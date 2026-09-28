# Contrato de API — Chat IA

> Endpoint de chat conversacional con streaming SSE.
> Última actualización: 28 de septiembre de 2026
> Autor: René Rojas
> Estado: implementado y verificado end-to-end en local

---

## Base

- **Ruta base:** `/api/chat`
- **Autenticación:** ⚠️ pendiente de integrar (Bearer JWT en `Depends(get_current_user)`).
  Actualmente el endpoint es público para facilitar las pruebas locales.
- **Content-Type request:** `application/json`
- **Content-Type response:** `text/event-stream; charset=utf-8`

---

## 1. `POST /api/chat/stream` — Endpoint principal

Inicia o continúa una conversación con streaming de tokens vía SSE.

### Request Body

```json
{
  "session_id": "string | null",
  "message": "string"
}