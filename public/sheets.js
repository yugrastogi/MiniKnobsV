// Phone Knobs — Rename & CC Sheet
(() => {
  "use strict";

  const PK = window.PK;
  const { $, el, save, findControl, renderTabs, renderDeck } = PK;

  const sheet = $("#sheet");
  const scrim = $("#scrim");
  let sweeping = false;

  function show(nodes) {
    sheet.replaceChildren(...nodes);
    sheet.hidden = false;
    scrim.hidden = false;
  }

  function close() {
    sheet.hidden = true;
    scrim.hidden = true;
    sheet.replaceChildren();
  }

  scrim.addEventListener("click", close);
  document.addEventListener("keydown", (e) => { if (!sheet.hidden && e.key === "Escape") close(); });

  function heading(text) {
    const h = el("h2", null, text);
    h.id = "sheet-title";
    return h;
  }

  function field(label, type, value) {
    const wrap = el("label", "field");
    const input = el("input");
    input.type = type;
    input.value = value;
    if (type === "number") input.inputMode = "numeric";
    wrap.append(el("span", null, label), input);
    return { wrap, input };
  }

  function bindInt(input, lo, hi, get, set) {
    input.min = lo;
    input.max = hi;
    input.addEventListener("input", () => {
      const n = parseInt(input.value, 10);
      if (Number.isInteger(n) && n >= lo && n <= hi) set(n);
    });
    input.addEventListener("change", () => { input.value = get(); });
  }

  function button(text, cls) {
    const b = el("button", "btn" + (cls ? " " + cls : ""), text);
    b.type = "button";
    return b;
  }

  function openCtrlSheet(id) {
    const found = findControl(id);
    if (!found) return;
    const { page, ctrl } = found;

    const name = field("Name", "text", ctrl.label);
    name.input.maxLength = 14;
    name.input.placeholder = "Name this knob";
    name.input.addEventListener("input", () => {
      ctrl.label = name.input.value.slice(0, 14);
      save();
      renderDeck();
    });

    const cc = field("MIDI CC (0–127)", "number", ctrl.cc);
    const ch = field("MIDI Channel (1–16)", "number", ctrl.ch || page.ch || 1);
    const row = el("div", "row");
    row.append(cc.wrap, ch.wrap);

    bindInt(cc.input, 0, 127, () => ctrl.cc, (n) => {
      ctrl.cc = n;
      PK.sent.delete(id);
      save();
      renderDeck();
    });
    bindInt(ch.input, 1, 16, () => ctrl.ch || page.ch || 1, (n) => {
      ctrl.ch = n;
      PK.sent.delete(id);
      save();
      renderDeck();
    });

    const learn = el("div", "learn");
    const sweepBtn = button("Send MIDI Learn Sweep", "primary");
    sweepBtn.addEventListener("click", () => {
      if (sweeping) return;
      sweeping = true;
      sweepBtn.disabled = true;
      sweepBtn.textContent = "Sweeping…";
      const home = PK.midiVal(ctrl.n);
      const t0 = performance.now();
      let last = -1;
      const step = () => {
        const p = (performance.now() - t0) / 900;
        if (p >= 1) {
          PK.sendCtrl(ctrl, home);
          PK.sent.set(id, home);
          sweeping = false;
          sweepBtn.disabled = false;
          sweepBtn.textContent = "Send MIDI Learn Sweep";
          return;
        }
        const v = Math.round((p < 0.5 ? p * 2 : (1 - p) * 2) * 127);
        if (v !== last) { last = v; PK.sendCtrl(ctrl, v); }
        setTimeout(step, 16);
      };
      step();
    });
    learn.style.margin = "10px 0";
    learn.append(sweepBtn, el("p", "hint", "Click MIDI Learn in your plugin, then tap above to auto-map."));

    const done = button("Done");
    done.addEventListener("click", close);
    const actions = el("div", "actions");
    actions.append(el("span"), done);

    show([heading(`Edit: ${ctrl.label || "Knob"}`), name.wrap, row, learn, actions]);
  }

  function openPageSheet() {
    const page = PK.currentPage();
    const name = field("Page Name", "text", page.name);
    name.input.maxLength = 20;
    name.input.addEventListener("input", () => {
      page.name = name.input.value.slice(0, 20);
      save();
      renderTabs();
    });

    const ch = field("MIDI Channel (1–16)", "number", page.ch || 1);
    bindInt(ch.input, 1, 16, () => page.ch || 1, (n) => {
      page.ch = n;
      save();
      renderDeck();
    });

    // restore the factory CC mapping for this page
    const resetWrap = el("div", "learn");
    resetWrap.style.margin = "4px 0 12px";
    const reset = button("Reset Knob Mapping");
    let armed = false;
    reset.addEventListener("click", () => {
      if (!armed) {
        armed = true;
        reset.textContent = "Tap again to confirm";
        return;
      }
      page.controls = PK.defaultControls();
      PK.sent.clear();
      save();
      renderDeck();
      close();
    });
    resetWrap.append(reset, el("p", "hint", "Restores Cutoff (CC 74), Resonance (CC 71) and twelve unnamed knobs on CC 20–31."));

    const only = PK.state.pages.length < 2;
    const del = button("Delete Page", "danger");
    del.disabled = only;
    del.addEventListener("click", () => {
      if (PK.state.pages.length < 2) return;
      PK.state.pages = PK.state.pages.filter((p) => p !== page);
      PK.state.active = PK.state.pages[0].id;
      save();
      close();
      renderTabs();
      renderDeck();
    });

    const done = button("Done", "primary");
    done.addEventListener("click", close);
    const actions = el("div", "actions");
    actions.append(del, done);

    const chHint = el("p", "hint", "Pitch, mod and all knobs on this page use this channel. Give each plugin its own page and channel, and set that plugin to listen on it.");
    chHint.style.margin = "-6px 0 12px";
    show([heading("Page Settings"), name.wrap, ch.wrap, chHint, resetWrap, actions]);
  }

  Object.assign(PK, { openCtrlSheet, openPageSheet, closeSheet: close });
})();
