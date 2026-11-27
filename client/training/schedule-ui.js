const coachSchedulePanels = new WeakMap();

function coachScheduleChoices(day) {
  if (day.date < day.today) return [];
  const choices = [];
  if (!day.dayClosed) choices.push(['addClass', '특별 수업 추가']);
  if (day.canOpenDay) choices.push(['openDay', '하루 휴강 해제']);
  if (day.canCloseDay) choices.push(['closeDay', '남은 수업 전체 휴강']);
  if (day.dayClosed) return choices;
  if (day.classes.some(slot => !slot.started && !slot.cancelled)) choices.push(['cancelClass', '수업 한 타임 취소']);
  if (day.classes.some(slot => !slot.started && slot.cancelled)) choices.push(['restoreClass', '취소한 수업 재개']);
  return choices;
}

function coachScheduleAffected(day, action, startTime) {
  const isDay = action === 'closeDay';
  const isSlot = action === 'cancelClass';
  const slots = day.classes.filter(slot =>
    !slot.started && !slot.cancelled && (isDay || (isSlot && startTime === slot.startTime))
  );
  return {
    confirmed: slots.reduce((total, slot) => total + slot.confirmedCount, 0),
    waiting: slots.reduce((total, slot) => total + slot.waitlistCount, 0)
  };
}

function coachScheduleOptions(select, entries) {
  const signature = JSON.stringify(entries);
  if (select.dataset.signature === signature) return;
  const current = select.value;
  select.replaceChildren(...entries.map(([value, text]) => new Option(text, value)));
  if (entries.some(([value]) => value === current)) select.value = current;
  select.dataset.signature = signature;
}

