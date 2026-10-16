/**
 * admin.js
 * Commissioner (password-gated) panel.
 * Plain script (shared global scope with data.js, main.js, stats.js,
 * signup.js, admin.js). Load order in index.html: data.js, stats.js,
 * signup.js, admin.js, main.js (main.js LAST - it calls init()).
 */

// ---------- Admin (password gated) ----------
let adminPassword = null;
let adminEntriesCache = [];
let editingEntryId = null;

function renderAdminPanel() {
  const el = document.getElementById('admin-panel');

  if (!adminPassword) {
    el.innerHTML = `
      <label for="admin-pw-input">Admin Password</label>
      <div class="pw-field-wrap">
        <input type="password" id="admin-pw-input">
        <button type="button" id="admin-pw-toggle" class="pw-eye-btn" aria-label="Show password">👁</button>
      </div>
      <button id="admin-login-btn">Log In</button>
      <div id="admin-login-status" class="status-msg"></div>
    `;
    document.getElementById('admin-pw-toggle').addEventListener('click', () => {
      const input = document.getElementById('admin-pw-input');
      const btn = document.getElementById('admin-pw-toggle');
      if (input.type === 'password') {
        input.type = 'text';
        btn.setAttribute('aria-label', 'Hide password');
        btn.classList.add('pw-eye-btn-active');
      } else {
        input.type = 'password';
        btn.setAttribute('aria-label', 'Show password');
        btn.classList.remove('pw-eye-btn-active');
      }
    });

    async function doAdminLogin() {
      const pw = document.getElementById('admin-pw-input').value;
      const statusEl = document.getElementById('admin-login-status');
      statusEl.textContent = 'Checking...';
      statusEl.className = 'status-msg';

      const result = await adminGetEntries(pw);
      if (result.success) {
        adminPassword = pw;
        renderAdminEntries(result.data);
      } else {
        statusEl.textContent = result.error || 'Invalid password';
        statusEl.className = 'status-msg error';
      }
    }

    document.getElementById('admin-login-btn').addEventListener('click', doAdminLogin);
    document.getElementById('admin-pw-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') doAdminLogin();
    });
    return;
  }

  loadAdminEntries();
}

async function loadAdminEntries() {
  const el = document.getElementById('admin-panel');
  el.innerHTML = `<p class="mono" style="color:var(--text-dim)">Loading entries...</p>`;
  const result = await adminGetEntries(adminPassword);
  if (!result.success) {
    adminPassword = null;
    renderAdminPanel();
    return;
  }
  renderAdminEntries(result.data);
}

