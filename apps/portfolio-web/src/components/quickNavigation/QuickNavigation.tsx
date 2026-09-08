import { Folder, FolderOpen, Home as HomeIcon, ListTree, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useFloatingControls } from "../floatingControls/useFloatingControls";
import TransitionNavLink from "../pageTransition/TransitionNavLink";

type QuickNavigationTab = "portfolio" | "apps";

const visibleRoutePrefixes = ["/projects", "/certificates", "/snippets"];

const links = {
  portfolio: [
    ["01", "Projects", "/projects"],
    ["02", "Certificates", "/certificates"],
    ["03", "Snippets", "/snippets"],
    ["04", "Privacy", "/privacy-policy"],
    ["05", "Terms", "/terms-and-conditions"],
  ],
  apps: [
    ["01", "NetBird", "/netbird"],
    ["02", "Atelier", "/atelier"],
    ["03", "AI and MCP", "/ai"],
    ["04", "Portfolio Assistant", "/agent"],
  ],
} as const;

export default function QuickNavigation() {
  const location = useLocation();
  const { activePanel, closePanel, openPanel } = useFloatingControls();
  const [activeTab, setActiveTab] = useState<QuickNavigationTab>("portfolio");
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const isOpen = activePanel === "quick-navigation";
  const isVisible = visibleRoutePrefixes.some((prefix) => location.pathname.startsWith(prefix));

  const closeNavigation = useCallback(() => {
    closePanel("quick-navigation");
    window.requestAnimationFrame(() => toggleRef.current?.focus());
  }, [closePanel]);

  useEffect(() => {
    if (!isOpen) return;

    const focusFrame = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLElement>("button, a")?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;

      event.preventDefault();
      closeNavigation();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeNavigation, isOpen]);

  useEffect(() => {
    if (isVisible || !isOpen) return;
    closePanel("quick-navigation");
  }, [closePanel, isOpen, isVisible]);

  if (!isVisible) return null;

  return (
    <div
      className={`quick-navigation${isOpen ? " is-open" : ""}`}
      data-floating-panel="quick-navigation"
    >
      <div
        ref={panelRef}
        aria-hidden={!isOpen}
        className="quick-navigation-panel w-[min(22rem,calc(100vw-2rem))] border border-line-strong bg-surface shadow-panel"
        data-state={isOpen ? "open" : "closed"}
        id="quick-navigation-panel"
        inert={!isOpen}
      >
        <div className="flex items-start justify-between gap-4 border-b border-line px-4 py-4">
          <div>
            <p className="eyebrow mb-1">Quick navigation</p>
            <strong className="font-display text-xl font-normal text-text">
              What do you want to view?
            </strong>
          </div>
          <button
            aria-label="Close quick navigation"
            className="inline-grid min-h-9 min-w-9 place-items-center border border-line-strong bg-transparent text-text hover:border-signal hover:text-signal"
            onClick={closeNavigation}
            type="button"
          >
            <X aria-hidden="true" size={17} />
          </button>
        </div>

        <div
          className="grid grid-cols-2 border-b border-line"
          role="tablist"
          aria-label="Quick navigation category"
        >
          {(["portfolio", "apps"] as const).map((tab) => {
            const isActive = tab === activeTab;
            const Icon = isActive ? FolderOpen : Folder;

            return (
              <button
                aria-selected={isActive}
                className={`flex min-h-11 items-center justify-center gap-2 border-r border-line font-mono text-meta uppercase tracking-[0.06em] last:border-r-0 ${isActive ? "bg-surface-raised text-signal" : "text-text-muted hover:text-text"}`}
                key={tab}
                onClick={() => setActiveTab(tab)}
                role="tab"
                type="button"
              >
                <Icon aria-hidden="true" size={16} />
                {tab}
              </button>
            );
          })}
        </div>

        <nav aria-label={`${activeTab} quick links`} className="grid gap-1 p-3">
          {links[activeTab].map(([number, label, path]) => (
            <TransitionNavLink
              className={({ isActive }) =>
                `grid grid-cols-[2rem_1fr] items-center gap-3 border border-transparent px-2 py-2 no-underline ${isActive ? "border-line bg-surface-raised text-signal" : "text-text-muted hover:border-line hover:text-text"}`
              }
              key={path}
              onBeforeNavigate={closeNavigation}
              to={path}
            >
              <span className="font-mono text-meta text-text-faint">{number}</span>
              <span>{label}</span>
            </TransitionNavLink>
          ))}
        </nav>
      </div>

      <button
        ref={toggleRef}
        aria-controls="quick-navigation-panel"
        aria-expanded={isOpen}
        aria-label={isOpen ? "Close quick navigation" : "Open quick navigation"}
        className="quick-navigation-toggle inline-flex min-h-12 items-center gap-3 border border-line-strong bg-surface px-3 text-text shadow-panel transition-colors hover:border-signal hover:text-signal"
        data-cursor="context-menu"
        onClick={() => (isOpen ? closeNavigation() : openPanel("quick-navigation"))}
        title="Quick navigation"
        type="button"
      >
        <span className="inline-grid min-h-8 min-w-8 place-items-center border border-line-strong">
          <HomeIcon aria-hidden="true" size={15} />
        </span>
        <ListTree aria-hidden="true" size={19} />
      </button>
    </div>
  );
}
