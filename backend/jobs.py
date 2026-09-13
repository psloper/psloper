"""In-memory job store.

Deliberately simple: this is a single-user, single-process personal tool, not
a multi-tenant service. If you need jobs to survive a server restart, swap
this dict for a small SQLite table -- the rest of the app only touches it
through the functions below.
"""
from __future__ import annotations

import threading
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

_lock = threading.Lock()
_jobs: dict[str, "Job"] = {}


@dataclass
class Job:
    id: str
    prompt: str
    status: str = "generating"  # generating | ready | slicing | printing | error
    code: str = ""
    stl_path: str = ""
    gcode_path: str = ""
    error: str = ""
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


def create_job(prompt: str) -> Job:
    job = Job(id=uuid.uuid4().hex[:12], prompt=prompt)
    with _lock:
        _jobs[job.id] = job
    return job


def get_job(job_id: str) -> Optional[Job]:
    with _lock:
        return _jobs.get(job_id)


def list_jobs() -> list[Job]:
    with _lock:
        return sorted(_jobs.values(), key=lambda j: j.created_at, reverse=True)


def update_job(job_id: str, **fields) -> Optional[Job]:
    with _lock:
        job = _jobs.get(job_id)
        if job is None:
            return None
        for k, v in fields.items():
            setattr(job, k, v)
        return job
