from __future__ import annotations

from pydantic import BaseModel, Field


class UserCreateRequest(BaseModel):
    nombre: str = Field(min_length=2, max_length=100)
    email: str = Field(min_length=5, max_length=100)
    password: str = Field(min_length=6, max_length=100)
    rol: str
    activo: bool = True
    # Solo lo respeta el super_usuario (asigna el usuario a una empresa). Para el
    # admin de una empresa se ignora: siempre crea usuarios en su propia empresa.
    empresa_id: int | None = None


class UserUpdateRequest(BaseModel):
    nombre: str | None = Field(default=None, min_length=2, max_length=100)
    email: str | None = Field(default=None, min_length=5, max_length=100)
    password: str | None = Field(default=None, min_length=6, max_length=100)
    rol: str | None = None
    activo: bool | None = None
