from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.mysql import router as mysql_router
from app.api.postgres import router as postgres_router
from app.api.docker_run import router as docker_run_router
from app.api.id_remapping import router as id_remapping_router

app = FastAPI(
    title="MySQL to PostgreSQL Migration Tool",
    version="0.1.1"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(mysql_router)
app.include_router(postgres_router)
app.include_router(docker_run_router)
app.include_router(id_remapping_router)

@app.get("/")
def home():
    return {
        "application": "MySQL to PostgreSQL Migration Tool",
        "status": "Running"
    }
