"use strict";
const $ = (s) => document.querySelector(s);
const api = async (url, opt = {}) => {
  if (opt.json !== undefined) {
    opt.headers = { "Content-Type": "application/json" };
    opt.body = JSON.stringify(opt.json);
  }
  const r = await fetch(url, opt);
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.json();
};
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const f1 = (v) => (v === null || v === undefined ? "–" : Number(v).toFixed(1));

let FIELDS = null;
const S = { sid: null, info: null, lm: null, frame: 0, met: null, mode: "edit", drag: null, playing: null, imgs: new Map() };
const IDX = { left: { ear: 7, shoulder: 11, elbow: 13, wrist: 15, hip: 23, knee: 25, ankle: 27, heel: 29, toe: 31 },
              right: { ear: 8, shoulder: 12, elbow: 14, wrist: 16, hip: 24, knee: 26, ankle: 28, heel: 30, toe: 32 } };

// ---------- tabs ----------
function showTab(t) {
  document.querySelectorAll("nav button").forEach((b) => b.classList.toggle("active", b.dataset.tab === t));
  ["list", "analyze", "compare", "pros"].forEach((x) => ($("#tab-" + x).hidden = x !== t));
  if (t !== "analyze") stopPlay();
  if (t === "list") loadList();
  if (t === "pros") loadPros();
}
document.querySelectorAll("nav button").forEach((b) => (b.onclick = () => showTab(b.dataset.tab)));

// ---------- forms ----------
function fieldInputs(fields, values, prefix) {
  return fields.map(([k, label]) =>
    `<label>${esc(label)}<input data-k="${prefix}:${k}" value="${esc(values?.[k] ?? "")}"></label>`).join("");
}
function readFields(root, prefix) {
  const o = {};
  root.querySelectorAll(`input[data-k^="${prefix}:"]`).forEach((i) => { if (i.value !== "") o[i.dataset.k.slice(prefix.length + 1)] = i.value; });
  return o;
}

// ---------- list ----------
let listTimer = null;
async function loadList() {
  clearTimeout(listTimer);
  const ss = await api("/api/sessions");
  const el = $("#session-list");
  el.innerHTML = ss.slice().reverse().map((m) => {
    const s = m.summary || {};
    const status = m.status === "ready" ? "" :
      m.status === "error" ? `<span class="low">${esc(t("list.fail", { e: tErr(m.error) }))}</span>` :
      `<span class="tag">${esc(t("list.analyzing", { p: (m.progress * 100).toFixed(0) }))}</span>`;
    const chips = [["knee_flexion_bdc", t("list.knee")], ["hip_closed_tdc", t("list.hip")], ["shoulder_angle", t("list.shoulder")], ["torso_angle", t("list.torso")]]
      .filter(([k]) => s[k] !== undefined).map(([k, l]) => `<span class="tag">${l} ${f1(s[k])}°</span>`).join(" ");
    return `<div class="card srow">
      <label class="srow" style="gap:10px"><input type="checkbox" class="chk cmp" value="${m.id}" ${m.status === "ready" ? "" : "disabled"}>
        <span><b>${esc(m.name)}</b> <span class="meta">${esc(m.created)}</span> ${status}<br>${chips}</span></label>
      <span>${m.status === "ready" ? `<button data-open="${m.id}">${t("list.open")}</button>` : ""}
      <button data-del="${m.id}">${t("list.del")}</button></span></div>`;
  }).join("") + (ss.length ? `<button id="b-compare" class="primary">${t("list.compare")}</button>` : `<p class='hint'>${t("list.empty")}</p>`);
  el.querySelectorAll("[data-open]").forEach((b) => (b.onclick = () => openSession(b.dataset.open)));
  el.querySelectorAll("[data-del]").forEach((b) => (b.onclick = async () => {
    if (confirm(t("list.confirmDel"))) { await api("/api/sessions/" + b.dataset.del, { method: "DELETE" }); loadList(); }
  }));
  const bc = $("#b-compare");
  if (bc) bc.onclick = () => {
    const ids = [...el.querySelectorAll(".cmp:checked")].map((c) => c.value);
    if (ids.length < 2) return alert(t("list.min2"));
    showTab("compare"); loadCompare(ids);
  };
  if (ss.some((m) => m.status === "analyzing" || m.status === "uploaded")) listTimer = setTimeout(loadList, 2000);
}

