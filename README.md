# Drone Machine π + Granulone — Studio

Uno studio sonoro che gira interamente nel browser, senza dipendenze e senza installazioni: un **synth drone** guidato dalle costanti matematiche (π, e, φ, ζ, √2, τ…) incatenato a un **campionatore granulare**. Il drone genera materiale infinito, il granulare lo frantuma.

Created by **Giovanni Barbieri**.

## Avvio rapido

1. Scarica il progetto: pulsante verde **Code → Download ZIP** su GitHub (oppure `git clone`).
2. Estrai la cartella.
3. Avvia lo Studio:

| Sistema | Come |
|---|---|
| **Mac** | Doppio clic su **`Avvia Studio.command`**. La prima volta macOS può bloccarlo: tasto destro → **Apri** → Apri. Se manca `python3`, macOS propone da solo l'installazione dei Command Line Tools. |
| **Windows** | Doppio clic su **`Avvia Studio Windows.bat`**. Richiede [Python](https://www.python.org/downloads/) (va bene anche quello del Microsoft Store). |
| **Qualsiasi sistema** | Da terminale, nella cartella del progetto: `python3 -m http.server 8765`, poi apri `http://localhost:8765/studio.html` |

Il server è **solo locale**: gira sul tuo computer e non espone nulla su internet.

> Solo drone, senza server: `index.html` si apre anche con un semplice doppio clic.

## Le pagine

- **`studio.html`** — lo Studio completo: Drone π + Granulone con motore audio unico (richiede il server locale)
- **`index.html`** — il solo Drone π, standalone
- **`granulone/index.html`** — il solo Granulone, standalone

## Cosa c'è dentro

**Drone π** — 4 voci i cui rapporti di frequenza derivano da 12 costanti matematiche; quantizzazione sui numeri primi; 13 preset factory (uno per costante); modalità Evolve (drift generativo lento); tastiera da computer (icona piano per attivarla); preset salvabili ed esportabili in file.

**Granulone** — campionatore granulare a slice: pointer, spray, random pitch, overlap, delay e reverb per slice; finestre d'inviluppo Hann/triangolare/gaussiana/rettangolare; quantizzazione del pitch verso una scala.

**Lo Studio (la catena)** —
- **Un solo AudioContext** condiviso, bus master e limiter unici
- **Cascata**: registra il drone e lo riversa nel Granulone come campione da granulare, con slider per dosare quanta cascata di suono riversare
- **Quantizzazione comune**: il drone è il master tonale; con Prime Quantization attiva forza la quantizzazione del Granulone, altrimenti il Granulone segue automaticamente la nota del drone
- **Preset studio**: esporta/importa lo stato di entrambi i synth in un unico file JSON
- **Tutorial** al primo avvio (ripetibile con il pulsante «?»)

## Tecnologia

JavaScript puro + Web Audio API. Nessuna dipendenza, nessun build step, nessun dato lascia il tuo computer.

## Struttura

```
studio.html / studio.js     → shell dello Studio (tab, cascata, sync, tour)
index.html                  → Drone π standalone
drone.js                    → motore del drone (voci, routing, stato)
pigreco.js                  → le formule delle costanti matematiche
pi_fx.js / pi_reverb.js     → effetti modulati matematicamente
smart.js                    → preset factory/utente + modalità Evolve
granulone/                  → il campionatore granulare (moduli ES)
ALGORITHMS.md               → note sugli algoritmi
```
