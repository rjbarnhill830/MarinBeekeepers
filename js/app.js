import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, CLUB_NAME } from './config.js';
import {
  APIARY_FIELDS, RECORD_TYPES, MITE_TREAT, hiveFields, hiveAlerts, miteRate,
  fmtDate, fmtTime, nowHHMM, todayISO,
} from './records.js';
import { weatherAt } from './weather.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const app = document.getElementById('app');
const state = { session: null, profile: null, recovering: false };
const uid = () => state.session?.user.id;
const isAdmin = () => state.profile?.approved && state.profile.role === 'admin';
// Where Supabase email links (confirm sign-up, reset password) send people back to.
const SITE_URL = location.origin + location.pathname;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ESC[c]);

async function must(query) {
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return data;
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { el.hidden = true; }, 3000);
}

function render(html) {
  app.innerHTML = html;
  app.querySelector('[autofocus]')?.focus();
}

function on(selector, event, fn) {
  app.querySelectorAll(selector).forEach(el => el.addEventListener(event, fn));
}

const latestBy = (rows, key = 'hive_id') => {
  const out = {};
  for (const r of rows) if (!(r[key] in out)) out[r[key]] = r;   // rows arrive newest first
  return out;
};

function alertList(alerts) {
  if (!alerts.length) return '';
  return `<ul class="alerts">${alerts.map(a =>
    `<li class="alert ${a.level}"><span aria-hidden="true">${
      { bad: '●', warn: '▲', info: 'ℹ' }[a.level]}</span> ${esc(a.text)}</li>`).join('')}</ul>`;
}

// ---------------------------------------------------------------------------
// Generic form dialog, built from the field definitions in records.js
// ---------------------------------------------------------------------------

const dialog = document.getElementById('dialog');
const dialogForm = document.getElementById('dialog-form');

function fieldHTML(f, value) {
  const id = `f-${f.name}`;
  const req = f.required ? ' required' : '';
  let input;
  if (f.type === 'textarea') {
    input = `<textarea id="${id}" name="${f.name}" rows="3"${req}>${esc(value)}</textarea>`;
  } else if (f.type === 'select' || f.type === 'bool') {
    const opts = f.type === 'bool' ? [['', '—'], ['true', 'Yes'], ['false', 'No']] : f.options;
    const cur = value == null ? '' : String(value);
    input = `<select id="${id}" name="${f.name}"${req}>${opts.map(o => {
      const [v, label] = Array.isArray(o) ? o : [o, o];
      return `<option value="${esc(v)}"${String(v) === cur ? ' selected' : ''}>${esc(label)}</option>`;
    }).join('')}</select>`;
  } else {
    const type = ['number', 'date', 'time'].includes(f.type) ? f.type : 'text';
    if (type === 'time' && value) value = String(value).slice(0, 5);   // DB returns HH:MM:SS
    const attrs = [
      f.min != null && `min="${f.min}"`, f.max != null && `max="${f.max}"`,
      f.step && `step="${f.step}"`, f.placeholder && `placeholder="${esc(f.placeholder)}"`,
      f.list && `list="${id}-list"`, type === 'number' && 'inputmode="decimal"',
    ].filter(Boolean).join(' ');
    input = `<input id="${id}" name="${f.name}" type="${type}" value="${esc(value)}" ${attrs}${req}>`;
    if (f.list) input += `<datalist id="${id}-list">${f.list.map(o => `<option value="${esc(o)}">`).join('')}</datalist>`;
  }
  return `<div class="field" data-field="${f.name}">
    <label for="${id}">${esc(f.label)}${f.required ? ' <span class="req" aria-hidden="true">*</span>' : ''}</label>
    ${input}${f.help ? `<small class="muted">${esc(f.help)}</small>` : ''}</div>`;
}

function readForm(fields) {
  const fd = new FormData(dialogForm);
  const values = {};
  for (const f of fields) {
    const raw = (fd.get(f.name) ?? '').toString().trim();
    if (raw === '') values[f.name] = null;
    else if (f.type === 'number') values[f.name] = Number(raw);
    else if (f.type === 'bool') values[f.name] = raw === 'true';
    else values[f.name] = raw;
  }
  return values;
}

/**
 * Show a form dialog. onSave(values) persists and may throw to show an error;
 * validate(values) may return an error string (and may normalise values).
 */
