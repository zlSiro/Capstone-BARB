// frontend/src/app/features/chat/message-bubble.component.ts

import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MarkdownModule } from 'ngx-markdown';
import { ChatMessage } from '../../core/models/chat.model';

@Component({
  selector: 'app-message-bubble',
  standalone: true,
  imports: [CommonModule, MarkdownModule],
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
