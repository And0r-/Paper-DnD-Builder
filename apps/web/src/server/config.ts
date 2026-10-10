/**
 * Server configuration from the environment (see .env.example).
 *
 * Values are read once. Secrets (database URL, SMTP password) are never
 * logged; `describeConfig` prints only what is safe to show.
 */
export interface SmtpConfig {
  host: string;
  port: number;
  /** Implicit TLS (usually port 465). Otherwise STARTTLS is required. */
  secure: boolean;
  user?: string;
  password?: string;
}

export interface Config {
  databaseUrl?: string;
  packagesDir?: string;
  /** Public address, e.g. https://builder.example. Used in mails and for the same-origin check. */
  baseUrl?: URL;
  /** Mark cookies Secure (and use the __Host- prefix). On whenever the public address is https. */
  secureCookies: boolean;
  smtp?: SmtpConfig;
  mailFrom?: string;
  /**
   * The first admin's password, read at start while there is no admin
   * (see auth/accounts.ts, `createFirstAdmin`); of no use after that.
   * Never logged.
   */
  adminPassword?: string;
}

/** Shortest ADMIN_PASSWORD taken: it is stored as an unsalted hash until its first login swaps it. */
export const MIN_ADMIN_PASSWORD = 12;
/** Longest: what the login form takes (MAX_PASSWORD_INPUT in auth/password.ts, not imported to keep this file light). */
const MAX_ADMIN_PASSWORD = 200;

const blank = (v: string | undefined) => (v === undefined || v.trim() === "" ? undefined : v.trim());

export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const base = blank(env["BASE_URL"]);
  let baseUrl: URL | undefined;
  if (base) {
    try {
      baseUrl = new URL(base);
    } catch {
      throw new Error("BASE_URL is not a valid URL. See .env.example.");
    }
  }
  const host = blank(env["SMTP_HOST"]);
  const port = Number(blank(env["SMTP_PORT"]) ?? "587");
  const user = blank(env["SMTP_USER"]);
  const password = env["SMTP_PASSWORD"] || undefined;
  const config: Config = {
    secureCookies: baseUrl?.protocol === "https:",
  };
  const databaseUrl = blank(env["DATABASE_URL"]);
  const packagesDir = blank(env["PACKAGES_DIR"]);
  const mailFrom = blank(env["MAIL_FROM"]);
  if (databaseUrl) config.databaseUrl = databaseUrl;
  if (packagesDir) config.packagesDir = packagesDir;
  if (baseUrl) config.baseUrl = baseUrl;
  if (mailFrom) config.mailFrom = mailFrom;
  const adminPassword = blank(env["ADMIN_PASSWORD"]);
  if (adminPassword) {
    if (adminPassword.length < MIN_ADMIN_PASSWORD || adminPassword.length > MAX_ADMIN_PASSWORD) {
      throw new Error(
        `ADMIN_PASSWORD must be ${MIN_ADMIN_PASSWORD} to ${MAX_ADMIN_PASSWORD} characters long. See .env.example.`,
      );
    }
    config.adminPassword = adminPassword;
  }
  if (host) {
    if (!Number.isInteger(port) || port <= 0) throw new Error("SMTP_PORT must be a port number.");
    config.smtp = {
      host,
      port,
      secure: blank(env["SMTP_SECURE"]) === "true",
      ...(user ? { user } : {}),
      ...(password ? { password } : {}),
    };
  }
  return config;
}
