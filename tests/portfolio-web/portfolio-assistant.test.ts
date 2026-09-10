import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";
import type { UIMessage } from "ai";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  describeAssistantError,
  MODEL_ALLOCATION_MESSAGE,
} from "../../apps/portfolio-web/src/components/portfolioAssistant/portfolioAssistantErrors.ts";
import {
  normalizeAssistantMarkdownHref,
  normalizeAssistantMarkdownText,
  transformAssistantMarkdownUrl,
} from "../../apps/portfolio-web/src/components/portfolioAssistant/portfolioAssistantLinkPolicy.ts";
import { AssistantMarkdownLink } from "../../apps/portfolio-web/src/components/portfolioAssistant/portfolioAssistantLinks.tsx";
import {
  assistantUserLabel,
  canStartAnotherThread,
  collapseDuplicateAssistantSourceMessages,
  formatAssistantThreadOptions,
  hasThreadActivity,
  hasVisibleMessageContent,
  latestCompactionNotice,
  messageFileParts,
  messageReasoning,
  messageSnapshotKey,
  messageSourceDocumentParts,
  messageSourceUrlParts,
  messageText,
  PORTFOLIO_ASSISTANT_STARTER_PROMPTS,
  parseCompactionNotice,
  shouldShowAssistantTyping,
  splitAssistantToolCalls,
  splitStreamingMarkdown,
} from "../../apps/portfolio-web/src/components/portfolioAssistant/portfolioAssistantMessages.ts";

const repositoryRoot = resolve(import.meta.dirname, "../../");
const appPath = resolve(repositoryRoot, "apps/portfolio-web/src/App.tsx");
const fabPath = resolve(
  repositoryRoot,
  "apps/portfolio-web/src/components/portfolioAssistant/PortfolioAssistantFab.tsx",
);
const apiPath = resolve(
  repositoryRoot,
  "apps/portfolio-web/src/components/portfolioAssistant/portfolioAssistantApi.ts",
);
const availabilityPath = resolve(
  repositoryRoot,
  "apps/portfolio-web/src/components/portfolioAssistant/portfolioAssistantAvailability.ts",
);
const configPath = resolve(
  repositoryRoot,
  "apps/portfolio-web/src/components/portfolioAssistant/portfolioAssistantConfig.ts",
);
const cssPath = resolve(
  repositoryRoot,
  "apps/portfolio-web/src/components/portfolioAssistant/PortfolioAssistant.css",
);

function renderAssistantMarkdown(value: string): string {
  return renderToStaticMarkup(
    createElement(
      ReactMarkdown,
      {
        components: { a: AssistantMarkdownLink } as Components,
        remarkPlugins: [remarkGfm],
        urlTransform: transformAssistantMarkdownUrl,
      },
      normalizeAssistantMarkdownText(value),
    ),
  );
}

test("renders a provider allocation failure instead of a generic interruption", () => {
  assert.deepEqual(
    describeAssistantError(
      new Error("The provider's daily Workers AI allocation has been used up."),
    ),
    {
      title: "Provider allocation exhausted.",
      message: MODEL_ALLOCATION_MESSAGE,
    },
  );
  assert.equal(
    describeAssistantError(new Error("network stream failed")).title,
    "Response interrupted.",
  );
});

