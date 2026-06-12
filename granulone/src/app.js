import GranularEngine from "./granularEngine.js";
import { setupUI } from "./ui.js";

const isAudioContext = ctx =>
  ctx &&
  typeof ctx === "object" &&
  typeof ctx.state === "string" &&
  typeof ctx.resume === "function" &&
  typeof ctx.suspend === "function";

const audioCtor =
  (typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext)) ||
  (typeof globalThis !== "undefined" && (globalThis.AudioContext || globalThis.webkitAudioContext)) ||
  null;

const candidateContexts = [];
if (typeof window !== "undefined" && isAudioContext(window.ctx)) {
  candidateContexts.push(window.ctx);
}
if (typeof globalThis !== "undefined" && isAudioContext(globalThis.ctx)) {
  candidateContexts.push(globalThis.ctx);
}

let audioContext = candidateContexts.length ? candidateContexts[0] : null;

if (!audioContext && audioCtor) {
  audioContext = new audioCtor({ latencyHint: "interactive", sampleRate: 44100 });
}

if (!audioContext) {
  throw new Error("AudioContext non disponibile");
}

candidateContexts.forEach(ctx => {
  if (ctx && ctx !== audioContext && typeof console !== "undefined" && console.warn) {
    console.warn("Extra AudioContext detected:", ctx);
  }
});

try {
  const mainTarget = typeof window !== "undefined" ? window : globalThis;
  if (mainTarget && typeof mainTarget === "object") {
    mainTarget.ctx = audioContext;
  }
  if (typeof globalThis !== "undefined") {
    globalThis.ctx = audioContext;
  }
  if (typeof console !== "undefined" && console.log) {
    console.log("AudioContext globally available as ctx");
  }
} catch (err) {
  if (typeof console !== "undefined" && console.warn) {
    console.warn("Failed to expose AudioContext globally:", err);
  }
}

if (typeof window !== "undefined" && window.addEventListener) {
  window.addEventListener("load", () => {
    if (!window.ctx && typeof audioContext !== "undefined") {
      window.ctx = audioContext;
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  const engine = new GranularEngine(audioContext);
  setupUI(engine);
  window.__granuloneReady = true;
});