$("#upload-form").onsubmit = async (e) => {
  e.preventDefault();
  const fd = new FormData();
  fd.append("name", e.target.name.value);
  fd.append("video", e.target.video.files[0]);
  fd.append("setup", JSON.stringify(readFields($("#setup-fields"), "setup")));
  fd.append("perf", JSON.stringify(readFields($("#perf-fields"), "perf")));
  $("#upload-msg").textContent = t("up.sending");
  try { await api("/api/sessions", { method: "POST", body: fd }); } catch (err) { $("#upload-msg").textContent = err.message; return; }
  $("#upload-msg").textContent = t("up.done");
  e.target.reset(); loadList();
};

// ---------- analyze ----------
async function openSession(sid) {
  stopPlay();
  S.sid = sid; S.imgs.clear();
  S.info = await api("/api/sessions/" + sid);
  if (S.info.meta.status !== "ready") return alert(t("an.notReady"));
  S.lm = await api(`/api/sessions/${sid}/landmarks`);
  S.frame = 0; S.mode = "edit";
  const m = S.info.meta;
  $("#a-title").textContent = m.name;
  $("#sel-side").value = m.side;
  $("#a-setup").innerHTML = fieldInputs(FIELDS.setup, m.setup, "setup");
  $("#a-perf").innerHTML = fieldInputs(FIELDS.perf, m.perf, "perf");
  $("#a-notes").value = m.notes || "";
  $("#slider").max = S.info.n - 1; $("#slider").value = 0;
  document.querySelector('nav button[data-tab="analyze"]').disabled = false;
  showTab("analyze");
  await refreshMetrics();
  goFrame(0);
}

async function refreshMetrics() {
  S.met = await api(langQS(`/api/sessions/${S.sid}/metrics`));
  S.info = { ...S.info, ...(await api("/api/sessions/" + S.sid)) };
  renderMetrics(); drawStrip(); draw();
}

function renderMetrics() {
  const r = S.met, a = r.advice, el = $("#metrics-panel");
  const cyc = r.bdc.length;
  let h = `<div class="card"><b>${t("m.cycles", { n: cyc })}</b>${r.cadence ? t("m.cadence", { v: r.cadence.toFixed(0) }) : ""}
    <span class="hint">${t("m.range", { a: r.range[0], b: r.range[1] })}${r.px_per_mm ? t("m.scaled") : `<span class='noise'>${t("m.unscaled")}</span>`}</span>
    ${cyc < 4 ? `<div class='noise'>${t("m.fewCycles")}</div>` : ""}</div>`;
  if (a.fix_first) {
    h += `<div class="fix"><b>${t("m.fixFirst")}</b>${t("m.oneAtATime")}<br>${esc(a.fix_first.text)}
      <span class="hint">${t("m.deviation", { d: a.fix_first.deviation, u: esc(a.fix_first.unit) })}</span></div>`;
  } else {
    h += `<div class="fix" style="border-color:var(--ok)">${t("m.allGood")}${a.items.length ? "" : t("m.noData")}</div>`;
  }
  if (a.saddle_delta_mm !== null) {
    const d = a.saddle_delta_mm;
    h += `<div class="card">${t("m.saddle", { dir: d >= 0 ? t("m.up") : t("m.down"), mm: Math.abs(d).toFixed(0) })}
      <span class="hint">${t("m.saddleHint")}</span></div>`;
  }
  if (a.others.length) h += `<div class="card"><b>${t("m.others")}</b><ul>${a.others.map((o) => `<li>${esc(o.text)}</li>`).join("")}</ul></div>`;
  if (a.hints.length) h += `<div class="card"><b>${t("m.hints")}</b><span class="hint">${t("m.hintsNote")}</span><ul>${a.hints.map((o) => `<li>${esc(o.text)}</li>`).join("")}</ul></div>`;
  if (a.noise_note.length) h += `<div class="hint noise">${t("m.noise")}${a.noise_note.map(esc).join(t("sep"))}</div>`;
  h += `<div class="card scroll"><table><tr><th>${t("m.metric")}</th><th class="num">${t("m.value")}</th><th>${t("m.target")}</th></tr>` +
    a.items.map((i) => {
      const tgt = i.low !== null && i.high !== null ? `${i.low}–${i.high}${i.unit}` :
        i.low !== null ? `≥ ${i.low}${i.unit}` : i.high !== null ? `≤ ${i.high}${i.unit}` : t("m.track");
      const cls = i.within_noise ? "noise" : i.status;
      return `<tr><td>${esc(i.label)}${i.confidence === "rule_of_thumb" ? ` <span class="tag" title="${esc(t("m.ruleTitle"))}">${t("m.rule")}</span>` : ""}</td>
        <td class="num ${cls}">${f1(i.value)}${esc(i.unit)} <span class="hint">±${f1(i.std)} (${i.n})</span></td><td class="hint">${tgt}</td></tr>`;
    }).join("") + `</table></div>`;
  el.innerHTML = h;
}

