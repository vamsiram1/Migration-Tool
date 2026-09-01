from pydantic import BaseModel

class TableRequest(BaseModel):
    host: str
    port: int
    username: str
    password: str
    database: str
    schema_name: str
    table_name: str
