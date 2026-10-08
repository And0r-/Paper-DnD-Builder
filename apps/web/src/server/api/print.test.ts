import { renderPdf } from "@builder/print";
import { sheetFields, sheetModelSchema, type PrintPart, type SheetModel } from "@builder/sheet";
import { beforeEach, describe, expect, it } from "vitest";
import { Client, signIn, startTestServer, type TestServer } from "../testing.ts";
import { fileNames } from "./routes/print.ts";

let server: TestServer;
let client: Client;

beforeEach(async () => {
  server = await startTestServer();
  client = new Client(server);
  await signIn(client, "player@example.org", "de");
});

interface ChoiceState {
  id: string;
  kind: string;
  status: string;
  optional: boolean;
  options?: string[];
  count?: number;
  min?: number;
  recommended?: unknown;
}

function answerFor(c: ChoiceState): unknown {
  switch (c.kind) {
    case "pickOne":
      return { pick: (c.recommended as string[] | undefined)?.[0] ?? c.options![0] };
    case "pickMany": {
      const rec = (c.recommended as string[] | undefined) ?? [];
      return { picks: rec.length === c.count ? rec : c.options!.slice(0, c.count) };
    }
    case "distribute":
      return c.recommended;
    case "number":
      return { value: c.min };
    case "text":
      return { text: "Mira Fennwick" };
  }
  throw new Error(`no answer for ${c.kind}`);
}

/** A demo character (level 3 unless told), answered step by step over the API; finished unless told otherwise. */
async function character(finish = true, level = 3): Promise<string> {
  let view = (await client.call("POST", "/api/drafts", { packageId: "demo", level })).json;
  const id: string = view.draft.id;
  for (let guard = 0; guard < 300 && !view.evaluation.complete; guard++) {
    const open = view.evaluation.steps
      .flatMap((s: { choices: string[] }) => s.choices)
      .map((c: string) => view.evaluation.choices[c] as ChoiceState)
      .find((c: ChoiceState) => !c.optional && c.status !== "answered" && c.status !== "info")!;
    view = (
      await client.call("PUT", `/api/drafts/${id}/answers/${open.id}`, {
        version: view.draft.version,
        answer: answerFor(open),
      })
    ).json;
  }
  if (finish) await client.call("POST", `/api/drafts/${id}/finish`, { version: view.draft.version });
  return id;
}

const latin1 = async (res: Response) => Buffer.from(await res.arrayBuffer()).toString("latin1");

describe("file names", () => {
  it("say the design, and the fallback shortens only the character's name, at a word's end", () => {
    expect(fileNames(["Mira", "Klassisch", "Bogen, Karten"])).toBe(
      `attachment; filename="Mira-Klassisch-Bogen-Karten.pdf"; filename*=UTF-8''${encodeURIComponent("Mira - Klassisch - Bogen, Karten.pdf")}`,
    );
    const long = "Hesper Laternenträgerin vom Nebelmoor-Ufer";
    const header = fileNames([long, "Fassung 7. Oktober 13-15", "Classic", "Sheet"]);
    expect(header).toContain(
      'filename="Hesper-Laternentragerin-vom-Nebelmoor-Fassung-7-Oktober-13-15-Classic-Sheet.pdf"',
    );
    expect(header).toContain(encodeURIComponent(`${long} - Fassung 7. Oktober 13-15 - Classic - Sheet.pdf`));
  });
});

