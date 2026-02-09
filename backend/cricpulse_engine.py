from __future__ import annotations

import hashlib
import zipfile
from pathlib import Path
from typing import Any, Optional

import pandas as pd

try:
    import orjson  # type: ignore
except Exception:
    orjson = None  # type: ignore


CACHE_DIR = Path("cache")
CACHE_DIR.mkdir(exist_ok=True)

NON_BOWLER_WICKET_KINDS = {
    "run out",
    "retired hurt",
    "retired out",
    "obstructing the field",
    "handled the ball",
    "timed out",
}


# ----------------------------
# Helpers
# ----------------------------
def _zip_fingerprint(zip_path: str) -> str:
    p = Path(zip_path)
    st = p.stat()
    key = f"{p.resolve()}|{st.st_size}|{st.st_mtime}".encode("utf-8")
    return hashlib.md5(key).hexdigest()


def _safe_json_loads(text: str) -> dict[str, Any] | None:
    text = text.lstrip("\ufeff").strip()
    if not text:
        return None
    try:
        if orjson is not None:
            obj = orjson.loads(text.encode("utf-8"))
        else:
            import json

            obj = json.loads(text)
    except Exception:
        return None
    return obj if isinstance(obj, dict) else None


def _safe_json_from_zip(z: zipfile.ZipFile, fname: str) -> dict[str, Any] | None:
    try:
        raw = z.read(fname)
    except Exception:
        return None
    if not raw:
        return None
    txt = raw.decode("utf-8", errors="ignore")
    return _safe_json_loads(txt)


def _mode(series: pd.Series) -> Optional[str]:
    if series is None or series.empty:
        return None
    vc = series.dropna().astype(str).value_counts()
    return vc.index[0] if not vc.empty else None


def _match_innings_key(df: pd.DataFrame) -> pd.Series:
    # unique "start" definition: match_id + innings
    return df["match_id"].astype(str) + "||" + df["innings"].astype(str)


def _apply_slot_filter(df: pd.DataFrame, start_over0: int, start_ball0: int, overs: int = 3) -> pd.DataFrame:
    w = df[(df["over"] >= start_over0) & (df["over"] < start_over0 + overs)].copy()
    w = w[(w["over"] > start_over0) | (w["ball_in_over"] >= start_ball0)]
    return w


