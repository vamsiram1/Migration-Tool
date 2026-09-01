import subprocess
import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.schemas.docker_run import DockerRunRequest


router = APIRouter(prefix="/docker-run", tags=["Docker execution"])


@router.post("")
def run_with_docker(request: DockerRunRequest):
    duplicates_content = ""
    try:
        with tempfile.TemporaryDirectory(prefix="mysql-pg-migration-") as temporary_directory:
            work_directory = Path(temporary_directory)
            try:
                root_dir = Path(__file__).resolve().parents[3]
                (root_dir / "debug_pgloader.load").write_text(request.pgloader_config, encoding="utf-8")
                (root_dir / "debug_docker.ps1").write_text(request.docker_script, encoding="utf-8")
            except Exception:
                try:
                    Path("debug_pgloader.load").write_text(request.pgloader_config, encoding="utf-8")
                    Path("debug_docker.ps1").write_text(request.docker_script, encoding="utf-8")
                except Exception:
                    pass
            (work_directory / "mysql-to-postgres.load").write_text(
                request.pgloader_config, encoding="utf-8", newline="\n"
            )
            runner = work_directory / "mysql-to-pgloader-docker.ps1"
            runner.write_text(request.docker_script, encoding="utf-8")
            if request.lookup_helper:
                (work_directory / "lookup-transform.py").write_text(
                    request.lookup_helper, encoding="utf-8", newline="\n"
                )
            result = subprocess.run(
                ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(runner)],
                cwd=work_directory,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=3600,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
                check=False,
            )
            duplicates_file = work_directory / "lookup-duplicates.txt"
            if duplicates_file.exists():
                duplicates_content = duplicates_file.read_text(encoding="utf-8", errors="replace")
    except FileNotFoundError as error:
        raise HTTPException(status_code=500, detail="PowerShell or Docker Desktop was not found.") from error
    except subprocess.TimeoutExpired as error:
        output = "".join(part for part in [error.stdout or "", error.stderr or ""])
        raise HTTPException(status_code=504, detail=f"Docker migration timed out.\n{output}") from error

    return {
        "success": result.returncode == 0,
        "exit_code": result.returncode,
        "output": result.stdout + result.stderr,
        "duplicates": duplicates_content,
    }
