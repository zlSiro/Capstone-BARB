import { TestBed } from '@angular/core/testing';
import { ComponentFixture } from '@angular/core/testing';

import { ImageAttachmentComponent } from './image-attachment.component';

/**
 * HU-05 (CGBIDA-278): el componente de carga valida ANTES de emitir — mismo
 * contrato que el backend (docs/contrato_api_chat_multimedia.md): solo
 * jpeg/png/webp y máx. 5 MB decodificados. El backend revalida igual.
 */
describe('ImageAttachmentComponent', () => {
  let fixture: ComponentFixture<ImageAttachmentComponent>;
  let component: ImageAttachmentComponent;
  let selected: string[];
  let errors: string[];

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [ImageAttachmentComponent] });
    fixture = TestBed.createComponent(ImageAttachmentComponent);
    component = fixture.componentInstance;

    selected = [];
    errors = [];
    component.imageSelected.subscribe((dataUrl) => selected.push(dataUrl));
    component.imageError.subscribe((msg) => errors.push(msg));
  });

  /** Dispara el (change) con el archivo dado, como lo haría el input real. */
  function selectFile(file: File | null): void {
    const input = document.createElement('input');
    input.type = 'file';
    if (file) Object.defineProperty(input, 'files', { value: [file] });
    const event = new Event('change');
    Object.defineProperty(event, 'target', { value: input });
    component.onFileSelected(event);
  }

  /** FileReader es asíncrono: esperar a que resuelva la lectura. */
  async function flushReader(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  it('acepta un PNG válido y emite la data URL', async () => {
    selectFile(new File(['datos-de-imagen'], 'foto.png', { type: 'image/png' }));
    await flushReader();

    expect(selected.length).toBe(1);
    expect(selected[0].startsWith('data:image/png;base64,')).toBe(true);
    expect(errors.length).toBe(0);
  });

  it('acepta jpeg y webp (los tres formatos del contrato)', async () => {
    selectFile(new File(['a'], 'a.jpg', { type: 'image/jpeg' }));
    await flushReader();
    selectFile(new File(['b'], 'b.webp', { type: 'image/webp' }));
    await flushReader();

    expect(selected.length).toBe(2);
    expect(selected[0].startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(selected[1].startsWith('data:image/webp;base64,')).toBe(true);
    expect(errors.length).toBe(0);
  });

  it('rechaza formatos no permitidos (gif) con error traducido', async () => {
    selectFile(new File(['gif'], 'anim.gif', { type: 'image/gif' }));
    await flushReader();

    expect(selected.length).toBe(0);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('JPEG');
  });

  it('rechaza imágenes sobre 5 MB (límite del contrato)', async () => {
    const oversized = new File(
      [new ArrayBuffer(5 * 1024 * 1024 + 1)],
      'enorme.png',
      { type: 'image/png' },
    );
    selectFile(oversized);
    await flushReader();

    expect(selected.length).toBe(0);
    expect(errors.length).toBe(1);
    expect(errors[0]).toContain('5 MB');
  });

  it('no emite nada si el change llega sin archivo (cancelado)', async () => {
    selectFile(null);
    await flushReader();

    expect(selected.length).toBe(0);
    expect(errors.length).toBe(0);
  });
});
