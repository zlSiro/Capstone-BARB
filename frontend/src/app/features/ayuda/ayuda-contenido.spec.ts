import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { translations } from '../../core/i18n/translations';
import { ROLES, puedeAccederRuta, puedeEjecutarAccion } from '../../core/permissions/permissions';
import { AuthService } from '../../core/services/auth.service';
import { NAV_ITEMS } from '../../shared/components/layout/nav-items';
import { PRIMEROS_PASOS, RECORRIDOS, TAREAS, Requisito, claveRecorrido, claveTarea } from './ayuda-contenido';
import { AyudaService } from './ayuda.service';

function servicio(role: string) {
  TestBed.configureTestingModule({
    providers: [{ provide: AuthService, useValue: { user: signal({ id: 1, name: 'Ana', role }), privilegiosPendientes: signal(false) } }],
  });
  return TestBed.inject(AyudaService);
}

/** El requisito se mide contra `permissions.ts` directamente (la fuente de verdad), no contra el servicio que se prueba. */
const cumple = (role: string, req: Requisito | undefined): boolean =>
  !req || ((!req.ruta || puedeAccederRuta(role as never, req.ruta)) && (!req.accion || puedeEjecutarAccion(role as never, req.accion)));

/** Tareas esperadas por perfil (tabla del pedido; «Asignar una OT» no existe aún en el frontend). */
const ESPERADAS: Record<string, string[]> = {
  operador: ['privilegios', 'reportar_falla', 'seguir_aviso', 'ver_ot_generada', 'docchat'],
  tecnico: ['privilegios', 'reportar_falla', 'iniciar_ot', 'enviar_validacion', 'docchat'],
  supervisor: ['revisar_avisos', 'generar_ot', 'validar_devolver', 'salud'],
  engineer: ['dash_operativo', 'top5', 'subir_documento', 'reportar_falla', 'docchat'],
  gerente: ['dashboard_completo', 'costo_maquina', 'crear_administrador', 'bitacora', 'revisar_avisos'],
  admin: ['crear_usuario_operativo', 'registrar_planta', 'disciplinas', 'subir_documento', 'consultar_ot'],
  super_usuario: ['crear_empresa', 'crear_gerente', 'suspender', 'mis_transacciones'],
};

describe('Ayuda: filtrado por perfil', () => {
  it('hay primeros pasos definidos para los 7 perfiles', () => {
    expect(Object.keys(PRIMEROS_PASOS).sort()).toEqual([...ROLES].sort());
  });

  it.each(ROLES)('%s: ninguna tarea ni recorrido requiere una ruta o acción que el rol no tiene', (role) => {
    const svc = servicio(role);
    for (const t of svc.tareas()) expect(cumple(role, t.def.requiere), `tarea ${t.def.id}`).toBe(true);
    for (const r of svc.recorridos()) expect(cumple(role, r.requiere), `recorrido ${r.id}`).toBe(true);
    // Y cada tarea que se muestra con «Mostrarme cómo» tiene su recorrido disponible para ese rol.
    for (const t of svc.tareas().filter((x) => x.def.recorrido)) {
      expect(svc.recorridos().some((r) => r.id === t.def.recorrido), `${t.def.id} -> ${t.def.recorrido}`).toBe(true);
    }
  });

  it.each(ROLES)('%s: ve exactamente sus primeros pasos', (role) => {
    expect(servicio(role).tareas().map((t) => t.def.id)).toEqual(ESPERADAS[role]);
  });

  it('un perfil sin la acción no ve la tarea: el gerente no genera OT, el técnico no crea empresas', () => {
    expect(servicio('gerente').recorridos().map((r) => r.id)).not.toContain('generar_ot');
    TestBed.resetTestingModule();
    expect(servicio('tecnico').recorridos().map((r) => r.id)).not.toContain('crear_empresa');
  });

  it('el costo solo lo ven quienes tienen ver_kpis_financieros (gerente), aunque otros vean el dashboard', () => {
    const conCosto = ROLES.filter((r) => {
      TestBed.resetTestingModule();
      return servicio(r).recorridos().some((x) => x.id === 'costo_maquina');
    });
    expect(conCosto).toEqual(['gerente']);
  });

  it('el superusuario no ve nada de DocChat', () => {
    const svc = servicio('super_usuario');
    expect(svc.recorridos().map((r) => r.id)).not.toContain('docchat');
    expect(svc.tareas().map((t) => t.def.id)).not.toContain('docchat');
  });

  it('cada recorrido y tarea declara qué necesita (nada queda visible para todos por descuido)', () => {
    for (const r of RECORRIDOS) expect(r.requiere.ruta ?? r.requiere.accion, r.id).toBeDefined();
    for (const t of Object.values(TAREAS)) expect(t.automatica ?? t.requiere, t.id).toBeDefined();
  });

  it('«Ir a…» solo se ofrece si el perfil puede entrar a esa pantalla', () => {
    const rutasDelMenu = NAV_ITEMS.map((i) => i.path);
    for (const r of RECORRIDOS.filter((x) => x.pantalla)) expect(rutasDelMenu, r.id).toContain(r.pantalla);
    expect(servicio('operador').pantalla('/dashboard')).toBeNull();
    TestBed.resetTestingModule();
    expect(servicio('gerente').pantalla('/dashboard')).toEqual({ path: '/dashboard', nav: 'nav.dashboard' });
  });
});

