/**
 * Puts the live channel on the server Next.js runs, at start (from
 * instrumentation.ts), in production and in development alike.
 *
 * Next.js answers HTTP only and gives no handle on its server; the
 * standalone build even writes its own `server.js`. So the WebSocket
 * upgrades of the live channel's path are taken before Next.js sees them,
 * on every HTTP server of this process; every other upgrade (Next.js'
 * own in development) goes on as before. One process, one port, nothing
 * to change in the Docker image.
 */
import { Server } from "node:http";
import type { App } from "../app.ts";
import { liveUpgradeHandler } from "./upgrade.ts";

const holder = globalThis as unknown as { __builderLive?: true };

export function installLive(getApp: () => Promise<App>): void {
  // Once per process: dev reloads run this again.
  if (holder.__builderLive) return;
  holder.__builderLive = true;
  const handle = liveUpgradeHandler(getApp);
  const emit = Server.prototype.emit as (this: Server, event: string | symbol, ...args: unknown[]) => boolean;
  Server.prototype.emit = function (this: Server, event: string | symbol, ...args: unknown[]) {
    if (event === "upgrade") {
      const [req, socket, head] = args as Parameters<typeof handle>;
      if (handle(req, socket, head)) return true;
    }
    return emit.call(this, event, ...args);
  } as typeof Server.prototype.emit;
}
