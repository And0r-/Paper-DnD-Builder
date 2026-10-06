import { describe, expect, it } from "vitest";
import { parseTemplate, sentences, TemplateSyntaxError, visibleText } from "./template.ts";

describe("parseTemplate", () => {
  it("splits text, quantities, variables and glossary links", () => {
    expect(
      parseTemplate(
        "Up to {{length:30}} ({{length:30|short}}), {{var:name}} gets [[glossary:stamina|stamina]].",
      ),
    ).toEqual([
      { type: "text", text: "Up to " },
      { type: "quantity", dimension: "length", amount: 30, form: "long" },
      { type: "text", text: " (" },
      { type: "quantity", dimension: "length", amount: 30, form: "short" },
      { type: "text", text: "), " },
      { type: "var", name: "name" },
      { type: "text", text: " gets " },
      { type: "glossary", id: "stamina", text: "stamina" },
      { type: "text", text: "." },
    ]);
  });

  it("reads a signed variable", () => {
    expect(parseTemplate("1 {{var:bonus|signed}}")).toEqual([
      { type: "text", text: "1 " },
      { type: "var", name: "bonus", signed: true },
    ]);
  });

  it("accepts plain text", () => {
    expect(parseTemplate("Nothing special.")).toEqual([{ type: "text", text: "Nothing special." }]);
  });

  it.each([
    ["{{30 feet}}", "bad placeholder"],
    ["{{length:thirty}}", "bad placeholder"],
    ["{{var:bonus|loud}}", "bad placeholder"],
    ["[[stamina]]", "bad glossary link"],
    ["a {{ b", "unbalanced"],
  ])("rejects %j", (src, message) => {
    expect(() => parseTemplate(src)).toThrow(TemplateSyntaxError);
    expect(() => parseTemplate(src)).toThrow(message);
  });
});

describe("visibleText", () => {
  it("keeps the words of a glossary link and counts placeholders at a fixed width", () => {
    expect(visibleText("Gain [[glossary:stamina|Stamina]] within {{length:30}}, {{var:count}} times.")).toBe(
      "Gain Stamina within 00000000, 00 times.",
    );
  });

  it("returns a text that does not parse unchanged", () => {
    expect(visibleText("Broken {{nope}}")).toBe("Broken {{nope}}");
  });
});

describe("sentences", () => {
  it("splits at the end of a sentence before a capital or a digit, also inside a quote", () => {
    expect(sentences("Once per rest. Ölig wird es! 3 Mal? „Brot!“ Du lachst.")).toEqual([
      "Once per rest.",
      "Ölig wird es!",
      "3 Mal?",
      "„Brot!“",
      "Du lachst.",
    ]);
  });

  it("does not split inside a sentence", () => {
    expect(sentences("Up to 1.5 m, e.g. here.")).toHaveLength(1);
  });
});
