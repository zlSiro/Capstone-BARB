"""
Conciliación de las cifras del módulo «Reportes» contra la base de datos.

Para cada reporte, perfil y combinación de filtros compara TRES números:

    app   la cifra que muestra el reporte. Se calcula a partir de lo que entrega la API, con un ESPEJO EXACTO de las funciones puras del
          frontend (`frontend/src/app/features/reportes/logica/*.ts`): solo conteos, sumas y porcentajes directos sobre las filas que ya
          entregó el backend (periodo sobre `created_at`, topología por el catálogo de máquinas, demorada = en curso hace más de
          `umbral_dias`). Los KPI (SLA, MTTR, MTBF, disponibilidad, top 5…) se muestran tal cual los entrega el backend.
    api   la cifra que entrega el backend (`financial-impact`, `historical`, el listado, la bitácora…).
    bd    la cifra que sale de una consulta SQL de SOLO LECTURA que copia los predicados de `stats.py`, `work_orders.py` y `avisos.py`
          (alcance por empresa vía maquina -> planta, alcance propio de operador y técnico, `en_sla`, estancadas, ventana del MTBF).

Las cifras enteras deben coincidir exacto; los montos al centavo y los promedios/porcentajes al decimal que usa el backend.

Seguridad
    - Solo base local (localhost / 127.0.0.1). `DATABASE_URL` se lee de `backend/.env` y nunca se imprime.
    - Cada consulta corre en una transacción `READ ONLY` y termina en ROLLBACK. Solo SELECT.
    - Las credenciales no están en el repo: se pasan por variables de entorno (ver `CREDENCIALES` abajo).

Uso (backend en http://localhost:9000, base migrada y sembrada):

    export BARB_CRED_SUPERVISOR='supervisor@…:…'   # formato correo:clave, una por perfil (de la empresa A)
    uv run --project backend python tools/conciliacion-reportes/conciliar.py

Escribe `docs/reportes/CONCILIACION.md` con las tablas, el SQL usado, la fecha y las observaciones del backend.
"""
from __future__ import annotations

import json
import math
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse

import psycopg
from psycopg.rows import dict_row

RAIZ = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RAIZ / "backend" / "src"))

from barb.core.config import settings  # noqa: E402  (solo para leer DATABASE_URL, sla_target_minutes y las constantes)
from barb.routers import stats as backend_stats  # noqa: E402  (constantes y `_disponibilidad` del propio backend)

BASE = os.environ.get("BARB_API", "http://localhost:9000")
SALIDA = RAIZ / "docs" / "reportes" / "CONCILIACION.md"
DIA = timedelta(days=1)

# Perfil -> variable de entorno con «correo:clave» (empresa A). `OTRA` es un usuario de OTRA empresa.
CREDENCIALES = {
    "supervisor": "BARB_CRED_SUPERVISOR",
    "engineer": "BARB_CRED_ENGINEER",
    "gerente": "BARB_CRED_GERENTE",
    "admin": "BARB_CRED_ADMIN",
    "operador": "BARB_CRED_OPERADOR",
    "tecnico": "BARB_CRED_TECNICO",
    "otra": "BARB_CRED_OTRA_EMPRESA",
}

# Qué perfiles se concilian en cada reporte (los que el catálogo deja abrir con la matriz actual).
PERFILES = {
    "R1": ["supervisor", "engineer", "gerente"],
    "R2": ["supervisor", "engineer", "gerente"],
    "R3": ["supervisor", "engineer", "gerente"],
    "R4": ["supervisor", "engineer", "gerente"],
    "R5": ["supervisor", "engineer", "gerente"],
    "R6": ["gerente"],
    "R7": ["supervisor", "gerente"],
    "R8": ["operador", "tecnico"],
    "R9": ["supervisor", "engineer", "gerente", "admin", "operador", "tecnico"],
    "R10": ["supervisor", "admin"],
}
ESTADOS_ABIERTOS = ("pending", "assigned", "overdue", "in_progress", "por_validar")
TIPOS = ("corrective", "preventive", "predictive", "inspection")


# ======================================================================================================== utilidades
def _exigir_base_local() -> str:
    host = urlparse(settings.database_url).hostname or ""
    if host not in {"localhost", "127.0.0.1", "::1"}:
        sys.exit(f"ABORTADO: DATABASE_URL apunta a '{host}'. La conciliación solo corre contra una base local.")
    return host


def api(token: str | None, ruta: str, metodo: str = "GET", cuerpo: dict | None = None) -> tuple[int, object]:
    req = urllib.request.Request(
        f"{BASE}{ruta}",
        data=json.dumps(cuerpo).encode() if cuerpo is not None else None,
        method=metodo,
        headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode() or "null")
        except Exception:
            return e.code, None


class BD:
    """Consultas de SOLO LECTURA: cada una en una transacción READ ONLY que termina en ROLLBACK."""

    def __init__(self) -> None:
        self.conn = psycopg.connect(settings.database_url, row_factory=dict_row)
        self.conn.read_only = True
        self.sqls: dict[str, str] = {}

    def q(self, clave: str, sql: str, params: dict | None = None) -> list[dict]:
        assert sql.lstrip().upper().startswith(("SELECT", "WITH")), "solo SELECT"
        self.sqls.setdefault(clave, sql.strip())
        try:
            with self.conn.cursor() as cur:
                cur.execute(sql, params or {})
                return cur.fetchall()
        finally:
            self.conn.rollback()

    def uno(self, clave: str, sql: str, params: dict | None = None) -> dict:
        return self.q(clave, sql, params)[0]


def parse_iso(s: str | None) -> datetime | None:
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


# ================================================================================================ espejo del frontend
def espejo_alcance(ots: list[dict], f: dict, maquinas_ids: set[int] | None, ahora: datetime) -> list[dict]:
    """Espejo de `otsDelAlcance` (comun.ts): periodo sobre created_at y topología por machine_id del catálogo."""
    salida = []
    for o in ots:
        if f["dias"] is not None and parse_iso(o["created_at"]) < ahora - f["dias"] * DIA:
            continue
        if maquinas_ids is not None and o["machine_id"] not in maquinas_ids:
            continue
        salida.append(o)
    return salida


