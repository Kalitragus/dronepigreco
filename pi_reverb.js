class PiReverb {
  constructor(ctx, pigrecoFn) {
    this.ctx = ctx;
    this.pigreco = pigrecoFn;
    this.baseFreq = 220;

    this.primes = [2, 3, 5, 7, 11, 13, 17, 19];
    this.primeIndex = 0;
    this.mode = "PI";
    this.freezeUntil = 0;

    this.input = ctx.createGain();
    this.wetGain = ctx.createGain();
    this.dryGain = ctx.createGain();
    this.master = ctx.createGain();
    this.output = this.master;
    this.isConnected = false;

    // Two parallel convolvers: impulse changes crossfade between them instead
    // of swapping the live buffer, which clicks in most browsers.
    this.convolverA = ctx.createConvolver();
    this.convolverB = ctx.createConvolver();
    this.convolverGainA = ctx.createGain();
    this.convolverGainB = ctx.createGain();
    this.convolverGainA.gain.value = 1;
    this.convolverGainB.gain.value = 0;
    this.activeConvolver = "A";
    this.input.connect(this.convolverA);
    this.input.connect(this.convolverB);
    this.convolverA.connect(this.convolverGainA).connect(this.wetGain);
    this.convolverB.connect(this.convolverGainB).connect(this.wetGain);

    this.manualAmount = null;
    this.modDepth = 0.45;
    this.modRate = Math.PI / 5;
    this.decayDepth = 0.35;
    this.usePrimeMode = false;

    this.input.connect(this.dryGain);
    this.dryGain.connect(this.master);
    this.wetGain.connect(this.master);

    this._irCache = new Map();
    this.currentImpulse = { seconds: 3.25, decay: 2.5 };
    this.convolverA.buffer = this._getImpulse(this.currentImpulse.seconds, this.currentImpulse.decay);
    this.wetGain.gain.value = 0.5;
    this.dryGain.gain.value = 0.5;
    this.master.gain.value = 1;

    this.modActive = true;
    this._lastImpulseUpdate = 0;
    this.depthScale = 1;
  }

  static createImpulse(ctx, seconds = 3, decay = 2.4) {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        const t = i / length;
        const env = Math.pow(1 - t, decay);
        const phase = Math.PI * t * (1 + ch * 0.35);
        data[i] = (Math.random() * 2 - 1) * env * Math.cos(phase);
      }
    }
    return buffer;
  }

  // Quantized + cached: the expensive buffer generation runs once per
  // (seconds, decay) pair instead of every impulse update.
  _getImpulse(seconds, decay) {
    const qSeconds = Math.round(seconds * 4) / 4;
    const qDecay = Math.round(decay * 4) / 4;
    const key = `${qSeconds}|${qDecay}`;
    let buffer = this._irCache.get(key);
    if (!buffer) {
      buffer = PiReverb.createImpulse(this.ctx, qSeconds, qDecay);
      if (this._irCache.size >= 24) {
        this._irCache.delete(this._irCache.keys().next().value);
      }
      this._irCache.set(key, buffer);
    }
    return buffer;
  }

  _swapImpulse(seconds, decay, t) {
    const buffer = this._getImpulse(seconds, decay);
    const incoming = this.activeConvolver === "A" ? this.convolverB : this.convolverA;
    const incomingGain = this.activeConvolver === "A" ? this.convolverGainB : this.convolverGainA;
    const outgoingGain = this.activeConvolver === "A" ? this.convolverGainA : this.convolverGainB;
    incoming.buffer = buffer;
    incomingGain.gain.setTargetAtTime(1, t, 0.3);
    outgoingGain.gain.setTargetAtTime(0, t, 0.3);
    this.activeConvolver = this.activeConvolver === "A" ? "B" : "A";
  }

  startModulation() {
    this.modActive = true;
  }

  updateParameters(time) {
    if (!this.ctx || this.ctx.state === "closed" || !this.modActive) return;
    const t = typeof time === "number" ? time : this.ctx.currentTime;
    if (t < this.freezeUntil) return;
    const depthScale = Math.min(1, Math.max(0, this.depthScale));
    const baseWet = this.manualAmount != null ? this.manualAmount : 0.5;
    const primeStep = this.primes[this.primeIndex % this.primes.length];
    const harmonic = this.pigreco
      ? this.pigreco(this.baseFreq, this.primeIndex % 4, { usePrimes: this.usePrimeMode, mode: this.mode })
      : this.baseFreq;
    const harmonicNorm = Math.min(440, harmonic || 0) / 440;
    const modDepthBase = this.modDepth + harmonicNorm * 0.25;
    const modDepth = modDepthBase * depthScale;
    const mod = baseWet + Math.sin(this.modRate * t * (primeStep / 2)) * modDepth * 0.6;
    const targetWet = Math.min(1, Math.max(0, mod));
    const targetDry = 1 - targetWet;

    this.wetGain.gain.setTargetAtTime(targetWet, t, 0.12);
    this.dryGain.gain.setTargetAtTime(targetDry, t, 0.12);

    const decaySwing = (this.decayDepth + harmonicNorm * 0.2) * depthScale;
    const decayMod = 1 + Math.sin((Math.PI / primeStep) * t) * decaySwing;
    const targetSeconds = 2.4 + decayMod;
    const targetDecay = 2.2 + harmonicNorm * 0.8 * depthScale;
    if (t - this._lastImpulseUpdate > 2.5 &&
        (Math.abs(targetSeconds - this.currentImpulse.seconds) > 0.4 ||
         Math.abs(targetDecay - this.currentImpulse.decay) > 0.3)) {
      this.currentImpulse = { seconds: targetSeconds, decay: targetDecay };
      this._swapImpulse(targetSeconds, targetDecay, t);
      this._lastImpulseUpdate = t;
    }

    this.primeIndex = (this.primeIndex + 1) % this.primes.length;
  }

  setWetDry(amount, manual = true) {
    if (manual) {
      this.manualAmount = amount;
    }
    const now = this.ctx.currentTime;
    this.wetGain.gain.setTargetAtTime(amount, now, 0.1);
    this.dryGain.gain.setTargetAtTime(1 - amount, now, 0.1);
  }

  updatePi(baseFreq) {
    this.baseFreq = baseFreq;
    const variant = this.pigreco
      ? this.pigreco(baseFreq, this.primeIndex % 4, { usePrimes: this.usePrimeMode, mode: this.mode })
      : baseFreq;
    const norm = Math.min(440, variant) / 440;
    switch (this.mode) {
      case "E":
        this.modDepth = 0.4 + norm * 0.5;
        this.modRate = (Math.PI / 4) * (1 + norm * 1.1);
        this.decayDepth = 0.3 + norm * 0.4;
        break;
      case "PHI":
        this.modDepth = 0.32 + norm * 0.35;
        this.modRate = (Math.PI / 5) * (0.75 + norm * 0.9);
        this.decayDepth = 0.28 + norm * 0.3;
        break;
      case "ZETA3":
        this.modDepth = 0.5 + norm * 0.5;
        this.modRate = (Math.PI / 3.5) * (0.9 + norm * 1.3);
        this.decayDepth = 0.35 + norm * 0.45;
        break;
      case "PI":
      default:
        this.modDepth = 0.35 + norm * 0.4;
        this.modRate = (Math.PI / 4) * (0.8 + norm);
        this.decayDepth = 0.25 + norm * 0.3;
        break;
    }
    return this.modRate;
  }

  connect(target) {
    this.master.connect(target);
    this.isConnected = true;
  }

  disconnect() {
    this.master.disconnect();
    this.isConnected = false;
  }

  setPrimeMode(enabled) {
    this.usePrimeMode = enabled;
    this.freeze(0.18);
  }

  stopWithFade() {
    if (!this.ctx) return;
    this.modActive = false;
    const now = this.ctx.currentTime;
    const end = now + 3;
    [this.master, this.wetGain, this.dryGain].forEach(node => {
      node.gain.cancelScheduledValues(now);
      node.gain.setValueAtTime(node.gain.value, now);
      node.gain.linearRampToValueAtTime(0, end);
    });
    setTimeout(() => {
      this.disconnect();
    }, 3100);
  }

  setMathMode(mode) {
    this.mode = mode;
    this.freeze(0.2);
    this.updatePi(this.baseFreq);
  }

  freeze(duration = 0.18) {
    if (!this.ctx) return;
    this.freezeUntil = this.ctx.currentTime + duration;
  }

  setDepthScale(scale = 1) {
    this.depthScale = Math.min(1, Math.max(0, scale));
  }
}

window.PiReverb = PiReverb;
