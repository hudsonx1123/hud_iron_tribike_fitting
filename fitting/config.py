import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "sessions"
MODEL = ROOT / "models" / "pose_landmarker_heavy.task"
RANGES_FILE = ROOT / "ranges.json"
MAX_FRAME_WIDTH = 1280

# 側別對應的 MediaPipe 關節點 index
SIDES = {
    "left": dict(ear=7, shoulder=11, elbow=13, wrist=15, hip=23, knee=25, ankle=27, heel=29, toe=31),
    "right": dict(ear=8, shoulder=12, elbow=14, wrist=16, hip=24, knee=26, ankle=28, heel=30, toe=32),
}

SETUP_FIELDS = [
    ("saddle_height_mm", "座墊高度 (BB到座墊頂) mm"),
    ("saddle_setback_mm", "座墊後退 mm"),
    ("saddle_tilt_deg", "座墊傾角 °"),
    ("crank_length_mm", "曲柄長度 mm"),
    ("pad_stack_mm", "手墊 stack mm"),
    ("pad_reach_mm", "手墊 reach mm"),
    ("pad_width_mm", "手墊寬度 mm"),
    ("extension_length_mm", "延伸把長度 mm"),
    ("extension_angle_deg", "延伸把上翹角 °"),
    ("cleat_note", "扣片位置備註"),
]
PERF_FIELDS = [
    ("avg_power_w", "平均功率 W"),
    ("avg_hr", "平均心率"),
    ("avg_speed_kmh", "平均速度 km/h"),
    ("cda", "CdA (若有)"),
    ("comfort_1_10", "舒適度 1-10"),
    ("pain_note", "疼痛/不適"),
]


SETUP_EN = {
    "saddle_height_mm": "Saddle height (BB to saddle top) mm",
    "saddle_setback_mm": "Saddle setback mm",
    "saddle_tilt_deg": "Saddle tilt °",
    "crank_length_mm": "Crank length mm",
    "pad_stack_mm": "Pad stack mm",
    "pad_reach_mm": "Pad reach mm",
    "pad_width_mm": "Pad width mm",
    "extension_length_mm": "Extension length mm",
    "extension_angle_deg": "Extension upward tilt °",
    "cleat_note": "Cleat position notes",
}
PERF_EN = {
    "avg_power_w": "Avg power W",
    "avg_hr": "Avg heart rate",
    "avg_speed_kmh": "Avg speed km/h",
    "cda": "CdA (if known)",
    "comfort_1_10": "Comfort 1-10",
    "pain_note": "Pain / discomfort",
}


def localized_fields(lang):
    if lang != "en":
        return SETUP_FIELDS, PERF_FIELDS
    return ([(k, SETUP_EN[k]) for k, _ in SETUP_FIELDS], [(k, PERF_EN[k]) for k, _ in PERF_FIELDS])


def load_ranges(lang="zh"):
    with open(RANGES_FILE, encoding="utf-8") as f:
        out = {k: v for k, v in json.load(f).items() if not k.startswith("_")}
    if lang == "en":
        for v in out.values():
            v["label"] = v.get("label_en", v["label"])
    return out
