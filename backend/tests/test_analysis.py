import math
from datetime import UTC, date, datetime, time, timedelta

import pytest

from app.analysis import Data, delivery_hours, percentile, summarize

DECISION_DAY = date(2026, 1, 10)  # delivery day 11 Jan
HOURS = delivery_hours(DECISION_DAY)


def utc(day: int, hour: int, minute: int = 0) -> datetime:
    return datetime(2026, 1, day, hour, minute, tzinfo=UTC)


def forecast(published: datetime, value: float, hours: list[datetime] = HOURS):
    """A forecast with the same value for every given target hour."""
    return [(published, t, value) for t in hours]


def decide(forecasts, actuals=None, cutoff=time(9, 0)):
    return Data(forecasts, actuals or {}).decision(DECISION_DAY, cutoff)


def test_decision_is_made_on_the_day_before_delivery():
    decided_at, rows = decide([])

    assert decided_at == utc(10, 9)  # January: UK time == UTC
    assert [row["target_time"] for row in rows] == HOURS
    assert HOURS[0] == utc(11, 0) and HOURS[-1] == utc(11, 23)


def test_uses_newest_forecast_published_by_the_cutoff_and_never_a_later_one():
    _, rows = decide(
        forecast(utc(10, 4, 30), 100)
        + forecast(utc(10, 9, 0), 300)  # published exactly at the cutoff: counts
        + forecast(utc(10, 9, 30), 999)  # published after the cutoff: never used
    )

    assert {row["publish_time"] for row in rows} == {utc(10, 9)}
    assert {row["forecast_mw"] for row in rows} == {300}


def test_each_hour_uses_the_newest_forecast_that_covers_it_or_is_missing():
    _, rows = decide(
        forecast(utc(10, 4, 30), 100, HOURS[:22])  # older: covers 00:00-21:00
        + forecast(utc(10, 7, 30), 200, HOURS[:20])  # newest: covers 00:00-19:00 only
    )

    assert [row["forecast_mw"] for row in rows] == [200] * 20 + [100] * 2 + [None] * 2
    assert all(row["missing"] and row["error_mw"] is None for row in rows[22:])


def test_actual_is_mean_of_both_half_hours_and_error_is_forecast_minus_actual():
    half_hours = {
        utc(11, 0): 100.0,
        utc(11, 0, 30): 200.0,
        utc(11, 1): 300.0,  # 01:30 missing -> hour 01 missing, never half an hour
    }
    _, rows = decide(forecast(utc(10, 7, 30), 200), half_hours)

    assert rows[0]["actual_mw"] == 150
    assert rows[0]["error_mw"] == 50  # positive = forecast too high
    assert rows[0]["lead_time_hours"] == 16.5  # 11 Jan 00:00 - 10 Jan 07:30
    assert rows[1]["actual_mw"] is None and rows[1]["missing"]


def test_summary_metrics_exclude_missing_hours():
    rows = [
        {"forecast_mw": f, "actual_mw": 1000, "error_mw": f - 1000, "missing": False}
        for f in (1100, 700, 1200)  # errors +100, -300, +200
    ] + [{"forecast_mw": None, "actual_mw": 1000, "error_mw": None, "missing": True}]

    s = summarize(rows)

    assert (s["hours"], s["total_hours"]) == (3, 4)
    assert s["mae_mw"] == 200  # (100 + 300 + 200) / 3
    assert s["rmse_mw"] == round(math.sqrt((100**2 + 300**2 + 200**2) / 3), 1)
    assert s["bias_mw"] == 0
    assert s["max_abs_error_mw"] == 300
    assert s["nmae"] == 0.2


def test_percentile_interpolates_and_p90_is_the_safety_margin():
    errors = list(range(1, 11))  # 1..10
    assert percentile(errors, 50) == pytest.approx(5.5)
    assert percentile(errors, 90) == pytest.approx(9.1)
    assert percentile([], 90) is None
    # Its meaning: actual >= forecast - P90 in at least 90% of hours.
    assert sum(e <= percentile(errors, 90) for e in errors) / len(errors) >= 0.9


def test_delivery_day_hours_follow_uk_time():
    assert len(delivery_hours(date(2026, 1, 31))) == 24
    assert delivery_hours(date(2026, 1, 31))[0] == utc(31, 0) + timedelta(days=1)
