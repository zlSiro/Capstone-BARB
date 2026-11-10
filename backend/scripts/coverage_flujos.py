"""Cobertura de tests por flujo crítico (HU-14), a partir de `coverage.json`.

    uv run pytest --cov --cov-report=json
    uv run python scripts/coverage_flujos.py [ruta/a/coverage.json]

Imprime % de líneas y de ramas por flujo (Autenticación, OTs, Métricas) y el
total de todo `src/barb` (el total NO es la suma de los tres flujos).
Avisa si un archivo del mapeo no existe en el repo o no aparece en el JSON.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]

FLUJOS: dict[str, list[str]] = {
    "Autenticación": [
        "src/barb/routers/auth.py",
        "src/barb/core/permissions.py",
        "src/barb/core/security.py",
    ],
    "OTs": [
        "src/barb/routers/work_orders.py",
        "src/barb/core/work_order_states.py",
        "src/barb/routers/avisos.py",
        "src/barb/schemas/work_orders.py",
    ],
    "Métricas": [
        "src/barb/routers/stats.py",
    ],
}


def _pct(cubierto: int, total: int) -> str:
    return "n/a" if total == 0 else f"{100 * cubierto / total:.1f}%"


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8")  # tildes legibles en consolas Windows
    ruta = Path(sys.argv[1]) if len(sys.argv) > 1 else BACKEND / "coverage.json"
    if not ruta.is_file():
        print(f"ERROR: no existe {ruta}. Genera el reporte con: uv run pytest --cov --cov-report=json")
        return 1

    datos = json.loads(ruta.read_text(encoding="utf-8"))
    # Rutas del JSON normalizadas a "/" (en Windows vienen con "\").
    archivos = {k.replace("\\", "/"): v["summary"] for k, v in datos["files"].items()}

    problemas: list[str] = []
    filas: list[tuple[str, int, int, int, int]] = []

    for flujo, modulos in FLUJOS.items():
        lc = ls = bc = bs = 0
        for modulo in modulos:
            if not (BACKEND / modulo).is_file():
                problemas.append(f"[{flujo}] no existe en el repo: {modulo}")
            resumen = archivos.get(modulo)
            if resumen is None:
                problemas.append(f"[{flujo}] no aparece en coverage.json: {modulo}")
                continue
            lc += resumen["covered_lines"]
            ls += resumen["num_statements"]
            bc += resumen["covered_branches"]
            bs += resumen["num_branches"]
        filas.append((flujo, lc, ls, bc, bs))

    t = datos["totals"]
    filas.append(("TOTAL src/barb", t["covered_lines"], t["num_statements"], t["covered_branches"], t["num_branches"]))

    ancho = max(len(f[0]) for f in filas)
    print(f"{'Flujo':<{ancho}}  {'Líneas':>8}  {'Cubiertas':>11}  {'Ramas':>8}  {'Cubiertas':>11}")
    print("-" * (ancho + 47))
    for nombre, lc, ls, bc, bs in filas:
        sep = "-" * (ancho + 47) + "\n" if nombre.startswith("TOTAL") else ""
        print(f"{sep}{nombre:<{ancho}}  {_pct(lc, ls):>8}  {f'{lc}/{ls}':>11}  {_pct(bc, bs):>8}  {f'{bc}/{bs}':>11}")

    if problemas:
        print("\nAVISOS:")
        for p in problemas:
            print(f"  - {p}")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