function renderAdminEntries(entries) {
  const el = document.getElementById('admin-panel');
  entries = [...entries].sort((a, b) => a.teamName.localeCompare(b.teamName));
  adminEntriesCache = entries;

  const ctaVisible = currentConfig.showSignupCta !== false;
  const pendingCount = entries.filter(e => !e.approved).length;
  const unpaidCount = entries.filter(e => !e.paymentReceived).length;
  let tab = 'today';
  try { tab = localStorage.getItem('aahl_admin_tab') || 'today'; } catch (e) { /* private mode */ }

  el.innerHTML = `
    <div class="adm-top">
      <div class="adm-chips">
        <span class="adm-chip"><b>${entries.length}</b> teams</span>
        <span class="adm-chip${pendingCount ? ' warn' : ''}"><b>${pendingCount}</b> awaiting approval</span>
        <span class="adm-chip${unpaidCount ? ' warn' : ''}"><b>${unpaidCount}</b> unpaid</span>
        <span class="adm-chip" id="adm-chip-moves"><b>…</b> pending moves</span>
      </div>
      <a class="admin-btn adm-builder" href="box-builder.html" target="_blank" rel="noopener">📦 2027-28 Box Builder</a>
    </div>

    <nav class="adm-tabs" id="adm-tabs">
      <button data-pane="today">Today</button>
      <button data-pane="teams">Teams <span class="mono">${entries.length}</span></button>
      <button data-pane="tools">Tools</button>
    </nav>

    <section class="adm-pane" data-pane="today">
      <div id="admin-pending-moves"></div>
      <div id="admin-recap"></div>
      <div id="admin-live-health"></div>
    </section>

    <section class="adm-pane" data-pane="teams">
      <div class="adm-teams-bar">
        <input type="search" id="adm-team-search" placeholder="Search team, owner or email…" aria-label="Search teams">
        <button id="admin-add-late-entry-btn" class="admin-btn" title="For a late joiner after the public deadline has passed.">+ Add Late Entry</button>
        <button id="admin-create-late-link-btn" class="admin-btn" title="A private one-entry link, expires in 7 days.">🔗 Late Entry Link</button>
      </div>
      <div id="admin-late-link-result"></div>
      <div id="admin-bulk-bar" class="adm-bulk" style="display:none;">
        <span class="mono" id="admin-bulk-count"></span>
        <button class="admin-btn adm-danger" id="admin-bulk-delete-btn">Delete Selected</button>
      </div>
      ${entries.length === 0 ? '<p class="mono" style="color:var(--text-dim)">No entries yet.</p>' : `
      <table class="admin-entries-table adm-table">
        <thead><tr><th><input type="checkbox" id="admin-select-all" aria-label="Select all"></th><th>Team</th><th>Email</th><th>Status</th><th></th></tr></thead>
        <tbody>
          ${entries.map(e => `
            <tr data-entry-id="${e.id}" data-search="${escapeHtml((e.teamName + ' ' + e.ownerName + ' ' + e.email).toLowerCase())}">
              <td data-label="Select"><input type="checkbox" class="admin-row-select" data-id="${e.id}" aria-label="Select ${escapeHtml(e.teamName)}"></td>
              <td data-label="Team"><div class="adm-team">${escapeHtml(e.teamName)}</div><div class="adm-owner">${escapeHtml(e.ownerName)}</div></td>
              <td class="mono adm-email" data-label="Email">${escapeHtml(e.email)}</td>
              <td data-label="Status">
                <span class="adm-tag ${e.approved ? 'ok' : 'warn'}">${e.approved ? 'Approved' : 'Pending'}</span>
                <button class="adm-tag adm-tag-btn admin-toggle-paid ${e.paymentReceived ? 'ok' : 'off'}" data-id="${e.id}" data-paid="${e.paymentReceived ? '1' : '0'}" title="Click to mark ${e.paymentReceived ? 'unpaid' : 'paid'}">${e.paymentReceived ? '✓ Paid' : 'Unpaid'}</button>
              </td>
              <td data-label="Actions">
                <div class="admin-actions">
                  ${!e.approved ? `<button class="admin-btn admin-approve adm-primary" data-id="${e.id}">Approve</button>` : ''}
                  <button class="admin-btn admin-view-picks" data-id="${e.id}">View</button>
                  <details class="adm-more">
                    <summary class="admin-btn" aria-label="More actions">⋯</summary>
                    <div class="adm-menu">
                      <button class="admin-edit-picks" data-id="${e.id}">✏️ Edit picks</button>
                      <button class="admin-rename" data-id="${e.id}">🏷️ Rename team</button>
                      <button class="admin-resend-email" data-id="${e.id}">✉️ Resend email</button>
                      <button class="admin-delete adm-danger" data-id="${e.id}">🗑️ Delete team</button>
                    </div>
                  </details>
                </div>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`}
    </section>

    <section class="adm-pane" data-pane="tools">
      <div class="adm-tools">
        <div class="panel adm-tool adm-wide">
          <h3>🔁 Process Trade</h3>
          <p class="adm-help">Same as the owner doing it from My Team: counts as one of their moves, banks the outgoing player's points, logs it in Activity and emails the owner. In-season it's auto-approved.</p>
          <div class="adm-row">
            <select id="admin-trade-team"><option value="">Select team...</option></select>
            <select id="admin-trade-box" disabled><option value="">Box...</option></select>
            <select id="admin-trade-player" disabled><option value="">New player...</option></select>
            <button id="admin-trade-btn" disabled>Process Trade</button>
          </div>
          <div id="admin-trade-info" class="mono" style="font-size:12px; margin-top:8px;"></div>
          <div id="admin-trade-status" class="status-msg"></div>
        </div>
        <div class="panel adm-tool adm-wide">
          <h3>🩹 Player Status (IR List)</h3>
          <p class="adm-help">Fills itself from the NHL injury feed every 4 hours. Use this to add someone it missed, correct a status or mark a player healthy.</p>
          <div class="adm-row">
            <select id="admin-inj-player"><option value="">Loading players...</option></select>
            <select id="admin-inj-code"></select>
            <input type="text" id="admin-inj-note" placeholder="Details (e.g. Knee)">
            <button id="admin-inj-set-btn">Set</button>
            <button id="admin-inj-refresh-btn" class="admin-btn">Refresh from feed</button>
          </div>
          <div id="admin-inj-status" class="status-msg"></div>
          <div id="admin-inj-overrides" style="margin-top:10px;"></div>
        </div>
        <div class="panel adm-tool">
          <h3>📸 Weekly Standings Image</h3>
          <p class="adm-help">A ready-to-post picture of last week's standings (also attached to the Monday email).</p>
          <button id="admin-weekly-image-btn" class="admin-btn">Make image</button>
          <div id="admin-weekly-image-result" style="margin-top:10px;"></div>
        </div>
        <div class="panel adm-tool">
          <h3>🏒 Sign Up button</h3>
          <p class="adm-help">Show the Sign Up button on the Home page.</p>
          <label class="toggle-switch">
            <input type="checkbox" id="admin-toggle-cta" ${ctaVisible ? 'checked' : ''}>
            <span class="toggle-slider"></span>
          </label>
        </div>
      </div>
    </section>
  `;

  // Tabs (remembered per browser)
  const showPane = (name) => {
    el.querySelectorAll('.adm-pane').forEach(p => { p.hidden = p.dataset.pane !== name; });
    el.querySelectorAll('#adm-tabs button').forEach(b => b.classList.toggle('on', b.dataset.pane === name));
    try { localStorage.setItem('aahl_admin_tab', name); } catch (e) { /* private mode */ }
  };
  el.querySelectorAll('#adm-tabs button').forEach(b => b.addEventListener('click', () => showPane(b.dataset.pane)));
  showPane(['today', 'teams', 'tools'].includes(tab) ? tab : 'today');

  // Team search
  const search = document.getElementById('adm-team-search');
  if (search) search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase();
    el.querySelectorAll('.adm-table tbody tr').forEach(tr => { tr.hidden = !!q && !tr.dataset.search.includes(q); });
  });

  // Close any open "⋯" menu when another opens or you click elsewhere
  el.querySelectorAll('.adm-more').forEach(d => d.addEventListener('toggle', () => {
    if (d.open) el.querySelectorAll('.adm-more[open]').forEach(o => { if (o !== d) o.open = false; });
  }));
  document.addEventListener('click', (ev) => {
    if (!ev.target.closest('.adm-more')) el.querySelectorAll('.adm-more[open]').forEach(o => { o.open = false; });
  });

  if (entries.length === 0) {
    wireAdminCtaToggle_();
    wireAdminAddLateEntryButton_();
    wireAdminCreateLateLinkButton_();
    wireAdminWeeklyImageButton_();
    wireAdminInjuryPanel_();
    wireAdminTradePanel_();
    loadAdminPendingMoves(); // after innerHTML so the container exists
    loadAdminRecap_();
    loadAdminLiveHealth_();
    return;
  }

  function updateBulkBar_() {
    const checked = el.querySelectorAll('.admin-row-select:checked');
    const bar = document.getElementById('admin-bulk-bar');
    bar.style.display = checked.length > 0 ? 'flex' : 'none';
    document.getElementById('admin-bulk-count').textContent = `${checked.length} selected`;
  }

  document.getElementById('admin-select-all').addEventListener('change', (e) => {
    el.querySelectorAll('.admin-row-select').forEach(cb => { cb.checked = e.target.checked; });
    updateBulkBar_();
  });

  el.querySelectorAll('.admin-row-select').forEach(cb => {
    cb.addEventListener('change', updateBulkBar_);
  });

  document.getElementById('admin-bulk-delete-btn').addEventListener('click', async () => {
    const ids = Array.from(el.querySelectorAll('.admin-row-select:checked')).map(cb => cb.dataset.id);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} entries permanently? This can't be undone.`)) return;
    await adminBatchRejectEntries(adminPassword, ids);
    loadAdminEntries();
  });

  el.querySelectorAll('.admin-approve').forEach(btn => {
    btn.addEventListener('click', async () => {
      await adminApproveEntry(adminPassword, btn.dataset.id);
      loadAdminEntries();
    });
  });

  el.querySelectorAll('.admin-view-picks').forEach(btn => {
    btn.addEventListener('click', () => {
      openAdminPicksModal(btn.dataset.id);
    });
  });

  el.querySelectorAll('.admin-edit-picks').forEach(btn => {
    btn.addEventListener('click', () => {
      const entry = adminEntriesCache.find(e => e.id === btn.dataset.id);
      if (entry) startEditingEntry(entry);
    });
  });

  el.querySelectorAll('.admin-resend-email').forEach(btn => {
    btn.addEventListener('click', async () => {
      const originalText = btn.textContent;
      btn.textContent = 'Sending...';
      btn.disabled = true;
      const result = await adminResendEmail(adminPassword, btn.dataset.id);
      btn.textContent = result.success ? 'Sent!' : 'Failed';
      setTimeout(() => { btn.textContent = originalText; btn.disabled = false; }, 2000);
    });
  });

  el.querySelectorAll('.admin-toggle-paid').forEach(btn => {
    btn.addEventListener('click', async () => {
      const currentlyPaid = btn.dataset.paid === '1';
      await adminSetPayment(adminPassword, btn.dataset.id, !currentlyPaid);
      loadAdminEntries();
    });
  });

  el.querySelectorAll('.admin-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('Delete this entry permanently?')) return;
      await adminRejectEntry(adminPassword, btn.dataset.id);
      loadAdminEntries();
    });
  });

  el.querySelectorAll('.admin-rename').forEach(btn => {
    btn.addEventListener('click', async () => {
      const newName = prompt('New team name:');
      if (!newName) return;
      await adminUpdateEntry(adminPassword, btn.dataset.id, { teamName: newName });
      loadAdminEntries();
    });
  });

  wireAdminCtaToggle_();
  wireAdminAddLateEntryButton_();
  wireAdminCreateLateLinkButton_();
  wireAdminWeeklyImageButton_();
  wireAdminInjuryPanel_();
  wireAdminTradePanel_();
  loadAdminPendingMoves(); // after innerHTML so the container exists
  loadAdminRecap_();
  loadAdminLiveHealth_();
}

