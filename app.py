"""Tri-bike fitting: local web app.  Run: .venv/bin/python app.py  → http://localhost:5000"""
import json
import threading

import numpy as np
from flask import Flask, abort, jsonify, request, send_file, send_from_directory

from fitting import advice, metrics, pose, store
from fitting.config import DATA, ROOT, SETUP_DEFAULTS, load_ranges, localized_fields

app = Flask(__name__, static_folder=str(ROOT / "static"), static_url_path="/static")
app.config["MAX_CONTENT_LENGTH"] = 2 * 1024**3
_lock = threading.Lock()  # one pose analysis at a time


def _meta_or_404(sid):
    m = store.get_meta(sid) if (DATA / sid).is_dir() else None
    if not m:
        abort(404)
    return m


def _lang():
    return "en" if request.args.get("lang") == "en" else "zh"


def _compute(sid):
    meta = _meta_or_404(sid)
    if meta["status"] != "ready":
        return None
    p = store.load_pose(sid)
    lm = store.effective_landmarks(sid)
    px_per_mm = None
    sc = meta.get("scale")
    if sc and sc.get("mm"):
        dx = (sc["p1"][0] - sc["p2"][0]) * p["width"]
        dy = (sc["p1"][1] - sc["p2"][1]) * p["height"]
        px_per_mm = float(np.hypot(dx, dy) / sc["mm"])
    res = metrics.compute(lm, p["width"], p["height"], p["fps"], meta["side"], meta.get("facing", 1),
                          meta.get("range"), px_per_mm)
    res["advice"] = advice.advise(res, load_ranges(_lang()), _lang())
    return res


def _run(sid, path):
    with _lock:
        pose.analyze(sid, path)


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/api/fields")
def fields():
    setup, perf = localized_fields(_lang())
    return jsonify(setup=setup, perf=perf, ranges=load_ranges(_lang()), setup_defaults=SETUP_DEFAULTS)


@app.get("/api/sessions")
def sessions():
    out = []
    for m in store.list_sessions():
        s = dict(m)
        if m["status"] == "ready":
            r = _compute(m["id"])
            s["summary"] = {k: v["value"] for k, v in r["metrics"].items()}
        out.append(s)
    return jsonify(out)


@app.post("/api/sessions")
def create():
    f = request.files.get("video")
    if not f:
        abort(400, "missing video")
    meta = store.create(request.form.get("name", ""), json.loads(request.form.get("setup", "{}")),
                        json.loads(request.form.get("perf", "{}")))
    path = store.sdir(meta["id"]) / ("video" + (("." + f.filename.rsplit(".", 1)[-1]) if "." in f.filename else ".mp4"))
    f.save(path)
    threading.Thread(target=_run, args=(meta["id"], path), daemon=True).start()
    return jsonify(meta)


@app.get("/api/sessions/<sid>")
def get_session(sid):
    meta = _meta_or_404(sid)
    out = dict(meta=meta)
    if meta["status"] == "ready":
        p = store.load_pose(sid)
        out.update(fps=p["fps"], width=p["width"], height=p["height"], n=p["n"],
                   overrides=sorted(int(k) for k in store.load_overrides(sid)))
    return jsonify(out)


@app.patch("/api/sessions/<sid>")
def patch(sid):
    meta = _meta_or_404(sid)
    body = request.get_json()
    for k in ("name", "setup", "perf", "notes", "scale", "range", "side", "pro", "short", "lowconf"):
        if k in body:
            meta[k] = body[k]
    if "side" in body and meta["status"] == "ready":
        meta["facing"] = store.detect_facing(store.effective_landmarks(sid), meta["side"])
    store.save_meta(sid, meta)
    return jsonify(meta)


@app.delete("/api/sessions/<sid>")
def delete(sid):
    _meta_or_404(sid)
    store.delete(sid)
    return jsonify(ok=True)


@app.post("/api/sessions/<sid>/reanalyze")
def reanalyze(sid):
    _meta_or_404(sid)
    vids = list(store.sdir(sid).glob("video.*"))
    if not vids:
        abort(404)
    for f in ("overrides.json",):
        (store.sdir(sid) / f).unlink(missing_ok=True)
    store.invalidate(sid)
    threading.Thread(target=_run, args=(sid, vids[0]), daemon=True).start()
    return jsonify(ok=True)


@app.get("/api/sessions/<sid>/frame/<int:n>")
def frame(sid, n):
    p = store.sdir(sid) / "frames" / f"{n:05d}.jpg"
    if not p.exists():
        abort(404)
    return send_file(p, mimetype="image/jpeg", max_age=3600)


@app.get("/api/sessions/<sid>/landmarks")
def landmarks(sid):
    _meta_or_404(sid)
    lm = store.effective_landmarks(sid)
    return jsonify(np.round(lm, 4).tolist())


@app.put("/api/sessions/<sid>/override")
def override(sid):
    _meta_or_404(sid)
    b = request.get_json()
    store.set_override(sid, int(b["frame"]), int(b["idx"]), float(b["x"]), float(b["y"]))
    return jsonify(ok=True)


@app.delete("/api/sessions/<sid>/override/<int:n>")
def del_override(sid, n):
    _meta_or_404(sid)
    store.clear_override(sid, n)
    return jsonify(ok=True)


@app.get("/api/sessions/<sid>/metrics")
def get_metrics(sid):
    r = _compute(sid)
    if r is None:
        abort(409)
    return jsonify(r)


@app.get("/api/compare")
def compare():
    ids = [i for i in request.args.get("ids", "").split(",") if i]
    rows = []
    for sid in ids:
        meta = _meta_or_404(sid)
        r = _compute(sid)
        rows.append(dict(id=sid, name=meta["name"], created=meta["created"], setup=meta["setup"], perf=meta["perf"],
                         metrics={k: v["value"] for k, v in (r["metrics"] if r else {}).items()},
                         cadence=r and r["cadence"]))
    return jsonify(rows)


if __name__ == "__main__":
    DATA.mkdir(parents=True, exist_ok=True)
    app.run(host="127.0.0.1", port=5000, debug=False, threaded=True)
