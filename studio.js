// Studio shell: mounts Drone π and Granulone in one page with a single
// shared AudioContext and one master bus + limiter. Requires an HTTP server
// (python3 -m http.server) because it fetches the two synth pages at runtime.
import GranularEngine from "./granulone/src/granularEngine.js";
import { setupUI } from "./granulone/src/ui.js";
import { createBassline } from "./bassline.js";
import { createMosquitoDrums } from "./mosquito_drums.js";

// ---------------------------------------------------------------------------
// Shared audio: ONE context, one master bus, one safety limiter.
// window.ctx is the global Granulone already looks for; window.SharedAudio is
// what drone.js now looks for in ensureAudioContext.
// ---------------------------------------------------------------------------
const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
let ctx;
try {
  ctx = new AudioContextCtor({ latencyHint: "playback" });
} catch (error) {
  ctx = new AudioContextCtor();
}

const masterBus = ctx.createGain();
const limiter = ctx.createDynamicsCompressor();
limiter.threshold.value = -9;
limiter.knee.value = 6;
limiter.ratio.value = 16;
limiter.attack.value = 0.002;
limiter.release.value = 0.25;
masterBus.connect(limiter);
limiter.connect(ctx.destination);

// ---------------------------------------------------------------------------
// Cascade bus: any synth can pour its output here through a per-synth send;
// what flows in can be recorded and dropped into Granulone as grain material.
// Future synths: window.SharedAudio.registerCascadeSend(name, outputNode).
// ---------------------------------------------------------------------------
const cascadeBus = ctx.createGain();
const recorderDest = ctx.createMediaStreamDestination();
cascadeBus.connect(recorderDest);
const cascadeSends = new Map();

function registerCascadeSend(name, sourceNode, initialGain = 0.8) {
  let send = cascadeSends.get(name);
  if (!send) {
    send = ctx.createGain();
    send.gain.value = initialGain;
    sourceNode.connect(send);
    send.connect(cascadeBus);
    cascadeSends.set(name, send);
  }
  return send;
}

// ---------------------------------------------------------------------------
// Shared clock: 16th-note grid with lookahead scheduling on a fixed timer
// (the same anti-glitch pattern used everywhere else). Subscribers get
// callback(audioTime, stepIndex 0-15) for every step.
// ---------------------------------------------------------------------------
const clock = {
  bpm: 110,
  running: false,
  step: 0,
  nextStepTime: 0,
  listeners: new Set(),
  _timer: null
};

function clockStepDuration() {
  return 60 / clock.bpm / 4;
}

function clockTick() {
  const lookAhead = 0.35;
  while (clock.nextStepTime < ctx.currentTime + lookAhead) {
    const time = clock.nextStepTime;
    const step = clock.step;
    clock.listeners.forEach(fn => {
      try {
        fn(time, step);
      } catch (error) {
        console.error(error);
      }
    });
    clock.nextStepTime += clockStepDuration();
    clock.step = (clock.step + 1) % 16;
  }
}

clock.start = () => {
  if (clock.running) return;
  clock.running = true;
  clock.step = 0;
  clock.nextStepTime = ctx.currentTime + 0.1;
  clock._timer = setInterval(clockTick, 40);
};

clock.stop = () => {
  clock.running = false;
  if (clock._timer) {
    clearInterval(clock._timer);
    clock._timer = null;
  }
};

clock.subscribe = fn => {
  clock.listeners.add(fn);
  return () => clock.listeners.delete(fn);
};

window.ctx = ctx;
window.SharedAudio = { ctx, masterBus, limiter, cascadeBus, registerCascadeSend, clock };

const unlockAudio = () => {
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => {});
  }
};
document.addEventListener("pointerdown", unlockAudio, { passive: true });
document.addEventListener("touchend", unlockAudio, { passive: true });

