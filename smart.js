// Smart features: preset manager (localStorage + file export/import) and
// "Evolve" generative drift mode. Uses window.DroneAPI exposed by drone.js.
(function () {
  const STORAGE_KEY = "dronepigreco.presets.v1";

  const voice = (waveform, pan, gain, delay, detune, cutoff, resonance, mute = false) =>
    ({ waveform, pan, gain, delay, detune, cutoff, resonance, mute });

  // One preset per math mode, tuned to emphasize the character of each
  // constant's ratio series. Read-only: they live in code, not localStorage.
  const FACTORY_PRESETS = {
    "Cerchio Infinito (π)": {
      version: 1, baseFrequency: 110, piDepth: 0.5, morph: 0.15, resonatorAmount: 0.3,
      fxControl: 0.45, masterVolume: 0.8, primeMode: false, currentMode: "PI",
      voiceSettings: [
        voice("sine", -0.7, 0.22, 0.28, -1.2, 3200, 0.7),
        voice("sine", -0.25, 0.18, 0.34, 0.6, 3000, 0.7),
        voice("sine", 0.3, 0.16, 0.42, -1.8, 2800, 0.7),
        voice("sine", 0.7, 0.14, 0.5, 1.4, 2600, 0.7)
      ]
    },
    "Crescita Naturale (e)": {
      version: 1, baseFrequency: 164.8, piDepth: 0.35, morph: 0.25, resonatorAmount: 0.45,
      fxControl: 0.5, masterVolume: 0.8, primeMode: false, currentMode: "E",
      voiceSettings: [
        voice("sawtooth", -0.5, 0.15, 0.3, -0.8, 2400, 1.1),
        voice("triangle", -0.15, 0.2, 0.38, 0.5, 2800, 0.8),
        voice("sawtooth", 0.2, 0.13, 0.46, -1.4, 2000, 1.4),
        voice("sine", 0.55, 0.18, 0.52, 0.9, 3200, 0.7)
      ]
    },
    "Sezione Aurea (φ)": {
      version: 1, baseFrequency: 161.8, piDepth: 0.38, morph: 0.2, resonatorAmount: 0.4,
      fxControl: 0.48, masterVolume: 0.8, primeMode: false, currentMode: "PHI",
      voiceSettings: [
        voice("triangle", -0.6, 0.2, 0.3, -0.9, 2600, 0.8),
        voice("sine", -0.2, 0.18, 0.36, 0.7, 3000, 0.7),
        voice("triangle", 0.25, 0.16, 0.44, -1.1, 2400, 0.9),
        voice("sine", 0.6, 0.15, 0.5, 1.3, 2800, 0.7)
      ]
    },
    "Nebulosa di Apéry (ζ3)": {
      version: 1, baseFrequency: 98, piDepth: 0.7, morph: 0.4, resonatorAmount: 0.55,
      fxControl: 0.75, masterVolume: 0.8, primeMode: false, currentMode: "ZETA3",
      voiceSettings: [
        voice("sine", -0.8, 0.2, 0.45, -2, 2200, 0.7),
        voice("triangle", -0.3, 0.16, 0.55, 1.5, 1800, 1.0),
        voice("sine", 0.35, 0.18, 0.6, -2.5, 2000, 0.8),
        voice("triangle", 0.8, 0.14, 0.68, 2.2, 1600, 1.2)
      ]
    },
    "Diagonale Irrazionale (√2)": {
      version: 1, baseFrequency: 155.56, piDepth: 0.3, morph: 0.1, resonatorAmount: 0.35,
      fxControl: 0.35, masterVolume: 0.8, primeMode: false, currentMode: "SQRT2",
      voiceSettings: [
        voice("square", -0.45, 0.12, 0.32, -0.6, 1400, 2.4),
        voice("square", 0.45, 0.12, 0.4, 0.6, 1200, 2.8),
        voice("triangle", 0, 0.18, 0.36, 0, 1800, 1.5),
        voice("sine", 0, 0.14, 0.5, 0, 2200, 0.7, true)
      ]
    },
    "Spirale di Fibonacci (φ²)": {
      version: 1, baseFrequency: 89, piDepth: 0.45, morph: 0.5, resonatorAmount: 0.42,
      fxControl: 0.55, masterVolume: 0.8, primeMode: false, currentMode: "PHI2",
      voiceSettings: [
        voice("sawtooth", -0.55, 0.14, 0.34, -1, 2800, 1.0),
        voice("triangle", -0.2, 0.18, 0.42, 0.8, 3200, 0.8),
        voice("triangle", 0.2, 0.16, 0.5, -1.3, 2600, 0.9),
        voice("sawtooth", 0.55, 0.12, 0.58, 1.1, 3000, 1.1)
      ]
    },
    "Ombra di Eulero (γ)": {
      version: 1, baseFrequency: 72, piDepth: 0.25, morph: 0.05, resonatorAmount: 0.2,
      fxControl: 0.6, masterVolume: 0.8, primeMode: false, currentMode: "GAMMA",
      voiceSettings: [
        voice("sine", -0.35, 0.24, 0.3, -0.5, 1300, 0.6),
        voice("sine", -0.1, 0.18, 0.4, 0.4, 1500, 0.7, true),
        voice("sine", 0.1, 0.18, 0.46, -0.6, 1400, 0.7, true),
        voice("sine", 0.35, 0.22, 0.55, 0.6, 1200, 0.6)
      ]
    },
    "Pentagono Mistico (√5)": {
      version: 1, baseFrequency: 130.8, piDepth: 0.55, morph: 0.35, resonatorAmount: 0.5,
      fxControl: 0.52, masterVolume: 0.8, primeMode: false, currentMode: "SQRT5",
      voiceSettings: [
        voice("triangle", -0.65, 0.18, 0.32, -1.6, 2400, 1.0),
        voice("sine", -0.2, 0.16, 0.4, 1, 2800, 0.7),
        voice("triangle", 0.25, 0.17, 0.48, -0.8, 2200, 1.2),
        voice("sine", 0.65, 0.15, 0.55, 1.8, 2600, 0.8)
      ]
    },
    "Labirinto di Catalan (G)": {
      version: 1, baseFrequency: 120, piDepth: 0.5, morph: 0.6, resonatorAmount: 0.65,
      fxControl: 0.65, masterVolume: 0.8, primeMode: false, currentMode: "CATALAN",
      voiceSettings: [
        voice("sawtooth", -0.7, 0.13, 0.6, -1.2, 900, 3.5),
        voice("sawtooth", 0.7, 0.13, 0.7, 1.2, 950, 3.2),
        voice("triangle", -0.25, 0.16, 0.5, -0.4, 1100, 2.0),
        voice("triangle", 0.25, 0.16, 0.65, 0.4, 1050, 2.2)
      ]
    },
    "Cattedrale Esagonale (√3)": {
      version: 1, baseFrequency: 110, piDepth: 0.3, morph: 0.15, resonatorAmount: 0.6,
      fxControl: 0.85, masterVolume: 0.8, primeMode: false, currentMode: "SQRT3",
      voiceSettings: [
        voice("sine", -0.5, 0.2, 0.35, -0.7, 2000, 0.6),
        voice("triangle", -0.15, 0.16, 0.45, 0.5, 2400, 0.7),
        voice("sine", 0.2, 0.18, 0.55, -1, 1800, 0.6),
        voice("triangle", 0.55, 0.14, 0.65, 0.9, 2200, 0.8)
      ]
    },
    "Doppia Rivoluzione (τ)": {
      version: 1, baseFrequency: 65.4, piDepth: 0.6, morph: 0.7, resonatorAmount: 0.45,
      fxControl: 0.5, masterVolume: 0.8, primeMode: false, currentMode: "TAU",
      voiceSettings: [
        voice("sawtooth", -0.8, 0.13, 0.3, -1.5, 3600, 1.3),
        voice("square", -0.3, 0.1, 0.4, 1.1, 3000, 1.8),
        voice("sawtooth", 0.3, 0.13, 0.48, -2, 4200, 1.1),
        voice("triangle", 0.8, 0.16, 0.55, 1.7, 4600, 0.8)
      ]
    },
    "Basilea 1735 (ζ2)": {
      version: 1, baseFrequency: 92, piDepth: 0.42, morph: 0.22, resonatorAmount: 0.4,
      fxControl: 0.58, masterVolume: 0.8, primeMode: false, currentMode: "ZETA2",
      voiceSettings: [
        voice("sine", -0.55, 0.2, 0.33, -0.8, 2300, 0.7),
        voice("triangle", -0.2, 0.17, 0.4, 0.6, 2700, 0.8),
        voice("sine", 0.2, 0.18, 0.48, -1.1, 2500, 0.7),
        voice("triangle", 0.55, 0.15, 0.56, 1, 2100, 0.9)
      ]
    },
    "Griglia dei Primi (π·℘)": {
      version: 1, baseFrequency: 140, piDepth: 0.5, morph: 0.3, resonatorAmount: 0.45,
      fxControl: 0.4, masterVolume: 0.8, primeMode: true, currentMode: "PI",
      voiceSettings: [
        voice("square", -0.4, 0.14, 0.3, 0, 2400, 1.6),
        voice("sine", 0.4, 0.2, 0.42, 0, 2800, 0.7),
        voice("triangle", -0.15, 0.16, 0.5, 0, 2600, 1.0),
        voice("square", 0.15, 0.12, 0.58, 0, 2200, 1.8)
      ]
    }
  };

  const els = {
    driftToggle: document.getElementById("driftToggle"),
    driftRate: document.getElementById("driftRate"),
    driftRateVal: document.getElementById("driftRateVal"),
    driftDepth: document.getElementById("driftDepth"),
    driftDepthVal: document.getElementById("driftDepthVal"),
    presetName: document.getElementById("presetName"),
    presetSaveBtn: document.getElementById("presetSaveBtn"),
    presetList: document.getElementById("presetList"),
    presetLoadBtn: document.getElementById("presetLoadBtn"),
    presetDeleteBtn: document.getElementById("presetDeleteBtn"),
    presetExportBtn: document.getElementById("presetExportBtn"),
    presetImportInput: document.getElementById("presetImportInput"),
    presetStatus: document.getElementById("presetStatus"),
    presetPanel: document.getElementById("preset-panel")
  };

  let statusTimer = null;
  function status(message, isError = false) {
    if (!els.presetStatus) return;
    els.presetStatus.textContent = message;
    els.presetStatus.style.color = isError ? "#ff7777" : "";
    if (statusTimer) clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      els.presetStatus.textContent = "";
    }, 4000);
  }

  // ---------------------------------------------------------------------
  // Evolve / drift mode: slow random walk on the macro controls, applied
  // through the existing sliders so UI and audio stay in sync and every
  // change goes through the smoothed ramps.
  // ---------------------------------------------------------------------
  let driftTimer = null;

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function nudgeSlider(slider, fraction) {
    if (!slider) return;
    const min = parseFloat(slider.min);
    const max = parseFloat(slider.max);
    const span = max - min;
    const current = parseFloat(slider.value);
    const next = clamp(current + (Math.random() * 2 - 1) * span * fraction, min, max);
    slider.value = next;
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function driftTick() {
    const depth = els.driftDepth ? parseFloat(els.driftDepth.value) : 0.35;
    nudgeSlider(document.getElementById("morph"), 0.07 * depth);
    nudgeSlider(document.getElementById("resonatorAmount"), 0.06 * depth);
    nudgeSlider(document.getElementById("fxAmount"), 0.05 * depth);
    nudgeSlider(document.getElementById("baseFreq"), 0.008 * depth);
    for (let i = 0; i < 4; i++) {
      nudgeSlider(document.getElementById(`voice-${i}-cutoff`), 0.05 * depth);
    }
  }

  function driftIntervalMs() {
    const rate = els.driftRate ? parseFloat(els.driftRate.value) : 0.3;
    return Math.round(5000 - rate * 4400);
  }

  function restartDrift() {
    if (driftTimer) {
      clearInterval(driftTimer);
      driftTimer = null;
    }
    if (els.driftToggle && els.driftToggle.checked) {
      driftTimer = setInterval(driftTick, driftIntervalMs());
    }
  }

  els.driftToggle?.addEventListener("change", restartDrift);
  els.driftRate?.addEventListener("input", () => {
    if (els.driftRateVal) els.driftRateVal.textContent = parseFloat(els.driftRate.value).toFixed(2);
    restartDrift();
  });
  els.driftDepth?.addEventListener("input", () => {
    if (els.driftDepthVal) els.driftDepthVal.textContent = parseFloat(els.driftDepth.value).toFixed(2);
  });

  // ---------------------------------------------------------------------
  // Preset manager
  // ---------------------------------------------------------------------
  function loadStore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (error) {
      return {};
    }
  }

  function saveStore(store) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
      return true;
    } catch (error) {
      status("Storage not available", true);
      return false;
    }
  }

  function getSelectedPreset() {
    const value = els.presetList?.value || "";
    const sep = value.indexOf(":");
    if (sep < 0) return null;
    const kind = value.slice(0, sep);
    const name = value.slice(sep + 1);
    const state = kind === "factory" ? FACTORY_PRESETS[name] : loadStore()[name];
    return state ? { kind, name, state } : null;
  }

  function updateButtonStates() {
    const selected = els.presetList?.value || "";
    if (els.presetLoadBtn) els.presetLoadBtn.disabled = !selected;
    if (els.presetDeleteBtn) els.presetDeleteBtn.disabled = !selected.startsWith("user:");
  }

  function refreshList(selectValue) {
    if (!els.presetList) return;
    const store = loadStore();
    els.presetList.innerHTML = "";
    const addGroup = (label, names, kind) => {
      if (!names.length) return;
      const group = document.createElement("optgroup");
      group.label = label;
      names.forEach(name => {
        const option = document.createElement("option");
        option.value = `${kind}:${name}`;
        option.textContent = name;
        group.appendChild(option);
      });
      els.presetList.appendChild(group);
    };
    addGroup("Factory", Object.keys(FACTORY_PRESETS), "factory");
    addGroup("User", Object.keys(store).sort((a, b) => a.localeCompare(b)), "user");
    if (selectValue) {
      els.presetList.value = selectValue;
    }
    updateButtonStates();
  }

  function savePreset() {
    if (!window.DroneAPI) return;
    const name = (els.presetName?.value || "").trim() || `Preset ${new Date().toLocaleString()}`;
    const store = loadStore();
    store[name] = window.DroneAPI.getState();
    if (saveStore(store)) {
      refreshList(`user:${name}`);
      status(`Saved "${name}"`);
    }
  }

  function loadPreset() {
    if (!window.DroneAPI) return;
    const selected = getSelectedPreset();
    if (selected && window.DroneAPI.applyState(selected.state)) {
      status(`Loaded "${selected.name}"`);
    } else {
      status("Preset not found or invalid", true);
    }
  }

  function deletePreset() {
    const selected = getSelectedPreset();
    if (!selected) return;
    if (selected.kind === "factory") {
      status("Factory presets cannot be deleted", true);
      return;
    }
    const store = loadStore();
    delete store[selected.name];
    if (saveStore(store)) {
      refreshList();
      status(`Deleted "${selected.name}"`);
    }
  }

  function exportPreset() {
    if (!window.DroneAPI) return;
    const selected = getSelectedPreset();
    const name = selected?.name || "current";
    const state = selected?.state || window.DroneAPI.getState();
    const payload = { app: "dronepigreco", name, state };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `drone-pi-${name.replace(/[^a-z0-9_-]+/gi, "_")}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    status(`Exported "${name}"`);
  }

  function importPresetText(text, fileName) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      status("Invalid file: not JSON", true);
      return;
    }
    const state = parsed?.state && typeof parsed.state === "object" ? parsed.state : parsed;
    if (!window.DroneAPI?.applyState(state)) {
      status("Invalid preset file", true);
      return;
    }
    const name = parsed?.name || (fileName || "imported").replace(/\.json$/i, "");
    const store = loadStore();
    store[name] = window.DroneAPI.getState();
    saveStore(store);
    refreshList(`user:${name}`);
    status(`Imported "${name}"`);
  }

  // FileReader + <input type="file"> works on every browser including
  // iOS/Android, unlike the File System Access API.
  function importPresetFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => importPresetText(String(reader.result), file.name);
    reader.onerror = () => status("Could not read file", true);
    reader.readAsText(file);
  }

  els.presetList?.addEventListener("change", updateButtonStates);
  els.presetSaveBtn?.addEventListener("click", savePreset);
  els.presetLoadBtn?.addEventListener("click", loadPreset);
  els.presetDeleteBtn?.addEventListener("click", deletePreset);
  els.presetExportBtn?.addEventListener("click", exportPreset);
  els.presetImportInput?.addEventListener("change", event => {
    importPresetFile(event.target.files?.[0]);
    event.target.value = "";
  });

  // Desktop drag & drop onto the preset panel.
  if (els.presetPanel) {
    els.presetPanel.addEventListener("dragover", event => {
      event.preventDefault();
    });
    els.presetPanel.addEventListener("drop", event => {
      event.preventDefault();
      importPresetFile(event.dataTransfer?.files?.[0]);
    });
  }

  refreshList();
})();
