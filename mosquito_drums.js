// Mosquito Drums: lo sciame decide quali step della griglia colpiscono e con
// che forza (stocastica imbrigliata dal clock, alla Grids). Il canvas è la
// superficie di esecuzione: click = sposta la luce, il ragno = fill.
// 4 voci sintetizzate, ognuna con Level / Tune / Filtro / Decay.
// Interfaccia modulo: createMosquitoDrums(ctx, deps) -> { output, mount,
// getState, applyState }.

const WORLD_W = 400;
const WORLD_H = 190;
const AGENT_COUNT = 22;

const VOICE_ORDER = ["kick", "snare", "hat", "perc"];

const VOICE_DEFS = {
  kick: {
    label: "Kick",
    filterType: "lowpass",
    filter: { min: 100, max: 2000, def: 800 },
    tune: { min: 30, max: 90, def: 52 },
    decay: { min: 0.08, max: 0.9, def: 0.42 },
    level: 0.9
  },
  snare: {
    label: "Snare",
    filterType: "bandpass",
    filter: { min: 500, max: 6000, def: 1800 },
    tune: { min: 120, max: 320, def: 190 },
    decay: { min: 0.05, max: 0.5, def: 0.2 },
    level: 0.7
  },
  hat: {
    label: "Hat",
    filterType: "highpass",
    filter: { min: 2000, max: 11000, def: 6500 },
    tune: null,
    decay: { min: 0.02, max: 0.35, def: 0.07 },
    level: 0.5
  },
  perc: {
    label: "Perc",
    filterType: "bandpass",
    filter: { min: 300, max: 4000, def: 1200 },
    tune: { min: 80, max: 600, def: 220 },
    decay: { min: 0.03, max: 0.5, def: 0.12 },
    level: 0.6
  }
};

// Pesi per step (16esimi) in stile topografico: la griglia dà il groove,
// lo sciame decide quanto di quel groove si accende.
const STEP_WEIGHTS = {
  kick:  [1, 0, 0, 0, 0.1, 0, 0.6, 0, 0.9, 0, 0, 0.3, 0.2, 0, 0.4, 0],
  snare: [0, 0, 0, 0, 1, 0, 0, 0.2, 0, 0, 0.1, 0, 1, 0, 0, 0.4],
  hat:   [0.8, 0.3, 0.6, 0.3, 0.8, 0.3, 0.7, 0.3, 0.8, 0.3, 0.6, 0.4, 0.8, 0.3, 0.7, 0.5],
  perc:  [0, 0.4, 0, 0.2, 0, 0, 0.5, 0, 0.3, 0, 0, 0.6, 0, 0.4, 0, 0.2]
};