// ---------------------------------------------------------------------------
// Page mounting: fetch each synth's HTML, scope its CSS to its panel via CSS
// nesting, inject the markup, then run its scripts against the shared context.
// ---------------------------------------------------------------------------
async function fetchDoc(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Impossibile caricare ${url} (${res.status})`);
  return new DOMParser().parseFromString(await res.text(), "text/html");
}

function injectScopedStyles(doc, scopeSelector) {
  doc.querySelectorAll("style").forEach(styleEl => {
    const scoped = document.createElement("style");
    scoped.textContent = `${scopeSelector} {\n${styleEl.textContent}\n}`;
    document.head.appendChild(scoped);
  });
}

function loadClassicScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error(`Script non caricato: ${src}`));
    document.head.appendChild(script);
  });
}

async function mountDrone() {
  const doc = await fetchDoc("index.html");
  doc.querySelectorAll("script").forEach(s => s.remove());
  const panel = document.getElementById("drone-panel");
  const main = doc.querySelector("main");
  const perfFooter = doc.getElementById("perf-footer");
  if (main) panel.appendChild(document.importNode(main, true));
  if (perfFooter) panel.appendChild(document.importNode(perfFooter, true));
  injectScopedStyles(doc, "#drone-panel");
  // Order matters: drone.js expects pigreco/PiFX/PiReverb globals.
  for (const src of ["pigreco.js", "pi_fx.js", "pi_reverb.js", "drone.js", "smart.js"]) {
    await loadClassicScript(src);
  }
}

async function mountGranulone() {
  const doc = await fetchDoc("granulone/index.html");
  doc.querySelectorAll("script").forEach(s => s.remove());
  const panel = document.getElementById("granulone-panel");
  Array.from(doc.body.children).forEach(node => {
    panel.appendChild(document.importNode(node, true));
  });
  injectScopedStyles(doc, "#granulone-panel");

  const engine = new GranularEngine(ctx);
  // Reroute from ctx.destination to the shared master bus; the recorder tap
  // (masterGain -> recorderDestination) stays untouched.
  try {
    engine.masterGain.disconnect(ctx.destination);
  } catch (error) {
    // already disconnected
  }
  engine.masterGain.connect(masterBus);
  setupUI(engine);
  return engine;
}

// ---------------------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------------------
function activateTab(tabId) {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.tab === tabId);
  });
  document.querySelectorAll(".studio-panel").forEach(panel => {
    panel.hidden = panel.id !== tabId;
  });
}

function initTabs() {
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => activateTab(btn.dataset.tab));
  });
}

// ---------------------------------------------------------------------------
// Transport (clock condiviso di basso e batteria)
// ---------------------------------------------------------------------------
function initTransport() {
  const playBtn = document.getElementById("clockPlayBtn");
  const bpmInput = document.getElementById("bpmInput");
  playBtn?.addEventListener("click", () => {
    unlockAudio();
    if (clock.running) {
      clock.stop();
      playBtn.innerHTML = "&#9654;";
      playBtn.classList.remove("running");
    } else {
      clock.start();
      playBtn.innerHTML = "&#9632;";
      playBtn.classList.add("running");
    }
  });
  bpmInput?.addEventListener("change", () => {
    const raw = parseFloat(bpmInput.value);
    const bpm = Number.isFinite(raw) ? Math.min(220, Math.max(40, raw)) : 110;
    clock.bpm = bpm;
    bpmInput.value = bpm;
    refreshAllDelaySync();
  });
}

// ---------------------------------------------------------------------------
// Cascata: record the drone send and pour the take into Granulone by
// injecting it into its own file input — the whole Granulone pipeline
// (decode, waveform, auto-slice) runs as if the user had picked a file.
// ---------------------------------------------------------------------------
let cascadeRecorder = null;
let cascadeChunks = [];
let cascadeTimer = null;
let cascadeStartedAt = 0;

function getCascadeAmount() {
  const slider = document.getElementById("cascadeAmount");
  const raw = slider ? parseFloat(slider.value) : 80;
  return Math.min(1, Math.max(0, raw / 100));
}

function pickRecordingMimeType() {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4"
  ];
  return candidates.find(type => MediaRecorder.isTypeSupported(type)) || "";
}

function setRecButtonState(recording, seconds = 0) {
  const btn = document.getElementById("cascadeRecBtn");
  if (!btn) return;
  btn.classList.toggle("recording", recording);
  btn.innerHTML = recording
    ? `&#9632; Stop (${seconds.toFixed(1)}s)`
    : "&#9679; Riversa";
}

