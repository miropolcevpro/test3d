'use strict';

const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const crypto = require('crypto');
const https = require('https');

const REGION = process.env.TELEMETRY_S3_REGION || process.env.S3_REGION || 'ru-central1';
const ENDPOINT = process.env.TELEMETRY_S3_ENDPOINT || process.env.S3_ENDPOINT || 'https://storage.yandexcloud.net';
const BUCKET = process.env.TELEMETRY_S3_BUCKET || process.env.S3_BUCKET || '';
const PREFIX = String(process.env.TELEMETRY_PREFIX || 'telemetry')
  .replace(/^\/+/, '')
  .replace(/\/+$/, '');
const MAX_EVENTS_PER_POST = Number(process.env.TELEMETRY_MAX_EVENTS || 50);
const MAX_DAYS = Number(process.env.TELEMETRY_MAX_DAYS || 365);
const MAX_OBJECTS_PER_DAY = Number(process.env.TELEMETRY_MAX_OBJECTS_PER_DAY || 250);
const SUMMARY_DEFAULT_OBJECTS_PER_DAY = Number(process.env.TELEMETRY_SUMMARY_DEFAULT_OBJECTS_PER_DAY || 80);
const SUMMARY_MAX_OBJECTS_PER_DAY = Math.max(1, Math.min(MAX_OBJECTS_PER_DAY, Number(process.env.TELEMETRY_SUMMARY_MAX_OBJECTS_PER_DAY || 120) || 120));
const SUMMARY_MAX_BATCHES_TOTAL = Math.max(1, Number(process.env.TELEMETRY_SUMMARY_MAX_BATCHES_TOTAL || 240) || 240);
const SUMMARY_TIME_BUDGET_MS = Math.max(1000, Number(process.env.TELEMETRY_SUMMARY_TIME_BUDGET_MS || 8500) || 8500);
const MAX_RECENT_ERRORS = Number(process.env.TELEMETRY_MAX_RECENT_ERRORS || 25);
const MAX_ERROR_ITEMS = Number(process.env.TELEMETRY_MAX_ERROR_ITEMS || 2000);
const MAX_CLEAR_OBJECTS_PER_DAY = Number(process.env.TELEMETRY_MAX_CLEAR_OBJECTS_PER_DAY || 120);
const RELEASE_VERSION = '20260510-f24eg';
const TELEGRAM_BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || '').trim();
const TELEGRAM_CHAT_ID = String(process.env.TELEGRAM_CHAT_ID || '').trim();
const TELEGRAM_MESSAGE_LIMIT = 3900;

const ERROR_SEVERITY_ORDER = ['critical', 'medium', 'low', 'diagnostic'];
const ERROR_CATEGORY_ORDER = ['ar_session', 'textures_materials', 'palette_content', 'snapshot_export', 'analytics_backend', 'admin_save', 'ui_flow', 'runtime_js'];
const ERROR_RULES = {
  app_init_failed: { severity: 'critical', category: 'ui_flow' },
  quick_ar_launch_failed: { severity: 'critical', category: 'ar_session' },
  ar_session_start_failed: { severity: 'critical', category: 'ar_session' },
  tiles_load_failed: { severity: 'critical', category: 'palette_content' },
  shapes_load_failed: { severity: 'critical', category: 'palette_content' },
  palette_load_failed: { severity: 'critical', category: 'palette_content' },
  palette_parse_failed: { severity: 'critical', category: 'palette_content' },
  texture_map_load_failed: { severity: 'critical', category: 'textures_materials' },
  admin_api_error: { severity: 'critical', category: 'admin_save' },
  admin_ar_calibration_save_failed: { severity: 'critical', category: 'admin_save' },
  window_error: { severity: 'critical', category: 'runtime_js' },
  unhandled_rejection: { severity: 'critical', category: 'runtime_js' },
  ar_texture_rail_build_failed: { severity: 'medium', category: 'textures_materials' },
  ar_texture_rail_refresh_failed: { severity: 'medium', category: 'textures_materials' },
  ar_texture_rail_shape_switch_failed: { severity: 'medium', category: 'textures_materials' },
  ar_shape_switch_failed: { severity: 'medium', category: 'ui_flow' },
  ar_shape_picker_build_failed: { severity: 'medium', category: 'ui_flow' },
  detail_open_failed: { severity: 'medium', category: 'ui_flow' },
  quick_ar_rail_build_failed: { severity: 'medium', category: 'ui_flow' },
  ar_snapshot_request_failed: { severity: 'medium', category: 'snapshot_export' },
  ar_snapshot_builtin_failed: { severity: 'medium', category: 'snapshot_export' },
  gallery_asset_missing: { severity: 'low', category: 'palette_content' },
  admin_login_failed: { severity: 'medium', category: 'admin_save' },
  admin_telemetry_flush_failed: { severity: 'medium', category: 'analytics_backend' },
  admin_login_config_missing: { severity: 'critical', category: 'admin_save' },
  ar_texture_group_skipped: { severity: 'diagnostic', category: 'textures_materials' }
};
const ERROR_COMPACT_PROP_KEYS = [
  'message', 'reason', 'error', 'stack', 'deviceType', 'shapeId', 'selectedShapeId', 'targetShapeId',
  'tileId', 'selectedTileId', 'textureId', 'itemId', 'filename', 'lineno', 'colno', 'endpoint', 'url',
  'code', 'status', 'phase', 'flow', 'source', 'origin', 'path'
];

const s3 = new S3Client({
  region: REGION,
  endpoint: ENDPOINT,
  forcePathStyle: true,
  credentials: process.env.TELEMETRY_S3_ACCESS_KEY_ID && process.env.TELEMETRY_S3_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.TELEMETRY_S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.TELEMETRY_S3_SECRET_ACCESS_KEY,
      }
    : (process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        }
      : undefined),
});

function corsHeaders(extra) {
  return Object.assign({
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }, extra || {});
}

function json(statusCode, payload, extraHeaders) {
  return {
    statusCode,
    headers: corsHeaders(extraHeaders),
    body: JSON.stringify(payload)
  };
}

function methodOf(event) {
  return String(
    (event && (event.httpMethod || (event.requestContext && event.requestContext.http && event.requestContext.http.method))) ||
    'GET'
  ).toUpperCase();
}

function pathOf(event) {
  return String(
    (event && (event.path || event.rawPath || (event.requestContext && event.requestContext.http && event.requestContext.http.path))) ||
    '/'
  );
}

function queryOf(event) {
  return (event && event.queryStringParameters) || {};
}

function bodyString(event) {
  if (!event || event.body == null) return '';
  if (event.isBase64Encoded) return Buffer.from(String(event.body), 'base64').toString('utf8');
  return String(event.body);
}

function nowIso() {
  return new Date().toISOString();
}

function trimTrailingSlashes(value) {
  return String(value || '').replace(/\/+$/, '');
}

function digitsOnly(value) {
  return String(value || '').replace(/\D/g, '');
}

function normalizeLeadString(value, maxLen) {
  const raw = String(value == null ? '' : value).replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
  if (!raw) return '';
  const limit = Number(maxLen || 0) > 0 ? Number(maxLen) : 4000;
  return raw.length > limit ? raw.slice(0, limit) : raw;
}

function buildLeadTransactionId() {
  return `${Date.now()}:${String(Math.floor(Math.random() * 1e10)).padStart(10, '0')}`;
}

