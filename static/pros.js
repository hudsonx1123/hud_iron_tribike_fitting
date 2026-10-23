// ---------- 職業選手對照 tab ----------
// 「選手」= 紀錄中 meta.pro === true 的 session(meta.short 為圓點代號,meta.lowconf 為低可信度指標)。
// 「你」= 其餘紀錄中由下拉選的一筆。數值取自各 session 的指標,新增紀錄後這個分頁會自動更新。
const PRO_METRICS = ["knee_flexion_bdc", "hip_closed_tdc", "shoulder_angle", "upper_arm_angle", "torso_angle", "forearm_angle", "elbow_angle"]
  .map((key) => ({ key, get desc() { return t("pd." + key); } }));
const PRO_BIG_GAP = 8; // 小於此差距視為雜訊(追車鏡頭與固定機位的系統誤差)
let PROS = { sessions: null, fields: null, youId: null };

async function loadPros() {
  const [ss, fl] = await Promise.all([fetch("/api/sessions").then((r) => r.json()), fetch(langQS("/api/fields")).then((r) => r.json())]);
  PROS.sessions = ss.filter((s) => s.status === "ready" && s.summary);
  PROS.fields = fl;
  const mine = PROS.sessions.filter((s) => !s.pro).sort((a, b) => a.created.localeCompare(b.created));
  if (!mine.some((s) => s.id === PROS.youId)) PROS.youId = mine.length ? mine[mine.length - 1].id : null;
  $("#pros-you").innerHTML = mine.map((s) => `<option value="${s.id}" ${s.id === PROS.youId ? "selected" : ""}>${esc(s.name)}(${esc(s.created.slice(0, 10))})</option>`).join("");
  renderPros();
}

function prosColors() {
  const cs = getComputedStyle(document.documentElement), g = (n) => cs.getPropertyValue(n).trim();
  return { you: g("--you") || "#e2561f", pro: g("--acc"), mut: g("--mut"), line: g("--line"), card: g("--card"), band: g("--okbg") || "#cfe7e2", bandLine: g("--ok") };
}

function prosStack(items, minGap) { // 垂直分層,避免圓點重疊
  const lanes = [], out = [];
  items.slice().sort((a, b) => a.x - b.x).forEach((it) => {
    let l = 0;
    while (lanes[l] !== undefined && it.x - lanes[l] < minGap) l++;
    lanes[l] = it.x; out.push({ it, l });
  });
  return out;
}

