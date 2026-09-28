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
        class="max-w-[75%] px-4 py-2 rounded-2xl text-sm leading-relaxed prose prose-sm max-w-none dark:prose-invert"
        [class.bg-blue-600]="message.role === 'user'"
        [class.text-white]="message.role === 'user'"
        [class.rounded-br-sm]="message.role === 'user'"
        [class.bg-gray-100]="message.role === 'assistant'"
        [class.dark:bg-gray-800]="message.role === 'assistant'"
        [class.text-gray-900]="message.role === 'assistant'"
        [class.dark:text-gray-100]="message.role === 'assistant'"
        [class.rounded-bl-sm]="message.role === 'assistant'"
      >
        @if (message.role === 'assistant') {
          <markdown [data]="message.content || '...'" />
        } @else {
          <span class="whitespace-pre-wrap break-words">{{ message.content }}</span>
        }
      </div>
    </div>
  `,
})
export class MessageBubbleComponent {
  @Input({ required: true }) message!: ChatMessage;
}
