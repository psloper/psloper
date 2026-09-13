"""
Text description -> CadQuery Python script -> STL file.

Pipeline:
  1. Ask Claude to write a CadQuery script that builds the requested part.
  2. Statically screen the script for obviously dangerous constructs (best-effort,
     not a real sandbox -- see README "Security notes").
  3. Run it in a subprocess with a timeout and a memory limit, exporting an STL.
  4. If it errors, send the error back to Claude and ask for a fix, up to
     MAX_GEN_RETRIES times.
"""
from __future__ import annotations

import re
import resource
import subprocess
import sys
import textwrap
from dataclasses import dataclass

import anthropic

import config

SYSTEM_PROMPT = textwrap.dedent(
    """
    You write CadQuery (Python) scripts that build a single solid 3D-printable part
    from a plain-language description.

    Rules for the code you write:
    - Only `import cadquery as cq` (and `import math` if you need it). No other imports.
    - Do not read or write files, do not use `open`, `os`, `subprocess`, `socket`,
      `requests`, `eval`, `exec`, `__import__`, or any network/filesystem/process APIs.
    - Build the final solid into a variable named exactly `result` (a cadquery
      Workplane or Shape). Do not call exporters yourself -- the caller handles export.
    - Use sensible real-world millimeter dimensions. If the user didn't give exact
      sizes, pick reasonable ones for the described object and briefly note your
      assumptions in a comment.
    - Prefer parametric, readable CadQuery: named dimension variables at the top,
      then the model built from them.
    - The part must be a single watertight manifold solid suitable for 3D printing
      (no open shells, no zero-thickness walls). Keep wall thickness >= 1.2mm unless
      the user asks otherwise.
    - Return ONLY the Python code, no prose, no markdown fences.
    """
).strip()

FIX_PROMPT_TEMPLATE = textwrap.dedent(
    """
    The script you wrote failed to run. Fix it and return the corrected, complete
    script (same rules as before: only cadquery/math imports, build into `result`,
    code only, no markdown fences).

    --- Previous script ---
    {code}

    --- Error running it ---
    {error}
    """
).strip()

_FORBIDDEN_PATTERNS = [
    r"\bimport\s+(?!cadquery\b|math\b)",
    r"\bfrom\s+\w+",
    r"\bopen\s*\(",
    r"\b__import__\s*\(",
    r"\beval\s*\(",
    r"\bexec\s*\(",
    r"\bos\.",
    r"\bsys\.",
    r"\bsubprocess\.",
    r"\bsocket\.",
    r"\brequests\.",
    r"\bshutil\.",
]

_RUNNER_TEMPLATE = textwrap.dedent(
    """
    import cadquery as cq

    {user_code}

    cq.exporters.export(result, {out_path!r})
    """
)


class CadGenerationError(RuntimeError):
    """Raised when Claude-generated CadQuery code cannot be produced/run safely."""


@dataclass
class GenerationResult:
    code: str
    stl_path: str
    attempts: int


def _strip_markdown_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        lines = text.splitlines()
        lines = lines[1:]
        if lines and lines[-1].strip().startswith("```"):
            lines = lines[:-1]
        text = "\n".join(lines)
    return text.strip()


def _screen_code(code: str) -> None:
    """Best-effort static check for obviously dangerous constructs.

    This is NOT a real sandbox -- it just catches the common ways a
    misbehaving/hallucinated script could try to touch the filesystem, network,
    or process. See README "Security notes" for the actual isolation story.
    """
    for pattern in _FORBIDDEN_PATTERNS:
        if re.search(pattern, code):
            raise CadGenerationError(
                f"Generated script contains a disallowed construct matching /{pattern}/."
            )
    if "result" not in code:
        raise CadGenerationError("Generated script never assigns a `result` variable.")


def _limit_resources():
    """Preexec function: cap memory and disallow core dumps in the child process."""
    mem_bytes = config.GEN_MEMORY_LIMIT_MB * 1024 * 1024
    try:
        resource.setrlimit(resource.RLIMIT_AS, (mem_bytes, mem_bytes))
    except (ValueError, OSError):
        pass
    try:
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    except (ValueError, OSError):
        pass


def _run_script(code: str, out_path: str) -> tuple[bool, str]:
    """Run the CadQuery script in an isolated subprocess. Returns (ok, stderr_or_empty)."""
    script = _RUNNER_TEMPLATE.format(user_code=code, out_path=out_path)
    try:
        proc = subprocess.run(
            [sys.executable, "-I", "-c", script],  # -I: isolated mode, ignores env/site
            capture_output=True,
            text=True,
            timeout=config.GEN_TIMEOUT_SECONDS,
            preexec_fn=_limit_resources if sys.platform != "win32" else None,
            env={},
        )
    except subprocess.TimeoutExpired:
        return False, f"Script timed out after {config.GEN_TIMEOUT_SECONDS}s."

    if proc.returncode != 0:
        return False, proc.stderr[-4000:]
    return True, ""


def _ask_claude(client: anthropic.Anthropic, messages: list[dict]) -> str:
    response = client.messages.create(
        model=config.CLAUDE_MODEL,
        max_tokens=4096,
        system=SYSTEM_PROMPT,
        messages=messages,
    )
    text = "".join(block.text for block in response.content if block.type == "text")
    return _strip_markdown_fences(text)


def generate_model(prompt: str, job_id: str) -> GenerationResult:
    """Turn a text prompt into an STL file. Retries on execution failure."""
    if not config.ANTHROPIC_API_KEY:
        raise CadGenerationError(
            "ANTHROPIC_API_KEY is not set. Add it to your .env file (see .env.example)."
        )

    client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
    out_path = str(config.GENERATED_DIR / f"{job_id}.stl")

    messages = [{"role": "user", "content": f"Design request: {prompt}"}]
    last_error = ""
    code = ""

    for attempt in range(1, config.MAX_GEN_RETRIES + 2):  # first try + retries
        code = _ask_claude(client, messages)

        try:
            _screen_code(code)
        except CadGenerationError as exc:
            last_error = str(exc)
            messages.append({"role": "assistant", "content": code})
            messages.append(
                {
                    "role": "user",
                    "content": FIX_PROMPT_TEMPLATE.format(code=code, error=last_error),
                }
            )
            continue

        ok, err = _run_script(code, out_path)
        if ok:
            return GenerationResult(code=code, stl_path=out_path, attempts=attempt)

        last_error = err
        messages.append({"role": "assistant", "content": code})
        messages.append(
            {"role": "user", "content": FIX_PROMPT_TEMPLATE.format(code=code, error=last_error)}
        )

    raise CadGenerationError(
        f"Could not generate a working model after {config.MAX_GEN_RETRIES + 1} attempts. "
        f"Last error: {last_error}"
    )