function splitTelegramText(text, limit) {
  const maxLen = Math.max(500, Number(limit || TELEGRAM_MESSAGE_LIMIT) || TELEGRAM_MESSAGE_LIMIT);
  const source = String(text || '');
  if (!source) return [];
  if (source.length <= maxLen) return [source];
  const out = [];
  let rest = source;
  while (rest.length > maxLen) {
    let cut = rest.lastIndexOf('\n', maxLen);
    if (cut < Math.floor(maxLen * 0.6)) cut = maxLen;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^\n+/, '');
  }
  if (rest) out.push(rest);
  return out;
}

function sendTelegramMessage(text) {
  return new Promise((resolve, reject) => {
    if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
      reject(new Error('telegram_not_configured'));
      return;
    }
    const body = JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text: String(text || ''),
      disable_web_page_preview: true
    });
    const req = https.request({
      hostname: 'api.telegram.org',
      method: 'POST',
      path: `/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        const ok = res.statusCode && res.statusCode >= 200 && res.statusCode < 300;
        if (!ok) {
          reject(new Error(`telegram_http_${res.statusCode || 500}`));
          return;
        }
        try {
          const parsed = data ? JSON.parse(data) : {};
          if (!parsed || parsed.ok !== true) {
            reject(new Error(parsed && parsed.description ? String(parsed.description) : 'telegram_api_error'));
            return;
          }
          resolve(parsed);
        } catch (err) {
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendTelegramTextChunks(text) {
  const chunks = splitTelegramText(text, TELEGRAM_MESSAGE_LIMIT);
  if (!chunks.length) throw new Error('telegram_message_empty');
  for (const chunk of chunks) {
    await sendTelegramMessage(chunk);
  }
}

function buildLeadMessage(payload) {
  const source = String(payload.source || payload.order_source || payload.form_type || 'lead_submit');
  const contacts = payload.contacts && typeof payload.contacts === 'object' ? payload.contacts : {};
  const summary = payload.summary && typeof payload.summary === 'object' ? payload.summary : {};
  const additional = [];
  const details = [];
  const name = normalizeLeadString(contacts.name, 120) || '—';
  const email = normalizeLeadString(contacts.email, 200) || '—';
  const phone = normalizeLeadString(contacts.phone, 64) || '—';
  const comment = normalizeLeadString(contacts.comment, 1000) || '—';
  const orderPositionsText = normalizeLeadString(payload.order_positions_text || summary.order_positions_text, 12000);
  const grandTotal = normalizeLeadString(payload.order_cart_grand_total || payload.cart_grand_total || summary.order_cart_grand_total, 160);
  const positionsCount = String(Number(payload.order_positions_count || payload.cart_positions_count || 0) || 0);
  const orderSource = normalizeLeadString(payload.order_source || source, 120) || source;
  const consent = payload.personal_data_consent === 'yes' || payload.consent === true ? 'yes' : 'no';
  const txId = normalizeLeadString(payload.transaction_id, 120) || buildLeadTransactionId();
  const blockId = normalizeLeadString(payload.block_id, 120) || (source === 'manager_form_v1' ? 'detail_manager_form' : 'calculator_module');
  const pageUrl = normalizeLeadString(payload.page_url, 1000);
  const formType = normalizeLeadString(payload.form_type || source, 120);
  const shapeName = normalizeLeadString(payload.shape_name || payload.shapeName, 200);
  const tileName = normalizeLeadString(payload.tile_name || payload.tileName, 200);
  const submittedAt = normalizeLeadString(payload.submitted_at, 120) || nowIso();

  details.push('Request details:');
  details.push(`name: ${name}`);
  details.push(`email: ${email}`);
  details.push(`phone: ${phone}`);
  details.push(`comment: ${comment}`);
  if (orderPositionsText) details.push(`order_positions_text: ${orderPositionsText}`);
  if (grandTotal) details.push(`order_cart_grand_total: ${grandTotal}`);
  details.push(`order_positions_count: ${positionsCount}`);
  details.push(`order_source: ${orderSource}`);
  details.push(`personal_data_consent: ${consent}`);

  additional.push('Additional information:');
  additional.push(`Transaction ID: ${txId}`);
  additional.push(`Block ID: ${blockId}`);
  if (pageUrl) additional.push(`Page URL: ${pageUrl}`);
  if (formType) additional.push(`Form type: ${formType}`);
  if (shapeName) additional.push(`Shape: ${shapeName}`);
  if (tileName) additional.push(`Texture: ${tileName}`);
  additional.push(`Timestamp: ${submittedAt}`);

  return {
    text: details.join('\n') + '\n\n' + additional.join('\n'),
    transactionId: txId,
    blockId,
    orderSource,
  };
}

function validateLeadPayload(body) {
  const payload = body && typeof body === 'object' ? body : {};
  const contacts = payload.contacts && typeof payload.contacts === 'object' ? payload.contacts : {};
  const honeypot = normalizeLeadString(payload.honeypot || payload.company, 200);
  if (honeypot) return { ok: false, statusCode: 400, message: 'invalid_payload' };
  const name = normalizeLeadString(contacts.name, 120);
  const phoneDigits = digitsOnly(contacts.phone || '');
  if (name.length < 2) return { ok: false, statusCode: 400, message: 'name is required' };
  if (phoneDigits.length < 10) return { ok: false, statusCode: 400, message: 'phone is required' };
  if (!(payload.personal_data_consent === 'yes' || payload.consent === true)) {
    return { ok: false, statusCode: 400, message: 'personal_data_consent is required' };
  }
  return { ok: true };
}

async function handleLeadSubmit(payload) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return json(503, { ok: false, message: 'Telegram integration is not configured' });
  }
  const validation = validateLeadPayload(payload);
  if (!validation.ok) return json(validation.statusCode || 400, { ok: false, message: validation.message || 'invalid lead payload' });
  const built = buildLeadMessage(payload || {});
  await sendTelegramTextChunks(built.text);
  return json(200, {
    ok: true,
    mode: 'lead_submit',
    channel: 'telegram',
    transactionId: built.transactionId,
    blockId: built.blockId,
    orderSource: built.orderSource,
    sentAt: nowIso(),
  });
}

function readHeader(event, name) {
  const target = String(name || '').toLowerCase();
  const headers = event && event.headers && typeof event.headers === 'object' ? event.headers : {};
  const keys = Object.keys(headers);
  for (const key of keys) {
    if (String(key || '').toLowerCase() !== target) continue;
    return String(headers[key] || '');
  }
  return '';
}

function readBearerToken(event) {
  const raw = readHeader(event, 'authorization').trim();
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match ? String(match[1] || '').trim() : '';
}

function getTelemetryAdminJwtSecret() {
  const candidates = [
    process.env.TELEMETRY_ADMIN_JWT_SECRET,
    process.env.ADMIN_JWT_SECRET,
    process.env.JWT_SECRET
  ];
  for (const item of candidates) {
    const value = String(item || '').trim();
    if (value) return value;
  }
  return '';
}

function decodeBase64UrlSegment(value) {
  const input = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const pad = input.length % 4;
  const normalized = pad ? (input + '='.repeat(4 - pad)) : input;
  return Buffer.from(normalized, 'base64');
}

function safeTimingEqual(a, b) {
  const left = Buffer.isBuffer(a) ? a : Buffer.from(String(a || ''));
  const right = Buffer.isBuffer(b) ? b : Buffer.from(String(b || ''));
  if (left.length !== right.length) return false;
  try {
    return crypto.timingSafeEqual(left, right);
  } catch (_) {
    return false;
  }
}

function verifyHs256Jwt(token, secret) {
  const raw = String(token || '').trim();
  const jwtSecret = String(secret || '');
  if (!raw || !jwtSecret) return { ok: false, reason: raw ? 'secret_missing' : 'token_missing' };
  const parts = raw.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'jwt_format' };
  try {
    const header = JSON.parse(decodeBase64UrlSegment(parts[0]).toString('utf8'));
    const payload = JSON.parse(decodeBase64UrlSegment(parts[1]).toString('utf8'));
    if (!header || header.alg !== 'HS256') return { ok: false, reason: 'jwt_alg' };
    const signingInput = parts[0] + '.' + parts[1];
    const expected = crypto.createHmac('sha256', jwtSecret).update(signingInput).digest('base64url');
    if (!safeTimingEqual(Buffer.from(parts[2]), Buffer.from(expected))) return { ok: false, reason: 'jwt_signature' };

    const nowSec = Math.floor(Date.now() / 1000);
    if (payload && payload.nbf != null) {
      const nbf = Number(payload.nbf);
      if (Number.isFinite(nbf) && nbf > nowSec + 30) return { ok: false, reason: 'jwt_nbf' };
    }
    if (payload && payload.exp != null) {
      const exp = Number(payload.exp);
      if (!Number.isFinite(exp) || exp <= nowSec) return { ok: false, reason: 'jwt_expired' };
    }
    return { ok: true, payload };
  } catch (_) {
    return { ok: false, reason: 'jwt_parse' };
  }
}

function requireTelemetryAdminAuth(event, options) {
  const opts = options && typeof options === 'object' ? options : {};
  const allowPresenceFallback = !!opts.allowPresenceFallback;
  const requiredIntentHeader = String(opts.requiredIntentHeader || '').trim().toLowerCase();
  const requiredIntentValue = String(opts.requiredIntentValue || '').trim().toLowerCase();
  const token = readBearerToken(event);
  if (!token) return { ok: false, statusCode: 401, message: 'Admin authorization is required for protected telemetry access', code: 'telemetry_admin_auth_required' };
  const secret = getTelemetryAdminJwtSecret();
  if (!secret) {
    if (allowPresenceFallback) {
      if (requiredIntentHeader) {
        const headerValue = String(readHeader(event, requiredIntentHeader) || '').trim().toLowerCase();
        if (!headerValue || (requiredIntentValue && headerValue !== requiredIntentValue)) {
          return { ok: false, statusCode: 400, message: 'Required telemetry admin action header is missing', code: 'telemetry_admin_action_header_required' };
        }
      }
      return { ok: true, claims: {}, degradedAuth: true, authMode: 'bearer_presence_only' };
    }
    return { ok: false, statusCode: 503, message: 'Telemetry admin auth secret is not configured', code: 'telemetry_admin_auth_not_configured' };
  }
  const verified = verifyHs256Jwt(token, secret);
  if (!verified.ok) {
    return { ok: false, statusCode: 401, message: 'Invalid or expired admin token', code: verified.reason || 'telemetry_admin_auth_failed' };
  }
  return { ok: true, claims: verified.payload || {}, authMode: 'jwt_verified' };
}

function dayKeyFromTs(ts) {
  const d = new Date(Number(ts || Date.now()));
  return Number.isFinite(d.getTime()) ? d.toISOString().slice(0, 10) : nowIso().slice(0, 10);
}

function monthKeyFromTs(ts) {
  const d = new Date(Number(ts || Date.now()));
  if (!Number.isFinite(d.getTime())) return nowIso().slice(0, 7);
  return d.toISOString().slice(0, 7);
}

function quarterKeyFromTs(ts) {
  const d = new Date(Number(ts || Date.now()));
  if (!Number.isFinite(d.getTime())) return nowIso().slice(0, 4) + '-Q1';
  return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`;
}

function yearKeyFromTs(ts) {
  const d = new Date(Number(ts || Date.now()));
  if (!Number.isFinite(d.getTime())) return nowIso().slice(0, 4);
  return String(d.getUTCFullYear());
}

function streamToString(stream) {
  if (!stream) return Promise.resolve('');
  if (typeof stream.transformToString === 'function') return stream.transformToString();
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  });
}

