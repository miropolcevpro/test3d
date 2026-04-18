(function (global) {
  'use strict';

  var runtimeConfig = global.__RUNTIME_CONFIG__ || null;
  var STORAGE_HISTORY_KEY = 'webar_telemetry_history_v1';
  var STORAGE_PENDING_KEY = 'webar_telemetry_pending_v1';
  var STORAGE_SESSION_KEY = 'webar_telemetry_session_v1';
  var STORAGE_VISITOR_KEY = 'webar_telemetry_visitor_v1';
  var MAX_HISTORY = 600;
  var MAX_PENDING = 250;
  var MAX_BATCH = 40;
  var FLUSH_DEBOUNCE_MS = 1800;
  var AUTO_FLUSH_INTERVAL_MS = 12000;
  var endpointDisabledForSession = false;
  var flushTimer = 0;
  var pageViewSent = false;
  var errorDedupe = Object.create(null);
  var flushIntervalStarted = false;
  var lastFlushAttemptAt = 0;
  var lastFlushSuccessAt = 0;
  var lastFlushFailedAt = 0;
  var lastFlushResult = '';

  function nowIso() {
    try { return new Date().toISOString(); } catch (_) { return ''; }
  }

  function safeString(value) {
    if (value == null) return '';
    try { return String(value); } catch (_) { return ''; }
  }

  function clampArray(arr, maxItems) {
    if (!Array.isArray(arr)) return [];
    if (arr.length <= maxItems) return arr;
    return arr.slice(arr.length - maxItems);
  }

  function safeJsonParse(value, fallback) {
    if (!value) return fallback;
    try { return JSON.parse(value); } catch (_) { return fallback; }
  }

  function readStorage(key, fallback) {
    try {
      return safeJsonParse(global.localStorage.getItem(key), fallback);
    } catch (_) {
      return fallback;
    }
  }

  function writeStorage(key, value) {
    try {
      global.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      return false;
    }
  }

  function buildSessionId() {
    return 'sess_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
  }

  function buildVisitorId() {
    return 'vis_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
  }

  function getVisitorId() {
    try {
      var existing = global.localStorage.getItem(STORAGE_VISITOR_KEY);
      if (existing) return existing;
      var next = buildVisitorId();
      global.localStorage.setItem(STORAGE_VISITOR_KEY, next);
      return next;
    } catch (_) {
      return buildVisitorId();
    }
  }

  function getSessionId() {
    try {
      var existing = global.sessionStorage.getItem(STORAGE_SESSION_KEY);
      if (existing) return existing;
      var next = buildSessionId();
      global.sessionStorage.setItem(STORAGE_SESSION_KEY, next);
      return next;
    } catch (_) {
      return buildSessionId();
    }
  }

  function pickEndpoint() {
    try {
      if (global.__TELEMETRY_ENDPOINT__) return safeString(global.__TELEMETRY_ENDPOINT__).trim();
      if (runtimeConfig && typeof runtimeConfig.resolveTelemetryEndpoint === 'function') {
        return safeString(runtimeConfig.resolveTelemetryEndpoint()).trim();
      }
      if (runtimeConfig && typeof runtimeConfig.resolveAdminApiBaseUrl === 'function') {
        var base = safeString(runtimeConfig.resolveAdminApiBaseUrl()).trim().replace(/\/+$/, '');
        if (base) return base + '/api/telemetry';
      }
    } catch (_) {}
    return '';
  }

  function getPagePath() {
    try {
      return safeString(global.location && global.location.pathname) || '/';
    } catch (_) {
      return '/';
    }
  }

  function getQuery() {
    try {
      return safeString(global.location && global.location.search) || '';
    } catch (_) {
      return '';
    }
  }

  function getBuildVersion() {
    try {
      if (runtimeConfig && runtimeConfig.version) return safeString(runtimeConfig.version);
    } catch (_) {}
    return '';
  }

  function detectDeviceType() {
    try {
      var ua = safeString(global.navigator && global.navigator.userAgent).toLowerCase();
      var width = 0;
      try { width = Math.max(global.innerWidth || 0, (global.screen && global.screen.width) || 0); } catch (_) { width = 0; }
      var isTabletUa = /ipad|tablet|playbook|silk|(android(?!.*mobile))/i.test(ua);
      var isMobileUa = /iphone|ipod|android.*mobile|windows phone|blackberry|opera mini|mobile/i.test(ua);
      if (isTabletUa || (width >= 768 && width <= 1200 && ('ontouchstart' in global))) return 'tablet';
      if (isMobileUa || (width > 0 && width < 768)) return 'mobile';
      if (width >= 1200 || (!('ontouchstart' in global) && width >= 768)) return 'desktop';
    } catch (_) {}
    return 'unknown';
  }

  function detectOs() {
    var ua = safeString(global.navigator && global.navigator.userAgent).toLowerCase();
    if (/android/.test(ua)) return 'android';
    if (/iphone|ipad|ipod/.test(ua)) return 'ios';
    if (/mac os/.test(ua)) return 'macos';
    if (/windows/.test(ua)) return 'windows';
    if (/linux/.test(ua)) return 'linux';
    return 'unknown';
  }

  function detectBrowser() {
    var ua = safeString(global.navigator && global.navigator.userAgent).toLowerCase();
    if (/edg\//.test(ua)) return 'edge';
    if (/opr\//.test(ua) || /opera/.test(ua)) return 'opera';
    if (/chrome\//.test(ua) && !/edg\//.test(ua) && !/opr\//.test(ua)) return 'chrome';
    if (/safari\//.test(ua) && !/chrome\//.test(ua)) return 'safari';
    if (/firefox\//.test(ua)) return 'firefox';
    return 'unknown';
  }

  function detectViewportBucket() {
    try {
      var width = Math.max(global.innerWidth || 0, (global.screen && global.screen.width) || 0);
      if (width < 480) return 'xs';
      if (width < 768) return 'sm';
      if (width < 1024) return 'md';
      if (width < 1440) return 'lg';
      return 'xl';
    } catch (_) {
      return 'unknown';
    }
  }

  function buildBaseContext() {
    return {
      deviceType: detectDeviceType(),
      os: detectOs(),
      browser: detectBrowser(),
      viewportBucket: detectViewportBucket()
    };
  }

  function normalizeDaysParam(value) {
    var days = Number(value || 7) || 7;
    if (days < 1) days = 1;
    if (days > 365) days = 365;
    return days;
  }

  function normalizeDeviceFilter(value) {
    var key = safeString(value || 'all').toLowerCase();
    if (key === 'mobile' || key === 'tablet' || key === 'desktop' || key === 'unknown') return key;
    return 'all';
  }

  function filterHistoryRecords(history, params) {
    var records = Array.isArray(history) ? history.slice() : [];
    var options = params || {};
    var days = normalizeDaysParam(options.days);
    var deviceType = normalizeDeviceFilter(options.deviceType);
    var cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    return records.filter(function (item) {
      if (!item || !item.name) return false;
      var ts = Number(item.ts || 0) || 0;
      if (ts && ts < cutoff) return false;
      if (deviceType !== 'all') {
        var props = item.props || {};
        var itemDevice = getProp(props, ['deviceType']) || 'unknown';
        if (itemDevice !== deviceType) return false;
      }
      return true;
    });
  }

  function sanitizeProps(input, depth) {
    depth = Number(depth || 0);
    if (depth > 3) return '[depth-limit]';
    if (input == null) return input;
    var t = typeof input;
    if (t === 'string' || t === 'number' || t === 'boolean') return input;
    if (Array.isArray(input)) {
      return input.slice(0, 12).map(function (item) { return sanitizeProps(item, depth + 1); });
    }
    if (t === 'object') {
      var out = {};
      Object.keys(input).slice(0, 24).forEach(function (key) {
        if (!key) return;
        out[key] = sanitizeProps(input[key], depth + 1);
      });
      return out;
    }
    return safeString(input);
  }

  function buildRecord(kind, name, props) {
    return {
      id: kind + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8),
      kind: kind,
      name: safeString(name || 'unknown'),
      ts: Date.now(),
      iso: nowIso(),
      sessionId: getSessionId(),
      visitorId: getVisitorId(),
      path: getPagePath(),
      query: getQuery(),
      version: getBuildVersion(),
      props: sanitizeProps(Object.assign({}, buildBaseContext(), { visitorId: getVisitorId(), deviceId: getVisitorId() }, props || {}), 0)
    };
  }

  function appendRecord(record) {
    var history = readStorage(STORAGE_HISTORY_KEY, []);
    history.push(record);
    history = clampArray(history, MAX_HISTORY);
    writeStorage(STORAGE_HISTORY_KEY, history);

    var pending = readStorage(STORAGE_PENDING_KEY, []);
    pending.push(record);
    pending = clampArray(pending, MAX_PENDING);
    writeStorage(STORAGE_PENDING_KEY, pending);
  }

  function removePendingByIds(ids) {
    if (!Array.isArray(ids) || !ids.length) return;
    var set = {};
    ids.forEach(function (id) { set[id] = true; });
    var pending = readStorage(STORAGE_PENDING_KEY, []);
    pending = pending.filter(function (item) {
      return !(item && item.id && set[item.id]);
    });
    writeStorage(STORAGE_PENDING_KEY, pending);
  }

  function scheduleFlush(delayMs) {
    if (endpointDisabledForSession) return;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = 0;
    }
    flushTimer = global.setTimeout(function () {
      flushTimer = 0;
      flush();
    }, Math.max(0, Number(delayMs || FLUSH_DEBOUNCE_MS) || FLUSH_DEBOUNCE_MS));
  }

  function isPriorityEventName(name) {
    var key = safeString(name || '');
    return key === 'ar_launch_click' ||
      key === 'quick_ar_launch' ||
      key === 'ar_session_start_requested' ||
      key === 'ar_session_started' ||
      key === 'ar_first_point' ||
      key === 'ar_visualization_ready' ||
      key === 'texture_select' ||
      key === 'cta_manager_call' ||
      key === 'cta_site_click';
  }

  function startAutoFlushTimer() {
    if (flushIntervalStarted || !global.setInterval) return;
    flushIntervalStarted = true;
    global.setInterval(function () {
      try {
        var pending = readStorage(STORAGE_PENDING_KEY, []);
        if (Array.isArray(pending) && pending.length) flush();
      } catch (_) {}
    }, AUTO_FLUSH_INTERVAL_MS);
  }


  function isSameOriginEndpoint(endpoint) {
    if (!endpoint) return false;
    try {
      var url = new URL(endpoint, global.location && global.location.href ? global.location.href : undefined);
      if (!global.location || !global.location.origin) return false;
      return url.origin === global.location.origin;
    } catch (_) {
      return false;
    }
  }

  function flush() {
    lastFlushAttemptAt = Date.now();
    var endpoint = pickEndpoint();
    if (!endpoint || endpointDisabledForSession) return Promise.resolve(false);
    if (global.navigator && global.navigator.onLine === false) return Promise.resolve(false);
    var pending = readStorage(STORAGE_PENDING_KEY, []);
    if (!pending.length) return Promise.resolve(false);
    var batch = pending.slice(0, MAX_BATCH);
    var ids = batch.map(function (item) { return item && item.id ? item.id : ''; }).filter(Boolean);
    var payload = {
      ok: true,
      source: 'webar-client',
      version: getBuildVersion(),
      sessionId: getSessionId(),
      sentAt: nowIso(),
      events: batch
    };
    var body = JSON.stringify(payload);
    if (isSameOriginEndpoint(endpoint) && global.navigator && typeof global.navigator.sendBeacon === 'function') {
      try {
        var blob = new Blob([body], { type: 'application/json' });
        var sent = global.navigator.sendBeacon(endpoint, blob);
        if (sent) {
          removePendingByIds(ids);
          lastFlushSuccessAt = Date.now();
          lastFlushResult = 'beacon';
          return Promise.resolve(true);
        }
      } catch (_) {}
    }
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
      keepalive: true,
      credentials: 'omit',
      cache: 'no-store'
    }).then(function (res) {
      if (res && res.ok) {
        removePendingByIds(ids);
        lastFlushSuccessAt = Date.now();
        lastFlushResult = 'ok';
        return true;
      }
      if (res && (res.status === 404 || res.status === 405 || res.status === 501)) {
        endpointDisabledForSession = true;
      }
      lastFlushFailedAt = Date.now();
      lastFlushResult = res ? ('http_' + res.status) : 'http_error';
      return false;
    }).catch(function () {
      lastFlushFailedAt = Date.now();
      lastFlushResult = 'network_error';
      return false;
    });
  }

  function track(name, props) {
    var record = buildRecord('event', name, props);
    appendRecord(record);
    if (isPriorityEventName(name)) scheduleFlush(120);
    else scheduleFlush();
    return record;
  }

  function trackError(name, err, props) {
    var message = '';
    var stack = '';
    if (err && typeof err === 'object') {
      message = safeString(err.message || err.name || err.toString());
      stack = safeString(err.stack || '');
    } else {
      message = safeString(err || '');
    }
    var dedupeKey = safeString(name) + '|' + message;
    var now = Date.now();
    if (errorDedupe[dedupeKey] && now - errorDedupe[dedupeKey] < 3000) return null;
    errorDedupe[dedupeKey] = now;
    var mergedProps = Object.assign({}, sanitizeProps(props || {}, 0), {
      message: message,
      stack: stack ? stack.split('\n').slice(0, 6).join('\n') : ''
    });
    var record = buildRecord('error', name, mergedProps);
    appendRecord(record);
    scheduleFlush(120);
    return record;
  }

  function trackPageView(name, props) {
    var pageName = safeString(name || getPagePath() || 'page');
    if (!pageViewSent) {
      pageViewSent = true;
      return track('page_view', Object.assign({ page: pageName }, props || {}));
    }
    return track('screen_view', Object.assign({ page: pageName }, props || {}));
  }

  function getRecent(limit, params) {
    var history = filterHistoryRecords(readStorage(STORAGE_HISTORY_KEY, []), params || {});
    var max = Math.max(1, Number(limit || 100) || 100);
    return history.slice(Math.max(0, history.length - max));
  }

  function getSummary(params) {
    var history = filterHistoryRecords(readStorage(STORAGE_HISTORY_KEY, []), params || {});
    var pendingItems = readStorage(STORAGE_PENDING_KEY, []);
    var summary = {
      total: history.length,
      events: 0,
      errors: 0,
      byName: {},
      endpoint: pickEndpoint(),
      pending: pendingItems.length,
      sessionId: getSessionId(),
      visitorId: getVisitorId(),
      version: getBuildVersion(),
      latestLocalEventAt: history.length ? safeString(history[history.length - 1].iso || '') : '',
      latestPendingEventAt: pendingItems.length ? safeString(pendingItems[pendingItems.length - 1].iso || '') : ''
    };
    history.forEach(function (item) {
      if (!item || !item.name) return;
      if (item.kind === 'error') summary.errors += 1;
      else summary.events += 1;
      summary.byName[item.name] = (summary.byName[item.name] || 0) + 1;
    });
    return summary;
  }


  function getProp(obj, keys) {
    if (!obj || typeof obj !== 'object') return '';
    for (var i = 0; i < keys.length; i += 1) {
      var value = obj[keys[i]];
      if (value != null && value !== '') return safeString(value);
    }
    return '';
  }

  function incCounter(map, key, value) {
    if (!key) return;
    map[key] = (map[key] || 0) + (Number(value || 1) || 1);
  }

  function getVisitorKey(item) {
    if (!item) return '';
    return safeString(item.visitorId || getProp(item.props || {}, ['visitorId', 'deviceId']) || item.sessionId) || '';
  }

  function bucketKeyFromTs(ts, mode) {
    var d = new Date(Number(ts || Date.now()));
    if (!Number.isFinite(d.getTime())) d = new Date();
    var yyyy = String(d.getUTCFullYear());
    var mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    if (mode === 'month') return yyyy + '-' + mm;
    if (mode === 'quarter') return yyyy + '-Q' + (Math.floor(d.getUTCMonth() / 3) + 1);
    if (mode === 'year') return yyyy;
    return d.toISOString().slice(0, 10);
  }

  function pushSeries(store, mode, item, sessionId, visitorId, isError) {
    var key = bucketKeyFromTs(item && item.ts, mode);
    if (!store[key]) store[key] = { key: key, events: 0, errors: 0, sessions: {}, visitors: {} };
    store[key].events += 1;
    if (isError) store[key].errors += 1;
    if (sessionId) store[key].sessions[sessionId] = true;
    if (visitorId) store[key].visitors[visitorId] = true;
  }

  function buildSeries(store) {
    return Object.keys(store).sort().map(function (key) {
      var item = store[key] || {};
      return {
        key: key,
        label: key,
        events: Number(item.events || 0),
        errors: Number(item.errors || 0),
        sessions: setSize(item.sessions),
        uniqueVisitors: setSize(item.visitors)
      };
    });
  }

  function ratio(num, den) {
    var n = Number(num || 0);
    var d = Number(den || 0);
    if (!d || !Number.isFinite(n) || !Number.isFinite(d)) return 0;
    return n / d;
  }

  function setAdd(bag, key, value) {
    if (!key || !value) return;
    if (!bag[key]) bag[key] = {};
    bag[key][value] = true;
  }

  function setSize(obj) {
    if (!obj || typeof obj !== 'object') return 0;
    return Object.keys(obj).length;
  }

  function extractShapeInfo(props) {
    var shapeId = getProp(props, ['shapeId', 'selectedShapeId', 'targetShapeId']);
    var shapeName = getProp(props, ['shapeName', 'selectedShapeName', 'targetShapeName']);
    return { id: shapeId, name: shapeName };
  }

  function extractTextureInfo(props) {
    var tileId = getProp(props, ['tileId', 'selectedTileId', 'textureId', 'itemId']);
    var tileName = getProp(props, ['tileName', 'selectedTileName', 'textureName', 'itemName']);
    return { id: tileId, name: tileName };
  }

  function sortTopEntries(entries, limit) {
    return entries.sort(function (a, b) {
      return (Number(b.sessions || 0) - Number(a.sessions || 0)) || (Number(b.count || 0) - Number(a.count || 0)) || String(a.name || a.id || '').localeCompare(String(b.name || b.id || ''));
    }).slice(0, Math.max(1, Number(limit || 5) || 5));
  }

  function buildDeviceResult(deviceMap) {
    return Object.keys(deviceMap).map(function (key) {
      var entry = deviceMap[key];
      var sessions = Object.keys(entry.sessions || {}).length;
      var arLaunchSessions = Object.keys(entry.arLaunchSessions || {}).length;
      var arStartedSessions = Object.keys(entry.arStartedSessions || {}).length;
      var arCompletedSessions = Object.keys(entry.arCompletedSessions || {}).length;
      return {
        deviceType: key,
        sessions: sessions,
        arLaunchSessions: arLaunchSessions,
        arStartedSessions: arStartedSessions,
        arCompletedSessions: arCompletedSessions,
        errors: Number(entry.errors || 0),
        arCompletionRate: ratio(arCompletedSessions, arLaunchSessions),
        errorRatePerSession: ratio(Number(entry.errors || 0), sessions),
        share: ratio(sessions, Object.keys(deviceMap.__allSessions || {}).length),
        shareLabel: ''
      };
    }).filter(function (item) { return item.sessions > 0; }).sort(function (a, b) {
      return Number(b.sessions || 0) - Number(a.sessions || 0);
    });
  }

  function computeDashboardSummaryFromHistory(history) {
    var records = Array.isArray(history) ? history : [];
    var metrics = {
      arLaunches: 0,
      arStarted: 0,
      firstPoints: 0,
      contoursClosed: 0,
      arCompleted: 0,
      textureChanges: 0,
      managerCtaClicks: 0,
      siteCtaClicks: 0,
      snapshotUses: 0,
      shapePickerUses: 0,
      rotationUses: 0,
      adminCalibrationUsage: 0,
      adminCalibrationSaves: 0,
      errors: 0,
      sessions: 0,
      uniqueVisitors: 0,
      returningVisitors: 0,
      repeatVisits: 0,
      avgSessionsPerVisitor: 0
    };
    var allSessions = {};
    var allVisitors = {};
    var visitorSessions = {};
    var sessionsWithErrors = {};
    var seriesDay = {};
    var seriesMonth = {};
    var seriesQuarter = {};
    var seriesYear = {};
    var arLaunchSessions = {};
    var arStartedSessions = {};
    var firstPointSessions = {};
    var contourClosedSessions = {};
    var arCompletedSessions = {};
    var textureInteractionSessions = {};
    var managerCtaSessions = {};
    var adminCalibrationSessions = {};
    var adminSessions = {};
    var shapes = {};
    var textures = {};
    var devices = { __allSessions: allSessions };

    function ensureDevice(deviceType) {
      var key = deviceType || 'unknown';
      if (!devices[key]) devices[key] = { sessions: {}, arLaunchSessions: {}, arStartedSessions: {}, arCompletedSessions: {}, errors: 0 };
      return devices[key];
    }

    records.forEach(function (item) {
      if (!item || !item.name) return;
      var name = safeString(item.name);
      var props = item.props || {};
      var sid = safeString(item.sessionId || '');
      var visitorId = getVisitorKey(item);
      var deviceType = getProp(props, ['deviceType']) || 'unknown';
      var deviceEntry = ensureDevice(deviceType);
      if (sid) { allSessions[sid] = true; deviceEntry.sessions[sid] = true; }
      if (visitorId) {
        allVisitors[visitorId] = true;
        if (!visitorSessions[visitorId]) visitorSessions[visitorId] = {};
        if (sid) visitorSessions[visitorId][sid] = true;
      }
      pushSeries(seriesDay, 'day', item, sid, visitorId, item.kind === 'error');
      pushSeries(seriesMonth, 'month', item, sid, visitorId, item.kind === 'error');
      pushSeries(seriesQuarter, 'quarter', item, sid, visitorId, item.kind === 'error');
      pushSeries(seriesYear, 'year', item, sid, visitorId, item.kind === 'error');
      if (item.kind === 'error') {
        metrics.errors += 1;
        deviceEntry.errors += 1;
        if (sid) sessionsWithErrors[sid] = true;
      }
      if (String(item.path || '').indexOf('/admin') !== -1 || name.indexOf('admin_') === 0) {
        if (sid) adminSessions[sid] = true;
      }

      if (name === 'ar_launch_click' || name === 'ar_session_start_requested') {
        metrics.arLaunches += 1;
        if (sid) { arLaunchSessions[sid] = true; deviceEntry.arLaunchSessions[sid] = true; }
      }
      if (name === 'ar_session_started') {
        metrics.arStarted += 1;
        if (sid) { arStartedSessions[sid] = true; deviceEntry.arStartedSessions[sid] = true; }
      }
      if (name === 'ar_first_point') {
        metrics.firstPoints += 1;
        if (sid) firstPointSessions[sid] = true;
      }
      if (name === 'ar_contour_closed') {
        metrics.contoursClosed += 1;
        if (sid) contourClosedSessions[sid] = true;
      }
      if (name === 'ar_visualization_ready') {
        metrics.arCompleted += 1;
        if (sid) { arCompletedSessions[sid] = true; deviceEntry.arCompletedSessions[sid] = true; }
      }
      if (name === 'texture_select') {
        metrics.textureChanges += 1;
        if (sid) textureInteractionSessions[sid] = true;
      }
      if (name === 'cta_manager_call') {
        metrics.managerCtaClicks += 1;
        if (sid) managerCtaSessions[sid] = true;
      }
      if (name === 'cta_site_click') metrics.siteCtaClicks += 1;
      if (name === 'ar_snapshot_click' || name === 'ar_snapshot_exported') metrics.snapshotUses += 1;
      if (name === 'ar_shape_picker_toggle' || name === 'ar_shape_picker_select') metrics.shapePickerUses += 1;
      if (name === 'ar_rotation_step' || name === 'ar_rotation_reset') metrics.rotationUses += 1;
      if (name === 'admin_ar_calibration_open' || (name === 'admin_ar_calibration_toggle' && !!props.open)) {
        metrics.adminCalibrationUsage += 1;
        if (sid) adminCalibrationSessions[sid] = true;
      }
      if (name === 'admin_ar_calibration_saved') metrics.adminCalibrationSaves += 1;

      var shouldCountShape = (name === 'form_change' || name === 'texture_select' || name === 'ar_visualization_ready' || name === 'ar_shape_picker_select' || name === 'page_view' || name === 'screen_view' || name === 'cta_manager_call');
      var shouldCountTexture = (name === 'texture_select' || name === 'ar_visualization_ready' || name === 'admin_ar_calibration_saved' || name === 'cta_manager_call');
      if (shouldCountShape) {
        var shape = extractShapeInfo(props);
        if (shape.id) {
          if (!shapes[shape.id]) shapes[shape.id] = { id: shape.id, name: shape.name || shape.id, count: 0, sessions: {} };
          shapes[shape.id].count += 1;
          if (shape.name) shapes[shape.id].name = shape.name;
          if (sid) shapes[shape.id].sessions[sid] = true;
        }
      }
      if (shouldCountTexture) {
        var texture = extractTextureInfo(props);
        if (texture.id) {
          if (!textures[texture.id]) textures[texture.id] = { id: texture.id, name: texture.name || texture.id, count: 0, sessions: {} };
          textures[texture.id].count += 1;
          if (texture.name) textures[texture.id].name = texture.name;
          if (sid) textures[texture.id].sessions[sid] = true;
        }
      }
    });

    metrics.sessions = Object.keys(allSessions).length;
    metrics.uniqueVisitors = Object.keys(allVisitors).length;
    Object.keys(visitorSessions).forEach(function (visitorId) {
      var count = setSize(visitorSessions[visitorId]);
      if (count > 1) {
        metrics.returningVisitors += 1;
        metrics.repeatVisits += (count - 1);
      }
    });
    metrics.avgSessionsPerVisitor = ratio(metrics.sessions, metrics.uniqueVisitors || 0);

    var topShapes = sortTopEntries(Object.keys(shapes).map(function (id) {
      return { id: id, name: shapes[id].name || id, count: shapes[id].count || 0, sessions: setSize(shapes[id].sessions) };
    }), 5);
    var topTextures = sortTopEntries(Object.keys(textures).map(function (id) {
      return { id: id, name: textures[id].name || id, count: textures[id].count || 0, sessions: setSize(textures[id].sessions) };
    }), 5);
    var deviceSegments = buildDeviceResult(devices).map(function (item) {
      item.shareLabel = formatPercentText(ratio(item.sessions, metrics.sessions));
      return item;
    });

    return {
      metrics: metrics,
      audience: {
        uniqueVisitors: metrics.uniqueVisitors,
        sessions: metrics.sessions,
        returningVisitors: metrics.returningVisitors,
        repeatVisits: metrics.repeatVisits,
        avgSessionsPerVisitor: metrics.avgSessionsPerVisitor,
        repeatVisitorRate: ratio(metrics.returningVisitors, metrics.uniqueVisitors),
        repeatSessionShare: ratio(metrics.repeatVisits, metrics.sessions)
      },
      sessionMetrics: {
        sessions: metrics.sessions,
        uniqueVisitors: metrics.uniqueVisitors,
        returningVisitors: metrics.returningVisitors,
        repeatVisits: metrics.repeatVisits,
        sessionsWithErrors: Object.keys(sessionsWithErrors).length,
        arLaunchSessions: Object.keys(arLaunchSessions).length,
        arStartedSessions: Object.keys(arStartedSessions).length,
        firstPointSessions: Object.keys(firstPointSessions).length,
        contourClosedSessions: Object.keys(contourClosedSessions).length,
        arCompletedSessions: Object.keys(arCompletedSessions).length,
        textureInteractionSessions: Object.keys(textureInteractionSessions).length,
        managerCtaSessions: Object.keys(managerCtaSessions).length,
        adminCalibrationSessions: Object.keys(adminCalibrationSessions).length,
        adminSessions: Object.keys(adminSessions).length
      },
      topShapes: topShapes,
      topTextures: topTextures,
      deviceSegments: deviceSegments,
      timeSeries: {
        byDay: buildSeries(seriesDay),
        byMonth: buildSeries(seriesMonth),
        byQuarter: buildSeries(seriesQuarter),
        byYear: buildSeries(seriesYear)
      },
      funnel: {
        steps: [
          { key: 'launch', label: 'Клик по запуску AR', sessions: Object.keys(arLaunchSessions).length, conversionFromLaunch: 1, conversionFromPrev: 1 },
          { key: 'started', label: 'Успешный вход в AR', sessions: Object.keys(arStartedSessions).length, conversionFromLaunch: ratio(Object.keys(arStartedSessions).length, Object.keys(arLaunchSessions).length), conversionFromPrev: ratio(Object.keys(arStartedSessions).length, Object.keys(arLaunchSessions).length) },
          { key: 'firstPoint', label: 'Поставили первую точку', sessions: Object.keys(firstPointSessions).length, conversionFromLaunch: ratio(Object.keys(firstPointSessions).length, Object.keys(arLaunchSessions).length), conversionFromPrev: ratio(Object.keys(firstPointSessions).length, Object.keys(arStartedSessions).length) },
          { key: 'contourClosed', label: 'Замкнули контур', sessions: Object.keys(contourClosedSessions).length, conversionFromLaunch: ratio(Object.keys(contourClosedSessions).length, Object.keys(arLaunchSessions).length), conversionFromPrev: ratio(Object.keys(contourClosedSessions).length, Object.keys(firstPointSessions).length) },
          { key: 'completed', label: 'Дошли до заливки', sessions: Object.keys(arCompletedSessions).length, conversionFromLaunch: ratio(Object.keys(arCompletedSessions).length, Object.keys(arLaunchSessions).length), conversionFromPrev: ratio(Object.keys(arCompletedSessions).length, Object.keys(contourClosedSessions).length) }
        ]
      },
      kpis: {
        arStartRate: ratio(Object.keys(arStartedSessions).length, Object.keys(arLaunchSessions).length),
        arCompletionRate: ratio(Object.keys(arCompletedSessions).length, Object.keys(arLaunchSessions).length),
        textureInteractionRate: ratio(Object.keys(textureInteractionSessions).length, Object.keys(arCompletedSessions).length),
        ctaClickRate: ratio(Object.keys(managerCtaSessions).length, metrics.sessions),
        adminCalibrationUsage: ratio(Object.keys(adminCalibrationSessions).length, Object.keys(adminSessions).length || metrics.sessions),
        errorRatePerSession: ratio(metrics.errors, metrics.sessions),
        errorSessionRate: ratio(Object.keys(sessionsWithErrors).length, metrics.sessions),
        arContourCompletionRate: ratio(Object.keys(contourClosedSessions).length, Object.keys(arStartedSessions).length)
      }
    };
  }

  function formatPercentText(value) {
    var n = Number(value || 0);
    if (!Number.isFinite(n)) return '0%';
    return (n * 100).toFixed(0) + '%';
  }


  function buildRemoteUrl(mode, params) {
    var endpoint = pickEndpoint();
    if (!endpoint) return '';
    try {
      var url = new URL(endpoint, global.location.href);
      if (mode) url.searchParams.set('mode', String(mode));
      var data = params || {};
      Object.keys(data).forEach(function (key) {
        var value = data[key];
        if (value == null || value === '') return;
        url.searchParams.set(key, String(value));
      });
      return url.toString();
    } catch (_) {
      return '';
    }
  }

  function fetchRemoteJson(url) {
    if (!url) return Promise.resolve(null);
    return fetch(url, {
      method: 'GET',
      cache: 'no-store',
      credentials: 'omit',
      headers: { 'Accept': 'application/json' }
    }).then(function (res) {
      if (!res || !res.ok) return null;
      return res.json().catch(function () { return null; });
    }).catch(function () {
      return null;
    });
  }

  function getRemoteSummary(params) {
    return fetchRemoteJson(buildRemoteUrl('summary', params || {}));
  }

  function getRemoteHealth() {
    return fetchRemoteJson(buildRemoteUrl('health', {}));
  }

  function getSyncStatus() {
    var history = readStorage(STORAGE_HISTORY_KEY, []);
    var pending = readStorage(STORAGE_PENDING_KEY, []);
    var latestLocalEventAt = history.length ? safeString(history[history.length - 1].iso || '') : '';
    var latestPendingEventAt = pending.length ? safeString(pending[pending.length - 1].iso || '') : '';
    return {
      endpoint: pickEndpoint(),
      pending: pending.length,
      totalLocal: history.length,
      latestLocalEventAt: latestLocalEventAt,
      latestPendingEventAt: latestPendingEventAt,
      hasUnsyncedQueue: pending.length > 0,
      lastFlushAttemptAt: lastFlushAttemptAt ? new Date(lastFlushAttemptAt).toISOString() : '',
      lastFlushSuccessAt: lastFlushSuccessAt ? new Date(lastFlushSuccessAt).toISOString() : '',
      lastFlushFailedAt: lastFlushFailedAt ? new Date(lastFlushFailedAt).toISOString() : '',
      lastFlushResult: lastFlushResult || '',
      endpointDisabledForSession: !!endpointDisabledForSession
    };
  }

  function clearAll() {
    try { global.localStorage.removeItem(STORAGE_HISTORY_KEY); } catch (_) {}
    try { global.localStorage.removeItem(STORAGE_PENDING_KEY); } catch (_) {}
  }

  function exportJson() {
    return {
      exportedAt: nowIso(),
      summary: getSummary(),
      history: readStorage(STORAGE_HISTORY_KEY, []),
      pending: readStorage(STORAGE_PENDING_KEY, [])
    };
  }

  function bindGlobalErrorHooks() {
    if (bindGlobalErrorHooks.__bound) return;
    bindGlobalErrorHooks.__bound = true;
    startAutoFlushTimer();
    global.addEventListener('error', function (event) {
      try {
        var err = event && event.error ? event.error : null;
        trackError('window_error', err || (event && event.message) || 'window_error', {
          filename: event && event.filename ? safeString(event.filename) : '',
          lineno: event && event.lineno ? event.lineno : 0,
          colno: event && event.colno ? event.colno : 0
        });
      } catch (_) {}
    });
    global.addEventListener('unhandledrejection', function (event) {
      try {
        var reason = event && Object.prototype.hasOwnProperty.call(event, 'reason') ? event.reason : 'unhandledrejection';
        trackError('unhandled_rejection', reason, {});
      } catch (_) {}
    });
    global.addEventListener('online', function () { scheduleFlush(250); });
    global.addEventListener('visibilitychange', function () {
      if (document && document.visibilityState === 'hidden') flush();
    });
    global.addEventListener('pagehide', function () { flush(); });
    global.addEventListener('beforeunload', function () { flush(); });
    global.addEventListener('blur', function () { scheduleFlush(120); });
  }

  bindGlobalErrorHooks();

  var api = {
    track: track,
    trackError: trackError,
    trackPageView: trackPageView,
    flush: flush,
    getRecent: getRecent,
    getSummary: getSummary,
    getDashboardSummary: function (params) { return computeDashboardSummaryFromHistory(filterHistoryRecords(readStorage(STORAGE_HISTORY_KEY, []), params || {})); },
    getRemoteSummary: getRemoteSummary,
    getRemoteHealth: getRemoteHealth,
    getSyncStatus: getSyncStatus,
    clearAll: clearAll,
    exportJson: exportJson,
    getSessionId: getSessionId,
    getVisitorId: getVisitorId,
    getEndpoint: pickEndpoint
  };

  global.__APP_TELEMETRY__ = api;
})(typeof window !== 'undefined' ? window : self);