function mountCoachSchedulePanel(host, page, onSaved) {
  host.innerHTML = `<details class="coach-schedule-card">
    <summary>코치 수업 일정 관리</summary><div class="coach-schedule-body">
      <p class="coach-schedule-state" data-schedule-state></p>
      <form class="coach-schedule-form"><fieldset>
        <legend class="sr-only">일정 변경</legend>
        <label class="field" for="schedule-operation">변경 종류
          <select name="action" id="schedule-operation"></select></label>
        <label class="field" for="schedule-slot" data-schedule-slot hidden>수업 선택
          <select name="slot" id="schedule-slot" disabled></select></label>
        <label class="field" for="schedule-reason" data-schedule-reason hidden>휴강·취소 사유 (선택)
          <input name="reason" id="schedule-reason" maxlength="100" disabled></label>
        <div class="coach-schedule-extra" data-schedule-special hidden>
          <label class="field" for="schedule-label">수업 이름
            <input name="label" id="schedule-label" maxlength="40" placeholder="특별 수업" disabled></label>
          <div class="coach-schedule-grid">
            <label class="field" for="schedule-start">시작 시각
              <input type="time" name="startTime" id="schedule-start" required disabled></label>
            <label class="field" for="schedule-end">종료 시각
              <input type="time" name="endTime" id="schedule-end" required disabled></label>
            <label class="field" for="schedule-capacity">예약 정원
              <input type="number" name="capacity" id="schedule-capacity" min="1" max="100" value="18" required disabled></label>
            <label class="field" for="schedule-waitlist">대기 정원
              <input type="number" name="waitlistCapacity" id="schedule-waitlist" min="0" max="20" value="2" required disabled></label>
          </div>
        </div>
        <button class="button secondary" type="submit">변경 내용 확인</button>
      </fieldset></form>
      <div class="coach-schedule-review" data-schedule-review hidden>
        <h3 tabindex="-1">변경 내용 확인</h3>
        <p data-schedule-description></p><p data-schedule-impact></p><p data-schedule-rebooking></p>
        <div class="coach-schedule-actions"><button type="button" class="button" data-schedule-submit></button>
          <button type="button" class="button secondary" data-schedule-back>돌아가기</button></div>
      </div>
      <p class="coach-schedule-message" role="status" aria-live="polite"></p>
    </div></details>`;
  const state = { host, page, date: page.date, onSaved, pending: null, submitting: false };
  state.form = host.querySelector('form');
  state.review = host.querySelector('[data-schedule-review]');
  state.message = host.querySelector('[role="status"]');
  state.form.onsubmit = event => {
    event.preventDefault();
    if (state.page.busy || state.submitting || !state.form.reportValidity()) return;
    const day = state.page.data;
    const fields = state.form.elements;
    const action = fields.namedItem('action').value;
    const label = coachScheduleChoices(day).find(([key]) => key === action)?.[1];
    if (!label) return;
    const body = { date: day.date, revision: day.scheduleRevision, action };
    let description = day.date + ' · ' + label;
    const isCancel = action === 'closeDay' || action === 'cancelClass';
    if (action === 'closeDay' && day.classes.some(slot => slot.started)) {
      description += ' · 이미 시작한 수업은 기존 일정으로 유지됩니다.';
    }
    if (action === 'openDay') description += ' · 개별 취소된 수업을 제외하고 앞으로 시작할 수업을 다시 엽니다.';
    if (action === 'cancelClass' || action === 'restoreClass') {
      body.startTime = fields.slot.value;
      description += ' · ' + body.startTime;
    }
    const counts = coachScheduleAffected(day, action, body.startTime);
    if (isCancel) {
      body.reason = fields.reason.value.trim();
      body.rosterRevision = day.rosterRevision;
      body.expectedConfirmed = counts.confirmed;
      body.expectedWaiting = counts.waiting;
      body.expectedBookings = counts.confirmed + counts.waiting;
      if (body.reason) description += ' · ' + body.reason;
    }
    if (action === 'addClass') {
      body.startTime = fields.startTime.value;
      body.endTime = fields.endTime.value;
      if (body.startTime >= body.endTime) {
        fields.endTime.setCustomValidity('종료 시각은 시작 시각 이후여야 합니다.');
        fields.endTime.reportValidity();
        return;
      }
      body.label = fields.label.value.trim();
      body.capacity = Number(fields.capacity.value);
      body.waitlistCapacity = Number(fields.waitlistCapacity.value);
      description += ` · ${body.label || '특별 수업'} ${body.startTime}–${body.endTime} · 정원 ${body.capacity}명, 대기 ${body.waitlistCapacity}명`;
    }
    state.pending = body;
    state.review.querySelector('[data-schedule-description]').textContent = description;
    state.review.querySelector('[data-schedule-impact]').textContent = isCancel
      ? `예약 확정 ${counts.confirmed}명과 대기 ${counts.waiting}명의 신청이 취소됩니다.`
      : '';
    const rebooking = state.review.querySelector('[data-schedule-rebooking]');
    rebooking.textContent = action === 'addClass' ? '' : '수업을 다시 열어도 기존 예약과 대기는 복원되지 않습니다. 회원이 다시 신청해야 합니다.';
    const submit = state.review.querySelector('[data-schedule-submit]');
    submit.textContent = label + ' 적용';
    state.review.hidden = false;
    state.message.textContent = '';
    state.review.querySelector('h3').focus();
  };
  state.form.addEventListener('input', () => {
    state.form.elements.endTime.setCustomValidity('');
    state.message.textContent = '';
    discardSchedulePreview(state);
  });
  state.form.onchange = () => {
    discardSchedulePreview(state);
    updateCoachSchedulePanel(state);
  };
  state.review.querySelector('[data-schedule-back]').onclick = () => {
    discardSchedulePreview(state);
    state.form.querySelector('[type="submit"]').focus();
  };
  state.review.querySelector('[data-schedule-submit]').onclick = () => applyCoachSchedule(state);
  return state;
}

function discardSchedulePreview(state) {
  state.pending = null;
  state.review.hidden = true;
}