def _ensure_schema(df: pd.DataFrame) -> pd.DataFrame:
    """
    If user had an older cache / CSV fallback, schema may miss:
    - is_batter_out
    - bowler_credit_wicket
    - batting_team / bowling_team
    - total_runs, batter_runs, extras
    This function tries to derive missing columns safely.
    """
    df = df.copy()

    # Basic required
    required = ["match_id", "innings", "over", "ball_in_over", "batter", "bowler"]
    for c in required:
        if c not in df.columns:
            raise ValueError(f"Input dataframe missing required column: {c}")

    # Runs columns
    if "total_runs" not in df.columns:
        if "runs_off_bat" in df.columns and "extras" in df.columns:
            df["total_runs"] = df["runs_off_bat"].fillna(0).astype(int) + df["extras"].fillna(0).astype(int)
        elif "runs" in df.columns:
            df["total_runs"] = pd.to_numeric(df["runs"], errors="coerce").fillna(0).astype(int)
        else:
            df["total_runs"] = 0

    if "batter_runs" not in df.columns:
        if "runs_off_bat" in df.columns:
            df["batter_runs"] = pd.to_numeric(df["runs_off_bat"], errors="coerce").fillna(0).astype(int)
        else:
            df["batter_runs"] = 0

    if "extras" not in df.columns:
        if "extras_runs" in df.columns:
            df["extras"] = pd.to_numeric(df["extras_runs"], errors="coerce").fillna(0).astype(int)
        else:
            df["extras"] = 0

    # Wicket columns
    if "player_out" not in df.columns:
        for alt in ["player_dismissed", "wicket_player_out", "out_player"]:
            if alt in df.columns:
                df["player_out"] = df[alt]
                break
        else:
            df["player_out"] = None

    if "wicket_kind" not in df.columns:
        for alt in ["kind", "wicket_type", "dismissal_kind"]:
            if alt in df.columns:
                df["wicket_kind"] = df[alt]
                break
        else:
            df["wicket_kind"] = None

    if "is_batter_out" not in df.columns:
        df["is_batter_out"] = (df["player_out"].notna() & (df["player_out"] == df["batter"])).astype(int)

    if "bowler_credit_wicket" not in df.columns:
        wk = df["wicket_kind"].astype(str).str.strip().str.lower()
        has_wk = df["player_out"].notna()
        no_credit = wk.isin(NON_BOWLER_WICKET_KINDS)
        df["bowler_credit_wicket"] = (has_wk & ~no_credit).astype(int)

    # Teams (optional but used in opposition split)
    if "batting_team" not in df.columns:
        for alt in ["battingTeam", "bat_team", "batting_side"]:
            if alt in df.columns:
                df["batting_team"] = df[alt]
                break
        else:
            df["batting_team"] = None

    if "bowling_team" not in df.columns:
        for alt in ["bowlingTeam", "bowl_team", "bowling_side"]:
            if alt in df.columns:
                df["bowling_team"] = df[alt]
                break
        else:
            df["bowling_team"] = None

    # Clean numeric
    df["over"] = pd.to_numeric(df["over"], errors="coerce").astype("Int64")
    df["ball_in_over"] = pd.to_numeric(df["ball_in_over"], errors="coerce").astype("Int64")
    df["total_runs"] = pd.to_numeric(df["total_runs"], errors="coerce").fillna(0).astype(int)
    df["is_batter_out"] = pd.to_numeric(df["is_batter_out"], errors="coerce").fillna(0).astype(int)
    df["bowler_credit_wicket"] = pd.to_numeric(df["bowler_credit_wicket"], errors="coerce").fillna(0).astype(int)

    df = df.dropna(subset=["over", "ball_in_over", "batter", "bowler"]).reset_index(drop=True)
    df["over"] = df["over"].astype(int)
    df["ball_in_over"] = df["ball_in_over"].astype(int)

    return df


# ----------------------------
# New metrics (your definitions)
# ----------------------------
def _wicket_in_window_probability_pct(d: pd.DataFrame) -> float:
    """
    Wicket-in-window probability (per start):
    Event = 1 if at least one bowler-credit wicket occurs in the 3-over window for a start (match+innings),
    else 0. Returns percent [0,100].
    """
    if d.empty:
        return 0.0
    start_key = _match_innings_key(d)
    wkts_per_start = d.assign(start_key=start_key).groupby("start_key")["bowler_credit_wicket"].sum()
    return round(float(wkts_per_start.ge(1).mean() * 100), 1)


def _wicket_share_of_total_matchwise_mean_pct(df_all_bowler: pd.DataFrame, df_window_bowler: pd.DataFrame) -> float:
    """
    Option A — Average of match-wise shares (recommended)
    Each match treated equally:
      mean( w_window,match / w_total,match ) * 100
    Skip matches where w_total,match == 0.
    """
    if df_all_bowler.empty:
        return 0.0

    all_key = _match_innings_key(df_all_bowler)
    total = df_all_bowler.assign(start_key=all_key).groupby("start_key")["bowler_credit_wicket"].sum()

    if df_window_bowler.empty:
        aligned = total.to_frame("total")
        aligned["window"] = 0
    else:
        win_key = _match_innings_key(df_window_bowler)
        window = df_window_bowler.assign(start_key=win_key).groupby("start_key")["bowler_credit_wicket"].sum()
        aligned = total.to_frame("total").join(window.rename("window"), how="left").fillna(0)

    aligned = aligned[aligned["total"] > 0]
    if aligned.empty:
        return 0.0

    return round(float((aligned["window"] / aligned["total"]).mean() * 100), 1)


# ----------------------------
# Caching + parsing
# ----------------------------
def load_df_cached(zip_path: str) -> pd.DataFrame:
    fp = _zip_fingerprint(zip_path)
    parquet_path = CACHE_DIR / f"deliveries_{fp}.parquet"
    pickle_path = CACHE_DIR / f"deliveries_{fp}.pkl"

    df = None

    if parquet_path.exists():
        try:
            df = pd.read_parquet(parquet_path)
        except Exception:
            df = None

    if df is None and pickle_path.exists():
        df = pd.read_pickle(pickle_path)

    if df is None:
        df = parse_zip_to_deliveries(zip_path)

    # ensure schema
    df = _ensure_schema(df)

    # Re-cache with updated schema
    try:
        df.to_parquet(parquet_path, index=False)
    except Exception:
        df.to_pickle(pickle_path)

    return df


