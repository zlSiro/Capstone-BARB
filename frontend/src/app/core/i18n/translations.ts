// =============================================================================
// SISTEMA DE TRADUCCIONES — ES / EN
// =============================================================================

export type AppLang = 'es' | 'en';

export const translations = {
  es: {
    common: {
      language: 'Idioma', refresh: 'Actualizar', loading: 'Cargando…', export: 'Exportar',
      csv: 'CSV', xlsx: 'XLSX', search: 'Buscar', all: 'Todos', back: 'Volver', close: 'Cerrar',
      cancel: 'Cancelar', save: 'Guardar', create: 'Crear', delete: 'Eliminar', status: 'Estado',
      machine: 'Máquina', priority: 'Prioridad', title: 'Título', description: 'Descripción',
      summary: 'Resumen', report: 'Reporte', theme: 'Tema', username: 'Usuario', password: 'Contraseña',
      role: 'Rol', settings: 'Configuración', optional: 'opcional', page: 'Página', remove: 'Quitar',
      replace: 'Cambiar', upload: 'Subir', processing: 'Procesando...', documentName: 'Nombre del documento',
      internalNotes: 'Notas internas', file: 'Archivo', send: 'Enviar', connecting: 'Conectando...',
      forbiddenTitle: '403 - No Autorizado',
      forbiddenMessage: 'Tu usuario no tiene permiso para acceder a esta ruta.',
      backToMenu: 'Volver al menú', goToLogin: 'Ir al Login', success: 'Éxito', error: 'Error',
      severity: 'Severidad', low: 'Baja', medium: 'Media', high: 'Alta', critical: 'Crítica',
      minutes: 'minutos', operator: 'Operador', untitled: 'Sin título', noDescription: 'Sin descripción',
      plant: 'Planta', discipline: 'Disciplina', next: 'Siguiente', prev: 'Anterior',
      technician: 'Técnico', duration: 'Duración', action: 'Acciones', view: 'Ver', urgent: 'Urgente',
      understood: 'Entendido',
      errorLoadingCatalogs: 'No se pudieron cargar los catálogos. Verifica la conexión.',
      fillDetails: 'Ingresa los detalles para generar y asignar la orden.',
      sessionExpired: 'Tu sesión expiró. Inicia sesión nuevamente.'
    },
    statuses: {
      pending: 'Pendiente', assigned: 'Asignada', in_progress: 'En Progreso', completed: 'Completada',
      cancelled: 'Cancelada', overdue: 'Atrasada', open: 'Abierta', done: 'Terminada', closed: 'Cerrada',
      operativo: 'Operativo', alerta: 'Alerta', mantenimiento: 'Mantenimiento', falla: 'Falla'
    },
    maintenanceTypes: {
      corrective: 'Correctivo', preventive: 'Preventivo', predictive: 'Predictivo', inspection: 'Inspección'
    },
    login: {
      title: 'BARB', subtitle: 'Sistema de mantenimiento de planta',
      usernamePlaceholder: 'Usuario', passwordPlaceholder: 'Contraseña',
      loginButton: 'Ingresar',
      incorrectCredentials: 'Usuario o contraseña incorrecta, vuelve a intentarlo.',
      chooseRole: 'Seleccionar rol', technician: 'Técnico', engineer: 'Ingeniero',
      supervisor: 'Supervisor', admin: 'Administrador',
      themeToggle: 'Cambiar tema', hidePassword: 'Ocultar contraseña', showPassword: 'Mostrar contraseña'
    },
    topbar: {
      admin: 'ADMIN', apiOnline: 'API', documentChat: 'Chat de documentos',
      machineDebug: 'Diagnóstico de máquina', plantTopology: 'Topología de planta',
      machineMemory: 'Memoria de máquina', debugReport: 'Reporte de sesión',
      mainMenu: 'Menú principal', maintenance: 'Mantenimiento de planta',
      logout: 'Salir', settings: 'Configuración', helpGuide: 'Guía de esta pantalla'
    },
    menu: {
      title: 'Menú principal',
      documentChatTitle: 'Asistente Documental',
      documentChatDescription: 'Consulta manuales y procedimientos',
      topologyTitle: 'Topología de planta',
      topologyDescription: 'Mapa interactivo de máquinas',
      dashboardTitle: 'Dashboard KPI', dashboardDescription: 'Métricas y reportes',
      adminBadge: 'ADMIN',
      uploadTitle: 'Subir documentos',
      uploadDescription: 'Sube archivos al repositorio documental',
      uploadHint: 'El archivo se guardará en el repositorio documental seguro.',
      sessionHistoryTitle: 'Historial de Sesiones',
      sessionHistoryDescription: 'Revisa conversaciones y diagnósticos anteriores'
    },
    financial: {
      roiTitle: 'Impacto Anual Proyectado (Modelo BARB v1.0)',
      roiSubtitle: 'Basado en US$2.000/min de inactividad operativa.',
      withoutBarb: 'Escenario Sin BARB', withBarb: 'Escenario Con BARB',
      savingsGenerated: 'Ahorro Generado a la fecha',
      mttrGlobal: 'MTTR Global', mttrOptimal: '✓ Dentro de SLA',
      efficiency: 'Eficiencia Resolución', efficiencySub: 'OTs completadas dentro del SLA (24h)',
      directCost: 'Costo Directo', directCostSub: 'Repuestos y servicios facturados',
      mtbf: 'MTBF Global', mtbfSub: 'Tiempo Medio Entre Fallas (Horas)',
      mtbfNeedData: 'Requiere historial min. 2 fallas',
      healthTitle: 'Salud Operacional: Backlog',
      healthSub: 'Tendencia diaria de OTs Abiertas vs Cerradas (14 d).',
      performanceTitle: 'Rendimiento por Máquina',
      measured: 'Medido', estimated: 'Estimado',
      topMachinesTitle: 'Top Equipos', topMachinesSubtitle: 'Rendimiento por métrica',
      viewOts: 'Volumen OTs', viewMttr: 'MTTR (Minutos)', viewAhorro: 'Ahorro Generado'
    },
    dashboard: {
      title: 'Órdenes de Trabajo', totalWorkOrders: 'Total OTs',
      activeWorkOrders: 'OTs activas', completedWorkOrders: 'Completadas',
      mttr: 'MTTR (min)', filters: 'Filtros', allStatuses: 'Todos los estados',
      allMachines: 'Todas las máquinas', allTypes: 'Todos los tipos',
      createWorkOrder: 'Crear OT', chartStatus: 'Distribución por estado',
      chartMachines: 'Máquinas con más OTs', chartResolution: 'Tiempo de resolución',
      noData: 'Sin datos', strategyTitle: 'Estrategia de Mantenimiento',
      strategySubtitle: 'Preventivo vs Correctivo',
      costDeviationTitle: 'Desviación de Costos',
      costDeviationSubtitle: 'Costo Estimado vs Real (USD)',
      topAssetsTitle: 'Top 5 Activos Críticos',
      topAssetsSubtitle: 'Máquinas con mayor volumen de OTs',
      last7Days: 'Últimos 7 días', last30Days: 'Últimos 30 días',
      last90Days: 'Últimos 90 días', allTime: 'Histórico'
    },
    settings: {
      title: 'Configuración', appearanceLanguage: 'Apariencia e idioma',
      darkTheme: 'Tema oscuro', account: 'Cuenta',
      systemConnections: 'Sistema y conexiones', appVersion: 'Versión de la app',
      fastApiEndpoint: 'Endpoint FastAPI', lmStudioEndpoint: 'Endpoint LM Studio',
      testConnections: 'Probar conexiones',
      testingConnections: 'Probando conexión a FastAPI y LM Studio…',
      apiOkLmOffline: '✅ FastAPI · ❌ LM Studio (No detectado)',
      apiOkLmOk: '✅ FastAPI · ✅ LM Studio',
      saveChanges: 'Guardar cambios',
      savedLocally: 'Configuración guardada localmente',
      languageUpdated: 'Idioma actualizado',
      username: 'Usuario', role: 'Rol', guest: 'Invitado',
      testingShort: 'Probando...', productionLabel: 'Producción'
    },
    chatHistory: {
      title: 'Historial de Diagnósticos', subtitle: 'Registro de auditoría y consultas previas realizadas a la IA.',
      backToChat: '← Volver al chat', loadingSessions: 'Cargando conversaciones…',
      loadingMessages: 'Cargando mensajes…', date: 'Fecha', titleIssue: 'Título / Problema',
      machine: 'Equipo', deleteTooltip: 'Eliminar conversación',
      selectPrompt: 'Selecciona una conversación para ver el detalle.',
      continueConversation: 'Continuar esta conversación',
      emptyState: 'Todavía no tienes conversaciones guardadas.',
      startConversation: 'Iniciar una conversación', loadError: 'No se pudieron cargar las conversaciones.',
      loadDetailError: 'No se pudo cargar la conversación.',
      deleteConfirm: '¿Eliminar la conversación "{title}"? Esta acción no se puede deshacer.',
      deleteSuccess: 'Conversación eliminada', deleteError: 'No se pudo eliminar la conversación',
      sidebarSubtitle: 'Consultas previas realizadas a la IA', sidebarEmpty: 'Sin conversaciones guardadas.',
      sidebarEmptyHint: 'Inicia una nueva para verla aquí.', loadSessionsError: 'No se pudo cargar el historial.'
    },
    docChat: {
      title: 'DocChat IA', subtitle: 'Consulta al asistente técnico en tiempo real',
      activeConversation: 'Conversación activa', newConversation: '+ Nueva conversación',
      emptyState: 'Inicia la conversación escribiendo tu primera pregunta.',
      inputPlaceholder: 'Escribe tu pregunta... (Enter para enviar, Shift+Enter para salto de línea)',
      unknownError: 'Error desconocido', connectionError: 'No se pudo conectar con el asistente.',
      deleteError: 'No se pudo eliminar la conversación.'
    }
  },

  en: {
    common: {
      language: 'Language', refresh: 'Refresh', loading: 'Loading…', export: 'Export',
      csv: 'CSV', xlsx: 'XLSX', search: 'Search', all: 'All', back: 'Back', close: 'Close',
      cancel: 'Cancel', save: 'Save', create: 'Create', delete: 'Delete', status: 'Status',
      machine: 'Machine', priority: 'Priority', title: 'Title', description: 'Description',
      summary: 'Summary', report: 'Report', theme: 'Theme', username: 'Username', password: 'Password',
      role: 'Role', settings: 'Settings', optional: 'optional', page: 'Page', remove: 'Remove',
      replace: 'Change', upload: 'Upload', processing: 'Processing...', documentName: 'Document name',
      internalNotes: 'Internal notes', file: 'File', send: 'Send', connecting: 'Connecting...',
      forbiddenTitle: '403 - Forbidden',
      forbiddenMessage: 'You do not have permission to access this page.',
      backToMenu: 'Back to menu', goToLogin: 'Go to Login', success: 'Success', error: 'Error',
      severity: 'Severity', low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical',
      minutes: 'minutes', operator: 'Operator', untitled: 'Untitled', noDescription: 'No description',
      plant: 'Plant', discipline: 'Discipline', next: 'Next', prev: 'Prev',
      technician: 'Technician', duration: 'Duration', action: 'Actions', view: 'View',
      urgent: 'Urgent', understood: 'Got it',
      errorLoadingCatalogs: 'Could not load the catalogs. Check your connection.',
      fillDetails: 'Enter the details to generate and assign the order.',
      sessionExpired: 'Your session has expired. Please log in again.'
    },
    statuses: {
      pending: 'Pending', assigned: 'Assigned', in_progress: 'In Progress', completed: 'Completed',
      cancelled: 'Cancelled', overdue: 'Overdue', open: 'Open', done: 'Done', closed: 'Closed',
      operativo: 'Operational', alerta: 'Warning', mantenimiento: 'Maintenance', falla: 'Error'
    },
    maintenanceTypes: {
      corrective: 'Corrective', preventive: 'Preventive', predictive: 'Predictive', inspection: 'Inspection'
    },
    login: {
      title: 'BARB', subtitle: 'Plant maintenance system',
      usernamePlaceholder: 'Username', passwordPlaceholder: 'Password',
      loginButton: 'Login',
      incorrectCredentials: 'Incorrect username or password, please try again.',
      chooseRole: 'Choose role', technician: 'Technician', engineer: 'Engineer',
      supervisor: 'Supervisor', admin: 'Admin',
      themeToggle: 'Toggle theme', hidePassword: 'Hide password', showPassword: 'Show password'
    },
    topbar: {
      admin: 'ADMIN', apiOnline: 'API', documentChat: 'Document Chat',
      machineDebug: 'Machine Debug', plantTopology: 'Plant Topology',
      machineMemory: 'Machine Memory', debugReport: 'Session Report',
      mainMenu: 'Main Menu', maintenance: 'Plant Maintenance',
      logout: 'Log out', settings: 'Settings', helpGuide: 'Guide for this screen'
    },
    menu: {
      title: 'Main Menu',
      documentChatTitle: 'Document Chat',
      documentChatDescription: 'Chat with plant manuals and documentation by discipline',
      topologyTitle: 'Plant Topology',
      topologyDescription: 'View machines and their connections in the plant',
      dashboardTitle: 'OT Dashboard',
      dashboardDescription: 'Work order dashboard — automatic tickets, start/close times, maintenance KPIs',
      adminBadge: 'ADMIN',
      uploadTitle: 'Document upload',
      uploadDescription: 'Upload manuals, technical sheets or procedures.',
      uploadHint: 'The file will be stored in the document repository.',
      sessionHistoryTitle: 'Session History',
      sessionHistoryDescription: 'Review previous conversations and diagnostics'
    },
    financial: {
      roiTitle: 'Projected Annual Impact (BARB v1.0 Model)',
      roiSubtitle: 'Based on US$2,000/min of operational downtime.',
      withoutBarb: 'Without BARB Scenario', withBarb: 'With BARB Scenario',
      savingsGenerated: 'Savings Generated to Date',
      mttrGlobal: 'Global MTTR', mttrOptimal: '✓ Within SLA',
      efficiency: 'Resolution Efficiency', efficiencySub: 'Work orders completed within SLA (24h)',
      directCost: 'Direct Cost', directCostSub: 'Billed parts and services',
      mtbf: 'Global MTBF', mtbfSub: 'Mean Time Between Failures (Hours)',
      mtbfNeedData: 'Requires min. 2 failures history',
      healthTitle: 'Operational Health: Backlog',
      healthSub: 'Daily trend of Open vs Closed WOs (14 d).',
      performanceTitle: 'Machine Performance',
      measured: 'Measured', estimated: 'Estimated',
      topMachinesTitle: 'Top Machines', topMachinesSubtitle: 'Performance by metric',
      viewOts: 'WO Volume', viewMttr: 'MTTR (Minutes)', viewAhorro: 'Savings Generated'
    },
    dashboard: {
      title: 'Work Orders', totalWorkOrders: 'Total WOs',
      activeWorkOrders: 'Active WOs', completedWorkOrders: 'Completed',
      mttr: 'MTTR (min)', filters: 'Filters', allStatuses: 'All statuses',
      allMachines: 'All machines', allTypes: 'All types',
      createWorkOrder: 'Create WO', chartStatus: 'Status breakdown',
      chartMachines: 'Top machines', chartResolution: 'Resolution time',
      noData: 'No data', strategyTitle: 'Maintenance Strategy',
      strategySubtitle: 'Preventive vs Corrective',
      costDeviationTitle: 'Cost Deviation',
      costDeviationSubtitle: 'Estimated vs Real Cost (USD)',
      topAssetsTitle: 'Top 5 Critical Assets',
      topAssetsSubtitle: 'Machines with highest WO volume',
      last7Days: 'Last 7 days', last30Days: 'Last 30 days',
      last90Days: 'Last 90 days', allTime: 'All Time'
    },
    settings: {
      title: 'Settings', appearanceLanguage: 'Appearance & language',
      darkTheme: 'Dark theme', account: 'Account',
      systemConnections: 'System & connections', appVersion: 'App version',
      fastApiEndpoint: 'FastAPI endpoint', lmStudioEndpoint: 'LM Studio endpoint',
      testConnections: 'Test connections',
      testingConnections: 'Testing FastAPI and LM Studio connection…',
      apiOkLmOffline: '✅ FastAPI · ❌ LM Studio (Not detected)',
      apiOkLmOk: '✅ FastAPI · ✅ LM Studio',
      saveChanges: 'Save changes',
      savedLocally: 'Configuration saved locally',
      languageUpdated: 'Language updated',
      username: 'Username', role: 'Role', guest: 'Guest',
      testingShort: 'Testing...', productionLabel: 'Production'
    },
    chatHistory: {
      title: 'Diagnostic History', subtitle: 'Audit log of previous queries made to the AI.',
      backToChat: '← Back to chat', loadingSessions: 'Loading conversations…',
      loadingMessages: 'Loading messages…', date: 'Date', titleIssue: 'Title / Issue',
      machine: 'Machine', deleteTooltip: 'Delete conversation',
      selectPrompt: 'Select a conversation to view its details.',
      continueConversation: 'Continue this conversation',
      emptyState: "You don't have any saved conversations yet.",
      startConversation: 'Start a conversation', loadError: 'Could not load the conversations.',
      loadDetailError: 'Could not load the conversation.',
      deleteConfirm: 'Delete the conversation "{title}"? This action cannot be undone.',
      deleteSuccess: 'Conversation deleted', deleteError: 'Could not delete the conversation',
      sidebarSubtitle: 'Previous queries made to the AI', sidebarEmpty: 'No saved conversations.',
      sidebarEmptyHint: 'Start a new one to see it here.', loadSessionsError: 'Could not load the history.'
    },
    docChat: {
      title: 'DocChat AI', subtitle: 'Ask the technical assistant in real time',
      activeConversation: 'Active conversation', newConversation: '+ New conversation',
      emptyState: 'Start the conversation by typing your first question.',
      inputPlaceholder: 'Type your question... (Enter to send, Shift+Enter for a new line)',
      unknownError: 'Unknown error', connectionError: 'Could not connect to the assistant.',
      deleteError: 'Could not delete the conversation.'
    }
  }
};

export type TranslationTree = typeof translations['es'];
