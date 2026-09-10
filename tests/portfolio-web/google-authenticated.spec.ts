import { expect, test } from "playwright/test";
import { installAssistantBrowserAudit } from "./playwright-observability.ts";

test("reuses the saved Google session for the portfolio assistant", async ({ page }) => {
  const audit = installAssistantBrowserAudit(page);
  await page.goto("/ai");
  await expect(page.getByRole("heading", { name: "Portfolio, readable by agents." })).toBeVisible();

  const sessionResponsePromise = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/session",
  );
  await page.getByRole("button", { name: "Open portfolio assistant" }).click();

  const sessionResponse = await sessionResponsePromise;
  expect(sessionResponse.status()).toBe(200);
  const session = (await sessionResponse.json()) as { authenticated?: unknown };
  expect(session.authenticated).toBe(true);

  const panel = page.locator("#portfolio-assistant-panel");
  await expect(panel).toHaveAttribute("data-chat-state", /^(turnstile|active)$/);
  audit.assertClean();
});

test("audits the authenticated assistant WebSocket and grounded response", async ({ page }) => {
  test.setTimeout(120_000);
  test.skip(
    process.env.PLAYWRIGHT_LIVE_ASSISTANT !== "1",
    "Set PLAYWRIGHT_LIVE_ASSISTANT=1 only for the approval-gated live assistant smoke.",
  );
  const audit = installAssistantBrowserAudit(page);
  await page.goto("/ai");
  await page.getByRole("button", { name: "Open portfolio assistant" }).click();

  const panel = page.locator("#portfolio-assistant-panel");
  await expect(panel).toHaveAttribute("data-chat-state", "active");
  await expect(panel.locator(".portfolio-assistant-composer textarea")).toBeVisible();
  await expect
    .poll(() => audit.events.some((event) => event.kind === "websocket-created"), {
      timeout: 15_000,
    })
    .toBe(true);

  const composer = panel.locator(".portfolio-assistant-composer textarea");
  const sourceDisclosure = panel.locator(".portfolio-assistant-source-disclosure");
  const initialSourceCount = await sourceDisclosure.count();
  const initialAssistantCount = await panel
    .locator("article.portfolio-assistant-message.assistant")
    .count();
  await composer.fill("Which projects use TypeScript?");
  await panel.getByRole("button", { name: "Send portfolio question" }).click();

  await expect
    .poll(
      async () => {
        const error = panel.locator(".portfolio-assistant-chat-error");
        if (await error.count()) return `error: ${await error.innerText()}`;
        if ((await sourceDisclosure.count()) > initialSourceCount) return "source-ready";
        return "pending";
      },
      { timeout: 90_000 },
    )
    .toBe("source-ready");
  await expect(panel.locator("article.portfolio-assistant-message.assistant")).toHaveCount(
    initialAssistantCount + 1,
  );
  const latestSourceDisclosure = sourceDisclosure.last();
  await expect(latestSourceDisclosure).toBeVisible();
  await latestSourceDisclosure.locator("summary").click();
  await expect(
    latestSourceDisclosure.locator(".portfolio-assistant-source-reference").first(),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await panel
          .locator(".portfolio-assistant-thread-select-trigger")
          .getAttribute("aria-label")) ?? "",
      { timeout: 90_000 },
    )
    .not.toMatch(/^Assistant thread: Thread /);
  audit.assertClean();
});

test("keeps the assistant contained and touch-sized across the responsive matrix", async ({
  page,
}) => {
  test.setTimeout(60_000);
  const audit = installAssistantBrowserAudit(page);
  await page.goto("/ai");
  await page.getByRole("button", { name: "Open portfolio assistant" }).click();

  const panel = page.locator("#portfolio-assistant-panel");
  await expect(panel).toBeVisible();
  const viewport = page.viewportSize();
  if (!viewport) throw new Error("Playwright viewport is unavailable.");

  const isResponsiveModal = viewport.width <= 640 || viewport.height <= 560;
  if (isResponsiveModal) {
    await expect(panel).toHaveAttribute("role", "dialog");
    await expect(panel).toHaveAttribute("aria-modal", "true");
    await expect(page.locator(".portfolio-assistant-fab")).toHaveCount(0);
    await expect(page.locator(".portfolio-assistant-expanded-backdrop")).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: "Expand portfolio assistant for reading" }),
    ).toHaveCount(0);

    await expect.poll(async () => (await panel.boundingBox())?.x ?? -1, { timeout: 5_000 }).toBe(0);
    const panelBox = await panel.boundingBox();
    expect(panelBox).not.toBeNull();
    expect(panelBox?.x ?? -1).toBe(0);
    expect(panelBox?.y ?? -1).toBe(0);
    expect(panelBox?.width ?? 0).toBe(viewport.width);
    expect(panelBox?.height ?? 0).toBe(viewport.height);
  } else {
    await expect(panel).not.toHaveAttribute("role", "dialog");
    await expect(page.locator(".portfolio-assistant-fab")).toHaveCount(1);
  }

  await expect
    .poll(
      async () => {
        const targets = await panel.locator("button, textarea").evaluateAll((elements) =>
          elements.map((element) => {
            const rect = element.getBoundingClientRect();
            return { height: rect.height, width: rect.width };
          }),
        );
        return targets.every(({ height, width }) => height >= 44 && width >= 44);
      },
      { timeout: 10_000 },
    )
    .toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    viewport.width,
  );

  const state = await panel.getAttribute("data-chat-state");
  if (state !== "active") {
    audit.assertClean();
    return;
  }

  const rows = await panel
    .locator(
      ".portfolio-assistant-header, .portfolio-assistant-toolbar, .portfolio-assistant-transcript-shell, .portfolio-assistant-composer, .portfolio-assistant-quota, .portfolio-assistant-status",
    )
    .evaluateAll((elements) =>
      elements
        .filter((element) => getComputedStyle(element).display !== "none")
        .map((element) => {
          const rect = element.getBoundingClientRect();
          return { bottom: rect.bottom, top: rect.top };
        }),
    );
  expect(rows.every((row, index) => index === 0 || row.top >= rows[index - 1].bottom - 1)).toBe(
    true,
  );

  const transcript = panel.locator(".portfolio-assistant-transcript");
  const transcriptBox = await transcript.boundingBox();
  expect(transcriptBox).not.toBeNull();
  expect(transcriptBox?.height ?? 0).toBeGreaterThanOrEqual(viewport.height * 0.45);
  const composer = panel.locator(".portfolio-assistant-composer textarea");
  await expect(composer).toBeVisible({ timeout: 15_000 });
  await composer.focus();
  await expect(composer).toBeFocused();

  const pageScrollTop = await page.evaluate(() => window.scrollY);
  const transcriptScroll = await transcript.evaluate((element) => {
    const before = element.scrollTop;
    const maximum = element.scrollHeight - element.clientHeight;
    const target = before > 0 ? Math.max(0, before - 120) : Math.min(maximum, before + 120);
    element.scrollTop = target;
    return {
      before,
      after: element.scrollTop,
      canScroll: element.scrollHeight > element.clientHeight,
    };
  });
  expect(await page.evaluate(() => window.scrollY)).toBe(pageScrollTop);
  if (transcriptScroll.canScroll)
    expect(Math.abs(transcriptScroll.after - transcriptScroll.before)).toBeGreaterThan(0);
  audit.assertClean();
});
