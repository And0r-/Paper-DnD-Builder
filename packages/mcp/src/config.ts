/**
 * Where the builder is and which key to use: `config.json` next to the
 * server file (`{ "baseUrl", "key" }`), each field overridable by
 * `BUILDER_BASE_URL` and `BUILDER_KEY`.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface ServerConfig {
  baseUrl: string;
  key: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export function loadConfig(dir: string, env: Readonly<Record<string, string | undefined>>): ServerConfig {
  const path = join(dir, "config.json");
  let file: Partial<Record<keyof ServerConfig, unknown>> = {};
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
  if (typeof key !== "string" || !key.startsWith("cbk_")) {
    throw new ConfigError(`No access key: set "key" (cbk_...) in ${path} or BUILDER_KEY.`);
  }
  return { baseUrl, key };
}