function sanitizeProps(input, depth) {
  const d = Number(depth || 0);
  if (d > 3) return '[depth-limit]';
  if (input == null) return input;
  const t = typeof input;
  if (t === 'string') return input.slice(0, 500);
  if (t === 'number' || t === 'boolean') return input;
  if (Array.isArray(input)) return input.slice(0, 16).map((item) => sanitizeProps(item, d + 1));
  if (t === 'object') {
    const out = {};
    Object.keys(input).slice(0, 32).forEach((key) => {
      out[String(key).slice(0, 80)] = sanitizeProps(input[key], d + 1);
    });
    return out;
  }
  return String(input).slice(0, 120);
}

function sanitizeEvent(item) {
  if (!item || typeof item !== 'object') return null;
  const kind = item.kind === 'error' ? 'error' : 'event';
  const name = String(item.name || 'unknown').trim().slice(0, 120);
  if (!name) return null;
  const ts = Number(item.ts || Date.now());
  return {
    id: String(item.id || '').slice(0, 120) || ('evt_' + crypto.randomBytes(6).toString('hex')),
    kind,
    name,
    ts: Number.isFinite(ts) ? ts : Date.now(),
    iso: String(item.iso || nowIso()).slice(0, 40),
    sessionId: String(item.sessionId || '').slice(0, 120),
    visitorId: String(item.visitorId || (item.props && (item.props.visitorId || item.props.deviceId)) || '').slice(0, 120),
    path: String(item.path || '').slice(0, 240),
    version: String(item.version || '').slice(0, 80),
    props: sanitizeProps(item.props || {}, 0)
  };
}

function uniqueBatchKey(ts) {
  const d = new Date(ts || Date.now());
  const yyyy = String(d.getUTCFullYear());
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mi = String(d.getUTCMinutes()).padStart(2, '0');
  const ss = String(d.getUTCSeconds()).padStart(2, '0');
  const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
  const rand = crypto.randomBytes(4).toString('hex');
  return `${PREFIX}/batches/${yyyy}/${mm}/${dd}/${yyyy}${mm}${dd}T${hh}${mi}${ss}${ms}Z_${rand}.json`;
}

async function putJson(key, payload) {
  await s3.send(new PutObjectCommand({
    Bucket: BUCKET,
    Key: key,
    Body: JSON.stringify(payload),
    ContentType: 'application/json; charset=utf-8',
    CacheControl: 'no-store'
  }));
}

async function getJson(key) {
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key }));
    const body = await streamToString(res.Body);
    return body ? JSON.parse(body) : null;
  } catch (err) {
    const code = err && (err.name || err.Code || err.code);
    if (String(code || '').includes('NoSuchKey')) return null;
    if (err && err.$metadata && err.$metadata.httpStatusCode === 404) return null;
    throw err;
  }
}

async function listKeys(prefix, maxKeys) {
  const keys = [];
  let continuationToken = undefined;
  do {
    const res = await s3.send(new ListObjectsV2Command({
      Bucket: BUCKET,
      Prefix: prefix,
      ContinuationToken: continuationToken,
      MaxKeys: Math.min(1000, Math.max(1, Number(maxKeys || 1000)))
    }));
    (res.Contents || []).forEach((item) => {
      if (item && item.Key) keys.push(item.Key);
    });
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken && keys.length < maxKeys);
  return keys.slice(0, maxKeys);
}

