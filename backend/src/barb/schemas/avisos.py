from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field, field_validator

Severidad = Literal["low", "medium", "high", "critical"]
Prioridad = Literal["low", "medium", "high", "urgent"]
TipoMantenimiento = Literal["corrective", "preventive", "predictive", "inspection"]


def _texto_no_vacio(valor: str) -> str:
    limpio = (valor or "").strip()
    if not limpio:
        raise ValueError("No puede estar vacío.")
    return limpio


class AvisoCreateRequest(BaseModel):
    """Aviso de falla reportado desde planta. El reportante es siempre el usuario autenticado."""

    maquina_id: int = Field(ge=1)
    descripcion: str = Field(max_length=5000)
    severidad: Severidad = "medium"

    _limpiar = field_validator("descripcion")(_texto_no_vacio)


class AvisoGenerarOtRequest(BaseModel):
    """Datos con los que el supervisor convierte un aviso en OT. Todo lo demás se hereda del aviso."""

    tecnico_id: int = Field(ge=1)
    priority: Prioridad = "medium"
    tipo: TipoMantenimiento = "corrective"
    severity: Severidad | None = None
    fecha_vencimiento: datetime | None = None
    descripcion_problema: str | None = Field(default=None, max_length=5000)


class AvisoDescartarRequest(BaseModel):
    """Descartar un aviso exige dejar el motivo: quien reportó tiene derecho a saber por qué no hubo OT."""

    motivo: str = Field(max_length=500)

    @field_validator("motivo")
    @classmethod
    def _motivo(cls, valor: str) -> str:
        limpio = _texto_no_vacio(valor)
        if len(limpio) < 3:
            raise ValueError("Indica el motivo del descarte (mínimo 3 caracteres).")
        return limpio
