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
      <label>Admin Password</label>
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
  const toggleHtml = `
    <div class="panel" style="margin-bottom:16px; display:flex; align-items:center; justify-content:space-between;">
      <span>Sign Up button on Home page</span>
      <label class="toggle-switch">
        <input type="checkbox" id="admin-toggle-cta" ${ctaVisible ? 'checked' : ''}>
        <span class="toggle-slider"></span>
      </label>
    </div>
    <div class="panel" style="margin-bottom:16px;">
      <button id="admin-add-late-entry-btn" style="margin:0;">+ Add Late Entry</button>
      <span class="mono" style="color:var(--text-dim); font-size:12px; margin-left:10px;">For a late joiner after the public deadline has passed.</span>
    </div>
    <div class="panel" style="margin-bottom:16px;">
      <button id="admin-create-late-link-btn" style="margin:0;">🔗 Create Late Entry Link</button>
      <span class="mono" style="color:var(--text-dim); font-size:12px; margin-left:10px;">Send someone a private link so they can fill in the form themselves. One entry per link, expires in 7 days.</span>
      <div id="admin-late-link-result" style="margin-top:10px;"></div>
    </div>
    <div class="panel" style="margin-bottom:16px;">
      <button id="admin-weekly-image-btn" style="margin:0;">📸 Weekly Standings Image</button>
      <span class="mono" style="color:var(--text-dim); font-size:12px; margin-left:10px;">A ready-to-post picture of last week's standings for the Facebook group.</span>
      <div id="admin-weekly-image-result" style="margin-top:10px;"></div>
    </div>
    <div id="admin-pending-moves"></div>
  `;

  loadAdminPendingMoves();

  if (entries.length === 0) {
    el.innerHTML = toggleHtml + `<p class="mono" style="color:var(--text-dim)">No entries yet.</p>`;
    wireAdminCtaToggle_();
    wireAdminAddLateEntryButton_();
    wireAdminCreateLateLinkButton_();
    wireAdminWeeklyImageButton_();
    return;
  }

  el.innerHTML = toggleHtml + `
    <div id="admin-bulk-bar" style="display:none; margin-bottom:10px; padding:8px 12px; background:var(--bg-panel-alt); align-items:center; justify-content:space-between; gap:10px;">
      <span class="mono" id="admin-bulk-count" style="color:var(--amber);"></span>
      <button class="admin-btn" id="admin-bulk-delete-btn" style="margin:0; border-color:#ff5c5c; color:#ff5c5c;">Delete Selected</button>
    </div>
    <table class="admin-entries-table">
      <thead><tr><th><input type="checkbox" id="admin-select-all"></th><th>Team</th><th>Owner</th><th>Email</th><th>Status</th><th>Paid</th><th>Actions</th></tr></thead>
      <tbody>
        ${entries.map(e => `
          <tr data-entry-id="${e.id}">
            <td data-label="Select"><input type="checkbox" class="admin-row-select" data-id="${e.id}"></td>
            <td data-label="Team">${escapeHtml(e.teamName)}</td>
            <td data-label="Owner">${escapeHtml(e.ownerName)}</td>
            <td class="mono" data-label="Email">${escapeHtml(e.email)}</td>
            <td data-label="Status">${e.approved ? '<span style="color:var(--ice)">Approved</span>' : '<span style="color:var(--amber)">Pending</span>'}</td>
            <td data-label="Paid">${e.paymentReceived ? '<span style="color:var(--ice)">✓ Paid</span>' : '<span style="color:var(--text-dim)">Unpaid</span>'}</td>
            <td data-label="Actions">
              <div class="admin-actions">
                ${!e.approved ? `<button class="admin-btn admin-approve" data-id="${e.id}">Approve</button>` : ''}
                <button class="admin-btn admin-view-picks" data-id="${e.id}">View Picks</button>
                <button class="admin-btn admin-edit-picks" data-id="${e.id}">Edit</button>
                <button class="admin-btn admin-resend-email" data-id="${e.id}">Resend Email</button>
                <button class="admin-btn admin-toggle-paid" data-id="${e.id}" data-paid="${e.paymentReceived ? '1' : '0'}">${e.paymentReceived ? 'Mark Unpaid' : 'Mark Paid'}</button>
                <button class="admin-btn admin-rename" data-id="${e.id}">Rename</button>
                <button class="admin-btn admin-delete" data-id="${e.id}">Delete</button>
              </div>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>
    <div class="mono" style="color:var(--text-dim); font-size:11px; margin-top:8px;">${entries.length} team${entries.length === 1 ? '' : 's'}</div>
  `;

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
}

async function loadAdminPendingMoves() {
  const container = document.getElementById('admin-pending-moves');
  if (!container) return;
  container.innerHTML = `<p class="mono" style="color:var(--text-dim); font-size:13px;">Loading pending moves...</p>`;

  const result = await adminGetPendingMoves(adminPassword);
  if (!result.success || !result.data || result.data.length === 0) {
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
            <button class="admin-btn admin-approve-move" data-id="${m.moveId}">Approve</button>
            <button class="admin-btn admin-reject-move" data-id="${m.moveId}">Reject</button>
          </span>
        </div>
      `).join('')}
    </div>
  `;

  container.querySelectorAll('.admin-approve-move').forEach(btn => {
    btn.addEventListener('click', async () => {
      await adminApproveMove(adminPassword, btn.dataset.id);
      loadAdminPendingMoves();
      loadAdminEntries();
    });
  });

  container.querySelectorAll('.admin-reject-move').forEach(btn => {
    btn.addEventListener('click', async () => {
      await adminRejectMove(adminPassword, btn.dataset.id);
      loadAdminPendingMoves();
    });
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
