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
  ["decay", "Decay (s)", 0.05, 0.6, 0.01]
];

export function createBassline(ctx, { masterBus, clock, getTonalState }) {
  const params = {
    level: 0.55,
    density: 0.65,
    drift: 0.45,
    gravity: 0.5,
    slide: 0.3,
    accent: 0.35,
    cutoff: 900,
    decay: 0.18
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

  osc.connect(vca);
  sub.connect(subGain).connect(vca);
  vca.connect(filter).connect(output);
  osc.start();
  sub.start();

  let degree = 0;
  let lastFreq = 55;

  // Piega una frequenza nell'ottava del basso (30-120 Hz).
  function foldToBass(freq) {
    let f = Math.abs(freq) || 55;
    while (f > 120) f /= 2;
    while (f < 30) f *= 2;
    return f;
  }

  // I gradi della scala vengono dalle stesse formule del drone: per la
  // costante attiva, i rapporti delle 4 voci ripiegati nell'ottava bassa.
  function candidateFreqs() {
    const tonal = typeof getTonalState === "function" ? getTonalState() : null;
    const base = tonal?.baseFrequency || 110;
    const mode = tonal?.currentMode || "PI";
    const usePrimes = !!tonal?.primeMode;
    const root = foldToBass(base);
    const set = new Set([root]);
    if (typeof window !== "undefined" && typeof window.pigreco === "function") {
      for (let i = 0; i < 4; i++) {
        set.add(foldToBass(window.pigreco(base, i, { usePrimes, mode })));
      }
    }
    return { root, degrees: Array.from(set).sort((a, b) => a - b) };
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
    vca.gain.cancelScheduledValues(time);
    if (slide) {
      vca.gain.setTargetAtTime(peak, time, 0.01);
    } else {
      vca.gain.setValueAtTime(0.0001, time);
      vca.gain.linearRampToValueAtTime(peak, time + 0.005);
    }
    vca.gain.setTargetAtTime(0.0001, time + dur, 0.05);

    const envAmt = accent ? 3.2 : 1.8;
    filter.frequency.cancelScheduledValues(time);
    filter.frequency.setValueAtTime(Math.min(9000, params.cutoff * envAmt), time);
    filter.frequency.setTargetAtTime(params.cutoff, time, dur * 0.6);
  }

  clock.subscribe(onStep);

  const sliders = {};

  function applyParam(key, value) {
    params[key] = value;
    if (key === "level") {
      output.gain.setTargetAtTime(value, ctx.currentTime, 0.05);
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
      <div class="param-grid"></div>`;
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

  return { output, mount, getState, applyState };
}
