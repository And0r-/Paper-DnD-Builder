/**
 * Runs once when the server starts: loads and validates the content
 * packages, so a rejected package is reported in the log right away (and
 * the server starts anyway, without it). Makes the public MCP zip, which is
 * then only served. Opens the live help's channel on the same server.
 */
export async function register(): Promise<void> {
  if (process.env["NEXT_RUNTIME"] !== "nodejs") return;
  const { getApp } = await import("./src/server/app.ts");
  const { readConfig } = await import("./src/server/config.ts");
  const { mcpZip } = await import("./src/server/mcp-zip.ts");
  try {
    const zip = await mcpZip(readConfig());
    if ("missing" in zip) console.error(`MCP zip: not available (${zip.missing}).`);
  } catch (error) {
    console.error("Startup:", (error as Error).message);
  }
  // The live help's WebSocket endpoint, on this same server (src/server/live/install.ts).
  const { installLive } = await import("./src/server/live/install.ts");
  installLive(getApp);
  try {
    await getApp();
  } catch (error) {
    // Logged, not thrown: the health check stays up and the problem is visible.
    console.error("Startup:", (error as Error).message);
  }
}