function openForm({ title, fields, values = {}, validate, onSave, onDelete, saveLabel = 'Save', visibility, setup }) {
  document.getElementById('dialog-title').textContent = title;
  document.getElementById('dialog-save').textContent = saveLabel;
  const errEl = document.getElementById('dialog-error');
  errEl.textContent = '';
  const body = document.getElementById('dialog-body');
  body.innerHTML = fields.map(f => {
    let v = values[f.name];
    if (v === undefined) v = f.default === 'today' ? todayISO() : f.default === 'now' ? nowHHMM() : f.default ?? '';
    return fieldHTML(f, v);
  }).join('');

  const applyVisibility = () => {
    if (!visibility) return;
    const shown = visibility(readForm(fields));
    for (const f of fields) {
      if (f.name in shown) body.querySelector(`[data-field="${f.name}"]`).hidden = !shown[f.name];
    }
  };
  body.oninput = applyVisibility;
  applyVisibility();

  const del = document.getElementById('dialog-delete');
  del.hidden = !onDelete;
  del.onclick = async () => {
    if (!confirm(`Delete this ${title.replace(/^Edit /, '').toLowerCase()}? This can't be undone.`)) return;
    try { await onDelete(); dialog.close(); } catch (e) { errEl.textContent = e.message; }
  };
  document.getElementById('dialog-cancel').onclick = () => dialog.close();

  dialogForm.onsubmit = async (ev) => {
    ev.preventDefault();
    errEl.textContent = '';
    const v = readForm(fields);
    const missing = fields.find(f => f.required && v[f.name] == null
      && !body.querySelector(`[data-field="${f.name}"]`).hidden);
    const problem = missing ? `${missing.label} is required.` : validate?.(v);
    if (problem) { errEl.textContent = problem; return; }
    const btn = document.getElementById('dialog-save');
    btn.disabled = true;
    try { await onSave(v); dialog.close(); } catch (e) { errEl.textContent = e.message; } finally { btn.disabled = false; }
  };
  dialog.showModal();
  body.querySelector('input, select, textarea')?.focus();
  setup?.(body);
}

// Inspection form: a "Fill in weather" button, run automatically for new inspections and
// again when the date/time changes, unless the member has typed their own weather.
const WEATHER_FIELDS = ['temp_f', 'conditions', 'wind_mph', 'humidity'];

function wireWeather(body, town, isNew) {
  const input = name => body.querySelector(`[name="${name}"]`);
  const row = document.createElement('div');
  row.className = 'weather-row';
  row.innerHTML = `<button type="button" class="secondary small">☁ Fill in weather</button>
    <small class="muted" role="status"></small>`;
  body.querySelector('[data-field="inspected_at"]').after(row);
  const [btn, status] = row.children;
  const current = () => WEATHER_FIELDS.map(n => input(n).value).join('|');
  let autoFilled = isNew ? current() : null;   // weather values we put there ourselves
  let seq = 0;

  async function fill() {
    const date = input('inspected_on').value;
    if (!date) { status.textContent = 'Pick a date first.'; return; }
    const mine = ++seq;
    btn.disabled = true;
    status.textContent = 'Looking up weather…';
    try {
      const w = await weatherAt(town, date, input('inspected_at').value);
      if (mine !== seq) return;
      for (const n of WEATHER_FIELDS) input(n).value = w[n] ?? '';
      autoFilled = current();
      const when = input('inspected_at').value ? fmtTime(input('inspected_at').value) : 'midday';
      status.textContent = `Weather for ${w.place} at ${when} (Open-Meteo). You can edit it.`;
    } catch (e) {
      if (mine === seq) status.textContent = e.message;
    } finally {
      if (mine === seq) btn.disabled = false;
    }
  }

  btn.addEventListener('click', fill);
  let timer;
  for (const n of ['inspected_on', 'inspected_at']) {
    input(n).addEventListener('change', () => {
      if (autoFilled === null || current() !== autoFilled) return;   // member's own values: leave alone
      clearTimeout(timer);
      timer = setTimeout(fill, 400);
    });
  }
  if (isNew) fill();
}

// Mite form: show sample size or board days depending on method.
const miteVisibility = v => ({
  bees_sampled: v.method !== 'sticky board',
  board_days: v.method === 'sticky board',
});

function editRecord(table, hive, row, after) {
  const def = RECORD_TYPES[table];
  openForm({
    title: row ? `Edit ${def.label.toLowerCase()}` : `New ${def.label.toLowerCase()}`,
    fields: def.fields,
    values: row ?? {},
    validate: def.validate,
    visibility: table === 'mite_counts' ? miteVisibility : undefined,
    setup: table === 'inspections' ? body => wireWeather(body, hive.apiaries?.town, !row) : undefined,
    onSave: async v => {
      if (row) await must(sb.from(table).update(v).eq('id', row.id));
      else await must(sb.from(table).insert({ ...v, hive_id: hive.id }));
      toast(`${def.label} saved`);
      after();
    },
    onDelete: row && (async () => {
      await must(sb.from(table).delete().eq('id', row.id));
      toast(`${def.label} deleted`);
      after();
    }),
  });
}

async function editHive(hive, after) {
  const apiaries = await must(sb.from('apiaries').select('id, name').eq('owner_id', uid()).order('name'));
  openForm({
    title: hive ? 'Edit hive' : 'New hive',
    fields: hiveFields(apiaries),
    values: hive ?? {},
    onSave: async v => {
      if (v.status === 'active') v.ended_on = null;
      else if (!v.ended_on) v.ended_on = todayISO();
      if (hive) await must(sb.from('hives').update(v).eq('id', hive.id));
      else {
        const [created] = await must(sb.from('hives').insert(v).select('id'));
        hive = { id: created.id };
      }
      toast('Hive saved');
      after(hive);
    },
    onDelete: hive && (async () => {
      await must(sb.from('hives').delete().eq('id', hive.id));
      toast('Hive deleted');
      location.hash = '#/';
    }),
  });
}