function buildScopedDayPrefixes(days, scope) {
  const safeDays = Math.max(1, Math.min(MAX_DAYS, Number(days || 7) || 7));
  const baseScope = String(scope || 'batches').replace(/^\/+/, '').replace(/\/+$/, '') || 'batches';
  const out = [];
  const now = new Date();
  for (let i = 0; i < safeDays; i += 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    d.setUTCDate(d.getUTCDate() - i);
    const yyyy = String(d.getUTCFullYear());
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    out.push(`${PREFIX}/${baseScope}/${yyyy}/${mm}/${dd}/`);
  }
  return out;
}

function buildDayPrefixes(days) {
  return buildScopedDayPrefixes(days, 'batches');
}

function buildErrorClearPrefixes(days) {
  return buildScopedDayPrefixes(days, 'error_clears');
}

function sortKeysDesc(keys) {
  return keys.slice().sort((a, b) => String(b).localeCompare(String(a)));
}


function buildErrorClearObjectKey(dayKey) {
  const safeDayKey = /^\d{4}-\d{2}-\d{2}$/.test(String(dayKey || '')) ? String(dayKey) : dayKeyFromTs(Date.now());
  const parts = safeDayKey.split('-');
  const rand = crypto.randomBytes(4).toString('hex');
  const stamp = nowIso().replace(/[-:.TZ]/g, '').slice(0, 17);
  return `${PREFIX}/error_clears/${parts[0]}/${parts[1]}/${parts[2]}/${stamp}_${rand}.json`;
}

function sanitizeClearItem(item) {
  if (!item || typeof item !== 'object') return null;
  const id = String(item.id || '').trim().slice(0, 160);
  if (!id) return null;
  const ts = Number(item.ts || 0) || 0;
  return {
    id,
    ts: Number.isFinite(ts) && ts > 0 ? ts : Date.now(),
    name: String(item.name || '').trim().slice(0, 120)
  };
}

async function loadClearedErrorIds(days) {
  const cleared = new Set();
  const prefixes = buildErrorClearPrefixes(days);
  for (const prefix of prefixes) {
    const keys = sortKeysDesc(await listKeys(prefix, MAX_CLEAR_OBJECTS_PER_DAY));
    for (const key of keys) {
      const marker = await getJson(key);
      if (!marker || !Array.isArray(marker.items)) continue;
      marker.items.forEach((item) => {
        const id = String(item && item.id || '').trim();
        if (id) cleared.add(id);
      });
    }
  }
  return cleared;
}

async function persistClearedErrors(items, scope) {
  const groups = Object.create(null);
  const list = (Array.isArray(items) ? items : []).map(sanitizeClearItem).filter(Boolean).slice(0, MAX_ERROR_ITEMS);
  if (!list.length) return { cleared: 0, markers: 0, dayCount: 0 };
  list.forEach((item) => {
    const dayKey = dayKeyFromTs(item.ts);
    if (!groups[dayKey]) groups[dayKey] = [];
    groups[dayKey].push(item);
  });
  let markers = 0;
  const createdAt = nowIso();
  for (const dayKey of Object.keys(groups)) {
    const key = buildErrorClearObjectKey(dayKey);
    await putJson(key, {
      ok: true,
      type: 'error_clear',
      createdAt,
      dayKey,
      scope: scope || {},
      items: groups[dayKey]
    });
    markers += 1;
  }
  return { cleared: list.length, markers, dayCount: Object.keys(groups).length };
}

function makeEmptySummary(days) {
  return {
    ok: true,
    source: 'telemetry-collector',
    generatedAt: nowIso(),
    days: Number(days || 7) || 7,
    totals: { batches: 0, events: 0, errors: 0, sessions: 0 },
    byName: [],
    byDay: [],
    topErrors: [],
    latestEventAt: '',
    partial: false,
    scan: {
      requestedLimitPerDay: 0,
      appliedLimitPerDay: 0,
      scannedBatches: 0,
      scannedDays: 0,
      daysRequested: Number(days || 7) || 7,
      maxBatchesTotal: SUMMARY_MAX_BATCHES_TOTAL,
      timeBudgetMs: SUMMARY_TIME_BUDGET_MS,
      elapsedMs: 0,
      stopReason: ''
    }
  };
}

function normalizeDeviceFilter(value) {
  const key = String(value || 'all').toLowerCase();
  return (key === 'mobile' || key === 'tablet' || key === 'desktop' || key === 'unknown') ? key : 'all';
}

function matchesFilters(evt, filters) {
  if (!evt) return false;
  const cfg = filters || {};
  const deviceType = normalizeDeviceFilter(cfg.deviceType);
  if (deviceType !== 'all') {
    const evtDevice = getProp(evt.props || {}, ['deviceType']) || 'unknown';
    if (evtDevice !== deviceType) return false;
  }
  return true;
}

function normalizeSummaryLimit(value) {
  const requested = Number(value);
  if (!Number.isFinite(requested) || requested <= 0) return SUMMARY_DEFAULT_OBJECTS_PER_DAY;
  return Math.max(1, Math.min(SUMMARY_MAX_OBJECTS_PER_DAY, requested));
}

function shouldStopSummaryScan(scanState) {
  if (!scanState) return '';
  if (Number(scanState.scannedBatches || 0) >= SUMMARY_MAX_BATCHES_TOTAL) return 'max_batches_total';
  if (Number(scanState.startedAt || 0) > 0 && (Date.now() - Number(scanState.startedAt || 0)) >= SUMMARY_TIME_BUDGET_MS) return 'time_budget';
  return '';
}

function normalizeErrorSeverity(value) {
  const key = String(value || 'all').toLowerCase();
  return ERROR_SEVERITY_ORDER.includes(key) ? key : 'all';
}

function normalizeErrorCategory(value) {
  const key = String(value || 'all').toLowerCase();
  return ERROR_CATEGORY_ORDER.includes(key) ? key : 'all';
}

function normalizeErrorSource(value) {
  const key = String(value || 'all').toLowerCase();
  return (key === 'site' || key === 'admin') ? key : 'all';
}

function inferErrorSource(evt) {
  const path = String(evt && evt.path || '');
  const name = String(evt && evt.name || '');
  if (name.startsWith('admin_') || /\/admin(?:\/|$)/i.test(path)) return 'admin';
  return 'site';
}

function classifyErrorMeta(name) {
  const key = String(name || '');
  const rule = ERROR_RULES[key] || {};
  let severity = rule.severity || '';
  let category = rule.category || '';
  if (!severity) {
    if (key.includes('window') || key.includes('rejection')) severity = 'critical';
    else if (key.includes('snapshot')) severity = 'medium';
    else if (key.includes('palette') || key.includes('tiles') || key.includes('shapes')) severity = 'critical';
    else if (key.includes('texture') || key.includes('detail_') || key.includes('shape_')) severity = 'medium';
    else severity = 'diagnostic';
  }
  if (!category) {
    if (key.includes('snapshot')) category = 'snapshot_export';
    else if (key.includes('palette') || key.includes('tiles') || key.includes('shapes') || key.includes('gallery')) category = 'palette_content';
    else if (key.includes('texture')) category = 'textures_materials';
    else if (key.startsWith('admin_')) category = 'admin_save';
    else if (key.includes('window') || key.includes('rejection')) category = 'runtime_js';
    else if (key.includes('analytics') || key.includes('telemetry') || key.includes('summary') || key.includes('backend')) category = 'analytics_backend';
    else if (key.includes('ar_')) category = 'ar_session';
    else category = 'ui_flow';
  }
  return { severity, category };
}

