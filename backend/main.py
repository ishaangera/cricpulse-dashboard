import os
from functools import lru_cache

import pandas as pd
from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware

from cricpulse_engine import (
    load_df_cached,
    compute_batter_card,
    compute_bowler_card,
    compute_matchup_block,
    top_bowlers_vs_batter_same_slot,
    top_batters_vs_bowler_same_slot,
    best_batters_overall_same_slot,
    best_bowlers_overall_same_slot,
    opposition_split_batter,
    opposition_split_bowler,
)

ZIP_PATH = os.getenv("CRICPULSE_ZIP", "T20I match data.zip")

app = FastAPI(title="CricPulse API", version="1.0")


app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://moneycontrolcricpulse.netlify.app",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



@lru_cache(maxsize=1)
def load_all() -> pd.DataFrame:
    return load_df_cached(ZIP_PATH)


@app.get("/health")
def health():
    return {"ok": True}


@app.get("/players")
def players():
    df = load_all()

    batters = sorted(df["batter"].dropna().astype(str).unique().tolist())
    bowlers = sorted(df["bowler"].dropna().astype(str).unique().tolist())

    teams = []
    if "batting_team" in df.columns:
        teams = sorted(df["batting_team"].dropna().astype(str).unique().tolist())

    return {"batters": batters, "bowlers": bowlers, "teams": teams}


@app.get("/matchup")
def matchup(
    batter: str = Query(...),
    bowler: str = Query(...),
    start_over0: int = Query(0, ge=0, le=19),
    start_ball0: int = Query(0, ge=0, le=5),
    min_balls: int = Query(6, ge=1),
):
    df = load_all()

    batter_card = compute_batter_card(df, batter, start_over0, start_ball0)
    bowler_card = compute_bowler_card(df, bowler, start_over0, start_ball0)
    matchup_block = compute_matchup_block(df, batter, bowler, start_over0, start_ball0)

    top_bowlers = top_bowlers_vs_batter_same_slot(df, batter, start_over0, start_ball0, min_balls=min_balls)
    top_batters = top_batters_vs_bowler_same_slot(df, bowler, start_over0, start_ball0, min_balls=min_balls)

    best_batters = best_batters_overall_same_slot(df, start_over0, start_ball0, min_runs=150)
    best_bowlers = best_bowlers_overall_same_slot(df, start_over0, start_ball0, min_deliveries=36)

    opp_batter = opposition_split_batter(df, batter, start_over0, start_ball0, min_runs=100)
    opp_bowler = opposition_split_bowler(df, bowler, start_over0, start_ball0, min_deliveries=25)

    # Top-5 (as in Streamlit sections)
    top5_bowlers = top_bowlers.head(5)
    top5_batters = top_batters.head(5)

    return {
        "ok": True,
        "slot": {"start_over0": start_over0, "start_ball0": start_ball0, "overs": 3},
        "batter_card": batter_card,
        "bowler_card": bowler_card,
        "matchup": matchup_block,
        "tables": {
            "top_bowlers_vs_batter_same_slot": top_bowlers.to_dict("records"),
            "top_batters_vs_bowler_same_slot": top_batters.to_dict("records"),
            "best_batters_overall_same_slot": best_batters.to_dict("records"),
            "best_bowlers_overall_same_slot": best_bowlers.to_dict("records"),
            "top5_bowlers_vs_batter_same_slot": top5_bowlers.to_dict("records"),
            "top5_batters_vs_bowler_same_slot": top5_batters.to_dict("records"),
            "opposition_split_batter_same_slot": opp_batter.to_dict("records"),
            "opposition_split_bowler_same_slot": opp_bowler.to_dict("records"),
        },
    }