function prosStrip(m, you, pros, rng, w, C) {
  const padL = 18, padR = 18, top = 18, R = 11, laneH = 26;
  const vals = [you.val, ...pros.map((p) => p.val)];
  if (rng) { if (rng.low != null) vals.push(rng.low); if (rng.high != null) vals.push(rng.high); }
  const step = Math.max(...vals) - Math.min(...vals) > 60 ? 20 : Math.max(...vals) - Math.min(...vals) > 30 ? 10 : 5;
  const min = Math.floor((Math.min(...vals) - 3) / step) * step, max = Math.ceil((Math.max(...vals) + 3) / step) * step;
  const x = (v) => padL + ((v - min) / (max - min)) * (w - padL - padR);
  const pts = [{ k: t("you"), val: you.val, you: 1, name: t("you") }, ...pros].map((p) => ({ ...p, x: x(p.val) }));
  const st = prosStack(pts, R * 2 + 2), lanes = Math.max(...st.map((s) => s.l)) + 1;
  const axisY = top + lanes * laneH + 8, H = axisY + 22;
  let s = `<svg viewBox="0 0 ${w} ${H}" role="img" aria-label="${esc(m.label)}">`;
  if (rng && (rng.low != null || rng.high != null)) {
    const a = rng.low == null ? min : Math.max(min, rng.low), b = rng.high == null ? max : Math.min(max, rng.high);
    s += `<rect x="${x(a)}" y="${top - 8}" width="${Math.max(2, x(b) - x(a))}" height="${axisY - top + 8}" fill="${C.band}" stroke="${C.bandLine}" stroke-opacity=".5" rx="3"/>`;
  }
  s += `<line x1="${padL}" x2="${w - padR}" y1="${axisY}" y2="${axisY}" stroke="${C.line}"/>`;
  for (let t = Math.ceil(min / step) * step; t <= max; t += step)
    s += `<line x1="${x(t)}" x2="${x(t)}" y1="${axisY}" y2="${axisY + 4}" stroke="${C.mut}"/><text x="${x(t)}" y="${axisY + 16}" text-anchor="middle" fill="${C.mut}" font-size="11">${t}°</text>`;
  st.forEach(({ it, l }) => {
    const cy = top + l * laneH + R / 2, col = it.you ? C.you : C.pro;
    s += `<line x1="${it.x}" x2="${it.x}" y1="${cy}" y2="${axisY}" stroke="${col}" stroke-opacity=".35" stroke-dasharray="2 3"/>`;
    s += `<circle cx="${it.x}" cy="${cy}" r="${it.you ? R + 2 : R}" fill="${it.low ? C.card : col}" stroke="${col}" stroke-width="${it.low ? 1.8 : 0}"/>`;
    s += `<text x="${it.x}" y="${cy + 4}" text-anchor="middle" font-size="10.5" font-weight="600" fill="${it.low ? col : "#fff"}">${esc(it.k)}</text>`;
    s += `<title>${esc(it.name)}: ${it.val.toFixed(1)}°${it.low ? t("pro.lowTip") : ""}</title>`;
  });
  return s + "</svg>";
}

function prosMedian(a) {
  const s = a.slice().sort((p, q) => p - q), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}


// 依你與選手中位的差距(>= PRO_BIG_GAP)產生調整順序;小於門檻一律視為雜訊、不動。
function prosPlan(rows, you) {
  const by = Object.fromEntries(rows.map((x) => [x.pm.key, x]));
  const d = (k) => (by[k] ? by[k].yv - by[k].med : null);
  const inR = (k) => by[k] && (by[k].r.low == null || by[k].yv >= by[k].r.low) && (by[k].r.high == null || by[k].yv <= by[k].r.high);
  const big = (k) => d(k) != null && Math.abs(d(k)) >= PRO_BIG_GAP;
  const f = (k) => by[k].yv.toFixed(1), m = (k) => by[k].med.toFixed(1);
  const steps = [];
  const S_ = (type, key, vars) => ({ t: type, h: t(key + ".h"), p: t(key + ".p", vars) });
  // 1. 座高 / 髖角
  if (by.knee_flexion_bdc && by.hip_closed_tdc) {
    const dev = (k) => { const x = by[k]; return x.r.low != null && x.yv < x.r.low ? x.r.low - x.yv : x.r.high != null && x.yv > x.r.high ? x.yv - x.r.high : 0; };
    const kd = dev("knee_flexion_bdc"), hd = dev("hip_closed_tdc"), NOISE = 3; // 2D 姿態估計誤差下限約 3°
    const note = (name, v) => (v > 0 ? t("pp.offTarget", { name, v: v.toFixed(1) }) : "");
    const vars = { k: f("knee_flexion_bdc"), h: f("hip_closed_tdc") };
    if (kd > NOISE || hd > NOISE) steps.push(S_("go", "pp.seat.go", vars));
    else steps.push(S_("hold", "pp.seat.hold", { ...vars,
      notes: [note(t("pp.kneeName"), kd), note(t("pp.hipName"), hd)].filter(Boolean).join(t("sep")),
      tail: kd || hd ? t("pp.tailErr") : t("pp.tailOk") }));
  }
  // 2. 前臂上翹
  if (by.forearm_angle) {
    const x = d("forearm_angle"), v = { y: f("forearm_angle"), m: m("forearm_angle") };
    steps.push(big("forearm_angle") && x < 0 ? S_("go", "pp.fa.up", v) : big("forearm_angle") ? S_("go", "pp.fa.chk", v) : S_("hold", "pp.fa.hold", v));
  }
  // 3. 軀幹角
  if (by.torso_angle) {
    const x = d("torso_angle"), hipRoom = by.hip_closed_tdc && by.hip_closed_tdc.r.low != null ? by.hip_closed_tdc.yv - by.hip_closed_tdc.r.low : null;
    const v = { y: f("torso_angle"), m: m("torso_angle") };
    if (big("torso_angle") && x > 0) {
      const tight = hipRoom != null && hipRoom < 5;
      steps.push(tight ? S_("hold", "pp.to.tight", { ...v, room: hipRoom.toFixed(1) })
        : S_("go", "pp.to.go", { ...v, room: hipRoom != null ? t("pp.to.room", { r: hipRoom.toFixed(1) }) : "" }));
    } else if (big("torso_angle")) steps.push(S_("hold", "pp.to.flat", v));
    else steps.push(S_("hold", "pp.to.hold", v));
  }
  // 4. 手肘角(跟著變)
  if (by.elbow_angle) {
    const v = { y: f("elbow_angle"), m: m("elbow_angle") };
    steps.push(big("elbow_angle") ? S_("follow", "pp.el.follow", v) : { t: "hold", h: t("pp.el.follow.h"), p: t("pp.el.hold.p", v) });
  }
  // 5. 上臂角
  if (by.upper_arm_angle) steps.push(S_("hold", "pp.ua", { y: f("upper_arm_angle"), m: m("upper_arm_angle"), out: inR("upper_arm_angle") ? "" : t("pp.ua.out") }));
  let n = 0;
  return steps.map((s) => ({ ...s, tag: s.t === "go" ? t("pp.step", { n: ++n }) : s.t === "follow" ? t("pp.follow") : t("pp.hold") }));
}

