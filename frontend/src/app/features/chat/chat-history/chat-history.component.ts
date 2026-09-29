// frontend/src/app/features/chat/chat-history/chat-history.component.ts

import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { ChatService } from '../../../core/services/chat.service';
import { SessionListItem, SessionMessage } from '../../../core/models/chat.model';
import { ToastService } from '../../../core/services/toast.service';

@Component({
  selector: 'app-chat-history',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: 'chat-history.component.html',
})
export class ChatHistoryComponent {
  private readonly chatService = inject(ChatService);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly sessions = signal<SessionListItem[]>([]);
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly selectedId = signal<string | null>(null);
  readonly selectedMessages = signal<SessionMessage[]>([]);
  readonly selectedTitle = signal<string>('');
  readonly selectedMeta = signal<{ machine?: string | null; discipline?: string | null; savedBy?: string | null }>({});
  readonly loadingDetail = signal(false);

  readonly hasSelection = computed(() => this.selectedId() !== null);

  constructor() {
    this.loadSessions();
  }

  loadSessions(): void {
    this.loading.set(true);
    this.errorMessage.set(null);

    this.chatService.listSessions(50, 0).subscribe({
      next: (resp) => {
        this.sessions.set(resp.sessions);
        this.loading.set(false);
      },
      error: () => {
        this.errorMessage.set('No se pudieron cargar las conversaciones.');
        this.loading.set(false);
      },
    });
  }

  selectSession(s: SessionListItem): void {
    this.selectedId.set(s.session_id);
    this.selectedTitle.set(s.titulo);
    this.selectedMeta.set({
      machine: s.machine_name,
      discipline: s.discipline,
      savedBy: s.saved_by,
    });
    this.selectedMessages.set([]);
    this.loadingDetail.set(true);

    this.chatService.getSession(s.session_id).subscribe({
      next: (detail) => {
        this.selectedMessages.set(detail.messages);
        this.loadingDetail.set(false);
      },
      error: () => {
        this.errorMessage.set('No se pudo cargar la conversación.');
        this.loadingDetail.set(false);
      },
    });
  }

  closeDetail(): void {
    this.selectedId.set(null);
    this.selectedMessages.set([]);
    this.selectedTitle.set('');
  }

  continueInChat(): void {
    const id = this.selectedId();
    if (!id) return;
    this.router.navigate(['/chat'], { queryParams: { session_id: id } });
  }

  deleteSession(s: SessionListItem, ev: Event): void {
    ev.stopPropagation();

    const ok = confirm(`¿Eliminar la conversación "${s.titulo}"? Esta acción no se puede deshacer.`);
    if (!ok) return;

    this.chatService.deleteSession(s.session_id).subscribe({
      next: () => {
        this.sessions.update((list) => list.filter((x) => x.session_id !== s.session_id));
        if (this.selectedId() === s.session_id) this.closeDetail();
        this.toast.show('Conversación eliminada', 'success');
      },
      error: () => {
        this.toast.show('No se pudo eliminar la conversación', 'error');
      },
    });
  }

  formatDate(iso: string): string {
    const d = new Date(iso);
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const year = d.getFullYear();
    return `${day}-${month}-${year}`;
  }
}