def parse_zip_to_deliveries(zip_path: str) -> pd.DataFrame:
    zp = Path(zip_path)
    if not zp.exists():
        raise FileNotFoundError(f"ZIP not found: {zp.resolve()}")

    rows: list[dict[str, Any]] = []

    with zipfile.ZipFile(zp, "r") as z:
        names = [n for n in z.namelist() if not n.endswith("/")]
        json_names = [n for n in names if n.lower().endswith(".json")]
        csv_names = [n for n in names if n.lower().endswith(".csv")]

        if not json_names and csv_names:
            with z.open(csv_names[0]) as f:
                return pd.read_csv(f)

        if not json_names:
            exts = sorted({Path(n).suffix.lower() for n in names})
            raise ValueError(f"No JSON/CSV found in ZIP. Found extensions: {exts}")

        used = 0

        for fname in json_names:
            match = _safe_json_from_zip(z, fname)
            if match is None:
                continue
            used += 1

            info = match.get("info", {}) if isinstance(match.get("info"), dict) else {}
            teams = info.get("teams")
            match_teams = teams if isinstance(teams, list) else None

            innings = match.get("innings", [])
            if not isinstance(innings, list):
                continue

            for idx, inn in enumerate(innings, start=1):
                inn_name = f"innings_{idx}"
                inn_obj: dict[str, Any] | None = None

                if isinstance(inn, dict):
                    if len(inn) == 1:
                        inn_name, inn_obj = next(iter(inn.items()))
                    else:
                        inn_obj = inn

                if not isinstance(inn_obj, dict):
                    continue

                batting_team = (
                    inn_obj.get("team")
                    or inn_obj.get("batting_team")
                    or inn_obj.get("battingTeam")
                )

                bowling_team = None
                if match_teams and isinstance(match_teams, list) and batting_team in match_teams and len(match_teams) >= 2:
                    bowling_team = next((t for t in match_teams if t != batting_team), None)

                overs = inn_obj.get("overs")
                if not isinstance(overs, list):
                    overs = []

                for over_obj in overs:
                    if not isinstance(over_obj, dict):
                        continue
                    over_num = over_obj.get("over")
                    deliveries = over_obj.get("deliveries", [])
                    if not isinstance(deliveries, list):
                        continue

                    for i, d in enumerate(deliveries):
                        if not isinstance(d, dict):
                            continue

                        batter = d.get("batter") or d.get("striker") or d.get("batsman")
                        bowler = d.get("bowler")
                        non_striker = d.get("non_striker") or d.get("nonStriker")

                        runs = d.get("runs", {}) if isinstance(d.get("runs"), dict) else {}
                        batter_runs = int(runs.get("batter", runs.get("batsman", 0)) or 0)
                        extras = int(runs.get("extras", 0) or 0)
                        total_runs = int(runs.get("total", batter_runs + extras) or 0)

                        player_out = None
                        wicket_kind = None
                        bowler_credit_wicket = 0

                        w_list = d.get("wickets")
                        if isinstance(w_list, list) and len(w_list) > 0 and isinstance(w_list[0], dict):
                            w0 = w_list[0]
                            player_out = w0.get("player_out")
                            wicket_kind = w0.get("kind")
                        w1 = d.get("wicket")
                        if player_out is None and isinstance(w1, dict):
                            player_out = w1.get("player_out")
                            wicket_kind = w1.get("kind")

                        if wicket_kind and isinstance(wicket_kind, str):
                            k = wicket_kind.strip().lower()
                            bowler_credit_wicket = 0 if k in NON_BOWLER_WICKET_KINDS else (1 if player_out else 0)
                        else:
                            bowler_credit_wicket = 1 if player_out else 0

                        is_batter_out = 1 if (player_out is not None and batter is not None and player_out == batter) else 0

                        ball_in_over = d.get("ball", None)
                        if ball_in_over is None:
                            ball_in_over = i

                        rows.append(
                            {
                                "match_id": fname,
                                "innings": inn_name,
                                "batting_team": batting_team,
                                "bowling_team": bowling_team,
                                "over": int(over_num) if over_num is not None else None,
                                "ball_in_over": int(ball_in_over),
                                "batter": batter,
                                "bowler": bowler,
                                "non_striker": non_striker,
                                "batter_runs": batter_runs,
                                "extras": extras,
                                "total_runs": total_runs,
                                "player_out": player_out,
                                "wicket_kind": wicket_kind,
                                "is_batter_out": int(is_batter_out),
                                "bowler_credit_wicket": int(bowler_credit_wicket),
                            }
                        )

        if used == 0:
            raise ValueError("Found JSON files but none were valid.")

    df = pd.DataFrame(rows)
    if df.empty:
        raise ValueError("Parsed 0 deliveries — JSON schema might be different.")

    return df