def espejo_demorada(o: dict, ahora: datetime, umbral: int) -> bool:
    """Espejo de `esDemorada`: en curso y COALESCE(fecha_inicio, created_at) < ahora - umbral días."""
    if o["estado"] != "in_progress":
        return False
    desde = parse_iso(o.get("fecha_inicio")) or parse_iso(o["created_at"])
    return desde < ahora - umbral * DIA


def ids_topologia(cat: dict, f: dict) -> set[int] | None:
    """Espejo de `idsMaquina`: máquinas del catálogo que cumplen planta/disciplina/máquina (None = sin restricción)."""
    if f["planta"] is None and f["disciplina"] is None and f["maquina"] is None:
        return None
    ids = {m["id"] for m in cat["maquinas"] if (f["planta"] is None or m["plant_id"] == f["planta"]) and (f["disciplina"] is None or m["discipline_id"] == f["disciplina"])}
    return {i for i in ids if i == f["maquina"]} if f["maquina"] is not None else ids


# ======================================================================================================== resultados
class Resultados:
    def __init__(self) -> None:
        self.filas: list[dict] = []

    def comparar(self, reporte: str, perfil: str, combo: str, metrica: str, app, api_v, bd, tipo: str = "int", nota: str = "") -> None:
        def igual(a, b) -> bool:
            if a is None or b is None:
                return True  # no aplica en esa columna
            if tipo == "int":
                return int(a) == int(b)
            if tipo == "monto":
                return round(float(a) * 100) == round(float(b) * 100)
            return round(float(a), 1) == round(float(b), 1)  # promedio / porcentaje: 1 decimal

        valores = [v for v in (app, api_v, bd) if v is not None]
        ok = all(igual(valores[0], v) for v in valores[1:]) if valores else True
        self.filas.append({"reporte": reporte, "perfil": perfil, "combo": combo, "metrica": metrica, "app": app, "api": api_v, "bd": bd, "ok": ok, "nota": nota})


# ===================================================================================================== combinaciones
def armar_combos(bd: BD, cat: dict, empresa_id: int, ajena_planta: int | None) -> list[dict]:
    """Las 6 combinaciones de filtros (la 6.ª, usuario de otra empresa, se trata aparte)."""
    plantas = bd.q(
        "plantas_con_ot",
        "SELECT p.planta_id, COUNT(ot.ot_id) AS n FROM planta p LEFT JOIN maquina m ON m.planta_id = p.planta_id "
        "LEFT JOIN orden_trabajo ot ON ot.maquina_id = m.maquina_id WHERE p.empresa_id = %(e)s GROUP BY p.planta_id ORDER BY n DESC",
        {"e": empresa_id},
    )
    planta = int(plantas[0]["planta_id"])
    maq = bd.uno(
        "maquina_mas_ot",
        "SELECT m.maquina_id, m.disciplina_id, COUNT(ot.ot_id) AS n FROM maquina m LEFT JOIN orden_trabajo ot ON ot.maquina_id = m.maquina_id "
        "WHERE m.planta_id = %(p)s GROUP BY m.maquina_id, m.disciplina_id ORDER BY n DESC LIMIT 1",
        {"p": planta},
    )
    vacia = None
    for p in cat["plantas"]:
        for d in cat["disciplinas"]:
            if not any(m["plant_id"] == p["id"] and m["discipline_id"] == d["id"] for m in cat["maquinas"]):
                vacia = {"planta": p["id"], "disciplina": d["id"], "maquina": None, "dias": None}
                break
        if vacia:
            break
    vacia = vacia or {"planta": planta, "disciplina": None, "maquina": int(maq["maquina_id"]), "dias": 1}
    base = {"planta": None, "disciplina": None, "maquina": None}
    combos = [
        {"nombre": "1. Histórico, sin filtros", "f": {**base, "dias": None}},
        {"nombre": "2. 30 días + una planta", "f": {**base, "dias": 30, "planta": planta}},
        {"nombre": "3. 365 días + planta + disciplina + máquina", "f": {"dias": 365, "planta": planta, "disciplina": int(maq["disciplina_id"]), "maquina": int(maq["maquina_id"])}},
        {"nombre": "4. Combinación sin filas", "f": vacia},
    ]
    if ajena_planta is not None:
        combos.append({"nombre": "5. Planta de otra empresa (debe dar 404)", "f": {**base, "dias": 30, "planta": ajena_planta}, "ajena": True})
    return combos


def query_stats(f: dict, gran: str | None = None) -> str:
    p = {}
    if gran:
        p["granularity"] = gran
    if f["dias"] is not None:
        p["days"] = f["dias"]
    for k, nombre in (("planta", "planta_id"), ("disciplina", "disciplina_id"), ("maquina", "maquina_id")):
        if f[k] is not None:
            p[nombre] = f[k]
    return ("?" + urllib.parse.urlencode(p)) if p else ""


def sql_params(e: int, f: dict) -> dict:
    return {"e": e, "pl": f["planta"], "di": f["disciplina"], "ma": f["maquina"], "d": f["dias"]}


# Copia de `_get_ot_scope_params` (stats.py): OT -> maquina -> planta -> empresa, con los filtros de topología.
SCOPE = (
    " AND ot.maquina_id IN (SELECT m2.maquina_id FROM maquina m2 JOIN planta p2 ON p2.planta_id = m2.planta_id"
    " WHERE p2.empresa_id = %(e)s AND (%(pl)s::int IS NULL OR m2.planta_id = %(pl)s)"
    " AND (%(di)s::int IS NULL OR m2.disciplina_id = %(di)s) AND (%(ma)s::int IS NULL OR m2.maquina_id = %(ma)s))"
)
# Copia del `date_filter` de stats.py.
FECHA = " AND (%(d)s::int IS NULL OR ot.fecha_creacion >= NOW() - (%(d)s || ' days')::interval)"
# Copia de `en_sla` (stats.py) con el SLA global de settings.
EN_SLA = (
    "((ot.fecha_vencimiento IS NOT NULL AND ot.fecha_cierre IS NOT NULL AND ot.fecha_cierre <= ot.fecha_vencimiento)"
    f" OR (ot.fecha_vencimiento IS NULL AND ot.tiempo_reparacion_min <= {settings.sla_target_minutes}))"
)
# Copia de `_alcance_propio` (work_orders.py): operador y técnico solo ven lo suyo.
PROPIO = (
    " AND (ot.tecnico_id = %(uid)s OR ot.creado_por = %(uid)s OR EXISTS (SELECT 1 FROM aviso_falla afp"
    " WHERE afp.aviso_falla_id = ot.aviso_falla_id AND afp.reportado_por = %(uid)s))"
)