describe("printing a character", () => {
  it("gives a finished character as PDF, in the account's language", async () => {
    const id = await character();
    const res = await client.request("GET", `/api/drafts/${id}/pdf`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toBe(
      `attachment; filename="Mira-Fennwick.pdf"; filename*=UTF-8''Mira%20Fennwick.pdf`,
    );
    const pdf = await latin1(res);
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf).toContain("/Lang (de)");

    // Switching the language switches the whole document.
    await client.call("PATCH", "/api/account/settings", { language: "en" });
    const en = await latin1(await client.request("GET", `/api/drafts/${id}/pdf`));
    expect(en).toContain("/Lang (en)");
  });

  it("refuses a character that is not finished", async () => {
    const id = await character(false);
    const res = await client.call("GET", `/api/drafts/${id}/pdf`);
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("notFinished");
  });

  it("prints only your own characters, and only when logged in", async () => {
    const id = await character();
    const other = new Client(server, "198.51.100.9");
    await signIn(other, "someone-else@example.org");
    expect((await other.call("GET", `/api/drafts/${id}/pdf`)).status).toBe(404);
    expect((await new Client(server).call("GET", `/api/drafts/${id}/pdf`)).status).toBe(401);
  });

  it("limits how many PDFs one account makes in a short time", async () => {
    const id = await character();
    const account = (await server.db.query<{ id: string }>("SELECT id FROM accounts"))[0]!.id;
    for (let i = 0; i < 20; i++)
      server.app.limiter.record(`pdf:account:${account}`, { max: 20, windowMs: 600_000 });
    const res = await client.call("GET", `/api/drafts/${id}/pdf`);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).not.toBeNull();
  });
});

describe("where the PDF breaks the sheet's pages", () => {
  it("names each section's page and column for the screen, as the PDF of the sheet has them", async () => {
    const id = await character(true, 20);
    const model = (await client.call("GET", `/api/drafts/${id}/sheet`)).json as SheetModel;
    const res = await client.call("POST", `/api/drafts/${id}/sheet-places`, { model, design: "verbose" });
    expect(res.status).toBe(200);
    const pdf = await renderPdf(model, { parts: ["sheet"], design: "verbose" });
    expect(res.json.pages).toBe(pdf.sheetPages);
    expect(res.json.sections).toHaveLength(model.sections.length);
    expect(res.json.sections[0]).toEqual({ page: 0, col: 0, cols: [0] });

    expect((await client.call("POST", `/api/drafts/${id}/sheet-places`, { model, design: "x" })).status).toBe(
      400,
    );
    expect(
      (await client.call("POST", `/api/drafts/${id}/sheet-places`, { model: {}, design: "verbose" })).status,
    ).toBe(400);
    expect(
      (await new Client(server).call("POST", `/api/drafts/${id}/sheet-places`, { model, design: "verbose" }))
        .status,
    ).toBe(401);
  });
});

