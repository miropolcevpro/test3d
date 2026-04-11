(function(global) {
  'use strict';

  function safeDecode(value) {
    try { return decodeURIComponent(value); } catch (_) { return value; }
  }

  function asCleanString(value) {
    if (value == null) return '';
    var s = (typeof value === 'number' && isFinite(value)) ? String(value) : String(value || '');
    return s.trim();
  }

  function canonicalEntityId(value, fallback) {
    var s = safeDecode(asCleanString(value));
    if (!s) return asCleanString(fallback);
    s = s.replace(/[\\/]+/g, '_');
    s = s.replace(/\s+/g, ' ').trim();
    return s || asCleanString(fallback);
  }

  function canonicalShapeId(value, fallback) {
    var s = canonicalEntityId(value, fallback).toLowerCase();
    s = s.replace(/\s+/g, '-');
    return s.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  }

  function stripShapePrefix(shapeId, value) {
    var s = canonicalEntityId(value);
    var sid = canonicalShapeId(shapeId);
    if (!s || !sid) return s;
    for (var i = 0; i < 4; i += 1) {
      var next = s;
      if (next.toLowerCase().indexOf(sid.toLowerCase() + ':') === 0) next = next.slice(sid.length + 1).trim();
      else if (next.toLowerCase().indexOf(sid.toLowerCase() + '_') === 0) next = next.slice(sid.length + 1).trim();
      else if (next.toLowerCase().indexOf(sid.toLowerCase() + '-') === 0) next = next.slice(sid.length + 1).trim();
      if (next === s) break;
      s = next;
    }
    return s;
  }

  function canonicalTextureBareId(shapeId, value, fallback) {
    var s = stripShapePrefix(shapeId, value);
    if (!s) s = canonicalEntityId(fallback);
    s = s.replace(/^pack[:_\-]+/i, '');
    s = s.replace(/[\\/]+/g, '_');
    s = s.replace(/\s+/g, '_');
    s = s.replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    return s;
  }

  function canonicalTextureId(shapeId, value, fallback) {
    var bare = canonicalTextureBareId(shapeId, value, fallback);
    if (!bare) return '';
    var sid = canonicalShapeId(shapeId);
    return sid ? (sid + ':' + bare) : bare;
  }

  function canonicalStorageTextureId(shapeId, value, fallback) {
    var bare = canonicalTextureBareId(shapeId, value, fallback);
    return bare.replace(/:/g, '_');
  }

  function comparableTextureKey(shapeId, value, fallback) {
    var bare = canonicalTextureBareId(shapeId, value, fallback).toLowerCase();
    return bare.replace(/[^a-z0-9_\-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
  }

  function normalizeContentPath(value, fallback) {
    var s = asCleanString(value);
    if (!s) return asCleanString(fallback);
    if (/^(https?:\/\/|data:|blob:)/i.test(s)) return s;
    s = safeDecode(s);
    s = s.replace(/\\+/g, '/');
    s = s.replace(/^\.\/+/, '');
    s = s.replace(/\/+/g, '/');
    s = s.replace(/(^|\/)\.\//g, '$1');
    s = s.replace(/^\/(assets|surfaces|palettes|palette_settings|admin)\//i, '$1/');
    return s;
  }

  function buildSurfaceAssetPath(shapeId, textureId, quality, fileName) {
    var sid = canonicalShapeId(shapeId);
    var tid = canonicalStorageTextureId(shapeId, textureId);
    var q = asCleanString(quality || '1k');
    var file = normalizeContentPath(fileName);
    if (!sid || !tid || !file) return '';
    return 'surfaces/' + sid + '/' + tid + '/' + q + '/' + file.replace(/^\/+/, '');
  }

  global.__CONTENT_IDENTITY__ = Object.freeze({
    canonicalEntityId: canonicalEntityId,
    canonicalShapeId: canonicalShapeId,
    stripShapePrefix: stripShapePrefix,
    canonicalTextureBareId: canonicalTextureBareId,
    canonicalTextureId: canonicalTextureId,
    canonicalStorageTextureId: canonicalStorageTextureId,
    comparableTextureKey: comparableTextureKey,
    normalizeContentPath: normalizeContentPath,
    buildSurfaceAssetPath: buildSurfaceAssetPath
  });
})(window);
