/**
 * Campaigns: three people on every route. The game master leads the
 * campaign, the player plays in it, the stranger has nothing to do with
 * it. The game master reaches the player's characters; the player sees
 * only their own; the stranger gets 404 everywhere, as for something
 * that does not exist. And what deleting either account leaves behind.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { Client, passwordFromMail, signIn, startTestServer, type TestServer } from "../testing.ts";

let server: TestServer;
let gm: Client;
let player: Client;
let stranger: Client;
let campaignId: string;
let playerId: string;

const GM = "lead@example.org";
const PLAYER = "player@example.org";

beforeEach(async () => {
  server = await startTestServer();
  gm = new Client(server, "203.0.113.1");
  player = new Client(server, "203.0.113.2");
  stranger = new Client(server, "203.0.113.3");
  await signIn(gm, server, GM);
  await signIn(stranger, server, "stranger@example.org");

  const made = await gm.call("POST", "/api/campaigns", { name: "Die Nebelrunde" });
  expect(made.status, JSON.stringify(made.json)).toBe(201);
  campaignId = made.json.campaign.id;

  // A new address: the invitation makes the account and mails its password.
  const added = await gm.call("POST", `/api/campaigns/${campaignId}/players`, { email: PLAYER });
  expect(added.status, JSON.stringify(added.json)).toBe(201);
  playerId = added.json.player.id;
  const password = passwordFromMail(server.mails, PLAYER);
  expect((await player.call("POST", "/api/auth/login", { email: PLAYER, password })).status).toBe(200);
});

const newDraft = async (c: Client) => {
  const res = await c.call("POST", "/api/drafts", { packageId: "demo" });
  expect(res.status).toBe(201);
  return res.json.draft as { id: string; version: number };
};

interface ChoiceState {
  id: string;
  kind: string;
  step: string;
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

describe("adding players", () => {
  it("makes an account for a new address; the password mail names who invited", async () => {
    const mail = server.mails.filter((m) => m.to === PLAYER).at(-1)!;
    expect(mail.subject).toBe("Dein Passwort für den Charakterbuilder");
    expect(mail.text).toContain(`${GM} hat dich zur Kampagne „Die Nebelrunde“ eingeladen`);
    expect(mail.text).toContain(`${GM} leitet die Kampagne`);
    expect(mail.text).toMatch(/Dein Passwort: [a-z]+(-[a-z]+){3}-\d{4}$/m);
    // No other service: the only link is the builder's own address.
    expect(mail.text.match(/https?:\/\/[^\s]+/g)).toEqual(["http://builder.test"]);

    const account = (await player.call("GET", "/api/account")).json.account;
    // The new account starts in the game master's language.
    expect(account).toMatchObject({ email: PLAYER, language: "de" });
  });

  it("takes the language given for a new account", async () => {
    const res = await gm.call("POST", `/api/campaigns/${campaignId}/players`, {
      email: "guest@example.org",
      language: "en",
    });
    expect(res.status).toBe(201);
    const mail = server.mails.at(-1)!;
    expect(mail.to).toBe("guest@example.org");
    expect(mail.text).toContain(`${GM} invited you to the campaign "Die Nebelrunde"`);
    expect(mail.text).toMatch(/Your password: /);
  });

  it("only adds an existing account: short mail naming the game master, password unchanged", async () => {
    const other = await gm.call("POST", "/api/campaigns", { name: "Zweite Runde" });
    const before = server.mails.length;
    const password = passwordFromMail(server.mails, PLAYER);

    const res = await gm.call("POST", `/api/campaigns/${other.json.campaign.id}/players`, {
      email: PLAYER.toUpperCase(),
    });
    expect(res.status).toBe(201);
    expect(res.json.player).toEqual({ id: playerId, email: PLAYER, addedAt: "2026-10-04T10:00:00.000Z" });

    expect(server.mails).toHaveLength(before + 1);
    const mail = server.mails.at(-1)!;
    expect(mail).toMatchObject({ to: PLAYER, subject: "Du bist jetzt in einer Kampagne" });
    expect(mail.text).toContain(`${GM} hat dich zur Kampagne „Zweite Runde“ hinzugefügt.`);
    expect(mail.text).not.toMatch(/Passwort:/);
    expect(mail.text.match(/https?:\/\/[^\s]+/g)).toEqual(["http://builder.test"]);
    // The old password still works.
    const again = new Client(server, "203.0.113.9");
    expect((await again.call("POST", "/api/auth/login", { email: PLAYER, password })).status).toBe(200);
  });

  it("refuses the game master, someone already in, and names with line breaks", async () => {
    const self = await gm.call("POST", `/api/campaigns/${campaignId}/players`, { email: GM });
    expect(self.status).toBe(422);
    expect(self.json.error.code).toBe("cannotAddYourself");
    const twice = await gm.call("POST", `/api/campaigns/${campaignId}/players`, { email: PLAYER });
    expect(twice.status).toBe(409);
    expect(twice.json.error.code).toBe("alreadyPlayer");
    expect((await gm.call("POST", "/api/campaigns", { name: "a\nb" })).status).toBe(400);
    expect((await gm.call("POST", "/api/campaigns", { name: "   " })).status).toBe(400);
  });

  it("stores nothing when the mail cannot be sent", async () => {
    server.failMail.on = true;
    const res = await gm.call("POST", `/api/campaigns/${campaignId}/players`, { email: "late@example.org" });
    expect(res.status).toBe(502);
    expect(await server.db.query("SELECT 1 FROM accounts WHERE email = 'late@example.org'")).toEqual([]);
    expect((await gm.call("GET", `/api/campaigns/${campaignId}`)).json.players).toHaveLength(1);
  });
});

describe("who sees what", () => {
  it("lists campaigns: the game master leads, the player plays, the stranger sees none", async () => {
    const lead = (await gm.call("GET", "/api/campaigns")).json.campaigns;
    expect(lead).toEqual([
      {
        id: campaignId,
        name: "Die Nebelrunde",
        role: "gameMaster",
        gameMaster: { email: GM },
        playerCount: 1,
        createdAt: "2026-10-04T10:00:00.000Z",
      },
    ]);
    const plays = (await player.call("GET", "/api/campaigns")).json.campaigns;
    expect(plays).toEqual([{ ...lead[0], role: "player" }]);
    expect((await stranger.call("GET", "/api/campaigns")).json.campaigns).toEqual([]);
  });

  it("shows a campaign: players and characters to the game master, nothing of others to the player", async () => {
    const mine = await newDraft(player);
    const view = (await gm.call("GET", `/api/campaigns/${campaignId}`)).json;
    expect(view.players).toMatchObject([
      {
        id: playerId,
        email: PLAYER,
        characters: [{ id: mine.id, access: "gameMaster", owner: { email: PLAYER } }],
      },
    ]);
    const asPlayer = await player.call("GET", `/api/campaigns/${campaignId}`);
    expect(asPlayer.status).toBe(200);
    expect(asPlayer.json).toEqual({ campaign: expect.objectContaining({ role: "player" }), players: null });

    const asStranger = await stranger.call("GET", `/api/campaigns/${campaignId}`);
    expect(asStranger.status).toBe(404);
    expect(asStranger.json.error.code).toBe("campaignNotFound");
  });

  it("checks every campaign route for all three", async () => {
    const c = `/api/campaigns/${campaignId}`;
    const expectations: [string, string, unknown, number, number][] = [
      // method, path, body, player, stranger
      ["PATCH", c, { name: "Neu" }, 403, 404],
      ["POST", `${c}/players`, { email: "x@example.org" }, 403, 404],
      ["POST", `${c}/players/${playerId}/drafts`, { packageId: "demo" }, 403, 404],
      ["DELETE", `${c}/players/${playerId}`, undefined, 204, 404],
      ["DELETE", c, undefined, 403, 404],
    ];
    for (const [method, path, body, , asStranger] of expectations) {
      const s = await stranger.call(method, path, body);
      expect(s.status, `stranger ${method} ${path}`).toBe(asStranger);
      if (asStranger === 404) expect(s.json.error.code).toBe("campaignNotFound");
    }
    for (const [method, path, body, asPlayer] of expectations.filter((e) => e[3] !== 204)) {
      const p = await player.call(method, path, body);
      expect(p.status, `player ${method} ${path}`).toBe(asPlayer);
      expect(p.json.error.code).toBe("gameMasterOnly");
    }
    // A player removes only themselves.
    const other = await gm.call("POST", `${c}/players`, { email: "second@example.org" });
    const removeOther = await player.call("DELETE", `${c}/players/${other.json.player.id}`);
    expect(removeOther.status).toBe(403);

    // The game master can do all of it.
    expect((await gm.call("PATCH", c, { name: "Neu" })).json.campaign.name).toBe("Neu");
    const made = await gm.call("POST", `${c}/players/${playerId}/drafts`, { packageId: "demo", level: 2 });
    expect(made.status).toBe(201);
    expect(made.json.draft).toMatchObject({ level: 2, access: "gameMaster", owner: { email: PLAYER } });
    expect((await gm.call("DELETE", `${c}/players/${other.json.player.id}`)).status).toBe(204);
    expect((await gm.call("DELETE", `${c}/players/${other.json.player.id}`)).status).toBe(404);
    expect(
      (await gm.call("POST", `${c}/players/${other.json.player.id}/drafts`, { packageId: "demo" })).status,
    ).toBe(404);
    expect((await gm.call("DELETE", c)).status).toBe(204);
    expect((await gm.call("GET", c)).status).toBe(404);
  });

  it("checks every draft route for all three on a player's character", async () => {
    const d = await newDraft(player);
    const p = `/api/drafts/${d.id}`;

    // The stranger: 404 on everything, as if it did not exist.
    for (const [method, path, body] of [
      ["GET", p, undefined],
      ["PATCH", p, { version: 1, level: 2 }],
      ["PUT", `${p}/answers/name`, { version: 1, answer: { text: "X" } }],
      ["PUT", `${p}/pools/talents`, { version: 1, picks: [] }],
      ["POST", `${p}/finish`, { version: 1 }],
      ["POST", `${p}/level-up`, { version: 1, level: 2 }],
      ["GET", `${p}/pdf`, undefined],
      ["GET", `${p}/sheet`, undefined],
      ["DELETE", p, undefined],
    ] as const) {
      const res = await stranger.call(method, path, body);
      expect(res.status, `stranger ${method} ${path}`).toBe(404);
      expect(res.json.error.code).toBe("draftNotFound");
    }
    expect((await stranger.call("GET", "/api/drafts")).json.drafts).toEqual([]);

    // The game master opens and changes it; it stays the player's.
    const opened = await gm.call("GET", p);
    expect(opened.status).toBe(200);
    expect(opened.json.draft).toMatchObject({ access: "gameMaster", owner: { email: PLAYER } });
    const changed = await gm.call("PUT", `${p}/answers/name`, {
      version: 1,
      answer: { text: "Von der Leitung" },
    });
    expect(changed.status).toBe(200);
    const level = await gm.call("PATCH", p, { version: 2, level: 2 });
    expect(level.status).toBe(200);
    // Not in the game master's own list, and only the owner deletes.
    expect((await gm.call("GET", "/api/drafts")).json.drafts).toEqual([]);
    const del = await gm.call("DELETE", p);
    expect(del.status).toBe(403);
    expect(del.json.error.code).toBe("ownerOnly");

    // The player sees the change, as owner.
    const own = await player.call("GET", p);
    expect(own.json.draft).toMatchObject({
      version: 3,
      level: 2,
      access: "owner",
      owner: { email: PLAYER },
      answers: { name: { text: "Von der Leitung" } },
    });
    expect((await player.call("DELETE", p)).status).toBe(204);
  });

  it("keeps the game master's own characters from the player", async () => {
    const gmOwn = await newDraft(gm);
    for (const c of [player, stranger]) {
      expect((await c.call("GET", `/api/drafts/${gmOwn.id}`)).status).toBe(404);
      expect((await c.call("PATCH", `/api/drafts/${gmOwn.id}`, { version: 1, level: 2 })).status).toBe(404);
    }
  });

  it("lets the game master build a character for a player from empty to PDF", async () => {
    const made = await gm.call("POST", `/api/campaigns/${campaignId}/players/${playerId}/drafts`, {
      packageId: "demo",
      level: 3,
    });
    let view = made.json;
    const id: string = view.draft.id;
    for (let guard = 0; view.evaluation.open.length > 0; guard++) {
      expect(guard).toBeLessThan(80);
      const choice: ChoiceState = view.evaluation.choices[view.evaluation.open[0]];
      const step = view.evaluation.steps.find((s: { id: string }) => s.id === choice.step);
      const res = step.pool
        ? await gm.call("PUT", `/api/drafts/${id}/pools/${step.id}`, {
            version: view.draft.version,
            picks: step.pool.recommended,
          })
        : await gm.call("PUT", `/api/drafts/${id}/answers/${encodeURIComponent(choice.id)}`, {
            version: view.draft.version,
            answer: answerFor(choice),
          });
      expect(res.status, `${choice.id}: ${JSON.stringify(res.json)}`).toBe(200);
      view = res.json;
    }
    const done = await gm.call("POST", `/api/drafts/${id}/finish`, { version: view.draft.version });
    expect(done.json.draft).toMatchObject({ status: "finished", owner: { email: PLAYER } });
    const pdf = await gm.request("GET", `/api/drafts/${id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    const sheet = await gm.call("GET", `/api/drafts/${id}/sheet`);
    expect(sheet.status).toBe(200);
    expect(sheet.json.origin).toMatchObject({ kind: "original", level: 3 });
    const up = await gm.call("POST", `/api/drafts/${id}/level-up`, {
      version: done.json.draft.version,
      level: 4,
    });
    expect(up.status).toBe(200);

    // It is the player's: in their list, printable by them.
    expect((await player.call("GET", "/api/drafts")).json.drafts).toMatchObject([{ id, access: "owner" }]);
  });

  it("ends the game master's reach the moment a player is removed or leaves", async () => {
    const d = await newDraft(player);
    expect((await gm.call("GET", `/api/drafts/${d.id}`)).status).toBe(200);
    expect((await player.call("DELETE", `/api/campaigns/${campaignId}/players/me`)).status).toBe(204);
    expect((await gm.call("GET", `/api/drafts/${d.id}`)).status).toBe(404);
    expect((await player.call("GET", `/api/campaigns/${campaignId}`)).status).toBe(404);
    // The character stays with the player.
    expect((await player.call("GET", `/api/drafts/${d.id}`)).status).toBe(200);

    await gm.call("POST", `/api/campaigns/${campaignId}/players`, { email: PLAYER });
    expect((await gm.call("GET", `/api/drafts/${d.id}`)).status).toBe(200);
    expect((await gm.call("DELETE", `/api/campaigns/${campaignId}/players/${playerId}`)).status).toBe(204);
    expect((await gm.call("GET", `/api/drafts/${d.id}`)).status).toBe(404);
  });

  it("gives an access key the same rights as the screen", async () => {
    const d = await newDraft(player);
    const key = (await gm.call("POST", "/api/account/keys", {})).json.key.secret;
    const res = await server.fetch(
      new Request(`http://builder.test/api/drafts/${d.id}`, { headers: { authorization: `Bearer ${key}` } }),
    );
    expect(res.status).toBe(200);
    const list = await server.fetch(
      new Request(`http://builder.test/api/campaigns/${campaignId}`, {
        headers: { authorization: `Bearer ${key}` },
      }),
    );
    expect((await list.json()).players).toHaveLength(1);
  });
});

describe("deleting an account", () => {
  it("a player: their characters and places go, the campaign stays", async () => {
    const d = await newDraft(player);
    const gmOwn = await newDraft(gm);
    expect((await player.call("DELETE", "/api/account", { confirm: true })).status).toBe(204);

    expect(await server.db.query("SELECT 1 FROM drafts WHERE id = $1", [d.id])).toEqual([]);
    expect(await server.db.query("SELECT 1 FROM campaign_players")).toEqual([]);
    const view = (await gm.call("GET", `/api/campaigns/${campaignId}`)).json;
    expect(view.campaign).toMatchObject({ name: "Die Nebelrunde", playerCount: 0 });
    expect(view.players).toEqual([]);
    expect((await gm.call("GET", `/api/drafts/${gmOwn.id}`)).status).toBe(200);
  });

  it("a game master: campaigns and player lists go, the players keep their characters", async () => {
    const d = await newDraft(player);
    const forPlayer = (
      await gm.call("POST", `/api/campaigns/${campaignId}/players/${playerId}/drafts`, { packageId: "demo" })
    ).json.draft;
    expect((await gm.call("DELETE", "/api/account", { confirm: true })).status).toBe(204);

    expect(await server.db.query("SELECT 1 FROM campaigns")).toEqual([]);
    expect(await server.db.query("SELECT 1 FROM campaign_players")).toEqual([]);
    expect((await player.call("GET", "/api/campaigns")).json.campaigns).toEqual([]);
    const own = (await player.call("GET", "/api/drafts")).json.drafts.map((x: { id: string }) => x.id);
    expect(own.sort()).toEqual([d.id, forPlayer.id].sort());
  });
});
