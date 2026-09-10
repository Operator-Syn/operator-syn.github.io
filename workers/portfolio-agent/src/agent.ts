import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateText,
  type ModelMessage,
  streamText,
  toUIMessageStream,
  type UIMessage,
} from "ai";
import { createWorkersAI } from "workers-ai-provider";
import {
  type AgentIdentityRow,
  type AgentProps,
  MCP_CONNECTION_MAX_ATTEMPTS,
  MCP_CONNECTION_RETRY_BASE_DELAY_MS,
  MCP_CONNECTION_RETRY_MAX_DELAY_MS,
  MCP_DISCOVERY_TIMEOUT_MS,
  MCP_SERVER_NAME,
  MODEL_ALLOCATION_MESSAGE,
  MODEL_CAPACITY_MESSAGE,
  MODEL_ID,
  type PortfolioAgentEnvironment,
  ROLLING_TOKEN_BUDGET,
} from "./config.ts";
import {
  defaultPortfolioAgentDiagnosticSink,
  emitPortfolioAgentDiagnostic,
} from "./diagnostics.ts";
import { classifyModelCapacityError, isRefundableModelCapacityFailure } from "./errors.ts";
import {
  createPortfolioEvidenceState,
  hasCompletePortfolioToolCatalog,
  portfolioToolChoice,
  recordPortfolioToolResult,
  selectPortfolioTools,
  shouldStopPortfolioToolLoop,
} from "./evidence.ts";
import { collectExportToolCalls, sanitizeExportMessage } from "./export.ts";
import {
  AGENT_IDENTITY_HEADER,
  AGENT_REQUEST_ID_HEADER,
  normalizeAgentRequestId,
  parseAgentIdentity,
} from "./identity.ts";
import {
  asToolSet,
  buildSystemPrompt,
  estimateModelTokens,
  isUnsafeQuestion,
  latestUserQuestion,
  type McpTool,
  mergeAdjacentUserMessages,
  stripAssistantReasoning,
} from "./limits.ts";
import {
  ensurePortfolioMcpConnection,
  type PortfolioMcpEnsureOptions,
  type PortfolioMcpManager,
  rediscoverPortfolioMcpCatalog,
  remainingMcpDiscoveryTimeout,
} from "./mcp.ts";
import {
  checkRollingQuotaAvailability,
  consumeRollingQuota,
  estimateQuotaUnits,
  markRollingTokenUsageInFlight,
  markRollingTokenUsageUnknown,
  PROVISIONAL_OUTPUT_TOKEN_ALLOWANCE,
  releaseRollingTokenReservation,
  settleRollingTokenUsage,
} from "./quota.ts";
import {
  boundPortfolioAnswerStream,
  coalesceToolInputDeltas,
  isModelOutputChunkType,
} from "./stream.ts";
import {
  isThreadTitleEligible,
  persistGeneratedThreadTitle as persistThreadTitle,
} from "./thread-title.ts";

export type PortfolioAgentMessagePageOptions = {
  before?: string;
  limit?: number;
};

export type PortfolioAgentMessagePage = {
  messages: UIMessage[];
  nextCursor: string | null;
  hasMore: boolean;
};

const DEFAULT_THREAD_MESSAGE_PAGE_SIZE = 24;
const MAX_THREAD_MESSAGE_PAGE_SIZE = 50;

type PortfolioCatalog =
  | {
      tools: Record<string, McpTool>;
    }
  | {
      failure: "unavailable";
    };

function modelStreamError(error: unknown): string {
  const errorType = error instanceof Error ? error.name : typeof error;
  console.error(`[portfolio-agent] model stream failed (${errorType})`);
  const capacity = classifyModelCapacityError(error);
  if (capacity?.class === "account-allocation") return MODEL_ALLOCATION_MESSAGE;
  if (capacity?.class === "out-of-capacity") return MODEL_CAPACITY_MESSAGE;
  return "The assistant could not complete this response. Please try again.";
}

