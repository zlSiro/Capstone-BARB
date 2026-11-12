import { describe, expect, it } from 'vitest';

import { translations } from '../../core/i18n/translations';
import { puedeAccederRuta, puedeEjecutarAccion } from '../../core/permissions/permissions';
import { GuiaBusqueda, PUNTAJE_MINIMO, buscarGuia, normalizar, puntuar } from './ayuda-buscador';
import { RECORRIDOS, claveRecorrido } from './ayuda-contenido';

/** Guías del perfil en el idioma pedido, armadas igual que `AyudaService.guias` pero sin Angular. */
function guiasDe(role: string, lang: 'es' | 'en'): GuiaBusqueda[] {
  const textos = (translations[lang] as unknown as { ayuda: Record<string, string> }).ayuda;
  const t = (clave: string) => textos[clave.replace(/^ayuda\./, '')];
  return RECORRIDOS.filter(
    (r) =>
      (!r.requiere.ruta || puedeAccederRuta(role as never, r.requiere.ruta)) &&
      (!r.requiere.accion || puedeEjecutarAccion(role as never, r.requiere.accion)),
  ).map((r) => ({ id: r.id, titulo: t(claveRecorrido(r.id, 'titulo')), claves: t(claveRecorrido(r.id, 'claves')) }));
}

const mejor = (pregunta: string, role: string, lang: 'es' | 'en' = 'es') => buscarGuia(pregunta, guiasDe(role, lang), lang)?.guia.id ?? null;

describe('normalizar', () => {
  it('pasa a minúsculas, quita tildes y signos', () => {
    expect(normalizar('¿Cómo DEVUELVO una OT al técnico?')).toBe('como devuelvo una ot al tecnico');
    expect(normalizar('  Validación,   revisión.  ')).toBe('validacion revision');
  });
});

describe('Pregúntale a la ayuda: búsqueda local en español', () => {
  it('la pregunta del ejemplo del supervisor encuentra «Validar o devolver una OT»', () => {
    expect(mejor('¿Cómo devuelvo una OT al técnico?', 'supervisor')).toBe('validar_devolver');
  });

  it('sinónimo de planta: «cerrar» = «validar» y «ticket» = «OT»', () => {
    expect(mejor('quiero cerrar un ticket', 'supervisor')).toBe('validar_devolver');
    expect(mejor('validar una orden', 'supervisor')).toBe('validar_devolver');
  });

  it('el técnico, con la misma idea, cae en su recorrido de iniciar y enviar a validación', () => {
    expect(mejor('¿Cómo envío una OT a validación?', 'tecnico')).toBe('iniciar_enviar');
    expect(mejor('cerrar el ticket cuando termino', 'tecnico')).toBe('iniciar_enviar');
  });

  it('no distingue mayúsculas ni tildes', () => {
    expect(mejor('VALIDACION DE UNA OT', 'tecnico')).toBe('iniciar_enviar');
    expect(mejor('validación de una ot', 'tecnico')).toBe('iniciar_enviar');
  });

  it.each([
    ['qué significa el color de la salud operacional', 'gerente', 'salud_operacional'],
    ['cómo reporto una falla con foto', 'operador', 'reportar_falla'],
    ['dónde subo un documento técnico', 'engineer', 'subir_documento'],
    ['cómo suspendo una empresa', 'super_usuario', 'suspender_empresa'],
    ['cómo creo un usuario nuevo', 'admin', 'crear_usuario'],
    ['ver la bitácora de mi empresa', 'gerente', 'bitacora'],
    ['cuánto cuesta cada máquina', 'gerente', 'costo_maquina'],
    ['buscar un manual', 'operador', 'docchat'],
  ])('«%s» (%s) → %s', (pregunta, rol, esperado) => {
    expect(mejor(pregunta, rol)).toBe(esperado);
  });

  it('solo responde con guías del perfil: el operador no recibe la de validar OT', () => {
    expect(mejor('¿Cómo devuelvo una OT al técnico?', 'operador')).not.toBe('validar_devolver');
    expect(mejor('cómo creo una empresa', 'tecnico')).toBeNull();
  });

  it('el superusuario no recibe guías de DocChat', () => {
    expect(mejor('buscar un manual en docchat', 'super_usuario')).toBeNull();
  });
});

describe('Pregúntale a la ayuda: búsqueda local en inglés', () => {
  it.each([
    ['how do I send a work order back to the technician', 'supervisor', 'validar_devolver'],
    ['I want to close a ticket', 'supervisor', 'validar_devolver'],
    ['what does the traffic light color mean', 'gerente', 'salud_operacional'],
    ['how do I report a failure with a photo', 'operador', 'reportar_falla'],
    ['send my work order for validation', 'tecnico', 'iniciar_enviar'],
  ] as const)('«%s» (%s) → %s', (pregunta, rol, esperado) => {
    expect(mejor(pregunta, rol, 'en')).toBe(esperado);
  });

  it('busca en el idioma activo: una pregunta en español no encuentra guías en inglés', () => {
    expect(mejor('¿Cómo devuelvo una OT al técnico?', 'supervisor', 'en')).toBeNull();
  });
});

describe('Pregúntale a la ayuda: cuando no hay respuesta', () => {
  it.each(['receta de cocina', 'qué hora es', '   ', '', '¿¿??', 'la el de'])('«%s» no coincide con ninguna guía', (pregunta) => {
    expect(mejor(pregunta, 'supervisor')).toBeNull();
  });

  it('una palabra genérica («OT») por sí sola no basta para responder', () => {
    expect(mejor('ot', 'supervisor')).toBeNull();
    expect(puntuar('ot', guiasDe('supervisor', 'es')[0], 'es')).toBeLessThan(PUNTAJE_MINIMO);
  });

  it('en empate gana la primera guía de la lista (resultado estable)', () => {
    const iguales: GuiaBusqueda[] = [
      { id: 'a', titulo: 'Guía uno', claves: 'zorro, lobo' },
      { id: 'b', titulo: 'Guía dos', claves: 'zorro, lobo' },
    ];
    expect(buscarGuia('zorro y lobo', iguales, 'es')?.guia.id).toBe('a');
  });

  it('devuelve el puntaje que justifica la guía elegida', () => {
    const r = buscarGuia('¿Cómo devuelvo una OT al técnico?', guiasDe('supervisor', 'es'), 'es')!;
    expect(r.puntaje).toBeGreaterThanOrEqual(PUNTAJE_MINIMO);
  });
});
