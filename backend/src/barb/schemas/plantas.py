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
    # SLA y costo de inactividad configurables POR MÁQUINA (pedido del profesor): no todos
    # los equipos valen lo mismo parados ni toleran la misma demora. `None` = usar el
    # default de la empresa (`SLA_TARGET_MINUTES`).
    sla_horas: float | None = Field(default=None, ge=0, le=8760)
    costo_inactividad_minuto: float | None = Field(default=None, ge=0)


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
    # Se devuelven tal como quedaron en la base (None si la base todavía no tiene las
    # columnas, o si no se enviaron).
    sla_horas: float | None = None
    costo_inactividad_minuto: float | None = None


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
    sla_horas: float | None = Field(default=None, ge=0, le=8760)
    costo_inactividad_minuto: float | None = Field(default=None, ge=0)


class MaquinaUpdateRequest(BaseModel):
    """Campos editables de una máquina. `None` = no tocar ese campo."""

    nombre: str | None = Field(default=None, min_length=1, max_length=100)
    codigo: str | None = Field(default=None, min_length=1, max_length=50)
    # Se edita por id: la disciplina ya existe en el catálogo de la empresa. Crear
    # disciplinas nuevas se hace al dar de alta la planta, no al editar una máquina.
    disciplina_id: int | None = None
    sla_horas: float | None = Field(default=None, ge=0, le=8760)
    costo_inactividad_minuto: float | None = Field(default=None, ge=0)


class MaquinaActualizada(BaseModel):
    maquina_id: int
    planta_id: int
    nombre: str
    codigo: str
    disciplina_id: int | None
    sla_horas: float | None = None
    costo_inactividad_minuto: float | None = None
