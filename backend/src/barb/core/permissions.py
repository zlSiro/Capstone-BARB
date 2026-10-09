"""
permissions.py
===============
Sistema de permisos por rol (rutas + acciones) para BARB.
Port 1:1 de `backend/permisos.py` (matrices y mensajes idénticos), adaptado
a dependencias FastAPI async sobre el pool psycopg3.

Uso:
    from barb.core.permissions import require_route, require_action
    from fastapi import Depends

    @router.get("/api/dashboard", dependencies=[Depends(require_route("dashboard"))])
    def get_dashboard(): ...

    @router.post("/api/work-orders", dependencies=[Depends(require_action("crear_ot"))])
    async def create_work_order(request: Request): ...
"""

from __future__ import annotations

from fastapi import Header, HTTPException

from barb.core.db import fetch_one

# =============================================================================
# ROLES VÁLIDOS
# =============================================================================

# "super_usuario": operador de la plataforma BARB. No pertenece a ninguna empresa
# (usuario.empresa_id es NULL) y ve/administra todas las empresas.
ROLES = ("operador", "tecnico", "supervisor", "engineer", "gerente", "admin", "visitante", "super_usuario")

# =============================================================================
# PERMISOS POR RUTA  (basado en la matriz "Ruta")
# True  = acceso total
# "ver" = acceso solo lectura (equivalente a "solo ver" en la matriz)
# False = sin acceso
# =============================================================================

RUTAS: dict[str, dict[str, bool | str]] = {
    "menu":       {"operador": True, "tecnico": True, "supervisor": True, "engineer": True, "gerente": True, "admin": True, "visitante": True, "super_usuario": True},
    "docchat":    {"operador": True, "tecnico": True, "supervisor": True, "engineer": True, "gerente": True, "admin": True, "visitante": False, "super_usuario": True},
    "debug":      {"operador": True, "tecnico": True, "supervisor": True, "engineer": True, "gerente": True, "admin": True, "visitante": False, "super_usuario": True},
    "topology":   {"operador": True, "tecnico": True, "supervisor": True, "engineer": True, "gerente": True, "admin": True, "visitante": "ver", "super_usuario": True},
    "memory":     {"operador": True, "tecnico": True, "supervisor": True, "engineer": True, "gerente": True, "admin": True, "visitante": "ver", "super_usuario": True},
    "report":     {"operador": True, "tecnico": True, "supervisor": True, "engineer": True, "gerente": True, "admin": True, "visitante": False, "super_usuario": True},
    "dashboard":  {"operador": False, "tecnico": False, "supervisor": True, "engineer": True, "gerente": True, "admin": True, "visitante": "ver", "super_usuario": True},
    # --- Multi-empresa (migración 0004) ---
    # empresas: mantenedor de empresas, exclusivo del super_usuario.
    # usuarios: mantenedor de perfiles; admin de empresa (solo su empresa) y super_usuario.
    # documentos: documentación de la empresa que consume el chat IA ("ver" = solo consulta).
    "empresas":   {"operador": False, "tecnico": False, "supervisor": False, "engineer": False, "gerente": False, "admin": False, "visitante": False, "super_usuario": True},
    "usuarios":   {"operador": False, "tecnico": False, "supervisor": False, "engineer": False, "gerente": False, "admin": True, "visitante": False, "super_usuario": True},
    "documentos": {"operador": "ver", "tecnico": "ver", "supervisor": "ver", "engineer": True, "gerente": True, "admin": True, "visitante": False, "super_usuario": True},
    # notificaciones: configuración del correo de OTs atrasadas (supervisor hacia arriba).
    "notificaciones": {"operador": False, "tecnico": False, "supervisor": True, "engineer": False, "gerente": True, "admin": True, "visitante": False, "super_usuario": True},
    "history":    {"operador": False, "tecnico": False, "supervisor": True, "engineer": False, "gerente": True, "admin": True, "visitante": False, "super_usuario": True},
}

# =============================================================================
# PERMISOS POR ACCIÓN  (basado en la matriz "Funciones dentro de las páginas")
# NOTA: "crear_ot" se sobre-escribe abajo por instrucción explícita del negocio:
# solo gerente y admin pueden crear OT (la matriz de referencia original indicaba
# otros roles).
# =============================================================================

