import type { Issue, ValidationResult } from "./validate.ts";

/** One line per issue: "error   things/knacks.json  [3].grants[0].choice: unknown choice ...". */
export function formatIssue(i: Issue): string {
  const where = i.path ? `${i.file}  ${i.path}` : i.file;
  return `${i.level === "error" ? "error  " : "warning"}  ${where}: ${i.message}`;
}

/** Human-readable report of a validation run. */
export function formatReport(dir: string, r: ValidationResult): string {
  const lines = [...r.errors, ...r.warnings].map(formatIssue);
  const p = r.package;
  if (p) {
    const textCount = Object.values(p.texts)[0] ? Object.keys(Object.values(p.texts)[0]!).length : 0;
    lines.push(
      `OK  ${p.manifest.id} ${p.manifest.version} (format ${p.manifest.formatVersion}): ` +
        `${p.things.length} things, ${p.flow.choices.length} choices, ${p.values.length} values, ` +
        `${p.manifest.languages.length} languages (${p.manifest.languages.join(", ")}), ${textCount} texts each, ` +
        `${r.warnings.length} warning(s)`,
    );
  } else {
    lines.push(`FAILED  ${dir}: ${r.errors.length} error(s), ${r.warnings.length} warning(s)`);
  }
  return lines.join("\n");
}
