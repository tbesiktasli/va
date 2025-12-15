function fitTextToContainer(container, maxFontSize = 100, minFontSize = 7) {
  // Prefer the scaling-text span if you have it, but fall back to any span
  const span = container.querySelector('.scaling-text') || container.querySelector('span');
  if (!span) return;

  // Optional: burger icon we added for the fallback state
  const placeholder = container.querySelector('.text-placeholder-icon');

  // --- Reset visual state so we can measure correctly ---
  container.classList.remove('text-too-small');

  span.style.display = 'inline-block';  // participate in flex layout for measurement
  span.style.opacity = '';              // clear any old opacity-based hiding
  span.style.whiteSpace = 'pre-wrap';
  //span.style.wordWrap = 'break-word';
  span.style.minWidth = '0';            // allow flex item to shrink inside flex container

  if (placeholder) {
    placeholder.style.display = 'none'; // hidden by default in normal case
  }

  // Account for container padding so text fits inside the card
  const cs = getComputedStyle(container);
  const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const targetW = parseFloat(container.style.width)  || container.clientWidth;
  const targetH = parseFloat(container.style.height) || container.clientHeight;
  
  const availW = Math.max(0, targetW - padX);
  const availH = Math.max(0, targetH - padY);
  
  span.style.maxWidth = `${availW}px`;

  // If there is literally no space, fall back immediately
  if (availW <= 0 || availH <= 0) {
    container.classList.add('text-too-small');
    span.style.display = 'none';
    if (placeholder) placeholder.style.display = 'block';
    return;
  }

  // --- Pre-check the smallest font size (minFontSize) ---
  span.style.fontSize = `${minFontSize}px`;
  const minFits =
    span.scrollWidth  <= availW &&
    span.scrollHeight <= availH;

  if (!minFits) {
    // Even the smallest size does not fit → show burger icon instead of text
    container.classList.add('text-too-small');
    span.style.display = 'none';
    if (placeholder) placeholder.style.display = 'block';
    return;
  }

  // At least minFontSize fits; now binary-search for the largest size that still fits
  let low = minFontSize;
  let high = maxFontSize;
  let best = minFontSize;

  while (low <= high) {
    const mid = (low + high) >> 1;
    span.style.fontSize = `${mid}px`;

    const fits =
      span.scrollWidth  <= availW &&
      span.scrollHeight <= availH;

    if (fits) {
      best = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  // Final normal state: text visible, icon hidden
  span.style.fontSize = `${best}px`;
  span.style.display = 'inline-block';
  container.classList.remove('text-too-small');
  if (placeholder) placeholder.style.display = 'none';
}
window.fitTextToContainer = fitTextToContainer;

export class Grid {
    constructor(gridId='grid', objects, groups) {
      this.gridId = gridId;
      this.htmlGridElement = document.getElementById(gridId);
      this.viewportEl = document.getElementById('workspace') || document.documentElement;
      this.display = {
        // change this default to make everything appear larger/smaller at start
        baseZoom: 1, // e.g. 1.25 for bigger, 0.85 for smaller
      
        // NEW: hard limits for how far you can zoom in/out
        // (tweak these numbers if you want a wider/narrower zoom range)
        minZoom: 0.25,
        maxZoom: 4,
      
        objectScale: 0.8, // NEW: starting size for all objects (1 = keep original)
        detailConnectingTagLimit: null,

        textPadBase: 20, // px at zoom = 1
        textPadMin:  6,  // px floor when zooming out
      };
      
      this.objects = objects;
      // NEW: pre-scale object widths/heights so initial zoom can remain 1
      const s = (this.display?.objectScale ?? 1);
      if (s !== 1) {
        for (const o of this.objects) {
          o.width  = Math.max(1, Math.round(o.width  * s));
          o.height = Math.max(1, Math.round(o.height * s));
        }
      }
      this.groups = groups || {};
      this.zoomLevel = 1;
      this._updateGridTextPadding();
      // NEW: display config (initial/reset zoom)
      this._grid = [];
      this._setState('grouped');
      this._detail = { active: false };
      this._clusterTimer = null;

      // Single Audio() instance for hover TTS on tiles
      this._hoverTtsAudio = null;

      // Tunables for grouped layout (increase to spread items apart)
      this.GROUPED_SPREAD = 38;  // was ~16
      this.GROUPED_JITTER = 28;  // was ~6
  
      this.gridDimension = {
        width: 0,
        height: 0
      };
  
      this.gridSectionDimension = {
        'width': 200,
        'height': 180,
        'marginX': 80, // was 60
        'marginY': 60, // was 40
        'offsetX': 40,
      }

      // NEW: per-mode spacing configuration
      this.spacing = {
        ungrouped: {
          // distance between sections (i.e., distance between objects in ungrouped view)
          sectionGapX: this.gridSectionDimension.marginX,
          sectionGapY: this.gridSectionDimension.marginY,
        },
        cluster: {
          // minimum pixels between items inside a cluster
          itemGap: 25, // was 12
          // extra clearance between clusters beyond their footprint radii
          groupGap: 100,
          // global multiplier applied to cluster radii before center layout
          spread: 1.25,
        }
      };

      this.detailConfig = {
        // default: square-ish detail
        ungrouped: {
          width: 480,
          height: 480,
          // explicit portrait dimensions
          portraitWidth: 560,
          portraitHeight: 330,
          margin: 80,
        },
        clustered: {
          width: 480,
          height: 480,
          portraitWidth: 560,
          portraitHeight: 330,
          margin: 80,
        },
        // Mobile-specific behaviour
        mobile: {
          // match your CSS: @media (max-width: 768px)
          breakpoint: 768,
          // target fraction of viewport size on the grid
          viewportFraction: 0.9,
          // (optional) allow different fractions per axis later:
          // viewportWidthFraction: 0.9,
          // viewportHeightFraction: 0.9,
        },
      };
      
      this.createGrid();
      this.addObjectsRandomly();
      // ✨ NEW: snapshot initial ungrouped layout so we can always go back to it
      for (const o of this.objects) {
        if (o._ungroupedX == null) {
          o._ungroupedX = o.grid_x;
          o._ungroupedY = o.grid_y;
        }
      }
      this.computeDynamicGroupCenters();
      this.applyGroupedScatter(this.GROUPED_SPREAD, this.GROUPED_JITTER);
      this.fitToView('grouped', 200);
      this.initDrag(); // performance
      this.initWheelBlock();
      //this.groupObjects();
      this.groupObjectsInstant();
      if (window.DEBUG_GRID_ANIM) this._installAnimDebug();
      // Always do a post-paint text refit (even without base zoom)
      requestAnimationFrame(() => this._refitAllText?.());
      // And again once web fonts are fully ready
      if (document.fonts?.ready) {
        document.fonts.ready.then(() => this._refitAllText?.());
      }
      // NEW: apply initial base zoom once the grouped view is in place
      if (this.display?.baseZoom && this.display.baseZoom !== 1) {
        this.resetZoomToBase(/*animate*/ false);
        // After first paint, refit once more (layout is fully settled)
        requestAnimationFrame(() => this._refitAllText?.());

        // When web fonts finish loading, refit again (fixes first-load overflow)
        if (document.fonts && document.fonts.ready) {
          document.fonts.ready.then(() => this._refitAllText?.());
        }
      }
    }

    _updateGridTextPadding() {
      const gridEl = this.htmlGridElement;
      if (!gridEl) return;
    
      const cfg  = this.display || {};
      const base = cfg.textPadBase ?? 20;
      const min  = cfg.textPadMin  ?? 6;
    
      const z = this.zoomLevel || 1;
    
      // Only shrink when zooming out (cap at base for zoom>=1)
      const padPx = Math.max(min, Math.min(base, base * z));
    
      gridEl.style.setProperty('--grid-text-pad', `${padPx}px`);
    }    

    _installAnimDebug() {
      const gridEl = this.htmlGridElement;
      if (!gridEl || gridEl.__animDebugInstalled) return;
      gridEl.__animDebugInstalled = true;
    
      const handler = (ev) => {
        if (!ev.target?.classList?.contains('object')) return;
        if (ev.propertyName && ev.propertyName !== 'transform') return;
    
        const id = ev.target.id;
        const tr = getComputedStyle(ev.target).transform;
    
        console.debug(`[grid-anim ${ev.type}]`, {
          t: Number(performance.now().toFixed(1)),
          id,
          prop: ev.propertyName,
          state: this.currentState,
          transform: tr,
        });
      };
    
      ['transitionrun', 'transitionstart', 'transitionend', 'transitioncancel']
        .forEach(type => gridEl.addEventListener(type, handler, true));
    
      console.debug('[grid-anim] transition debug installed');
    }    

    // Keep Grid state in sync with a DOM attribute so CSS can react (e.g., disable glows in grouped view)
    _setState(next) {
      this.currentState = next;
      if (this.htmlGridElement) {
        this.htmlGridElement.dataset.view = next;
      }
    }

    _vw() { return this.viewportEl?.clientWidth  || window.innerWidth; }
    _vh() { return this.viewportEl?.clientHeight || window.innerHeight; }

    _isMobileViewport() {
      const cfg = this.detailConfig?.mobile || {};
      const breakpoint = cfg.breakpoint ?? 768;
      const vw = this._vw?.() ?? window.innerWidth;
      return vw <= breakpoint;
    }

    // Adjust a detail panel size for mobile so it fills ~90% of the viewport
    _applyMobileDetailSizing(width, height) {
      const cfg = this.detailConfig?.mobile || {};
      const breakpoint = cfg.breakpoint ?? 768;
    
      const vw = this._vw?.() ?? window.innerWidth;
      const vh = this._vh?.() ?? window.innerHeight;
    
      // Not in mobile breakpoint → keep original size
      if (vw > breakpoint) return { width, height };
    
      const fracW = cfg.viewportWidthFraction ?? cfg.viewportFraction ?? 0.9;
      const fracH = cfg.viewportHeightFraction ?? cfg.viewportFraction ?? 0.9;
    
      const zoom = this.zoomLevel || 1;
    
      // On mobile we *override* the detail size so that on screen it is
      // ~90% of the viewport in each direction, independent of the base config.
      return {
        width:  (fracW * vw) / zoom,
        height: (fracH * vh) / zoom,
      };
    }    

    // Approximate how large a group "pile" is in grouped view
    _groupedPileRadius(groupMembers, scatterStep = 16, padding = 18) {
      const n = groupMembers.length;
      // spiral radius ~ step * sqrt(n)
      let maxDim = 0;
      for (const o of groupMembers) {
        maxDim = Math.max(maxDim, Math.max(o.width, o.height));
      }
      // generous: object half-size + spiral radius + padding
      return Math.max(60, scatterStep * Math.sqrt(Math.max(1, n)) + 0.5 * maxDim + padding);
    }

    // Push overlapping centers apart until they clear by (Ri+Rj+margin)
    _relaxCenters(centers, radii, { margin = 40, iterations = 60, anchorX, anchorY } = {}) {
      const gids = Object.keys(centers);
      for (let it = 0; it < iterations; it++) {
        let moved = false;
        for (let i = 0; i < gids.length; i++) {
          for (let j = i + 1; j < gids.length; j++) {
            const a = gids[i], b = gids[j];
            const A = centers[a], B = centers[b];
            let dx = B.x - A.x, dy = B.y - A.y;
            let dist = Math.hypot(dx, dy) || 0.0001;
            const need = radii[a] + radii[b] + margin;
            if (dist < need) {
              const push = (need - dist) * 0.5;
              const nx = dx / dist, ny = dy / dist;
              A.x -= nx * push; A.y -= ny * push;
              B.x += nx * push; B.y += ny * push;
              moved = true;
            }
          }
        }
        if (!moved) break;
      }
      // recentre cloud so it stays around the viewport centre
      if (anchorX != null && anchorY != null) {
        let cx = 0, cy = 0;
        for (const g of gids) { cx += centers[g].x; cy += centers[g].y; }
        cx /= gids.length; cy /= gids.length;
        const dx = anchorX - cx, dy = anchorY - cy;
        for (const g of gids) { centers[g].x += dx; centers[g].y += dy; }
      }
      return centers;
    }

    // Helper: center of world (grid coordinates)
    _getWorldCenter() {
      return { x: this.gridDimension.width / 2, y: this.gridDimension.height / 2 };
    }

    _syncPanStateFromDom() {
      if (!this._pan) return; // safe if pan system not initialized yet
      const left = parseFloat(this.htmlGridElement.style.left) || 0;
      const top  = parseFloat(this.htmlGridElement.style.top)  || 0;
      this._pan.currentX = this._pan.targetX = left;
      this._pan.currentY = this._pan.targetY = top;
    }

    // Estimate a circular radius needed to place this group's objects without overlap
    estimateClusterRadius(objs, buffer = 10) {
      let area = 0;
      for (const o of objs) {
        area += (o.width + buffer) * (o.height + buffer);
      }
      const packingEff = 0.7; // rectangles in a cluster pack ~70% efficiently
      return Math.sqrt((area / packingEff) / Math.PI);
    }

    // Push each group's center outward along its current ray to make clusters more distant
    computeClusterCentersRadial(radiiMap, ringScale = 1.6, baseGap = 100) {
      const cx = this.gridDimension.width  / 2;
      const cy = this.gridDimension.height / 2;

      const centers = {};
      for (const gid of Object.keys(radiiMap)) {
        const g = this.groups[gid];              // current (grouped) center
        const dx = g.x - cx, dy = g.y - cy;
        const r0 = Math.hypot(dx, dy) || 1;      // current distance from center
        const ang = Math.atan2(dy, dx);

        const need = radiiMap[gid] + baseGap;    // how much extra space this group wants
        const rTarget = Math.max(r0 * ringScale, r0 + need);

        centers[gid] = { x: cx + Math.cos(ang) * rTarget,
                        y: cy + Math.sin(ang) * rTarget };
      }
      return centers;
    }

    centerViewportOnWorldPoint(worldX, worldY, animate = true) {
      const zoom = this.zoomLevel || 1;
      const desiredLeft = (this._vw()/2) - worldX * zoom;
      const desiredTop  = (this._vh()/2) - worldY * zoom;
    
      const w = parseFloat(this.htmlGridElement.style.width)  || (this.gridDimension.width  * zoom);
      const h = parseFloat(this.htmlGridElement.style.height) || (this.gridDimension.height * zoom);
    
      const baseMinX = Math.min(0, this._vw() - w);
      const baseMinY = Math.min(0, this._vh() - h);
    
      const needSlackX = Math.max(0, desiredLeft - 0, baseMinX - desiredLeft);
      const needSlackY = Math.max(0, desiredTop  - 0, baseMinY - desiredTop);
      const needSlack  = Math.max(needSlackX, needSlackY);
    
      if (this._pan && animate) {
        this._pan.slack = Math.max(this._pan.slack || 0, needSlack);
        this._pan.targetX = desiredLeft;
        this._pan.targetY = desiredTop;
        this._pan.vx = 0; this._pan.vy = 0;
        this._startPanLoop?.();
      } else {
        this.htmlGridElement.style.left = `${desiredLeft}px`;
        this.htmlGridElement.style.top  = `${desiredTop}px`;
        this._syncPanStateFromDom?.();
      }
    }    
    
    clampCameraToBounds(animate = true, reason = 'generic') {
      const zoom = this.zoomLevel || 1;
      const w = parseFloat(this.htmlGridElement.style.width)  || (this.gridDimension.width  * zoom);
      const h = parseFloat(this.htmlGridElement.style.height) || (this.gridDimension.height * zoom);

      const vw = this._vw();
      const vh = this._vh();

      // legal range (no slack)
      const minX = Math.min(0, vw - w);
      const minY = Math.min(0, vh - h);

      const curLeft = parseFloat(this.htmlGridElement.style.left) || 0;
      const curTop  = parseFloat(this.htmlGridElement.style.top)  || 0;

      const targetX = Math.max(minX, Math.min(0, curLeft));
      const targetY = Math.max(minY, Math.min(0, curTop));

      const prevSlack = this._pan?.slack;

      // Optional debug logging (set window.DEBUG_GRID_CLAMP = false to turn this off)
      const debugClamp =
        (typeof window !== 'undefined') &&
        window.DEBUG_GRID_CLAMP !== false &&
        typeof console !== 'undefined' &&
        typeof console.groupCollapsed === 'function';

      if (debugClamp) {
        console.groupCollapsed('[grid clamp]', reason);
        console.log('zoom', zoom, 'animate', animate);
        console.log('gridDimension', this.gridDimension);
        console.log('css size', { w, h }, 'viewport', { vw, vh });
        console.log('bounds', { minX, minY }, 'current', { curLeft, curTop }, 'target', { targetX, targetY });
        console.log('panSlackBefore', prevSlack);
        console.groupEnd();
      }

      // kill overscroll allowance so we glide back inside
      if (this._pan) this._pan.slack = 0;

      if (this._pan && animate) {
        this._pan.targetX = targetX;
        this._pan.targetY = targetY;
        this._pan.vx = 0; this._pan.vy = 0;
        this._startPanLoop?.();   // kick the RAF loop if needed
      } else {
        this.htmlGridElement.style.left = `${targetX}px`;
        this.htmlGridElement.style.top  = `${targetY}px`;
        this._syncPanStateFromDom?.();
      }
    }    

    _formatDetailDate(dateLike) {
      if (!dateLike) return '';
      const d = new Date(dateLike);
      if (isNaN(d.getTime())) return '';
      const dd = String(d.getDate()).padStart(2, '0');
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const yyyy = d.getFullYear();
      // Same as object detail page: DD/MM/YYYY
      return `${dd}/${mm}/${yyyy}`;
    }

    // Shared inline detail panel for both ungrouped and clustered flows
    _createInlineDetailPanel(el, obj, {
      from = this.currentState,
      onClose = () => {},
    } = {}) {
      const panel = document.createElement('div');
      let wsInline = null;  // ✅ add
      const formattedDate = this._formatDetailDate(obj.date);
      // text objects → use Name if present, else Description
      // everything else → always Description
      let primaryText = '';
      if (obj.type === 'text') {
        primaryText = (obj.name && obj.name.trim())
          ? obj.name.trim()
          : (obj.description || '').trim();
      } else {
        primaryText = (obj.description || '').trim();
      }
      panel.className = 'detail-panel';
      if (obj.type === 'text') {
        panel.classList.add('detail-text-object');
      }

      // Limit number of connecting tags in inline detail panel (optional)
      const allConnectingTags = Array.isArray(obj.connectingTags) ? obj.connectingTags : [];
      const maxDetailTags = this.display?.detailConnectingTagLimit;
      const detailConnectingTags = (
        typeof maxDetailTags === 'number' && maxDetailTags > 0
          ? allConnectingTags.slice(0, maxDetailTags)
          : allConnectingTags
      );

      panel.innerHTML = `
        <button class="detail-close" aria-label="Close"></button>

        <!-- top date for NON-portrait -->
        <div class="detail-date-top">${formattedDate}</div>
        ${
          (obj.type === 'image' && obj.image) ||
          (obj.type === 'video' && obj.video) ||
          (obj.type === 'audio' && obj.audio)
            ? `
              <div class="detail-media ${obj.type === 'audio' ? 'audio' : ''}">
                ${obj.type === 'image' ? `<img src="${obj.image}" alt="">` : ''}
                ${obj.type === 'video' ? `<video src="${obj.video}" controls playsinline style="width:100%;height:auto"></video>` : ''}
                ${obj.type === 'audio' ? `<div class="wave" aria-label="Waveform"></div>` : ''}
              </div>
              `
            : ''
        }
        <div class="detail-info">
          <div class="detail-date-inline">${formattedDate}</div>
            ${primaryText ? `<div class="detail-description" data-allow-scroll>${primaryText}</div>` : ''}
          <div class="detail-group">${obj.groupLocation || ''}</div>
          <div class="detail-tags-row detail-tags-row--scroll" data-allow-scroll>
            <ul class="detail-tags tags">
              ${detailConnectingTags.map(t => `<li>${t}</li>`).join('')}
            </ul>
          </div>
          <a class="detail-link" href="#" target="_blank" rel="noopener">
            Discover
            <svg class="detail-link-icon"
                viewBox="0 0 33 18"
                aria-hidden="true"
                fill="currentColor" stroke="currentColor">
              <path d="M32.8,9.49l-8.31,8.31c-.27.27-.71.27-.98,0s-.27-.71,0-.98l7.13-7.13H.69c-.38,0-.69-.31-.69-.69s.31-.69.69-.69h29.94l-7.12-7.12c-.27-.27-.27-.71,0-.98s.71-.27.98,0l8.31,8.31c.27.27.27.71,0,.98Z"/>
            </svg>
          </a>
        </div>
      `;

      // Only use portrait layout on non-mobile screens for portrait media
      const mobileCfg  = this.detailConfig?.mobile || {};
      const breakpoint = mobileCfg.breakpoint ?? 768;
      const viewportW  = this._vw?.() ?? window.innerWidth;
      const isMobile   = viewportW <= breakpoint;

      const isPortraitMedia =
        (obj.type === 'image' || obj.type === 'video') &&
        ((obj.height || 0) > (obj.width || 0));

      if (!isMobile && isPortraitMedia) {
        panel.classList.add('portrait');
      }

      el.appendChild(panel);
      requestAnimationFrame(() => panel.classList.add('visible'));

      // --- close button
      panel.querySelector('.detail-close')?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        onClose();
      });

      // --- inline WaveSurfer for audio detail panels
      if (obj.type === 'audio' && obj.audio) {
        const waveEl = panel.querySelector('.detail-media.audio .wave');
        if (waveEl) {
          // create using shared helper if available
          if (window.createWave) {
            wsInline = window.createWave(waveEl, obj.audio, { height: 70 });
          } else if (window.WaveSurfer) {
            wsInline = window.WaveSurfer.create({
              container: waveEl,
              height: 70,
              barWidth: 1,
              barGap: 1,
              normalize: true,
              responsive: true,
              interact: true,
              cursorWidth: 1,
            });
            wsInline.load(obj.audio);
          }

          panel.__wsInline = wsInline; // allow exitDetail() to destroy reliably

          // click toggles play/pause; stopPropagation prevents closing detail
          waveEl.addEventListener('click', (e) => {
            e.stopPropagation();
            wsInline?.playPause?.();
          });

          waveEl.addEventListener('mouseenter', (e) => {
            e.stopPropagation();
            try { wsInline?.play?.(); } catch {}
          }, { passive: true });

          waveEl.addEventListener('mouseleave', (e) => {
            e.stopPropagation();
            try { wsInline?.pause?.(); } catch {}
          }, { passive: true });
        }
      }

      // --- Open → full-page detail
      const openLink = panel.querySelector('.detail-link');
      if (openLink) {
        openLink.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          // keep your current signature
          window.openObjectDetail?.({
            objectId: obj.id,
            from,
            gid: obj.groupId,
          });
        });
      }

      // --- tags
      const tagList = panel.querySelector('.detail-tags');
      if (tagList) {
        // annotate
        tagList.querySelectorAll('li').forEach(li => {
          li.dataset.tag = li.textContent.trim();
        });

        const repaint = () => {
          tagList.querySelectorAll('li').forEach(li => {
            const t = li.dataset.tag;
            const on = !!(window.activeTags && window.activeTags.has(t));
            const c  = (window.tagColors && window.tagColors[t]) || '';
            li.classList.toggle('active', on);
            li.style.borderColor = on && c ? c : '#000';
            li.style.color       = on && c ? c : '';
            li.style.boxShadow   = on && c ? `${c}66 0 0 8px` : '';
          });
        };

        // initial paint
        repaint();

        tagList.addEventListener('click', (ev) => {
          const li = ev.target.closest('li');
          if (!li) return;
          ev.stopPropagation();
          const tag = li.dataset.tag;

          // call whichever exists
          if (typeof window.toggleTagFromDetail === 'function') {
            window.toggleTagFromDetail(tag);
          } else if (typeof toggleTagFromDetail === 'function') {
            toggleTagFromDetail(tag);
          }

          repaint();
        });
      }

      return panel;
    }

    // Remove any inline detail panels that might still be attached to grid cards
    _removeAllInlineDetailPanels() {
      if (!this.htmlGridElement) return;

      const panels = this.htmlGridElement.querySelectorAll('.detail-panel');
      panels.forEach((panel) => {
        try { panel.__wsInline?.destroy?.(); } catch {}
        panel.remove();
      });
    }

    enterDetail(objectId, opts = {}) {
      if (this.currentState !== 'ungrouped' || this._detail?.active) return;
    
      const obj = this.objects.find(o => o.id === objectId);
      if (!obj) return;

      // Stop any hover TTS audio when opening inline detail
      this.stopHoverTts();

      // Desktop UX: if the grid is zoomed, snap back to base zoom *before* opening inline detail.
      // Mobile keeps its own "almost fullscreen" sizing behavior.
      if (!this._isMobileViewport?.()) {
        const baseZ = (this.display?.baseZoom ?? 1);
        const curZ  = (this.zoomLevel || 1);
        if (Math.abs(curZ - baseZ) > 1e-3) {
          // Make the zoom reset instant (no width/height animation), so detail open feels deliberate.
          this._setObjectTransitionsEnabled?.(false);
          this.setZoomAbsolute?.(baseZ, { center: false, animate: false });
          (this._forceLayoutFlush ? this._forceLayoutFlush() : void this.htmlGridElement?.offsetHeight);
          this._setObjectTransitionsEnabled?.(true);

          this.clampCameraToBounds?.(false, 'detail-reset-zoom');
          this._syncPanStateFromDom?.();
        }
      }
    
      const el = document.getElementById(obj.id);

      // centralize sizes
      const baseCfg = (this.detailConfig && this.detailConfig.ungrouped) ? this.detailConfig.ungrouped : {};
      const {
        size   = baseCfg.size   ?? baseCfg.width ?? 500,
        margin = baseCfg.margin ?? 80,
        width,
        height,
        portraitWidth  = baseCfg.portraitWidth  ?? baseCfg.width  ?? size,
        portraitHeight = baseCfg.portraitHeight ?? baseCfg.height ?? size,
      } = opts;
    
      // Focus object center (world coords)
      const ocx = obj.grid_x + obj.width / 2;
      const ocy = obj.grid_y + obj.height / 2;
    
      // Expand IN PLACE (keep center fixed)
      let W = width  || size;
      let H = height || size;

      // If the focused object is portrait image/video, add +100px width
      const objIsPortraitMedia =
        (obj && (obj.type === 'image' || obj.type === 'video')) &&
        ((obj.height || 0) > (obj.width || 0));

      if (objIsPortraitMedia) {
        W = portraitWidth;
        H = portraitHeight;
      }

      // Mobile override: expand card to ~90% of viewport on small screens
      const mobileSize = this._applyMobileDetailSizing(W, H);
      W = mobileSize.width;
      H = mobileSize.height;

      const targetLeft = ocx - W / 2;
      const targetTop  = ocy - H / 2;
      const dx = targetLeft - obj.grid_x;
      const dy = targetTop  - obj.grid_y;
    
      // Save prev + mark active
      this._detail = {
          active: true, id: obj.id, size, width: W, height: H, margin,
          prevState: this.currentState,
          pushed: true,
          source: 'ungrouped',
        prev: {
          width: obj.width,
          height: obj.height,
          bg: el.style.backgroundImage || '',
          transform: el.style.transform || '',
          className: el.className
        }
      };  
    
      // Lift above others & fade small content
      el.classList.add('is-detail', 'detail-fade-out');
      if (obj.type === 'image') el.style.backgroundImage = 'none';
      this.pauseAllVideos?.();
    
      // Start the tile expansion on next frame
      requestAnimationFrame(() => {
          const z = this.zoomLevel || 1;
          el.style.width  = `${W * z}px`;
          el.style.height = `${H * z}px`;
          el.style.transform = `translate(${dx * z}px, ${dy * z}px)`;
      });
    
      // IMPORTANT: center the camera NOW (no delay) so slack is granted before spring-back runs
      this.centerViewportOnWorldPoint(ocx, ocy, /*animate*/ true);
      this._startPanLoop?.();  // if you added startPanLoop; otherwise _ensurePanTick is fine
    
      // Local, distance-based push: strong near, fades quickly; far tiles barely move
      // const detailRadius = size / 2 + margin;
      const detailRadius = Math.max(W, H) / 2 + margin;
      const center = { x: ocx, y: ocy };
      const falloff = Math.max(280, margin * 4);
      const epsilon = 4;
    
      for (const other of this.objects) {
        if (other.id === obj.id) continue;
    
        const otherEl = document.getElementById(other.id);
        const ocx2 = other.grid_x + other.width / 2;
        const ocy2 = other.grid_y + other.height / 2;
    
        let vx = ocx2 - center.x;
        let vy = ocy2 - center.y;
        let r  = Math.hypot(vx, vy) || 0.0001;
    
        const otherR = 0.5 * Math.hypot(other.width, other.height) + 6;
        const needed = detailRadius + otherR + epsilon;
    
        const nx = vx / r, ny = vy / r;
        let newR = r;
    
        if (r <= needed) {
          newR = needed; // hard clearance
        } else {
          const R0 = needed, R1 = needed + falloff;
          if (r < R1) {
            const t = (R1 - r) / (R1 - R0);           // 0..1
            const s = t * t * (3 - 2 * t);            // smoothstep
            const maxPush = 40 + margin * 0.25;       // cap
            const dr = Math.min(maxPush, (R1 - r) * 0.35 * s);
            newR = r + dr;
          }
        }
    
        const newCx = center.x + nx * newR;
        const newCy = center.y + ny * newR;
    
        const newLeft = newCx - other.width / 2;
        const newTop  = newCy - other.height / 2;
    
        const ddx = newLeft - other.grid_x;
        const ddy = newTop  - other.grid_y;
    
        //otherEl.style.transform = `translate(${ddx}px, ${ddy}px)`;
        const z = this.zoomLevel || 1;
        otherEl.style.transform = `translate(${ddx * z}px, ${ddy * z}px)`;
      }
    
      // Add the detail panel UI and fade it in
      // Add the detail panel UI and fade it in (shared)
      this._createInlineDetailPanel(el, obj, {
        from: 'ungrouped',
        onClose: () => this.exitDetail(),
      });

      const onEsc = (e) => { if (e.key === 'Escape') this.exitDetail(); };
      window.addEventListener('keydown', onEsc, { once: true });
    
      this.prevState = this.currentState;
      this.currentState = 'detail';
    }

    // Clustered detail: keep the arrangement, push neighbors outward to make room,
    // and open the focused card *at the cluster center* (0.75× baseSize; 50% larger than the previous cluster detail).
    enterClusterDetail(objectId, { baseSize = 400, margin = 80, gap = 12 } = {}) {
      if (this.currentState !== 'clustered' || this._detail?.active) return;
    
      const obj = this.objects.find(o => o.id === objectId);
      if (!obj) return;

      // Stop any hover TTS audio when opening clustered inline detail
      this.stopHoverTts();

      // Desktop UX: if the grid is zoomed, snap back to base zoom *before* opening clustered detail.
      // Mobile keeps its own "almost fullscreen" sizing behavior.
      if (!this._isMobileViewport?.()) {
        const baseZ = (this.display?.baseZoom ?? 1);
        const curZ  = (this.zoomLevel || 1);
        if (Math.abs(curZ - baseZ) > 1e-3) {
          this._setObjectTransitionsEnabled?.(false);
          this.setZoomAbsolute?.(baseZ, { center: false, animate: false });
          (this._forceLayoutFlush ? this._forceLayoutFlush() : void this.htmlGridElement?.offsetHeight);
          this._setObjectTransitionsEnabled?.(true);

          this.clampCameraToBounds?.(false, 'detail-reset-zoom');
          this._syncPanStateFromDom?.();
        }
      }

      const el = document.getElementById(obj.id);
      const z = this.zoomLevel || 1; // world → screen scaling (keep consistent with enterDetail)
    
      // Detail size = half of ungrouped in both dimensions
      const cfg = this.detailConfig.clustered;
      let width  = cfg.width ?? 500;
      let height = cfg.height ?? 500;
      const portraitWidth  = cfg.portraitWidth  ?? width;
      const portraitHeight = cfg.portraitHeight ?? height;
      
      const objIsPortraitMedia =
        (obj && (obj.type === 'image' || obj.type === 'video')) &&
        ((obj.height || 0) > (obj.width || 0));
      
      if (objIsPortraitMedia) {
        width  = portraitWidth;
        height = portraitHeight;
      }

      // Mobile override: expand card to ~90% of viewport on small screens
      const mobileSize = this._applyMobileDetailSizing(width, height);
      width  = mobileSize.width;
      height = mobileSize.height;
    
      // Cluster/group center in world space
      const g = this.groups?.[obj.groupId];
      const cx = g ? g.x : (obj.cluster_x + obj.width / 2);
      const cy = g ? g.y : (obj.cluster_y + obj.height / 2);
    
      // Save prev + mark active
      this._detail = {
        active: true, id: obj.id, width, height, margin,
        prevState: this.currentState,
        pushed: false,
        source: 'clustered',
        prev: {
          width: obj.width,
          height: obj.height,
          bg: el.style.backgroundImage || '',
          transform: el.style.transform || '',
          className: el.className
        }
      };
    
      // Lift above others & fade small content
      el.classList.add('is-detail', 'detail-fade-out');
      if (obj.type === 'image') el.style.backgroundImage = 'none';
      this.pauseAllVideos?.();
    
      // ---------- Push neighbors outward (same group only) ----------
      const R = Math.max(width, height) / 2 + margin; // exclusion radius around center
      const sameGroup = this.objects.filter(o => o.groupId === obj.groupId && o.id !== obj.id);
      for (const other of sameGroup) {
        const otherEl = document.getElementById(other.id);
        const ocx = other.cluster_x + other.width / 2;
        const ocy = other.cluster_y + other.height / 2;
        let vx = ocx - cx, vy = ocy - cy;
        let r = Math.hypot(vx, vy);
        if (r < 1e-4) { vx = 1; vy = 0; r = 1; } // degenerate: on center
        const ro = Math.max(other.width, other.height) / 2;
        const rMin = R + ro + gap;
        // Only push outward if overlapping the detail exclusion circle
        const rr = (r < rMin) ? rMin : r;
        const k = rr / r;
        const nccx = cx + vx * k;
        const nccy = cy + vy * k;
        const newLeft = nccx - other.width / 2;
        const newTop  = nccy - other.height / 2;
        const dx = newLeft - other.grid_x;
        const dy = newTop  - other.grid_y;
        otherEl.style.transform = `translate(${dx * z}px, ${dy * z}px)`; // preserves angular order
      }
      // Leave other groups untouched (their cluster transforms stay as-is)
    
      // ---------- Slide focused card to center, then expand ----------
      const targetLeft1 = cx - obj.width / 2;
      const targetTop1  = cy - obj.height / 2;
      const dx1 = targetLeft1 - obj.grid_x;
      const dy1 = targetTop1  - obj.grid_y;
      // Stage 1: slide to center (keeps current size)
      requestAnimationFrame(() => {
        el.style.transform = `translate(${dx1 * z}px, ${dy1 * z}px)`;
      });
    
      // Center camera on cluster center (nice polish)
      this.centerViewportOnWorldPoint(cx, cy, /*animate*/ true);
      this._startPanLoop?.();
    
      // Stage 2: after slide completes, expand keeping center fixed
      const expand = () => {

        // 🚧 Guard against races: if detail has been closed or replaced, do nothing
        if (!this._detail?.active || this._detail.id !== obj.id) {
          return;
        }

        const targetLeft2 = cx - width / 2;
        const targetTop2  = cy  - height / 2;
        const dx2 = targetLeft2 - obj.grid_x;
        const dy2 = targetTop2  - obj.grid_y;
        el.style.width  = `${width * z}px`;
        el.style.height = `${height * z}px`;
        el.style.transform = `translate(${dx2 * z}px, ${dy2 * z}px)`;        
    
        // Build detail panel UI (reuse your ungrouped panel structure)
        // Shared panel builder
        this._createInlineDetailPanel(el, obj, {
          from: 'clustered',
          onClose: () => this.exitDetail(),
        });
      };
    
      const to = setTimeout(expand, 520);
      const onEnd = (e) => {
        if (e && e.propertyName !== 'transform') return;
        el.removeEventListener('transitionend', onEnd);
        clearTimeout(to);
        expand();
      };
      el.addEventListener('transitionend', onEnd);
    
      this.prevState = this.currentState;
      this.currentState = 'detail';
    } 

    exitDetail() {
      if (!this._detail?.active) return Promise.resolve();
    
      //const { id, prev } = this._detail;
      const { id, prev, prevState, pushed } = this._detail;
      const focusObj = this.objects.find(o => o.id === id);
      const el = document.getElementById(id);
    
      // Remove any inline detail panels that might still be attached
      this._removeAllInlineDetailPanels();
    
      // Restore other tiles only if we pushed them (ungrouped detail case)
      if (pushed) {
        this.objects.forEach(other => {
          if (other.id === id) return;
          const otherEl = document.getElementById(other.id);
          otherEl.style.transform = '';
        });
      }
    
      // Restore focused tile
      const z = this.zoomLevel || 1;
      el.style.width  = `${prev.width * z}px`;
      el.style.height = `${prev.height * z}px`;
      el.style.transform = prev.transform || '';

      if (focusObj?.type === 'image') el.style.backgroundImage = prev.bg;
      el.className = prev.className || el.className; // remove is-detail/fade
    
      //this._detail = { active: false };
      //this.currentState = 'ungrouped';
      this._detail = { active: false };
      this._setState(prevState || 'ungrouped');
      this._applyTransformsForCurrentState();
    
      // Remove any temporary overscroll allowance and glide back inside bounds
      if (this._pan) {
        this._pan.slack = 0;
        // clamp to legal range
        const zoom = this.zoomLevel || 1;
        const w = parseFloat(this.htmlGridElement.style.width)  || (this.gridDimension.width  * zoom);
        const h = parseFloat(this.htmlGridElement.style.height) || (this.gridDimension.height * zoom);
        const minX = Math.min(0, window.innerWidth  - w);
        const minY = Math.min(0, window.innerHeight - h);
        const curLeft = parseFloat(this.htmlGridElement.style.left) || 0;
        const curTop  = parseFloat(this.htmlGridElement.style.top)  || 0;
        this._pan.targetX = Math.max(minX, Math.min(0, curLeft));
        this._pan.targetY = Math.max(minY, Math.min(0, curTop));
        this._pan.vx = 0; this._pan.vy = 0;
        this._startPanLoop?.(); this._ensurePanTick?.();
      }
    
      // Resolve after transitions settle
      return new Promise(resolve => {
        const done = () => resolve();
        const to = setTimeout(done, 520);
        el.addEventListener('transitionend', () => {
          clearTimeout(to);
          done();
        }, { once: true });
      });
    }

    pauseAllVideos() {
      this.htmlGridElement.querySelectorAll("video").forEach(v => {
        v.pause();
        v.currentTime = 0;
      });
    }

    _ensureHoverTtsAudio() {
      if (!this._hoverTtsAudio) {
        this._hoverTtsAudio = new Audio();
        this._hoverTtsAudio.preload = 'none';
      }
      return this._hoverTtsAudio;
    }

    stopHoverTts() {
      if (!this._hoverTtsAudio) return;
      try { this._hoverTtsAudio.pause(); } catch {}
      try { this._hoverTtsAudio.currentTime = 0; } catch {}
    }

    _rand01(seed) {
      let h = 2166136261; // FNV-ish
      for (let i = 0; i < seed.length; i++) {
        h ^= seed.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      // map to [0,1)
      return (h >>> 0) / 4294967296;
    }    

    // still inside Grid
    applyGroupedScatter(step = 16, jitter = 6) {
      // group objects by groupId
      const grouped = {};
      for (const obj of this.objects) {
        (grouped[obj.groupId] ||= []).push(obj);
      }

      for (const gid in grouped) {
        const center = this.groups[gid];
        const members = grouped[gid];

        const phi = Math.PI * (3 - Math.sqrt(5)); // golden angle
        members.forEach((obj, idx) => {
          // base spiral position (tight pile)
          const r = step * Math.sqrt(idx);
          const a = idx * phi;

          // tiny deterministic jitter per object so it doesn't look too regular
          const jx = (this._rand01(obj.id + ':x') - 0.5) * 2 * jitter;
          const jy = (this._rand01(obj.id + ':y') - 0.5) * 2 * jitter;

          const x = center.x + Math.cos(a) * r + jx;
          const y = center.y + Math.sin(a) * r + jy;

          obj.group_initial_x = x;
          obj.group_initial_y = y;
          // IMPORTANT: keep these in *grid/world* coordinates
          obj.group_x = x;
          obj.group_y = y;
        });
      }
    }
  
    createGrid() {
      let gridSectionCountX = Math.ceil(Math.sqrt(this.objects.length));
      let gridSectionCountY = Math.ceil(this.objects.length / gridSectionCountX);
  
      this.gridDimension.width = gridSectionCountX * this.gridSectionDimension.width + (gridSectionCountX-1) * this.gridSectionDimension.marginX;
      this.gridDimension.height = gridSectionCountY * this.gridSectionDimension.height + (gridSectionCountY-1) * this.gridSectionDimension.marginY;

      this.recenterToViewport();
      this._syncPanStateFromDom();
  
      for(let row = 0; row < gridSectionCountY; row++) {
        for(let column = 0; column < gridSectionCountX; column++) {
          this._grid.push({
            section_id: `section_${column}_${row}`,
            x: this.gridSectionDimension.width * column + this.gridSectionDimension.marginX * column,
            y: this.gridSectionDimension.height * row + this.gridSectionDimension.marginY * row,
            object_id: '',
          });
        }
      }

      this.htmlGridElement.style.width  = `${this.gridDimension.width}px`;
      this.htmlGridElement.style.height = `${this.gridDimension.height}px`;
    }

    // Recompute section coordinates & object base positions after changing section margins.
    // Keeps objects in their existing sections and preserves their local offset within the section.
    _reflowUngroupedGrid() {
      const total = this.objects.length;
      const gridSectionCountX = Math.ceil(Math.sqrt(total));
      const gridSectionCountY = Math.ceil(total / gridSectionCountX);

      const oldGrid = this._grid.slice(); // preserve section order & object assignments

      // Update overall grid dimension from current margins
      this.gridDimension.width  =
        gridSectionCountX * this.gridSectionDimension.width +
        (gridSectionCountX - 1) * this.gridSectionDimension.marginX;
      this.gridDimension.height =
        gridSectionCountY * this.gridSectionDimension.height +
        (gridSectionCountY - 1) * this.gridSectionDimension.marginY;

      this.htmlGridElement.style.width  = `${this.gridDimension.width}px`;
      this.htmlGridElement.style.height = `${this.gridDimension.height}px`;

      // Rebuild section coordinates in the SAME order as before
      const newGrid = [];
      for (let row = 0; row < gridSectionCountY; row++) {
        for (let col = 0; col < gridSectionCountX; col++) {
          newGrid.push({
            x: this.gridSectionDimension.width * col + this.gridSectionDimension.marginX * col,
            y: this.gridSectionDimension.height * row + this.gridSectionDimension.marginY * row,
            object_id: oldGrid[newGrid.length]?.object_id ?? ''
          });
        }
      }
      this._grid = newGrid;

      // Move each object to the same relative offset inside its (unchanged) section index
      const byId = new Map(this.objects.map(o => [o.id, o]));
      const count = Math.min(oldGrid.length, newGrid.length);
      for (let i = 0; i < count; i++) {
        const oid = oldGrid[i]?.object_id;
        if (!oid) continue;

        const obj = byId.get(oid);
        if (!obj) continue;

        const prev = oldGrid[i];
        const next = newGrid[i];

        const offX = obj.grid_x - prev.x;
        const offY = obj.grid_y - prev.y;

        const maxOffX = Math.max(0, this.gridSectionDimension.width  - obj.width);
        const maxOffY = Math.max(0, this.gridSectionDimension.height - obj.height);

        obj.grid_x = next.x + Math.min(Math.max(0, offX), maxOffX);
        obj.grid_y = next.y + Math.min(Math.max(0, offY), maxOffY);

        const el = document.getElementById(obj.id);
        if (el) {
          el.style.left = `${obj.grid_x}px`;
          el.style.top  = `${obj.grid_y}px`;
          if (this.currentState === 'ungrouped') {
            el.style.transform = ''; // base position = grid_x/grid_y
          }
        }
      }

      if (this.currentState === 'ungrouped') {
        this.fitToView('ungrouped', 160, { animateCamera: true, reason: 'ungrouped-reflow' });
      }      
    }

    // Public setter: change distance in ungrouped view at any time.
    // Usage: grid.setUngroupedGap(80) or grid.setUngroupedGap(80, 60)
    setUngroupedGap(gapX, gapY = gapX) {
      this.spacing.ungrouped.sectionGapX = gapX;
      this.spacing.ungrouped.sectionGapY = gapY;
      this.gridSectionDimension.marginX = gapX;
      this.gridSectionDimension.marginY = gapY;
      this._reflowUngroupedGrid();
    }
  
    addObjectsRandomly() {
      for(const object of this.objects) {
        let onlyEmptyGridSections = this._grid.filter(gridSection => gridSection.object_id == '');
        let randomGridSection = Math.floor(Math.random() * (onlyEmptyGridSections.length - 1));
        
        onlyEmptyGridSections[randomGridSection].object_id = object.id;
  
        let diffWidthImageToGrid = this.gridSectionDimension.width - object.width;
        let diffHeightImageToGrid = this.gridSectionDimension.height - object.height;
    
        let randomImageLeft = Math.floor(Math.random() * diffWidthImageToGrid + 1);
        let randomImageTop = Math.floor(Math.random() * diffHeightImageToGrid + 1);
  
        object.grid_x = onlyEmptyGridSections[randomGridSection].x + randomImageLeft;
        object.grid_y = onlyEmptyGridSections[randomGridSection].y + randomImageTop;
  
        const objectDiv = document.createElement("div");
        objectDiv.id = object.id;
        objectDiv.classList.add("object");
        objectDiv.style.top = `${object.grid_y}px`;
        objectDiv.style.left = `${object.grid_x}px`;
        objectDiv.style.width = `${object.width}px`;
        objectDiv.style.height = `${object.height}px`;
        if (object.type === 'image') {
          objectDiv.classList.add('image');
          const url = String(object.image || '');
          const img = new Image();
          img.onload = () => {
            objectDiv.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`;
            window.DEBUG_MEDIA && console.debug('[grid:image-set]', { id: object.id, cssW: object.width, cssH: object.height, url });
          };
          img.onerror = () => {
            // Fallback: show an <img> so you at least see a broken icon (useful for debugging 404/CORS)
            img.style.width = '100%';
            img.style.height = '100%';
            img.style.objectFit = 'cover';
            objectDiv.appendChild(img);
          };
          img.src = url;
        }

        if (object.type === 'text') {
          objectDiv.dataset.type = 'text';
          objectDiv.classList.add('text');
          const span = document.createElement("span");
          span.className = 'scaling-text';
          span.textContent = object.text;
          objectDiv.appendChild(span);

          // Inline burger icon used as "too small to show text" placeholder
          const svgNS = 'http://www.w3.org/2000/svg';
          const icon = document.createElementNS(svgNS, 'svg');
          icon.setAttribute('class', 'burger burger--rect text-placeholder-icon');
          icon.setAttribute('viewBox', '0 0 28 20');
          icon.setAttribute('aria-hidden', 'true');
          icon.setAttribute('focusable', 'false');

          const bars = [
            { className: 'bar bar--top', y: 2 },
            { className: 'bar bar--mid', y: 9 },
            { className: 'bar bar--bot', y: 16 },
          ];

          for (const { className, y } of bars) {
            const rect = document.createElementNS(svgNS, 'rect');
            rect.setAttribute('class', className);
            rect.setAttribute('x', '4');
            rect.setAttribute('y', String(y));
            rect.setAttribute('width', '20');
            rect.setAttribute('height', '1');
            rect.setAttribute('rx', '0.5');
            icon.appendChild(rect);
          }

          objectDiv.appendChild(icon);

          // 🔊 Hover text-to-speech for text objects (only if they have TTS audio)
          if (object.textToSpeech) {
            const ttsSrc = object.textToSpeech;
            objectDiv.dataset.ttsSrc = ttsSrc; // convenient for debugging

            const playHoverTts = () => {
              // Only in ungrouped or clustered views (not grouped, not detail)
              if (this.currentState !== 'ungrouped' && this.currentState !== 'clustered') return;
              if (this._detail?.active) return; // inline detail open → no hover playback
              if (!ttsSrc) return;

              const a = this._ensureHoverTtsAudio();
              if (a.src !== ttsSrc) {
                a.src = ttsSrc;
              }
              try { a.currentTime = 0; } catch {}
              a.play().catch(() => {
                // ignore autoplay / other transient errors
              });
            };

            const stopHoverTts = () => {
              this.stopHoverTts();
            };

            objectDiv.addEventListener('mouseenter', playHoverTts, { passive: true });
            objectDiv.addEventListener('mouseleave', stopHoverTts, { passive: true });
          }
        }

        if (object.type === 'video') {
          objectDiv.classList.add('video');
          const v = document.createElement("video");
          v.src = object.video;
          v.muted = true;            // required for autoplay policies
          v.playsInline = true;
          v.preload = "metadata";
          v.loop = true;
          v.style.width = "100%";
          v.style.height = "100%";
          v.style.objectFit = "cover";
          objectDiv.appendChild(v);
        
          // hover play outside grouped
          objectDiv.addEventListener("mouseenter", () => {
            if (this.currentState !== "grouped") v.play().catch(()=>{});
          });
          objectDiv.addEventListener("mouseleave", () => {
            v.pause();
            v.currentTime = 0;
          });
        }

        // === AUDIO TILE ===
        if (object.type === 'audio') {
          objectDiv.classList.add('audio');
          const waveWrap = document.createElement('div');
          waveWrap.className = 'wave-wrap';
          objectDiv.appendChild(waveWrap);

          // 1) Create WaveSurfer WITHOUT url (won’t fetch audio)
          const ws = WaveSurfer.create({
            container: waveWrap,
            height: 48,
            interact: false,
            waveColor: '#9aa0a6',
            progressColor: '#1a73e8',
            cursorWidth: 0,
          });
          objectDiv.__ws = ws;

          // 2) OPTIONAL: draw waveform from precomputed peaks (no audio fetch)
          //    We try to find a peaks JSON next to the audio: foo.mp3 -> foo.peaks.json
          let peaks, duration;
          (async () => {
            try {
              const peaksUrl = object.audio.replace(/\.[^/.]+$/, '.peaks.json');
              const r = await fetch(peaksUrl, { cache: 'force-cache' });
              if (r.ok) {
                const json = await r.json();
                // support either { data: [...], duration: <sec> } or a plain array
                peaks = Array.isArray(json) ? json : (json.data || json.peaks || undefined);
                duration = (json.duration || json.length || object.duration || undefined);
                if (peaks && peaks.length) {
                  // Draw waveform from peaks only; still no audio fetched
                  ws.load('', peaks, duration);
                }
              }
            } catch (e) { /* no peaks available — fine */ }
          })();

          // TEMP: eager-load (disable hover-lazy)
          ws.load(object.audio, peaks, duration);

          // Hover play/pause for tiles — disabled in grouped mode and when tile is in inline detail
          const playOnHover = () => {
            if (this.currentState === 'grouped') return;         // ✅ no hover playback in grouped mode
            if (objectDiv.classList.contains('is-detail')) return;
            try { ws.play?.(); } catch {}
          };

          const pauseOnLeave = () => {
            if (this.currentState === 'grouped') return;         // ✅ symmetry / avoid unnecessary calls
            if (objectDiv.classList.contains('is-detail')) return;
            try { ws.pause?.(); } catch {}
          };

          objectDiv.addEventListener('mouseenter', playOnHover, { passive: true });
          objectDiv.addEventListener('mouseleave', pauseOnLeave, { passive: true });

        }
        
        const tagList = Array.isArray(object.connectingTags)
        ? object.connectingTags
        : [];
        objectDiv.dataset.tags = tagList.join(",");

  
        // Add a gradient shadow layer
        const glowDiv = document.createElement("div");
        glowDiv.classList.add("object-glow");
        objectDiv.appendChild(glowDiv);
  
        this.htmlGridElement.appendChild(objectDiv);

        if (object.type === 'text') {
          fitTextToContainer(objectDiv); // Call our function
        }
      }
    }

    // 1) Keep grid centered on the viewport
    recenterToViewport() {
      const diffX = this.gridDimension.width  - this._vw();
      const diffY = this.gridDimension.height - this._vh();
      this.htmlGridElement.style.left = `-${Math.floor(diffX / 2)}px`;
      this.htmlGridElement.style.top  = `-${Math.floor(diffY / 2)}px`;
    }

    // 2) Compute dynamic group centers near the grid center (radial / golden‑angle)
    computeDynamicGroupCenters() {
      // group objects by groupId once
      const grouped = {};
      for (const o of this.objects) (grouped[o.groupId] ||= []).push(o);
      const groupIds = Object.keys(grouped);
    
      // 1) seed centers on a golden spiral (good initial distribution)
      const cx = this.gridDimension.width / 2;
      const cy = this.gridDimension.height / 2;
      const golden = Math.PI * (3 - Math.sqrt(5));
      const seedStep = 240;
    
      const centers = {};
      groupIds.forEach((gid, i) => {
        const r = seedStep * Math.sqrt(i);
        const a = i * golden;
        centers[gid] = { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
      });
    
      // 2) compute per-group pile radius (what grouped scatter will occupy)
      const radii = {};
      for (const gid of groupIds) {
        radii[gid] = this._groupedPileRadius(
            grouped[gid],
            this.GROUPED_SPREAD, /*padding*/18
          );
      }
    
      // 3) relax to remove overlaps between piles (keeps them near the centre)
      this._relaxCenters(centers, radii, { margin: 36, iterations: 60, anchorX: cx, anchorY: cy });
    
      // 4) write back and snapshot compact positions for grouped
      this.groups = this.groups || {};
      for (const gid of groupIds) {
        if (!this.groups[gid]) this.groups[gid] = {};
        this.groups[gid].x = centers[gid].x;
        this.groups[gid].y = centers[gid].y;
      }
      this.baseGroupCenters = {};
      for (const gid of groupIds) {
        this.baseGroupCenters[gid] = { x: this.groups[gid].x, y: this.groups[gid].y };
      }
    
      // 5) set each object's grouped targets to *world* coords (scatter applied elsewhere)
      for (const obj of this.objects) {
        const g = this.groups[obj.groupId];
        obj.group_initial_x = g.x;
        obj.group_initial_y = g.y;
        obj.group_x = g.x;
        obj.group_y = g.y;
      }
    }    

    // --- Compute bounds for different views ---
    getBoundsFor(view, footprints = null) {
      // We treat .grid_x/.group_x/.cluster_x as top-left world coords (as in your transforms)
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

      const pushRect = (x, y, w, h) => {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y + h);
      };

      if (view === 'ungrouped') {
        for (const o of this.objects) pushRect(o.grid_x, o.grid_y, o.width, o.height);
      } else if (view === 'grouped') {
        for (const o of this.objects) pushRect(o.group_x, o.group_y, o.width, o.height);
      } else if (view === 'clustered') {
        // Use cluster coords when present; otherwise fall back per-object to grouped/grid.
        for (const o of this.objects) {
          const x = (o.cluster_x ?? o.group_x ?? o.grid_x);
          const y = (o.cluster_y ?? o.group_y ?? o.grid_y);
          pushRect(x, y, o.width, o.height);
        }
      } else if (view === 'footprints' && footprints) {
        // use group centers + radii to approximate future cluster extents
        for (const gid in footprints) {
          const c = this.groups[gid];
          const R = footprints[gid].r;
          pushRect(c.x - R, c.y - R, 2 * R, 2 * R);
        }
      }

      if (!isFinite(minX)) {
        // nothing found—return a tiny box to avoid NaNs
        minX = minY = 0; maxX = maxY = 1;
      }

      return { minX, minY, maxX, maxY };
    }

    // --- Core: rebase all world coords to fit bounds + padding, resize grid, refresh DOM ---
    _fitGridToBounds(bounds, padding = 160, opts = {}) {
      const { animateCamera = false, reason = 'fitGridToBounds' } = (opts || {});
      const { minX, minY, maxX, maxY } = bounds;
      const offsetX = padding - minX;
      const offsetY = padding - minY;

      // 1) Resize unscaled grid dimensions
      this.gridDimension.width  = (maxX - minX) + padding * 2;
      this.gridDimension.height = (maxY - minY) + padding * 2;

      // 2) Shift all stored world coords by the same offset
      for (const o of this.objects) {
        o.grid_x  += offsetX; o.grid_y  += offsetY;
        if (o.group_initial_x != null) { o.group_initial_x += offsetX; o.group_initial_y += offsetY; }
        if (o.group_x != null)         { o.group_x         += offsetX; o.group_y         += offsetY; }
        if (o.cluster_x != null)       { o.cluster_x       += offsetX; o.cluster_y       += offsetY; }
        if (o._ungroupedX != null) {
          o._ungroupedX += offsetX;
          o._ungroupedY += offsetY;
        }
      }
      for (const gid in this.groups) {
        if (this.groups[gid]) {
          this.groups[gid].x += offsetX;
          this.groups[gid].y += offsetY;
        }
      }
      if (this.baseGroupCenters) {
        for (const gid in this.baseGroupCenters) {
          this.baseGroupCenters[gid].x += offsetX;
          this.baseGroupCenters[gid].y += offsetY;
        }
      }

      // 3) Apply scaled size to the DOM and refresh element base positions at current zoom
      const scaledW = this.gridDimension.width  * this.zoomLevel;
      const scaledH = this.gridDimension.height * this.zoomLevel;
      this.htmlGridElement.style.width  = `${scaledW}px`;
      this.htmlGridElement.style.height = `${scaledH}px`;

      for (const o of this.objects) {
        const el = document.getElementById(o.id);
        el.style.left = `${o.grid_x * this.zoomLevel}px`;
        el.style.top  = `${o.grid_y * this.zoomLevel}px`;
        // transforms (group/cluster) remain correct because we shifted both base and targets
      }

      // 4) Keep the same content anchored under the screen center (no visible jump)
      const zoom = this.zoomLevel || 1;
      const prevLeft = parseFloat(this.htmlGridElement.style.left) || 0;
      const prevTop  = parseFloat(this.htmlGridElement.style.top)  || 0;
      const anchorWorldX = (this._vw()/2 - prevLeft) / zoom;
      const anchorWorldY = (this._vh()/2 - prevTop) / zoom;
      // After rebasing world coords by (offsetX, offsetY), keep the same world point at center:
      // NOTE: keep this instantaneous (it preserves the same on-screen content); only animate the clamp correction.
      this.centerViewportOnWorldPoint(anchorWorldX + offsetX, anchorWorldY + offsetY, /*animate*/ false);
      this.clampCameraToBounds(animateCamera, reason);
    }

    // Re-apply CSS transforms for the current state at the current zoom
    _applyTransformsForCurrentState() {
      const z = this.zoomLevel || 1;
      for (const obj of this.objects) {
        const el = document.getElementById(obj.id);
        if (!el) continue;
        if (this.currentState === 'ungrouped') {
          el.style.transform = '';
        //} else if (this.currentState === 'grouped') {
        } else if (this.currentState === 'grouped' || this.currentState === 'pre-cluster') { // cluster animation fix
          el.style.transform = `translate(${(obj.group_x - obj.grid_x) * z}px, ${(obj.group_y - obj.grid_y) * z}px)`;
        } else if (this.currentState === 'clustered') {
          const tx = (obj.cluster_x ?? obj.group_x) - obj.grid_x;
          const ty = (obj.cluster_y ?? obj.group_y) - obj.grid_y;
          el.style.transform = `translate(${tx * z}px, ${ty * z}px)`;
        }
      }
    }

    // Wait until specific CSS transitions have actually finished (across all tiles),
    // then run `callback`. Uses a short "quiet window" after the last transitionend.
    // Includes a fallback so we never hang.
    //
    // Supports either:
    //   _waitForObjectTransitionsToSettle(cb, { props: ['width','height'], fallbackMs: 900, quietMs: 56 })
    // or:
    //   _waitForObjectTransitionsToSettle(cb, { props: ['transform'] }, 650)  <-- via wrappers below
    _waitForObjectTransitionsToSettle(callback, optsOrFallbackMs = 650) {
      const gridEl = this.htmlGridElement;
      if (!gridEl) return callback();

      // Normalize args
      const opts = (optsOrFallbackMs && typeof optsOrFallbackMs === 'object')
        ? optsOrFallbackMs
        : { fallbackMs: optsOrFallbackMs };

      const props = Array.isArray(opts.props) && opts.props.length ? opts.props : ['transform'];
      const want = new Set(props);

      const quietMs = Number.isFinite(opts.quietMs) ? opts.quietMs : 48;
      let fallbackMs = Number.isFinite(opts.fallbackMs) ? opts.fallbackMs : 650;

      // Make sure fallback is not shorter than the actual CSS transition for the relevant props.
      const sampleObj = gridEl.querySelector('.object');
      if (sampleObj) {
        const cs = getComputedStyle(sampleObj);

        const toMs = (v) => {
          if (!v) return 0;
          const s = String(v).trim();
          if (s.endsWith('ms')) return parseFloat(s) || 0;
          if (s.endsWith('s')) return (parseFloat(s) || 0) * 1000;
          return parseFloat(s) || 0;
        };

        const propsList = (cs.transitionProperty || '').split(',').map(s => s.trim()).filter(Boolean);
        const durs      = (cs.transitionDuration || '').split(',').map(s => s.trim()).filter(Boolean);
        const dels      = (cs.transitionDelay || '').split(',').map(s => s.trim()).filter(Boolean);

        const maxLen = Math.max(propsList.length, durs.length, dels.length, 1);

        let maxRelevantTotal = 0;
        for (let i = 0; i < maxLen; i++) {
          const prop  = (propsList[i % propsList.length] || 'all');
          const dur   = toMs(durs[i % durs.length] || '0s');
          const del   = toMs(dels[i % dels.length] || '0s');
          const total = dur + del;

          // We care about specific props, and 'all' covers them too.
          if (prop === 'all' || want.has(prop)) {
            if (total > maxRelevantTotal) maxRelevantTotal = total;
          }
        }

        if (maxRelevantTotal > 0) {
          fallbackMs = Math.max(fallbackMs, Math.ceil(maxRelevantTotal + quietMs + 50));
        }
      }

      let done = false;
      let fallbackTimer = null;
      let quietTimer = null;

      const finish = () => {
        if (done) return;
        done = true;
        if (fallbackTimer) clearTimeout(fallbackTimer);
        if (quietTimer) clearTimeout(quietTimer);
        gridEl.removeEventListener('transitionend', onEnd, true);
        callback();
      };

      const armQuietFinish = () => {
        if (quietTimer) clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, quietMs);
      };

      const onEnd = (ev) => {
        if (!ev.target?.classList?.contains('object')) return;
        if (!want.has(ev.propertyName)) return;
        armQuietFinish();
      };

      gridEl.addEventListener('transitionend', onEnd, true);
      fallbackTimer = setTimeout(finish, fallbackMs);

      // If nothing fires, fallback handles it.
    }

    // Backwards-compatible wrapper (existing callers keep working)
    _waitForObjectTransformsToSettle(callback, optsOrFallbackMs = 650) {
      const base = (optsOrFallbackMs && typeof optsOrFallbackMs === 'object')
        ? optsOrFallbackMs
        : { fallbackMs: optsOrFallbackMs };
      return this._waitForObjectTransitionsToSettle(callback, { ...base, props: ['transform'] });
    }

    // New wrapper for zoom-resize settling
    _waitForObjectSizesToSettle(callback, optsOrFallbackMs = 650) {
      const base = (optsOrFallbackMs && typeof optsOrFallbackMs === 'object')
        ? optsOrFallbackMs
        : { fallbackMs: optsOrFallbackMs };
      return this._waitForObjectTransitionsToSettle(callback, { ...base, props: ['width', 'height'] });
    }

    _setObjectTransitionsEnabled(enabled) {
      // Inline transition toggling is fine, but we MUST flush when disabling,
      // otherwise the browser may batch and still animate the bake step.
      for (const o of this.objects) {
        const el = document.getElementById(o.id);
        if (!el) continue;
        el.style.transition = enabled ? '' : 'none';
      }
    
      if (!enabled) {
        // Force style flush so "transition: none" is applied BEFORE we change transforms.
        const any = this.htmlGridElement?.querySelector?.('.object');
        if (any) void any.offsetHeight;
      }
    }    

    _forceLayoutFlush() {
      // Any forced layout read works; offsetHeight is simple and reliable.
      // Use the grid root so we flush the same subtree we are animating.
      void this.htmlGridElement.offsetHeight;
    }    

    _restoreTransitionsNextFrameWithFlush() {
      this._forceLayoutFlush();
      requestAnimationFrame(() => this._setObjectTransitionsEnabled(true));
    }

      // Refit all text tiles currently in the DOM
    _refitAllText() {
      for (const o of this.objects) {
        if (o.type !== 'text') continue;
        const el = document.getElementById(o.id);
        if (el) fitTextToContainer(el);
      }
    }

    // Convenience wrappers
    // opts:
    //  - animateCamera: smoothly glides the camera if bounds changes force clamping
    //  - reason: optional label for debug/logging
    fitToView(view, padding = 160, opts = {}) {
      const b = this.getBoundsFor(view);
      this._fitGridToBounds(b, padding, {
        reason: opts.reason ?? `fitToView:${view}`,
        ...opts
      });
    }
    fitToFootprints(footprints, padding = 160, opts = {}) {
      const b = this.getBoundsFor('footprints', footprints);
      this._fitGridToBounds(b, padding, {
        reason: opts.reason ?? 'fitToFootprints',
        ...opts
      });
    }

    // Zoom/pan so that *all items for the current state* fit in the viewport.
    // Does *not* rebase world coords; only adjusts camera (zoom + pan).
    // Padding is in world units (same as your object positions/sizes).
    fitAll(padding = 120, animate = true) {
      // Choose which bounds to use based on active state
      const view = (this.currentState === 'pre-cluster') ? 'grouped' : this.currentState;
      const b = this.getBoundsFor(view);
      const W = (b.maxX - b.minX) + 2 * padding;
      const H = (b.maxY - b.minY) + 2 * padding;
      const vw = this._vw(), vh = this._vh();
      if (W <= 0 || H <= 0 || vw <= 0 || vh <= 0) return;

      // Target zoom to fit (only zoom OUT as much as needed)
      const zTarget = Math.min(vw / W, vh / H);
      const zNow = this.zoomLevel || 1;
      if (zTarget < zNow) {
        const factor = zTarget / zNow;
        this.zoom(factor);
      }

      // Center on the bounds' center in world space
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      this.centerViewportOnWorldPoint(cx, cy, animate);
      this.clampCameraToBounds(false, 'fitViewportToBounds');
      this._syncPanStateFromDom?.();
    }

    // NEW: set zoom to an absolute value (not a multiplier), then optionally center
    setZoomAbsolute(targetZoom, { center = true, animate = true } = {}) {
      const current = this.zoomLevel || 1;
      if (!isFinite(targetZoom) || targetZoom <= 0) return;
      const factor = targetZoom / current;
      if (Math.abs(factor - 1) < 1e-6) return;

      this.zoom(factor);

      if (center) {
        const view = (this.currentState === 'pre-cluster') ? 'grouped' : this.currentState;
        const b = this.getBoundsFor(view);
        const cx = (b.minX + b.maxX) / 2;
        const cy = (b.minY + b.maxY) / 2;
        this.centerViewportOnWorldPoint(cx, cy, animate);
        this.clampCameraToBounds(false, 'setZoomAbsolute');
        this._syncPanStateFromDom?.();
      }
    }

    // NEW: snap back to your configured base zoom
    // centerOn:
    //  - 'grid'  (default): center camera on the full grid's center
    //  - 'bounds': center camera on the current state's content bounds
    resetZoomToBase(animate = true, { centerOn = 'grid' } = {}) {
      const z = (this.display?.baseZoom ?? 1);

      // 1) Zoom back to base without changing where we're looking yet
      this.setZoomAbsolute(z, { center: false, animate });

      // 2) Recentre the camera
      if (centerOn === 'bounds') {
        const view = (this.currentState === 'pre-cluster') ? 'grouped' : this.currentState;
        const b = this.getBoundsFor(view);
        const cx = (b.minX + b.maxX) / 2;
        const cy = (b.minY + b.maxY) / 2;
        this.centerViewportOnWorldPoint(cx, cy, animate);
      } else {
        const cx = this.gridDimension.width / 2;
        const cy = this.gridDimension.height / 2;
        this.centerViewportOnWorldPoint(cx, cy, animate);
      }

      this.clampCameraToBounds(false, 'resetZoomToBase');
      this._syncPanStateFromDom?.();
    }

    // Optional: change baseZoom at runtime; apply immediately if you want
    setBaseZoom(z, { apply = false, animate = true } = {}) {
      this.display = this.display || {};
      this.display.baseZoom = z;
      if (apply) this.resetZoomToBase(animate);
    }

    zoom(factor, { anchor = 'center', anchorX = null, anchorY = null } = {}) {
      // Temporarily disable transform animation while we change transforms for zoom
      document.body.classList.add('zooming');
    
      // --- NEW: respect configurable min/max zoom ---
      const cfg   = this.display || {};
      const minZ  = cfg.minZoom ?? 0.25;
      const maxZ  = cfg.maxZoom ?? 4;
      const prev  = this.zoomLevel || 1;

      // --- Keep camera anchored while zooming (default: viewport center) ---
      // Compute the world point currently under the chosen anchor,
      // then re-position the camera after changing zoom so that world point stays put.
      const cs = getComputedStyle(this.htmlGridElement);
      const prevLeft = parseFloat(this.htmlGridElement.style.left || cs.left || "0") || 0;
      const prevTop  = parseFloat(this.htmlGridElement.style.top  || cs.top  || "0") || 0;

      const vw = this._vw();
      const vh = this._vh();

      let ax = vw / 2;
      let ay = vh / 2;

      if (anchor === 'cursor' && isFinite(anchorX) && isFinite(anchorY)) {
        ax = anchorX;
        ay = anchorY;
      } else if (anchor && typeof anchor === 'object' && isFinite(anchor.x) && isFinite(anchor.y)) {
        ax = anchor.x;
        ay = anchor.y;
      }

      const worldX = (ax - prevLeft) / prev;
      const worldY = (ay - prevTop) / prev;
    
      // Proposed new zoom, clamped to [minZ, maxZ]
      let next = prev * factor;
      next = Math.max(minZ, Math.min(maxZ, next));
    
      // If clamping means "no effective change", bail early
      const appliedFactor = next / prev;
      if (Math.abs(appliedFactor - 1) < 1e-6) {
        document.body.classList.remove('zooming');
        return;
      }
    
      this.zoomLevel = next;
      this._updateGridTextPadding();
      const zoomToken = (this._zoomToken = (this._zoomToken || 0) + 1);
    
      // Resize grid container based on the NEW zoom
      const newWidth  = this.gridDimension.width  * this.zoomLevel;
      const newHeight = this.gridDimension.height * this.zoomLevel;
      this.htmlGridElement.style.width  = `${newWidth}px`;
      this.htmlGridElement.style.height = `${newHeight}px`;

      // Anchor camera so the chosen point stays under the same viewport coordinate.
      const newLeft = ax - worldX * this.zoomLevel;
      const newTop  = ay - worldY * this.zoomLevel;
      this.htmlGridElement.style.left = `${newLeft}px`;
      this.htmlGridElement.style.top  = `${newTop}px`;
      this._syncPanStateFromDom?.();
    
      // Resize and reposition objects in screen space
      for (const obj of this.objects) {
        const el = document.getElementById(obj.id);
        if (!el) continue;
    
        const scaledWidth  = obj.width  * this.zoomLevel;
        const scaledHeight = obj.height * this.zoomLevel;
        const scaledLeft   = obj.grid_x * this.zoomLevel;
        const scaledTop    = obj.grid_y * this.zoomLevel;
    
        el.style.width  = `${scaledWidth}px`;
        el.style.height = `${scaledHeight}px`;
        el.style.left   = `${scaledLeft}px`;
        el.style.top    = `${scaledTop}px`;
    
        if (obj.type === 'text') {
          fitTextToContainer(el);
        }
      }
    
      // Recompute transforms from world deltas × current zoom
      this._applyTransformsForCurrentState();
    
      // --- NEW: keep the camera in legal bounds at this zoom ---
      // (no animation here; we just correct the position immediately)
      this.clampCameraToBounds(false, 'zoom');
    
      // After width/height transitions finish, do one final refit pass.
      // (Token prevents older zooms from “winning” if the user zooms repeatedly.)
      this._waitForObjectSizesToSettle(() => {
        if (zoomToken !== this._zoomToken) return;

        for (const obj of this.objects) {
          if (obj.type !== 'text') continue;
          const el = document.getElementById(obj.id);
          if (el) fitTextToContainer(el);
        }
      }, { quietMs: 56, fallbackMs: 650 });

      // Re-enable transform animations on the next frame so future state switches animate
      requestAnimationFrame(() => {
        document.body.classList.remove('zooming');
      });

    }    

    zoomIn() {
        this.zoom(1.1);
    }

    zoomOut() {
        this.zoom(0.9);
    }
      
  
    groupObjects(event) {
      if (event) event.preventDefault();
      if (this._clusterTimer) { clearTimeout(this._clusterTimer); this._clusterTimer = null; }
      if (this._detail?.active) { this.exitDetail(); }
    
      const wasClustered = (this.currentState === 'clustered' || this.currentState === 'pre-cluster');
      if (wasClustered && this.baseGroupCenters) {
        this.movePilesToNewCenters(this.baseGroupCenters, this.GROUPED_SPREAD, this.GROUPED_JITTER);
      }
    
      this.fitToView('grouped', 200);
      this._syncPanStateFromDom();
    
      this._setState('grouped');
      this._applyTransformsForCurrentState?.();   // → this triggers the CSS transition
    
      const z = this.zoomLevel || 1;

      this._waitForObjectTransformsToSettle(() => {
        if (this.currentState !== 'grouped') return;

        // 1) turn transitions OFF for all objects
        // (Use the shared helper so we also force a style flush.)
        this._setObjectTransitionsEnabled(false);

        // 2) bake grouped positions with transitions OFF
        for (const o of this.objects) {
          if (o._ungroupedX == null) {
            o._ungroupedX = o.grid_x;
            o._ungroupedY = o.grid_y;
          }
          o.grid_x = o.group_x;
          o.grid_y = o.group_y;

          const el = document.getElementById(o.id);
          if (!el) continue;
          el.style.left = `${o.grid_x * z}px`;
          el.style.top  = `${o.grid_y * z}px`;
          el.style.transform = ''; // now this will NOT animate
        }

        // Force paint/layout so the baked transform='' is committed while transitions are OFF

        this._restoreTransitionsNextFrameWithFlush();
      });

    }      

    groupObjectsInstant() {
      this.pauseAllVideos();
      this._setState('grouped');
    
      const z = this.zoomLevel || 1;
    
      // FRAME 0: put everything in grouped position with transitions OFF
      for (const object of this.objects) {
        const el = document.getElementById(object.id);
        if (!el) continue;
    
        const dx = (object.group_x - object.grid_x) * z;
        const dy = (object.group_y - object.grid_y) * z;
    
        // kill any CSS transition for the first paint
        el.style.transition = 'none';
        el.style.transform = `translate(${dx}px, ${dy}px)`;
      }
    
      // FRAME 1: bake grouped coords into left/top, still with transitions OFF
      requestAnimationFrame(() => {
        for (const object of this.objects) {
          const el = document.getElementById(object.id);
          if (!el) continue;
    
          // remember original ungrouped spot the first time
          if (object._ungroupedX == null) {
            object._ungroupedX = object.grid_x;
            object._ungroupedY = object.grid_y;
          }
    
          // write grouped as the new base
          object.grid_x = object.group_x;
          object.grid_y = object.group_y;
    
          el.style.left = `${object.grid_x * z}px`;
          el.style.top  = `${object.grid_y * z}px`;
    
          // now we can drop the transform without any animation
          el.style.transform = '';
        }
    
        // FRAME 2: only now restore transitions for future mode changes
        requestAnimationFrame(() => {
          for (const object of this.objects) {
            const el = document.getElementById(object.id);
            if (!el) continue;
            el.style.transition = ''; // back to stylesheet value
          }
        });
      });
    }    

    // --- Estimate per-group cluster footprints (radius) ---
    estimateClusterFootprints(padding = 10) {
      const grouped = {};
      for (const o of this.objects) (grouped[o.groupId] ||= []).push(o);
      const footprints = {};
      const inefficiency = 1.15; // spiral packing overhead buffer
      for (const gid in grouped) {
        let area = 0, maxW = 0, maxH = 0;
        for (const o of grouped[gid]) {
          const w = o.width + padding;
          const h = o.height + padding;
          maxW = Math.max(maxW, w);
          maxH = Math.max(maxH, h);
          area += w * h;
        }
        area *= inefficiency;
        const r = Math.max(80, Math.sqrt(area / Math.PI));
        footprints[gid] = { r, maxW, maxH, count: grouped[gid].length };
      }
      return footprints;
    }

    // --- Layout group centers so clusters won't overlap ---
    layoutGroupCentersForFootprints(footprints, margin = 80) {
      const gids = Object.keys(footprints).sort((a,b)=>footprints[b].r - footprints[a].r);
      const placed = [];
      const centers = {};
      const cx = this.gridDimension.width / 2;
      const cy = this.gridDimension.height / 2;
      const golden = Math.PI * (3 - Math.sqrt(5));
      const stepR = 120; // base step outward if packed
      for (let i = 0; i < gids.length; i++) {
        const gid = gids[i];
        const R = footprints[gid].r;
        let found = false;
        // Spiral search from center
        for (let ring = 0; ring < 200 && !found; ring++) {
          const radius = ring * stepR;
          const turns = Math.max(1, Math.ceil((2 * Math.PI * (radius || 1)) / 120));
          for (let t = 0; t < turns; t++) {
            const a = (i + t) * golden;
            const x = cx + Math.cos(a) * radius;
            const y = cy + Math.sin(a) * radius;
            const ok = placed.every(p => {
              const need = R + p.R + margin;
              const dx = x - p.x, dy = y - p.y;
              return (dx*dx + dy*dy) >= need*need;
            });
            if (ok) {
              centers[gid] = { x, y };
              placed.push({ gid, x, y, R });
              found = true;
              break;
            }
          }
        }
        if (!found) {
          // very far fallback
          const x = cx + (i+1) * (R + margin);
          const y = cy;
          centers[gid] = { x, y };
          placed.push({ gid, x, y, R });
        }
      }
      return centers;
    }

    // --- Move group piles to new centers (preserve current scatter), animated ---
    movePilesToNewCenters(newCenters, scatterStep = 16, jitter = 6) {
      // 1) remember old centers so we can shift existing member positions
      const oldCenters = {};
      if (this.groups) {
        for (const gid in this.groups) {
          const g = this.groups[gid];
          if (g && typeof g.x === 'number' && typeof g.y === 'number') {
            oldCenters[gid] = { x: g.x, y: g.y };
          }
        }
      }

      // 2) write new centers
      for (const gid in newCenters) {
        if (!this.groups[gid]) this.groups[gid] = {};
        this.groups[gid].x = newCenters[gid].x;
        this.groups[gid].y = newCenters[gid].y;
      }

      // 3) shift each object's grouped target by the center delta
      //    (this avoids rebuilding the spiral = no visible "jump to grouped")
      for (const obj of this.objects) {
        const gid = obj.groupId;
        const prev = oldCenters[gid];
        const next = newCenters[gid];
        if (!prev || !next) continue;
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        obj.group_x += dx;
        obj.group_y += dy;
      }
    }

    // Public setter: tune cluster spacing knobs
    // Usage examples:
    //   grid.setClusterGaps({ item: 16 })                // more space inside clusters
    //   grid.setClusterGaps({ group: 140 })              // more space between clusters
    //   grid.setClusterGaps({ spread: 1.35 })            // globally push clusters apart
    //   grid.setClusterGaps({ item: 16, group: 140, spread: 1.35 })
    setClusterGaps({ item, group, spread } = {}) {
      if (typeof item   === 'number') this.spacing.cluster.itemGap  = item;
      if (typeof group  === 'number') this.spacing.cluster.groupGap = group;
      if (typeof spread === 'number') this.spacing.cluster.spread   = spread;
    }

    clusterGroupedObjects(event, opts = {}) {
      if (event) event.preventDefault();
    
      // If a cluster animation was queued, cancel it
      if (this._clusterTimer) { clearTimeout(this._clusterTimer); this._clusterTimer = null; }
      // Close any open detail when changing grid mode
      if (this._detail?.active) { this.exitDetail(); }

      // 🆕 remember where we are coming from
      const prevState = this.currentState;

      // grid.js – inside clusterGroupedObjects(event, opts = {}) { ... }
      if (this.currentState === 'clustered') {
        // Keep transforms consistent and ensure camera is legal; no re-fit jump.
        this._applyTransformsForCurrentState?.();
        this.clampCameraToBounds?.(true);
        return;
      }
    
      // Tunables (you can override from the caller if you want)
      const {
        spread = (this.spacing?.cluster?.spread ?? 1.25),
        layoutMargin = (this.spacing?.cluster?.groupGap ?? 100),
        preFitPad = 140,
        postFitPad = 160
      } = opts;      
    
      this.pauseAllVideos?.();
    
      // 1) Mark state
      this.currentState = 'pre-cluster';

      // 🆕 If we were in a non-grouped layout (e.g. UNGROUPED), do an *instant*
      // snap to grouped **and bake it** so the next cluster animation starts
      // from grouped, not from ungrouped.
      // If we were in a non-grouped layout (e.g. UNGROUPED), do **not** force
      // an invisible snap to grouped. We only need to make sure transitions
      // are ON so the cluster animation can run smoothly from the current pose.
      if (prevState !== 'grouped' && prevState !== 'pre-cluster' && prevState !== 'clustered') {
        for (const obj of this.objects) {
          const el = document.getElementById(obj.id);
          if (el) {
            // in case previous view temporarily disabled transitions
            el.style.transition = '';
          }
        }
      }
    
      // 2) Estimate each group’s cluster footprint (radius)
      const footprints = this.estimateClusterFootprints((this.spacing?.cluster?.itemGap ?? 12));
    
      // 3) Increase required radii to create more inter-cluster distance
      for (const gid in footprints) {
        footprints[gid].r *= spread;
      }
    
      // 4) Compute new group centers with increased margin
      const centers = this.layoutGroupCentersForFootprints(footprints, Math.round(layoutMargin * spread));
    
      // 5) Fit camera to the larger footprints (glide if clamping is needed)
      this.fitToFootprints(footprints, Math.round(preFitPad * spread), { animateCamera: true, reason: 'cluster-prefit' });
    
      // 6) Animate piles to their new (more distant) centers
      this.movePilesToNewCenters(centers, 18, 8);
      this._applyTransformsForCurrentState?.(); // cluster animation fix
    
      // Instead of a fixed timeout, wait until the "move piles to new centers"
      // transform transitions have actually finished (prevents the intermittent "tail").
      this._waitForObjectTransformsToSettle(() => {
        // If the user switched modes while we were animating, bail out.
        if (this.currentState !== 'pre-cluster') return;

        // --- keep your existing explode code exactly as-is here ---
        const groupedObjects = {};
        for (const obj of this.objects) {
          (groupedObjects[obj.groupId] ??= []).push(obj);
        }

        // Place larger items first — helps reduce overlaps
        for (const groupId in groupedObjects) {
          const group = this.groups[groupId];
          const objs = groupedObjects[groupId].slice().sort(
            (a, b) => (b.width * b.height) - (a.width * a.height)
          );

          const placed = [];
          const buffer = (this.spacing?.cluster?.itemGap ?? 12);
          const maxSpiralRadius = 1600;
          const stepAngle = Math.PI / 12;
          const stepRadius = 10;

          for (const obj of objs) {
            let found = false;

            for (let radius = 0; radius < maxSpiralRadius && !found; radius += stepRadius) {
              for (let angle = 0; angle < 2 * Math.PI; angle += stepAngle) {
                const tryX = group.x + Math.cos(angle) * radius;
                const tryY = group.y + Math.sin(angle) * radius;

                const halfW = obj.width / 2 + buffer;
                const halfH = obj.height / 2 + buffer;
                const left   = tryX - halfW, right  = tryX + halfW;
                const top    = tryY - halfH, bottom = tryY + halfH;

                let overlaps = false;
                for (const other of placed) {
                  const ol = other.cluster_x - other.width  / 2 - buffer;
                  const or = other.cluster_x + other.width  / 2 + buffer;
                  const ot = other.cluster_y - other.height / 2 - buffer;
                  const ob = other.cluster_y + other.height / 2 + buffer;
                  if (!(right < ol || left > or || bottom < ot || top > ob)) { overlaps = true; break; }
                }

                if (!overlaps) {
                  obj.cluster_x = tryX;
                  obj.cluster_y = tryY;
                  placed.push(obj);
                  found = true;
                  break;
                }
              }
            }

            if (!found) {
              // Fallback near center
              obj.cluster_x = group.x + Math.random() * 50;
              obj.cluster_y = group.y + Math.random() * 50;
              placed.push(obj);
            }
          }

          // Apply transform at current zoom
          const z = this.zoomLevel || 1;
          objs.forEach(obj => {
            const el = document.getElementById(obj.id);
            const dx = (obj.cluster_x - obj.grid_x) * z;
            const dy = (obj.cluster_y - obj.grid_y) * z;
            el.style.transform = `translate(${dx}px, ${dy}px)`;
          });
        }

        const z = this.zoomLevel || 1;

        // When cluster animation has completed, mark view as clustered
        if (this.currentState === 'pre-cluster') {
          this._setState('clustered');
        }

        this._waitForObjectTransformsToSettle(() => {
          // if user already switched view, don't overwrite
          if (this.currentState !== 'clustered') return;

          // 1) turn transitions OFF for all objects while we bake
          this._setObjectTransitionsEnabled(false);

          // 2) bake clustered positions with transitions OFF
          for (const obj of this.objects) {
            // keep ungrouped backup
            if (obj._ungroupedX == null) {
              obj._ungroupedX = obj.grid_x;
              obj._ungroupedY = obj.grid_y;
            }
            const cx = obj.cluster_x ?? obj.group_x;
            const cy = obj.cluster_y ?? obj.group_y;
            if (cx == null || cy == null) continue;

            obj.grid_x = cx;
            obj.grid_y = cy;

            const el = document.getElementById(obj.id);
            if (!el) continue;
            el.style.left = `${obj.grid_x * z}px`;
            el.style.top  = `${obj.grid_y * z}px`;
            el.style.transform = '';
          }

          // 3) ✅ NOW resize/rebase the grid to the *actual* clustered box
          // (pre-fit uses footprint estimates; post-fit fixes unreachable "outside grid" items)
          this.fitToView('clustered', Math.round(postFitPad * spread), { animateCamera: true, reason: 'cluster-postfit' });

          // Force paint/layout so the baked transform='' is committed while transitions are OFF
          this._restoreTransitionsNextFrameWithFlush();
        });
      }, { fallbackMs: 900, quietMs: 56 });
    }    
  
    ungroupObjects(event) {

      if (event) event.preventDefault();
      if (this._detail?.active) { this.exitDetail(); }
    
      const prev = this.currentState;
    
      // 1) set state + let CSS animate to ungrouped targets
      this._setState('ungrouped');
      console.log('ungroup objects');
    
      const z = this.zoomLevel || 1;
      for (const obj of this.objects) {
        const el = document.getElementById(obj.id);
        if (!el) continue;
    
        if (obj._ungroupedX != null) {
          const dx = (obj._ungroupedX - obj.grid_x) * z;
          const dy = (obj._ungroupedY - obj.grid_y) * z;
          el.style.transform = `translate(${dx}px, ${dy}px)`;
        } else {
          el.style.transform = '';
        }
      }
    
      this._waitForObjectTransformsToSettle(() => {
        const zNow = this.zoomLevel || 1;

        // 1) turn transitions off while we bake
        this._setObjectTransitionsEnabled(false);

        // 2) restore/bake the ungrouped positions into the main coords
        for (const obj of this.objects) {
          if (obj._ungroupedX != null) {
            obj.grid_x = obj._ungroupedX;
            obj.grid_y = obj._ungroupedY;
            const el = document.getElementById(obj.id);
            if (el) {
              el.style.left = `${obj.grid_x * zNow}px`;
              el.style.top  = `${obj.grid_y * zNow}px`;
              el.style.transform = '';
            }
          }
        }

        // 3) ✅ NOW resize the grid to the *actual* ungrouped box
        this.fitToView('ungrouped', 160, { animateCamera: true, reason: 'ungroup-postfit' });

        // 4) if we’re coming from clustered/pre-cluster, restore compact centers
        if ((prev === 'clustered' || prev === 'pre-cluster') && this.baseGroupCenters) {
          if (this._clusterTimer) { clearTimeout(this._clusterTimer); this._clusterTimer = null; }
          for (const gid in this.baseGroupCenters) {
            if (!this.groups[gid]) this.groups[gid] = {};
            this.groups[gid].x = this.baseGroupCenters[gid].x;
            this.groups[gid].y = this.baseGroupCenters[gid].y;
          }
          this.applyGroupedScatter?.(this.GROUPED_SPREAD, this.GROUPED_JITTER);
        }

        // 5) restore transitions on next frame
        requestAnimationFrame(() => this._setObjectTransitionsEnabled(true));
      });
    }     
  
    resetGrid(event) {
      this.recenterToViewport();
      this.groupObjects(); // snap back to centered grouped view
    }

    initWheelBlock({ allowCtrlWheelZoom = true, wheelPanSpeed = 1.5 } = {}) {
      // Wheel over the grid should never scroll the page.
      // Behavior:
      //  - ctrl/cmd + wheel => zoom (existing)
      //  - plain wheel / trackpad two-finger scroll => pan (NEW)
      const toPixels = (e) => {
        let dx = e.deltaX || 0;
        let dy = e.deltaY || 0;
    
        // deltaMode: 0=pixels, 1=lines, 2=pages
        if (e.deltaMode === 1) { dx *= 16; dy *= 16; }
        else if (e.deltaMode === 2) { dx *= this._vh(); dy *= this._vh(); }
    
        return { dx, dy };
      };
    
      const panBy = (panX, panY) => {
        const p = this._pan;
        if (p) {
          // keep pan state aligned with the DOM before nudging targets
          this._syncPanStateFromDom?.();
    
          p.targetX += panX;
          p.targetY += panY;
    
          // small velocity so it feels responsive but doesn't "fling" like drag-inertia
          p.vx = panX * 0.2;
          p.vy = panY * 0.2;
    
          this._ensurePanTick?.();
          return;
        }
    
        // Fallback if initDrag() hasn't run yet
        const cs = getComputedStyle(this.htmlGridElement);
        const left = parseFloat(this.htmlGridElement.style.left || cs.left || "0") || 0;
        const top  = parseFloat(this.htmlGridElement.style.top  || cs.top  || "0") || 0;
        this.htmlGridElement.style.left = `${left + panX}px`;
        this.htmlGridElement.style.top  = `${top + panY}px`;
        this.clampCameraToBounds?.(false, 'wheel-pan-fallback');
      };
    
      const handleWheel = (e) => {
        // Allow scroll if target is inside an element that explicitly opts-in
        if (e.target?.closest?.('[data-allow-scroll], .allow-scroll')) return;
    
        // Optional: keep ctrl/cmd + wheel as zoom
        if (allowCtrlWheelZoom && (e.ctrlKey || e.metaKey)) {
          const factor = Math.pow(1.0015, -e.deltaY); // tweak speed if you want
          this.zoom?.(factor, {
            anchor: 'cursor',
            anchorX: e.clientX,
            anchorY: e.clientY
          });
          
          e.preventDefault();   // IMPORTANT: requires passive:false on listener
          e.stopPropagation();
          return;
        }
    
        // NEW: wheel pan (trackpad two-finger scroll)
        if (this._pan?.isDown) {
          // avoid fighting the active drag pan
          e.preventDefault();
          e.stopPropagation();
          return;
        }
    
        let { dx, dy } = toPixels(e);
    
        // Common convention: Shift + wheel forces horizontal panning
        if (e.shiftKey && Math.abs(dy) > Math.abs(dx)) {
          dx = dy;
          dy = 0;
        }
    
        const panX = (-dx) * wheelPanSpeed;
        const panY = (-dy) * wheelPanSpeed;
    
        if (panX || panY) panBy(panX, panY);
    
        e.preventDefault();   // IMPORTANT: requires passive:false on listener
        e.stopPropagation();
      };
    
      this._onWheel = handleWheel;
      this.htmlGridElement.addEventListener('wheel', this._onWheel, { passive: false });
    
      // Trackpads sometimes bubble wheel to window; handle if it originated over the grid
      this._onWheelDoc = (e) => {
        const path = e.composedPath?.() || [];
        const overGrid = path.includes(this.htmlGridElement);
        if (!overGrid) return;
    
        // Still permit scrolling inside whitelisted elements inside the grid
        const target = e.target;
        if (target?.closest?.('[data-allow-scroll], .allow-scroll')) return;
    
        handleWheel(e);
      };
      window.addEventListener('wheel', this._onWheelDoc, { passive: false });
    
      // (Touch fallback) touch-action:none should already stop it; this is a belt-and-suspenders
      this._onTouchMove = (e) => {
        if (e.target?.closest?.('[data-allow-scroll], .allow-scroll')) return;
        e.preventDefault();
        e.stopPropagation();
      };
      this.htmlGridElement.addEventListener('touchmove', this._onTouchMove, { passive: false });
    }    

    initDrag() {
      // --- Pan state (read left/top robustly) ---
      const cs = getComputedStyle(this.htmlGridElement);
      const startLeft = parseFloat(this.htmlGridElement.style.left || cs.left || "0") || 0;
      const startTop  = parseFloat(this.htmlGridElement.style.top  || cs.top  || "0") || 0;
    
      this._pan = {
        isDown: false,
        lastX: 0, lastY: 0,
        currentX: startLeft,
        currentY: startTop,
        targetX: startLeft, targetY: startTop,
        vx: 0, vy: 0,
        raf: 0, lastTs: 0,
        moved2: 0,
        clickCandidateId: null,
        slack: 0,
      };

      // --- Touch pinch state (2-finger zoom) ---
      this._touchPointers = new Map(); // pointerId -> {x,y}
      this._pinch = {
        active: false,
        startDist: 0,
        startZoom: 1,
        worldX: 0,
        worldY: 0,
      };

      const readCameraLeftTop = () => {
        const p = this._pan;
        if (p && isFinite(p.targetX) && isFinite(p.targetY)) return { left: p.targetX, top: p.targetY };

        const cs = getComputedStyle(this.htmlGridElement);
        const left = parseFloat(this.htmlGridElement.style.left || cs.left || "0") || 0;
        const top  = parseFloat(this.htmlGridElement.style.top  || cs.top  || "0") || 0;
        return { left, top };
      };

      const writeCameraLeftTop = (left, top) => {
        this.htmlGridElement.style.left = `${left}px`;
        this.htmlGridElement.style.top  = `${top}px`;

        // keep pan state in sync so inertia / clamps don’t fight pinch
        const p = this._pan;
        if (p) {
          p.currentX = left; p.currentY = top;
          p.targetX  = left; p.targetY  = top;
          p.vx = 0; p.vy = 0;
        }
      };

      const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
      const mid  = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

      const startPinchIfReady = () => {
        if (this._touchPointers.size !== 2) return;

        const pts = Array.from(this._touchPointers.values());
        const a = pts[0], b = pts[1];
        const m = mid(a, b);

        const { left, top } = readCameraLeftTop();
        const z = this.zoomLevel || 1;

        // World point currently under the midpoint stays under the midpoint throughout the pinch
        this._pinch.active = true;
        this._pinch.startDist = Math.max(1, dist(a, b));
        this._pinch.startZoom = z;
        this._pinch.worldX = (m.x - left) / z;
        this._pinch.worldY = (m.y - top) / z;

        // cancel any active 1-finger pan immediately
        if (this._pan) {
          this._pan.isDown = false;
          this._pan.clickCandidateId = null;
        }
        this.htmlGridElement.classList.remove('dragging');
      };

      const applyPinch = () => {
        if (!this._pinch.active || this._touchPointers.size !== 2) return;

        const cfg  = this.display || {};
        const minZ = cfg.minZoom ?? 0.25;
        const maxZ = cfg.maxZoom ?? 4;

        const pts = Array.from(this._touchPointers.values());
        const a = pts[0], b = pts[1];
        const m = mid(a, b);

        const d = Math.max(1, dist(a, b));
        let nextZoom = this._pinch.startZoom * (d / this._pinch.startDist);
        nextZoom = Math.max(minZ, Math.min(maxZ, nextZoom));

        // Apply zoom without re-centering the view
        if (typeof this.setZoomAbsolute === 'function') {
          // use your existing helper if present
          this.setZoomAbsolute(nextZoom, { center: false, animate: false });
        } else {
          // fallback: multiply current zoom
          const factor = nextZoom / (this.zoomLevel || 1);
          this.zoom?.(factor);
        }

        // Keep the pinch midpoint anchored to the same world point
        const left = m.x - this._pinch.worldX * nextZoom;
        const top  = m.y - this._pinch.worldY * nextZoom;
        writeCameraLeftTop(left, top);

        // Respect bounds (instant clamp is fine during pinch)
        this.clampCameraToBounds?.(false, 'pinch');
      };
    
      // Bounds that include slack on both sides
      const boundsX = () => {
        const w = parseFloat(this.htmlGridElement.style.width) || (this.gridDimension.width * this.zoomLevel);
        const baseMin = this._vw() - w;   // ≤ 0
        const s = this._pan.slack || 0;
        return [Math.min(0, baseMin - s), 0 + s];
      };
      const boundsY = () => {
        const h = parseFloat(this.htmlGridElement.style.height) || (this.gridDimension.height * this.zoomLevel);
        const baseMin = this._vh() - h;
        const s = this._pan.slack || 0;
        return [Math.min(0, baseMin - s), 0 + s];
      };

      const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
      const applyResistance = (pos, min, max, k = 0.35) => {
        if (pos < min) return min + (pos - min) * k;
        if (pos > max) return max + (pos - max) * k;
        return pos;
      };
    
      // --- Spring constants ---
      const SPRING_K = 0.08;
      const DAMPING  = 0.85;
    
      // --- Animation tick ---
      const tick = (ts) => {
        const p = this._pan;
        if (!p.lastTs) p.lastTs = ts;
        const dt = Math.min(0.05, (ts - p.lastTs) / 1000);
        p.lastTs = ts;
      
        const [minX, maxX] = boundsX();
        const [minY, maxY] = boundsY();
      
        // When not dragging: inertia + spring-back toward bounds
        if (!p.isDown) {
          p.targetX += p.vx;
          p.targetY += p.vy;
      
          const cx = clamp(p.targetX, minX, maxX);
          const cy = clamp(p.targetY, minY, maxY);
      
          // spring force nudges target back toward legal range (with slack applied)
          const fx = (cx - p.targetX) * SPRING_K;
          const fy = (cy - p.targetY) * SPRING_K;
      
          p.vx = (p.vx + fx) * DAMPING;
          p.vy = (p.vy + fy) * DAMPING;
        }
      
        // LERP the *current* position toward the target (time-corrected)
        const alpha = 1 - Math.pow(1 - 0.25, dt * 60); // ~0.25 at 60fps
        p.currentX += (p.targetX - p.currentX) * alpha;
        p.currentY += (p.targetY - p.currentY) * alpha;
      
        this.htmlGridElement.style.left = `${p.currentX}px`;
        this.htmlGridElement.style.top  = `${p.currentY}px`;
        //this.htmlGridElement.style.transform = `translate3d(${p.currentX}px, ${p.currentY}px, 0)`;
      
        // STOP only when CURRENT is very close to TARGET and velocity is tiny
        const posErr = Math.hypot(p.targetX - p.currentX, p.targetY - p.currentY);
        const velMag = Math.hypot(p.vx, p.vy);
        if (!p.isDown && posErr < 0.5 && velMag < 0.08) {
          p.currentX = p.targetX; p.currentY = p.targetY;
          this.htmlGridElement.style.left = `${p.currentX}px`;
          this.htmlGridElement.style.top  = `${p.currentY}px`;
          p.raf = 0; p.lastTs = 0;
          return;
        }
      
        p.raf = requestAnimationFrame(tick);
      };      
    
      // Always (re)start loop safely
      const startPanLoop = () => {
        const p = this._pan;
        if (p.raf) { cancelAnimationFrame(p.raf); p.raf = 0; }
        p.lastTs = 0;
        p.raf = requestAnimationFrame(tick);
      };
      this._startPanLoop = startPanLoop;
    
      // Allow “poke to wake” when updating targets elsewhere
      this._ensurePanTick = () => {
        const p = this._pan;
        if (!p.raf) p.raf = requestAnimationFrame(tick);
      };
    
      // --- Pointer handlers ---
      this.htmlGridElement.addEventListener('pointerdown', (e) => {
        // ignore drags starting on the detail overlay
        if (e.target && e.target.closest && e.target.closest('.detail-panel')) return;

        // Track touch pointers for pinch
        if (e.pointerType === 'touch') {
          this._touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          startPinchIfReady();
        }

        this._pan.slack = 0;
    
        const card = e.target.closest?.('.object');
        this._pan.clickCandidateId = card ? card.id : null;
        this._pan.moved2 = 0;
    
        this.htmlGridElement.classList.add('dragging');
        this.htmlGridElement.setPointerCapture?.(e.pointerId);
    
        const p = this._pan;
        p.isDown = true;
        p.lastX = e.clientX; p.lastY = e.clientY;
        p.vx = 0; p.vy = 0;
    
        startPanLoop(); // <- key line: guarantees loop is running now
      });
    
      window.addEventListener('pointermove', (e) => {
        const p = this._pan;

        // Pinch move (2-finger zoom)
        if (this._touchPointers?.has(e.pointerId)) {
          this._touchPointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
          if (this._pinch?.active) {
            applyPinch();
            return; // don’t also pan while pinching
          }
        }

        if (!p.isDown) return;
    
        const dx = e.clientX - p.lastX;
        const dy = e.clientY - p.lastY;
        p.lastX = e.clientX; p.lastY = e.clientY;
    
        p.moved2 += dx*dx + dy*dy;
    
        const [minX, maxX] = boundsX();
        const [minY, maxY] = boundsY();
    
        let nextX = p.targetX + dx;
        let nextY = p.targetY + dy;
        nextX = applyResistance(nextX, minX, maxX, 0.35);
        nextY = applyResistance(nextY, minY, maxY, 0.35);
    
        p.targetX = nextX;
        p.targetY = nextY;
    
        const outsideX = p.targetX < minX || p.targetX > maxX;
        const outsideY = p.targetY < minY || p.targetY > maxY;
        p.vx = outsideX ? dx * 0.2 : dx;
        p.vy = outsideY ? dy * 0.2 : dy;
    
        // If something ever stopped the loop, make sure it’s running
        this._ensurePanTick();
      }, { passive: true });
    
      window.addEventListener('pointerup', (e) => {

        // Touch pointer cleanup for pinch
        if (this._touchPointers?.has(e.pointerId)) {
          this._touchPointers.delete(e.pointerId);
          if (this._pinch?.active && this._touchPointers.size < 2) {
            this._pinch.active = false;
          }
        }

        const p = this._pan;
        if (!p.isDown) return;
    
        this.htmlGridElement.classList.remove('dragging');
        this.htmlGridElement.releasePointerCapture?.(e.pointerId);
        p.isDown = false; // inertia + spring-back continue in tick()
    
        const CLICK_EPS2 = 25; // keep this
        if (p.clickCandidateId && p.moved2 <= CLICK_EPS2) {
          const clickedId = p.clickCandidateId;

          if (this.currentState === 'detail' && this._detail?.active) {
              if (clickedId !== this._detail.id) {
                const from = this._detail.source || 'ungrouped';
                this.exitDetail().then(() => {
                  // restore the source state before re-opening
                  this._setState(from);
                  if (from === 'clustered') {
                    // use your clustered-detail opener; defaults inside handle size/margin
                    this.enterClusterDetail?.(clickedId);
                  } else {
                    this.enterDetail(clickedId, { size: 400, margin: 80 });
                  }
                });
              } else {
                // clicked the same focused item -> just close
                this.exitDetail();
              }
            } else if (this.currentState === 'clustered' && !(this._detail && this._detail.active)) {
              // If this group only has one object, go straight to full detail page
              const obj = this.objects.find(o => String(o.id) === String(clickedId));
              const gid = obj && obj.groupId;
          
              if (obj && gid != null && typeof window.openObjectDetail === 'function') {
                const groupMembers = this.objects.filter(o => String(o.groupId) === String(gid));
                if (groupMembers.length === 1) {
                  window.openObjectDetail({
                    objectId: obj.id,
                    from: 'clustered',
                    gid
                  });
                  // Do not open clustered-detail in this special case
                  return;
                }
              }
          
              // Default: multi-object groups still use clustered-detail as before
              this.enterClusterDetail?.(clickedId);          
            } else if (this.currentState === 'ungrouped' && !(this._detail && this._detail.active)) {
              this.enterDetail(clickedId, { size: 500, margin: 80 });
            }
        }
        p.clickCandidateId = null;
      });
    }          
}
