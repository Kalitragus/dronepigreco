const VOICE_COUNT = 4;
const WAVEFORMS = ["sine", "triangle", "sawtooth", "square"];
const RESONATOR_FREQS = [200, 500, 1200, 2500];
const MAX_BASE_FREQ = 440;
const MIN_BASE_FREQ = 20;

const defaultVoices = [
  { waveform: "sine", pan: -0.6, gain: 0.22, delay: 0.28, detune: -1.4, cutoff: 4000, resonance: 0.7, mute: false },
  { waveform: "sine", pan: -0.2, gain: 0.18, delay: 0.34, detune: 0.8, cutoff: 4000, resonance: 0.7, mute: false },
  { waveform: "sine", pan: 0.25, gain: 0.16, delay: 0.42, detune: -2.1, cutoff: 4000, resonance: 0.7, mute: false },
  { waveform: "sine", pan: 0.6, gain: 0.14, delay: 0.5, detune: 1.6, cutoff: 4000, resonance: 0.7, mute: false }
];

let audioCtx;
let masterGain;
let safetyLimiter;
let impulseBuffer;
let piFxModule;
let piReverbModule;
let tailDelay;
let tailFeedbackGain;
let voices = [];
let isRunning = false;

let baseFrequency = 220;
let piDepth = 0.4;
let morph = 0;
let resonatorAmount = 0.35;
let fxControl = 0.5;
let fxAmount = mapFxAmount(fxControl);
let masterVolume = 0.8;
let voiceSettings = defaultVoices.map(v => ({ ...v }));
let primeMode = false;
let currentMode = "PI";
let transitionCooldownUntil = 0;
let isCrossfading = false;
let modulationInterval = null;
let fpsTracking = false;
let frames = 0;
let lastFrameTime = 0;
let cpuLevel = 0;
let crossfadeTimer = null;
let crossfadeResumeTimer = null;
let lastModLog = 0;
let fadeStatus = "Idle";
let octaveOffset = 0;
let baseFrequencyMemory = null;
const activeKeyCodes = new Set();
let keyboardInitialized = false;
let keyboardEnabled = false;

const MODE_LABELS = {
  PI: "π",
  E: "e",
  PHI: "φ",
  ZETA3: "ζ(3)",
  SQRT2: "√2",
  PHI2: "φ²",
  GAMMA: "γ",
  SQRT5: "√5",
  CATALAN: "G",
  SQRT3: "√3",
  TAU: "τ",
  ZETA2: "ζ(2)"
};

const MODE_IDS = {
  PI: "pi-mode",
  E: "e-mode",
  PHI: "phi-mode",
  ZETA3: "zeta-mode",
  SQRT2: "sqrt2-mode",
  PHI2: "phi2-mode",
  GAMMA: "gamma-mode",
  SQRT5: "sqrt5-mode",
  CATALAN: "catalan-mode",
  SQRT3: "sqrt3-mode",
  TAU: "tau-mode",
  ZETA2: "zeta2-mode"
};

const KEY_TO_SEMITONE = {
  KeyA: 0,
  KeyW: 1,
  KeyS: 2,
  KeyE: 3,
  KeyD: 4,
  KeyF: 5,
  KeyT: 6,
  KeyG: 7,
  KeyY: 8,
  KeyH: 9,
  KeyU: 10,
  KeyJ: 11,
  KeyK: 12
};

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const KEYBOARD_MIN_OCTAVE = -24;
const KEYBOARD_MAX_OCTAVE = 24;

const ui = {
  startBtn: document.getElementById("startBtn"),
  stopBtn: document.getElementById("stopBtn"),
  randomBtn: document.getElementById("randomBtn"),
  baseFreq: document.getElementById("baseFreq"),
  baseFreqVal: document.getElementById("baseFreqVal"),
  piDepth: document.getElementById("piDepth"),
  piDepthVal: document.getElementById("piDepthVal"),
  morph: document.getElementById("morph"),
  morphVal: document.getElementById("morphVal"),
  resonatorAmount: document.getElementById("resonatorAmount"),
  resonatorVal: document.getElementById("resonatorVal"),
  fxAmount: document.getElementById("fxAmount"),
  fxAmountVal: document.getElementById("fxAmountVal"),
  masterVolume: document.getElementById("masterVolume"),
  masterVolumeVal: document.getElementById("masterVolumeVal"),
  modeButtons: {},
  primeToggle: document.getElementById("primeMode"),
  voiceFreqs: Array.from({ length: VOICE_COUNT }, (_, i) => document.getElementById(`voice-${i}-freq`)),
  voiceWaveforms: Array.from({ length: VOICE_COUNT }, (_, i) => document.getElementById(`voice-${i}-waveform`)),
  voicePan: Array.from({ length: VOICE_COUNT }, (_, i) => document.getElementById(`voice-${i}-pan`)),
  voicePanVal: Array.from({ length: VOICE_COUNT }, (_, i) => document.getElementById(`voice-${i}-pan-val`)),
  voiceGain: Array.from({ length: VOICE_COUNT }, (_, i) => document.getElementById(`voice-${i}-gain`)),
  voiceGainVal: Array.from({ length: VOICE_COUNT }, (_, i) => document.getElementById(`voice-${i}-gain-val`)),
  voiceCutoff: Array.from({ length: VOICE_COUNT }, (_, i) => document.getElementById(`voice-${i}-cutoff`)),
  voiceCutoffVal: Array.from({ length: VOICE_COUNT }, (_, i) => document.getElementById(`voice-${i}-cutoff-val`)),
  voiceResonance: Array.from({ length: VOICE_COUNT }, (_, i) => document.getElementById(`voice-${i}-res`)),
  voiceResonanceVal: Array.from({ length: VOICE_COUNT }, (_, i) => document.getElementById(`voice-${i}-res-val`)),
  voiceMute: Array.from({ length: VOICE_COUNT }, (_, i) => document.getElementById(`voice-${i}-mute`)),
  currentNote: document.getElementById("current-note"),
  kbToggle: document.getElementById("kbToggle")
};

