(function(global, doc) {
  'use strict';

  var DEFAULTS = Object.freeze({
    bucketBaseUrl: 'https://storage.yandexcloud.net/webar3dtexture/',
    surfacePaletteBaseUrl: 'https://storage.yandexcloud.net/webar3dtexture/palettes/',
    paletteSettingsBaseUrl: 'https://storage.yandexcloud.net/webar3dtexture/palette_settings/',
    adminApiBaseUrl: 'https://d5d1712p9mu7k3aurh9s.laqt4bj7.apigw.yandexcloud.net',
    telemetryEndpoint: ''
  });

  var SW_MESSAGES = Object.freeze({
    skipWaiting: 'SKIP_WAITING',
    getVersion: 'GET_VERSION',
    activated: 'SW_ACTIVATED',
    version: '20260422-f24ec'
  });

  function safeString(value) {
    if (value == null) return '';
    return String(value).trim();
  }

  function trimTrailingSlashes(value, preserveRoot) {
    var s = safeString(value);
    if (!s) return '';
    s = s.replace(/\/+$/g, '');
    if (!s && preserveRoot) return '/';
    return s;
  }

  function ensureTrailingSlash(value) {
    var s = safeString(value);
    if (!s) return '';
    return trimTrailingSlashes(s) + '/';
  }

  function isAbsoluteUrl(value) {
    return /^(https?:)?\/\//i.test(safeString(value));
  }

  function isSpecialUrl(value) {
    return /^(data:|blob:)/i.test(safeString(value));
  }

  function normalizeBaseUrl(url) {
    var u = new URL(url, global.location.href);
    var s = u.toString();
    return s.replace(/\/+$/, '') + '/';
  }

  function deriveBaseUrlFromLocation() {
    var u = new URL(global.location.href);
    var path = u.pathname || '/';

    if (/\/admin(?:\/index\.html?)?$/i.test(path)) {
      path = path.replace(/\/admin(?:\/index\.html?)?$/i, '/');
    } else if (!path.endsWith('/')) {
      path = path.replace(/\/[^/]*$/, '/');
    }

    if (!path) path = '/';
    return new URL(path, u.origin).toString();
  }

  function detectSiteBaseUrl() {
    try {
      if (doc && doc.currentScript && doc.currentScript.src) {
        return normalizeBaseUrl(new URL('../', doc.currentScript.src).toString());
      }
    } catch (_) {}

    try {
      var scripts = doc && doc.scripts ? Array.prototype.slice.call(doc.scripts) : [];
      for (var i = scripts.length - 1; i >= 0; i -= 1) {
        var src = scripts[i] && scripts[i].src ? String(scripts[i].src) : '';
        if (!src) continue;
        if (/\/js\/runtime-config\.js(?:\?|$)/i.test(src) || /\/js\/site-env\.js(?:\?|$)/i.test(src)) {
          return normalizeBaseUrl(new URL('../', src).toString());
        }
      }
    } catch (_) {}

    return normalizeBaseUrl(deriveBaseUrlFromLocation());
  }

  function resolveSiteUrl(value, siteBaseUrl) {
    if (value == null || value === '') return value;
    var s = String(value);
    if (isAbsoluteUrl(s) || isSpecialUrl(s)) return s;
    return new URL(s.replace(/^\/+/, ''), siteBaseUrl || detectSiteBaseUrl()).toString();
  }

  function resolveRuntimeBaseUrl(globalKeys, fallbackUrl) {
    for (var i = 0; i < globalKeys.length; i += 1) {
      var key = globalKeys[i];
      if (!key) continue;
      var value = trimTrailingSlashes(global[key]);
      if (value) return value + '/';
    }
    return ensureTrailingSlash(fallbackUrl || '');
  }

  function getLocationHostname() {
    try {
      return safeString(global.location && global.location.hostname).toLowerCase();
    } catch (_) {
      return '';
    }
  }

  function isPrivateIpv4Hostname(hostname) {
    if (!hostname || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
    var parts = hostname.split('.').map(function(part) { return parseInt(part, 10) || 0; });
    return parts[0] === 10 ||
      (parts[0] === 127) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31);
  }

  function isDevSiteContext() {
    try {
      if (global.location && global.location.protocol === 'file:') return true;
    } catch (_) {}
    var hostname = getLocationHostname();
    if (!hostname) return false;
    return hostname === 'localhost' || hostname === '::1' || hostname === '[::1]' ||
      hostname.endsWith('.local') || hostname.endsWith('.test') || hostname.endsWith('.localhost') ||
      isPrivateIpv4Hostname(hostname);
  }

  function normalizeAdminApiCandidate(value) {
    var s = trimTrailingSlashes(value);
    if (!s) return '';
    try {
      var u = new URL(s, global.location.href);
      if (!/^https?:$/i.test(u.protocol)) return '';
      return trimTrailingSlashes(u.toString());
    } catch (_) {
      return '';
    }
  }

  function resolveAdminApiOverrideWhitelist() {
    var defaults = [trimTrailingSlashes(DEFAULTS.adminApiBaseUrl)];
    var fromGlobal = [];
    try {
      if (Array.isArray(global.__ADMIN_API_OVERRIDE_WHITELIST__)) {
        fromGlobal = global.__ADMIN_API_OVERRIDE_WHITELIST__;
      }
    } catch (_) {}
    var merged = defaults.concat(fromGlobal || []);
    var normalized = [];
    for (var i = 0; i < merged.length; i += 1) {
      var item = normalizeAdminApiCandidate(merged[i]);
      if (item && normalized.indexOf(item) === -1) normalized.push(item);
    }
    return normalized;
  }

  function isAllowedAdminApiOverride(candidate) {
    var normalized = normalizeAdminApiCandidate(candidate);
    if (!normalized) return false;
    if (isDevSiteContext()) return true;
    var whitelist = resolveAdminApiOverrideWhitelist();
    return whitelist.indexOf(normalized) !== -1;
  }

  function resolveAdminApiBaseUrl() {
    var LS_KEY = 'admin_api_base_url';

    try {
      var u = new URL(global.location.href);
      var qp = normalizeAdminApiCandidate(u.searchParams.get('api'));
      if (qp) {
        if (isAllowedAdminApiOverride(qp)) {
          try { global.localStorage.setItem(LS_KEY, qp); } catch (_) {}
          return qp;
        }
        try { global.localStorage.removeItem(LS_KEY); } catch (_) {}
        try { console.warn('[runtime-config] Ignored non-whitelisted admin API override:', qp); } catch (_) {}
      }
    } catch (_) {}

    try {
      var saved = normalizeAdminApiCandidate(global.localStorage.getItem(LS_KEY));
      if (saved) {
        if (isAllowedAdminApiOverride(saved)) return saved;
        try { global.localStorage.removeItem(LS_KEY); } catch (_) {}
        try { console.warn('[runtime-config] Cleared non-whitelisted stored admin API override:', saved); } catch (_) {}
      }
    } catch (_) {}

    var existing = trimTrailingSlashes(global.API_BASE_URL || global.__API_BASE_URL__ || '');
    if (existing) return existing;
    return trimTrailingSlashes(DEFAULTS.adminApiBaseUrl);
  }

  var siteBaseUrl = detectSiteBaseUrl();
  var siteBasePath = '/';
  try {
    siteBasePath = new URL(siteBaseUrl).pathname || '/';
  } catch (_) {}
  if (!siteBasePath.endsWith('/')) siteBasePath += '/';

  var config = Object.freeze({
    version: '20260422-f24ec',
    site: Object.freeze({
      siteBaseUrl: siteBaseUrl,
      siteBasePath: siteBasePath,
      resolveSiteUrl: function(value) { return resolveSiteUrl(value, siteBaseUrl); },
      isAbsoluteUrl: isAbsoluteUrl,
      isSpecialUrl: isSpecialUrl
    }),
    sw: Object.freeze({
      version: '20260422-f24ec',
      scriptFilename: 'sw.js',
      messages: SW_MESSAGES
    }),
    defaults: DEFAULTS,
    resolveSurfacePaletteBaseUrl: function() {
      return resolveRuntimeBaseUrl(['__SURFACE_PALETTE_BASE_URL__'], DEFAULTS.surfacePaletteBaseUrl);
    },
    resolvePaletteSettingsBaseUrl: function() {
      return resolveRuntimeBaseUrl(['__PALETTE_SETTINGS_BASE_URL__'], DEFAULTS.paletteSettingsBaseUrl);
    },
    resolvePublicApiBaseUrl: function() {
      return trimTrailingSlashes(global.__API_BASE_URL__ || '') ? trimTrailingSlashes(global.__API_BASE_URL__) + '/' : '';
    },
    resolveTelemetryEndpoint: function() {
      var direct = safeString(global.__TELEMETRY_ENDPOINT__ || DEFAULTS.telemetryEndpoint).trim();
      if (direct) return direct;
      var base = trimTrailingSlashes(resolveAdminApiBaseUrl());
      return base ? (base + '/api/telemetry') : '';
    },
    resolveAdminApiBaseUrl: resolveAdminApiBaseUrl
  });

  global.__RUNTIME_CONFIG__ = config;
})(typeof self !== 'undefined' ? self : window, typeof document !== 'undefined' ? document : null);
