/**
 * Runs once when the server starts: loads and validates the content
 * packages, so a rejected package is reported in the log right away (and
 * the server starts anyway, without it).
 */
export async function register(): Promise<void> {
  if (process.env["NEXT_RUNTIME"] !== "nodejs") return;
  const { getApp } = await import("./src/server/app.ts");
  try {
    await getApp();
  } catch (error) {
    // Logged, not thrown: the health check stays up and the problem is visible.
    console.error("Startup:", (error as Error).message);
  }
}
