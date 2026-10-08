// Field definitions for every editable record type. The dialog form, the record
// lists and the CSV export are all generated from these.

const yesNo = { type: 'bool' };

export const HIVE_TYPES = ['Langstroth', 'Top bar', 'Warré', 'Flow hive', 'Nuc', 'Other'];
// Suggestions only; members can type anything (e.g. a specific breeder's line).
export const BEE_SPECIES = [
  'Italian', 'Carniolan', 'Russian', 'Buckfast', 'Saskatraz', 'Caucasian',
  'Local survivor / feral', 'Mixed / unknown',
];
export const CONDITIONS = [
  'Clear', 'Mostly clear', 'Partly cloudy', 'Overcast', 'Fog', 'Drizzle', 'Light rain', 'Rain', 'Windy',
];
export const HIVE_STATUSES = ['active', 'dead', 'swarmed', 'combined', 'sold'];

// Mite thresholds (mites per 100 bees from a wash, roll or CO2 sample).
export const MITE_WARN = 2;
export const MITE_TREAT = 3;

// Start reminding members this many days before their membership runs out.
export const RENEW_WARN_DAYS = 30;

export const APIARY_FIELDS = [
  { name: 'name', label: 'Name', required: true, placeholder: 'Backyard' },
  { name: 'town', label: 'Town', placeholder: 'San Anselmo',
    help: 'Only used for club-wide hive counts by town.' },
  { name: 'location', label: 'Location / directions', type: 'textarea',
    help: 'Private to you (and club admins).' },
  { name: 'notes', label: 'Notes', type: 'textarea' },
];

export function hiveFields(apiaries) {
  return [
    { name: 'name', label: 'Hive name', required: true, placeholder: 'Hive 1' },
    { name: 'apiary_id', label: 'Apiary', type: 'select',
      options: [['', '— none —'], ...apiaries.map(a => [a.id, a.name])] },
    { name: 'hive_type', label: 'Hive type', type: 'select', options: HIVE_TYPES, default: 'Langstroth' },
    { name: 'bee_species', label: 'Bee species / race', list: BEE_SPECIES,
      placeholder: 'e.g. Italian, Carniolan' },
    { name: 'status', label: 'Status', type: 'select', options: HIVE_STATUSES, default: 'active' },
    { name: 'established_on', label: 'Established', type: 'date' },
    { name: 'ended_on', label: 'Lost / closed on', type: 'date',
      help: 'Fill in if the colony died, swarmed, was combined or sold.' },
    { name: 'queen_source', label: 'Queen source', placeholder: 'Local swarm, package, breeder…' },
    { name: 'queen_year', label: 'Queen year', type: 'number', min: 2000, max: 2100 },
    { name: 'notes', label: 'Notes', type: 'textarea' },
  ];
}