export class PortfolioAgent extends AIChatAgent<PortfolioAgentEnvironment, unknown, AgentProps> {
  static options = { hibernate: true, sendIdentityOnConnect: false };
  messageConcurrency = "queue" as const;
  // Catalog readiness owns the single bounded wait so a timeout is not paid twice.
  waitForMcpConnections = false;
  chatStreamStallTimeoutMs = 60_000;

  private identity: AgentProps | null = null;
  private readonly environment: PortfolioAgentEnvironment;
  private readonly diagnosticSink = defaultPortfolioAgentDiagnosticSink;

  constructor(
    ctx: ConstructorParameters<typeof AIChatAgent>[0],
    environment: PortfolioAgentEnvironment,
  ) {
    super(ctx, environment);
    this.environment = environment;
  }

  private emitDiagnostic(input: unknown): void {
    emitPortfolioAgentDiagnostic(this.diagnosticSink, input);
  }

  private persistIdentity(identity: AgentProps): void {
    this.identity = identity;
    this.sql(["DELETE FROM portfolio_agent_identity"] as unknown as TemplateStringsArray);
    this.sql(
      [
        "INSERT INTO portfolio_agent_identity (sub, sid, tid, q) VALUES (",
        ", ",
        ", ",
        ", ",
        ")",
      ] as unknown as TemplateStringsArray,
      identity.sub,
      identity.sid,
      identity.tid,
      identity.q,
    );
  }

  private portfolioMcpManager(): PortfolioMcpManager {
    return {
      add: () =>
        this.addMcpServer(MCP_SERVER_NAME, this.environment.PORTFOLIO_MCP_URL, {
          transport: { type: "streamable-http" },
          retry: {
            maxAttempts: MCP_CONNECTION_MAX_ATTEMPTS,
            baseDelayMs: MCP_CONNECTION_RETRY_BASE_DELAY_MS,
            maxDelayMs: MCP_CONNECTION_RETRY_MAX_DELAY_MS,
          },
        }),
      getState: () => this.getMcpServers(),
      remove: (id) => this.removeMcpServer(id),
      discover: (id, options) => this.mcp.discoverIfConnected(id, options),
    };
  }

  private ensureMcpConnection(options?: PortfolioMcpEnsureOptions): Promise<boolean> {
    return ensurePortfolioMcpConnection(this.portfolioMcpManager(), undefined, {
      ...options,
      diagnostics: {
        ...options?.diagnostics,
        sink: this.diagnosticSink,
      },
    });
  }

  async onStart(props?: AgentProps): Promise<void> {
    const startedAt = Date.now();
    this.emitDiagnostic({
      phase: "agent-start",
      outcome: "started",
      requestId: props?.requestId,
    });
    try {
      this.sql([
        "CREATE TABLE IF NOT EXISTS portfolio_agent_identity (sub TEXT NOT NULL, sid TEXT NOT NULL, tid TEXT NOT NULL, q INTEGER NOT NULL)",
      ] as unknown as TemplateStringsArray);
      if (props) {
        this.persistIdentity(props);
      }
      const stored = this.sql<AgentIdentityRow>([
        "SELECT sub, sid, tid, q FROM portfolio_agent_identity LIMIT 1",
      ] as unknown as TemplateStringsArray)[0];
      if (!this.identity && stored) {
        this.identity = parseAgentIdentity(JSON.stringify(stored), this.name);
      }
    } catch (error) {
      this.emitDiagnostic({
        phase: "agent-start",
        outcome: "failed",
        reason: "configuration",
        elapsedMs: Date.now() - startedAt,
        requestId: props?.requestId,
      });
      throw error;
    }
    this.emitDiagnostic({
      phase: "agent-start",
      outcome: "succeeded",
      elapsedMs: Date.now() - startedAt,
      requestId: props?.requestId,
    });
  }

