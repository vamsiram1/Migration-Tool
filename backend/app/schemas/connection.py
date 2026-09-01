from pydantic import BaseModel

class DatabaseConnection(BaseModel):
    host: str
    port: int
    username: str
    password: str
    database: str