// ---------- Live points health (Cloudflare Worker, every minute during games) ----------
async function loadAdminLiveHealth_() {
  const box = document.getElementById('admin-live-health');
  if (!box) return;
  let hist = null, work = null;
  try {
    [hist, work] = await Promise.all([supabaseDirectGet_('config', 'liveHealthHistory'), supabaseDirectGet_('config', 'livePointsWork')]);
  } catch (e) { /* shown as empty */ }
  const rows = ((hist && hist.nights) || []).slice();
  // Tonight / last night still in progress (not yet copied by the morning job).
  if (work && work.health && !rows.some(n => n.date === work.date)) {
    const h = work.health;
    rows.unshift(Object.assign({ live: true, date: work.date, avgMs: h.runs ? Math.round(h.totalMs / h.runs) : 0, games: Object.keys(work.gameStates || {}).length }, h));
  }
  const ok = (n) => !n.failed && n.maxMs < 5000;
  box.innerHTML = `
    <div class="panel" style="margin-bottom:16px;">
      <h3 style="margin-bottom:6px;">📡 Live Points Health</h3>
      <p class="mono" style="color:var(--text-dim); font-size:12px; margin-bottom:10px;">One row per game night from the fast server (updates every minute during games). "Queued" = games waiting a minute for their turn on busy nights. Exact CPU time is only in Cloudflare → aahl-2526 → Metrics.</p>
      ${rows.length ? `<div class="players-table-scroll"><table class="data-table"><thead><tr>
        <th>Night</th><th>Games</th><th>Most live</th><th>Runs</th><th>Box scores</th><th>Queued</th><th>Updates</th><th>Avg / slowest run</th><th>Failed</th><th></th>
      </tr></thead><tbody>${rows.map(n => `<tr>
        <td class="mono">${escapeHtml(n.date)}${n.live ? ' <span style="color:var(--ice)">(in progress)</span>' : ''}</td>
        <td class="mono">${n.games || 0}</td><td class="mono">${n.maxGames || 0}</td><td class="mono">${n.runs || 0}</td>
        <td class="mono">${n.fetched || 0}</td><td class="mono">${n.queued || 0}</td><td class="mono">${n.pointsSaves || 0}</td>
        <td class="mono">${n.avgMs || 0} / ${n.maxMs || 0} ms</td><td class="mono" style="color:${n.failed ? '#ff5c5c' : 'inherit'}">${n.failed || 0}</td>
        <td>${ok(n) ? '✅' : '⚠️'}</td></tr>`).join('')}</tbody></table></div>`
      : '<p class="mono" style="color:var(--text-dim); font-size:13px;">No game nights recorded yet - the first row appears once games start.</p>'}
    </div>`;
}

