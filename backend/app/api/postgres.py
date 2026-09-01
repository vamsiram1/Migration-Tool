from fastapi import APIRouter, HTTPException

from app.schemas.connection import DatabaseConnection
from app.schemas.schema_request import SchemaRequest
from app.services.postgres_service import test_connection
from app.services.postgres_service import get_tables
from app.services.postgres_service import get_schemas
from app.services.postgres_service import get_databases
from app.schemas.table_request import TableRequest
from app.services.postgres_service import get_columns

router = APIRouter(prefix="/postgres", tags=["PostgreSQL"])

@router.post("/test")
def postgres_test(conn: DatabaseConnection):

    try:
        test_connection(conn)

        return {
            "success": True,
            "message": "PostgreSQL connection successful"
        }

    except Exception as e:

        raise HTTPException(
            status_code=400,
            detail=str(e)
        )

@router.post("/schemas")
def postgres_schemas(conn: DatabaseConnection):
    try:
        return get_schemas(conn)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/databases")
def postgres_databases(conn: DatabaseConnection):
    try:
        return get_databases(conn)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/tables")
def postgres_tables(conn: SchemaRequest):

    try:
        return get_tables(conn)

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/columns")
def postgres_columns(req: TableRequest):
    try:
        return get_columns(req, req.table_name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


# Direct routes for ID remapping on /postgres/id-remap
from app.schemas.id_remapping import (
    IdRemapPreviewRequest,
    IdRemapPreviewResponse,
    IdRemapExecuteRequest,
    IdRemapExecuteResponse,
    TableDiscoveryRequest,
    TableDiscoveryResponse,
)
from app.services.id_remapping_service import (
    preview_id_remapping,
    execute_id_remapping,
    discover_related_tables,
)


@router.post("/id-remap/discover-tables", response_model=TableDiscoveryResponse)
def postgres_discover_tables(req: TableDiscoveryRequest):
    return discover_related_tables(req)


@router.post("/id-remap/preview", response_model=IdRemapPreviewResponse)
def postgres_preview_remap(req: IdRemapPreviewRequest):
    return preview_id_remapping(req)


@router.post("/id-remap/execute", response_model=IdRemapExecuteResponse)
def postgres_execute_remap(req: IdRemapExecuteRequest):
    return execute_id_remapping(req)

