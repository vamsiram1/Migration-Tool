import subprocess
import tempfile
import threading
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.schemas.docker_run import DockerRunRequest


router = APIRouter(prefix="/docker-run", tags=["Docker execution"])

_migration_lock = threading.Lock()
_active_state = {
    "process": None,
    "cancelled": False,
}


def cleanup_docker_containers():
    """Clean up any leftover temporary client or pgloader containers."""
    cleanup_cmd = (
        'docker ps -q --filter name=migration-mysql-client | ForEach-Object { docker rm -f $_ }; '
        'docker ps -q --filter name=migration-postgres-client | ForEach-Object { docker rm -f $_ }; '
        'docker ps -q --filter ancestor=dimitri/pgloader:latest | ForEach-Object { docker rm -f $_ }'
    )
    try:
        subprocess.run(
            ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", cleanup_cmd],
            capture_output=True,
            timeout=15,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except Exception:
        pass


@router.post("")
def run_with_docker(request: DockerRunRequest):
    global _active_state
    with _migration_lock:
        _active_state["cancelled"] = False

    duplicates_content = ""
    stdout = ""
    stderr = ""
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

            process = subprocess.Popen(
                ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(runner)],
                cwd=work_directory,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                encoding="utf-8",
                errors="replace",
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )

            with _migration_lock:
                _active_state["process"] = process

            try:
                stdout, stderr = process.communicate(timeout=3600)
            finally:
                with _migration_lock:
                    _active_state["process"] = None

            duplicates_file = work_directory / "lookup-duplicates.txt"
            if duplicates_file.exists():
                duplicates_content = duplicates_file.read_text(encoding="utf-8", errors="replace")

            if _active_state["cancelled"]:
                return {
                    "success": False,
                    "exit_code": -1,
                    "output": "Migration was cancelled by user.\n" + (stdout or "") + (stderr or ""),
                    "duplicates": duplicates_content,
                }

    except FileNotFoundError as error:
        raise HTTPException(status_code=500, detail="PowerShell or Docker Desktop was not found.") from error
    except subprocess.TimeoutExpired as error:
        cleanup_docker_containers()
        output = "".join(part for part in [getattr(error, "stdout", "") or "", getattr(error, "stderr", "") or ""])
        raise HTTPException(status_code=504, detail=f"Docker migration timed out.\n{output}") from error

    return {
        "success": process.returncode == 0,
        "exit_code": process.returncode,
        "output": (stdout or "") + (stderr or ""),
        "duplicates": duplicates_content,
    }


@router.post("/cancel")
def cancel_docker_migration():
    global _active_state
    with _migration_lock:
        process = _active_state.get("process")
        _active_state["cancelled"] = True

    if process is not None and process.poll() is None:
        try:
            subprocess.run(
                ["taskkill", "/F", "/T", "/PID", str(process.pid)],
                capture_output=True,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            )
        except Exception:
            try:
                process.kill()
            except Exception:
                pass

        cleanup_docker_containers()
        return {"success": True, "message": "Migration cancelled and containers cleaned up."}

    cleanup_docker_containers()
    return {"success": True, "message": "No active migration was running; cleaned up lingering containers."}

