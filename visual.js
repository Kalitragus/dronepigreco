// Visual: la finestra che interpreta lo Studio.
// - Forma (drone): armonografo i cui rapporti vengono dalle stesse formule
//   matematiche del drone; Prime Quantization aggiunge il reticolo di punti.
// - Noise (granulone): campo di particelle pilotato dall'energia del granulare.
// - Palette (basso): la tinta segue il grado della nota, gli accenti saturano.
// - Impulsi (drum): kick = anello/zoom, snare = frattura, hat = scintille,
//   perc = ripple.
// Solo grafica su requestAnimationFrame: l'audio non passa di qui.

const W = 960;
const H = 540;
const NOISE_PARTICLES = 140;

export function createVisual(ctx, deps) {
  const { getTonalState, getDroneOutput, granAnalyser, bass, drums } = deps;

  // ---- palette (basso) ----
  let hue = 205;
  let hueTarget = 205;
  let satBoost = 0;
  bass?.onNote?.(({ freq, accent, degree }) => {
    const octaveShift = Math.log2(Math.max(25, freq) / 55) * 40;
    hueTarget = ((degree * 47 + octaveShift) % 360 + 360) % 360;
    if (accent) satBoost = 1;
  });

  // ---- impulsi (drum) ----
  const pulses = [];
  drums?.onHit?.((voice, time, velocity) => {
    pulses.push({ voice, born: performance.now(), velocity });
    if (pulses.length > 48) pulses.shift();
  });

  // ---- analyser del drone (lazy: l'uscita esiste dopo il primo avvio) ----
  let droneAnalyser = null;
  const droneData = new Uint8Array(256);
  function ensureDroneAnalyser() {
    if (droneAnalyser) return;
    const out = getDroneOutput?.();
    if (out) {
      droneAnalyser = ctx.createAnalyser();
      droneAnalyser.fftSize = 256;
      out.connect(droneAnalyser);
    }
  }
  const granData = new Uint8Array(granAnalyser ? granAnalyser.fftSize : 0);

  function levelOf(analyser, data) {
    if (!analyser) return 0;
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const d = (data[i] - 128) / 128;
      sum += d * d;
    }
    return Math.min(1, Math.sqrt(sum / data.length) * 3);
  }

  // ---- noise (granulone) ----
  const particles = Array.from({ length: NOISE_PARTICLES }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    vx: 0,
    vy: 0,
    seed: Math.random() * Math.PI * 2
  }));

  let canvas = null;
  let g = null;
  let panel = null;
  let t = 0;
  let zoom = 0;

  function tonalRatios(tonal) {
    const base = tonal?.baseFrequency || 110;
    const mode = tonal?.currentMode || "PI";
    const usePrimes = !!tonal?.primeMode;
    const ratios = [];
    for (let i = 0; i < 3; i++) {
      const f = typeof window !== "undefined" && typeof window.pigreco === "function"
        ? window.pigreco(base, i, { usePrimes, mode })
        : base * (1 + i * 0.5);
      ratios.push(Math.max(0.25, Math.min(4, f / base)));
    }
    return ratios;
  }

  function drawHarmonograph(tonal, droneLevel) {
    const [a, b, c] = tonalRatios(tonal);
    const depth = tonal?.piDepth ?? 0.4;
    const morph = tonal?.morph ?? 0;
    const copies = 1 + Math.round(morph * 3);
    const amp = (H * 0.32) * (0.7 + droneLevel * 0.6);
    const cx = W / 2;
    const cy = H / 2;
    const baseRot = t * 0.05;

    for (let copy = 0; copy < copies; copy++) {
      const rot = baseRot + (copy / copies) * Math.PI * 2;
      g.save();
      g.translate(cx, cy);
      g.rotate(rot);
      g.beginPath();
      const steps = 420;
      for (let i = 0; i <= steps; i++) {
        const s = (i / steps) * Math.PI * 2 * 3;
        const wobble = 1 + Math.sin(s * c + t * 0.8) * depth * 0.35;
        const x = Math.sin(s * a + t * 0.21) * amp * wobble;
        const y = Math.sin(s * b + t * 0.17 + Math.PI / 4) * amp * wobble * 0.78;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      const alpha = 0.34 / copies + droneLevel * 0.25;
      g.strokeStyle = `hsla(${hue}, ${60 + satBoost * 35}%, ${58 + droneLevel * 18}%, ${alpha})`;
      g.lineWidth = 1.2;
      g.stroke();
      g.restore();
    }

    if (tonal?.primeMode) {
      const primes = [2, 3, 5, 7, 11, 13];
      g.fillStyle = `hsla(${(hue + 40) % 360}, 70%, 65%, 0.5)`;
      primes.forEach((p, i) => {
        const angle = baseRot * p * 0.5 + i;
        const radius = (H * 0.1) + i * (H * 0.055);
        for (let k = 0; k < p; k++) {
          const phi = angle + (k / p) * Math.PI * 2;
          g.beginPath();
          g.arc(cx + Math.cos(phi) * radius, cy + Math.sin(phi) * radius, 1.6, 0, Math.PI * 2);
          g.fill();
        }
      });
    }
  }

  function drawNoise(granLevel) {
    if (granLevel < 0.01) return;
    const drive = granLevel * 2.2;
    g.fillStyle = `hsla(${(hue + 160) % 360}, 55%, 70%, ${Math.min(0.7, 0.18 + granLevel * 0.5)})`;
    particles.forEach(p => {
      p.vx += (Math.random() - 0.5) * drive;
      p.vy += (Math.random() - 0.5) * drive;
      p.vx *= 0.92;
      p.vy *= 0.92;
      p.x += p.vx + Math.sin(t * 0.7 + p.seed) * 0.4;
      p.y += p.vy + Math.cos(t * 0.6 + p.seed) * 0.4;
      if (p.x < 0) p.x += W;
      if (p.x > W) p.x -= W;
      if (p.y < 0) p.y += H;
      if (p.y > H) p.y -= H;
      const size = 0.8 + granLevel * 2.4;
      g.fillRect(p.x, p.y, size, size);
    });
  }

  function drawPulses() {
    const now = performance.now();
    for (let i = pulses.length - 1; i >= 0; i--) {
      const pulse = pulses[i];
      const age = (now - pulse.born) / 1000;
      if (age > 0.8) {
        pulses.splice(i, 1);
        continue;
      }
      const fade = 1 - age / 0.8;
      const v = pulse.velocity;
      if (pulse.voice === "kick") {
        if (age < 0.12) zoom = Math.max(zoom, (0.12 - age) * 0.5 * v);
        g.strokeStyle = `hsla(${hue}, 80%, 60%, ${fade * 0.6})`;
        g.lineWidth = 2.5 * fade;
        g.beginPath();
        g.arc(W / 2, H / 2, 30 + age * 620, 0, Math.PI * 2);
        g.stroke();
      } else if (pulse.voice === "snare") {
        g.strokeStyle = `hsla(${(hue + 90) % 360}, 75%, 70%, ${fade * 0.55})`;
        g.lineWidth = 1.4;
        const seedBase = pulse.born % 1000;
        for (let k = 0; k < 5; k++) {
          const angle = ((seedBase * (k + 1)) % 360) * (Math.PI / 180);
          const reach = (60 + ((seedBase * (k + 3)) % 200)) * (0.4 + age);
          g.beginPath();
          g.moveTo(W / 2, H / 2);
          g.lineTo(W / 2 + Math.cos(angle) * reach, H / 2 + Math.sin(angle) * reach);
          g.stroke();
        }
      } else if (pulse.voice === "hat") {
        g.fillStyle = `hsla(${(hue + 200) % 360}, 80%, 80%, ${fade * 0.7})`;
        const seedBase = pulse.born % 977;
        for (let k = 0; k < 7; k++) {
          const x = (seedBase * (k + 7)) % W;
          const y = ((seedBase * (k + 13)) % (H * 0.4));
          g.fillRect(x, y, 2, 2);
        }
      } else {
        g.strokeStyle = `hsla(${(hue + 300) % 360}, 70%, 65%, ${fade * 0.5})`;
        g.lineWidth = 1.5;
        const seedBase = pulse.born % 877;
        const px = seedBase % W;
        const py = (seedBase * 3) % H;
        g.beginPath();
        g.arc(px, py, 8 + age * 180, 0, Math.PI * 2);
        g.stroke();
      }
    }
    zoom *= 0.88;
  }

  function render() {
    requestAnimationFrame(render);
    if (!g || (panel && panel.hidden && document.fullscreenElement !== canvas)) return;
    t += 1 / 60;
    satBoost = Math.max(0, satBoost - 0.03);
    let diff = hueTarget - hue;
    if (Math.abs(diff) > 180) diff -= Math.sign(diff) * 360;
    hue = (hue + diff * 0.04 + 360) % 360;

    ensureDroneAnalyser();
    const droneLevel = levelOf(droneAnalyser, droneData);
    const granLevel = granAnalyser ? levelOf(granAnalyser, granData) : 0;

    g.setTransform(1, 0, 0, 1, 0, 0);
    g.fillStyle = `hsla(${hue}, 35%, 4%, 0.22)`;
    g.fillRect(0, 0, W, H);

    const scale = 1 + zoom;
    g.setTransform(scale, 0, 0, scale, (W - W * scale) / 2, (H - H * scale) / 2);

    const tonal = getTonalState?.() || null;
    drawHarmonograph(tonal, droneLevel);
    drawNoise(granLevel);
    drawPulses();
  }

  function mount(targetPanel) {
    panel = targetPanel;
    const section = document.createElement("section");
    section.className = "synth-section";
    section.innerHTML = `
      <h2>Visual</h2>
      <p class="synth-hint">
        Il drone disegna la forma (cambia costante e cambia la geometria),
        il Granulone accende il noise, il basso muove la palette di colori,
        la drum scolpisce gli impulsi. Avvia i synth e guarda.
      </p>
      <canvas id="visualCanvas" width="${W}" height="${H}"></canvas>
      <div class="preset-row" style="margin-top:1rem;">
        <button id="visualFullscreenBtn" type="button">Fullscreen</button>
      </div>`;
    canvas = section.querySelector("#visualCanvas");
    g = canvas.getContext("2d");
    g.fillStyle = "#05070b";
    g.fillRect(0, 0, W, H);
    section.querySelector("#visualFullscreenBtn").addEventListener("click", () => {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        canvas.requestFullscreen?.();
      }
    });
    targetPanel.appendChild(section);
    requestAnimationFrame(render);
  }

  return { mount };
}