ACCIONES: dict[str, dict[str, bool]] = {
    "crear_ot":            {"operador": False, "tecnico": False, "supervisor": False, "engineer": False, "gerente": True, "admin": True, "visitante": False, "super_usuario": True},
    # Técnico y operador NO cambian estados de OT (solo supervisión hacia arriba).
    "cambiar_estado_ot":   {"operador": False, "tecnico": False, "supervisor": True,  "engineer": True,  "gerente": True, "admin": True, "visitante": False, "super_usuario": True},
    # Cancelar una OT (estado final) es más restrictivo que iniciarla/cerrarla: engineer no puede.
    "cancelar_ot":         {"operador": False, "tecnico": False, "supervisor": True,  "engineer": False, "gerente": True, "admin": True, "visitante": False, "super_usuario": True},
    "eliminar_ot":         {"operador": False, "tecnico": False, "supervisor": True,  "engineer": True,  "gerente": True, "admin": True, "visitante": False, "super_usuario": True},
    "subir_documentos":    {"operador": False, "tecnico": False, "supervisor": False, "engineer": True,  "gerente": True, "admin": True, "visitante": False, "super_usuario": True},
    # No estaba en la matriz original; gestión de usuarios (crear/editar/eliminar) queda
    # restringida solo a admin por ser una acción sensible de administración del sistema.
    "gestionar_usuarios":  {"operador": False, "tecnico": False, "supervisor": False, "engineer": False, "gerente": False, "admin": True, "visitante": False, "super_usuario": True},
    # Ver el directorio de usuarios (con email) también se limita a admin.
    "eliminar_documentos": {"operador": False, "tecnico": False, "supervisor": False, "engineer": True,  "gerente": True, "admin": True, "visitante": False, "super_usuario": True},
    # Alta/edición/baja de empresas: solo super_usuario.
    "gestionar_empresas":  {"operador": False, "tecnico": False, "supervisor": False, "engineer": False, "gerente": False, "admin": False, "visitante": False, "super_usuario": True},
    "configurar_notificaciones": {"operador": False, "tecnico": False, "supervisor": True, "engineer": False, "gerente": True, "admin": True, "visitante": False, "super_usuario": True},
    "ver_usuarios":        {"operador": False, "tecnico": False, "supervisor": False, "engineer": False, "gerente": False, "admin": True, "visitante": False, "super_usuario": True},
}


ROL_SUPER = "super_usuario"
ESTADOS_EMPRESA_BLOQUEADOS = ("suspended", "cancelled")


def _normalizar_rol(rol: str | None) -> str:
    rol = (rol or "").strip().lower()
    if rol not in ROLES:
        raise HTTPException(status_code=403, detail=f"Rol desconocido: '{rol}'")
    return rol


def puede_acceder_ruta(rol: str, ruta: str) -> bool | str:
    permiso = RUTAS.get(ruta)
    if permiso is None:
        raise HTTPException(status_code=500, detail=f"Ruta '{ruta}' no está definida en permissions.py")
    return permiso.get(_normalizar_rol(rol), False)


def puede_ejecutar_accion(rol: str, accion: str) -> bool:
    permiso = ACCIONES.get(accion)
    if permiso is None:
        raise HTTPException(status_code=500, detail=f"Acción '{accion}' no está definida en permissions.py")
    return bool(permiso.get(_normalizar_rol(rol), False))


# =============================================================================
# RESOLUCIÓN DE LA SESIÓN ACTUAL
# =============================================================================
# Se recibe el token vía header Authorization: Bearer <token> y se consulta el
# rol REAL desde la base de datos en cada request, para no confiar en un rol
# que el cliente pudiera manipular.

