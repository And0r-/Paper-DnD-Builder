/**
 * Package format version this code understands, "MAJOR.MINOR".
 *
 * Rule (see SPEC.md, "Versioning"): a package is accepted if its major
 * version equals ours and its minor version is not higher. While the major
 * version is 0, every minor bump may break packages and must ship a
 * migration note in SPEC.md.
 */
export const PACKAGE_FORMAT_VERSION = "0.2";

export function parseFormatVersion(v: string): { major: number; minor: number } | undefined {
  const m = /^(\d+)\.(\d+)$/.exec(v);
  return m ? { major: Number(m[1]), minor: Number(m[2]) } : undefined;
}

/** Returns a reason if a package written for `packageVersion` cannot be loaded, else undefined. */
export function formatVersionMismatch(
  packageVersion: string,
  supported = PACKAGE_FORMAT_VERSION,
): string | undefined {
  const p = parseFormatVersion(packageVersion);
  const s = parseFormatVersion(supported)!;
  if (!p) return `format version "${packageVersion}" is not "MAJOR.MINOR"`;
  if (p.major !== s.major) {
    return `package is written for format ${packageVersion}, this builder understands ${supported} (major versions differ)`;
  }
  if (s.major === 0 ? p.minor !== s.minor : p.minor > s.minor) {
    return `package is written for format ${packageVersion}, this builder understands ${supported}`;
  }
  return undefined;
}
