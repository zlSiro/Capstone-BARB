from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

Estado = Literal["active", "suspended", "cancelled"]


class GerenteInicial(BaseModel):
    """Primer usuario de la empresa, con perfil gerente (se crea junto con ella, opcional)."""

    nombre: str = Field(min_length=2, max_length=100)
    email: str = Field(min_length=5, max_length=100)
    password: str = Field(min_length=6, max_length=100)


class EmpresaCreateRequest(BaseModel):
    nombre: str = Field(min_length=2, max_length=150)
    rut: str | None = Field(default=None, max_length=20)
    pais: str = Field(default="Chile", max_length=60)
    industria: str | None = Field(default=None, max_length=100)
    contacto_nombre: str | None = Field(default=None, max_length=100)
    contacto_email: str | None = Field(default=None, max_length=100)
    contacto_telefono: str | None = Field(default=None, max_length=30)
    estado: Estado = "active"
    max_usuarios: int = Field(default=10, ge=1, le=10000)
    notas: str | None = None
    gerente: GerenteInicial | None = None


class EmpresaUpdateRequest(BaseModel):
    nombre: str | None = Field(default=None, min_length=2, max_length=150)
    rut: str | None = Field(default=None, max_length=20)
    pais: str | None = Field(default=None, max_length=60)
    industria: str | None = Field(default=None, max_length=100)
    contacto_nombre: str | None = Field(default=None, max_length=100)
    contacto_email: str | None = Field(default=None, max_length=100)
    contacto_telefono: str | None = Field(default=None, max_length=30)
    estado: Estado | None = None
    max_usuarios: int | None = Field(default=None, ge=1, le=10000)
    notas: str | None = None
