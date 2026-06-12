// Studio shell: mounts Drone π and Granulone in one page with a single
// shared AudioContext and one master bus + limiter. Requires an HTTP server
// (python3 -m http.server) because it fetches the two synth pages at runtime.
import GranularEngine from "./granulone/src/granularEngine.js";
import { setupUI } from "./granulone/src/ui.js";

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

window.ctx = ctx;
window.SharedAudio = { ctx, masterBus, limiter };

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
function initTabs() {
  const buttons = Array.from(document.querySelectorAll(".tab-btn"));
  buttons.forEach(btn => {
    btn.addEventListener("click", () => {
      buttons.forEach(other => other.classList.toggle("active", other === btn));
      document.querySelectorAll(".studio-panel").forEach(panel => {
        panel.hidden = panel.id !== btn.dataset.tab;
      });
    });
  });
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
    version: 1,
    drone: window.DroneAPI.getState(),
    granulone: getGranuloneState()
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
    initTabs();
    initStudioPresets();
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
