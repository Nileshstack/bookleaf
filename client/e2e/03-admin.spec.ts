import { ADMIN, expect, login, shot, test } from "./fixtures";
import type { Page } from "@playwright/test";

const queueRows = (page: Page) =>
  page
    .getByRole("table", { name: /^Ticket queue/ })
    .getByRole("rowgroup")
    .nth(1)
    .getByRole("row");

test.describe("Admin portal", () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.password);
  });

  test("dashboard: stat cards and charts", async ({ page }) => {
    const summary = page.getByRole("region", { name: "Queue summary" });
    await expect(
      summary.getByRole("link", { name: /^Open tickets \d+/ }),
    ).toBeVisible();
    await expect(
      summary.getByRole("link", { name: /^Critical 1/ }),
    ).toBeVisible(); // BL-0005
    await expect(
      summary.getByRole("link", { name: /^Overdue \d+/ }),
    ).toBeVisible();
    await expect(summary).toContainText("AI override rate");

    await expect(
      page.getByRole("table", { name: "Tickets by category" }).getByRole("row"),
    ).toHaveCount(6);
    await expect(
      page
        .getByRole("table", { name: "Tickets by priority" })
        .getByRole("row", { name: "Critical 1" }),
    ).toBeAttached();
    await expect(page.locator(".recharts-surface").first()).toBeVisible();

    await page.getByRole("button", { name: "All time" }).click();
    await expect(
      page.getByRole("button", { name: "All time" }),
    ).toHaveAttribute("aria-pressed", "true");
    await shot(page, "03-admin-dashboard");

    await summary.getByRole("link", { name: /^Critical/ }).click();
    await expect(page).toHaveURL(/\/admin\/tickets\?priority=Critical/);
    await expect(queueRows(page)).toHaveCount(1);
  });

  test("queue: default sort, priority colours, overdue markers", async ({
    page,
  }) => {
    await page.goto("/admin/tickets");
    const table = page.getByRole("table", { name: /^Ticket queue/ });
    await expect(table).toHaveAccessibleName(/sorted by Urgency, then age/);
    // The stack re-triages the seeded backlog at boot; wait for it to settle.
    await expect(table.getByText("AI classifying…")).toHaveCount(0, {
      timeout: 30_000,
    });
    const rows = queueRows(page);
    await expect(rows.first()).toContainText("BL-0005"); // the only Critical ticket comes first
    await expect(rows.first()).toContainText("Critical");

    // Priority ranks never increase down the list.
    const rank = { Critical: 0, High: 1, Medium: 2, Low: 3 } as Record<
      string,
      number
    >;
    const priorities = await rows.evaluateAll((trs) =>
      trs.map((tr) => tr.querySelectorAll("td")[4]?.textContent?.trim() ?? ""),
    );
    const ranks = priorities.map((p) => rank[p]);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));

    // Colour-coded badges: Critical red, High orange.
    const badgeClass = async (label: string) =>
      table
        .locator("td")
        .getByText(label, { exact: true })
        .first()
        .getAttribute("class");
    expect(await badgeClass("Critical")).toMatch(/danger/);
    expect(await badgeClass("High")).toMatch(/orange/);

    await expect(rows.filter({ hasText: "(overdue)" }).first()).toBeVisible();
    await shot(page, "03-admin-queue");
  });

  test("queue: filters, search and sort", async ({ page }) => {
    await page.goto("/admin/tickets");
    const rows = queueRows(page);

    await page.getByLabel("Category").selectOption("Printing & Quality");
    await expect(rows).not.toHaveCount(0);
    for (const row of await rows.all())
      await expect(row).toContainText("Printing & Quality");

    await page.getByLabel("Category").selectOption("");
    await page.getByLabel("Priority").selectOption("Critical");
    await expect(rows).toHaveCount(1);
    await page.getByLabel("Priority").selectOption("");

    await page.getByLabel("Overdue only").check();
    await expect(rows).not.toHaveCount(0);
    for (const row of await rows.all())
      await expect(row).toContainText("(overdue)");
    await page.getByLabel("Overdue only").uncheck();

    await page.getByLabel("Status").selectOption({ label: "All statuses" });
    await expect(rows.filter({ hasText: "BL-0001" })).toHaveCount(1); // Closed shows up only now

    await page.getByLabel("Search tickets").fill("BL-0003");
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText("binding defects");
    await page.getByLabel("Search tickets").fill("");

    await page.getByLabel("Sort").selectOption({ label: "Newest first" });
    await expect(
      page.getByRole("table", { name: /sorted by Newest first/ }),
    ).toBeVisible();
    await shot(page, "03-admin-queue-filtered");
  });

  test("workspace: draft auto-loads, edit, regenerate, send", async ({
    page,
  }) => {
    await page.goto("/admin/tickets/BL-0005");
    const reply = page.getByLabel("Reply to Ananya");
    await expect(
      page.getByText(/Drafting a reply from BookLeaf policy/),
    ).toBeVisible();
    await expect(reply).toHaveValue(/^Hi Ananya,[\s\S]*Team BookLeaf$/, {
      timeout: 15_000,
    });
    await expect(
      page.getByText(/AI draft · .* · based on Royalty policy/),
    ).toBeVisible();
    await shot(page, "03-admin-workspace-draft");

    await reply.fill(
      "Hi Ananya,\n\nI'm sorry for the delay. Your ₹2,546 is overdue and we have escalated it today.\n\nWarm regards,\nTeam BookLeaf",
    );
    await expect(page.getByText(/· edited/)).toBeVisible();

    // Regenerating over edits asks first.
    await page.getByRole("button", { name: "Regenerate" }).click();
    await expect(
      page.getByRole("button", { name: "Replace your edits?" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Replace your edits?" }).click();
    await expect(reply).toHaveValue(
      /^Hi Ananya,\n\nThank you for reaching out/,
    );

    await reply.fill(
      "Hi Ananya,\n\nI'm sorry for the delay. Your ₹2,546 is overdue and we have escalated it today.\n\nWarm regards,\nTeam BookLeaf",
    );
    await page.getByRole("button", { name: "Send reply" }).click();
    await expect(page.getByText("Reply sent to Ananya").first()).toBeVisible();
    await expect(
      page.getByRole("log", { name: "Conversation with the author" }),
    ).toContainText("escalated it today");
    await shot(page, "03-admin-workspace-sent");
  });

  test("workspace: overrides keep the AI suggestion, assign, internal note", async ({
    page,
  }) => {
    await page.goto("/admin/tickets/BL-0006");
    const controls = page.getByRole("complementary", {
      name: "Ticket controls and internal notes",
    });

    await controls.getByLabel("Category").selectOption("General Inquiry");
    await expect(controls.getByText("Overridden").first()).toBeVisible();
    await expect(controls).toContainText(
      "AI suggested: ISBN & Metadata Issues",
    );

    await controls
      .getByLabel("Priority", { exact: true })
      .selectOption("Critical");
    await expect(controls.getByText("Overridden")).toHaveCount(2);

    await controls.getByRole("button", { name: "Assign to me" }).click();
    await expect(controls.getByText("You", { exact: true })).toBeVisible();

    const notes = controls.getByRole("region", { name: "Internal notes" });
    await notes
      .getByLabel("New internal note")
      .fill("Checked with production: wrong ISBN pushed to Amazon US feed.");
    await notes.getByRole("button", { name: "Add note" }).click();
    await expect(notes).toContainText("wrong ISBN pushed to Amazon US feed");

    // Persisted: survives a reload.
    await page.reload();
    await expect(controls.getByLabel("Category")).toHaveValue(
      "General Inquiry",
    );
    await expect(controls.getByLabel("Priority", { exact: true })).toHaveValue(
      "Critical",
    );
    await expect(notes).toContainText("wrong ISBN pushed to Amazon US feed");
    await shot(page, "03-admin-workspace-overrides");

    // Restore the category so later specs see the original triage.
    await controls
      .getByLabel("Category")
      .selectOption("ISBN & Metadata Issues");
  });

  test("workspace: send & mark Resolved", async ({ page }) => {
    await page.goto("/admin/tickets/BL-0007");
    const reply = page.getByLabel("Reply to Farhan");
    await expect(reply).toHaveValue(/^Hi Farhan,/, { timeout: 15_000 });
    await page.getByRole("button", { name: "Send & mark Resolved" }).click();
    await expect(
      page.getByText("Reply sent and BL-0007 marked Resolved"),
    ).toBeVisible();
    await expect(
      page
        .getByRole("complementary", {
          name: "Ticket controls and internal notes",
        })
        .getByLabel("Status"),
    ).toHaveValue("Resolved");
  });
});
