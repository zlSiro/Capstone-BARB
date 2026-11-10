// frontend/src/app/features/chat/doc-chat.component.ts

import { Component, DestroyRef, ElementRef, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { ChatService } from '../../core/services/chat.service';
import { ChatMessage, SessionListItem } from '../../core/models/chat.model';
import { tituloCorto } from '../../core/utils/chat-titulo';
import { MessageBubbleComponent } from './message-bubble.component';
import { ImageAttachmentComponent } from './image-attachment.component';
import { ToastService } from '../../core/services/toast.service';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { Icon } from '../../shared/components/ui/icon/icon';

/** Altura máxima del prompt en px; a partir de ahí el textarea hace scroll interno. */
const MAX_ALTURA_INPUT_PX = 192;

// ── Sidebar del historial: ancho y colapso ──
/** Ancho mínimo/máximo del historial en escritorio (px) y ancho inicial. */
export const ANCHO_HISTORIAL_MIN = 280;
export const ANCHO_HISTORIAL_MAX = 640;
export const ANCHO_HISTORIAL_DEFAULT = 440;
/** Cuánto cambia el ancho con cada flecha del teclado. */
const PASO_TECLADO_PX = 16;

const STORAGE_ANCHO = 'barb.chat.historial.ancho';
const STORAGE_COLAPSADO = 'barb.chat.historial.colapsado';

/** Lleva cualquier ancho al rango permitido (y redondea a px enteros). */
export function clampAnchoHistorial(px: number): number {
  if (!Number.isFinite(px)) return ANCHO_HISTORIAL_DEFAULT;
  return Math.min(ANCHO_HISTORIAL_MAX, Math.max(ANCHO_HISTORIAL_MIN, Math.round(px)));
}

@Component({
  selector: 'app-doc-chat',
  imports: [FormsModule, MessageBubbleComponent, ImageAttachmentComponent, TranslatePipe, Icon],
  templateUrl: './doc-chat.component.html',
})
export class DocChatComponent {
  private readonly chatService = inject(ChatService);
  private readonly route = inject(ActivatedRoute);
  private readonly i18n = inject(I18nService);
  private readonly toast = inject(ToastService);
  private readonly destroyRef = inject(DestroyRef);

  @ViewChild('messagesContainer') messagesContainer!: ElementRef<HTMLDivElement>;
  @ViewChild('promptInput') promptInput?: ElementRef<HTMLTextAreaElement>;

  // ── Chat state ──
  readonly messages = signal<ChatMessage[]>([]);
  readonly inputText = signal('');
  readonly isLoading = signal(false);
  readonly errorMessage = signal<string | null>(null);
  readonly sessionId = signal<string | null>(null);
  /** En móvil el historial y el chat no caben juntos: el historial se abre sobre el chat. */
  readonly historialAbierto = signal(false);
  /** En escritorio el historial se puede ocultar para darle todo el ancho al chat. */
  readonly historialColapsado = signal(this.leerColapsadoGuardado());
  /** Ancho del historial en escritorio (px), redimensionable con el cursor. */
  readonly anchoHistorial = signal(this.leerAnchoGuardado());
  /** Clases del sidebar: móvil (overlay) y escritorio (colapsable) se resuelven por separado. */
  protected readonly claseHistorial = computed(() => {
    if (this.historialAbierto()) return 'flex w-full';
    return this.historialColapsado() ? 'hidden' : 'hidden md:flex';
  });

  // ── Imagen adjunta (HU-05) ──
  // Data URL de la imagen lista para analizar; null = sin imagen.
  readonly attachedImage = signal<string | null>(null);

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

    // Al achicar/agrandar la ventana cambia el ancho disponible y, con él, cuántas
    // líneas ocupa el texto: hay que recalcular la altura del prompt.
    const onResize = () => this.reajustarAlturaInput();
    window.addEventListener('resize', onResize, { passive: true });
    this.destroyRef.onDestroy(() => window.removeEventListener('resize', onResize));
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

  /** Oculta el historial en escritorio para que el chat use todo el ancho. */
  colapsarHistorial(): void {
    this.historialColapsado.set(true);
    this.guardarColapsado(true);
  }

  /** Reabre el historial en escritorio (el botón solo se muestra colapsado). */
  mostrarHistorial(): void {
    this.historialColapsado.set(false);
    this.guardarColapsado(false);
  }

  // ── Redimensión con el cursor ──

  /** Estado del arrastre en curso (solo mientras se mantiene presionado el handle). */
  private redimension?: { pointerId: number; x: number; ancho: number };

  iniciarRedimension(ev: PointerEvent): void {
    if (ev.button !== 0) return;
    const handle = ev.currentTarget as HTMLElement;
    // Captura el puntero: los `pointermove` siguen llegando al handle aunque el
    // cursor salga de su franja de 6 px.
    handle.setPointerCapture(ev.pointerId);
    this.redimension = { pointerId: ev.pointerId, x: ev.clientX, ancho: this.anchoHistorial() };
    ev.preventDefault();
  }

  moverRedimension(ev: PointerEvent): void {
    const r = this.redimension;
    if (!r || r.pointerId !== ev.pointerId) return;
    this.anchoHistorial.set(clampAnchoHistorial(r.ancho + (ev.clientX - r.x)));
  }

  terminarRedimension(ev: PointerEvent): void {
    const r = this.redimension;
    if (!r || r.pointerId !== ev.pointerId) return;
    this.redimension = undefined;
    const handle = ev.currentTarget as HTMLElement;
    if (handle.hasPointerCapture(ev.pointerId)) handle.releasePointerCapture(ev.pointerId);
    this.guardarAncho();
    // Al cambiar el ancho cambia el espacio del texto: recalcula el prompt.
    this.reajustarAlturaInput();
  }

  redimensionarConTeclado(ev: KeyboardEvent): void {
    const actual = this.anchoHistorial();
    let nuevo: number;
    switch (ev.key) {
      case 'ArrowLeft':
        nuevo = actual - PASO_TECLADO_PX;
        break;
      case 'ArrowRight':
        nuevo = actual + PASO_TECLADO_PX;
        break;
      case 'Home':
        nuevo = ANCHO_HISTORIAL_MIN;
        break;
      case 'End':
        nuevo = ANCHO_HISTORIAL_MAX;
        break;
      default:
        return;
    }
    ev.preventDefault();
    this.anchoHistorial.set(clampAnchoHistorial(nuevo));
    this.guardarAncho();
    this.reajustarAlturaInput();
  }

  // ── Persistencia (localStorage, igual que `barb.lang`) ──

  private leerAnchoGuardado(): number {
    const raw = this.leerStorage(STORAGE_ANCHO);
    return raw === null ? ANCHO_HISTORIAL_DEFAULT : clampAnchoHistorial(Number(raw));
  }

  private leerColapsadoGuardado(): boolean {
    return this.leerStorage(STORAGE_COLAPSADO) === '1';
  }

  private guardarAncho(): void {
    this.escribirStorage(STORAGE_ANCHO, String(this.anchoHistorial()));
  }

  private guardarColapsado(colapsado: boolean): void {
    this.escribirStorage(STORAGE_COLAPSADO, colapsado ? '1' : '0');
  }

  private leerStorage(clave: string): string | null {
    try {
      return typeof window !== 'undefined' ? window.localStorage.getItem(clave) : null;
    } catch {
      return null;
    }
  }

  private escribirStorage(clave: string, valor: string): void {
    try {
      if (typeof window !== 'undefined') window.localStorage.setItem(clave, valor);
    } catch {
      // Sin almacenamiento (modo privado, cuota llena): el ajuste dura la sesión.
    }
  }

  selectSession(s: SessionListItem): void {
    this.historialAbierto.set(false);
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
    this.historialAbierto.set(false);
    this.messages.set([]);
    this.sessionId.set(null);
    this.errorMessage.set(null);
    this.inputText.set('');
    this.attachedImage.set(null);
    this.reajustarAlturaInput();
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
    this.reajustarAlturaInput();
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

  /** Recalcula la altura del prompt al escribir (ver `reajustarAlturaInput`). */
  onInputChange(): void {
    this.reajustarAlturaInput();
  }

  /** Ajusta la altura del textarea al contenido (máx. `MAX_ALTURA_INPUT_PX`). */
  private reajustarAlturaInput(): void {
    const el = this.promptInput?.nativeElement;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_ALTURA_INPUT_PX)}px`;
  }

  /**
   * Título corto para la tabla del historial (ver `chat-titulo.ts`).
   * Las sesiones nuevas ya nacen cortas en el backend; esto también acorta las
   * antiguas, que guardaron el prompt completo como título.
   */
  protected readonly tituloCorto = tituloCorto;

  /** Límites del ancho, expuestos al template para `aria-valuemin` / `aria-valuemax`. */
  protected readonly anchoMin = ANCHO_HISTORIAL_MIN;
  protected readonly anchoMax = ANCHO_HISTORIAL_MAX;

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