// ---------- Nightly recap ("Last Night in the AAHL", written by AI) ----------
async function loadAdminRecap_(op) {
  const box = document.getElementById('admin-recap');
  if (!box || !adminPassword) return;
  if (op) box.querySelectorAll('button').forEach(b => { b.disabled = true; });
  const res = await adminRecap(adminPassword, op || 'get');
  const r = res && res.success ? res.data : null;
  const note = res && !res.success ? `<p class="status-msg error" style="margin-top:8px;">${escapeHtml(res.error || 'Something went wrong')}</p>` : '';
  box.innerHTML = `
    <div class="panel" style="margin-bottom:16px;">
      <h3 style="margin-bottom:6px;">📰 Last Night Recap</h3>
      <p class="mono" style="color:var(--text-dim); font-size:12px; margin-bottom:10px;">Written each morning by AI from the 4am stats (shown on Home). Every number is checked against the real stats; if the AI gets one wrong, a plain version is used instead.</p>
      ${r ? `
        <p style="margin-bottom:6px;">${escapeHtml(r.text)}</p>
        <p class="mono" style="color:var(--text-dim); font-size:11px; margin-bottom:10px;">${escapeHtml(r.night || r.date)} · ${r.source === 'ai' ? 'written by AI' : 'plain version' + (r.note ? ' - ' + escapeHtml(r.note) : '')}${r.hidden ? ' · <span style="color:var(--amber)">HIDDEN from Home</span>' : ''}</p>
      ` : '<p class="mono" style="color:var(--text-dim); font-size:13px; margin-bottom:10px;">No recap yet - the first one is written after the next 4am run.</p>'}
      <div style="display:flex; gap:8px; flex-wrap:wrap;">
        <button type="button" data-recap="regenerate">✍️ Rewrite</button>
        ${r ? `<button type="button" data-recap="${r.hidden ? 'show' : 'hide'}">${r.hidden ? '👁 Show on Home' : '🙈 Hide from Home'}</button>` : ''}
      </div>
      ${note}
    </div>`;
  box.querySelectorAll('button[data-recap]').forEach(b => b.addEventListener('click', () => loadAdminRecap_(b.dataset.recap)));
}

// ---------- Live pending-moves alerts ----------
// Apps Script updates config/pendingMovesSignal (count + time only) whenever
// a move is requested, approved or rejected. While Admin is open and signed
// in, Supabase Realtime tells this page straight away and the pending list
// reloads through the normal password-protected call. If supabase-js isn't
// loaded, nothing changes: the list still loads when Admin opens.
let adminMovesChannel_ = null;
let adminMovesCount_ = null;
let adminMovesTimer_ = null;
function onAdminMovesSignal_(payload) {
  const row = payload && payload.new;
  const count = row && row.data && typeof row.data.count === 'number' ? row.data.count : null;
  const grew = count != null && adminMovesCount_ != null && count > adminMovesCount_;
  if (count != null) adminMovesCount_ = count;
  if (!adminPassword || !document.getElementById('admin-pending-moves')) return;
  clearTimeout(adminMovesTimer_);
  adminMovesTimer_ = setTimeout(() => {
    loadAdminPendingMoves();
    if (grew) showAdminMovesBanner_();
  }, 800);
}
function showAdminMovesBanner_() {
  const container = document.getElementById('admin-pending-moves');
  if (!container) return;
  let b = document.getElementById('admin-moves-banner');
  if (!b) {
    b = document.createElement('div');
    b.id = 'admin-moves-banner';
    b.className = 'mono';
    b.style.cssText = 'background:var(--bg-panel); border:1px solid var(--ice); color:var(--ice); border-radius:8px; padding:8px 12px; margin-bottom:10px; font-size:13px;';
    container.parentNode.insertBefore(b, container);
  }
  b.textContent = '● New move request just came in';
  clearTimeout(b._t);
  b._t = setTimeout(() => b.remove(), 15000);
}
function startAdminMovesChannel_() {
  if (adminMovesChannel_) return;
  const sb = (typeof sbClient_get_ === 'function') ? sbClient_get_() : null;
  if (!sb || typeof sb.channel !== 'function') return;
  try {
    adminMovesChannel_ = sb.channel('aahl-admin-moves')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'config', filter: 'id=eq.pendingMovesSignal' }, onAdminMovesSignal_)
      .subscribe();
  } catch (e) {
    adminMovesChannel_ = null;
  }
}

function updateAdminMovesChip_() {
  const chip = document.getElementById('adm-chip-moves');
  if (!chip) return;
  chip.innerHTML = `<b>${adminMovesCount_}</b> pending move${adminMovesCount_ === 1 ? '' : 's'}`;
  chip.classList.toggle('warn', adminMovesCount_ > 0);
}