# ----------------------------
# Public API used by main.py
# ----------------------------
def compute_batter_card(df: pd.DataFrame, batter: str, start_over0: int, start_ball0: int) -> dict[str, Any]:
    w = _apply_slot_filter(df, start_over0, start_ball0)
    d = w[w["batter"] == batter].copy()
    if d.empty:
        return {"name": batter, "ok": False}

    starts = _match_innings_key(d).nunique()
    balls = int(len(d))
    runs = int(d["total_runs"].sum())
    outs = int(d["is_batter_out"].sum())
    sr = round((runs / balls) * 100, 1) if balls else 0.0
    dismissal_pct = round((outs / starts) * 100, 1) if starts else 0.0
    team = _mode(d["batting_team"])
    return {
        "ok": True,
        "name": batter,
        "team": team,
        "sr": sr,
        "dismissal_pct_per_start": dismissal_pct,
        "historical_starts": int(starts),
        "balls_in_sample": balls,
    }


def compute_bowler_card(df: pd.DataFrame, bowler: str, start_over0: int, start_ball0: int) -> dict[str, Any]:
    w = _apply_slot_filter(df, start_over0, start_ball0)
    d = w[w["bowler"] == bowler].copy()
    if d.empty:
        return {"name": bowler, "ok": False}

    starts = _match_innings_key(d).nunique()
    balls = int(len(d))
    runs_conceded = int(d["total_runs"].sum())
    econ = round((runs_conceded / balls) * 6, 2) if balls else 0.0

    wicket_prob = _wicket_in_window_probability_pct(d)

    all_b = df[df["bowler"] == bowler].copy()
    share = _wicket_share_of_total_matchwise_mean_pct(all_b, d)

    team = _mode(d["bowling_team"]) or _mode(d["batting_team"])
    return {
        "ok": True,
        "name": bowler,
        "team": team,
        "economy": econ,
        "wicket_pct_per_start": wicket_prob,
        "wickets_share_of_total": share,
        "historical_starts": int(starts),
    }


def compute_matchup_block(df: pd.DataFrame, batter: str, bowler: str, start_over0: int, start_ball0: int) -> dict[str, Any]:
    w = _apply_slot_filter(df, start_over0, start_ball0)
    d = w[(w["batter"] == batter) & (w["bowler"] == bowler)].copy()
    if d.empty:
        return {"ok": False, "reason": "no_sample"}

    starts = _match_innings_key(d).nunique()
    balls = int(len(d))
    runs = int(d["total_runs"].sum())
    outs = int(d["is_batter_out"].sum())

    sr = round((runs / balls) * 100, 1) if balls else 0.0
    dismissal_pct = round((outs / starts) * 100, 1) if starts else 0.0
    econ = round((runs / balls) * 6, 2) if balls else 0.0

    wicket_prob = _wicket_in_window_probability_pct(d)

    return {
        "ok": True,
        "batter_sr_vs_bowler": sr,
        "batter_dismissal_pct_per_start": dismissal_pct,
        "bowler_economy_vs_batter": econ,
        "bowler_wicket_pct_per_start": wicket_prob,
        "starts": int(starts),
        "balls": balls,
    }


