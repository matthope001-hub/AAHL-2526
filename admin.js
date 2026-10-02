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
    <div id="admin-pending-moves"></div>
  `;

  loadAdminPendingMoves();

  if (entries.length === 0) {
    el.innerHTML = toggleHtml + `<p class="mono" style="color:var(--text-dim)">No entries yet.</p>`;
    wireAdminCtaToggle_();
    wireAdminAddLateEntryButton_();
    wireAdminCreateLateLinkButton_();
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
