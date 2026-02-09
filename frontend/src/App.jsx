import { useEffect, useMemo, useRef, useState } from "react";

// ----------------------------
// Formatting helpers
// ----------------------------

// Format numbers like cricket stats:
// - economy: 2 decimals
// - strike rate, dismissal rate, wicket ratio/share: 1 decimal
function formatCell(v, key = "") {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    const k = String(key).toLowerCase();

    if (k.includes("econ")) return v.toFixed(2);

    if (k === "sr" || k.includes("sr_") || k.includes("_sr") || k.includes("strike")) return v.toFixed(1);

    if (k.includes("dismiss")) return v.toFixed(1);

    if (k.includes("wicket_pct") || k.includes("wicket_pct_per_start")) return v.toFixed(1);
    if (k.includes("share")) return v.toFixed(1);

    const isInt = Number.isInteger(v);
    return isInt ? String(v) : String(Math.round(v * 10000) / 10000);
  }
  return String(v);
}

const fmt = (value, key) => (value === null || value === undefined ? "—" : formatCell(value, key));
const fmtPct = (value, key) => (value === null || value === undefined ? "—" : `${formatCell(value, key)}%`);

// ----------------------------
// Team colors
// ----------------------------
function teamColor(team, fallback) {
  if (!team) return fallback;
  const t = String(team).toLowerCase();

  const map = {
    india: "#0ea5e9",
    australia: "#e8fb36",
    england: "#ed3a3a",
    "new zealand": "#111827b5",
    pakistan: "#13e05e",
    "south africa": "#056817",
    "west indies": "#7c2d12",
    "sri lanka": "#00165f",
    bangladesh: "#b91c1c",
    afghanistan: "#30532e",
    ireland: "#16a34a",
    scotland: "#2362ea",
    nepal: "#dc262682",
    "united arab emirates": "#0f172a",
    zimbabwe: "#a16207",
  };

  return map[t] || fallback;
}

