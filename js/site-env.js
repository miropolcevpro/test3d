(function(global) {
  'use strict';
  var runtime = global.__RUNTIME_CONFIG__ || null;
  var site = runtime && runtime.site ? runtime.site : Object.freeze({
    siteBaseUrl: (function() {
      try { return new URL('./', global.location.href).toString(); } catch (_) { return '/'; }
    })(),
    siteBasePath: (function() {
      try { return new URL('./', global.location.href).pathname || '/'; } catch (_) { return '/'; }
    })(),
    resolveSiteUrl: function(value) {
      if (value == null || value === '') return value;
      try { return new URL(String(value).replace(/^\/+/, ''), global.location.href).toString(); } catch (_) { return value; }
    },
    isAbsoluteUrl: function(value) { return /^(https?:)?\/\//i.test(String(value || '')); },
    isSpecialUrl: function(value) { return /^(data:|blob:)/i.test(String(value || '')); }
  });
  global.__SITE_ENV__ = Object.freeze(site);
})(window);
