"""FastAPI app (uvicorn locally/Docker, Vercel in production). Serves /api from the bundled CSVs.

Times are UTC (in January UK time equals UTC); power is MW.
"""

import csv
import os
import re
from datetime import date, datetime, time, timedelta
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, HTTPException

from app.analysis import FIRST_DAY, LAST_DAY, Data, histogram, percentile, summarize

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parent.parent / "data"))

app = FastAPI(title="GB Wind Forecast Monitor API")


def read_csv(name: str) -> list[dict]:
    with open(DATA_DIR / name, newline="") as f:
        return list(csv.DictReader(f))


@lru_cache(maxsize=1)
def data() -> tuple[Data, int, int]:
    """Read once per process, so requests never touch disk (or call Elexon)."""
    forecasts = [
        (
            datetime.fromisoformat(r["publish_time"]),
            datetime.fromisoformat(r["start_time"]),
            float(r["generation_mw"]),
        )
        for r in read_csv("windfor.csv")
    ]
    actuals = {
        datetime.fromisoformat(r["start_time"]): float(r["generation_mw"])
        for r in read_csv("fuelhh.csv")
    }
    return Data(forecasts, actuals), len(forecasts), len(actuals)


@lru_cache(maxsize=64)
def month_errors(cutoff: time) -> list[float]:
    """Errors of every decision in January at this cutoff: the history behind the margins."""
    rows = [row for day in days(FIRST_DAY, LAST_DAY) for row in data()[0].decision(day, cutoff)[1]]
    return [row["error_mw"] for row in rows if not row["missing"]]


def days(first: date, last: date) -> list[date]:
    return [first + timedelta(days=i) for i in range((last - first).days + 1)]


def check_day(value: date, name: str) -> date:
    if not FIRST_DAY <= value <= LAST_DAY:
        raise HTTPException(
            400, f"{name} must be a decision day from {FIRST_DAY} to {LAST_DAY}, got {value}"
        )
    return value


def parse_cutoff(value: str) -> time:
    if not re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", value):
        raise HTTPException(400, f"cutoff must be a UK time in HH:MM format, got {value!r}")
    return time.fromisoformat(value)


@app.get("/api/health")
def health():
    _, forecast_rows, actual_rows = data()
    return {"status": "ok", "forecast_rows": forecast_rows, "actual_rows": actual_rows}


@app.get("/api/forecast")
def forecast(date: date, cutoff: str = "09:00"):
    """The forecast available at decision time for the next day, next to the actuals."""
    decided_at, rows = data()[0].decision(check_day(date, "date"), parse_cutoff(cutoff))
    # Likely range for the actual, from January's errors at this cutoff (in-sample):
    # [forecast - P90, forecast - P10] is where the actual landed in 80% of past hours.
    errors = month_errors(parse_cutoff(cutoff))
    p10, p90 = percentile(errors, 10), percentile(errors, 90)
    for row in rows:
        has_range = row["forecast_mw"] is not None and p90 is not None
        row["range_low_mw"] = round(row["forecast_mw"] - p90, 1) if has_range else None
        row["range_high_mw"] = round(row["forecast_mw"] - p10, 1) if has_range else None
    used = [row["publish_time"] for row in rows if row["publish_time"]]
    return {
        "decision_date": date,
        "delivery_date": date + timedelta(days=1),
        "decision_time": decided_at,
        "forecast_publish_time": max(used, default=None),  # newest forecast used for any hour
        "summary": summarize(rows),
        "safety_margin_mw": round(p90, 1) if p90 is not None else None,
        "margin_hours": len(errors),
        "hours": rows,
    }


@app.get("/api/accuracy")
def accuracy(start: date = FIRST_DAY, end: date = LAST_DAY, cutoff: str = "09:00"):
    """Accuracy of the decision-time forecasts for decision days start..end."""
    check_day(start, "start")
    check_day(end, "end")
    if start > end:
        raise HTTPException(400, f"start ({start}) must be on or before end ({end})")
    selected_cutoff = parse_cutoff(cutoff)
    all_rows, daily = [], []
    for day in days(start, end):
        rows = data()[0].decision(day, selected_cutoff)[1]
        day_summary = summarize(rows)
        daily.append(
            {
                "decision_date": day,
                "delivery_date": day + timedelta(days=1),
                "mae_mw": day_summary["mae_mw"],
                "bias_mw": day_summary["bias_mw"],
            }
        )
        all_rows += rows
    return {
        "start": start,
        "end": end,
        "cutoff": cutoff,
        "summary": summarize(all_rows),
        "daily": daily,
        "histogram": histogram(all_rows),
    }
