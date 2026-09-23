from __future__ import annotations

from fastapi import APIRouter, Header, HTTPException

from barb.core.db import execute, fetch_one
from barb.core.security import generate_session_token, verify_password
from barb.schemas.auth import LoginRequest

router = APIRouter()


@router.post("/auth/login")
@router.post("/api/auth/login")
async def login(payload: LoginRequest):
    email = payload.email.strip().lower()
    password = payload.password

    if not email or not password:
        raise HTTPException(status_code=400, detail="Email y contraseña requeridos.")

    user = await fetch_one(
        """
        SELECT usuario_id, nombre, email, password_hash, rol, activo
        FROM usuario
        WHERE lower(email) = lower(%(email)s)
        LIMIT 1
        """,
        {"email": email},
    )

    if not user or not user.get("activo", True):
        raise HTTPException(status_code=401, detail="Usuario o contraseña incorrecta")

    if not verify_password(password, str(user.get("password_hash") or "")):
        raise HTTPException(status_code=401, detail="Usuario o contraseña incorrecta")

    token = generate_session_token()
    await execute(
        "INSERT INTO sesion (token, usuario_id, expira_en) VALUES (%(token)s, %(uid)s, NOW() + INTERVAL '24 hours')",
        {"token": token, "uid": int(user["usuario_id"])},
    )

    return {
        "token": token,
        "user": {
            "id": int(user["usuario_id"]),
            "name": str(user["nombre"]),
            "role": str(user["rol"]).lower(),
        },
    }


@router.post("/auth/logout")
@router.post("/api/auth/logout")
async def logout(authorization: str = Header(default="", alias="Authorization")):
    token = authorization.replace("Bearer ", "").strip()
    if token:
        await execute("DELETE FROM sesion WHERE token = %(token)s", {"token": token})
    return {"status": "success"}
