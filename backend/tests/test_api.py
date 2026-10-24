"""API tests. These run against the real committed January 2026 data."""

from datetime import date, timedelta

import pytest
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def get(url: str):
    response = client.get(url)
    return response.status_code, response.json()


def test_health_reports_loaded_data():
    status, body = get("/api/health")

    assert status == 200
    assert body == {"status": "ok", "forecast_rows": 272 * 73, "actual_rows": 33 * 48}


@pytest.mark.parametrize(
    ("cutoff", "expected_publish", "covered"),
    [
        ("09:00", "2026-01-10T07:30:00Z", 24),  # newest forecast before 09:00
        ("09:30", "2026-01-10T09:30:00Z", 24),  # published exactly at the cutoff counts
        ("01:00", "2026-01-09T22:30:00Z", 22),  # no forecast yet covers 22:00 and 23:00
    ],
)
def test_decision_on_10_january_uses_expected_forecast(cutoff, expected_publish, covered):
    status, body = get(f"/api/forecast?date=2026-01-10&cutoff={cutoff}")

    assert status == 200
    assert body["delivery_date"] == "2026-01-11"
    assert body["forecast_publish_time"].replace("+00:00", "Z") == expected_publish
    assert (body["summary"]["hours"], body["summary"]["total_hours"]) == (covered, 24)
    for hour in body["hours"]:
        if not hour["missing"]:
            assert hour["error_mw"] == pytest.approx(hour["forecast_mw"] - hour["actual_mw"])
            assert hour["range_low_mw"] <= hour["range_high_mw"]


def test_no_selected_forecast_is_published_after_its_cutoff_on_any_day():
    day, late = date(2026, 1, 1), 0
    while day <= date(2026, 1, 31):
        for cutoff in ("06:00", "09:00", "09:30", "12:00"):
            _, body = get(f"/api/forecast?date={day}&cutoff={cutoff}")
            late += sum(
                h["publish_time"] is not None and h["publish_time"] > body["decision_time"]
                for h in body["hours"]
            )
        day += timedelta(days=1)

    assert late == 0


def test_accuracy_over_january_at_the_default_cutoff():
    status, body = get("/api/accuracy")

    assert status == 200
    s = body["summary"]
    assert (s["hours"], s["total_hours"]) == (31 * 24, 31 * 24)
    assert (s["mae_mw"], s["bias_mw"], s["p90_mw"]) == (2038.9, 1747.9, 4097.9)
    assert len(body["daily"]) == 31
    assert sum(band["hours"] for band in body["histogram"]) == s["hours"]


@pytest.mark.parametrize(
    ("url", "status", "message"),
    [
        ("/api/forecast?date=2025-12-31", 400, "date must be a decision day from 2026-01-01"),
        ("/api/forecast?date=2026-02-01", 400, "date must be a decision day"),
        ("/api/forecast?date=2026-01-15&cutoff=25:99", 400, "cutoff must be a UK time"),
        ("/api/accuracy?start=2026-01-20&end=2026-01-10", 400, "must be on or before end"),
    ],
)
def test_invalid_input_returns_a_clear_message(url, status, message):
    actual_status, body = get(url)

    assert actual_status == status
    assert message in body["detail"]