// ---------- canvas ----------
const cv = $("#cv"), ctx = cv.getContext("2d");
function getImg(n) {
  let im = S.imgs.get(n);
  if (!im) {
    im = new Image(); im.src = `/api/sessions/${S.sid}/frame/${n}`;
    im.onload = () => { if (n === S.frame) draw(); };
    S.imgs.set(n, im);
    if (S.imgs.size > 150) S.imgs.delete(S.imgs.keys().next().value);
  }
  return im;
}
function goFrame(n) {
  S.frame = Math.max(0, Math.min(S.info.n - 1, n));
  $("#slider").value = S.frame;
  const ov = S.info.overrides || [];
  $("#a-frame").textContent = t("an.frame", { f: S.frame, n: S.info.n - 1 }) + (ov.includes(S.frame) ? t("an.fixed") : "");
  for (let k = 1; k <= 3; k++) if (S.frame + k < S.info.n) getImg(S.frame + k);
  draw();
}
function pts() {
  const ix = IDX[S.info.meta.side], L = S.lm[S.frame], o = {};
  for (const k in ix) o[k] = L[ix[k]];
  return o;
}
function draw() {
  if (!S.info || S.info.meta.status !== "ready") return;
  const im = getImg(S.frame);
  if (!im.complete || !im.naturalWidth) return;
  cv.width = im.naturalWidth; cv.height = im.naturalHeight;
  const W = cv.width, H = cv.height, u = W / 1000;
  ctx.drawImage(im, 0, 0);
  const P = pts(), X = (p) => p[0] * W, Y = (p) => p[1] * H;
  const line = (a, b, col, w = 3, dash = []) => { ctx.setLineDash(dash); ctx.strokeStyle = col; ctx.lineWidth = w * u; ctx.beginPath(); ctx.moveTo(X(P[a]), Y(P[a])); ctx.lineTo(X(P[b]), Y(P[b])); ctx.stroke(); ctx.setLineDash([]); };
  line("shoulder", "elbow", "#38bdf8"); line("elbow", "wrist", "#38bdf8");
  line("shoulder", "hip", "#facc15"); line("hip", "knee", "#4ade80"); line("knee", "ankle", "#4ade80");
  line("ankle", "toe", "#a78bfa"); line("ankle", "heel", "#a78bfa");
  line("ear", "shoulder", "#e5e7eb", 2);
  if (S.met) {
    const sc = S.info.meta.scale;
    const ang = (a, b, c) => { const v1 = [P[a][0] - P[b][0], P[a][1] - P[b][1]], v2 = [P[c][0] - P[b][0], P[c][1] - P[b][1]];
      const A = [v1[0] * W, v1[1] * H], B = [v2[0] * W, v2[1] * H];
      return Math.acos(Math.max(-1, Math.min(1, (A[0] * B[0] + A[1] * B[1]) / (Math.hypot(...A) * Math.hypot(...B) + 1e-9)))) * 180 / Math.PI; };
    const label = (p, txt) => { ctx.font = `${15 * u}px sans-serif`; const x = X(p) + 12 * u, y = Y(p) - 10 * u;
      ctx.fillStyle = "rgba(0,0,0,.65)"; const w = ctx.measureText(txt).width; ctx.fillRect(x - 3 * u, y - 15 * u, w + 6 * u, 20 * u);
      ctx.fillStyle = "#fff"; ctx.fillText(txt, x, y); };
    label(P.knee, `${t("cv.knee")} ${(180 - ang("hip", "knee", "ankle")).toFixed(0)}°`);
    label(P.hip, `${t("cv.hip")} ${ang("shoulder", "hip", "knee").toFixed(0)}°`);
    label(P.elbow, `${t("cv.elbow")} ${ang("shoulder", "elbow", "wrist").toFixed(0)}°`);
    line("knee", "elbow", "#f472b6", 2, [8 * u, 6 * u]);
    if (S.met.px_per_mm) {
      const d = Math.hypot((P.knee[0] - P.elbow[0]) * W, (P.knee[1] - P.elbow[1]) * H) / S.met.px_per_mm;
      label([(P.knee[0] + P.elbow[0]) / 2, (P.knee[1] + P.elbow[1]) / 2], `${d.toFixed(0)} mm`);
    }
    if (sc) {
      ctx.strokeStyle = "#fb923c"; ctx.lineWidth = 2 * u; ctx.beginPath();
      ctx.moveTo(sc.p1[0] * W, sc.p1[1] * H); ctx.lineTo(sc.p2[0] * W, sc.p2[1] * H); ctx.stroke();
      label(sc.p2, `${sc.mm} mm`);
    }
    if (S.met.bdc.includes(S.frame)) badge("BDC", "#4ade80");
    else if (S.met.tdc.includes(S.frame)) badge("TDC", "#38bdf8");
    const r = S.info.meta.range;
    if (r && (S.frame < r[0] || S.frame > r[1])) badge(t("cv.out"), "#fb923c", 1);
  }
  for (const k in P) {
    ctx.fillStyle = k === (S.drag && S.drag.name) ? "#fff" : "#ef4444";
    ctx.beginPath(); ctx.arc(X(P[k]), Y(P[k]), 6 * u, 0, 7); ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5 * u; ctx.stroke();
  }
  if (S.scalePts) S.scalePts.forEach((p) => { ctx.fillStyle = "#fb923c"; ctx.beginPath(); ctx.arc(p[0] * W, p[1] * H, 6 * u, 0, 7); ctx.fill(); });
}
function badge(t, col, row = 0) {
  const u = cv.width / 1000; ctx.font = `bold ${22 * u}px sans-serif`;
  ctx.fillStyle = col; ctx.fillText(t, 14 * u, (34 + row * 28) * u);
}
function drawStrip() {
  const c = $("#strip"), g = c.getContext("2d");
  c.width = c.clientWidth * (devicePixelRatio || 1); g.clearRect(0, 0, c.width, c.height);
  const n = S.info.n, sx = (f) => (f + 0.5) / n * c.width;
  const r = S.info.meta.range;
  if (r) { g.fillStyle = "rgba(251,146,60,.35)"; g.fillRect(sx(r[0]), 0, sx(r[1]) - sx(r[0]), c.height); }
  g.fillStyle = "#4ade80"; S.met.bdc.forEach((f) => g.fillRect(sx(f) - 1, 0, 2, 7));
  g.fillStyle = "#38bdf8"; S.met.tdc.forEach((f) => g.fillRect(sx(f) - 1, 7, 2, 7));
  g.fillStyle = "#ef4444"; (S.info.overrides || []).forEach((f) => g.fillRect(sx(f) - 2, 0, 4, c.height));
}

