"""Contrato del mantenedor de plantas (HU-25 / CGBIDA-461).

Alta masiva: una sola llamada crea la planta, reutiliza (o crea) sus disciplinas y da de
alta sus máquinas. Las disciplinas se reciben por nombre, no por id: el usuario escribe
«Mecánica» y el endpoint resuelve si existe en su empresa o hay que crearla.

Edición: nombre y ubicación de una planta existente. La unicidad del nombre se valida en
Python (ver `catalog.py`), no con una restricción de la base: el esquema del repo no la
tiene y `AGENTS.md` prohíbe agregarla.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class MaquinaCreate(BaseModel):
    """Máquina hija de la planta que se está creando."""

    nombre: str = Field(min_length=1, max_length=100)
    codigo: str = Field(min_length=1, max_length=50)
    # Nombre de la disciplina; debe venir también en `disciplinas` o existir en la empresa.
    disciplina: str | None = Field(default=None, max_length=50)


class PlantaCompletaCreate(BaseModel):
    """Planta con todas sus dependencias en una sola operación."""

    nombre: str = Field(min_length=2, max_length=120)
    ubicacion: str | None = Field(default=None, max_length=255)
    # Nombres de disciplina: se reutilizan si ya existen en la empresa.
    disciplinas: list[str] = Field(default_factory=list)
    maquinas: list[MaquinaCreate] = Field(default_factory=list)


class DisciplinaResuelta(BaseModel):
    disciplina_id: int
    nombre: str
    # False = ya existía en la empresa y se reutilizó.
    creada: bool


class MaquinaCreada(BaseModel):
    maquina_id: int
    nombre: str
    codigo: str
    disciplina_id: int | None


class PlantaCompletaResponse(BaseModel):
    planta_id: int
    nombre: str
    ubicacion: str | None
    disciplinas: list[DisciplinaResuelta]
    maquinas: list[MaquinaCreada]


# =============================================================================
# Edición (PATCH /api/plantas/{id}) y alta de una máquina suelta
# =============================================================================


class PlantaUpdateRequest(BaseModel):
    """Campos editables de una planta. `None` = no tocar."""

    nombre: str | None = Field(default=None, min_length=2, max_length=120)
    ubicacion: str | None = Field(default=None, max_length=255)


class PlantaActualizada(BaseModel):
    planta_id: int
    nombre: str
    ubicacion: str | None


class MaquinaNuevaRequest(BaseModel):
    """Máquina que se agrega a una planta ya existente."""

    nombre: str = Field(min_length=1, max_length=100)
    codigo: str = Field(min_length=1, max_length=50)
    disciplina: str | None = Field(default=None, max_length=50)
