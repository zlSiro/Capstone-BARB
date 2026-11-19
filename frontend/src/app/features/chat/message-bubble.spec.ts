import { TestBed } from '@angular/core/testing';
import { provideMarkdown } from 'ngx-markdown';
import { describe, expect, it } from 'vitest';
import { MessageBubbleComponent } from './message-bubble.component';
import { ChatMessage } from '../../core/models/chat.model';

describe('MessageBubbleComponent', () => {
  it('renderiza badges de estado y prioridad con colores de OT en mensaje del asistente', async () => {
    TestBed.configureTestingModule({
      providers: [provideMarkdown()],
    });
    const fixture = TestBed.createComponent(MessageBubbleComponent);
    const content = `OT creada: **OT-IA-20261119-123456-ABCD**
- Equipo: Chancador Primario (CHA-001) — Chancado Primario
- Problema: Ruido metálico persistente
- Tipo: correctivo · Prioridad: Alta
- Estado: Pendiente · Asignada a: Juan Pérez
Puedes verla en el tablero de órdenes de trabajo.`;

    const message: ChatMessage = {
      id: 'msg-1',
      role: 'assistant',
      content,
      createdAt: new Date(),
    };
    fixture.componentRef.setInput('message', message);
    fixture.detectChanges();
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    // Prioridad Alta badge: bg-alerta-suave text-alerta
    expect(element.innerHTML).toContain('bg-alerta-suave text-alerta');
    expect(element.innerHTML).toContain('Alta');
    // Estado Pendiente badge: bg-media-suave text-media
    expect(element.innerHTML).toContain('bg-media-suave text-media');
    expect(element.innerHTML).toContain('bg-media');
    expect(element.innerHTML).toContain('Pendiente');
  });

  it('renderiza tablas markdown con badges en columnas de Estado y Prioridad', async () => {
    TestBed.configureTestingModule({
      providers: [provideMarkdown()],
    });
    const fixture = TestBed.createComponent(MessageBubbleComponent);
    const tableMarkdown = `
| N° OT | Estado | Prioridad | Fecha de creación |
|---|---|---|---|
| OT-001 | Pendiente | Media | 2026-11-19 |
| OT-002 | in_progress | urgent | 2026-11-19 |
`;
    const message: ChatMessage = {
      id: 'msg-2',
      role: 'assistant',
      content: tableMarkdown,
      createdAt: new Date(),
    };
    fixture.componentRef.setInput('message', message);
    fixture.detectChanges();
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.innerHTML).toContain('<table>');
    // Pendiente y Media
    expect(element.innerHTML).toContain('bg-media-suave text-media');
    expect(element.innerHTML).toContain('bg-accion-suave text-accion');
    // in_progress (En curso) y urgent (Urgente)
    expect(element.innerHTML).toContain('bg-peligro-suave text-peligro');
  });

  it('renderiza mensajes de usuario sin markdown ni badges', async () => {
    TestBed.configureTestingModule({
      providers: [provideMarkdown()],
    });
    const fixture = TestBed.createComponent(MessageBubbleComponent);
    const message: ChatMessage = {
      id: 'msg-3',
      role: 'user',
      content: '¿Cuál es el estado de las OTs?',
      createdAt: new Date(),
    };
    fixture.componentRef.setInput('message', message);
    fixture.detectChanges();
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('¿Cuál es el estado de las OTs?');
    expect(element.querySelector('markdown')).toBeNull();
  });
});
