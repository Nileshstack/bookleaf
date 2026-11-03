import { allowConsole, expect, login, shot, test } from "./fixtures";

test.describe("Author portal", () => {
  test("dashboard: summary from Sneha's real records", async ({ page }) => {
    await login(page, "sneha.kulkarni@email.com");
    const summary = page.getByRole("region", { name: "Summary" });
    await expect(summary).toContainText("Total books3");
    await expect(summary).toContainText("2 published · 1 in production");
    await expect(summary).toContainText("2,290");
    await expect(summary).toContainText("₹60,865");
    await expect(summary).toContainText("₹53,000 paid out so far");
    await expect(summary).toContainText("₹7,865");
    await expect(
      page.getByRole("link", { name: /^BL-0004 In Progress/ }),
    ).toBeVisible();
    await shot(page, "02-author-dashboard");
  });

  test("books: in-production book shows the stepper and dashes, never fake zeros", async ({
    page,
  }) => {
    await login(page, "sneha.kulkarni@email.com");
    await page.getByRole("link", { name: "My books" }).click();
    await expect(
      page.getByRole("heading", { name: "My books", level: 1 }),
    ).toBeVisible();

    const stages = page.getByRole("list", { name: "Production stages" });
    await expect(stages.getByRole("listitem")).toHaveCount(9);
    await expect(
      stages.getByText("Cover Design (current stage)"),
    ).toBeVisible();
    await expect(stages.getByText("Editing (completed)")).toBeVisible();
    await expect(stages.getByText("Typesetting (upcoming)")).toBeVisible();

    // The in-production card: MRP and dates are dashes with an explanation; no royalty figures.
    const mysore = page.locator("[aria-labelledby]").filter({
      has: page.getByRole("heading", { name: "Midnight in Mysore" }),
    });
    await expect(mysore).toContainText("—");
    await expect(mysore).toContainText(
      "Not available until the book is published",
    );
    await expect(mysore).not.toContainText("₹");
    await expect(mysore).not.toContainText("Copies sold");

    // Published books: real figures.
    await expect(page.getByText("₹3,690 is pending.")).toBeVisible();
    await shot(page, "02-author-books-sneha");
  });

  test("books: Ananya's never-paid book explains the first payout", async ({
    page,
  }) => {
    await login(page, "ananya.reddy@email.com");
    await page.goto("/author/books");
    await expect(
      page.getByText("₹2,546 is pending. This will be your first payout.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("definition").filter({ hasText: /^₹0$/ }),
    ).toBeVisible(); // paid ₹0 is a real zero
    await shot(page, "02-author-books-ananya-first-payout");
  });

  test("books: Kavita's balance below ₹1,000 explains the rollover", async ({
    page,
  }) => {
    await login(page, "kavita.deshmukh@email.com");
    await page.goto("/author/books");
    await expect(
      page.getByText(
        /₹850 is below the ₹1,000 minimum payout, so it rolls over/,
      ),
    ).toBeVisible();
  });

  test("new ticket: validation, General option, book preselect, file chips, submit", async ({
    page,
  }) => {
    await login(page, "sneha.kulkarni@email.com");
    await page.goto("/author/tickets/new");

    const book = page.getByLabel("Which book is this about?");
    await expect(book.locator("option")).toHaveText([
      "General / Account level",
      "Ctrl+Alt+Delete My Ex",
      "The Algorithm of Love",
      "Midnight in Mysore (in production: Cover Design)",
    ]);

    await page.getByRole("button", { name: "Submit ticket" }).click();
    await expect(
      page.getByText("Give your ticket a short subject"),
    ).toBeVisible();
    await expect(page.getByText("Describe what's happening")).toBeVisible();
    await page.getByLabel("Subject").fill("Hi");
    await page.getByLabel("Description").fill("Too short");
    await page.getByRole("button", { name: "Submit ticket" }).click();
    await expect(
      page.getByText(/Add a little more detail \(at least \d+ characters\)/),
    ).toBeVisible();
    await expect(
      page.getByText(/at least \d+ characters so we can help faster/),
    ).toBeVisible();
    await shot(page, "02-new-ticket-validation");

    // Deep link from a book card preselects the book.
    await page.goto("/author/tickets/new?bookId=BK012");
    await expect(book).toHaveValue(/.+/);
    await expect(book.locator("option:checked")).toHaveText(
      "Ctrl+Alt+Delete My Ex",
    );

    await page.getByLabel("Subject").fill("Missing pages in my author copies");
    await page
      .getByLabel("Description")
      .fill(
        "Three of the ten author copies I received yesterday are missing pages 41 to 56. I have photos.",
      );
    await page.locator('input[type="file"]').setInputFiles([
      {
        name: "copy-1.jpg",
        mimeType: "image/jpeg",
        buffer: Buffer.from("fake image 1"),
      },
      {
        name: "copy-2.jpg",
        mimeType: "image/jpeg",
        buffer: Buffer.from("fake image 2"),
      },
    ]);
    const chips = page.getByRole("list", { name: "Attached files" });
    await expect(chips.getByRole("listitem")).toHaveCount(2);
    await page.getByRole("button", { name: "Remove copy-2.jpg" }).click();
    await expect(chips.getByRole("listitem")).toHaveCount(1);
    await shot(page, "02-new-ticket-filled");

    await page.getByRole("button", { name: "Submit ticket" }).click();
    await expect(page).toHaveURL(/\/author\/tickets\/BL-\d{4}$/);
    await expect(
      page.getByRole("heading", { name: "Missing pages in my author copies" }),
    ).toBeVisible();
    await expect(page.getByRole("log", { name: "Conversation" })).toContainText(
      "missing pages 41 to 56",
    );
    await expect(page.getByText("copy-1.jpg")).toBeVisible();
    await shot(page, "02-ticket-detail-new");
  });

  test("ticket list: filters and the new ticket", async ({ page }) => {
    await login(page, "sneha.kulkarni@email.com");
    await page.goto("/author/tickets");
    await expect(
      page.getByRole("link", { name: /Missing pages in my author copies/ }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /^BL-0004/ })).toBeVisible();

    await page.getByRole("button", { name: "Resolved" }).click();
    await expect(
      page.getByRole("button", { name: "Resolved" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("link", { name: /^BL-0004/ })).toHaveCount(0);
    await page.getByRole("button", { name: "In Progress" }).click();
    await expect(page.getByRole("link", { name: /^BL-0004/ })).toBeVisible();
    await shot(page, "02-author-ticket-list");
  });

  test("ticket detail: reply and see it in the conversation", async ({
    page,
  }) => {
    await login(page, "sneha.kulkarni@email.com");
    await page.goto("/author/tickets/BL-0004");
    const send = page.getByRole("button", { name: "Send reply" });
    await expect(send).toBeDisabled();
    await page
      .getByLabel("Reply to the BookLeaf team")
      .fill("I have now sent my feedback on the second cover draft by email.");
    await send.click();
    await expect(page.getByRole("log", { name: "Conversation" })).toContainText(
      "sent my feedback on the second cover draft",
    );
    await expect(page.getByLabel("Reply to the BookLeaf team")).toHaveValue("");
    // No AI metadata or internal notes ever reach the author view.
    await expect(page.getByRole("main")).not.toContainText(
      /confidence|AI suggested|internal note|Rule-based/i,
    );
    await shot(page, "02-author-ticket-reply");
  });

  test("an author cannot open another author's ticket", async ({ page }) => {
    allowConsole(/\/api\/v1\/tickets\/BL-0005/); // the 404 is the point of this test
    await login(page, "sneha.kulkarni@email.com");
    await page.goto("/author/tickets/BL-0005"); // Ananya's
    await expect(
      page.getByText(/not found|couldn't find|doesn't exist/i).first(),
    ).toBeVisible();
    await expect(page.getByRole("main")).not.toContainText(
      "Between Two Temples",
    );
  });
});