function editApiary(apiary, after) {
  openForm({
    title: apiary ? 'Edit apiary' : 'New apiary',
    fields: APIARY_FIELDS,
    values: apiary ?? {},
    onSave: async v => {
      if (apiary) await must(sb.from('apiaries').update(v).eq('id', apiary.id));
      else await must(sb.from('apiaries').insert(v));
      toast('Apiary saved');
      after();
    },
    onDelete: apiary && (async () => {
      await must(sb.from('apiaries').delete().eq('id', apiary.id));
      toast('Apiary deleted (its hives were kept)');
      after();
    }),
  });
}

// ---------------------------------------------------------------------------
// Signed-out views
// ---------------------------------------------------------------------------

function authView(mode = 'signin', message = '') {
  const titles = { signin: 'Sign in', signup: 'Join', forgot: 'Reset password' };
  render(`
    <section class="auth card">
      <h1>🐝 Marin Hive Tracker</h1>
      <p class="muted">Hive records for ${esc(CLUB_NAME)} members.</p>
      <h2>${titles[mode]}</h2>
      ${message ? `<p class="notice">${esc(message)}</p>` : ''}
      <form id="auth-form">
        ${mode === 'signup' ? `<label>Your name <input name="full_name" required autocomplete="name" autofocus></label>` : ''}
        <label>Email <input name="email" type="email" required autocomplete="email" ${mode !== 'signup' ? 'autofocus' : ''}></label>
        ${mode !== 'forgot' ? `<label>Password <input name="password" type="password" required minlength="8"
            autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}"></label>` : ''}
        <p class="error" id="auth-error" role="alert"></p>
        <button type="submit">${{ signin: 'Sign in', signup: 'Create account', forgot: 'Email me a reset link' }[mode]}</button>
      </form>
      <p class="auth-links">
        ${mode !== 'signin' ? '<a href="#" data-mode="signin">Sign in</a>' : ''}
        ${mode !== 'signup' ? '<a href="#" data-mode="signup">New member? Create an account</a>' : ''}
        ${mode === 'signin' ? '<a href="#" data-mode="forgot">Forgot password?</a>' : ''}
      </p>
    </section>`);

  on('[data-mode]', 'click', e => { e.preventDefault(); authView(e.target.dataset.mode); });
  app.querySelector('#auth-form').addEventListener('submit', async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const err = app.querySelector('#auth-error');
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    err.textContent = '';
    try {
      if (mode === 'signin') {
        const { error } = await sb.auth.signInWithPassword({ email: f.email, password: f.password });
        if (error) throw error;
      } else if (mode === 'signup') {
        const { data, error } = await sb.auth.signUp({
          email: f.email, password: f.password,
          options: { data: { full_name: f.full_name }, emailRedirectTo: SITE_URL },
        });
        if (error) throw error;
        if (!data.session) authView('signin', 'Check your email to confirm your address, then sign in. A club admin will approve your account.');
      } else {
        const { error } = await sb.auth.resetPasswordForEmail(f.email, { redirectTo: SITE_URL });
        if (error) throw error;
        authView('signin', 'If that email has an account, a reset link is on its way.');
      }
    } catch (ex) {
      err.textContent = ex.message;
    } finally {
      btn.disabled = false;
    }
  });
}

function newPasswordView() {
  render(`
    <section class="auth card">
      <h1>Choose a new password</h1>
      <form id="pw-form">
        <label>New password <input name="password" type="password" required minlength="8" autocomplete="new-password" autofocus></label>
        <p class="error" role="alert"></p>
        <button type="submit">Save password</button>
      </form>
    </section>`);
  app.querySelector('#pw-form').addEventListener('submit', async e => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: new FormData(e.target).get('password') });
    if (error) { e.target.querySelector('.error').textContent = error.message; return; }
    state.recovering = false;
    toast('Password updated');
    location.hash = '#/';
    route();
  });
}

function pendingView() {
  render(`
    <section class="auth card">
      <h1>Almost there${state.profile?.full_name ? `, ${esc(state.profile.full_name)}` : ''}</h1>
      <p>Your account is waiting for a ${esc(CLUB_NAME)} admin to approve it.
         You'll be able to add hives as soon as that happens.</p>
      <p class="muted">Signed in as ${esc(state.session.user.email)}</p>
      <div class="row">
        <button id="recheck">Check again</button>
        <button class="secondary" id="signout">Sign out</button>
      </div>
    </section>`);
  on('#recheck', 'click', async () => { await loadProfile(); route(); });
  on('#signout', 'click', () => sb.auth.signOut());
}

// ---------------------------------------------------------------------------
// Member views
// ---------------------------------------------------------------------------

async function dashboardView() {
  const me = uid();
  const [hives, inspections, mites, openTreatments] = await Promise.all([
    must(sb.from('hives').select('*, apiaries(name)').eq('owner_id', me).order('name')),
    must(sb.from('inspections').select('hive_id, inspected_on, queen_seen, eggs_seen, queen_cells, created_at')
      .eq('owner_id', me).order('inspected_on', { ascending: false })
      .order('inspected_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })),
    must(sb.from('mite_counts').select('hive_id, counted_on, method, mites, bees_sampled, board_days, created_at')
      .eq('owner_id', me).order('counted_on', { ascending: false }).order('created_at', { ascending: false })),
    must(sb.from('treatments').select('hive_id, product, started_on')
      .eq('owner_id', me).is('ended_on', null).order('started_on', { ascending: false })),
  ]);
  const lastInspection = latestBy(inspections);
  const lastMite = latestBy(mites);
  const lastSample = latestBy(mites.filter(m => m.method !== 'sticky board'));
  const openTreatment = latestBy(openTreatments);

  const active = hives.filter(h => h.status === 'active');
  const past = hives.filter(h => h.status !== 'active');

  const card = h => {
    const li = lastInspection[h.id];
    const lm = lastMite[h.id];
    const alerts = hiveAlerts(h, {
      lastInspection: li, lastMite: lm, lastSample: lastSample[h.id], openTreatment: openTreatment[h.id],
    });
    return `<a class="card hive-card" href="#/hive/${h.id}">
      <div class="hive-head"><h3>${esc(h.name)}</h3><span class="badge">${esc(h.hive_type)}</span></div>
      <dl class="facts">
        <div><dt>Last inspection</dt><dd>${li ? fmtDate(li.inspected_on) : '—'}</dd></div>
        <div><dt>Last mite count</dt><dd>${lm ? `${miteRate(lm)}${lm.method === 'sticky board' ? '/day' : '%'} · ${fmtDate(lm.counted_on)}` : '—'}</dd></div>
      </dl>
      ${alertList(alerts)}
    </a>`;
  };

  // Group active hives by apiary.
  const groups = new Map();
  for (const h of active) {
    const key = h.apiaries?.name ?? 'No apiary';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(h);
  }

  render(`
    <div class="page-head">
      <h1>My hives</h1>
      <button id="add-hive">+ Add hive</button>
    </div>
    ${!hives.length ? `
      <div class="card empty">
        <p>No hives yet. Start by adding an <a href="#/apiaries">apiary</a> (where your hives live), then add your hives.</p>
      </div>` : ''}
    ${[...groups].map(([name, hs]) => `
      <section>
        <h2 class="group-title">${esc(name)}</h2>
        <div class="grid">${hs.map(card).join('')}</div>
      </section>`).join('')}
    ${past.length ? `
      <details class="past">
        <summary>Past colonies (${past.length})</summary>
        <ul class="plain">${past.map(h => `<li><a href="#/hive/${h.id}">${esc(h.name)}</a>
          <span class="muted">· ${esc(h.status)}${h.ended_on ? ` ${fmtDate(h.ended_on)}` : ''}</span></li>`).join('')}</ul>
      </details>` : ''}
  `);
  on('#add-hive', 'click', () => editHive(null, h => { location.hash = `#/hive/${h.id}`; }));
}

