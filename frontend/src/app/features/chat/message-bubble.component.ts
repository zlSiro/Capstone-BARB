// frontend/src/app/features/chat/message-bubble.component.ts

import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MarkdownModule } from 'ngx-markdown';
import { ChatMessage } from '../../core/models/chat.model';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { Icon } from '../../shared/components/ui/icon/icon';

@Component({
  selector: 'app-message-bubble',
  standalone: true,
  imports: [CommonModule, MarkdownModule, TranslatePipe, Icon],
  template: `
    <div
      class="flex w-full mb-3"
      [class.justify-end]="message.role === 'user'"
      [class.justify-start]="message.role === 'assistant'"
    >
      <div
        class="max-w-[75%] px-4 py-2 rounded-control text-sm leading-relaxed prose prose-sm max-w-none dark:prose-invert"
        [class.bg-accion]="message.role === 'user'"
        [class.text-sobre-accion]="message.role === 'user'"
        [class.rounded-br-sm]="message.role === 'user'"
        [class.bg-superficie-2]="message.role === 'assistant'"
        [class.text-tinta]="message.role === 'assistant'"
        [class.rounded-bl-sm]="message.role === 'assistant'"
      >
        @if (message.role === 'assistant') {
          <markdown [data]="message.content || '...'" />
        } @else {
          @if (message.imageUrl) {
            <img
              [src]="message.imageUrl"
              [alt]="message.content"
              class="mb-2 max-h-40 rounded-control"
            />
          } @else if (message.hasImage) {
            <!-- Turno con imagen cargado del Historial: la imagen no se guarda, solo se indica que existió. -->
            <span class="mb-1 flex items-center gap-1 text-xs opacity-90" data-testid="burbuja-imagen-enviada">
              <app-icon name="camara" [size]="16" />
              {{ 'docChat.imagenEnviada' | translate }}
            </span>
          }
          <span class="whitespace-pre-wrap break-words">{{ message.content }}</span>
        }
      </div>
    </div>
  `,
})
export class MessageBubbleComponent {
  @Input({ required: true }) message!: ChatMessage;
}
