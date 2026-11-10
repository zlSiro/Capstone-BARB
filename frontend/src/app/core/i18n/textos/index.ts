// Textos por vista. Cada módulo exporta `{ es, en }` con `en` tipado como `typeof es`.
import { accesoTextos } from './acceso';
import { avisosTextos } from './avisos';
import { documentosTextos } from './documentos';
import { empresasTextos } from './empresas';
import { otTextos } from './ot';
import { plantasTextos } from './plantas';
import { privilegiosTextos } from './privilegios';
import { sistemaTextos } from './sistema';
import { trxTextos } from './trx';
import { usuariosTextos } from './usuarios';

export const textosExtra = {
  es: {
    ...accesoTextos.es,
    ...avisosTextos.es,
    ...documentosTextos.es,
    ...empresasTextos.es,
    ...otTextos.es,
    ...plantasTextos.es,
    ...privilegiosTextos.es,
    ...sistemaTextos.es,
    ...trxTextos.es,
    ...usuariosTextos.es,
  },
  en: {
    ...accesoTextos.en,
    ...avisosTextos.en,
    ...documentosTextos.en,
    ...empresasTextos.en,
    ...otTextos.en,
    ...plantasTextos.en,
    ...privilegiosTextos.en,
    ...sistemaTextos.en,
    ...trxTextos.en,
    ...usuariosTextos.en,
  },
};
