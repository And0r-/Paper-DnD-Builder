/**
 * Where the builder is and which key to use: `config.json` next to the
 * server file (`{ "baseUrl", "key" }`), each field overridable by
 * `BUILDER_BASE_URL` and `BUILDER_KEY`.
 *
 * The key decides the mode. With a key: private, over stdio, always that
 * key's account. Without one: public, over HTTP, each request with its own
 * key. Never a fixed key over HTTP: anyone who reaches the port would act
 * as that account.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const DEFAULT_PORT = 8787;

export type ServerConfig =
  | { mode: "private"; baseUrl: string; key: string }
  | { mode: "public"; baseUrl: string; port: number; allowedOrigins: string[] };

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function loadConfig(dir: string, env: Readonly<Record<string, string | undefined>>): ServerConfig {
  const path = join(dir, "config.json");
  let file: Partial<Record<"baseUrl" | "key", unknown>> = {};
  try {
    file = JSON.parse(readFileSync(path, "utf8")) as typeof file;
  } catch (e) {
    const missing = (e as NodeJS.ErrnoException).code === "ENOENT";
    if (!missing) throw new ConfigError(`${path} is not valid JSON: ${(e as Error).message}`);
  }
  const baseUrl = env["BUILDER_BASE_URL"] || file.baseUrl;
  const key = env["BUILDER_KEY"] || file.key;
  if (typeof baseUrl !== "string" || !/^https?:\/\//.test(baseUrl)) {
    throw new ConfigError(
      `No builder address: set "baseUrl" in ${path} or BUILDER_BASE_URL (http:// or https://).`,
    );
  }
  if (key !== undefined && key !== "" && key !== null) {
    if (typeof key !== "string" || !key.startsWith("cbk_")) {
      throw new ConfigError(`The access key in ${path} or BUILDER_KEY must start with cbk_.`);
    }
    return { mode: "private", baseUrl, key };
  }
  const port = env["PORT"] ? Number(env["PORT"]) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new ConfigError(`PORT must be a port number, not "${env["PORT"]}".`);
  }
  const allowedOrigins = (env["ALLOWED_ORIGINS"] ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  for (const origin of allowedOrigins) {
    if (!/^https?:\/\/[^/]+$/.test(origin)) {
      throw new ConfigError(`ALLOWED_ORIGINS: "${origin}" is not an origin like https://example.org.`);
    }
  }
  return { mode: "public", baseUrl, port, allowedOrigins };
}