function evtPos(e) {
  const b = cv.getBoundingClientRect();
  return [(e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height];
}
cv.onpointerdown = (e) => {
  const [x, y] = evtPos(e);
  if (S.mode === "scale") {
    (S.scalePts ||= []).push([x, y]);
    if (S.scalePts.length === 2) {
      const mm = parseFloat(prompt(t("an.scalePrompt")));
      if (mm > 0) {
        api("/api/sessions/" + S.sid, { method: "PATCH", json: { scale: { p1: S.scalePts[0], p2: S.scalePts[1], mm } } })
          .then((m) => { S.info.meta = m; refreshMetrics(); });
      }
      S.scalePts = null; setMode("edit");
    }
    draw(); return;
  }
  const P = pts(), b = cv.getBoundingClientRect();
  let best = null, bd = 16;
  for (const k in P) {
    const d = Math.hypot((P[k][0] - x) * b.width, (P[k][1] - y) * b.height);
    if (d < bd) { bd = d; best = k; }
  }
  if (best) { S.drag = { name: best, idx: IDX[S.info.meta.side][best] }; cv.setPointerCapture(e.pointerId); stopPlay(); }
};
cv.onpointermove = (e) => {
  if (!S.drag) return;
  const [x, y] = evtPos(e);
  S.lm[S.frame][S.drag.idx] = [Math.min(1, Math.max(0, x)), Math.min(1, Math.max(0, y)), 1];
  draw();
};
cv.onpointerup = async () => {
  if (!S.drag) return;
  const p = S.lm[S.frame][S.drag.idx], d = S.drag; S.drag = null;
  await api(`/api/sessions/${S.sid}/override`, { method: "PUT", json: { frame: S.frame, idx: d.idx, x: p[0], y: p[1] } });
  await refreshMetrics(); goFrame(S.frame);
};

function setMode(m) {
  S.mode = m; $("#b-scale").classList.toggle("on", m === "scale");
  $("#a-hint").textContent = m === "scale" ? t("an.hintScale") : t("an.hintEdit");
  cv.style.cursor = m === "scale" ? "copy" : "crosshair";
}

// ---------- controls ----------
function stopPlay() { if (S.playing) { clearInterval(S.playing); S.playing = null; $("#b-play").textContent = "▶"; } }
$("#b-play").onclick = () => {
  if (S.playing) return stopPlay();
  $("#b-play").textContent = "⏸";
  S.playing = setInterval(() => goFrame(S.frame + 1 >= S.info.n ? 0 : S.frame + 1), 1000 / Math.min(30, S.info.fps));
};
$("#slider").oninput = (e) => { stopPlay(); goFrame(+e.target.value); };
$("#b-prev").onclick = () => goFrame(S.frame - 1);
$("#b-next").onclick = () => goFrame(S.frame + 1);
const jump = (arr, dir) => {
  const c = dir > 0 ? arr.find((f) => f > S.frame) : [...arr].reverse().find((f) => f < S.frame);
  if (c !== undefined) goFrame(c);
};
$("#b-nbdc").onclick = () => jump(S.met.bdc, 1); $("#b-pbdc").onclick = () => jump(S.met.bdc, -1);
$("#b-ntdc").onclick = () => jump(S.met.tdc, 1); $("#b-ptdc").onclick = () => jump(S.met.tdc, -1);
$("#b-scale").onclick = () => { S.scalePts = null; setMode(S.mode === "scale" ? "edit" : "scale"); };
const setRange = async (r) => { S.info.meta = await api("/api/sessions/" + S.sid, { method: "PATCH", json: { range: r } }); await refreshMetrics(); };
$("#b-rs").onclick = () => { const r = S.info.meta.range || [0, S.info.n - 1]; setRange([S.frame, Math.max(S.frame, r[1])]); };
$("#b-re").onclick = () => { const r = S.info.meta.range || [0, S.info.n - 1]; setRange([Math.min(S.frame, r[0]), S.frame]); };
$("#b-rr").onclick = () => setRange(null);
$("#b-reset").onclick = async () => {
  await api(`/api/sessions/${S.sid}/override/${S.frame}`, { method: "DELETE" });
  S.lm = await api(`/api/sessions/${S.sid}/landmarks`); await refreshMetrics(); goFrame(S.frame);
};
$("#sel-side").onchange = async (e) => {
  S.info.meta = await api("/api/sessions/" + S.sid, { method: "PATCH", json: { side: e.target.value } });
  await refreshMetrics(); goFrame(S.frame);
};
$("#b-save").onclick = async () => {
  const body = { setup: readFields($("#a-setup"), "setup"), perf: readFields($("#a-perf"), "perf"), notes: $("#a-notes").value };
  S.info.meta = await api("/api/sessions/" + S.sid, { method: "PATCH", json: body });
  $("#save-msg").textContent = t("an.saved"); setTimeout(() => ($("#save-msg").textContent = ""), 1500);
};
document.addEventListener("keydown", (e) => {
  if ($("#tab-analyze").hidden || /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && document.activeElement.type !== "range") return;
  if (e.key === "ArrowRight") { goFrame(S.frame + 1); e.preventDefault(); }
  else if (e.key === "ArrowLeft") { goFrame(S.frame - 1); e.preventDefault(); }
  else if (e.key === " ") { $("#b-play").click(); e.preventDefault(); }
});
window.addEventListener("resize", () => { if (S.met) drawStrip(); });

// ---------- compare ----------
let CMP_IDS = null;
async function loadCompare(ids) {
  CMP_IDS = ids;
  const rows = (await api("/api/compare?ids=" + ids.join(","))).sort((a, b) => a.created.localeCompare(b.created));
  const R = FIELDS.ranges;
  const mk = (title, keys, labelOf, get, delta) => `<tr><th colspan="${rows.length + 2}">${title}</th></tr>` + keys.map((k) => {
    const vals = rows.map((r) => get(r, k));
    const num = vals.map((v) => parseFloat(v));
    const d = delta && num.length > 1 && isFinite(num[0]) && isFinite(num.at(-1)) ? (num.at(-1) - num[0]) : null;
    if (vals.every((v) => v === undefined || v === "")) return "";
    return `<tr><td>${esc(labelOf(k))}</td>${vals.map((v) => `<td class="num">${v === undefined ? "–" : isFinite(parseFloat(v)) && delta ? f1(v) : esc(v)}</td>`).join("")}
      <td class="num hint">${d === null ? "" : (d > 0 ? "+" : "") + f1(d)}</td></tr>`;
  }).join("");
  const mkeys = Object.keys(R).concat(["leg_extension_mm"]);
  const lab = { leg_extension_mm: t("cmp.legDist") };
  $("#compare-out").innerHTML = `<div class="card scroll"><table>
    <tr><th></th>${rows.map((r) => `<th class="num">${esc(r.name)}<br><span class="hint">${esc(r.created)}</span></th>`).join("")}<th class="num">${t("cmp.delta")}</th></tr>
    ${mk(t("cmp.setup"), FIELDS.setup.map((x) => x[0]), (k) => FIELDS.setup.find((x) => x[0] === k)[1], (r, k) => r.setup[k], true)}
    ${mk(t("cmp.metrics"), mkeys, (k) => (R[k] ? R[k].label : lab[k]), (r, k) => r.metrics[k], true)}
    ${mk(t("cmp.perf"), FIELDS.perf.map((x) => x[0]), (k) => FIELDS.perf.find((x) => x[0] === k)[1], (r, k) => r.perf[k], true)}
  </table></div>`;
}

// ---------- language ----------
async function setLang(l) {
  const setupVals = readFields($("#setup-fields"), "setup"), perfVals = readFields($("#perf-fields"), "perf");
  const aSetup = readFields($("#a-setup"), "setup"), aPerf = readFields($("#a-perf"), "perf");
  LANG = l;
  try { localStorage.setItem("lang", l); } catch (e) { /* ignore */ }
  applyStaticI18n();
  FIELDS = await api(langQS("/api/fields"));
  $("#setup-fields").innerHTML = fieldInputs(FIELDS.setup, setupVals, "setup");
  $("#perf-fields").innerHTML = fieldInputs(FIELDS.perf, perfVals, "perf");
  if (S.info) {
    $("#a-setup").innerHTML = fieldInputs(FIELDS.setup, aSetup, "setup");
    $("#a-perf").innerHTML = fieldInputs(FIELDS.perf, aPerf, "perf");
  }
  setMode(S.mode);
  if (!$("#tab-list").hidden) loadList();
  if (!$("#tab-analyze").hidden && S.sid) { await refreshMetrics(); goFrame(S.frame); }
  if (!$("#tab-compare").hidden && CMP_IDS) loadCompare(CMP_IDS);
  if (!$("#tab-pros").hidden) loadPros();
}
$("#lang-btn").onclick = () => setLang(LANG === "en" ? "zh" : "en");

// ---------- init ----------
(async () => {
  applyStaticI18n();
  FIELDS = await api(langQS("/api/fields"));
  $("#setup-fields").innerHTML = fieldInputs(FIELDS.setup, {}, "setup");
  $("#perf-fields").innerHTML = fieldInputs(FIELDS.perf, {}, "perf");
  setMode("edit");
  loadList();
})();