export function createMosquitoDrums(ctx, { masterBus, clock }) {
  const output = ctx.createGain();
  output.gain.value = 0.9;
  output.connect(masterBus);

  const noiseBuffer = (() => {
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  })();

  const params = {
    swarm: { temperature: 0.55, density: 0.6 },
    voices: {}
  };
  const voiceNodes = {};
  VOICE_ORDER.forEach(name => {
    const def = VOICE_DEFS[name];
    params.voices[name] = {
      level: def.level,
      tune: def.tune ? def.tune.def : 0,
      filter: def.filter.def,
      decay: def.decay.def,
      mute: false
    };
    const filterNode = ctx.createBiquadFilter();
    filterNode.type = def.filterType;
    filterNode.frequency.value = def.filter.def;
    if (def.filterType === "bandpass") filterNode.Q.value = 1.2;
    const gainNode = ctx.createGain();
    gainNode.gain.value = def.level;
    filterNode.connect(gainNode).connect(output);
    voiceNodes[name] = { filter: filterNode, gain: gainNode };
  });

  // ------------------------------------------------------------------
  // Sintesi delle voci (oscillatori/noise per colpo, inviluppo a decay).
  // ------------------------------------------------------------------
  function envGain(time, vel, decay) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(vel, time + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, time + Math.max(0.03, decay));
    return g;
  }

  function noiseSource(time, duration) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer;
    src.loop = true;
    src.start(time);
    src.stop(time + duration + 0.1);
    return src;
  }

  const triggers = {
    kick(time, vel, v) {
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(Math.max(40, v.tune * 3.2), time);
      osc.frequency.exponentialRampToValueAtTime(v.tune, time + 0.05);
      const g = envGain(time, vel, v.decay);
      osc.connect(g).connect(voiceNodes.kick.filter);
      osc.start(time);
      osc.stop(time + v.decay + 0.15);
    },
    snare(time, vel, v) {
      const body = ctx.createOscillator();
      body.type = "triangle";
      body.frequency.setValueAtTime(v.tune, time);
      const bodyG = envGain(time, vel * 0.6, Math.min(0.12, v.decay));
      body.connect(bodyG).connect(voiceNodes.snare.filter);
      body.start(time);
      body.stop(time + v.decay + 0.1);
      const noise = noiseSource(time, v.decay);
      const noiseG = envGain(time, vel, v.decay);
      noise.connect(noiseG).connect(voiceNodes.snare.filter);
    },
    hat(time, vel, v) {
      const noise = noiseSource(time, v.decay);
      const g = envGain(time, vel, v.decay);
      noise.connect(g).connect(voiceNodes.hat.filter);
    },
    perc(time, vel, v) {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.setValueAtTime(v.tune * 1.4, time);
      osc.frequency.exponentialRampToValueAtTime(Math.max(40, v.tune), time + 0.04);
      const g = envGain(time, vel * 0.8, v.decay);
      osc.connect(g).connect(voiceNodes.perc.filter);
      osc.start(time);
      osc.stop(time + v.decay + 0.1);
    }
  };

  // ------------------------------------------------------------------
  // Sciame (fisica su timer fisso; il canvas disegna soltanto).
  // ------------------------------------------------------------------
  const world = {
    lightX: WORLD_W / 2,
    lightY: WORLD_H / 2,
    panic: 0,
    saccades: [0, 0, 0, 0]
  };
  const agents = Array.from({ length: AGENT_COUNT }, () => ({
    x: Math.random() * WORLD_W,
    y: Math.random() * WORLD_H,
    heading: Math.random() * Math.PI * 2,
    speed: 0.6 + Math.random() * 0.6,
    cooldown: Math.random() * 60,
    flash: 0
  }));

  function physicsTick() {
    const temp = params.swarm.temperature;
    agents.forEach(agent => {
      let speed = agent.speed * (0.4 + temp * 1.6);
      if (world.panic > 0) speed *= 2.3;
      agent.x += Math.cos(agent.heading) * speed;
      agent.y += Math.sin(agent.heading) * speed;
      if (agent.x < 0) agent.x += WORLD_W;
      if (agent.x > WORLD_W) agent.x -= WORLD_W;
      if (agent.y < 0) agent.y += WORLD_H;
      if (agent.y > WORLD_H) agent.y -= WORLD_H;

      const toLight = Math.atan2(world.lightY - agent.y, world.lightX - agent.x);
      let diff = toLight - agent.heading;
      diff = ((diff + Math.PI) % (Math.PI * 2)) - Math.PI;
      agent.heading += diff * 0.025;

      agent.cooldown -= 1 + temp;
      if (agent.flash > 0) agent.flash -= 0.12;
      const saccadeChance = 0.01 + temp * 0.03 + world.panic * 0.12;
      if (agent.cooldown <= 0 && Math.random() < saccadeChance) {
        agent.heading += (Math.random() < 0.5 ? -1 : 1) * (Math.PI / 4 + Math.random() * Math.PI / 2);
        agent.cooldown = 25 + Math.random() * 70;
        agent.flash = 1;
        const region = Math.min(3, Math.floor(agent.x / (WORLD_W / 4)));
        world.saccades[region] += 1;
      }
    });
    world.panic = Math.max(0, world.panic - 0.012);
  }
  setInterval(physicsTick, 33);

  function regionEnergies() {
    const counts = [0, 0, 0, 0];
    agents.forEach(agent => {
      counts[Math.min(3, Math.floor(agent.x / (WORLD_W / 4)))] += 1;
    });
    const expected = AGENT_COUNT / 3;
    const energies = counts.map((count, i) => {
      const saccadeBoost = Math.min(1, world.saccades[i] * 0.3);
      return Math.min(1, count / expected) * 0.8 + saccadeBoost * 0.2;
    });
    world.saccades = [0, 0, 0, 0];
    return energies;
  }

  const recentHits = { kick: 0, snare: 0, hat: 0, perc: 0 };
  const hitListeners = new Set();

  function onStep(time, step) {
    const energies = regionEnergies();
    VOICE_ORDER.forEach((name, idx) => {
      const v = params.voices[name];
      if (v.mute) return;
      const weight = STEP_WEIGHTS[name][step % 16];
      const energy = energies[idx];
      let probability = weight * params.swarm.density * (0.35 + 0.65 * energy);
      if (world.panic > 0.05 && (name === "hat" || name === "snare")) {
        probability = Math.max(probability, world.panic * 0.55);
      }
      if (Math.random() < probability) {
        const velocity = Math.min(1, 0.55 + 0.45 * energy + world.panic * 0.2);
        triggers[name](time, velocity, v);
        recentHits[name] = performance.now();
        hitListeners.forEach(fn => {
          try {
            fn(name, time, velocity);
          } catch (error) {
            console.error(error);
          }
        });
      }
    });
  }
  clock.subscribe(onStep);

  // ------------------------------------------------------------------
  // UI
  // ------------------------------------------------------------------
  const sliders = {};

  function applyVoiceParam(name, key, value) {
    params.voices[name][key] = value;
    if (key === "level") {
      voiceNodes[name].gain.gain.setTargetAtTime(value, ctx.currentTime, 0.05);
    } else if (key === "filter") {
      voiceNodes[name].filter.frequency.setTargetAtTime(value, ctx.currentTime, 0.05);
    }
  }

  function buildParam(grid, label, min, max, step, value, onChange, refKey) {
    const wrap = document.createElement("div");
    wrap.className = "param";
    wrap.innerHTML = `
      <label>${label}<output>${value}</output></label>
      <input type="range" min="${min}" max="${max}" step="${step}" value="${value}">`;
    const input = wrap.querySelector("input");
    const out = wrap.querySelector("output");
    input.addEventListener("input", () => {
      const next = parseFloat(input.value);
      onChange(next);
      out.textContent = next;
    });
    if (refKey) sliders[refKey] = { input, out };
    grid.appendChild(wrap);
  }

  let canvas = null;
  let canvasCtx = null;

  function drawSwarm() {
    if (canvasCtx) {
      const g = canvasCtx;
      g.fillStyle = "rgba(10, 20, 8, 0.28)";
      g.fillRect(0, 0, WORLD_W, WORLD_H);
      for (let i = 1; i < 4; i++) {
        g.strokeStyle = "rgba(125, 217, 86, 0.12)";
        g.beginPath();
        g.moveTo((WORLD_W / 4) * i, 0);
        g.lineTo((WORLD_W / 4) * i, WORLD_H);
        g.stroke();
      }
      const now = performance.now();
      VOICE_ORDER.forEach((name, idx) => {
        const age = now - recentHits[name];
        g.fillStyle = "rgba(125, 217, 86, 0.5)";
        g.font = "8px monospace";
        g.fillText(VOICE_DEFS[name].label.toUpperCase(), (WORLD_W / 4) * idx + 6, WORLD_H - 6);
        if (age < 140) {
          g.fillStyle = `rgba(212, 160, 76, ${0.3 * (1 - age / 140)})`;
          g.fillRect((WORLD_W / 4) * idx, 0, WORLD_W / 4, WORLD_H);
        }
      });
      const glow = g.createRadialGradient(world.lightX, world.lightY, 0, world.lightX, world.lightY, 55);
      glow.addColorStop(0, "rgba(212, 160, 76, 0.28)");
      glow.addColorStop(1, "rgba(212, 160, 76, 0)");
      g.fillStyle = glow;
      g.fillRect(0, 0, WORLD_W, WORLD_H);
      agents.forEach(agent => {
        if (agent.flash > 0.1) {
          g.fillStyle = `rgba(212, 160, 76, ${agent.flash * 0.35})`;
          g.beginPath();
          g.arc(agent.x, agent.y, 3 + agent.flash * 3, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = world.panic > 0.1 ? "#c44c3a" : "#7dd956";
        g.beginPath();
        g.arc(agent.x, agent.y, 1.5, 0, Math.PI * 2);
        g.fill();
      });
    }
    requestAnimationFrame(drawSwarm);
  }

  function mount(panel) {
    const swarmSection = document.createElement("section");
    swarmSection.className = "synth-section";
    swarmSection.innerHTML = `
      <h2>Mosquito Drums</h2>
      <p class="synth-hint">
        Lo sciame decide quali colpi della griglia si accendono: ogni colonna
        del display è una voce. Clicca sul display per spostare la luce (lo
        sciame la insegue e il groove migra), il ragno scatena un fill.
        Parte con ▶ nella barra in alto.
      </p>
      <canvas id="swarmCanvas" width="${WORLD_W * 2}" height="${WORLD_H * 2}"></canvas>
      <div class="swarm-controls">
        <div class="param-grid" style="flex:1;"></div>
        <div class="param" style="align-items:center;">
          <label>Spider</label>
          <button type="button" class="panic-btn" title="Fill: lo sciame va nel panico">PANIC</button>
        </div>
      </div>`;
    canvas = swarmSection.querySelector("#swarmCanvas");
    canvasCtx = canvas.getContext("2d");
    canvasCtx.setTransform(2, 0, 0, 2, 0, 0);
    canvas.addEventListener("pointerdown", event => {
      const rect = canvas.getBoundingClientRect();
      world.lightX = ((event.clientX - rect.left) / rect.width) * WORLD_W;
      world.lightY = ((event.clientY - rect.top) / rect.height) * WORLD_H;
    });
    swarmSection.querySelector(".panic-btn").addEventListener("click", () => {
      world.panic = 1;
    });
    const swarmGrid = swarmSection.querySelector(".param-grid");
    buildParam(swarmGrid, "Temperature", 0, 1, 0.01, params.swarm.temperature, value => {
      params.swarm.temperature = value;
    }, "swarm.temperature");
    buildParam(swarmGrid, "Hit Density", 0, 1, 0.01, params.swarm.density, value => {
      params.swarm.density = value;
    }, "swarm.density");
    panel.appendChild(swarmSection);

    const voicesSection = document.createElement("section");
    voicesSection.className = "synth-section";
    voicesSection.innerHTML = "<h2>Voci</h2><div class=\"drum-voices\"></div>";
    const voicesGrid = voicesSection.querySelector(".drum-voices");
    VOICE_ORDER.forEach(name => {
      const def = VOICE_DEFS[name];
      const v = params.voices[name];
      const card = document.createElement("article");
      card.className = "drum-voice";
      card.innerHTML = `
        <header>
          <span>${def.label}</span>
          <button type="button" class="dv-mute" aria-pressed="false" title="Mute ${def.label}">M</button>
        </header>`;
      const muteBtn = card.querySelector(".dv-mute");
      muteBtn.addEventListener("click", () => {
        v.mute = !v.mute;
        muteBtn.classList.toggle("active", v.mute);
        muteBtn.setAttribute("aria-pressed", v.mute ? "true" : "false");
      });
      sliders[`${name}.mute`] = { button: muteBtn };
      buildParam(card, "Level", 0, 1, 0.01, v.level,
        value => applyVoiceParam(name, "level", value), `${name}.level`);
      if (def.tune) {
        buildParam(card, "Tune (Hz)", def.tune.min, def.tune.max, 1, v.tune,
          value => applyVoiceParam(name, "tune", value), `${name}.tune`);
      }
      buildParam(card, "Filtro (Hz)", def.filter.min, def.filter.max, 10, v.filter,
        value => applyVoiceParam(name, "filter", value), `${name}.filter`);
      buildParam(card, "Decay (s)", def.decay.min, def.decay.max, 0.01, v.decay,
        value => applyVoiceParam(name, "decay", value), `${name}.decay`);
      voicesGrid.appendChild(card);
    });
    panel.appendChild(voicesSection);

    requestAnimationFrame(drawSwarm);
  }

  function getState() {
    return {
      swarm: { ...params.swarm },
      voices: Object.fromEntries(
        VOICE_ORDER.map(name => [name, { ...params.voices[name] }])
      )
    };
  }

  function applyState(state) {
    if (!state || typeof state !== "object") return false;
    const setSlider = (key, value) => {
      const ref = sliders[key];
      if (ref?.input) {
        ref.input.value = value;
        ref.out.textContent = value;
      }
    };
    if (state.swarm) {
      ["temperature", "density"].forEach(key => {
        const value = parseFloat(state.swarm[key]);
        if (Number.isFinite(value)) {
          params.swarm[key] = Math.min(1, Math.max(0, value));
          setSlider(`swarm.${key}`, params.swarm[key]);
        }
      });
    }
    if (state.voices) {
      VOICE_ORDER.forEach(name => {
        const incoming = state.voices[name];
        if (!incoming) return;
        const def = VOICE_DEFS[name];
        const ranges = {
          level: [0, 1],
          tune: def.tune ? [def.tune.min, def.tune.max] : null,
          filter: [def.filter.min, def.filter.max],
          decay: [def.decay.min, def.decay.max]
        };
        Object.entries(ranges).forEach(([key, range]) => {
          if (!range) return;
          const value = parseFloat(incoming[key]);
          if (Number.isFinite(value)) {
            const clamped = Math.min(range[1], Math.max(range[0], value));
            applyVoiceParam(name, key, clamped);
            setSlider(`${name}.${key}`, clamped);
          }
        });
        if (typeof incoming.mute === "boolean") {
          params.voices[name].mute = incoming.mute;
          const ref = sliders[`${name}.mute`];
          if (ref?.button) {
            ref.button.classList.toggle("active", incoming.mute);
            ref.button.setAttribute("aria-pressed", incoming.mute ? "true" : "false");
          }
        }
      });
    }
    return true;
  }

  // I colpi (voce, tempo audio, velocity) sono osservabili dall'esterno:
  // lo shell li usa per risincronizzare i grani delle slice di Granulone.
  function onHit(fn) {
    hitListeners.add(fn);
    return () => hitListeners.delete(fn);
  }

  return { output, mount, getState, applyState, onHit };
}