describe('Ayuda: textos', () => {
  const es = (translations.es as unknown as { ayuda: Record<string, string> }).ayuda;
  const en = (translations.en as unknown as { ayuda: Record<string, string> }).ayuda;
  const sinPrefijo = (k: string) => k.replace(/^ayuda\./, '');

  const clavesEsperadas = (): string[] => {
    const claves: string[] = [];
    for (const t of Object.values(TAREAS)) claves.push(claveTarea(t.id, 'titulo'), claveTarea(t.id, 'desc'));
    for (const r of RECORRIDOS) {
      claves.push(claveRecorrido(r.id, 'titulo'), claveRecorrido(r.id, 'resumen'), claveRecorrido(r.id, 'claves'));
      r.pasos.forEach((_, i) => claves.push(claveRecorrido(r.id, `p${i + 1}_titulo`), claveRecorrido(r.id, `p${i + 1}_texto`)));
    }
    return claves.map(sinPrefijo);
  };

  it('cada tarea, recorrido y paso tiene su texto en español y en inglés (no vacío)', () => {
    for (const clave of clavesEsperadas()) {
      expect(es[clave], `es ${clave}`).toBeTruthy();
      expect(en[clave], `en ${clave}`).toBeTruthy();
    }
  });

  it('los textos de pasos coinciden con los pasos declarados (ni faltan ni sobran)', () => {
    for (const r of RECORRIDOS) {
      const n = r.pasos.length;
      const textos = Object.keys(es).filter((k) => k.startsWith(`r_${r.id}_p`));
      expect(textos.length, r.id).toBe(n * 2);
      expect(es[`r_${r.id}_p${n + 1}_titulo`], `${r.id} tiene un paso de más en el texto`).toBeUndefined();
    }
  });

  it('español e inglés tienen exactamente las mismas claves', () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(es).sort());
  });

  it('cada recorrido tiene palabras clave en ambos idiomas para la búsqueda', () => {
    for (const r of RECORRIDOS) {
      expect(es[`r_${r.id}_claves`].split(',').length, `es ${r.id}`).toBeGreaterThan(3);
      expect(en[`r_${r.id}_claves`].split(',').length, `en ${r.id}`).toBeGreaterThan(3);
    }
  });
});

describe('Ayuda: cada data-tour que usa un recorrido existe en su componente', () => {
  const RAIZ = join(process.cwd(), 'src', 'app');

  const archivos = (dir: string): string[] =>
    readdirSync(dir).flatMap((nombre) => {
      const ruta = join(dir, nombre);
      if (statSync(ruta).isDirectory()) return archivos(ruta);
      return /\.(ts|html)$/.test(nombre) && !/\.spec\.ts$/.test(nombre) ? [ruta] : [];
    });

  const marcas = new Map<string, string[]>();
  for (const archivo of archivos(RAIZ)) {
    const texto = readFileSync(archivo, 'utf-8');
    // Literal (`data-tour="x"`) o condicional (`[attr.data-tour]="cond ? 'x' : null"`).
    const encontradas = [...texto.matchAll(/ data-tour="([a-z0-9-]+)"/g), ...texto.matchAll(/\[attr\.data-tour\]="[^"]*\?\s*'([a-z0-9-]+)'/g)];
    for (const m of encontradas) marcas.set(m[1], [...(marcas.get(m[1]) ?? []), archivo]);
  }

  const objetivos = [...new Set(RECORRIDOS.flatMap((r) => r.pasos.map((p) => p.objetivo).filter((o): o is string => !!o)))];

  it.each(objetivos)('data-tour="%s" está en la plantilla de algún componente', (objetivo) => {
    expect(marcas.has(objetivo), `falta data-tour="${objetivo}" (¿cambió la interfaz?)`).toBe(true);
  });

  it('no quedan marcas data-tour huérfanas que ningún recorrido use', () => {
    const usadas = new Set(objetivos);
    const huerfanas = [...marcas.keys()].filter((m) => !usadas.has(m));
    expect(huerfanas).toEqual([]);
  });
});
