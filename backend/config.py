"""Central configuration, loaded from environment variables (see .env.example)."""
import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent

# --- Claude ---
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
CLAUDE_MODEL = os.environ.get("CLAUDE_MODEL", "claude-sonnet-5")
MAX_GEN_RETRIES = int(os.environ.get("MAX_GEN_RETRIES", "2"))

# --- CAD script execution sandbox ---
GEN_TIMEOUT_SECONDS = int(os.environ.get("GEN_TIMEOUT_SECONDS", "60"))
GEN_MEMORY_LIMIT_MB = int(os.environ.get("GEN_MEMORY_LIMIT_MB", "1024"))

# --- Storage ---
GENERATED_DIR = Path(os.environ.get("GENERATED_DIR", BASE_DIR / "generated")).resolve()
GENERATED_DIR.mkdir(parents=True, exist_ok=True)

# --- Slicer (PrusaSlicer CLI by default) ---
PRUSASLICER_PATH = os.environ.get("PRUSASLICER_PATH", "prusa-slicer")
PRINTER_PROFILE = os.environ.get("PRINTER_PROFILE", str(BASE_DIR / "profiles" / "default.ini"))
SLICE_TIMEOUT_SECONDS = int(os.environ.get("SLICE_TIMEOUT_SECONDS", "180"))

# --- OctoPrint ---
OCTOPRINT_URL = os.environ.get("OCTOPRINT_URL", "").rstrip("/")
OCTOPRINT_API_KEY = os.environ.get("OCTOPRINT_API_KEY", "")

# --- Server ---
HOST = os.environ.get("HOST", "127.0.0.1")
PORT = int(os.environ.get("PORT", "5000"))
DEBUG = os.environ.get("DEBUG", "false").lower() == "true"