async function loadAdminPendingMoves() {
  startAdminMovesChannel_();
  const container = document.getElementById('admin-pending-moves');
  if (!container) return;
  container.innerHTML = `<p class="mono" style="color:var(--text-dim); font-size:13px;">Loading pending moves...</p>`;

  let result;
  try {
    result = await adminGetPendingMoves(adminPassword);
  } catch (err) {
    result = { success: false, error: err.message };
  }

  // Show real failures instead of masking them as "No pending moves."
  if (!result || !result.success) {
    container.innerHTML = `<p class="status-msg error" style="margin-bottom:16px;">Pending moves failed to load: ${escapeHtml((result && result.error) || 'Unknown error')}</p>`;
    return;
  }
  adminMovesCount_ = (result.data || []).length;
  updateAdminMovesChip_();
  if (!result.data || result.data.length === 0) {
    container.innerHTML = `<p class="mono" style="color:var(--text-dim); font-size:13px; margin-bottom:16px;">No pending moves.</p>`;
    return;
  }

  container.innerHTML = `
    <div class="panel" style="margin-bottom:16px;">
      <h3 style="margin-bottom:12px;">Pending Moves (${result.data.length})</h3>
      ${result.data.map(m => `
        <div class="activity-row">
          <span><strong>${escapeHtml(m.teamName)}</strong> — ${escapeHtml(m.boxLabel)}: ${escapeHtml(m.outPlayerName)} → ${escapeHtml(m.inPlayerName)}</span>
          <span>
            <button class="admin-btn admin-approve-move" data-id="${escapeHtml(m.moveId)}">Approve</button>
            <button class="admin-btn admin-reject-move" data-id="${escapeHtml(m.moveId)}">Reject</button>
          </span>
        </div>
      `).join('')}
      <div id="admin-moves-status" class="status-msg"></div>
    </div>
  `;

  const statusEl = document.getElementById('admin-moves-status');
  const allBtns = container.querySelectorAll('.admin-approve-move, .admin-reject-move');

  async function act_(btn, fn, label) {
    allBtns.forEach(b => { b.disabled = true; }); // block double-clicks
    btn.textContent = label + '...';
    let res;
    try { res = await fn(adminPassword, btn.dataset.id); }
    catch (err) { res = { success: false, error: err.message }; }
    if (!res || !res.success) {
      statusEl.textContent = `${label} failed: ${(res && res.error) || 'Unknown error'}`;
      statusEl.className = 'status-msg error';
      allBtns.forEach(b => { b.disabled = false; });
      btn.textContent = label === 'Approving' ? 'Approve' : 'Reject';
      return;
    }
    loadAdminPendingMoves();
    loadAdminEntries();
  }

  container.querySelectorAll('.admin-approve-move').forEach(btn => {
    btn.addEventListener('click', () => act_(btn, adminApproveMove, 'Approving'));
  });

  container.querySelectorAll('.admin-reject-move').forEach(btn => {
    btn.addEventListener('click', () => {
      if (!confirm('Reject this move? The player will stay as-is and the move will not count.')) return;
      act_(btn, adminRejectMove, 'Rejecting');
    });
  });
}

/**
 * Admin trade: runs the exact same server path an owner uses from My Team
 * (submitBatchTeamChanges with the team's own entryId + email), then, if the
 * season has started and the move landed in Pending, approves it right away
 * via the normal approve path - which banks points and writes the activity.
 */
async function wireAdminTradePanel_() {
  const teamSel = document.getElementById('admin-trade-team');
  if (!teamSel) return;
  const boxSel = document.getElementById('admin-trade-box');
  const playerSel = document.getElementById('admin-trade-player');
  const btn = document.getElementById('admin-trade-btn');
  const infoEl = document.getElementById('admin-trade-info');
  const statusEl = document.getElementById('admin-trade-status');
  let tradeEntry = null;   // findEntryForMoves result
  let tradeCreds = null;   // { entryId, email, teamName }

  teamSel.innerHTML = `<option value="">Select team...</option>` + adminEntriesCache
    .filter(e => e.approved)
    .map(e => `<option value="${escapeHtml(e.id)}">${escapeHtml(e.teamName)} — ${escapeHtml(e.ownerName || '')}</option>`).join('');

  // Fresh IR data each time the panel loads, so tags match the IR List.
  await Promise.all([ensureBoxesLoaded_(), ensureInjuriesLoaded_(true)]);
  const irTag = pid => {
    const inj = injuriesByPlayer[pid];
    return inj ? `  🩹 ${inj.code}` : '';
  };
  const boxById = {};
  allBoxes.forEach(b => { boxById[b.id] = b; });
  const nameOf = (box, pid) => {
    const o = (box && box.players || []).find(p => p.playerId === pid);
    return o ? o.name : pid;
  };

  function setStatus_(msg, isErr) {
    statusEl.textContent = msg;
    statusEl.className = 'status-msg' + (isErr ? ' error' : '');
  }

  function refreshPlayers_() {
    const box = boxById[boxSel.value];
    playerSel.disabled = !box;
    btn.disabled = true;
    if (!box) { playerSel.innerHTML = `<option value="">New player...</option>`; return; }
    const cur = tradeEntry.picks[box.id];
    playerSel.innerHTML = `<option value="">New player...</option>` + box.players
      .filter(p => p.playerId !== cur)
      .map(p => `<option value="${escapeHtml(p.playerId)}">${escapeHtml(p.name)} (${escapeHtml(p.team)})${escapeHtml(irTag(p.playerId))}</option>`).join('');
  }

  teamSel.addEventListener('change', async () => {
    tradeEntry = null; tradeCreds = null;
    boxSel.disabled = true; playerSel.disabled = true; btn.disabled = true;
    boxSel.innerHTML = `<option value="">Box...</option>`;
    playerSel.innerHTML = `<option value="">New player...</option>`;
    infoEl.textContent = ''; setStatus_('', false);
    const entry = adminEntriesCache.find(e => e.id === teamSel.value);
    if (!entry) return;

    infoEl.textContent = 'Loading team...';
    const res = await findEntryForMoves(entry.id, entry.email);
    if (!res.success) { infoEl.textContent = ''; setStatus_(res.error || 'Team lookup failed', true); return; }
    tradeEntry = res.data;
    tradeCreds = { entryId: entry.id, email: entry.email, teamName: entry.teamName };

    infoEl.innerHTML = tradeEntry.seasonStarted
      ? `<span style="color:${tradeEntry.movesRemaining > 0 ? 'var(--ice)' : '#ff5c5c'}">${tradeEntry.movesRemaining} move${tradeEntry.movesRemaining === 1 ? '' : 's'} remaining</span>`
      : `<span style="color:var(--ice)">Pre-season: change is instant and free</span>`;
    if (tradeEntry.seasonStarted && tradeEntry.movesRemaining <= 0) return;

    boxSel.innerHTML = `<option value="">Box...</option>` + REQUIRED_BOX_IDS.map(id => {
      const box = boxById[id];
      if (!box) return '';
      return `<option value="${escapeHtml(box.id)}">${escapeHtml(box.boxLabel)}: ${escapeHtml(nameOf(box, tradeEntry.picks[box.id]))}${escapeHtml(irTag(tradeEntry.picks[box.id]))}</option>`;
    }).join('');
    boxSel.disabled = false;
  });

  boxSel.addEventListener('change', refreshPlayers_);
  playerSel.addEventListener('change', () => { btn.disabled = !playerSel.value; });

  btn.addEventListener('click', async () => {
    if (!tradeEntry || !tradeCreds || !boxSel.value || !playerSel.value) return;
    const box = boxById[boxSel.value];
    const outName = nameOf(box, tradeEntry.picks[box.id]);
    const inName = nameOf(box, playerSel.value);
    if (!confirm(`Process official trade for ${tradeCreds.teamName}?\n\n${box.boxLabel}: ${outName} → ${inName}\n\n${outName}'s points get banked. This uses one of their moves.`)) return;

    btn.disabled = true; teamSel.disabled = true; boxSel.disabled = true; playerSel.disabled = true;
    setStatus_('Submitting trade...', false);

    try {
      const res = await submitBatchTeamChanges(tradeCreds.entryId, tradeCreds.email,
        [{ boxId: box.id, newPlayerId: playerSel.value }], []);
      if (!res.success) {
        const msg = (res.errors && res.errors.length) ? res.errors.join('\n') : (res.error || 'Unknown error');
        throw new Error(msg);
      }

      if (tradeEntry.seasonStarted) {
        setStatus_('Approving trade...', false);
        const pend = await adminGetPendingMoves(adminPassword);
        const mv = (pend.success ? pend.data : []).find(m =>
          m.teamName === tradeCreds.teamName && m.inPlayerName === inName && m.outPlayerName === outName);
        if (!mv) {
          alert('Trade submitted but could not auto-approve. Approve it under Pending Moves.');
        } else {
          const ap = await adminApproveMove(adminPassword, mv.moveId);
          if (!ap.success) throw new Error('Submitted, but approve failed: ' + (ap.error || 'Unknown error') + ' - approve it under Pending Moves.');
          alert(`Trade done: ${tradeCreds.teamName} — ${outName} → ${inName}. Points banked.`);
        }
      } else {
        alert(`Pre-season change done: ${tradeCreds.teamName} — ${outName} → ${inName}.`);
      }
      if (typeof refreshAndRenderHome === 'function') refreshAndRenderHome();
      loadAdminEntries();
    } catch (err) {
      setStatus_('Trade failed: ' + err.message, true);
      teamSel.disabled = false; boxSel.disabled = false; playerSel.disabled = false; btn.disabled = false;
    }
  });
}

