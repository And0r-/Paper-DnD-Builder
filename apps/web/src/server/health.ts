/**
 * The body of GET /api/health. Always "ok" while the process serves
 * requests (Docker restarts on anything else), plus which content packages
 * are loaded, bases and extensions, so a missing or rejected package shows up before anyone
 * starts testing against it.
 */
import path from "node:path";
import type { PackageRegistry } from "./packages/loader.ts";

export type HealthPackage =
  | { id: string; version: string; formatVersion: string; kind: "base" }
  /** `extends`: the id of the base package the extension adds to. */
  | { id: string; version: string; formatVersion: string; kind: "extension"; extends: string };

export interface HealthReport {
  status: "ok";
  packages: HealthPackage[];
  warnings: string[];
}

export function healthReport(registry: PackageRegistry | undefined): HealthReport {
  if (!registry) {
    return {
      status: "ok",
      packages: [],
      warnings: ["The server did not start completely; no packages are loaded. See the log."],
    };
  }
  const packages: HealthPackage[] = [
    ...[...registry.packages.values()].map(({ pkg: { manifest } }) => ({
      id: manifest.id,
      version: manifest.version,
      formatVersion: manifest.formatVersion,
      kind: "base" as const,
    })),
    // Extensions are no packages of their own in the registry; each goes after the bases.
    ...[...registry.extensions.values()].map((ext) => ({
      id: ext.id,
      version: ext.info.version,
      formatVersion: (ext.files.get("manifest.json") as { formatVersion: string }).formatVersion,
      kind: "extension" as const,
      extends: ext.base,
    })),
  ];
  // Folder names only: the full path says nothing to the reader and shows the server layout.
  const warnings = registry.rejected.map(
    (r) => `Package folder "${path.basename(r.dir)}" was rejected. See the log.`,
  );
  if (packages.length === 0) warnings.push("No content package is loaded.");
  return { status: "ok", packages, warnings };
}
