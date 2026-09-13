"""Flask app: text prompt -> CadQuery model -> STL -> sliced G-code -> printer.

Routes:
  GET  /                          the web UI
  POST /api/generate              {prompt} -> creates a job, generates the model
  GET  /api/jobs                  list jobs (most recent first)
  GET  /api/jobs/<id>             job details (status, code, error)
  GET  /api/jobs/<id>/stl         download/preview the STL
  POST /api/jobs/<id>/print       slice + send to the printer via OctoPrint
  GET  /api/printer/status        current OctoPrint job/printer status
  POST /api/printer/cancel        cancel the print in progress
"""
from __future__ import annotations

from pathlib import Path

from flask import Flask, jsonify, request, send_file, send_from_directory

import cad_generator
import config
import jobs
import printer
import slicer

app = Flask(__name__, static_folder=None)

FRONTEND_DIR = (Path(__file__).resolve().parent.parent / "frontend").resolve()


def job_to_dict(job: jobs.Job) -> dict:
    return {
        "id": job.id,
        "prompt": job.prompt,
        "status": job.status,
        "code": job.code,
        "error": job.error,
        "created_at": job.created_at,
        "has_stl": bool(job.stl_path),
    }


# ---------------------------------------------------------------- frontend --
@app.get("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.get("/<path:filename>")
def static_files(filename):
    return send_from_directory(FRONTEND_DIR, filename)


# --------------------------------------------------------------------- API --
@app.post("/api/generate")
def api_generate():
    data = request.get_json(silent=True) or {}
    prompt = (data.get("prompt") or "").strip()
    if not prompt:
        return jsonify(error="prompt is required"), 400

    job = jobs.create_job(prompt)
    try:
        result = cad_generator.generate_model(prompt, job.id)
    except cad_generator.CadGenerationError as exc:
        jobs.update_job(job.id, status="error", error=str(exc))
        return jsonify(job_to_dict(jobs.get_job(job.id))), 502

    jobs.update_job(
        job.id,
        status="ready",
        code=result.code,
        stl_path=result.stl_path,
    )
    return jsonify(job_to_dict(jobs.get_job(job.id)))


@app.get("/api/jobs")
def api_list_jobs():
    return jsonify([job_to_dict(j) for j in jobs.list_jobs()])


@app.get("/api/jobs/<job_id>")
def api_get_job(job_id):
    job = jobs.get_job(job_id)
    if job is None:
        return jsonify(error="not found"), 404
    return jsonify(job_to_dict(job))


@app.get("/api/jobs/<job_id>/stl")
def api_get_stl(job_id):
    job = jobs.get_job(job_id)
    if job is None or not job.stl_path:
        return jsonify(error="not found"), 404
    return send_file(job.stl_path, mimetype="model/stl")


@app.post("/api/jobs/<job_id>/print")
def api_print(job_id):
    job = jobs.get_job(job_id)
    if job is None:
        return jsonify(error="not found"), 404
    if not job.stl_path:
        return jsonify(error="job has no model to print"), 400

    jobs.update_job(job_id, status="slicing")
    try:
        gcode_path = slicer.slice_to_gcode(job.stl_path, job_id)
    except slicer.SlicingError as exc:
        jobs.update_job(job_id, status="error", error=str(exc))
        return jsonify(job_to_dict(jobs.get_job(job_id))), 502

    jobs.update_job(job_id, gcode_path=gcode_path, status="printing")
    try:
        printer.upload_and_print(gcode_path)
    except printer.PrinterError as exc:
        jobs.update_job(job_id, status="error", error=str(exc))
        return jsonify(job_to_dict(jobs.get_job(job_id))), 502

    return jsonify(job_to_dict(jobs.get_job(job_id)))


@app.get("/api/printer/status")
def api_printer_status():
    try:
        return jsonify(printer.get_job_status())
    except printer.PrinterError as exc:
        return jsonify(error=str(exc)), 502


@app.post("/api/printer/cancel")
def api_printer_cancel():
    try:
        printer.cancel_current_job()
        return jsonify(ok=True)
    except printer.PrinterError as exc:
        return jsonify(error=str(exc)), 502


if __name__ == "__main__":
    app.run(host=config.HOST, port=config.PORT, debug=config.DEBUG)
