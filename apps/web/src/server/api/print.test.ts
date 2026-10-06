import { renderPdf } from "@builder/print";
import { sheetFields, sheetModelSchema, type PrintPart, type SheetModel } from "@builder/sheet";
import { beforeEach, describe, expect, it } from "vitest";
import { Client, signIn, startTestServer, type TestServer } from "../testing.ts";

let server: TestServer;
let client: Client;

beforeEach(async () => {
  server = await startTestServer();
  client = new Client(server);
  await signIn(client, server, "player@example.org", "de");
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
    await signIn(other, server, "someone-else@example.org");
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
      expect(res.headers.get("content-disposition")).toBe(
        `attachment; filename="Mira-Fennwick-${word}.pdf"; filename*=UTF-8''${encodeURIComponent(`Mira Fennwick - ${word}.pdf`)}`,
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
      "Mira%20Fennwick%20-%20Bogen%2C%20Karten%2C%20Regeltexte.pdf",
    );
    expect((await bytes(all)).equals(await local(["sheet", "cards", "texts"]))).toBe(true);
  });

  it("refuses parts, designs and states it does not know or does not draw yet, and copies it does not have", async () => {
    const id = await character();
    const code = async (query: string) => {
      const res = await client.call("GET", `/api/drafts/${id}/pdf?${query}`);
      return [res.status, res.json?.error?.code];
    };
    expect(await code("parts=")).toEqual([400, "badQuery"]);
    expect(await code("parts=sheet,poster")).toEqual([400, "badQuery"]);
    expect(await code("design=fancy")).toEqual([400, "badQuery"]);
    // Planned: the classic design and the play state come with later parts of the sheet work.
    expect(await code("design=classic")).toEqual([400, "designNotAvailable"]);
    expect(await code("state=filled")).toEqual([400, "stateNotAvailable"]);
    expect(await code("state=half")).toEqual([400, "badQuery"]);
    expect(await code("version=0b0f0c3e-1d5a-4a8e-9f00-000000000000")).toEqual([404, "versionNotFound"]);
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
      ],
    });
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
    await signIn(other, server, "someone-else@example.org");
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
