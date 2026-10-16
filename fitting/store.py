"""Session storage: one folder per ride video under data/sessions/<id>/."""
import json
import shutil
import time
import uuid

import numpy as np

from .config import DATA, SIDES


def sdir(sid):
    return DATA / sid


def new_id():
    return time.strftime("%Y%m%d-%H%M%S-") + uuid.uuid4().hex[:4]


def read_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return default


def write_json(path, obj):
    tmp = path.with_suffix(path.suffix + ".tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False)
    tmp.replace(path)


def create(name, setup, perf):
    sid = new_id()
    (sdir(sid) / "frames").mkdir(parents=True)
    meta = dict(id=sid, name=name or sid, created=time.strftime("%Y-%m-%d %H:%M:%S"),
                setup=setup or {}, perf=perf or {}, notes="", status="uploaded",
                progress=0.0, error=None, side=None, scale=None, range=None)
    save_meta(sid, meta)
    return meta


def get_meta(sid):
    return read_json(sdir(sid) / "meta.json")


def save_meta(sid, meta):
    write_json(sdir(sid) / "meta.json", meta)


def list_sessions():
    out = []
    if DATA.exists():
        for p in sorted(DATA.iterdir()):
            m = read_json(p / "meta.json")
            if m:
                out.append(m)
    return out


def delete(sid):
    shutil.rmtree(sdir(sid), ignore_errors=True)


# ---- landmarks (normalized x,y,vis per frame) with manual overrides ----

_cache = {}


def load_pose(sid):
    return read_json(sdir(sid) / "pose.json")


def load_overrides(sid):
    return read_json(sdir(sid) / "overrides.json", {})


def set_override(sid, frame, idx, x, y):
    ov = load_overrides(sid)
    ov.setdefault(str(frame), {})[str(idx)] = [x, y]
    write_json(sdir(sid) / "overrides.json", ov)
    _cache.pop(sid, None)


def clear_override(sid, frame):
    ov = load_overrides(sid)
    ov.pop(str(frame), None)
    write_json(sdir(sid) / "overrides.json", ov)
    _cache.pop(sid, None)


def effective_landmarks(sid):
    """(n,33,3) float array, normalized coords, overrides applied (vis=1)."""
    if sid in _cache:
        return _cache[sid]
    pose = load_pose(sid)
    lm = np.array(pose["frames"], dtype=float)
    for f, d in load_overrides(sid).items():
        f = int(f)
        if f < len(lm):
            for i, (x, y) in d.items():
                lm[f, int(i)] = [x, y, 1.0]
    _cache[sid] = lm
    return lm


def invalidate(sid):
    _cache.pop(sid, None)


def detect_side(lm):
    """Side closer to camera = higher mean visibility."""
    vis = {s: float(np.mean([lm[:, v, 2].mean() for k, v in idx.items() if k != "ear"])) for s, idx in SIDES.items()}
    return max(vis, key=vis.get)


def detect_facing(lm, side):
    """+1 if rider faces image right, -1 if left (nose vs hips)."""
    nose = np.median(lm[:, 0, 0])
    hip = np.median(lm[:, SIDES[side]["hip"], 0])
    return 1 if nose > hip else -1
