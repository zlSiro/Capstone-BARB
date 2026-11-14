import { TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { of } from 'rxjs';
import { provideMarkdown } from 'ngx-markdown';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ChatStreamEvent, SessionDetailResponse } from '../../core/models/chat.model';
import { CatalogService } from '../../core/services/catalog.service';
import { ChatService } from '../../core/services/chat.service';
import { DocChatComponent } from './doc-chat.component';

const SESION = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

const MAQUINAS = [
  { id: 5, name: 'Compressor A1', codigo: 'COMP-A1', discipline_id: 1, plant_id: 1 },
  { id: 6, name: 'Pump E4', codigo: 'PUMP-E4', discipline_id: 1, plant_id: 1 },
];

const EVENTOS: ChatStreamEvent[] = [
  { type: 'session', data: { session_id: SESION } },
  { type: 'token', data: { text: 'ok' } },
  { type: 'done', data: {} },
];

describe('DocChat: máquina de la conversación (HU-23)', () => {
  let chat: {
    listSessions: ReturnType<typeof vi.fn>;
    getSession: ReturnType<typeof vi.fn>;
    streamChat: ReturnType<typeof vi.fn>;
    streamMultimedia: ReturnType<typeof vi.fn>;
  };

  function setup() {
    chat = {
      listSessions: vi.fn(() => of({ sessions: [], total: 0 })),
      getSession: vi.fn(),
      streamChat: vi.fn(() => of(...EVENTOS)),
      streamMultimedia: vi.fn(() => of(...EVENTOS)),
    };
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideMarkdown(),
        { provide: ChatService, useValue: chat },
        {
          provide: CatalogService,
          useValue: { getMachines: () => of(MAQUINAS), getPlants: () => of([{ id: 1, name: 'Planta Central' }]) },
        },
        { provide: ActivatedRoute, useValue: { queryParams: of({}) } },
      ],
    });
    const fixture = TestBed.createComponent(DocChatComponent);
    fixture.detectChanges();
    return { fixture, c: fixture.componentInstance, el: fixture.nativeElement as HTMLElement };
  }

  function enviar(c: DocChatComponent, texto = 'hola') {
    c.inputText.set(texto);
    c.sendMessage();
  }

  const detalle = (parcial: Partial<SessionDetailResponse> = {}): SessionDetailResponse => ({
    session_id: SESION,
    titulo: 'Diagnóstico',
    saved_at: '2026-11-10T10:00:00Z',
    messages: [
      { role: 'user', content: '¿qué le pasa?', timestamp: 1, has_image: true },
      { role: 'assistant', content: 'parece una fuga', timestamp: 2 },
    ],
    maquina_id: null,
    machine_name: null,
    ...parcial,
  });

  beforeEach(() => {
    TestBed.resetTestingModule();
    // jsdom no implementa Element.scrollTo, que el chat usa para bajar al último mensaje.
    Element.prototype.scrollTo = vi.fn();
  });

  it('el selector aparece en el chat con el catálogo cargado', () => {
    const { el } = setup();

    expect(el.querySelector('app-maquina-selector')).not.toBeNull();
    expect(el.querySelector<HTMLInputElement>('[data-testid="maquina-input"]')?.labels?.[0]?.textContent).toContain(
      'Equipo',
    );
  });

  it('sin elegir máquina el request no lleva maquina_id', () => {
    const { c } = setup();

    enviar(c);

    expect(chat.streamChat).toHaveBeenCalledTimes(1);
    expect('maquina_id' in chat.streamChat.mock.calls[0][0]).toBe(false);
  });

  it('con máquina elegida, el primer mensaje la envía y los siguientes no', () => {
    const { c } = setup();
    c.maquinaId.set(5);

    enviar(c, 'primero');
    enviar(c, 'segundo');

    expect(chat.streamChat.mock.calls[0][0].maquina_id).toBe(5);
    expect('maquina_id' in chat.streamChat.mock.calls[1][0]).toBe(false);
    expect(chat.streamChat.mock.calls[1][0].session_id).toBe(SESION);
  });

  it('cambiar de máquina a mitad de la conversación la vuelve a enviar una vez', () => {
    const { c } = setup();
    c.maquinaId.set(5);
    enviar(c, 'uno');

    c.maquinaId.set(6);
    enviar(c, 'dos');
    enviar(c, 'tres');

    expect(chat.streamChat.mock.calls[1][0].maquina_id).toBe(6);
    expect('maquina_id' in chat.streamChat.mock.calls[2][0]).toBe(false);
  });

  it('elegir «Sin máquina» en una sesión con máquina envía null para desvincular', () => {
    const { c } = setup();
    c.maquinaId.set(5);
    enviar(c, 'uno');

    c.maquinaId.set(null);
    enviar(c, 'dos');

    expect(chat.streamChat.mock.calls[1][0].maquina_id).toBeNull();
  });

  it('el turno con imagen también envía la máquina (texto e imagen comparten selector)', () => {
    const { c } = setup();
    c.maquinaId.set(5);
    c.attachedImage.set('data:image/png;base64,QQ==');

    enviar(c, '¿qué es esto?');

    expect(chat.streamMultimedia).toHaveBeenCalledTimes(1);
    expect(chat.streamMultimedia.mock.calls[0][0].maquina_id).toBe(5);
    expect(chat.streamChat).not.toHaveBeenCalled();
  });

  it('al abrir una conversación del historial restaura la máquina y no la reenvía', () => {
    const { fixture, c } = setup();
    chat.getSession.mockReturnValue(of(detalle({ maquina_id: 6, machine_name: 'Pump E4' })));

    c.loadConversation(SESION);
    fixture.detectChanges();

    expect(c.maquinaId()).toBe(6);
    const input = fixture.nativeElement.querySelector('[data-testid="maquina-input"]') as HTMLInputElement;
    expect(input.value).toBe('Pump E4 (PUMP-E4)');

    enviar(c, 'seguimiento');
    expect('maquina_id' in chat.streamChat.mock.calls[0][0]).toBe(false);
  });

  it('una conversación del historial sin máquina deja el selector vacío', () => {
    const { c } = setup();
    c.maquinaId.set(5);
    chat.getSession.mockReturnValue(of(detalle()));

    c.loadConversation(SESION);

    expect(c.maquinaId()).toBeNull();
  });

  it('desde el historial, elegir una máquina nueva la envía en el siguiente mensaje', () => {
    const { c } = setup();
    chat.getSession.mockReturnValue(of(detalle({ maquina_id: 6 })));
    c.loadConversation(SESION);

    c.maquinaId.set(5);
    enviar(c, 'cambio');

    expect(chat.streamChat.mock.calls[0][0].maquina_id).toBe(5);
  });

  it('una conversación nueva limpia el selector y no arrastra la máquina anterior', () => {
    const { c } = setup();
    c.maquinaId.set(5);
    enviar(c, 'uno');

    c.newConversation();
    enviar(c, 'otra');

    expect(c.maquinaId()).toBeNull();
    expect('maquina_id' in chat.streamChat.mock.calls[1][0]).toBe(false);
    expect(chat.streamChat.mock.calls[1][0].session_id).toBeNull();
  });

  it('el mensaje con imagen del historial muestra el indicador (sin imagen)', () => {
    const { fixture, el, c } = setup();
    chat.getSession.mockReturnValue(of(detalle()));

    c.loadConversation(SESION);
    fixture.detectChanges();

    const indicadores = el.querySelectorAll('[data-testid="burbuja-imagen-enviada"]');
    expect(indicadores).toHaveLength(1);
    expect(indicadores[0].textContent).toContain('Imagen enviada');
    expect(el.querySelectorAll('img[src^="data:"]')).toHaveLength(0);
  });
});