function updateCoachSchedulePanel(state) {
  const day = state.page.data;
  const ready = day && day.date === state.date && !state.page.error;
  const fieldset = state.form.querySelector('fieldset');
  if (!ready) {
    state.host.querySelector('[data-schedule-state]').textContent = state.page.error || '일정을 불러오는 중입니다.';
    fieldset.disabled = true;
    discardSchedulePreview(state);
    return;
  }
  const choices = coachScheduleChoices(day);
  const stateText = day.dayClosed && day.classes.some(slot => slot.started && !slot.cancelled) ? '남은 수업 휴강'
    : day.dayClosed ? '하루 휴강' : '수업 일정';
  state.host.querySelector('[data-schedule-state]').textContent = day.date + ' · ' + stateText +
    (day.dayClosed && day.scheduleReason ? ' · ' + day.scheduleReason : '') +
    (choices.length ? '' : ' · 변경할 수 있는 일정이 없습니다.');
  state.form.hidden = !choices.length;
  const fields = state.form.elements;
  const actionField = fields.namedItem('action');
  coachScheduleOptions(actionField, choices);
  const action = actionField.value;
  const single = action === 'cancelClass' || action === 'restoreClass';
  const slotList = day.classes.filter(slot =>
    !slot.started && (action === 'restoreClass' ? slot.cancelled : !slot.cancelled)
  );
  coachScheduleOptions(fields.slot, slotList.map(slot =>
    [slot.startTime, slot.startTime + '–' + slot.endTime + (slot.label ? ' · ' + slot.label : '')]
  ));
  const groups = [
    ['[data-schedule-slot]', single],
    ['[data-schedule-special]', action === 'addClass'],
    ['[data-schedule-reason]', action === 'closeDay' || action === 'cancelClass']
  ];
  for (const [selector, enabled] of groups) {
    const group = state.form.querySelector(selector);
    group.hidden = !enabled;
    group.querySelectorAll('input,select').forEach(control => { control.disabled = !enabled; });
  }
  fieldset.disabled = state.submitting || !choices.length;
  const submitDisabled = fieldset.disabled || state.page.busy;
  state.form.querySelector('[type="submit"]').disabled = submitDisabled;
  state.review.querySelectorAll('button').forEach(button => { button.disabled = submitDisabled; });
  const pending = state.pending;
  if (pending) {
    const counts = coachScheduleAffected(day, pending.action, pending.startTime);
    const slotChanged = single && fields.slot.value !== pending.startTime;
    const rosterChanged = pending.expectedBookings !== undefined &&
      (day.rosterRevision !== pending.rosterRevision || counts.confirmed !== pending.expectedConfirmed || counts.waiting !== pending.expectedWaiting);
    if (day.scheduleRevision !== pending.revision || action !== pending.action || slotChanged || rosterChanged) {
      discardSchedulePreview(state);
      state.message.textContent = '일정 또는 신청 인원이 바뀌었습니다. 변경 내용을 다시 확인해주세요.';
    }
  }
}

async function applyCoachSchedule(state) {
  updateCoachSchedulePanel(state);
  if (!state.pending || state.submitting || state.page.busy) return;
  const body = state.pending;
  state.submitting = true;
  updateCoachSchedulePanel(state);
  state.message.textContent = '일정을 저장하는 중입니다.';
  const active = () => state.host.isConnected && coachSchedulePanels.get(state.host) === state;
  let refresh = false;
  try {
    await api('/api/admin/schedule', { method: 'POST', body: JSON.stringify(body) });
    if (!active()) return;
    discardSchedulePreview(state);
    state.form.reset();
    state.message.textContent = '수업 일정을 변경했습니다.';
    refresh = true;
  } catch (error) {
    if (!active()) return;
    discardSchedulePreview(state);
    if (error.status === 409 || !error.status || error.status >= 500) {
      state.message.textContent = error.message + ' 최신 일정을 확인한 뒤 다시 진행해주세요.';
      refresh = true;
    } else {
      state.message.textContent = error.message;
    }
  } finally {
    if (refresh && active()) {
      try {
        await state.onSaved();
      } catch {
        if (active()) state.message.textContent += ' 최신 일정을 불러오려면 새로고침해주세요.';
      }
    }
    state.submitting = false;
    if (active()) updateCoachSchedulePanel(state);
  }
}

function paintCoachSchedule(host, page, onSaved) {
  if (!host) return;
  let state = coachSchedulePanels.get(host);
  if (!state || state.page !== page || state.date !== page.date) {
    state = mountCoachSchedulePanel(host, page, onSaved);
    coachSchedulePanels.set(host, state);
  }
  state.onSaved = onSaved;
  updateCoachSchedulePanel(state);
}
