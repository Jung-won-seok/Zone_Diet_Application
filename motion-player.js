function movementPlayerView(motion) {
  const { frames, duration } = motion;
  const phaseButtons = frames.map((frame, index) => {
    if (index && frame.label === frames[index - 1].label) return '';
    return `<button type="button" data-motion-phase="${index}"${index === 0 ? ' aria-current="step"' : ''}>${escapeHTML(frame.label)}</button>`;
  }).join('');
  return `<section class="motion-player" data-motion-player aria-label="동작 시뮬레이션">
    <h3>동작 시뮬레이션</h3>
    <div class="motion-card">
      <canvas width="320" height="220" role="img" aria-label="현재 동작 자세"></canvas>
      <div class="motion-controls">
        <div class="motion-toolbar">
          <button class="motion-play" type="button" data-motion-play><span data-motion-icon aria-hidden="true">▶</span><span data-motion-play-label>재생</span></button>
          <strong data-motion-label>${escapeHTML(frames[0].label)}</strong>
          <button class="motion-rate" type="button" data-motion-rate aria-label="재생 속도 1배, 0.5배로 변경">1×</button>
        </div>
        <label class="motion-timeline">
          <span>재생 위치</span>
          <span class="motion-clock" aria-hidden="true"><b data-motion-current>0.00</b> / ${duration.toFixed(2)}초</span>
          <input data-motion-time type="range" min="0" max="${duration}" step="0.01" value="0">
        </label>
      </div>
    </div>
    <div class="motion-phases" role="group" aria-label="단계로 이동">${phaseButtons}</div>
  </section>`;
}

function mountMovementPlayer(root, motion) {
  const canvas = root.querySelector('canvas');
  const play = root.querySelector('[data-motion-play]');
  const playLabel = root.querySelector('[data-motion-play-label]');
  const icon = root.querySelector('[data-motion-icon]');
  const rate = root.querySelector('[data-motion-rate]');
  const range = root.querySelector('[data-motion-time]');
  const clock = root.querySelector('[data-motion-current]');
  const label = root.querySelector('[data-motion-label]');
  const steps = Array.from(root.querySelectorAll('[data-motion-phase]'));
  const events = new AbortController();
  const options = { signal: events.signal };
  let time = 0, speed = 1;
  let playing = false, frameId = null, lastTick = 0;
  let shownPhase = -1;

  function render() {
    const { pose, phaseIndex } = sampleMovementPose(motion, time);
    drawMovementPose(canvas, motion, pose);
    const phase = motion.frames[phaseIndex].label;
    range.value = time.toFixed(2);
    range.setAttribute('aria-valuetext', `${time.toFixed(2)}초, ${phase}`);
    clock.textContent = time.toFixed(2);
    if (phaseIndex !== shownPhase) {
      shownPhase = phaseIndex;
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
    const action = playing ? '일시정지' : time >= motion.duration ? '다시 재생' : '재생';
    if (playLabel.textContent !== action) {
      playLabel.textContent = action;
      icon.textContent = playing ? 'Ⅱ' : '▶';
    }
  }

  function advance(now) {
    time = Math.min(motion.duration, time + Math.max(0, now - lastTick) * speed / 1000);
    lastTick = now;
  }
  function stop() {
    playing = false;
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
  }
  function tick(now) {
    frameId = null;
    if (!playing) return;
    advance(now);
    if (time >= motion.duration) stop();
    render();
    if (playing) frameId = requestAnimationFrame(tick);
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
  play.addEventListener('click', () => {
    if (playing) { pause(); return; }
    if (time >= motion.duration) time = 0;
    lastTick = performance.now();
    playing = true;
    render();
    frameId = requestAnimationFrame(tick);
  }, options);
  range.addEventListener('pointerdown', pause, options);
  range.addEventListener('input', () => seek(Number(range.value)), options);
  for (const step of steps) {
    step.addEventListener('click', () => seek(motion.frames[Number(step.dataset.motionPhase)].at), options);
  }
  rate.addEventListener('click', () => {
    if (playing) advance(performance.now());
    speed = speed === 1 ? 0.5 : 1;
    rate.textContent = speed + '×';
    rate.dataset.slow = String(speed === 0.5);
    rate.setAttribute('aria-label', `재생 속도 ${speed}배, ${speed === 1 ? 0.5 : 1}배로 변경`);
    render();
  }, options);
  document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); }, options);
  render();
  const resize = new ResizeObserver(() => {
    if (!events.signal.aborted) drawMovementPose(canvas, motion, sampleMovementPose(motion, time).pose);
  });
  resize.observe(canvas);
  return {
    pause,
    dispose() {
      stop();
      resize.disconnect();
      events.abort();
    }
  };
}
