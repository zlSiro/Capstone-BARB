// Declaraciones mínimas para los tests que leen archivos del proyecto (p. ej. comprobar que cada `data-tour` existe).
// Evita agregar `@types/node` como dependencia: solo se tipa lo que esos tests usan.
declare module 'node:fs' {
  export function readFileSync(ruta: string, codificacion: 'utf-8'): string;
  export function readdirSync(ruta: string): string[];
  export function statSync(ruta: string): { isDirectory(): boolean };
}

declare module 'node:path' {
  export function join(...partes: string[]): string;
}

declare const process: { cwd(): string };