async def get_sesion_actual(authorization: str = Header(..., alias="Authorization")) -> dict:
    token = authorization.replace("Bearer ", "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Falta el header Authorization: Bearer <token>.")

    # Multi-empresa (migración 0004): se resuelve la empresa del usuario en cada
    # request, junto con el estado de la empresa. LEFT JOIN porque el
    # super_usuario no pertenece a ninguna empresa (empresa_id NULL).
    sesion = await fetch_one(
        """
        SELECT u.usuario_id, u.rol, u.activo, u.empresa_id, e.estado AS empresa_estado
        FROM sesion s
        JOIN usuario u ON u.usuario_id = s.usuario_id
        LEFT JOIN empresa e ON e.empresa_id = u.empresa_id
        WHERE s.token = %(token)s AND s.expira_en > NOW()
        """,
        {"token": token},
    )
    if not sesion or not sesion.get("activo", True):
        raise HTTPException(status_code=401, detail="Sesión inválida o expirada. Vuelve a iniciar sesión.")

    rol = _normalizar_rol(sesion["rol"])
    # Una empresa suspendida/cancelada pierde el acceso completo a la solución.
    if rol != ROL_SUPER and sesion.get("empresa_estado") in ESTADOS_EMPRESA_BLOQUEADOS:
        raise HTTPException(status_code=403, detail="La empresa está suspendida o cancelada. Contacta a BARB.")

    return {
        "usuario_id": int(sesion["usuario_id"]),
        "rol": rol,
        "empresa_id": int(sesion["empresa_id"]) if sesion.get("empresa_id") is not None else None,
    }


def resolver_empresa(sesion: dict, empresa_id_solicitada: int | None = None) -> int | None:
    """
    Aislamiento multi-empresa: devuelve el empresa_id con el que se deben filtrar
    las consultas.

    - Usuario de empresa: SIEMPRE su propia empresa. Cualquier `empresa_id` que
      envíe el cliente se ignora (no se puede espiar a otra empresa).
    - super_usuario: el `empresa_id` solicitado, o None = todas las empresas.
    """
    if sesion["rol"] == ROL_SUPER:
        return empresa_id_solicitada
    return sesion["empresa_id"]


def empresa_obligatoria(sesion: dict, empresa_id_solicitada: int | None = None) -> int:
    """Como `resolver_empresa`, pero exige una empresa concreta (altas/escrituras)."""
    empresa_id = resolver_empresa(sesion, empresa_id_solicitada)
    if empresa_id is None:
        raise HTTPException(status_code=422, detail="Debes indicar la empresa (empresa_id) para esta operación.")
    return empresa_id


async def get_rol_actual(authorization: str = Header(..., alias="Authorization")) -> str:
    """Igual que get_sesion_actual pero devuelve solo el rol normalizado."""
    sesion = await get_sesion_actual(authorization)
    return sesion["rol"]


# =============================================================================
# DEPENDENCIAS PARA FASTAPI
# =============================================================================

def require_route(ruta: str, solo_lectura: bool = False):
    """
    Dependencia para proteger un endpoint según la matriz de RUTAS.

    Args:
        ruta:
            Clave de la ruta definida en RUTAS.
        solo_lectura:
            Si True, considera "ver" como acceso válido (endpoints GET).
            Si False, "ver" se rechaza (endpoints que escriben datos).
    """

    async def _dep(authorization: str = Header(..., alias="Authorization")):
        rol_actual = await get_rol_actual(authorization)
        permiso = puede_acceder_ruta(rol_actual, ruta)
        acceso_valido = permiso is True or (solo_lectura and permiso == "ver")
        if not acceso_valido:
            raise HTTPException(status_code=403, detail=f"El rol '{rol_actual}' no tiene acceso a '{ruta}'.")
        return rol_actual

    return _dep


def require_action(accion: str):
    """Dependencia para proteger una acción (crear/editar/eliminar/subir) según ACCIONES."""

    async def _dep(authorization: str = Header(..., alias="Authorization")):
        rol_actual = await get_rol_actual(authorization)
        if not puede_ejecutar_accion(rol_actual, accion):
            raise HTTPException(status_code=403, detail=f"El rol '{rol_actual}' no puede ejecutar '{accion}'.")
        return rol_actual

    return _dep


async def require_auth(authorization: str = Header(..., alias="Authorization")) -> str:
    """
    Dependencia liviana: solo exige un usuario autenticado y válido (cualquier
    rol, incluido visitante). Para datos de referencia de solo lectura que no
    aparecen en la matriz de rutas/acciones (máquinas, plantas, disciplinas,
    técnicos, listado de OTs).
    """
    return await get_rol_actual(authorization)
