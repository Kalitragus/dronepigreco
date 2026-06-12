import { DEFAULTS } from "./granularEngine.js";
import { initializeWaveform, renderWaveform } from "./waveform.js";

const MIN_SLICE_MS = 10;

export function setupUI(engine) {
  const fileInput = document.getElementById("fileInput");
  const playBtn = document.getElementById("playBtn");
  const stopBtn = document.getElementById("granStopBtn");
  const addSliceBtn = document.getElementById("addSliceBtn");
  const recordBtn = document.getElementById("recordBtn");
  const downloadLink = document.getElementById("downloadLink");
  const slicesContainer = document.getElementById("slices");
  const sliceTemplate = document.getElementById("sliceTemplate");
  const waveformCanvas = document.getElementById("waveform");

  const globalControls = {
    grainInterval: document.getElementById("grainInterval"),
    grainDuration: document.getElementById("grainDuration"),
    masterGain: document.getElementById("masterGain"),
    lfoSpeed: document.getElementById("lfoSpeed"),
    grainWindow: document.getElementById("grainWindow"),
    sliceMix: document.getElementById("sliceMix"),
    rootNote: document.getElementById("rootNote"),
    muteMainSample: document.getElementById("muteMainSample"),
  };

  let currentSampleId = null;
  let currentSliceId = null;
  let recordingUrl = null;
  const recordingAllowed = isRecordingAllowed();
  const recorderSupported = typeof MediaRecorder !== "undefined";
  const canRecord = Boolean(recordBtn) && recordingAllowed && recorderSupported;

  initializeWaveform(waveformCanvas, {
    onSliceChange: (sliceId, changes) => {
      if (!sliceId) return;
      const updatedSlice = engine.updateSlice(sliceId, changes);
      if (!updatedSlice) return;
      currentSliceId = sliceId;
      refreshSliceCard(updatedSlice);
      scheduleWaveformRender(updatedSlice);
    },
  });

  if (!recordBtn) {
    downloadLink.hidden = true;
  } else if (!canRecord) {
    recordBtn.disabled = true;
    recordBtn.classList.add("is-disabled");
    recordBtn.title = recordingAllowed
      ? "MediaRecorder non supportato in questo browser"
      : "Registrazione disponibile solo in locale";
    recordBtn.setAttribute("aria-hidden", "true");
    recordBtn.hidden = true;
    recordBtn.style.display = "none";
    downloadLink.hidden = true;
  } else {
    recordBtn.removeAttribute("aria-hidden");
    recordBtn.classList.remove("is-disabled");
    recordBtn.hidden = false;
    recordBtn.style.display = "";
  }

  fileInput.addEventListener("change", async event => {
    const [file] = event.target.files;
    if (!file) return;

    try {
      const sample = await engine.loadFile(file);
      currentSampleId = sample.id;

      if (!engine.hasSlicesForSample(sample.id)) {
        const displayName = sample.name || `Slice ${engine.slices.length}`;
        engine.addSlice(displayName, sample.id);
      }

      renderSlices();
      focusSample(sample.id);
      updateButtons();
      if (recordingUrl) {
        URL.revokeObjectURL(recordingUrl);
        recordingUrl = null;
      }
      downloadLink.hidden = true;
    } catch (err) {
      console.error(err);
      alert("Errore nel caricamento del file audio");
    }
  });

  playBtn.addEventListener("click", () => {
    engine.play();
  });

  stopBtn.addEventListener("click", () => {
    engine.stop();
  });

  addSliceBtn.addEventListener("click", () => {
    try {
      const sample =
        (currentSampleId && engine.getSample(currentSampleId)) ||
        engine.getCurrentSample() ||
        engine.getSamples()[0];

      if (!sample) throw new Error("Carica prima un campione");

      engine.addSlice(`Slice ${engine.slices.length}`, sample.id);
      renderSlices();
      focusSample(sample.id);
      updateButtons();
    } catch (err) {
      alert(err.message);
    }
  });

  if (canRecord && recordBtn) {
    recordBtn.addEventListener("click", async () => {
      if (!engine.isRecording) {
        try {
          engine.startRecording();
          recordBtn.textContent = "Stop Rec";
          recordBtn.classList.add("recording");
          downloadLink.hidden = true;
          if (recordingUrl) {
            URL.revokeObjectURL(recordingUrl);
            recordingUrl = null;
          }
        } catch (err) {
          alert(err.message || "Registrazione non supportata");
        }
        return;
      }

      recordBtn.disabled = true;
      try {
        const blob = await engine.stopRecording();
        recordBtn.textContent = "Rec";
        recordBtn.classList.remove("recording");
        if (blob) {
          recordingUrl = URL.createObjectURL(blob);
          downloadLink.href = recordingUrl;
          downloadLink.download = `granulone-${Date.now()}.webm`;
          downloadLink.hidden = false;
        } else {
          downloadLink.hidden = true;
        }
      } catch (err) {
        recordBtn.textContent = "Rec";
        recordBtn.classList.remove("recording");
        alert(err?.message || "Errore durante la registrazione");
      } finally {
        recordBtn.disabled = false;
      }
    });
  }

  setupGlobalControl(
    globalControls.grainInterval,
    value => {
      engine.setGrainInterval(Number(value));
    },
    value => `${value}`
  );

  setupGlobalControl(
    globalControls.grainDuration,
    value => {
      engine.setGrainDuration(Number(value));
    },
    value => `${value}`
  );

  setupGlobalControl(
    globalControls.masterGain,
    value => {
      engine.setMasterGain(Number(value) / 100);
    },
    value => (Number(value) / 100).toFixed(2)
  );

  setupGlobalControl(
    globalControls.lfoSpeed,
    value => {
      engine.setLfoSpeed(Number(value));
    },
    value => Number(value).toFixed(1)
  );

  if (globalControls.sliceMix) {
    setupGlobalControl(
      globalControls.sliceMix,
      value => {
        engine.setSliceMix(Number(value) / 100);
      },
      value => `${value}%`
    );
  }

  if (globalControls.grainWindow) {
    globalControls.grainWindow.value = DEFAULTS.windowType;
    globalControls.grainWindow.addEventListener("change", event => {
      engine.setWindowType(event.target.value);
    });
  }

  if (globalControls.rootNote) {
    globalControls.rootNote.value = DEFAULTS.rootNote;
    globalControls.rootNote.addEventListener("change", event => {
      engine.setRootNote(event.target.value);
    });
  }

  if (globalControls.muteMainSample) {
    globalControls.muteMainSample.checked = Boolean(engine.mainSampleMuted);
    globalControls.muteMainSample.addEventListener("change", event => {
      engine.setMainSampleMuted(event.target.checked);
    });
  }

  function focusSample(sampleId) {
    if (!sampleId) return null;
    const sample = engine.setCurrentSample(sampleId);
    if (!sample) return null;
    currentSampleId = sample.id;
    const isCurrentSliceValid = engine.slices.some(
      s => s.id === currentSliceId && s.sampleId === currentSampleId
    );
    if (!isCurrentSliceValid) {
      ensureActiveSlice(currentSampleId);
    }
    highlightActiveCards();
    updateButtons();
    scheduleWaveformRender();
    return sample;
  }

  function highlightActiveCards() {
    const cards = slicesContainer.querySelectorAll(".slice-card");
    cards.forEach(card => {
      const sliceId = card.dataset.sliceId;
      const slice = engine.slices.find(s => s.id === sliceId);
      const isActiveSample = slice && slice.sampleId === currentSampleId;
      const isSelected = slice && slice.id === currentSliceId;
      card.classList.toggle("is-active", Boolean(isActiveSample));
      card.classList.toggle("is-selected", Boolean(isSelected));
      card.classList.toggle("is-muted", Boolean(slice?.muted));
    });
  }

  function updateButtons() {
    const sample =
      (currentSampleId && engine.getSample(currentSampleId)) || engine.getCurrentSample();
    addSliceBtn.disabled = !sample;
    const hasPlayableSlice = engine.slices.some(slice => engine.getSample(slice.sampleId));
    playBtn.disabled = !hasPlayableSlice;
  }

  function setSliderValue(input, value, formatter = v => v) {
    if (!input) return;
    if (String(input.value) !== String(value)) {
      input.value = value;
    }
    const output = input.nextElementSibling;
    if (output) {
      output.textContent = formatter(value);
    }
  }

  function getSliceCard(sliceId) {
    if (!sliceId) return null;
    return slicesContainer.querySelector(`.slice-card[data-slice-id="${sliceId}"]`);
  }

  function refreshSliceCard(slice) {
    if (!slice) return;
    const card = getSliceCard(slice.id);
    if (!card) return;
    const sample = engine.getSample(slice.sampleId);
    const buffer = sample ? sample.buffer : null;
    const rangeLabel = card.querySelector(".slice-range");
    const startInput = card.querySelector(".slice-start");
    const endInput = card.querySelector(".slice-end");
    const pointerInput = card.querySelector(".slice-pointer");
    const sprayInput = card.querySelector(".slice-spray");
    const grainIntervalInput = card.querySelector(".slice-grain-interval");
    const overlapInput = card.querySelector(".slice-overlap");
    const playbackRateInput = card.querySelector(".slice-playback-rate");
    const randomPitchInput = card.querySelector(".slice-random-pitch");
    const gainInput = card.querySelector(".slice-gain");
    const delayTimeInput = card.querySelector(".slice-delay-time");
    const delayFeedbackInput = card.querySelector(".slice-delay-feedback");
    const delayMixInput = card.querySelector(".slice-delay-mix");
    const reverbMixInput = card.querySelector(".slice-reverb-mix");

    if (!buffer) {
      return;
    }

    const totalMs = Math.round(buffer.duration * 1000);
    if (startInput) {
      startInput.min = 0;
      startInput.max = totalMs;
    }
    if (endInput) {
      endInput.min = 0;
      endInput.max = totalMs;
    }

    setSliderValue(startInput, Math.round(slice.start * 1000), v => `${v} ms`);
    setSliderValue(endInput, Math.round(slice.end * 1000), v => `${v} ms`);
    setSliderValue(pointerInput, Math.round(slice.pointer * 100), v => `${v}%`);
    const sprayValue = Math.round((slice.spray ?? slice.randomStart ?? 0) * 100);
    setSliderValue(sprayInput, sprayValue, v => `${v}%`);
    setSliderValue(
      grainIntervalInput,
      Math.round((slice.grainInterval ?? DEFAULTS.slice.grainInterval) * 1000),
      v => `${v} ms`
    );
    setSliderValue(
      overlapInput,
      Math.round((slice.overlap ?? DEFAULTS.slice.overlap) * 100),
      v => `${v}%`
    );
    setSliderValue(playbackRateInput, slice.playbackRate, v => `${(v / 100).toFixed(2)} st`);
    setSliderValue(randomPitchInput, slice.randomPitch, v => `${(v / 100).toFixed(2)} st`);
    setSliderValue(gainInput, Math.round(slice.gain * 100), v => (v / 100).toFixed(2));
    setSliderValue(delayTimeInput, Math.round((slice.delayTime ?? 0) * 1000), v => `${v} ms`);
    setSliderValue(delayFeedbackInput, Math.round((slice.delayFeedback ?? 0) * 100), v => `${v}%`);
    setSliderValue(delayMixInput, Math.round((slice.delayMix ?? 0) * 100), v => `${v}%`);
    setSliderValue(reverbMixInput, Math.round((slice.reverbMix ?? 0) * 100), v => `${v}%`);

    if (rangeLabel) {
      const label = sample ? sample.name : "Campione";
      const start = Math.round(slice.start * 1000);
      const end = Math.round(slice.end * 1000);
      rangeLabel.textContent = `${label} · ${start} ms → ${end} ms`;
    }
  }

  function ensureActiveSlice(sampleId) {
    if (!sampleId) {
      const anySlice = engine.slices[0];
      currentSliceId = anySlice ? anySlice.id : null;
      return;
    }
    const candidate = engine.slices.find(slice => slice.sampleId === sampleId);
    if (candidate) {
      currentSliceId = candidate.id;
    } else {
      const fallback = engine.slices[0];
      currentSliceId = fallback ? fallback.id : null;
    }
  }

  function scheduleWaveformRender(preferredSlice) {
    const slice = preferredSlice
      ? preferredSlice
      : engine.slices.find(s => s.id === currentSliceId) || null;
    const sample = slice
      ? engine.getSample(slice.sampleId)
      : currentSampleId
      ? engine.getSample(currentSampleId)
      : null;
    const buffer = sample ? sample.buffer : null;
    renderWaveform(waveformCanvas, buffer, slice || null);
  }

  function renderSlices() {
    slicesContainer.innerHTML = "";
    const slices = engine.slices;

    const isCurrentSliceValid = slices.some(slice => slice.id === currentSliceId);
    if (!isCurrentSliceValid) {
      ensureActiveSlice(currentSampleId);
    }

    if (!slices.length) {
      const p = document.createElement("p");
      p.textContent = "Aggiungi uno slice per iniziare.";
      p.className = "empty-state";
      slicesContainer.appendChild(p);
      highlightActiveCards();
      updateButtons();
      return;
    }

    const fragment = document.createDocumentFragment();
    slices.forEach(slice => {
      const node = renderSlice(slice);
      if (node) fragment.appendChild(node);
    });
    slicesContainer.appendChild(fragment);
    highlightActiveCards();
    updateButtons();
    scheduleWaveformRender();
  }

  function renderSlice(slice) {
    const sample = engine.getSample(slice.sampleId);
    const buffer = sample ? sample.buffer : null;
    const clone = sliceTemplate.content.firstElementChild.cloneNode(true);
    clone.dataset.sliceId = slice.id;

    const nameInput = clone.querySelector(".slice-name");
    const rangeLabel = clone.querySelector(".slice-range");
    const muteBtn = clone.querySelector(".mute-slice");
    const removeBtn = clone.querySelector(".remove-slice");

    const startInput = clone.querySelector(".slice-start");
    const endInput = clone.querySelector(".slice-end");
    const pointerInput = clone.querySelector(".slice-pointer");
    const sprayInput = clone.querySelector(".slice-spray");
    const grainIntervalInput = clone.querySelector(".slice-grain-interval");
    const overlapInput = clone.querySelector(".slice-overlap");
    const playbackRateInput = clone.querySelector(".slice-playback-rate");
    const randomPitchInput = clone.querySelector(".slice-random-pitch");
    const gainInput = clone.querySelector(".slice-gain");
    const delayTimeInput = clone.querySelector(".slice-delay-time");
    const delayFeedbackInput = clone.querySelector(".slice-delay-feedback");
    const delayMixInput = clone.querySelector(".slice-delay-mix");
    const reverbMixInput = clone.querySelector(".slice-reverb-mix");

    const inputs = [
      startInput,
      endInput,
      pointerInput,
      sprayInput,
      grainIntervalInput,
      overlapInput,
      playbackRateInput,
      randomPitchInput,
      gainInput,
      delayTimeInput,
      delayFeedbackInput,
      delayMixInput,
      reverbMixInput,
    ];

    nameInput.value = slice.name;
    muteBtn.textContent = slice.muted ? "Unmute" : "Mute";
    clone.classList.toggle("is-muted", Boolean(slice.muted));

    if (!buffer) {
      inputs.forEach(el => {
        if (el) el.disabled = true;
      });
      rangeLabel.textContent = "Campione non disponibile";
      return clone;
    }

    const totalMs = Math.round(buffer.duration * 1000);
    if (startInput) {
      startInput.min = 0;
      startInput.max = totalMs;
    }
    if (endInput) {
      endInput.min = 0;
      endInput.max = totalMs;
    }

    const startMs = Math.round(slice.start * 1000);
    const endMs = Math.round(slice.end * 1000);
    const pointerValue = Math.round(slice.pointer * 100);
    const sprayValue = Math.round((slice.spray ?? slice.randomStart ?? 0) * 100);

    setSliderValue(startInput, startMs, v => `${v} ms`);
    setSliderValue(endInput, endMs, v => `${v} ms`);
    setSliderValue(pointerInput, pointerValue, v => `${v}%`);
    setSliderValue(sprayInput, sprayValue, v => `${v}%`);
    setSliderValue(
      grainIntervalInput,
      Math.round((slice.grainInterval ?? DEFAULTS.slice.grainInterval) * 1000),
      v => `${v} ms`
    );
    setSliderValue(
      overlapInput,
      Math.round((slice.overlap ?? DEFAULTS.slice.overlap) * 100),
      v => `${v}%`
    );
    setSliderValue(playbackRateInput, slice.playbackRate, v => `${(v / 100).toFixed(2)} st`);
    setSliderValue(randomPitchInput, slice.randomPitch, v => `${(v / 100).toFixed(2)} st`);
    setSliderValue(gainInput, Math.round(slice.gain * 100), v => (v / 100).toFixed(2));
    setSliderValue(delayTimeInput, Math.round((slice.delayTime ?? 0) * 1000), v => `${v} ms`);
    setSliderValue(delayFeedbackInput, Math.round((slice.delayFeedback ?? 0) * 100), v => `${v}%`);
    setSliderValue(delayMixInput, Math.round((slice.delayMix ?? 0) * 100), v => `${v}%`);
    setSliderValue(reverbMixInput, Math.round((slice.reverbMix ?? 0) * 100), v => `${v}%`);

    const ensureFocus = () => {
      if (currentSampleId !== slice.sampleId) {
        focusSample(slice.sampleId);
      }
      if (currentSliceId !== slice.id) {
        currentSliceId = slice.id;
        highlightActiveCards();
      }
      scheduleWaveformRender(slice);
    };

    const updateRangeLabel = updatedSlice => {
      if (!rangeLabel) return;
      const sampleRef = engine.getSample(updatedSlice.sampleId);
      const label = sampleRef ? sampleRef.name : "Campione";
      const start = Math.round((updatedSlice.start ?? 0) * 1000);
      const end = Math.round((updatedSlice.end ?? 0) * 1000);
      rangeLabel.textContent = `${label} · ${start} ms → ${end} ms`;
    };

    updateRangeLabel(slice);

    const applyUpdate = (patch, sliderUpdate) => {
      const updated = engine.updateSlice(slice.id, patch);
      if (updated) {
        Object.assign(slice, updated);
        if (typeof sliderUpdate === "function") {
          sliderUpdate(updated);
        }
        refreshSliceCard(updated);
        scheduleWaveformRender(updated);
        highlightActiveCards();
      }
    };

    clone.addEventListener("mousedown", event => {
      if (event.target.closest("input, button")) return;
      ensureFocus();
    });

    nameInput.addEventListener("input", event => {
      ensureFocus();
      applyUpdate({ name: event.target.value });
    });

    muteBtn.addEventListener("click", () => {
      const muted = !slice.muted;
      applyUpdate({ muted }, updated => {
        muteBtn.textContent = updated.muted ? "Unmute" : "Mute";
        clone.classList.toggle("is-muted", Boolean(updated.muted));
      });
    });

    removeBtn.addEventListener("click", () => {
      engine.removeSlice(slice.id);
      renderSlices();
      if (engine.slices.length) {
        const candidate = engine.slices[engine.slices.length - 1];
        focusSample(candidate.sampleId);
      } else {
        currentSampleId = null;
        currentSliceId = null;
        engine.setCurrentSample(null);
        renderWaveform(waveformCanvas, null, null);
        updateButtons();
        highlightActiveCards();
      }
    });

    startInput.addEventListener("input", () => {
      ensureFocus();
      const maxValue = Math.max(Number(endInput.value) - MIN_SLICE_MS, 0);
      const value = clamp(Number(startInput.value), 0, maxValue);
      setSliderValue(startInput, value, v => `${v} ms`);
      applyUpdate({ start: value / 1000 }, updateRangeLabel);
    });

    endInput.addEventListener("input", () => {
      ensureFocus();
      const minValue = Number(startInput.value) + MIN_SLICE_MS;
      const value = clamp(Number(endInput.value), minValue, totalMs);
      setSliderValue(endInput, value, v => `${v} ms`);
      applyUpdate({ end: value / 1000 }, updateRangeLabel);
    });

    pointerInput.addEventListener("input", () => {
      ensureFocus();
      const raw = Number(pointerInput.value);
      setSliderValue(pointerInput, raw, v => `${v}%`);
      applyUpdate({ pointer: raw / 100 });
    });

    sprayInput.addEventListener("input", () => {
      ensureFocus();
      const raw = Number(sprayInput.value);
      setSliderValue(sprayInput, raw, v => `${v}%`);
      applyUpdate({ spray: raw / 100 });
    });

    grainIntervalInput.addEventListener("input", () => {
      ensureFocus();
      const value = clamp(Number(grainIntervalInput.value), 10, 400);
      setSliderValue(grainIntervalInput, value, v => `${v} ms`);
      applyUpdate({ grainInterval: value / 1000 });
    });

    overlapInput.addEventListener("input", () => {
      ensureFocus();
      const raw = Number(overlapInput.value);
      setSliderValue(overlapInput, raw, v => `${v}%`);
      applyUpdate({ overlap: raw / 100 });
    });

    playbackRateInput.addEventListener("input", () => {
      ensureFocus();
      const cents = Number(playbackRateInput.value);
      setSliderValue(playbackRateInput, cents, v => `${(v / 100).toFixed(2)} st`);
      applyUpdate({ playbackRate: cents });
    });

    randomPitchInput.addEventListener("input", () => {
      ensureFocus();
      const cents = Number(randomPitchInput.value);
      setSliderValue(randomPitchInput, cents, v => `${(v / 100).toFixed(2)} st`);
      applyUpdate({ randomPitch: cents });
    });

    gainInput.addEventListener("input", () => {
      ensureFocus();
      const value = Number(gainInput.value);
      setSliderValue(gainInput, value, v => (v / 100).toFixed(2));
      applyUpdate({ gain: value / 100 });
    });

    delayTimeInput.addEventListener("input", () => {
      ensureFocus();
      const value = clamp(Number(delayTimeInput.value), 0, 2500);
      setSliderValue(delayTimeInput, value, v => `${v} ms`);
      applyUpdate({ delayTime: value / 1000 });
    });

    delayFeedbackInput.addEventListener("input", () => {
      ensureFocus();
      const value = clamp(Number(delayFeedbackInput.value), 0, 95);
      setSliderValue(delayFeedbackInput, value, v => `${v}%`);
      applyUpdate({ delayFeedback: value / 100 });
    });

    delayMixInput.addEventListener("input", () => {
      ensureFocus();
      const value = clamp(Number(delayMixInput.value), 0, 100);
      setSliderValue(delayMixInput, value, v => `${v}%`);
      applyUpdate({ delayMix: value / 100 });
    });

    reverbMixInput.addEventListener("input", () => {
      ensureFocus();
      const value = clamp(Number(reverbMixInput.value), 0, 100);
      setSliderValue(reverbMixInput, value, v => `${v}%`);
      applyUpdate({ reverbMix: value / 100 });
    });

    return clone;
  }

  addSliceBtn.disabled = true;
  playBtn.disabled = true;
  downloadLink.hidden = true;
  if (recordBtn && canRecord) {
    recordBtn.textContent = "Rec";
    recordBtn.classList.remove("recording");
  }

  applyGlobalDefaults();
  updateButtons();

  function applyGlobalDefaults() {
    setControlValue(globalControls.grainInterval, DEFAULTS.grainInterval * 1000, v => `${v}`);
    setControlValue(globalControls.grainDuration, DEFAULTS.grainDuration * 1000, v => `${v}`);
    setControlValue(
      globalControls.masterGain,
      Math.round(DEFAULTS.masterGain * 100),
      v => (v / 100).toFixed(2)
    );
    setControlValue(globalControls.lfoSpeed, DEFAULTS.lfo.speed, v => Number(v).toFixed(1));
    setControlValue(
      globalControls.sliceMix,
      Math.round((DEFAULTS.sliceMix ?? 0) * 100),
      v => `${v}%`
    );
    if (globalControls.grainWindow) {
      globalControls.grainWindow.value = DEFAULTS.windowType;
      globalControls.grainWindow.dispatchEvent(new Event("change"));
    }
    if (globalControls.rootNote) {
      globalControls.rootNote.value = DEFAULTS.rootNote;
      globalControls.rootNote.dispatchEvent(new Event("change"));
    }
    if (globalControls.muteMainSample) {
      globalControls.muteMainSample.checked = false;
      engine.setMainSampleMuted(false);
    }
  }

  function setControlValue(control, value, formatter = v => v) {
    if (!control) return;
    control.value = value;
    updateOutput(control, value, formatter);
    control.dispatchEvent(new Event("input"));
  }
}

function setupGlobalControl(input, onChange, formatter = value => value) {
  if (!input) return;
  updateOutput(input, input.value, formatter);
  input.addEventListener("input", event => {
    const value = event.target.value;
    updateOutput(input, value, formatter);
    onChange(value);
  });
}

function updateOutput(input, value, formatter = v => v) {
  if (!input) return;
  const output = input.nextElementSibling;
  if (output) {
    output.textContent = formatter(value);
  }
}

function isRecordingAllowed() {
  const { protocol, hostname } = window.location;
  if (protocol === "file:") return true;
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") return true;
  return false;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
