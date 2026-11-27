const movementCameraViews = {
  oblique: { label: '사선', yaw: 0.48, pitch: 0.09 },
  front: { label: '정면', yaw: Math.PI / 2, pitch: 0 },
  side: { label: '측면', yaw: 0, pitch: 0 },
  back: { label: '후면', yaw: -Math.PI / 2, pitch: 0 },
};

function movement3DControlsView() {
  const buttons = Object.entries(movementCameraViews).map(([id, view]) =>
    `<button type="button" data-camera-view="${id}" aria-pressed="${id === 'oblique'}" aria-label="${view.label} 시점">${view.label}</button>`
  ).join('');
  return `<div class="motion-camera" data-motion-camera hidden>
    <div class="motion-camera-views" role="group" aria-label="3D 시점 선택">${buttons}</div>
    <div class="motion-camera-tools">
      <div class="motion-camera-zoom" role="group" aria-label="3D 확대·축소">
        <button type="button" data-camera-zoom="out" aria-label="축소">−</button>
        <output data-camera-scale aria-label="현재 배율">100%</output>
        <button type="button" data-camera-zoom="in" aria-label="확대">+</button>
      </div>
      <p>드래그하거나 방향키로 회전하고, 두 손가락으로 확대·축소하세요.</p>
    </div>
  </div>`;
}

function mountMovementCamera(canvas, controls, onChange) {
  const buttons = Array.from(controls.querySelectorAll('[data-camera-view]'));
  const zoomButtons = Array.from(controls.querySelectorAll('[data-camera-zoom]'));
  const scale = controls.querySelector('[data-camera-scale]');
  const events = new AbortController();
  const listeners = { signal: events.signal };
  const pointers = new Map();
  const minZoom = 0.5, maxZoom = 3;
  let { yaw, pitch } = movementCameraViews.oblique;
  let zoom = 1;
  let enabled = false;
  let drag = null;
  let pinchSpan = 0;

  function getView() { return { yaw, pitch, zoom }; }

  function setZoom(value) {
    const bounded = Math.min(maxZoom, Math.max(minZoom, value));
    if (bounded === zoom) return;
    zoom = bounded;
    scale.textContent = Math.round(100 * zoom) + '%';
    for (const button of zoomButtons) {
      button.disabled = button.dataset.cameraZoom === 'in' ? zoom === maxZoom : zoom === minZoom;
    }
    onChange(getView());
  }

  function setView(nextYaw, nextPitch) {
    yaw = Math.atan2(Math.sin(nextYaw), Math.cos(nextYaw));
    pitch = Math.max(-0.35, Math.min(0.85, nextPitch));
    for (const button of buttons) {
      const preset = movementCameraViews[button.dataset.cameraView];
      const selected = Math.abs(yaw - preset.yaw) < 0.001 && Math.abs(pitch - preset.pitch) < 0.001;
      button.setAttribute('aria-pressed', String(selected));
    }
    onChange(getView());
  }

  function endPointer(id) {
    if (!pointers.delete(id)) return;
    // A remaining finger after a pinch must lift before it can start an orbit.
    drag = null;
    pinchSpan = 0;
    canvas.removeAttribute('data-camera-dragging');
    if (canvas.hasPointerCapture(id)) canvas.releasePointerCapture(id);
  }

  function setEnabled(nextEnabled) {
    enabled = nextEnabled;
    controls.hidden = !enabled;
    canvas.tabIndex = enabled ? 0 : -1;
    if (enabled) {
      canvas.setAttribute('data-camera-enabled', '');
      canvas.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown');
    } else {
      for (const id of pointers.keys()) endPointer(id);
      canvas.removeAttribute('data-camera-enabled');
      canvas.removeAttribute('aria-keyshortcuts');
    }
  }

  for (const button of buttons) {
    button.addEventListener('click', () => {
      if (!enabled) return;
      const preset = movementCameraViews[button.dataset.cameraView];
      setView(preset.yaw, preset.pitch);
    }, listeners);
  }
  for (const button of zoomButtons) {
    button.addEventListener('click', () => {
      if (enabled) setZoom(zoom + (button.dataset.cameraZoom === 'in' ? 0.25 : -0.25));
    }, listeners);
  }

  function distanceBetweenPointers() {
    const [first, second] = pointers.values();
    return Math.hypot(first.x - second.x, first.y - second.y);
  }

  canvas.addEventListener('pointerdown', event => {
    if (!enabled || event.button !== 0 || pointers.size >= 2) return;
    if (pointers.size && (event.pointerType !== 'touch' || pointers.values().next().value.type !== 'touch')) return;
    const point = { x: event.clientX, y: event.clientY, type: event.pointerType };
    pointers.set(event.pointerId, point);
    canvas.setPointerCapture(event.pointerId);
    if (pointers.size === 2) {
      drag = null;
      pinchSpan = distanceBetweenPointers();
      canvas.removeAttribute('data-camera-dragging');
      return;
    }
    const scroller = canvas.closest('dialog');
    drag = { x: point.x, y: point.y, yaw, pitch, mode: null, scroller, scrollTop: scroller?.scrollTop ?? 0 };
  }, listeners);
  canvas.addEventListener('pointermove', event => {
    const point = pointers.get(event.pointerId);
    if (!point) return;
    point.x = event.clientX;
    point.y = event.clientY;
    if (pointers.size === 2) {
      const span = distanceBetweenPointers();
      if (span >= 1 && pinchSpan >= 1) setZoom(zoom * span / pinchSpan);
      pinchSpan = span;
      return;
    }
    if (!drag) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (event.pointerType === 'touch' && !drag.mode) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 5) return;
      drag.mode = Math.abs(dy) > Math.abs(dx) ? 'scroll' : 'orbit';
    }
    if (drag.mode === 'scroll') {
      if (drag.scroller) drag.scroller.scrollTop = drag.scrollTop - dy;
      return;
    }
    if (!dx && !dy && !drag.mode) return;
    drag.mode = 'orbit';
    canvas.setAttribute('data-camera-dragging', '');
    setView(drag.yaw + dx * 2 * Math.PI / Math.max(200, canvas.clientWidth),
      drag.pitch - dy * 2 / Math.max(140, canvas.clientHeight));
  }, listeners);
  for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(eventName, event => endPointer(event.pointerId), listeners);
  }
  canvas.addEventListener('keydown', event => {
    if (!enabled || event.altKey || event.ctrlKey || event.metaKey) return;
    const step = Math.PI / 12;
    switch (event.key) {
      case 'ArrowLeft': setView(yaw - step, pitch); break;
      case 'ArrowRight': setView(yaw + step, pitch); break;
      case 'ArrowUp': setView(yaw, pitch + step); break;
      case 'ArrowDown': setView(yaw, pitch - step); break;
      default: return;
    }
    event.preventDefault();
  }, listeners);

  setEnabled(false);
  return {
    getView,
    setEnabled,
    dispose() {
      setEnabled(false);
      events.abort();
    },
  };
}
