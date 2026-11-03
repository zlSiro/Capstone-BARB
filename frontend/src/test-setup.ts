import { beforeEach } from 'vitest';
import { reiniciarIdiomaParaPruebas } from './app/core/i18n/i18n.service';

// El idioma es un estado global (señal compartida + localStorage). Cada prueba parte en español para que no dependa de otra.
beforeEach(() => reiniciarIdiomaParaPruebas());
