from pydantic import BaseModel

from app.schemas.table_request import TableRequest


class ColumnValuesRequest(TableRequest):
    column_name: str
    limit: int = 500


class MasterTableRequest(TableRequest):
    id_column: str
    display_column: str
    limit: int = 1000
