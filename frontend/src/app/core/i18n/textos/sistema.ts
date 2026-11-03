// Textos de la vista «sistema». `en` está tipado como `typeof es`: no puede faltarle ni sobrarle una clave.
const es = {
  sistema: {
    demasiadas_peticiones_espera_u: 'Demasiadas peticiones. Espera un momento.',
    mensaje_invalido_vacio_o: 'Mensaje inválido (vacío o demasiado largo).',
    selecciona_una_empresa_en: 'Selecciona una empresa en la cabecera para consultar su documentación.',
    sesion_expirada_vuelve_a: 'Sesión expirada. Vuelve a iniciar sesión.',
    ocurrio_un_error_inesperado: 'Ocurrió un error inesperado.',
    no_hay_conexion_con: 'No hay conexión con el servidor.',
    eliminar_conversacion: 'Eliminar conversación',
    conversacion: 'Conversación',
    historial_de_conversaciones: 'Historial de conversaciones',
    metrica_del_ranking: 'Métrica del ranking',
    cerrar: 'Cerrar',
    cerrar_aviso: 'Cerrar aviso',
    volver_al_mapa: 'Volver al mapa',
    gestionar_activos: 'Gestionar activos',
  },
};

const en: typeof es = {
  sistema: {
    demasiadas_peticiones_espera_u: 'Too many requests. Wait a moment.',
    mensaje_invalido_vacio_o: 'Invalid message (empty or too long).',
    selecciona_una_empresa_en: 'Select a company in the header to query its documentation.',
    sesion_expirada_vuelve_a: 'Session expired. Sign in again.',
    ocurrio_un_error_inesperado: 'An unexpected error occurred.',
    no_hay_conexion_con: 'There is no connection to the server.',
    eliminar_conversacion: 'Delete conversation',
    conversacion: 'Conversation',
    historial_de_conversaciones: 'Conversation history',
    metrica_del_ranking: 'Ranking metric',
    cerrar: 'Close',
    cerrar_aviso: 'Close notice',
    volver_al_mapa: 'Back to the map',
    gestionar_activos: 'Manage assets',
  },
};

export const sistemaTextos = { es, en };
