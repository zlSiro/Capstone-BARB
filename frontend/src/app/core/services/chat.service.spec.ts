import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideRouter } from '@angular/router';
import type { Observable } from 'rxjs';

import { ChatService } from './chat.service';
import type { ChatStreamEvent } from '../models/chat.model';

/**
 * HU-03/HU-05: el chat textual y el multimodal comparten postSse (mismo parser
 * SSE y mismo manejo de 401). Estos tests blindan el endpoint correcto, el body
 * (image_base64 / empresa_id del super_usuario) y el parseo de eventos.
 * Contrato multimodal: docs/contrato_api_chat_multimedia.md (CGBIDA-276).
 */

const originalFetch = globalThis.fetch;

/** Respuesta SSE real (stream) con los bloques dados. */
function sseResponse(blocks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const block of blocks) controller.enqueue(encoder.encode(block));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } });
}

describe('ChatService (streams SSE)', () => {
  let service: ChatService;
  let calls: Array<{ url: string; init?: RequestInit }>;

  /** Stub de fetch que graba la llamada y responde con los bloques SSE dados. */
  function mockFetch(blocks: string[], status = 200): void {
    calls = [];
    globalThis.fetch = async (input: string | URL | RequestInfo, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return sseResponse(blocks, status);
    };
  }

  /** Instancia el service con el usuario del localStorage (como AuthService lo carga). */
  function makeService(resetInjector = false): ChatService {
    if (resetInjector) TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideRouter([])],
    });
    return TestBed.inject(ChatService);
  }

  /** Collecta los eventos del observable hasta que completa o falla. */
  function collectStream(obs: Observable<ChatStreamEvent>) {
    const events: ChatStreamEvent[] = [];
    let streamError: Error | undefined;
    let resolveDone!: () => void;
    const done = new Promise<void>((resolve) => (resolveDone = resolve));
    obs.subscribe({
      next: (e) => events.push(e),
      error: (err) => {
        streamError = err;
        resolveDone();
      },
      complete: () => resolveDone(),
    });
    return { events, error: () => streamError, done };
  }

  beforeEach(() => {
    localStorage.setItem('barb_token', 'token-de-prueba');
    localStorage.removeItem('barb_user');
    localStorage.removeItem('barb_tenant_empresa_id');
    calls = [];
    service = makeService();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('streamChat pide POST /chat/stream con el token y parsea los eventos SSE', async () => {
    mockFetch([
      'event: session\ndata: {"session_id": "abc-123"}\n\n',
      'event: token\ndata: {"text": "Hola"}\n\n',
      'event: token\ndata: {"text": " mundo"}\n\n',
      'event: done\ndata: {}\n\n',
    ]);

    const result = collectStream(service.streamChat({ session_id: null, message: 'hola' }));
    await result.done;

    expect(calls[0].url).toContain('/api/chat/stream');
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer token-de-prueba');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      session_id: null,
      message: 'hola',
    });

    expect(result.events.map((e) => e.type)).toEqual(['session', 'token', 'token', 'done']);
    expect(result.error()).toBeUndefined();
  });

  it('streamMultimedia pide POST /chat/multimedia con image_base64 en el body', async () => {
    mockFetch([
      'event: session\ndata: {"session_id": "sid-mm"}\n\n',
      'event: token\ndata: {"text": "Veo una bomba"}\n\n',
      'event: done\ndata: {}\n\n',
    ]);

    const result = collectStream(
      service.streamMultimedia({
        session_id: null,
        message: '¿Qué le pasa a esta bomba?',
        image_base64: 'data:image/png;base64,QQ==',
      }),
    );
    await result.done;

    expect(calls[0].url).toContain('/api/chat/multimedia');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      session_id: null,
      message: '¿Qué le pasa a esta bomba?',
      image_base64: 'data:image/png;base64,QQ==',
    });
    expect(result.events.map((e) => e.type)).toEqual(['session', 'token', 'done']);
    expect(result.events[1].type === 'token' && result.events[1].data.text).toBe('Veo una bomba');
  });

  it('streamMultimedia traduce el 503 del backend (feature apagada)', async () => {
    mockFetch([], 503);

    const result = collectStream(
      service.streamMultimedia({
        session_id: null,
        message: '¿Qué ves?',
        image_base64: 'data:image/png;base64,QQ==',
      }),
    );
    await result.done;

    expect(result.error()?.message).toContain('no está disponible');
  });

  it('super_usuario con empresa activa envía empresa_id en el body', async () => {
    localStorage.setItem(
      'barb_user',
      JSON.stringify({ id: 9, name: 'Super', role: 'super_usuario', empresa_id: null }),
    );
    localStorage.setItem('barb_tenant_empresa_id', '3');
    const svcSuper = makeService(true);

    mockFetch(['event: done\ndata: {}\n\n']);
    const result = collectStream(
      svcSuper.streamMultimedia({
        session_id: null,
        message: '¿Qué ves?',
        image_base64: 'data:image/png;base64,QQ==',
      }),
    );
    await result.done;

    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.empresa_id).toBe(3);
  });

  it('super_usuario sin empresa elegida falla antes de llamar al backend', async () => {
    localStorage.setItem(
      'barb_user',
      JSON.stringify({ id: 9, name: 'Super', role: 'super_usuario', empresa_id: null }),
    );
    const svcSuper = makeService(true);

    mockFetch(['event: done\ndata: {}\n\n']);
    const result = collectStream(
      svcSuper.streamMultimedia({
        session_id: null,
        message: '¿Qué ves?',
        image_base64: 'data:image/png;base64,QQ==',
      }),
    );
    await result.done;

    expect(result.error()?.message).toContain('Selecciona una empresa');
    expect(calls.length).toBe(0);
  });
});
