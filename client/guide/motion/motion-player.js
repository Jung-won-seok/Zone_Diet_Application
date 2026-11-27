const movementPlaybackRates = [0.5, 0.75, 1, 1.25, 1.5];

function movementPlayerView(motion) {
  const { frames, duration } = motion;
  const ratesId = 'motion-rates-' + escapeHTML(motion.id);
  const rateButtons = movementPlaybackRates.map(speed =>
    `<button type="button" data-motion-speed="${speed}" aria-label="${speed}배" aria-pressed="${speed === 1}">${speed}×</button>`
  ).join('');
  const phaseButtons = frames.map((frame, index) => {
    if (index && frame.label === frames[index - 1].label) return '';
    return `<button type="button" data-motion-phase="${index}"${index === 0 ? ' aria-current="step"' : ''}>${escapeHTML(frame.label)}</button>`;
  }).join('');
  return `<section class="motion-player" data-motion-player aria-label="동작 시뮬레이션">
    <div class="motion-heading">
      <h3>동작 시뮬레이션</h3>
      <div class="motion-modes" role="group" aria-label="동작 보기 방식">
        <button type="button" data-motion-mode="2d" aria-pressed="true">2D</button>
        <button type="button" data-motion-mode="3d" aria-pressed="false">3D</button>
      </div>
    </div>
    <div class="motion-card">
      <canvas width="320" height="220" role="img" aria-label="현재 동작 자세"></canvas>
      ${movement3DControlsView()}
      <div class="motion-controls">
        <div class="motion-toolbar">
          <button class="motion-play" type="button" data-motion-play><span data-motion-icon aria-hidden="true">▶</span><span data-motion-play-label>재생</span></button>
          <strong data-motion-label>${escapeHTML(frames[0].label)}</strong>
          <button class="motion-rate" type="button" data-motion-rate aria-label="재생 속도 1배" aria-expanded="false" aria-controls="${ratesId}">배속 1×</button>
        </div>
        <div id="${ratesId}" class="motion-rates" data-motion-rates role="group" aria-label="재생 속도 선택" hidden>${rateButtons}</div>
        <label class="motion-timeline">
          <span>재생 위치</span>
          <span class="motion-clock" aria-hidden="true"><b data-motion-current>0.00</b> / ${duration.toFixed(2)}초</span>
          <input data-motion-time type="range" min="0" max="${duration}" step="0.01" value="0">
        </label>
      </div>
    </div>
    ${movementMuscleView()}
    <div class="motion-phases" role="group" aria-label="단계로 이동">${phaseButtons}</div>
  </section>`;
}

