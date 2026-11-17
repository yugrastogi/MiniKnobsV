// Phone Knobs — 14-knob synth panel (12 main + 2 side knobs)
// Pre-mapped standard CCs, pitch/mod wheels, and two-way MIDI sync (DAW/plugin -> phone).
(() => {
  "use strict";

  const STORE = "phoneknobs.synth12.v3";
  const DRAG_RANGE = 150;
  const SWEEP = 135;
  const MAX_PAGES = 16;
  const LOCAL_HOLDOFF = 300; // ms: ignore DAW echo right after you touched a control

  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const uid = () => Math.random().toString(36).slice(2, 9);
  const midiVal = (n) => Math.round(n * 127);

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  }

  document.addEventListener("pointerdown", () => {
    if (screen.orientation && screen.orientation.lock) {
      screen.orientation.lock("landscape").catch(() => {});
    }
  }, { once: true });

  // ------------------------------------------------------------ default layout
  // Only CUTOFF (CC 74) and EMPHASIS/RESONANCE (CC 71) are pre-mapped: they are the standard MIDI
  // "sound controller" CCs that many synths react to without learning. The other twelve knobs
  // (10 in the main grid + 2 stacked on the right plate) send free CCs 20-31.
  function defaultControls() {
    const k = (label, cc, n, free) => {
      const c = { id: uid(), type: "knob", label, cc, n };
      if (free) c.free = true;
      return c;
    };
    const out = [k("CUTOFF", 74, 0.6), k("EMPHASIS", 71, 0.2)];   // Moog's name for resonance
    for (let i = 1; i <= 12; i++) out.push(k("", 19 + i, 0.5, true));
    return out;
  }

  function createPage(name, ch = 1) {
    return { id: uid(), name, ch, mod: 0, controls: defaultControls() };
  }

  // each page gets its own MIDI channel, so one page = one plugin
  function freeChannel() {
    const used = new Set(state.pages.map((p) => p.ch || 1));
    for (let c = 1; c <= 16; c++) if (!used.has(c)) return c;
    return 1;
  }

  function starter() {
    const p = createPage("Synth 1");
    return { v: 3, active: p.id, pages: [p] };
  }

  // migrate older 12-knob saves to 14 knobs and clean up legacy labels
  function normalizePages(s) {
    let changed = false;
    for (const p of s.pages) {
      for (const c of p.controls) {
        if (/^KNOB \d+$/.test(c.label)) { c.label = ""; changed = true; }
        if (c.cc === 71 && c.label === "RESONANCE") { c.label = "EMPHASIS"; changed = true; }
      }
      const knobs = p.controls.filter((c) => c.type === "knob");
      if (knobs.length < 14) {
        const usedCCs = new Set(knobs.map((c) => c.cc));
        let nextCC = 30;
        while (p.controls.filter((c) => c.type === "knob").length < 14) {
          while (usedCCs.has(nextCC) && nextCC < 119) nextCC++;
          usedCCs.add(nextCC);
          p.controls.push({ id: uid(), type: "knob", label: "", cc: nextCC, n: 0.5, free: true });
          changed = true;
        }
      }
    }
    return changed;
  }

  const valid = (s) => !!(s && s.v === 3 && Array.isArray(s.pages) && s.pages.length &&
    s.pages.every((p) => Array.isArray(p.controls)));

  function readLocal() {
    try { return JSON.parse(localStorage.getItem(STORE)); } catch (_) { return null; }
  }
  function writeLocal() {
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch (_) {}
  }

  let state = readLocal();
  if (!valid(state)) state = starter();
  else if (normalizePages(state)) writeLocal();

  let editing = false;
  let dirty = false;
  let saveTimer = null;
  let fbTimer = null;
  const painters = new Map();

  function save() {
    writeLocal();
    dirty = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(pushLayouts, 350);
  }
  function pushLayouts() {
    if (ws && ws.readyState === 1) {
      ws.send(JSON.stringify({ t: "save", layouts: state }));
      dirty = false;
    }
  }
  // values changed by the DAW are persisted too, but lazily
  function scheduleFeedbackSave() {
    clearTimeout(fbTimer);
    fbTimer = setTimeout(save, 800);
  }

  const currentPage = () => state.pages.find((p) => p.id === state.active) || state.pages[0];
  const pageCh = () => currentPage().ch || 1;

  function findControl(id) {
    const page = currentPage();
    const ctrl = page.controls.find((c) => c.id === id);
    return ctrl ? { page, ctrl } : null;
  }

  // ------------------------------------------------- local-touch guard (echo)
  const localTouch = new Map();
  const touch = (key) => localTouch.set(key, performance.now());
  const isLocal = (key) => performance.now() - (localTouch.get(key) ?? -1e9) < LOCAL_HOLDOFF;

  // ---------------------------------------------------------- binary MIDI I/O
  let ws = null, retry = null;
  const sent = new Map();
  const txBuf = new Uint8Array(3);

  function setStatus(text) {
    const statusEl = $("#status");
    if (statusEl) statusEl.textContent = text;
  }

  function sendRawCC(ch, cc, v) {
    if (!ws || ws.readyState !== 1) return;
    txBuf[0] = 0xB0 | ((ch - 1) & 0x0F);
    txBuf[1] = cc & 0x7F;
    txBuf[2] = v & 0x7F;
    ws.send(txBuf);
  }

  function sendCtrl(ctrl, v) {
    touch("k" + ctrl.id);
    sendRawCC(ctrl.ch || pageCh(), ctrl.cc, v);
  }

  function sendPitchBend(ch, value14) {
    if (!ws || ws.readyState !== 1) return;
    const c = clamp(Math.round(value14), 0, 16383);
    txBuf[0] = 0xE0 | ((ch - 1) & 0x0F);
    txBuf[1] = c & 0x7F;
    txBuf[2] = (c >> 7) & 0x7F;
    ws.send(txBuf);
  }

  // DAW / plugin -> phone. Fires when you change a preset or move a knob in the plugin,
  // as long as the DAW sends those CCs out to the "Phone Knobs" MIDI port.
  function handleIncomingMidi(buf) {
    const bytes = new Uint8Array(buf);
    let changed = false;

    for (let i = 0; i + 2 < bytes.length; i += 3) {
      const status = bytes[i], d1 = bytes[i + 1], d2 = bytes[i + 2];
      const type = status & 0xF0;
      const ch = (status & 0x0F) + 1;

      if (type === 0xB0) {
        const cur = currentPage();
        for (const page of state.pages) {
          const pch = page.ch || 1;
          for (const c of page.controls) {
            if ((c.ch || pch) !== ch || c.cc !== d1) continue;
            if (isLocal("k" + c.id)) continue;
            const n = d2 / 127;
            if (c.n === n) continue;
            c.n = n;
            changed = true;
            sent.set(c.id, d2);
            if (page === cur) { const fn = painters.get(c.id); if (fn) fn(true); }
          }
        }
        if (d1 === 1) {
          for (const page of state.pages) {
            if ((page.ch || 1) !== ch) continue;
            if (page === cur) {
              if (isLocal("mod")) continue;
              mod.setVisual(d2 / 127);
              modLast = d2;
            }
            page.mod = d2 / 127;
            changed = true;
          }
        }
      } else if (type === 0xE0 && ch === pageCh() && !isLocal("pitch")) {
        const v14 = (d2 << 7) | d1;
        pitch.setVisual(v14 / 16383);
        pitchLast = v14;
      }
    }
    if (changed) scheduleFeedbackSave();
  }

  function connect() {
    clearTimeout(retry);
    try {
      ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
      ws.binaryType = "arraybuffer";
    } catch (_) {
      setStatus("Open from Mac server URL");
      return;
    }
    ws.onopen = () => setStatus("Linked");
    ws.onclose = () => {
      setStatus("Retrying…");
      retry = setTimeout(connect, 1000);
    };
    ws.onmessage = (ev) => {
      if (ev.data instanceof ArrayBuffer) {
        handleIncomingMidi(ev.data);
        return;
      }
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }
      if (!msg || msg.t !== "hello") return;
      if (!msg.live) setStatus("TEST MODE");
      else setStatus(msg.fb ? `I/O: ${msg.midi}` : `OUT: ${msg.midi}`);

      if (valid(msg.layouts) && !dirty) {
        const migrated = normalizePages(msg.layouts);
        if (JSON.stringify(msg.layouts) !== JSON.stringify(state)) {
          state = msg.layouts;
          writeLocal();
          renderTabs();
          renderDeck();
        }
        if (migrated) save();
      } else {
        pushLayouts(); // server has no (or an old-format) layout: it gets ours
      }
    };
  }

  // ------------------------------------------------------------ knob artwork
  // Mini V style scale: thin white ticks around the knob, "0" and "10" at the ends
  const TICKS = (() => {
    const pt = (deg, r) => {
      const a = (deg * Math.PI) / 180;
      return [50 + r * Math.sin(a), 50 - r * Math.cos(a)];
    };
    let s = "";
    for (let i = 0; i <= 10; i++) {
      const d = -SWEEP + (i * SWEEP * 2) / 10;
      const even = i % 2 === 0;
      const [x1, y1] = pt(d, 35);
      const [x2, y2] = pt(d, even ? 40 : 38);
      s += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#E8E4D8" stroke-opacity=".9" stroke-width="1.1"/>`;
      if (even) {
        const [nx, ny] = pt(d, 45.5);
        s += `<text x="${nx.toFixed(1)}" y="${(ny + 2.6).toFixed(1)}" text-anchor="middle" font-size="6.4" font-weight="500" fill="#E8E4D8" fill-opacity=".9" font-family="Montserrat, Helvetica Neue, Arial, sans-serif">${i}</text>`;
      }
    }
    return s;
  })();

  // Static part: printed scale, black knurled skirt, black body. Flat, no highlights.
  const KNOB_BASE = `<svg viewBox="0 0 100 100">${TICKS}
    <circle cx="50" cy="50" r="30" fill="url(#pkSkirt)" stroke="#000" stroke-width="1"/>
    <circle cx="50" cy="50" r="28.6" fill="none" stroke="rgba(255,255,255,.10)" stroke-width="2.2" stroke-dasharray="0.8 1.9"/>
    <circle cx="50" cy="50" r="22" fill="url(#pkBody)" stroke="#000" stroke-width="1"/></svg>`;

  // Turning part: just the white pointer line, from the cap out to the rim
  const KNOB_HEAD = `<svg viewBox="0 0 100 100">
    <rect x="48.6" y="17" width="2.8" height="16.5" rx="1.2" fill="#F1EEE4"/></svg>`;

  function buildKnob(ctrl) {
    const wrap = el("div", "ctrl" + (ctrl.free ? " free" : ""));
    const lbl = el("div", "ctrl-lbl", ctrl.label);
    // tap the name (any mode) to rename the knob or change its CC
    lbl.addEventListener("click", (e) => { e.stopPropagation(); window.PK.openCtrlSheet(ctrl.id); });
    const dial = el("div", "knob-wrap");
    dial.innerHTML = `<div class="knob-base">${KNOB_BASE}</div><div class="knob-head">${KNOB_HEAD}</div><div class="knob-cap"></div>`;
    const head = $(".knob-head", dial);
    const valEl = el("div", "ctrl-val");

    const paint = (smooth) => {
      const deg = -SWEEP + ctrl.n * SWEEP * 2;
      head.style.transition = smooth ? "transform 90ms linear" : "none";
      head.style.transform = `rotate(${deg.toFixed(1)}deg)`;
      valEl.textContent = editing ? `CC ${ctrl.cc}` : String(midiVal(ctrl.n));
    };
    painters.set(ctrl.id, paint);
    paint(false);

    wrap.addEventListener("click", () => { if (editing) window.PK.openCtrlSheet(ctrl.id); });

    let drag = null;
    dial.addEventListener("pointerdown", (e) => {
      if (editing || e.button > 0) return;
      dial.setPointerCapture(e.pointerId);
      drag = { id: e.pointerId, y: e.clientY, n: ctrl.n };
      wrap.classList.add("active");
      touch("k" + ctrl.id);
      e.preventDefault();
    });
    dial.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      ctrl.n = clamp(drag.n + (drag.y - e.clientY) / DRAG_RANGE, 0, 1);
      const v = midiVal(ctrl.n);
      if (sent.get(ctrl.id) !== v) {
        sent.set(ctrl.id, v);
        sendCtrl(ctrl, v);
      }
      paint(false);
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag = null;
      wrap.classList.remove("active");
      touch("k" + ctrl.id);
      save();
    };
    dial.addEventListener("pointerup", end);
    dial.addEventListener("pointercancel", end);

    wrap.append(lbl, dial, valEl);
    return wrap;
  }

  // -------------------------------------------------------------- wheels
  // A wheel is a ribbed cylinder seen through a slot. The ridges and the finger-notch
  // move together as you drag. Pitch springs back to centre, mod stays where you leave it.
  function makeWheel({ slot, surface, valEl, key, initial, spring, snap, format, send }) {
    const PAD = 18;
    let norm = initial;
    let ptr = null, startY = 0, startN = 0, raf = 0;

    const ctx = surface.getContext("2d");
    const RAD = Math.PI / 180;
    const VIS = 68 * RAD, SWING = 50 * RAD, STEP = 4.5 * RAD;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = slot.clientWidth, h = slot.clientHeight;
      if (!w || !h) return;
      const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
      if (surface.width !== pw || surface.height !== ph) { surface.width = pw; surface.height = ph; }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const R = (h / 2) / Math.sin(VIS);
      const phi = (norm - 0.5) * 2 * SWING;

      for (let y = 0; y < h; y++) {                       // body: bright in the middle, dark toward the ends
        const s = (h / 2 - (y + 0.5)) / R;
        const c = Math.sqrt(1 - s * s);
        const v = Math.round(52 + 156 * Math.pow(c, 2.2));
        ctx.fillStyle = `rgb(${v},${v - 2},${v - 9})`;
        ctx.fillRect(0, y, w, 1.2);
      }
      for (let k = -40; k <= 40; k++) {                   // ridges
        const th = phi + k * STEP;
        if (Math.abs(th) > VIS) continue;
        const y = h / 2 - R * Math.sin(th), c = Math.cos(th);
        ctx.fillStyle = `rgba(0,0,0,${(0.55 * c).toFixed(2)})`;
        ctx.fillRect(0, y - 0.6 * c, w, 1.3 * c);
        ctx.fillStyle = `rgba(255,255,255,${(0.28 * c).toFixed(2)})`;
        ctx.fillRect(0, y + 0.7 * c, w, 0.8 * c);
      }
      const g = ctx.createLinearGradient(0, 0, w, 0);     // rounded rim on the left and right edges
      g.addColorStop(0, "rgba(0,0,0,.55)"); g.addColorStop(0.22, "rgba(0,0,0,0)");
      g.addColorStop(0.78, "rgba(0,0,0,0)"); g.addColorStop(1, "rgba(0,0,0,.55)");
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

      if (Math.abs(phi) < VIS) {                          // finger notch, fixed to the wheel
        const y = h / 2 - R * Math.sin(phi), c = Math.cos(phi), nh = 16 * c, nx = 4;
        ctx.fillStyle = "rgba(10,9,7,.78)";
        ctx.beginPath(); ctx.roundRect(nx, y - nh / 2, w - nx * 2, nh, Math.min(4, nh / 2)); ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,.22)";
        ctx.fillRect(nx + 1, y + nh / 2, w - nx * 2 - 2, 1);
      }
    };

    const travel = () => Math.max(1, slot.clientHeight - PAD * 2);
    const paint = () => {
      draw();
      valEl.textContent = format(norm);
    };
    const setNorm = (n, doSend) => {
      norm = clamp(n, 0, 1);
      if (snap && Math.abs(norm - 0.5) < snap) norm = 0.5;
      paint();
      if (doSend) { touch(key); send(norm); }
    };
    const glide = () => {
      const from = norm, t0 = performance.now();
      const step = (t) => {
        const p = Math.min(1, (t - t0) / 150);
        const e = 1 - Math.pow(1 - p, 3);
        setNorm(from + (0.5 - from) * e, true);
        raf = p < 1 ? requestAnimationFrame(step) : 0;
      };
      raf = requestAnimationFrame(step);
    };

    slot.addEventListener("pointerdown", (e) => {
      if (e.button > 0) return;
      cancelAnimationFrame(raf); raf = 0;
      ptr = e.pointerId;
      slot.setPointerCapture(e.pointerId);
      startY = e.clientY; startN = norm;
      slot.parentElement.classList.add("active");
      touch(key);
      e.preventDefault();
    });
    slot.addEventListener("pointermove", (e) => {
      if (e.pointerId !== ptr) return;
      setNorm(startN + (startY - e.clientY) / travel(), true);
    });
    const end = (e) => {
      if (e.pointerId !== ptr) return;
      ptr = null;
      slot.parentElement.classList.remove("active");
      touch(key);
      if (spring) glide();
    };
    slot.addEventListener("pointerup", end);
    slot.addEventListener("pointercancel", end);

    if ("ResizeObserver" in window) new ResizeObserver(paint).observe(slot);
    paint();

    return {
      setVisual(n) {
        if (ptr !== null || raf) return;
        norm = clamp(n, 0, 1);
        if (snap && Math.abs(norm - 0.5) < 0.001) norm = 0.5;
        paint();
      },
      repaint: paint,
    };
  }

  let pitchLast = 8192;
  const pitch = makeWheel({
    slot: $("#pitch-slot"), surface: $("#pitch-surface"), valEl: $("#pitch-val"),
    key: "pitch", initial: 0.5, spring: true, snap: 0.03,
    format: (n) => { const c = Math.round((n - 0.5) * 16383); return c > 0 ? `+${c}` : String(c); },
    send: (n) => {
      const v14 = n === 0.5 ? 8192 : Math.round(n * 16383);
      if (v14 === pitchLast) return;
      pitchLast = v14;
      sendPitchBend(pageCh(), v14);
    },
  });

  let modLast = -1;
  const mod = makeWheel({
    slot: $("#mod-slot"), surface: $("#mod-surface"), valEl: $("#mod-val"),
    key: "mod", initial: 0, spring: false, snap: 0,
    format: (n) => String(midiVal(n)),
    send: (n) => {
      currentPage().mod = n; // each page (plugin) remembers its own mod wheel
      scheduleFeedbackSave();
      const v = midiVal(n);
      if (v === modLast) return;
      modLast = v;
      sendRawCC(pageCh(), 1, v);
    },
  });

  // -------------------------------------------------------------- rendering
  function renderDeck() {
    painters.clear();
    const grid = $("#knob-grid");
    const side = $("#side-knobs");
    grid.replaceChildren();
    if (side) side.replaceChildren();

    const knobs = currentPage().controls.filter((c) => c.type === "knob");
    knobs.slice(0, 12).forEach((ctrl) => grid.append(buildKnob(ctrl)));
    if (side) {
      knobs.slice(12, 14).forEach((ctrl) => side.append(buildKnob(ctrl)));
    }

    pitch.repaint();
    const pm = currentPage().mod || 0;
    mod.setVisual(pm);
    modLast = midiVal(pm);
  }

  function selectPage(id) {
    state.active = id;
    save();
    renderTabs();
    renderDeck();
  }

  function renderTabs() {
    const bar = $("#tabs");
    bar.replaceChildren();
    for (const p of state.pages) {
      const b = el("button", "tab", p.name);
      b.append(el("span", "tab-ch", `CH ${p.ch || 1}`));
      b.type = "button";
      if (p.id === state.active) b.setAttribute("aria-current", "true");
      b.addEventListener("click", () => selectPage(p.id));
      bar.append(b);
    }
    const addBtn = el("button", "tab add-page", "+ New Synth Page");
    addBtn.type = "button";
    addBtn.addEventListener("click", () => {
      if (state.pages.length >= MAX_PAGES) return;
      const p = createPage(`Synth ${state.pages.length + 1}`, freeChannel());
      state.pages.push(p);
      selectPage(p.id);
    });
    bar.append(addBtn);

    if (editing) {
      const pageSet = el("button", "tab", "Page Settings");
      pageSet.type = "button";
      pageSet.addEventListener("click", () => window.PK.openPageSheet());
      bar.append(pageSet);
    }
  }

  $("#edit").addEventListener("click", () => {
    editing = !editing;
    if (window.PK.closeSheet) window.PK.closeSheet();
    document.body.classList.toggle("editing", editing);
    const b = $("#edit");
    b.classList.toggle("edit-on", editing);
    b.textContent = editing ? "Done" : "Edit";
    renderTabs();
    renderDeck();
  });

  window.PK = {
    $, el, midiVal,
    get state() { return state; },
    sent, save, sendCtrl, findControl, currentPage, renderTabs, renderDeck,
    defaultControls,
  };

  renderTabs();
  renderDeck();
  connect();
})();
