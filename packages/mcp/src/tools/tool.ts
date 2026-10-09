/**
 * The shape of one tool in the shared list. A tool depends on nothing but
 * an `ApiClient`: the stdio server hands it one talking to the builder over
 * HTTP with a key, a later assistant in the web app another.
 */
import { z } from "zod";
import { ApiError, type ApiClient } from "../api-client.ts";
import type { ToolName } from "./descriptions.ts";
import { PackageMissing } from "./view.ts";

/** A file a tool hands back (the PDF). */
export interface ToolFile {
  name: string;
  mimeType: string;
  /** The bytes, base64. */
  data: string;
}

/**
 * What a tool answers: plain data the model reads (names already in the
 * player's language), marked as an error when nothing was done.
 */
export interface ToolResult {
  data: unknown;
  isError?: boolean;
  file?: ToolFile;
}

export interface Tool {
  name: ToolName;
  description: string;
  /** Zod fields of the input object. */
  input: z.ZodRawShape;
  /** Checks the input against `input` and runs; API errors become an error result, never a throw. */
  run(client: ApiClient, input: unknown): Promise<ToolResult>;
}

export function defineTool<Shape extends z.ZodRawShape>(tool: {
  name: ToolName;
  description: string;
  input: Shape;
  run(client: ApiClient, input: z.infer<z.ZodObject<Shape>>): Promise<ToolResult>;
}): Tool {
  const schema = z.object(tool.input);
  return {
    name: tool.name,
    description: tool.description,
    input: tool.input,
    async run(client, raw) {
      const parsed = schema.safeParse(raw ?? {});
      if (!parsed.success) {
        return failure(`The input does not fit: ${z.prettifyError(parsed.error)}`);
      }
      try {
        return await tool.run(client, parsed.data);
      } catch (e) {
        if (e instanceof ApiError) return failure(apiErrorMessage(e, client.baseUrl), e.details);
        if (e instanceof PackageMissing) return failure(e.message);
        throw e;
      }
    },
  };
}

export function failure(message: string, details?: unknown): ToolResult {
  return { isError: true, data: details === undefined ? { message } : { message, details } };
}

/** An API error in words a model can pass on; codes from apps/web/API.md. */
export function apiErrorMessage(e: ApiError, baseUrl: string): string {
  switch (e.code) {
    case "unreachable":
      return (
        `Could not reach the character builder at ${baseUrl} (${String(e.details["message"])}). ` +
        "Check the internet connection and the address in config.json."
      );
    case "keyNotValid":
    case "notLoggedIn":
      return (
        "The character builder does not accept the access key: it was withdrawn in the settings, has ended, " +
        "or is mistyped. The player can make a new key in the builder under Settings, Access keys and put " +
        "it where the old one was: as BUILDER_KEY in the MCP program's configuration (for example " +
        "claude_desktop_config.json), which wins, or in config.json next to server.mjs."
      );
    case "draftNotFound":
      return "There is no character with this id in this account. list_characters shows the player's characters.";
    case "valueNotFound":
      return "The character's package has no value with this id. get_character lists the value ids.";
    case "packageNotFound":
      return "The builder has no package with this id. list_packages shows the loaded ones.";
    case "packageUnavailable":
      return "The package this character was built with is not loaded on the builder right now.";
    case "languageNotSupported":
      return `The sheet cannot be made in the player's language with this package; it can in: ${String(e.details["languages"])}.`;
    case "tooManyRequests":
      return "Too many PDFs in a short time. Wait a minute and try again.";
    case "changeRejected":
      return rejectionMessage(e.details["reason"]);
    default:
      return `The character builder answered ${e.status} ${e.code}.`;
  }
}

const PROBLEMS: Record<string, string> = {
  badShape: "The answer has the wrong shape for this kind of choice (see list_options).",
  duplicate: "An option is picked twice, or the character already has it from somewhere else.",
  notOffered: "At least one pick is not among the options offered now (see list_options).",
  tooMany: "More picks than the choice allows.",
  badMethod: "There is no method with this index for this choice.",
  badAssignment:
    "The numbers do not fit the method: a value that is not a target, or a number it does not allow.",
  overBudget: "The numbers cost or give more points than there are.",
  outOfRange: "A number is outside the allowed range.",
  empty: "The text is empty.",
  tooLong: "The text is too long.",
  badCharacters: "The text holds characters that are not allowed.",
};

/** Why the rules refused a change (`ChangeError`). */
export function rejectionMessage(reason: unknown): string {
  const r = (reason ?? {}) as Record<string, unknown>;
  const prefix = "The builder refused the change, nothing was saved. ";
  switch (r["code"]) {
    case "levelOutOfRange":
      return `${prefix}The level must be from ${String(r["min"])} to ${String(r["max"])}.`;
    case "levelNotHigher":
      return `${prefix}Raising needs a level above the current level ${String(r["level"])}.`;
    case "unknownChoice":
      return `${prefix}The package has no choice with this id.`;
    case "notAsked":
      return `${prefix}This choice is not asked for this character now; an earlier answer or the level decides whether it comes.`;
    case "unknownStep":
      return `${prefix}This step has no shared list; answer its choices one by one with set_answer.`;
    case "noAnswerNeeded":
      return `${prefix}This choice only informs; it takes no answer.`;
    case "noTracks":
      return `${prefix}This package has no tracks: every level goes to the character as a whole.`;
    case "unknownTrack":
      return `${prefix}${String(r["thing"])} is not one of the things that can take levels (see get_character, tracks.nextLevel).`;
    case "tooManyTracks":
      return `${prefix}More tracks than levels: at most ${String(r["most"])}.`;
    case "trackNotAllowed":
      return `${prefix}${String(r["thing"])} cannot be added at level ${String(r["level"])}; its condition is not met.`;
    case "answerDoesNotFit":
      return (
        prefix + (PROBLEMS[String(r["problem"])] ?? `The answer does not fit (${String(r["problem"])}).`)
      );
    default:
      return `${prefix}Reason: ${JSON.stringify(reason)}.`;
  }
}