async function hiveView(id, filter = 'all') {
  const me = uid();
  const tables = Object.keys(RECORD_TYPES);
  const [hives, ...records] = await Promise.all([
    // No owner filter: row-level security returns the hive if it's ours, shared with us, or we're an admin.
    must(sb.from('hives').select('*, apiaries(name, town)').eq('id', id)),
    ...tables.map(t => must(sb.from(t).select('*').eq('hive_id', id)
      .order(RECORD_TYPES[t].dateField, { ascending: false }).order('created_at', { ascending: false }))),
  ]);
  const hive = hives[0];
  if (!hive) { render('<p>Hive not found, or its owner has stopped sharing it. <a href="#/">Back to my hives</a></p>'); return; }
  const readOnly = hive.owner_id !== me;
  state.viewingOther = readOnly;
  setChrome(true);
  // Someone else's hive: owner name and town come from the directory (we can't read their apiary).
  const listing = readOnly ? (await must(sb.rpc('hive_directory'))).find(h => h.id === id) : null;

  const byTable = Object.fromEntries(tables.map((t, i) => [t, records[i]]));
  const timeline = tables.flatMap(t => byTable[t].map(r => ({ t, r, date: r[RECORD_TYPES[t].dateField] })))
    .filter(e => filter === 'all' || e.t === filter)
    .sort((a, b) => b.date.localeCompare(a.date)
      || (b.r.inspected_at ?? '').localeCompare(a.r.inspected_at ?? '')
      || b.r.created_at.localeCompare(a.r.created_at));

  const alerts = hiveAlerts(hive, {
    lastInspection: byTable.inspections[0],
    lastMite: byTable.mite_counts[0],
    lastSample: byTable.mite_counts.find(m => m.method !== 'sticky board'),
    openTreatment: byTable.treatments.find(r => !r.ended_on),
  });
  const honey = byTable.harvests.reduce((s, r) => s + Number(r.honey_lbs || 0), 0);

  render(`
    <p>${readOnly ? '<a href="#/hives">← Club hives</a>' : '<a href="#/">← My hives</a>'}</p>
    ${readOnly ? `<p class="notice">You're viewing ${esc(listing?.owner_name ?? 'another member')}'s hive${
      listing?.town ? ` in ${esc(listing.town)}` : ''}. Only they can make changes.</p>` : ''}
    <div class="page-head">
      <div>
        <h1>${esc(hive.name)} ${hive.status !== 'active' ? `<span class="badge muted-badge">${esc(hive.status)}</span>` : ''}</h1>
        <p class="muted">${[readOnly ? listing?.town : hive.apiaries?.name, hive.hive_type, hive.bee_species,
          hive.queen_year && `${hive.queen_year} queen${hive.queen_source ? ` (${hive.queen_source})` : ''}`,
          hive.established_on && `since ${fmtDate(hive.established_on)}`,
          honey && `${Math.round(honey * 10) / 10} lbs harvested`].filter(Boolean).map(esc).join(' · ')}</p>
      </div>
      ${readOnly ? '' : '<button class="secondary" id="edit-hive">Edit hive</button>'}
    </div>
    ${hive.notes ? `<p class="hive-notes">${esc(hive.notes)}</p>` : ''}
    ${alertList(alerts)}
    ${readOnly ? '' : `<div class="quick-add">
      ${tables.map(t => `<button data-add="${t}">+ ${RECORD_TYPES[t].label}</button>`).join('')}
    </div>`}
    <div class="tabs" role="tablist">
      ${[['all', 'All'], ...tables.map(t => [t, RECORD_TYPES[t].plural])].map(([k, label]) =>
        `<button role="tab" class="tab" aria-selected="${k === filter}" data-filter="${k}">${label}${
          k !== 'all' ? ` <span class="count">${byTable[k].length}</span>` : ''}</button>`).join('')}
    </div>
    ${timeline.length ? `<ol class="timeline">${timeline.map(({ t, r, date }, i) => `
      <li><${readOnly ? 'div' : 'button'} class="entry" data-i="${i}">
        <span class="entry-date">${fmtDate(date)}${r.inspected_at ? `<br>${fmtTime(r.inspected_at)}` : ''}</span>
        <span class="tag tag-${t}">${RECORD_TYPES[t].label}</span>
        <span class="entry-summary">${esc(RECORD_TYPES[t].summary(r)) || '<span class="muted">No details</span>'}
          ${r.notes ? `<span class="entry-notes">${esc(r.notes)}</span>` : ''}</span>
      </${readOnly ? 'div' : 'button'}></li>`).join('')}</ol>`
      : `<p class="muted">No records yet.${readOnly ? '' : ' Use the buttons above to log an inspection, mite count and more.'}</p>`}
  `);

  const refresh = () => hiveView(id, filter);
  on('#edit-hive', 'click', () => editHive(hive, refresh));
  on('[data-add]', 'click', e => editRecord(e.currentTarget.dataset.add, hive, null, refresh));
  on('[data-filter]', 'click', e => hiveView(id, e.currentTarget.dataset.filter));
  if (readOnly) return;
  on('.entry', 'click', e => {
    const { t, r } = timeline[e.currentTarget.dataset.i];
    editRecord(t, hive, r, refresh);
  });
}

