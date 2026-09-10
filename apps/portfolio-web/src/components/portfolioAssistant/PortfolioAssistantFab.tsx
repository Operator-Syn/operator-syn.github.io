import { useAgentChat } from "@cloudflare/ai-chat/react";
import { useAgent } from "agents/react";
import type { FileUIPart, SourceDocumentUIPart, SourceUrlUIPart, UIMessage } from "ai";
import {
  ArrowUpRight,
  Bot,
  ChevronDown,
  CircleUserRound,
  Download,
  Ellipsis,
  FileText,
  Image as ImageIcon,
  LogIn,
  LogOut,
  Maximize2,
  MessageCircle,
  Minimize2,
  Paperclip,
  Plus,
  RefreshCw,
  Send,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import {
  Component,
  type FormEvent,
  Fragment,
  type ImgHTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
  Suspense,
  type TableHTMLAttributes,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { useFloatingControls } from "../floatingControls/useFloatingControls";
import Modal from "../modal/Modal.tsx";
import {
  type AssistantThread,
  createThread,
  deleteThread,
  exportThread,
  getAssistantQuota,
  getSession,
  getThreadMessagesPage,
  listThreads,
  type PortfolioAssistantQuota,
  PortfolioAssistantRequestError,
  type PublicSession,
  prepareAgentConnection,
  signInUrl,
  signOut,
  verifyTurnstile,
} from "./portfolioAssistantApi.ts";
import { portfolioAssistantAvailability } from "./portfolioAssistantAvailability.ts";
import { portfolioAssistantConfig } from "./portfolioAssistantConfig.ts";
import { describeAssistantError } from "./portfolioAssistantErrors.ts";
import {
  normalizeAssistantMarkdownText,
  transformAssistantMarkdownUrl,
} from "./portfolioAssistantLinkPolicy.ts";
import { AssistantMarkdownLink } from "./portfolioAssistantLinks.tsx";
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
  shouldShowAssistantTyping,
  splitAssistantToolCalls,
  splitStreamingMarkdown,
} from "./portfolioAssistantMessages.ts";

declare global {
  interface Window {
    turnstile?: {
      render: (
        element: HTMLElement,
        options: {
          sitekey: string;
          callback: (token: string) => void;
          "expired-callback": () => void;
          "error-callback": () => void;
          theme: "dark";
          size?: "normal" | "compact" | "flexible";
        },
      ) => string;
      remove?: (widgetId: string) => void;
    };
  }
}

const { publicAuthOrigin, turnstileSiteKey } = portfolioAssistantConfig;
const AGENT_QUERY_CACHE_TTL_MS = 4 * 60 * 1_000;
const ASSISTANT_COMPOSER_MAX_HEIGHT_PX = 128;
const ASSISTANT_HISTORY_PAGE_SIZE = 24;
const ASSISTANT_HISTORY_TOP_THRESHOLD_PX = 96;
const ASSISTANT_SCROLL_BOTTOM_THRESHOLD_PX = 64;
const ASSISTANT_STREAM_COMMIT_DELAY_MS = 48;
const ASSISTANT_RESPONSIVE_DIALOG_QUERY = "(max-width: 640px), (max-height: 560px)";
const ASSISTANT_FOCUSABLE_SELECTOR =
  "a[href], button:not(:disabled), textarea:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex='-1'])";

function useAssistantResponsiveDialog(): boolean {
  const [matches, setMatches] = useState(
    () =>
      typeof window !== "undefined" && window.matchMedia(ASSISTANT_RESPONSIVE_DIALOG_QUERY).matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia(ASSISTANT_RESPONSIVE_DIALOG_QUERY);
    const handleChange = () => setMatches(mediaQuery.matches);
    handleChange();
    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleChange);
      return () => mediaQuery.removeEventListener("change", handleChange);
    }
    mediaQuery.addListener(handleChange);
    return () => mediaQuery.removeListener(handleChange);
  }, []);

  return matches;
}

function safeGoogleProfilePictureUrl(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed.length > 2_048) return null;
  try {
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase();
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.port ||
      (hostname !== "googleusercontent.com" && !hostname.endsWith(".googleusercontent.com"))
    ) {
      return null;
    }
    return parsed.href;
  } catch {
    return null;
  }
}

function handleComposerKeyDown(event: ReactKeyboardEvent<HTMLTextAreaElement>) {
  if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
  event.preventDefault();
  event.currentTarget.form?.requestSubmit();
}

function isImageMediaType(mediaType: string): boolean {
  return /^image\//i.test(mediaType.trim());
}

function isSafeAssistantAssetUrl(value: string, mediaType?: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;

  if (/^data:/i.test(trimmed)) {
    return (
      Boolean(mediaType && isImageMediaType(mediaType)) &&
      /^data:image\/(?:png|jpe?g|gif|webp|avif|bmp)(?:;|,)/i.test(trimmed)
    );
  }

  try {
    const parsed = new URL(trimmed, "https://syn-forge.invalid");
    return (
      parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "blob:"
    );
  } catch {
    return false;
  }
}

type AssistantImagePreviewProps = {
  alt: string;
  label: string;
  src: string;
};

function AssistantImagePreview({ alt, label, src }: AssistantImagePreviewProps) {
  const safe = isSafeAssistantAssetUrl(src, "image/*");
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">(
    safe ? "loading" : "error",
  );

  useEffect(() => {
    setLoadState(isSafeAssistantAssetUrl(src, "image/*") ? "loading" : "error");
  }, [src]);

  const imageLabel = label.trim() || "Assistant image";
  const imageAlt = alt.trim() || imageLabel;
  const state = safe ? loadState : "error";

  return (
    <span className="portfolio-assistant-image-preview" data-image-state={state}>
      <span className="portfolio-assistant-image-stage">
        {state === "error" ? (
          <span
            aria-label={`${imageLabel} preview unavailable`}
            className="portfolio-assistant-image-error"
            role="img"
          >
            <ImageIcon aria-hidden="true" size={20} />
            <span>Preview unavailable</span>
          </span>
        ) : (
          <a aria-label={`Open ${imageLabel}`} href={src} rel="noreferrer" target="_blank">
            <img
              alt={imageAlt}
              decoding="async"
              loading="lazy"
              onError={() => setLoadState("error")}
              onLoad={() => setLoadState("loaded")}
              src={src}
            />
          </a>
        )}
        {state === "loading" ? (
          <span aria-hidden="true" className="portfolio-assistant-image-skeleton" />
        ) : null}
      </span>
    </span>
  );
}

function AssistantMarkdownImage({ alt, src, title }: ImgHTMLAttributes<HTMLImageElement>) {
  const label = title?.trim() || alt?.trim() || "Assistant image";
  return (
    <span className="portfolio-assistant-markdown-image">
      <AssistantImagePreview alt={alt ?? label} label={label} src={src ?? ""} />
      {title || alt ? <span className="portfolio-assistant-image-caption">{label}</span> : null}
    </span>
  );
}

function AssistantMarkdownTable({ children }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <section aria-label="Scrollable assistant table" className="portfolio-assistant-table-scroll">
      <table>{children}</table>
    </section>
  );
}

const assistantMarkdownComponents = {
  a: AssistantMarkdownLink,
  img: AssistantMarkdownImage,
  table: AssistantMarkdownTable,
};

function AssistantFileAttachment({ part }: { part: FileUIPart }) {
  const mediaType = part.mediaType?.trim() || "application/octet-stream";
  const label =
    part.filename?.trim() || (isImageMediaType(mediaType) ? "Attached image" : "Attached file");

  if (isImageMediaType(mediaType)) {
    return (
      <figure className="portfolio-assistant-attachment portfolio-assistant-image-attachment">
        <AssistantImagePreview alt={label} label={label} src={part.url} />
        <figcaption>
          <span>{label}</span>
          <small>{mediaType}</small>
        </figcaption>
      </figure>
    );
  }

  const safe = isSafeAssistantAssetUrl(part.url, mediaType);
  if (!safe) {
    return (
      <div className="portfolio-assistant-attachment portfolio-assistant-file-attachment is-unavailable">
        <Paperclip aria-hidden="true" size={17} />
        <span className="portfolio-assistant-attachment-copy">
          <strong>{label}</strong>
          <small>Attachment unavailable</small>
        </span>
      </div>
    );
  }

  return (
    <a
      aria-label={`Open ${label}`}
      className="portfolio-assistant-attachment portfolio-assistant-file-attachment"
      href={part.url}
      rel="noreferrer"
      target="_blank"
    >
      <FileText aria-hidden="true" size={17} />
      <span className="portfolio-assistant-attachment-copy">
        <strong>{label}</strong>
        <small>{mediaType}</small>
      </span>
      <ArrowUpRight aria-hidden="true" size={16} />
    </a>
  );
}

function AssistantSourceReference({ part }: { part: SourceUrlUIPart }) {
  const label = part.title?.trim() || part.url;
  const safe = isSafeAssistantAssetUrl(part.url);
  if (!safe) {
    return (
      <div className="portfolio-assistant-source-reference is-unavailable">
        <span className="portfolio-assistant-source-copy">
          <strong>{label}</strong>
          <small>Source unavailable</small>
        </span>
      </div>
    );
  }

  return (
    <a
      aria-label={`Open source: ${label}`}
      className="portfolio-assistant-source-reference"
      href={part.url}
      rel="noreferrer"
      target="_blank"
    >
      <span className="portfolio-assistant-source-copy">
        <strong>{label}</strong>
        <small>{part.url}</small>
      </span>
      <ArrowUpRight aria-hidden="true" size={16} />
    </a>
  );
}

function AssistantDocumentReference({ part }: { part: SourceDocumentUIPart }) {
  const label = part.title.trim() || part.filename?.trim() || "Attached document";
  return (
    <div className="portfolio-assistant-source-reference is-document">
      <FileText aria-hidden="true" size={17} />
      <span className="portfolio-assistant-source-copy">
        <strong>{label}</strong>
        <small>{part.filename?.trim() || part.mediaType}</small>
      </span>
    </div>
  );
}

function AssistantMessageAttachments({ message }: { message: UIMessage }) {
  const fileParts = messageFileParts(message);
  const sourceUrlParts = messageSourceUrlParts(message);
  const sourceDocumentParts = messageSourceDocumentParts(message);
  const sourceCount = sourceUrlParts.length + sourceDocumentParts.length;
  if (fileParts.length === 0 && sourceCount === 0) {
    return null;
  }

  return (
    <div className="portfolio-assistant-attachment-list">
      {fileParts.map((part, index) => (
        <AssistantFileAttachment key={`${part.url}-${index}`} part={part} />
      ))}
      {sourceCount > 0 ? (
        <details className="portfolio-assistant-source-disclosure">
          <summary>
            Sources <span aria-hidden="true">·</span> {sourceCount}
          </summary>
          <div className="portfolio-assistant-source-list">
            <p className="eyebrow">Evidence links</p>
            {sourceUrlParts.map((part, index) => (
              <AssistantSourceReference key={`${part.sourceId}-${index}`} part={part} />
            ))}
            {sourceDocumentParts.map((part, index) => (
              <AssistantDocumentReference key={`${part.sourceId}-${index}`} part={part} />
            ))}
          </div>
        </details>
      ) : null}
    </div>
  );
}