  onConnect(
    _connection: Parameters<AIChatAgent<PortfolioAgentEnvironment>["onConnect"]>[0],
    context: Parameters<AIChatAgent<PortfolioAgentEnvironment>["onConnect"]>[1],
  ): void {
    const requestId = normalizeAgentRequestId(context.request.headers.get(AGENT_REQUEST_ID_HEADER));
    const identity = parseAgentIdentity(
      context.request.headers.get(AGENT_IDENTITY_HEADER),
      this.name,
    );
    if (identity) this.persistIdentity(identity);
    this.emitDiagnostic({
      phase: "ws-connect",
      outcome: "succeeded",
      requestId,
    });
  }

  private async persistGeneratedThreadTitle(
    answer: string,
    abortSignal?: AbortSignal,
    requestId?: string,
  ): Promise<void> {
    await persistThreadTitle({
      database: this.environment.AUTH_DB,
      identity: this.identity,
      messages: this.messages,
      answer,
      abortSignal,
      requestId,
      diagnosticSink: this.diagnosticSink,
      generateTitle: async ({
        system,
        messages,
        maxOutputTokens,
        reasoning,
        abortSignal: titleAbortSignal,
      }) =>
        generateText({
          model: createWorkersAI({ binding: this.environment.AI as never })(MODEL_ID, {
            sessionAffinity: this.sessionAffinity,
          }),
          system,
          messages,
          maxOutputTokens,
          maxRetries: 1,
          reasoning,
          // GLM-4.7 enables its thinking template by default. Title generation
          // is a bounded extraction task; disable that hidden reasoning pass so
          // the 32-token response contains the title text instead of exhausting
          // the output budget before a visible answer is emitted.
          providerOptions: {
            "workers-ai": {
              chat_template_kwargs: { enable_thinking: false },
            },
          },
          abortSignal: titleAbortSignal,
        }),
    });
  }

  private staticResponse(message: string): Response {
    const originalMessages = this.messages;
    const stream = createUIMessageStream({
      originalMessages,
      execute: ({ writer }) => {
        const id = crypto.randomUUID();
        writer.write({ type: "text-start", id });
        writer.write({ type: "text-delta", id, delta: message });
        writer.write({ type: "text-end", id });
        writer.write({ type: "finish", finishReason: "stop" });
        writer.setOutcome({ status: "completed" });
      },
    });
    return createUIMessageStreamResponse({ stream });
  }

  private limitResponse(message: string): Response {
    return this.staticResponse(
      `${message}\n\nYour conversation remains available to read. Try again after some usage rolls off the rolling window.`,
    );
  }

  private quotaFailureResponse(reason: "paused" | "rolling-limit" | "configuration"): Response {
    if (reason === "paused") {
      return this.staticResponse(
        `The assistant is paused by an administrator. This is separate from your rolling 1-hour ${ROLLING_TOKEN_BUDGET.toLocaleString()}-unit allowance. Try again later; your thread remains available to read.`,
      );
    }
    if (reason === "rolling-limit") {
      return this.limitResponse(
        `Your rolling 1-hour assistant budget is full (${ROLLING_TOKEN_BUDGET.toLocaleString()} quota units).`,
      );
    }
    return this.staticResponse("The portfolio assistant is not configured for this session.");
  }

