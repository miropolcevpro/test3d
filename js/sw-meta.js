(function(global) {
  'use strict';
  var runtime = global.__RUNTIME_CONFIG__ || null;
  var meta = runtime && runtime.sw ? runtime.sw : Object.freeze({
    version: 'dev',
    scriptFilename: 'sw.js',
    messages: Object.freeze({
      skipWaiting: 'SKIP_WAITING',
      getVersion: 'GET_VERSION',
      activated: 'SW_ACTIVATED',
      version: 'SW_VERSION'
    })
  });
  global.__SW_META__ = Object.freeze(meta);
})(typeof self !== 'undefined' ? self : window);
