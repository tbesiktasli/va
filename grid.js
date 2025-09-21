function fitTextToContainer(container, maxFontSize = 100, minFontSize = 6) {
  const span = container.querySelector('span');
  if (!span) return;

  let low = minFontSize;
  let high = maxFontSize;
  let fontSize = high;

  span.style.display = 'inline-block';
  span.style.whiteSpace = 'pre-wrap';
  span.style.wordWrap = 'break-word';

    // Account for container padding so text fits inside the card
  const cs = getComputedStyle(container);
  const padX = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
  const padY = (parseFloat(cs.paddingTop) || 0) + (parseFloat(cs.paddingBottom) || 0);
  const availW = Math.max(0, container.clientWidth  - padX);
  const availH = Math.max(0, container.clientHeight - padY);

  while (low <= high) {
    const mid = (low + high) >> 1;
    span.style.fontSize = `${mid}px`;

    const fits = span.offsetWidth <= container.clientWidth && span.offsetHeight <= container.clientHeight;

    if (fits) {
      fontSize = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  span.style.fontSize = `${fontSize}px`;
}


export class Grid {
    constructor(gridId='grid', objects, groups) {
      this.gridId = gridId;
      this.htmlGridElement = document.getElementById(gridId);
      this.viewportEl = document.getElementById('workspace') || document.documentElement;
      this.objects = objects;
      this.groups = groups || {};
      this.zoomLevel = 1;
      this._grid = [];
      this.currentState = 'grouped';
      this._detail = { active: false };
      this._clusterTimer = null;

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
        'marginX': 60,
        'marginY': 40,
        'offsetX': 40,
      }
      
      this.createGrid();
      this.addObjectsRandomly();
      this.computeDynamicGroupCenters();
      this.applyGroupedScatter(this.GROUPED_SPREAD, this.GROUPED_JITTER);
      this.fitToView('grouped', 200);
      this.initDrag();
      this.initWheelBlock();
      //this.groupObjects();
      this.groupObjectsInstant();
    }

    _vw() { return this.viewportEl?.clientWidth  || window.innerWidth; }
    _vh() { return this.viewportEl?.clientHeight || window.innerHeight; }

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
      const left = parseInt(this.htmlGridElement.style.left) || 0;
      const top  = parseInt(this.htmlGridElement.style.top)  || 0;
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
    
    clampCameraToBounds(animate = true) {
      const zoom = this.zoomLevel || 1;
      const w = parseFloat(this.htmlGridElement.style.width)  || (this.gridDimension.width  * zoom);
      const h = parseFloat(this.htmlGridElement.style.height) || (this.gridDimension.height * zoom);
    
      // legal range (no slack)
      const minX = Math.min(0, this._vw() - w);
      const minY = Math.min(0, this._vh() - h);
    
      const curLeft = parseFloat(this.htmlGridElement.style.left) || 0;
      const curTop  = parseFloat(this.htmlGridElement.style.top)  || 0;
    
      const targetX = Math.max(minX, Math.min(0, curLeft));
      const targetY = Math.max(minY, Math.min(0, curTop));
    
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

    enterDetail(objectId, { size = 500, margin = 80, width, height } = {}) {
      if (this.currentState !== 'ungrouped' || this._detail?.active) return;
    
      const obj = this.objects.find(o => o.id === objectId);
      if (!obj) return;
    
      const el = document.getElementById(obj.id);
    
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

      if (objIsPortraitMedia) W += 100;

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
      const panel = document.createElement('div');
      panel.className = 'detail-panel';
      panel.innerHTML = `
      <button class="detail-close" aria-label="Close">×</button>
      <div class="detail-media">
        ${obj.type === 'image' ? `<img src="${obj.image}" alt="">` : ''}
        ${obj.type === 'text'  ? `<div class="detail-text">${obj.text}</div>` : ''}
        ${obj.type === 'video' ? `<video src="${obj.video}" controls playsinline style="width:100%;height:auto"></video>` : ''}
        ${obj.type === 'audio' ? `<audio src="${obj.audio}" controls style="width:100%"></audio>` : ''}
      </div>
      <div class="detail-info">
        <div class="detail-date">${obj.date || ''}</div>
        <div class="detail-group">${obj.groupLocation || ''}</div>
        <ul class="detail-tags tags">${(obj.tags||[]).map(t=>`<li>${t}</li>`).join('')}</ul>
        <a class="detail-link" href="#" target="_blank" rel="noopener">Open</a>
      </div>
    `;

    // Add 'portrait' layout class when image/video is taller than wide
    if ((obj.type === 'image' || obj.type === 'video') && ((obj.height || 0) > (obj.width || 0))) {
      panel.classList.add('portrait');
    }

      el.appendChild(panel);
      requestAnimationFrame(() => panel.classList.add('visible'));
    
      // Close handlers
      panel.querySelector('.detail-close')?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        this.exitDetail();
      });

      // Detail tag clicks: reseed global selection (toggle-aware) and sync chip colors
      const tagList = panel.querySelector('.detail-tags');
      if (tagList) {
        // annotate chips so we can read the tag
        tagList.querySelectorAll('li').forEach(li => {
          li.dataset.tag = li.textContent.trim();
        });
        tagList.addEventListener('click', (ev) => {
          const li = ev.target.closest('li');
          if (!li) return;
          ev.stopPropagation();
          reseedTagsFromDetail(li.dataset.tag); // now toggles if clicked twice
          // reflect active visuals locally in this detail list, too
          tagList.querySelectorAll('li').forEach(el => {
            const t = el.dataset.tag;
            //const on = activeTags.has(t);
            const on = !!(window.activeTags && window.activeTags.has(t));
            //const c  = tagColors?.[t];
            const c  = (window.tagColors && window.tagColors[t]) || '';
            el.classList.toggle('active', on);
            el.style.borderColor = on && c ? c : '#000';
            el.style.color       = on && c ? c : '';
            el.style.boxShadow   = on && c ? `${c}66 0 0 8px` : '';
          });
        });
      }

      const onEsc = (e) => { if (e.key === 'Escape') this.exitDetail(); };
      window.addEventListener('keydown', onEsc, { once: true });

      // NEW: make sure clicking Open always navigates, not bubble/close
      panel.querySelector('.detail-link')?.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();

        // If you want to pass context (object id / group) to the demo page:
        // const url = `demo-sidebars.html?id=${encodeURIComponent(obj.id)}&group=${encodeURIComponent(obj.groupName || obj.groupId)}`;
        // window.location.href = url;

        // Plain navigation:
        window.openObjectDetail?.({ objectId: obj.id, from: this.currentState, gid: obj.groupId });
      });
    
      this.currentState = 'detail';
    }

    // Clustered detail: keep the arrangement, push neighbors outward to make room,
    // and open the focused card *at the cluster center* (0.75× baseSize; 50% larger than the previous cluster detail).
    enterClusterDetail(objectId, { baseSize = 400, margin = 80, gap = 12 } = {}) {
      if (this.currentState !== 'clustered' || this._detail?.active) return;
    
      const obj = this.objects.find(o => o.id === objectId);
      if (!obj) return;
      const el = document.getElementById(obj.id);
    
      // Detail size = half of ungrouped in both dimensions
      let width  = 500;
      const height = 500;
      
      const objIsPortraitMedia =
        (obj && (obj.type === 'image' || obj.type === 'video')) &&
        ((obj.height || 0) > (obj.width || 0));
      
      if (objIsPortraitMedia) width += 100;
    
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
        otherEl.style.transform = `translate(${dx}px, ${dy}px)`; // preserves angular order
      }
      // Leave other groups untouched (their cluster transforms stay as-is)
    
      // ---------- Slide focused card to center, then expand ----------
      const targetLeft1 = cx - obj.width / 2;
      const targetTop1  = cy - obj.height / 2;
      const dx1 = targetLeft1 - obj.grid_x;
      const dy1 = targetTop1  - obj.grid_y;
      // Stage 1: slide to center (keeps current size)
      requestAnimationFrame(() => {
        el.style.transform = `translate(${dx1}px, ${dy1}px)`;
      });
    
      // Center camera on cluster center (nice polish)
      this.centerViewportOnWorldPoint(cx, cy, /*animate*/ true);
      this._startPanLoop?.();
    
      // Stage 2: after slide completes, expand keeping center fixed
      const expand = () => {
        const targetLeft2 = cx - width / 2;
        const targetTop2  = cy  - height / 2;
        const dx2 = targetLeft2 - obj.grid_x;
        const dy2 = targetTop2  - obj.grid_y;
        el.style.width  = `${width}px`;
        el.style.height = `${height}px`;
        el.style.transform = `translate(${dx2}px, ${dy2}px)`;
    
        // Build detail panel UI (reuse your ungrouped panel structure)
        const panel = document.createElement('div');
        panel.className = 'detail-panel';
        panel.innerHTML = `
        <button class="detail-close" aria-label="Close">×</button>
        <div class="detail-media">
          ${obj.type === 'image' ? `<img src="${obj.image}" alt="">` : ''}
          ${obj.type === 'text'  ? `<div class="detail-text">${obj.text}</div>` : ''}
          ${obj.type === 'video' ? `<video src="${obj.video}" controls playsinline style="width:100%;height:auto"></video>` : ''}
          ${obj.type === 'audio' ? `<audio src="${obj.audio}" controls style="width:100%"></audio>` : ''}
        </div>
        <div class="detail-info">
          <div class="detail-date">${obj.date || ''}</div>
          <div class="detail-group">${obj.groupLocation || ''}</div>
          <ul class="detail-tags tags">${(obj.tags||[]).map(t=>`<li>${t}</li>`).join('')}</ul>
          <a class="detail-link" href="#" target="_blank" rel="noopener">Open</a>
        </div>
      `;

        // Add 'portrait' layout class when image/video is taller than wide
        if ((obj.type === 'image' || obj.type === 'video') && ((obj.height || 0) > (obj.width || 0))) {
          panel.classList.add('portrait');
        }

        el.appendChild(panel);
        requestAnimationFrame(() => panel.classList.add('visible'));
        panel.querySelector('.detail-close')?.addEventListener('click', (ev) => {
          ev.stopPropagation();
          this.exitDetail();
        });

        // Open full-page object detail from clustered detail card
        const openLink = panel.querySelector('.detail-link');
        if (openLink) {
          openLink.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            window.openObjectDetail?.({ objectId: obj.id, from: 'clustered', gid: obj.groupId });
          });
        }

        // Detail tags (clustered): paint on open and repaint after clicks
        const tagList = panel.querySelector('.detail-tags');
        if (tagList) {
          // annotate each chip with data-tag
          tagList.querySelectorAll('li').forEach(li => {
            li.dataset.tag = li.textContent.trim();
          });
          // painter used on open and after each change
          const paintDetailChips = () => {
            tagList.querySelectorAll('li').forEach(el => {
              const t  = el.dataset.tag;
              const on = !!(window.activeTags && window.activeTags.has(t));
              const c  = (window.tagColors && window.tagColors[t]) || '';
              el.classList.toggle('active', on);
              el.style.borderColor = (on && c) ? c : '#000';
              el.style.color       = (on && c) ? c : '';
              el.style.boxShadow   = (on && c) ? `${c}66 0 0 8px` : '';
            });
          };
          tagList.addEventListener('click', (ev) => {
            const li = ev.target.closest('li');
            if (!li) return;
            ev.stopPropagation();
            // reseed global selection, sync menu, glows, counters
            reseedTagsFromDetail(li.dataset.tag);

            // repaint chips with the current selection/colors
            paintDetailChips();
          });
        }

      };
    
      const to = setTimeout(expand, 520);
      const onEnd = (e) => {
        if (e && e.propertyName !== 'transform') return;
        el.removeEventListener('transitionend', onEnd);
        clearTimeout(to);
        expand();
      };
      el.addEventListener('transitionend', onEnd);
    
      this.currentState = 'detail';
    } 

    exitDetail() {
      if (!this._detail?.active) return Promise.resolve();
    
      //const { id, prev } = this._detail;
      const { id, prev, prevState, pushed } = this._detail;
      const focusObj = this.objects.find(o => o.id === id);
      const el = document.getElementById(id);
    
      // Remove panel
      const panel = el.querySelector('.detail-panel');
      if (panel) panel.remove();
    
      // Restore other tiles only if we pushed them (ungrouped detail case)
      if (pushed) {
        this.objects.forEach(other => {
          if (other.id === id) return;
          const otherEl = document.getElementById(other.id);
          otherEl.style.transform = '';
        });
      }
    
      // Restore focused tile
      el.style.width  = `${prev.width}px`;
      el.style.height = `${prev.height}px`;
      el.style.transform = prev.transform || '';
      if (focusObj?.type === 'image') el.style.backgroundImage = prev.bg;
      el.className = prev.className || el.className; // remove is-detail/fade
    
      //this._detail = { active: false };
      //this.currentState = 'ungrouped';
      this._detail = { active: false };
      this.currentState = prevState || 'ungrouped';
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
          const url = String(object.image || '');
          const img = new Image();
          img.onload = () => { objectDiv.style.backgroundImage = `url("${url.replace(/"/g, '%22')}")`; };
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
        }

        if (object.type === 'video') {
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

        if (object.type === 'audio') {
          objectDiv.classList.add('audio');            // so we can target it
          objectDiv.dataset.audioSrc = object.audio;   // WaveSurfer will read from here
        
          const wave = document.createElement('div');
          wave.className = 'wave';
          wave.id = `wave_${object.id}_o`;               // unique per tile
        
          // place at the bottom of the tile
          wave.style.position = 'absolute';
          wave.style.left = '0';
          wave.style.bottom = '0';
          wave.style.width = '100%';
          wave.style.height = '50px';
        
          objectDiv.appendChild(wave);
        }
        
        objectDiv.dataset.tags = object.tags.join(",");
  
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
        // if cluster_x/y exist, use them; else fall back to grouped
        let had = false;
        for (const o of this.objects) {
          if (o.cluster_x != null && o.cluster_y != null) {
            pushRect(o.cluster_x, o.cluster_y, o.width, o.height);
            had = true;
          }
        }
        if (!had) {
          // fallback pre-cluster: approximate with grouped
          for (const o of this.objects) pushRect(o.group_x, o.group_y, o.width, o.height);
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
    _fitGridToBounds(bounds, padding = 160) {
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
      this.centerViewportOnWorldPoint(anchorWorldX + offsetX, anchorWorldY + offsetY, /*animate*/ false);
      this.clampCameraToBounds(false);
      this._syncPanStateFromDom();
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

    // Convenience wrappers
    fitToView(view, padding = 160) {
      const b = this.getBoundsFor(view);
      this._fitGridToBounds(b, padding);
    }
    fitToFootprints(footprints, padding = 160) {
      const b = this.getBoundsFor('footprints', footprints);
      this._fitGridToBounds(b, padding);
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
      this.clampCameraToBounds(false);
      this._syncPanStateFromDom?.();
    }

    zoom(factor) {
        // this.zoomLevel *= factor;

        // Temporarily disable transform animation while we change transforms for zoom
        document.body.classList.add('zooming');
        this.zoomLevel *= factor;
      
        // Resize grid container
        const newWidth = this.gridDimension.width * this.zoomLevel;
        const newHeight = this.gridDimension.height * this.zoomLevel;
        this.htmlGridElement.style.width = `${newWidth}px`;
        this.htmlGridElement.style.height = `${newHeight}px`;
      
        // Resize and reposition objects
        for (const obj of this.objects) {
          const el = document.getElementById(obj.id);
      
          const scaledWidth = obj.width * this.zoomLevel;
          const scaledHeight = obj.height * this.zoomLevel;
          const scaledLeft = obj.grid_x * this.zoomLevel;
          const scaledTop = obj.grid_y * this.zoomLevel;
      
          el.style.width = `${scaledWidth}px`;
          el.style.height = `${scaledHeight}px`;
          el.style.left = `${scaledLeft}px`;
          el.style.top = `${scaledTop}px`;

          if (obj.type === 'text') {
            fitTextToContainer(el);
          }
        }

        // Recompute transforms from world deltas × current zoom
        this._applyTransformsForCurrentState();

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
      // if a cluster animation was queued, cancel it
      if (this._clusterTimer) { clearTimeout(this._clusterTimer); this._clusterTimer = null; }
      // Close any open detail when changing grid mode
      if (this._detail?.active) { this.exitDetail(); }
      
      // If we’re returning from cluster/pre-cluster, move piles back to the compact centers first.
      if (this.currentState === 'clustered' || this.currentState === 'pre-cluster') {
        // re-center piles to the saved compact centers, then we’re done
        this.movePilesToNewCenters(this.baseGroupCenters, this.GROUPED_SPREAD, this.GROUPED_JITTER);
        this.fitToView('grouped', 200);
        this._syncPanStateFromDom();
        this.currentState = 'grouped';
        this._applyTransformsForCurrentState?.();
        return;
      }
      
      // already in grouped (or coming from ungrouped) — just animate to current grouped targets
      this.pauseAllVideos();
      this.currentState = 'grouped';
      // If we are coming from UNGROUPED, shrink grid back to grouped bounds
      // (the ungrouped fit expanded gridDimension; this resets it)
      this.fitToView('grouped', 200);
      this._syncPanStateFromDom();
      this._applyTransformsForCurrentState();
    }

    groupObjectsInstant() {
      this.pauseAllVideos();
      this.currentState = 'grouped';
      
      const z = this.zoomLevel || 1;
      for (const object of this.objects) {
        const el = document.getElementById(object.id);
        const dx = (object.group_x - object.grid_x) * z;
        const dy = (object.group_y - object.grid_y) * z;
        // disable animation just for this first paint
        el.style.transition = 'none';
        el.style.transform = `translate(${dx}px, ${dy}px)`;
      }

      // restore CSS transitions on the next frame so future state changes animate
      requestAnimationFrame(() => {
        for (const object of this.objects) {
          const el = document.getElementById(object.id);
          el.style.transition = ''; // back to stylesheet (transform 0.5s ease)
        }
      });
    }

    // Re-apply CSS transforms based on the *current* state
    /*
    _applyTransformsForCurrentState() {
      for (const o of this.objects) {
        const el = document.getElementById(o.id);
        if (!el) continue;
        if (this.currentState === 'ungrouped') {
          el.style.transform = '';
        } else if (this.currentState === 'grouped') {
          el.style.transform = `translate(${o.group_x - o.grid_x}px, ${o.group_y - o.grid_y}px)`;
        } else if (this.currentState === 'clustered') {
          el.style.transform = `translate(${o.cluster_x - o.grid_x}px, ${o.cluster_y - o.grid_y}px)`;
        }
      }
    }
    */

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

    // --- Move group piles to new centers (keeps grouped scatter), animated ---
    movePilesToNewCenters(newCenters, scatterStep = 16, jitter = 6) {
      // update centers
      for (const gid in newCenters) {
        if (!this.groups[gid]) this.groups[gid] = {};
        this.groups[gid].x = newCenters[gid].x;
        this.groups[gid].y = newCenters[gid].y;
      }
      // recompute grouped scatter targets
      this.applyGroupedScatter(scatterStep, jitter);
    }

    clusterGroupedObjects(event, opts = {}) {
      if (event) event.preventDefault();
    
      // If a cluster animation was queued, cancel it
      if (this._clusterTimer) { clearTimeout(this._clusterTimer); this._clusterTimer = null; }
      // Close any open detail when changing grid mode
      if (this._detail?.active) { this.exitDetail(); }

      // grid.js – inside clusterGroupedObjects(event, opts = {}) { ... }
      if (this.currentState === 'clustered') {
        // Keep transforms consistent and ensure camera is legal; no re-fit jump.
        this._applyTransformsForCurrentState?.();
        this.clampCameraToBounds?.(true);
        return;
      }
    
      // Tunables (you can override from the caller if you want)
      const {
        spread = 1.25,      // >1 pushes clusters farther apart before “exploding”
        layoutMargin = 100, // base margin passed to layoutGroupCentersForFootprints
        preFitPad = 140,    // padding when fitting to footprints (pre-explosion)
        postFitPad = 160    // padding when fitting to final clustered layout
      } = opts;
    
      this.pauseAllVideos?.();
    
      // 1) Mark state
      this.currentState = 'pre-cluster';
    
      // 2) Estimate each group’s cluster footprint (radius)
      const footprints = this.estimateClusterFootprints(12);
    
      // 3) Increase required radii to create more inter-cluster distance
      for (const gid in footprints) {
        footprints[gid].r *= spread;
      }
    
      // 4) Compute new group centers with increased margin
      const centers = this.layoutGroupCentersForFootprints(footprints, Math.round(layoutMargin * spread));
    
      // 5) Fit camera to the larger footprints and sync pan state
      this.fitToFootprints(footprints, Math.round(preFitPad * spread));
      this._syncPanStateFromDom?.();
    
      // 6) Animate piles to their new (more distant) centers
      this.movePilesToNewCenters(centers, 18, 8);
      this._applyTransformsForCurrentState?.(); // cluster animation fix
    
      // 7) After the piles reached the new centers, perform the non-overlap “explode”
      this._clusterTimer = setTimeout(() => {
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
          const buffer = 12;
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
    
        // 8) Done
        this.currentState = 'clustered';
        this.fitToView('clustered', postFitPad);
        this._syncPanStateFromDom?.();
      }, 520);
    }    
  
    ungroupObjects(event) {

      if (event) event.preventDefault();
      // Close any open detail when changing grid mode
      if (this._detail?.active) { this.exitDetail(); }

      const prev = this.currentState;
      this.currentState = 'ungrouped';
      console.log('ungroup objects');
      // If we’re coming from clustered/pre-cluster, restore compact centers now
      if ((prev === 'clustered' || prev === 'pre-cluster') && this.baseGroupCenters) {
        if (this._clusterTimer) { clearTimeout(this._clusterTimer); this._clusterTimer = null; }
        for (const gid in this.baseGroupCenters) {
          if (!this.groups[gid]) this.groups[gid] = {};
          this.groups[gid].x = this.baseGroupCenters[gid].x;
          this.groups[gid].y = this.baseGroupCenters[gid].y;
        }
        // Recompute grouped scatter targets around the restored centers (no DOM anim)
        this.applyGroupedScatter?.(this.GROUPED_SPREAD, this.GROUPED_JITTER);
      }
  
      for(const object of this.objects) {
        const element = document.getElementById(object.id);
        element.style.transform = '';
      }

      this.fitToView('ungrouped', 160)
    }
  
    resetGrid(event) {
      this.recenterToViewport();
      this.groupObjects(); // snap back to centered grouped view
    }

    initWheelBlock({ allowCtrlWheelZoom = true } = {}) {
      // Wheel over the grid should never scroll the page
      this._onWheel = (e) => {
        // Allow scroll if target is inside an element that explicitly opts-in
        if (e.target?.closest?.('[data-allow-scroll], .allow-scroll')) return;
    
        // Optional: keep ctrl/cmd + wheel as zoom
        if (allowCtrlWheelZoom && (e.ctrlKey || e.metaKey)) {
          const factor = Math.pow(1.0015, -e.deltaY); // tweak speed if you want
          this.zoom?.(factor);
        }
    
        e.preventDefault();   // IMPORTANT: requires passive:false on listener
        e.stopPropagation();
      };
      this.htmlGridElement.addEventListener('wheel', this._onWheel, { passive: false });
    
      // Trackpads sometimes bubble wheel to window; block if it originated over the grid
      this._onWheelDoc = (e) => {
        const path = e.composedPath?.() || [];
        const overGrid = path.includes(this.htmlGridElement);
        if (!overGrid) return;
    
        // Still permit scrolling inside whitelisted elements inside the grid
        const target = e.target;
        if (target?.closest?.('[data-allow-scroll], .allow-scroll')) return;
    
        e.preventDefault();
        e.stopPropagation();
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
                  this.currentState = from;
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
              this.enterClusterDetail?.(clickedId);
            } else if (this.currentState === 'ungrouped' && !(this._detail && this._detail.active)) {
              this.enterDetail(clickedId, { size: 500, margin: 80 });
            }
        }
        p.clickCandidateId = null;
      });
    }          
}
