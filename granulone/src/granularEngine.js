const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const NOTE_TO_INDEX = {
  C: 0,
  "C#": 1,
  DB: 1,
  D: 2,
  "D#": 3,
  EB: 3,
  E: 4,
  F: 5,
  "F#": 6,
  GB: 6,
  G: 7,
  "G#": 8,
  AB: 8,
  A: 9,
  "A#": 10,
  BB: 10,
  B: 11,
};

const DEFAULTS = {
  grainInterval: 0.18,
  grainDuration: 0.18,
  masterGain: 0.8,
  windowType: "hann",
  sliceMix: 0,
  rootNote: "C",
  slice: {
    grainInterval: 0.18,
    overlap: 0.7,
    spray: 0,
    delayTime: 0,
    delayFeedback: 0.25,
    delayMix: 0,
    reverbMix: 0,
    muted: false,
  },
  lfo: {
    speed: 0,
    depth: 0.25,
  },
};

const MIN_SLICE_LENGTH = 0.01; // seconds
const MAX_DELAY_TIME = 2.5; // seconds

const isAudioContext = ctx =>
  ctx &&
  typeof ctx === "object" &&
  typeof ctx.state === "string" &&
  typeof ctx.resume === "function" &&
  typeof ctx.suspend === "function";

const centsToPlaybackRate = cents => Math.pow(2, cents / 1200);
const makeId = (prefix = "id") => {
  const fallback = `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") {
    return fallback;
  }
  const uuid = crypto.randomUUID();
  return prefix ? `${prefix}-${uuid}` : uuid;
};

export default class GranularEngine {
  constructor(audioContext) {
    const candidateContexts = [];
    if (typeof window !== "undefined" && isAudioContext(window.ctx)) {
      candidateContexts.push(window.ctx);
    }
    if (typeof globalThis !== "undefined" && isAudioContext(globalThis.ctx)) {
      candidateContexts.push(globalThis.ctx);
    }

    const resolvedContext = audioContext || candidateContexts[0];
    if (!resolvedContext) {
      throw new Error("AudioContext non disponibile");
    }

    candidateContexts.forEach(ctx => {
      if (ctx && ctx !== resolvedContext && typeof console !== "undefined" && console.warn) {
        console.warn("Extra AudioContext detected:", ctx);
      }
    });

    this.audioContext = resolvedContext;
    if (typeof window !== "undefined") {
      window.ctx = this.audioContext;
    }
    if (typeof globalThis !== "undefined") {
      globalThis.ctx = this.audioContext;
    }

    this.masterGain = this.audioContext.createGain();
    this.mainSampleGain = this.audioContext.createGain();
    this.mainSampleGain.gain.value = 1;
    this.mainSampleGain.connect(this.masterGain);
    this.masterGain.connect(this.audioContext.destination);

    this.samples = new Map();
    this.currentSampleId = null;
    this.slices = [];
    this.isPlaying = false;

    this.grainInterval = DEFAULTS.grainInterval;
    this.grainDuration = DEFAULTS.grainDuration;

    this.masterGain.gain.value = DEFAULTS.masterGain;
    this.baseMasterGain = DEFAULTS.masterGain;
    this.windowType = DEFAULTS.windowType;
    this.sliceMix = DEFAULTS.sliceMix;
    this.rootNote = DEFAULTS.rootNote;

    this.recorderDestination = this.audioContext.createMediaStreamDestination();
    this.masterGain.connect(this.recorderDestination);
    this.mediaRecorder = null;
    this.recordedChunks = [];
    this.isRecording = false;

    this.lfoDepth = DEFAULTS.lfo.depth;
    this.lfoOscillator = this.audioContext.createOscillator();
    this.lfoGain = this.audioContext.createGain();
    this.lfoGain.gain.value = 0;
    this.lfoOscillator.type = "sine";
    this.lfoOscillator.connect(this.lfoGain);
    this.lfoGain.connect(this.masterGain.gain);
    this.lfoOscillator.start();
    this.setLfoSpeed(DEFAULTS.lfo.speed);

    this._sliceNodes = new Map();
    this._sliceTimers = new Map();
    this._reverbBuffer = null;
    this._windowCurves = this._buildWindowCurves();
    this._activeGrains = 0;
    this._activeSliceSources = new Map();
    this._sliceBufferCache = new Map();
    this.mainSampleSource = null;
    this._mainSampleSourceHandler = null;
    this._isMainSampleConnected = false;
    this.mainSampleMuted = false;
    this._mainSamplePlaybackEnabled = false;

    this._animationFrame = null;
    this._tick = this._tick.bind(this);
  }

  async loadFile(file) {
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);

    const name = file && file.name ? file.name.replace(/\.[^/.]+$/, "") : "Campione";
    const sampleId = makeId("sample");

    const sample = {
      id: sampleId,
      name,
      buffer: audioBuffer,
    };

    this._stopMainSamplePlayback();
    this.samples.set(sampleId, sample);
    this.currentSampleId = sampleId;
    this._updateOutputState();

    return sample;
  }

  addSlice(name = "Slice", sampleId = this.currentSampleId) {
    const sample = sampleId ? this.samples.get(sampleId) : null;
    if (!sample) throw new Error("Carica prima un campione");
    const duration = sample.buffer.duration;
    const slice = {
      id: makeId("slice"),
      sampleId: sample.id,
      name,
      start: 0,
      end: duration,
      pointer: 0,
      spray: DEFAULTS.slice.spray,
      playbackRate: 0,
      randomPitch: 0,
      gain: 1,
      grainInterval: DEFAULTS.slice.grainInterval,
      overlap: DEFAULTS.slice.overlap,
      delayTime: DEFAULTS.slice.delayTime,
      delayFeedback: DEFAULTS.slice.delayFeedback,
      delayMix: DEFAULTS.slice.delayMix,
      reverbMix: DEFAULTS.slice.reverbMix,
      muted: DEFAULTS.slice.muted,
    };
    this.slices.push(slice);
    this._ensureSliceNodes(slice);
    this._applySliceEffects(slice);
    this._syncSliceConnection(slice);
    this._sliceTimers.set(slice.id, this.audioContext.currentTime);
    this._updateOutputState();
    return slice;
  }

  updateSlice(id, patch) {
    const slice = this.slices.find(s => s.id === id);
    if (!slice) return;

    const prevSampleId = slice.sampleId;
    const prevStart = slice.start;
    const prevEnd = slice.end;

    if (patch && patch.sampleId && this.samples.has(patch.sampleId)) {
      slice.sampleId = patch.sampleId;
    }

    if (patch && Object.prototype.hasOwnProperty.call(patch, "randomStart")) {
      patch.spray = patch.randomStart;
      delete patch.randomStart;
    }

    Object.assign(slice, patch);

    const sample = this.samples.get(slice.sampleId);
    const duration = sample ? sample.buffer.duration : 0;

    if (duration > 0) {
      if (slice.start < 0) slice.start = 0;
      if (slice.end > duration) slice.end = duration;
      if (slice.end - slice.start < MIN_SLICE_LENGTH) {
        slice.end = Math.min(slice.start + MIN_SLICE_LENGTH, duration);
        if (slice.end - slice.start < MIN_SLICE_LENGTH) {
          slice.start = Math.max(0, duration - MIN_SLICE_LENGTH);
          slice.end = duration;
        }
      }
    }

    if (slice.pointer < 0) slice.pointer = 0;
    if (slice.pointer > 1) slice.pointer = 1;
    if (slice.spray < 0) slice.spray = 0;
    if (slice.spray > 1) slice.spray = 1;
    if (slice.gain < 0) slice.gain = 0;
    if (slice.grainInterval < 0.005) slice.grainInterval = 0.005;
    if (slice.overlap < 0) slice.overlap = 0;
    if (slice.overlap > 0.95) slice.overlap = 0.95;
    if (slice.delayTime < 0) slice.delayTime = 0;
    if (slice.delayTime > MAX_DELAY_TIME) slice.delayTime = MAX_DELAY_TIME;
    if (slice.delayFeedback < 0) slice.delayFeedback = 0;
    if (slice.delayFeedback > 0.95) slice.delayFeedback = 0.95;
    if (slice.delayMix < 0) slice.delayMix = 0;
    if (slice.delayMix > 1) slice.delayMix = 1;
    if (slice.reverbMix < 0) slice.reverbMix = 0;
    if (slice.reverbMix > 1) slice.reverbMix = 1;
    slice.muted = Boolean(slice.muted);

    this._applySliceEffects(slice);
    this._syncSliceConnection(slice);

    if (this._sliceTimers.has(slice.id)) {
      this._sliceTimers.set(slice.id, this.audioContext.currentTime);
    }

    if (slice.muted) {
      this._stopSliceGrains(slice.id);
    }

    if (
      slice.sampleId !== prevSampleId ||
      Math.abs(slice.start - prevStart) > 1e-5 ||
      Math.abs(slice.end - prevEnd) > 1e-5
    ) {
      this._invalidateSliceBuffer(slice.id);
    }

    this._updateOutputState();
    return slice;
  }

  removeSlice(id) {
    this._stopSliceGrains(id);
    this.slices = this.slices.filter(s => s.id !== id);
    const nodes = this._sliceNodes.get(id);
    if (nodes) {
      try {
        nodes.input.disconnect();
        nodes.dryGain.disconnect();
        nodes.delayNode.disconnect();
        nodes.delayFeedback.disconnect();
        nodes.delayMix.disconnect();
        nodes.reverb.disconnect();
        nodes.reverbMix.disconnect();
        nodes.output.disconnect();
      } catch (err) {
        console.warn("Errore nella disconnessione degli effetti dello slice", err);
    }
    this._sliceNodes.delete(id);
    }
    this._sliceTimers.delete(id);
    this._sliceBufferCache.delete(id);
    this._updateOutputState();
  }

  setGrainInterval(ms) {
    this.grainInterval = Math.max(0.005, ms / 1000);
  }

  setGrainDuration(ms) {
    this.grainDuration = Math.max(0.01, ms / 1000);
  }

  setMasterGain(value) {
    const clamped = Math.max(0, Math.min(value, 1.5));
    this.baseMasterGain = clamped;
    this.masterGain.gain.setValueAtTime(clamped, this.audioContext.currentTime);
    this.setLfoSpeed(this.lfoSpeed ?? DEFAULTS.lfo.speed);
    this._updateOutputState();
  }

  setWindowType(type) {
    if (!type) return;
    const normalized = String(type).toLowerCase();
    if (!this._windowCurves[normalized]) return;
    this.windowType = normalized;
  }

  setSliceMix(percent) {
    const value = Math.max(0, Math.min(Number(percent) || 0, 1));
    this.sliceMix = value;
  }

  setRootNote(note) {
    if (!note) return;
    this.rootNote = String(note).toUpperCase();
  }

  setMainSampleMuted(muted) {
    const shouldMute = Boolean(muted);
    if (this.mainSampleMuted === shouldMute) return;
    this.mainSampleMuted = shouldMute;
    if (shouldMute) {
      this._stopMainSamplePlayback();
      this._mainSamplePlaybackEnabled = false;
    } else {
      if (this.isPlaying) {
        const hasActiveSlices = this._hasActiveSlices();
        this._mainSamplePlaybackEnabled = !hasActiveSlices;
        if (hasActiveSlices) {
          this._stopMainSamplePlayback();
        }
      }
    }
    this._updateOutputState();
  }

  setLfoSpeed(speedHz) {
    const value = Math.max(0, Number.isFinite(speedHz) ? speedHz : 0);
    const now = this.audioContext.currentTime;
    if (value <= 0) {
      this.lfoGain.gain.setTargetAtTime(0, now, 0.05);
      this.lfoOscillator.frequency.setTargetAtTime(0.0001, now, 0.05);
    } else {
      const depth = Math.max(0, this.baseMasterGain * this.lfoDepth);
      this.lfoGain.gain.setTargetAtTime(depth, now, 0.05);
      this.lfoOscillator.frequency.setTargetAtTime(value, now, 0.05);
    }
    this.lfoSpeed = value;
  }

  startRecording() {
    if (typeof MediaRecorder === "undefined") {
      throw new Error("MediaRecorder non supportato in questo browser");
    }
    if (this.isRecording) return;

    this.recordedChunks = [];
    this.mediaRecorder = new MediaRecorder(this.recorderDestination.stream);
    this.mediaRecorder.ondataavailable = event => {
      if (event.data && event.data.size > 0) {
        this.recordedChunks.push(event.data);
      }
    };
    this.mediaRecorder.onstop = null;
    this.mediaRecorder.start();
    this.isRecording = true;
  }

  stopRecording() {
    if (!this.mediaRecorder || !this.isRecording) {
      return Promise.resolve(null);
    }

    return new Promise((resolve, reject) => {
      this.mediaRecorder.onstop = () => {
        const mimeType = this.mediaRecorder.mimeType || "audio/webm";
        const blob = new Blob(this.recordedChunks, { type: mimeType });
        this.isRecording = false;
        this.mediaRecorder = null;
        this.recordedChunks = [];
        resolve(blob);
      };
      this.mediaRecorder.onerror = event => {
        this.isRecording = false;
        this.recordedChunks = [];
        this.mediaRecorder = null;
        const error = event.error || new Error("Errore nella registrazione audio");
        reject(error);
      };
      this.mediaRecorder.stop();
    });
  }

  getSample(sampleId) {
    return this.samples.get(sampleId) || null;
  }

  getSamples() {
    return Array.from(this.samples.values());
  }

  getCurrentSample() {
    return this.currentSampleId ? this.getSample(this.currentSampleId) : null;
  }

  setCurrentSample(sampleId) {
    if (!sampleId) {
      if (this.currentSampleId !== null) {
        this._stopMainSamplePlayback();
      }
      this.currentSampleId = null;
      this._syncAllSliceConnections();
      this._updateOutputState();
      return null;
    }
    const sample = this.getSample(sampleId);
    if (sample) {
      if (this.currentSampleId !== sampleId) {
        this._stopMainSamplePlayback();
      }
      this.currentSampleId = sampleId;
      this._syncAllSliceConnections();
      this._updateOutputState();
      return sample;
    }
    return null;
  }

  hasSlicesForSample(sampleId) {
    return this.slices.some(slice => slice.sampleId === sampleId);
  }

  play() {
    if (this.isPlaying) return;

    const globalCtx =
      (typeof window !== "undefined" && isAudioContext(window.ctx) ? window.ctx : null) ||
      (typeof globalThis !== "undefined" && isAudioContext(globalThis.ctx) ? globalThis.ctx : null);
    if (globalCtx && globalCtx !== this.audioContext && typeof console !== "undefined" && console.warn) {
      console.warn("Extra AudioContext detected:", globalCtx);
    }

    const hasPlayableSlice = this.slices.some(slice => this._canSliceOutput(slice));

    if (!hasPlayableSlice) return;

    this.isPlaying = true;
    const hasActiveSlices = this._hasActiveSlices();
    this._mainSamplePlaybackEnabled = !this.mainSampleMuted && !hasActiveSlices;
    if (hasActiveSlices) {
      this._stopMainSamplePlayback();
    }
    const startTime = this.audioContext.currentTime;
    const interval = this._computeSliceInterval(slice);

    if (!Number.isFinite(interval) || interval <= 0) {
      this._sliceTimers.set(slice.id, now + 0.05);
      return;
    }

    this.slices.forEach(slice => {
      this._sliceTimers.set(slice.id, startTime);
    });
    if (this.audioContext.state === "suspended") {
      this.audioContext.resume();
    }
    this._animationFrame = requestAnimationFrame(this._tick);
    this._updateOutputState();
  }

  stop() {
    if (!this.isPlaying) return;
    this.isPlaying = false;
    this._mainSamplePlaybackEnabled = false;
    this._stopAllSliceGrains();
    this._stopMainSamplePlayback();
    if (this._animationFrame) {
      cancelAnimationFrame(this._animationFrame);
      this._animationFrame = null;
    }
    this._updateOutputState();
  }

  _tick() {
    if (!this.isPlaying) return;

    if (!this.slices || this.slices.length === 0) {
      this.stop();
      return;
    }

    const hasUnmutedSlice = this.slices.some(slice => !slice.muted);
    if (!hasUnmutedSlice) {
      this.stop();
      return;
    }

    const now = this.audioContext.currentTime;
    const lookAhead = 0.1;

    this.slices.forEach(slice => {
      const sample = this.samples.get(slice.sampleId);
      if (!sample || !sample.buffer || sample.buffer.duration <= 0) {
        return;
      }

      const timer = this._sliceTimers.get(slice.id) ?? now;
      let interval = this._computeSliceInterval(slice);
      if (!Number.isFinite(interval) || interval <= 0) {
        interval = Math.max(this.grainDuration * 0.5, 0.005);
      }

      if (!this._canSliceOutput(slice, sample)) {
        this._sliceTimers.set(slice.id, now + interval);
        return;
      }

      let nextTime = timer;

      while (nextTime < now + lookAhead) {
        const scheduled = this._scheduleGrain(slice, nextTime);
        if (!scheduled) {
          nextTime = now + 0.01;
          break;
        }
        nextTime += interval;
      }

      this._sliceTimers.set(slice.id, nextTime);
    });

    this._animationFrame = requestAnimationFrame(this._tick);
  }

  _scheduleGrain(slice, time) {
    if (!this.slices || !this.slices.length) return false;
    if (!this._hasActiveSlices()) return false;

    const sample = this.samples.get(slice.sampleId);
    if (!this._canSliceOutput(slice, sample)) return false;

    const sliceData = this._getSliceBuffer(sample, slice);
    if (!sliceData || !sliceData.buffer || sliceData.duration <= 0) {
      return false;
    }

    const buffer = sliceData.buffer;
    const totalDuration = sliceData.duration;

    const nodes = this._ensureSliceNodes(slice);
    const sliceId = slice.id;

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;

    const usableDuration = Math.max(totalDuration - MIN_SLICE_LENGTH, 0);
    const pointerPos = slice.pointer * (usableDuration || 0);
    const randomFactor = (Math.random() * 2 - 1) * slice.spray;
    const jitteredPointer = pointerPos + randomFactor * (usableDuration || 0);
    const clampedStart = clamp(
      jitteredPointer,
      0,
      usableDuration
    );
    const grainDuration = Math.min(this.grainDuration, totalDuration - clampedStart);
    if (!grainDuration || grainDuration <= 0) return false;

    const baseCents = slice.playbackRate;
    const randomCents = (Math.random() * 2 - 1) * slice.randomPitch;
    const totalCents = baseCents + randomCents;
    const quantizedCents = this._quantizeCents(totalCents);
    const mix = Math.max(0, Math.min(this.sliceMix, 1));
    const blendedCents = lerp(totalCents, quantizedCents, mix);
    const finalRate = centsToPlaybackRate(blendedCents);
    source.playbackRate.setValueAtTime(finalRate, time);

    const gainNode = this.audioContext.createGain();
    const baseAmplitude = clamp(slice.gain, 0, 2);
    const activeCount = this._incrementActiveGrains();
    const compensatedAmplitude = baseAmplitude / Math.max(1, Math.sqrt(activeCount));
    const windowCurve = this._getScaledWindowCurve(this.windowType, compensatedAmplitude);
    gainNode.gain.cancelScheduledValues(time);
    gainNode.gain.setValueAtTime(0, time);
    if (windowCurve.length > 1) {
      gainNode.gain.setValueCurveAtTime(windowCurve, time, grainDuration);
    } else {
      gainNode.gain.setValueAtTime(compensatedAmplitude, time);
      gainNode.gain.linearRampToValueAtTime(0.0001, time + grainDuration);
    }

    source.connect(gainNode).connect(nodes.input);
    source.__granuloneSliceId = sliceId;
    source.__granuloneStartTime = time;
    let activeSources = this._activeSliceSources.get(sliceId);
    if (!activeSources) {
      activeSources = new Set();
      this._activeSliceSources.set(sliceId, activeSources);
    }
    activeSources.add(source);
    source.start(time, clampedStart, grainDuration);
    source.onended = () => {
      this._decrementActiveGrains();
      const active = this._activeSliceSources.get(sliceId);
      if (active) {
        active.delete(source);
        if (active.size === 0) {
          this._activeSliceSources.delete(sliceId);
        }
      }
      try {
        source.disconnect();
      } catch (err) {
        // ignore
      }
      try {
        gainNode.disconnect();
      } catch (err) {
        // ignore
      }
    };

    return true;
  }

  _ensureSliceNodes(slice) {
    let nodes = this._sliceNodes.get(slice.id);
    if (nodes) return nodes;

    const input = this.audioContext.createGain();
    const dryGain = this.audioContext.createGain();
    const delayNode = this.audioContext.createDelay(MAX_DELAY_TIME);
    const delayFeedback = this.audioContext.createGain();
    const delayMix = this.audioContext.createGain();
    const reverb = this.audioContext.createConvolver();
    const reverbMix = this.audioContext.createGain();
    const sliceGain = this.audioContext.createGain();

    reverb.buffer = this._getReverbBuffer();

    input.connect(dryGain);
    dryGain.connect(sliceGain);

    input.connect(delayNode);
    delayNode.connect(delayMix);
    delayMix.connect(sliceGain);
    delayNode.connect(delayFeedback);
    delayFeedback.connect(delayNode);

    input.connect(reverb);
    reverb.connect(reverbMix);
    reverbMix.connect(sliceGain);

    sliceGain.gain.value = slice.muted ? 0 : 1;

    nodes = {
      input,
      dryGain,
      delayNode,
      delayFeedback,
      delayMix,
      reverb,
      reverbMix,
      sliceGain,
      output: sliceGain,
      isConnected: false,
    };

    this._sliceNodes.set(slice.id, nodes);
    this._syncSliceConnection(slice);
    return nodes;
  }

  _syncSliceConnection(slice) {
    if (!slice) return;
    const nodes = this._sliceNodes.get(slice.id);
    if (!nodes) return;
    const sample = this.samples.get(slice.sampleId);
    const hasBuffer = Boolean(sample && sample.buffer && sample.buffer.duration > 0);

    if (hasBuffer && !nodes.isConnected) {
      try {
        nodes.sliceGain.connect(this.masterGain);
        nodes.isConnected = true;
      } catch (err) {
        // ignore InvalidStateError
      }
    } else if (!hasBuffer && nodes.isConnected) {
      try {
        nodes.sliceGain.disconnect(this.masterGain);
      } catch (err) {
        // ignore InvalidStateError
      }
      nodes.isConnected = false;
    }

    if (!nodes.sliceGain) return;
    const targetGain = slice.muted ? 0 : 1;
    const now = this.audioContext.currentTime;
    nodes.sliceGain.gain.cancelScheduledValues(now);
    nodes.sliceGain.gain.setTargetAtTime(targetGain, now, 0.01);
  }

  setMainSampleSource(source) {
    if (source === this.mainSampleSource) {
      this._updateOutputState();
      return;
    }

    this._stopMainSamplePlayback();

    if (!source) {
      return;
    }
    this.mainSampleSource = source;
    this._isMainSampleConnected = false;

    const target = source;
    const handler = () => {
      if (this.mainSampleSource === target) {
        this._clearMainSampleSource();
      } else if (target && typeof target.removeEventListener === "function") {
        target.removeEventListener("ended", handler);
      }
    };

    if (typeof source.addEventListener === "function") {
      source.addEventListener("ended", handler);
      this._mainSampleSourceHandler = { source, fn: handler, type: "event" };
    } else {
      const previous = source.onended;
      const wrapped = event => {
        if (typeof previous === "function") {
          previous.call(source, event);
        }
        handler();
      };
      source.onended = wrapped;
      this._mainSampleSourceHandler = {
        source,
        fn: wrapped,
        type: "onended",
        previous,
      };
    }

    this._updateOutputState();
  }

  _connectMainSampleSource() {
    if (
      this.mainSampleMuted ||
      this._hasActiveSlices() ||
      !this.mainSampleSource ||
      this._isMainSampleConnected
    ) {
      return;
    }
    try {
      this.mainSampleSource.connect(this.mainSampleGain);
      this._isMainSampleConnected = true;
    } catch (err) {
      // ignore InvalidStateError
    }
  }

  _disconnectMainSampleSource() {
    if (!this.mainSampleSource || !this._isMainSampleConnected) {
      return;
    }
    try {
      this.mainSampleSource.disconnect(this.mainSampleGain);
    } catch (err) {
      // ignore InvalidStateError
    }
    this._isMainSampleConnected = false;
  }

  _hasActiveSlices() {
    return this.slices.some(slice => !slice.muted);
  }

  _updateOutputState() {
    const hasActiveSlices = this._hasActiveSlices();
    const allSlicesMuted = !hasActiveSlices;
    const now = this.audioContext.currentTime;

    const wantsMainSample =
      this._mainSamplePlaybackEnabled && !this.mainSampleMuted && !hasActiveSlices;
    const shouldSilenceMainSample = !wantsMainSample;
    this.mainSampleGain.gain.cancelScheduledValues(now);
    this.mainSampleGain.gain.setValueAtTime(shouldSilenceMainSample ? 0 : 1, now);

    if (this.mainSampleSource) {
      if (!wantsMainSample) {
        this._stopMainSamplePlayback();
      } else if (!hasActiveSlices) {
        this._connectMainSampleSource();
      } else {
        this._disconnectMainSampleSource();
      }
    }

    const shouldMuteMaster = this.mainSampleMuted && allSlicesMuted;
    const targetMaster = shouldMuteMaster ? 0 : this.baseMasterGain;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setValueAtTime(targetMaster, now);

    if (shouldMuteMaster) {
      this.lfoGain.gain.setTargetAtTime(0, now, 0.05);
    } else {
      const depth = Math.max(0, this.baseMasterGain * this.lfoDepth);
      this.lfoGain.gain.setTargetAtTime(depth, now, 0.05);
    }

    if (shouldMuteMaster && this.audioContext.state === "running") {
      this.audioContext.suspend().catch(() => {});
    } else if (!shouldMuteMaster && this.audioContext.state === "suspended") {
      this.audioContext.resume().catch(() => {});
    }
  }

  _clearMainSampleSource() {
    if (!this.mainSampleSource) return;
    this._disconnectMainSampleSource();
    const handler = this._mainSampleSourceHandler;
    if (handler) {
      const { source, fn, type, previous } = handler;
      if (type === "event" && source && typeof source.removeEventListener === "function") {
        source.removeEventListener("ended", fn);
      } else if (type === "onended" && source) {
        source.onended = typeof previous === "undefined" ? null : previous;
      }
    }
    this._mainSampleSourceHandler = null;
    this.mainSampleSource = null;
    this._updateOutputState();
  }

  _stopMainSamplePlayback() {
    if (!this.mainSampleSource) return;
    const source = this.mainSampleSource;
    try {
      source.stop(0);
    } catch (err) {
      // ignore InvalidStateError for already-stopped sources
    }
    try {
      source.disconnect();
    } catch (err) {
      // ignore InvalidStateError for already-disconnected sources
    }
    this._clearMainSampleSource();
  }

  _stopSliceGrains(sliceId) {
    if (!sliceId || !this._activeSliceSources.size) return;
    const sources = this._activeSliceSources.get(sliceId);
    if (!sources || !sources.size) return;
    const now = this.audioContext.currentTime;
    Array.from(sources).forEach(source => {
      try {
        const startTime = source.__granuloneStartTime ?? now;
        const stopTime = Math.max(now, startTime);
        source.stop(stopTime);
      } catch (err) {
        // ignore InvalidStateError for already-stopped sources
      }
    });
  }

  _stopAllSliceGrains() {
    if (!this._activeSliceSources.size) return;
    const sliceIds = Array.from(this._activeSliceSources.keys());
    sliceIds.forEach(sliceId => {
      this._stopSliceGrains(sliceId);
    });
  }

  _applySliceEffects(slice) {
    const nodes = this._ensureSliceNodes(slice);
    const now = this.audioContext.currentTime;

    const delayTime = clamp(slice.delayTime ?? DEFAULTS.slice.delayTime, 0, MAX_DELAY_TIME);
    const delayFeedback = clamp(
      slice.delayFeedback ?? DEFAULTS.slice.delayFeedback,
      0,
      0.95
    );
    const delayMix = clamp(slice.delayMix ?? DEFAULTS.slice.delayMix, 0, 1);
    const reverbMix = clamp(slice.reverbMix ?? DEFAULTS.slice.reverbMix, 0, 1);
    const dryLevel = clamp(1 - reverbMix, 0, 1);

    nodes.delayNode.delayTime.setTargetAtTime(delayTime, now, 0.01);
    nodes.delayFeedback.gain.setTargetAtTime(delayFeedback, now, 0.01);
    nodes.delayMix.gain.setTargetAtTime(delayMix, now, 0.01);
    nodes.reverbMix.gain.setTargetAtTime(reverbMix, now, 0.01);
    nodes.dryGain.gain.setTargetAtTime(dryLevel, now, 0.01);
  }

  _invalidateSliceBuffer(sliceId) {
    if (!sliceId) return;
    this._sliceBufferCache.delete(sliceId);
  }

  _getReverbBuffer() {
    if (this._reverbBuffer) return this._reverbBuffer;
    const duration = 2.5;
    const sampleRate = this.audioContext.sampleRate;
    const length = Math.floor(sampleRate * duration);
    const impulse = this.audioContext.createBuffer(2, length, sampleRate);

    for (let channel = 0; channel < impulse.numberOfChannels; channel += 1) {
      const channelData = impulse.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        const decay = Math.pow(1 - i / length, 2);
        channelData[i] = (Math.random() * 2 - 1) * decay;
      }
    }

    this._reverbBuffer = impulse;
    return this._reverbBuffer;
  }

  _getSliceBuffer(sample, slice) {
    if (!sample || !sample.buffer || !slice) {
      return null;
    }

    const buffer = sample.buffer;
    const start = clamp(slice.start, 0, Math.max(buffer.duration - MIN_SLICE_LENGTH, 0));
    const end = clamp(slice.end, start + MIN_SLICE_LENGTH, buffer.duration);

    const cached = this._sliceBufferCache.get(slice.id);
    if (
      cached &&
      cached.sampleId === slice.sampleId &&
      Math.abs(cached.start - start) < 1e-5 &&
      Math.abs(cached.end - end) < 1e-5
    ) {
      return cached;
    }

    const sampleRate = buffer.sampleRate;
    const channelCount = buffer.numberOfChannels;
    const startFrame = Math.max(0, Math.floor(start * sampleRate));
    const endFrame = Math.min(buffer.length, Math.max(startFrame + 1, Math.ceil(end * sampleRate)));
    const frameCount = Math.max(endFrame - startFrame, 1);

    const sliceBuffer = this.audioContext.createBuffer(channelCount, frameCount, sampleRate);
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sourceData = buffer.getChannelData(channel);
      const targetData = sliceBuffer.getChannelData(channel);
      for (let i = 0; i < frameCount; i += 1) {
        const sourceIndex = startFrame + i;
        targetData[i] = sourceIndex < sourceData.length ? sourceData[sourceIndex] : 0;
      }
    }

    const result = {
      buffer: sliceBuffer,
      duration: frameCount / sampleRate,
      sampleId: slice.sampleId,
      start,
      end,
    };

    this._sliceBufferCache.set(slice.id, result);
    return result;
  }

  _computeSliceInterval(slice) {
    const densityFloor = Math.max(this.grainDuration * 0.5, 0.005);
    const fallbackInterval =
      this.grainInterval ?? DEFAULTS.slice.grainInterval ?? DEFAULTS.grainInterval;
    const requestedInterval = slice.grainInterval ?? fallbackInterval;
    const base = Math.max(requestedInterval, densityFloor, 0.005);
    const overlap = clamp(slice.overlap ?? DEFAULTS.slice.overlap, 0, 0.95);
    const effective = base * (1 - overlap);
    return Math.max(effective, densityFloor);
  }

  _canSliceOutput(slice, sample = null) {
    if (!slice || slice.muted) return false;
    const resolvedSample = sample || this.samples.get(slice.sampleId);
    if (!resolvedSample || !resolvedSample.buffer || resolvedSample.buffer.duration <= 0) {
      return false;
    }
    return true;
  }

  _buildWindowCurves() {
    const length = 128;
    const types = ["hann", "triangular", "gaussian", "rectangular"];
    const curves = {};
    types.forEach(type => {
      const curve = new Float32Array(length);
      let max = 0;
      for (let i = 0; i < length; i += 1) {
        const phase = length === 1 ? 0 : i / (length - 1);
        let value = 0;
        switch (type) {
          case "hann":
            value = 0.5 * (1 - Math.cos(2 * Math.PI * phase));
            break;
          case "triangular":
            value = 1 - Math.abs(phase * 2 - 1);
            break;
          case "gaussian": {
            const sigma = 0.4;
            const centered = phase - 0.5;
            value = Math.exp(-0.5 * (centered / sigma) ** 2);
            break;
          }
          case "rectangular":
            value = 1;
            break;
          default:
            value = phase <= 0 ? 0 : 1;
        }
        curve[i] = value;
        if (value > max) max = value;
      }
      const normalizer = max > 0 ? 1 / max : 1;
      for (let i = 0; i < length; i += 1) {
        curve[i] *= normalizer;
      }
      curves[type] = curve;
    });
    return curves;
  }

  _getScaledWindowCurve(type, amplitude) {
    const key = this._windowCurves[type] ? type : DEFAULTS.windowType;
    const template = this._windowCurves[key] || this._windowCurves[DEFAULTS.windowType];
    if (!template) return new Float32Array([amplitude]);
    const length = template.length;
    const curve = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      curve[i] = template[i] * amplitude;
    }
    return curve;
  }

  _syncAllSliceConnections() {
    this.slices.forEach(slice => {
      this._syncSliceConnection(slice);
    });
  }

  _incrementActiveGrains() {
    this._activeGrains = Math.max(0, (this._activeGrains ?? 0)) + 1;
    return this._activeGrains;
  }

  _decrementActiveGrains() {
    this._activeGrains = Math.max(0, (this._activeGrains ?? 0) - 1);
    return this._activeGrains;
  }

  _quantizeCents(cents) {
    if (!this.sliceMix) return cents;
    const semitone = cents / 100;
    const root = NOTE_TO_INDEX[this.rootNote] ?? 0;
    const shifted = semitone + root;
    const quantizedShifted = this._nearestScaleValue(shifted, MAJOR_SCALE);
    const quantized = quantizedShifted - root;
    return quantized * 100;
  }

  _nearestScaleValue(value, scale) {
    let best = value;
    let bestDiff = Number.POSITIVE_INFINITY;
    const baseOctave = Math.floor(value / 12);
    for (let octave = baseOctave - 1; octave <= baseOctave + 1; octave += 1) {
      for (let i = 0; i < scale.length; i += 1) {
        const candidate = octave * 12 + scale[i];
        const diff = Math.abs(candidate - value);
        if (diff < bestDiff) {
          bestDiff = diff;
          best = candidate;
        }
      }
    }
    return best;
  }
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

export { DEFAULTS };
