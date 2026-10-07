from __future__ import annotations

from pydantic import BaseModel, Field


class WorkOrderStatusRequest(BaseModel):
    status: str
    comment: str | None = Field(default=None, max_length=500)
