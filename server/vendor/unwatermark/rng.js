'use strict';

/**
 * mulberry32 — small, fast, seedable PRNG.
 * @param {number} [seed] integer seed. Same seed -> same stream (reproducible).
 * @returns {() => number} function returning floats in [0, 1).
 */
function makeRng(seed) {
  let a = (seed === undefined || seed === null ? 0x12345678 : (seed >>> 0)) || 0x9e3779b9;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clampByte = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

module.exports = { makeRng, clampByte };
