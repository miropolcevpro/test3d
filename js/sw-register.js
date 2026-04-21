// Service Worker register (soft update flow)
//
// Principles:
// - No network-response caching in SW itself.
// - One shared version source via js/sw-meta.js.
// - Skip waiting on updates, but avoid a forced reload on the very first install.
// - Never force-reload during active AR / recent interaction windows.
// - Prefer a soft deferred update with a visible, user-friendly prompt.

(function() {
  if (!('serviceWorker' in navigator)) return;

  var siteEnv = (typeof window !== 'undefined' && window.__SITE_ENV__) ? window.__SITE_ENV__ : null;
  var swMeta = (typeof window !== 'undefined' && window.__SW_META__) ? window.__SW_META__ : {};
  var swMessages = swMeta.messages || {};

  var SW_VERSION = String(swMeta.version || 'dev');
  var SW_FILENAME = String(swMeta.scriptFilename || 'sw.js');
  var SW_MSG_SKIP_WAITING = swMessages.skipWaiting || 'SKIP_WAITING';
  var SW_MSG_GET_VERSION = swMessages.getVersion || 'GET_VERSION';
  var SW_MSG_ACTIVATED = swMessages.activated || 'SW_ACTIVATED';
  var SW_SCOPE = (siteEnv && siteEnv.siteBasePath) ? siteEnv.siteBasePath : (function() {
    try {
      return new URL('./', window.location.href).pathname || '/';
    } catch (e) {
      return '/';
    }
  })();
  var SW_URL = (function() {
    try {
      if (siteEnv && typeof siteEnv.resolveSiteUrl === 'function') {
        return siteEnv.resolveSiteUrl(SW_FILENAME + '?v=' + encodeURIComponent(SW_VERSION));
      }
      var base = (siteEnv && siteEnv.siteBaseUrl) ? siteEnv.siteBaseUrl : window.location.href;
      return new URL(SW_FILENAME + '?v=' + encodeURIComponent(SW_VERSION), base).toString();
    } catch (e) {
      return SW_FILENAME + '?v=' + encodeURIComponent(SW_VERSION);
    }
  })();

  var STORAGE_KEY = 'sw:last-ack-version:' + SW_SCOPE;
  var isReloading = false;
  var suppressNextActivationReload = !navigator.serviceWorker.controller;
  var pendingReloadVersion = '';
  var pendingReloadSource = '';
  var pendingReloadQueuedAt = 0;
  var pendingReloadSnoozeUntil = 0;
  var applyTimer = 0;
  var idleGraceMs = 2800;
  var snoozeMs = 60000;
  var lastUserInteractionAt = Date.now();
  var updatePrompt = null;
  var updatePromptText = null;
  var updatePromptUpdateBtn = null;
  var updatePromptLaterBtn = null;

  function getAckVersion() {
    try {
      return sessionStorage.getItem(STORAGE_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  function setAckVersion(version) {
    if (!version) return;
    try {
      sessionStorage.setItem(STORAGE_KEY, String(version));
    } catch (e) {}
  }

  function requestSkipWaiting(reg) {
    try {
      if (reg && reg.waiting) {
        reg.waiting.postMessage({ type: SW_MSG_SKIP_WAITING });
      }
    } catch (e) {}
  }

  function reloadForVersion(version) {
    if (isReloading) return;
    isReloading = true;
    if (version) setAckVersion(version);
    hideUpdatePrompt();
    window.location.reload();
  }

  function extractVersionFromScriptUrl(scriptURL) {
    try {
      if (!scriptURL) return '';
      var url = new URL(String(scriptURL), window.location.href);
      return url.searchParams.get('v') || '';
    } catch (e) {
      return '';
    }
  }

  function queryControllerVersion(controller) {
    return new Promise(function(resolve) {
      if (!controller) {
        resolve('');
        return;
      }

      var fallbackVersion = extractVersionFromScriptUrl(controller.scriptURL);
      if (typeof MessageChannel === 'undefined') {
        resolve(fallbackVersion);
        return;
      }

      var settled = false;
      var channel = new MessageChannel();
      var timer = window.setTimeout(function() {
        if (settled) return;
        settled = true;
        resolve(fallbackVersion);
      }, 1200);

      channel.port1.onmessage = function(event) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        var data = event && event.data ? event.data : null;
        resolve(data && data.version ? String(data.version) : fallbackVersion);
      };

      try {
        controller.postMessage({ type: SW_MSG_GET_VERSION }, [channel.port2]);
      } catch (e) {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(fallbackVersion);
      }
    });
  }

  function readCurrentControllerVersion(options) {
    var controller = navigator.serviceWorker.controller;
    var persist = !options || options.persist !== false;
    if (!controller) return Promise.resolve('');
    return queryControllerVersion(controller).then(function(version) {
      if (persist && version) setAckVersion(version);
      return version;
    }).catch(function() {
      return '';
    });
  }

  function markUserInteraction() {
    lastUserInteractionAt = Date.now();
    if (pendingReloadVersion) schedulePendingReloadCheck(3200);
  }

  function isElementVisible(el) {
    if (!el) return false;
    if (typeof el.hasAttribute === 'function' && el.hasAttribute('hidden')) return false;
    try {
      var style = window.getComputedStyle(el);
      if (!style) return true;
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
    } catch (e) {}
    return true;
  }

  function isArScreenActive() {
    try {
      var el = document.getElementById('screenAR');
      return !!(el && el.classList.contains('screen--active') && isElementVisible(el));
    } catch (e) {
      return false;
    }
  }

  function isFatalUiVisible() {
    try {
      return isElementVisible(document.getElementById('appFatalState'));
    } catch (e) {
      return false;
    }
  }

  function hasRecentInteraction() {
    return (Date.now() - lastUserInteractionAt) < idleGraceMs;
  }

  function isReloadBlocked() {
    if (document.visibilityState !== 'visible') return true;
    if (document.fullscreenElement || document.webkitFullscreenElement) return true;
    if (document.body && document.body.classList && document.body.classList.contains('splash-active')) return true;
    if (isArScreenActive()) return true;
    if (hasRecentInteraction() && !isFatalUiVisible()) return true;
    return false;
  }

  function ensureUpdatePrompt() {
    if (updatePrompt && updatePrompt.parentNode) return updatePrompt;

    var host = document.createElement('div');
    host.id = 'swUpdatePrompt';
    host.setAttribute('hidden', '');
    host.setAttribute('aria-live', 'polite');
    host.style.position = 'fixed';
    host.style.left = '16px';
    host.style.right = '16px';
    host.style.bottom = '16px';
    host.style.zIndex = '9999';
    host.style.display = 'flex';
    host.style.justifyContent = 'center';
    host.style.pointerEvents = 'none';

    var card = document.createElement('div');
    card.style.maxWidth = '560px';
    card.style.width = '100%';
    card.style.pointerEvents = 'auto';
    card.style.borderRadius = '18px';
    card.style.padding = '14px 16px';
    card.style.background = 'rgba(18,23,31,0.94)';
    card.style.color = '#fff';
    card.style.boxShadow = '0 18px 40px rgba(0,0,0,0.26)';
    card.style.backdropFilter = 'blur(10px)';
    card.style.webkitBackdropFilter = 'blur(10px)';
    card.style.border = '1px solid rgba(255,255,255,0.12)';

    var title = document.createElement('div');
    title.textContent = 'Доступно обновление';
    title.style.fontSize = '14px';
    title.style.fontWeight = '800';
    title.style.marginBottom = '6px';

    var text = document.createElement('div');
    text.style.fontSize = '13px';
    text.style.lineHeight = '1.45';
    text.style.opacity = '0.92';

    var actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '10px';
    actions.style.flexWrap = 'wrap';
    actions.style.marginTop = '12px';

    var btnUpdate = document.createElement('button');
    btnUpdate.type = 'button';
    btnUpdate.textContent = 'Обновить';
    btnUpdate.style.border = '0';
    btnUpdate.style.borderRadius = '999px';
    btnUpdate.style.padding = '10px 14px';
    btnUpdate.style.fontSize = '13px';
    btnUpdate.style.fontWeight = '700';
    btnUpdate.style.cursor = 'pointer';
    btnUpdate.style.background = '#2d8cff';
    btnUpdate.style.color = '#fff';

    var btnLater = document.createElement('button');
    btnLater.type = 'button';
    btnLater.textContent = 'Позже';
    btnLater.style.border = '1px solid rgba(255,255,255,0.16)';
    btnLater.style.borderRadius = '999px';
    btnLater.style.padding = '10px 14px';
    btnLater.style.fontSize = '13px';
    btnLater.style.fontWeight = '700';
    btnLater.style.cursor = 'pointer';
    btnLater.style.background = 'transparent';
    btnLater.style.color = '#fff';

    actions.appendChild(btnUpdate);
    actions.appendChild(btnLater);
    card.appendChild(title);
    card.appendChild(text);
    card.appendChild(actions);
    host.appendChild(card);

    btnUpdate.addEventListener('click', function() {
      if (pendingReloadVersion) {
        reloadForVersion(pendingReloadVersion);
      }
    });

    btnLater.addEventListener('click', function() {
      pendingReloadSnoozeUntil = Date.now() + snoozeMs;
      hideUpdatePrompt();
      schedulePendingReloadCheck(snoozeMs + 500);
    });

    document.body.appendChild(host);
    updatePrompt = host;
    updatePromptText = text;
    updatePromptUpdateBtn = btnUpdate;
    updatePromptLaterBtn = btnLater;
    return host;
  }

  function showUpdatePrompt() {
    if (!pendingReloadVersion) return;
    var host = ensureUpdatePrompt();
    if (!host) return;
    var message = isArScreenActive()
      ? 'Новая версия готова. Обновление будет применено после выхода из режима визуализации или по кнопке ниже.'
      : 'Новая версия готова. Мы не перезагружаем страницу во время активного действия. Можно обновить сейчас или чуть позже.';
    if (updatePromptText) updatePromptText.textContent = message;
    if (updatePromptUpdateBtn) updatePromptUpdateBtn.disabled = false;
    if (updatePromptLaterBtn) updatePromptLaterBtn.disabled = false;
    host.removeAttribute('hidden');
  }

  function hideUpdatePrompt() {
    if (!updatePrompt) return;
    updatePrompt.setAttribute('hidden', '');
  }

  function schedulePendingReloadCheck(delayMs) {
    if (!pendingReloadVersion || isReloading) return;
    if (applyTimer) window.clearTimeout(applyTimer);
    applyTimer = window.setTimeout(function() {
      applyTimer = 0;
      tryApplyPendingReload(false);
    }, Math.max(250, Number(delayMs) || 0));
  }

  function queuePendingReload(version, source) {
    pendingReloadVersion = String(version || '');
    pendingReloadSource = String(source || '');
    pendingReloadQueuedAt = Date.now();
    showUpdatePrompt();
    schedulePendingReloadCheck(3500);
  }

  function tryApplyPendingReload(force) {
    if (!pendingReloadVersion || isReloading) return false;
    if (!force) {
      if (pendingReloadSnoozeUntil && Date.now() < pendingReloadSnoozeUntil) {
        schedulePendingReloadCheck((pendingReloadSnoozeUntil - Date.now()) + 300);
        return false;
      }
      if (isReloadBlocked()) {
        showUpdatePrompt();
        schedulePendingReloadCheck(3000);
        return false;
      }
    }
    var version = pendingReloadVersion;
    pendingReloadVersion = '';
    pendingReloadSource = '';
    pendingReloadQueuedAt = 0;
    pendingReloadSnoozeUntil = 0;
    reloadForVersion(version);
    return true;
  }

  function handleActivatedVersion(version, source) {
    var nextVersion = version ? String(version) : '';
    if (!nextVersion) return;

    if (suppressNextActivationReload) {
      setAckVersion(nextVersion);
      suppressNextActivationReload = false;
      return;
    }

    if (getAckVersion() === nextVersion) return;

    if (isReloadBlocked()) {
      queuePendingReload(nextVersion, source || 'activated');
      return;
    }

    reloadForVersion(nextVersion);
  }

  navigator.serviceWorker.register(SW_URL, {
    scope: SW_SCOPE,
    updateViaCache: 'none'
  })
    .then(function(reg) {
      readCurrentControllerVersion({ persist: true }).catch(function() {});

      try { reg.update(); } catch (e) {}
      requestSkipWaiting(reg);

      reg.addEventListener('updatefound', function() {
        var installing = reg.installing;
        if (!installing) return;

        installing.addEventListener('statechange', function() {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            requestSkipWaiting(reg);
          }
        });
      });
    })
    .catch(function(err) {
      console.warn('[SW] register failed', err);
    });

  navigator.serviceWorker.addEventListener('message', function(event) {
    var data = event && event.data ? event.data : null;
    if (!data) return;

    if (data.type === SW_MSG_ACTIVATED) {
      handleActivatedVersion(data.version, 'message');
    }
  });

  navigator.serviceWorker.addEventListener('controllerchange', function() {
    window.setTimeout(function() {
      readCurrentControllerVersion({ persist: false }).then(function(version) {
        if (!version) return;
        if (suppressNextActivationReload) {
          setAckVersion(version);
          suppressNextActivationReload = false;
          return;
        }
        if (getAckVersion() !== version) {
          handleActivatedVersion(version, 'controllerchange');
        }
      }).catch(function() {});
    }, 150);
  });

  window.addEventListener('pointerdown', markUserInteraction, true);
  window.addEventListener('touchstart', markUserInteraction, true);
  window.addEventListener('keydown', markUserInteraction, true);
  window.addEventListener('mousedown', markUserInteraction, true);
  window.addEventListener('focus', function() {
    schedulePendingReloadCheck(600);
  });
  document.addEventListener('visibilitychange', function() {
    if (document.visibilityState === 'visible') {
      schedulePendingReloadCheck(600);
    }
  });
  window.addEventListener('pageshow', function() {
    schedulePendingReloadCheck(600);
  });
})();
