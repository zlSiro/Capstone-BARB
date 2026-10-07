"""CLI del job de OTs atrasadas (cron local / Render Cron Job).

    uv run python scripts/run_overdue_job.py            # respeta frecuencia de cada empresa
    uv run python scripts/run_overdue_job.py --force    # ignora frecuencia
    uv run python scripts/run_overdue_job.py --empresa 2
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from barb.core.config import settings  # noqa: E402
from barb.core.db import close_pool, open_pool  # noqa: E402
from barb.services.overdue_report import run_overdue_job  # noqa: E402

logging.basicConfig(level=logging.INFO)


async def main(force: bool, empresa_id: int | None) -> int:
    if not settings.smtp_configurado:
        print("SMTP no configurado (SMTP_HOST / SMTP_FROM).", file=sys.stderr)
        return 1
    await open_pool()
    try:
        resultados = await run_overdue_job(force=force, empresa_id=empresa_id)
    finally:
        await close_pool()
    print(json.dumps(resultados, ensure_ascii=False, indent=2, default=str))
    return 0


if __name__ == "__main__":
    if sys.platform == "win32":
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--empresa", type=int, default=None)
    args = ap.parse_args()
    sys.exit(asyncio.run(main(args.force, args.empresa)))