const perfEl = document.getElementById("perf-stats");

function buildModeButtons() {
  const container = document.querySelector("#math-mode-controls .mode-buttons");
  if (!container) {
    console.warn("[Drone] Mode button container not found.");
    return false;
  }

  ui.modeButtons = {};

  const randomBtnId = "random-mode";
  const randomBtn = document.getElementById(randomBtnId) || (() => {
    const btn = document.createElement("button");
    btn.id = randomBtnId;
    btn.className = "mode-btn random";
    btn.type = "button";
    btn.textContent = "RANDOM";
    container.appendChild(btn);
    return btn;
  })();

  Object.entries(MODE_IDS).forEach(([mode, id]) => {
    let button = document.getElementById(id);
    if (!button) {
      button = document.createElement("button");
      button.id = id;
      button.type = "button";
      button.className = "mode-btn";
      button.innerHTML = `<span>${MODE_LABELS[mode] || mode}</span><span class="indicator"></span>`;
      container.insertBefore(button, randomBtn);
    } else if (!button.classList.contains("mode-btn")) {
      button.classList.add("mode-btn");
      if (!button.querySelector(".indicator")) {
        button.innerHTML = `<span>${MODE_LABELS[mode] || mode}</span><span class="indicator"></span>`;
      }
    }
    ui.modeButtons[mode] = button;
  });

  ui.modeButtons.RANDOM = randomBtn;
  return true;
}

function ensureAudioContext() {
  if (!audioCtx) {
    // A host page (studio shell) can provide a shared context and master bus
    // via window.SharedAudio; never create a second AudioContext beside it.
    const shared = window.SharedAudio;
    if (shared?.ctx) {
      audioCtx = shared.ctx;
    } else {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      try {
        // "playback" trades latency for a larger buffer: fewer underruns on mobile.
        audioCtx = new AudioContextCtor({ latencyHint: "playback" });
      } catch (error) {
        audioCtx = new AudioContextCtor();
      }
    }
    window.audioCtx = audioCtx;
    masterGain = audioCtx.createGain();
    masterGain.gain.value = masterVolume;
    tailDelay = audioCtx.createDelay(5);
    tailDelay.delayTime.value = 0.6;
    tailFeedbackGain = audioCtx.createGain();
    tailFeedbackGain.gain.value = 0.25;
    tailDelay.connect(tailFeedbackGain).connect(tailDelay);

    let outputBus;
    if (shared?.masterBus) {
      outputBus = shared.masterBus;
    } else {
      safetyLimiter = audioCtx.createDynamicsCompressor();
      safetyLimiter.threshold.value = -9;
      safetyLimiter.knee.value = 6;
      safetyLimiter.ratio.value = 16;
      safetyLimiter.attack.value = 0.002;
      safetyLimiter.release.value = 0.25;
      safetyLimiter.connect(audioCtx.destination);
      outputBus = safetyLimiter;
    }

    masterGain.connect(tailDelay);
    masterGain.connect(outputBus);
    tailDelay.connect(outputBus);

    impulseBuffer = createImpulseResponse(audioCtx, 1.6, 2.3);
    piFxModule = new PiFX(audioCtx);
    piFxModule.setAmount(fxAmount);
    piFxModule.setPrimeMode(primeMode);
    piFxModule.setMathMode(currentMode);

    piReverbModule = new PiReverb(audioCtx, pigreco);
    piReverbModule.setPrimeMode(primeMode);
    piReverbModule.setMathMode(currentMode);
    piReverbModule.updatePi(baseFrequency);
    piReverbModule.setWetDry(fxAmount, false);
    piReverbModule.connect(masterGain);
    piFxModule.connect(piReverbModule.input);
    updateFxAmount(false);
    applyDepthScaling();
  } else {
    window.audioCtx = audioCtx;
  }
  startPerformanceMonitor();
  return audioCtx;
}

function createImpulseResponse(ctx, seconds = 1.5, decay = 2.4) {
  const rate = ctx.sampleRate;
  const length = Math.floor(seconds * rate);
  const impulse = ctx.createBuffer(2, length, rate);
  for (let channel = 0; channel < 2; channel++) {
    const data = impulse.getChannelData(channel);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      const envelope = Math.pow(1 - t, decay);
      data[i] = (Math.random() * 2 - 1) * envelope * Math.cos(Math.PI * t * (1 + channel * 0.25));
    }
  }
  return impulse;
}

