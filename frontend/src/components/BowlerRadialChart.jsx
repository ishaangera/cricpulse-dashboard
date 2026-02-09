import {
  ResponsiveContainer,
  RadialBarChart,
  RadialBar,
  PolarAngleAxis,
  Tooltip,
  Cell,
} from "recharts";

function teamColor(team, fallback = "#f59e0b") {
  if (!team) return fallback;
  const t = String(team).toLowerCase();
  const map = {
    india: "#0ea5e9",
    australia: "#e8fb36",
    england: "#ed3a3a",
    "new zealand": "#111827",
    pakistan: "#13e05e",
    "south africa": "#056817",
    "west indies": "#7c2d12",
    "sri lanka": "#00165f",
    bangladesh: "#b91c1c",
    afghanistan: "#30532e",
    ireland: "#16a34a",
    scotland: "#2362ea",
    zimbabwe: "#a16207",
  };
  return map[t] || fallback;
}

function shortTeam(team) {
  if (!team) return "Overall";
  const t = String(team).trim();
  const map = {
    India: "IND",
    Australia: "AUS",
    England: "ENG",
    "New Zealand": "NZ",
    Pakistan: "PAK",
    "South Africa": "SA",
    "West Indies": "WI",
    "Sri Lanka": "SL",
    Bangladesh: "BAN",
    Afghanistan: "AFG",
    Ireland: "IRE",
    Scotland: "SCO",
    Zimbabwe: "ZIM",
  };
  return map[t] || t;
}

export default function BowlerRadialChart({ rows = [] }) {
  if (!rows?.length) return <div className="note">No data</div>;

  // Expected row keys (from your API):
  // bowler, econ, wicket_pct_per_start
  const econVals = rows.map((r) => Number(r.econ || 0));
  const maxEcon = Math.max(...econVals, 0);

  // Invert so lower economy -> longer bar.
  // We draw "score" but show "econ" in tooltip.
  const data = rows.map((r) => {
    const econ = Number(r.econ || 0);
    const score = Math.max(0, maxEcon - econ) + 0.01; // keep non-zero
    return {
      name: r.bowler,
      team: r.team, // optional
      econ,
      wicketProb: Number(r.wicket_pct_per_start || 0),
      score,
      fill: teamColor(r.team, "#f59e0b"),
    };
  });

  return (
    <div className="radialWrap">
      <div style={{ width: "100%", height: 420 }}>
        <ResponsiveContainer>
          <RadialBarChart
            data={data}
            innerRadius="20%"
            outerRadius="95%"
            startAngle={90}
            endAngle={-270}
            barSize={12}
          >
            <PolarAngleAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 11, fill: "#0f172a" }}
            />

            <Tooltip
              contentStyle={{
                borderRadius: 14,
                border: "1px solid rgba(15,23,42,0.10)",
                boxShadow: "0 12px 30px rgba(15,23,42,0.12)",
              }}
              formatter={(value, key, ctx) => {
                const p = ctx?.payload || {};
                if (key === "score") return [Number(p.econ).toFixed(2), "Economy"];
                return [value, key];
              }}
              labelFormatter={(label, payload) => {
                const p = payload?.[0]?.payload;
                if (!p) return label;
                return `${p.name} (${shortTeam(p.team)}) • Wicket-in-window: ${Number(
                  p.wicketProb || 0
                ).toFixed(1)}%`;
              }}
            />

            <RadialBar
              dataKey="score"
              minAngle={8}
              background
              clockWise
              isAnimationActive={false}
            >
              {data.map((entry, idx) => (
                <Cell key={`cell-${idx}`} fill={entry.fill} />
              ))}
            </RadialBar>
          </RadialBarChart>
        </ResponsiveContainer>
      </div>

      <div
        style={{
          position: "absolute",
          left: "50%",
          top: "52%",
          transform: "translate(-50%,-50%)",
          textAlign: "center",
        }}
      >
        <div style={{ fontWeight: 800, fontSize: 14, color: "#0f172a" }}>Overall</div>
        <div style={{ fontSize: 12, opacity: 0.75 }}>Economy (lower better)</div>
      </div>
    </div>
  );
}