function wireAdminCtaToggle_() {
  const checkbox = document.getElementById('admin-toggle-cta');
  if (!checkbox) return;
  checkbox.addEventListener('change', async () => {
    const newVisible = checkbox.checked;
    const result = await adminUpdateConfig(adminPassword, { showSignupCta: newVisible });
    if (result.success) {
      currentConfig.showSignupCta = newVisible;
      applySignupCtaVisibility();
    } else {
      checkbox.checked = !newVisible; // revert on failure
    }
  });
}

function wireAdminAddLateEntryButton_() {
  const btn = document.getElementById('admin-add-late-entry-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    isAdminCreatingEntry = true;
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    document.getElementById('view-signup').classList.add('active');
    document.title = 'Sign Up — AAHL 26/27';
    await Promise.all([ensurePlayersLoaded(), ensureBoxesLoaded_(), ensureLastSeasonStandingsLoaded_()]);
    renderSignupForm();
  });
}

/**
 * "Create Late Entry Link" - asks the server for a one-time signed invite
 * link, then shows it with a Copy button so it can be pasted into a text
 * or email. Each click makes a fresh link (one entry per link).
 */
function wireAdminCreateLateLinkButton_() {
  const btn = document.getElementById('admin-create-late-link-btn');
  const out = document.getElementById('admin-late-link-result');
  if (!btn || !out) return;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    out.innerHTML = `<span class="mono" style="color:var(--text-dim); font-size:12px;">Creating link...</span>`;

    const result = await adminCreateLateInvite(adminPassword);
    btn.disabled = false;

    if (!result || !result.success) {
      out.innerHTML = `<span class="status-msg error">${escapeHtml((result && result.error) || 'Could not create link.')}</span>`;
      return;
    }

    const expires = new Date(result.data.expiresAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    out.innerHTML = `
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        <input type="text" id="admin-late-link-input" readonly value="${escapeHtml(result.data.url)}" style="flex:1; min-width:240px; margin:0;">
        <button id="admin-late-link-copy-btn" style="margin:0;">Copy</button>
      </div>
      <div class="mono" style="color:var(--text-dim); font-size:12px; margin-top:6px;">Good for one entry. Expires ${escapeHtml(expires)}. The entry will show as Pending until you approve it.</div>
    `;

    const input = document.getElementById('admin-late-link-input');
    const copyBtn = document.getElementById('admin-late-link-copy-btn');
    input.addEventListener('focus', () => input.select());
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(input.value);
      } catch (e) {
        input.select();
        document.execCommand('copy');
      }
      copyBtn.textContent = 'Copied!';
      setTimeout(() => { copyBtn.textContent = 'Copy'; }, 2000);
    });
  });
}

// ---------- Weekly standings image (for the Facebook post) ----------
/**
 * "Weekly Standings Image": draws a 1080x1350 picture of last week's
 * standings (top 10 with each team's points gained that week), the three
 * hottest teams and the three top players, then offers it as a PNG.
 * Built from the Points Race history and the weekly top performers, so
 * both need to have run at least once.
 */
