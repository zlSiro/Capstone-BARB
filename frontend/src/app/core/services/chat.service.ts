// frontend/src/app/core/services/chat.service.ts

import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import {
  ChatRequest,
  DeleteSessionResponse,
  SessionDetailResponse,
  SessionListResponse,
} from '../models/chat.model';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';
import { I18nService } from '../i18n/i18n.service';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly i18n = inject(I18nService);
  private readonly baseUrl = `${environment.apiUrl}/chat`;

  // ---------------------------------------------------------------------------
  // Chat en streaming (HU-03)
  // ---------------------------------------------------------------------------

  streamChat(payload: ChatRequest): Observable<{ type: string; data: any }> {
    return new Observable((subscriber) => {
      const controller = new AbortController();
      const token = localStorage.getItem('barb_token');

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;

      fetch(`${this.baseUrl}/stream`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (response.status === 401) {
            // El stream usa fetch nativo (no pasa por authInterceptor):
            // mismo manejo de sesión expirada → logout + redirect a /login.
            this.toast.show(this.i18n.t('common').sessionExpired, 'error');
            this.auth.logout();
            subscriber.error(new Error('Sesión expirada. Vuelve a iniciar sesión.'));
            return;
          }
          if (response.status === 429) {
            subscriber.error(new Error('Demasiadas peticiones. Espera un momento.'));
            return;
          }
          if (response.status === 422) {
            subscriber.error(new Error('Mensaje inválido (vacío o demasiado largo).'));
            return;
          }
          if (!response.ok) {
            subscriber.error(new Error(`HTTP ${response.status}`));
            return;
          }

          const reader = response.body?.getReader();
          if (!reader) {
            subscriber.error(new Error('No response body'));
            return;
          }

          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder
              .decode(value, { stream: true })
              .replace(/\r\n/g, '\n');

            let separatorIdx: number;
            while ((separatorIdx = buffer.indexOf('\n\n')) !== -1) {
              const block = buffer.slice(0, separatorIdx);
              buffer = buffer.slice(separatorIdx + 2);

              const parsed = this.parseSseEvent(block);
              if (parsed) subscriber.next(parsed);
            }
          }

          subscriber.complete();
        })
        .catch((err) => {
          if (err.name !== 'AbortError') subscriber.error(err);
        });

      return () => controller.abort();
    });
  }

  private parseSseEvent(raw: string): { type: string; data: any } | null {
    const lines = raw.split('\n');
    let eventType = 'message';
    let dataLine = '';

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        dataLine = line.slice(5).trim();
      }
    }

    if (!dataLine) return null;

    try {
      return { type: eventType, data: JSON.parse(dataLine) };
    } catch (e) {
      console.warn('[ChatService] No se pudo parsear el evento SSE:', raw, e);
      return null;
    }
  }

  // ---------------------------------------------------------------------------
  // Historial de conversaciones (CGBIDA-254/255/256)
  // ---------------------------------------------------------------------------

  listSessions(limit = 20, offset = 0): Observable<SessionListResponse> {
    const params = new HttpParams()
      .set('limit', String(limit))
      .set('offset', String(offset));
    return this.http.get<SessionListResponse>(`${this.baseUrl}/sessions`, { params });
  }

  getSession(sessionId: string): Observable<SessionDetailResponse> {
    return this.http.get<SessionDetailResponse>(
      `${this.baseUrl}/sessions/${sessionId}`,
    );
  }

  deleteSession(sessionId: string): Observable<DeleteSessionResponse> {
    return this.http.delete<DeleteSessionResponse>(
      `${this.baseUrl}/sessions/${sessionId}`,
    );
  }
}
