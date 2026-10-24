"""Download the Elexon data used by the app and save it as CSV (offline only).

Run from the backend folder:  python -m app.fetch_data

Writes data/windfor.csv, data/fuelhh.csv and data/manifest.json. Those files are committed,
so the running app never calls Elexon.
"""

import csv
import json
import time
from collections import Counter
from datetime import UTC, date, datetime, timedelta

import httpx

from app.main import DATA_DIR

BASE_URL = "https://data.elexon.co.uk/bmrs/api/v1"
# A little wider than the decision days (1-31 Jan), so every cutoff on every day has data.
FORECASTS_FROM, FORECASTS_TO = date(2025, 12, 30), date(2026, 2, 1)  # publish days
ACTUALS_FROM, ACTUALS_TO = date(2026, 1, 1), date(2026, 2, 2)  # settlement days


def get(client: httpx.Client, path: str, params: dict) -> list[dict]:
    """GET with up to 5 retries (exponential backoff) on rate limits, server or network errors."""
    for attempt in range(6):
        try:
            response = client.get(path, params=params)
            if response.status_code != 429 and response.status_code < 500:
                response.raise_for_status()  # other 4xx errors are our fault: fail now
                return response.json()
        except httpx.TransportError:
            pass
        if attempt < 5:
            time.sleep(2**attempt)
    raise RuntimeError(f"Elexon request {path} {params} kept failing")


def chunks(first: date, last: date, size: int = 7):
    """(start, end) day pairs covering first..last inclusive."""
    while first <= last:
        end = min(first + timedelta(days=size - 1), last)
        yield first, end
        first = end + timedelta(days=1)


def main() -> None:
    forecasts, actuals = {}, {}
    with httpx.Client(base_url=BASE_URL, timeout=60) as client:
        for start, end in chunks(FORECASTS_FROM, FORECASTS_TO):
            params = {
                "publishDateTimeFrom": f"{start}T00:00:00Z",
                "publishDateTimeTo": f"{end}T23:59:59Z",
            }
            for r in get(client, "/datasets/WINDFOR/stream", params):
                forecasts[(r["publishTime"], r["startTime"])] = r["generation"]
        for start, end in chunks(ACTUALS_FROM, ACTUALS_TO):
            params = {"settlementDateFrom": str(start), "settlementDateTo": str(end)}
            for r in get(client, "/datasets/FUELHH/stream", params | {"fuelType": "WIND"}):
                actuals[r["startTime"]] = (r["fuelType"], r["generation"])

    # Data checks: every forecast has 73 hourly points, every day has 48 half-hours.
    warnings = [
        f"Forecast published {publish} has {n} points (expected 73)"
        for publish, n in sorted(Counter(p for p, _ in forecasts).items())
        if n != 73
    ]
    per_day = Counter(start[:10] for start in actuals)
    days = (ACTUALS_TO - ACTUALS_FROM).days + 1
    for day in (ACTUALS_FROM + timedelta(days=i) for i in range(days)):
        if per_day[str(day)] != 48:
            warnings.append(f"{day} has {per_day[str(day)]} actual values (expected 48)")
    for warning in warnings:
        print("WARNING:", warning)

    with open(DATA_DIR / "windfor.csv", "w", newline="") as f:
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(["publish_time", "start_time", "generation_mw"])
        writer.writerows((p, s, mw) for (p, s), mw in sorted(forecasts.items()))
    with open(DATA_DIR / "fuelhh.csv", "w", newline="") as f:
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(["start_time", "fuel_type", "generation_mw"])
        writer.writerows((s, fuel, mw) for s, (fuel, mw) in sorted(actuals.items()))

    manifest = {
        "source": BASE_URL,
        "fetched_at": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "forecasts": {
            "dataset": "WINDFOR",
            "publish_days": f"{FORECASTS_FROM} .. {FORECASTS_TO}",
            "forecast_count": len({p for p, _ in forecasts}),
            "rows": len(forecasts),
        },
        "actuals": {
            "dataset": "FUELHH (fuelType=WIND)",
            "settlement_days": f"{ACTUALS_FROM} .. {ACTUALS_TO}",
            "rows": len(actuals),
        },
        "validation_warnings": warnings,
    }
    (DATA_DIR / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"Saved {len(forecasts)} forecast rows and {len(actuals)} actual rows")


if __name__ == "__main__":
    main()