export const RECORD_TYPES = {
  inspections: {
    label: 'Inspection',
    plural: 'Inspections',
    dateField: 'inspected_on',
    fields: [
      { name: 'inspected_on', label: 'Date', type: 'date', required: true, default: 'today' },
      { name: 'inspected_at', label: 'Time', type: 'time', default: 'now' },
      { name: 'temp_f', label: 'Temperature (°F)', type: 'number', step: 'any' },
      { name: 'conditions', label: 'Conditions', list: CONDITIONS },
      { name: 'wind_mph', label: 'Wind (mph)', type: 'number', min: 0, step: 'any' },
      { name: 'humidity', label: 'Humidity (%)', type: 'number', min: 0, max: 100 },
      { name: 'queen_seen', label: 'Queen seen', ...yesNo },
      { name: 'eggs_seen', label: 'Eggs seen', ...yesNo },
      { name: 'queen_cells', label: 'Queen cells', ...yesNo },
      { name: 'brood_pattern', label: 'Brood pattern', type: 'select',
        options: [['', '—'], 'excellent', 'good', 'spotty', 'none'] },
      { name: 'temperament', label: 'Temperament', type: 'select',
        options: [['', '—'], 'calm', 'nervous', 'aggressive'] },
      { name: 'frames_bees', label: 'Frames of bees', type: 'number', min: 0 },
      { name: 'frames_brood', label: 'Frames of brood', type: 'number', min: 0 },
      { name: 'frames_honey', label: 'Frames of honey', type: 'number', min: 0 },
      { name: 'disease_signs', label: 'Pests / disease signs', placeholder: 'e.g. chalkbrood, SHB, DWV' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
    summary(r) {
      const bits = [];
      if (r.queen_seen) bits.push('queen seen');
      else if (r.eggs_seen) bits.push('eggs seen');
      else if (r.queen_seen === false && r.eggs_seen === false) bits.push('no queen/eggs seen');
      if (r.queen_cells) bits.push('queen cells');
      if (r.brood_pattern) bits.push(`${r.brood_pattern} brood`);
      if (r.temperament) bits.push(r.temperament);
      const frames = [['bees', r.frames_bees], ['brood', r.frames_brood], ['honey', r.frames_honey]]
        .filter(([, n]) => n != null).map(([k, n]) => `${n} ${k}`);
      if (frames.length) bits.push(`frames: ${frames.join(', ')}`);
      if (r.disease_signs) bits.push(`⚠ ${r.disease_signs}`);
      const weather = [r.temp_f != null && `${Number(r.temp_f)}°F`, r.conditions?.toLowerCase(),
                       r.wind_mph != null && `wind ${Number(r.wind_mph)} mph`].filter(Boolean).join(', ');
      if (weather) bits.push(weather);
      return bits.join(' · ');
    },
  },

  mite_counts: {
    label: 'Mite count',
    plural: 'Mite counts',
    dateField: 'counted_on',
    fields: [
      { name: 'counted_on', label: 'Date', type: 'date', required: true, default: 'today' },
      { name: 'method', label: 'Method', type: 'select', required: true, default: 'alcohol wash',
        options: ['alcohol wash', 'dish soap wash', 'sugar roll', 'CO2', 'sticky board'] },
      { name: 'bees_sampled', label: 'Bees sampled', type: 'number', min: 1, default: 300,
        help: '½ cup of bees ≈ 300. Not used for sticky boards.' },
      { name: 'mites', label: 'Mites counted', type: 'number', min: 0, required: true },
      { name: 'board_days', label: 'Days board was in', type: 'number', min: 1,
        help: 'Sticky boards only.' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
    // Mirror the database's mite_sample_shape constraint with a friendlier message.
    validate(v) {
      if (v.method === 'sticky board') {
        if (!v.board_days) return 'Enter how many days the sticky board was in.';
        v.bees_sampled = null;
      } else {
        if (!v.bees_sampled) return 'Enter how many bees were in the sample.';
        v.board_days = null;
      }
      return null;
    },
    summary(r) {
      const rate = miteRate(r);
      return r.method === 'sticky board'
        ? `${r.mites} mites over ${r.board_days} days (${rate}/day) · sticky board`
        : `${rate} per 100 bees (${r.mites}/${r.bees_sampled}) · ${r.method}`;
    },
  },

  treatments: {
    label: 'Treatment',
    plural: 'Treatments',
    dateField: 'started_on',
    fields: [
      { name: 'product', label: 'Treatment', required: true, list: [
        'Oxalic acid (vapor)', 'Oxalic acid (dribble)', 'Formic Pro', 'Mite Away Quick Strips',
        'Apivar', 'Api Life Var', 'Apiguard', 'HopGuard', 'Brood break', 'Drone brood removal'] },
      { name: 'started_on', label: 'Started', type: 'date', required: true, default: 'today' },
      { name: 'ended_on', label: 'Ended', type: 'date' },
      { name: 'dose', label: 'Dose / application', placeholder: 'e.g. 1 g, 2 strips' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
    validate(v) {
      if (v.ended_on && v.ended_on < v.started_on) return 'End date is before the start date.';
      return null;
    },
    summary(r) {
      const span = r.ended_on ? `until ${fmtDate(r.ended_on)}` : 'in progress';
      return [r.product, r.dose, span].filter(Boolean).join(' · ');
    },
  },

  feedings: {
    label: 'Feeding',
    plural: 'Feedings',
    dateField: 'fed_on',
    fields: [
      { name: 'fed_on', label: 'Date', type: 'date', required: true, default: 'today' },
      { name: 'feed', label: 'Feed', required: true,
        list: ['1:1 syrup', '2:1 syrup', 'Pollen patty', 'Fondant', 'Dry sugar'] },
      { name: 'amount', label: 'Amount', placeholder: 'e.g. 1 gallon' },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
    summary: r => [r.feed, r.amount].filter(Boolean).join(' · '),
  },

  harvests: {
    label: 'Harvest',
    plural: 'Harvests',
    dateField: 'harvested_on',
    fields: [
      { name: 'harvested_on', label: 'Date', type: 'date', required: true, default: 'today' },
      { name: 'honey_lbs', label: 'Honey (lbs)', type: 'number', min: 0, step: '0.1' },
      { name: 'frames', label: 'Frames pulled', type: 'number', min: 0 },
      { name: 'notes', label: 'Notes', type: 'textarea' },
    ],
    summary: r => [r.honey_lbs != null && `${Number(r.honey_lbs)} lbs`,
                   r.frames != null && `${r.frames} frames`].filter(Boolean).join(' · '),
  },
};

// Mites per 100 bees (wash/roll/CO2) or mites per day (sticky board).
// Matches public.mite_rate() in the database.
export function miteRate(r) {
  const raw = r.method === 'sticky board' ? r.mites / r.board_days : (r.mites * 100) / r.bees_sampled;
  return Math.round(raw * 10) / 10;
}

export function todayISO() {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function daysSince(iso) {
  if (!iso) return Infinity;
  const [y, m, d] = iso.split('-').map(Number);
  const then = Date.UTC(y, m - 1, d);
  const [ty, tm, td] = todayISO().split('-').map(Number);
  return Math.round((Date.UTC(ty, tm - 1, td) - then) / 86400000);
}

export function nowHHMM() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function fmtTime(t) {
  if (!t) return '';
  const [h, m] = t.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

export function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// Membership status from the paid-through date (set by admins).
export function membershipStatus(paidThrough) {
  if (!paidThrough) return { key: 'unknown', label: 'Not recorded', level: 'muted' };
  const left = -daysSince(paidThrough);   // days remaining; negative once expired
  if (left < 0) return { key: 'expired', label: 'Expired', level: 'bad', left };
  if (left <= RENEW_WARN_DAYS) return { key: 'expiring', label: 'Renewal due', level: 'warn', left };
  return { key: 'active', label: 'Active', level: 'good', left };
}

// Reminders shown on the dashboard for an active hive.
// lastInspection / lastMite are the most recent rows (or undefined); lastSample is the
// most recent wash/roll/CO2 count, which is what the treatment threshold applies to.
export function hiveAlerts(hive, { lastInspection, lastMite, lastSample, openTreatment }) {
  if (hive.status !== 'active') return [];
  const alerts = [];
  const month = new Date().getMonth() + 1;
  const season = month >= 3 && month <= 10;           // Marin's active season
  const inspectEvery = season ? 14 : 30;

  const sinceInspect = daysSince(lastInspection?.inspected_on);
  if (sinceInspect > inspectEvery) {
    alerts.push({ level: 'warn', text: lastInspection
      ? `Inspection due (last ${sinceInspect} days ago)` : 'No inspections yet' });
  }
  if (lastInspection && lastInspection.queen_seen === false && lastInspection.eggs_seen === false) {
    alerts.push({ level: 'bad', text: 'No queen or eggs seen at last inspection' });
  }
  if (lastInspection?.queen_cells) {
    alerts.push({ level: 'warn', text: 'Queen cells seen — watch for swarming' });
  }

  const sinceMite = daysSince(lastMite?.counted_on);
  if (sinceMite > 30) {
    alerts.push({ level: 'warn', text: lastMite
      ? `Mite check due (last ${sinceMite} days ago)` : 'No mite counts yet' });
  }
  if (lastSample) {
    const rate = miteRate(lastSample);
    if (rate >= MITE_TREAT) alerts.push({ level: 'bad', text: `Mites at ${rate}% — above treatment threshold` });
    else if (rate >= MITE_WARN) alerts.push({ level: 'warn', text: `Mites at ${rate}% — nearing threshold` });
  }
  if (openTreatment) {
    alerts.push({ level: 'info', text: `${openTreatment.product} in progress since ${fmtDate(openTreatment.started_on)}` });
  }
  return alerts;
}