function startCascadeRecording() {
  if (typeof MediaRecorder === "undefined") {
    status("Registrazione non supportata da questo browser", true);
    return;
  }
  if (!window.DroneAPI) {
    status("Drone non ancora pronto", true);
    return;
  }
  window.DroneAPI.ensureAudio();
  unlockAudio();
  const droneOut = window.DroneAPI.getOutput?.();
  if (droneOut) {
    registerCascadeSend("drone", droneOut, getCascadeAmount());
  }
  if (!window.DroneAPI.isRunning() && !clock.running) {
    status("Avvia il drone o la sezione ritmica (▶) prima di riversare", true);
    return;
  }
  cascadeSends.forEach(send => {
    send.gain.setTargetAtTime(getCascadeAmount(), ctx.currentTime, 0.05);
  });

  const mimeType = pickRecordingMimeType();
  try {
    cascadeRecorder = new MediaRecorder(
      recorderDest.stream,
      mimeType ? { mimeType } : undefined
    );
  } catch (error) {
    status("Impossibile avviare la registrazione", true);
    return;
  }
  cascadeChunks = [];
  cascadeRecorder.ondataavailable = event => {
    if (event.data && event.data.size) cascadeChunks.push(event.data);
  };
  cascadeRecorder.onstop = pourCascadeIntoGranulone;
  cascadeRecorder.start();
  cascadeStartedAt = performance.now();
  setRecButtonState(true, 0);
  cascadeTimer = setInterval(() => {
    setRecButtonState(true, (performance.now() - cascadeStartedAt) / 1000);
  }, 200);
  status("Cascata in registrazione…");
}

function stopCascadeRecording() {
  if (cascadeTimer) {
    clearInterval(cascadeTimer);
    cascadeTimer = null;
  }
  setRecButtonState(false);
  if (cascadeRecorder && cascadeRecorder.state !== "inactive") {
    cascadeRecorder.stop();
  }
}

function pourCascadeIntoGranulone() {
  const type = cascadeRecorder?.mimeType || "audio/webm";
  const blob = new Blob(cascadeChunks, { type });
  cascadeChunks = [];
  cascadeRecorder = null;
  if (blob.size < 1000) {
    status("Registrazione troppo corta o vuota", true);
    return;
  }
  const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
  const stamp = new Date().toTimeString().slice(0, 8).replaceAll(":", "-");
  const file = new File([blob], `drone-cascata-${stamp}.${ext}`, { type });
  const fileInput = document.querySelector("#granulone-panel #fileInput");
  if (!fileInput) {
    status("Granulone non pronto", true);
    return;
  }
  try {
    const transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    activateTab("granulone-panel");
    status("Cascata riversata nel Granulone");
    autoPlayGranulone();
  } catch (error) {
    console.error(error);
    status("Impossibile passare il take al Granulone", true);
  }
}

// Dopo il riversamento il decode è asincrono: appena la slice esiste,
// Granulone parte da solo (engine.play è idempotente se già in play).
function autoPlayGranulone(attempt = 0) {
  const engine = window.GranuloneAPI?.engine;
  if (!engine || engine.isPlaying) return;
  if (engine.slices?.length) {
    try {
      engine.play();
      status("Cascata riversata: Granulone in play");
    } catch (error) {
      console.error(error);
    }
    return;
  }
  if (attempt < 25) {
    setTimeout(() => autoPlayGranulone(attempt + 1), 200);
  }
}