describe("the parts of a printout", () => {
  const bytes = async (res: Response) => Buffer.from(await res.arrayBuffer());

  it("gives a level 20 character's sheet, cards and rules texts as three files, and both as before without parts", async () => {
    const id = await character(true, 20);
    const model = (await client.call("GET", `/api/drafts/${id}/sheet`)).json as SheetModel;
    expect(model.level).toBe(20);
    expect(model.cards.length).toBeGreaterThan(0);
    const local = async (parts?: PrintPart[]) =>
      Buffer.from((await renderPdf(model, parts ? { parts } : {})).bytes);

    // Each part on its own, exactly what the print package makes of the sheet model.
    const files: Record<string, Buffer> = {};
    for (const [part, word] of [
      ["sheet", "Bogen"],
      ["cards", "Karten"],
      ["texts", "Regeltexte"],
    ] as const) {
      const res = await client.request("GET", `/api/drafts/${id}/pdf?parts=${part}`);
      expect(res.status, part).toBe(200);
      // The design is named where the sheet is in the file.
      const named = part === "sheet" ? ["Ausführlich", word] : [word];
      expect(res.headers.get("content-disposition")).toBe(
        `attachment; filename="${["Mira-Fennwick", ...named].join("-").replace("ü", "u")}.pdf"; filename*=UTF-8''${encodeURIComponent(["Mira Fennwick", ...named].join(" - ") + ".pdf")}`,
      );
      files[part] = await bytes(res);
      expect(files[part].equals(await local([part])), part).toBe(true);
    }
    expect(new Set(Object.values(files).map((f) => f.toString("base64"))).size).toBe(3);

    // Without parts: the sheet and the cards, the file it was before there were parts.
    const plain = await client.request("GET", `/api/drafts/${id}/pdf`);
    expect(plain.headers.get("content-disposition")).toContain('filename="Mira-Fennwick.pdf"');
    const before = await bytes(plain);
    expect(before.equals(await local(["sheet", "cards"]))).toBe(true);
    expect(before.equals(await local())).toBe(true);

    // Several parts in one file, always in the order sheet, cards, rules texts.
    const all = await client.request(
      "GET",
      `/api/drafts/${id}/pdf?parts=texts,sheet,cards&design=verbose&version=original&state=empty`,
    );
    expect(all.status).toBe(200);
    expect(all.headers.get("content-disposition")).toContain(
      "Mira%20Fennwick%20-%20Ausf%C3%BChrlich%20-%20Bogen%2C%20Karten%2C%20Regeltexte.pdf",
    );
    expect((await bytes(all)).equals(await local(["sheet", "cards", "texts"]))).toBe(true);

    // Another design: a folder in the sheet package, nothing else changed here.
    const classic = await client.request("GET", `/api/drafts/${id}/pdf?parts=sheet&design=classic`);
    expect(classic.status).toBe(200);
    expect(
      (await bytes(classic)).equals(
        Buffer.from((await renderPdf(model, { parts: ["sheet"], design: "classic" })).bytes),
      ),
    ).toBe(true);
  });

  it("refuses parts, designs and states it does not know, and copies it does not have", async () => {
    const id = await character();
    const code = async (query: string) => {
      const res = await client.call("GET", `/api/drafts/${id}/pdf?${query}`);
      return [res.status, res.json?.error?.code];
    };
    expect(await code("parts=")).toEqual([400, "badQuery"]);
    expect(await code("parts=sheet,poster")).toEqual([400, "badQuery"]);
    expect(await code("design=fancy")).toEqual([400, "badQuery"]);
    expect(await code("state=half")).toEqual([400, "badQuery"]);
    expect(await code("tz=Mars/Olympus")).toEqual([400, "badQuery"]);
    expect(await code("version=0b0f0c3e-1d5a-4a8e-9f00-000000000000")).toEqual([404, "versionNotFound"]);
    expect(await code("version=copy-1")).toEqual([404, "versionNotFound"]);
    // None of these used up the PDF limit.
    const account = (await server.db.query<{ id: string }>("SELECT id FROM accounts"))[0]!.id;
    expect(server.app.limiter.take(`pdf:account:${account}`, { max: 1, windowMs: 600_000 }).ok).toBe(true);
  });

  it("lists the designs to choose from, with names in every screen language, without a login", async () => {
    const res = await new Client(server).call("GET", "/api/sheet-designs");
    expect(res.status).toBe(200);
    expect(res.json).toEqual({
      default: "verbose",
      designs: [
        {
          id: "verbose",
          name: { de: "Ausführlich", en: "Detailed" },
          description: { de: expect.any(String), en: expect.any(String) },
        },
        {
          id: "classic",
          name: { de: "Klassisch", en: "Classic" },
          description: { de: expect.any(String), en: expect.any(String) },
        },
      ],
    });
  });
});

