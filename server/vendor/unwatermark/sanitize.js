'use strict';

const { makeRng, clampByte } = require('./rng');

const DEFAULTS = {
  warp: 0,           // sub-pixel random warp, max px (desync registered templates)
  smooth: 0.7,       // flat-area mean-blend strength 0..1
  smoothRadius: 2,   // window radius (2 = 5x5)
  smoothTol: 10,     // bilateral color tolerance
  noise: 2.5,        // texture-masked dither amplitude (levels)
  lsb: 1,            // randomize lowest K bit-planes
  clamp: 6,          // hard cap |out-orig| <= G per channel
  flatk: 6,          // flatness sensitivity
  seed: 1,           // PRNG seed
};

/**
 * Resolve user options. With `auto` (or when no disruption method is set) the
 * conservative default recipe is filled in.
 */
function resolveOptions(opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const explicit = opts.warp || opts.smooth || opts.noise || opts.lsb;
  if (opts.auto || !explicit) {
    if (!opts.smooth) o.smooth = DEFAULTS.smooth;
    if (!opts.noise) o.noise = DEFAULTS.noise;
    if (!opts.lsb) o.lsb = DEFAULTS.lsb;
    // warp stays as given (0 unless explicitly requested) — most faithful.
  }
  return o;
}

/**
 * Per-pixel flatness mask in [0,1] (1 = perfectly flat) from local luminance
 * variance, computed with integral images. O(N).
 */