function initCascade() {
  const slider = document.getElementById("cascadeAmount");
  const out = document.getElementById("cascadeVal");
  slider?.addEventListener("input", () => {
    if (out) out.textContent = `${slider.value}%`;
    cascadeSends.forEach(send => {
      send.gain.setTargetAtTime(getCascadeAmount(), ctx.currentTime, 0.05);
    });
  });
  document.getElementById("cascadeRecBtn")?.addEventListener("click", () => {
    if (cascadeRecorder && cascadeRecorder.state === "recording") {
      stopCascadeRecording();
    } else {
      startCascadeRecording();
    }
  });
}

// ---------------------------------------------------------------------------
// Delay Sync per le slice di Granulone (stile Ableton): il tempo del delay
// può agganciarsi alle divisioni musicali del BPM della sezione ritmica.
// Usa il VALORE del BPM, non il clock che corre: funziona anche a transport
// fermo. Tutto iniettato dallo shell: granulone non sa nulla del tempo.
// ---------------------------------------------------------------------------
const DELAY_DIVISIONS = [
  ["1/32", 0.125],
  ["1/16", 0.25],
  ["1/16.", 0.375],
  ["1/8", 0.5],
  ["1/8.", 0.75],
  ["1/4", 1],
  ["1/4.", 1.5],
  ["1/2", 2],
  ["1 bar", 4]
];
const delaySyncState = new Map();

function syncedDelayMs(beats) {
  return Math.round((60 / clock.bpm) * beats * 1000);
}

function applyDelaySync(card) {
  const state = delaySyncState.get(card.dataset.sliceId);
  const input = card.querySelector(".slice-delay-time");
  if (!state || !input) return;
  if (state.enabled) {
    const max = parseFloat(input.max) || 2500;
    input.value = Math.min(max, syncedDelayMs(state.beats));
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.disabled = true;
  } else {
    input.disabled = false;
  }
}

function injectDelaySync(card) {
  const sliceId = card.dataset.sliceId;
  if (!sliceId || card.querySelector(".delay-sync")) return;
  const delayInput = card.querySelector(".slice-delay-time");
  const control = delayInput?.closest("label.control");
  if (!control) return;
  let state = delaySyncState.get(sliceId);
  if (!state) {
    state = { enabled: false, beats: 0.5 };
    delaySyncState.set(sliceId, state);
  }
  const row = document.createElement("span");
  row.className = "delay-sync";
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "delay-sync-btn" + (state.enabled ? " on" : "");
  btn.textContent = "SYNC";
  btn.title = "Aggancia il delay alle divisioni del BPM";
  const select = document.createElement("select");
  select.className = "delay-sync-div";
  DELAY_DIVISIONS.forEach(([label, beats]) => {
    const option = document.createElement("option");
    option.value = beats;
    option.textContent = label;
    select.appendChild(option);
  });
  select.value = String(state.beats);
  select.hidden = !state.enabled;
  btn.addEventListener("click", () => {
    state.enabled = !state.enabled;
    btn.classList.toggle("on", state.enabled);
    select.hidden = !state.enabled;
    applyDelaySync(card);
  });
  select.addEventListener("change", () => {
    state.beats = parseFloat(select.value) || 0.5;
    applyDelaySync(card);
  });
  row.append(btn, select);
  control.appendChild(row);
  applyDelaySync(card);
}

function refreshAllDelaySync() {
  document.querySelectorAll("#granulone-panel .slice-card[data-slice-id]").forEach(card => {
    const state = delaySyncState.get(card.dataset.sliceId);
    if (state?.enabled) applyDelaySync(card);
  });
}

function initDelaySync() {
  const container = document.querySelector("#granulone-panel #slices");
  if (!container) return;
  const scan = () => {
    container.querySelectorAll(".slice-card[data-slice-id]").forEach(injectDelaySync);
  };
  new MutationObserver(scan).observe(container, { childList: true, subtree: true });
  scan();
}

