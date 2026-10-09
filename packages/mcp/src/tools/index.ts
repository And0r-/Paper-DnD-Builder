/**
 * The shared tool list: the stdio MCP server registers exactly these, and
 * a later assistant in the web app reads the same list with its own
 * `ApiClient`. Every tool goes through the public HTTP API only.
 */
import { z } from "zod";
import { draftPackage, enc, ApiError, type ApiClient } from "../api-client.ts";
import type {
  ChoiceState,
  DraftListEntry,
  Evaluation,
  DraftView,
  PackageEntry,
  ValueExplanation,
  ValueSource,
} from "../api-types.ts";
import type { Words } from "../words.ts";
import { INPUT_DESCRIPTIONS as D, TOOL_DESCRIPTIONS as T } from "./descriptions.ts";
import { defineTool, failure, type Tool } from "./tool.ts";
import {
  answerInWords,
  changeOutcome,
  choiceTitle,
  evaluationOf,
  flowChoice,
  methodInWords,
  openChoices,
  standing,
} from "./view.ts";

export { INTRO, TOOL_DESCRIPTIONS, type ToolName } from "./descriptions.ts";
export type { Tool, ToolFile, ToolResult } from "./tool.ts";

const characterId = z.string().min(1).describe(D.characterId);
const level = z.number().int().describe(D.level);

const answer = z
  .union([
    z.strictObject({
      pick: z.string(),
      texts: z.record(z.string(), z.record(z.string(), z.string())).optional(),
    }),
    z.strictObject({
      picks: z.array(z.string()),
      texts: z.record(z.string(), z.record(z.string(), z.string())).optional(),
    }),
    z.strictObject({ method: z.number().int().min(0), assign: z.record(z.string(), z.number().int()) }),
    z.strictObject({ value: z.number() }),
    z.strictObject({ text: z.string() }),
  ])
  .nullable()
  .describe(D.answer);

async function viewWithWords(client: ApiClient, id: string): Promise<[DraftView, Words]> {
  const view = await client.draft(id);
  return [view, await client.words(draftPackage(view.draft))];
}

const listPackages = defineTool({
  name: "list_packages",
  description: T.list_packages,
  input: {},
  async run(client) {
    const { language } = await client.account();
    const { packages } = await client.json<{ packages: PackageEntry[] }>(
      "GET",
      `/api/packages?lang=${enc(language)}`,
    );
    return {
      data: packages.map((p) => ({
        packageId: p.id,
        name: p.name,
        description: p.short,
        version: p.version,
        languages: p.languages,
        extensions: p.extensions.map((e) => ({
          extensionId: e.id,
          name: e.name,
          description: e.short,
          ...(e.publishable ? {} : { notForSharing: true }),
        })),
      })),
    };
  },
});

const listCharacters = defineTool({
  name: "list_characters",
  description: T.list_characters,
  input: {},
  async run(client) {
    const { drafts } = await client.json<{ drafts: DraftListEntry[] }>("GET", "/api/drafts");
    const characters = await Promise.all(
      drafts.map(async (d) => {
        const words = d.packageAvailable ? await client.words(draftPackage(d)) : null;
        return {
          characterId: d.id,
          name: d.summary?.name ?? null,
          level: d.level,
          state: d.status === "finished" ? "finished" : "open",
          ...(d.levelBefore !== null ? { raisingFrom: d.levelBefore } : {}),
          summary: words && d.summary ? words.summaryLine(d.summary.line) : null,
          packageId: d.packageId,
          ...(d.packageAvailable ? {} : { packageLoaded: false }),
          changedAt: d.updatedAt,
        };
      }),
    );
    return { data: characters };
  },
});