describe("printing a kept copy and the play state", () => {
  const bytes = async (res: Response) => Buffer.from(await res.arrayBuffer());

  it("prints a copy as kept, in its own language and units, with the original's cards and rules texts", async () => {
    const id = await character(true, 3);
    const original = (await client.call("GET", `/api/drafts/${id}/sheet`)).json as SheetModel;
    // The player's own row in a copy; it has no card and no rules text.
    const own: SheetModel = {
      ...original,
      sections: original.sections.map((s) =>
        s.kind === "featureTable" && s.id === "traits"
          ? {
              ...s,
              rows: [
                ...s.rows,
                {
                  id: "own-1",
                  name: "Moorlicht",
                  marks: "",
                  text: "Leuchtet im Nebel.",
                  uses: null,
                  group: null,
                },
              ],
            }
          : s,
      ),
    };
    const made = (await client.call("POST", `/api/drafts/${id}/sheet-copies`, { model: own })).json;
    const copyId: string = made.copy.id;
    // The account switches to English with feet; the copy stays German with meters.
    await client.call("PATCH", "/api/account/settings", { language: "en", units: { length: "ft" } });

    // Named as on the screen, by the minute it was made, in the reader's time zone (10:00 UTC);
    // the file name says it too, so the copy is not taken for the original.
    const sheet = await client.request(
      "GET",
      `/api/drafts/${id}/pdf?parts=sheet&version=${copyId}&tz=Europe%2FZurich`,
    );
    expect(sheet.status).toBe(200);
    expect(sheet.headers.get("content-disposition")).toBe(
      `attachment; filename="Mira-Fennwick-Fassung-4-Oktober-12-00-Ausfuhrlich-Bogen.pdf"; filename*=UTF-8''${encodeURIComponent("Mira Fennwick - Fassung 4. Oktober 12-00 - Ausführlich - Bogen.pdf")}`,
    );
    const stored = made.model as SheetModel;
    if (stored.origin.kind !== "copy") throw new Error("not a copy");
    const kept: SheetModel = {
      ...stored,
      origin: { ...stored.origin, name: "Meine Fassung vom 4. Oktober, 12:00" },
    };
    const sheetBytes = await bytes(sheet);
    expect(sheetBytes.equals(Buffer.from((await renderPdf(kept, { parts: ["sheet"] })).bytes))).toBe(true);
    expect(sheetBytes.toString("latin1")).toContain("/Lang (de)");

    // Cards and rules texts are the original's, in the copy's language and units.
    const all = await client.request(
      "GET",
      `/api/drafts/${id}/pdf?parts=sheet,cards,texts&version=${copyId}&tz=Europe%2FZurich`,
    );
    expect(all.status).toBe(200);
    expect(all.headers.get("content-disposition")).toContain("Bogen%2C%20Karten%2C%20Regeltexte");
    await client.call("PATCH", "/api/account/settings", { language: "de", units: { length: "m" } });
    const now = (await client.call("GET", `/api/drafts/${id}/sheet`)).json as SheetModel;
    const expected = await renderPdf(
      { ...kept, cards: now.cards, rulesTexts: now.rulesTexts },
      { parts: ["sheet", "cards", "texts"] },
    );
    expect((await bytes(all)).equals(Buffer.from(expected.bytes))).toBe(true);
    expect(now.rulesTexts.flatMap((g) => g.entries.map((e) => e.id))).not.toContain("own-1");
  });

  it("prints a copy's sheet even when the character is no longer finished, but not its cards", async () => {
    const id = await character(true, 3);
    const made = (await client.call("POST", `/api/drafts/${id}/sheet-copies`, {})).json;
    // Back to a draft: a level up leaves choices open.
    const draft = (await client.call("GET", `/api/drafts/${id}`)).json;
    const raised = await client.call("POST", `/api/drafts/${id}/level-up`, {
      version: draft.draft.version,
      level: 4,
    });
    expect(raised.status).toBe(200);
    expect((await client.call("GET", `/api/drafts/${id}/pdf?parts=sheet`)).json.error.code).toBe(
      "notFinished",
    );
    expect(
      (await client.request("GET", `/api/drafts/${id}/pdf?parts=sheet&version=${made.copy.id}`)).status,
    ).toBe(200);
    const cards = await client.call("GET", `/api/drafts/${id}/pdf?parts=cards&version=${made.copy.id}`);
    expect([cards.status, cards.json.error.code]).toEqual([409, "notFinished"]);
  });

  it("fills in the play state only when asked, for the original and a copy alike", async () => {
    const id = await character(true, 3);
    const model = (await client.call("GET", `/api/drafts/${id}/sheet`)).json as SheetModel;
    const play = { "sheet/primary/stamina": 7, "sheet/notes/notes": "Zwei Münzen beim Fährmann" };
    expect((await client.call("PUT", `/api/drafts/${id}/state`, { version: 0, state: play })).status).toBe(
      200,
    );

    const empty = await bytes(await client.request("GET", `/api/drafts/${id}/pdf?parts=sheet`));
    expect(empty.equals(Buffer.from((await renderPdf(model, { parts: ["sheet"] })).bytes))).toBe(true);
    const filled = await client.request("GET", `/api/drafts/${id}/pdf?parts=sheet&state=filled`);
    expect(filled.status).toBe(200);
    const local = await renderPdf(model, { parts: ["sheet"], play });
    expect((await bytes(filled)).equals(Buffer.from(local.bytes))).toBe(true);
    expect(local.fields.find((f) => f.id === "sheet/primary/stamina")).toMatchObject({ text: "7" });

    const made = (await client.call("POST", `/api/drafts/${id}/sheet-copies`, {})).json;
    const copy = await client.request(
      "GET",
      `/api/drafts/${id}/pdf?parts=sheet&state=filled&version=${made.copy.id}&tz=UTC`,
    );
    const stored = made.model as SheetModel;
    if (stored.origin.kind !== "copy") throw new Error("not a copy");
    const named = { ...stored, origin: { ...stored.origin, name: "Meine Fassung vom 4. Oktober, 10:00" } };
    const kept = await renderPdf(named, { parts: ["sheet"], play });
    expect((await bytes(copy)).equals(Buffer.from(kept.bytes))).toBe(true);
  });

  it("prints no copy of someone else's character", async () => {
    const id = await character();
    const made = (await client.call("POST", `/api/drafts/${id}/sheet-copies`, {})).json;
    const other = new Client(server, "198.51.100.9");
    await signIn(other, "someone-else@example.org");
    const mine = await character();
    expect((await other.call("GET", `/api/drafts/${id}/pdf?version=${made.copy.id}`)).status).toBe(404);
    // A copy of one character is not a version of another.
    const res = await client.call("GET", `/api/drafts/${mine}/pdf?version=${made.copy.id}`);
    expect([res.status, res.json.error.code]).toEqual([404, "versionNotFound"]);
  });
});

