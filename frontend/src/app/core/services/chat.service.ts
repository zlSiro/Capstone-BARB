// frontend/src/app/core/services/chat.service.ts

import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ChatRequest } from '../models/chat.model';

@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = '/api/chat';

  streamChat(payload: ChatRequest): Observable<{ type: string; data: any }> {
    return new Observable((subscriber) => {
      const controller = new AbortController();

      fetch(`${this.baseUrl}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      })
        .then(async (response) => {
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

            // Normalizar CRLF → LF para que el split funcione siempre
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
}