const getCharacter = defineTool({
  name: "get_character",
  description: T.get_character,
  input: { characterId },
  async run(client, { characterId }) {
    const [view, words] = await viewWithWords(client, characterId);
    const ev = evaluationOf(view);
    const answered = ev.steps.flatMap((s) =>
      s.choices.flatMap((id) => {
        const c = ev.choices[id];
        if (!c || c.answer === undefined || c.answer === null) return [];
        return [{ choice: id, title: choiceTitle(words, c), answer: answerInWords(words, c.answer) }];
      }),
    );
    const values = Object.entries(ev.values).flatMap(([id, n]) => {
      const name = words.text(`value.${id}.name`);
      if (name === null) return [];
      const shown = words.amount(id, n);
      return [{ value: id, name, number: n, ...(shown !== words.number(n) ? { written: shown } : {}) }];
    });
    const has = ev.things.map((t) => ({
      thing: t.id,
      name: words.name(t.id),
      kind: words.text(`kind.${t.kind}.name`) ?? t.kind,
      short: words.text(`${t.id}.short`),
      ...(t.count !== undefined ? { count: t.count } : {}),
    }));
    return {
      data: {
        ...standing(view, words),
        packageId: view.draft.packageId,
        ...(view.draft.extensions.length > 0 ? { extensions: view.draft.extensions } : {}),
        summary: view.summary ? words.summaryLine(view.summary.line) : null,
        ...(ev.tracks ? { tracks: tracksInWords(ev.tracks, words) } : {}),
        ...(view.levelUp
          ? {
              raise: {
                from: view.levelUp.from,
                to: view.levelUp.to,
                newChoices: view.levelUp.newChoices.map((id) => titled(words, ev.choices[id], id)),
              },
            }
          : {}),
        values,
        has,
        answered,
      },
    };
  },
});

const explainValue = defineTool({
  name: "explain_value",
  description: T.explain_value,
  input: { characterId, value: z.string().min(1).describe(D.value) },
  async run(client, { characterId, value }) {
    const [view, words] = await viewWithWords(client, characterId);
    const ex = await client.json<ValueExplanation>(
      "GET",
      `/api/drafts/${enc(characterId)}/explain/${enc(value)}`,
    );
    const choices = view.evaluation?.choices ?? {};
    const from = (s: ValueSource) => {
      switch (s.kind) {
        case "start":
          return { kind: "start", says: "the number the value starts at" };
        case "choice":
          return {
            kind: "answer",
            choice: s.choice,
            title: titled(words, choices[s.choice], s.choice).title,
          };
        case "thing":
          return { kind: "thing", thing: s.thing, name: words.name(s.thing) };
        case "values":
          return {
            kind: "values",
            says: "worked out from other values",
            values: s.values.map((v) => ({ value: v, name: v === "level" ? "level" : words.value(v) })),
          };
        case "unclear":
          return { kind: "unclear", says: "two ways give the same number; the builder does not guess which" };
      }
    };
    return {
      data: {
        value: ex.value,
        name: words.value(ex.value),
        total: ex.total,
        written: words.amount(ex.value, ex.total),
        parts:
          ex.parts === null
            ? "This number is not a plain sum (a lowest or highest limit cut it), so it has no parts."
            : ex.parts.map((p) => ({ amount: p.amount, from: from(p.source) })),
      },
    };
  },
});

const listOpenChoices = defineTool({
  name: "list_open_choices",
  description: T.list_open_choices,
  input: { characterId },
  async run(client, { characterId }) {
    const [view, words] = await viewWithWords(client, characterId);
    const ev = evaluationOf(view);
    const sharedSteps = new Map(ev.steps.filter((s) => s.pool).map((s) => [s.id, s]));
    const open = ev.open.flatMap((id) => {
      const c = ev.choices[id];
      if (!c) return [];
      const shared = sharedSteps.get(c.step);
      return [
        {
          choice: id,
          title: choiceTitle(words, c),
          question: words.choice(c, "question"),
          kind: c.kind,
          status: c.status,
          ...(c.status === "invalid" ? { problem: c.problem } : {}),
          ...(c.count !== undefined ? { count: c.count } : {}),
          ...(c.remaining !== undefined ? { remaining: c.remaining } : {}),
          ...(c.remaining !== undefined && words.choice(c, "missing")
            ? { missing: words.choice(c, "missing") }
            : {}),
          step: c.step,
          ...(shared ? { sharedListStep: shared.id } : {}),
        },
      ];
    });
    return {
      data: {
        ...standing(view, words),
        openChoices: open,
        ...(open.length === 0
          ? { note: "Nothing is open: finish_character can finish this character." }
          : {}),
      },
    };
  },
});

