/**
 * Before login the screen does not ask for an account it cannot have: no
 * 401 in the console of a fresh visitor. After login it does, and gets one.
 */
import { expect, signup, test } from "./helpers.ts";

test("a visitor without a session cookie gets no 401 on the login page", async ({ page, foreign }) => {
  void foreign;
  const failed: string[] = [];
  page.on("response", (res) => {
    if (res.status() >= 400) failed.push(`${res.status()} ${res.url()}`);
  });
  await page.goto("/login");
  await page.waitForLoadState("networkidle");
  expect(failed).toEqual([]);

  await signup(page, "session");
  await page.reload();
  const account = await page.request.get("/api/account");
  expect(account.status()).toBe(200);
  expect(failed).toEqual([]);
});
