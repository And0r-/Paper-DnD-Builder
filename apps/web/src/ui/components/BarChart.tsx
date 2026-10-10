"use client";
/**
 * A bar per week, drawn as plain SVG (no chart library: nothing from
 * elsewhere, and the CSP stays as it is). One series, so no legend: the
 * heading names it. Each bar names its week and count on hover (`<title>`),
 * over the whole height of its column, not only the bar. The same numbers
 * follow as a table, for screen readers and for reading them exactly.
 */
import { useId } from "react";
import { useApp } from "../app-state.tsx";

export interface WeekCount {
  /** The week's Monday, `YYYY-MM-DD`, UTC. */
  week: string;
  count: number;
}

const W = 640;
const H = 200;
const PAD = { top: 12, right: 8, bottom: 28, left: 36 };
const GAP = 2;
const RADIUS = 4;

/** A bar from the baseline up, its top corners rounded. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(RADIUS, w / 2, h);
  const base = y + h;
  return `M${x},${base}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${base}Z`;
}

export function BarChart({ title, data }: { title: string; data: WeekCount[] }) {
  const { t, lang } = useApp();
  const titleId = useId();
  const day = new Intl.DateTimeFormat(lang, { day: "numeric", month: "short", timeZone: "UTC" });
  const long = new Intl.DateTimeFormat(lang, { dateStyle: "medium", timeZone: "UTC" });
  const max = Math.max(1, ...data.map((d) => d.count));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const col = plotW / Math.max(1, data.length);
  const base = PAD.top + plotH;
  const weekName = (d: WeekCount) => long.format(new Date(`${d.week}T00:00:00Z`));
  return (
    <figure className="bar-chart">
      <figcaption className="section-title" id={titleId}>
        {title}
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-labelledby={titleId}
        aria-describedby={`${titleId}-desc`}
        className="bar-chart__svg"
      >
        <desc id={`${titleId}-desc`}>
          {t("admin.chartDesc", { weeks: data.length, max: Math.max(0, ...data.map((d) => d.count)) })}
        </desc>
        {/* Recessive guides: the top value and the baseline. */}
        <line className="bar-chart__grid" x1={PAD.left} x2={W - PAD.right} y1={PAD.top} y2={PAD.top} />
        <text className="bar-chart__axis" x={PAD.left - 6} y={PAD.top + 4} textAnchor="end">
          {max}
        </text>
        <text className="bar-chart__axis" x={PAD.left - 6} y={base + 4} textAnchor="end">
          0
        </text>
        {data.map((d, i) => {
          const x = PAD.left + i * col;
          const h = (d.count / max) * plotH;
          return (
            <g key={d.week} className="bar-chart__bar">
              <title>{t("admin.barTitle", { week: weekName(d), count: d.count })}</title>
              <rect className="bar-chart__hit" x={x} y={PAD.top} width={col} height={plotH} />
              {d.count > 0 && <path d={barPath(x + GAP / 2, base - h, col - GAP, h)} />}
            </g>
          );
        })}
        <line className="bar-chart__baseline" x1={PAD.left} x2={W - PAD.right} y1={base} y2={base} />
        {data.length > 0 && (
          <>
            <text className="bar-chart__axis" x={PAD.left} y={H - 8} textAnchor="start">
              {day.format(new Date(`${data[0]!.week}T00:00:00Z`))}
            </text>
            <text className="bar-chart__axis" x={W - PAD.right} y={H - 8} textAnchor="end">
              {day.format(new Date(`${data.at(-1)!.week}T00:00:00Z`))}
            </text>
          </>
        )}
      </svg>
      <table className="bar-chart__table">
        <caption className="visually-hidden">{title}</caption>
        <thead>
          <tr>
            <th scope="col">{t("admin.colWeek")}</th>
            <th scope="col">{t("admin.colCount")}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.week}>
              <th scope="row">{weekName(d)}</th>
              <td>{d.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}