function compactErrorProps(props) {
  const src = props && typeof props === 'object' ? props : {};
  const out = {};
  ERROR_COMPACT_PROP_KEYS.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(src, key) && src[key] != null && src[key] !== '') out[key] = src[key];
  });
  let extraCount = 0;
  Object.keys(src).forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(out, key)) return;
    if (extraCount >= 6) return;
    const value = src[key];
    if (value == null || value === '') return;
    out[key] = value;
    extraCount += 1;
  });
  return out;
}

function buildErrorFeedItem(evt, meta) {
  const props = evt && evt.props && typeof evt.props === 'object' ? evt.props : {};
  return {
    id: evt.id,
    kind: 'error',
    name: evt.name,
    ts: evt.ts,
    iso: evt.iso,
    sessionId: evt.sessionId,
    visitorId: evt.visitorId,
    path: evt.path,
    version: evt.version,
    severity: meta.severity,
    category: meta.category,
    source: meta.source,
    props: compactErrorProps(props)
  };
}

function errorMatchesFilters(evt, filters, meta) {
  if (!matchesFilters(evt, filters)) return false;
  const cfg = filters || {};
  const info = meta || Object.assign({}, classifyErrorMeta(evt && evt.name), { source: inferErrorSource(evt) });
  const severity = normalizeErrorSeverity(cfg.severity);
  const category = normalizeErrorCategory(cfg.category);
  const source = normalizeErrorSource(cfg.source);
  if (severity !== 'all' && info.severity !== severity) return false;
  if (category !== 'all' && info.category !== category) return false;
  if (source !== 'all' && info.source !== source) return false;
  return true;
}


function getProp(obj, keys) {
  if (!obj || typeof obj !== 'object') return '';
  for (const key of keys) {
    const value = obj[key];
    if (value != null && value !== '') return String(value);
  }
  return '';
}

function ratio(num, den) {
  const n = Number(num || 0);
  const d = Number(den || 0);
  if (!d || !Number.isFinite(n) || !Number.isFinite(d)) return 0;
  return n / d;
}

function extractVisitorId(evt) {
  if (!evt) return '';
  return String(evt.visitorId || getProp((evt && evt.props) || {}, ['visitorId', 'deviceId']) || evt.sessionId || '');
}

function extractDeviceType(props) {
  return getProp(props, ['deviceType']) || 'unknown';
}

function pushSeriesBucket(map, key, sessionId, visitorId, isError) {
  const bucketKey = String(key || nowIso().slice(0, 10));
  if (!map.has(bucketKey)) {
    map.set(bucketKey, { key: bucketKey, events: 0, errors: 0, sessions: new Set(), visitors: new Set() });
  }
  const bucket = map.get(bucketKey);
  bucket.events += 1;
  if (isError) bucket.errors += 1;
  if (sessionId) bucket.sessions.add(sessionId);
  if (visitorId) bucket.visitors.add(visitorId);
}

function formatPercentText(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return '0%';
  return `${(n * 100).toFixed(0)}%`;
}

function setSize(set) {
  return set instanceof Set ? set.size : 0;
}

function extractShapeInfo(props) {
  return {
    id: getProp(props, ['shapeId', 'selectedShapeId', 'targetShapeId']),
    name: getProp(props, ['shapeName', 'selectedShapeName', 'targetShapeName'])
  };
}

function extractTextureInfo(props) {
  return {
    id: getProp(props, ['tileId', 'selectedTileId', 'textureId', 'itemId']),
    name: getProp(props, ['tileName', 'selectedTileName', 'textureName', 'itemName'])
  };
}

function makeDashboardAccumulator() {
  return {
    metrics: {
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
    },
    sessions: new Set(),
    visitors: new Set(),
    visitorSessions: new Map(),
    sessionsWithErrors: new Set(),
    arLaunchSessions: new Set(),
    arStartedSessions: new Set(),
    firstPointSessions: new Set(),
    contourClosedSessions: new Set(),
    arCompletedSessions: new Set(),
    textureInteractionSessions: new Set(),
    managerCtaSessions: new Set(),
    adminCalibrationSessions: new Set(),
    adminSessions: new Set(),
    shapes: new Map(),
    textures: new Map(),
    devices: new Map(),
    seriesDay: new Map(),
    seriesMonth: new Map(),
    seriesQuarter: new Map(),
    seriesYear: new Map()
  };
}

function addRankedContext(map, id, name, sessionId) {
  if (!id) return;
  if (!map.has(id)) map.set(id, { id, name: name || id, count: 0, sessions: new Set() });
  const entry = map.get(id);
  entry.count += 1;
  if (name) entry.name = name;
  if (sessionId) entry.sessions.add(sessionId);
}

function ensureDeviceSegment(acc, deviceType) {
  const key = deviceType || 'unknown';
  if (!acc.devices.has(key)) {
    acc.devices.set(key, { deviceType: key, sessions: new Set(), arLaunchSessions: new Set(), arStartedSessions: new Set(), arCompletedSessions: new Set(), errors: 0 });
  }
  return acc.devices.get(key);
}

function applyDashboardEvent(acc, evt) {
  if (!acc || !evt) return;
  const name = String(evt.name || '');
  const props = evt.props || {};
  const sessionId = String(evt.sessionId || '');
  const visitorId = extractVisitorId(evt);
  const deviceEntry = ensureDeviceSegment(acc, extractDeviceType(props));
  if (sessionId) {
    acc.sessions.add(sessionId);
    deviceEntry.sessions.add(sessionId);
  }
  if (visitorId) {
    acc.visitors.add(visitorId);
    if (!acc.visitorSessions.has(visitorId)) acc.visitorSessions.set(visitorId, new Set());
    if (sessionId) acc.visitorSessions.get(visitorId).add(sessionId);
  }
  pushSeriesBucket(acc.seriesDay, dayKeyFromTs(evt.ts), sessionId, visitorId, evt.kind === 'error');
  pushSeriesBucket(acc.seriesMonth, monthKeyFromTs(evt.ts), sessionId, visitorId, evt.kind === 'error');
  pushSeriesBucket(acc.seriesQuarter, quarterKeyFromTs(evt.ts), sessionId, visitorId, evt.kind === 'error');
  pushSeriesBucket(acc.seriesYear, yearKeyFromTs(evt.ts), sessionId, visitorId, evt.kind === 'error');
  if (evt.kind === 'error') {
    acc.metrics.errors += 1;
    deviceEntry.errors += 1;
    if (sessionId) acc.sessionsWithErrors.add(sessionId);
  }
  if ((evt.path && String(evt.path).includes('/admin')) || name.startsWith('admin_')) {
    if (sessionId) acc.adminSessions.add(sessionId);
  }
  if (name === 'ar_launch_click' || name === 'ar_session_start_requested') {
    acc.metrics.arLaunches += 1;
    if (sessionId) { acc.arLaunchSessions.add(sessionId); deviceEntry.arLaunchSessions.add(sessionId); }
  }
  if (name === 'ar_session_started') {
    acc.metrics.arStarted += 1;
    if (sessionId) { acc.arStartedSessions.add(sessionId); deviceEntry.arStartedSessions.add(sessionId); }
  }
  if (name === 'ar_first_point') {
    acc.metrics.firstPoints += 1;
    if (sessionId) acc.firstPointSessions.add(sessionId);
  }
  if (name === 'ar_contour_closed') {
    acc.metrics.contoursClosed += 1;
    if (sessionId) acc.contourClosedSessions.add(sessionId);
  }
  if (name === 'ar_visualization_ready') {
    acc.metrics.arCompleted += 1;
    if (sessionId) { acc.arCompletedSessions.add(sessionId); deviceEntry.arCompletedSessions.add(sessionId); }
  }
  if (name === 'texture_select') {
    acc.metrics.textureChanges += 1;
    if (sessionId) acc.textureInteractionSessions.add(sessionId);
  }
  if (name === 'cta_manager_call') {
    acc.metrics.managerCtaClicks += 1;
    if (sessionId) acc.managerCtaSessions.add(sessionId);
  }
  if (name === 'cta_site_click') acc.metrics.siteCtaClicks += 1;
  if (name === 'ar_snapshot_click' || name === 'ar_snapshot_exported') acc.metrics.snapshotUses += 1;
  if (name === 'ar_shape_picker_toggle' || name === 'ar_shape_picker_select') acc.metrics.shapePickerUses += 1;
  if (name === 'ar_rotation_step' || name === 'ar_rotation_reset') acc.metrics.rotationUses += 1;
  if (name === 'admin_ar_calibration_open' || (name === 'admin_ar_calibration_toggle' && !!props.open)) {
    acc.metrics.adminCalibrationUsage += 1;
    if (sessionId) acc.adminCalibrationSessions.add(sessionId);
  }
  if (name === 'admin_ar_calibration_saved') acc.metrics.adminCalibrationSaves += 1;

  const shouldCountShape = (name === 'form_change' || name === 'texture_select' || name === 'ar_visualization_ready' || name === 'ar_shape_picker_select' || name === 'page_view' || name === 'screen_view' || name === 'cta_manager_call');
  const shouldCountTexture = (name === 'texture_select' || name === 'ar_visualization_ready' || name === 'admin_ar_calibration_saved' || name === 'cta_manager_call');
  if (shouldCountShape) {
    const shape = extractShapeInfo(props);
    if (shape.id) addRankedContext(acc.shapes, shape.id, shape.name, sessionId);
  }
  if (shouldCountTexture) {
    const texture = extractTextureInfo(props);
    if (texture.id) addRankedContext(acc.textures, texture.id, texture.name, sessionId);
  }
}

