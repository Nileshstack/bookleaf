import {
  test as base,
  expect,
  type Browser,
  type Page,
} from "@playwright/test";
import { mkdirSync, appendFileSync } from "node:fs";
import { FAKE_AI_URL } from "../playwright.config";

export { expect };

export const SHOTS = "../qa-screenshots";
mkdirSync(SHOTS, { recursive: true });

export const PASSWORD = "Author@123";
export const ADMIN = { email: "admin@bookleaf.com", password: "Admin@123" };

/**
 * Browser noise that is expected and not a defect:
 * - 401 from /auth/me while signed out (how the app learns there is no session),
 * - 401 from /auth/login in the wrong-password test,
 * - 503 from /draft while the AI is deliberately down.
 * Anything else logged as an error or warning fails the test.
 */
const EXPECTED = [/\/api\/v1\/auth\/me/, /\/api\/v1\/auth\/login/, /\/draft/];

/** Marks a failed request as expected for the current test only (e.g. a deliberate 404). */
export const allowConsole = (url: RegExp) =>
  base
    .info()
    .annotations.push({ type: "allow-console", description: url.source });

type ConsoleIssue = { type: string; text: string; url: string; page: string };

export const test = base.extend<{ consoleIssues: ConsoleIssue[] }>({
  consoleIssues: [
    async ({ page }, use, testInfo) => {
      const issues: ConsoleIssue[] = [];
      page.on("console", (msg) => {
        if (msg.type() !== "error" && msg.type() !== "warning") return;
        const url = msg.location().url ?? "";
        const allowed = [
          ...EXPECTED,
          ...testInfo.annotations
            .filter((a) => a.type === "allow-console")
            .map((a) => new RegExp(a.description ?? "^$")),
        ];
        const expected =
          msg.text().startsWith("Failed to load resource") &&
          allowed.some((re) => re.test(url));
        if (!expected)
          issues.push({
            type: msg.type(),
            text: msg.text(),
            url,
            page: page.url(),
          });
      });
      page.on("pageerror", (err) =>
        issues.push({
          type: "pageerror",
          text: err.message,
          url: "",
          page: page.url(),
        }),
      );
      await use(issues);
      appendFileSync(
        "../qa/console-log.jsonl",
        `${JSON.stringify({ test: testInfo.title, issues })}\n`,
      );
      expect(issues, "console errors/warnings on the page").toEqual([]);
    },
    { auto: true }, // every test checks the console
  ],
});

export const shot = (page: Page, name: string) =>
  page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true });

export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/(author|admin)\//);
}

/** A second, independent browser session (e.g. admin next to an author). */
export async function newSession(
  browser: Browser,
  email: string,
  password = PASSWORD,
) {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  const page = await context.newPage();
  await login(page, email, password);
  return { context, page };
}

export async function setAi(mode: "up" | "down") {
  await fetch(`${FAKE_AI_URL}/__qa/mode`, {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
}

/** Waits until the SSE connection shows as live in the sidebar. */
export const waitForLive = (page: Page) =>
  expect(page.getByText(/live updates connected/i).first()).toBeVisible({
    timeout: 15_000,
  });
