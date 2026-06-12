# Drone Machine π — Algorithms and Parameters

## 1. Architecture Overview
The Web Audio synthesizer runs four independent voices (`VOICE_COUNT = 4`).  
Each voice contains:
- **Oscillator** (selectable waveform) with a pitch LFO.
- **Internal FX chain**: gain → delay → convolution + resonators.
- **Shared low-pass filter** with cutoff and resonance controls.
- **Routing** into the FX bus (`PiFX`) and the reverb (`PiReverb`), then to the master.

The core pitch is produced by the helper `pigreco(baseFreq, voiceIndex, options)`, which depends on:
- The selected mathematical mode.
- Whether prime quantization is active.
- Global UI parameters (base frequency, π depth, morph, etc.).


## 2. Mathematical Modes (`pigreco.js`)
`MATH_CONSTANTS` defines a collection of mode profiles. Each one contains:
- **label** (button caption / symbol),
- **value** (approximate numeric constant),
- **ratio(index)**: function returning the multiplier applied to the base frequency for the given voice index.

Available modes:
1. PI (π) – circle ratio.
2. E – natural exponential growth.
3. PHI – golden ratio progression.
4. ZETA3 – Apéry constant, fractal variations.
5. SQRT2 – geometric expansion with √2.
6. PHI2 – golden ratio squared (φ²).
7. GAMMA – Euler–Mascheroni constant, logarithmic offsets.
8. SQRT5 – geometry linked to √5.
9. CATALAN (G) – Catalan’s constant.
10. SQRT3 – triadic symmetry with √3.
11. TAU (2π) – full-cycle resonance.
12. ZETA2 – Basel constant (π² / 6).

Each mode influences:
- Per-voice pitch ratios.
- `PiFX` dynamics (delay base, modulation depth/rate, feedback bias).
- `PiReverb` dynamics (modulation rate/depth, decay curve, wet bias).


## 3. Global UI Parameters
| Parameter            | Effect                                                                                         |
|----------------------|-------------------------------------------------------------------------------------------------|
| **Base Frequency**   | Master reference for `pigreco()`. All voices are scaled from this pitch.                        |
| **π Depth**          | Global modulation depth (pitch LFO, filter swings, FX bias).                                    |
| **Morph**            | Interpolates pan and delay between mirrored voice layouts.                                      |
| **Resonator Amount** | Sets the mix level of the multi-band resonator bank (`RESONATOR_FREQS`).                        |
| **FX Amount**        | Controls `PiFX` wet/dry with a nonlinear response; modes can bias this value.                   |
| **Master Volume**    | Final gain applied to the `masterGain`.                                                         |
| **Prime Quantization** | Locks pitches to the nearest ratios from `PRIME_GRID` (2,3,5,7,11,13,17,19).                 |

### Per-voice controls
Each voice exposes:
- Waveform selector (sine, triangle, saw, square).
- Live-adjustable pan, gain, delay, low-pass cutoff and resonance.


## 4. Prime Quantization
When `Prime Quantization` is enabled:
1. `pigreco()` computes the continuous frequency for each voice.
2. `quantizeToPrimes(freq, baseFreq)` maps the ratio to the nearest prime fraction.
3. The frequency is clamped to the `[20, 440] Hz` range.

This creates harmonically stable relationships and blends the mathematical mode with prime-number intervals.


## 5. Interactions and Modulators
1. **Switch mode → `setMathMode()`**  
   - Updates UI state, reconfigures `PiFX` & `PiReverb`, rescales LFOs and filters, and applies voice controls.

2. **Shared modulation → `updateAllModulations()`**  
   - Every ~50 ms modulates voice filters based on π depth, morph and the mode profile, and pings `PiReverb.updateParameters()`.

3. **Nonlinear FX amount**  
   - Slider input is mapped via `mapFxAmount(fx^0.7) * 0.65`; modes can bias the effective wet mix.

4. **Pitch LFO**  
   - LFO rate/gain respond to mode-specific scalers and the π depth multiplier.

5. **Morph**  
   - Smoothly bends pan and delay times, creating spatial movement that combines well with TAU / ZETA modulation.


## 6. Signal Flow Summary
```
Oscillator → Gain → Delay → Convolver
                       ↘ Resonator Filters → Mix
Mix → Voice Low-pass → Stereo Panner → PiFX → PiReverb → MasterGain → Destination
```
All automation uses Web Audio scheduling (`linearRampToValueAtTime`, `setTargetAtTime`) to avoid clicks.  
`stopDrone()` performs a 3-second fade and lets the delay/reverb tail decay naturally.


## 7. Operational Notes
- **Start Drone** creates/resumes the AudioContext (requires user gesture in most browsers).
- **Randomize** toggles on the engine if necessary and scatters voice parameters & modes.
- Diagnostics via `[MOD DEBUG] …` logs provide insight into active mode, depth, FX, and nodes under modulation.
- The `perf-footer` shows CPU usage & FPS, highlighting in red when CPU > 75%.


## 8. Keyboard Controller (design prompt)
Add a keyboard-style controller tied to Base Frequency.  
Desired behaviour:
1. **Key mapping**  
   - Map computer keyboard row: e.g., `KeyA`=base note, `KeyW`=+1 semitone, `KeyS`=+2, etc.  
   - Keep a dictionary like:
     ```js
     const KEY_TO_SEMITONE = {
       KeyA: 0, KeyW: 1, KeyS: 2, KeyE: 3, KeyD: 4, KeyF: 5, KeyT: 6,
       KeyG: 7, KeyY: 8, KeyH: 9, KeyU: 10, KeyJ: 11, KeyK: 12
     };
     ```
   - Allow octave changes with `KeyZ` (down one octave) and `KeyX` (up one octave); clamp octave range (e.g., 2–6).

2. **Base frequency control**  
   - On `keydown`:
     - Ignore `event.repeat` and events originating from input fields.
     - Use `ensureAudioContext()` to guarantee audio is running.
     - Compute `newFreq = baseFrequency * Math.pow(2, semitoneOffset / 12 + octaveShift)`.
     - Clamp to `[20, 440]`, update the slider (`ui.baseFreq.value`) and label (`ui.baseFreqVal`).
     - Call `updateBaseFrequency()` to propagate across voices/FX.
   - On `keyup`:
     - If a key matches the active mapping, restore the previous base frequency (or maintain a “hold” if desired).

3. **Visual feedback**  
   - (Optional) Provide an element in the UI (`#current-note`) to display the note name and octave.  
   - Use a lookup like `NOTE_NAMES = ['C', 'C#', 'D', ...]` to derive note names from frequency.

4. **Implementation details**  
   - Add the event listeners in `bindUI()` or a dedicated `initializeKeyboardController()`.  
   - Manage a `baseFreqMemory` variable to restore the original pitch after key release.  
   - Handle the octave shift with a `currentOctaveOffset` variable modified by `KeyZ`/`KeyX`.

5. **Testing**  
   - Load the page, click Start Drone, then play the mapped keys; the drone should follow the pitch changes.  
   - Verify that releasing keys resets or maintains the desired sustain.  
   - Switching modes or toggling Prime Quantization should continue to work while the keyboard is active.

This prompt can be passed to Codex (or used manually) to implement a keyboard-driven base-frequency controller with octave shifting via the Z / X keys.