test("normalizes assistant Markdown links before they reach SPA navigation", () => {
  assert.equal(
    normalizeAssistantMarkdownHref("https://syn-forge.com/%2F"),
    "https://syn-forge.com/",
  );
  assert.equal(
    normalizeAssistantMarkdownHref("https://syn-forge.com/projects"),
    "https://syn-forge.com/projects",
  );
  assert.equal(normalizeAssistantMarkdownHref("https://syn-forge.com/%E2%80%94is"), null);
  assert.equal(normalizeAssistantMarkdownHref("https://syn-forge.com/missing"), null);
  assert.equal(
    normalizeAssistantMarkdownHref("https://github.com/Operator-Syn"),
    "https://github.com/Operator-Syn",
  );
  assert.equal(
    normalizeAssistantMarkdownText("See https://syn-forge.com/—is here."),
    "See https://syn-forge.com/ —is here.",
  );

  const labels = [
    "Know more about me",
    "Operating Systems",
    "Programming Languages",
    "Frameworks",
    "Database",
    "Virtualization & Containerization",
    "Networking and Security",
    "Social Links",
    "Xbox",
    "Steam",
    "LinkedIn",
    "PayPal",
    "GitHub",
    "Discord",
    "Facebook",
    "Instagram",
    "GMail",
  ];
  const rendered = renderAssistantMarkdown(
    [
      "Your portfolio—the site that returns https://syn-forge.com/—is the public profile.",
      "",
      ...labels.map((label) => `[${label}](https://syn-forge.com/%2F)`),
      "[Instagram](https://www.instagram.com/rohn_rohnann)",
      "[Unknown](https://syn-forge.com/missing)",
    ].join("\n"),
  );
  const hrefs = [...rendered.matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(hrefs.filter((href) => href === "https://syn-forge.com/").length, labels.length + 1);
  assert.equal(hrefs.includes("https://www.instagram.com/rohn_rohnann"), true);
  assert.equal(hrefs.includes("https://syn-forge.com/missing"), false);
  assert.doesNotMatch(rendered, /%2F|%E2%80%94/);
  assert.match(rendered, /https:\/\/syn-forge\.com\/<\/a> —is/);
});

test("mounts the portfolio assistant globally with bounded authenticated chat controls", async () => {
  const [appSource, fabSource, apiSource, configSource, cssSource] = await Promise.all([
    readFile(appPath, "utf8"),
    readFile(fabPath, "utf8"),
    readFile(apiPath, "utf8"),
    readFile(configPath, "utf8"),
    readFile(cssPath, "utf8"),
  ]);

  assert.match(appSource, /<PortfolioAssistantFab \/>/);
  assert.match(fabSource, /useAgentChat/);
  assert.match(fabSource, /useAgent/);
  assert.match(fabSource, /AGENT_QUERY_CACHE_TTL_MS = 4 \* 60 \* 1_000/);
  assert.match(fabSource, /cacheTtl: AGENT_QUERY_CACHE_TTL_MS/);
  assert.match(fabSource, /<Suspense[\s\S]*fallback=/);
  assert.match(fabSource, /AssistantChatErrorBoundary/);
  assert.match(fabSource, /turnstile/);
  assert.match(fabSource, /New assistant thread/);
  assert.match(fabSource, /Export assistant thread/);
  assert.match(fabSource, /Delete assistant thread/);
  assert.match(fabSource, /activeThreadBusy/);
  assert.match(fabSource, /deleteDisabled/);
  assert.match(fabSource, /if \(activeThreadId && !activeThreadBusy\) setDeletePendingThreadId/);
  assert.match(
    fabSource,
    /if \(!deletePendingThreadId \|\| isDeleting \|\| activeThreadBusy\) return/,
  );
  assert.match(fabSource, /provisional quota units/);
  assert.match(fabSource, /settled quota units recorded/);
  assert.match(fabSource, /providerAllocationExhausted \|\| isRetrying/);
  assert.match(fabSource, /Unavailable until reset/);
  assert.match(fabSource, /Legacy context summary/);
  assert.match(fabSource, /messageReasoning\(message\)/);
  assert.match(fabSource, /<details className="portfolio-assistant-reasoning">/);
  assert.match(fabSource, /<summary>Show model reasoning<\/summary>/);
  assert.match(fabSource, /AssistantThreadSelect/);
  assert.match(fabSource, /AssistantThreadActionsMenu/);
  assert.match(fabSource, /Expand portfolio assistant for reading/);
  assert.match(fabSource, /data-assistant-mode=/);
  assert.match(fabSource, /aria-modal=\{isDialogPresentation \? "true" : undefined\}/);
  assert.match(fabSource, /data-assistant-mobile-modal=/);
  assert.match(
    fabSource,
    /ASSISTANT_RESPONSIVE_DIALOG_QUERY = "\(max-width: 640px\), \(max-height: 560px\)"/,
  );
  assert.match(fabSource, /function useAssistantResponsiveDialog/);
  assert.match(fabSource, /!isDialogPresentation \? \(/);
  assert.match(fabSource, /portfolio-assistant-source-disclosure/);
  assert.match(fabSource, /ChevronDown/);
  assert.match(fabSource, /aria-expanded=\{isOpen\}/);
  assert.match(fabSource, /aria-label=\{`Assistant thread: \$\{selectedLabel\}`\}/);
  assert.match(fabSource, /role="listbox"/);
  assert.match(fabSource, /stopImmediatePropagation\(\)/);
  assert.match(fabSource, /assistantUserLabel\(session\.user\?\.displayName\)/);
  assert.match(fabSource, /message\.role === "user" \? userDisplayName : "Assistant"/);
  assert.match(fabSource, /import remarkGfm from "remark-gfm";/);
  assert.match(fabSource, /AssistantMarkdownLink/);
  assert.match(fabSource, /normalizeAssistantMarkdownText\(text\)/);
  assert.match(fabSource, /splitAssistantToolCalls\(normalizedText\)/);
  assert.match(fabSource, /portfolio-assistant-tool-call/);
  assert.match(fabSource, /<AssistantToolCall[\s\S]*?isWorking=\{isStreaming\}/);
  assert.match(fabSource, /aria-busy=\{isWorking\}/);
  assert.match(fabSource, /data-tool-call-state=\{isWorking \? "working" : "recorded"\}/);
  assert.match(fabSource, /isWorking \? "Working…" : "Recorded"/);
  assert.match(fabSource, /<ReactMarkdown[\s\S]*?remarkPlugins=\{\[remarkGfm\]\}[\s\S]*?>/);
  assert.match(fabSource, /AssistantMessageAttachments/);
  assert.match(fabSource, /AssistantMarkdownImage/);
  assert.match(fabSource, /function AssistantMarkdownTable/);
  assert.match(fabSource, /table: AssistantMarkdownTable/);
  assert.match(cssSource, /\.portfolio-assistant-table-scroll\s*\{[\s\S]*?overflow-x:\s*auto;/);
  assert.match(
    cssSource,
    /\.portfolio-assistant-message table\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*100%;[\s\S]*?border-collapse:\s*collapse;/,
  );
  assert.match(
    cssSource,
    /\.portfolio-assistant-message table\s*\{[\s\S]*?width:\s*100%;[\s\S]*?min-width:\s*100%;[\s\S]*?table-layout:\s*auto;/,
  );
  assert.match(
    cssSource,
    /\.portfolio-assistant-message th,[\s\S]*?\.portfolio-assistant-message td\s*\{[\s\S]*?min-width:\s*7rem;[\s\S]*?padding:\s*0\.8rem 1rem;[\s\S]*?overflow-wrap:\s*break-word;[\s\S]*?word-break:\s*normal;/,
  );
  assert.match(
    cssSource,
    /@media \(max-width: 640px\)[\s\S]*?\.portfolio-assistant-message table\s*\{[\s\S]*?min-width:\s*42rem;[\s\S]*?table-layout:\s*auto;/,
  );
  assert.doesNotMatch(
    cssSource,
    /@media \(max-width: 640px\)[\s\S]*?\.portfolio-assistant-message table\s*\{[\s\S]*?table-layout:\s*fixed;/,
  );
  assert.doesNotMatch(fabSource, /onData:\s*handleData/);
  assert.doesNotMatch(fabSource, /visibleCompactionNotice/);
  assert.doesNotMatch(fabSource, /maxLength=\{2_000\}/);
  assert.match(fabSource, /describeAssistantError/);
  assert.match(fabSource, /useAssistantConnectionGate/);
  assert.match(fabSource, /Rolling budget reached/);
  assert.match(fabSource, /Shared capacity paused/);
  assert.match(fabSource, /AGENT_PAUSED/);
  assert.match(fabSource, /shared Workers AI capacity/);
  assert.match(fabSource, /AssistantQuotaStatus/);
  assert.match(fabSource, /getAssistantQuota/);
  assert.match(fabSource, /Checking quota usage/);
  assert.match(fabSource, /quota units used/);
  assert.doesNotMatch(fabSource, /tokens used/);
  assert.doesNotMatch(fabSource, /estimated token usage/);
  assert.match(fabSource, /role="progressbar"/);
  assert.match(fabSource, /Next refresh in/);
  assert.match(fabSource, /Preparing a secure assistant session/);
  assert.match(fabSource, /AssistantAccessError error=\{sessionError\}/);
  assert.match(fabSource, /onRetry=\{\(\) => void openAssistant\(\)\}/);
  assert.match(fabSource, /setSessionError\(error\);/);
  assert.match(fabSource, /submitPendingRef/);
  assert.match(fabSource, /isSubmitting/);
  assert.match(fabSource, /regenerate\(\)/);
  assert.match(fabSource, /isStreaming/);
  assert.match(
    cssSource,
    /\.portfolio-assistant-reasoning:not\(\[open\]\)[\s\S]*?display:\s*none;/,
  );
  assert.match(cssSource, /\.portfolio-assistant-access-error\s*\{/);
  assert.doesNotMatch(apiSource, /\/agent\/token/);
  assert.match(apiSource, /"\/agent\/prepare"/);
  assert.match(fabSource, /publicAuthOrigin/);
  assert.match(fabSource, /rid/);
  assert.match(fabSource, /maxRetries: 3/);
  assert.match(fabSource, /connectionTimeout: 10_000/);
  assert.doesNotMatch(fabSource, /token:\s*await getToken/);
  assert.match(apiSource, /"\/threads"/);
  assert.match(configSource, /VITE_PUBLIC_AUTH_URL/);
  assert.doesNotMatch(configSource, /VITE_PORTFOLIO_AGENT_URL/);
  assert.match(configSource, /required for local development/);
  assert.doesNotMatch(apiSource, /public-auth\.syn-forge\.com/);
  assert.doesNotMatch(fabSource, /assistant\.syn-forge\.com/);
  assert.match(cssSource, /portfolio-assistant-fab/);
  assert.match(cssSource, /@keyframes portfolio-assistant-panel-enter/);
  assert.match(cssSource, /portfolio-assistant-panel-enter/);
  assert.match(cssSource, /\.portfolio-assistant-composer:focus-within/);
  assert.match(cssSource, /\.portfolio-assistant-quota\s*\{/);
  assert.match(cssSource, /\.portfolio-assistant-quota-meter\s*\{/);
  assert.match(cssSource, /\.portfolio-assistant-quota-refresh\s*\{/);
  assert.match(cssSource, /transition:/);
  assert.match(cssSource, /prefers-reduced-motion/);
  assert.doesNotMatch(fabSource, /auth_token/);
  assert.doesNotMatch(apiSource, /localStorage|sessionStorage/);
});

test("keeps agent-development with an explicit active assistant gate", async () => {
  const [availabilitySource, fabSource] = await Promise.all([
    readFile(availabilityPath, "utf8"),
    readFile(fabPath, "utf8"),
  ]);

  assert.match(
    availabilitySource,
    /portfolioAssistantAvailability: PortfolioAssistantAvailability = "active"/,
  );
  assert.match(fabSource, /portfolioAssistantAvailability === "teaser"/);
  assert.match(fabSource, /"Open portfolio assistant"/);
});

test("keeps long assistant content on one readable scroll surface", async () => {
  const [cssSource, fabSource] = await Promise.all([
    readFile(cssPath, "utf8"),
    readFile(fabPath, "utf8"),
  ]);

  assert.match(
    cssSource,
    /\.portfolio-assistant-panel\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;/,
  );
  assert.match(
    cssSource,
    /\.portfolio-assistant-body\s*\{[\s\S]*?min-height:\s*0;[\s\S]*?overflow-y:\s*auto;/,
  );
  assert.match(cssSource, /\.portfolio-assistant-header > div\s*\{[\s\S]*?min-width:\s*0;/);
  assert.match(cssSource, /\.portfolio-assistant-chat\s*\{[\s\S]*?min-width:\s*0;/);
  assert.match(cssSource, /\.portfolio-assistant-transcript\s*\{[\s\S]*?overflow-y:\s*auto;/);
  assert.match(
    cssSource,
    /\.portfolio-assistant-transcript-shell\s*\{[\s\S]*?position:\s*relative;[\s\S]*?overflow:\s*hidden;[\s\S]*?margin-inline-end:\s*calc\(-1 \* var\(--assistant-session-inline-pad\)\);/,
  );
  assert.match(
    cssSource,
    /\.portfolio-assistant-transcript\s*\{[\s\S]*?overflow-y:\s*auto;[\s\S]*?padding-inline-end:\s*var\(--assistant-session-inline-pad\);/,
  );
  assert.match(
    cssSource,
    /\.portfolio-assistant-session\s*\{[\s\S]*?--assistant-session-inline-pad:\s*1rem;/,
  );
  assert.match(
    cssSource,
    /\.portfolio-assistant-body\[data-chat-state="active"\]\s*\{[\s\S]*?overflow:\s*hidden;/,
  );
  assert.match(
    cssSource,
    /\.portfolio-assistant-message-list\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?overflow:\s*visible;/,
  );
  assert.doesNotMatch(cssSource, /max-height:\s*24rem/);
  assert.match(
    cssSource,
    /\.portfolio-assistant-message\s*\{[\s\S]*?min-width:\s*0;[\s\S]*?overflow-wrap:\s*anywhere;/,
  );
  assert.match(
    cssSource,
    /\.portfolio-assistant-message a\s*\{[\s\S]*?overflow-wrap:\s*anywhere;[\s\S]*?word-break:\s*break-word;/,
  );
  assert.match(
    cssSource,
    /\.portfolio-assistant-message a\s*\{[\s\S]*?text-decoration-line:\s*underline;/,
  );
  assert.match(
    cssSource,
    /\.portfolio-assistant-message-markdown\s*>\s*:where\(p, ul, ol, blockquote, pre, hr\)/,
  );
  assert.match(
    cssSource,
    /\.portfolio-assistant-message-markdown\s*> hr\s*\{[\s\S]*?border-block-start:/,
  );
  assert.match(cssSource, /\.portfolio-assistant-image-stage\s*\{[\s\S]*?aspect-ratio:/);
  assert.match(
    cssSource,
    /\.portfolio-assistant-thread-select-trigger\s*\{[\s\S]*?display:\s*flex;[\s\S]*?padding:\s*0\.35rem 2\.75rem 0\.35rem 0\.75rem;/,
  );
  assert.match(
    cssSource,
    /\.portfolio-assistant-thread-select-chevron\s*\{[\s\S]*?inset-inline-end:\s*0\.75rem;[\s\S]*?transform:\s*translateY\(-50%\);/,
  );
  assert.match(
    cssSource,
    /\.portfolio-assistant-thread-select-chevron\[data-state="open"\]\s*\{[\s\S]*?rotate\(180deg\);/,
  );
  assert.doesNotMatch(
    cssSource,
    /\.portfolio-assistant-thread-select:focus-within[\s\S]*?rotate\(180deg\)/,
  );
  assert.match(
    cssSource,
    /\.portfolio-assistant-file-attachment\s*\{[\s\S]*?text-decoration:\s*none;/,
  );
  assert.match(
    cssSource,
    /\.portfolio-assistant-toolbar\s*\{[\s\S]*?position:\s*relative;[\s\S]*?z-index:\s*3;[\s\S]*?background:\s*var\(--color-surface, #171918\);/,
  );
  assert.match(
    cssSource,
    /\.portfolio-assistant\[data-assistant-mode="expanded"\]\s+\.portfolio-assistant-panel\s*\{[\s\S]*?inset-inline:\s*max\([\s\S]*?max-width:\s*none;/,
  );
  assert.match(cssSource, /--assistant-composer-min-block-size:\s*4\.5rem/);
  assert.match(
    cssSource,
    /\.portfolio-assistant-message\.assistant\s*\{[\s\S]*?width:\s*min\(100%, 68rem\)[\s\S]*?background:\s*var\(--color-surface\);/,
  );
  assert.match(cssSource, /\.portfolio-assistant-message-avatar/);
  assert.match(cssSource, /\.portfolio-assistant-message-avatar-image/);
  assert.match(fabSource, /function AssistantUserAvatar/);
  assert.match(fabSource, /userPictureUrl/);
  assert.match(fabSource, /referrerPolicy="no-referrer"/);
  assert.match(fabSource, /const AuthorIcon = message\.role === "user" \? CircleUserRound : Bot/);
  assert.match(cssSource, /\.portfolio-assistant-source-disclosure/);
  assert.match(cssSource, /\.portfolio-assistant-tool-call\s*\{/);
  assert.match(cssSource, /\.portfolio-assistant-tool-call-state\s*\{/);
  assert.match(cssSource, /\.portfolio-assistant-tool-call-state\.is-working\s*\{/);
  assert.match(cssSource, /\.portfolio-assistant-tool-call\.is-working\s*\{/);
  assert.match(cssSource, /\.portfolio-assistant-quota-summary/);
});

test("keeps streaming reveal quiet and intentional", async () => {
  const cssSource = await readFile(cssPath, "utf8");
  const fabSource = await readFile(fabPath, "utf8");

  assert.match(
    cssSource,
    /\.portfolio-assistant-typing\s*\{[\s\S]*?border:\s*0;[\s\S]*?background:\s*transparent;[\s\S]*?text-transform:\s*none;/,
  );
  assert.match(cssSource, /@keyframes portfolio-assistant-typing-fade/);
  assert.match(cssSource, /@keyframes portfolio-assistant-stream-caret/);
  assert.match(cssSource, /\.portfolio-assistant-stream-caret/);
  assert.match(cssSource, /\.portfolio-assistant-stream-caret\.is-settling/);
  assert.match(cssSource, /\.portfolio-assistant-streaming-tail/);
  assert.match(cssSource, /\.portfolio-assistant-streaming-mark/);
  assert.match(fabSource, /function StreamingAssistantMarkdown/);
  assert.match(fabSource, /data-streaming-caret=/);
  assert.match(fabSource, /splitStreamingMarkdown\(normalizedText\)/);
  assert.match(fabSource, /setCaretVisible\(false\), 180\)/);
  assert.doesNotMatch(fabSource, /document\.createTreeWalker/);
  assert.doesNotMatch(fabSource, /getClientRects|getBoundingClientRect|ResizeObserver/);
  assert.doesNotMatch(cssSource, /message-markdown\.is-streaming\s*>\s*:last-child::after/);
  assert.doesNotMatch(cssSource, /steps\(1, end\)/);
  assert.doesNotMatch(cssSource, /portfolio-assistant-message-enter/);
  assert.doesNotMatch(cssSource, /portfolio-assistant-typing-pulse/);
  assert.match(
    cssSource,
    /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.portfolio-assistant-typing-dots i/,
  );
  assert.match(fabSource, /useStreamingMessageSnapshot/);
  assert.match(fabSource, /ASSISTANT_STREAM_COMMIT_DELAY_MS = 48/);
  assert.match(fabSource, /lastCommitAtRef/);
  assert.match(fabSource, /snapshotRef/);
  assert.doesNotMatch(fabSource, /commitFrameRef/);
  assert.doesNotMatch(fabSource, /setSnapshot/);
  assert.doesNotMatch(fabSource, /requestAnimationFrame\(commitOnFrame\)/);
  assert.match(fabSource, /className=\{`portfolio-assistant-message \$\{message\.role\}\$\{/);
  assert.match(fabSource, /isStreamingMessage/);
  assert.match(fabSource, /portfolio-assistant-streaming-status/);
});

test("keeps an unfinished Markdown block out of the streaming parser", () => {
  assert.deepEqual(splitStreamingMarkdown("First paragraph.\n\nSecond paragraph"), {
    stable: "First paragraph.\n\n",
    pending: "Second paragraph",
  });

  const listAndTable = splitStreamingMarkdown(
    "- one\n- two\n\n| Name | Value |\n| --- | --- |\n| A | B |\n\nNext",
  );
  assert.equal(
    listAndTable.stable,
    "- one\n- two\n\n| Name | Value |\n| --- | --- |\n| A | B |\n\n",
  );
  assert.equal(listAndTable.pending, "Next");

  const fenced = splitStreamingMarkdown("```ts\nconst answer = 42;\n```\n\nStill typing");
  assert.equal(fenced.stable, "```ts\nconst answer = 42;\n```\n\n");
  assert.equal(fenced.pending, "Still typing");
});

test("splits pseudo tool markers into presentation-only segments", () => {
  assert.deepEqual(
    splitAssistantToolCalls(
      "I'm checking the portfolio. <tool_call>get_portfolio_certificates</tool_call>",
    ),
    [
      { type: "text", text: "I'm checking the portfolio. " },
      { type: "tool-call", name: "get_portfolio_certificates" },
    ],
  );
  assert.deepEqual(
    splitAssistantToolCalls(
      "<tool_call>search_portfolio</tool_call> then <tool_call>get_project</tool_call>",
    ),
    [
      { type: "tool-call", name: "search_portfolio" },
      { type: "text", text: " then " },
      { type: "tool-call", name: "get_project" },
    ],
  );
  assert.deepEqual(splitAssistantToolCalls("<tool_call>get_project"), [
    { type: "text", text: "<tool_call>get_project" },
  ]);
  assert.deepEqual(splitAssistantToolCalls("<tool_call>get@project</tool_call>"), [
    { type: "text", text: "<tool_call>get@project</tool_call>" },
  ]);
});

test("stabilizes assistant loading geometry and state transitions", async () => {
  const [cssSource, fabSource] = await Promise.all([
    readFile(cssPath, "utf8"),
    readFile(fabPath, "utf8"),
  ]);

  assert.match(
    cssSource,
    /\.portfolio-assistant-panel\[data-chat-state="loading"\][\s\S]*?height:\s*var\(--assistant-panel-block-size\);/,
  );
  assert.match(
    cssSource,
    /\.portfolio-assistant-panel\[data-chat-state="turnstile"\][\s\S]*?height:\s*var\(--assistant-panel-block-size\);/,
  );
  assert.doesNotMatch(cssSource, /:has\(\.portfolio-assistant-chat-fallback\)/);
  assert.doesNotMatch(cssSource, /clip-path:\s*inset\(12% 0 0\)/);
  assert.match(cssSource, /@keyframes portfolio-assistant-state-enter/);
  assert.match(cssSource, /portfolio-assistant-state-enter 220ms var\(--motion-ease\)/);
  assert.match(
    cssSource,
    /\.portfolio-assistant\s*\{[\s\S]*?--assistant-composer-min-block-size:\s*4\.75rem;/,
  );
  assert.match(
    cssSource,
    /\.portfolio-assistant-composer textarea\s*\{[\s\S]*?block-size:\s*auto;[\s\S]*?min-block-size:\s*2\.75rem;[\s\S]*?max-block-size:\s*8rem;/,
  );
  assert.match(fabSource, /resizeComposer\(draft\);[\s\S]*?\}, \[draft, resizeComposer\]\);/);
  assert.match(fabSource, /textarea\.style\.overflowY/);
});

test("keeps reconnecting state calm, centered, and announced", async () => {
  const [cssSource, fabSource] = await Promise.all([
    readFile(cssPath, "utf8"),
    readFile(fabPath, "utf8"),
  ]);

  assert.match(
    fabSource,
    /<output[\s\S]*?aria-busy="true"[\s\S]*?aria-live="polite"[\s\S]*?className="portfolio-assistant-chat-fallback"/,
  );
  assert.match(
    cssSource,
    /\.portfolio-assistant-chat-fallback\s*\{[\s\S]*?flex:\s*0 1 auto;[\s\S]*?width:\s*min\(100%, 28rem\);[\s\S]*?min-height:\s*11rem;[\s\S]*?margin:\s*auto;[\s\S]*?border:\s*1px solid var\(--color-line\);[\s\S]*?background:\s*var\(--color-surface-raised\);[\s\S]*?padding:\s*1\.35rem 1\.4rem;/,
  );
  assert.match(
    cssSource,
    /\.portfolio-assistant-chat-fallback\s*\{[\s\S]*?grid-template-columns:\s*1\.1rem minmax\(0, 1fr\);[\s\S]*?column-gap:\s*0\.7rem;[\s\S]*?row-gap:\s*0\.35rem;/,
  );
  assert.match(
    cssSource,
    /\.portfolio-assistant-chat-fallback\s*>\s*svg\s*\{[\s\S]*?grid-column:\s*1;[\s\S]*?grid-row:\s*1;[\s\S]*?align-self:\s*center;/,
  );
  assert.match(
    cssSource,
    /\.portfolio-assistant-chat-fallback strong\s*\{[\s\S]*?grid-column:\s*2;[\s\S]*?align-self:\s*center;/,
  );
  assert.doesNotMatch(cssSource, /\.portfolio-assistant-chat-fallback\s*\{[^}]*border-block:/);
});

test("reflows assistant controls under text zoom", async () => {
  const cssSource = await readFile(cssPath, "utf8");

  assert.match(
    cssSource,
    /@media \(max-width: 640px\)[\s\S]*?\.portfolio-assistant-toolbar\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-wrap:\s*wrap;/,
  );
  assert.match(
    cssSource,
    /@media \(max-width: 400px\)[\s\S]*?\.portfolio-assistant-thread-select\s*\{[\s\S]*?flex-basis:\s*100%;/,
  );
});

test("keeps narrow panels on the shared transcript scroll surface", async () => {
  const cssSource = await readFile(cssPath, "utf8");

  const narrowMediaStart = cssSource.indexOf("@media (max-width: 400px)");
  const narrowMediaEnd = cssSource.indexOf("@media (max-width: 400px)", narrowMediaStart + 1);
  assert.ok(narrowMediaStart >= 0);
  assert.ok(narrowMediaEnd > narrowMediaStart);
  const narrowMedia = cssSource.slice(narrowMediaStart, narrowMediaEnd);
  assert.match(narrowMedia, /\.portfolio-assistant-panel\s*\{[\s\S]*?max-height:\s*calc\(/);
  assert.doesNotMatch(narrowMedia, /\.portfolio-assistant-panel\s*\{[^}]*overflow-y:\s*auto;/);
  assert.doesNotMatch(narrowMedia, /\.portfolio-assistant-body\s*\{/);
});

test("keeps model reasoning out of the default answer text", () => {
  const message: UIMessage = {
    id: "assistant-message",
    role: "assistant",
    parts: [
      { type: "reasoning", id: "reasoning-1", text: "Internal planning" },
      { type: "text", text: "The grounded portfolio answer." },
    ],
  };

  assert.equal(messageText(message), "The grounded portfolio answer.");
  assert.equal(messageReasoning(message), "Internal planning");
});

test("stabilizes equivalent streaming message snapshots", () => {
  const message = {
    id: "assistant-message",
    role: "assistant" as const,
    parts: [{ type: "text" as const, text: "Grounded answer." }],
  } as unknown as UIMessage;
  const equivalent = {
    ...message,
    parts: [{ type: "text" as const, text: "Grounded answer." }],
  } as unknown as UIMessage;
  const changed = {
    ...message,
    parts: [{ type: "text" as const, text: "Grounded answer changed." }],
  } as unknown as UIMessage;

  assert.equal(messageSnapshotKey([message]), messageSnapshotKey([equivalent]));
  assert.notEqual(messageSnapshotKey([message]), messageSnapshotKey([changed]));
});

test("ignores transient AI SDK fields in streaming message snapshots", () => {
  const streaming = {
    id: "assistant-message",
    role: "assistant" as const,
    parts: [
      {
        type: "text" as const,
        text: "Grounded answer.",
        state: "streaming" as const,
        providerMetadata: { workersAi: { trace: "first" } },
      },
    ],
  } as unknown as UIMessage;
  const settled = {
    ...streaming,
    parts: [
      {
        type: "text" as const,
        text: "Grounded answer.",
        state: "done" as const,
        providerMetadata: { workersAi: { trace: "second" } },
      },
    ],
  } as unknown as UIMessage;
  const changed = {
    ...settled,
    parts: [{ type: "text" as const, text: "Grounded answer changed." }],
  } as unknown as UIMessage;

  assert.equal(messageSnapshotKey([streaming]), messageSnapshotKey([settled]));
  assert.notEqual(messageSnapshotKey([settled]), messageSnapshotKey([changed]));
});

test("hides source-reading activity after a bounded assistant warning", () => {
  const warning = {
    id: "static-warning",
    role: "assistant" as const,
    parts: [{ type: "text" as const, text: "The assistant is temporarily unavailable." }],
  } as UIMessage;
  const userQuestion = {
    id: "new-question",
    role: "user" as const,
    parts: [{ type: "text" as const, text: "Can you continue where we left off?" }],
  } as UIMessage;

  assert.equal(shouldShowAssistantTyping(true, [warning]), false);
  assert.equal(shouldShowAssistantTyping(true, [warning, userQuestion]), true);
  assert.equal(shouldShowAssistantTyping(false, [warning]), false);
});

test("does not label a submitted static response as source activity", async () => {
  const source = await readFile(fabPath, "utf8");
  const messageListSource = source.slice(
    source.indexOf("function AssistantMessageList("),
    source.indexOf("type ThreadHistoryState"),
  );
  const chatSource = source.slice(
    source.indexOf("function AssistantChat("),
    source.indexOf("function AssistantChatBoundary("),
  );

  assert.match(messageListSource, /collapseDuplicateAssistantSourceMessages\(messages\)/);
  assert.match(
    messageListSource,
    /const deduplicatedMessages = collapseDuplicateAssistantSourceMessages\(messages\)/,
  );
  assert.match(messageListSource, /shouldShowAssistantTyping\(isStreaming, deduplicatedMessages\)/);
  assert.doesNotMatch(chatSource, /isStreaming=\{isStreaming \|\| isSubmitting\}/);
  assert.match(chatSource, /isStreaming=\{isStreaming\}/);
  assert.doesNotMatch(chatSource, /isSubmitting \|\| isStreaming\s*\?/);
});

test("uses the signed-in Google display name for user messages with a safe fallback", () => {
  assert.equal(assistantUserLabel("John-Ronan S. Beira"), "John-Ronan S. Beira");
  assert.equal(assistantUserLabel("  John-Ronan S. Beira  "), "John-Ronan S. Beira");
  assert.equal(assistantUserLabel(null), "You");
  assert.equal(assistantUserLabel("   "), "You");
});

test("keeps ID placeholders until completion and disambiguates duplicate titles", async () => {
  assert.deepEqual(
    formatAssistantThreadOptions([
      { id: "abcdef123456", title: "Portfolio overview" },
      { id: "123456abcdef", title: "Portfolio overview" },
      { id: "unique-thread", title: null },
    ]),
    [
      { id: "abcdef123456", label: "Portfolio overview · abcdef" },
      { id: "123456abcdef", label: "Portfolio overview · 123456" },
      { id: "unique-thread", label: "Thread unique" },
    ],
  );

  const [source, apiSource] = await Promise.all([
    readFile(fabPath, "utf8"),
    readFile(apiPath, "utf8"),
  ]);
  assert.match(source, /formatAssistantThreadOptions\(threads\)/);
  assert.doesNotMatch(source, /formatAssistantThreadTitle|titleCandidate|onThreadTitlePreview/);
  assert.match(source, /if \(shouldNameThread\) onThreadTitleSettled\(\)/);
  assert.match(source, /key=\{activeThreadId\}/);
  assert.match(apiSource, /listThreads\(\): Promise[\s\S]*?requestJson[\s\S]*?cache: "no-store"/);
});

test("allows another thread only after the current thread has activity", () => {
  const blankAssistant = {
    id: "blank-assistant",
    role: "assistant" as const,
    parts: [],
  } as unknown as UIMessage;
  const userQuestion = {
    id: "user-question",
    role: "user" as const,
    parts: [{ type: "text" as const, text: "What projects use TypeScript?" }],
  } as unknown as UIMessage;

  assert.equal(hasThreadActivity([]), false);
  assert.equal(hasThreadActivity([blankAssistant]), false);
  assert.equal(hasThreadActivity([userQuestion]), true);
  assert.equal(canStartAnotherThread(null, null), true);
  assert.equal(canStartAnotherThread("thread-1", null), false);
  assert.equal(canStartAnotherThread("thread-1", false), false);
  assert.equal(canStartAnotherThread("thread-1", true), true);
});

test("offers grounded starter prompts in an empty assistant thread", async () => {
  assert.deepEqual(
    [...PORTFOLIO_ASSISTANT_STARTER_PROMPTS],
    [
      "Give me a tour of the portfolio.",
      "What kinds of projects are featured?",
      "Show me certificates.",
      "How can I contact Operator-Syn?",
    ],
  );

  const [source, cssSource] = await Promise.all([
    readFile(fabPath, "utf8"),
    readFile(cssPath, "utf8"),
  ]);
  assert.match(source, /AssistantStarterPrompts/);
  assert.match(source, /onPromptSelect=\{submitQuestion\}/);
  assert.match(source, /const submitQuestion = \(question: string\)/);
  assert.match(cssSource, /\.portfolio-assistant-starter-prompts/);
});

test("uses an automatic thread placeholder when no thread is active", async () => {
  const [source, cssSource] = await Promise.all([
    readFile(fabPath, "utf8"),
    readFile(cssPath, "utf8"),
  ]);

  assert.match(source, /AssistantThreadPlaceholder/);
  assert.match(
    source,
    /A new conversation will appear here automatically when the archive is empty\./,
  );
  assert.doesNotMatch(source, /Start a new thread when you’re ready\./);
  assert.match(cssSource, /\.portfolio-assistant-thread-placeholder/);
  assert.match(cssSource, /@media \(min-width: 401px\)/);
});

test("keeps empty active threads from creating another thread", async () => {
  const source = await readFile(fabPath, "utf8");
  assert.match(source, /activeThreadHasActivity/);
  assert.match(source, /onThreadActivityChange/);
  assert.match(source, /onThreadBusyChange/);
  assert.match(source, /canStartAnotherThread/);
  assert.match(source, /disabled=\{!canCreateNewThread \|\| isCreatingThread\}/);
  assert.match(source, /Ask a question before creating another thread/);
});

test("keeps public reasoning visible as assistant content", () => {
  const reasoningOnly = {
    id: "reasoning-only",
    role: "assistant" as const,
    parts: [{ type: "reasoning" as const, text: "private planning trace" }],
  } as unknown as UIMessage;

  assert.equal(hasVisibleMessageContent(reasoningOnly), true);
  assert.equal(hasThreadActivity([reasoningOnly]), true);
});

test("keeps legacy context markers and hides empty assistant placeholders", () => {
  const messages = [
    {
      id: "old-compaction",
      role: "assistant" as const,
      parts: [{ type: "data-compaction", data: { retainedMessages: 6 } }],
    },
    {
      id: "blank-assistant",
      role: "assistant" as const,
      parts: [],
    },
    {
      id: "latest-compaction",
      role: "assistant" as const,
      parts: [{ type: "data-compaction", data: { retainedMessages: 6 } }],
    },
  ] as unknown as UIMessage[];

  assert.deepEqual(latestCompactionNotice(messages), { retainedMessages: 6 });
  assert.equal(hasVisibleMessageContent(messages[1]), false);
  assert.deepEqual(
    parseCompactionNotice({
      type: "data-compaction",
      transient: true,
      data: { retainedMessages: 6 },
    }),
    { retainedMessages: 6 },
  );
});

test("collapses duplicate source-only assistant snapshots", () => {
  const sources = [
    {
      type: "source-url" as const,
      sourceId: "source-1",
      title: "Portfolio source",
      url: "https://syn-forge.com/projects",
    },
    {
      type: "source-document" as const,
      sourceId: "document-1",
      mediaType: "application/pdf",
      title: "Project brief",
      filename: "project-brief.pdf",
    },
  ];
  const sourceOnly = {
    id: "assistant-sources",
    role: "assistant" as const,
    parts: sources,
  } as unknown as UIMessage;
  const completed = {
    id: "assistant-completed",
    role: "assistant" as const,
    parts: [...sources, { type: "text" as const, text: "Here is the grounded answer." }],
  } as unknown as UIMessage;
  const differentSources = {
    id: "assistant-different",
    role: "assistant" as const,
    parts: [
      {
        type: "source-url" as const,
        sourceId: "source-2",
        title: "Other source",
        url: "https://syn-forge.com/contact",
      },
      { type: "text" as const, text: "A different answer." },
    ],
  } as unknown as UIMessage;

  assert.deepEqual(collapseDuplicateAssistantSourceMessages([sourceOnly, completed]), [completed]);
  const duplicateSourceOnly = { ...sourceOnly, id: "assistant-sources-2" };
  assert.deepEqual(collapseDuplicateAssistantSourceMessages([sourceOnly, duplicateSourceOnly]), [
    duplicateSourceOnly,
  ]);
  assert.deepEqual(collapseDuplicateAssistantSourceMessages([sourceOnly, differentSources]), [
    sourceOnly,
    differentSources,
  ]);
  assert.deepEqual(collapseDuplicateAssistantSourceMessages([sourceOnly]), [sourceOnly]);
});

test("keeps image, attachment, and source parts visible without text", () => {
  const message = {
    id: "parts-only",
    role: "assistant" as const,
    parts: [
      {
        type: "file" as const,
        mediaType: "image/png",
        filename: "archive.png",
        url: "https://cdn.example.test/archive.png",
      },
      {
        type: "source-url" as const,
        sourceId: "source-1",
        title: "Portfolio source",
        url: "https://syn-forge.com/projects",
      },
      {
        type: "source-document" as const,
        sourceId: "document-1",
        mediaType: "application/pdf",
        title: "Project brief",
        filename: "project-brief.pdf",
      },
    ],
  } as unknown as UIMessage;

  assert.equal(hasVisibleMessageContent(message), true);
  assert.equal(messageFileParts(message).length, 1);
  assert.equal(messageSourceUrlParts(message).length, 1);
  assert.equal(messageSourceDocumentParts(message).length, 1);
});

test("loads a recent history window and prepends older pages without moving the reader", async () => {
  const source = await readFile(fabPath, "utf8");
  const cssSource = await readFile(cssPath, "utf8");

  assert.match(
    source,
    /getThreadMessagesPage\(threadId, \{ limit: ASSISTANT_HISTORY_PAGE_SIZE \}\)/,
  );
  assert.match(source, /before: cursor/);
  assert.match(source, /onScroll=\{handleTranscriptScroll\}/);
  assert.match(source, /syncMessagesToServer: false/);
  assert.match(source, /loadedHistoryIdsRef/);
  assert.match(source, /displayedMessages/);
  assert.match(source, /pendingHistoryAnchorRef\.current = \{ previousHeight, previousTop \}/);
  assert.match(
    source,
    /previousTop\s*\+\s*transcript\.scrollHeight\s*-\s*pendingHistoryAnchor\.previousHeight/,
  );
  assert.match(source, /Load earlier assistant messages/);
  assert.match(cssSource, /\.portfolio-assistant-history-pagination/);
  assert.match(cssSource, /\.portfolio-assistant-transcript\s*\{[\s\S]*?scroll-behavior:\s*auto;/);
  assert.match(cssSource, /\.portfolio-assistant-transcript\s*\{[\s\S]*?overflow-anchor:\s*none;/);
  assert.match(
    source,
    /className="portfolio-assistant-transcript-shell">[\s\S]*?className="portfolio-assistant-transcript"[\s\S]*?<\/div>\s*\{isStreaming && !isTranscriptPinnedToBottom/,
  );
  assert.match(
    cssSource,
    /\.portfolio-assistant-jump-latest\s*\{[\s\S]*?inset-inline-end:\s*0\.75rem;/,
  );
  assert.doesNotMatch(cssSource, /\.portfolio-assistant-history-pagination[^}]*overflow-y/);
});
