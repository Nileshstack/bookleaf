"use client";

import { Bar, BarChart, CartesianGrid, Cell, Tooltip, XAxis, YAxis } from "recharts";
import type { CountMap } from "@/lib/types";
import { PRIORITY_FILL } from "./ticket-badges";

const CATEGORY_SHORT: Record<string, string> = {
  "Royalty & Payments": "Royalty & payments",
  "ISBN & Metadata Issues": "ISBN & metadata",
  "Printing & Quality": "Printing & quality",
  "Distribution & Availability": "Distribution",
  "Book Status & Production Updates": "Production updates",
  "General Inquiry": "General",
  Unclassified: "Unclassified",
};

const tooltipStyle = {
  contentStyle: { borderRadius: 10, border: "1px solid #e7e0d4", boxShadow: "0 10px 30px -10px rgb(28 42 51 / 0.25)", fontSize: 12 },
  cursor: { fill: "#f3eee5" },
};

/** Visually hidden table so the numbers are available without the chart. */
function DataTable({ caption, rows }: { caption: string; rows: { name: string; value: number }[] }) {
  return (
    <table className="sr-only">
      <caption>{caption}</caption>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}>
            <th scope="row">{r.name}</th>
            <td>{r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function CategoryChart({ counts, caption }: { counts: CountMap; caption: string }) {
  const rows = Object.entries(counts)
    .filter(([name, value]) => value > 0 || name !== "Unclassified")
    .map(([name, value]) => ({ name: CATEGORY_SHORT[name] ?? name, value }));
  return (
    <figure>
      <div aria-hidden>
        <BarChart responsive data={rows} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }} style={{ width: "100%", height: 220 }}>
          <CartesianGrid horizontal={false} stroke="#efe9de" />
          <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: "#66737d" }} axisLine={false} tickLine={false} />
          <YAxis type="category" dataKey="name" width={124} tick={{ fontSize: 12, fill: "#3e4c56" }} axisLine={false} tickLine={false} />
          <Tooltip {...tooltipStyle} formatter={(v) => [v, "Tickets"]} />
          <Bar dataKey="value" fill="#2d757c" radius={[0, 6, 6, 0]} barSize={16} isAnimationActive={false} />
        </BarChart>
      </div>
      <DataTable caption={caption} rows={rows} />
    </figure>
  );
}

export function PriorityChart({ counts, caption }: { counts: CountMap; caption: string }) {
  const rows = ["Critical", "High", "Medium", "Low", "Unclassified"]
    .filter((name) => name !== "Unclassified" || counts[name] > 0)
    .map((name) => ({ name, value: counts[name] ?? 0 }));
  return (
    <figure>
      <div aria-hidden>
        <BarChart responsive data={rows} margin={{ top: 8, right: 8, bottom: 4, left: -16 }} style={{ width: "100%", height: 220 }}>
          <CartesianGrid vertical={false} stroke="#efe9de" />
          <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#3e4c56" }} axisLine={false} tickLine={false} />
          <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#66737d" }} axisLine={false} tickLine={false} />
          <Tooltip {...tooltipStyle} formatter={(v) => [v, "Tickets"]} />
          <Bar dataKey="value" radius={[6, 6, 0, 0]} barSize={36} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.name} fill={PRIORITY_FILL[r.name]} />
            ))}
          </Bar>
        </BarChart>
      </div>
      <DataTable caption={caption} rows={rows} />
    </figure>
  );
}
