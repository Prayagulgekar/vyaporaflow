import { formatINR } from "@/domain/money";

/**
 * Single-series daily bar chart, rendered on the server as SVG.
 * One hue (accent), thin bars with rounded tops anchored to the baseline,
 * recessive grid, a native per-bar tooltip, and a table view for screen readers.
 */
export function DailyBarChart({ data, title }: { data: { day: string; value: string }[]; title: string }) {
  const values = data.map((d) => Number(d.value));
  const max = Math.max(1, ...values);
  const nice = niceMax(max);
  const W = 720;
  const H = 200;
  const padL = 56;
  const padB = 24;
  const plotW = W - padL - 8;
  const plotH = H - padB - 8;
  const slot = plotW / Math.max(1, data.length);
  const barW = Math.max(2, Math.min(24, slot - 2));
  const ticks = [0, 0.5, 1].map((f) => nice * f);
  const labelEvery = Math.ceil(data.length / 8);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`${title}. Highest day ${formatINR(String(max))}.`}>
        {ticks.map((t) => {
          const y = 8 + plotH - (t / nice) * plotH;
          return (
            <g key={t}>
              <line x1={padL} x2={W - 8} y1={y} y2={y} stroke="var(--color-line)" strokeWidth={1} />
              <text x={padL - 6} y={y + 4} textAnchor="end" fontSize={11} fill="var(--color-ink-muted)">
                {compactINR(t)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const v = Number(d.value);
          const h = (v / nice) * plotH;
          const x = padL + i * slot + (slot - barW) / 2;
          const y = 8 + plotH - h;
          const r = Math.min(4, barW / 2, h);
          return (
            <g key={d.day}>
              <rect x={padL + i * slot} y={8} width={slot} height={plotH} fill="transparent">
                <title>{`${d.day}: ${formatINR(d.value)}`}</title>
              </rect>
              {h > 0 ? (
                <path
                  d={`M${x},${y + h} V${y + r} Q${x},${y} ${x + r},${y} H${x + barW - r} Q${x + barW},${y} ${x + barW},${y + r} V${y + h} Z`}
                  fill="var(--color-accent)"
                  pointerEvents="none"
                />
              ) : null}
              {i % labelEvery === 0 ? (
                <text x={padL + i * slot + slot / 2} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--color-ink-muted)">
                  {d.day.slice(8)}/{d.day.slice(5, 7)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-ink-muted">Show as table</summary>
        <table className="data-table mt-2">
          <thead>
            <tr>
              <th scope="col">Date</th>
              <th scope="col" className="num">
                Amount
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.day}>
                <td>{d.day}</td>
                <td className="num">{formatINR(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}

function niceMax(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

function compactINR(v: number) {
  if (v >= 1e7) return `₹${+(v / 1e7).toFixed(1)}Cr`;
  if (v >= 1e5) return `₹${+(v / 1e5).toFixed(1)}L`;
  if (v >= 1e3) return `₹${+(v / 1e3).toFixed(1)}k`;
  return `₹${v}`;
}
