import AxeBuilder from "@axe-core/playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { ADMIN, expect, login, shot, test } from "./fixtures";

const AUTHOR_PAGES = [
  "/author/dashboard",
  "/author/books",
  "/author/tickets",
  "/author/tickets/new",
  "/author/tickets/BL-0004",
];
const ADMIN_PAGES = [
  "/admin/dashboard",
  "/admin/tickets",
  "/admin/tickets/BL-0003",
];

/** Pixels of horizontal overflow, plus the widest offenders to make a failure actionable. */
const noHorizontalScroll = async (page: import("@playwright/test").Page) => {
  const { overflow, offenders } = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const offenders = [...document.querySelectorAll("body *")]
      .filter((el) => el.getBoundingClientRect().right > width + 1)
      .slice(0, 5)
      .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)}`);
    return { overflow: document.documentElement.scrollWidth - width, offenders };
  });
  if (overflow > 0) console.info("overflowing elements:", offenders); // eslint-disable-line no-console
  return overflow;
};

for (const width of [375, 1280]) {
  test.describe(`Responsive at ${width}px`, () => {
    test.use({ viewport: { width, height: width === 375 ? 812 : 800 } });

    test("author pages fit without horizontal scrolling", async ({ page }) => {
      await page.goto("/login");
      expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
      await shot(page, `06-${width}-login`);
      await login(page, "sneha.kulkarni@email.com");
      for (const path of AUTHOR_PAGES) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect(
          await noHorizontalScroll(page),
          `${path} overflows`,
        ).toBeLessThanOrEqual(0);
        await shot(page, `06-${width}${path.replaceAll("/", "-")}`);
      }
    });

    test("admin pages fit without horizontal scrolling", async ({ page }) => {
      await login(page, ADMIN.email, ADMIN.password);
      for (const path of ADMIN_PAGES) {
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
        expect(
          await noHorizontalScroll(page),
          `${path} overflows`,
        ).toBeLessThanOrEqual(0);
        await shot(page, `06-${width}${path.replaceAll("/", "-")}`);
      }
    });
  });
}

test.describe("Accessibility (axe-core, WCAG 2.1 A/AA)", () => {
  const results: Record<
    string,
    {
      id: string;
      impact: string | null | undefined;
      help: string;
      nodes: number;
      sample: string;
    }[]
  > = {};
  // Merged into the file per page, so a worker restart after a failure keeps earlier results.
  const save = () => {
    let previous = {};
    try {
      previous = JSON.parse(readFileSync("../qa/a11y-results.json", "utf8"));
    } catch {}
    writeFileSync(
      "../qa/a11y-results.json",
      `${JSON.stringify({ ...previous, ...results }, null, 2)}\n`,
    );
  };

  const audit = async (page: import("@playwright/test").Page, name: string) => {
    await page.waitForTimeout(800); // let data and charts render
    const { violations } = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    results[name] = violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      help: v.help,
      nodes: v.nodes.length,
      sample: v.nodes[0]?.target.join(" ") ?? "",
    }));
    save();
    return violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
  };

  test("login", async ({ page }) => {
    await page.goto("/login");
    expect(await audit(page, "/login")).toEqual([]);
  });

  test("author pages", async ({ page }) => {
    await login(page, "sneha.kulkarni@email.com");
    for (const path of AUTHOR_PAGES) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await audit(page, path), path).toEqual([]);
    }
  });

  test("admin pages", async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.password);
    for (const path of ADMIN_PAGES) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(await audit(page, path), path).toEqual([]);
    }
  });

  test("keyboard: skip link and visible focus", async ({ page }) => {
    await login(page, "sneha.kulkarni@email.com");
    await page.goto("/author/dashboard");
    // The shell renders behind the client auth gate; Tab before that lands nowhere.
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);
  });
});
