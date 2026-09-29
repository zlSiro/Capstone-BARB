from __future__ import annotations

import secrets

import bcrypt

from fastapi import Header, HTTPException

from barb.core.db import fetch_one


def hash_password(raw_password: str) -> str:
    return bcrypt.hashpw(raw_password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(raw_password: str, stored_password: str) -> bool:
    stored = (stored_password or "").strip()
    if stored.startswith("$2"):
        try:
            return bcrypt.checkpw(raw_password.encode("utf-8"), stored.encode("utf-8"))
        except ValueError:
            return False
    return stored == raw_password


def generate_session_token() -> str:
    return secrets.token_hex(32)

# =============================================================================
# Dependency para endpoints protegidos
# =============================================================================

async def get_current_user(
    authorization: str = Header(default="", alias="Authorization"),
) -> dict:
   
    token = authorization.replace("Bearer ", "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Token de autenticación requerido.")

    row = await fetch_one(
        """
        SELECT u.usuario_id, u.empresa_id, u.nombre, u.email, u.rol, s.expira_en
        FROM sesion s
        JOIN usuario u ON u.usuario_id = s.usuario_id
        WHERE s.token = %(token)s
          AND s.expira_en > NOW()
          AND u.activo = TRUE
        LIMIT 1
        """,
        {"token": token},
    )

    if not row:
        raise HTTPException(status_code=401, detail="Token inválido o expirado.")

    return {
        "id": int(row["usuario_id"]),
        "empresa_id": int(row["empresa_id"]),
        "name": str(row["nombre"]),
        "email": str(row["email"]),
        "role": str(row["rol"]).lower(),
    }