'use strict';

/**
 * unwatermark — disrupt hidden patterns (watermarks / steganography) in images
 * while keeping them visually identical, plus a surface-shuffle utility.
 *
 * Two layers:
 *   - raw cores operate on an RGBA Buffer (no I/O, bring your own decoder)
 *   - file/buffer helpers use jimp to decode/encode for you
 */

const rng = require('./rng');
const sanitize = require('./sanitize');
const shuffle = require('./shuffle');
const io = require('./io');

module.exports = {
  // ---- high-level (jimp-backed) ----
  sanitizeFile: io.sanitizeFile,
  sanitizeBuffer: io.sanitizeBuffer,
  sanitizeImage: io.sanitizeImage,
  shuffleFile: io.shuffleFile,
  shuffleBuffer: io.shuffleBuffer,
  mapFile: io.mapFile,
  readImage: io.readImage,
  Jimp: io.Jimp,

  // ---- raw cores (RGBA Buffer in place / returned) ----
  sanitizeRaw: sanitize.sanitizeRaw,
  shuffleSurfaces: shuffle.shuffleSurfaces,
  mapSurfaces: shuffle.mapSurfaces,
  eachSurface: shuffle.eachSurface,
  flatnessMask: sanitize.flatnessMask,

  // ---- utilities / defaults ----
  makeRng: rng.makeRng,
  resolveSanitizeOptions: sanitize.resolveOptions,
  SANITIZE_DEFAULTS: sanitize.SANITIZE_DEFAULTS,
  SHUFFLE_DEFAULTS: shuffle.SHUFFLE_DEFAULTS,
};
