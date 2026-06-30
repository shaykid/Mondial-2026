'use strict';

const Jimp = require('jimp');
const { sanitizeRaw } = require('./sanitize');
const { shuffleSurfaces, mapSurfaces } = require('./shuffle');

/**
 * Apply a raw RGBA operation to a Jimp image in place and return { image, result }.
 * `op(data, width, height)` may mutate `data` and/or return a new buffer in
 * `{ data }`. Returns the op's stats/result object.
 */
function applyToImage(image, op) {
  const { data, width, height } = image.bitmap;
  const result = op(data, width, height);
  if (result && result.data && result.data !== data) {
    image.bitmap.data = result.data;
  }
  return result;
}

async function readImage(input) {
  // input: file path, URL, Buffer, or Jimp image
  if (input && input.bitmap) return input;
  return Jimp.read(input);
}

function applyEncoding(image, output, options) {
  const ext = String(output || '').toLowerCase();
  if ((ext.endsWith('.jpg') || ext.endsWith('.jpeg')) && options.quality) {
    image.quality(options.quality);
  }
  return image;
}

/** Sanitize a Buffer/path/URL -> returns { image, buffer, stats, options }. */
async function sanitizeImage(input, options = {}) {
  const image = (await readImage(input)).clone();
  const result = applyToImage(image, (d, w, h) => sanitizeRaw(d, w, h, options));
  return { image, stats: result.stats, options: result.options, mask: result.mask };
}

/** Sanitize an input file and write the result to `output`. */
async function sanitizeFile(input, output, options = {}) {
  const { image, stats, options: opts } = await sanitizeImage(input, options);
  applyEncoding(image, output, { quality: 90, ...options });
  await image.writeAsync(output);
  return { output, stats, options: opts };
}

/** Sanitize a Buffer and return a Buffer (mime defaults to image/png). */
async function sanitizeBuffer(buffer, options = {}) {
  const { image, stats } = await sanitizeImage(buffer, options);
  const mime = options.mime || Jimp.MIME_PNG;
  if (mime === Jimp.MIME_JPEG && options.quality) image.quality(options.quality);
  const out = await image.getBufferAsync(mime);
  return { buffer: out, stats };
}

/** Shuffle near-uniform surfaces of an input file and write the result. */
async function shuffleFile(input, output, options = {}) {
  const image = (await readImage(input)).clone();
  const stats = applyToImage(image, (d, w, h) => shuffleSurfaces(d, w, h, options));
  applyEncoding(image, output, { quality: 85, ...options });
  await image.writeAsync(output);
  return { output, stats };
}

/** Shuffle surfaces of a Buffer and return a Buffer. */
async function shuffleBuffer(buffer, options = {}) {
  const image = (await readImage(buffer)).clone();
  const stats = applyToImage(image, (d, w, h) => shuffleSurfaces(d, w, h, options));
  const mime = options.mime || Jimp.MIME_PNG;
  if (mime === Jimp.MIME_JPEG && options.quality) image.quality(options.quality);
  const out = await image.getBufferAsync(mime);
  return { buffer: out, stats };
}

/** Paint detected surfaces (default bright red) and write the visualization. */
async function mapFile(input, output, options = {}) {
  const image = (await readImage(input)).clone();
  const stats = applyToImage(image, (d, w, h) => mapSurfaces(d, w, h, options));
  await image.writeAsync(output);
  return { output, stats };
}

module.exports = {
  Jimp,
  readImage,
  sanitizeImage, sanitizeFile, sanitizeBuffer,
  shuffleFile, shuffleBuffer,
  mapFile,
};
