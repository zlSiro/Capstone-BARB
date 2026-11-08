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
ROLES = ("operador", "tecnico", "supervisor", "engineer", "gerente", "admin", "super_usuario")

# =============================================================================
# PERMISOS POR RUTA  (basado en la matriz "Ruta")
# True  = acceso total
# "ver" = acceso solo lectura (equivalente a "solo ver" en la matriz)
# False = sin acceso
# =============================================================================

RUTAS: dict[str, dict[str, bool | str]] = {
    "menu":       {"operador": True, "tecnico": True, "supervisor": True, "engineer": True, "gerente": True, "admin": True, "super_usuario": False},
    "docchat":    {"operador": True, "tecnico": True, "supervisor": True, "engineer": True, "gerente": True, "admin": True, "super_usuario": False},
    "debug":      {"operador": True, "tecnico": True, "supervisor": True, "engineer": True, "gerente": True, "admin": True, "super_usuario": False},
    "topology":   {"operador": True, "tecnico": True, "supervisor": True, "engineer": True, "gerente": True, "admin": True, "super_usuario": False},
    "memory":     {"operador": True, "tecnico": True, "supervisor": True, "engineer": True, "gerente": True, "admin": True, "super_usuario": False},
    "report":     {"operador": True, "tecnico": True, "supervisor": True, "engineer": True, "gerente": True, "admin": True, "super_usuario": False},
    "dashboard":  {"operador": False, "tecnico": False, "supervisor": True, "engineer": True, "gerente": True, "admin": False, "super_usuario": False},
    # --- Multi-empresa (migración 0004) ---
    # empresas: mantenedor de empresas, exclusivo del super_usuario.
    # usuarios: mantenedor de perfiles; gerente y admin de empresa (solo su empresa). El super_usuario
    # solo puede crear/gestionar usuarios con perfil gerente (ver routers/users.py).
    # documentos: documentación de la empresa que consume el chat IA ("ver" = solo consulta).
    "empresas":   {"operador": False, "tecnico": False, "supervisor": False, "engineer": False, "gerente": False, "admin": False, "super_usuario": True},
    "usuarios":   {"operador": False, "tecnico": False, "supervisor": False, "engineer": False, "gerente": True, "admin": True, "super_usuario": True},
    "documentos": {"operador": "ver", "tecnico": "ver", "supervisor": "ver", "engineer": True, "gerente": "ver", "admin": True, "super_usuario": False},
    # plantas: mantenedor masivo de plantas, disciplinas y máquinas (HU-24). Sólo el admin de la
    # empresa puede dar de alta: crear una planta arrastra máquinas, y desde ahí ya se pueden abrir
    # OTs. El resto de los roles sigue viendo el catálogo por /api/plants, /api/machines y
    # /api/disciplines, que sólo piden sesión.
    "plantas":    {"operador": False, "tecnico": False, "supervisor": False, "engineer": False, "gerente": False, "admin": True, "super_usuario": False},
    # notificaciones: configuración del correo de OTs atrasadas (supervisor y admin). El gerente solo lo recibe (escalamiento).
    "notificaciones": {"operador": False, "tecnico": False, "supervisor": True, "engineer": False, "gerente": False, "admin": True, "super_usuario": False},
    # transacciones: bitácora de lo que hacen los usuarios de las empresas (solo lectura), exclusiva del super_usuario.
    "transacciones": {"operador": False, "tecnico": False, "supervisor": False, "engineer": False, "gerente": False, "admin": False, "super_usuario": True},
    # transacciones_empresa: lo mismo, acotado a la empresa del usuario (solo lectura), exclusiva del gerente.
    "transacciones_empresa": {"operador": False, "tecnico": False, "supervisor": False, "engineer": False, "gerente": True, "admin": False, "super_usuario": False},
    # history: supervisor, ingeniero y gerente analizan el historial de fallas; el administrador no lo ve.
    "history":    {"operador": False, "tecnico": False, "supervisor": True, "engineer": True, "gerente": True, "admin": False, "super_usuario": False},
    # avisos: reporte de fallas desde planta. Quienes reportan ven los suyos; supervisor y gerente ven
    # el repositorio completo de la empresa (ROLES_REPOSITORIO_AVISOS), pero solo el supervisor decide
    # si se genera una OT o se descarta (acción `gestionar_avisos`).
    "avisos":     {"operador": True, "tecnico": True, "supervisor": True, "engineer": True, "gerente": True, "admin": False, "super_usuario": False},
}