function renderPros() {
  const out = $("#pros-out");
  const you = PROS.sessions.find((s) => s.id === PROS.youId);
  const pros = PROS.sessions.filter((s) => s.pro);
  if (!you || !pros.length) {
    out.innerHTML = `<div class="card"><p>${t("pro.none")}</p></div>`;
    return;
  }
  const C = prosColors(), ranges = PROS.fields.ranges;
  const w = Math.max(280, out.clientWidth - 30);
  const rows = PRO_METRICS.map((pm) => {
    const r = ranges[pm.key] || {};
    const yv = you.summary[pm.key];
    const pv = pros.filter((p) => p.summary[pm.key] != null).map((p) => ({ k: p.short || p.name[0], val: p.summary[pm.key], low: (p.lowconf || []).includes(pm.key), name: p.name }));
    if (yv == null || !pv.length) return null;
    return { pm, r, yv, pv, med: prosMedian(pv.map((p) => p.val)) };
  }).filter(Boolean);
  const label = (x) => x.r.label || x.pm.key;
  const tg = (r) => (r.low == null && r.high == null ? t("pro.trackOnly") : r.high == null ? t("pro.tgGe", { v: r.low }) : r.low == null ? t("pro.tgLe", { v: r.high }) : t("pro.tgBetween", { a: r.low, b: r.high }));

  let h = `<div class="legend"><span><i class="pchip you">${esc(t("you"))}</i>${esc(you.name)}</span>` +
    pros.map((p) => `<span><i class="pchip">${esc(p.short || "?")}</i>${esc(p.name.replace(/\s*\(.*\)$/, ""))}</span>`).join("") +
    `<span><i class="pchip low">?</i>${t("pro.lowLegend")}</span><span><i class="pband"></i>${t("pro.bandLegend")}</span></div>`;

  const gaps = rows.map((x) => ({ x, d: x.yv - x.med })).sort((a, b) => Math.abs(b.d) - Math.abs(a.d));
  const big = gaps.filter((g) => Math.abs(g.d) >= PRO_BIG_GAP);
  h += `<div class="card"><b>${t("pro.overview")}</b><p class="hint" style="margin:4px 0 0">${big.length
    ? t("pro.bigList", { g: PRO_BIG_GAP }) + big.map((g) => `${esc(label(g.x))} <b class="gapbig">${g.d > 0 ? "+" : ""}${g.d.toFixed(1)}°</b>`).join(t("sep"))
    : t("pro.noBig", { g: PRO_BIG_GAP })}</p></div>`;

  h += rows.map((x) => {
    const d = x.yv - x.med, bigGap = Math.abs(d) >= PRO_BIG_GAP;
    const inRange = (x.r.low == null || x.yv >= x.r.low) && (x.r.high == null || x.yv <= x.r.high);
    return `<div class="card prow"><div class="srow"><b>${esc(label(x))}</b><span class="hint">${t("pro.rowLine", { y: x.yv.toFixed(1), m: x.med.toFixed(1), c: bigGap ? "gapbig" : "", d: (d > 0 ? "+" : "") + d.toFixed(1) })}</span></div>
      <div class="hint">${esc(x.pm.desc)} ${tg(x.r)}${x.r.high != null || x.r.low != null ? (inRange ? t("pro.inRange") : t("pro.outRange")) : ""}</div>
      ${prosStrip(x.pm, { val: x.yv }, x.pv, x.r, w, C)}</div>`;
  }).join("");

  h += `<div class="card scroll"><table><tr><th>${t("pro.metric")}</th><th class="num">${esc(t("you"))}</th>` + pros.map((p) => `<th class="num" title="${esc(p.name)}">${esc(p.short || "?")}</th>`).join("") + `<th class="num">${t("pro.median")}</th><th class="num">${t("pro.gap")}</th></tr>` +
    rows.map((x) => {
      const d = x.yv - x.med;
      return `<tr><td>${esc(label(x))}</td><td class="num yourv">${x.yv.toFixed(1)}</td>` +
        pros.map((p) => { const v = p.summary[x.pm.key]; return `<td class="num ${(p.lowconf || []).includes(x.pm.key) ? "lowv" : ""}">${v == null ? "—" : v.toFixed(1)}</td>`; }).join("") +
        `<td class="num">${x.med.toFixed(1)}</td><td class="num ${Math.abs(d) >= PRO_BIG_GAP ? "gapbig" : ""}">${d > 0 ? "+" : ""}${d.toFixed(1)}°</td></tr>`;
    }).join("") + `</table></div>`;

  h += `<div class="card"><b>${t("pro.plan")}</b><p class="hint" style="margin:4px 0 8px">${t("pro.planNote")}</p><ol class="plan">` +
    prosPlan(rows, you).map((st) => `<li><span class="ptag ${st.t}">${esc(st.tag)}</span><div><b>${esc(st.h)}</b><div class="hint">${esc(st.p)}</div></div></li>`).join("") + `</ol></div>`;

  h += `<div class="card"><b>${t("pro.limits")}</b><ul class="hint" style="margin:6px 0 0;padding-left:1.2em">
    <li>${t("pro.l1", { g: PRO_BIG_GAP })}</li><li>${t("pro.l2")}</li><li>${t("pro.l3")}</li><li>${t("pro.l4")}</li></ul></div>`;
  out.innerHTML = h;
}

$("#pros-you").onchange = (e) => { PROS.youId = e.target.value; renderPros(); };
let _prosRt;
addEventListener("resize", () => { if (!$("#tab-pros").hidden) { clearTimeout(_prosRt); _prosRt = setTimeout(renderPros, 120); } });
matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", () => { if (PROS.sessions && !$("#tab-pros").hidden) renderPros(); });
if (location.hash === "#pros") showTab("pros");