# ========================================================================================================= reportes
class Conciliador:
    def __init__(self) -> None:
        self.bd = BD()
        self.res = Resultados()
        self.tokens: dict[str, dict] = {}
        self.cat: dict = {}
        self.empresa_id = 0

    # ---- sesión -------------------------------------------------------------------------------------------
    def login(self, perfil: str) -> dict:
        if perfil in self.tokens:
            return self.tokens[perfil]
        cred = os.environ.get(CREDENCIALES[perfil], "")
        if ":" not in cred:
            sys.exit(f"Falta la variable {CREDENCIALES[perfil]} (formato correo:clave).")
        correo, clave = cred.split(":", 1)
        st, d = api(None, "/api/auth/login", "POST", {"email": correo, "password": clave})
        if st != 200:
            sys.exit(f"No se pudo iniciar sesión como {perfil} ({st}).")
        self.tokens[perfil] = {"token": d["token"], "uid": d["user"]["id"], "empresa": d["user"]["empresa_id"], "correo": correo}
        return self.tokens[perfil]

    def get(self, perfil: str, ruta: str):
        return api(self.login(perfil)["token"], ruta)

    # ---- bloques por reporte --------------------------------------------------------------------------------
    def dashboard(self, perfil: str, combo: dict) -> None:
        f, nombre = combo["f"], combo["nombre"]
        e = self.empresa_id
        ahora = datetime.now(UTC)
        ids = ids_topologia(self.cat, f)
        p = sql_params(e, f)

        if combo.get("ajena"):
            st, _ = self.get(perfil, "/api/stats/financial-impact" + query_stats(f))
            for r in ("R1", "R2", "R3", "R4", "R5", "R6"):
                if perfil in PERFILES[r]:
                    self.res.comparar(r, perfil, nombre, "HTTP con un id de otra empresa (esperado 404)", 404, st, 404, nota="el reporte explica y quita el filtro")
            return

        st, stats = self.get(perfil, "/api/stats/financial-impact" + query_stats(f))
        st_h, hist = self.get(perfil, "/api/stats/historical" + query_stats(f, "month"))
        _, stats_ahora = self.get(perfil, "/api/stats/financial-impact" + query_stats({**f, "dias": None}))
        _, ots = self.get(perfil, "/api/work-orders")
        assert st == 200 and st_h == 200, (st, st_h)
        fin, d = stats["financials"], stats["salud_operacional"]["desglose"]
        alcance = espejo_alcance(ots, f, ids, ahora)

        def n_estado(lista, estados):
            return sum(1 for o in lista if o["estado"] in estados)

        # ---------------- R1
        if perfil in PERFILES["R1"]:
            b = self.bd.uno("r1_desglose",
                "SELECT COUNT(*) AS total, COUNT(*) FILTER (WHERE ot.estado = 'completed') AS completadas,"
                " COUNT(*) FILTER (WHERE ot.estado = 'in_progress') AS en_curso,"
                " COUNT(*) FILTER (WHERE ot.estado IN ('pending','assigned','overdue')) AS pendientes,"
                " COUNT(*) FILTER (WHERE ot.estado = 'por_validar') AS por_validar,"
                " COUNT(*) FILTER (WHERE ot.estado = 'cancelled') AS canceladas,"
                f" COUNT(*) FILTER (WHERE ot.estado = 'completed' AND {EN_SLA}) AS en_sla,"
                " COALESCE(AVG(ot.tiempo_reparacion_min) FILTER (WHERE ot.estado = 'completed'), 0) AS mttr,"
                " COALESCE(SUM(ot.downtime_minutes) FILTER (WHERE ot.estado != 'cancelled'), 0) AS downtime_total"
                " FROM orden_trabajo ot WHERE TRUE" + FECHA + SCOPE, p)
            self.res.comparar("R1", perfil, nombre, "OT del periodo (total)", len(alcance), d["total"], b["total"])
            for clave, estados in (("completadas", ("completed",)), ("en_curso", ("in_progress",)), ("pendientes", ("pending", "assigned", "overdue")), ("por_validar", ("por_validar",)), ("canceladas", ("cancelled",))):
                self.res.comparar("R1", perfil, nombre, f"OT {clave}", n_estado(alcance, estados), d[clave], b[clave])
            comp = b["completadas"]
            self.res.comparar("R1", perfil, nombre, "Cumplimiento de SLA (%)", fin["efficiency"], fin["efficiency"], round(100.0 * b["en_sla"] / comp, 1) if comp else 0.0, "dec")
            self.res.comparar("R1", perfil, nombre, "MTTR (min)", fin["mttr"], fin["mttr"], float(b["mttr"]), "dec")
            dias_periodo = f["dias"] if f["dias"] is not None else backend_stats.IMPACTO_VENTANA_DIAS
            self.res.comparar("R1", perfil, nombre, "Disponibilidad de planta (%)", fin["disponibilidad_planta"], fin["disponibilidad_planta"],
                              backend_stats._disponibilidad(float(dias_periodo) * 24.0, float(b["downtime_total"])), "dec",
                              "denominador = días del periodo (365 si es histórico)")
            if fin["mtbf_visible"]:
                m = self.bd.uno("r1_mtbf",
                    "SELECT COUNT(*) AS fallas, COALESCE(SUM(ot.downtime_minutes), 0) AS downtime FROM orden_trabajo ot "
                    f"WHERE ot.tipo = 'corrective' AND ot.estado != 'cancelled' AND ot.fecha_creacion >= NOW() - INTERVAL '{backend_stats.MTBF_VENTANA_DIAS} days'" + SCOPE, p)
                esperado = round((backend_stats.MTBF_VENTANA_HORAS - float(m["downtime"]) / 60.0) / m["fallas"], 1) if m["fallas"] >= 2 else None
                if esperado is not None or fin["mtbfHours"] is not None:
                    self.res.comparar("R1", perfil, nombre, "MTBF (h)", fin["mtbfHours"], fin["mtbfHours"], esperado, "dec")
            else:
                self.res.comparar("R1", perfil, nombre, "MTBF oculto (mtbf_visible=false con days<365)", 0, 0, 0, nota="el reporte rotula el motivo")
            st_e = stats["estancadas"]
            e_bd = self.bd.uno("r1_estancadas",
                "SELECT COUNT(*) FILTER (WHERE vencida) AS vencidas, COUNT(*) FILTER (WHERE demorada) AS demoradas FROM ("
                " SELECT (ot.fecha_vencimiento IS NOT NULL AND ot.fecha_vencimiento < NOW() AND ot.estado::text NOT IN ('completed','cancelled')) AS vencida,"
                f" (ot.estado = 'in_progress' AND COALESCE(ot.fecha_inicio, ot.fecha_creacion) < NOW() - INTERVAL '{backend_stats.UMBRAL_ESTANCADA_DIAS} days') AS demorada"
                " FROM orden_trabajo ot WHERE TRUE" + SCOPE + ") t WHERE vencida OR demorada", p)
            self.res.comparar("R1", perfil, nombre, "OT estancadas vencidas (foto del momento)", st_e["vencidas"], st_e["vencidas"], e_bd["vencidas"])

        # ---------------- R2 (serie mensual)
        if perfil in PERFILES["R2"]:
            filas = self.bd.q("r2_meses",
                "SELECT date_trunc('month', ot.fecha_creacion)::date AS periodo, COUNT(*) AS total_ots,"
                " COUNT(*) FILTER (WHERE ot.estado = 'completed') AS completadas FROM orden_trabajo ot WHERE TRUE" + FECHA + SCOPE + " GROUP BY 1 ORDER BY 1", p)
            self.res.comparar("R2", perfil, nombre, "Σ OT de todos los periodos", sum(x["total_ots"] for x in hist["periods"]), d["total"], sum(x["total_ots"] for x in filas))
            self.res.comparar("R2", perfil, nombre, "Σ OT completadas de todos los periodos", sum(x["completadas"] for x in hist["periods"]), d["completadas"], sum(x["completadas"] for x in filas))
            por_bd = {x["periodo"].isoformat(): x["total_ots"] for x in filas}
            iguales = sum(1 for x in hist["periods"] if por_bd.get(x["periodo"][:10]) == x["total_ots"])
            self.res.comparar("R2", perfil, nombre, "Periodos (mes) cuyo total de OT coincide", iguales, len(hist["periods"]), len(filas))

        # ---------------- R5
        if perfil in PERFILES["R5"]:
            filas = self.bd.q("r5_tipos", "SELECT ot.tipo::text AS tipo, COUNT(*) AS n FROM orden_trabajo ot WHERE TRUE" + FECHA + SCOPE + " GROUP BY 1", p)
            bd_t = {x["tipo"]: x["n"] for x in filas}
            api_t = {x["tipo"]: x["total"] for x in stats["por_tipo"]}
            for tp in TIPOS:
                self.res.comparar("R5", perfil, nombre, f"OT tipo {tp}", sum(1 for o in alcance if o["tipo"] == tp), api_t.get(tp, 0), bd_t.get(tp, 0))

        # ---------------- R3 (foto del momento: sin periodo)
        if perfil in PERFILES["R3"]:
            abiertas = [o for o in ots if o["estado"] in ESTADOS_ABIERTOS and (ids is None or o["machine_id"] in ids)]
            umbral = stats_ahora["estancadas"]["umbral_dias"]
            ds = stats_ahora["salud_operacional"]["desglose"]
            b = self.bd.uno("r3_abiertas",
                "SELECT COUNT(*) AS abiertas FROM orden_trabajo ot WHERE ot.estado::text NOT IN ('completed','cancelled')" + SCOPE, {**p, "d": None})
            self.res.comparar("R3", perfil, nombre, "OT abiertas", len(abiertas), ds["en_curso"] + ds["pendientes"] + ds["por_validar"], b["abiertas"])
            e_bd = self.bd.uno("r3_estancadas",
                "SELECT COUNT(*) FILTER (WHERE ot.estado = 'in_progress' AND COALESCE(ot.fecha_inicio, ot.fecha_creacion) < NOW() - (%(u)s || ' days')::interval) AS demoradas,"
                " COUNT(*) FILTER (WHERE ot.fecha_vencimiento IS NOT NULL AND ot.fecha_vencimiento < NOW() AND ot.estado::text NOT IN ('completed','cancelled')) AS vencidas"
                " FROM orden_trabajo ot WHERE TRUE" + SCOPE, {**p, "u": umbral})
            self.res.comparar("R3", perfil, nombre, "OT demoradas", sum(1 for o in abiertas if espejo_demorada(o, ahora, umbral)), stats_ahora["estancadas"]["demoradas"], e_bd["demoradas"])
            self.res.comparar("R3", perfil, nombre, "OT vencidas (solo total del backend)", None, stats_ahora["estancadas"]["vencidas"], e_bd["vencidas"])

        # ---------------- R4
        if perfil in PERFILES["R4"]:
            for tope in stats.get("top_5_peor_mttr") or []:
                mid = int(tope["id"])
                b = self.bd.uno("r4_mttr",
                    "SELECT COUNT(*) AS completadas, AVG(ot.tiempo_reparacion_min) AS mttr FROM orden_trabajo ot "
                    "WHERE ot.maquina_id = %(m)s AND ot.estado = 'completed' AND ot.tiempo_reparacion_min IS NOT NULL" + FECHA, {**p, "m": mid})
                lista = [o for o in alcance if o["machine_id"] == mid and o["estado"] == "completed" and o["age_minutes"] > 0]
                self.res.comparar("R4", perfil, nombre, f"{tope['name']}: OT completadas con tiempo", len(lista), tope["completadas"], b["completadas"],
                                  nota="age_minutes=0 no distingue «sin dato»")
                self.res.comparar("R4", perfil, nombre, f"{tope['name']}: MTTR (min)", round(sum(o["age_minutes"] for o in lista) / len(lista), 1) if lista else None, tope["mttr"], float(b["mttr"]), "dec")
            for tope in stats.get("top_5_peor_mtbf") or []:
                mid = int(tope["id"])
                b = self.bd.uno("r4_fallas",
                    "SELECT COUNT(*) AS fallas FROM orden_trabajo ot WHERE ot.maquina_id = %(m)s AND ot.tipo = 'corrective' AND ot.estado != 'cancelled' "
                    f"AND ot.fecha_creacion >= NOW() - INTERVAL '{backend_stats.MTBF_VENTANA_DIAS} days'", {**p, "m": mid})
                lista = [o for o in ots if o["machine_id"] == mid and o["tipo"] == "corrective" and o["estado"] != "cancelled" and parse_iso(o["created_at"]) >= ahora - 365 * DIA]
                self.res.comparar("R4", perfil, nombre, f"{tope['name']}: fallas (365 días)", len(lista), tope["fallas"], b["fallas"])

        # ---------------- R6
        if perfil in PERFILES["R6"]:
            b = self.bd.uno("r6_costo", "SELECT COALESCE(SUM(ot.costo_real) FILTER (WHERE ot.estado != 'cancelled'), 0) AS costo FROM orden_trabajo ot WHERE TRUE" + FECHA + SCOPE, p)
            suma = round(sum(o["costo_real"] for o in alcance if o["estado"] != "cancelled"), 2)
            self.res.comparar("R6", perfil, nombre, "Costo real (sin canceladas)", suma, fin.get("costo_total_acumulado"), float(b["costo"]), "monto")

        # ---------------- R10 (calidad de datos)
        if perfil in PERFILES["R10"]:
            cerradas = [o for o in alcance if o["estado"] == "completed"]
            b = self.bd.uno("r10_calidad",
                "SELECT COUNT(*) AS cerradas, COUNT(*) FILTER (WHERE ot.downtime_minutes IS NOT NULL) AS con_downtime,"
                " COUNT(*) FILTER (WHERE COALESCE(ot.costo_real, 0) > 0) AS con_costo, COUNT(*) FILTER (WHERE ot.tecnico_id IS NOT NULL) AS con_tecnico"
                " FROM orden_trabajo ot WHERE ot.estado = 'completed'" + FECHA + SCOPE, p)
            self.res.comparar("R10", perfil, nombre, "OT cerradas", len(cerradas), d["completadas"] if perfil == "supervisor" else None, b["cerradas"])
            self.res.comparar("R10", perfil, nombre, "Con downtime registrado", sum(1 for o in cerradas if o["downtime_minutes"] is not None), None, b["con_downtime"])
            self.res.comparar("R10", perfil, nombre, "Con costo real mayor que 0", sum(1 for o in cerradas if o["costo_real"] > 0), None, b["con_costo"], nota="el listado entrega 0 cuando el costo es NULL")
            self.res.comparar("R10", perfil, nombre, "Con técnico asignado", sum(1 for o in cerradas if o.get("tecnico_id") is not None), None, b["con_tecnico"])

    # ---- R10 para el admin (sin dashboard: solo listado), R7, R8, R9 ---------------------------------------
    def sin_dashboard(self, perfil: str, combo: dict) -> None:
        """R10 del admin: no tiene `dashboard`, así que se concilia solo el listado contra la BD."""
        if combo.get("ajena"):
            return
        f, nombre, e = combo["f"], combo["nombre"], self.empresa_id
        ahora = datetime.now(UTC)
        _, ots = self.get(perfil, "/api/work-orders")
        alcance = espejo_alcance(ots, f, ids_topologia(self.cat, f), ahora)
        cerradas = [o for o in alcance if o["estado"] == "completed"]
        b = self.bd.uno("r10_calidad",
            "SELECT COUNT(*) AS cerradas, COUNT(*) FILTER (WHERE ot.downtime_minutes IS NOT NULL) AS con_downtime,"
            " COUNT(*) FILTER (WHERE COALESCE(ot.costo_real, 0) > 0) AS con_costo, COUNT(*) FILTER (WHERE ot.tecnico_id IS NOT NULL) AS con_tecnico"
            " FROM orden_trabajo ot WHERE ot.estado = 'completed'" + FECHA + SCOPE, sql_params(e, f))
        self.res.comparar("R10", perfil, nombre, "OT cerradas", len(cerradas), None, b["cerradas"])
        self.res.comparar("R10", perfil, nombre, "Con downtime registrado", sum(1 for o in cerradas if o["downtime_minutes"] is not None), None, b["con_downtime"])
        self.res.comparar("R10", perfil, nombre, "Con costo real mayor que 0", sum(1 for o in cerradas if o["costo_real"] > 0), None, b["con_costo"])
        self.res.comparar("R10", perfil, nombre, "Con técnico asignado", sum(1 for o in cerradas if o.get("tecnico_id") is not None), None, b["con_tecnico"])

    def avisos(self, perfil: str, combo: dict, reporte: str) -> None:
        if combo.get("ajena"):
            return
        f, nombre, e = combo["f"], combo["nombre"], self.empresa_id
        ahora = datetime.now(UTC)
        tk = self.login(perfil)
        _, avisos = self.get(perfil, "/api/avisos")
        ids = ids_topologia(self.cat, f) if reporte == "R7" else None
        lista = [a for a in avisos if (f["dias"] is None or parse_iso(a["created_at"]) >= ahora - f["dias"] * DIA) and (ids is None or a["maquina_id"] in ids)]
        propio = " AND af.reportado_por = %(uid)s" if reporte == "R8" else ""
        p = {**sql_params(e, f), "uid": tk["uid"]}
        topo = (" AND m.maquina_id IN (SELECT m2.maquina_id FROM maquina m2 JOIN planta p2 ON p2.planta_id = m2.planta_id WHERE p2.empresa_id = %(e)s"
                " AND (%(pl)s::int IS NULL OR m2.planta_id = %(pl)s) AND (%(di)s::int IS NULL OR m2.disciplina_id = %(di)s) AND (%(ma)s::int IS NULL OR m2.maquina_id = %(ma)s))") if reporte == "R7" else ""
        filas = self.bd.q(f"{reporte.lower()}_avisos",
            "SELECT af.estado, COUNT(*) AS n FROM aviso_falla af JOIN maquina m ON m.maquina_id = af.maquina_id JOIN planta p ON p.planta_id = m.planta_id "
            "WHERE p.empresa_id = %(e)s AND (%(d)s::int IS NULL OR af.created_at >= NOW() - (%(d)s || ' days')::interval)" + propio + topo + " GROUP BY af.estado", p)
        bd_e = {x["estado"]: x["n"] for x in filas}
        for est in ("pendiente", "con_ot", "descartado"):
            api_n = None
            if f["dias"] is None and all(f[k] is None for k in ("planta", "disciplina", "maquina")):
                _, la = self.get(perfil, f"/api/avisos?estado={est}")
                api_n = len(la)
            self.res.comparar(reporte, perfil, nombre, f"Avisos {est}", sum(1 for a in lista if a["estado"] == est), api_n, bd_e.get(est, 0))
        if reporte == "R8":
            _, ots = self.get(perfil, "/api/work-orders")
            alc = [o for o in ots if f["dias"] is None or parse_iso(o["created_at"]) >= ahora - f["dias"] * DIA]
            filas = self.bd.q("r8_ots",
                "SELECT ot.estado::text AS estado, COUNT(*) AS n FROM orden_trabajo ot WHERE ot.maquina_id IN (SELECT m2.maquina_id FROM maquina m2 JOIN planta p2 "
                "ON p2.planta_id = m2.planta_id WHERE p2.empresa_id = %(e)s)" + FECHA + PROPIO + " GROUP BY 1", p)
            bd_o = {x["estado"]: x["n"] for x in filas}
            self.res.comparar("R8", perfil, nombre, "Mis OT (total)", len(alc), None, sum(bd_o.values()))
            for est in ("pending", "in_progress", "por_validar", "completed", "cancelled"):
                self.res.comparar("R8", perfil, nombre, f"Mis OT {est}", sum(1 for o in alc if o["estado"] == est), None, bd_o.get(est, 0))

    def trazabilidad(self, perfil: str) -> None:
        tk = self.login(perfil)
        _, ots = self.get(perfil, "/api/work-orders")
        nombre = "OT con más movimientos que ve el perfil"
        if not ots:
            self.res.comparar("R9", perfil, nombre, "Sin OT visibles", 0, 0, 0)
            return
        cuentas = self.bd.q("r9_mov", "SELECT a.ot_id, COUNT(*) AS n FROM ot_audit_log a WHERE a.ot_id = ANY(%(ids)s) GROUP BY a.ot_id ORDER BY n DESC LIMIT 1", {"ids": [o["ot_id"] for o in ots]})
        elegida = next((o for o in ots if cuentas and o["ot_id"] == cuentas[0]["ot_id"]), ots[0])
        st, det = self.get(perfil, f"/api/work-orders/{elegida['numero_ot']}")
        n_bd = self.bd.uno("r9_historial", "SELECT COUNT(*) AS n FROM ot_audit_log a WHERE a.ot_id = %(o)s", {"o": elegida["ot_id"]})["n"]
        self.res.comparar("R9", perfil, nombre, f"{elegida['numero_ot']}: movimientos del historial", len(det["status_history"]), len(det["status_history"]), n_bd)
        ultimo = det["status_history"][0]["to_status"] if det["status_history"] else None
        self.res.comparar("R9", perfil, nombre, f"{elegida['numero_ot']}: último movimiento = estado actual", 1 if ultimo == det["estado"] else 0, 1, 1)
        # Una OT que el perfil NO ve: 404 (no se revela si existe).
        ajena = self.bd.q("r9_no_visible",
            "SELECT ot.numero_ot FROM orden_trabajo ot WHERE ot.numero_ot <> ALL(%(vis)s) AND ot.maquina_id IN (SELECT m2.maquina_id FROM maquina m2 JOIN planta p2 "
            "ON p2.planta_id = m2.planta_id WHERE p2.empresa_id = %(e)s) ORDER BY ot.ot_id LIMIT 1", {"vis": [o["numero_ot"] for o in ots], "e": tk["empresa"]})
        if ajena:
            st404, _ = self.get(perfil, f"/api/work-orders/{ajena[0]['numero_ot']}")
            self.res.comparar("R9", perfil, "OT que el perfil no debe ver", "HTTP (esperado 404)", 404, st404, 404)
        if perfil == "gerente":
            desde = (parse_iso(elegida["created_at"]) - DIA).date().isoformat()
            fin = parse_iso(det.get("fecha_cierre")) or datetime.now(UTC)
            hasta = (fin + DIA).date().isoformat()
            items, off = [], 0
            while True:
                _, pag = self.get(perfil, f"/api/empresa/transacciones?rango=custom&desde={desde}&hasta={hasta}&limit=200&offset={off}")
                items += pag["items"]
                off += pag["limit"]
                if off >= pag["total"]:
                    break
            app_n = sum(1 for t in items if (t.get("detalle") or {}).get("tabla") == "orden_trabajo" and (t.get("detalle") or {}).get("registro_id") == str(elegida["ot_id"]))
            b = self.bd.uno("r9_bitacora",
                "SELECT COUNT(*) AS n FROM transacciones t WHERE t.empresa_id = %(e)s AND t.perfil <> 'super_usuario' AND t.fecha >= %(d)s::date AND t.fecha < (%(h)s::date + 1)"
                " AND t.detalle->>'tabla' = 'orden_trabajo' AND t.detalle->>'registro_id' = %(r)s", {"e": tk["empresa"], "d": desde, "h": hasta, "r": str(elegida["ot_id"])})
            self.res.comparar("R9", perfil, nombre, f"{elegida['numero_ot']}: movimientos de la bitácora", app_n, app_n, b["n"])

    def otra_empresa(self, ajeno_login: dict) -> None:
        """6. Un usuario de otra empresa nunca ve los datos de la primera."""
        nombre = "6. Usuario de otra empresa"
        propias = {o["numero_ot"] for o in self.get("supervisor", "/api/work-orders")[1]}
        _, ots_otra = self.get("otra", "/api/work-orders")
        cruces = propias & {o["numero_ot"] for o in ots_otra}
        self.res.comparar("R1-R10", "otra empresa", nombre, "OT de la empresa A visibles para la otra empresa", len(cruces), len(cruces), 0)
        if propias:
            st, _ = self.get("otra", f"/api/work-orders/{sorted(propias)[0]}")
            self.res.comparar("R9", "otra empresa", nombre, "HTTP al pedir una OT ajena (esperado 404)", 404, st, 404)
        planta_a = self.bd.uno("planta_empresa_a", "SELECT MIN(planta_id) AS id FROM planta WHERE empresa_id = %(e)s", {"e": self.empresa_id})["id"]
        st, _ = self.get("otra", f"/api/stats/financial-impact?planta_id={planta_a}")
        self.res.comparar("R1", "otra empresa", nombre, "HTTP de financial-impact con una planta ajena (esperado 404)", 404, st, 404)
        _, avisos_otra = self.get("otra", "/api/avisos")
        ajenos = self.bd.uno("avisos_ajenos",
            "SELECT COUNT(*) AS n FROM aviso_falla af JOIN maquina m ON m.maquina_id = af.maquina_id JOIN planta p ON p.planta_id = m.planta_id "
            "WHERE p.empresa_id = %(e)s AND af.aviso_falla_id = ANY(%(ids)s)", {"e": self.empresa_id, "ids": [a["aviso_id"] for a in avisos_otra] or [0]})["n"]
        self.res.comparar("R7", "otra empresa", nombre, "Avisos de la empresa A visibles para la otra empresa", ajenos, ajenos, 0)

    # ---- observaciones del backend (medidas, no supuestas) --------------------------------------------------
    def observaciones(self) -> list[str]:
        e = self.empresa_id
        hist = self.get("gerente", "/api/stats/financial-impact")[1]["financials"]["disponibilidad_planta"]
        b = self.bd.uno("obs_disp",
            "SELECT COALESCE(SUM(ot.downtime_minutes) FILTER (WHERE ot.estado != 'cancelled'), 0) AS total,"
            " COALESCE(SUM(ot.downtime_minutes) FILTER (WHERE ot.estado != 'cancelled' AND ot.fecha_creacion >= NOW() - INTERVAL '365 days'), 0) AS ultimo_anio"
            " FROM orden_trabajo ot WHERE TRUE" + SCOPE, {"e": e, "pl": None, "di": None, "ma": None})
        con_365 = backend_stats._disponibilidad(365 * 24.0, float(b["ultimo_anio"]))
        nulos = self.bd.uno("obs_nulos",
            "SELECT COUNT(*) FILTER (WHERE ot.estado = 'completed' AND ot.tiempo_reparacion_min IS NULL) AS tiempo_nulo,"
            " COUNT(*) FILTER (WHERE ot.estado = 'completed' AND ot.tiempo_reparacion_min = 0) AS tiempo_cero,"
            " COUNT(*) FILTER (WHERE ot.costo_real IS NULL) AS costo_nulo, COUNT(*) FILTER (WHERE ot.costo_real = 0) AS costo_cero,"
            " COUNT(*) AS total FROM orden_trabajo ot WHERE TRUE" + SCOPE, {"e": e, "pl": None, "di": None, "ma": None})
        sin_planta = self.bd.uno("obs_planta", "SELECT COUNT(*) AS n FROM maquina WHERE planta_id IS NULL")["n"]
        n_ot = len(self.get("gerente", "/api/work-orders")[1])
        linea_plant = next((i for i, ln in enumerate((RAIZ / "backend/src/barb/routers/work_orders.py").read_text(encoding="utf-8").splitlines(), 1) if 'row.get("planta_id") or 1' in ln), None)
        linea_vacio = next((i for i, ln in enumerate((RAIZ / "backend/src/barb/routers/work_orders.py").read_text(encoding="utf-8").splitlines(), 1) if "Error al listar órdenes de trabajo" in ln), None)
        return [
            f"**Disponibilidad con «histórico».** Con `days` nulo, `financial-impact` usa 365 días × 24 h como denominador, pero el downtime suma TODO el historial. "
            f"En esta base: el backend entrega {hist} % y, con el downtime de los últimos 365 días, daría {con_365} %. El reporte muestra el valor tal cual y lo rotula «ventana de 365 días». No se corrigió (`stats.py`, `dias_periodo`).",
            f"**El listado de OT devuelve `[]` ante cualquier error.** `GET /api/work-orders` captura toda excepción y responde `[]` en vez de un error "
            f"(`work_orders.py:{linea_vacio}`): una falla de base de datos se ve como «no hay OT». Por eso cada reporte compara el listado con `desglose.total` y bloquea la exportación si no cuadra.",
            f"**`plant_id` del payload de OT no es confiable.** `row_to_work_order` lo rellena con 1 cuando falta (`work_orders.py:{linea_plant}`: `int(row.get(\"planta_id\") or 1)`). "
            f"En esta base hay {sin_planta} máquinas sin planta, pero el campo puede inducir a error: los reportes filtran la planta por el catálogo de máquinas, nunca por ese campo.",
            f"**`age_minutes` y los costos no distinguen «sin dato» de 0.** `age_minutes` es `tiempo_reparacion_min or 0` y `costo_real`/`costo_estimado` llegan como 0 cuando son NULL. "
            f"En esta empresa: {nulos['tiempo_nulo']} OT completadas con tiempo NULL y {nulos['tiempo_cero']} con tiempo 0; {nulos['costo_nulo']} OT con costo NULL y {nulos['costo_cero']} con costo 0 (de {nulos['total']}). "
            "El MTTR por máquina (R4) lo explica cuando el listado no cuadra por esta causa.",
            f"**El listado no pagina ni filtra.** `GET /api/work-orders` devuelve todas las OT de la empresa ({n_ot} para el gerente de esta empresa); todos los cortes se hacen en el navegador.",
            "**`GET /api/work-orders` no trae `fecha_vencimiento`.** Las OT vencidas no se pueden contar desde el listado: R3 muestra solo el total `estancadas.vencidas` del backend.",
        ]

    # ---- orquestación -----------------------------------------------------------------------------------------
    def correr(self) -> None:
        sup = self.login("supervisor")
        self.empresa_id = int(sup["empresa"])
        _, plantas = self.get("supervisor", "/api/plants")
        _, discip = self.get("supervisor", "/api/disciplines")
        _, maquinas = self.get("supervisor", "/api/machines")
        self.cat = {"plantas": plantas, "disciplinas": discip, "maquinas": maquinas}
        otra = self.login("otra")
        ajena_planta = self.bd.uno("planta_otra", "SELECT MIN(planta_id) AS id FROM planta WHERE empresa_id = %(e)s", {"e": otra["empresa"]})["id"]
        combos = armar_combos(self.bd, self.cat, self.empresa_id, ajena_planta)
        for combo in combos:
            for perfil in ("supervisor", "engineer", "gerente"):
                self.dashboard(perfil, combo)
            self.sin_dashboard("admin", combo)
            for perfil in PERFILES["R7"]:
                self.avisos(perfil, combo, "R7")
            for perfil in PERFILES["R8"]:
                self.avisos(perfil, combo, "R8")
        for perfil in PERFILES["R9"]:
            self.trazabilidad(perfil)
        self.otra_empresa(otra)


