(function () {
  class PiFX {
    constructor(ctx, options = {}) {
      this.ctx = ctx;
      this.input = ctx.createGain();
      this.delay = ctx.createDelay(2);
      this.feedbackGain = ctx.createGain();
      this.lowpass = ctx.createBiquadFilter();
      this.convolver = ctx.createConvolver();
      this.wetGain = ctx.createGain();
      this.dryGain = ctx.createGain();
      this.outputGain = ctx.createGain();

      this.baseDelay = options.baseDelay ?? 0.45;
      this.baseFeedback = options.baseFeedback ?? 0.35;
      this.depth = options.depth ?? 0.32;
      this.depthScale = options.depthScale ?? 1;
      this.modSpeed = options.modSpeed ?? 0.12;
      this.feedbackOffset = options.feedbackOffset ?? Math.PI / 3;
      this.globalAmount = options.amount ?? 0.5;
      this.usePrimeMode = false;
      this.mode = "PI";
      this.freezeUntil = 0;
      this.primes = [2, 3, 5, 7, 11, 13];
      this.primeIndex = 0;

      this.delay.delayTime.value = this.baseDelay;
      this.feedbackGain.gain.value = Math.min(this.baseFeedback, 0.9);

      this.lowpass.type = "lowpass";
      this.lowpass.frequency.value = 3200;
      this.lowpass.Q.value = 0.8;

      this.dryGain.gain.value = 1 - this.globalAmount * 0.7;
      this.wetGain.gain.value = this.globalAmount;

      this.convolver.buffer = PiFX.createImpulseResponse(ctx, 2.8, 2.7);

      this.input.connect(this.dryGain);
      this.input.connect(this.delay);

      this.delay.connect(this.lowpass);
      this.lowpass.connect(this.feedbackGain);
      this.feedbackGain.connect(this.delay);

      this.lowpass.connect(this.convolver);
      this.delay.connect(this.wetGain);
      this.convolver.connect(this.wetGain);

      this.dryGain.connect(this.outputGain);
      this.wetGain.connect(this.outputGain);

      this._boundTick = this._tick.bind(this);
      // setInterval instead of requestAnimationFrame: keeps modulating when
      // the tab is in background and decouples audio from frame rate.
      this._modTimer = setInterval(this._boundTick, 90);
    }

    static createImpulseResponse(ctx, seconds = 2.5, decay = 2.4) {
      const length = Math.floor(ctx.sampleRate * seconds);
      const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
      for (let channel = 0; channel < 2; channel++) {
        const data = buffer.getChannelData(channel);
        for (let i = 0; i < length; i++) {
          const t = i / length;
          const envelope = Math.pow(1 - t, decay);
          data[i] = (Math.random() * 2 - 1) * envelope * Math.cos(Math.PI * t * (1 + channel * 0.3));
        }
      }
      return buffer;
    }

    _tick() {
      if (!this.ctx || this.ctx.state === "closed") {
        return;
      }
      const t = this.ctx.currentTime;
      if (t < this.freezeUntil) {
        return;
      }
      const primeStep = this.usePrimeMode ? this.primes[this.primeIndex % this.primes.length] : 1;
      const depthScale = Math.min(1, Math.max(0, this.depthScale));
      const delaySwing = this.depth * depthScale;
      const delayTarget =
        this.baseDelay * (1 + Math.sin(Math.PI * t * this.modSpeed * primeStep) * delaySwing);
      this.delay.delayTime.setTargetAtTime(delayTarget, t, 0.25);

      const feedbackSwing =
        Math.sin((Math.PI / 2) * t * (primeStep * 0.9) + this.feedbackOffset) *
        (delaySwing + 0.15 * depthScale);
      const feedbackTarget = this.baseFeedback * (1 + feedbackSwing);
      const limitedFeedback = Math.min(0.9, Math.max(0, feedbackTarget));
      this.feedbackGain.gain.setTargetAtTime(limitedFeedback, t, 0.3);

      const lpTarget =
        2100 + 2200 * Math.sin(Math.PI * t * (this.modSpeed * 1.9) * primeStep) * depthScale;
      this.lowpass.frequency.setTargetAtTime(lpTarget, t, 0.3);

      if (this.usePrimeMode) {
        this.primeIndex = (this.primeIndex + 1) % this.primes.length;
      }
    }

    setAmount(value) {
      this.globalAmount = value;
      const now = this.ctx.currentTime;
      this.wetGain.gain.setTargetAtTime(value, now, 0.25);
      this.dryGain.gain.setTargetAtTime(Math.max(0, 1 - value * 0.7), now, 0.25);
    }

    setPrimeMode(enabled) {
      this.usePrimeMode = enabled;
    }

    setMathMode(mode) {
      this.mode = mode;
      this.freeze(0.2);
      switch (mode) {
        case "E":
          this.baseDelay = 0.5;
          this.depth = 0.45;
          this.modSpeed = 0.18;
          this.feedbackOffset = Math.PI / 2.4;
          break;
        case "PHI":
          this.baseDelay = 0.42;
          this.depth = 0.34;
          this.modSpeed = 0.1;
          this.feedbackOffset = Math.PI / 1.8;
          break;
        case "ZETA3":
          this.baseDelay = 0.58;
          this.depth = 0.52;
          this.modSpeed = 0.22;
          this.feedbackOffset = Math.PI / 3.4;
          break;
        case "PI":
        default:
          this.baseDelay = 0.45;
          this.depth = 0.32;
          this.modSpeed = 0.12;
          this.feedbackOffset = Math.PI / 3;
          break;
      }
      const now = this.ctx.currentTime;
      this.feedbackGain.gain.setTargetAtTime(Math.min(this.baseFeedback, 0.9), now, 0.1);
    }

    freeze(duration = 0.2) {
      if (!this.ctx) return;
      this.freezeUntil = this.ctx.currentTime + duration;
    }

    setDepthScale(scale = 1) {
      this.depthScale = Math.min(1, Math.max(0, scale));
    }

    connect(destination) {
      this.outputGain.connect(destination);
    }

    disconnect() {
      this.outputGain.disconnect();
    }

    dispose() {
      if (this._modTimer) {
        clearInterval(this._modTimer);
        this._modTimer = null;
      }
      this.disconnect();
    }
  }

  window.PiFX = PiFX;
})();