def top_bowlers_vs_batter_same_slot(df: pd.DataFrame, batter: str, start_over0: int, start_ball0: int, min_balls: int = 6) -> pd.DataFrame:
    w = _apply_slot_filter(df, start_over0, start_ball0)
    d = w[w["batter"] == batter].copy()
    if d.empty:
        return pd.DataFrame([])

    d["start_key"] = _match_innings_key(d)

    g = d.groupby("bowler").agg(
        balls=("total_runs", "size"),
        runs_conceded=("total_runs", "sum"),
        wkts=("bowler_credit_wicket", "sum"),
        historical_starts=("start_key", "nunique"),
    )
    g = g[g["balls"] >= min_balls].copy()
    if g.empty:
        return pd.DataFrame([])

    g["econ_vs_batter"] = (g["runs_conceded"] / g["balls"]) * 6

    bowler_start_event = (
        d.groupby(["bowler", "start_key"])["bowler_credit_wicket"]
        .sum()
        .ge(1)
        .reset_index(name="event")
    )
    prob = bowler_start_event.groupby("bowler")["event"].mean().mul(100)
    g["wicket_pct_per_start"] = g.index.map(lambda b: float(prob.get(b, 0.0))).round(1)

    return g.sort_values(["econ_vs_batter", "balls"], ascending=[True, False]).reset_index()


def top_batters_vs_bowler_same_slot(df: pd.DataFrame, bowler: str, start_over0: int, start_ball0: int, min_balls: int = 6) -> pd.DataFrame:
    w = _apply_slot_filter(df, start_over0, start_ball0)
    d = w[w["bowler"] == bowler].copy()
    if d.empty:
        return pd.DataFrame([])

    d["start_key"] = _match_innings_key(d)

    g = d.groupby("batter").agg(
        balls=("total_runs", "size"),
        runs=("total_runs", "sum"),
        outs=("is_batter_out", "sum"),
        historical_starts=("start_key", "nunique"),
    )
    g = g[g["balls"] >= min_balls].copy()
    if g.empty:
        return pd.DataFrame([])

    g["sr_vs_bowler"] = (g["runs"] / g["balls"]) * 100
    g["dismissal_pct_per_start"] = (g["outs"] / g["historical_starts"]) * 100
    return g.sort_values(["sr_vs_bowler", "balls"], ascending=[False, False]).reset_index()


def best_batters_overall_same_slot(
    df: pd.DataFrame,
    start_over0: int,
    start_ball0: int,
    min_runs: int = 150,
) -> pd.DataFrame:
    """Best batters overall in the selected 3-over window.

    Threshold rule (your spec):
      - Keep rows with at least `min_runs` total runs in the window (default 150).
    """
    w = _apply_slot_filter(df, start_over0, start_ball0).copy()
    if w.empty:
        return pd.DataFrame([])

    w["start_key"] = _match_innings_key(w)

    g = w.groupby("batter").agg(
        Historical_starts=("start_key", "nunique"),
        runs=("total_runs", "sum"),
        balls=("total_runs", "size"),
        outs=("is_batter_out", "sum"),
    )

    # ✅ threshold: minimum runs
    g = g[g["runs"] >= int(min_runs)].copy()
    if g.empty:
        return pd.DataFrame([])

    g["sr"] = (g["runs"] / g["balls"]) * 100
    g["dismissal_%"] = (g["outs"] / g["Historical_starts"]) * 100

    return g.sort_values(["sr", "runs"], ascending=[False, False]).reset_index()

