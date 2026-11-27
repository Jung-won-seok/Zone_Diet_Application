const { scheduleDay, CAPACITY, WAITLIST_CAPACITY } = require('../services/schedule');

function table(name, key, fields, json = []) {
  return { name, key, columns: [...key, ...fields], json };
}

// Parents precede children for inserts. Delete in reverse order.
const tables = [
  table('sections', ['field'], ['kind', 'value'], ['value']),
  table('section_items', ['field', 'group_key', 'item_key'], ['value'], ['value']),
  table('accounts', ['member_id'], ['ordinal', 'username', 'display_name', 'is_admin', 'salt', 'password_hash', 'details'], ['details']),
  table('members', ['member_id'], ['ordinal', 'team_id', 'role', 'custom_role', 'details'], ['details']),
  table('memberships', ['member_id'], ['kind', 'expires_on', 'remaining_visits', 'revision', 'has_charges', 'details'], ['details']),
  table('pass_charges', ['member_id', 'class_date'], ['value'], ['value']),
  table('class_days', ['class_date'], ['schedule_details', 'roster_revision', 'has_reservations'], ['schedule_details']),
  table('class_slots', ['class_date', 'start_time'], ['end_time', 'capacity', 'waitlist_capacity', 'special_ordinal', 'special_details', 'cancel_details', 'has_queue'], ['special_details', 'cancel_details']),
  table('reservations', ['class_date', 'member_id'], ['start_time', 'position']),
  table('media', ['media_id'], ['member_id', 'team_id', 'mime', 'details'], ['details']),
];

const rowKey = (definition, row) => JSON.stringify(definition.key.map(column => row[column]));
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const normalized = new Set(['users', 'members', 'memberships', 'media', 'classSchedules', 'classReservations', 'classRosterRevisions']);
const accountFields = { id: 'member_id', username: 'username', name: 'display_name', isAdmin: 'is_admin', salt: 'salt', passwordHash: 'password_hash' };
const memberFields = { id: 'member_id', teamId: 'team_id', role: 'role', customRole: 'custom_role' };
const passFields = { kind: 'kind', expiresOn: 'expires_on', remainingVisits: 'remaining_visits', revision: 'revision' };
const mediaFields = { memberId: 'member_id', teamId: 'team_id', mime: 'mime' };
const specialFields = { startTime: 'start_time', endTime: 'end_time', capacity: 'capacity', waitlistCapacity: 'waitlist_capacity' };

// A JSON null in details distinguishes explicitly null from absent properties.
// Other fields include auth versions, recovery digests and future app fields.
function pack(record, fields) {
  const details = { ...record };
  const result = { details };
  for (const [property, column] of Object.entries(fields)) {
    result[column] = record[property] ?? null;
    if (result[column] !== null) delete details[property];
  }
  return result;
}

function unpack(row, fields, details = row.details) {
  const record = { ...details };
  for (const [property, column] of Object.entries(fields)) {
    if (row[column] !== null && row[column] !== undefined) record[property] = row[column];
  }
  return record;
}

function writeSections(store, rows) {
  for (const [field, value] of Object.entries(store)) {
    const kind = Array.isArray(value) ? 'array' : isObject(value) ? 'object' : 'scalar';
    rows.sections.push({ field, kind, value: kind === 'scalar' ? value : null });
    if (normalized.has(field)) {
      const expected = ['users', 'members'].includes(field) ? 'array' : 'object';
      if (kind !== expected) throw new Error('Invalid database snapshot section: ' + field);
      continue;
    }
    if (kind === 'scalar') continue;
    for (const [item_key, item] of Object.entries(value)) {
      // A login or logout affects one session, even if many devices are active.
      const authGroup = field === 'authState' && ['sessions', 'failures'].includes(item_key) && isObject(item);
      rows.section_items.push({ field, group_key: '', item_key, value: authGroup ? {} : item });
      if (authGroup) {
        for (const [token, data] of Object.entries(item)) {
          rows.section_items.push({ field, group_key: item_key, item_key: token, value: data });
        }
      }
    }
  }
}

