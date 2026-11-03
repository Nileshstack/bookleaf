import { ADMIN, expect, login, shot, test } from "./fixtures";

test.describe("Login and route protection", () => {
  test("demo credentials autofill and sign an author in", async ({ page }) => {
    await page.goto("/login");
    await expect(
      page.getByRole("heading", { name: "Welcome back" }),
    ).toBeVisible();
    await shot(page, "01-login");

    await page.getByRole("button", { name: /^Priya Sharma Author/ }).click();
    await expect(page.getByLabel("Email")).toHaveValue(
      "priya.sharma@email.com",
    );
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue(
      "Author@123",
    );

    await page.getByRole("button", { name: "Show password" }).click();
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
      "type",
      "text",
    );

    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/author\/dashboard$/);
    await expect(
      page.getByRole("heading", { name: "Welcome back, Priya" }),
    ).toBeVisible();
  });

  test("client-side validation before any request", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Enter your email address")).toBeVisible();
    await expect(page.getByText("Enter your password")).toBeVisible();
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("Enter a valid email address")).toBeVisible();
  });

  test("wrong password shows an error and stays on /login", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("priya.sharma@email.com");
    await page.getByLabel("Password", { exact: true }).fill("Wrong@123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: /invalid email or password/i }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
    await shot(page, "01-login-wrong-password");
  });

  test("each role lands on its own portal", async ({ page }) => {
    await login(page, ADMIN.email, ADMIN.password);
    await expect(page).toHaveURL(/\/admin\/dashboard$/);
    await expect(
      page.getByRole("heading", { name: "Support dashboard" }),
    ).toBeVisible();
  });

  test("signed-out visitors are sent to login and returned afterwards", async ({
    page,
  }) => {
    await page.goto("/author/books");
    await expect(page).toHaveURL(/\/login\?next=%2Fauthor%2Fbooks/);
    await page.getByLabel("Email").fill("sneha.kulkarni@email.com");
    await page.getByLabel("Password", { exact: true }).fill("Author@123");
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/author\/books$/);
  });

  test("an author cannot open the admin portal, and an admin cannot open the author portal", async ({
    page,
  }) => {
    await login(page, "sneha.kulkarni@email.com");
    await page.goto("/admin/tickets");
    await expect(page).toHaveURL(/\/author\//);
    await expect(
      page.getByRole("heading", { name: "Ticket queue" }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);

    await login(page, ADMIN.email, ADMIN.password);
    await page.goto("/author/dashboard");
    await expect(page).toHaveURL(/\/admin\//);
  });

  test("sign out ends the session", async ({ page }) => {
    await login(page, "sneha.kulkarni@email.com");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);
    await page.goto("/author/dashboard");
    await expect(page).toHaveURL(/\/login/);
  });
});
