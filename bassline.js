// Basso stocastico nativo dello Studio: random walk sui gradi derivati dalle
// costanti matematiche del drone (via window.pigreco), agganciato al clock
// condiviso. Interfaccia modulo: createBassline(ctx, deps) -> { output, mount,
// getState, applyState }.

const PARAM_DEFS = [
  ["level", "Volume", 0, 1, 0.01],
  ["density", "Density", 0, 1, 0.01],
  ["drift", "Drift", 0, 1, 0.01],
  ["gravity", "Gravity", 0, 1, 0.01],
  ["slide", "Slide", 0, 1, 0.01],
  ["accent", "Accent", 0, 1, 0.01],
  ["cutoff", "Cutoff (Hz)", 200, 4000, 10],
  ["attack", "Attack (s)", 0.001, 0.3, 0.001],
  ["decay", "Decay (s)", 0.05, 1.2, 0.01],
  ["envFilter", "Env→Filtro", 0, 1, 0.01],
  ["fx", "Flanger", 0, 1, 0.01]
];

// Preset di genere: stessi 8 parametri, caratteri molto diversi.
const BASS_PRESETS = {
  "Acid Line": { level: 0.55, density: 0.8, drift: 0.7, gravity: 0.35, slide: 0.65, accent: 0.7, cutoff: 1400, attack: 0.002, decay: 0.22, envFilter: 0.8, fx: 0 },
  "Dub Foundation": { level: 0.65, density: 0.45, drift: 0.2, gravity: 0.85, slide: 0.2, accent: 0.2, cutoff: 380, attack: 0.02, decay: 0.7, envFilter: 0.3, fx: 0.15 },
  "Techno Rolling": { level: 0.6, density: 0.9, drift: 0.25, gravity: 0.7, slide: 0.1, accent: 0.45, cutoff: 800, attack: 0.002, decay: 0.2, envFilter: 0.5, fx: 0 },
  "Deep House Groove": { level: 0.58, density: 0.55, drift: 0.35, gravity: 0.6, slide: 0.3, accent: 0.4, cutoff: 650, attack: 0.005, decay: 0.35, envFilter: 0.45, fx: 0.1 },
  "Drone Root": { level: 0.6, density: 0.3, drift: 0.05, gravity: 1, slide: 0.5, accent: 0.1, cutoff: 420, attack: 0.08, decay: 1.0, envFilter: 0.25, fx: 0.25 },
  "Funk Walker": { level: 0.55, density: 0.75, drift: 0.6, gravity: 0.45, slide: 0.25, accent: 0.65, cutoff: 1100, attack: 0.002, decay: 0.24, envFilter: 0.6, fx: 0 },
  "Ambient Pulse": { level: 0.5, density: 0.35, drift: 0.3, gravity: 0.75, slide: 0.55, accent: 0.15, cutoff: 500, attack: 0.12, decay: 0.9, envFilter: 0.3, fx: 0.35 },
  "Electro Snap": { level: 0.55, density: 0.65, drift: 0.5, gravity: 0.5, slide: 0.05, accent: 0.8, cutoff: 1800, attack: 0.001, decay: 0.16, envFilter: 0.9, fx: 0 },
  "Dungeon Crawl": { level: 0.6, density: 0.5, drift: 0.8, gravity: 0.3, slide: 0.4, accent: 0.5, cutoff: 300, attack: 0.01, decay: 0.5, envFilter: 0.5, fx: 0.2 },
  "Liquid DnB": { level: 0.5, density: 0.85, drift: 0.45, gravity: 0.55, slide: 0.45, accent: 0.55, cutoff: 950, attack: 0.002, decay: 0.18, envFilter: 0.55, fx: 0.3 },
  "Random Madness": { level: 0.5, density: 0.95, drift: 1, gravity: 0.1, slide: 0.6, accent: 0.6, cutoff: 2400, attack: 0.004, decay: 0.3, envFilter: 0.7, fx: 0.4 },
  "Flanger-Phaser Glitch": { level: 0.52, density: 0.7, drift: 0.85, gravity: 0.25, slide: 0.15, accent: 0.75, cutoff: 2200, attack: 0.001, decay: 0.14, envFilter: 0.85, fx: 0.9 }
};