// ---------------------------------------------------------------------------
// First-run tutorial: short guided tour of the macro functions.
// ---------------------------------------------------------------------------
const TOUR_KEY = "dronepigreco.studio.tour.v2";
const TOUR_STEPS = [
  {
    tab: "drone-panel",
    target: null,
    title: "Benvenuto nello Studio",
    text: "Due synth, un solo motore audio: il Drone π genera suono infinito dalle costanti matematiche, il Granulone lo frantuma in grani. Questo mini-tour ti mostra l'essenziale per sentire qualcosa."
  },
  {
    tab: null,
    target: ".tab-btn[data-tab='granulone-panel']",
    title: "Cambiare synth",
    text: "Con questi due pulsanti passi da un synth all'altro. Entrambi restano accesi: puoi lasciare il drone a suonare mentre lavori sul Granulone."
  },
  {
    tab: "drone-panel",
    target: "#startBtn",
    title: "Sentire il drone",
    text: "Premi Start Drone e il suono parte subito. Prova Randomize e i pulsanti delle costanti (π, φ, e…) per cambiare carattere."
  },
  {
    tab: null,
    target: "#cascade-controls",
    title: "La Cascata",
    text: "Con il drone acceso premi ● Riversa per registrarlo; ripremi per fermare. Il take finisce da solo nel Granulone come campione. Lo slider decide quanta cascata di suono riversare."
  },
  {
    tab: "granulone-panel",
    target: "#playBtn",
    title: "Sentire il Granulone",
    text: "Carica un campione (o riversa la Cascata), poi premi Play: i grani partono dalla slice creata automaticamente."
  },
  {
    tab: "granulone-panel",
    target: "#slices",
    title: "Pointer e Random pitch",
    text: "Il cuore espressivo del Granulone: muovi Pointer (%) per scegliere il punto del campione da granulare e alza Random pitch (st) per dare vita e movimento al suono. Spray aggiunge dispersione attorno al pointer."
  },
  {
    tab: null,
    target: "#transport",
    title: "La sezione ritmica",
    text: "▶ avvia il clock condiviso: Basso e Drums partono insieme, sul BPM che imposti qui. Il valore del BPM guida anche il Delay Sync delle slice del Granulone."
  },
  {
    tab: "bass-panel",
    target: "#bass-panel .bass-preset",
    title: "Basso Stocastico",
    text: "Un random walk intonato dal drone: scegli un preset di genere per partire, poi scolpisci con Density (note/pause), Drift (quanto vaga) e Gravity (attrazione alla fondamentale). Con Prime Quantization attiva segue la griglia dei primi."
  },
  {
    tab: "drums-panel",
    target: "#swarmCanvas",
    title: "Mosquito Drums",
    text: "Lo sciame decide i colpi: ogni colonna del display è una voce (Kick, Snare, Hat, Perc). Clicca sul display per spostare la luce e far migrare il groove; il pulsante rosso PANIC scatena un fill. Ogni voce ha Level, Tune, Filtro e Decay."
  },
  {
    tab: null,
    target: null,
    title: "Tutto qui",
    text: "Prime Quantization sul drone intona Granulone e basso; la Cascata riversa tutto nel Granulone; Export Studio salva l'intero set in un file. Rivedi questo tour quando vuoi con il pulsante «?» qui sopra."
  }
];

let tourEl = null;
let tourHighlighted = null;

function clearTourHighlight() {
  tourHighlighted?.classList.remove("tour-highlight");
  tourHighlighted = null;
}

function endTour() {
  clearTourHighlight();
  tourEl?.remove();
  tourEl = null;
  try {
    localStorage.setItem(TOUR_KEY, "done");
  } catch (error) {
    // storage unavailable: the tour will simply reappear next time
  }
}