function flatnessMask(data, W, H, radius = 2, k = 6) {
  const N = W * H;
  const lum = new Float64Array(N);
  for (let i = 0, p = 0; i < N; i++, p += 4) {
    lum[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  const SW = W + 1;
  const I1 = new Float64Array(SW * (H + 1));
  const I2 = new Float64Array(SW * (H + 1));
  for (let y = 0; y < H; y++) {
    let r1 = 0, r2 = 0;
    for (let x = 0; x < W; x++) {
      const v = lum[y * W + x];
      r1 += v; r2 += v * v;
      const a = (y + 1) * SW + (x + 1);
      I1[a] = I1[y * SW + (x + 1)] + r1;
      I2[a] = I2[y * SW + (x + 1)] + r2;
    }
  }
  const sum = (I, x1, y1, x2, y2) =>
    I[(y2 + 1) * SW + (x2 + 1)] - I[y1 * SW + (x2 + 1)] - I[(y2 + 1) * SW + x1] + I[y1 * SW + x1];

  const mask = new Float32Array(N);
  const k2 = k * k;
  for (let y = 0; y < H; y++) {
    const y1 = Math.max(0, y - radius), y2 = Math.min(H - 1, y + radius);
    for (let x = 0; x < W; x++) {
      const x1 = Math.max(0, x - radius), x2 = Math.min(W - 1, x + radius);
      const area = (x2 - x1 + 1) * (y2 - y1 + 1);
      const s = sum(I1, x1, y1, x2, y2);
      const s2 = sum(I2, x1, y1, x2, y2);
      let varr = s2 / area - (s / area) * (s / area);
      if (varr < 0) varr = 0;
      mask[y * W + x] = k2 / (k2 + varr);
    }
  }
  return mask;
}

/**
 * Disrupt hidden patterns (LSB, flat-block micro-deviations, spread-spectrum,
 * registered templates) while preserving appearance. Returns a NEW RGBA buffer
 * (the input `data` is not mutated) plus fidelity stats.
 *
 * @returns {{data:Buffer, mask:Float32Array, options:object,
 *            stats:{meanAbs:number, psnr:number, lsbFlippedPct:number}}}
 */
function sanitizeRaw(data, W, H, opts = {}) {
  const o = resolveOptions(opts);
  const N = W * H;
  const orig = Buffer.from(data);
  const rng = makeRng(o.seed);

  // ----- 1. sub-pixel warp (optional) -----
  let cur = Buffer.from(data);
  if (o.warp > 0) {
    const warped = Buffer.alloc(data.length);
    const ph = Array.from({ length: 8 }, () => rng() * Math.PI * 2);
    const dispAt = (x, y, base) => {
      const u = x / W, v = y / H;
      return o.warp * (
        Math.sin(6.283 * (1.7 * u) + ph[base]) +
        Math.sin(6.283 * (2.3 * v) + ph[base + 1]) +
        Math.sin(6.283 * (1.1 * u + 1.9 * v) + ph[base + 2]) +
        Math.sin(6.283 * (2.9 * v - 1.3 * u) + ph[base + 3])
      ) / 4;
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const sx = Math.min(W - 1, Math.max(0, x + dispAt(x, y, 0)));
        const sy = Math.min(H - 1, Math.max(0, y + dispAt(x, y, 4)));
        const x0 = Math.floor(sx), y0 = Math.floor(sy);
        const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
        const fx = sx - x0, fy = sy - y0;
        const o00 = (y0 * W + x0) << 2, o10 = (y0 * W + x1) << 2;
        const o01 = (y1 * W + x0) << 2, o11 = (y1 * W + x1) << 2;
        const d = (y * W + x) << 2;
        for (let c = 0; c < 4; c++) {
          const top = cur[o00 + c] * (1 - fx) + cur[o10 + c] * fx;
          const bot = cur[o01 + c] * (1 - fx) + cur[o11 + c] * fx;
          warped[d + c] = Math.round(top * (1 - fy) + bot * fy);
        }
      }
    }
    cur = warped;
  }

  const mask = flatnessMask(cur, W, H, o.smoothRadius, o.flatk);
  const out = Buffer.from(cur);

  // ----- 2. edge-preserving smoothing in FLAT areas -----
  if (o.smooth > 0) {
    const r = o.smoothRadius, tol = o.smoothTol;
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const idx = y * W + x;
        const wf = mask[idx];
        if (wf < 0.05) continue;
        const c = idx << 2;
        const cr = cur[c], cg = cur[c + 1], cb = cur[c + 2];
        let ar = 0, ag = 0, ab = 0, n = 0;
        for (let dy = -r; dy <= r; dy++) {
          const ny = y + dy; if (ny < 0 || ny >= H) continue;
          for (let dx = -r; dx <= r; dx++) {
            const nx = x + dx; if (nx < 0 || nx >= W) continue;
            const nc = (ny * W + nx) << 2;
            if (Math.abs(cur[nc] - cr) > tol) continue;
            if (Math.abs(cur[nc + 1] - cg) > tol) continue;
            if (Math.abs(cur[nc + 2] - cb) > tol) continue;
            ar += cur[nc]; ag += cur[nc + 1]; ab += cur[nc + 2]; n++;
          }
        }
        if (n === 0) continue;
        const blend = o.smooth * wf;
        out[c] = Math.round(cr + blend * (ar / n - cr));
        out[c + 1] = Math.round(cg + blend * (ag / n - cg));
        out[c + 2] = Math.round(cb + blend * (ab / n - cb));
      }
    }
  }

  // ----- 3. texture-masked dither noise -----
  if (o.noise > 0) {
    for (let i = 0, c = 0; i < N; i++, c += 4) {
      const amp = o.noise * (1 - mask[i]);
      if (amp <= 0) continue;
      for (let ch = 0; ch < 3; ch++) {
        out[c + ch] = clampByte(out[c + ch] + Math.round((rng() * 2 - 1) * amp));
      }
    }
  }

  // ----- 4. randomize lowest K bit-planes everywhere -----
  if (o.lsb > 0) {
    const k = Math.min(8, Math.max(1, Math.round(o.lsb)));
    const mhi = 0xff & (~((1 << k) - 1));
    const span = 1 << k;
    for (let i = 0, c = 0; i < N; i++, c += 4) {
      for (let ch = 0; ch < 3; ch++) {
        out[c + ch] = (out[c + ch] & mhi) | ((rng() * span) | 0);
      }
    }
  }

  // ----- 5. hard clamp to +/-G of the ORIGINAL -----
  let lsbFlipped = 0, sumAbs = 0, sumSq = 0;
  const G = o.clamp;
  for (let i = 0, c = 0; i < N; i++, c += 4) {
    for (let ch = 0; ch < 3; ch++) {
      const oc = orig[c + ch];
      let v = out[c + ch];
      if (v > oc + G) v = oc + G;
      else if (v < oc - G) v = oc - G;
      v = clampByte(v);
      out[c + ch] = v;
      const d = v - oc;
      sumAbs += d < 0 ? -d : d; sumSq += d * d;
      if (((v ^ oc) & 1) !== 0) lsbFlipped++;
    }
    out[c + 3] = orig[c + 3];
  }

  const npx = N * 3;
  return {
    data: out,
    mask,
    options: o,
    stats: {
      meanAbs: sumAbs / npx,
      psnr: sumSq === 0 ? Infinity : 10 * Math.log10((255 * 255) / (sumSq / npx)),
      lsbFlippedPct: (lsbFlipped / npx) * 100,
    },
  };
}

module.exports = { sanitizeRaw, flatnessMask, resolveOptions, SANITIZE_DEFAULTS: DEFAULTS };
