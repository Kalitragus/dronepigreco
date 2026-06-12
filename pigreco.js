const PRIME_GRID = [2, 3, 5, 7, 11, 13, 17, 19];
const PHI = (1 + Math.sqrt(5)) / 2;
const ZETA3 = 1.202056903159594;
const SQRT2 = Math.SQRT2;
const SQRT3 = Math.sqrt(3);
const SQRT5 = Math.sqrt(5);
const TAU = Math.PI * 2;
const PHI2 = PHI * PHI;
const GAMMA = 0.5772156649;
const CATALAN = 0.9159655941;
const ZETA2 = 1.6449340668;

function quantizeToPrimes(freq, baseFreq) {
  if (!baseFreq) return Math.min(440, freq);
  const scaled = (freq / baseFreq) * 10;
  const nearest = PRIME_GRID.reduce((prev, curr) =>
    Math.abs(curr - scaled) < Math.abs(prev - scaled) ? curr : prev
  );
  const quantized = (nearest / 10) * baseFreq;
  return Math.min(440, quantized);
}

window.pigreco = function pigreco(baseFreq = 220, voiceIndex = 0, options = {}) {
  const { usePrimes = false, mode = "PI" } = options;
  const clamped = Math.min(baseFreq, 440);
  const index = voiceIndex || 0;
  let ratio;

  switch (mode) {
    case "E": {
      const scale = 1.05 + index * 0.12;
      ratio = Math.E / (index + scale);
      break;
    }
    case "PHI": {
      ratio = Math.pow(PHI, (index + 1) / 2) / (index + 1);
      break;
    }
    case "ZETA3": {
      ratio = 1 + Math.sin(ZETA3 * (index + 1)) * 0.65 + (index * 0.08);
      break;
    }
    case "SQRT2": {
      ratio = Math.pow(SQRT2, index) / (index + 1.2);
      break;
    }
    case "PHI2": {
      ratio = Math.pow(PHI, index + 1) / (index + 1);
      break;
    }
    case "GAMMA": {
      ratio = 1 + (GAMMA / (index + 1.5));
      break;
    }
    case "SQRT5": {
      ratio = Math.pow(SQRT5, (index + 1) * 0.6) / (index + 1.1);
      break;
    }
    case "CATALAN": {
      ratio = 1 + (CATALAN / (index + 1));
      break;
    }
    case "SQRT3": {
      ratio = Math.pow(SQRT3, (index + 1) * 0.75) / (index + 1.25);
      break;
    }
    case "TAU": {
      ratio = TAU / (index + 1.5);
      break;
    }
    case "ZETA2": {
      ratio = 1 + (ZETA2 / (index + 1.3));
      break;
    }
    case "PI":
    default: {
      ratio = Math.PI / (index + 1);
      break;
    }
  }

  let freq = clamped * ratio;
  if (usePrimes) {
    freq = quantizeToPrimes(freq, clamped);
  }
  return Math.min(440, Math.max(20, freq));
};

window.MathModes = [
  "PI",
  "E",
  "PHI",
  "ZETA3",
  "SQRT2",
  "PHI2",
  "GAMMA",
  "SQRT5",
  "CATALAN",
  "SQRT3",
  "TAU",
  "ZETA2"
];