const listOptions = defineTool({
  name: "list_options",
  description: T.list_options,
  input: { characterId, choice: z.string().min(1).describe(D.choice) },
  async run(client, { characterId, choice }) {
    const [view, words] = await viewWithWords(client, characterId);
    const ev = evaluationOf(view);
    const c = ev.choices[choice];
    if (!c) {
      return failure(
        "This choice is not asked for this character now. list_open_choices shows what is asked; " +
          "an earlier answer or the level decides whether a choice comes.",
      );
    }
    const head = {
      choice: c.id,
      title: choiceTitle(words, c),
      question: words.choice(c, "question"),
      intro: words.choice(c, "intro"),
      kind: c.kind,
      status: c.status,
      optional: c.optional,
      ...(c.answer !== undefined
        ? { currentAnswer: c.answer, currentAnswerInWords: answerInWords(words, c.answer) }
        : {}),
    };
    switch (c.kind) {
      case "pickOne":
      case "pickMany":
        return { data: { ...head, ...pickDetails(words, c, ev.steps.find((s) => s.id === c.step)?.pool) } };
      case "distribute": {
        const structure = await client.structure(draftPackage(view.draft));
        const f = flowChoice(structure.flow.choices, c);
        return {
          data: {
            ...head,
            values: (f?.targets ?? []).map((v) => ({
              value: v,
              name: words.value(v),
              now: ev.values[v],
              ...(c.raise ? { before: c.raise.before[v], most: c.raise.most[v] } : {}),
            })),
            methods: (f?.methods ?? []).map((m, i) => methodInWords(m, i)),
            ...(c.raise ? { raise: { points: c.raise.points } } : {}),
            ...(c.remaining !== undefined ? { remaining: c.remaining } : {}),
            recommended: c.recommended ?? null,
            answerShape: '{"method": <method index>, "assign": {"<value id>": <number>, ...}}',
          },
        };
      }
      case "number":
        return { data: { ...head, min: c.min, max: c.max, answerShape: '{"value": <number>}' } };
      case "text": {
        const structure = await client.structure(draftPackage(view.draft));
        const f = flowChoice(structure.flow.choices, c);
        return {
          data: {
            ...head,
            ...(f?.maxLength !== undefined ? { maxLength: f.maxLength } : {}),
            answerShape: '{"text": "..."}',
          },
        };
      }
      case "info":
        return {
          data: {
            ...head,
            note: "This choice only informs; it takes no answer.",
            ...(c.info
              ? {
                  things: (c.info.things ?? (c.info.thing ? [c.info.thing] : [])).map((t) => words.thing(t)),
                  values: (c.info.values ?? []).map((v) => ({ name: words.value(v.value), add: v.add })),
                }
              : {}),
          },
        };
    }
  },
});

function pickDetails(words: Words, c: ChoiceState, pool: { recommended?: string[] } | undefined) {
  const recommended = Array.isArray(c.recommended) ? c.recommended : [];
  return {
    ...(c.count !== undefined ? { count: c.count, ...(c.upTo ? { fewerIsFine: true } : {}) } : {}),
    ...(c.remaining !== undefined ? { remaining: c.remaining } : {}),
    ...(c.held?.length ? { alreadyHas: c.held.map((t) => words.name(t)) } : {}),
    ...(c.textsMissing?.length ? { textsMissingFor: c.textsMissing } : {}),
    ...(pool ? { sharedListStep: c.step } : {}),
    options: (c.options ?? []).map((o) => {
      const rank = recommended.indexOf(o);
      const badge = c.badges?.[o];
      const texts = words.textInputs(o);
      return {
        option: o,
        ...words.thing(o),
        ...(rank >= 0 ? { recommended: rank + 1 } : {}),
        ...(badge ? { badge: words.text(badge) ?? badge } : {}),
        ...(texts.length > 0 ? { asksForTexts: texts } : {}),
      };
    }),
    answerShape:
      (c.kind === "pickOne" ? '{"pick": "<option id>"' : '{"picks": ["<option id>", ...]') +
      ((c.options ?? []).some((o) => words.textInputs(o).length > 0)
        ? ', "texts": {"<option id>": {"<input>": "..."}}} (texts only for picked options with asksForTexts)'
        : "}"),
  };
}

/** Base64 without Node's Buffer, so the list also runs in a browser. */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function titled(words: Words, c: ChoiceState | undefined, id: string) {
  return { choice: id, title: c ? choiceTitle(words, c) : id };
}

const setAnswer = defineTool({
  name: "set_answer",
  description: T.set_answer,
  input: { characterId, choice: z.string().min(1).describe(D.choice), answer },
  async run(client, { characterId, choice, answer }) {
    const result = await client.change(
      characterId,
      "PUT",
      `/api/drafts/${enc(characterId)}/answers/${enc(choice)}`,
      { answer },
    );
    const words = await client.words(draftPackage(result.view.draft));
    const c = result.view.evaluation?.choices[choice];
    return {
      data: {
        ...changeOutcome(result, words),
        ...(result.applied && c
          ? {
              thisChoice: {
                choice,
                title: choiceTitle(words, c),
                status: c.status,
                ...(c.remaining !== undefined ? { remaining: c.remaining } : {}),
              },
            }
          : {}),
      },
    };
  },
});