async function clubHivesView() {
  const list = await must(sb.rpc('hive_directory'));
  const admin = isAdmin();
  const byOwner = new Map();
  for (const h of list) {
    if (!byOwner.has(h.owner_id)) byOwner.set(h.owner_id, { name: h.owner_name, shared: h.shared, hives: [] });
    byOwner.get(h.owner_id).hives.push(h);
  }
  const card = h => `<a class="card hive-card" href="#/hive/${h.id}">
    <div class="hive-head"><h3>${esc(h.name)}</h3><span class="badge${h.status === 'active' ? '' : ' muted-badge'}">${
      esc(h.status === 'active' ? h.hive_type : h.status)}</span></div>
    <p class="muted card-sub">${[h.town, h.bee_species].filter(Boolean).map(esc).join(' · ')}</p>
    <dl class="facts">
      <div><dt>Last inspection</dt><dd>${h.last_inspection ? fmtDate(h.last_inspection) : '—'}</dd></div>
      <div><dt>Last mite count</dt><dd>${h.last_mite_on ? `${Number(h.last_mite_rate)}${
        h.last_mite_method === 'sticky board' ? '/day' : '%'} · ${fmtDate(h.last_mite_on)}` : '—'}</dd></div>
    </dl>
  </a>`;
  render(`
    <div class="page-head"><h1>Club hives</h1></div>
    <p class="muted">${admin
      ? "As a club admin you can view every member's hives. Members only see hives their owners have chosen to share."
      : 'Hives other members have chosen to share. Everything here is view-only; apiary locations are never shown, only the town.'}
      ${state.profile.share_hives ? 'Your hives are shared.' : 'Your hives are not shared.'}
      <a href="#/account">Change in Account</a>.</p>
    ${!list.length ? `<div class="card empty"><p>${admin ? 'No other members have hives yet.'
      : 'No one is sharing their hives yet.'}</p></div>` : ''}
    ${[...byOwner.values()].map(o => `
      <section>
        <h2 class="group-title">${esc(o.name)}${admin && !o.shared ? ' <span class="badge muted-badge">not shared</span>' : ''}</h2>
        <div class="grid">${o.hives.map(card).join('')}</div>
      </section>`).join('')}
  `);
}

