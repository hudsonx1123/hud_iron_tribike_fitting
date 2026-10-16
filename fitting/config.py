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


def load_ranges():
    with open(RANGES_FILE, encoding="utf-8") as f:
        return {k: v for k, v in json.load(f).items() if not k.startswith("_")}