type AssistantThreadSelectProps = {
  activeThread: AssistantThread | undefined;
  activeThreadId: string | null;
  disabled?: boolean;
  onChange: (threadId: string) => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  threads: readonly AssistantThread[];
};

function AssistantThreadSelect({
  activeThread,
  activeThreadId,
  disabled = false,
  onChange,
  triggerRef,
  threads,
}: AssistantThreadSelectProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [isOpen, setIsOpen] = useState(false);
  const threadOptions = useMemo(
    () => [
      ...(!activeThread ? [{ id: "", label: "Preparing thread…" }] : []),
      ...formatAssistantThreadOptions(threads),
    ],
    [activeThread, threads],
  );
  const selectedIndex = Math.max(
    0,
    threadOptions.findIndex((option) => option.id === (activeThreadId ?? "")),
  );
  const selectedLabel = threadOptions[selectedIndex]?.label ?? "Preparing thread…";
  const [activeIndex, setActiveIndex] = useState(selectedIndex);

  useEffect(() => {
    if (disabled && isOpen) setIsOpen(false);
  }, [disabled, isOpen]);

  const closeListbox = useCallback(
    (returnFocus = false) => {
      setIsOpen(false);
      if (returnFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
    },
    [triggerRef],
  );

  const openListbox = useCallback(
    (nextIndex = selectedIndex) => {
      setActiveIndex(nextIndex);
      setIsOpen(true);
    },
    [selectedIndex],
  );

  useEffect(() => {
    if (!isOpen) return;
    const option = optionRefs.current[activeIndex];
    window.requestAnimationFrame(() => option?.focus());
  }, [activeIndex, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      closeListbox();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeListbox(true);
      } else if (event.key === "Tab") {
        window.requestAnimationFrame(() => closeListbox());
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [closeListbox, isOpen]);

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape" && isOpen) {
      event.preventDefault();
      event.stopPropagation();
      closeListbox(true);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!isOpen) openListbox(selectedIndex);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!isOpen) openListbox(Math.max(0, selectedIndex - 1));
    }
  };

  const handleOptionKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      const nextIndex = (index + offset + threadOptions.length) % threadOptions.length;
      setActiveIndex(nextIndex);
      return;
    }
    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : threadOptions.length - 1);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const option = threadOptions[index];
      if (!option) return;
      onChange(option.id);
      closeListbox(true);
    }
  };

  const handleOptionSelect = (id: string) => {
    onChange(id);
    closeListbox(true);
  };

  return (
    <div className="portfolio-assistant-thread-select" ref={rootRef}>
      <span className="sr-only" id={`${listboxId}-label`}>
        Assistant thread
      </span>
      <button
        aria-controls={listboxId}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={`Assistant thread: ${selectedLabel}`}
        className="portfolio-assistant-thread-select-trigger"
        disabled={disabled}
        onClick={() => (isOpen ? closeListbox() : openListbox())}
        onKeyDown={handleTriggerKeyDown}
        ref={triggerRef}
        type="button"
      >
        <span>{selectedLabel}</span>
      </button>
      <ChevronDown
        aria-hidden="true"
        className="portfolio-assistant-thread-select-chevron"
        data-state={isOpen ? "open" : "closed"}
        size={16}
      />
      {isOpen ? (
        <div
          aria-labelledby={`${listboxId}-label`}
          className="portfolio-assistant-thread-select-listbox"
          id={listboxId}
          role="listbox"
        >
          {threadOptions.map((option, index) => (
            <button
              aria-selected={option.id === (activeThreadId ?? "")}
              className="portfolio-assistant-thread-select-option"
              key={option.id || "new-thread"}
              onClick={() => handleOptionSelect(option.id)}
              onFocus={() => setActiveIndex(index)}
              onKeyDown={(event) => handleOptionKeyDown(event, index)}
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              role="option"
              tabIndex={index === activeIndex ? 0 : -1}
              type="button"
            >
              <span>{option.label}</span>
              {option.id === (activeThreadId ?? "") ? (
                <span aria-hidden="true">Current</span>
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type AssistantThreadActionsMenuProps = {
  activeThreadId: string | null;
  deleteDisabled?: boolean;
  onDelete: () => void;
  onExport: () => void;
  onLogout: () => void;
};

function AssistantThreadActionsMenu({
  activeThreadId,
  deleteDisabled = false,
  onDelete,
  onExport,
  onLogout,
}: AssistantThreadActionsMenuProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstActionRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const [isOpen, setIsOpen] = useState(false);

  const closeMenu = useCallback((returnFocus = false) => {
    setIsOpen(false);
    if (returnFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const focusFrame = window.requestAnimationFrame(() => firstActionRef.current?.focus());
    const handlePointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      closeMenu(true);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      closeMenu(true);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [closeMenu, isOpen]);

  const runAction = (action: () => void, returnFocus = true) => {
    setIsOpen(false);
    action();
    if (returnFocus) window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  return (
    <div className="portfolio-assistant-actions-menu" ref={rootRef}>
      <button
        aria-controls={menuId}
        aria-expanded={isOpen}
        aria-label="Assistant thread actions"
        className="portfolio-assistant-icon portfolio-assistant-actions-trigger"
        onClick={() => setIsOpen((current) => !current)}
        ref={triggerRef}
        title="Assistant thread actions"
        type="button"
      >
        <Ellipsis aria-hidden="true" size={16} />
      </button>
      {isOpen ? (
        <div className="portfolio-assistant-actions-popover" id={menuId}>
          <button
            aria-label="Export assistant thread"
            className="portfolio-assistant-actions-item"
            disabled={!activeThreadId}
            onClick={() => runAction(onExport)}
            ref={firstActionRef}
            type="button"
          >
            <Download aria-hidden="true" size={15} /> Export thread
          </button>
          <button
            aria-label="Delete assistant thread"
            className="portfolio-assistant-actions-item"
            disabled={!activeThreadId || deleteDisabled}
            onClick={() => runAction(onDelete, false)}
            type="button"
          >
            <Trash2 aria-hidden="true" size={15} /> Delete thread
          </button>
          <button
            aria-label="Sign out of portfolio assistant"
            className="portfolio-assistant-actions-item"
            onClick={() => runAction(onLogout)}
            type="button"
          >
            <LogOut aria-hidden="true" size={15} /> Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}

function TurnstileGate({ onVerified }: { onVerified: () => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!turnstileSiteKey) {
      setError("Turnstile is not configured for this build yet.");
      return;
    }
    const scriptId = "portfolio-turnstile-script";
    const existing = document.getElementById(scriptId);
    const script =
      existing instanceof HTMLScriptElement ? existing : document.createElement("script");
    if (!existing) {
      script.id = scriptId;
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    const handleLoad = () => setReady(true);
    script.addEventListener("load", handleLoad);
    if (window.turnstile) setReady(true);
    return () => script.removeEventListener("load", handleLoad);
  }, []);

  useEffect(() => {
    if (!ready || !containerRef.current || !turnstileSiteKey || !window.turnstile) return;
    const widgetId = window.turnstile.render(containerRef.current, {
      sitekey: turnstileSiteKey,
      theme: "dark",
      size:
        typeof window !== "undefined" && window.matchMedia("(max-width: 400px)").matches
          ? "compact"
          : "normal",
      callback: (token) => {
        void verifyTurnstile(token)
          .then(onVerified)
          .catch((verificationError: unknown) => {
            setError(
              verificationError instanceof Error
                ? verificationError.message
                : "Bot verification failed.",
            );
          });
      },
      "expired-callback": () => setError("The bot check expired. Please try again."),
      "error-callback": () => setError("The bot check could not load. Please try again."),
    });
    return () => {
      if (widgetId && window.turnstile?.remove) window.turnstile.remove(widgetId);
    };
  }, [onVerified, ready]);

  return (
    <div className="portfolio-assistant-turnstile">
      <p className="eyebrow">One-time access check</p>
      <p className="portfolio-assistant-muted">
        Complete the Cloudflare check once per session before opening the assistant.
      </p>
      {turnstileSiteKey ? (
        <div className="portfolio-assistant-turnstile-widget" ref={containerRef} />
      ) : null}
      {error ? <p className="portfolio-assistant-error">{error}</p> : null}
    </div>
  );
}

function AssistantComingSoon() {
  return (
    <div className="portfolio-assistant-coming-soon">
      <MessageCircle aria-hidden="true" size={28} />
      <p className="eyebrow">In development</p>
      <h3>Portfolio assistant coming soon.</h3>
      <p>
        We’re tuning a source-grounded guide to the work in this portfolio. It will answer with
        evidence from the archive and decline unrelated requests.
      </p>
      <p className="portfolio-assistant-muted">
        The assistant is being tested privately before it becomes part of the public release.
      </p>
    </div>
  );
}

function AssistantSessionLoadingState() {
  return (
    <div aria-busy="true" className="portfolio-assistant-session-loading">
      <span aria-hidden="true" className="portfolio-assistant-loading-mark">
        <i />
        <i />
        <i />
      </span>
      <div>
        <p className="eyebrow">Session handshake / 00</p>
        <h3>Opening a private channel.</h3>
        <p>Checking your session before the archive is opened.</p>
      </div>
      <div aria-hidden="true" className="portfolio-assistant-loading-skeleton">
        <span className="portfolio-assistant-skeleton-line is-short" />
        <span className="portfolio-assistant-skeleton-line is-medium" />
      </div>
    </div>
  );
}

function AssistantThreadPlaceholder({
  error,
  isRetrying,
  onRetry,
}: {
  error: string | null;
  isRetrying: boolean;
  onRetry: () => void;
}) {
  const failed = Boolean(error);
  return (
    <div
      aria-busy={!failed}
      aria-live="polite"
      className="portfolio-assistant-empty-state portfolio-assistant-thread-placeholder"
      data-state={failed ? "error" : "loading"}
    >
      <span aria-hidden="true" className="portfolio-assistant-loading-mark">
        <i />
        <i />
        <i />
      </span>
      <div className="portfolio-assistant-thread-placeholder-copy">
        <p className="eyebrow">{failed ? "Thread setup / error" : "Thread staging / 00"}</p>
        <h3>{failed ? "The thread is not ready yet." : "Preparing a fresh thread."}</h3>
        <p>
          {failed
            ? "The assistant could not prepare a conversation. Try again to continue."
            : "A new conversation will appear here automatically when the archive is empty."}
        </p>
      </div>
      {!failed ? (
        <div aria-hidden="true" className="portfolio-assistant-loading-skeleton">
          <span className="portfolio-assistant-skeleton-line is-short" />
          <span className="portfolio-assistant-skeleton-line is-medium" />
          <span className="portfolio-assistant-skeleton-line is-long" />
        </div>
      ) : null}
      {failed ? (
        <button className="action-quiet" disabled={isRetrying} onClick={onRetry} type="button">
          {isRetrying ? "Retrying…" : "Retry thread setup"}
        </button>
      ) : null}
    </div>
  );
}

type AssistantChatErrorBoundaryProps = {
  children: ReactNode;
};

type AssistantChatErrorBoundaryState = {
  hasError: boolean;
};

class AssistantChatErrorBoundary extends Component<
  AssistantChatErrorBoundaryProps,
  AssistantChatErrorBoundaryState
> {
  state: AssistantChatErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): AssistantChatErrorBoundaryState {
    return { hasError: true };
  }

  reset = () => this.setState({ hasError: false });

  render() {
    if (this.state.hasError) {
      return (
        <div className="portfolio-assistant-empty-state">
          <p className="portfolio-assistant-error">
            The assistant connection could not be opened. Please try again.
          </p>
          <button className="action-quiet" onClick={this.reset} type="button">
            Retry connection
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

type AssistantAccessErrorDetails = {
  title: string;
  message: string;
  actionLabel: string;
};

function describeAssistantAccessError(error: unknown): AssistantAccessErrorDetails {
  const requestError = error instanceof PortfolioAssistantRequestError ? error : null;

  if (requestError?.status === 429) {
    return {
      title: "Rolling budget reached",
      message:
        "The rolling 1-hour assistant budget is full. You can keep reading this thread; try again as earlier usage rolls off.",
      actionLabel: "Check again",
    };
  }

  if (requestError?.code === "TURNSTILE_REQUIRED") {
    return {
      title: "Verification needed",
      message: "Complete the bot verification before opening this assistant thread.",
      actionLabel: "Try again",
    };
  }

  if (requestError?.code === "AGENT_PAUSED") {
    return {
      title: "Shared capacity paused",
      message:
        requestError.message ||
        "The shared Workers AI capacity is paused. This is separate from your rolling 1-hour user budget.",
      actionLabel: "Check again",
    };
  }

  if (requestError?.status === 401) {
    return {
      title: "Assistant session expired",
      message: "Sign in again to continue this assistant thread.",
      actionLabel: "Try again",
    };
  }

  return {
    title: "Assistant unavailable",
    message:
      error instanceof Error
        ? error.message
        : "The assistant could not prepare this thread. Please try again.",
    actionLabel: "Try again",
  };
}

function AssistantAccessError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const details = describeAssistantAccessError(error);

  return (
    <div className="portfolio-assistant-access-error" role="alert">
      <div>
        <strong>{details.title}</strong>
        <p>{details.message}</p>
      </div>
      <button className="action-quiet" onClick={onRetry} type="button">
        {details.actionLabel}
      </button>
    </div>
  );
}

function useAssistantConnectionGate(threadId: string) {
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<unknown>(null);
  const attemptIdRef = useRef<string | null>(null);
  const requestRef = useRef<Promise<string> | null>(null);
  const terminalErrorRef = useRef<unknown>(null);

  const ensureAttemptId = useCallback(async () => {
    if (terminalErrorRef.current) throw terminalErrorRef.current;
    if (attemptIdRef.current) return attemptIdRef.current;

    if (!requestRef.current) {
      requestRef.current = prepareAgentConnection(threadId)
        .then((result) => {
          attemptIdRef.current = result.attemptId;
          return result.attemptId;
        })
        .catch((preparationError: unknown) => {
          terminalErrorRef.current = preparationError;
          setError(preparationError);
          setStatus("error");
          throw preparationError;
        })
        .finally(() => {
          requestRef.current = null;
        });
    }

    return requestRef.current;
  }, [threadId]);

  const takeAttemptId = useCallback(async () => {
    const attemptId = await ensureAttemptId();
    if (attemptIdRef.current === attemptId) attemptIdRef.current = null;
    return attemptId;
  }, [ensureAttemptId]);

  useEffect(() => {
    let mounted = true;
    void ensureAttemptId()
      .then(() => {
        if (mounted) setStatus("ready");
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, [ensureAttemptId]);

  const retry = useCallback(() => {
    terminalErrorRef.current = null;
    attemptIdRef.current = null;
    setError(null);
    setStatus("loading");
    void ensureAttemptId()
      .then(() => setStatus("ready"))
      .catch(() => undefined);
  }, [ensureAttemptId]);

  return { error, retry, status, takeAttemptId };
}

function AssistantUserAvatar({ pictureUrl }: { pictureUrl: string | null }) {
  const safeUrl = safeGoogleProfilePictureUrl(pictureUrl);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (!safeUrl || failedUrl === safeUrl) {
    return (
      <CircleUserRound
        aria-hidden="true"
        className="portfolio-assistant-message-avatar"
        size={15}
      />
    );
  }

  return (
    <img
      alt=""
      aria-hidden="true"
      className="portfolio-assistant-message-avatar portfolio-assistant-message-avatar-image"
      decoding="async"
      height={20}
      loading="lazy"
      onError={() => setFailedUrl(safeUrl)}
      referrerPolicy="no-referrer"
      src={safeUrl}
      width={20}
    />
  );
}

function useStreamingMessageSnapshot(
  messages: readonly UIMessage[],
  isStreaming: boolean,
): readonly UIMessage[] {
  const snapshotRef = useRef<readonly UIMessage[]>(messages);
  const lastCommitAtRef = useRef(0);
  const committedMessageKeyRef = useRef(messageSnapshotKey(messages));
  const latestMessage = messages.at(-1);
  const shouldThrottle =
    isStreaming && latestMessage?.role === "assistant" && hasVisibleMessageContent(latestMessage);
  const now = Date.now();
  const elapsed = now - lastCommitAtRef.current;
  const nextMessageKey = messageSnapshotKey(messages);

  // The AI SDK already publishes throttled snapshots. Keep this additional
  // reader snapshot synchronous and ref-backed so a stream update never
  // schedules a second React state update from an animation-frame callback.
  if (
    (!shouldThrottle || elapsed >= ASSISTANT_STREAM_COMMIT_DELAY_MS) &&
    committedMessageKeyRef.current !== nextMessageKey
  ) {
    committedMessageKeyRef.current = nextMessageKey;
    snapshotRef.current = messages;
    lastCommitAtRef.current = now;
  }

  return snapshotRef.current;
}

type StreamingAssistantMarkdownProps = {
  isStreaming: boolean;
  text: string;
};

function StreamingAssistantMarkdown({ isStreaming, text }: StreamingAssistantMarkdownProps) {
  const normalizedText = normalizeAssistantMarkdownText(text);
  const streamingParts = useMemo(() => splitStreamingMarkdown(normalizedText), [normalizedText]);
  const toolCallSegments = useMemo(() => splitAssistantToolCalls(normalizedText), [normalizedText]);
  const hasToolCalls = toolCallSegments.some((segment) => segment.type === "tool-call");
  const segmentedStreamingParts = useMemo(
    () =>
      hasToolCalls
        ? toolCallSegments.map((segment) =>
            segment.type === "text" ? splitStreamingMarkdown(segment.text) : null,
          )
        : [],
    [hasToolCalls, toolCallSegments],
  );
  const lastTextSegmentIndex = useMemo(() => {
    for (let index = toolCallSegments.length - 1; index >= 0; index -= 1) {
      if (toolCallSegments[index]?.type === "text") return index;
    }
    return -1;
  }, [toolCallSegments]);
  const hasStreamingTail = hasToolCalls
    ? segmentedStreamingParts.some((parts) => parts?.pending.length)
    : streamingParts.pending.length > 0;
  const [caretVisible, setCaretVisible] = useState(false);

  useEffect(() => {
    if (isStreaming) {
      if (hasStreamingTail) setCaretVisible(true);
      return;
    }
    if (!caretVisible) return;

    const timeout = window.setTimeout(() => setCaretVisible(false), 180);
    return () => window.clearTimeout(timeout);
  }, [caretVisible, hasStreamingTail, isStreaming]);

  const showStreamingLayout = isStreaming || caretVisible;
  const showStreamingCaret = caretVisible && hasStreamingTail;
  const segmentKeyCounts = new Map<string, number>();

  return (
    <div
      className={`portfolio-assistant-message-markdown${showStreamingLayout ? " is-streaming" : ""}`}
      data-streaming-caret={showStreamingCaret ? (isStreaming ? "active" : "settling") : "idle"}
    >
      {!hasToolCalls && showStreamingLayout ? (
        <>
          {streamingParts.stable ? (
            <ReactMarkdown
              components={assistantMarkdownComponents}
              remarkPlugins={[remarkGfm]}
              urlTransform={transformAssistantMarkdownUrl}
            >
              {streamingParts.stable}
            </ReactMarkdown>
          ) : null}
          {streamingParts.pending ? (
            <span
              className={`portfolio-assistant-streaming-tail${streamingParts.stable ? " has-stable-prefix" : ""}`}
            >
              {streamingParts.pending}
              {showStreamingCaret ? (
                <span
                  aria-hidden="true"
                  className={`portfolio-assistant-stream-caret${isStreaming ? "" : " is-settling"}`}
                />
              ) : null}
            </span>
          ) : null}
        </>
      ) : !hasToolCalls ? (
        <ReactMarkdown
          components={assistantMarkdownComponents}
          remarkPlugins={[remarkGfm]}
          urlTransform={transformAssistantMarkdownUrl}
        >
          {normalizedText}
        </ReactMarkdown>
      ) : (
        toolCallSegments.map((segment, index) => {
          const segmentKeyPrefix =
            segment.type === "tool-call" ? `tool-call-${segment.name}` : "tool-call-text";
          const segmentKeyOccurrence = segmentKeyCounts.get(segmentKeyPrefix) ?? 0;
          segmentKeyCounts.set(segmentKeyPrefix, segmentKeyOccurrence + 1);
          const segmentKey = `${segmentKeyPrefix}-${segmentKeyOccurrence}`;

          if (segment.type === "tool-call") {
            return (
              <AssistantToolCall isWorking={isStreaming} key={segmentKey} name={segment.name} />
            );
          }

          const segmentParts = segmentedStreamingParts[index] ?? {
            stable: "",
            pending: segment.text,
          };
          const segmentShowCaret =
            showStreamingCaret && index === lastTextSegmentIndex && segmentParts.pending.length > 0;

          return showStreamingLayout ? (
            <Fragment key={segmentKey}>
              {segmentParts.stable ? (
                <ReactMarkdown
                  components={assistantMarkdownComponents}
                  remarkPlugins={[remarkGfm]}
                  urlTransform={transformAssistantMarkdownUrl}
                >
                  {segmentParts.stable}
                </ReactMarkdown>
              ) : null}
              {segmentParts.pending ? (
                <span
                  className={`portfolio-assistant-streaming-tail${segmentParts.stable ? " has-stable-prefix" : ""}`}
                >
                  {segmentParts.pending}
                  {segmentShowCaret ? (
                    <span
                      aria-hidden="true"
                      className={`portfolio-assistant-stream-caret${isStreaming ? "" : " is-settling"}`}
                    />
                  ) : null}
                </span>
              ) : null}
            </Fragment>
          ) : (
            <ReactMarkdown
              components={assistantMarkdownComponents}
              key={segmentKey}
              remarkPlugins={[remarkGfm]}
              urlTransform={transformAssistantMarkdownUrl}
            >
              {segment.text}
            </ReactMarkdown>
          );
        })
      )}
    </div>
  );
}

function AssistantToolCall({ isWorking, name }: { isWorking: boolean; name: string }) {
  return (
    <output
      aria-busy={isWorking}
      aria-live="polite"
      aria-label={`${isWorking ? "Working on" : "Recorded"} tool call: ${name}`}
      className={`portfolio-assistant-tool-call${isWorking ? " is-working" : ""}`}
      data-tool-call-state={isWorking ? "working" : "recorded"}
    >
      <Wrench aria-hidden="true" size={14} />
      <span className="portfolio-assistant-tool-call-label">Tool call</span>
      <code>{name}</code>
      <span className={`portfolio-assistant-tool-call-state${isWorking ? " is-working" : ""}`}>
        {isWorking ? (
          <RefreshCw aria-hidden="true" className="portfolio-assistant-spin" size={13} />
        ) : null}
        {isWorking ? "Working…" : "Recorded"}
      </span>
    </output>
  );
}

function AssistantStarterPrompts({ onSelect }: { onSelect: (prompt: string) => void }) {
  return (
    <div className="portfolio-assistant-starter-prompts">
      <p className="portfolio-assistant-starter-label">Suggested questions</p>
      <div className="portfolio-assistant-starter-list">
        {PORTFOLIO_ASSISTANT_STARTER_PROMPTS.map((prompt) => (
          <button
            className="portfolio-assistant-starter-prompt"
            key={prompt}
            onClick={() => onSelect(prompt)}
            type="button"
          >
            {prompt}
          </button>
        ))}
      </div>
    </div>
  );
}

function AssistantMessageList({
  hasOlderMessages = false,
  isLoadingOlder = false,
  isStreaming = false,
  messageListRef,
  messages,
  olderError = null,
  onLoadOlder,
  onPromptSelect,
  userDisplayName,
  userPictureUrl,
}: {
  hasOlderMessages?: boolean;
  isLoadingOlder?: boolean;
  isStreaming?: boolean;
  messageListRef?: React.RefObject<HTMLDivElement | null>;
  messages: readonly UIMessage[];
  olderError?: string | null;
  onLoadOlder?: () => void | Promise<void>;
  onPromptSelect?: (prompt: string) => void;
  userDisplayName: string;
  userPictureUrl: string | null;
}) {
  const deduplicatedMessages = collapseDuplicateAssistantSourceMessages(messages);
  const latestMessageId = deduplicatedMessages.at(-1)?.id;
  const visibleMessages = deduplicatedMessages.filter(
    (message) =>
      message.role === "user" ||
      hasVisibleMessageContent(message) ||
      (isStreaming && message.role === "assistant" && message.id === latestMessageId),
  );
  const shouldShowTyping = shouldShowAssistantTyping(isStreaming, deduplicatedMessages);

  return (
    <div className="portfolio-assistant-message-list" aria-live="polite" ref={messageListRef}>
      {onLoadOlder && (hasOlderMessages || isLoadingOlder || olderError) ? (
        <div className="portfolio-assistant-history-pagination" aria-live="polite">
          {isLoadingOlder ? (
            <output aria-busy="true">Loading earlier messages…</output>
          ) : olderError ? (
            <>
              <span role="alert">{olderError}</span>
              <button onClick={() => void onLoadOlder()} type="button">
                Try again
              </button>
            </>
          ) : (
            <button
              aria-label="Load earlier assistant messages"
              onClick={() => void onLoadOlder()}
              type="button"
            >
              Load earlier messages
            </button>
          )}
        </div>
      ) : null}
      {visibleMessages.length === 0 ? (
        <div className="portfolio-assistant-empty-state">
          <p className="eyebrow">Archive ready / 01</p>
          <h3>Start with a focused question.</h3>
          <p>Ask about the work, projects, certificates, snippets, or a linked repository.</p>
          <span className="portfolio-assistant-empty-hint">Answers return linked evidence.</span>
          {onPromptSelect ? <AssistantStarterPrompts onSelect={onPromptSelect} /> : null}
        </div>
      ) : (
        visibleMessages.map((message) => {
          const text = messageText(message);
          const reasoning = messageReasoning(message);
          const AuthorIcon = message.role === "user" ? CircleUserRound : Bot;
          const isStreamingMessage =
            isStreaming &&
            message.role === "assistant" &&
            message.id === deduplicatedMessages.at(-1)?.id;
          return (
            <article
              className={`portfolio-assistant-message ${message.role}${isStreamingMessage ? " is-streaming" : ""}`}
              key={message.id}
            >
              <p className="eyebrow">
                {message.role === "user" ? (
                  <AssistantUserAvatar pictureUrl={userPictureUrl} />
                ) : (
                  <AuthorIcon
                    aria-hidden="true"
                    className="portfolio-assistant-message-avatar"
                    size={15}
                  />
                )}
                <span>{message.role === "user" ? userDisplayName : "Assistant"}</span>
                {isStreamingMessage && !text ? (
                  <span aria-hidden="true" className="portfolio-assistant-streaming-mark" />
                ) : null}
              </p>
              {text ? (
                message.role === "assistant" ? (
                  <StreamingAssistantMarkdown isStreaming={isStreamingMessage} text={text} />
                ) : (
                  <p>{text}</p>
                )
              ) : null}
              {message.role === "assistant" && reasoning ? (
                <details className="portfolio-assistant-reasoning">
                  <summary>Show model reasoning</summary>
                  <div className="portfolio-assistant-reasoning-content">
                    <ReactMarkdown
                      components={assistantMarkdownComponents}
                      remarkPlugins={[remarkGfm]}
                      urlTransform={transformAssistantMarkdownUrl}
                    >
                      {normalizeAssistantMarkdownText(reasoning)}
                    </ReactMarkdown>
                  </div>
                </details>
              ) : null}
              {shouldShowTyping && isStreamingMessage ? (
                <output
                  aria-label="Assistant is reading portfolio sources"
                  className="portfolio-assistant-typing portfolio-assistant-streaming-status"
                >
                  <span aria-hidden="true" className="portfolio-assistant-typing-dots">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span>Reading portfolio sources…</span>
                </output>
              ) : null}
              <AssistantMessageAttachments message={message} />
            </article>
          );
        })
      )}
    </div>
  );
}

type ThreadHistorySnapshot = {
  messages: UIMessage[];
  status: "loading" | "ready" | "error";
  error: unknown;
  hasMore: boolean;
  nextCursor: string | null;
  isLoadingOlder: boolean;
  olderError: string | null;
};

type ThreadHistoryState = ThreadHistorySnapshot & {
  loadOlder: () => Promise<UIMessage[] | null>;
};

function useThreadHistory(threadId: string): ThreadHistoryState {
  const [state, setState] = useState<ThreadHistorySnapshot>({
    messages: [],
    status: "loading",
    error: null,
    hasMore: false,
    nextCursor: null,
    isLoadingOlder: false,
    olderError: null,
  });
  const pagingRef = useRef(false);
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    let mounted = true;
    pagingRef.current = false;
    setState({
      messages: [],
      status: "loading",
      error: null,
      hasMore: false,
      nextCursor: null,
      isLoadingOlder: false,
      olderError: null,
    });
    void getThreadMessagesPage(threadId, { limit: ASSISTANT_HISTORY_PAGE_SIZE }).then(
      (page) => {
        if (!mounted || generationRef.current !== generation) return;
        setState({
          messages: page.messages,
          status: "ready",
          error: null,
          hasMore: page.hasMore,
          nextCursor: page.nextCursor,
          isLoadingOlder: false,
          olderError: null,
        });
      },
      (error: unknown) => {
        if (!mounted || generationRef.current !== generation) return;
        setState({
          messages: [],
          status: "error",
          error,
          hasMore: false,
          nextCursor: null,
          isLoadingOlder: false,
          olderError: null,
        });
      },
    );
    return () => {
      mounted = false;
    };
  }, [threadId]);

  const loadOlder = useCallback(async (): Promise<UIMessage[] | null> => {
    if (pagingRef.current || state.status !== "ready" || !state.hasMore || !state.nextCursor) {
      return null;
    }
    const generation = generationRef.current;
    const cursor = state.nextCursor;
    pagingRef.current = true;
    setState((current) => ({ ...current, isLoadingOlder: true, olderError: null }));
    try {
      const page = await getThreadMessagesPage(threadId, {
        before: cursor,
        limit: ASSISTANT_HISTORY_PAGE_SIZE,
      });
      if (generationRef.current !== generation) return null;
      setState((current) => ({
        ...current,
        hasMore: page.hasMore,
        nextCursor: page.nextCursor,
        isLoadingOlder: false,
        olderError: null,
      }));
      return page.messages;
    } catch (error: unknown) {
      if (generationRef.current === generation) {
        setState((current) => ({
          ...current,
          isLoadingOlder: false,
          olderError:
            error instanceof Error ? error.message : "Earlier messages could not be loaded.",
        }));
      }
      return null;
    } finally {
      pagingRef.current = false;
    }
  }, [state.hasMore, state.nextCursor, state.status, threadId]);

  return { ...state, loadOlder };
}

function AssistantHistoryState({
  error,
  messages,
  userDisplayName,
  userPictureUrl,
}: {
  error: unknown;
  messages: readonly UIMessage[];
  userDisplayName: string;
  userPictureUrl: string | null;
}) {
  const compactionNotice = useMemo(() => latestCompactionNotice(messages), [messages]);
  return (
    <div className="portfolio-assistant-history-state">
      <div className="portfolio-assistant-transcript">
        <AssistantMessageList
          messages={messages}
          userDisplayName={userDisplayName}
          userPictureUrl={userPictureUrl}
        />
        {compactionNotice ? (
          <aside aria-live="polite" className="portfolio-assistant-compaction">
            <strong>Legacy context summary</strong>
            <p>
              This older thread contains a preserved context summary. New questions use the full
              thread.
            </p>
          </aside>
        ) : null}
      </div>
      {error ? (
        <p className="portfolio-assistant-error" role="alert">
          The saved conversation could not be loaded. Please try again.
        </p>
      ) : null}
    </div>
  );
}

function AssistantChatLoadingState({
  detail,
  label,
  messages,
  userDisplayName,
  userPictureUrl,
}: {
  detail: string;
  label: string;
  messages: readonly UIMessage[];
  userDisplayName: string;
  userPictureUrl: string | null;
}) {
  return (
    <div
      aria-busy="true"
      className="portfolio-assistant-history-state portfolio-assistant-loading-state"
    >
      <div className="portfolio-assistant-transcript">
        {messages.length > 0 ? (
          <AssistantMessageList
            messages={messages}
            userDisplayName={userDisplayName}
            userPictureUrl={userPictureUrl}
          />
        ) : (
          <div className="portfolio-assistant-loading-skeleton" aria-hidden="true">
            <span className="portfolio-assistant-skeleton-line is-short" />
            <span className="portfolio-assistant-skeleton-line is-medium" />
            <span className="portfolio-assistant-skeleton-line is-long" />
            <span className="portfolio-assistant-skeleton-line is-short" />
          </div>
        )}
      </div>
      <output className="portfolio-assistant-loading-banner" aria-live="polite">
        <span aria-hidden="true" className="portfolio-assistant-loading-mark">
          <i />
          <i />
          <i />
        </span>
        <span>
          <strong>{label}</strong>
          <small>{detail}</small>
        </span>
      </output>
    </div>
  );
}

function formatAssistantTokenCount(value: number): string {
  const tokens = Math.max(0, Math.round(value));
  if (tokens >= 1_000_000) {
    const millions = tokens / 1_000_000;
    return `${millions.toFixed(millions >= 10 || Number.isInteger(millions) ? 0 : 1)}M`;
  }
  if (tokens >= 1_000) {
    const thousands = tokens / 1_000;
    return `${thousands.toFixed(thousands >= 10 || Number.isInteger(thousands) ? 0 : 1)}k`;
  }
  return tokens.toLocaleString();
}

function formatAssistantRefresh(value: number): string {
  if (value <= 0) return "Refresh available now";
  const minutes = Math.ceil(value / 60_000);
  if (minutes < 60) return `Next refresh in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes > 0
    ? `Next refresh in ${hours}h ${remainingMinutes}m`
    : `Next refresh in ${hours}h`;
}

function formatAssistantResetTime(value: number): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "refresh time unavailable";
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function AssistantQuotaStatus({
  error,
  isLoading,
  onRefresh,
  quota,
}: {
  error: string | null;
  isLoading: boolean;
  onRefresh: () => void;
  quota: PortfolioAssistantQuota | null;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!quota?.resetAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    const refreshTimer = window.setTimeout(
      () => {
        setNow(Date.now());
        onRefresh();
      },
      Math.max(250, quota.resetAt - Date.now() + 250),
    );
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(refreshTimer);
    };
  }, [onRefresh, quota?.resetAt]);

  const refresh = () => {
    setNow(Date.now());
    onRefresh();
  };

  if (!quota) {
    return (
      <div
        aria-busy={isLoading}
        aria-live="polite"
        className="portfolio-assistant-quota"
        data-quota-state={isLoading ? "loading" : "error"}
      >
        <div className="portfolio-assistant-quota-heading">
          <span className="eyebrow">Rolling budget</span>
          <span className="portfolio-assistant-quota-message">
            {isLoading ? "Checking quota usage…" : error || "Budget unavailable."}
          </span>
        </div>
        {isLoading ? (
          <div aria-hidden="true" className="portfolio-assistant-quota-skeleton">
            <span />
          </div>
        ) : null}
        <div className="portfolio-assistant-quota-footer">
          <span className="portfolio-assistant-quota-message">
            {isLoading ? "Usage will appear when the session is ready." : "Refresh to try again."}
          </span>
          <button
            aria-label="Refresh rolling budget"
            className="portfolio-assistant-quota-refresh"
            disabled={isLoading}
            onClick={refresh}
            type="button"
          >
            <RefreshCw
              aria-hidden="true"
              className={isLoading ? "portfolio-assistant-spin" : undefined}
              size={14}
            />
          </button>
        </div>
      </div>
    );
  }

  const usedQuotaUnits = Math.max(0, quota.usedTokens);
  const settledQuotaUnits = Math.max(0, quota.settledTokens);
  const provisionalQuotaUnits = Math.max(0, quota.provisionalTokens);
  const budgetQuotaUnits = Math.max(1, quota.budgetTokens);
  const remainingQuotaUnits = Math.max(0, Math.min(budgetQuotaUnits, quota.remainingTokens));
  const usagePercent = Math.min(100, Math.max(0, (usedQuotaUnits / budgetQuotaUnits) * 100));
  const resetCopy = quota.resetAt
    ? `${formatAssistantRefresh(quota.resetAt - now)} · ${formatAssistantResetTime(quota.resetAt)}`
    : "No active usage to roll off";
  const usageLabel = `${usedQuotaUnits.toLocaleString()} of ${budgetQuotaUnits.toLocaleString()} quota units used`;

  return (
    <details
      aria-busy={isLoading}
      aria-live="polite"
      className="portfolio-assistant-quota"
      data-quota-state={isLoading ? "refreshing" : "ready"}
    >
      <summary className="portfolio-assistant-quota-summary">
        <span className="portfolio-assistant-quota-heading">
          <span className="eyebrow">Rolling budget</span>
          <strong>
            {formatAssistantTokenCount(usedQuotaUnits)} used <span aria-hidden="true">/</span>{" "}
            {formatAssistantTokenCount(budgetQuotaUnits)} total
          </strong>
        </span>
        <span
          aria-label={usageLabel}
          aria-valuemax={budgetQuotaUnits}
          aria-valuemin={0}
          aria-valuenow={Math.min(budgetQuotaUnits, usedQuotaUnits)}
          className="portfolio-assistant-quota-meter portfolio-assistant-quota-summary-meter"
          role="progressbar"
        >
          <span style={{ width: `${usagePercent}%` }} />
        </span>
      </summary>
      <div className="portfolio-assistant-quota-details">
        <div className="portfolio-assistant-quota-footer">
          <span>
            {formatAssistantTokenCount(remainingQuotaUnits)} quota units remaining{" "}
            <span aria-hidden="true">·</span> {resetCopy}
          </span>
          <button
            aria-label="Refresh rolling budget"
            className="portfolio-assistant-quota-refresh"
            disabled={isLoading}
            onClick={refresh}
            type="button"
          >
            <RefreshCw
              aria-hidden="true"
              className={isLoading ? "portfolio-assistant-spin" : undefined}
              size={14}
            />
          </button>
        </div>
        <small>{formatAssistantTokenCount(settledQuotaUnits)} settled quota units recorded.</small>
        {provisionalQuotaUnits > 0 ? (
          <small className="portfolio-assistant-quota-error">
            {formatAssistantTokenCount(provisionalQuotaUnits)} provisional quota units are held for
            interrupted turns and will roll off if they cannot be settled.
          </small>
        ) : null}
        {error ? <small className="portfolio-assistant-quota-error">{error}</small> : null}
      </div>
    </details>
  );
}

function AssistantChat({
  getAttemptId,
  hasOlderMessages,
  initialMessages,
  isLoadingOlder,
  loadOlderMessages,
  olderError,
  threadId,
  onConnectionError,
  onThreadActivityChange,
  onThreadBusyChange,
  onThreadTitleSettled,
  shouldNameThread,
  userDisplayName,
  userPictureUrl,
}: {
  getAttemptId: () => Promise<string>;
  hasOlderMessages: boolean;
  initialMessages: UIMessage[];
  isLoadingOlder: boolean;
  loadOlderMessages: () => Promise<UIMessage[] | null>;
  olderError: string | null;
  threadId: string;
  onConnectionError: (message: string) => void;
  onThreadActivityChange: (threadId: string, hasActivity: boolean) => void;
  onThreadBusyChange: (threadId: string, isBusy: boolean) => void;
  onThreadTitleSettled: () => void;
  shouldNameThread: boolean;
  userDisplayName: string;
  userPictureUrl: string | null;
}) {
  const query = useCallback(async () => ({ rid: await getAttemptId() }), [getAttemptId]);
  const queryDeps = useMemo(() => [threadId], [threadId]);
  const loadInitialMessages = useCallback(async () => initialMessages, [initialMessages]);
  const agent = useAgent({
    agent: "PortfolioAgent",
    name: threadId,
    host: publicAuthOrigin ?? "",
    query,
    queryDeps,
    cacheTtl: AGENT_QUERY_CACHE_TTL_MS,
    maxRetries: 3,
    connectionTimeout: 10_000,
    onConnectionError: () => {
      onConnectionError(
        "The assistant connection was interrupted. Your thread is still available; try again.",
      );
    },
  });
  const [draft, setDraft] = useState("");
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);
  const submitPendingRef = useRef(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const messageListRef = useRef<HTMLDivElement>(null);
  const previousVisibleMessageCountRef = useRef(0);
  const shouldFollowTranscriptRef = useRef(true);
  const previousTranscriptScrollTopRef = useRef<number | null>(null);
  const pendingHistoryAnchorRef = useRef<{ previousHeight: number; previousTop: number } | null>(
    null,
  );
  const [isTranscriptPinnedToBottom, setIsTranscriptPinnedToBottom] = useState(true);
  const loadedHistoryIdsRef = useRef<Set<string>>(
    new Set(initialMessages.map((message) => message.id)),
  );
  const initialHistoryTailIdRef = useRef<string | null>(
    initialMessages[initialMessages.length - 1]?.id ?? null,
  );
  const {
    messages,
    setMessages,
    sendMessage,
    regenerate,
    clearError,
    error,
    isRecovering,
    isStreaming,
  } = useAgentChat({
    agent,
    getInitialMessages: loadInitialMessages,
    syncMessagesToServer: false,
  });
  const [quota, setQuota] = useState<PortfolioAssistantQuota | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const [isQuotaLoading, setIsQuotaLoading] = useState(true);
  const refreshQuota = useCallback(async () => {
    setIsQuotaLoading(true);
    try {
      setQuota(await getAssistantQuota());
      setQuotaError(null);
    } catch (quotaLoadError: unknown) {
      setQuotaError(
        quotaLoadError instanceof Error
          ? quotaLoadError.message
          : "The assistant budget could not be loaded.",
      );
    } finally {
      setIsQuotaLoading(false);
    }
  }, []);
  useEffect(() => {
    void refreshQuota();
  }, [refreshQuota]);
  const errorPresentation = describeAssistantError(error);
  const providerAllocationExhausted = errorPresentation.title === "Provider allocation exhausted.";
  const displayedMessages = useMemo(() => {
    const tailId = initialHistoryTailIdRef.current;
    if (!tailId || loadedHistoryIdsRef.current.size === messages.length) return messages;
    const tailIndex = messages.findIndex((message) => message.id === tailId);
    if (tailIndex < 0) return messages;
    return messages.filter(
      (message, index) => loadedHistoryIdsRef.current.has(message.id) || index > tailIndex,
    );
  }, [messages]);
  const renderedMessages = useStreamingMessageSnapshot(displayedMessages, isStreaming);
  const renderedVisibleMessages = useMemo(() => {
    const latestMessageId = renderedMessages.at(-1)?.id;
    return renderedMessages.filter(
      (message) =>
        message.role === "user" ||
        hasVisibleMessageContent(message) ||
        (isStreaming && message.role === "assistant" && message.id === latestMessageId),
    );
  }, [isStreaming, renderedMessages]);
  const showSubmittingActivity = isSubmitting && !isStreaming;
  const isTurnBusy = isSubmitting || isStreaming || isRecovering || isRetrying;
  useEffect(() => {
    onThreadBusyChange(threadId, isTurnBusy);
  }, [isTurnBusy, onThreadBusyChange, threadId]);
  const showStatus =
    isRetrying ||
    isRecovering ||
    showSubmittingActivity ||
    Boolean(error) ||
    Boolean(agent.connectionError);

  const resizeComposer = useCallback((value: string) => {
    const textarea = composerTextareaRef.current;
    if (!textarea) return;
    textarea.style.blockSize = "auto";
    const contentHeight = textarea.scrollHeight;
    textarea.style.blockSize = `${Math.min(contentHeight, ASSISTANT_COMPOSER_MAX_HEIGHT_PX)}px`;
    textarea.style.overflowY =
      value.trim() && contentHeight > ASSISTANT_COMPOSER_MAX_HEIGHT_PX ? "auto" : "hidden";
  }, []);

  useLayoutEffect(() => {
    resizeComposer(draft);
  }, [draft, resizeComposer]);

  useLayoutEffect(() => {
    const list = messageListRef.current;
    const transcript = list?.closest<HTMLElement>(".portfolio-assistant-transcript");
    if (!transcript || renderedVisibleMessages.length === 0) {
      return;
    }

    const pendingHistoryAnchor = pendingHistoryAnchorRef.current;
    if (pendingHistoryAnchor) {
      const nextTop = Math.max(
        0,
        pendingHistoryAnchor.previousTop +
          transcript.scrollHeight -
          pendingHistoryAnchor.previousHeight,
      );
      if (Math.abs(transcript.scrollTop - nextTop) > 1) transcript.scrollTop = nextTop;
      pendingHistoryAnchorRef.current = null;
      shouldFollowTranscriptRef.current = false;
      previousTranscriptScrollTopRef.current = transcript.scrollTop;
      setIsTranscriptPinnedToBottom(false);
    } else if (previousVisibleMessageCountRef.current === 0 || shouldFollowTranscriptRef.current) {
      const nextTop = Math.max(0, transcript.scrollHeight - transcript.clientHeight);
      if (Math.abs(transcript.scrollTop - nextTop) > 1) transcript.scrollTop = nextTop;
      shouldFollowTranscriptRef.current = true;
      previousTranscriptScrollTopRef.current = transcript.scrollTop;
      setIsTranscriptPinnedToBottom(true);
    }

    previousVisibleMessageCountRef.current = renderedVisibleMessages.length;
  }, [renderedVisibleMessages]);

  const syncTranscriptFollowState = useCallback((transcript: HTMLElement) => {
    const distanceFromBottom =
      transcript.scrollHeight - transcript.scrollTop - transcript.clientHeight;
    const previousScrollTop = previousTranscriptScrollTopRef.current;
    const movedUp = previousScrollTop !== null && transcript.scrollTop < previousScrollTop - 1;
    const isPinned = !movedUp && distanceFromBottom <= ASSISTANT_SCROLL_BOTTOM_THRESHOLD_PX;
    shouldFollowTranscriptRef.current = isPinned;
    previousTranscriptScrollTopRef.current = transcript.scrollTop;
    setIsTranscriptPinnedToBottom((current) => (current === isPinned ? current : isPinned));
  }, []);

  const handleJumpToLatest = useCallback(() => {
    const list = messageListRef.current;
    const transcript = list?.closest<HTMLElement>(".portfolio-assistant-transcript");
    if (!transcript) return;
    shouldFollowTranscriptRef.current = true;
    const nextTop = Math.max(0, transcript.scrollHeight - transcript.clientHeight);
    if (Math.abs(transcript.scrollTop - nextTop) > 1) transcript.scrollTop = nextTop;
    previousTranscriptScrollTopRef.current = transcript.scrollTop;
    setIsTranscriptPinnedToBottom(true);
  }, []);

  const prependMissingMessages = useCallback(
    (olderMessages: readonly UIMessage[], currentMessages: readonly UIMessage[]) => {
      const existingIds = new Set(currentMessages.map((message) => message.id));
      const missingMessages = olderMessages.filter((message) => !existingIds.has(message.id));
      return [...missingMessages, ...currentMessages];
    },
    [],
  );

  const handleLoadOlderMessages = useCallback(async () => {
    const list = messageListRef.current;
    const transcript = list?.closest<HTMLElement>(".portfolio-assistant-transcript");
    if (!transcript || isLoadingOlder || !hasOlderMessages) return;
    const previousHeight = transcript.scrollHeight;
    const previousTop = transcript.scrollTop;
    const olderMessages = await loadOlderMessages();
    if (!olderMessages?.length) return;
    for (const message of olderMessages) loadedHistoryIdsRef.current.add(message.id);
    pendingHistoryAnchorRef.current = { previousHeight, previousTop };
    setMessages((currentMessages) => prependMissingMessages(olderMessages, currentMessages));
  }, [hasOlderMessages, isLoadingOlder, loadOlderMessages, prependMissingMessages, setMessages]);

  const handleTranscriptScroll = useCallback(() => {
    const list = messageListRef.current;
    const transcript = list?.closest<HTMLElement>(".portfolio-assistant-transcript");
    if (!transcript) return;
    syncTranscriptFollowState(transcript);
    if (
      transcript.scrollTop > ASSISTANT_HISTORY_TOP_THRESHOLD_PX ||
      !hasOlderMessages ||
      isLoadingOlder
    )
      return;
    void handleLoadOlderMessages();
  }, [handleLoadOlderMessages, hasOlderMessages, isLoadingOlder, syncTranscriptFollowState]);

  const handleRetry = useCallback(async () => {
    if (isRetrying || isStreaming || isRecovering) return;
    setIsRetrying(true);
    onThreadBusyChange(threadId, true);
    clearError();
    try {
      await regenerate();
    } catch {
      // useAgentChat owns the safe error state shown below.
    } finally {
      setIsRetrying(false);
      void refreshQuota();
    }
  }, [
    clearError,
    isRecovering,
    isRetrying,
    isStreaming,
    onThreadBusyChange,
    refreshQuota,
    regenerate,
    threadId,
  ]);

  const submitQuestion = (question: string) => {
    const value = question.trim();
    if (
      !value ||
      submitPendingRef.current ||
      isSubmitting ||
      isStreaming ||
      isRecovering ||
      isRetrying
    )
      return;
    if (error) clearError();
    onThreadActivityChange(threadId, true);
    onThreadBusyChange(threadId, true);
    submitPendingRef.current = true;
    setIsSubmitting(true);
    shouldFollowTranscriptRef.current = true;
    previousTranscriptScrollTopRef.current = null;
    setIsTranscriptPinnedToBottom(true);
    setDraft("");

    void sendMessage({ text: value })
      .catch(() => undefined)
      .finally(() => {
        submitPendingRef.current = false;
        setIsSubmitting(false);
        if (shouldNameThread) onThreadTitleSettled();
        void refreshQuota();
      });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submitQuestion(draft);
  };

  return (
    <div className="portfolio-assistant-chat">
      <div className="portfolio-assistant-transcript-shell">
        <div
          aria-busy={isStreaming || isRecovering || isSubmitting}
          className="portfolio-assistant-transcript"
          onScroll={handleTranscriptScroll}
        >
          <AssistantMessageList
            isStreaming={isStreaming}
            messageListRef={messageListRef}
            hasOlderMessages={hasOlderMessages}
            isLoadingOlder={isLoadingOlder}
            messages={renderedMessages}
            olderError={olderError}
            onLoadOlder={handleLoadOlderMessages}
            onPromptSelect={submitQuestion}
            userDisplayName={userDisplayName}
            userPictureUrl={userPictureUrl}
          />
          {error ? (
            <div className="portfolio-assistant-chat-error" role="alert">
              <div>
                <strong>{errorPresentation.title}</strong>
                <p>{errorPresentation.message}</p>
              </div>
              <button
                className="action-quiet"
                disabled={providerAllocationExhausted || isRetrying || isStreaming || isRecovering}
                onClick={() => void handleRetry()}
                type="button"
                title={
                  providerAllocationExhausted
                    ? "Retry after the provider allocation resets at 00:00 UTC"
                    : undefined
                }
              >
                {providerAllocationExhausted
                  ? "Unavailable until reset"
                  : isRetrying
                    ? "Retrying…"
                    : "Try again"}
              </button>
            </div>
          ) : null}
        </div>
        {isStreaming && !isTranscriptPinnedToBottom ? (
          <button
            aria-label="Jump to latest assistant response"
            className="portfolio-assistant-jump-latest"
            onClick={handleJumpToLatest}
            type="button"
          >
            <ChevronDown aria-hidden="true" size={15} />
            <span>Jump to latest</span>
          </button>
        ) : null}
      </div>
      <form className="portfolio-assistant-composer" onSubmit={handleSubmit}>
        <label className="sr-only" htmlFor="portfolio-assistant-message">
          Portfolio question
        </label>
        <span className="sr-only" id="portfolio-assistant-message-hint">
          Press Enter to send. Press Shift+Enter for a new line.
        </span>
        <textarea
          aria-describedby="portfolio-assistant-message-hint"
          ref={composerTextareaRef}
          aria-keyshortcuts="Enter Shift+Enter"
          id="portfolio-assistant-message"
          onKeyDown={handleComposerKeyDown}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Ask a grounded portfolio question..."
          rows={2}
          value={draft}
        />
        <button
          aria-label="Send portfolio question"
          aria-busy={isSubmitting || isStreaming || isRecovering}
          className="portfolio-assistant-send"
          disabled={!draft.trim() || isSubmitting || isStreaming || isRecovering || isRetrying}
          type="submit"
        >
          {isSubmitting || isStreaming || isRecovering ? (
            <RefreshCw aria-hidden="true" className="portfolio-assistant-spin" size={16} />
          ) : (
            <Send aria-hidden="true" size={16} />
          )}
        </button>
      </form>
      <AssistantQuotaStatus
        error={quotaError}
        isLoading={isQuotaLoading}
        onRefresh={refreshQuota}
        quota={quota}
      />
      {showStatus ? (
        <output
          aria-live="polite"
          className="portfolio-assistant-status"
          data-status={
            isRetrying || isRecovering || showSubmittingActivity
              ? "busy"
              : error
                ? "error"
                : "warning"
          }
        >
          {isRetrying
            ? "Retrying the last question…"
            : isRecovering
              ? "Recovering the durable conversation…"
              : showSubmittingActivity
                ? "Sending question…"
                : error
                  ? errorPresentation.message
                  : "The assistant connection was interrupted. You can try again."}
        </output>
      ) : null}
    </div>
  );
}

function AssistantChatBoundary({
  onThreadActivityChange,
  onThreadBusyChange,
  onThreadTitleSettled,
  shouldNameThread,
  threadId,
  onConnectionError,
  userDisplayName,
  userPictureUrl,
}: {
  onThreadActivityChange: (threadId: string, hasActivity: boolean) => void;
  onThreadBusyChange: (threadId: string, isBusy: boolean) => void;
  onThreadTitleSettled: () => void;
  shouldNameThread: boolean;
  threadId: string;
  onConnectionError: (message: string | null) => void;
  userDisplayName: string;
  userPictureUrl: string | null;
}) {
  const { error, retry, status, takeAttemptId } = useAssistantConnectionGate(threadId);
  const history = useThreadHistory(threadId);
  const [connectionError, setConnectionError] = useState<unknown>(null);
  const handleConnectionError = useCallback((message: string) => {
    setConnectionError(new Error(message));
  }, []);
  const handleConnectionRetry = useCallback(() => {
    setConnectionError(null);
    onConnectionError(null);
    retry();
  }, [onConnectionError, retry]);

  useEffect(() => {
    if (history.status !== "ready") return;
    onThreadActivityChange(threadId, hasThreadActivity(history.messages));
  }, [history.messages, history.status, onThreadActivityChange, threadId]);

  if (status === "error" || history.status === "error" || connectionError) {
    return (
      <>
        <AssistantHistoryState
          error={history.error}
          messages={history.messages}
          userDisplayName={userDisplayName}
          userPictureUrl={userPictureUrl}
        />
        {status === "error" ? <AssistantAccessError error={error} onRetry={retry} /> : null}
        {connectionError ? (
          <AssistantAccessError error={connectionError} onRetry={handleConnectionRetry} />
        ) : null}
      </>
    );
  }

  if (status === "loading" || history.status === "loading") {
    return (
      <AssistantChatLoadingState
        detail={
          history.status === "loading"
            ? "Restoring the latest archive messages."
            : "Your thread stays available while access is checked."
        }
        label={
          history.status === "loading"
            ? "Loading saved thread…"
            : "Preparing a secure assistant session…"
        }
        messages={history.messages}
        userDisplayName={userDisplayName}
        userPictureUrl={userPictureUrl}
      />
    );
  }

  return (
    <AssistantChatErrorBoundary>
      <Suspense
        fallback={
          <output aria-busy="true" aria-live="polite" className="portfolio-assistant-chat-fallback">
            <RefreshCw aria-hidden="true" className="portfolio-assistant-spin" size={18} />
            <strong>Reconnecting to the archive…</strong>
            <p>Your thread stays available while the assistant connection is restored.</p>
          </output>
        }
      >
        <AssistantChat
          getAttemptId={takeAttemptId}
          hasOlderMessages={history.hasMore}
          initialMessages={history.messages}
          isLoadingOlder={history.isLoadingOlder}
          loadOlderMessages={history.loadOlder}
          olderError={history.olderError}
          onConnectionError={handleConnectionError}
          onThreadActivityChange={onThreadActivityChange}
          onThreadBusyChange={onThreadBusyChange}
          onThreadTitleSettled={onThreadTitleSettled}
          shouldNameThread={shouldNameThread}
          threadId={threadId}
          userDisplayName={userDisplayName}
          userPictureUrl={userPictureUrl}
        />
      </Suspense>
    </AssistantChatErrorBoundary>
  );
}

function AuthenticatedAssistant({
  onLogout,
  userDisplayName,
  userPictureUrl,
}: {
  onLogout: () => void;
  userDisplayName: string;
  userPictureUrl: string | null;
}) {
  const [threads, setThreads] = useState<AssistantThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [activeThreadHasActivity, setActiveThreadHasActivity] = useState<boolean | null>(null);
  const [activeThreadBusy, setActiveThreadBusy] = useState(false);
  const [isCreatingThread, setIsCreatingThread] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletePendingThreadId, setDeletePendingThreadId] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const cancelDeleteRef = useRef<HTMLButtonElement>(null);
  const threadSelectRef = useRef<HTMLButtonElement>(null);

  const refreshThreads = useCallback(async () => {
    setIsCreatingThread(true);
    try {
      const result = await listThreads();
      if (result.threads.length === 0) {
        const firstThread = await createThread();
        setThreads([firstThread]);
        setActiveThreadId(firstThread.id);
        setActiveThreadHasActivity(false);
        return;
      }
      setThreads(result.threads);
      if (!activeThreadId && result.threads[0]) {
        setActiveThreadId(result.threads[0].id);
        setActiveThreadHasActivity(null);
      }
    } finally {
      setIsCreatingThread(false);
    }
  }, [activeThreadId]);

  useEffect(() => {
    void refreshThreads().catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : "Threads could not be loaded.");
    });
  }, [refreshThreads]);

  const handleThreadChange = useCallback((threadId: string) => {
    setActiveThreadId(threadId || null);
    setActiveThreadHasActivity(null);
    setActiveThreadBusy(false);
  }, []);

  const canCreateNewThread =
    Boolean(activeThreadId) && canStartAnotherThread(activeThreadId, activeThreadHasActivity);

  const handleNewThread = async () => {
    if (!canCreateNewThread || isCreatingThread) return;
    setIsCreatingThread(true);
    try {
      const thread = await createThread();
      setThreads((current) => [thread, ...current]);
      setActiveThreadId(thread.id);
      setActiveThreadHasActivity(false);
      setError(null);
    } catch (createError: unknown) {
      setError(createError instanceof Error ? createError.message : "Thread could not be created.");
    } finally {
      setIsCreatingThread(false);
    }
  };

  const requestDelete = () => {
    if (activeThreadId && !activeThreadBusy) setDeletePendingThreadId(activeThreadId);
  };

  const handleDelete = async () => {
    if (!deletePendingThreadId || isDeleting || activeThreadBusy) return;
    setIsDeleting(true);
    try {
      await deleteThread(deletePendingThreadId);
      const remaining = threads.filter((thread) => thread.id !== deletePendingThreadId);
      setThreads(remaining);
      setActiveThreadId((current) =>
        current === deletePendingThreadId ? (remaining[0]?.id ?? null) : current,
      );
      setActiveThreadHasActivity(null);
      setActiveThreadBusy(false);
      setDeletePendingThreadId(null);
      setError(null);
    } catch (deleteError: unknown) {
      setError(deleteError instanceof Error ? deleteError.message : "Thread could not be deleted.");
      setDeletePendingThreadId(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const handleExport = async () => {
    if (!activeThreadId) return;
    try {
      const payload = await exportThread(activeThreadId);
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `syn-forge-assistant-${activeThreadId}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    } catch (exportError: unknown) {
      setError(exportError instanceof Error ? exportError.message : "Export could not be created.");
    }
  };

  const handleLogout = async () => {
    await signOut().catch(() => undefined);
    onLogout();
  };

  const handleThreadTitleSettled = useCallback(() => {
    void refreshThreads().catch((loadError: unknown) => {
      setError(loadError instanceof Error ? loadError.message : "Threads could not be refreshed.");
    });
  }, [refreshThreads]);

  const handleThreadActivityChange = useCallback(
    (threadId: string, hasActivity: boolean) => {
      setActiveThreadHasActivity((current) =>
        activeThreadId === threadId ? hasActivity : current,
      );
    },
    [activeThreadId],
  );

  const handleThreadBusyChange = useCallback(
    (threadId: string, isBusy: boolean) => {
      setActiveThreadBusy((current) => (activeThreadId === threadId ? isBusy : current));
    },
    [activeThreadId],
  );

  const handleRetryThreadSetup = () => {
    setError(null);
    void refreshThreads().catch((loadError: unknown) => {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "A new assistant thread could not be prepared.",
      );
    });
  };

  const activeThread = threads.find((thread) => thread.id === activeThreadId);
  const shouldNameActiveThread = !activeThread?.title?.trim();
  return (
    <div className="portfolio-assistant-session">
      <div className="portfolio-assistant-toolbar">
        <AssistantThreadSelect
          activeThread={activeThread}
          activeThreadId={activeThreadId}
          disabled={!activeThreadId || isCreatingThread}
          onChange={handleThreadChange}
          triggerRef={threadSelectRef}
          threads={threads}
        />
        <button
          aria-label={
            canCreateNewThread
              ? "New assistant thread"
              : "Ask a question before creating another thread"
          }
          className="portfolio-assistant-icon"
          disabled={!canCreateNewThread || isCreatingThread}
          onClick={() => void handleNewThread()}
          title={
            canCreateNewThread
              ? "New assistant thread"
              : "Ask a question before creating another thread"
          }
          type="button"
        >
          <Plus aria-hidden="true" size={15} />
        </button>
        <AssistantThreadActionsMenu
          activeThreadId={activeThreadId}
          deleteDisabled={activeThreadBusy}
          onDelete={requestDelete}
          onExport={() => void handleExport()}
          onLogout={() => void handleLogout()}
        />
      </div>
      {error ? <p className="portfolio-assistant-error">{error}</p> : null}
      {activeThreadId ? (
        <AssistantChatBoundary
          key={activeThreadId}
          onConnectionError={setError}
          onThreadActivityChange={handleThreadActivityChange}
          onThreadBusyChange={handleThreadBusyChange}
          onThreadTitleSettled={handleThreadTitleSettled}
          shouldNameThread={shouldNameActiveThread}
          threadId={activeThreadId}
          userDisplayName={userDisplayName}
          userPictureUrl={userPictureUrl}
        />
      ) : (
        <AssistantThreadPlaceholder
          error={error}
          isRetrying={isCreatingThread}
          onRetry={handleRetryThreadSetup}
        />
      )}
      <Modal
        description="This permanently removes the selected thread and its messages from your assistant archive."
        footer={
          <>
            <button
              className="action-quiet"
              disabled={isDeleting}
              onClick={() => setDeletePendingThreadId(null)}
              ref={cancelDeleteRef}
              type="button"
            >
              Keep thread
            </button>
            <button
              className="action-quiet app-modal-danger"
              disabled={isDeleting || activeThreadBusy}
              onClick={() => void handleDelete()}
              type="button"
            >
              {isDeleting ? "Deleting…" : "Delete thread"}
            </button>
          </>
        }
        initialFocusRef={cancelDeleteRef}
        onClose={() => {
          if (!isDeleting) setDeletePendingThreadId(null);
        }}
        open={deletePendingThreadId !== null}
        returnFocusRef={threadSelectRef}
        role="alertdialog"
        title="Delete this thread?"
      >
        <p className="portfolio-assistant-modal-copy">
          {threads.find((thread) => thread.id === deletePendingThreadId)?.title ??
            "The selected assistant thread"}{" "}
          will no longer appear in your archive.
        </p>
      </Modal>
    </div>
  );
}

export default function PortfolioAssistantFab() {
  const { activePanel, closePanel, openPanel } = useFloatingControls();
  const isOpen = activePanel === "assistant";
  const isResponsiveModal = useAssistantResponsiveDialog();
  const fabRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [session, setSession] = useState<PublicSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [sessionError, setSessionError] = useState<unknown>(null);
  const configurationError = portfolioAssistantConfig.configurationError;
  const [isExpanded, setIsExpanded] = useState(false);
  const expandRef = useRef<HTMLButtonElement>(null);
  const isDialogPresentation = isOpen && (isExpanded || isResponsiveModal);
  const canExpand =
    !isResponsiveModal && Boolean(session?.authenticated && session.turnstileVerified);

  const openAssistant = async () => {
    openPanel("assistant");
    if (portfolioAssistantAvailability === "teaser") {
      setSessionError(null);
      return;
    }
    if (configurationError) {
      setSessionError(configurationError);
      return;
    }
    if (session || loading) return;
    setLoading(true);
    try {
      const result = await getSession();
      setSession(result);
      setSessionError(null);
    } catch (error: unknown) {
      setSession(null);
      setSessionError(error);
    } finally {
      setLoading(false);
    }
  };

  const handleVerified = useCallback(() => {
    setSession((current) => (current ? { ...current, turnstileVerified: true } : current));
  }, []);

  const collapseExpanded = useCallback(() => {
    setIsExpanded(false);
    window.requestAnimationFrame(() => expandRef.current?.focus());
  }, []);

  const closeAssistant = useCallback(() => {
    setIsExpanded(false);
    closePanel("assistant");
    window.requestAnimationFrame(() => fabRef.current?.focus());
  }, [closePanel]);

  const toggleExpanded = useCallback(() => {
    if (!canExpand) return;
    setIsExpanded((current) => !current);
  }, [canExpand]);

  const dismissAssistantBackdrop = useCallback(() => {
    if (isResponsiveModal) {
      closeAssistant();
      return;
    }
    collapseExpanded();
  }, [closeAssistant, collapseExpanded, isResponsiveModal]);

  useEffect(() => {
    if (!canExpand) setIsExpanded(false);
  }, [canExpand]);

  useEffect(() => {
    if (!isDialogPresentation) return;
    const documentElement = document.documentElement;
    const previousBodyOverflow = document.body.style.overflow;
    const previousDocumentOverflow = documentElement.style.overflow;
    const previousScrollbarGutter = documentElement.style.scrollbarGutter;
    document.body.style.overflow = "hidden";
    documentElement.style.overflow = "hidden";
    documentElement.style.scrollbarGutter = "auto";
    return () => {
      document.body.style.overflow = previousBodyOverflow;
      documentElement.style.overflow = previousDocumentOverflow;
      documentElement.style.scrollbarGutter = previousScrollbarGutter;
    };
  }, [isDialogPresentation]);

  useEffect(() => {
    if (!isOpen) return;

    const focusFrame = window.requestAnimationFrame(() => {
      const firstFocusable = panelRef.current?.querySelector<HTMLElement>(
        ASSISTANT_FOCUSABLE_SELECTOR,
      );
      (firstFocusable ?? panelRef.current)?.focus();
    });
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (isExpanded && !isResponsiveModal) {
          collapseExpanded();
        } else {
          closeAssistant();
        }
        return;
      }
      if (!isDialogPresentation || event.key !== "Tab") return;

      const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
        ASSISTANT_FOCUSABLE_SELECTOR,
      );
      if (!focusable || focusable.length === 0) {
        event.preventDefault();
        panelRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!panelRef.current?.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    closeAssistant,
    collapseExpanded,
    isDialogPresentation,
    isExpanded,
    isOpen,
    isResponsiveModal,
  ]);

  return (
    <div
      className={`portfolio-assistant ${isOpen ? "is-open" : ""}`}
      data-assistant-mode={isExpanded ? "expanded" : "compact"}
      data-assistant-dialog={isDialogPresentation ? "true" : undefined}
      data-assistant-mobile-modal={isResponsiveModal ? "true" : undefined}
      data-availability={portfolioAssistantAvailability}
      data-floating-panel="assistant"
    >
      {isOpen && isDialogPresentation && !isResponsiveModal ? (
        <button
          aria-label="Close expanded portfolio assistant"
          className="portfolio-assistant-expanded-backdrop"
          onClick={dismissAssistantBackdrop}
          tabIndex={-1}
          type="button"
        />
      ) : null}
      {isOpen ? (
        <>
          {/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: aria-modal is paired with the conditional dialog role. */}
          <section
            aria-label="Portfolio assistant"
            aria-modal={isDialogPresentation ? "true" : undefined}
            id="portfolio-assistant-panel"
            className="portfolio-assistant-panel"
            role={isDialogPresentation ? "dialog" : undefined}
            tabIndex={isDialogPresentation ? -1 : undefined}
            data-chat-state={
              portfolioAssistantAvailability === "teaser"
                ? "teaser"
                : configurationError
                  ? "configuration"
                  : loading
                    ? "loading"
                    : session?.authenticated
                      ? session.turnstileVerified
                        ? "active"
                        : "turnstile"
                      : "gate"
            }
            data-state="open"
            ref={panelRef}
          >
            <header className="portfolio-assistant-header">
              <div>
                <p className="eyebrow">Syn-Forge assistant</p>
                <h2>
                  {portfolioAssistantAvailability === "teaser"
                    ? "Coming soon."
                    : "Ask the archive."}
                </h2>
                <p className="portfolio-assistant-muted">
                  {portfolioAssistantAvailability === "teaser"
                    ? "A source-grounded portfolio guide is in development."
                    : "Grounded in the portfolio MCP. No general-purpose work."}
                </p>
              </div>
              <div className="portfolio-assistant-header-actions">
                {canExpand ? (
                  <button
                    aria-controls="portfolio-assistant-panel"
                    aria-expanded={isExpanded}
                    aria-label={
                      isExpanded
                        ? "Collapse expanded portfolio assistant"
                        : "Expand portfolio assistant for reading"
                    }
                    className="portfolio-assistant-icon"
                    onClick={toggleExpanded}
                    ref={expandRef}
                    title={isExpanded ? "Collapse assistant" : "Expand assistant for reading"}
                    type="button"
                  >
                    {isExpanded ? (
                      <Minimize2 aria-hidden="true" size={17} />
                    ) : (
                      <Maximize2 aria-hidden="true" size={17} />
                    )}
                  </button>
                ) : null}
                <button
                  aria-label="Close portfolio assistant"
                  className="portfolio-assistant-icon"
                  onClick={closeAssistant}
                  title="Close portfolio assistant"
                  type="button"
                >
                  <X aria-hidden="true" size={17} />
                </button>
              </div>
            </header>
            <div
              className="portfolio-assistant-body"
              data-chat-state={
                session?.authenticated && session.turnstileVerified ? "active" : undefined
              }
            >
              {portfolioAssistantAvailability === "teaser" ? (
                <AssistantComingSoon />
              ) : configurationError ? (
                <div className="portfolio-assistant-sign-in">
                  <MessageCircle aria-hidden="true" size={28} />
                  <h3>Assistant is not configured for this environment.</h3>
                  <p>{configurationError}</p>
                </div>
              ) : loading ? (
                <AssistantSessionLoadingState />
              ) : session?.authenticated ? (
                session.turnstileVerified ? (
                  <AuthenticatedAssistant
                    onLogout={() => setSession({ authenticated: false })}
                    userDisplayName={assistantUserLabel(session.user?.displayName)}
                    userPictureUrl={session.user?.pictureUrl ?? null}
                  />
                ) : (
                  <TurnstileGate onVerified={handleVerified} />
                )
              ) : sessionError ? (
                <AssistantAccessError error={sessionError} onRetry={() => void openAssistant()} />
              ) : (
                <div className="portfolio-assistant-sign-in portfolio-assistant-sign-in-gate">
                  <div aria-hidden="true" className="portfolio-assistant-sign-in-rail">
                    <span className="portfolio-assistant-sign-in-index">01</span>
                    <MessageCircle size={24} />
                    <span className="portfolio-assistant-sign-in-rail-line" />
                  </div>
                  <div className="portfolio-assistant-sign-in-content">
                    <p className="portfolio-assistant-sign-in-kicker">Private thread / access 01</p>
                    <h3>Sign in to open the archive.</h3>
                    <p>
                      Use Google to receive a bounded, private thread. The assistant only answers
                      with evidence from this portfolio.
                    </p>
                    <div className="portfolio-assistant-sign-in-actions">
                      <button
                        className="action-signal portfolio-assistant-google-action"
                        onClick={() => window.location.assign(signInUrl(window.location.href))}
                        title="Continue with Google"
                        type="button"
                      >
                        <LogIn aria-hidden="true" size={16} /> Continue with Google
                      </button>
                      <span className="portfolio-assistant-sign-in-note">
                        Read-only answers from the portfolio
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </section>
        </>
      ) : null}
      {!isDialogPresentation ? (
        <button
          aria-controls="portfolio-assistant-panel"
          aria-expanded={isOpen}
          aria-label={
            isOpen
              ? "Close portfolio assistant"
              : portfolioAssistantAvailability === "teaser"
                ? "Open portfolio assistant (coming soon)"
                : "Open portfolio assistant"
          }
          className="portfolio-assistant-fab"
          onClick={() => (isOpen ? closeAssistant() : void openAssistant())}
          title={
            portfolioAssistantAvailability === "teaser"
              ? "Portfolio assistant — coming soon"
              : "Portfolio assistant"
          }
          ref={fabRef}
          type="button"
        >
          {isOpen ? (
            <X aria-hidden="true" size={20} />
          ) : (
            <MessageCircle aria-hidden="true" size={20} />
          )}
        </button>
      ) : null}
    </div>
  );
}
