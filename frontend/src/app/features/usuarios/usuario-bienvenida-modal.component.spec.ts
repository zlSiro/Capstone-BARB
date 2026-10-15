import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BienvenidaUsuario, UsuarioBienvenidaModalComponent } from './usuario-bienvenida-modal.component';

const DATOS: BienvenidaUsuario = {
  nombre: 'Ana Pérez',
  rol: 'Gerente',
  fecha: '2026-10-14T15:30:00',
  password: 'secreto123',
  creadorNombre: 'Super BARB',
  creadorEmail: 'super@barb.com',
};

function crear(datos = DATOS) {
  const fixture = TestBed.createComponent(UsuarioBienvenidaModalComponent);
  fixture.componentRef.setInput('datos', datos);
  fixture.detectChanges();
  return fixture;
}

describe('UsuarioBienvenidaModalComponent', () => {
  afterEach(() => vi.restoreAllMocks());

  it('arma el mensaje con el formato acordado', () => {
    const fixture = crear();
    expect(fixture.componentInstance.mensaje()).toBe(
      [
        'Estimado(a) Ana Pérez',
        'Informamos que con fecha 14-10-2026 15:30, hemos habilitado su usuario para poder operar en BARB con rol Gerente.',
        'Su contraseña es secreto123.',
        '',
        'Cualquier duda, favor comunicarse con Super BARB al correo super@barb.com',
      ].join('\n'),
    );
    const area = (fixture.nativeElement as HTMLElement).querySelector<HTMLTextAreaElement>('[data-testid="bienvenida-texto"]');
    expect(area?.value).toContain('Su contraseña es secreto123.');
  });

  it('copia el mensaje al portapapeles', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    const fixture = crear();
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="bienvenida-copiar"]')!.click();
    await fixture.whenStable();
    expect(writeText).toHaveBeenCalledWith(fixture.componentInstance.mensaje());
    vi.unstubAllGlobals();
  });

  it('avisa al cerrar', () => {
    const fixture = crear();
    const cerrado = vi.fn();
    fixture.componentInstance.closed.subscribe(cerrado);
    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('[data-testid="bienvenida-cerrar"]')!.click();
    expect(cerrado).toHaveBeenCalledOnce();
  });
});