function writeClassDays(store, rows) {
  const dates = new Set([
    ...Object.keys(store.classSchedules || {}),
    ...Object.keys(store.classReservations || {}),
    ...Object.keys(store.classRosterRevisions || {}),
  ]);
  for (const class_date of dates) {
    const settings = store.classSchedules?.[class_date];
    const queues = store.classReservations?.[class_date];
    const specials = settings?.specials || [];
    const cancellations = settings?.cancelled || {};
    const schedule_details = settings ? { ...settings } : null;
    if (settings?.specials) schedule_details.specials = [];
    if (settings?.cancelled) schedule_details.cancelled = {};
    rows.class_days.push({
      class_date, schedule_details, roster_revision: store.classRosterRevisions?.[class_date] ?? null,
      has_reservations: queues !== undefined,
    });
    const specialOrder = new Map(specials.map((item, i) => [item.startTime, i]));
    const slots = new Map(scheduleDay(store, class_date, 0).classes.map(slot => [slot.startTime, slot]));
    if (specialOrder.size !== specials.length) throw new Error('Duplicate special class start time');
    const times = new Set([...slots.keys(), ...Object.keys(cancellations), ...Object.keys(queues || {})]);
    for (const start_time of times) {
      const slot = slots.get(start_time);
      const special_ordinal = specialOrder.get(start_time) ?? null;
      const queue = queues?.[start_time];
      rows.class_slots.push({
        class_date, start_time, end_time: slot?.endTime ?? null,
        capacity: slot?.capacity ?? CAPACITY, waitlist_capacity: slot?.waitlistCapacity ?? WAITLIST_CAPACITY,
        special_ordinal, special_details: special_ordinal === null ? null : pack(specials[special_ordinal], specialFields).details,
        cancel_details: cancellations[start_time] ?? null, has_queue: queue !== undefined,
      });
      (queue || []).forEach((member_id, i) => rows.reservations.push({ class_date, start_time, member_id, position: i + 1 }));
    }
  }
}

function toRows(store) {
  const rows = Object.fromEntries(tables.map(({ name }) => [name, []]));
  writeSections(store, rows);
  (store.users || []).forEach((account, ordinal) => rows.accounts.push({ ...pack(account, accountFields), ordinal }));
  (store.members || []).forEach((member, ordinal) => rows.members.push({ ...pack(member, memberFields), ordinal }));
  for (const [member_id, pass] of Object.entries(store.memberships || {})) {
    const row = { ...pack(pass, passFields), member_id, has_charges: isObject(pass.chargedDates) };
    if (row.has_charges) {
      delete row.details.chargedDates;
      for (const [class_date, value] of Object.entries(pass.chargedDates)) rows.pass_charges.push({ member_id, class_date, value });
    }
    rows.memberships.push(row);
  }
  writeClassDays(store, rows);
  for (const [media_id, media] of Object.entries(store.media || {})) rows.media.push({ ...pack(media, mediaFields), media_id });
  return rows;
}

// Define own properties even for imported dictionary keys such as "__proto__".
function put(object, key, value) {
  Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true });
}

function readSections(rows) {
  const store = {};
  for (const { field, kind, value } of rows.sections) {
    put(store, field, kind === 'array' ? [] : kind === 'object' ? {} : value);
  }
  for (const { field, group_key, item_key, value } of rows.section_items) {
    if (!group_key) put(store[field], item_key, value);
  }
  for (const { field, group_key, item_key, value } of rows.section_items) {
    if (group_key) put(store[field][group_key], item_key, value);
  }
  return store;
}

function readClassDays(rows, store) {
  for (const day of rows.class_days) {
    if (day.schedule_details !== null) put(store.classSchedules, day.class_date, day.schedule_details);
    if (day.roster_revision !== null) put(store.classRosterRevisions, day.class_date, day.roster_revision);
    if (day.has_reservations) put(store.classReservations, day.class_date, {});
  }
  for (const slot of rows.class_slots) {
    const settings = store.classSchedules?.[slot.class_date];
    if (slot.special_ordinal !== null) settings.specials[slot.special_ordinal] = unpack(slot, specialFields, slot.special_details);
    if (slot.cancel_details !== null) put(settings.cancelled, slot.start_time, slot.cancel_details);
    if (slot.has_queue) put(store.classReservations[slot.class_date], slot.start_time, []);
  }
  for (const seat of rows.reservations) {
    store.classReservations[seat.class_date][seat.start_time][seat.position - 1] = seat.member_id;
  }
}

function fromRows(input) {
  // The adapter retains original rows for conflict detection while the app is
  // allowed to edit its own snapshot (including session maps and schedule data).
  const rows = structuredClone(input);
  const store = readSections(rows);
  for (const row of rows.accounts.sort((a, b) => a.ordinal - b.ordinal || a.member_id.localeCompare(b.member_id))) {
    store.users.push(unpack(row, accountFields));
  }
  for (const row of rows.members.sort((a, b) => a.ordinal - b.ordinal || a.member_id.localeCompare(b.member_id))) {
    store.members.push(unpack(row, memberFields));
  }
  for (const row of rows.memberships) {
    const pass = unpack(row, passFields);
    if (row.has_charges) pass.chargedDates = {};
    put(store.memberships, row.member_id, pass);
  }
  for (const charge of rows.pass_charges) put(store.memberships[charge.member_id].chargedDates, charge.class_date, charge.value);
  readClassDays(rows, store);
  for (const row of rows.media) put(store.media, row.media_id, unpack(row, mediaFields));
  return store;
}

module.exports = { tables, rowKey, toRows, fromRows };
