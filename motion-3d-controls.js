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
    <p>드래그하거나 방향키로 시점을 돌리세요.</p>
  </div>`;
}

function mountMovementCamera(canvas, controls, onChange) {
  const buttons = Array.from(controls.querySelectorAll('[data-camera-view]'));
  const events = new AbortController();
  const listeners = { signal: events.signal };
  let { yaw, pitch } = movementCameraViews.oblique;
  let enabled = false;
  let drag = null;

  function setView(nextYaw, nextPitch) {
    yaw = Math.atan2(Math.sin(nextYaw), Math.cos(nextYaw));
    pitch = Math.max(-0.35, Math.min(0.85, nextPitch));
    for (const button of buttons) {
      const preset = movementCameraViews[button.dataset.cameraView];
      const selected = Math.abs(yaw - preset.yaw) < 0.001 && Math.abs(pitch - preset.pitch) < 0.001;
      button.setAttribute('aria-pressed', String(selected));
    }
    onChange({ yaw, pitch });
  }

  function endDrag() {
    if (!drag) return;
    const id = drag.id;
    drag = null;
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
      endDrag();
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

  canvas.addEventListener('pointerdown', event => {
    if (!enabled || drag || !event.isPrimary || event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, yaw, pitch, started: false };
    canvas.setPointerCapture(event.pointerId);
  }, listeners);
  canvas.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    // Let a vertical touch swipe scroll the dialog without nudging the camera.
    if (!drag.started && event.pointerType === 'touch' && (Math.abs(dx) < 5 || Math.abs(dy) > Math.abs(dx))) return;
    if (!dx && !dy && !drag.started) return;
    drag.started = true;
    canvas.setAttribute('data-camera-dragging', '');
    setView(drag.yaw + dx * 2 * Math.PI / Math.max(200, canvas.clientWidth),
      drag.pitch - dy * 2 / Math.max(140, canvas.clientHeight));
  }, listeners);
  for (const eventName of ['pointerup', 'pointercancel', 'lostpointercapture']) {
    canvas.addEventListener(eventName, event => {
      if (drag && event.pointerId === drag.id) endDrag();
    }, listeners);
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
    getView: () => ({ yaw, pitch }),
    setEnabled,
    dispose() {
      setEnabled(false);
      events.abort();
    },
  };
}
