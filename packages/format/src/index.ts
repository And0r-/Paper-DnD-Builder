/**
 * Content package format.
 *
 * Reserved for the content/format role: the Zod schema for packages
 * (things, choices, rules, texts per language, unit conversion tables)
 * lives here. The builder only ever reads packages through this schema.
 *
 * Placeholder until the format v0 task lands.
 */

/** Package format version the builder understands. `0` means "not defined yet". */
export const PACKAGE_FORMAT_VERSION = 0;