function wireAdminWeeklyImageButton_() {
  const btn = document.getElementById('admin-weekly-image-btn');
  const out = document.getElementById('admin-weekly-image-result');
  if (!btn || !out) return;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    out.innerHTML = `<span class="mono" style="color:var(--text-dim); font-size:12px;">Building image...</span>`;
    try {
      const [race, weekly] = await Promise.all([fetchPointsRace(), fetchWeeklyTop()]);
      if (!race || !race.dates || race.dates.length === 0) {
        out.innerHTML = `<span class="status-msg error">No nightly standings history yet - run setupPointsRaceTrigger in Apps Script first.</span>`;
        return;
      }
      try { await Promise.all([document.fonts.load("800 60px 'Barlow Condensed'"), document.fonts.load("700 30px 'JetBrains Mono'")]); } catch (e) { /* fall back to default fonts */ }

      const canvas = drawWeeklyImage_(race, weekly);
      canvas.style.cssText = 'width:100%; max-width:360px; height:auto; border:1px solid var(--border); display:block; margin-bottom:8px;';
      out.innerHTML = '';
      out.appendChild(canvas);
      const dl = document.createElement('button');
      dl.textContent = 'Download PNG';
      dl.style.margin = '0';
      dl.addEventListener('click', () => {
        const a = document.createElement('a');
        a.download = `aahl-week-${canvas.dataset.weekEnd}.png`;
        a.href = canvas.toDataURL('image/png');
        a.click();
      });
      out.appendChild(dl);
    } catch (err) {
      out.innerHTML = `<span class="status-msg error">Could not build the image: ${escapeHtml(err.message)}</span>`;
    } finally {
      btn.disabled = false;
    }
  });
}

