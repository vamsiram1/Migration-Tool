from app.schemas.connection import DatabaseConnection


class SchemaRequest(DatabaseConnection):
    schema_name: str
