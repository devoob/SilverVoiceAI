import { test, expect, type Page } from "@playwright/test";

const STUB = "./e2e/speech-stub.js";
const PIN = "123456";

/**
 * Utterances are fed one at a time and each stage is asserted before the next
 * line is spoken. Pre-queueing a whole conversation is racy: the stub resolves
 * synthesis in ~10ms, so every turn completes before the first assertion polls
 * and the transient card under test has already been replaced.
 */
async function openAssistant(page: Page) {
  await page.addInitScript({ path: STUB });
  await page.goto("/");
}

async function startCall(page: Page) {
  await page.getByTestId("mic-button").click();
  await expect(page.getByTestId("end-call")).toBeVisible();
}

async function say(page: Page, text: string) {
  await page.evaluate((line) => window.__SV_SAY__(line), text);
}

async function enterPin(page: Page, pin: string) {
  for (const digit of pin) {
    await page.getByTestId(`pin-key-${digit}`).click();
  }
}

async function spoken(page: Page): Promise<string> {
  const lines = await page.evaluate(() => window.__SV_SPOKEN__);
  return lines.join("\n");
}

async function typeInto(page: Page, text: string) {
  await page.getByTestId("fallback-input").fill(text);
  await page.getByTestId("fallback-send").click();
}

test.describe("PRD Journey 1 + 2 — a complete Cantonese voice call", () => {
  test("balance and savings advice, then an electricity bill paid by voice", async ({ page }) => {
    await openAssistant(page);
    await startCall(page);

    // Journey 1: a single utterance gets both the balance and the advice.
    await say(page, "我有幾多錢喺入面？可唔可以畀少少儲錢建議我？");
    await expect(page.getByTestId("card-balance")).toBeVisible();
    await expect(page.getByTestId("card-balance")).toContainText("12,480.50");
    await expect(page.getByTestId("card-balance")).toContainText("4821");
    expect(await spoken(page)).toContain("12480蚊5毫");

    // Journey 2: the CLP bill is proposed with its amount.
    await say(page, "我想繳交電力公司電費。");
    await expect(page.getByTestId("card-bill-confirm")).toBeVisible();
    await expect(page.getByTestId("card-bill-confirm")).toContainText("450.00");
    expect(await spoken(page)).toContain("450蚊");

    // The spoken confirmation reaches the PIN gate — not a payment.
    await say(page, "係，幫我交啦。");
    await expect(page.getByTestId("pin-pad")).toBeVisible();
    expect(page.getByTestId("card-receipt")).toHaveCount(0);
    expect(await spoken(page)).toContain("六位數保安密碼");

    await enterPin(page, PIN);

    await expect(page.getByTestId("card-receipt")).toBeVisible();
    await expect(page.getByTestId("card-receipt")).toContainText("450.00");
    // 12,480.50 - 450.00
    await expect(page.getByTestId("card-receipt")).toContainText("12,030.50");

    // Every user turn persisted as large text — the dual-feedback requirement.
    await expect(page.getByTestId("turn-user")).toHaveCount(3);
    await expect(page.getByTestId("turn-user").first()).toContainText("我有幾多錢");
  });
});

test.describe("PRD Journey 3 — FPS peer-to-peer transfer", () => {
  test("transfers $200 to Mrs Chan after confirmation and PIN", async ({ page }) => {
    await openAssistant(page);
    await startCall(page);

    await say(page, "幫我轉 $200 畀陳太太。");
    await expect(page.getByTestId("card-transfer-confirm")).toBeVisible();
    await expect(page.getByTestId("card-transfer-confirm")).toContainText("200.00");
    await expect(page.getByTestId("card-transfer-confirm")).toContainText("陳太太");

    await say(page, "係");
    await expect(page.getByTestId("pin-pad")).toBeVisible();

    await enterPin(page, PIN);

    await expect(page.getByTestId("card-receipt")).toBeVisible();
    await expect(page.getByTestId("card-receipt")).toContainText("陳太太");
    // 12,480.50 - 200.00
    await expect(page.getByTestId("card-receipt")).toContainText("12,280.50");

    const lines = await spoken(page);
    expect(lines).toContain("200蚊");
    expect(lines).toContain("搞掂");
  });

  test("asks how much to send when the amount is not spoken", async ({ page }) => {
    await openAssistant(page);
    await startCall(page);

    await say(page, "轉錢畀陳太太");
    // Wait for the card before asserting on speech: `expect(...).toContain`
    // does not retry, so reading spoken() immediately would race the turn.
    await expect(page.getByTestId("card-transfer-confirm")).toBeVisible();
    expect(await spoken(page)).toContain("幾多錢");

    await say(page, "兩百蚊");
    await expect(page.getByTestId("card-transfer-confirm")).toContainText("200.00");

    await say(page, "係");
    await expect(page.getByTestId("pin-pad")).toBeVisible();
  });
});

