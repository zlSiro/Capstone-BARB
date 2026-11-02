# Fuentes web — manuales reales con texto digital (para descargar y subir a mano)

Enlaces de referencia (verificados 02-11-2026) de manuales de fabricantes reales que
**sí tienen texto digital extraíble** (no escaneados), alineados con los equipos del
seed. Descargar el PDF **con texto** (copiar/pegar desde el visor debe funcionar; un
PDF escaneado se rechaza con 422 en `/api/documents`).

## Compresores de tornillo → COMP-A1 / COMP-N2

- **Atlas Copco — biblioteca oficial de manuales GA (español):**
  <https://www.atlascopco.com/es-es/compressors/manuals/ga-series>
  PDFs oficiales de folletos/datasheets por rango de potencia (GA 5,5–11 kW, GA 7–75
  kW VSD, GA 37–110 VSD+, etc.). El manual de *servicio* completo exige el número de
  serie vía SMARTLINK; los PDFs de la página ya cubren instalación y mantenimiento
  del usuario.
- **Manual de instrucciones GA 30+/GA 37/GA 45 (español, 200+ págs. con texto):**
  <https://jahancompressor.com/wp-content/uploads/2022/06/GA-37-GA-45-GA-55-GA-75-instruction-manual-JahanCompressor.pdf>
  (GA 37+/45+/55/75, English) y la versión en español del GA 30+–45 disponible vía
  repositores (idoc.tips / pdfcookie — son espejos no oficiales; preferir el PDF
  directo del sitio Atlas Copco o de Jahan).
- **Manual Electronikon GA5–GA90C (español, clubdediagramas):**
  <https://clubdediagramas.com/archivo/4098/manual-ga45-mkiv-pdf>
  Cubre el regulador Elektronikon I/II de los GA5…GA90C.

## Bombas centrífugas → PUMP-E4

- **KSB ETA — Manual de servicio en español (PDF, texto digital):**
  <http://delta-ca.com/anexos/prod1191_59806347bddd6.pdf>
  Incluye supervisión de servicio y mantención; idealmente recortar a las secciones
  de operación/mantención (§4) para no subir 200 págs. de tablas de la ETA.
- **Grundfos CM/CME — Instrucciones de mantenimiento (español, PDF oficial):**
  <https://api.grundfos.com/literature/Grundfosliterature-2186526.pdf>
  Desmontaje/montaje, kits de mantenimiento y localización de fallos.
- **Grundfos TP serie 300 — Instrucciones de mantenimiento (español, PDF oficial):**
  <https://www.anwo.cl/files/prd_productos/52282/Instrucciones%20de%20Mantenimiento%20(Series%20300)%20-%203810878.pdf>

## Notas prácticas

1. **Tamaño**: el límite de la app es 15 MB por documento — estarán dentro, pero
   conviene recortar manuales de 200 págs. a las secciones útiles (mantenimiento,
   fallas, seguridad): chunks más finos = mejores respuestas del chat.
2. **`title` citable**: nombrar el documento con marca/modelo («Manual Atlas Copco
   GA37», «Manual KSB ETA»); el chat cita por el campo título.
3. **Copyright**: los PDFs de fabricantes son para uso interno de la demo; con eso
   alcanza — no redistribuirlos fuera del repositorio del ramo.
4. Los mini-manuales `.md` de esta carpeta siguen siendo los primarios para la demo
   (mencionan PUMP-E4/COMP-A1 explícitamente, que ningún manual real va a nombrar).
