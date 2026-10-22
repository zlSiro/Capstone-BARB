"""Contrato del alta masiva de plantas (HU-24).

Una sola llamada crea la planta, reutiliza (o crea) sus disciplinas y da de alta sus
máquinas. Las disciplinas se reciben por nombre, no por id: el usuario escribe «Mecánica»
y el endpoint resuelve si existe en su empresa o hay que crearla.
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