function clampValue(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function frequencyToNoteNumber(freq) {
  return Math.round(12 * Math.log2(freq / 440)) + 69;
}

function frequencyToNoteLabel(freq) {
  const midi = frequencyToNoteNumber(freq);
  const name = NOTE_NAMES[((midi % 12) + 12) % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

function updateCurrentNoteDisplay(freq) {
  if (!ui.currentNote) return;
  ui.currentNote.textContent = frequencyToNoteLabel(freq);
}

function applyBaseFrequency(freq, options = {}) {
  const { updateSlider = true } = options;
  const clamped = clampValue(freq, MIN_BASE_FREQ, MAX_BASE_FREQ);
  baseFrequency = clamped;
  if (updateSlider && ui.baseFreq) {
    ui.baseFreq.value = clamped.toFixed(2);
  }
  if (ui.baseFreqVal) {
    ui.baseFreqVal.textContent = `${clamped.toFixed(2)} Hz`;
  }
  updateCurrentNoteDisplay(clamped);
  if (piReverbModule) {
    piReverbModule.updatePi(baseFrequency);
  }
  updateFrequencyDisplays();
  if (!audioCtx || !voices.length) return;
  voices.forEach((_, index) => updateVoiceFrequency(index));
}

function clampCutoff(value) {
  return Math.min(8000, Math.max(500, value));
}

function mapFxAmount(value) {
  const clamped = Math.min(1, Math.max(0, value));
  return Math.pow(clamped, 0.7) * 0.65;
}

function getFxDisplay() {
  return fxAmount;
}

function getNormalizedDepth() {
  return Math.min(1, Math.max(0, piDepth));
}

function applyDepthScaling(immediate = false) {
  const depth = getNormalizedDepth();
  if (piFxModule) {
    piFxModule.setDepthScale(depth);
  }
  if (piReverbModule) {
    piReverbModule.setDepthScale(depth);
  }
  if (immediate && audioCtx && voices.length && !isCrossfading) {
    updateAllModulations(audioCtx.currentTime);
  }
}

function getModulationLabel() {
  const base = MODE_LABELS[currentMode] || currentMode;
  if (primeMode) return `Prime|${base}`;
  return base;
}

function getModulationTargets() {
  const targets = new Set();
  if (voices.length) {
    targets.add("filter");
  }
  if (piFxModule) {
    targets.add("delay");
  }
  if (piReverbModule) {
    targets.add("reverb");
  }
  return Array.from(targets);
}

function getVoiceSummary() {
  if (!voiceSettings || !voiceSettings.length) return "N/A";
  const forms = voiceSettings.map(v => (v?.waveform || "sine").toUpperCase());
  const unique = new Set(forms);
  return unique.size === 1 ? forms[0] : "Mixed";
}

function logModulationDebug() {
  if (!audioCtx) return;
  const now = performance.now();
  if (now - lastModLog < 1000) return;
  lastModLog = now;
  const label = getModulationLabel();
  const targets = getModulationTargets().join(", ");
  console.log(
    `[MOD DEBUG] Model=${label} | Depth=${getNormalizedDepth().toFixed(2)} | FX=${getFxDisplay().toFixed(2)} | Voices=${getVoiceSummary()} | Fade=${fadeStatus} | Nodes=${targets}`
  );
}

function updateAllModulations(time) {
  if (!audioCtx || !voices.length) return;
  const depth = getNormalizedDepth();
  voices.forEach((voice, index) => {
    if (!voice || !voice.filter) return;
    const settings = voiceSettings[index] || {};
    const base = clampCutoff(settings.cutoff ?? 4000);
    const mod = Math.sin(time * Math.PI * 0.5);
    const swing = 0.04 * depth;
    const target = clampCutoff(base * (1 + mod * swing));
    voice.filter.frequency.setTargetAtTime(target, time, 0.12);
  });
  piReverbModule?.updateParameters(time);
}

function measureCPU(startTime, intervalMs = 50) {
  const elapsed = performance.now() - startTime;
  cpuLevel = Math.min(100, (elapsed / intervalMs) * 100);
}

function trackFPS() {
  if (!fpsTracking) return;
  frames += 1;
  const now = performance.now();
  if (!lastFrameTime) {
    lastFrameTime = now;
  }
  if (now - lastFrameTime >= 1000) {
    if (perfEl) {
      perfEl.textContent = `CPU: ${cpuLevel.toFixed(1)} % | FPS: ${frames}`;
    }
    frames = 0;
    lastFrameTime = now;
  }
  requestAnimationFrame(trackFPS);
}

function startPerformanceMonitor() {
  if (modulationInterval) return;
  const intervalMs = 100;
  fpsTracking = true;
  if (perfEl) {
    perfEl.textContent = `CPU: ${cpuLevel.toFixed(1)} % | FPS: 0`;
  }
  requestAnimationFrame(trackFPS);
  modulationInterval = setInterval(() => {
    if (!audioCtx) return;
    const start = performance.now();
    if (masterGain?.gain?.value > 0.01 && !isCrossfading) {
      updateAllModulations(audioCtx.currentTime);
      logModulationDebug();
    }
    measureCPU(start, intervalMs);
    if (perfEl) {
      if (cpuLevel > 75) {
        perfEl.classList.add("alert");
      } else {
        perfEl.classList.remove("alert");
      }
    }
  }, intervalMs);
}

function createVoice(index) {
  const settings = voiceSettings[index];

  const osc = audioCtx.createOscillator();
  osc.type = settings.waveform;

  const panNode = audioCtx.createStereoPanner();
  panNode.pan.value = settings.pan;

  const gainNode = audioCtx.createGain();
  gainNode.gain.value = 0;

  const delayNode = audioCtx.createDelay(1);
  delayNode.delayTime.value = settings.delay;

  const convolver = audioCtx.createConvolver();
  convolver.buffer = impulseBuffer;

  const resonatorInput = audioCtx.createGain();
  resonatorInput.gain.value = 1;

  const dryGain = audioCtx.createGain();
  dryGain.gain.value = 1;

  const resonatorMix = audioCtx.createGain();
  resonatorMix.gain.value = resonatorAmount;

  const filter = audioCtx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = clampCutoff(settings.cutoff ?? 4000);
  filter.Q.value = settings.resonance ?? 0.7;

  const resonatorFilters = RESONATOR_FREQS.map((freq, idx) => {
    const filter = audioCtx.createBiquadFilter();
    filter.type = "peaking";
    filter.frequency.value = freq;
    filter.Q.value = 5 - idx * 0.6;
    filter.gain.value = 7 - idx * 1.2;
    resonatorInput.connect(filter);
    filter.connect(resonatorMix);
    return filter;
  });

  const pitchLfo = audioCtx.createOscillator();
  pitchLfo.type = "sine";
  pitchLfo.frequency.value = 0.08 + index * 0.05;
  const pitchLfoGain = audioCtx.createGain();
  pitchLfoGain.gain.value = piDepth * 5;
  pitchLfo.connect(pitchLfoGain).connect(osc.frequency);

  osc.connect(gainNode);
  gainNode.connect(delayNode);
  delayNode.connect(convolver);
  convolver.connect(resonatorInput);
  resonatorInput.connect(dryGain);
  dryGain.connect(filter);
  resonatorMix.connect(filter);
  filter.connect(panNode);

  if (piFxModule) {
    panNode.connect(piFxModule.input);
  } else {
    panNode.connect(masterGain);
  }

  return {
    index,
    osc,
    gainNode,
    delayNode,
    convolver,
    resonatorInput,
    resonatorMix,
    dryGain,
    filter,
    panNode,
    resonatorFilters,
    pitchLfo,
    pitchLfoGain
  };
}

function updateVoiceFrequency(index) {
  const settings = voiceSettings[index];
  const base = pigreco(baseFrequency, index, { usePrimes: primeMode, mode: currentMode });
  const freq = base + settings.detune;
  if (ui.voiceFreqs[index]) {
    ui.voiceFreqs[index].textContent = `${freq.toFixed(1)} Hz`;
  }
  const voice = voices[index];
  if (!voice || !audioCtx) return;
  const now = audioCtx.currentTime;
  voice.osc.frequency.setTargetAtTime(Math.max(20, freq), now, 0.08);
}

function updateVoiceGain(index) {
  const voice = voices[index];
  if (!voice || !audioCtx) return;
  const settings = voiceSettings[index];
  const gainValue = settings.mute ? 0 : Math.max(0, settings.gain);
  const now = audioCtx.currentTime;
  voice.gainNode.gain.setTargetAtTime(gainValue, now, 0.15);
}

function updateMuteButton(index) {
  const btn = ui.voiceMute[index];
  if (!btn) return;
  const muted = !!voiceSettings[index]?.mute;
  btn.classList.toggle("active", muted);
  btn.setAttribute("aria-pressed", muted ? "true" : "false");
}

function setVoiceMute(index, muted) {
  if (!voiceSettings[index]) return;
  voiceSettings[index].mute = !!muted;
  updateMuteButton(index);
  updateVoiceGain(index);
}

function updateVoicePan(index) {
  const voice = voices[index];
  if (!voice || !audioCtx) return;
  const basePan = voiceSettings[index].pan;
  const mirror = -basePan;
  const target = basePan * (1 - morph) + mirror * morph;
  const now = audioCtx.currentTime;
  voice.panNode.pan.setTargetAtTime(target, now, 0.15);
}

function updateVoiceDelay(index) {
  const voice = voices[index];
  if (!voice || !audioCtx) return;
  const settings = voiceSettings[index];
  const offset = (index / (VOICE_COUNT - 1 || 1)) - 0.5;
  const target = Math.min(0.8, Math.max(0, settings.delay + offset * morph * 0.25));
  const now = audioCtx.currentTime;
  voice.delayNode.delayTime.setTargetAtTime(target, now, 0.25);
}

function updateVoiceCutoff(index) {
  const voice = voices[index];
  if (!voice || !audioCtx || !voice.filter) return;
  const now = audioCtx.currentTime;
  const target = clampCutoff(voiceSettings[index]?.cutoff ?? 4000);
  voice.filter.frequency.cancelScheduledValues(now);
  voice.filter.frequency.setTargetAtTime(target, now, 0.05);
}

function updateVoiceResonance(index) {
  const voice = voices[index];
  if (!voice || !audioCtx || !voice.filter) return;
  const now = audioCtx.currentTime;
  const target = Math.min(10, Math.max(0.1, voiceSettings[index]?.resonance ?? 0.7));
  voice.filter.Q.cancelScheduledValues(now);
  voice.filter.Q.setTargetAtTime(target, now, 0.05);
}

function updateResonatorMix() {
  resonatorAmount = parseFloat(ui.resonatorAmount.value);
  ui.resonatorVal.textContent = resonatorAmount.toFixed(2);
  if (!audioCtx || !voices.length) return;
  voices.forEach(voice => {
    if (!voice) return;
    const now = audioCtx.currentTime;
    voice.resonatorMix.gain.setTargetAtTime(resonatorAmount, now, 0.2);
  });
}

function updatePiDepth() {
  piDepth = parseFloat(ui.piDepth.value);
  ui.piDepthVal.textContent = piDepth.toFixed(2);
  const canApplyNow = !!(audioCtx && voices.length);
  applyDepthScaling(canApplyNow);
  if (!canApplyNow) return;
  voices.forEach(voice => {
    if (!voice) return;
    voice.pitchLfoGain.gain.setTargetAtTime(piDepth * 5, audioCtx.currentTime, 0.25);
  });
}

function updateMorph() {
  morph = parseFloat(ui.morph.value);
  ui.morphVal.textContent = morph.toFixed(2);
  if (!audioCtx || !voices.length) return;
  voices.forEach((_, index) => {
    updateVoicePan(index);
    updateVoiceDelay(index);
  });
}

function updateBaseFrequency() {
  if (!ui.baseFreq) return;
  const raw = parseFloat(ui.baseFreq.value);
  if (!Number.isFinite(raw)) return;
  applyBaseFrequency(raw, { updateSlider: true });
}

function updateFxAmount(manual = true) {
  if (!ui.fxAmount) return;
  const raw = parseFloat(ui.fxAmount.value);
  const normalized = Number.isFinite(raw) ? raw : 0;
  fxControl = Math.min(1, Math.max(0, normalized));
  fxAmount = mapFxAmount(fxControl);
  ui.fxAmountVal.textContent = fxAmount.toFixed(2);
  if (piFxModule && audioCtx) {
    piFxModule.setAmount(fxAmount);
  }
  if (piReverbModule) {
    piReverbModule.setWetDry(fxAmount, manual);
  }
}

function updateMasterVolume() {
  masterVolume = parseFloat(ui.masterVolume.value);
  ui.masterVolumeVal.textContent = masterVolume.toFixed(2);
  if (audioCtx && masterGain) {
    const now = audioCtx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(masterVolume, now + 0.2);
  }
}

function smoothModeTransition(applyFn) {
  if (!audioCtx || !masterGain) {
    applyFn();
    return;
  }
  const fadeOutDuration = 0.3;
  const fadeInDuration = 0.3;
  const safeFloor = 0.0001;
  if (crossfadeTimer) {
    clearTimeout(crossfadeTimer);
    crossfadeTimer = null;
  }
  if (crossfadeResumeTimer) {
    clearTimeout(crossfadeResumeTimer);
    crossfadeResumeTimer = null;
  }
  isCrossfading = true;
  fadeStatus = "Active";
  const now = audioCtx.currentTime;
  transitionCooldownUntil = now + fadeOutDuration + fadeInDuration + 0.1;
  const target = masterVolume;
  const currentValue = masterGain.gain.value;
  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.setValueAtTime(currentValue, now);
  masterGain.gain.linearRampToValueAtTime(safeFloor, now + fadeOutDuration);
  piFxModule?.freeze(fadeOutDuration + 0.05);
  piReverbModule?.freeze(fadeOutDuration + 0.05);

  const switchDelay = fadeOutDuration * 1000 + 20;
  crossfadeTimer = setTimeout(() => {
    applyFn();
    const resumeTime = audioCtx.currentTime;
    masterGain.gain.cancelScheduledValues(resumeTime);
    masterGain.gain.setValueAtTime(masterGain.gain.value, resumeTime);
    masterGain.gain.linearRampToValueAtTime(target, resumeTime + fadeInDuration);
    crossfadeResumeTimer = setTimeout(() => {
      isCrossfading = false;
      fadeStatus = "Idle";
      transitionCooldownUntil = audioCtx ? audioCtx.currentTime : 0;
      voices.forEach((_, index) => applyVoiceControls(index));
      updateFrequencyDisplays();
      if (audioCtx) {
        updateAllModulations(audioCtx.currentTime);
      }
      crossfadeTimer = null;
      crossfadeResumeTimer = null;
    }, fadeInDuration * 1000 + 40);
  }, switchDelay);
}

function updateModeButtonsActive(mode) {
  Object.entries(ui.modeButtons).forEach(([key, btn]) => {
    if (!btn || key === "RANDOM") return;
    if (key === mode) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
}

function applyPrimeState(enabled) {
  primeMode = enabled;
  if (ui.primeToggle) ui.primeToggle.checked = enabled;
  if (piFxModule) {
    piFxModule.setPrimeMode(enabled);
  }
  if (piReverbModule) {
    piReverbModule.setPrimeMode(enabled);
    piReverbModule.updatePi(baseFrequency);
  }
  applyDepthScaling();
  updateFrequencyDisplays();
}

function updatePrimeMode(enabled, force = false) {
  if (primeMode === enabled && !force) return;
  if (!audioCtx || !isRunning) {
    applyPrimeState(enabled);
    return;
  }
  smoothModeTransition(() => {
    applyPrimeState(enabled);
  });
}

function applyMathMode(mode) {
  currentMode = mode;
  updateModeButtonsActive(mode);
  if (piFxModule) {
    piFxModule.setMathMode(mode);
  }
  if (piReverbModule) {
    piReverbModule.setMathMode(mode);
    piReverbModule.updatePi(baseFrequency);
  }
  applyDepthScaling();
  if (voices.length) {
    voices.forEach((_, index) => applyVoiceControls(index));
  }
  updateFrequencyDisplays();
}

function setMathMode(mode) {
  if (mode === currentMode) return;
  if (!audioCtx || !isRunning) {
    applyMathMode(mode);
    return;
  }
  smoothModeTransition(() => {
    applyMathMode(mode);
  });
}

function randomizeMathMode() {
  const available = Object.keys(ui.modeButtons).filter(modeKey =>
    modeKey !== "RANDOM" && modeKey !== currentMode
  );
  const next = available[Math.floor(Math.random() * available.length)] || currentMode;
  ui.modeButtons.RANDOM?.classList.add("active");
  setTimeout(() => ui.modeButtons.RANDOM?.classList.remove("active"), 360);
  setMathMode(next);
}

function applyVoiceControls(index) {
  updateVoiceFrequency(index);
  updateVoiceGain(index);
  updateVoicePan(index);
  updateVoiceDelay(index);
  updateVoiceCutoff(index);
  updateVoiceResonance(index);
}

function updateFrequencyDisplays() {
  voiceSettings.forEach((settings, index) => {
    if (!ui.voiceFreqs[index]) return;
    const base = pigreco(baseFrequency, index, { usePrimes: primeMode, mode: currentMode });
    const displayFreq = base + (settings.detune || 0);
    ui.voiceFreqs[index].textContent = `${displayFreq.toFixed(1)} Hz`;
  });
}

function startDrone() {
  ensureAudioContext();
  if (isRunning) {
    audioCtx.resume();
    return;
  }

  const startTime = audioCtx.currentTime + 0.05;
  masterGain.gain.setValueAtTime(masterGain.gain.value, audioCtx.currentTime);
  masterGain.gain.linearRampToValueAtTime(masterVolume, startTime + 0.5);
  if (tailFeedbackGain) {
    tailFeedbackGain.gain.cancelScheduledValues(audioCtx.currentTime);
    tailFeedbackGain.gain.setValueAtTime(0.25, startTime);
  }

  if (piReverbModule && !piReverbModule.isConnected) {
    piReverbModule.connect(masterGain);
    piReverbModule.setPrimeMode(primeMode);
    piReverbModule.setMathMode(currentMode);
    piReverbModule.updatePi(baseFrequency);
    piReverbModule.startModulation();
    piReverbModule.setWetDry(fxAmount, false);
    piReverbModule.master.gain.setTargetAtTime(1, startTime, 0.6);
  } else {
    piReverbModule?.startModulation();
  }

  voices = Array.from({ length: VOICE_COUNT }, (_, index) => createVoice(index));
  voices.forEach((voice, index) => {
    const freqBase = pigreco(baseFrequency, index, { usePrimes: primeMode, mode: currentMode });
    const freq = freqBase + voiceSettings[index].detune;
    voice.osc.frequency.setValueAtTime(Math.max(20, freq), audioCtx.currentTime);
    voice.gainNode.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    voice.pitchLfo.start(startTime);
    voice.osc.start(startTime);
    applyVoiceControls(index);
  });

  if (ui.stopBtn) ui.stopBtn.disabled = false;
  isRunning = true;
}

function stopDrone() {
  if (!audioCtx || !isRunning) return;

  const now = audioCtx.currentTime;
  const stopTime = now + 0.35;
  const fadeEnd = now + 3;
  masterGain.gain.cancelScheduledValues(now);
  masterGain.gain.setValueAtTime(masterGain.gain.value, now);
  masterGain.gain.linearRampToValueAtTime(0.0001, fadeEnd);
  if (tailFeedbackGain) {
    tailFeedbackGain.gain.cancelScheduledValues(now);
    tailFeedbackGain.gain.setValueAtTime(tailFeedbackGain.gain.value, now);
    tailFeedbackGain.gain.linearRampToValueAtTime(0, fadeEnd + 1);
  }
  if (tailDelay) {
    tailDelay.delayTime.cancelScheduledValues(now);
    tailDelay.delayTime.setTargetAtTime(0.6, now, 0.5);
  }
  voices.forEach(voice => {
    voice.gainNode.gain.linearRampToValueAtTime(0.0001, stopTime - 0.1);
    voice.dryGain.gain.linearRampToValueAtTime(0.0001, stopTime - 0.1);
    voice.resonatorMix.gain.linearRampToValueAtTime(0.0001, stopTime - 0.1);
    voice.pitchLfoGain.gain.linearRampToValueAtTime(0, stopTime - 0.1);
    voice.osc.stop(stopTime);
    voice.pitchLfo.stop(stopTime);
  });

  if (piReverbModule) {
    piReverbModule.stopWithFade();
  }

  setTimeout(() => {
    voices = [];
    isRunning = false;
    if (ui.stopBtn) ui.stopBtn.disabled = true;
    if (masterGain) {
      masterGain.gain.setValueAtTime(0.0001, audioCtx.currentTime);
    }
    if (tailFeedbackGain) {
      tailFeedbackGain.gain.setValueAtTime(0, audioCtx.currentTime);
    }
  }, 3200);
}

function isEditableTarget(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

function applyFrequencyForActiveKey() {
  if (!activeKeyCodes.size) return;
  const lastKey = Array.from(activeKeyCodes).slice(-1)[0];
  const base = KEY_TO_SEMITONE[lastKey];
  if (base == null) return;
  const reference = baseFrequencyMemory ?? baseFrequency;
  const semitone = base + octaveOffset;
  const newFreq = reference * Math.pow(2, semitone / 12);
  applyBaseFrequency(newFreq, { updateSlider: true });
}

function handleKeyDown(event) {
  if (!keyboardEnabled) return;
  if (event.repeat) return;
  if (isEditableTarget(event.target)) return;
  const { code } = event;

  if (code === "KeyZ") {
    octaveOffset = clampValue(octaveOffset - 12, KEYBOARD_MIN_OCTAVE, KEYBOARD_MAX_OCTAVE);
    if (activeKeyCodes.size) {
      applyFrequencyForActiveKey();
    } else {
      updateCurrentNoteDisplay(baseFrequency);
    }
    return;
  }

  if (code === "KeyX") {
    octaveOffset = clampValue(octaveOffset + 12, KEYBOARD_MIN_OCTAVE, KEYBOARD_MAX_OCTAVE);
    if (activeKeyCodes.size) {
      applyFrequencyForActiveKey();
    } else {
      updateCurrentNoteDisplay(baseFrequency);
    }
    return;
  }

  const semitoneBase = KEY_TO_SEMITONE[code];
  if (semitoneBase == null) return;

  ensureAudioContext();
  try {
    audioCtx?.resume?.();
  } catch {
    // ignore resume errors
  }

  if (!activeKeyCodes.size) {
    baseFrequencyMemory = baseFrequency;
  }

  activeKeyCodes.add(code);
  const reference = baseFrequencyMemory ?? baseFrequency;
  const semitone = semitoneBase + octaveOffset;
  const newFreq = reference * Math.pow(2, semitone / 12);
  applyBaseFrequency(newFreq, { updateSlider: true });
}

function handleKeyUp(event) {
  if (!keyboardEnabled) return;
  const { code } = event;
  if (code === "KeyZ" || code === "KeyX") {
    return;
  }
  if (!activeKeyCodes.has(code)) return;
  activeKeyCodes.delete(code);
  if (activeKeyCodes.size) {
    applyFrequencyForActiveKey();
    return;
  }
  if (baseFrequencyMemory != null) {
    applyBaseFrequency(baseFrequencyMemory, { updateSlider: true });
    baseFrequencyMemory = null;
  }
}

function initializeKeyboardController() {
  if (keyboardInitialized) return;
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  keyboardInitialized = true;
}

function setKeyboardEnabled(enabled) {
  keyboardEnabled = !!enabled;
  if (ui.kbToggle) {
    ui.kbToggle.classList.toggle("active", keyboardEnabled);
    ui.kbToggle.setAttribute("aria-pressed", keyboardEnabled ? "true" : "false");
  }
  if (!keyboardEnabled) {
    activeKeyCodes.clear();
    if (baseFrequencyMemory != null) {
      applyBaseFrequency(baseFrequencyMemory, { updateSlider: true });
      baseFrequencyMemory = null;
    }
  }
}

function randomize() {
  baseFrequency = Math.random() * (MAX_BASE_FREQ - 50) + 50;
  ui.baseFreq.value = baseFrequency.toFixed(2);
  updateBaseFrequency();

  const randomRes = Math.random();
  ui.resonatorAmount.value = randomRes.toFixed(2);
  updateResonatorMix();

  voiceSettings = voiceSettings.map((settings, index) => {
    const updated = {
      ...settings,
      waveform: WAVEFORMS[Math.floor(Math.random() * WAVEFORMS.length)],
      pan: parseFloat((Math.random() * 2 - 1).toFixed(2)),
      gain: parseFloat((Math.random() * 0.4 + 0.05).toFixed(2)),
      delay: parseFloat((Math.random() * 0.8).toFixed(3)),
      detune: Math.random() * 10 - 5,
      cutoff: clampCutoff(Math.random() * 6000 + 1200),
      resonance: Math.min(10, Math.max(0.1, parseFloat((Math.random() * 2.4 + 0.4).toFixed(1))))
    };
    if (ui.voiceWaveforms[index]) ui.voiceWaveforms[index].value = updated.waveform;
    if (ui.voicePan[index]) {
      ui.voicePan[index].value = updated.pan;
      ui.voicePanVal[index].textContent = updated.pan.toFixed(2);
    }
    if (ui.voiceGain[index]) {
      ui.voiceGain[index].value = updated.gain;
      ui.voiceGainVal[index].textContent = updated.gain.toFixed(2);
    }
    if (ui.voiceCutoff[index]) {
      ui.voiceCutoff[index].value = updated.cutoff;
    }
    if (ui.voiceCutoffVal[index]) {
      ui.voiceCutoffVal[index].textContent = `${updated.cutoff.toFixed(0)} Hz`;
    }
    if (ui.voiceResonance[index]) {
      ui.voiceResonance[index].value = updated.resonance;
    }
    if (ui.voiceResonanceVal[index]) {
      ui.voiceResonanceVal[index].textContent = updated.resonance.toFixed(1);
    }
    return updated;
  });

  voices.forEach((voice, index) => {
    if (!voice) return;
    voice.osc.type = voiceSettings[index].waveform;
  });

  voices.forEach((_, index) => applyVoiceControls(index));
  voiceSettings.forEach((_, index) => updateVoiceFrequency(index));
  updateFrequencyDisplays();
}

function bindUI() {
  ui.startBtn?.addEventListener("click", async () => {
    ensureAudioContext();
    try {
      await audioCtx.resume();
    } catch (error) {
      // ignore
    }
    startDrone();
  });

  ui.stopBtn?.addEventListener("click", () => {
    stopDrone();
  });

  ui.randomBtn?.addEventListener("click", async () => {
    ensureAudioContext();
    try {
      await audioCtx.resume();
    } catch (error) {
      // ignore
    }
    if (!isRunning) {
      startDrone();
    }
    randomize();
  });

  ui.baseFreq?.addEventListener("input", () => {
    updateBaseFrequency();
  });

  ui.piDepth?.addEventListener("input", () => {
    updatePiDepth();
  });

  ui.morph?.addEventListener("input", () => {
    updateMorph();
  });

  ui.resonatorAmount?.addEventListener("input", () => {
    updateResonatorMix();
  });

  ui.fxAmount?.addEventListener("input", () => {
    updateFxAmount();
  });

  ui.masterVolume?.addEventListener("input", () => {
    updateMasterVolume();
  });

  ui.primeToggle?.addEventListener("change", event => {
    updatePrimeMode(event.target.checked);
  });

  Object.entries(ui.modeButtons).forEach(([key, btn]) => {
    if (key === "RANDOM") return;
    btn?.addEventListener("click", () => {
      setMathMode(key);
    });
  });

  ui.modeButtons.RANDOM?.addEventListener("click", () => {
    randomizeMathMode();
  });

  ui.voiceWaveforms.forEach((select, index) => {
    select?.addEventListener("change", event => {
      const value = event.target.value;
      voiceSettings[index].waveform = value;
      if (voices[index]) {
        voices[index].osc.type = value;
      }
    });
  });

  ui.voicePan.forEach((slider, index) => {
    slider?.addEventListener("input", event => {
      const value = parseFloat(event.target.value);
      voiceSettings[index].pan = value;
      if (ui.voicePanVal[index]) ui.voicePanVal[index].textContent = value.toFixed(2);
      updateVoicePan(index);
    });
  });

  ui.voiceGain.forEach((slider, index) => {
    slider?.addEventListener("input", event => {
      const value = parseFloat(event.target.value);
      voiceSettings[index].gain = value;
      if (ui.voiceGainVal[index]) ui.voiceGainVal[index].textContent = value.toFixed(2);
      updateVoiceGain(index);
    });
  });

  ui.voiceCutoff.forEach((slider, index) => {
    slider?.addEventListener("input", event => {
      const raw = parseFloat(event.target.value);
      const value = clampCutoff(Number.isFinite(raw) ? raw : 4000);
      voiceSettings[index].cutoff = value;
      event.target.value = value;
      if (ui.voiceCutoffVal[index]) {
        ui.voiceCutoffVal[index].textContent = `${value.toFixed(0)} Hz`;
      }
      updateVoiceCutoff(index);
    });
  });

  ui.voiceResonance.forEach((slider, index) => {
    slider?.addEventListener("input", event => {
      const raw = parseFloat(event.target.value);
      const value = Math.min(10, Math.max(0.1, Number.isFinite(raw) ? raw : 0.7));
      voiceSettings[index].resonance = value;
      event.target.value = value;
      if (ui.voiceResonanceVal[index]) {
        ui.voiceResonanceVal[index].textContent = value.toFixed(1);
      }
      updateVoiceResonance(index);
    });
  });

  ui.voiceMute.forEach((btn, index) => {
    btn?.addEventListener("click", () => {
      setVoiceMute(index, !voiceSettings[index].mute);
    });
  });

  ui.kbToggle?.addEventListener("click", () => {
    setKeyboardEnabled(!keyboardEnabled);
  });

  initializeKeyboardController();

  const unlockAudio = () => {
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
  };
  document.addEventListener("touchend", unlockAudio, { passive: true });
  document.addEventListener("pointerdown", unlockAudio, { passive: true });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && isRunning) unlockAudio();
  });
}

function initializeDisplays() {
  baseFrequency = parseFloat(ui.baseFreq.value);
  updateBaseFrequency();
  piDepth = parseFloat(ui.piDepth.value);
  ui.piDepthVal.textContent = piDepth.toFixed(2);
  morph = parseFloat(ui.morph.value);
  ui.morphVal.textContent = morph.toFixed(2);
  resonatorAmount = parseFloat(ui.resonatorAmount.value);
  ui.resonatorVal.textContent = resonatorAmount.toFixed(2);
  updateFxAmount(false);
  masterVolume = parseFloat(ui.masterVolume.value);
  ui.masterVolumeVal.textContent = masterVolume.toFixed(2);
  if (ui.primeToggle) {
    primeMode = ui.primeToggle.checked;
  }
  updatePrimeMode(primeMode, true);
  updateModeButtonsActive(currentMode);

  voiceSettings.forEach((settings, index) => {
    if (ui.voiceWaveforms[index]) ui.voiceWaveforms[index].value = settings.waveform;
    if (ui.voicePan[index]) ui.voicePan[index].value = settings.pan;
    if (ui.voicePanVal[index]) ui.voicePanVal[index].textContent = settings.pan.toFixed(2);
    if (ui.voiceGain[index]) ui.voiceGain[index].value = settings.gain;
    if (ui.voiceGainVal[index]) ui.voiceGainVal[index].textContent = settings.gain.toFixed(2);
    const cutoffVal = clampCutoff(settings.cutoff ?? 4000);
    const resonanceVal = Math.min(10, Math.max(0.1, settings.resonance ?? 0.7));
    if (ui.voiceCutoff[index]) ui.voiceCutoff[index].value = cutoffVal;
    if (ui.voiceCutoffVal[index]) ui.voiceCutoffVal[index].textContent = `${cutoffVal.toFixed(0)} Hz`;
    if (ui.voiceResonance[index]) ui.voiceResonance[index].value = resonanceVal;
    if (ui.voiceResonanceVal[index]) ui.voiceResonanceVal[index].textContent = resonanceVal.toFixed(1);
    updateMuteButton(index);
    updateVoiceFrequency(index);
  });
  updateFrequencyDisplays();
}

function sanitizeVoiceSettings(raw, fallback) {
  const safe = { ...fallback };
  if (!raw || typeof raw !== "object") return safe;
  if (WAVEFORMS.includes(raw.waveform)) safe.waveform = raw.waveform;
  const numeric = (value, min, max, current) =>
    Number.isFinite(value) ? clampValue(value, min, max) : current;
  safe.pan = numeric(raw.pan, -1, 1, safe.pan);
  safe.gain = numeric(raw.gain, 0, 0.5, safe.gain);
  safe.delay = numeric(raw.delay, 0, 0.8, safe.delay);
  safe.detune = numeric(raw.detune, -24, 24, safe.detune);
  safe.cutoff = Number.isFinite(raw.cutoff) ? clampCutoff(raw.cutoff) : safe.cutoff;
  safe.resonance = numeric(raw.resonance, 0.1, 10, safe.resonance);
  safe.mute = typeof raw.mute === "boolean" ? raw.mute : false;
  return safe;
}

function getFullState() {
  return {
    version: 1,
    baseFrequency,
    piDepth,
    morph,
    resonatorAmount,
    fxControl,
    masterVolume,
    primeMode,
    currentMode,
    voiceSettings: voiceSettings.map(v => ({ ...v }))
  };
}

function applyFullState(state) {
  if (!state || typeof state !== "object") return false;
  const setSliderValue = (el, value) => {
    if (el && Number.isFinite(value)) el.value = value;
  };
  setSliderValue(ui.baseFreq, state.baseFrequency);
  setSliderValue(ui.piDepth, state.piDepth);
  setSliderValue(ui.morph, state.morph);
  setSliderValue(ui.resonatorAmount, state.resonatorAmount);
  setSliderValue(ui.fxAmount, state.fxControl);
  setSliderValue(ui.masterVolume, state.masterVolume);
  if (ui.primeToggle && typeof state.primeMode === "boolean") {
    ui.primeToggle.checked = state.primeMode;
  }
  if (Array.isArray(state.voiceSettings)) {
    voiceSettings = voiceSettings.map((current, index) =>
      sanitizeVoiceSettings(state.voiceSettings[index], current)
    );
  }
  initializeDisplays();
  if (state.currentMode && MODE_IDS[state.currentMode]) {
    applyMathMode(state.currentMode);
  }
  voices.forEach((voice, index) => {
    if (!voice) return;
    voice.osc.type = voiceSettings[index].waveform;
    applyVoiceControls(index);
  });
  return true;
}

window.DroneAPI = {
  getState: getFullState,
  applyState: applyFullState,
  start: startDrone,
  stop: stopDrone,
  randomize,
  setMathMode,
  isRunning: () => isRunning,
  modes: Object.keys(MODE_IDS)
};

function bootstrapDrone() {
  const built = buildModeButtons();
  if (!built) {
    setTimeout(buildModeButtons, 100);
  }
  bindUI();
  initializeDisplays();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootstrapDrone);
} else {
  bootstrapDrone();
}