# =============================================================================
# PERMISOS POR ACCIÓN  (basado en la matriz "Funciones dentro de las páginas")
# NOTA: "crear_ot" (crear una OT directamente, sin un aviso de falla previo) es exclusiva del
# supervisor por decisión explícita del negocio. Todo lo que reportan los demás roles entra como
# aviso de falla y el supervisor decide si genera la OT (`gestionar_avisos`).
# =============================================================================

ACCIONES: dict[str, dict[str, bool]] = {
    # Crear una OT directamente (sin pasar por un aviso): SOLO el supervisor. El gerente y el administrador no la
    # crean por esta vía; las OT que nacen de un aviso también las genera solo el supervisor (`gestionar_avisos`).
    "crear_ot":            {"operador": False, "tecnico": False, "supervisor": True,  "engineer": False, "gerente": False, "admin": False, "super_usuario": False},
    # El técnico solo inicia las OT que tiene asignadas (`iniciar_ot_asignada`). Gerente e ingeniero consultan, no operan.
    "cambiar_estado_ot":   {"operador": False, "tecnico": False, "supervisor": True,  "engineer": False,  "gerente": False, "admin": False, "super_usuario": False},
    # Cancelar una OT (estado final, con motivo) es solo del supervisor.
    "cancelar_ot":         {"operador": False, "tecnico": False, "supervisor": True,  "engineer": False, "gerente": False, "admin": False, "super_usuario": False},
    # Eliminar borra el historial de la OT: ningún perfil puede (D1). El endpoint DELETE se mantiene y
    # responde 403 por permisos; lo normal es cancelar.
    "eliminar_ot":         {"operador": False, "tecnico": False, "supervisor": False, "engineer": False, "gerente": False, "admin": False, "super_usuario": False},
    # --- Aviso de falla -> OT (Fase 1 de roles y privilegios) ---
    # Reportar una falla desde planta. Llega al repositorio de avisos del supervisor.
    "reportar_falla":      {"operador": True,  "tecnico": True,  "supervisor": True,  "engineer": True,  "gerente": True, "admin": False, "super_usuario": False},
    # Decidir sobre un aviso: generar una OT o descartarlo (con motivo).
    "gestionar_avisos":    {"operador": False, "tecnico": False, "supervisor": True,  "engineer": False, "gerente": False, "admin": False, "super_usuario": False},
    # Priorizar, asignar y reasignar el técnico de una OT.
    "asignar_ot":          {"operador": False, "tecnico": False, "supervisor": True,  "engineer": False, "gerente": False, "admin": False, "super_usuario": False},
    # Doble validación del cierre: enviar la OT a validación (in_progress -> por_validar). El técnico solo la OT que
    # tiene asignada (ROLES_SOLO_OT_ASIGNADA); el supervisor cualquiera.
    "enviar_a_validacion": {"operador": False, "tecnico": True,  "supervisor": True,  "engineer": False, "gerente": False, "admin": False, "super_usuario": False},
    # Validar y cerrar (por_validar -> completed) o devolver a «en curso» con comentario: solo el supervisor, y nunca
    # quien envió la OT a validación (se comprueba en work_order_states / el router).
    "validar_ot":          {"operador": False, "tecnico": False, "supervisor": True,  "engineer": False, "gerente": False, "admin": False, "super_usuario": False},
    # KPIs financieros del dashboard (costo directo, ahorro, impacto anual y rankings por costo): solo el gerente.
    # Supervisor e ingeniero ven los KPIs operativos; el resto de los campos se omite de la respuesta.
    "ver_kpis_financieros": {"operador": False, "tecnico": False, "supervisor": False, "engineer": False, "gerente": True,  "admin": False, "super_usuario": False},
    # Iniciar la OT propia (solo si el usuario es el técnico asignado; se valida en el router).
    "iniciar_ot_asignada": {"operador": False, "tecnico": True,  "supervisor": False, "engineer": False, "gerente": False, "admin": False, "super_usuario": False},
    "subir_documentos":    {"operador": False, "tecnico": False, "supervisor": False, "engineer": True,  "gerente": False, "admin": True, "super_usuario": False},
    # No estaba en la matriz original; gestión de usuarios (crear/editar/eliminar) queda
    # restringida a gerente y admin de la empresa. El super_usuario solo puede operar sobre
    # usuarios con perfil gerente (regla aplicada en routers/users.py).
    "gestionar_usuarios":  {"operador": False, "tecnico": False, "supervisor": False, "engineer": False, "gerente": True, "admin": True, "super_usuario": True},
    # Ver el directorio de usuarios (con email) se limita a los mismos perfiles.
    "eliminar_documentos": {"operador": False, "tecnico": False, "supervisor": False, "engineer": True,  "gerente": False, "admin": True, "super_usuario": False},
    # Alta/edición/baja de empresas: solo super_usuario.
    "gestionar_empresas":  {"operador": False, "tecnico": False, "supervisor": False, "engineer": False, "gerente": False, "admin": False, "super_usuario": True},
    "configurar_notificaciones": {"operador": False, "tecnico": False, "supervisor": True, "engineer": False, "gerente": False, "admin": True, "super_usuario": False},
    "ver_usuarios":        {"operador": False, "tecnico": False, "supervisor": False, "engineer": False, "gerente": True, "admin": True, "super_usuario": True},
}