  private async loadPortfolioCatalog(options?: OnChatMessageOptions): Promise<PortfolioCatalog> {
    const requestId = options?.requestId;
    const startedAt = Date.now();
    this.emitDiagnostic({
      phase: "mcp-catalog",
      outcome: "started",
      requestId,
    });
    const discoveryDeadline = Date.now() + MCP_DISCOVERY_TIMEOUT_MS;
    try {
      await this.mcp.waitForConnections({ timeout: MCP_DISCOVERY_TIMEOUT_MS });
    } catch {
      this.emitDiagnostic({
        phase: "mcp-catalog",
        outcome: "failed",
        reason: "timeout",
        elapsedMs: Date.now() - startedAt,
        requestId,
      });
      return { failure: "unavailable" };
    }
    let rawTools = this.mcp.getAITools() as Record<string, McpTool>;
    let selectedTools = selectPortfolioTools(rawTools);
    if (!hasCompletePortfolioToolCatalog(selectedTools)) {
      // A restored discovery failure can leave the transport connected with an
      // empty catalog; refresh it in place before using destructive recovery.
      const remainingTimeoutMs = remainingMcpDiscoveryTimeout(discoveryDeadline);
      const rediscovered =
        remainingTimeoutMs > 0
          ? await rediscoverPortfolioMcpCatalog(
              this.portfolioMcpManager(),
              undefined,
              remainingTimeoutMs,
              { requestId, sink: this.diagnosticSink },
            )
          : false;
      if (!rediscovered && remainingMcpDiscoveryTimeout(discoveryDeadline) > 0) {
        await this.ensureMcpConnection({
          deadlineMs: discoveryDeadline,
          forceReconnect: true,
          diagnostics: { requestId },
        });
      }
      rawTools = this.mcp.getAITools() as Record<string, McpTool>;
      selectedTools = selectPortfolioTools(rawTools);
    }
    if (!hasCompletePortfolioToolCatalog(selectedTools)) {
      this.emitDiagnostic({
        phase: "mcp-catalog",
        outcome: "failed",
        reason: remainingMcpDiscoveryTimeout(discoveryDeadline) === 0 ? "timeout" : "no-connection",
        toolCount: Object.keys(selectedTools).length,
        elapsedMs: Date.now() - startedAt,
        requestId,
      });
      return { failure: "unavailable" };
    }

    this.emitDiagnostic({
      phase: "mcp-catalog",
      outcome: "succeeded",
      toolCount: Object.keys(selectedTools).length,
      elapsedMs: Date.now() - startedAt,
      requestId,
    });
    return { tools: selectedTools };
  }

