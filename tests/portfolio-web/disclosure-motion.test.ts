import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test } from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../../apps/portfolio-web");
const read = (relativePath: string) => readFile(resolve(repositoryRoot, relativePath), "utf8");

test("keeps media modal presence until exit completes", async () => {
  const [modal, projects, certificates, styles] = await Promise.all([
    read("src/components/mediaModal/MediaModal.tsx"),
    read("src/components/pages/projectsPage/Projects.tsx"),
    read("src/components/pages/certificatesPage/Certificates.tsx"),
    read("src/styles/media-modal.css"),
  ]);

  assert.match(modal, /onExitComplete\?: \(\) => void/);
  assert.match(modal, /data-state=\{show \? "open" : "closing"\}/);
  assert.match(modal, /onAnimationEnd=\{handleModalAnimationEnd\}/);
  assert.match(modal, /event.target === event.currentTarget/);
  assert.match(modal, /event.key === "Escape"/);
  assert.match(modal, /document.body.style.overflow = "hidden"/);
  assert.match(modal, /previouslyFocusedRef.current\?\.focus\(\)/);
  assert.match(modal, /hasCompletedExitRef/);
  assert.match(modal, /if \(!show\) return;/);
  assert.doesNotMatch(modal, /if \(!show \|\| !item \|\| !activeMedia\)/);
  assert.match(projects, /onExitComplete=\{handleModalExitComplete\}/);
  assert.match(projects, /const handleModalExitComplete = useCallback/);
  assert.match(certificates, /onExitComplete=\{handleModalExitComplete\}/);
  assert.match(certificates, /const handleModalExitComplete = useCallback/);
  assert.doesNotMatch(projects, /setTimeout\(\(\) => setSelectedProject/);
  assert.doesNotMatch(certificates, /setTimeout\(\(\) => setSelectedCert/);
  assert.match(styles, /media-modal-backdrop\[data-state="closing"\]/);
  assert.match(styles, /media-modal-dialog-exit/);
});

test("keeps fixed disclosures mounted and closed states inert", async () => {
  const [quickNavigation, navBar, toc, privacy, terms] = await Promise.all([
    read("src/components/quickNavigation/QuickNavigation.tsx"),
    read("src/components/navBar/NavBar.tsx"),
    read("src/components/pages/snippetsPage/SnippetDocumentToc.tsx"),
    read("src/components/pages/privacyPolicyPage/PrivacyPolicy.tsx"),
    read("src/components/pages/termsAndConditionsPage/TermsAndConditions.tsx"),
  ]);

  assert.doesNotMatch(quickNavigation, /\{isOpen && \(/);
  assert.match(quickNavigation, /aria-controls="quick-navigation-panel"/);
  assert.match(quickNavigation, /inert=\{!isOpen\}/);
  assert.match(quickNavigation, /event.key !== "Escape"/);
  assert.match(quickNavigation, /toggleRef.current\?\.focus\(\)/);
  assert.match(navBar, /data-navigation-state=\{expanded \? "open" : "closed"\}/);
  assert.match(navBar, /event.key !== "Escape"/);
  assert.match(navBar, /menuButtonRef.current\?\.focus\(\)/);
  assert.match(navBar, /onBeforeNavigate=\{closeNavigation\}/);
  assert.doesNotMatch(navBar, /\$\{expanded \? "flex" : "hidden"\}/);
  assert.doesNotMatch(toc, /<details/);
  assert.match(toc, /aria-expanded=\{isMobileOpen\}/);
  assert.match(toc, /inert=\{!isMobileOpen\}/);
  assert.match(toc, /event.key !== "Escape"/);
  assert.match(toc, /mobileTriggerRef.current\?\.focus\(\)/);
  assert.match(toc, /if \(isMobileOpen\) closeMobileToc\(\)/);
  assert.match(privacy, /aria-controls="policy-action-panel"/);
  assert.match(privacy, /inert=\{!quickActionsOpen\}/);
  assert.match(terms, /aria-controls="policy-action-panel"/);
  assert.match(terms, /inert=\{!quickActionsOpen\}/);
  assert.match(privacy, /if \(quickActionsOpen\) \{[\s\S]*closeQuickActions\(\)/);
  assert.match(terms, /if \(quickActionsOpen\) \{[\s\S]*closeQuickActions\(\)/);
  assert.doesNotMatch(privacy, /onClick=\{\(\) => setQuickActionsOpen\(false\)\}/);
  assert.doesNotMatch(terms, /onClick=\{\(\) => setQuickActionsOpen\(false\)\}/);
});

test("defines anchored overlay and disclosure motion tokens", async () => {
  const [tokens, media, quickNavigation, tocStyles, legalPolicyStyles] = await Promise.all([
    read("src/styles/tokens.css"),
    read("src/styles/media-modal.css"),
    read("src/styles/quick-navigation.css"),
    read("src/components/pages/snippetsPage/SnippetDocument.css"),
    read("src/components/pages/privacyPolicyPage/LegalPolicyPage.css"),
  ]);

  assert.match(tokens, /--motion-overlay-enter-duration: 280ms/);
  assert.match(tokens, /--motion-overlay-exit-duration: 180ms/);
  assert.match(tokens, /--motion-disclosure-enter-duration: 220ms/);
  assert.match(tokens, /--motion-disclosure-exit-duration: 160ms/);
  assert.match(media, /@keyframes media-modal-backdrop-enter/);
  assert.match(media, /@keyframes media-modal-backdrop-exit/);
  assert.match(media, /media-modal-backdrop\[data-state="open"\]/);
  assert.match(quickNavigation, /\.quick-navigation-panel\[data-state="open"\]/);
  assert.match(quickNavigation, /transform-origin: bottom right/);
  assert.match(quickNavigation, /\.navigation-menu\[data-navigation-state="open"\]/);
  assert.match(quickNavigation, /transform-origin: top/);
  assert.match(tocStyles, /bottom: calc\(100% \+ 0\.5rem\)/);
  assert.match(tocStyles, /\.snippet-document-toc-mobile\[data-state="open"\]/);
  assert.match(legalPolicyStyles, /\.legal-policy-page \.privacy-policy-action-panel/);
  assert.match(legalPolicyStyles, /\.legal-policy-page \.privacy-policy-quick-actions\.is-open/);
  assert.match(legalPolicyStyles, /--policy-control-clearance:\s*calc\(/);
  assert.match(legalPolicyStyles, /inset-inline-end:\s*var\(--policy-control-clearance\)/);
  assert.match(legalPolicyStyles, /calc\(100vw - var\(--policy-control-clearance\)/);

  for (const source of [tokens, media, quickNavigation, tocStyles, legalPolicyStyles]) {
    assert.doesNotMatch(source, /!important/);
  }
});

test("keeps reduced-motion paths immediate", async () => {
  const [media, quickNavigation, tocStyles, legalPolicyStyles] = await Promise.all([
    read("src/styles/media-modal.css"),
    read("src/styles/quick-navigation.css"),
    read("src/components/pages/snippetsPage/SnippetDocument.css"),
    read("src/components/pages/privacyPolicyPage/LegalPolicyPage.css"),
  ]);

  assert.match(media, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(media, /media-modal-backdrop\[data-state="closing"\][\s\S]*animation: none;/);
  assert.match(quickNavigation, /transition: none;\s+transform: none;/);
  assert.match(tocStyles, /\.snippet-document-toc-mobile-panel/);
  assert.match(tocStyles, /\.snippet-document-toc-mobile-panel \{[\s\S]*transform: none;/);
  assert.match(tocStyles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(legalPolicyStyles, /\.legal-policy-page \.privacy-policy-action-panel/);
  assert.match(legalPolicyStyles, /transition: none;/);
});