async function apiariesView() {
  const me = uid();
  const [apiaries, hives] = await Promise.all([
    must(sb.from('apiaries').select('*').eq('owner_id', me).order('name')),
    must(sb.from('hives').select('apiary_id').eq('owner_id', me).eq('status', 'active')),
  ]);
  const count = id => hives.filter(h => h.apiary_id === id).length;
  render(`
    <div class="page-head">
      <h1>Apiaries</h1>
      <button id="add-apiary">+ Add apiary</button>
    </div>
    <p class="muted">An apiary is a place where you keep bees. Locations are private to you and club admins.</p>
    ${apiaries.length ? `<div class="grid">${apiaries.map((a, i) => `
      <button class="card apiary-card" data-i="${i}">
        <h3>${esc(a.name)}</h3>
        <p class="muted">${[a.town, `${count(a.id)} active hive${count(a.id) === 1 ? '' : 's'}`].filter(Boolean).map(esc).join(' · ')}</p>
        ${a.location ? `<p>${esc(a.location)}</p>` : ''}
      </button>`).join('')}</div>`
      : '<div class="card empty"><p>No apiaries yet.</p></div>'}
  `);
  on('#add-apiary', 'click', () => editApiary(null, apiariesView));
  on('.apiary-card', 'click', e => editApiary(apiaries[e.currentTarget.dataset.i], apiariesView));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Column chart of the club's average mite load per month, with the treatment threshold.
function miteChart(rows) {
  const byMonth = Object.fromEntries(rows.map(r => [r.month, r]));
  // Size the SVG to the page so 1 unit ≈ 1px and axis text stays readable on phones.
  const W = Math.max(300, Math.min(900, app.clientWidth - 36)), H = 240, L = 30, R = 8, T = 12, B = 28;
  const narrow = W < 520;
  const max = Math.max(MITE_TREAT + 1, ...rows.map(r => Number(r.avg_per_100)));
  const yMax = Math.ceil(max);
  const step = (W - L - R) / 12;
  const barW = Math.min(24, step - 8);
  const y = v => T + (H - T - B) * (1 - v / yMax);
  const ticks = [...Array(yMax + 1).keys()].filter(v => yMax <= 6 || v % 2 === 0);

  const bars = MONTHS.map((m, i) => {
    const r = byMonth[i + 1];
    const cx = L + step * i + step / 2;
    const label = `<text class="axis" x="${cx}" y="${H - 8}" text-anchor="middle">${narrow ? m[0] : m}</text>`;
    if (!r) return label;
    const v = Number(r.avg_per_100);
    const top = y(v), base = y(0), x = cx - barW / 2, rad = Math.min(4, base - top);
    const path = `M${x},${base} V${top + rad} Q${x},${top} ${x + rad},${top} H${x + barW - rad} Q${x + barW},${top} ${x + barW},${top + rad} V${base} Z`;
    const tip = `${m}: ${v} mites per 100 bees · ${r.samples} sample${r.samples === 1 ? '' : 's'}, ${r.over_threshold} at or above ${MITE_TREAT}`;
    return `${label}<g class="bar" tabindex="0" data-tip="${esc(tip)}">
      <rect x="${cx - step / 2}" y="${T}" width="${step}" height="${base - T}" fill="transparent"/>
      <path d="${path}"/></g>`;
  }).join('');

  return `<div class="chart-wrap">
    <p class="chart-key"><span><span class="key-bar" aria-hidden="true"></span> Average per 100 bees</span>
      <span><span class="key-line" aria-hidden="true"></span> Treatment threshold (${MITE_TREAT})</span></p>
    <svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Average mites per 100 bees by month">
      ${ticks.map(v => `<line class="gridline" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/>
        <text class="axis" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join('')}
      <line class="threshold" x1="${L}" x2="${W - R}" y1="${y(MITE_TREAT)}" y2="${y(MITE_TREAT)}"/>
      ${bars}
    </svg>
    <div class="chart-tip" hidden></div>
  </div>`;
}

function wireChartTips() {
  const tip = app.querySelector('.chart-tip');
  if (!tip) return;
  const wrap = tip.parentElement;
  const show = e => {
    const g = e.currentTarget;
    tip.textContent = g.dataset.tip;
    tip.hidden = false;
    const box = g.querySelector('path').getBoundingClientRect();
    const outer = wrap.getBoundingClientRect();
    const left = Math.min(Math.max(box.left - outer.left + box.width / 2, 90), outer.width - 90);
    tip.style.left = `${left}px`;
    tip.style.top = `${box.top - outer.top - 8}px`;
  };
  const hide = () => { tip.hidden = true; };
  on('.bar', 'mouseenter', show);
  on('.bar', 'focus', show);
  on('.bar', 'mouseleave', hide);
  on('.bar', 'blur', hide);
}

const breakdown = obj => {
  const entries = Object.entries(obj).sort((a, b) => b[1] - a[1]);
  if (!entries.length) return '<p class="muted">No hives yet.</p>';
  return `<table class="table"><tbody>${entries.map(([k, n]) =>
    `<tr><td>${esc(k)}</td><td class="num">${n}</td></tr>`).join('')}</tbody></table>`;
};

async function clubView(year = new Date().getFullYear()) {
  const s = await must(sb.rpc('club_stats', { p_year: year }));
  const thisYear = new Date().getFullYear();
  const years = [...Array(thisYear - 2023).keys()].map(i => thisYear - i);
  const tile = (label, value) => `<div class="tile"><div class="tile-value">${esc(value)}</div><div class="tile-label">${label}</div></div>`;
  const mites = s.mites_by_month;

  render(`
    <div class="page-head">
      <h1>${esc(CLUB_NAME)}</h1>
      <label class="inline">Year <select id="year">${years.map(y =>
        `<option${y === year ? ' selected' : ''}>${y}</option>`).join('')}</select></label>
    </div>
    <p class="muted">Club-wide totals from every member's records. Individual hives, names and locations are never shown here.</p>
    <div class="tiles">
      ${tile('Active hives', s.active_hives)}
      ${tile('Members', s.members)}
      ${tile(`Honey harvested in ${year}`, `${Number(s.honey_lbs).toLocaleString()} lbs`)}
      ${tile(`Inspections logged in ${year}`, s.inspections.toLocaleString())}
      ${tile(`Colonies lost in ${year}`, s.losses)}
    </div>
    <section class="card">
      <h2>Average mite load by month, ${year}</h2>
      <p class="muted">Mites per 100 bees from alcohol washes, sugar rolls and CO₂ tests.</p>
      ${mites.length ? `${miteChart(mites)}
        <details><summary>Show as table</summary>
          <table class="table"><thead><tr><th>Month</th><th class="num">Samples</th><th class="num">Avg per 100</th><th class="num">At/above ${MITE_TREAT}</th></tr></thead>
          <tbody>${mites.map(r => `<tr><td>${MONTHS[r.month - 1]}</td><td class="num">${r.samples}</td>
            <td class="num">${r.avg_per_100}</td><td class="num">${r.over_threshold}</td></tr>`).join('')}</tbody></table>
        </details>` : '<p class="muted">No mite counts logged for this year yet.</p>'}
    </section>
    <div class="grid two">
      <section class="card"><h2>Active hives by town</h2>${breakdown(s.hives_by_town)}</section>
      <section class="card"><h2>Active hives by type</h2>${breakdown(s.hives_by_type)}</section>
      <section class="card"><h2>Active hives by bee species</h2>${breakdown(s.hives_by_species ?? {})}</section>
    </div>
  `);
  on('#year', 'change', e => clubView(Number(e.target.value)));
  wireChartTips();
}

async function adminView() {
  if (!isAdmin()) { render('<p>Club admins only.</p>'); return; }
  const [people, hives] = await Promise.all([
    must(sb.from('profiles').select('*').order('created_at', { ascending: false })),
    must(sb.from('hives').select('owner_id').eq('status', 'active')),
  ]);
  const hiveCount = id => hives.filter(h => h.owner_id === id).length;
  const pending = people.filter(p => !p.approved);
  const members = people.filter(p => p.approved).sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email));

  const row = p => `<tr>
    <td>${esc(p.full_name || '—')}${p.role === 'admin' ? ' <span class="badge">admin</span>' : ''}</td>
    <td>${esc(p.email)}</td>
    <td class="num">${p.approved ? hiveCount(p.id) : ''}</td>
    <td class="actions">${p.approved
      ? (p.id === uid() ? '<span class="muted">you</span>' : `
        <button class="small secondary" data-act="${p.role === 'admin' ? 'demote' : 'promote'}" data-id="${p.id}">${p.role === 'admin' ? 'Remove admin' : 'Make admin'}</button>
        <button class="small secondary" data-act="revoke" data-id="${p.id}">Revoke</button>`)
      : `<button class="small" data-act="approve" data-id="${p.id}">Approve</button>`}</td>
  </tr>`;

  render(`
    <h1>Members</h1>
    <section class="card">
      <h2>Waiting for approval (${pending.length})</h2>
      ${pending.length ? `<table class="table"><thead><tr><th>Name</th><th>Email</th><th></th><th></th></tr></thead>
        <tbody>${pending.map(row).join('')}</tbody></table>` : '<p class="muted">Nobody is waiting.</p>'}
    </section>
    <section class="card">
      <h2>Approved members (${members.length})</h2>
      <table class="table"><thead><tr><th>Name</th><th>Email</th><th class="num">Hives</th><th></th></tr></thead>
        <tbody>${members.map(row).join('')}</tbody></table>
    </section>
  `);
  const changes = {
    approve: { approved: true }, revoke: { approved: false, role: 'member' },
    promote: { role: 'admin' }, demote: { role: 'member' },
  };
  on('[data-act]', 'click', async e => {
    const { act, id } = e.currentTarget.dataset;
    if (act === 'revoke' && !confirm('Revoke this member? They will lose access until re-approved. Their records are kept.')) return;
    try {
      await must(sb.from('profiles').update(changes[act]).eq('id', id));
      toast('Updated');
    } catch (ex) { alert(ex.message); }
    adminView();
  });
}

function csv(rows) {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]).filter(c => c !== 'owner_id');
  const cell = v => {
    const s = v == null ? '' : typeof v === 'object' ? (v.name ?? JSON.stringify(v)) : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [cols.join(','), ...rows.map(r => cols.map(c => cell(r[c])).join(','))].join('\n');
}

async function accountView() {
  const p = state.profile;
  render(`
    <h1>Account</h1>
    <section class="card">
      <form id="name-form" class="stack">
        <label>Name <input name="full_name" value="${esc(p.full_name)}" required></label>
        <p class="muted">Email: ${esc(state.session.user.email)} · ${p.role === 'admin' ? 'Club admin' : 'Member'}</p>
        <button type="submit">Save name</button>
      </form>
    </section>
    <section class="card">
      <h2>Sharing</h2>
      <label class="check"><input type="checkbox" id="share-hives" ${p.share_hives ? 'checked' : ''}>
        Let other members view my hives and records</label>
      <p class="muted">They'll see your name, your hives' town, and your inspections, mite counts, treatments,
        feedings and harvests. They can't change anything, and your apiary locations stay private.
        Club admins can always view your hives.</p>
    </section>
    <section class="card">
      <h2>Download my records</h2>
      <p class="muted">Spreadsheet (CSV) files of everything you've logged.</p>
      <div class="row wrap">
        ${['hives', 'apiaries', ...Object.keys(RECORD_TYPES)].map(t =>
          `<button class="secondary small" data-export="${t}">${t.replace('_', ' ')}</button>`).join('')}
      </div>
    </section>
    <section class="card">
      <form id="pw-form" class="stack">
        <h2>Change password</h2>
        <label>New password <input name="password" type="password" minlength="8" required autocomplete="new-password"></label>
        <button type="submit">Update password</button>
      </form>
    </section>
    <button class="secondary" id="signout">Sign out</button>
  `);
  app.querySelector('#name-form').addEventListener('submit', async e => {
    e.preventDefault();
    const full_name = new FormData(e.target).get('full_name').trim();
    try {
      await must(sb.from('profiles').update({ full_name }).eq('id', uid()));
      state.profile.full_name = full_name;
      toast('Name saved');
    } catch (ex) { alert(ex.message); }
  });
  app.querySelector('#pw-form').addEventListener('submit', async e => {
    e.preventDefault();
    const { error } = await sb.auth.updateUser({ password: new FormData(e.target).get('password') });
    if (error) alert(error.message); else { e.target.reset(); toast('Password updated'); }
  });
  app.querySelector('#share-hives').addEventListener('change', async e => {
    const share_hives = e.target.checked;
    try {
      await must(sb.from('profiles').update({ share_hives }).eq('id', uid()));
      state.profile.share_hives = share_hives;
      toast(share_hives ? 'Your hives are now shared with members' : 'Your hives are now private');
    } catch (ex) { e.target.checked = !share_hives; alert(ex.message); }
  });
  on('[data-export]', 'click', async e => {
    const t = e.currentTarget.dataset.export;
    const select = t === 'apiaries' ? '*' : t === 'hives' ? '*, apiaries(name)' : '*, hives(name)';
    const rows = await must(sb.from(t).select(select).eq('owner_id', uid()));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv(rows)], { type: 'text/csv' }));
    a.download = `marin-hive-tracker-${t}-${todayISO()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  on('#signout', 'click', () => sb.auth.signOut());
}

// ---------------------------------------------------------------------------
// Routing & session
// ---------------------------------------------------------------------------

async function loadProfile() {
  if (!state.session) { state.profile = null; return; }
  const rows = await must(sb.from('profiles').select('*').eq('id', uid()));
  state.profile = rows[0] ?? null;
}

function setChrome(signedIn) {
  document.getElementById('topbar').hidden = !signedIn;
  document.getElementById('nav-admin').hidden = !isAdmin();
  const path = location.hash.split('/')[1] || '';
  document.querySelectorAll('#nav a').forEach(a => {
    const target = a.getAttribute('href').split('/')[1] || '';
    a.classList.toggle('active', target === path || (target === '' && path === 'hive' && !state.viewingOther)
      || (target === 'hives' && path === 'hive' && state.viewingOther));
  });
}

async function route() {
  if (state.recovering) { setChrome(false); return newPasswordView(); }
  if (!state.session) { setChrome(false); return authView(); }
  if (!state.profile?.approved) { setChrome(false); return pendingView(); }
  setChrome(true);
  const [, page, id] = location.hash.split('/');
  try {
    if (page === 'hive' && id) await hiveView(id);
    else if (page === 'apiaries') await apiariesView();
    else if (page === 'hives') await clubHivesView();
    else if (page === 'club') await clubView();
    else if (page === 'admin') await adminView();
    else if (page === 'account') await accountView();
    else await dashboardView();
  } catch (e) {
    // A missing column/table means the site was updated but supabase/schema.sql wasn't re-run.
    const outdated = /(column|relation|function) .* does not exist|schema cache/i.test(e.message);
    render(`<div class="card"><p class="error">Something went wrong: ${esc(e.message)}</p>
      ${outdated ? `<p>The database needs updating for the latest version of the site. A club admin should
        run the <b>Update database</b> workflow on GitHub (Actions tab), or run <code>supabase/schema.sql</code>
        in the Supabase SQL Editor (see the README).</p>` : ''}
      <button onclick="location.reload()">Reload</button></div>`);
  }
}

if (SUPABASE_URL.includes('YOUR-PROJECT')) {
  render(`<div class="card"><h1>Setup needed</h1>
    <p>Add your Supabase project URL and anon key to <code>js/config.js</code>. See the README for step-by-step instructions.</p></div>`);
} else {
  window.addEventListener('hashchange', () => { if (state.session) route(); });
  sb.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') state.recovering = true;
    const changedUser = session?.user.id !== state.session?.user.id;
    state.session = session;
    // Defer: Supabase recommends not awaiting other calls inside this callback.
    if (event === 'INITIAL_SESSION' || changedUser || event === 'PASSWORD_RECOVERY') {
      setTimeout(async () => {
        try { await loadProfile(); } catch (e) { console.error(e); }
        route();
      });
    }
  });
}
