import { evaluateDraft } from "@builder/core";
import { DEMO_PACKAGE_DIR } from "@builder/demo-package";
import { validatePackageDir } from "@builder/format";
import { describe, expect, it } from "vitest";
import { translator } from "../i18n/index.ts";
import { stepTitle } from "./flow/model.ts";
import {
  choiceTexts,
  distributeMethodLabels,
  grantedValue,
  isYesNoValue,
  measureContext,
  plain,
  stepTexts,
  thingHint,
} from "./package-text.ts";
import type { LoadedPackage } from "./packages.ts";

const de = translator("de");
const en = translator("en");

describe("names of the ways to distribute", () => {
  it("never shows two buttons with the same text for several fixed rows", () => {
    const methods = [
      { method: "array" as const, values: [2, 1, 0] },
      { method: "array" as const, values: [1, 1, 1] },
    ];
    const labels = distributeMethodLabels(methods, "de", de.t, de.list);
    expect(labels).toEqual(["Zahlen 2 und 1 vergeben", "Zahlen 1, 1 und 1 vergeben"]);
    expect(new Set(labels).size).toBe(labels.length);
    expect(distributeMethodLabels(methods, "en", en.t, en.list)).toEqual([
      "Give out 2 and 1",
      "Give out 1, 1 and 1",
    ]);
  });

  it("keeps the short names when they are already different", () => {
    const methods = [{ method: "pointBuy" as const }, { method: "array" as const, values: [8, 7, 7, 6] }];
    expect(distributeMethodLabels(methods, "de", de.t, de.list)).toEqual([
      "Punkte verteilen",
      "Feste Zahlen zuordnen",
    ]);
  });
});

describe("what you get", () => {
  const lp = {
    lang: "de",
    texts: { "value.trained.name": "Geübt im Klettern", "value.stamina.name": "Ausdauer" },
    pkg: {
      units: [],
      values: [
        { id: "trained", source: "s", default: 0, max: 1 },
        { id: "stamina", source: "s", default: 4 },
        { id: "capped", source: "s", min: 0, max: 1, formula: "1" },
      ],
    },
  } as unknown as LoadedPackage;
  const ctx = measureContext(lp, undefined);

  it("shows a yes/no value by its name only, without +1", () => {
    expect(isYesNoValue(lp, "trained")).toBe(true);
    expect(grantedValue(lp, ctx, "trained", 1)).toBe("Geübt im Klettern");
  });

  it("keeps the number for real numbers", () => {
    expect(isYesNoValue(lp, "stamina")).toBe(false);
    expect(isYesNoValue(lp, "capped")).toBe(false);
    expect(grantedValue(lp, ctx, "stamina", 15)).toBe("Ausdauer +15");
  });
});

describe("one sentence about a thing (AND-87)", () => {
  const lp = {
    lang: "de",
    texts: {
      "a.short": "Kurz gesagt.",
      "a.explain.what": "Lang. Und länger.",
      "b.explain.what": "Erster Satz. Zweiter Satz.",
      "c.explain.what": "Ohne Punkt",
    },
    pkg: { units: [] },
  } as unknown as LoadedPackage;
  const ctx = measureContext(lp, undefined);

  it("takes the short text first, else the first sentence of what it is", () => {
    expect(thingHint(lp, ctx, "a")).toBe("Kurz gesagt.");
    expect(thingHint(lp, ctx, "b")).toBe("Erster Satz.");
    expect(thingHint(lp, ctx, "c")).toBe("Ohne Punkt");
    expect(thingHint(lp, ctx, "d")).toBeUndefined();
  });
});

const pkg = (await validatePackageDir(DEMO_PACKAGE_DIR)).package!;

describe("texts of a choice for this character (SPEC 9.3, 10.4)", () => {
  const loaded = (lang: string) => ({ pkg, lang, texts: pkg.texts[lang]! }) as LoadedPackage;
  const runner = (folk: string) =>
    evaluateDraft(pkg, {
      level: 1,
      answers: { folk: { pick: folk }, calling: { pick: "calling.river-runner" } },
    });
  const intro = (lang: string, folk: string) => {
    const lp = loaded(lang);
    const step = { id: "talents-river-runner", choices: ["talents-river-runner"] };
    const texts = stepTexts(lp, step, runner(folk));
    return plain(measureContext(lp, undefined), texts.intro, texts.vars);
  };

  it("says how many talents and, for hillfolk only, why one more", () => {
    expect(intro("de", "folk.hillfolk")).toBe(
      "Als Flussläufer lernst du 3 Talente, eins mehr als die anderen: Das Bergvolk lernt viel von seinen Alten. Wähle die, die zu deinem Charakter passen.",
    );
    expect(intro("de", "folk.moorfolk")).toBe(
      "Als Flussläufer lernst du 2 Talente. Wähle die, die zu deinem Charakter passen.",
    );
    expect(intro("en", "folk.hillfolk")).toBe(
      "As a River Runner, you learn 3 talents, one more than others: the hillfolk learn a lot from their elders. Pick the ones that fit your character.",
    );
    expect(intro("en", "folk.moorfolk")).toBe(
      "As a River Runner, you learn 2 talents. Pick the ones that fit your character.",
    );
  });

  it("keeps the base text for every text the variant does not change", () => {
    const lp = loaded("de");
    const state = runner("folk.hillfolk").choices["talents-river-runner"]!;
    expect(state.textVariant).toBe("hillfolk");
    const texts = choiceTexts(lp, "talents-river-runner", state);
    expect(texts.title).toBe("Talente");
    expect(texts.question).toBe("Worin ist dein Charakter geübt?");
    expect(texts.missing).toBe("Wähle noch {{var:remaining}} Talent(e).");
  });

  it("fills {{var:count}} in a title and a question", () => {
    const lp = {
      ...loaded("en"),
      texts: {
        "choice.talents-river-runner.title": "{{var:count}} talents",
        "choice.talents-river-runner.question": "Which {{var:count}}?",
        "choice.talents-river-runner.variant.hillfolk.question": "Which {{var:count}}, hillfolk?",
      },
    } as LoadedPackage;
    const ev = runner("folk.hillfolk");
    expect(choiceTexts(lp, "talents-river-runner", ev.choices["talents-river-runner"])).toMatchObject({
      title: "3 talents",
      question: "Which 3, hillfolk?",
    });
    expect(stepTitle(lp, ev, "talents-river-runner")).toBe("3 talents");
    expect(
      choiceTexts(lp, "talents-river-runner", runner("folk.moorfolk").choices["talents-river-runner"]),
    ).toMatchObject({ title: "2 talents", question: "Which 2?" });
  });
});