function showTourStep(index) {
  const step = TOUR_STEPS[index];
  if (!step) {
    endTour();
    return;
  }
  if (step.tab) activateTab(step.tab);
  clearTourHighlight();
  if (step.target) {
    const el = document.querySelector(step.target);
    if (el) {
      el.classList.add("tour-highlight");
      tourHighlighted = el;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  } else {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  if (!tourEl) {
    tourEl = document.createElement("div");
    tourEl.id = "tour-popup";
    document.body.appendChild(tourEl);
  }
  const isLast = index === TOUR_STEPS.length - 1;
  tourEl.innerHTML = `
    <div class="tour-step">${index + 1} / ${TOUR_STEPS.length}</div>
    <h3>${step.title}</h3>
    <p>${step.text}</p>
    <div class="tour-actions">
      <button type="button" data-tour="skip">Salta</button>
      <button type="button" data-tour="next" class="primary">${isLast ? "Fine" : "Avanti"}</button>
    </div>`;
  tourEl.querySelector("[data-tour='skip']").addEventListener("click", endTour);
  tourEl.querySelector("[data-tour='next']").addEventListener("click", () => {
    if (isLast) {
      endTour();
    } else {
      showTourStep(index + 1);
    }
  });
}

function initTour() {
  document.getElementById("tourBtn")?.addEventListener("click", () => showTourStep(0));
  let seen = null;
  try {
    seen = localStorage.getItem(TOUR_KEY);
  } catch (error) {
    seen = "done";
  }
  if (!seen) {
    setTimeout(() => showTourStep(0), 600);
  }
}

// ---------------------------------------------------------------------------
// Common quantization: the drone is the tonal master of the studio.
// - Prime Quantization ON  -> Granulone quantization forced (Slice Mix 100%,
//   root note = drone note, controls temporarily disabled).
// - Prime Quantization OFF -> Granulone root note follows the drone note
//   automatically; Slice Mix stays in the user's hands.
// ---------------------------------------------------------------------------
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
let quantPrimeForced = null;
let quantSavedSliceMix = null;
let quantLastRootNote = null;

function droneNoteName(freq) {
  if (!Number.isFinite(freq) || freq <= 0) return null;
  const midi = Math.round(12 * Math.log2(freq / 440)) + 69;
  return NOTE_NAMES[((midi % 12) + 12) % 12];
}

function setControlValue(el, value, eventName) {
  el.value = value;
  el.dispatchEvent(new Event(eventName, { bubbles: true }));
}

function syncQuantization() {
  if (!window.DroneAPI) return;
  const state = window.DroneAPI.getState();
  const rootSelect = document.getElementById("rootNote");
  const mixSlider = document.getElementById("sliceMix");
  if (!rootSelect || !mixSlider) return;

  if (state.primeMode) {
    if (quantPrimeForced !== true) {
      quantPrimeForced = true;
      quantSavedSliceMix = mixSlider.value;
      setControlValue(mixSlider, 100, "input");
      mixSlider.disabled = true;
      rootSelect.disabled = true;
      const hint = "Controllato dalla Prime Quantization del drone";
      mixSlider.title = hint;
      rootSelect.title = hint;
      status("Quantizzazione comune: primi (drone) → Granulone");
    }
  } else if (quantPrimeForced !== false) {
    quantPrimeForced = false;
    mixSlider.disabled = false;
    rootSelect.disabled = false;
    mixSlider.title = "";
    rootSelect.title = "";
    if (quantSavedSliceMix != null) {
      setControlValue(mixSlider, quantSavedSliceMix, "input");
      quantSavedSliceMix = null;
    }
  }

  const note = droneNoteName(state.baseFrequency);
  if (note && note !== quantLastRootNote) {
    quantLastRootNote = note;
    setControlValue(rootSelect, note, "change");
  }
}

function initQuantizationSync() {
  syncQuantization();
  setInterval(syncQuantization, 400);
}

// ---------------------------------------------------------------------------
// Combined studio presets: full drone state + granulone global controls.
// (Slices depend on the loaded sample file, so they are not persisted.)
// ---------------------------------------------------------------------------
const GRANULONE_CONTROL_IDS = [
  "grainInterval", "grainDuration", "masterGain", "lfoSpeed",
  "grainWindow", "sliceMix", "rootNote", "muteMainSample"
];

function getGranuloneState() {
  const out = {};
  GRANULONE_CONTROL_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    out[id] = el.type === "checkbox" ? el.checked : el.value;
  });
  return out;
}

