"""El catálogo no puede inventar datos cuando la consulta falla.

`catalog.py` devolvía, ante cualquier excepción, una planta y una disciplina fabricadas
(`{"id": 1, "name": "Planta Principal"}`, `{"id": 1, "name": "General"}`). Era un parche
para "que la pantalla no quede vacía", pero convertía un fallo de base de datos en datos
falsos con apariencia de reales: el frontend los mostraba como si existieran y cualquier
consumidor (incluida la IA) los habría tratado como verdad.

Ahora devuelve una lista vacía y deja el rastro en el log. Vacío es honesto; inventado no.
"""

from __future__ import annotations

import pytest

from barb.routers import catalog


class _Sesion:
    """Sesión mínima: el router solo necesita empresa_id."""

    def __init__(self, empresa_id: int = 1) -> None:
        self.empresa_id = empresa_id
        self.usuario_id = 1
        self.rol = "admin"


@pytest.mark.asyncio
async def test_maquinas_devuelve_vacio_si_la_consulta_falla(monkeypatch):
    async def explota(*_a, **_k):
        raise RuntimeError("la base se cayó")

    monkeypatch.setattr(catalog, "fetch_all", explota)
    assert await catalog.get_machines(None, _Sesion()) == []


@pytest.mark.asyncio
async def test_disciplinas_devuelve_vacio_si_la_consulta_falla(monkeypatch):
    async def explota(*_a, **_k):
        raise RuntimeError("la base se cayó")

    monkeypatch.setattr(catalog, "fetch_all", explota)
    assert await catalog.get_disciplines(None, _Sesion()) == []


@pytest.mark.asyncio
async def test_plantas_devuelve_vacio_si_la_consulta_falla(monkeypatch):
    async def explota(*_a, **_k):
        raise RuntimeError("la base se cayó")

    monkeypatch.setattr(catalog, "fetch_all", explota)
    assert await catalog.get_plants(None, _Sesion()) == []


@pytest.mark.asyncio
async def test_tecnicos_devuelve_vacio_si_la_consulta_falla(monkeypatch):
    async def explota(*_a, **_k):
        raise RuntimeError("la base se cayó")

    monkeypatch.setattr(catalog, "fetch_all", explota)
    assert await catalog.get_technicians(None, _Sesion()) == []