test.describe("PRD 6 — safety guardrails under a live call", () => {
  test("a large transfer to an unknown payee is interrupted before the PIN", async ({ page }) => {
    await openAssistant(page);
    await startCall(page);

    await say(page, "轉五千蚊畀 WONG KA HUNG");
    await expect(page.getByTestId("card-scam")).toBeVisible();
    await expect(page.getByTestId("card-scam")).toContainText("WONG KA HUNG");
    expect(page.getByTestId("pin-pad")).toHaveCount(0);
    expect(await spoken(page)).toContain("18222");

    // Choosing to stop returns to idle and states that nothing moved.
    await say(page, "停一停，我要諗一諗");
    await expect(page.getByTestId("card-scam")).toHaveCount(0);
    expect(await spoken(page)).toContain("冇郁過");
    expect(page.getByTestId("card-receipt")).toHaveCount(0);
  });

  test("a spoken PIN can never authorise a payment", async ({ page }) => {
    await openAssistant(page);
    await startCall(page);

    await say(page, "幫我轉 $200 畀陳太太。");
    await say(page, "係");
    await expect(page.getByTestId("pin-pad")).toBeVisible();

    // The microphone is closed while the pad is open, so the spoken PIN is
    // never even heard — a stronger guarantee than hearing it and refusing.
    await say(page, PIN);
    await page.waitForTimeout(1200);
    expect(await page.evaluate(() => window.__SV_QUEUE__)).toContain(PIN);
    expect(page.getByTestId("card-receipt")).toHaveCount(0);

    // Tapping the same digits does complete it, proving the pad — not the
    // voice channel — is the only thing standing between them.
    await enterPin(page, PIN);
    await expect(page.getByTestId("card-receipt")).toBeVisible();
  });

  test("the microphone never re-arms while the PIN pad is open", async ({ page }) => {
    await openAssistant(page);
    await startCall(page);

    await say(page, "幫我轉 $200 畀陳太太。");
    await say(page, "係");
    await expect(page.getByTestId("pin-pad")).toBeVisible();

    const before = await page.evaluate(() => window.__SV_STATS__.started);
    // Far longer than the 350ms re-arm delay.
    await page.waitForTimeout(1500);
    const after = await page.evaluate(() => window.__SV_STATS__.started);

    expect(after).toBe(before);
  });

  test("a coercion script is intercepted before any intent is acted on", async ({ page }) => {
    await openAssistant(page);
    await startCall(page);

    await say(page, "公安叫我立即轉錢去安全賬戶，唔好同屋企人講");

    await expect(page.getByTestId("card-handover")).toBeVisible();
    expect(await spoken(page)).toContain("18222");
    expect(page.getByTestId("card-receipt")).toHaveCount(0);
  });
});

test.describe("resilience and alternatives to voice", () => {
  test("the text fallback completes a whole bill payment with no microphone", async ({ page }) => {
    await openAssistant(page);

    await typeInto(page, "我想繳交電力公司電費");
    await expect(page.getByTestId("card-bill-confirm")).toBeVisible();

    await typeInto(page, "係");
    await expect(page.getByTestId("pin-pad")).toBeVisible();

    await enterPin(page, PIN);
    await expect(page.getByTestId("card-receipt")).toBeVisible();
    await expect(page.getByTestId("card-receipt")).toContainText("12,030.50");
  });

  test("a wrong PIN is rejected on screen and can be retried", async ({ page }) => {
    await openAssistant(page);

    await typeInto(page, "我想繳交電力公司電費");
    await page.getByTestId("confirm-yes").click();
    await expect(page.getByTestId("pin-pad")).toBeVisible();

    await enterPin(page, "000000");

    await expect(page.getByTestId("pin-error")).toBeVisible();
    await expect(page.getByTestId("pin-error")).toContainText("唔啱");
    // Still on the pad, so the user retries rather than losing the transaction.
    await expect(page.getByTestId("pin-pad")).toBeVisible();
    expect(page.getByTestId("card-receipt")).toHaveCount(0);

    await enterPin(page, PIN);
    await expect(page.getByTestId("card-receipt")).toBeVisible();
  });

  test("cancelling reassures the user that no money moved", async ({ page }) => {
    await openAssistant(page);

    await typeInto(page, "幫我轉 $200 畀陳太太");
    await expect(page.getByTestId("card-transfer-confirm")).toBeVisible();

    await page.getByTestId("confirm-no").click();

    expect(await spoken(page)).toContain("冇郁過");
    expect(page.getByTestId("card-receipt")).toHaveCount(0);
    expect(page.getByTestId("pin-pad")).toHaveCount(0);
  });

  test("the handover button is always one tap away", async ({ page }) => {
    await openAssistant(page);

    await page.getByTestId("header-handover").click();

    await expect(page.getByTestId("card-handover")).toBeVisible();
    await expect(page.getByTestId("call-hotline")).toBeVisible();
    await expect(page.getByTestId("call-family")).toBeVisible();

    await page.getByTestId("resume-assistant").click();
    await expect(page.getByTestId("card-handover")).toHaveCount(0);
  });

  test("the conversation survives an environment with no TTS voices", async ({ page }) => {
    // Keep the recognition stub but drop the synthesis stub, so the app uses
    // the real (voiceless) headless speechSynthesis. Without the watchdog in
    // lib/speech.ts this hangs after the first spoken reply — the single most
    // likely way to freeze a live demo.
    await page.addInitScript({ path: STUB });
    await page.addInitScript(() => {
      delete window.__SILVERVOICE_SYNTHESIS__;
    });
    await page.goto("/");

    await typeInto(page, "我想繳交電力公司電費");
    await expect(page.getByTestId("card-bill-confirm")).toBeVisible({ timeout: 15_000 });

    await typeInto(page, "係");
    await expect(page.getByTestId("pin-pad")).toBeVisible({ timeout: 15_000 });

    await enterPin(page, PIN);
    await expect(page.getByTestId("card-receipt")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("card-receipt")).toContainText("12,030.50");
  });

  test("resetting the demo restores the opening balance", async ({ page }) => {
    await openAssistant(page);

    await typeInto(page, "我想繳交電力公司電費");
    await page.getByTestId("confirm-yes").click();
    await enterPin(page, PIN);
    await expect(page.getByTestId("card-receipt")).toContainText("12,030.50");

    await page.getByTestId("reset-demo").click();
    await typeInto(page, "我有幾多錢");
    await expect(page.getByTestId("card-balance")).toContainText("12,480.50");
  });
});

