# Pipeline di lavoro corrente

Stato del cantiere "fix basso + finestra Visual". Se la sessione si interrompe,
ripartire da qui: ogni voce ha [ ] = da fare, [x] = fatto.

## A. Fix basso (richieste: "non si intona", "gate più lunghi")

- [x] A1. Intonazione: in `bassline.js` → `candidateFreqs()`, i gradi derivati
      da pigreco vanno **snappati al semitono 12-TET rispetto alla fondamentale
      del drone** (come fa il Granulone con Slice Mix al 100%): semi =
      round(12·log2(f/root)), freq = root·2^(semi/12), dedupe. Prime mode
      cambia QUALI semitoni esistono, lo snap resta.
- [x] A2. Gate più lunghi: range Decay 0.05–1.2 (era 0.6), default 0.32,
      release del VCA 0.05→0.12, decay dei 12 preset aumentati (~×1.6,
      Drone Root fino a 1.0).
- [x] A3. Hook `onNote(fn)` nel modulo basso: emette { freq, accent, degree,
      time } a ogni nota (pattern identico a onHit di mosquito_drums.js).

## B. Finestra Visual (tab "Visual" nello Studio)

- [x] B1. Nuovo modulo `visual.js`: createVisual(ctx, deps) → { mount }.
      Tre layer su canvas 2D (mondo fisso ~960×540, rAF, skip se tab nascosto):
      - Forma (drone): curva armonografo con rapporti = pigreco(base,i,mode)/base;
        piDepth = deformazione, morph = copie ruotate, prime = reticolo di punti.
      - Noise (granulone): particelle pilotate dall'RMS di un AnalyserNode
        sul masterGain del granulone; banda alta = scintille.
      - Palette (basso): hue dal grado (onNote), accento = boost saturazione,
        lerp morbido. Sfondo tinto hsl(hue, ~40%, 4%).
      - Impulsi (drum): onHit → kick = anello+zoom, snare = frattura,
        hat = scintille, perc = ripple. Coda eventi con decadimento.
      - Pulsante Fullscreen (canvas.requestFullscreen()).
- [x] B2. Integrazione studio: import in `studio.js`, AnalyserNode (fftSize 256)
      su engine.masterGain del granulone (gli analyser NON alterano il suono),
      drone analyser lazy (getOutput disponibile solo dopo ensureAudio),
      tab "Visual" + panel in `studio.html` + CSS canvas.

## C. Chiusura

- [x] C1. node --check su tutti i file toccati.
- [x] C2. Commit locale (push su GitHub solo su richiesta esplicita).
- [ ] C3. Aggiornare questo file con [x] e poi POTARLO (o eliminarlo) quando
      tutto è verificato funzionante dall'utente.

## Contesto essenziale (per ripartenza a freddo)

- Architettura: studio.js è lo shell (un solo AudioContext: window.SharedAudio
  { ctx, masterBus, limiter, cascadeBus, registerCascadeSend, clock }).
- Moduli nativi: bassline.js e mosquito_drums.js → create*(ctx, deps) →
  { output, mount, getState, applyState, ...hooks }. Stesso pattern per visual.
- Regole anti-glitch: mai audio su requestAnimationFrame; timer fissi +
  lookahead 0.35s; setTargetAtTime ancorato. I visual su rAF vanno bene
  (solo grafica).
- granulone/ è una copia adattata, l'originale in GRANULONE BACKUP è intoccabile.