  async onChatMessage(
    _onFinish: Parameters<AIChatAgent<PortfolioAgentEnvironment>["onChatMessage"]>[0],
    options?: OnChatMessageOptions,
  ): Promise<Response> {
    const identity = this.identity;
    if (!identity) return this.staticResponse("This assistant session is not authenticated.");
    const question = latestUserQuestion(this.messages);
    if (!question) return this.staticResponse("Please ask a portfolio question.");
    if (isUnsafeQuestion(question)) {
      return this.staticResponse(
        "I can only help with this portfolio and its linked project evidence.",
      );
    }
    const quotaAvailability = await checkRollingQuotaAvailability(
      this.environment.AUTH_DB,
      identity.sub,
    );
    if (quotaAvailability !== "available") {
      this.emitDiagnostic({
        phase: "quota",
        outcome: "rejected",
        quotaDecision: quotaAvailability,
        reason: quotaAvailability,
        requestId: options?.requestId,
      });
      return this.quotaFailureResponse(quotaAvailability);
    }
    this.emitDiagnostic({
      phase: "quota",
      outcome: "succeeded",
      quotaDecision: "available",
      requestId: options?.requestId,
    });
    const catalog = await this.loadPortfolioCatalog(options);
    if ("failure" in catalog) {
      return this.staticResponse(
        "I could not reach the public portfolio evidence service. Please try again.",
      );
    }

    const selectedTools = asToolSet(catalog.tools);
    const modelInputMessages = stripAssistantReasoning(this.messages);
    const converted = await convertToModelMessages(modelInputMessages, {
      tools: selectedTools,
      ignoreIncompleteToolCalls: true,
    });
    const modelMessages = mergeAdjacentUserMessages(converted as ModelMessage[]);
    const systemPrompt = buildSystemPrompt();
    const provisionalTokens = estimateQuotaUnits(
      estimateModelTokens(systemPrompt, modelMessages),
      PROVISIONAL_OUTPUT_TOKEN_ALLOWANCE,
    );
    const quota = await consumeRollingQuota(
      this.environment.AUTH_DB,
      identity.sub,
      provisionalTokens,
    );
    if (!quota.allowed) {
      this.emitDiagnostic({
        phase: "quota",
        outcome: "rejected",
        quotaDecision: quota.reason,
        reason: quota.reason,
        requestId: options?.requestId,
      });
      return this.quotaFailureResponse(quota.reason);
    }
    this.emitDiagnostic({
      phase: "quota",
      outcome: "succeeded",
      quotaDecision: "reserved",
      quotaState: "reserved",
      requestId: options?.requestId,
    });
    try {
      await markRollingTokenUsageInFlight(this.environment.AUTH_DB, quota.reservationId);
    } catch {
      // A missing/old migration must not turn a model request into a user-visible failure.
    }
    let modelOutputObserved = false;
    let quotaFinalized = false;
    const releaseProviderCapacityReservation = async (error: unknown): Promise<boolean> => {
      if (quotaFinalized || !isRefundableModelCapacityFailure(error, modelOutputObserved)) {
        return false;
      }
      const released = await releaseRollingTokenReservation(
        this.environment.AUTH_DB,
        quota.reservationId,
      ).catch(() => false);
      if (!released) return false;
      quotaFinalized = true;
      this.emitDiagnostic({
        phase: "quota",
        outcome: "succeeded",
        quotaDecision: "released",
        quotaState: "released",
        reason: "provider-error",
        requestId: options?.requestId,
      });
      return true;
    };
    const modelStartedAt = Date.now();
    this.emitDiagnostic({
      phase: "model",
      outcome: "started",
      requestId: options?.requestId,
    });
    const workersai = createWorkersAI({ binding: this.environment.AI as never });
    let evidenceState = createPortfolioEvidenceState();
    let result: ReturnType<typeof streamText>;
    try {
      result = streamText({
        model: workersai(MODEL_ID, { sessionAffinity: this.sessionAffinity }),
        system: systemPrompt,
        messages: modelMessages,
        tools: selectedTools,
        prepareStep: () => ({ toolChoice: portfolioToolChoice(evidenceState) }),
        stopWhen: () => shouldStopPortfolioToolLoop(evidenceState),
        abortSignal: options?.abortSignal,
        onChunk: ({ chunk }) => {
          if (isModelOutputChunkType(chunk.type)) modelOutputObserved = true;
        },
        onError: async ({ error }) => {
          await releaseProviderCapacityReservation(error);
        },
        onToolExecutionStart: () => {
          this.emitDiagnostic({
            phase: "mcp-tool",
            outcome: "started",
            toolCount: 1,
            requestId: options?.requestId,
          });
        },
        onToolExecutionEnd: ({ toolCall, toolOutput }) => {
          const previousSuccesses = evidenceState.successfulResults;
          evidenceState = recordPortfolioToolResult(evidenceState, toolCall.toolName, toolOutput);
          const usable = evidenceState.successfulResults > previousSuccesses;
          this.emitDiagnostic({
            phase: "mcp-tool",
            outcome: usable ? "succeeded" : "failed",
            reason: usable ? undefined : "unusable-result",
            toolCount: 1,
            requestId: options?.requestId,
          });
        },
        onEnd: async ({ usage, finishReason, text }) => {
          const modelSucceeded = finishReason !== "error" && evidenceState.successfulResults > 0;
          const diagnosticFinishReason = ["stop", "length", "tool-calls", "error"].includes(
            finishReason,
          )
            ? finishReason
            : "unknown";
          const aborted = options?.abortSignal?.aborted ?? false;
          const titleEligible = isThreadTitleEligible(
            finishReason,
            text,
            options?.abortSignal?.aborted ?? false,
          );
          this.emitDiagnostic({
            phase: "model",
            outcome: modelSucceeded ? "succeeded" : "failed",
            reason: modelSucceeded
              ? undefined
              : finishReason === "error"
                ? "provider-error"
                : aborted
                  ? "aborted"
                  : "unusable-result",
            finishReason: diagnosticFinishReason as
              | "stop"
              | "length"
              | "tool-calls"
              | "error"
              | "unknown",
            streamOutcome: modelSucceeded
              ? "completed"
              : aborted
                ? "aborted"
                : finishReason === "error"
                  ? "provider-error"
                  : "unknown",
            elapsedMs: Date.now() - modelStartedAt,
            requestId: options?.requestId,
          });
          this.emitDiagnostic({
            phase: "settlement",
            outcome: "started",
            requestId: options?.requestId,
          });
          if (quota.allowed && !quotaFinalized) {
            try {
              const settled = await settleRollingTokenUsage(
                this.environment.AUTH_DB,
                quota.reservationId,
                usage,
              );
              if (!settled) {
                await markRollingTokenUsageUnknown(
                  this.environment.AUTH_DB,
                  quota.reservationId,
                ).catch(() => false);
                this.emitDiagnostic({
                  phase: "settlement",
                  outcome: "failed",
                  quotaDecision: "settlement-failed",
                  reason: "unknown-usage",
                  quotaState: "unknown",
                  requestId: options?.requestId,
                });
                console.error(
                  "[portfolio-agent] actual token usage settlement did not update reservation",
                );
              } else {
                this.emitDiagnostic({
                  phase: "settlement",
                  outcome: "succeeded",
                  quotaDecision: "settled",
                  quotaState: "settled",
                  requestId: options?.requestId,
                });
              }
            } catch (error) {
              await markRollingTokenUsageUnknown(
                this.environment.AUTH_DB,
                quota.reservationId,
              ).catch(() => false);
              this.emitDiagnostic({
                phase: "settlement",
                outcome: "failed",
                quotaDecision: "settlement-failed",
                reason: "unknown-usage",
                quotaState: "unknown",
                requestId: options?.requestId,
              });
              const errorType = error instanceof Error ? error.name : typeof error;
              console.error(
                `[portfolio-agent] actual token usage settlement failed (${errorType})`,
              );
            }
          }
          if (titleEligible) {
            await this.persistGeneratedThreadTitle(text, options?.abortSignal, options?.requestId);
          }
          try {
            await this.environment.AUTH_DB.prepare(
              "UPDATE threads SET updated_at = ?1 WHERE id = ?2 AND sub = ?3",
            )
              .bind(Date.now(), identity.tid, identity.sub)
              .run();
          } catch (error) {
            const errorType = error instanceof Error ? error.name : typeof error;
            console.error(`[portfolio-agent] turn metadata update failed (${errorType})`);
          }
          console.log("[portfolio-agent] aggregate turn completed");
        },
      });
    } catch (error) {
      const released = await releaseRollingTokenReservation(
        this.environment.AUTH_DB,
        quota.reservationId,
      ).catch(() => false);
      if (released) {
        quotaFinalized = true;
        this.emitDiagnostic({
          phase: "quota",
          outcome: "succeeded",
          quotaDecision: "released",
          quotaState: "released",
          reason: "pre-model-failure",
          requestId: options?.requestId,
        });
      }
      throw error;
    }

    const stream = createUIMessageStream({
      originalMessages: this.messages,
      execute: ({ writer }) => {
        writer.write({ type: "start" });
        writer.merge(
          boundPortfolioAnswerStream(
            coalesceToolInputDeltas(
              toUIMessageStream({
                stream: result.stream,
                tools: selectedTools,
                sendReasoning: true,
                sendSources: false,
                sendStart: false,
                sendFinish: false,
                onError: (error) => {
                  const aborted = options?.abortSignal?.aborted ?? false;
                  const providerCapacity = classifyModelCapacityError(error);
                  this.emitDiagnostic({
                    phase: "model",
                    outcome: "failed",
                    reason: aborted
                      ? "aborted"
                      : providerCapacity
                        ? "provider-error"
                        : "stream-error",
                    quotaDecision: quotaFinalized ? "released" : "provisional",
                    quotaState: quotaFinalized ? "released" : "unknown",
                    streamOutcome: aborted
                      ? "aborted"
                      : providerCapacity
                        ? "provider-error"
                        : "unknown",
                    providerErrorClass: providerCapacity?.class,
                    providerErrorCode: providerCapacity?.code ?? undefined,
                    requestId: options?.requestId,
                  });
                  const errorType = error instanceof Error ? error.name : typeof error;
                  console.error(
                    `[portfolio-agent] model stream failed (${errorType})${options?.requestId ? ` request=${options.requestId}` : ""}`,
                  );
                  return modelStreamError(error);
                },
              }),
            ),
            {
              hasEvidence: () => evidenceState.successfulResults > 0,
              sources: () => evidenceState.sources,
              fallbackMessage:
                "I couldn't verify that from the public portfolio evidence. Try asking about another part of the portfolio.",
            },
          ),
        );
      },
    });
    return createUIMessageStreamResponse({ stream });
  }

