/**
 * Content package format.
 *
 * Zod schemas, types and the validator for content packages. The builder
 * only ever reads packages through this module. SPEC.md in this package is
 * the human-readable specification.
 */

export { PACKAGE_FORMAT_VERSION, formatVersionMismatch, parseFormatVersion } from "./version.ts";
export * from "./schema.ts";
export { parseExpr, collectRefs, ExprSyntaxError, FUNCTIONS, BUILTIN_REFS } from "./expr.ts";
export type { Expr, BinaryOp, FunctionName, ExprRefs } from "./expr.ts";
export { parseTemplate, TemplateSyntaxError } from "./template.ts";
export type { TemplatePart } from "./template.ts";
export { convertAmount, dimensionOf } from "./units.ts";
export { FALLBACK_LANGUAGE, shownLanguage } from "./languages.ts";
export { readPackageDir, ROOT_FILES } from "./read.ts";
export type { PackageFiles, ReadResult } from "./read.ts";
export { validatePackageDir, validatePackageFiles, RESERVED_PREFIXES } from "./validate.ts";
export type { Issue, ContentPackage, ValidationResult, TextOrigin, ExtensionInfo } from "./validate.ts";
export { formatIssue, formatReport } from "./report.ts";
export { validateExtensionFiles, extensionDependency, versionAccepts } from "./extension.ts";
export type { ExtensionBase, ExtensionResult } from "./extension.ts";
