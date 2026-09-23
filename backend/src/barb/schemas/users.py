from __future__ import annotations

from pydantic import BaseModel


class UserCreateRequest(BaseModel):
    nombre: str
    email: str
    password: str
    rol: str
    activo: bool = True


class UserUpdateRequest(BaseModel):
    nombre: str | None = None
    email: str | None = None
    password: str | None = None
    rol: str | None = None
    activo: bool | None = None