const answerPool = defineTool({
  name: "answer_pool",
  description: T.answer_pool,
  input: {
    characterId,
    step: z.string().min(1).describe(D.step),
    picks: z.array(z.string()).describe(D.picks),
  },
  async run(client, { characterId, step, picks }) {
    const result = await client.change(
      characterId,
      "PUT",
      `/api/drafts/${enc(characterId)}/pools/${enc(step)}`,
      {
        picks,
      },
    );
    const words = await client.words(draftPackage(result.view.draft));
    return { data: changeOutcome(result, words) };
  },
});

const startCharacter = defineTool({
  name: "start_character",
  description: T.start_character,
  input: {
    packageId: z.string().min(1).describe(D.packageId),
    level: z.number().int().optional().describe(D.startLevel),
    extensions: z.array(z.string().min(1)).max(20).optional().describe(D.extensions),
  },
  async run(client, { packageId, level, extensions }) {
    const view = await client.json<DraftView>("POST", "/api/drafts", {
      packageId,
      ...(level !== undefined ? { level } : {}),
      ...(extensions !== undefined ? { extensions } : {}),
    });
    client.remember(view);
    return { data: standing(view, await client.words(draftPackage(view.draft))) };
  },
});

const setLevel = defineTool({
  name: "set_level",
  description: T.set_level,
  input: { characterId, level },
  async run(client, { characterId, level }) {
    const result = await client.change(characterId, "PATCH", `/api/drafts/${enc(characterId)}`, { level });
    return { data: changeOutcome(result, await client.words(draftPackage(result.view.draft))) };
  },
});

/**
 * The tracks of a character in words: each with its levels, and for the
 * next level which may be added, with the package's reason where not.
 */
function tracksInWords(tracks: NonNullable<Evaluation["tracks"]>, words: Words) {
  const reason = (id: string) => words.text(`${id}.addReason`) ?? words.name(id);
  /** The reasons for `thing`; one of a track the character already has names that track. */
  const because = (thing: string, ids: readonly string[]) =>
    ids.map((id) => (id === thing ? reason(id) : `${words.name(id)}: ${reason(id)}`));
  return {
    choice: tracks.choice,
    levels: tracks.list.map((t) => ({
      thing: t.thing,
      name: words.name(t.thing),
      levels: t.levels,
      fromLevel: t.from,
      ...(t.added ? { added: true } : { first: true }),
    })),
    nextLevel: tracks.options.map((o) => ({
      thing: o.thing,
      name: words.name(o.thing),
      allowed: o.allowed,
      ...(o.notMet ? { because: because(o.thing, o.notMet) } : {}),
    })),
    ...(tracks.unfit.length > 0
      ? {
          noLongerFits: tracks.unfit.map((id) => ({
            thing: id,
            name: words.name(id),
            because: because(id, tracks.unfitNotMet?.[id] ?? [id]),
          })),
        }
      : {}),
  };
}

const setTracks = defineTool({
  name: "set_tracks",
  description: T.set_tracks,
  input: { characterId, tracks: z.array(z.string().min(1)).max(1000).describe(D.tracks) },
  async run(client, { characterId, tracks }) {
    const result = await client.change(characterId, "PUT", `/api/drafts/${enc(characterId)}/tracks`, {
      tracks,
    });
    return { data: changeOutcome(result, await client.words(draftPackage(result.view.draft))) };
  },
});