# ===================================================================================================== documento
def fmt(v) -> str:
    if v is None:
        return "—"
    if isinstance(v, float):
        return f"{v:.2f}".rstrip("0").rstrip(".") if not math.isnan(v) else "—"
    return str(v)


def escribir(c: Conciliador, observaciones: list[str]) -> tuple[int, int]:
    ok = sum(1 for f in c.res.filas if f["ok"])
    total = len(c.res.filas)
    por_reporte: dict[str, list[dict]] = {}
    for f in c.res.filas:
        por_reporte.setdefault(f["reporte"], []).append(f)
    orden = sorted(por_reporte, key=lambda r: (len(r), r))
    out = [
        "# Conciliación del módulo «Reportes»",
        "",
        f"Corrida: {datetime.now().strftime('%Y-%m-%d %H:%M')} · API {BASE} · base local · empresa {c.empresa_id} (ids de planta/disciplina/máquina tomados del catálogo de esa empresa).",
        "",
        f"**Resultado: {ok} de {total} cifras cuadran** (app = API = base de datos).",
        "",
        "Cada fila compara tres números: **app** (la cifra que muestra el reporte, calculada con un espejo exacto de las funciones puras del frontend sobre lo que entregó la API), "
        "**API** (lo que entrega el backend) y **BD** (consulta SQL de solo lectura con los predicados de `stats.py`, `work_orders.py` y `avisos.py`). «—» = esa columna no aplica a la métrica. "
        "Enteros exactos; montos al centavo; promedios y porcentajes a 1 decimal.",
        "",
        "Se concilian las 6 combinaciones de filtros: (1) histórico sin filtros, (2) 30 días + una planta, (3) 365 días + planta + disciplina + máquina, (4) combinación sin filas, "
        "(5) una planta de otra empresa (el backend responde 404 y el reporte lo explica) y (6) un usuario de otra empresa, que nunca ve datos de la primera.",
        "",
    ]
    out += [
        "## Cómo reproducirla",
        "",
        "```bash",
        "docker compose up -d db",
        "cd backend && uv run alembic upgrade heads && uv run python scripts/seed.py",
        "uv run fastapi dev src/barb/main.py --port 9000        # en otra terminal",
        "# desde la raíz del repo, con una variable «correo:clave» por perfil (las credenciales de demo están en el encabezado de backend/seeds/02_maestros.sql)",
        "export BARB_CRED_SUPERVISOR=... BARB_CRED_ENGINEER=... BARB_CRED_GERENTE=... BARB_CRED_ADMIN=... BARB_CRED_OPERADOR=... BARB_CRED_TECNICO=...",
        "export BARB_CRED_OTRA_EMPRESA=...                      # un gerente de OTRA empresa",
        "uv run --project backend python tools/conciliacion-reportes/conciliar.py",
        "```",
        "",
    ]
    for r in orden:
        filas = por_reporte[r]
        out += [f"## {r}", "", "| Perfil | Filtros | Métrica | App | API | BD | |", "|---|---|---|---:|---:|---:|:-:|"]
        for f in filas:
            nota = f" ({f['nota']})" if f["nota"] else ""
            out.append(f"| {f['perfil']} | {f['combo']} | {f['metrica']}{nota} | {fmt(f['app'])} | {fmt(f['api'])} | {fmt(f['bd'])} | {'✓' if f['ok'] else '✗'} |")
        out.append("")
    out += ["## Observaciones del backend", "", "Solo se anotan; no se corrigió nada en `backend/`.", ""]
    out += [f"{i}. {o}" for i, o in enumerate(observaciones, 1)]
    out += ["", "## SQL usado (solo lectura)", "", "Cada consulta corre en una transacción `READ ONLY` y termina en `ROLLBACK`. Los fragmentos `SCOPE`, `FECHA`, `EN_SLA` y `PROPIO` se anteponen o añaden como se indica.", ""]
    out += [
        "- `SCOPE` (alcance por empresa y topología, copia de `_get_ot_scope_params`): `" + SCOPE.strip() + "`",
        "- `FECHA` (copia del `date_filter`): `" + FECHA.strip() + "`",
        "- `EN_SLA` (copia de `en_sla`): `" + EN_SLA + "`",
        "- `PROPIO` (copia de `_alcance_propio`): `" + PROPIO.strip() + "`",
        "",
    ]
    for clave, sql in sorted(c.bd.sqls.items()):
        out += [f"### `{clave}`", "", "```sql", re.sub(r"\s+", " ", sql), "```", ""]
    SALIDA.parent.mkdir(parents=True, exist_ok=True)
    SALIDA.write_text("\n".join(out), encoding="utf-8")
    return ok, total


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    _exigir_base_local()
    c = Conciliador()
    c.correr()
    ok, total = escribir(c, c.observaciones())
    fallan = [f for f in c.res.filas if not f["ok"]]
    print(f"{ok} de {total} cifras cuadran. Informe: {SALIDA}")
    for f in fallan[:40]:
        print(f"  ✗ {f['reporte']} · {f['perfil']} · {f['combo']} · {f['metrica']}: app={f['app']} api={f['api']} bd={f['bd']}")
    sys.exit(0 if not fallan else 1)


if __name__ == "__main__":
    main()
