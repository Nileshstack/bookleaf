import { ADMIN, expect, newSession, shot, test, waitForLive } from "./fixtures";
import { API_URL } from "../playwright.config";

/**
 * Two browsers side by side, as in production: an author and an admin.
 * Nothing is reloaded; every update must arrive over SSE.
 */
test.describe("Real-time flow (two browser contexts)", () => {
  test("ticket → shimmer → classified → reply → status → author reply → note stays private", async ({
    browser,
  }) => {
    test.setTimeout(120_000);
    const author = await newSession(browser, "rohit.kapoor@email.com");
    const admin = await newSession(browser, ADMIN.email, ADMIN.password);
    const issues: string[] = [];
    for (const p of [author.page, admin.page]) {
      p.on("console", (m) => {
        if (
          (m.type() === "error" || m.type() === "warning") &&
          !/Failed to load resource.*/.test(m.text())
        )
          issues.push(m.text());
      });
      p.on("pageerror", (e) => issues.push(e.message));
    }

    await admin.page.goto("/admin/tickets");
    await waitForLive(admin.page);

    // 1. Author raises a ticket.
    await author.page.goto("/author/tickets/new");
    await waitForLive(author.page);
    await author.page
      .getByLabel("Which book is this about?")
      .selectOption({ label: "Code & Karma" });
    await author.page
      .getByLabel("Subject")
      .fill("Code & Karma not available on Flipkart");
    await author.page
      .getByLabel("Description")
      .fill(
        "Since Monday Code & Karma shows out of stock on Flipkart, but readers can still buy it on Amazon.",
      );
    await author.page.getByRole("button", { name: "Submit ticket" }).click();
    await expect(author.page).toHaveURL(/\/author\/tickets\/BL-\d{4}$/);
    const ticketNumber = author.page.url().split("/").at(-1)!;

    // 2. Admin queue: new row appears live with the shimmer, then the AI's labels.
    const row = admin.page.getByRole("row").filter({ hasText: ticketNumber });
    await expect(row).toBeVisible();
    await expect(row.getByText("AI classifying…")).toBeVisible();
    await shot(admin.page, "04-realtime-queue-shimmer");
    await expect(row).toContainText("Distribution & Availability", {
      timeout: 15_000,
    });
    await expect(row.getByText("AI classifying…")).toHaveCount(0);
    await shot(admin.page, "04-realtime-queue-classified");

    // 3. Admin opens it and replies; the author sees it without reloading.
    await row.getByRole("link").click();
    await expect(admin.page).toHaveURL(
      new RegExp(`/admin/tickets/${ticketNumber}$`),
    );
    const reply = admin.page.getByLabel("Reply to Rohit");
    await expect(reply).toHaveValue(/^Hi Rohit,/, { timeout: 15_000 });
    await reply.fill(
      "Hi Rohit,\n\nWe have triggered a stock re-sync with Flipkart; it should be back within 24–48 hours.\n\nWarm regards,\nTeam BookLeaf",
    );
    await admin.page.getByRole("button", { name: "Send reply" }).click();

    const conversation = author.page.getByRole("log", { name: "Conversation" });
    await expect(conversation).toContainText(
      "triggered a stock re-sync with Flipkart",
    );
    await shot(author.page, "04-realtime-author-sees-reply");

    // 4. Status change reaches the author live.
    const controls = admin.page.getByRole("complementary", {
      name: "Ticket controls and internal notes",
    });
    await controls.getByLabel("Status").selectOption("Resolved");
    await expect(author.page.getByText(/^Status: Resolved./)).toBeVisible();

    // 5. Internal note: never reaches the author, now or after a reload.
    await controls
      .getByLabel("New internal note")
      .fill("SECRET-NOTE: Flipkart feed was paused by ops on Monday.");
    await controls.getByRole("button", { name: "Add note" }).click();
    await expect(controls).toContainText("SECRET-NOTE");

    // 6. The author replies (re-opening the resolved ticket); the admin sees it live.
    await author.page
      .getByLabel("Reply to the BookLeaf team")
      .fill("Thanks! It is showing in stock again now.");
    await author.page.getByRole("button", { name: "Send reply" }).click();
    await expect(
      admin.page.getByRole("log", { name: "Conversation with the author" }),
    ).toContainText("showing in stock again");
    await shot(admin.page, "04-realtime-admin-sees-author-reply");

    await author.page.waitForTimeout(1500); // give any (wrong) note event time to arrive
    await expect(author.page.getByRole("main")).not.toContainText(
      "SECRET-NOTE",
    );
    await author.page.reload();
    await expect(conversation).toContainText("showing in stock again");
    await expect(author.page.getByRole("main")).not.toContainText(
      "SECRET-NOTE",
    );
    await expect(author.page.getByRole("main")).not.toContainText(
      /confidence|AI suggested|Rule-based|internal/i,
    );

    // Another author's live session never sees Rohit's ticket.
    const other = await newSession(browser, "priya.sharma@email.com");
    await other.page.goto("/author/tickets");
    await expect(other.page.getByText(ticketNumber)).toHaveCount(0);

    expect(issues, "console errors in either browser").toEqual([]);
    await Promise.all([
      author.context.close(),
      admin.context.close(),
      other.context.close(),
    ]);
  });

  test("SSE stream is authenticated and scoped", async ({ request }) => {
    const anon = await request.get(`${API_URL}/api/v1/tickets/stream`);
    expect(anon.status()).toBe(401);
    const login = await request.post(`${API_URL}/api/v1/auth/login`, {
      data: { email: "rohit.kapoor@email.com", password: "Author@123" },
    });
    const token = (await login.json()).data.token;
    const adminStream = await request.get(
      `${API_URL}/api/v1/admin/tickets/stream`,
      { headers: { authorization: `Bearer ${token}` } },
    );
    expect(adminStream.status()).toBe(403);
  });
});
