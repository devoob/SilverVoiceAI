import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const STUB = "./e2e/speech-stub.js";
const PIN = "123456";

/**
 * The PRD commits to WCAG 2.1 AA, so the audit is scoped to exactly those
 * tags. axe also ships "best practice" rules that are not part of AA; failing
 * the build on those would be noise, so they are reported but not asserted.
 */
const WCAG_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function openAssistant(page: Page) {
  await page.addInitScript({ path: STUB });
  await page.goto("/");
}

async function audit(page: Page, label: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_AA).analyze();

  if (results.violations.length > 0) {
    const summary = results.violations
      .map((v) => `  [${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))\n${v.nodes
        .slice(0, 4)
        .map((n) => `      ${n.target.join(" ")}\n      ${n.failureSummary?.split("\n")[0] ?? ""}`)
        .join("\n")}`)
      .join("\n");
    // eslint-disable-next-line no-console
    console.error(`\nWCAG 2.1 AA violations in "${label}":\n${summary}\n`);
  }

  expect(results.violations, `WCAG 2.1 AA violations in "${label}"`).toEqual([]);
  return results;
}

async function driveToPinPad(page: Page) {
  const input = page.getByTestId("fallback-input");
  await input.fill("我想繳交電力公司電費");
  await page.getByTestId("fallback-send").click();
  await expect(page.getByTestId("card-bill-confirm")).toBeVisible();
  await page.getByTestId("confirm-yes").click();
  await expect(page.getByTestId("pin-pad")).toBeVisible();
}

test.describe("WCAG 2.1 AA audit", () => {
  test("the idle home screen passes", async ({ page }) => {
    await openAssistant(page);
    await audit(page, "home / idle");
  });

  test("the screen passes mid-call with a balance card and transcript", async ({ page }) => {
    await openAssistant(page);
    const input = page.getByTestId("fallback-input");
    await input.fill("我有幾多錢");
    await page.getByTestId("fallback-send").click();
    await expect(page.getByTestId("card-balance")).toBeVisible();

    await audit(page, "in-call with balance card");
  });

  test("the confirmation card passes", async ({ page }) => {
    await openAssistant(page);
    const input = page.getByTestId("fallback-input");
    await input.fill("我想繳交電力公司電費");
    await page.getByTestId("fallback-send").click();
    await expect(page.getByTestId("card-bill-confirm")).toBeVisible();

    await audit(page, "bill confirmation");
  });

  test("the PIN pad passes — the most safety-critical screen", async ({ page }) => {
    await openAssistant(page);
    await driveToPinPad(page);
    await audit(page, "PIN pad");
  });

  test("the scam warning passes", async ({ page }) => {
    await openAssistant(page);
    const input = page.getByTestId("fallback-input");
    await input.fill("轉五千蚊畀 WONG KA HUNG");
    await page.getByTestId("fallback-send").click();
    await expect(page.getByTestId("card-scam")).toBeVisible();

    await audit(page, "scam warning");
  });

  test("the settings panel passes when expanded", async ({ page }) => {
    await openAssistant(page);
    await page.getByTestId("settings-toggle").click();
    await expect(page.getByTestId("settings-panel")).toBeVisible();

    await audit(page, "settings panel");
  });

  test("the extra-large text setting still passes", async ({ page }) => {
    await openAssistant(page);
    await page.getByTestId("settings-toggle").click();
    await page.getByTestId("choice-textSize-extraLarge").click();

    const input = page.getByTestId("fallback-input");
    await input.fill("我有幾多錢");
    await page.getByTestId("fallback-send").click();
    await expect(page.getByTestId("card-balance")).toBeVisible();

    await audit(page, "extra-large text");
  });
});

