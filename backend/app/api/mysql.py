from fastapi import APIRouter, HTTPException

from app.schemas.connection import DatabaseConnection
from app.schemas.schema_request import SchemaRequest
from app.services.mysql_service import test_connection
from app.services.mysql_service import get_tables
from app.services.mysql_service import get_schemas

from app.schemas.table_request import TableRequest
from app.services.mysql_service import get_columns

router = APIRouter(prefix="/mysql", tags=["MySQL"])

@router.post("/test")
def mysql_test(conn: DatabaseConnection):

    try:
        test_connection(conn)

        return {
            "success": True,
            "message": "MySQL connection successful"
        }

    except Exception as e:

        raise HTTPException(
            status_code=400,
            detail=str(e)
        )

@router.post("/schemas")
def mysql_schemas(conn: DatabaseConnection):
    try:
        return get_schemas(conn)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/tables")
def mysql_tables(conn: SchemaRequest):

    try:
        return get_tables(conn)

    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/columns")
def mysql_columns(req: TableRequest):
    try:
        return get_columns(req, req.table_name)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
