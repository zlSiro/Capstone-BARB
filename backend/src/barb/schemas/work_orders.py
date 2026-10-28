from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class WorkOrderStatusRequest(BaseModel):
    status: str
    comment: str | None = Field(default=None, max_length=500)


class WorkOrderAssignRequest(BaseModel):
    """Cambios de asignación de una OT abierta. Todos opcionales, pero al menos uno es obligatorio."""

    tecnico_id: int | None = Field(default=None, ge=1)
    priority: str | None = None
    fecha_vencimiento: datetime | None = None
