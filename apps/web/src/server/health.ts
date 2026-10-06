/**
 * The body of GET /api/health. Always "ok" while the process serves
 * requests (Docker restarts on anything else), plus which content packages
 * are loaded, so a missing or rejected package shows up before anyone
 * starts testing against it.
 */
import path from "node:path";
import type { PackageRegistry } from "./packages/loader.ts";

export interface HealthPackage {
  id: string;
  version: string;
  formatVersion: string;
}

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
  const packages = [...registry.packages.values()].map(({ pkg: { manifest } }) => ({
    id: manifest.id,
    version: manifest.version,
    formatVersion: manifest.formatVersion,
  }));
  // Folder names only: the full path says nothing to the reader and shows the server layout.
  const warnings = registry.rejected.map(
    (r) => `Package folder "${path.basename(r.dir)}" was rejected. See the log.`,
  );
  if (packages.length === 0) warnings.push("No content package is loaded.");
  return { status: "ok", packages, warnings };
}
