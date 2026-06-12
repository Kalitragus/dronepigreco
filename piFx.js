/**
 * π-based spatial effects for the Drone Machine.
 * Provides lightweight delay and reverb builders that expose input/output nodes
 * plus parameter setters. Modulation relies on deterministic Math.PI ratios to
 * produce fluid, never-repeating motion.
 */

/**
 * Smoothly ramps an AudioParam to a target value.
 * @param {AudioParam} param
 * @param {number} value
 * @param {number} time - absolute AudioContext time
 * @param {number} duration - seconds for linear ramp
 */
function ramp(param, value, time, duration = 0.15) {
  param.cancelScheduledValues(time);
  param.linearRampToValueAtTime(value, time + Math.max(0.01, duration));
}

/**
 * Utility LFO that outputs a phase-locked π-based modulation value.
 * @param {AudioContext} context
 * @param {number} rate - base rate in Hz
 * @param {number} depth - modulation depth
 */
function createPiLfo(context, rate, depth = 1) {
  const oscillator = context.createOscillator();
  oscillator.type = 'sine';
  oscillator.frequency.value = rate;

  const gain = context.createGain();
  gain.gain.value = depth;

  oscillator.connect(gain);
  oscillator.start();

  return { oscillator, gain, output: gain };
}

/**
 * Creates a π-driven stereo delay network with smoothed parameter updates.
 * Delay time and feedback are subtly animated from Math.PI proportions.
 * @param {AudioContext} context
 * @param {object} options
 * @param {number} [options.delayTime=0.32] - base delay in seconds
 * @param {number} [options.feedback=0.45] - feedback gain 0-0.9
 * @param {number} [options.mix=0.4] - wet/dry mix 0-1
 * @param {boolean} [options.pingPong=true] - cross-channel feedback
 */
export function createPiDelay(context, options = {}) {
  const settings = {
    delayTime: 0.32,
    feedback: 0.45,
    mix: 0.4,
    pingPong: true,
    ...options
  };

  const input = context.createGain();
  const output = context.createGain();

  const dry = context.createGain();
  const wet = context.createGain();

  const delayL = context.createDelay(4);
  const delayR = context.createDelay(4);

  // π-based offsets yield irrational ping-pong timing differences.
  delayL.delayTime.value = settings.delayTime;
  delayR.delayTime.value = settings.delayTime * (Math.PI / 3);

  const feedbackL = context.createGain();
  const feedbackR = context.createGain();

  const dampingL = context.createBiquadFilter();
  const dampingR = context.createBiquadFilter();
  dampingL.type = 'lowpass';
  dampingR.type = 'lowpass';
  dampingL.frequency.value = 4500;
  dampingR.frequency.value = 4500;

  const merger = context.createChannelMerger(2);
  const splitter = context.createChannelSplitter(2);

  input.connect(splitter);
  splitter.connect(delayL, 0);
  splitter.connect(delayR, 1);

  delayL.connect(dampingL).connect(feedbackL);
  delayR.connect(dampingR).connect(feedbackR);

  // Base feedback; cross feeds enable ping-pong motion.
  feedbackL.connect(delayL);
  feedbackR.connect(delayR);

  const crossL = context.createGain();
  const crossR = context.createGain();
  crossL.gain.value = settings.pingPong ? settings.feedback * 0.6 : 0;
  crossR.gain.value = settings.pingPong ? settings.feedback * 0.6 : 0;

  delayL.connect(crossL).connect(delayR);
  delayR.connect(crossR).connect(delayL);

  delayL.connect(merger, 0, 0);
  delayR.connect(merger, 0, 1);

  input.connect(dry);
  merger.connect(wet);

  dry.connect(output);
  wet.connect(output);

  // π-driven modulation of delay time (≤ ±20ms)
  const modLfo = createPiLfo(context, Math.PI / 24, 0.02);
  const modDepth = 0.02; // seconds
  modLfo.output.connect(delayL.delayTime);

  const modScale = context.createGain();
  modScale.gain.value = modDepth;
  modLfo.output.connect(modScale).connect(delayR.delayTime);

  const clockStart = context.currentTime;
  const tempGain = context.createGain();
  tempGain.gain.value = 0;
  tempGain.connect(context.destination); // keep LFO alive

  function updateFeedback(time) {
    const elapsed = time - clockStart;
    const periodic = 0.45 + 0.08 * Math.sin(elapsed * (Math.PI / 2));
    ramp(feedbackL.gain, settings.feedback * periodic, time, 0.35);
    ramp(feedbackR.gain, settings.feedback * periodic, time, 0.35);

    // Filter cutoff tracks π-shaped arc to mellow repeats over time.
    const cutoff = 2000 + 1500 * Math.sin(elapsed * Math.PI / 6);
    ramp(dampingL.frequency, cutoff, time, 0.4);
    ramp(dampingR.frequency, cutoff * 0.95, time, 0.4);
  }

  function scheduleTick() {
    if (context.state === 'closed') return;
    const now = context.currentTime;
    updateFeedback(now);
    setTimeout(scheduleTick, 400);
  }
  scheduleTick();

  function setDelayTime(value) {
    settings.delayTime = value;
    const now = context.currentTime;
    ramp(delayL.delayTime, value, now);
    ramp(delayR.delayTime, value * (Math.PI / 3), now);
  }

  function setFeedback(value) {
    settings.feedback = value;
    const now = context.currentTime;
    ramp(feedbackL.gain, value, now);
    ramp(feedbackR.gain, value, now);
    ramp(crossL.gain, settings.pingPong ? value * 0.6 : 0, now);
    ramp(crossR.gain, settings.pingPong ? value * 0.6 : 0, now);
  }

  function setMix(value) {
    settings.mix = value;
    const now = context.currentTime;
    ramp(wet.gain, value, now);
    ramp(dry.gain, 1 - value, now);
  }

  function setPingPong(enabled) {
    settings.pingPong = enabled;
    setFeedback(settings.feedback);
  }

  setDelayTime(settings.delayTime);
  setFeedback(settings.feedback);
  setMix(settings.mix);

  return {
    input,
    output,
    setDelayTime,
    setFeedback,
    setMix,
    setPingPong,
    dispose() {
      modLfo.oscillator.stop();
    }
  };
}

