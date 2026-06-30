'use strict';

const { makeRng } = require('./rng');

const DEFAULTS = {
  threshold: 3,     // per-channel color-grade tolerance defining one surface
  min: 8,           // ignore surfaces smaller than this many pixels
  seed: undefined,  // undefined -> random each run
  connectivity: 8,  // 4 or 8 neighbour flood fill
  alpha: false,     // include alpha channel in matching & shuffle
};

function neighbours(connectivity) {
  return connectivity === 4
    ? [[1, 0], [-1, 0], [0, 1], [0, -1]]
    : [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
}

/**
 * Walk the image as connected "surfaces" of near-uniform color and invoke
 * `onRegion(indices, count)` for each surface with >= min pixels. Shared by the
 * shuffle and map operations. Mutates nothing.
 * @returns {{regions:number}} total surfaces found (any size)
 */
function eachSurface(data, width, height, opts, onRegion) {
  const o = { ...DEFAULTS, ...opts };
  const N = width * height;
  const visited = new Uint8Array(N);
  const t = o.threshold;
  const useAlpha = o.alpha;
  const neigh = neighbours(o.connectivity);
  const stack = new Int32Array(N);
  const region = new Int32Array(N);
  let regions = 0;

  const within = (i, sr, sg, sb, sa) => {
    const p = i << 2;
    if (Math.abs(data[p] - sr) > t) return false;
    if (Math.abs(data[p + 1] - sg) > t) return false;
    if (Math.abs(data[p + 2] - sb) > t) return false;
    if (useAlpha && Math.abs(data[p + 3] - sa) > t) return false;
    return true;
  };

  for (let start = 0; start < N; start++) {
    if (visited[start]) continue;
    const so = start << 2;
    const sr = data[so], sg = data[so + 1], sb = data[so + 2], sa = data[so + 3];
    let sp = 0, rc = 0;
    stack[sp++] = start;
    visited[start] = 1;
    while (sp > 0) {
      const p = stack[--sp];
      region[rc++] = p;
      const x = p % width;
      const y = (p - x) / width;
      for (let k = 0; k < neigh.length; k++) {
        const nx = x + neigh[k][0];
        const ny = y + neigh[k][1];
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const np = ny * width + nx;
        if (visited[np] || !within(np, sr, sg, sb, sa)) continue;
        visited[np] = 1;
        stack[sp++] = np;
      }
    }
    regions++;
    if (rc >= o.min) onRegion(region, rc);
  }
  return { regions };
}

/**
 * Shuffle pixels within each near-uniform surface, in place on an RGBA buffer.
 * Only permutes colors that already exist per surface, so the result is visually
 * identical but the per-pixel data is scrambled.
 * @returns {{regions, shuffledRegions, shuffledPixels}}
 */
function shuffleSurfaces(data, width, height, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const rng = makeRng(o.seed);
  let shuffledRegions = 0, shuffledPixels = 0;
  const { regions } = eachSurface(data, width, height, o, (region, rc) => {
    for (let i = rc - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      if (j === i) continue;
      const a = region[i] << 2, b = region[j] << 2;
      let tmp;
      tmp = data[a]; data[a] = data[b]; data[b] = tmp;
      tmp = data[a + 1]; data[a + 1] = data[b + 1]; data[b + 1] = tmp;
      tmp = data[a + 2]; data[a + 2] = data[b + 2]; data[b + 2] = tmp;
      tmp = data[a + 3]; data[a + 3] = data[b + 3]; data[b + 3] = tmp;
    }
    shuffledRegions++;
    shuffledPixels += rc;
  });
  return { regions, shuffledRegions, shuffledPixels };
}

/**
 * Paint every qualifying surface with a solid color (default bright red) in
 * place — a visualization of which areas the shuffle/sanitize would target.
 * @returns {{regions, mappedRegions, mappedPixels}}
 */
function mapSurfaces(data, width, height, opts = {}) {
  const o = { ...DEFAULTS, ...opts };
  const color = o.color || [255, 0, 0, 255];
  let mappedRegions = 0, mappedPixels = 0;
  const { regions } = eachSurface(data, width, height, o, (region, rc) => {
    for (let i = 0; i < rc; i++) {
      const p = region[i] << 2;
      data[p] = color[0]; data[p + 1] = color[1];
      data[p + 2] = color[2]; data[p + 3] = color[3] === undefined ? 255 : color[3];
    }
    mappedRegions++;
    mappedPixels += rc;
  });
  return { regions, mappedRegions, mappedPixels };
}

module.exports = { shuffleSurfaces, mapSurfaces, eachSurface, SHUFFLE_DEFAULTS: DEFAULTS };
