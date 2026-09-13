"""Slices an STL into G-code using PrusaSlicer's command-line mode.

Swap this module out if you use a different slicer:
- CuraEngine: `curaengine slice -j <printer.def.json> -l in.stl -o out.gcode`
- SuperSlicer: same CLI shape as PrusaSlicer (it's a fork), just change the binary.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

import config


class SlicingError(RuntimeError):
    pass


def slice_to_gcode(stl_path: str, job_id: str) -> str:
    stl = Path(stl_path)
    if not stl.exists():
        raise SlicingError(f"STL file not found: {stl_path}")

    profile = Path(config.PRINTER_PROFILE)
    if not profile.exists() or "PLACEHOLDER" in profile.read_text(errors="ignore")[:200]:
        raise SlicingError(
            f"{profile} is missing or still the placeholder. Export a real profile "
            "from PrusaSlicer (Printer Settings -> Export config bundle/ini) for "
            "YOUR printer/nozzle/filament, and point PRINTER_PROFILE at it -- see README."
        )

    gcode_path = config.GENERATED_DIR / f"{job_id}.gcode"

    cmd = [
        config.PRUSASLICER_PATH,
        "--export-gcode",
        "--load",
        str(profile),
        "-o",
        str(gcode_path),
        str(stl),
    ]
    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=config.SLICE_TIMEOUT_SECONDS,
        )
    except FileNotFoundError:
        raise SlicingError(
            f"Slicer binary not found at '{config.PRUSASLICER_PATH}'. "
            "Set PRUSASLICER_PATH in your .env to the PrusaSlicer executable."
        )
    except subprocess.TimeoutExpired:
        raise SlicingError(f"Slicing timed out after {config.SLICE_TIMEOUT_SECONDS}s.")

    if proc.returncode != 0 or not gcode_path.exists():
        raise SlicingError(f"Slicing failed:\n{proc.stderr[-4000:]}")

    return str(gcode_path)
