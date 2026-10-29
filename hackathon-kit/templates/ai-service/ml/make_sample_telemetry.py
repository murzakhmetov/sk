"""Generate `ml/sample_telemetry.csv` — SYNTHETIC per-player telemetry with an `is_bot` label.

The data is invented (no real players): bots grind one job for long, steady, night-heavy
sessions and barely chat. Some "stealth" bots and human "grinders" overlap on purpose, so the
task is learnable but not trivial. Replace with the case data as soon as you have it.

    python -m ml.make_sample_telemetry --rows 500 --out ml/sample_telemetry.csv
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

SERVERS = [f"s{i:02d}" for i in range(1, 36)]
BOT_FARM_SERVERS = ["s03", "s17", "s29"]  # bots cluster on a few servers


def generate(rows: int = 500, bot_share: float = 0.15, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    is_bot = rng.random(rows) < bot_share
    stealth = is_bot & (rng.random(rows) < 0.35)  # bots that imitate humans on several signals
    grinder = ~is_bot & (rng.random(rows) < 0.10)  # humans who play like bots

    def pick(bot: np.ndarray, human: np.ndarray) -> np.ndarray:
        return np.where(is_bot, bot, human)

    apm = pick(rng.normal(40, 12, rows), rng.lognormal(np.log(25), 0.4, rows))
    apm = np.where(stealth, rng.lognormal(np.log(27), 0.4, rows), apm)
    session = pick(rng.normal(180, 80, rows), rng.gamma(2.0, 35.0, rows))
    session = np.where(stealth, rng.gamma(2.0, 45.0, rows), session)
    session = np.where(grinder, rng.normal(200, 60, rows), session)
    night = pick(rng.beta(4, 4, rows), rng.beta(2, 5, rows))
    night = np.where(grinder, rng.beta(4, 4, rows), night)
    jobs = pick(rng.poisson(1.2, rows) + 1, rng.poisson(3, rows) + 1)
    jobs = np.where(grinder, rng.poisson(1.2, rows) + 1, jobs)
    chat = pick(rng.gamma(1.5, 3.0, rows), rng.gamma(2.0, 5.0, rows))
    chat = np.where(stealth, rng.gamma(2.0, 5.0, rows), chat)  # stealth bots post canned chat lines
    money = pick(rng.lognormal(np.log(60_000), 0.4, rows), rng.lognormal(np.log(40_000), 0.5, rows))

    server = np.where(is_bot & (rng.random(rows) < 0.5), rng.choice(BOT_FARM_SERVERS, rows), rng.choice(SERVERS, rows))
    df = pd.DataFrame(
        {
            "player_id": [f"P{100000 + i}" for i in range(rows)],
            "server": server,
            "actions_per_min": np.clip(apm, 1, None).round(1),
            "avg_session_min": np.clip(session, 3, 720).round(0),
            "night_play_ratio": night.round(3),
            "distinct_jobs": jobs.astype(int),
            "chat_msgs_per_hour": chat.round(2),
            "money_earned_per_hour": money.round(-2),
            "is_bot": is_bot.astype(int),
        }
    )
    for column in ("avg_session_min", "chat_msgs_per_hour"):  # real telemetry has gaps
        df.loc[rng.random(rows) < 0.03, column] = np.nan
    return df


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else None)
    parser.add_argument("--rows", type=int, default=500)
    parser.add_argument("--bot-share", type=float, default=0.15)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out", type=Path, default=Path("ml/sample_telemetry.csv"))
    args = parser.parse_args(argv)
    df = generate(args.rows, args.bot_share, args.seed)
    df.to_csv(args.out, index=False)
    print(f"wrote {args.out}: {len(df)} rows, bots {df['is_bot'].mean():.1%}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