// ----------------------------
// Search helpers (last-name friendly)
// ----------------------------
function normalizeText(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Build a search key that supports last-name search.
// Example: "RG Sharma" => "rg sharma | sharma rg | sharma | rg | rgsharma"
function buildSearchKey(fullName) {
  const n = normalizeText(fullName);
  if (!n) return "";
  const parts = n.split(" ").filter(Boolean);
  const first = parts[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1] : first;

  const firstLast = parts.join(" ");
  const lastFirst = [last, ...parts.slice(0, -1)].join(" ").trim();

  const compact = parts.join("");
  return [firstLast, lastFirst, last, first, compact].join(" | ");
}

// ----------------------------
// UI components
// ----------------------------
function Table({ title, columns, rows }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontSize: 20, fontWeight: 800, margin: "14px 0 10px 0" }}>{title}</div>
      <div className="tableWrap">
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key}>{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((r, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key}>{formatCell(r?.[c.key], c.key)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ value, label, align = "left" }) {
  return (
    <div style={{ textAlign: align }}>
      <div className="kpiValue">{value ?? "—"}</div>
      <div className="kpiLabel">{label}</div>
    </div>
  );
}

/**
 * Searchable select (combobox style)
 * - options: array of strings
 * - value: selected string
 * - onChange: (newValue) => void
 */
function SearchSelect({ label, placeholder = "Search…", options, value, onChange, disabled = false }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const wrapRef = useRef(null);

  const opts = useMemo(() => {
    const list = (options || []).map((name) => ({
      name,
      key: buildSearchKey(name),
    }));

    const qq = normalizeText(q);
    if (!qq) return list.slice(0, 150);

    // match anywhere in the "key"
    const filtered = list.filter((o) => o.key.includes(qq));
    return filtered.slice(0, 150);
  }, [options, q]);

  useEffect(() => {
    const onDoc = (e) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  useEffect(() => {
    // When external value changes, sync query to empty (do not fight user typing)
    setQ("");
  }, [value]);

  return (
    <div ref={wrapRef} style={{ position: "relative" }}>
      {label && <div className="fieldLabel">{label}</div>}
      <button
        type="button"
        className="comboButton"
        disabled={disabled}
        onClick={() => setOpen((s) => !s)}
        aria-expanded={open}
      >
        <span className="comboValue">{value || "—"}</span>
        <span className="comboChevron">▾</span>
      </button>

      {open && (
        <div className="comboDropdown">
          <input
            className="comboSearch"
            placeholder={placeholder}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
          <div className="comboList">
            {opts.length === 0 && <div className="comboEmpty">No matches</div>}
            {opts.map((o) => (
              <div
                key={o.name}
                className={`comboItem ${o.name === value ? "active" : ""}`}
                onClick={() => {
                  onChange(o.name);
                  setOpen(false);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && onChange(o.name)}
              >
                {o.name}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ----------------------------
// Main App
// ----------------------------
export default function App() {
  const [players, setPlayers] = useState(null);
  const [loadingPlayers, setLoadingPlayers] = useState(true);
  const [error, setError] = useState("");

  // Controls
  const [over0, setOver0] = useState(0);

  // Ball selector is 1–6, we show progressive dots
  const [ball1to6, setBall1to6] = useState(1);
  const startBall0 = useMemo(() => Math.max(0, Math.min(5, ball1to6 - 1)), [ball1to6]);

  // Selected players
  const [batter, setBatter] = useState("");
  const [bowler, setBowler] = useState("");

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);

  // Players fetch
  useEffect(() => {
    (async () => {
      try {
        setError("");
        setLoadingPlayers(true);
        const res = await fetch("/api/players");
        if (!res.ok) throw new Error(`Players HTTP ${res.status}`);
        const d = await res.json();
        setPlayers(d);
        setBatter(d?.batters?.[0] || "");
        setBowler(d?.bowlers?.[0] || "");
      } catch (e) {
        setError(String(e.message || e));
      } finally {
        setLoadingPlayers(false);
      }
    })();
  }, []);

  const canQuery = useMemo(() => !!batter && !!bowler, [batter, bowler]);

  // Matchup request
  useEffect(() => {
    if (!canQuery) return;
    const controller = new AbortController();

    (async () => {
      try {
        setError("");
        setLoading(true);

        const url = new URL("/api/matchup", window.location.origin);
        url.searchParams.set("batter", batter);
        url.searchParams.set("bowler", bowler);
        url.searchParams.set("start_over0", String(over0));
        url.searchParams.set("start_ball0", String(startBall0));
        url.searchParams.set("min_balls", "6");

        const res = await fetch(url.toString().replace(window.location.origin, ""), {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`Matchup HTTP ${res.status}`);
        setData(await res.json());
      } catch (e) {
        if (String(e).includes("AbortError")) return;
        setError(String(e.message || e));
      } finally {
        setLoading(false);
      }
    })();

    return () => controller.abort();
  }, [canQuery, batter, bowler, over0, startBall0]);

  const batterCard = data?.batter_card;
  const bowlerCard = data?.bowler_card;
  const matchup = data?.matchup;
  const tables = data?.tables || {};

  // Team colors (fallbacks)
  const batterTeamColor = teamColor(batterCard?.team, "#2563eb");
  const bowlerTeamColor = teamColor(bowlerCard?.team, "#16a34a");

  // Slider fill percent
  const overPct = useMemo(() => `${(over0 / 19) * 100}%`, [over0]);

  // ---------
  // Players lists (no team filtering in frontend)
  const battersList = useMemo(() => players?.batters || [], [players]);
  const bowlersList = useMemo(() => players?.bowlers || [], [players]);

  // --------------------
  // Sorted + limited table rows (your previous logic retained)
  // --------------------
  const batterTeamRows = useMemo(() => {
    const rows = tables.opposition_split_batter_same_slot || [];
    return [...rows].sort((a, b) => (Number(b?.sr) || 0) - (Number(a?.sr) || 0));
  }, [tables]);

  const bowlerTeamRows = useMemo(() => {
    const rows = tables.opposition_split_bowler_same_slot || [];
    return [...rows].sort((a, b) => (Number(b?.wicket_pct_per_start) || 0) - (Number(a?.wicket_pct_per_start) || 0));
  }, [tables]);

  const bestBattersTop10 = useMemo(() => {
    const rows = tables.best_batters_overall_same_slot || [];
    return [...rows].sort((a, b) => (Number(b?.sr) || 0) - (Number(a?.sr) || 0)).slice(0, 10);
  }, [tables]);

  const bestBowlersTop10 = useMemo(() => {
    const rows = tables.best_bowlers_overall_same_slot || [];
    return [...rows]
      .sort((a, b) => (Number(b?.wicket_pct_per_start) || 0) - (Number(a?.wicket_pct_per_start) || 0))
      .slice(0, 10);
  }, [tables]);

  const top5BattersSorted = useMemo(() => {
    const rows = tables.top5_batters_vs_bowler_same_slot || [];
    return [...rows].sort((a, b) => (Number(b?.sr_vs_bowler) || 0) - (Number(a?.sr_vs_bowler) || 0));
  }, [tables]);

  const top5BowlersSorted = useMemo(() => {
    const rows = tables.top5_bowlers_vs_batter_same_slot || [];
    return [...rows].sort((a, b) => (Number(b?.wicket_pct_per_start) || 0) - (Number(a?.wicket_pct_per_start) || 0));
  }, [tables]);

  const matchupLine = `${batter} vs ${bowler} • Slot: Over ${over0}, Ball ${ball1to6} • Window: 3 overs`;

  // ----------------------------
  // Card backgrounds (your gradient specs)
  // ----------------------------
  const batterCardBg = useMemo(() => {
    // bottom -> top (team color to white)
    return `linear-gradient(0deg, ${batterTeamColor} 0%, #ffffff 78%)`;
  }, [batterTeamColor]);

  const bowlerCardBg = useMemo(() => {
    return `linear-gradient(0deg, ${bowlerTeamColor} 0%, #ffffff 78%)`;
  }, [bowlerTeamColor]);

  const h2hBg = useMemo(() => {
    // left -> right (batter color to white to bowler color)
    return `linear-gradient(90deg, ${batterTeamColor} 0%, #ffffff 50%, ${bowlerTeamColor} 100%)`;
  }, [bowlerTeamColor, batterTeamColor]);

  // ----------------------------
  // Inline CSS (no dark mode)
  // ----------------------------
  const styles = `
    :root{
      --bg:#ffffff;
      --text:#0f172a;
      --muted: rgba(15,23,42,0.70);
      --border: rgba(15,23,42,0.12);
      --shadow: 0 10px 30px rgba(2,6,23,0.08);
      --radius: 18px;
      --tableHead: rgba(15,23,42,0.04);
      --chip: rgba(15,23,42,0.06);
      --focus: rgba(14,165,233,0.35);
      --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
      --sans: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji";
    }

    body { background: var(--bg); color: var(--text); font-family: var(--sans); }

    .app{
      max-width: 1220px;
      margin: 26px auto 44px auto;
      padding: 0 16px;
    }

    .headerRow{
      display:flex;
      align-items:flex-start;
      justify-content:space-between;
      gap: 14px;
      margin-bottom: 10px;
    }
    .headerLeft{
      display:flex;
      align-items:center;
      gap: 12px;
      min-width: 340px;
    }
    .logo{
      width: 46px;
      height: 46px;
      object-fit: contain;
      border-radius: 10px;
    }
    h1{
      margin: 0;
      font-size: 28px;
      letter-spacing: -0.02em;
    }
    .subtitle{
      margin-top: 2px;
      color: var(--muted);
      font-weight: 600;
    }

    .card{
      background: #fff;
      border: 1px solid var(--border);
      border-radius: var(--radius);
      box-shadow: var(--shadow);
      padding: 14px 14px;
    }

    .controlsCard{
      min-width: 380px;
      padding: 14px 14px;
    }
    .controlLabel{
      font-size: 12px;
      font-weight: 800;
      color: rgba(15,23,42,0.68);
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 6px;
    }
    .overRow{
      display:flex;
      align-items:center;
      gap: 10px;
    }
    .overPill{
      font-weight: 900;
      padding: 6px 10px;
      border-radius: 999px;
      background: var(--chip);
      border: 1px solid var(--border);
      font-size: 13px;
      white-space: nowrap;
    }
    .overRange{
      width: 100%;
      accent-color: #0ea5e9;
    }
    .ballRow{
      display:flex;
      gap: 8px;
      flex-wrap: nowrap;
      margin-top: 6px;
    }
    .ballDot{
      width: 34px;
      height: 34px;
      border-radius: 999px;
      display:flex;
      align-items:center;
      justify-content:center;
      border: 1px solid var(--border);
      background: #fff;
      cursor:pointer;
      user-select:none;
      font-weight: 800;
      font-size: 12px;
    }
    .ballDot.active{
      background: rgba(220,38,38,0.12);
      border-color: rgba(220,38,38,0.35);
    }

    .error{
      margin-top: 10px;
      padding: 12px 14px;
      border-radius: 14px;
      border: 1px solid rgba(220,38,38,0.35);
      background: rgba(220,38,38,0.08);
    }
    .note{
      margin-top: 10px;
      color: var(--muted);
      font-weight: 700;
    }

    .topLanes{
      display:grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-top: 10px;
      align-items: stretch;
    }
    .lane{
      border-radius: var(--radius);
      padding: 14px 14px;
      border: 1px solid rgba(15,23,42,0.10);
      box-shadow: var(--shadow);
    }
    .lanePanel{
      background: rgba(255,255,255,0.78);
      border: 1px solid rgba(15,23,42,0.10);
      border-radius: 16px;
      padding: 14px 14px;
    }
    .lanePanelTable{
      margin-top: 12px;
      padding-top: 6px;
    }

    .cardRow{
      display:flex;
      gap: 14px;
      align-items: stretch;
    }
    .cardLeft{
      flex: 1;
      min-width: 240px;
      display:flex;
      flex-direction: column;
      gap: 8px;
    }
    .cardRight{
      width: 220px;
      display:flex;
      justify-content:flex-end;
      align-items:flex-start;
    }
    .cardTitle{
      font-size: 12px;
      font-weight: 900;
      letter-spacing: 0.10em;
      text-transform: uppercase;
      color: rgba(15,23,42,0.60);
    }
    .playerSelectWrap .comboButton{
      background: transparent;
      border: none;
      border-bottom: 2px solid rgba(15,23,42,0.18);
      border-radius: 0;
      padding: 2px 0 6px 0;
    }
    .playerSelectWrap .comboButton:hover{
      border-bottom-color: rgba(15,23,42,0.35);
    }
    .teamUnderSelect{
      font-weight: 900;
      font-size: 18px;
      letter-spacing: -0.01em;
    }
    .kpiStackRight{
      display:flex;
      flex-direction: column;
      gap: 10px;
      align-items: flex-end;
      text-align: right;
      width: 100%;
    }

    .fieldLabel{
      margin: 12px 0 6px 0;
      color: rgba(15,23,42,0.65);
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 11px;
    }

    select{
      width: 100%;
      padding: 10px 10px;
      border-radius: 12px;
      border: 1px solid var(--border);
      font-weight: 700;
      background: #fff;
      outline: none;
    }
    select:focus{ box-shadow: 0 0 0 4px var(--focus); }

    .kpiValue{
      font-size: 18px;
      font-weight: 900;
      letter-spacing: -0.01em;
    }
    .kpiLabel{
      font-size: 12px;
      color: var(--muted);
      font-weight: 800;
      margin-top: 2px;
    }

    .grid2{
      display:grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
    }

    .tableWrap{
      overflow:auto;
      border-radius: 14px;
      border: 1px solid var(--border);
    }
    table{
      width: 100%;
      border-collapse: collapse;
      min-width: 540px;
      background: #fff;
    }
    thead th{
      position: sticky;
      top: 0;
      background: var(--tableHead);
      text-align: left;
      font-size: 12px;
      font-weight: 900;
      padding: 10px 10px;
      border-bottom: 1px solid var(--border);
      white-space: nowrap;
    }
    tbody td{
      font-size: 13px;
      font-weight: 650;
      padding: 10px 10px;
      border-bottom: 1px solid rgba(15,23,42,0.08);
      white-space: nowrap;
    }
    tbody tr:hover td{
      background: rgba(15,23,42,0.02);
    }

    /* Combobox */
    
.comboButton{
  width: 100%;
  display:flex;
  align-items:center;
  justify-content:space-between;
  padding: 0;
  border-radius: 0;
  border: none;
  background: transparent;
  cursor:pointer;
  font-weight: 900;
}
    .comboButton:focus{ outline: none; box-shadow: 0 0 0 4px var(--focus); }
    .comboValue{ font-size: 18px; }
    .comboChevron{ color: rgba(15,23,42,0.55); font-weight: 900; }

    .comboDropdown{
      position:absolute;
      z-index: 30;
      width: 100%;
      margin-top: 8px;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: #fff;
      box-shadow: var(--shadow);
      overflow:hidden;
    }
    .comboSearch{
      width: 100%;
      padding: 10px 10px;
      border: none;
      border-bottom: 1px solid var(--border);
      outline: none;
      font-weight: 750;
    }
    .comboList{ max-height: 300px; overflow:auto; }
    .comboItem{
      padding: 10px 10px;
      cursor:pointer;
      font-weight: 750;
      font-size: 13px;
    }
    .comboItem:hover{ background: rgba(15,23,42,0.04); }
    .comboItem.active{ background: rgba(14,165,233,0.10); }
    .comboEmpty{ padding: 12px 10px; color: var(--muted); font-weight: 800; }

    /* New card layouts */
    .splitHeaderRow{
      display:flex;
      align-items:flex-start;
      justify-content:space-between;
      gap: 12px;
      margin-bottom: 10px;
    }

    .teamName{
      font-size: 18px;
      font-weight: 950;
      letter-spacing: -0.02em;
      line-height: 1.05;
    }
    .playerName{
      font-size: 22px;
      font-weight: 950;
      letter-spacing: -0.02em;
      margin-top: 2px;
      line-height: 1.05;
    }

    .statStack{
      display:flex;
      flex-direction:column;
      gap: 10px;
      align-items:flex-end;
      justify-content:flex-start;
      min-width: 190px;
    }

    .statStackLeft{
      display:flex;
      flex-direction:column;
      gap: 10px;
      align-items:flex-start;
      justify-content:flex-start;
      min-width: 210px;
    }

    .miniHint{
      margin-top: 6px;
      color: rgba(15,23,42,0.62);
      font-weight: 800;
      font-size: 12px;
    }

    .sectionBand{
      border-radius: var(--radius);
      padding: 14px 14px;
      border: 1px solid rgba(15,23,42,0.10);
    }

    .h2hCard{
      padding: 16px 16px;
      border-radius: var(--radius);
      border: 1px solid rgba(15,23,42,0.12);
      box-shadow: var(--shadow);
    }
    .h2hTitle{
      font-size: 20px;
      font-weight: 950;
      letter-spacing: -0.02em;
      margin: 0;
    }
    .h2hSubtitle{
      margin-top: 6px;
      color: rgba(15,23,42,0.66);
      font-weight: 750;
      font-size: 13px;
    }
    .h2hRow{
      display:grid;
      grid-template-columns: 1fr 1fr;
      gap: 12px;
      margin-top: 14px;
      align-items:start;
    }
    .h2hSide{
      background: rgba(255,255,255,0.55);
      border: 1px solid rgba(15,23,42,0.12);
      border-radius: 16px;
      padding: 12px 12px;
      box-shadow: 0 8px 22px rgba(2,6,23,0.05);
    }
    .h2hNameLine{
      display:flex;
      align-items:baseline;
      gap: 8px;
      margin-bottom: 10px;
    }
    .teamBracket{
      font-size: 12px;
      font-weight: 900;
      opacity: 0.75;
    }
    .h2hName{
      font-size: 20px;
      font-weight: 950;
      letter-spacing: -0.02em;
      line-height: 1.05;
    }
    .h2hKpis{
      display:flex;
      flex-direction:column;
      gap: 10px;
    }

    @media (max-width: 980px){
      .topLanes{ grid-template-columns: 1fr; }
      .grid2{ grid-template-columns: 1fr; }
      table{ min-width: 520px; }
      .controlsCard{ min-width: 0; width: 100%; }
      .headerRow{ flex-direction: column; align-items: stretch; }
    }
  `;

  return (
    <div className="app">
      <style>{styles}</style>

      {/* Header */}
      <div className="headerRow">
        <div className="headerLeft">
          <img
            className="logo"
            src="/moneycontrol-logo-vector.png"
            alt="Moneycontrol"
            onError={(e) => (e.currentTarget.style.display = "none")}
          />
          <div>
            <h1>Moneycontrol CricPulse</h1>
            <div className="subtitle">Cricket Intelligence Platform</div>
          </div>
        </div>

        {/* Controls (top-right): Over + Ball */}
        <div className="card controlsCard" style={{ "--pct": overPct }}>
          <div className="controlLabel">Over</div>
          <div className="overRow" style={{ marginBottom: 10 }}>
            <div className="overPill">Over {over0}</div>
            <input
              className="overRange"
              type="range"
              min="0"
              max="19"
              value={over0}
              onChange={(e) => setOver0(Number(e.target.value))}
            />
          </div>

          <div className="controlLabel">Ball in over (1–6, legal)</div>
          <div className="ballRow" aria-label="Ball selector">
            {[1, 2, 3, 4, 5, 6].map((b) => (
              <div
                key={b}
                className={`ballDot ${b <= ball1to6 ? "active" : ""}`}
                onClick={() => setBall1to6(b)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && setBall1to6(b)}
                title={`Ball ${b}`}
              >
                <span>{b}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Error/loading */}
      {error && (
        <div className="error">
          <div style={{ fontWeight: 950, marginBottom: 4 }}>Error</div>
          <div style={{ color: "rgba(15,23,42,0.80)", fontWeight: 700 }}>{error}</div>
        </div>
      )}
      {loading && <div className="note">Loading…</div>}

      {/* Top: Batter + Bowler sections with your new layouts */}
      <div className="topLanes">
        {/* Batter lane: Batter card + Team record share ONE gradient */}
        <div className="lane" style={{ background: batterCardBg }}>
          <div className="lanePanel">
            <div className="cardRow">
              <div className="cardLeft">
                <div className="cardTitle">Batter</div>
                <div className="playerSelectWrap">
                  <SearchSelect
                    label={null}
                    placeholder="Search batter (try last name)…"
                    options={battersList}
                    value={batter}
                    onChange={setBatter}
                    disabled={loadingPlayers}
                  />
                </div>
                <div className="teamUnderSelect">{batterCard?.team || "—"}</div>
              </div>

              <div className="cardRight">
                <div className="kpiStackRight">
                  <Kpi value={fmt(batterCard?.sr, "sr")} label="Strike rate" align="right" />
                  <Kpi
                    value={fmtPct(batterCard?.dismissal_pct_per_start, "dismissal_pct_per_start")}
                    label="Dismissal % (per start)"
                    align="right"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="lanePanel lanePanelTable">
            <Table
              title="Team record — Batter vs opponents"
              rows={batterTeamRows}
              columns={[
                { key: "bowling_team", label: "Opposition" },
                { key: "runs", label: "Runs" },
                { key: "balls", label: "Balls" },
                { key: "outs", label: "Outs" },
                { key: "sr", label: "Strike rate" },
                { key: "dismissal_%", label: "Dismissal rate" },
              ]}
            />
          </div>
        </div>

        {/* Bowler lane: Bowler card + Team record share ONE gradient */}
        <div className="lane" style={{ background: bowlerCardBg }}>
          <div className="lanePanel">
            <div className="cardRow">
              <div className="cardLeft">
                <div className="cardTitle">Bowler</div>
                <div className="playerSelectWrap">
                  <SearchSelect
                    label={null}
                    placeholder="Search bowler (try last name)…"
                    options={bowlersList}
                    value={bowler}
                    onChange={setBowler}
                    disabled={loadingPlayers}
                  />
                </div>
                <div className="teamUnderSelect">{bowlerCard?.team || "—"}</div>
              </div>

              <div className="cardRight">
                <div className="kpiStackRight">
                  <Kpi value={fmt(bowlerCard?.economy, "econ")} label="Economy" align="right" />
                  <Kpi
                    value={fmtPct(bowlerCard?.wicket_pct_per_start, "wicket_pct_per_start")}
                    label="Wicket-in-window %"
                    align="right"
                  />
                  <Kpi
                    value={fmtPct(bowlerCard?.wickets_share_of_total, "wickets_share_of_total")}
                    label="Wicket share of total"
                    align="right"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="lanePanel lanePanelTable">
            <Table
              title="Team record — Bowler vs opponents"
              rows={bowlerTeamRows}
              columns={[
                { key: "batting_team", label: "Opposition" },
                { key: "runs_conceded", label: "Runs conceded" },
                { key: "legal_balls", label: "Deliveries" },
                { key: "wkts", label: "Wickets" },
                { key: "econ", label: "Economy" },
                { key: "wicket_pct_per_start", label: "Wickets ratio" },
              ]}
            />
          </div>
        </div>
      </div>

      /* Best overall (Top 10, sorted) */}
      <div className="grid2" style={{ marginTop: 8 }}>
        <div>
          <Table
            title="Best batters overall (Top 10)"
            rows={bestBattersTop10}
            columns={[
              { key: "batter", label: "Batter" },
              { key: "runs", label: "Runs" },
              { key: "balls", label: "Balls" },
              { key: "outs", label: "Outs" },
              { key: "sr", label: "Strike rate" },
              { key: "dismissal_%", label: "Dismissal rate" },
            ]}
          />
        </div>

        <div>
          <Table
            title="Best bowlers overall (Top 10)"
            rows={bestBowlersTop10}
            columns={[
              { key: "bowler", label: "Bowler" },
              { key: "runs_conceded", label: "Runs conceded" },
              { key: "legal_balls", label: "Deliveries" },
              { key: "wkts", label: "Wickets" },
              { key: "econ", label: "Economy" },
              { key: "wicket_pct_per_start", label: "Wickets ratio" },
            ]}
          />
        </div>
      </div>

      {/* Head-to-head (renamed + redesigned) */}
      <div className="h2hCard" style={{ marginTop: 16, background: h2hBg }}>
        <div>
          <div className="h2hTitle">Head-to-head</div>
          <div className="h2hSubtitle">{matchupLine}</div>
        </div>

        <div className="h2hRow">
          {/* Batter side (left) */}
          <div className="h2hSide">
            <div className="h2hNameLine">
              <span className="teamBracket">({batterCard?.team || "—"})</span>
              <span className="h2hName">{batter || "—"}</span>
            </div>
            <div className="h2hKpis">
              <Kpi value={fmt(matchup?.batter_sr_vs_bowler, "sr_vs_bowler")} label="Strike rate vs bowler" align="left" />
              <Kpi value={fmtPct(matchup?.batter_dismissal_pct_per_start, "dismissal_pct_per_start")} label="Dismissal % (per start)" align="left" />
            </div>
          </div>

          {/* Bowler side (right) */}
          <div className="h2hSide" style={{ textAlign: "right" }}>
            <div className="h2hNameLine" style={{ justifyContent: "flex-end" }}>
              <span className="teamBracket">({bowlerCard?.team || "—"})</span>
              <span className="h2hName">{bowler || "—"}</span>
            </div>
            <div className="h2hKpis">
              <Kpi value={fmt(matchup?.bowler_economy_vs_batter, "econ")} label="Economy vs batter" align="right" />
              <Kpi value={fmtPct(matchup?.bowler_wicket_pct_per_start, "wicket_pct_per_start")} label="Wicket-in-window %" align="right" />
            </div>
          </div>
        </div>
      </div>

      {/* Top 5 matchup tables */}
      <div className="grid2" style={{ marginTop: 10 }}>
        <div>
          <Table
            title="Top 5 bowlers vs this batter (same slot)"
            rows={top5BowlersSorted}
            columns={[
              { key: "bowler", label: "Bowler" },
              { key: "balls", label: "Balls" },
              { key: "econ_vs_batter", label: "Economy" },
              { key: "wkts", label: "Wickets" },
              { key: "wicket_pct_per_start", label: "Wickets ratio" },
            ]}
          />
        </div>

        <div>
          <Table
            title="Top 5 batters vs this bowler (same slot)"
            rows={top5BattersSorted}
            columns={[
              { key: "batter", label: "Batter" },
              { key: "balls", label: "Balls" },
              { key: "sr_vs_bowler", label: "Strike rate" },
              { key: "outs", label: "Outs" },
              { key: "dismissal_pct_per_start", label: "Dismissal rate" },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
