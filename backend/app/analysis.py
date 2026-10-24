"""Forecast selection and accuracy metrics, in plain Python.

A purchase decision is made on decision day D-1 at a cutoff (UK time) for delivery day D.
For each hour of D we use the newest forecast published at or before the cutoff that has a
value for that hour. Later forecasts are never used (no look-ahead), and hours with no such
forecast or no actual are MISSING: never interpolated, and left out of every metric.

error = forecast - actual (MW). Positive = the forecast was too high (we under-buy).
"""

import math
from bisect import bisect_right
from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

UK = ZoneInfo("Europe/London")
FIRST_DAY = date(2026, 1, 1)  # decision days: purchase decisions made in January 2026
LAST_DAY = date(2026, 1, 31)
HALF_HOUR = timedelta(minutes=30)


class Data:
    def __init__(self, forecasts: list[tuple[datetime, datetime, float]], actuals: dict):
        """forecasts: (publish_time, target_time, mw) rows; actuals: {half-hour start: mw}."""
        by_target: dict[datetime, list[tuple[datetime, float]]] = {}
        for publish, target, mw in forecasts:
            by_target.setdefault(target, []).append((publish, mw))
        self.forecasts = {target: sorted(rows) for target, rows in by_target.items()}
        self.publish_times = {t: [p for p, _ in rows] for t, rows in self.forecasts.items()}
        # Forecasts are hourly and actuals half-hourly: the actual for hour H is the mean of
        # the H:00 and H:30 half-hours. If either is missing, the hour is missing.
        self.actuals = {
            start: (mw + actuals[start + HALF_HOUR]) / 2
            for start, mw in actuals.items()
            if start.minute == 0 and start + HALF_HOUR in actuals
        }

    def hour(self, target: datetime, deadline: datetime) -> dict:
        """The newest forecast for `target` published at or before `deadline`, vs the actual."""
        position = bisect_right(self.publish_times.get(target, []), deadline)
        publish, forecast = self.forecasts[target][position - 1] if position else (None, None)
        actual = self.actuals.get(target)
        missing = forecast is None or actual is None
        return {
            "target_time": target,
            "publish_time": publish,
            "lead_time_hours": (target - publish).total_seconds() / 3600 if publish else None,
            "forecast_mw": forecast,
            "actual_mw": actual,
            "error_mw": None if missing else forecast - actual,
            "missing": missing,
        }

    def decision(self, day: date, cutoff: time) -> tuple[datetime, list[dict]]:
        """(decision time in UTC, one row per hour of the next day) for decision day `day`."""
        deadline = datetime.combine(day, cutoff, UK).astimezone(UTC)
        return deadline, [self.hour(target, deadline) for target in delivery_hours(day)]


def delivery_hours(decision_day: date) -> list[datetime]:
    """Start of every UK hour of the day after `decision_day`, in UTC (24 in January)."""
    start = datetime.combine(decision_day + timedelta(days=1), time(0), UK).astimezone(UTC)
    end = datetime.combine(decision_day + timedelta(days=2), time(0), UK).astimezone(UTC)
    return [start + timedelta(hours=h) for h in range(int((end - start) / timedelta(hours=1)))]


def percentile(values: list[float], p: float) -> float | None:
    """Linear interpolation between ranks (same as Excel PERCENTILE.INC and numpy)."""
    if not values:
        return None
    ordered = sorted(values)
    rank = (len(ordered) - 1) * p / 100
    low, high = math.floor(rank), math.ceil(rank)
    return ordered[low] + (ordered[high] - ordered[low]) * (rank - low)


def summarize(rows: list[dict]) -> dict:
    """Accuracy over the hours that have both a forecast and an actual (MW, 1 decimal)."""
    valid = [row for row in rows if not row["missing"]]
    errors = [row["error_mw"] for row in valid]
    n = len(errors)
    mean_actual = sum(row["actual_mw"] for row in valid) / n if n else None
    mae = sum(abs(e) for e in errors) / n if n else None
    values = {
        "mae_mw": mae,
        "rmse_mw": math.sqrt(sum(e * e for e in errors) / n) if n else None,
        "bias_mw": sum(errors) / n if n else None,
        "max_abs_error_mw": max(map(abs, errors)) if n else None,
        "mean_actual_mw": mean_actual,
        # X = P90 is the safety margin: in 90% of hours error <= X, so actual >= forecast - X.
        **{f"p{p}_mw": percentile(errors, p) for p in (10, 50, 90)},
    }
    return {
        "hours": n,
        "total_hours": len(rows),
        **{key: None if v is None else round(v, 1) for key, v in values.items()},
        "nmae": round(mae / mean_actual, 4) if n and mean_actual > 0 else None,
    }


def histogram(rows: list[dict], width: int = 500) -> list[dict]:
    """Hours per error band [from, from + width), including empty bands in between."""
    counts: dict[int, int] = {}
    for row in rows:
        if not row["missing"]:
            band = math.floor(row["error_mw"] / width)
            counts[band] = counts.get(band, 0) + 1
    bands = range(min(counts), max(counts) + 1) if counts else []
    return [{"from_mw": b * width, "hours": counts.get(b, 0)} for b in bands]
