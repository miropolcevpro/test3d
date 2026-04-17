export function createArSessionHelpers(ctx = {}) {
  const {
    state,
    UI,
    renderer,
    updateTexLoadMaxParallel,
    setActiveScreen,
    setShapePickerOpen,
    updateArTopStripVar,
    updateArBottomStripVar,
    worldAnchorClear,
    startAR,
    disposeSelectionRuntime,
    disposeWarmupResources,
    trimTextureCaches,
    touchMaterialTextures,
    getTileMaterial,
    getPreviewPlane,
    getFillMesh,
  } = ctx;

  async function checkXrSupport() {
    if (!navigator.xr) return false;
    try {
      return await navigator.xr.isSessionSupported('immersive-ar');
    } catch {
      return false;
    }
  }

  function cleanupXR() {
    state.xrSession = null;
    try { updateTexLoadMaxParallel({ xrActive: !!(state && state.xrSession) }); } catch (_) {}
    state.referenceSpace = null;
    state.viewerSpace = null;
    state.hitTestSource = null;
    state.transientHitTestSource = null;
    state.transientHitPoses = new Map();

    try { worldAnchorClear(); } catch (_) {}
    try { document.getElementById('btnArRecenter')?.remove(); } catch (_) {}
    state._lock2ReticleSamples = [];
    state._lock2LastGateMsgT = 0;
    state._lastHitTestResult = null;
    state._lastHitPose = null;

    state.depthSupported = false;
    state.depthInfoSize = null;
    state.depthTexture = null;
    state.depthData = null;

    state.floorLocked = false;
    state.floorStable = false;
    state.floorY = 0;
    state.floorSamples = [];
    state.floorYEstimate = null;
    state.textureRotationDeg = 0;
    state.rotationPanelOpen = false;
    state.arTextureRailStartShapeId = '';
    state.arTextureGroups = [];
    state._arTextureGroupsSeq = (state._arTextureGroupsSeq || 0) + 1;
    state._arTextureGroupsPromise = null;

    try {
      const btnTextureRotate = document.getElementById('btnTextureRotate');
      if (btnTextureRotate) {
        btnTextureRotate.textContent = 'Вращение 0°';
        btnTextureRotate.classList.remove('active');
        btnTextureRotate.setAttribute('aria-expanded', 'false');
      }
      const rotationPanel = document.getElementById('rotationPanel');
      if (rotationPanel) rotationPanel.hidden = true;
      const rotationValue = document.getElementById('rotationValue');
      if (rotationValue) rotationValue.textContent = '0°';
      const rotationSlider = document.getElementById('rotationSlider');
      if (rotationSlider) rotationSlider.value = '0';
    } catch (_) {}

    if (ctx.reticle) ctx.reticle.visible = false;
    if (ctx.scanGrid) ctx.scanGrid.visible = false;
    if (ctx.previewPlane) ctx.previewPlane.visible = true;
    if (ctx.previewGrid) ctx.previewGrid.visible = true;

    try { disposeSelectionRuntime?.(); } catch (_) {}
    try { disposeWarmupResources?.(); } catch (_) {}
    try {
      const tileMaterial = getTileMaterial?.();
      const previewPlane = getPreviewPlane?.();
      const fillMesh = getFillMesh?.();
      if (tileMaterial) touchMaterialTextures?.(tileMaterial);
      if (previewPlane?.material) touchMaterialTextures?.(previewPlane.material);
      if (fillMesh?.material) touchMaterialTextures?.(fillMesh.material);
      trimTextureCaches?.({
        maxEntries: 24,
        maxAgeMs: 120000,
        protected: [tileMaterial, previewPlane?.material, fillMesh?.material].filter(Boolean),
      });
    } catch (_) {}

    try { setShapePickerOpen(false, { UI, updateArTopStripVar, updateArBottomStripVar }); } catch (_) {}
    if (!state._restartingAR) {
      setActiveScreen('detail', UI);
      state.phase = 'detail';
    }
  }

  async function stopAR() {
    const s = state.xrSession;
    if (!s) return;
    try {
      if (state._onXRSelect) s.removeEventListener('select', state._onXRSelect);
    } catch (_) {}
    try { await s.end(); } catch (_) {}
  }

  async function fullRestartAR() {
    if (state._startingAR || state._restartingAR) return;
    state._restartingAR = true;
    try {
      UI.btnArReset?.setAttribute('disabled', '');
      UI.btnArAdd?.setAttribute('disabled', '');
      UI.btnArOk?.setAttribute('disabled', '');
      UI.btnDone?.setAttribute('disabled', '');
    } catch (_) {}

    const s = state.xrSession;
    if (s) {
      await new Promise((resolve) => {
        const onEnd = () => resolve();
        try { s.addEventListener('end', onEnd, { once: true }); } catch (_) {}
        try { s.end().catch(() => resolve()); } catch (_) { resolve(); }
        setTimeout(resolve, 1200);
      });
    }

    try {
      await startAR();
    } finally {
      state._restartingAR = false;
      try {
        UI.btnArReset?.removeAttribute('disabled');
        UI.btnArAdd?.removeAttribute('disabled');
        UI.btnArOk?.removeAttribute('disabled');
        UI.btnDone?.removeAttribute('disabled');
      } catch (_) {}
    }
  }

  return { checkXrSupport, cleanupXR, stopAR, fullRestartAR };
}
