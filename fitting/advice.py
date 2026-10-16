"""Compare metrics with target ranges and produce adjustment advice (tri-bike oriented)."""
import math

# (key, direction) -> advice text. direction: "low" = below range, "high" = above range
TEXT = {
    ("knee_flexion_bdc", "low"): "膝在 BDC 伸得太直 → 座墊偏高。降低座墊。",
    ("knee_flexion_bdc", "high"): "膝在 BDC 彎曲太多 → 座墊偏低。升高座墊(注意髖角會變大)。",
    ("hip_angle", "low"): "髖角太閉(軀幹壓太近大腿)→ 抬高手墊/延伸把,或座墊前移/加大座管角,或縮短延伸把。",
    ("hip_angle", "high"): "髖角偏開 → 姿勢偏高(風阻較大),可降低手墊,但需確認髖角不會小於 95°。",
    ("elbow_angle", "low"): "手肘角太小 → 延伸把偏短或手墊太靠前;可加長延伸把或把手墊後移。",
    ("elbow_angle", "high"): "手肘角偏大(手臂太伸直)→ 縮短延伸把或手墊前移。",
    ("upper_arm_angle", "low"): "上臂向後傾 → 手墊偏後(手肘在肩膀後方),手墊可前移。",
    ("upper_arm_angle", "high"): "上臂向前傾太多 → 手墊太靠前,可把手墊後移。",
    ("knee_elbow_gap_mm", "low"): "膝蓋離手肘太近(可能碰到)→ 手墊前移或抬高、或座墊後移。",
    ("knee_elbow_gap_mm", "high"): "膝-手肘間距偏大 → 姿勢可能還能再壓低、再收緊。",
}
# 先處理座墊,再處理髖/軀幹,最後手臂:一次只動一個變數
PRIORITY = ["knee_flexion_bdc", "hip_angle", "knee_elbow_gap_mm", "elbow_angle", "upper_arm_angle"]
MIN_NOISE_DEG = 3.0  # 2D 姿態估計的典型誤差下限 (文獻 3-9°)


def evaluate(result, ranges):
    items = []
    for key, r in ranges.items():
        m = result["metrics"].get(key)
        if not m:
            continue
        v = m["value"]
        status = "tracked"
        if r.get("low") is not None and r.get("high") is not None:
            status = "ok" if r["low"] <= v <= r["high"] else ("low" if v < r["low"] else "high")
        noise = max(m["std"], MIN_NOISE_DEG) if r.get("unit") == "°" else m["std"]
        dev = 0.0
        if status in ("low", "high"):
            dev = r["low"] - v if status == "low" else v - r["high"]
        items.append(dict(key=key, label=r["label"], unit=r["unit"], value=v, std=m["std"], n=m["n"],
                          low=r.get("low"), high=r.get("high"), ideal=r.get("ideal"),
                          confidence=r["confidence"], status=status, deviation=dev,
                          within_noise=status in ("low", "high") and dev <= noise))
    return items


def saddle_delta_mm(result, ranges):
    """Vertical-ish saddle change needed to bring BDC knee flexion to its ideal (law of cosines)."""
    g, px = result.get("geo"), result.get("px_per_mm")
    ideal = ranges.get("knee_flexion_bdc", {}).get("ideal")
    if not g or not px or ideal is None:
        return None
    a, b = g["thigh_px"], g["shank_px"]
    theta = math.radians(180 - ideal)
    d_target = math.sqrt(a * a + b * b - 2 * a * b * math.cos(theta))
    return (d_target - g["hip_ankle_px"]) / px


def advise(result, ranges):
    items = evaluate(result, ranges)
    todo = [i for i in items if i["status"] in ("low", "high")]
    todo.sort(key=lambda i: PRIORITY.index(i["key"]) if i["key"] in PRIORITY else 99)
    real = [i for i in todo if not i["within_noise"]]
    lines = []
    for i in real:
        lines.append(dict(key=i["key"], text=TEXT.get((i["key"], i["status"]), ""), deviation=round(i["deviation"], 1),
                          unit=i["unit"]))
    delta = saddle_delta_mm(result, ranges)
    out = dict(items=items, fix_first=lines[0] if lines else None, others=lines[1:],
               good=[i["label"] for i in items if i["status"] == "ok"],
               noise_note=[i["label"] for i in todo if i["within_noise"]],
               saddle_delta_mm=None if delta is None else round(delta, 1))
    return out