/**
 * Implements a lightweight π-proportioned algorithmic reverb.
 * Parallel combs feed series all-pass filters; parameters are smoothed and
 * modulated using Math.PI-based sinusoids for subtle motion.
 * @param {AudioContext} context
 * @param {object} options
 * @param {number} [options.decayTime=3.2] - seconds
 * @param {number} [options.mix=0.5] - wet/dry mix 0-1
 */
export function createPiReverb(context, options = {}) {
  const settings = {
    decayTime: 3.2,
    mix: 0.5,
    ...options
  };

  const input = context.createGain();
  const output = context.createGain();

  const dry = context.createGain();
  const wet = context.createGain();

  input.connect(dry).connect(output);

  const combDelays = [
    Math.PI / 28,  // ≈ 0.112 s
    Math.PI / 20,  // ≈ 0.157 s
    Math.PI / 18,  // ≈ 0.174 s
    Math.PI / 16   // ≈ 0.196 s
  ];

  const combs = combDelays.map((delaySeconds, index) => {
    const delay = context.createDelay(1.5);
    delay.delayTime.value = delaySeconds;

    const feedback = context.createGain();
    const filter = context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 5500 - index * 600;

    const gain = context.createGain();

    const modulator = createPiLfo(context, Math.PI / (10 + index * 6), 0.003);
    const depth = context.createGain();
    depth.gain.value = 0.003;
    modulator.output.connect(depth).connect(delay.delayTime);

    input.connect(delay);
    delay.connect(filter).connect(feedback).connect(delay);
    delay.connect(gain);

    return { delay, feedback, filter, gain, modulator };
  });

  const allpass1 = context.createBiquadFilter();
  allpass1.type = 'allpass';
  allpass1.frequency.value = 1200;

  const allpass2 = context.createBiquadFilter();
  allpass2.type = 'allpass';
  allpass2.frequency.value = 2700;

  const combSum = context.createGain();

  combs.forEach(({ gain }) => gain.connect(combSum));

  combSum.connect(allpass1).connect(allpass2).connect(wet).connect(output);

  function updateDecay(value) {
    settings.decayTime = value;
    const now = context.currentTime;
    const baseFeedback = Math.exp(-3 / value); // map decay to comb feedback
    combs.forEach(({ feedback }, index) => {
      const offset = 0.02 * Math.sin(now * Math.PI / (5 + index));
      const target = Math.min(0.92, baseFeedback + offset);
      ramp(feedback.gain, target, now, 0.4);
    });
  }

  function setMix(value) {
    settings.mix = value;
    const now = context.currentTime;
    ramp(wet.gain, value, now);
    ramp(dry.gain, 1 - value, now);
  }

  // π-based gentle variation of tonal color via low-pass filters.
  function tick() {
    if (context.state === 'closed') return;
    const now = context.currentTime;
    combs.forEach(({ filter }, index) => {
      const sweep = 3500 + 1500 * Math.sin(now * Math.PI / (6 + index * 2));
      ramp(filter.frequency, sweep, now, 0.5);
    });
    setTimeout(tick, 500);
  }
  tick();

  updateDecay(settings.decayTime);
  setMix(settings.mix);

  return {
    input,
    output,
    setDecayTime: updateDecay,
    setMix,
    dispose() {
      combs.forEach(({ modulator }) => modulator.oscillator.stop());
    }
  };
}
