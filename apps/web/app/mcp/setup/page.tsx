/**
 * The page about the MCP server (the address /mcp itself is the server).
 * Readable without logging in. The server's public address comes from
 * BASE_URL; without it, from the request, as the browser reached us.
 */
import { headers } from "next/headers";
import { readConfig } from "../../../src/server/config.ts";
import { McpSetup } from "../../../src/ui/components/McpSetup.tsx";

export const dynamic = "force-dynamic";

export default async function McpSetupPage() {
  const configured = readConfig().baseUrl?.origin;
  const h = await headers();
  const origin = configured ?? `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost"}`;
  return <McpSetup origin={origin} />;
}
