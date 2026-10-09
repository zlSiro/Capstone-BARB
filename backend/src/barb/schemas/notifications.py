from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, EmailStr, Field, field_validator, model_validator


class NotificacionConfigIn(BaseModel):
    activo: bool = False
    frecuencia: Literal["diaria", "semanal"] = "diaria"
    hora: int = Field(8, ge=0, le=23, description="Hora local (0-23) en NOTIF_TIMEZONE.")
    dia_semana: int | None = Field(None, ge=0, le=6, description="0=lunes … 6=domingo. Solo frecuencia semanal.")
    destinatarios: list[EmailStr] = Field(default_factory=list, max_length=20)

    @field_validator("destinatarios")
    @classmethod
    def _dedupe(cls, v: list[EmailStr]) -> list[str]:
        vistos: dict[str, str] = {}
        for email in v:
            vistos.setdefault(str(email).lower(), str(email).lower())
        return list(vistos.values())

    @model_validator(mode="after")
    def _coherencia(self) -> NotificacionConfigIn:
        if self.frecuencia == "semanal" and self.dia_semana is None:
            raise ValueError("dia_semana es obligatorio con frecuencia semanal.")
        if self.frecuencia == "diaria":
            self.dia_semana = None
        if self.activo and not self.destinatarios:
            raise ValueError("Agrega al menos un destinatario para activar las notificaciones.")
        return self


class NotificacionConfigOut(BaseModel):
    empresa_id: int
    activo: bool
    frecuencia: str
    hora: int
    dia_semana: int | None
    destinatarios: list[str]
    ultimo_envio: datetime | None
