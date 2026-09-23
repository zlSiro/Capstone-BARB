from __future__ import annotations

import secrets

import bcrypt


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