function buildDashboardResult(acc) {
  const metrics = Object.assign({}, acc.metrics, { sessions: acc.sessions.size });
  metrics.uniqueVisitors = acc.visitors.size;
  acc.visitorSessions.forEach((bag) => {
    const count = setSize(bag);
    if (count > 1) {
      metrics.returningVisitors += 1;
      metrics.repeatVisits += (count - 1);
    }
  });
  metrics.avgSessionsPerVisitor = ratio(metrics.sessions, metrics.uniqueVisitors || 0);
  function ranked(map) {
    return Array.from(map.values())
      .map((entry) => ({ id: entry.id, name: entry.name, count: entry.count, sessions: setSize(entry.sessions) }))
      .sort((a, b) => b.sessions - a.sessions || b.count - a.count || String(a.name || a.id).localeCompare(String(b.name || b.id)))
      .slice(0, 5);
  }
  const deviceSegments = Array.from(acc.devices.values()).map((entry) => ({
    deviceType: entry.deviceType,
    sessions: entry.sessions.size,
    arLaunchSessions: entry.arLaunchSessions.size,
    arStartedSessions: entry.arStartedSessions.size,
    arCompletedSessions: entry.arCompletedSessions.size,
    errors: Number(entry.errors || 0),
    arCompletionRate: ratio(entry.arCompletedSessions.size, entry.arLaunchSessions.size),
    errorRatePerSession: ratio(Number(entry.errors || 0), entry.sessions.size),
    share: ratio(entry.sessions.size, acc.sessions.size),
    shareLabel: formatPercentText(ratio(entry.sessions.size, acc.sessions.size))
  })).filter((item) => item.sessions > 0).sort((a, b) => b.sessions - a.sessions);
  const buildSeries = (map) => Array.from(map.values()).sort((a, b) => String(a.key).localeCompare(String(b.key))).map((entry) => ({
    key: entry.key,
    label: entry.key,
    events: entry.events,
    errors: entry.errors,
    sessions: entry.sessions.size,
    uniqueVisitors: entry.visitors.size
  }));
  return {
    metrics,
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
      sessions: acc.sessions.size,
      uniqueVisitors: metrics.uniqueVisitors,
      returningVisitors: metrics.returningVisitors,
      repeatVisits: metrics.repeatVisits,
      sessionsWithErrors: acc.sessionsWithErrors.size,
      arLaunchSessions: acc.arLaunchSessions.size,
      arStartedSessions: acc.arStartedSessions.size,
      firstPointSessions: acc.firstPointSessions.size,
      contourClosedSessions: acc.contourClosedSessions.size,
      arCompletedSessions: acc.arCompletedSessions.size,
      textureInteractionSessions: acc.textureInteractionSessions.size,
      managerCtaSessions: acc.managerCtaSessions.size,
      adminCalibrationSessions: acc.adminCalibrationSessions.size,
      adminSessions: acc.adminSessions.size
    },
    topShapes: ranked(acc.shapes),
    topTextures: ranked(acc.textures),
    deviceSegments,
    timeSeries: {
      byDay: buildSeries(acc.seriesDay),
      byMonth: buildSeries(acc.seriesMonth),
      byQuarter: buildSeries(acc.seriesQuarter),
      byYear: buildSeries(acc.seriesYear)
    },
    funnel: {
      steps: [
        { key: 'launch', label: 'Клик по запуску AR', sessions: acc.arLaunchSessions.size, conversionFromLaunch: 1, conversionFromPrev: 1 },
        { key: 'started', label: 'Успешный вход в AR', sessions: acc.arStartedSessions.size, conversionFromLaunch: ratio(acc.arStartedSessions.size, acc.arLaunchSessions.size), conversionFromPrev: ratio(acc.arStartedSessions.size, acc.arLaunchSessions.size) },
        { key: 'firstPoint', label: 'Поставили первую точку', sessions: acc.firstPointSessions.size, conversionFromLaunch: ratio(acc.firstPointSessions.size, acc.arLaunchSessions.size), conversionFromPrev: ratio(acc.firstPointSessions.size, acc.arStartedSessions.size) },
        { key: 'contourClosed', label: 'Замкнули контур', sessions: acc.contourClosedSessions.size, conversionFromLaunch: ratio(acc.contourClosedSessions.size, acc.arLaunchSessions.size), conversionFromPrev: ratio(acc.contourClosedSessions.size, acc.firstPointSessions.size) },
        { key: 'completed', label: 'Дошли до заливки', sessions: acc.arCompletedSessions.size, conversionFromLaunch: ratio(acc.arCompletedSessions.size, acc.arLaunchSessions.size), conversionFromPrev: ratio(acc.arCompletedSessions.size, acc.contourClosedSessions.size) }
      ]
    },
    kpis: {
      arStartRate: ratio(acc.arStartedSessions.size, acc.arLaunchSessions.size),
      arCompletionRate: ratio(acc.arCompletedSessions.size, acc.arLaunchSessions.size),
      textureInteractionRate: ratio(acc.textureInteractionSessions.size, acc.arCompletedSessions.size),
      ctaClickRate: ratio(acc.managerCtaSessions.size, acc.sessions.size),
      adminCalibrationUsage: ratio(acc.adminCalibrationSessions.size, acc.adminSessions.size || acc.sessions.size),
      errorRatePerSession: ratio(acc.metrics.errors, acc.sessions.size),
      errorSessionRate: ratio(acc.sessionsWithErrors.size, acc.sessions.size),
      arContourCompletionRate: ratio(acc.contourClosedSessions.size, acc.arStartedSessions.size)
    }
  };
}

