"""Vercel serverless entrypoint.

Vercel serves Python functions from the top-level /api folder. This file only makes
the backend package importable and re-exports its FastAPI `app`; all logic lives in
/backend. vercel.json rewrites every /api/* request to this function.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from app.main import app  # noqa: E402, F401