function drawWeeklyImage_(race, weekly) {
  const W = 1080, H = 1350, PAD = 60;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d');
  const DISPLAY = "'Barlow Condensed', Arial, sans-serif", MONO = "'JetBrains Mono', monospace";
  const ICE = '#4C8FC4', AMBER = '#A13F5C', GOLD = '#d4a017', TEXT = '#e8edf1', DIM = '#A2AAAD', PANEL = '#141414', LINE = '#2a2a2a', GREEN = '#3ecf6a';

  // The week: taken from the weekly top performers if available, otherwise
  // the last completed Mon-Sun week.
  const iso = (d) => d.toISOString().slice(0, 10);
  let weekStart = weekly && weekly.weekStart, weekEnd = weekly && weekly.weekEnd;
  if (!weekStart || !weekEnd) {
    const now = new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/New_York' }) + 'T12:00:00Z');
    const dow = now.getUTCDay() === 0 ? 7 : now.getUTCDay();
    const end = new Date(now.getTime() - dow * 86400000);
    weekEnd = iso(end); weekStart = iso(new Date(end.getTime() - 6 * 86400000));
  }
  canvas.dataset.weekEnd = weekEnd;

  // Standings as of the end of that week, and each team's gain during it.
  let endIdx = -1, baseIdx = -1;
  race.dates.forEach((d, i) => { if (d <= weekEnd) endIdx = i; if (d < weekStart) baseIdx = i; });
  if (endIdx === -1) endIdx = race.dates.length - 1;
  const teams = Object.keys(race.teams).map(id => {
    const t = race.teams[id];
    const pts = t.pts[endIdx];
    const base = baseIdx === -1 ? 0 : t.pts[baseIdx];
    return { name: t.name, pts, gain: (pts == null || base == null) ? null : pts - base };
  }).filter(t => t.pts != null).sort((a, b) => b.pts - a.pts);
  const hot = teams.filter(t => t.gain != null).sort((a, b) => b.gain - a.gain).slice(0, 3);

  const day = (s) => new Date(s + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const text = (str, x, y, font, color, align) => { c.font = font; c.fillStyle = color; c.textAlign = align || 'left'; c.fillText(str, x, y); };
  const fit = (str, font, maxW) => {
    c.font = font;
    if (c.measureText(str).width <= maxW) return str;
    while (str.length > 1 && c.measureText(str + '…').width > maxW) str = str.slice(0, -1);
    return str + '…';
  };

  c.fillStyle = '#0a0a0a'; c.fillRect(0, 0, W, H);

  // Header
  text('ANGRY ALPACA HOCKEY LEAGUE · 2026-27', PAD, 86, `700 24px ${MONO}`, AMBER);
  text('WEEKLY STANDINGS', PAD, 168, `800 84px ${DISPLAY}`, TEXT);
  text(`${day(weekStart)} – ${day(weekEnd)}`.toUpperCase(), PAD, 214, `700 30px ${MONO}`, ICE);

  // Top 10
  let y = 252;
  c.fillStyle = PANEL; c.fillRect(PAD, y, W - PAD * 2, 56 + 62 * Math.min(10, teams.length));
  text('RANK', PAD + 24, y + 38, `700 20px ${MONO}`, DIM);
  text('TEAM', PAD + 130, y + 38, `700 20px ${MONO}`, DIM);
  text('THIS WEEK', W - PAD - 190, y + 38, `700 20px ${MONO}`, DIM, 'right');
  text('POINTS', W - PAD - 24, y + 38, `700 20px ${MONO}`, DIM, 'right');
  y += 56;
  teams.slice(0, 10).forEach((t, i) => {
    c.fillStyle = LINE; c.fillRect(PAD, y, W - PAD * 2, 1);
    const rankColor = i === 0 ? GOLD : (i < 3 ? AMBER : DIM);
    text(String(i + 1), PAD + 24, y + 43, `800 40px ${DISPLAY}`, rankColor);
    text(fit(t.name, `700 38px ${DISPLAY}`, 520), PAD + 130, y + 43, `700 38px ${DISPLAY}`, TEXT);
    if (t.gain != null) text('+' + t.gain.toFixed(1), W - PAD - 190, y + 42, `700 28px ${MONO}`, GREEN, 'right');
    text(t.pts.toFixed(2), W - PAD - 24, y + 42, `700 30px ${MONO}`, ICE, 'right');
    y += 62;
  });

  // Two side-by-side lists: hottest teams and top players of the week.
  y += 34;
  const colW = (W - PAD * 2 - 24) / 2;
  const list = (x, title, rows) => {
    text(title, x, y + 26, `700 24px ${MONO}`, AMBER);
    c.fillStyle = PANEL; c.fillRect(x, y + 44, colW, 74 * 3 + 12);
    rows.forEach((r, i) => {
      const ry = y + 44 + 12 + i * 74;
      text(String(i + 1), x + 20, ry + 44, `800 36px ${DISPLAY}`, AMBER);
      text(fit(r.name, `700 32px ${DISPLAY}`, colW - 200), x + 60, ry + 34, `700 32px ${DISPLAY}`, TEXT);
      text(fit(r.sub, `400 19px ${MONO}`, colW - 200), x + 60, ry + 60, `400 19px ${MONO}`, DIM);
      text(r.value, x + colW - 18, ry + 44, `700 28px ${MONO}`, GREEN, 'right');
    });
    if (rows.length === 0) text('Not available yet', x + 20, y + 100, `400 20px ${MONO}`, DIM);
  };
  list(PAD, 'HOTTEST TEAMS', hot.map(t => ({ name: t.name, sub: `${ordinal(teams.indexOf(t) + 1)} overall`, value: '+' + t.gain.toFixed(1) })));
  list(PAD + colW + 24, 'TOP PLAYERS', ((weekly && weekly.top) || []).slice(0, 3).map(p => ({
    name: p.fullName,
    sub: `${p.team || ''} · ` + (p.isGoalie ? `${p.wins || 0}W ${p.saves || 0}SV` : `${p.goals || 0}G ${p.assists || 0}A`),
    value: '+' + (p.pts || 0).toFixed(1)
  })));

  // Footer
  const cfg = currentConfig || {};
  c.fillStyle = LINE; c.fillRect(PAD, H - 96, W - PAD * 2, 1);
  text(`${cfg.totalEntries ?? teams.length} TEAMS · $${(cfg.prizePool ?? 0).toFixed(0)} PRIZE POOL`, PAD, H - 50, `700 24px ${MONO}`, DIM);
  text('theaahl.ca', W - PAD, H - 48, `800 40px ${DISPLAY}`, ICE, 'right');

  return canvas;
}

// ---------- Player status overrides (IR List) ----------
/**
 * Admin panel for setting a pool player's status by hand. An override
 * always beats the automatic feed; "Healthy" forces a player off the IR
 * List; "Remove" hands the player back to the automatic feed.
 */
async function wireAdminInjuryPanel_() {
  const playerSel = document.getElementById('admin-inj-player');
  const codeSel = document.getElementById('admin-inj-code');
  const noteEl = document.getElementById('admin-inj-note');
  const statusEl = document.getElementById('admin-inj-status');
  const listEl = document.getElementById('admin-inj-overrides');
  if (!playerSel || !codeSel) return;

  codeSel.innerHTML = INJURY_ORDER.map(code => `<option value="${code}">${code} - ${escapeHtml(INJURY_STATUS[code].label)}</option>`).join('')
    + `<option value="OK">OK - Healthy (take off the list)</option>`;

  await ensurePlayersLoaded();
  const pool = allPlayers.filter(p => poolPlayerIds.has(p.id)).sort((a, b) => (a.fullName || '').localeCompare(b.fullName || ''));
  playerSel.innerHTML = `<option value="">Pick a player...</option>` + pool.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.fullName)} (${escapeHtml(p.team || '')})</option>`).join('');

  const say = (msg, isError) => { statusEl.textContent = msg; statusEl.className = 'status-msg' + (isError ? ' error' : ''); };

  const reloadSite = async () => {
    await ensureInjuriesLoaded_(true);
    applyInjuriesToPlayers_();
  };

  const renderOverrides = async () => {
    const overrides = await fetchInjuryOverrides();
    const ids = Object.keys(overrides);
    listEl.innerHTML = ids.length === 0
      ? `<p class="mono" style="color:var(--text-dim); font-size:12px;">No manual statuses set.</p>`
      : ids.map(id => {
          const p = allPlayers.find(ap => ap.id === id);
          const o = overrides[id];
          return `<div class="activity-row">
            <span>${escapeHtml(p ? p.fullName : id)} — <span class="ir-badge">${escapeHtml(o.code)}</span>${o.note ? ' ' + escapeHtml(o.note) : ''}</span>
            <button class="admin-btn" data-inj-remove="${escapeHtml(id)}">Remove</button>
          </div>`;
        }).join('');
    listEl.querySelectorAll('[data-inj-remove]').forEach(btn => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        say('Removing...');
        const result = await adminClearInjury(adminPassword, btn.dataset.injRemove);
        say(result.success ? 'Removed - back to the automatic feed.' : (result.error || 'Failed'), !result.success);
        await reloadSite();
        renderOverrides();
      });
    });
  };

  document.getElementById('admin-inj-set-btn').addEventListener('click', async () => {
    if (!playerSel.value) { say('Pick a player first.', true); return; }
    say('Saving...');
    const result = await adminSetInjury(adminPassword, playerSel.value, codeSel.value, noteEl.value.trim(), '');
    say(result.success ? 'Saved.' : (result.error || 'Failed'), !result.success);
    if (result.success) { noteEl.value = ''; playerSel.value = ''; }
    await reloadSite();
    renderOverrides();
  });

  document.getElementById('admin-inj-refresh-btn').addEventListener('click', async () => {
    say('Refreshing from the injury feed...');
    const result = await adminRefreshInjuries(adminPassword);
    say(result.success
      ? `Done - ${result.count} pool player${result.count === 1 ? '' : 's'} listed.${result.feedOk === false ? ' The feed could not be reached, so the last results were kept.' : ''}`
      : (result.error || 'Failed'), !result.success);
    await reloadSite();
  });

  renderOverrides();
}