def best_bowlers_overall_same_slot(
    df: pd.DataFrame,
    start_over0: int,
    start_ball0: int,
    min_deliveries: int = 36,
) -> pd.DataFrame:
    """Best bowlers overall in the selected 3-over window.

    Threshold rule (your spec):
      - Keep rows with at least `min_deliveries` legal deliveries in the window (default 36).
    """
    w = _apply_slot_filter(df, start_over0, start_ball0).copy()
    if w.empty:
        return pd.DataFrame([])

    w["start_key"] = _match_innings_key(w)

    g = w.groupby("bowler").agg(
        Historical_starts=("start_key", "nunique"),
        runs_conceded=("total_runs", "sum"),
        legal_balls=("total_runs", "size"),
        wkts=("bowler_credit_wicket", "sum"),
    )

    # ✅ threshold: minimum deliveries
    g = g[g["legal_balls"] >= int(min_deliveries)].copy()
    if g.empty:
        return pd.DataFrame([])

    g["econ"] = (g["runs_conceded"] / g["legal_balls"]) * 6

    # wicket-in-window probability per start
    bowler_start_event = (
        w.groupby(["bowler", "start_key"])["bowler_credit_wicket"]
        .sum()
        .ge(1)
        .reset_index(name="event")
    )
    prob = bowler_start_event.groupby("bowler")["event"].mean().mul(100)
    g["wicket_pct_per_start"] = g.index.map(lambda b: float(prob.get(b, 0.0))).round(1)

    # match-wise share-of-total wickets (Option A)
    total_by_start = df.groupby(["bowler", "match_id", "innings"])["bowler_credit_wicket"].sum()
    # keep a simple total wickets column too (useful in tables)
    total_wkts = df.groupby("bowler")["bowler_credit_wicket"].sum()
    g["total_wkts"] = g.index.map(lambda b: int(total_wkts.get(b, 0)))

    return g.sort_values(["econ", "legal_balls"], ascending=[True, False]).reset_index()

def opposition_split_batter(
    df: pd.DataFrame,
    batter: str,
    start_over0: int,
    start_ball0: int,
    min_runs: int = 100,
) -> pd.DataFrame:
    """Team record — Batter vs opponents (in the selected 3-over window).

    Threshold rule (your spec):
      - Keep opponent rows with at least `min_runs` total runs (default 100).
    """
    w = _apply_slot_filter(df, start_over0, start_ball0).copy()
    d = w[w["batter"] == batter].copy()
    if d.empty:
        return pd.DataFrame([])

    d["start_key"] = _match_innings_key(d)
    opp = d["bowling_team"].fillna("Unknown")

    g = d.assign(bowling_team=opp).groupby("bowling_team").agg(
        Historical_starts=("start_key", "nunique"),
        runs=("total_runs", "sum"),
        balls=("total_runs", "size"),
        outs=("is_batter_out", "sum"),
    )

    # ✅ threshold: minimum runs
    g = g[g["runs"] >= int(min_runs)].copy()
    if g.empty:
        return pd.DataFrame([])

    g["sr"] = (g["runs"] / g["balls"]) * 100
    g["dismissal_%"] = (g["outs"] / g["Historical_starts"]) * 100

    return g.sort_values(["runs", "balls"], ascending=[False, False]).reset_index()

def opposition_split_bowler(
    df: pd.DataFrame,
    bowler: str,
    start_over0: int,
    start_ball0: int,
    min_deliveries: int = 25,
) -> pd.DataFrame:
    """Team record — Bowler vs opponents (in the selected 3-over window).

    Threshold rule (your spec):
      - Keep opponent rows with at least `min_deliveries` legal deliveries (default 25).
    """
    w = _apply_slot_filter(df, start_over0, start_ball0).copy()
    d = w[w["bowler"] == bowler].copy()
    if d.empty:
        return pd.DataFrame([])

    d["start_key"] = _match_innings_key(d)
    opp = d["batting_team"].fillna("Unknown")

    g = d.assign(batting_team=opp).groupby("batting_team").agg(
        Historical_starts=("start_key", "nunique"),
        runs_conceded=("total_runs", "sum"),
        legal_balls=("total_runs", "size"),
        wkts=("bowler_credit_wicket", "sum"),
    )

    # ✅ threshold: minimum deliveries
    g = g[g["legal_balls"] >= int(min_deliveries)].copy()
    if g.empty:
        return pd.DataFrame([])

    g["econ"] = (g["runs_conceded"] / g["legal_balls"]) * 6

    # wicket-in-window probability per start for each opposition team
    team_start_event = (
        d.assign(batting_team=opp)
        .groupby(["batting_team", "start_key"])["bowler_credit_wicket"]
        .sum()
        .ge(1)
        .reset_index(name="event")
    )
    prob = team_start_event.groupby("batting_team")["event"].mean().mul(100)
    g["wicket_pct_per_start"] = g.index.map(lambda t: float(prob.get(t, 0.0))).round(1)

    return g.sort_values(["legal_balls", "Historical_starts"], ascending=[False, False]).reset_index()

