/**
 * Sample data for the track screens until the rule core answers (AND-251
 * replaces it). Three demo characters after the pattern of the three target
 * characters of AND-266, made from the demo package only:
 *
 * 1. a track without places, then one with places added on level 4,
 * 2. a short first track, then a second with its own places from level 2,
 * 3. a long first track, then a second that shares the places from level 7.
 *
 * Reasons and numbers are what the core would send; the reasons are in the
 * package languages (de, en), like every package text.
 */
import type { TrackOption, TrackPlan } from "./model.ts";

export type Localized = { de: string; en: string };

export interface SampleOption extends Omit<TrackOption, "reason"> {
  reason?: Localized;
}

/** One number on the overview or the sheet. */
export interface SampleNumber {
  /** A value of the package (its name comes from the package texts). */
  value: string;
  shown: string;
}

export interface SampleSection {
  /** The track the numbers belong to; absent for the numbers of the whole character. */
  thing?: string;
  numbers: SampleNumber[];
  /** Things chosen through this track (shown by name). */
  picks?: string[];
}

export interface TracksSample {
  id: string;
  name: string;
  /** The track choice of the package. */
  choice: string;
  plan: TrackPlan;
  /** The level the level-up screen goes to. */
  raiseTo: number;
  /** Tracks for the next level, as the core checks them on the character before it. */
  options: SampleOption[];
  /** Tracks whose requirement to be added no longer holds. */
  unfit?: { thing: string; reason: Localized }[];
  /** "What grows with your level", per track and for the whole character. */
  growth: SampleSection[];
}

const LANTERN = "calling.lantern-bearer";
const RIVER = "calling.river-runner";
const HERBS = "calling.herbalist";

export const SAMPLES: TracksSample[] = [
  {
    id: "1",
    name: "Mira",
    choice: "calling",
    plan: { level: 3, first: RIVER, tracks: [] },
    raiseTo: 4,
    options: [
      { thing: RIVER, allowed: true },
      { thing: HERBS, allowed: true },
      {
        thing: LANTERN,
        allowed: false,
        reason: { de: "Braucht Herz 13. Mira hat 10.", en: "Needs Heart 13. Mira has 10." },
      },
    ],
    growth: [
      { numbers: [{ value: "practice", shown: "+2" }] },
      { thing: RIVER, numbers: [{ value: "restDice", shown: "3" }] },
    ],
  },
  {
    id: "2",
    name: "Tobi",
    choice: "calling",
    plan: { level: 5, first: LANTERN, tracks: [RIVER, RIVER, RIVER, RIVER] },
    raiseTo: 6,
    options: [
      { thing: RIVER, allowed: true },
      { thing: LANTERN, allowed: true },
      {
        thing: HERBS,
        allowed: false,
        reason: {
          de: "Braucht Klugheit 13. Tobi hat 8.",
          en: "Needs Wit 13. Tobi has 8.",
        },
      },
    ],
    unfit: [
      {
        thing: RIVER,
        reason: {
          de: "Braucht Geschick 13. Tobi hat jetzt 12.",
          en: "Needs Grace 13. Tobi now has 12.",
        },
      },
    ],
    growth: [
      {
        numbers: [
          { value: "practice", shown: "+3" },
          { value: "lanternSlots1", shown: "2" },
        ],
      },
      {
        thing: RIVER,
        numbers: [
          { value: "knackTarget", shown: "14" },
          { value: "knackHit", shown: "+6" },
        ],
        picks: ["knack.fog-hop", "knack.eddy", "knack.wave-push", "knack.tide-turn"],
      },
      {
        thing: LANTERN,
        numbers: [
          { value: "knackTarget", shown: "14" },
          { value: "knackHit", shown: "+6" },
        ],
        picks: ["knack.warm-glow", "knack.glow-thread"],
      },
    ],
  },
  {
    id: "3",
    name: "Ennu",
    choice: "calling",
    plan: {
      level: 8,
      first: LANTERN,
      tracks: [LANTERN, LANTERN, LANTERN, LANTERN, LANTERN, HERBS, HERBS],
    },
    raiseTo: 10,
    options: [
      { thing: HERBS, allowed: true },
      { thing: LANTERN, allowed: true },
      {
        thing: RIVER,
        allowed: false,
        reason: {
          de: "Braucht Geschick 13 und Klugheit 13. Ennu hat Geschick 10.",
          en: "Needs Grace 13 and Wit 13. Ennu has Grace 10.",
        },
      },
    ],
    growth: [
      {
        numbers: [
          { value: "practice", shown: "+3" },
          { value: "lanternSlots1", shown: "4" },
          { value: "lanternSlots2", shown: "3" },
        ],
      },
      {
        thing: LANTERN,
        numbers: [
          { value: "knackTarget", shown: "13" },
          { value: "knackHit", shown: "+5" },
        ],
        picks: ["knack.warm-glow", "knack.shadow-ward", "knack.light-bridge", "knack.dawn-flare"],
      },
      {
        thing: HERBS,
        numbers: [
          { value: "knackTarget", shown: "12" },
          { value: "knackHit", shown: "+4" },
          { value: "bloomWardUses", shown: "2" },
        ],
        picks: ["knack.moss-bed", "knack.thorn-ring", "knack.herb-scent"],
      },
    ],
  },
];

export function sampleById(id: string | null): TracksSample {
  return SAMPLES.find((s) => s.id === id) ?? SAMPLES[0]!;
}

/** A package text of the sample in the shown package language. */
export function local(text: Localized, lang: string): string {
  return lang === "de" ? text.de : text.en;
}

export function optionsIn(sample: TracksSample, lang: string): TrackOption[] {
  return sample.options.map((o) => ({
    thing: o.thing,
    allowed: o.allowed,
    ...(o.reason && { reason: local(o.reason, lang) }),
  }));
}