const levelUp = defineTool({
  name: "level_up",
  description: T.level_up,
  input: {
    characterId,
    level: z.number().int().describe(D.raiseLevel),
    tracks: z.array(z.string().min(1)).max(1000).optional().describe(D.raiseTracks),
  },
  async run(client, { characterId, level, tracks }) {
    try {
      const result = await client.change(characterId, "POST", `/api/drafts/${enc(characterId)}/level-up`, {
        level,
        ...(tracks !== undefined ? { tracks } : {}),
      });
      const words = await client.words(draftPackage(result.view.draft));
      const outcome = changeOutcome(result, words);
      const up = result.view.levelUp;
      const ev = result.view.evaluation;
      if (!result.applied || !up || !ev) return { data: outcome };
      return {
        data: {
          ...outcome,
          raised: { from: up.from, to: up.to },
          // Everything open: the character was finished, so all of it comes from the raise,
          // also choices asked before that now take more picks.
          toAnswer: ev.open.map((id) => ({
            ...titled(words, ev.choices[id], id),
            ...(up.newChoices.includes(id) ? { new: true } : { morePlaces: true }),
          })),
        },
      };
    } catch (e) {
      if (e instanceof ApiError && e.code === "notFinished") {
        return failure(
          "Only a finished character can be raised. Finish it first, or change the level of an open " +
            "character with set_level.",
        );
      }
      const reason =
        e instanceof ApiError ? (e.details["reason"] as Record<string, unknown> | undefined) : undefined;
      if (reason?.["code"] === "trackNotAllowed") {
        // The package's own sentence for each condition not met, in the player's language.
        const [view, words] = await viewWithWords(client, characterId);
        const thing = String(reason["thing"]);
        const notMet = Array.isArray(reason["notMet"]) ? reason["notMet"].map(String) : [];
        return {
          isError: true,
          data: {
            message: `Nothing was saved: ${words.name(thing)} cannot be added at level ${String(reason["level"])}.`,
            because: notMet.map((id) => words.text(`${id}.addReason`) ?? words.name(id)),
            ...(evaluationOf(view).tracks
              ? { tracks: tracksInWords(evaluationOf(view).tracks!, words) }
              : {}),
          },
        };
      }
      throw e;
    }
  },
});

const finishCharacter = defineTool({
  name: "finish_character",
  description: T.finish_character,
  input: { characterId },
  async run(client, { characterId }) {
    try {
      const result = await client.change(characterId, "POST", `/api/drafts/${enc(characterId)}/finish`, {});
      return { data: changeOutcome(result, await client.words(draftPackage(result.view.draft))) };
    } catch (e) {
      if (e instanceof ApiError && e.code === "incomplete") {
        const [view, words] = await viewWithWords(client, characterId);
        const ev = evaluationOf(view);
        const unfit = ev.tracks && ev.tracks.unfit.length > 0;
        return {
          isError: true,
          data: {
            message: unfit
              ? "The character is not finished: a track no longer fits its condition (see tracks.noLongerFits)" +
                (ev.open.length > 0 ? ", and these choices still need an answer." : ".")
              : "The character is not finished: these choices still need an answer.",
            openChoices: openChoices(ev, words),
            ...(unfit ? { tracks: tracksInWords(ev.tracks!, words) } : {}),
          },
        };
      }
      throw e;
    }
  },
});

const getSheet = defineTool({
  name: "get_sheet",
  description: T.get_sheet,
  input: {
    characterId,
    as: z.enum(["data", "pdf"]).optional().describe(D.sheetAs),
    parts: z
      .array(z.enum(["sheet", "cards", "texts"]))
      .min(1)
      .optional()
      .describe(D.parts),
    design: z.enum(["verbose", "classic"]).optional().describe(D.design),
  },
  async run(client, { characterId, as, parts, design }) {
    try {
      if (as !== "pdf") {
        return { data: await client.json("GET", `/api/drafts/${enc(characterId)}/sheet`) };
      }
      const query = new URLSearchParams();
      if (parts) query.set("parts", parts.join(","));
      if (design) query.set("design", design);
      const q = query.size ? `?${query}` : "";
      const pdf = await client.file(`/api/drafts/${enc(characterId)}/pdf${q}`);
      const name = pdf.fileName ?? "character.pdf";
      return {
        data: { file: name, bytes: pdf.bytes.length, note: "The PDF is attached as a file." },
        file: { name, mimeType: pdf.mimeType, data: toBase64(pdf.bytes) },
      };
    } catch (e) {
      if (e instanceof ApiError && e.code === "notFinished") {
        const [view, words] = await viewWithWords(client, characterId);
        return {
          isError: true,
          data: {
            message: "The sheet is made for finished characters only. These choices still need an answer:",
            openChoices: openChoices(evaluationOf(view), words),
          },
        };
      }
      throw e;
    }
  },
});

/** Every tool, in the order a model meets them. */
export const TOOLS: readonly Tool[] = [
  listPackages,
  listCharacters,
  getCharacter,
  explainValue,
  listOpenChoices,
  listOptions,
  setAnswer,
  answerPool,
  startCharacter,
  setLevel,
  setTracks,
  levelUp,
  finishCharacter,
  getSheet,
];