export function createBassline(ctx, { masterBus, clock, getTonalState }) {
  const params = {
    level: 0.55,
    density: 0.65,
    drift: 0.45,
    gravity: 0.5,
    slide: 0.3,
    accent: 0.35,
    cutoff: 900,
    attack: 0.003,
    decay: 0.32,
    envFilter: 0.5,
    fx: 0
  };

  const output = ctx.createGain();
  output.gain.value = params.level;
  output.connect(masterBus);

  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = params.cutoff;
  filter.Q.value = 7;

  const vca = ctx.createGain();
  vca.gain.value = 0;

  const osc = ctx.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.value = 55;
  const sub = ctx.createOscillator();
  sub.type = "sine";
  sub.frequency.value = 27.5;
  const subGain = ctx.createGain();
  subGain.gain.value = 0.55;

  // Flanger-phaser: delay corto modulato da un LFO con feedback, in
  // parallelo al segnale dry. La manopola FX dosa wet e feedback.
  const flangerDelay = ctx.createDelay(0.05);
  flangerDelay.delayTime.value = 0.004;
  const flangerFeedback = ctx.createGain();
  flangerFeedback.gain.value = 0;
  const flangerWet = ctx.createGain();
  flangerWet.gain.value = 0;
  const flangerLfo = ctx.createOscillator();
  flangerLfo.type = "sine";
  flangerLfo.frequency.value = 0.35;
  const flangerLfoGain = ctx.createGain();
  flangerLfoGain.gain.value = 0.002;
  flangerLfo.connect(flangerLfoGain).connect(flangerDelay.delayTime);
  flangerDelay.connect(flangerFeedback).connect(flangerDelay);
  flangerLfo.start();

  osc.connect(vca);
  sub.connect(subGain).connect(vca);
  vca.connect(filter);
  filter.connect(output);
  filter.connect(flangerDelay);
  flangerDelay.connect(flangerWet).connect(output);
  osc.start();
  sub.start();

  let degree = 0;
  let lastFreq = 55;
  const noteListeners = new Set();

  // Piega una frequenza nell'ottava del basso (30-120 Hz).
  function foldToBass(freq) {
    let f = Math.abs(freq) || 55;
    while (f > 120) f /= 2;
    while (f < 30) f *= 2;
    return f;
  }

  // I gradi vengono dalle formule del drone (quali intervalli esistono lo
  // decide la costante attiva), ma ogni grado è SNAPPATO al semitono 12-TET
  // sulla fondamentale del drone — come il Granulone con Slice Mix al 100%.
  // È questo che tiene il basso intonato all'orecchio.
  function candidateFreqs() {
    const tonal = typeof getTonalState === "function" ? getTonalState() : null;
    const base = tonal?.baseFrequency || 110;
    const mode = tonal?.currentMode || "PI";
    const usePrimes = !!tonal?.primeMode;
    const root = foldToBass(base);
    const semitones = new Set([0]);
    if (typeof window !== "undefined" && typeof window.pigreco === "function") {
      for (let i = 0; i < 4; i++) {
        const folded = foldToBass(window.pigreco(base, i, { usePrimes, mode }));
        const semi = Math.round(12 * Math.log2(folded / root));
        semitones.add(((semi % 12) + 12) % 12);
      }
    }
    const degrees = Array.from(semitones)
      .sort((a, b) => a - b)
      .map(semi => root * Math.pow(2, semi / 12));
    return { root, degrees };
  }

  function onStep(time) {
    if (Math.random() > params.density) return;
    const { root, degrees } = candidateFreqs();

    const span = Math.max(1, Math.round(params.drift * 3));
    degree += Math.floor(Math.random() * (span * 2 + 1)) - span;
    if (Math.random() < params.gravity * 0.6) {
      degree = Math.trunc(degree / 2);
    }
    const maxIdx = degrees.length - 1;
    degree = Math.max(-maxIdx, Math.min(maxIdx, degree));
    let freq = degree === 0 ? root : degrees[Math.abs(degree)] ?? root;
    if (Math.random() < 0.12) freq /= 2;
    freq = Math.max(25, freq);

    const accent = Math.random() < params.accent;
    const slide = Math.random() < params.slide;
    const dur = Math.max(0.05, params.decay) + (accent ? 0.05 : 0);

    osc.frequency.cancelScheduledValues(time);
    sub.frequency.cancelScheduledValues(time);
    if (slide) {
      osc.frequency.setValueAtTime(Math.max(25, lastFreq), time);
      osc.frequency.exponentialRampToValueAtTime(freq, time + 0.09);
      sub.frequency.setValueAtTime(Math.max(12, lastFreq / 2), time);
      sub.frequency.exponentialRampToValueAtTime(freq / 2, time + 0.09);
    } else {
      osc.frequency.setValueAtTime(freq, time);
      sub.frequency.setValueAtTime(freq / 2, time);
    }
    lastFreq = freq;

    const peak = accent ? 1 : 0.7;
    const attack = Math.max(0.001, params.attack);
    vca.gain.cancelScheduledValues(time);
    if (slide) {
      vca.gain.setTargetAtTime(peak, time, attack * 0.5 + 0.005);
    } else {
      vca.gain.setValueAtTime(0.0001, time);
      vca.gain.linearRampToValueAtTime(peak, time + attack);
    }
    const decayStart = time + Math.max(dur, attack + 0.01);
    vca.gain.setTargetAtTime(0.0001, decayStart, 0.12);

    const maxBoost = accent ? 3.2 : 1.8;
    const envAmt = 1 + (maxBoost - 1) * params.envFilter;
    filter.frequency.cancelScheduledValues(time);
    filter.frequency.setValueAtTime(params.cutoff, time);
    filter.frequency.linearRampToValueAtTime(Math.min(9000, params.cutoff * envAmt), time + attack);
    filter.frequency.setTargetAtTime(params.cutoff, time + attack, dur * 0.6);

    noteListeners.forEach(fn => {
      try {
        fn({ freq, accent, slide, degree: Math.abs(degree), time });
      } catch (error) {
        console.error(error);
      }
    });
  }

  clock.subscribe(onStep);

  const sliders = {};

  function applyParam(key, value) {
    params[key] = value;
    const now = ctx.currentTime;
    if (key === "level") {
      output.gain.setTargetAtTime(value, now, 0.05);
    } else if (key === "fx") {
      flangerWet.gain.setTargetAtTime(value * 0.7, now, 0.1);
      flangerFeedback.gain.setTargetAtTime(value * 0.62, now, 0.1);
      flangerLfo.frequency.setTargetAtTime(0.25 + value * 1.4, now, 0.1);
    }
  }

  function mount(panel) {
    const section = document.createElement("section");
    section.className = "synth-section";
    section.innerHTML = `
      <h2>Basso Stocastico</h2>
      <p class="synth-hint">
        Intonato dal drone: cammina dentro la costante matematica attiva
        (e sulla griglia dei primi se Prime Quantization è accesa).
        Parte e si ferma con ▶ nella barra in alto.
      </p>
      <div class="param bass-preset-row">
        <label>Preset<output></output></label>
        <select class="bass-preset"></select>
      </div>
      <div class="param-grid"></div>`;
    const presetSelect = section.querySelector(".bass-preset");
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "— scegli un carattere —";
    presetSelect.appendChild(placeholder);
    Object.keys(BASS_PRESETS).forEach(name => {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name;
      presetSelect.appendChild(option);
    });
    presetSelect.addEventListener("change", () => {
      const preset = BASS_PRESETS[presetSelect.value];
      if (preset) applyState(preset);
    });
    const grid = section.querySelector(".param-grid");
    PARAM_DEFS.forEach(([key, label, min, max, step]) => {
      const wrap = document.createElement("div");
      wrap.className = "param";
      wrap.innerHTML = `
        <label>${label}<output>${params[key]}</output></label>
        <input type="range" min="${min}" max="${max}" step="${step}" value="${params[key]}">`;
      const input = wrap.querySelector("input");
      const out = wrap.querySelector("output");
      input.addEventListener("input", () => {
        const value = parseFloat(input.value);
        applyParam(key, value);
        out.textContent = value;
      });
      sliders[key] = { input, out };
      grid.appendChild(wrap);
    });
    panel.appendChild(section);
  }

  function getState() {
    return { ...params };
  }

  function applyState(state) {
    if (!state || typeof state !== "object") return false;
    PARAM_DEFS.forEach(([key, , min, max]) => {
      const value = parseFloat(state[key]);
      if (Number.isFinite(value)) {
        const clamped = Math.min(max, Math.max(min, value));
        applyParam(key, clamped);
        if (sliders[key]) {
          sliders[key].input.value = clamped;
          sliders[key].out.textContent = clamped;
        }
      }
    });
    return true;
  }

  // Le note (freq, accent, grado, tempo audio) sono osservabili dall'esterno:
  // i visual le usano per pilotare la palette di colori.
  function onNote(fn) {
    noteListeners.add(fn);
    return () => noteListeners.delete(fn);
  }

  return { output, mount, getState, applyState, onNote };
}
