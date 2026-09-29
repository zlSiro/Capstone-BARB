// frontend/src/app/features/chat/doc-chat.component.ts

import { Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ChatService } from '../../core/services/chat.service';
import { ChatMessage, SessionListItem } from '../../core/models/chat.model';
import { MessageBubbleComponent } from './message-bubble.component';

@Component({
  selector: 'app-doc-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, MessageBubbleComponent],
  templateUrl: './doc-chat.component.html',
})
export class DocChatComponent {
  private readonly chatService = inject(ChatService);
  private readonly route = inject(ActivatedRoute);

  @ViewChild('messagesContainer') messagesContainer!: ElementRef<HTMLDivElement>;

  // ── Chat state ──
  readonly messages = signal<ChatMessage[]>([]);
  readonly inputText = signal('');
  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly sessionId = signal<string | null>(null);

  // ── Sidebar state ──
  readonly sessions = signal<SessionListItem[]>([]);
  readonly loadingSessions = signal(false);
  readonly sessionError = signal<string | null>(null);

  constructor() {
    this.loadSessions();

    // Si llega ?session_id=XXX desde un bookmark/URL, cargar esa sesión
    this.route.queryParams.subscribe((params) => {
      const sid = params['session_id'];
      if (sid && sid !== this.sessionId()) {
        this.loadConversation(sid);
      }
    });
  }

  // ---------------------------------------------------------------------------
  // Sidebar
  // ---------------------------------------------------------------------------

  loadSessions(): void {
    this.loadingSessions.set(true);
    this.sessionError.set(null);
    this.chatService.listSessions(50, 0).subscribe({
      next: (resp) => {
        this.sessions.set(resp.sessions);
        this.loadingSessions.set(false);
      },
      error: () => {
        this.sessionError.set('No se pudo cargar el historial.');
        this.loadingSessions.set(false);
      },
    });
  }

  selectSession(s: SessionListItem): void {
    if (this.sessionId() === s.session_id) return;
    this.loadConversation(s.session_id);
  }

  loadConversation(sessionId: string): void {
    this.isLoading.set(true);
    this.errorMessage.set(null);
    this.chatService.getSession(sessionId).subscribe({
      next: (detail) => {
        this.messages.set(
          detail.messages.map((m) => ({
            id: crypto.randomUUID(),
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content,
            createdAt: m.timestamp ? new Date(m.timestamp) : new Date(),
          })),
        );
        this.sessionId.set(sessionId);
        this.isLoading.set(false);
        this.scrollToBottom();
      },
      error: () => {
        this.errorMessage.set('No se pudo cargar la conversación.');
        this.isLoading.set(false);
      },
    });
  }

  deleteSession(s: SessionListItem, ev: Event): void {
    ev.stopPropagation();
    const ok = window.confirm(
      `¿Eliminar la conversación "${s.titulo}"? Esta acción no se puede deshacer.`,
    );
    if (!ok) return;

    this.chatService.deleteSession(s.session_id).subscribe({
      next: () => {
        this.sessions.update((list) =>
          list.filter((x) => x.session_id !== s.session_id),
        );
        if (this.sessionId() === s.session_id) {
          this.newConversation();
        }
      },
      error: () => {
        this.errorMessage.set('No se pudo eliminar la conversación.');
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Chat
  // ---------------------------------------------------------------------------

  newConversation(): void {
    this.messages.set([]);
    this.sessionId.set(null);
    this.errorMessage.set(null);
    this.inputText.set('');
  }

  sendMessage(): void {
    const text = this.inputText().trim();
    if (!text || this.isLoading()) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      createdAt: new Date(),
    };
    this.messages.update((m) => [...m, userMsg]);
    this.inputText.set('');
    this.isLoading.set(true);
    this.errorMessage.set(null);

    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      createdAt: new Date(),
    };
    this.messages.update((m) => [...m, assistantMsg]);
    this.scrollToBottom();

    const wasNewSession = this.sessionId() === null;

    this.chatService
      .streamChat({ session_id: this.sessionId(), message: text })
      .subscribe({
        next: (event) => {
          if (event.type === 'session') {
            this.sessionId.set(event.data.session_id);
          } else if (event.type === 'token') {
            this.messages.update((msgs) =>
              msgs.map((m) =>
                m.id === assistantMsg.id
                  ? { ...m, content: m.content + event.data.text }
                  : m,
              ),
            );
            this.scrollToBottom();
          } else if (event.type === 'error') {
            this.errorMessage.set(event.data.message ?? 'Error desconocido');
            this.isLoading.set(false);
          } else if (event.type === 'done') {
            this.isLoading.set(false);
            if (wasNewSession) this.loadSessions();
          }
        },
        error: () => {
          this.errorMessage.set('No se pudo conectar con el asistente.');
          this.isLoading.set(false);
        },
        complete: () => this.isLoading.set(false),
      });
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      this.sendMessage();
    }
  }

  private scrollToBottom(): void {
    setTimeout(() => {
      this.messagesContainer?.nativeElement?.scrollTo({
        top: this.messagesContainer.nativeElement.scrollHeight,
        behavior: 'smooth',
      });
    }, 50);
  }

  formatDate(iso: string): string {
    const d = new Date(iso);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  }
}