test.describe("trilingual operation", () => {
  test("switching to English re-runs a journey in English", async ({ page }) => {
    await openAssistant(page);

    await page.getByTestId("settings-toggle").click();
    await page.getByTestId("choice-language-english").click();
    await expect(page.getByTestId("locale-badge")).toContainText("en-HK");

    await typeInto(page, "I want to pay my CLP electricity bill");
    await expect(page.getByTestId("card-bill-confirm")).toBeVisible();
    await expect(page.getByTestId("confirm-yes")).toContainText("Yes, confirm");

    await page.getByTestId("confirm-yes").click();
    await expect(page.getByTestId("pin-pad")).toContainText("6-digit security PIN");

    await enterPin(page, PIN);
    await expect(page.getByTestId("card-receipt")).toContainText("450.00");
    expect(await spoken(page)).toContain("450 dollars");
  });

  test("switching to Putonghua localises the same journey", async ({ page }) => {
    await openAssistant(page);

    await page.getByTestId("settings-toggle").click();
    await page.getByTestId("choice-language-putonghua").click();

    await typeInto(page, "用转数快转两百元给陈太太");
    await expect(page.getByTestId("card-transfer-confirm")).toBeVisible();
    await expect(page.getByTestId("card-transfer-confirm")).toContainText("陈太太");
    await expect(page.getByTestId("confirm-yes")).toContainText("是，确认");
  });

  test("the html lang attribute follows the spoken language", async ({ page }) => {
    await openAssistant(page);
    await expect(page.locator("html")).toHaveAttribute("lang", "zh-HK");

    await page.getByTestId("settings-toggle").click();
    await page.getByTestId("choice-language-english").click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en-HK");
  });
});

test.describe("age-friendly display controls", () => {
  test("text size, rate and pitch are adjustable in discrete steps", async ({ page }) => {
    await openAssistant(page);

    await page.getByTestId("settings-toggle").click();

    const readScale = () =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--text-scale").trim(),
      );

    expect(await readScale()).toBe("1");

    await page.getByTestId("choice-textSize-extraLarge").click();
    expect(Number(await readScale())).toBeGreaterThan(1);

    // The PRD's 20px floor must hold at every step.
    const bodyPx = await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize));
    expect(bodyPx).toBeGreaterThanOrEqual(20);

    await page.getByTestId("choice-speechRate-0.7").click();
    await page.getByTestId("voice-preview").click();
    await expect
      .poll(async () => (await page.evaluate(() => window.__SV_SPOKEN__)).length)
      .toBeGreaterThan(0);
  });

  test("every primary control clears the 64px tap-target minimum", async ({ page }) => {
    await openAssistant(page);

    const sizes = await page.evaluate(() => {
      const selectors = [
        '[data-testid="mic-button"]',
        '[data-testid="header-handover"]',
        '[data-testid="settings-toggle"]',
        '[data-testid="fallback-input"]',
        '[data-testid="fallback-send"]',
      ];
      return selectors.map((selector) => {
        const element = document.querySelector(selector);
        const rect = element?.getBoundingClientRect();
        return { selector, width: rect?.width ?? 0, height: rect?.height ?? 0 };
      });
    });

    for (const { selector, width, height } of sizes) {
      expect(width, `${selector} width`).toBeGreaterThanOrEqual(64);
      expect(height, `${selector} height`).toBeGreaterThanOrEqual(64);
    }
  });

  test("PIN keys are at least 88px tall for arthritic or trembling hands", async ({ page }) => {
    await openAssistant(page);

    await typeInto(page, "我想繳交電力公司電費");
    await page.getByTestId("confirm-yes").click();
    await expect(page.getByTestId("pin-pad")).toBeVisible();

    const height = await page
      .getByTestId("pin-key-1")
      .evaluate((el) => el.getBoundingClientRect().height);
    expect(height).toBeGreaterThanOrEqual(88);
  });
});
