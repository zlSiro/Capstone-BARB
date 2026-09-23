from __future__ import annotations

from pydantic import BaseModel


class WorkOrderStatusRequest(BaseModel):
    status: str
