from fastapi import APIRouter

from app.schemas.id_remapping import (
    IdRemapPreviewRequest,
    IdRemapPreviewResponse,
    IdRemapExecuteRequest,
    IdRemapExecuteResponse,
    IdRemapRevertRequest,
    IdRemapHistoryResponse,
    TableDiscoveryRequest,
    TableDiscoveryResponse,
)
from app.services.id_remapping_service import (
    preview_id_remapping,
    execute_id_remapping,
    revert_last_id_remapping,
    get_id_remapping_history,
    discover_related_tables,
)

router = APIRouter(prefix="/postgres/id-remap", tags=["PostgreSQL ID Remapping"])


@router.post("/discover-tables", response_model=TableDiscoveryResponse)
def discover_tables(req: TableDiscoveryRequest):
    return discover_related_tables(req)


@router.post("/preview", response_model=IdRemapPreviewResponse)
def preview_remap(req: IdRemapPreviewRequest):
    return preview_id_remapping(req)


@router.post("/execute", response_model=IdRemapExecuteResponse)
def execute_remap(req: IdRemapExecuteRequest):
    return execute_id_remapping(req)


@router.post("/revert", response_model=IdRemapExecuteResponse)
def revert_remap(req: IdRemapRevertRequest):
    return revert_last_id_remapping(req)


@router.post("/history", response_model=IdRemapHistoryResponse)
def get_history(req: IdRemapRevertRequest):
    return get_id_remapping_history(req.connection)