describe("the sheet as data", () => {
  it("gives a finished character's sheet model, in the account's language and units", async () => {
    const id = await character();
    const res = await client.call("GET", `/api/drafts/${id}/sheet`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(sheetModelSchema.safeParse(res.json).error?.issues ?? []).toEqual([]);
    expect(res.json).toMatchObject({
      language: "de",
      name: "Mira Fennwick",
      level: 3,
      packageId: "demo",
      origin: { kind: "original", level: 3 },
      units: { length: "m" },
    });
    expect(sheetFields(res.json)).toContain("sheet/primary/stamina");
    // A knack picked from the calling carries the numbers it is used with, by where it came from.
    expect(res.json.cards[0].origin).toEqual({
      label: "Laternenträgerin",
      value: expect.stringMatching(/^Ziel \d+ · Treffer [+-]\d+$/u),
    });

    await client.call("PATCH", "/api/account/settings", { language: "en", units: { length: "ft" } });
    const en = (await client.call("GET", `/api/drafts/${id}/sheet`)).json;
    expect(en).toMatchObject({ language: "en", units: { length: "ft" } });
    // The same places, whatever the language.
    expect(sheetFields(en).sort()).toEqual(sheetFields(res.json).sort());
  });

  it("refuses a character that is not finished, someone else's, and anyone not logged in", async () => {
    const open = await character(false);
    const res = await client.call("GET", `/api/drafts/${open}/sheet`);
    expect(res.status).toBe(409);
    expect(res.json.error.code).toBe("notFinished");

    const id = await character();
    const other = new Client(server, "198.51.100.9");
    await signIn(other, "someone-else@example.org");
    expect((await other.call("GET", `/api/drafts/${id}/sheet`)).status).toBe(404);
    expect((await new Client(server).call("GET", `/api/drafts/${id}/sheet`)).status).toBe(401);
  });

  it("is not held back by the PDF's limit", async () => {
    const id = await character();
    const account = (await server.db.query<{ id: string }>("SELECT id FROM accounts"))[0]!.id;
    for (let i = 0; i < 20; i++)
      server.app.limiter.record(`pdf:account:${account}`, { max: 20, windowMs: 600_000 });
    expect((await client.call("GET", `/api/drafts/${id}/sheet`)).status).toBe(200);
  });
});