function pushTopError(map, item) {
  if (!item || item.kind !== 'error') return;
  const key = item.name || 'error';
  if (!map[key]) map[key] = { name: key, count: 0, lastAt: '' };
  map[key].count += 1;
  if (!map[key].lastAt || String(item.iso || '') > String(map[key].lastAt)) map[key].lastAt = String(item.iso || '');
}

function makeEmptyErrorFeed(days, limit) {
  return {
    ok: true,
    source: 'telemetry-collector',
    mode: 'errors',
    generatedAt: nowIso(),
    days: Number(days || 7) || 7,
    totals: { batches: 0, errors: 0, returned: 0 },
    byName: [],
    bySeverity: ERROR_SEVERITY_ORDER.map((key) => ({ key, count: 0 })),
    byCategory: ERROR_CATEGORY_ORDER.map((key) => ({ key, count: 0 })),
    latestErrorAt: '',
    filters: { deviceType: 'all', severity: 'all', category: 'all', source: 'all' },
    limit: Math.max(1, Math.min(MAX_ERROR_ITEMS, Number(limit || MAX_ERROR_ITEMS) || MAX_ERROR_ITEMS)),
    batchLimit: MAX_OBJECTS_PER_DAY,
    truncated: false,
    items: []
  };
}

async function buildErrorFeed(days, limitPerDay, filters, itemLimit) {
  const safeLimit = Math.max(1, Math.min(MAX_ERROR_ITEMS, Number(itemLimit || MAX_ERROR_ITEMS) || MAX_ERROR_ITEMS));
  const batchLimit = Math.max(1, Math.min(MAX_OBJECTS_PER_DAY, Number(limitPerDay || MAX_OBJECTS_PER_DAY) || MAX_OBJECTS_PER_DAY));
  const feed = makeEmptyErrorFeed(days, safeLimit);
  const byNameMap = Object.create(null);
  const bySeverityMap = Object.create(null);
  const byCategoryMap = Object.create(null);
  const prefixes = buildDayPrefixes(days);
  const clearedErrorIds = await loadClearedErrorIds(days);

  for (const prefix of prefixes) {
    const keys = sortKeysDesc(await listKeys(prefix, batchLimit));
    for (const key of keys) {
      const batch = await getJson(key);
      if (!batch || !Array.isArray(batch.events)) continue;
      feed.totals.batches += 1;
      batch.events.forEach((item) => {
        const evt = sanitizeEvent(item);
        if (!evt || evt.kind !== 'error') return;
        if (clearedErrorIds.has(evt.id)) return;
        const meta = Object.assign({}, classifyErrorMeta(evt.name), { source: inferErrorSource(evt) });
        if (!errorMatchesFilters(evt, filters, meta)) return;
        feed.totals.errors += 1;
        const nameKey = evt.name || 'error';
        if (!byNameMap[nameKey]) byNameMap[nameKey] = { name: nameKey, count: 0, lastAt: '' };
        byNameMap[nameKey].count += 1;
        if (!byNameMap[nameKey].lastAt || String(evt.iso || '') > String(byNameMap[nameKey].lastAt)) {
          byNameMap[nameKey].lastAt = String(evt.iso || '');
        }
        if (!bySeverityMap[meta.severity]) bySeverityMap[meta.severity] = { key: meta.severity, count: 0 };
        bySeverityMap[meta.severity].count += 1;
        if (!byCategoryMap[meta.category]) byCategoryMap[meta.category] = { key: meta.category, count: 0 };
        byCategoryMap[meta.category].count += 1;
        if (!feed.latestErrorAt || String(evt.iso || '') > String(feed.latestErrorAt)) {
          feed.latestErrorAt = String(evt.iso || '');
        }
        if (feed.items.length < safeLimit) feed.items.push(buildErrorFeedItem(evt, meta));
        else feed.truncated = true;
      });
    }
  }

  feed.items.sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0) || String(b.iso || '').localeCompare(String(a.iso || '')));
  feed.byName = Object.values(byNameMap)
    .sort((a, b) => b.count - a.count || String(b.lastAt || '').localeCompare(String(a.lastAt || '')))
    .slice(0, 40);
  feed.bySeverity = ERROR_SEVERITY_ORDER.map((key) => ({ key, count: bySeverityMap[key] ? bySeverityMap[key].count : 0 }));
  feed.byCategory = ERROR_CATEGORY_ORDER.map((key) => ({ key, count: byCategoryMap[key] ? byCategoryMap[key].count : 0 }));
  feed.filters = {
    deviceType: normalizeDeviceFilter(filters && filters.deviceType),
    severity: normalizeErrorSeverity(filters && filters.severity),
    category: normalizeErrorCategory(filters && filters.category),
    source: normalizeErrorSource(filters && filters.source)
  };
  feed.batchLimit = batchLimit;
  feed.totals.returned = feed.items.length;
  return feed;
}

async function buildSummary(days, limitPerDay, filters) {
  const summary = makeEmptySummary(days);
  const byNameMap = Object.create(null);
  const byDayMap = Object.create(null);
  const errorMap = Object.create(null);
  const dashboardAcc = makeDashboardAccumulator();
  const prefixes = buildDayPrefixes(days);
  const requestedLimit = Number(limitPerDay || 0) || 0;
  const batchLimit = normalizeSummaryLimit(limitPerDay);
  const clearedErrorIds = await loadClearedErrorIds(days);
  const scanState = { startedAt: Date.now(), scannedBatches: 0, scannedDays: 0, stopReason: '' };

  for (const prefix of prefixes) {
    scanState.stopReason = shouldStopSummaryScan(scanState);
    if (scanState.stopReason) break;
    const keys = sortKeysDesc(await listKeys(prefix, batchLimit));
    if (keys.length) scanState.scannedDays += 1;
    for (const key of keys) {
      scanState.stopReason = shouldStopSummaryScan(scanState);
      if (scanState.stopReason) break;
      const batch = await getJson(key);
      scanState.scannedBatches += 1;
      if (!batch || !Array.isArray(batch.events)) continue;
      summary.totals.batches += 1;
      batch.events.forEach((item) => {
        const evt = sanitizeEvent(item);
        if (!evt) return;
        if (!matchesFilters(evt, filters)) return;
        const isClearedError = evt.kind === 'error' && clearedErrorIds.has(evt.id);
        summary.totals.events += 1;
        if (evt.kind === 'error' && !isClearedError) summary.totals.errors += 1;
        const nameKey = evt.name;
        if (!isClearedError) {
          if (!byNameMap[nameKey]) byNameMap[nameKey] = { name: nameKey, count: 0, kind: evt.kind };
          byNameMap[nameKey].count += 1;
        }
        const dayKey = dayKeyFromTs(evt.ts);
        if (!byDayMap[dayKey]) byDayMap[dayKey] = { day: dayKey, total: 0, errors: 0 };
        byDayMap[dayKey].total += 1;
        if (evt.kind === 'error' && !isClearedError) byDayMap[dayKey].errors += 1;
        if (!isClearedError) {
          pushTopError(errorMap, evt);
          applyDashboardEvent(dashboardAcc, evt);
        }
        if (!summary.latestEventAt || String(evt.iso || '') > String(summary.latestEventAt)) summary.latestEventAt = String(evt.iso || '');
      });
    }
    if (scanState.stopReason) break;
  }

  summary.byName = Object.values(byNameMap).sort((a, b) => b.count - a.count).slice(0, 20);
  summary.byDay = Object.values(byDayMap)
    .map((item) => ({ day: item.day, total: item.total, events: item.total - item.errors, errors: item.errors }))
    .sort((a, b) => String(a.day).localeCompare(String(b.day)));
  summary.topErrors = Object.values(errorMap)
    .sort((a, b) => b.count - a.count || String(b.lastAt).localeCompare(String(a.lastAt)))
    .slice(0, MAX_RECENT_ERRORS);
  summary.filters = { deviceType: normalizeDeviceFilter(filters && filters.deviceType) };
  summary.dashboard = buildDashboardResult(dashboardAcc);
  summary.totals.sessions = summary.dashboard && summary.dashboard.sessionMetrics ? Number(summary.dashboard.sessionMetrics.sessions || 0) : 0;
  summary.partial = !!scanState.stopReason || requestedLimit > batchLimit;
  summary.scan = {
    requestedLimitPerDay: requestedLimit || SUMMARY_DEFAULT_OBJECTS_PER_DAY,
    appliedLimitPerDay: batchLimit,
    scannedBatches: scanState.scannedBatches,
    scannedDays: scanState.scannedDays,
    daysRequested: prefixes.length,
    maxBatchesTotal: SUMMARY_MAX_BATCHES_TOTAL,
    timeBudgetMs: SUMMARY_TIME_BUDGET_MS,
    elapsedMs: Math.max(0, Date.now() - scanState.startedAt),
    stopReason: scanState.stopReason || (requestedLimit > batchLimit ? 'limit_clamped' : '')
  };
  return summary;
}

