# Muestras de documentos para la base de conocimiento (RAG)

Mini-manuales propios del equipo, en `.md`, para **poblar el RAG** del chat de BARB
después de la limpieza de documentos de producción (01-11). Se suben por la pantalla
de documentos de la página con una cuenta con permiso `subir_documentos`
(gerente/admin): la subida genera los vectores automáticamente (`index_chunks` con
`embeber=True`), así que **no hace falta correr `backfill_embeddings.py`** — ese
script queda solo para documentos viejos que quedaron sin vectores.

## Contenido

| Archivo | Equipos cubiertos | Códigos en la BD |
|---------|-------------------|------------------|
| `manual_compresor_a1.md` | Compresor de tornillo (el plan de 500 h como referencia histórica) | COMP-A1 |
| `manual_pump_e4.md` | Bomba centrífuga del circuito hidráulico | PUMP-E4 |
| `manual_press_b3_hidraulica.md` | Prensa hidráulica de 4 columnas | PRESS-B3 |
| `guia_electrica_motor_generador.md` | Motor con variador de frecuencia + grupo electrógeno de respaldo | MOTOR-D1, GEN-G1 |
| `guia_sistemas_neumaticos_n2.md` | Compresor neumático + red de aire, FRL y actuadores | COMP-N2 |
| `guia_gestion_sla_costo_inactividad.md` | Vocabulario de gestión: SLA, costo por minuto, kit de repuestos | transversal |

## Reglas que respetan estos textos

- **Los valores de SLA y costo por minuto NO se definen aquí**: vienen de la base de
  datos (mantenedor de máquinas). Los manuales solo los mencionan a título de
  referencia para no contradecir al chat cuando este consulta la BD.
- Cada manual menciona **el nombre y el código de la máquina explícitamente**
  («Pump E4», «PUMP-E4») para que el retrieval asocie la consulta con el contenido:
  el umbral semántico del RAG es conservador (0.25, segunda pasada 0.15) y el plan B
  es la búsqueda full-text.
- Vocabulario del proyecto: disciplinas (mecánica, eléctrica, neumática, hidráulica,
  robótica, automatización, HVAC, instrumentación), SLA, costo de inactividad por
  minuto, kit de repuestos, OT, LOTO.
- Continuidad con las respuestas de prod que ya citaron estos documentos («Manual
  Compresor A1: cada 500 h», etc.), para que la conversación histórica siga siendo
  coherente.
- Peso acotado a propósito (1–2 páginas por documento): chunks cortos, respuestas
  más finas del RAG.

## Cómo subirlos a prod

1. Login en la página con gerente/admin de la empresa «Planta Demo BARB».
2. Pantalla Documentos → cargar el `.md`/`.txt`/`.pdf`/`.docx` (máx. 15 MB; un PDF
   escaneado se rechaza con 422 porque no tiene texto extraíble).
3. Poner un `title` citable por el chat — ej. «Manual Compresor A1». Los documentos
   quedan ligados a la empresa de quien los sube.
4. Verificación rápida en el chat: «¿cada cuántas horas se limpia el filtro del
   Compresor A1?» → debe citar el documento por su título.

> OJO: los archivos de `samples/` son para **subirlos a la app**, no se sirven
> automáticamente desde el repo. Deben cargarse con la cuenta gerente via la
> pantalla para que queden en la base de la empresa correcta (empresa 1).

*Archivos del proyecto BARB, rama `docs/muestras-manuales-rag`: no son documentación
del producto; su único fin es alimentar las pruebas del RAG.*
