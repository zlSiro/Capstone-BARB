// frontend/src/app/features/chat/doc-chat.component.ts

import { Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { HttpErrorResponse } from '@angular/common/http';
import { ChatService } from '../../core/services/chat.service';
import { TicketsApi } from '../../core/services/tickets-api';
import { ChatMessage, SessionListItem } from '../../core/models/chat.model';
import { MessageBubbleComponent } from './message-bubble.component';
import { ImageAttachmentComponent } from './image-attachment.component';
import { ToastService } from '../../core/services/toast.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { apiErrorMessage } from '../../core/utils/http-error';

@Component({
  selector: 'app-doc-chat',
  imports: [FormsModule, MessageBubbleComponent, ImageAttachmentComponent, TranslatePipe],
  templateUrl: './doc-chat.component.html',
})
export class DocChatComponent {
  private readonly chatService = inject(ChatService);
  private readonly ticketsApi = inject(TicketsApi);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);

  @ViewChild('messagesContainer') messagesContainer!: ElementRef<HTMLDivElement>;

  // ── Chat state ──
  readonly messages = signal<ChatMessage[]>([]);
  readonly inputText = signal('');
  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly sessionId = signal<string | null>(null);

  // ── Imagen adjunta (HU-05) ──
  // Data URL de la imagen lista para analizar; null = sin imagen.
  readonly attachedImage = signal<string | null>(null);

  // ── Sidebar state ──
  readonly sessions = signal<SessionListItem[]>([]);
  readonly loadingSessions = signal(false);
  readonly sessionError = signal<string | null>(null);

  // ── Ticket (HU-06, CGBIDA-289): guardar la conversación activa como ticket ──
  readonly savingTicket = signal(false);

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
        this.sessionError.set(this.i18n.t('chatHistory').loadSessionsError);
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
        this.errorMessage.set(this.i18n.t('chatHistory').loadDetailError);
        this.isLoading.set(false);
      },
    });
  }

  deleteSession(s: SessionListItem, ev: Event): void {
    ev.stopPropagation();
    const ok = window.confirm(
      this.i18n.t('chatHistory').deleteConfirm.replace('{title}', s.titulo),
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
        this.errorMessage.set(this.i18n.t('docChat').deleteError);
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
    this.attachedImage.set(null);
  }

  // ---------------------------------------------------------------------------
  // Ticket conversacional (HU-06, CGBIDA-289): guardar como ticket
  // ---------------------------------------------------------------------------

  /**
   * Promueve la conversación activa a ticket (POST /api/tickets). Si la sesión
   * ya tiene uno (409 con `detail.ticket_id`), lleva al usuario al ticket
   * existente en vez de mostrar un error genérico.
   */
  saveAsTicket(): void {
    const sid = this.sessionId();
    if (!sid || this.savingTicket()) return;
    this.savingTicket.set(true);

    this.ticketsApi.create(sid).subscribe({
      next: (t) => {
        this.savingTicket.set(false);
        this.toast.success(`${this.i18n.t('tickets').savedFromChat} #${t.ticket_id}`);
        void this.router.navigate(['/tickets'], { queryParams: { ticket_id: t.ticket_id } });
      },
      error: (err) => {
        this.savingTicket.set(false);
        if (err instanceof HttpErrorResponse && err.status === 409) {
          // 1:1 (D1): la conversación ya tiene ticket — se navega al existente.
          const detail = (err.error as { detail?: { ticket_id?: number | null } } | null)?.detail;
          this.toast.info(this.i18n.t('tickets').alreadyExists);
          if (detail?.ticket_id) {
            void this.router.navigate(['/tickets'], { queryParams: { ticket_id: detail.ticket_id } });
          }
        } else {
          this.toast.error(apiErrorMessage(err, this.i18n.t('tickets').saveError));
        }
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Imagen adjunta (HU-05, CGBIDA-279)
  // ---------------------------------------------------------------------------

  onImageSelected(dataUrl: string): void {
    this.attachedImage.set(dataUrl);
  }

  onImageError(message: string): void {
    this.toast.show(message, 'error');
  }

  removeAttachedImage(): void {
    this.attachedImage.set(null);
  }

  sendMessage(): void {
    const text = this.inputText().trim();
    const image = this.attachedImage();
    // El contrato exige pregunta junto a la imagen (message 1–2000): el botón
    // de envío ya exige texto; esto es una doble guarda.
    if (!text || this.isLoading()) return;

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      createdAt: new Date(),
      // La imagen se muestra solo en la burbuja viva: el backend no la persiste (D2).
      ...(image ? { imageUrl: image } : {}),
    };
    this.messages.update((m) => [...m, userMsg]);
    this.inputText.set('');
    this.attachedImage.set(null);
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

    // Con imagen → turno multimodal (CGBIDA-276); sin imagen → stream textual (HU-03).
    const stream = image
      ? this.chatService.streamMultimedia({
          session_id: this.sessionId(),
          message: text,
          image_base64: image,
        })
      : this.chatService.streamChat({ session_id: this.sessionId(), message: text });

    stream.subscribe({
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
            this.errorMessage.set(event.data.message ?? this.i18n.t('docChat').unknownError);
            this.isLoading.set(false);
          } else if (event.type === 'done') {
            this.isLoading.set(false);
            if (wasNewSession) this.loadSessions();
          }
        },
        error: () => {
          this.errorMessage.set(this.i18n.t('docChat').connectionError);
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
