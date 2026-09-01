from pydantic import BaseModel, Field


class DockerRunRequest(BaseModel):
    pgloader_config: str = Field(min_length=1, max_length=5_000_000)
    docker_script: str = Field(min_length=1, max_length=5_000_000)
    lookup_helper: str = Field(default="", max_length=5_000_000)
