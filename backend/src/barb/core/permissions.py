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

from barb.core.db import actor_usuario_id, fetch_one

# =============================================================================
# ROLES VÁLIDOS
# =============================================================================

# "super_usuario": contraparte comercial de BARB frente a la empresa cliente. No pertenece a
# ninguna empresa (usuario.empresa_id es NULL). Solo administra empresas (alta/edición/suspensión)
# y crea sus usuarios con perfil gerente; NO accede a datos operativos (dashboard, OTs,
# topología, DocChat, documentos).
ROLES = ("operador", "tecnico", "supervisor", "engineer", "gerente", "admin", "visitante", "super_usuario")

# =============================================================================
# PERMISOS POR RUTA  (basado en la matriz "Ruta")
# True  = acceso total
# "ver" = acceso solo lectura (equivalente a "solo ver" en la matriz)
# False = sin acceso
# =============================================================================

RUTAS: dict[str, dict[str, bool | str]] = {
    "menu":       {"operador": True, "tecnico": True, "supervisor": True, "engineer": True, "gerente": True, "admin": True, "visitante": True, "super_usuario": False},
    "docchat":    {"operador": True, "tecnico": True, "supervisor": True, "engineer": True, "gerente": True, "admin": True, "visitante": False, "super_usuario": False},
    "debug":      {"operador": True, "tecnico": True, "supervisor": True, "engineer": True, "gerente": True, "admin": True, "visitante": False, "super_usuario": False},
    "topology":   {"operador": True, "tecnico": True, "supervisor": True, "engineer": True, "gerente": True, "admin": True, "visitante": "ver", "super_usuario": False},
    "memory":     {"operador": True, "tecnico": True, "supervisor": True, "engineer": True, "gerente": True, "admin": True, "visitante": "ver", "super_usuario": False},
    "report":     {"operador": True, "tecnico": True, "supervisor": True, "engineer": True, "gerente": True, "admin": True, "visitante": False, "super_usuario": False},
    "dashboard":  {"operador": False, "tecnico": False, "supervisor": True, "engineer": True, "gerente": True, "admin": True, "visitante": "ver", "super_usuario": False},
    # --- Multi-empresa (migración 0004) ---
    # empresas: mantenedor de empresas, exclusivo del super_usuario.
    # usuarios: mantenedor de perfiles; gerente y admin de empresa (solo su empresa). El super_usuario
    # solo puede crear/gestionar usuarios con perfil gerente (ver routers/users.py).
    # documentos: documentación de la empresa que consume el chat IA ("ver" = solo consulta).
    "empresas":   {"operador": False, "tecnico": False, "supervisor": False, "engineer": False, "gerente": False, "admin": False, "visitante": False, "super_usuario": True},
    "usuarios":   {"operador": False, "tecnico": False, "supervisor": False, "engineer": False, "gerente": True, "admin": True, "visitante": False, "super_usuario": True},
    "documentos": {"operador": "ver", "tecnico": "ver", "supervisor": "ver", "engineer": True, "gerente": True, "admin": True, "visitante": False, "super_usuario": False},
    # plantas: mantenedor masivo de plantas, disciplinas y máquinas (HU-24). Sólo gerente y
    # admin de la empresa pueden dar de alta: crear una planta arrastra máquinas, y desde ahí
    # ya se pueden abrir OTs. El resto de los roles sigue viendo el catálogo por /api/plants,
    # /api/machines y /api/disciplines, que sólo piden sesión.
    "plantas":    {"operador": False, "tecnico": False, "supervisor": False, "engineer": False, "gerente": True, "admin": True, "visitante": False, "super_usuario": False},
    # notificaciones: configuración del correo de OTs atrasadas (supervisor hacia arriba).
    "notificaciones": {"operador": False, "tecnico": False, "supervisor": True, "engineer": False, "gerente": True, "admin": True, "visitante": False, "super_usuario": False},
    # transacciones: bitácora de lo que hacen los usuarios de las empresas (solo lectura), exclusiva del super_usuario.
    "transacciones": {"operador": False, "tecnico": False, "supervisor": False, "engineer": False, "gerente": False, "admin": False, "visitante": False, "super_usuario": True},
    # transacciones_empresa: lo mismo, acotado a la empresa del usuario (solo lectura), exclusiva del gerente.
    "transacciones_empresa": {"operador": False, "tecnico": False, "supervisor": False, "engineer": False, "gerente": True, "admin": False, "visitante": False, "super_usuario": False},
    # history: vista global de la empresa. Primer consumidor backend: los tickets
    # conversacionales (HU-06) — quien la tiene ve TODOS los tickets de su empresa
    # en GET /api/tickets; el resto solo ve los creados desde sus conversaciones.
    "history":    {"operador": False, "tecnico": False, "supervisor": True, "engineer": False, "gerente": True, "admin": True, "visitante": False, "super_usuario": False},
}

