/**
 * Demo content package "Mistland".
 *
 * The package itself is the JSON in this folder (manifest.json, things/,
 * texts/, ...). This module only tells code where to find it, so tests and
 * local development can load it without a mounted volume. Everything in it
 * is invented; it must never contain text from any published rulebook.
 */
import { fileURLToPath } from "node:url";

/** Package key, as in manifest.json. */
export const DEMO_PACKAGE_ID = "demo";

/** Absolute path of the package root (the folder holding manifest.json). */
export const DEMO_PACKAGE_DIR = fileURLToPath(new URL("..", import.meta.url));