ROL_SUPER = "super_usuario"

# Roles cuyas acciones sobre una OT se limitan a la que tienen asignada (p. ej. enviarla a validación).
ROLES_SOLO_OT_ASIGNADA = frozenset({"tecnico"})

# Roles que solo ven las OT que les corresponden (asignadas a ellos, o nacidas de un aviso suyo).
# El resto de los roles de empresa ve todas las OT de su empresa.
ROLES_VISTA_PROPIA = frozenset({"operador", "tecnico"})

# Gestión de usuarios en cascada: cada perfil solo crea, ve, edita y elimina a los del nivel siguiente.
#   super_usuario -> gerente  ->  admin  ->  operador, tecnico, supervisor, engineer
# Evita que un perfil se otorgue (u otorgue a un igual) privilegios de decisión.
ROLES_GESTIONABLES_POR_ADMIN = frozenset({"operador", "tecnico", "supervisor", "engineer"})
ROLES_GESTIONABLES_POR_GERENTE = frozenset({"admin"})

# Roles que ven el repositorio completo de avisos de falla de su empresa. Solo `gestionar_avisos`
# (supervisor) decide sobre ellos; el gerente únicamente los consulta.
ROLES_REPOSITORIO_AVISOS = frozenset({"supervisor", "gerente"})
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


def require_any_action(*acciones: str):
    """Como `require_action`, pero basta con que el rol pueda ejecutar CUALQUIERA de las acciones.

    Para endpoints donde el permiso final depende del contexto (p. ej. el técnico solo inicia SU OT):
    esta dependencia deja pasar y el router valida el contexto.
    """

    async def _dep(authorization: str = Header(..., alias="Authorization")):
        rol_actual = await get_rol_actual(authorization)
        if not any(puede_ejecutar_accion(rol_actual, a) for a in acciones):
            raise HTTPException(status_code=403, detail=f"El rol '{rol_actual}' no puede ejecutar '{acciones[0]}'.")
        return rol_actual

    return _dep


async def require_auth(authorization: str = Header(..., alias="Authorization")) -> str:
    """
    Dependencia liviana: exige un usuario de empresa autenticado y válido (cualquier
    rol de empresa). Para datos de referencia de solo lectura que no
    aparecen en la matriz de rutas/acciones (máquinas, plantas, disciplinas,
    técnicos, listado de OTs). El super_usuario queda excluido: no accede a datos
    operativos de las empresas.
    """
    rol = await get_rol_actual(authorization)
    if rol == ROL_SUPER:
        raise HTTPException(status_code=403, detail="El rol 'super_usuario' no tiene acceso a datos operativos de las empresas.")
    return rol