async function handleClearErrors(event, payload) {
  const auth = requireTelemetryAdminAuth(event, { allowPresenceFallback: true });
  if (!auth.ok) return json(auth.statusCode, { ok: false, message: auth.message, code: auth.code });
  const body = payload && typeof payload === 'object' ? payload : {};
  const items = (Array.isArray(body.items) ? body.items : []).map(sanitizeClearItem).filter(Boolean).slice(0, MAX_ERROR_ITEMS);
  if (!items.length) {
    return json(400, { ok: false, message: 'items[] is required for clear_errors' });
  }
  const scope = body.scope && typeof body.scope === 'object' ? body.scope : {};
  const result = await persistClearedErrors(items, scope);
  return json(200, {
    ok: true,
    source: 'telemetry-collector',
    mode: 'clear_errors',
    clearedAt: nowIso(),
    cleared: Number(result.cleared || 0),
    markers: Number(result.markers || 0),
    dayCount: Number(result.dayCount || 0)
  });
}

async function handlePost(event) {
  const payload = JSON.parse(bodyString(event) || '{}');
  const qs = queryOf(event);
  const postMode = String((qs && qs.mode) || (payload && payload.mode) || (payload && payload.action) || '').toLowerCase();
  if (postMode === 'clear_errors') {
    if (!BUCKET) return json(500, { ok: false, message: 'TELEMETRY_S3_BUCKET/S3_BUCKET is not configured' });
    return await handleClearErrors(event, payload);
  }
  if (postMode === 'lead_submit') {
    return await handleLeadSubmit(payload);
  }
  if (!BUCKET) return json(500, { ok: false, message: 'TELEMETRY_S3_BUCKET/S3_BUCKET is not configured' });
  const rawEvents = Array.isArray(payload && payload.events) ? payload.events : [];
  const events = rawEvents.map(sanitizeEvent).filter(Boolean).slice(0, MAX_EVENTS_PER_POST);
  if (!events.length) return json(400, { ok: false, message: 'events[] is required' });
  const ts = Date.now();
  const key = uniqueBatchKey(ts);
  const batch = {
    ok: true,
    source: 'webar-client',
    savedAt: nowIso(),
    ip: '',
    path: pathOf(event),
    events
  };
  await putJson(key, batch);
  return json(200, { ok: true, stored: events.length, key, bucket: BUCKET });
}

async function handleGet(event) {
  if (!BUCKET) return json(500, { ok: false, message: 'TELEMETRY_S3_BUCKET/S3_BUCKET is not configured' });
  const qs = queryOf(event);
  const mode = String((qs && qs.mode) || 'summary').toLowerCase();
  if (mode === 'health') {
    return json(200, { ok: true, mode: 'health', bucket: BUCKET, prefix: PREFIX, version: RELEASE_VERSION, protectedModes: ['summary', 'errors', 'clear_errors'], auth: { strictSecretConfigured: !!getTelemetryAdminJwtSecret(), compatibilityFallbackForReadOnlyModes: true, compatibilityFallbackForClearErrors: true }, summaryDefaults: { defaultObjectsPerDay: SUMMARY_DEFAULT_OBJECTS_PER_DAY, maxObjectsPerDay: SUMMARY_MAX_OBJECTS_PER_DAY, maxBatchesTotal: SUMMARY_MAX_BATCHES_TOTAL, timeBudgetMs: SUMMARY_TIME_BUDGET_MS } });
  }
  if (mode === 'summary') {
    const auth = requireTelemetryAdminAuth(event, { allowPresenceFallback: true });
    if (!auth.ok) return json(auth.statusCode, { ok: false, message: auth.message, code: auth.code });
    const days = Math.max(1, Math.min(MAX_DAYS, Number(qs.days || 7) || 7));
    const requestedLimit = Number(qs.limit || 0) || 0;
    const deviceType = normalizeDeviceFilter(qs.deviceType || 'all');
    const summary = await buildSummary(days, requestedLimit, { deviceType });
    return json(200, summary);
  }
  if (mode === 'errors') {
    const auth = requireTelemetryAdminAuth(event, { allowPresenceFallback: true });
    if (!auth.ok) return json(auth.statusCode, { ok: false, message: auth.message, code: auth.code });
    const days = Math.max(1, Math.min(MAX_DAYS, Number(qs.days || 7) || 7));
    const limit = Math.max(1, Math.min(MAX_OBJECTS_PER_DAY, Number(qs.limit || MAX_OBJECTS_PER_DAY) || MAX_OBJECTS_PER_DAY));
    const deviceType = normalizeDeviceFilter(qs.deviceType || 'all');
    const severity = normalizeErrorSeverity(qs.severity || 'all');
    const category = normalizeErrorCategory(qs.category || 'all');
    const source = normalizeErrorSource(qs.source || 'all');
    const itemLimit = Math.max(1, Math.min(MAX_ERROR_ITEMS, Number(qs.items || qs.itemLimit || qs.maxItems || 300) || 300));
    const feed = await buildErrorFeed(days, limit, { deviceType, severity, category, source }, itemLimit);
    return json(200, feed);
  }
  return json(400, { ok: false, message: 'Unsupported mode' });
}

exports.handler = async function handler(event) {
  try {
    const method = methodOf(event);
    if (method === 'OPTIONS') return { statusCode: 204, headers: corsHeaders(), body: '' };
    if (method === 'POST') return await handlePost(event);
    if (method === 'GET') return await handleGet(event);
    return json(405, { ok: false, message: 'Method not allowed' });
  } catch (err) {
    return json(500, {
      ok: false,
      message: err && err.message ? err.message : 'Internal error',
      code: err && (err.name || err.code || '') ? String(err.name || err.code) : ''
    });
  }
};