  async persistMessages(
    messages: UIMessage[],
    excludeBroadcastIds?: string[],
    options?: { _deleteStaleRows?: boolean },
  ): Promise<void> {
    // A regenerate request can contain only the visible window. Keep the
    // Durable Object's unseen rows unless the request is effectively complete.
    const shouldPreserveUnseenHistory =
      options?._deleteStaleRows === true &&
      this.messages.length > messages.length + 1 &&
      messages.every((message) => this.messages.some((current) => current.id === message.id));
    await super.persistMessages(
      messages,
      excludeBroadcastIds,
      shouldPreserveUnseenHistory ? { ...options, _deleteStaleRows: false } : options,
    );
  }

  async getThreadMessages(
    options?: PortfolioAgentMessagePageOptions,
  ): Promise<UIMessage[] | PortfolioAgentMessagePage> {
    await this.waitUntilStable({ timeout: 5_000 });
    if (!options) return this.messages;

    const requestedLimit = Number.isFinite(options.limit)
      ? Math.trunc(options.limit ?? DEFAULT_THREAD_MESSAGE_PAGE_SIZE)
      : DEFAULT_THREAD_MESSAGE_PAGE_SIZE;
    const limit = Math.min(MAX_THREAD_MESSAGE_PAGE_SIZE, Math.max(1, requestedLimit));
    const end = options.before
      ? this.messages.findIndex((message) => message.id === options.before)
      : this.messages.length;
    if (options.before && end < 0) {
      throw new Error("Invalid thread message cursor.");
    }

    const start = Math.max(0, end - limit);
    const messages = this.messages.slice(start, end);
    return {
      messages,
      nextCursor: start > 0 ? (messages[0]?.id ?? null) : null,
      hasMore: start > 0,
    };
  }

  async exportThread(): Promise<Record<string, unknown>> {
    await this.waitUntilStable({ timeout: 5_000 });
    const messages = this.messages
      .map(sanitizeExportMessage)
      .filter((message): message is Record<string, unknown> => message !== null);
    return {
      formatVersion: 2,
      threadId: this.identity?.tid ?? null,
      exportedAt: new Date().toISOString(),
      messages,
      toolCalls: collectExportToolCalls(messages),
      note: "Public reasoning traces and sanitized model tool activity are included for audit. Tool arguments, raw MCP payloads, provider metadata, upstream errors, and credentials are omitted.",
    };
  }

  async deleteThread(): Promise<{ deleted: true }> {
    const stable = await this.waitUntilStable({ timeout: 5_000 });
    if (!stable) throw new Error("THREAD_BUSY");
    this.messages = [];
    await this.persistMessages([], [], { _deleteStaleRows: true });
    return { deleted: true };
  }
}