function applyGranuloneState(state) {
  if (!state || typeof state !== "object") return false;
  GRANULONE_CONTROL_IDS.forEach(id => {
    if (!(id in state)) return;
    const el = document.getElementById(id);
    if (!el) return;
    if (el.type === "checkbox") {
      el.checked = !!state[id];
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      el.value = state[id];
      const eventName = el.tagName === "SELECT" ? "change" : "input";
      el.dispatchEvent(new Event(eventName, { bubbles: true }));
    }
  });
  return true;
}

let statusTimer = null;
function status(message, isError = false) {
  const el = document.getElementById("studio-status");
  if (!el) return;
  el.textContent = message;
  el.style.color = isError ? "#ff7777" : "";
  if (statusTimer) clearTimeout(statusTimer);
  statusTimer = setTimeout(() => {
    el.textContent = "";
  }, 4000);
}

function exportStudioPreset() {
  if (!window.DroneAPI) {
    status("Drone non ancora pronto", true);
    return;
  }
  const payload = {
    app: "drone-granulone-studio",
    version: 2,
    bpm: clock.bpm,
    drone: window.DroneAPI.getState(),
    granulone: getGranuloneState(),
    bass: window.BassAPI?.getState?.() ?? null,
    drums: window.DrumsAPI?.getState?.() ?? null
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "studio-preset.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  status("Preset studio esportato");
}

function importStudioPreset(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let parsed;
    try {
      parsed = JSON.parse(String(reader.result));
    } catch (error) {
      status("File non valido: non è JSON", true);
      return;
    }
    let applied = false;
    if (parsed?.drone && window.DroneAPI?.applyState(parsed.drone)) applied = true;
    if (parsed?.granulone && applyGranuloneState(parsed.granulone)) applied = true;
    if (parsed?.bass && window.BassAPI?.applyState(parsed.bass)) applied = true;
    if (parsed?.drums && window.DrumsAPI?.applyState(parsed.drums)) applied = true;
    if (Number.isFinite(parsed?.bpm)) {
      clock.bpm = Math.min(220, Math.max(40, parsed.bpm));
      const bpmInput = document.getElementById("bpmInput");
      if (bpmInput) bpmInput.value = clock.bpm;
      refreshAllDelaySync();
    }
    // Also accept plain drone presets exported from the standalone page.
    if (!applied && window.DroneAPI?.applyState(parsed?.state || parsed)) applied = true;
    status(applied ? "Preset studio importato" : "Preset non riconosciuto", !applied);
  };
  reader.onerror = () => status("Impossibile leggere il file", true);
  reader.readAsText(file);
}

function initStudioPresets() {
  document.getElementById("studioSaveBtn")?.addEventListener("click", exportStudioPreset);
  document.getElementById("studioImportInput")?.addEventListener("change", event => {
    importStudioPreset(event.target.files?.[0]);
    event.target.value = "";
  });
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async () => {
  const loading = document.getElementById("studio-loading");
  try {
    await mountDrone();
    const engine = await mountGranulone();
    window.GranuloneAPI = {
      engine,
      getState: getGranuloneState,
      applyState: applyGranuloneState
    };

    const bass = createBassline(ctx, {
      masterBus,
      clock,
      getTonalState: () => window.DroneAPI?.getState?.() ?? null
    });
    bass.mount(document.getElementById("bass-panel"));
    registerCascadeSend("bassline", bass.output, getCascadeAmount());
    window.BassAPI = bass;

    const drums = createMosquitoDrums(ctx, { masterBus, clock });
    drums.mount(document.getElementById("drums-panel"));
    registerCascadeSend("drums", drums.output, getCascadeAmount());
    window.DrumsAPI = drums;

    initTabs();
    initTransport();
    initStudioPresets();
    initCascade();
    initQuantizationSync();
    initDelaySync();
    initTour();
    loading?.remove();
    document.getElementById("drone-panel").hidden = false;
  } catch (error) {
    console.error(error);
    if (loading) {
      loading.textContent =
        "Errore di caricamento. Avvia un server locale (python3 -m http.server) e apri http://localhost:8000/studio.html";
      loading.style.color = "#ff7777";
    }
  }
})();
