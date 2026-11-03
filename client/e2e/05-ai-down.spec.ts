import {
  ADMIN,
  expect,
  login,
  newSession,
  setAi,
  shot,
  test,
} from "./fixtures";

/**
 * The fake upstream answers 401 like a revoked key. Support must keep
 * working: tickets are accepted and rule-triaged, the draft panel offers a
 * template, and a manual reply goes out.
 */
test.describe("AI down (upstream rejects the key)", () => {
  test.beforeAll(() => setAi("down"));
  test.afterAll(async () => {
    await setAi("up");
    await new Promise((r) => setTimeout(r, 2500)); // let the 2 s breaker cooldown pass
  });

  test("new tickets fall back to rules; the queue labels them", async ({
    page,
    browser,
  }) => {
    const author = await newSession(browser, "vikram.joshi@email.com");
    await author.page.goto("/author/tickets/new");
    await author.page
      .getByLabel("Subject")
      .fill("Blurry images in my author copies");
    await author.page
      .getByLabel("Description")
      .fill(
        "The photos on pages 12 to 20 are blurry and the print looks faded in all 5 author copies.",
      );
    await author.page.getByRole("button", { name: "Submit ticket" }).click();
    await expect(author.page).toHaveURL(/\/author\/tickets\/BL-\d{4}$/); // accepted at once
    const ticketNumber = author.page.url().split("/").at(-1)!;
    await author.context.close();

    await login(page, ADMIN.email, ADMIN.password);
    await page.goto("/admin/tickets");
    const row = page.getByRole("row").filter({ hasText: ticketNumber });
    await expect(row.getByText("Rule-based fallback")).toBeVisible({
      timeout: 15_000,
    });
    await expect(row).toContainText("Printing & Quality");
    await shot(page, "05-ai-down-queue-rule-based");
  });

  test("draft panel: banner, insert template, send manually", async ({
    page,
  }) => {
    await login(page, ADMIN.email, ADMIN.password);
    await page.goto("/admin/tickets/BL-0004");
    await expect(page.getByText("AI unavailable: write manually")).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      page.getByText("AI drafting is unavailable. You can still reply."),
    ).toBeVisible();
    await shot(page, "05-ai-down-banner");

    await page.getByRole("button", { name: "Insert template" }).click();
    const reply = page.getByLabel("Reply to Sneha");
    await expect(reply).toHaveValue(/^Hi Sneha,[\s\S]*Team BookLeaf$/);
    await expect(
      page.getByText(
        "AI drafting is unavailable. Template inserted: fill in the [bracketed] parts.",
      ),
    ).toBeVisible();

    // Unfilled template gaps never reach the author.
    await page.getByRole("button", { name: "Send reply" }).click();
    await expect(
      page.getByText("Fill in or remove the [bracketed] parts"),
    ).toBeVisible();
    await expect(
      page.getByRole("log", { name: "Conversation with the author" }),
    ).not.toContainText("[");

    const text = (await reply.inputValue()).replace(
      /\[[^\]]*\]/g,
      "the second cover draft",
    );
    await reply.fill(text);
    await page.getByRole("button", { name: "Send reply" }).click();
    await expect(page.getByText("Reply sent to Sneha").first()).toBeVisible();
    await expect(
      page.getByRole("log", { name: "Conversation with the author" }),
    ).toContainText("the second cover draft");
    await shot(page, "05-ai-down-manual-reply-sent");
  });
});
