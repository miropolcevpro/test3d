import * as THREE from 'three';

export function createSelectionHelpers(ctx) {
  let selectTileSeq = 0;
  let prefetchTimer = null;
  let prefetchSeq = 0;
  let heavyMapsTimer = null;
  let heavyMapsSeq = 0;

  function setLayout(layout) {
    if (layout !== 'straight' && layout !== 'diagonal') layout = 'straight';

    ctx.state.layout = layout;
    if (ctx.UI.layoutSelect) ctx.UI.layoutSelect.value = layout;
    const tileMaterial = ctx.getTileMaterial();
    if (tileMaterial) {
      tileMaterial.uniforms.uLayoutMode.value = layout === 'diagonal' ? 1 : 0;
    }
    ctx.UI.finalPatterns?.querySelectorAll('.patternTab').forEach(btn => {
      btn.classList.toggle('patternTab--active', btn.dataset.layout === layout);
    });
    ctx.UI.layoutRow?.querySelectorAll('.layoutCard').forEach(btn => {
      btn.classList.toggle('layoutCard--active', btn.dataset.layout === layout);
    });
  }

  function crossfadeFillMeshToMaterial(newMat, durationMs = 140) {
    try {
      const fillMesh = ctx.getFillMesh();
      const scene = ctx.scene;
      if (!fillMesh) return;
      const oldMat = fillMesh.material;

      if (!oldMat || !scene) {
        fillMesh.material = newMat;
        fillMesh.material.needsUpdate = true;
        try { newMat.transparent = false; newMat.depthWrite = true; newMat.depthTest = true; } catch (_) {}
        if (newMat.uniforms && newMat.uniforms.uAlpha) newMat.uniforms.uAlpha.value = 1.0;
        return;
      }

      const oldFlags = { transparent: !!oldMat.transparent, depthWrite: oldMat.depthWrite !== false, depthTest: oldMat.depthTest !== false };

      if (oldMat.uniforms && oldMat.uniforms.uAlpha) oldMat.uniforms.uAlpha.value = 1.0;
      if (newMat.uniforms && newMat.uniforms.uAlpha) newMat.uniforms.uAlpha.value = 0.0;

      try {
        oldMat.transparent = true;
        newMat.transparent = true;
        oldMat.depthWrite = false;
        newMat.depthWrite = false;
        oldMat.depthTest = true;
        newMat.depthTest = true;
      } catch (_) {}

      const overlay = new THREE.Mesh(fillMesh.geometry, newMat);
      overlay.position.copy(fillMesh.position);
      overlay.quaternion.copy(fillMesh.quaternion);
      overlay.scale.copy(fillMesh.scale);
      overlay.frustumCulled = false;
      overlay.renderOrder = (fillMesh.renderOrder || 0) + 1;
      overlay.updateMatrix();
      overlay.matrixAutoUpdate = false;
      scene.add(overlay);

      const t0 = performance.now();
      const ease = (k) => k * k * (3.0 - 2.0 * k);

      const step = (now) => {
        const k = ctx.clamp((now - t0) / Math.max(1, durationMs), 0, 1);
        const a = ease(k);
        if (oldMat.uniforms && oldMat.uniforms.uAlpha) oldMat.uniforms.uAlpha.value = 1.0 - a;
        if (newMat.uniforms && newMat.uniforms.uAlpha) newMat.uniforms.uAlpha.value = a;

        if (k < 1) {
          requestAnimationFrame(step);
          return;
        }

        try { scene.remove(overlay); } catch (_) {}
        fillMesh.material = newMat;
        fillMesh.material.needsUpdate = true;

        try {
          newMat.transparent = false;
          newMat.depthWrite = true;
          newMat.depthTest = true;
        } catch (_) {}
        if (newMat.uniforms && newMat.uniforms.uAlpha) newMat.uniforms.uAlpha.value = 1.0;

        try {
          oldMat.transparent = oldFlags.transparent;
          oldMat.depthWrite = oldFlags.depthWrite;
          oldMat.depthTest = oldFlags.depthTest;
        } catch (_) {}

        try {
          if (oldMat && oldMat !== newMat && oldMat.dispose && oldMat.uniforms && oldMat.uniforms.uTex) {
            oldMat.dispose();
          }
        } catch (_) {}
      };

      requestAnimationFrame(step);
    } catch (_) {
      try {
        const fillMesh = ctx.getFillMesh();
        if (!fillMesh) return;
        fillMesh.material = newMat;
        fillMesh.material.needsUpdate = true;
        try { newMat.transparent = false; newMat.depthWrite = true; newMat.depthTest = true; } catch (_) {}
        if (newMat.uniforms && newMat.uniforms.uAlpha) newMat.uniforms.uAlpha.value = 1.0;
      } catch (_) {}
    }
  }

  function scheduleDeferredHeavyMaps(mat, urls, preferredQuality, isStaleFn, opts = {}) {
    try {
      if (heavyMapsTimer) clearTimeout(heavyMapsTimer);
      const mySeq = ++heavyMapsSeq;

      const delayMs = typeof opts.delayMs === 'number' ? opts.delayMs : 1200;
      const debounceMs = typeof opts.debounceMs === 'number' ? opts.debounceMs : 350;
      const startedAt = performance.now();

      heavyMapsTimer = setTimeout(async () => {
        if (mySeq !== heavyMapsSeq) return;
        if (isStaleFn && isStaleFn()) return;

        let slowNet = false;
        try {
          const { eff, downlink, rtt, saveData } = ctx.getConnInfo();
          if (saveData) return;
          if (/slow-2g|2g|3g/i.test(eff)) slowNet = true;
          if (downlink && downlink < 2) slowNet = true;
          if (rtt && rtt > 800) slowNet = true;
        } catch (_) {}

        const dt = performance.now() - startedAt;
        if (dt < debounceMs) return;

        const { aoUrl, heightUrl } = urls || {};
        const tasks = [];
        if (aoUrl) tasks.push(['ao', aoUrl]);
        if (!slowNet && heightUrl) tasks.push(['height', heightUrl]);
        if (!tasks.length) return;

        const rs = await Promise.all(tasks.map(async ([kind, u]) => {
          try {
            const tex = await ctx.loadTexSmartCached(u, kind, preferredQuality, isStaleFn, { priority: 'normal' });
            if (isStaleFn && isStaleFn()) return null;
            ctx.applyMapToTileMaterial(mat, kind, tex || null);
            try { opts.onMapApplied?.(kind, tex || null); } catch (_) {}
            return tex || null;
          } catch (_) {
            try { opts.onMapApplied?.(kind, null); } catch (_) {}
            return null;
          }
        }));
        if (isStaleFn && isStaleFn()) return;
        const fillMesh = ctx.getFillMesh();
        if (fillMesh && ctx.state.phase === 'ar_final') {
          fillMesh.material = mat;
          fillMesh.material.needsUpdate = true;
        }
      }, delayMs);
    } catch (_) {}
  }

  function schedulePrefetchAdjacentTiles(currentTile, list = null) {
    try {
      if (!currentTile) return;
      const { eff, downlink, saveData } = ctx.getConnInfo();
      if (saveData) return;
      if (/slow-2g|2g|3g/i.test(eff)) return;
      if (downlink && downlink < 2) return;
      const tuning = (typeof ctx.getSurfaceRuntimeTuning === 'function') ? ctx.getSurfaceRuntimeTuning({ inAR: ctx.state.phase === 'ar_final' }) : null;
      const maxNeighbors = Math.max(0, Math.min(2, Number(tuning?.prefetchNeighbors ?? 1) || 0));
      if (maxNeighbors <= 0) return;
      const tiles = Array.isArray(list) ? list : (Array.isArray(ctx.state.currentAllowedTiles) ? ctx.state.currentAllowedTiles : ctx.state.tiles);
      if (!Array.isArray(tiles) || tiles.length < 2) return;

      const idx = tiles.findIndex(x => String(x.id) === String(currentTile.id));
      if (idx < 0) return;

      const neighbors = [];
      if (idx + 1 < tiles.length) neighbors.push(tiles[idx + 1]);
      if (idx - 1 >= 0) neighbors.push(tiles[idx - 1]);
      neighbors.length = Math.min(neighbors.length, maxNeighbors);

      const mySeq = ++prefetchSeq;

      if (prefetchTimer) clearTimeout(prefetchTimer);
      prefetchTimer = setTimeout(async () => {
        if (mySeq !== prefetchSeq) return;

        let preferredQuality = (tuning && tuning.prefetchQuality) ? tuning.prefetchQuality : ctx.getPreferredSurfaceQuality({ inAR: ctx.state.phase === 'ar_final' });
        const params = (currentTile && currentTile.params && typeof currentTile.params === 'object') ? currentTile.params : null;
        const fq = (params && typeof params.forceQuality === 'string') ? params.forceQuality.trim().toLowerCase() : '';
        if (fq === '1k' || fq === '2k') preferredQuality = fq;

        for (const nt of neighbors) {
          if (mySeq !== prefetchSeq) return;

          const aUrl = (nt.maps && nt.maps.albedo) ? nt.maps.albedo : nt.texture;
          const rUrl = (nt.maps && nt.maps.roughness) ? nt.maps.roughness : null;
          const nUrl = (nt.maps && nt.maps.normal) ? nt.maps.normal : null;

          const prefetchKinds = Array.isArray(tuning?.prefetchMapKinds) ? tuning.prefetchMapKinds : ['albedo','roughness'];
          const warmKinds = Array.isArray(tuning?.warmupMapKinds) ? tuning.warmupMapKinds : ['albedo'];
          const aTexP = prefetchKinds.includes('albedo') ? ctx.loadTexSmartCached(aUrl, 'albedo', '1k', null, { priority: 'normal' }) : Promise.resolve(null);
          const rTexP = (rUrl && prefetchKinds.includes('roughness')) ? ctx.loadTexSmartCached(rUrl, 'roughness', preferredQuality, null, { priority: 'normal' }) : Promise.resolve(null);
          const nTexP = (nUrl && prefetchKinds.includes('normal')) ? ctx.loadTexSmartCached(nUrl, 'normal', preferredQuality, null, { priority: 'normal' }) : Promise.resolve(null);

          const aTex = await aTexP;
          if (aTex && warmKinds.includes('albedo')) ctx.warmupTextureOnGPU(aTex, true, ctx.renderer);

          const rTex = await rTexP;
          if (rTex && warmKinds.includes('roughness')) ctx.warmupTextureOnGPU(rTex, false, ctx.renderer);

          const nRes = await ctx.withTimeout(nTexP, 220);
          if (nRes.ok && nRes.v && warmKinds.includes('normal')) ctx.warmupTextureOnGPU(nRes.v, false, ctx.renderer);
        }
      }, Math.max(80, Number(tuning?.prefetchDelayMs ?? 180) || 180));
    } catch (_) {}
  }

  async function selectTile(tileOrId) {
    let t = null;
    if (tileOrId && typeof tileOrId === 'object') {
      t = tileOrId;
    } else {
      const id = tileOrId;
      t = ctx.state.tiles.find(x => x.id === id)
        || (Array.isArray(ctx.state.currentAllowedTiles) ? ctx.state.currentAllowedTiles.find(x => x.id === id) : null)
        || null;
    }
    if (!t) return;

    const mySeq = ++selectTileSeq;
    const isStale = () => mySeq !== selectTileSeq;

    const prevTile = ctx.state.selectedTile;
    ctx.state.selectedTile = t;

    const albedoCandidates = ctx.getTileAlbedoCandidates(t);
    const albedoUrl = albedoCandidates[0] || '';
    const normalUrl = (t.maps && t.maps.normal) ? t.maps.normal : null;
    const roughUrl = (t.maps && t.maps.roughness) ? t.maps.roughness : null;
    const aoUrl = (t.maps && t.maps.ao) ? t.maps.ao : null;
    const heightUrl = (t.maps && t.maps.height) ? t.maps.height : null;

    const params = t.params || {};
    const ns = typeof params.normalScale === 'number' ? params.normalScale : (typeof t.normalScale === 'number' ? t.normalScale : 0.0);
    const bs = typeof params.bumpScale === 'number' ? params.bumpScale : (typeof t.bumpScale === 'number' ? t.bumpScale : 0.0);

    const tuning = (typeof ctx.getSurfaceRuntimeTuning === 'function') ? ctx.getSurfaceRuntimeTuning({ inAR: ctx.state.phase === 'ar_final' }) : null;
    const preferredQuality = (tuning && tuning.preferredQuality) ? tuning.preferredQuality : ctx.getPreferredSurfaceQuality({ inAR: ctx.state.phase === 'ar_final' });

    const showTexProgress = ctx.state.phase === 'ar_final';
    const texProgSeq = showTexProgress ? (ctx.arTexProgress.seq + 1) : 0;
    const coreProgressMaps = [
      albedoUrl ? { key: 'albedo', label: 'Цвет' } : null,
      roughUrl ? { key: 'roughness', label: 'Шерох.' } : null,
      normalUrl ? { key: 'normal', label: 'Рельеф' } : null,
      aoUrl ? { key: 'ao', label: 'AO' } : null,
    ].filter(Boolean);
    if (showTexProgress && coreProgressMaps.length) {
      ctx.arTexProgressShow(texProgSeq, coreProgressMaps, { label: 'Загрузка текстуры…', delayMs: 450 });
    }

    const markCoreMap = (key, promise) => {
      if (!showTexProgress || !promise) return promise;
      return Promise.resolve(promise).then((v) => {
        const ok = (key === 'albedo') ? !!(v && v.tex) : !!v;
        ctx.arTexProgressMapUpdate?.(texProgSeq, key, ok ? 'loaded' : 'failed');
        return v;
      }).catch((err) => {
        ctx.arTexProgressMapUpdate?.(texProgSeq, key, 'failed');
        throw err;
      });
    };

    const albedoP = markCoreMap('albedo', ctx.loadTileAlbedoWithFallback(t, preferredQuality, isStale, { priority: 'high', getTileAlbedoCandidates: ctx.getTileAlbedoCandidates }));
    const roughP = roughUrl ? markCoreMap('roughness', ctx.loadTexSmartCached(roughUrl, 'roughness', preferredQuality, isStale, { priority: 'high' })) : Promise.resolve(null);
    const aoP = aoUrl ? markCoreMap('ao', ctx.loadTexSmartCached(aoUrl, 'ao', preferredQuality, isStale, { priority: 'high' })) : Promise.resolve(null);
    const normalP = normalUrl ? markCoreMap('normal', ctx.loadTexSmartCached(normalUrl, 'normal', preferredQuality, isStale, { priority: 'normal' })) : Promise.resolve(null);

    if (showTexProgress) {
      if (!albedoUrl) ctx.arTexProgressMapUpdate?.(texProgSeq, 'albedo', 'skipped', { label: 'Цвет' });
      if (!roughUrl) ctx.arTexProgressMapUpdate?.(texProgSeq, 'roughness', 'skipped', { label: 'Шерох.' });
      if (!normalUrl) ctx.arTexProgressMapUpdate?.(texProgSeq, 'normal', 'skipped', { label: 'Рельеф' });
      if (!aoUrl) ctx.arTexProgressMapUpdate?.(texProgSeq, 'ao', 'skipped', { label: 'AO' });
    }

    const albedoResult = await albedoP;
    if (isStale()) return;

    let albedoTex = albedoResult ? albedoResult.tex : null;
    const activeAlbedoUrl = (albedoResult && albedoResult.sourceUrl) ? albedoResult.sourceUrl : albedoUrl;

    if (albedoResult && albedoResult.usedFallback && activeAlbedoUrl) {
      console.warn(`[surfaces] albedo fallback applied for ${t.id}: ${activeAlbedoUrl}`);
    }

    if (!albedoTex) {
      console.warn('[surfaces] albedo missing, keeping previous material for stability:', albedoCandidates);
      ctx.state.selectedTile = prevTile || ctx.state.selectedTile;
      return;
    }

    const size = t.tileSizeM || { w: 0.2, h: 0.2 };

    let uvScaleX = 1.0, uvScaleY = 1.0;
    const uvp = (params && (params.uvScale ?? params.repeatScale)) ?? null;
    if (typeof uvp === 'number') { uvScaleX = uvScaleY = uvp; }
    else if (uvp && typeof uvp === 'object') {
      if (typeof uvp.x === 'number') uvScaleX = uvp.x;
      if (typeof uvp.y === 'number') uvScaleY = uvp.y;
    }

    const ag = (params && typeof params.albedoGain === 'number') ? params.albedoGain : 1.0;
    const rm = (params && typeof params.roughnessMult === 'number') ? params.roughnessMult : 1.0;
    const ss = (params && typeof params.specStrength === 'number') ? params.specStrength : 1.0;
    const em = (params && typeof params.exposureMult === 'number')
      ? params.exposureMult
      : ctx.computeAutoExposureMultFromTexture(albedoTex);

    const previewPlane = ctx.getPreviewPlane();
    if (previewPlane && previewPlane.material) {
      const pm = previewPlane.material;
      try {
        const g = previewPlane.geometry;
        if (g && g.attributes && g.attributes.uv && !g.attributes.uv2) {
          g.setAttribute('uv2', new THREE.BufferAttribute(g.attributes.uv.array, 2));
        }
      } catch (_) {}

      pm.map = albedoTex;
      if (pm.map && pm.map.repeat) pm.map.repeat.set((3 / size.w) * uvScaleX, (3 / size.h) * uvScaleY);
      pm.needsUpdate = true;
      try { ctx.touchMaterialTextures?.(pm); } catch (_) {}
    }

    let roughTex = null;
    let aoTexCore = null;
    let normalTex = null;

    if (ctx.state && ctx.state.phase === 'ar_final') {
      roughTex = await roughP;
      if (isStale()) return;
      aoTexCore = await aoP;
      if (isStale()) return;
      const normalR = await ctx.withTimeout(normalP, 350);
      if (isStale()) return;
      normalTex = normalR.ok ? normalR.v : null;
    } else {
      const coreWaitMs = Math.max(180, Number(tuning?.coreWaitMs ?? 260) || 260);
      const roughR = await ctx.withTimeout(roughP, coreWaitMs);
      const aoR = await ctx.withTimeout(aoP, coreWaitMs);
      const normalR = await ctx.withTimeout(normalP, coreWaitMs);
      if (isStale()) return;
      roughTex = roughR.ok ? roughR.v : null;
      aoTexCore = aoR.ok ? aoR.v : null;
      normalTex = normalR.ok ? normalR.v : null;
    }

    let tileMaterial = ctx.getTileMaterial();
    if (!tileMaterial) {
      tileMaterial = ctx.makeTileMaterial({
        albedoTex,
        normalTex,
        roughnessTex: roughTex,
        aoTex: aoTexCore,
        heightTex: null,
        normalScale: ns || 0.0,
        bumpScale: bs || 0.0,
      });
      ctx.setTileMaterial(tileMaterial);
    }

    const mat = tileMaterial;
    if (mat.uniforms.uNormalScale) mat.uniforms.uNormalScale.value = ns || 0.0;
    if (mat.uniforms.uBumpScale) mat.uniforms.uBumpScale.value = bs || 0.0;
    if (mat.uniforms.uTileSize) mat.uniforms.uTileSize.value.set(size.w, size.h);
    if (mat.uniforms.uUvScale) mat.uniforms.uUvScale.value.set(uvScaleX, uvScaleY);
    if (mat.uniforms.uAlbedoGain) mat.uniforms.uAlbedoGain.value = ag;
    if (mat.uniforms.uRoughnessMult) mat.uniforms.uRoughnessMult.value = rm;
    if (mat.uniforms.uSpecStrength) mat.uniforms.uSpecStrength.value = ss;
    if (mat.uniforms.uExposureMult) mat.uniforms.uExposureMult.value = em;

    ctx.applyMapToTileMaterial(mat, 'roughness', roughTex);
    ctx.applyMapToTileMaterial(mat, 'ao', aoTexCore);
    ctx.applyMapToTileMaterial(mat, 'normal', normalTex);
    ctx.applyMapToTileMaterial(mat, 'height', null);

    setLayout(ctx.state.layout);

    if (ctx.state.phase === 'ar_final') {
      ctx.crossfadeAlbedoOnMaterial(mat, albedoTex, 140);
    } else {
      ctx.applyMapToTileMaterial(mat, 'albedo', albedoTex);
    }

    const fillMesh = ctx.getFillMesh();
    if (fillMesh) {
      fillMesh.material = mat;
      fillMesh.material.needsUpdate = true;
    }
    try {
      ctx.touchMaterialTextures?.(mat);
      const previewPlaneNow = ctx.getPreviewPlane?.();
      if (previewPlaneNow?.material) ctx.touchMaterialTextures?.(previewPlaneNow.material);
      ctx.trimTextureCaches?.({
        maxEntries: ctx.state.phase === 'ar_final' ? 28 : 40,
        maxAgeMs: ctx.state.phase === 'ar_final' ? 120000 : 300000,
        protected: [mat, previewPlaneNow?.material].filter(Boolean),
      });
    } catch (_) {}

    if (ctx.UI.detailHero) {
      if (!(ctx.state.selectedShape && Array.isArray(ctx.state.selectedShape.gallery) && ctx.state.selectedShape.gallery.length)) {
        const hero = t.preview || (t.maps && t.maps.albedo) || t.texture || '';
        ctx.UI.detailHero.style.backgroundImage = hero ? `url(${hero})` : 'none';
      }
    }

    const tileKey = String(t.id);
    const updateSwatches = (wrap) => {
      wrap?.querySelectorAll('[data-tile-id]').forEach(el => {
        el.classList.toggle('swatch--active', tileKey === el.dataset.tileId);
      });
    };
    updateSwatches(ctx.UI.colorRow);
    updateSwatches(ctx.UI.finalColors);

    if (ctx.UI.arProductTitle) ctx.UI.arProductTitle.textContent = t.name || '—';

    const refineJobsPlanned = [];
    if (preferredQuality === '2k') refineJobsPlanned.push('albedo2k');
    if (normalUrl) refineJobsPlanned.push('normal');
    if (roughUrl) refineJobsPlanned.push('roughness');
    if (ctx.state.phase === 'ar_final') {
      if (!aoTexCore && aoUrl) refineJobsPlanned.push('ao');
      if (tuning?.loadHeightInAR && heightUrl) refineJobsPlanned.push('height');
    } else {
      if (!aoTexCore && aoUrl) refineJobsPlanned.push('ao');
      if (tuning?.loadHeightOutsideAR && heightUrl) refineJobsPlanned.push('height');
    }

    const matRef = mat;
    const deferMs = Math.max(40, Number(tuning?.postApplyDelayMs ?? 80) || 80);
    setTimeout(async () => {
      if (isStale()) return;

      let refineProgSeq = 0;
      if (showTexProgress && refineJobsPlanned.length) {
        refineProgSeq = texProgSeq + 1;
        const refineProgressMaps = refineJobsPlanned.map((kind) => ({ key: kind, label: kind === 'albedo2k' ? 'Цвет 2k' : (kind === 'roughness' ? 'Шерох.' : (kind === 'normal' ? 'Рельеф' : (kind === 'height' ? 'Height' : 'AO'))) }));
        ctx.arTexProgressShowImmediate(refineProgSeq, refineProgressMaps, { label: 'Улучшение качества…' });
      }
      const refineMapDone = (key, status = 'loaded') => {
        if (refineProgSeq) ctx.arTexProgressMapUpdate?.(refineProgSeq, key, status);
      };

      if (preferredQuality === '2k') {
        const albedo2k = await ctx.loadTexSmartCached(activeAlbedoUrl, 'albedo', preferredQuality, isStale, { priority: 'normal' });
        if (!isStale() && albedo2k && albedo2k !== albedoTex) {
          ctx.applyMapToTileMaterial(matRef, 'albedo', albedo2k);
          const previewPlane2 = ctx.getPreviewPlane();
          if (previewPlane2 && previewPlane2.material) {
            previewPlane2.material.map = albedo2k;
            previewPlane2.material.needsUpdate = true;
            try { ctx.touchMaterialTextures?.(previewPlane2.material); } catch (_) {}
          }
          try { ctx.touchMaterialTextures?.(matRef); } catch (_) {}
        }
        refineMapDone('albedo2k');
      }

      const jobs = [
        ['normal', normalUrl],
        ['roughness', roughUrl],
      ].filter(([kind]) => {
        const warmKinds = Array.isArray(tuning?.warmupMapKinds) ? tuning.warmupMapKinds : ['albedo','roughness'];
        return kind === 'roughness' || warmKinds.includes('normal') || ctx.state.phase !== 'ar_final';
      });

      await Promise.all(jobs.map(async ([kind, u]) => {
        try {
          const tex = await ctx.loadTexSmartCached(u, kind, preferredQuality, isStale, { priority: 'normal' });
          if (isStale()) return null;
          ctx.applyMapToTileMaterial(matRef, kind, tex || null);

          const previewPlane3 = ctx.getPreviewPlane();
          if (previewPlane3 && previewPlane3.material && previewPlane3.material.isMeshStandardMaterial) {
            const pm = previewPlane3.material;
            if (kind === 'normal') {
              pm.normalMap = tex || null;
              pm.normalScale?.set?.(ns || 0.0, ns || 0.0);
            } else if (kind === 'roughness') {
              pm.roughnessMap = tex || null;
            }
            pm.needsUpdate = true;
            try { ctx.touchMaterialTextures?.(pm); } catch (_) {}
          }
          refineMapDone(kind, tex ? 'loaded' : 'failed');
          return tex || null;
        } catch (_) {
          refineMapDone(kind, 'failed');
          return null;
        }
      }));
      if (isStale()) return;

      const fillMesh2 = ctx.getFillMesh();
      if (fillMesh2 && ctx.state.phase === 'ar_final') {
        fillMesh2.material = matRef;
        fillMesh2.material.needsUpdate = true;
      }
      try {
        const previewPlaneNow2 = ctx.getPreviewPlane?.();
        ctx.touchMaterialTextures?.(matRef);
        if (previewPlaneNow2?.material) ctx.touchMaterialTextures?.(previewPlaneNow2.material);
        ctx.trimTextureCaches?.({
          maxEntries: Number(tuning?.trimMaxEntries ?? (ctx.state.phase === 'ar_final' ? 28 : 40)) || 40,
          maxAgeMs: Number(tuning?.trimMaxAgeMs ?? (ctx.state.phase === 'ar_final' ? 120000 : 300000)) || 300000,
          protected: [matRef, previewPlaneNow2?.material].filter(Boolean),
        });
      } catch (_) {}

      if (ctx.state.phase === 'ar_final') {
        scheduleDeferredHeavyMaps(matRef, { aoUrl: (aoTexCore ? null : aoUrl), heightUrl: (tuning?.loadHeightInAR ? heightUrl : null) }, '1k', isStale, { delayMs: Number(tuning?.heavyMapsDelayMs ?? 1200) || 1200, debounceMs: Number(tuning?.heavyMapsDebounceMs ?? 350) || 350, onMapApplied: (kind) => refineMapDone(kind || 'heavy') });
      } else {
        const heavyJobs = [
          ['ao', (aoTexCore ? null : aoUrl)],
          ['height', (tuning?.loadHeightOutsideAR ? heightUrl : null)],
        ].filter(([_, u]) => !!u);
        if (heavyJobs.length) {
          await Promise.all(heavyJobs.map(async ([kind, u]) => {
            try {
              const tex = await ctx.loadTexSmartCached(u, kind, preferredQuality, isStale, { priority: 'normal' });
              if (isStale()) return null;
              ctx.applyMapToTileMaterial(matRef, kind, tex || null);
              const previewPlane4 = ctx.getPreviewPlane();
              if (previewPlane4 && previewPlane4.material && previewPlane4.material.isMeshStandardMaterial) {
                const pm = previewPlane4.material;
                if (kind === 'ao') pm.aoMap = tex || null;
                else if (kind === 'height') { pm.bumpMap = tex || null; pm.bumpScale = bs || 0.0; }
                pm.needsUpdate = true;
                try { ctx.touchMaterialTextures?.(pm); } catch (_) {}
              }
              refineMapDone(kind, tex ? 'loaded' : 'failed');
              return tex || null;
            } catch (_) {
              refineMapDone(kind, 'failed');
              return null;
            }
          }));
          if (isStale()) return;
        }
      }
      try {
        const previewPlaneNow3 = ctx.getPreviewPlane?.();
        ctx.touchMaterialTextures?.(matRef);
        if (previewPlaneNow3?.material) ctx.touchMaterialTextures?.(previewPlaneNow3.material);
        ctx.trimTextureCaches?.({
          maxEntries: Number(tuning?.trimMaxEntries ?? (ctx.state.phase === 'ar_final' ? 28 : 40)) || 40,
          maxAgeMs: Number(tuning?.trimMaxAgeMs ?? (ctx.state.phase === 'ar_final' ? 120000 : 300000)) || 300000,
          protected: [matRef, previewPlaneNow3?.material].filter(Boolean),
        });
      } catch (_) {}
    }, deferMs);

    schedulePrefetchAdjacentTiles(t);
  }

  function disposeSelectionRuntime() {
    try { if (prefetchTimer) clearTimeout(prefetchTimer); } catch (_) {}
    try { if (heavyMapsTimer) clearTimeout(heavyMapsTimer); } catch (_) {}
    prefetchTimer = null;
    heavyMapsTimer = null;
    prefetchSeq += 1;
    heavyMapsSeq += 1;
    selectTileSeq += 1;
  }

  return {
    setLayout,
    selectTile,
    schedulePrefetchAdjacentTiles,
    crossfadeFillMeshToMaterial,
    disposeSelectionRuntime,
  };
}