function mountMovementPlayer(root, motion) {
  const canvas = root.querySelector('canvas');
  const play = root.querySelector('[data-motion-play]');
  const playLabel = root.querySelector('[data-motion-play-label]');
  const icon = root.querySelector('[data-motion-icon]');
  const rate = root.querySelector('[data-motion-rate]');
  const rates = root.querySelector('[data-motion-rates]');
  const rateButtons = root.querySelectorAll('[data-motion-speed]');
  const range = root.querySelector('[data-motion-time]');
  const clock = root.querySelector('[data-motion-current]');
  const label = root.querySelector('[data-motion-label]');
  const muscles = root.querySelector('[data-motion-muscles]');
  const steps = Array.from(root.querySelectorAll('[data-motion-phase]'));
  const modes = Array.from(root.querySelectorAll('[data-motion-mode]'));
  const events = new AbortController();
  const options = { signal: events.signal };
  let time = 0, speed = 1;
  let playing = false, frameId = null, lastTick = null;
  let shownPhase = -1;
  let activeRegions = [];
  let viewMode = '2d';
  let currentPose;
  const camera = mountMovementCamera(canvas, root.querySelector('[data-motion-camera]'), drawPose);

  function drawPose() {
    if (!currentPose) return;
    if (viewMode === '3d') drawMovementPose3D(canvas, motion, currentPose, activeRegions, camera.getView());
    else drawMovementPose(canvas, motion, currentPose, activeRegions);
  }

  function render() {
    const { pose, phaseIndex } = sampleMovementPose(motion, time);
    currentPose = pose;
    const phase = motion.frames[phaseIndex].label;
    range.value = time.toFixed(2);
    range.setAttribute('aria-valuetext', `${time.toFixed(2)}초, ${phase}`);
    clock.textContent = time.toFixed(2);
    if (phaseIndex !== shownPhase) {
      shownPhase = phaseIndex;
      activeRegions = getMovementMuscles(motion.id, phaseIndex);
      updateMovementMuscleView(muscles, activeRegions);
      label.textContent = phase;
      canvas.setAttribute('aria-label', phase + ' 자세');
      let currentStep = steps[0];
      for (const step of steps) {
        if (Number(step.dataset.motionPhase) <= phaseIndex) currentStep = step;
      }
      for (const step of steps) {
        if (step === currentStep) step.setAttribute('aria-current', 'step');
        else step.removeAttribute('aria-current');
      }
    }
    drawPose();
    const action = playing ? '일시정지' : time >= motion.duration ? '다시 재생' : '재생';
    if (playLabel.textContent !== action) {
      playLabel.textContent = action;
      icon.textContent = playing ? 'Ⅱ' : '▶';
    }
  }

  function advance(now) {
    if (lastTick === null || now <= lastTick) return;
    time = (time + (now - lastTick) * speed / 1000) % motion.duration;
    lastTick = now;
  }
  function stopClock() {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
    lastTick = null;
  }
  function startClock() {
    if (lastTick !== null || document.hidden) return;
    lastTick = performance.now();
    frameId = requestAnimationFrame(tick);
  }
  function stop() {
    playing = false;
    stopClock();
  }
  function tick(now) {
    frameId = null;
    if (!playing || lastTick === null) return;
    advance(now);
    render();
    frameId = requestAnimationFrame(tick);
  }
  function pause() {
    if (!playing) return;
    advance(performance.now());
    stop();
    render();
  }
  function seek(seconds) {
    stop();
    time = Math.max(0, Math.min(seconds, motion.duration));
    render();
  }
  for (const button of modes) {
    button.addEventListener('click', () => {
      viewMode = button.dataset.motionMode;
      for (const mode of modes) mode.setAttribute('aria-pressed', String(mode === button));
      camera.setEnabled(viewMode === '3d');
      drawPose();
    }, options);
  }
  play.addEventListener('click', () => {
    if (playing) { pause(); return; }
    if (time >= motion.duration) time = 0;
    playing = true;
    render();
    startClock();
  }, options);
  range.addEventListener('pointerdown', pause, options);
  range.addEventListener('input', () => seek(Number(range.value)), options);
  for (const step of steps) {
    step.addEventListener('click', () => seek(motion.frames[Number(step.dataset.motionPhase)].at), options);
  }
  function showRates(open) {
    rates.hidden = !open;
    rate.setAttribute('aria-expanded', String(open));
    if (!open) rate.focus({ preventScroll: true });
  }
  rate.addEventListener('click', () => showRates(rates.hidden), options);
  for (const button of rateButtons) {
    button.addEventListener('click', () => {
      if (playing) advance(performance.now());
      speed = Number(button.dataset.motionSpeed);
      rate.textContent = `배속 ${speed}×`;
      rate.setAttribute('aria-label', `재생 속도 ${speed}배`);
      for (const choice of rateButtons) choice.setAttribute('aria-pressed', String(choice === button));
      showRates(false);
      render();
    }, options);
  }
  root.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || rates.hidden) return;
    event.preventDefault();
    showRates(false);
  }, options);
  document.addEventListener('visibilitychange', () => {
    if (!playing) return;
    if (document.hidden) {
      advance(performance.now());
      stopClock();
    } else {
      startClock();
    }
  }, options);
  render();
  const resize = new ResizeObserver(() => {
    if (!events.signal.aborted) drawPose();
  });
  resize.observe(canvas);
  return {
    pause,
    dispose() {
      stop();
      resize.disconnect();
      camera.dispose();
      events.abort();
    }
  };
}
