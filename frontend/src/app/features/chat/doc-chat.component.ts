// frontend/src/app/features/chat/doc-chat.component.ts

import { Component, ElementRef, ViewChild, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ChatService } from '../../core/services/chat.service';
import { ChatMessage } from '../../core/models/chat.model';
import { MessageBubbleComponent } from './message-bubble.component';

@Component({
  selector: 'app-doc-chat',
  standalone: true,
  imports: [CommonModule, FormsModule, MessageBubbleComponent],
  templateUrl: './doc-chat.component.html',
})
export class DocChatComponent {
  private readonly chatService = inject(ChatService);

  @ViewChild('messagesContainer') messagesContainer!: ElementRef<HTMLDivElement>;

  // Signals de estado
  readonly messages = signal<ChatMessage[]>([]);
  readonly inputText = signal('');
  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly sessionId = signal<string | null>(null);

  sendMessage(): void {
    const text = this.inputText().trim();
    if (!text || this.isLoading()) return;

    // 1. Agregar mensaje del usuario
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

    // 2. Crear placeholder del asistente (para ir llenando con tokens)
    const assistantMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'assistant',
      content: '',
      createdAt: new Date(),
    };
    this.messages.update((m) => [...m, assistantMsg]);
    this.scrollToBottom();

    // 3. Consumir el stream
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
          }
        },
        error: (err) => {
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

  resetChat(): void {
    this.messages.set([]);
    this.sessionId.set(crypto.randomUUID());   // UUID nuevo → sesión nueva en backend
    this.errorMessage.set(null);
    this.inputText.set('');
    }
}

