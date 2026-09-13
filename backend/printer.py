"""Sends G-code to a printer over OctoPrint's REST API and reports job status.

OctoPrint is the standard way to put a network/API front-end on an otherwise
"dumb" USB-connected 3D printer (a Raspberry Pi running OctoPrint/OctoPi sits
between this app and the printer). If you use Klipper/Moonraker or a printer
with a built-in web API instead, replace this module's two functions --
everything upstream (app.py) only calls upload_and_print() and get_job_status().
"""
from __future__ import annotations

from pathlib import Path

import requests

import config


class PrinterError(RuntimeError):
    pass


def _require_config():
    if not config.OCTOPRINT_URL or not config.OCTOPRINT_API_KEY:
        raise PrinterError(
            "OCTOPRINT_URL / OCTOPRINT_API_KEY are not set. Add them to your .env "
            "(find the API key in OctoPrint under Settings -> API) -- see README."
        )


def upload_and_print(gcode_path: str) -> dict:
    """Uploads a G-code file to OctoPrint and starts printing it immediately."""
    _require_config()
    path = Path(gcode_path)
    if not path.exists():
        raise PrinterError(f"G-code file not found: {gcode_path}")

    headers = {"X-Api-Key": config.OCTOPRINT_API_KEY}

    with path.open("rb") as f:
        resp = requests.post(
            f"{config.OCTOPRINT_URL}/api/files/local",
            headers=headers,
            files={"file": (path.name, f, "application/octet-stream")},
            data={"select": "true", "print": "true"},
            timeout=60,
        )

    if resp.status_code not in (200, 201):
        raise PrinterError(f"OctoPrint upload failed ({resp.status_code}): {resp.text[:1000]}")

    return resp.json()


def get_job_status() -> dict:
    """Returns OctoPrint's current job/printer state (progress %, state, etc.)."""
    _require_config()
    headers = {"X-Api-Key": config.OCTOPRINT_API_KEY}
    resp = requests.get(f"{config.OCTOPRINT_URL}/api/job", headers=headers, timeout=15)
    if resp.status_code != 200:
        raise PrinterError(f"OctoPrint status check failed ({resp.status_code}): {resp.text[:1000]}")
    return resp.json()


def cancel_current_job() -> None:
    _require_config()
    headers = {"X-Api-Key": config.OCTOPRINT_API_KEY}
    resp = requests.post(
        f"{config.OCTOPRINT_URL}/api/job",
        headers=headers,
        json={"command": "cancel"},
        timeout=15,
    )
    if resp.status_code not in (200, 204):
        raise PrinterError(f"OctoPrint cancel failed ({resp.status_code}): {resp.text[:1000]}")
