from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

PROJECTS_DIR = BASE_DIR / "projects"
GENERATED_DIR = BASE_DIR / "generated"
LOG_DIR = BASE_DIR / "logs"

PROJECTS_DIR.mkdir(exist_ok=True)
GENERATED_DIR.mkdir(exist_ok=True)
LOG_DIR.mkdir(exist_ok=True)