# =============================================================================
# PERMISOS POR ACCIÓN  (basado en la matriz "Funciones dentro de las páginas")
# NOTA: "crear_ot" se sobre-escribe abajo por instrucción explícita del negocio:
# solo gerente y admin pueden crear OT (la matriz de referencia original indicaba
# otros roles).
# =============================================================================

ACCIONES: dict[str, dict[str, bool]] = {
    "crear_ot":            {"operador": False, "tecnico": False, "supervisor": False, "engineer": False, "gerente": True, "admin": True, "visitante": False, "super_usuario": False},
    # Técnico y operador NO cambian estados de OT (solo supervisión hacia arriba).
    "cambiar_estado_ot":   {"operador": False, "tecnico": False, "supervisor": True,  "engineer": True,  "gerente": True, "admin": True, "visitante": False, "super_usuario": False},
    # Cancelar una OT (estado final) es más restrictivo que iniciarla/cerrarla: engineer no puede.
    "cancelar_ot":         {"operador": False, "tecnico": False, "supervisor": True,  "engineer": False, "gerente": True, "admin": True, "visitante": False, "super_usuario": False},
    "eliminar_ot":         {"operador": False, "tecnico": False, "supervisor": True,  "engineer": True,  "gerente": True, "admin": True, "visitante": False, "super_usuario": False},
    "subir_documentos":    {"operador": False, "tecnico": False, "supervisor": False, "engineer": True,  "gerente": True, "admin": True, "visitante": False, "super_usuario": False},
    # No estaba en la matriz original; gestión de usuarios (crear/editar/eliminar) queda
    # restringida a gerente y admin de la empresa. El super_usuario solo puede operar sobre
    # usuarios con perfil gerente (regla aplicada en routers/users.py).
    "gestionar_usuarios":  {"operador": False, "tecnico": False, "supervisor": False, "engineer": False, "gerente": True, "admin": True, "visitante": False, "super_usuario": True},
    # Ver el directorio de usuarios (con email) se limita a los mismos perfiles.
    "eliminar_documentos": {"operador": False, "tecnico": False, "supervisor": False, "engineer": True,  "gerente": True, "admin": True, "visitante": False, "super_usuario": False},
    # Alta/edición/baja de empresas: solo super_usuario.
    "gestionar_empresas":  {"operador": False, "tecnico": False, "supervisor": False, "engineer": False, "gerente": False, "admin": False, "visitante": False, "super_usuario": True},
    "configurar_notificaciones": {"operador": False, "tecnico": False, "supervisor": True, "engineer": False, "gerente": True, "admin": True, "visitante": False, "super_usuario": False},
    "ver_usuarios":        {"operador": False, "tecnico": False, "supervisor": False, "engineer": False, "gerente": True, "admin": True, "visitante": False, "super_usuario": True},
    # --- Tickets conversacionales (HU-06, migración 0007) ---
    # Quien conversa con la IA guarda su conversación como ticket: todos los roles
    # de empresa (ni visitante ni super_usuario, que no accede a datos operativos).
    "crear_ticket":            {"operador": True, "tecnico": True, "supervisor": True, "engineer": True, "gerente": True, "admin": True, "visitante": False, "super_usuario": False},
    # Avanzar/resolver tickets de la empresa. El dueño siempre puede avanzar el
    # suyo sin esta acción (regla de dueñez en core/ticket_states.py).
    "cambiar_estado_ticket":   {"operador": False, "tecnico": False, "supervisor": True, "engineer": False, "gerente": True, "admin": True, "visitante": False, "super_usuario": False},
    # Cancelar un ticket (estado final) es más restrictivo que avanzarlo, mismo
    # criterio que cancelar_ot: el dueño NO puede cancelar el suyo.
    "cancelar_ticket":         {"operador": False, "tecnico": False, "supervisor": True, "engineer": False, "gerente": True, "admin": True, "visitante": False, "super_usuario": False},
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

    actor_usuario_id.set(int(sesion["usuario_id"]))  # lo lee core/db.py para auditar en `transacciones`
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
    Dependencia liviana: exige un usuario de empresa autenticado y válido (cualquier
    rol, incluido visitante). Para datos de referencia de solo lectura que no
    aparecen en la matriz de rutas/acciones (máquinas, plantas, disciplinas,
    técnicos, listado de OTs). El super_usuario queda excluido: no accede a datos
    operativos de las empresas.
    """
    rol = await get_rol_actual(authorization)
    if rol == ROL_SUPER:
        raise HTTPException(status_code=403, detail="El rol 'super_usuario' no tiene acceso a datos operativos de las empresas.")
    return rol
