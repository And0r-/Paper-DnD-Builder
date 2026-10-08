"use client";
/**
 * The track screens on sample data, before the rule core knows tracks
 * (AND-276). `?s=1|2|3` picks the sample, `?v=raise|step|unfit|overview|sheet`
 * the screen. Nothing is saved. AND-251 wires the screens into the flow and
 * removes this page.
 */
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { useApp } from "../../../src/ui/app-state.tsx";
import { PageError } from "../../../src/ui/components/PageError.tsx";
import { GuestShell } from "../../../src/ui/components/Shell.tsx";
import { usePageTitle } from "../../../src/ui/flow/frame.tsx";
import { loadPackage, type LoadedPackage } from "../../../src/ui/packages.ts";
import { local, optionsIn, sampleById, SAMPLES } from "../../../src/ui/tracks/fixtures.ts";
import type { TrackPlan } from "../../../src/ui/tracks/model.ts";
import {
  TrackGrowth,
  TrackHead,
  TrackRaise,
  TrackSheet,
  TrackStep,
} from "../../../src/ui/tracks/screens.tsx";

const SCREENS = ["raise", "step", "unfit", "overview", "sheet"] as const;
type Screen = (typeof SCREENS)[number];

export default function TracksPreviewPage() {
  return (
    <Suspense>
      <Preview />
    </Suspense>
  );
}

function Preview() {
  const { t, lang } = useApp();
  const params = useSearchParams();
  const sample = sampleById(params.get("s"));
  const v = params.get("v");
  const screen: Screen = SCREENS.includes(v as Screen) ? (v as Screen) : "raise";
  const [lp, setLp] = useState<LoadedPackage>();
  const [failed, setFailed] = useState(false);
  const [plan, setPlan] = useState<TrackPlan>(sample.plan);
  usePageTitle([t("tracks.preview.title")]);
  useEffect(() => {
    let live = true;
    loadPackage("demo", lang).then(
      (p) => live && setLp(p),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [lang]);
  // Another sample or screen starts from that sample's levels again.
  useEffect(() => setPlan(sample.plan), [sample, screen]);

  if (failed) return <PageError t={t} />;
  if (!lp) return null;
  const options = optionsIn(sample, lp.lang);
  const unfit = (sample.unfit ?? []).map((u) => ({ thing: u.thing, reason: local(u.reason, lp.lang) }));
  const href = (s: string, view: Screen) => `/preview/tracks?s=${s}&v=${view}`;
  const names: Record<Screen, string> = {
    raise: t("tracks.preview.raise"),
    step: t("tracks.preview.step"),
    unfit: t("tracks.preview.unfit"),
    overview: t("tracks.preview.overview"),
    sheet: t("tracks.preview.sheet"),
  };

  return (
    <GuestShell>
      <div className="tracks-preview">
        {screen === "raise" && (
          <TrackRaise
            key={`${sample.id}-${lang}`}
            lp={lp}
            name={sample.name}
            plan={sample.plan}
            to={sample.raiseTo}
            options={options}
            onBack={() => undefined}
            onGo={setPlan}
          />
        )}
        {(screen === "step" || screen === "unfit") && (
          <TrackStep
            key={`${sample.id}-${screen}`}
            lp={lp}
            choice={sample.choice}
            plan={plan}
            options={options}
            unfit={screen === "unfit" ? unfit : []}
            onChange={setPlan}
          />
        )}
        {screen === "overview" && (
          <div className="page">
            <TrackHead lp={lp} name={sample.name} plan={plan} />
            <TrackGrowth lp={lp} plan={plan} blocks={sample.growth} />
          </div>
        )}
        {screen === "sheet" && <TrackSheet lp={lp} name={sample.name} plan={plan} blocks={sample.growth} />}

        <nav className="tracks-preview__nav" aria-label={t("tracks.preview.title")}>
          <p className="tracks-preview__title">{t("tracks.preview.title")}</p>
          <p className="tracks-preview__note">{t("tracks.preview.note")}</p>
          <p className="tracks-preview__label">{t("tracks.preview.sample")}</p>
          <ul className="tracks-preview__chips">
            {SAMPLES.map((s) => (
              <li key={s.id}>
                <Link
                  className="tracks-preview__chip"
                  href={href(s.id, screen)}
                  aria-current={s.id === sample.id ? "page" : undefined}
                >
                  {s.name}
                </Link>
              </li>
            ))}
          </ul>
          <p className="tracks-preview__label">{t("tracks.preview.screen")}</p>
          <ul className="tracks-preview__chips">
            {SCREENS.map((view) => (
              <li key={view}>
                <Link
                  className="tracks-preview__chip"
                  href={href(sample.id, view)}
                  aria-current={view === screen ? "page" : undefined}
                >
                  {names[view]}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </GuestShell>
  );
}