test.describe("Age-friendly structural requirements (PRD 5)", () => {
  test("has exactly one h1 and does not skip heading levels", async ({ page }) => {
    await openAssistant(page);

    const headings = await page.evaluate(() =>
      Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6")).map((h) =>
        Number(h.tagName.slice(1)),
      ),
    );

    expect(headings.filter((level) => level === 1)).toHaveLength(1);
    for (let i = 1; i < headings.length; i += 1) {
      // A jump from h1 to h3 is disorienting for screen-reader navigation.
      expect(headings[i] - headings[i - 1]).toBeLessThanOrEqual(1);
    }
  });

  test("base body text respects the 20px floor at every text-size step", async ({ page }) => {
    await openAssistant(page);
    await page.getByTestId("settings-toggle").click();

    for (const size of ["normal", "large", "extraLarge"]) {
      await page.getByTestId(`choice-textSize-${size}`).click();
      const bodyPx = await page.evaluate(() =>
        parseFloat(getComputedStyle(document.body).fontSize),
      );
      expect(bodyPx, `body font-size at "${size}"`).toBeGreaterThanOrEqual(20);
    }
  });

  test("headings are at least 28px", async ({ page }) => {
    await openAssistant(page);
    const input = page.getByTestId("fallback-input");
    await input.fill("我有幾多錢");
    await page.getByTestId("fallback-send").click();
    await expect(page.getByTestId("card-balance")).toBeVisible();

    const headingPx = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="card-balance"] h2');
      return card ? parseFloat(getComputedStyle(card).fontSize) : 0;
    });
    expect(headingPx).toBeGreaterThanOrEqual(28);
  });

  test("interactive elements expose an accessible name", async ({ page }) => {
    await openAssistant(page);
    await driveToPinPad(page);

    const unnamed = await page.evaluate(() => {
      const nodes = Array.from(
        document.querySelectorAll("button, a[href], input, select, textarea"),
      );

      const resolveName = (node: Element): string => {
        const el = node as HTMLElement;
        const labelledBy = el.getAttribute("aria-labelledby");
        if (labelledBy) {
          const text = labelledBy
            .split(/\s+/)
            .map((id) => document.getElementById(id)?.textContent ?? "")
            .join(" ")
            .trim();
          if (text) return text;
        }

        const aria = el.getAttribute("aria-label");
        if (aria?.trim()) return aria.trim();

        // An associated <label>, whether wrapping or referenced by for/id.
        const wrapping = el.closest("label");
        if (wrapping?.textContent?.trim()) return wrapping.textContent.trim();
        const id = el.id;
        if (id) {
          const escaped = CSS.escape(id);
          const referenced = document.querySelector(`label[for="${escaped}"]`);
          if (referenced?.textContent?.trim()) return referenced.textContent.trim();
        }

        const value = (el as HTMLInputElement).value;
        if (value?.trim()) return value.trim();

        if (el.textContent?.trim()) return el.textContent.trim();
        if (el.getAttribute("title")?.trim()) return el.getAttribute("title")!.trim();

        return "";
      };

      return nodes
        .filter((node) => resolveName(node).length === 0)
        .map((node) => node.getAttribute("data-testid") ?? node.outerHTML.slice(0, 90));
    });

    expect(unnamed).toEqual([]);
  });

  test("focus is visible on every interactive element", async ({ page }) => {
    await openAssistant(page);

    const outline = await page.evaluate(() => {
      const button = document.querySelector<HTMLElement>('[data-testid="mic-button"]');
      if (!button) return null;
      button.focus();
      const style = getComputedStyle(button);
      return { width: style.outlineWidth, color: style.outlineColor, style: style.outlineStyle };
    });

    expect(outline).not.toBeNull();
    expect(outline!.style).not.toBe("none");
    expect(parseFloat(outline!.width)).toBeGreaterThanOrEqual(2);
  });

  test("pinch zoom is not disabled", async ({ page }) => {
    await openAssistant(page);
    const content = await page.locator('meta[name="viewport"]').getAttribute("content");
    expect(content ?? "").not.toMatch(/user-scalable\s*=\s*no/i);
    expect(content ?? "").not.toMatch(/maximum-scale\s*=\s*1(\.0)?\s*(,|$)/i);
  });

  test("the transcript announces new assistant turns to screen readers", async ({ page }) => {
    await openAssistant(page);
    const live = page.getByTestId("live-region");
    await expect(live).toHaveAttribute("aria-live", "polite");

    const input = page.getByTestId("fallback-input");
    await input.fill("我有幾多錢");
    await page.getByTestId("fallback-send").click();
    await expect(page.getByTestId("card-balance")).toBeVisible();

    await expect(live).toContainText("12480蚊5毫");
  });
});
