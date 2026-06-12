const MIN_SLICE_LENGTH = 0.01;

const state = {
  canvas: null,
  buffer: null,
  slice: null,
  onSliceChange: null,
  dragging: null,
  pointerId: null,
};

export function initializeWaveform(canvas, { onSliceChange } = {}) {
  if (!canvas || canvas === state.canvas) {
    state.onSliceChange = typeof onSliceChange === "function" ? onSliceChange : state.onSliceChange;
    return;
  }

  state.canvas = canvas;
  state.onSliceChange = typeof onSliceChange === "function" ? onSliceChange : null;

  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointermove", handlePointerMove);
  canvas.addEventListener("pointerleave", handlePointerUp);
  window.addEventListener("pointerup", handlePointerUp);
}

export function renderWaveform(canvas, audioBuffer, slice) {
  if (canvas && canvas !== state.canvas) {
    initializeWaveform(canvas, { onSliceChange: state.onSliceChange });
  }
  state.buffer = audioBuffer || null;
  state.slice = slice ? { ...slice } : null;
  draw();
}

function draw() {
  const { canvas, buffer, slice } = state;
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const devicePixelRatio = window.devicePixelRatio || 1;
  const cssWidth = canvas.clientWidth || canvas.width;
  const cssHeight = canvas.clientHeight || canvas.height;
  const pixelWidth = Math.max(1, Math.floor(cssWidth * devicePixelRatio));
  const pixelHeight = Math.max(1, Math.floor(cssHeight * devicePixelRatio));

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  ctx.save();
  ctx.scale(devicePixelRatio, devicePixelRatio);

  ctx.fillStyle = "#10131a";
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  if (!buffer) {
    ctx.restore();
    return;
  }

  const channelData = buffer.getChannelData(0);
  const samplesPerPixel = Math.max(1, Math.floor(channelData.length / cssWidth));
  const halfHeight = cssHeight / 2;

  ctx.strokeStyle = "#4fc3f7";
  ctx.lineWidth = 1;
  ctx.beginPath();

  for (let x = 0; x < cssWidth; x += 1) {
    const start = x * samplesPerPixel;
    let min = 1;
    let max = -1;

    for (let j = 0; j < samplesPerPixel; j += 1) {
      const sample = channelData[start + j];
      if (sample === undefined) break;
      if (sample < min) min = sample;
      if (sample > max) max = sample;
    }

    const y1 = (1 - max) * halfHeight;
    const y2 = (1 - min) * halfHeight;

    ctx.moveTo(x, y1);
    ctx.lineTo(x, y2);
  }

  ctx.stroke();

  if (slice && buffer.duration > 0) {
    const startX = (clamp(slice.start, 0, buffer.duration) / buffer.duration) * cssWidth;
    const endX = (clamp(slice.end, slice.start + MIN_SLICE_LENGTH, buffer.duration) / buffer.duration) * cssWidth;
    ctx.fillStyle = "rgba(79, 195, 247, 0.15)";
    ctx.fillRect(startX, 0, Math.max(1, endX - startX), cssHeight);

    ctx.strokeStyle = "rgba(79, 195, 247, 0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(startX, 0);
    ctx.lineTo(startX, cssHeight);
    ctx.moveTo(endX, 0);
    ctx.lineTo(endX, cssHeight);
    ctx.stroke();

    drawHandle(ctx, startX, cssHeight);
    drawHandle(ctx, endX, cssHeight);
  }

  ctx.restore();
}

function drawHandle(ctx, x, height) {
  ctx.fillStyle = "#4fc3f7";
  ctx.fillRect(x - 2, 0, 4, height);
}

function handlePointerDown(event) {
  if (!state.canvas || !state.buffer || !state.slice) return;
  const { x } = getPointerPosition(event);
  const { startX, endX } = getSliceBoundsInPixels();
  const threshold = 10 * (window.devicePixelRatio || 1);

  if (Math.abs(x - startX) <= threshold) {
    state.dragging = "start";
  } else if (Math.abs(x - endX) <= threshold) {
    state.dragging = "end";
  } else {
    state.dragging = Math.abs(x - startX) < Math.abs(x - endX) ? "start" : "end";
  }

  state.pointerId = event.pointerId;
  state.canvas.setPointerCapture(event.pointerId);
  event.preventDefault();
  handlePointerMove(event);
}

function handlePointerMove(event) {
  if (!state.canvas) return;
  const { x } = getPointerPosition(event);
  const { startX, endX } = getSliceBoundsInPixels();

  if (!state.dragging) {
    const threshold = 10 * (window.devicePixelRatio || 1);
    const isNearHandle = Math.abs(x - startX) <= threshold || Math.abs(x - endX) <= threshold;
    state.canvas.style.cursor = isNearHandle ? "col-resize" : "default";
    return;
  }

  if (!state.buffer || !state.slice) return;

  const duration = state.buffer.duration;
  if (duration <= 0) return;

  const ratio = clamp(x / (state.canvas.clientWidth || 1), 0, 1);
  const time = ratio * duration;
  const current = { ...state.slice };

  if (state.dragging === "start") {
    const limit = current.end - MIN_SLICE_LENGTH;
    current.start = clamp(time, 0, Math.max(limit, 0));
  } else if (state.dragging === "end") {
    const limit = current.start + MIN_SLICE_LENGTH;
    current.end = clamp(time, limit, duration);
  }

  commitSliceChange(current);
  event.preventDefault();
}

function handlePointerUp(event) {
  if (state.pointerId !== null && event.pointerId !== state.pointerId) return;
  if (state.canvas && state.pointerId !== null) {
    try {
      state.canvas.releasePointerCapture(state.pointerId);
    } catch (err) {
      // ignore
    }
  }
  state.dragging = null;
  state.pointerId = null;
  if (state.canvas) {
    state.canvas.style.cursor = "default";
  }
}

function commitSliceChange(updatedSlice) {
  if (!updatedSlice || !state.slice) return;
  const changes = {};
  if (updatedSlice.start !== state.slice.start) {
    changes.start = updatedSlice.start;
  }
  if (updatedSlice.end !== state.slice.end) {
    changes.end = updatedSlice.end;
  }
  state.slice = updatedSlice;
  if (Object.keys(changes).length && typeof state.onSliceChange === "function") {
    state.onSliceChange(state.slice.id, changes, { ...state.slice });
  }
  draw();
}

function getSliceBoundsInPixels() {
  const { buffer, slice, canvas } = state;
  if (!buffer || !slice || !canvas) {
    return { startX: 0, endX: 0 };
  }
  const width = canvas.clientWidth || canvas.width;
  const duration = buffer.duration;
  if (duration <= 0) {
    return { startX: 0, endX: 0 };
  }
  const startX = (clamp(slice.start, 0, duration) / duration) * width;
  const endX = (clamp(slice.end, slice.start + MIN_SLICE_LENGTH, duration) / duration) * width;
  return { startX, endX };
}

function getPointerPosition(event) {
  const rect = state.canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  return { x };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}
