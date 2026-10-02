/**
 * signup.js
 * Sign Up form and My Team (roster moves).
 * Plain script (shared global scope with data.js, main.js, stats.js,
 * signup.js, admin.js). Load order in index.html: data.js, stats.js,
 * signup.js, admin.js, main.js (main.js LAST - it calls init()).
 */

// ---------- Signup ----------
let allBoxes = [];
let signupPicks = {}; // { boxId: playerId }
let divisionPicks = {}; // { division: teamAbbrev }
let lastSeasonStandings = {};
let signupFields = { teamName: '', ownerName: '', email: '' };

const DIVISION_TEAMS = {
  Atlantic: [['BOS','Boston Bruins'],['BUF','Buffalo Sabres'],['DET','Detroit Red Wings'],['FLA','Florida Panthers'],['MTL','Montreal Canadiens'],['OTT','Ottawa Senators'],['TBL','Tampa Bay Lightning'],['TOR','Toronto Maple Leafs']],
  Metropolitan: [['CAR','Carolina Hurricanes'],['CBJ','Columbus Blue Jackets'],['NJD','New Jersey Devils'],['NYI','New York Islanders'],['NYR','New York Rangers'],['PHI','Philadelphia Flyers'],['PIT','Pittsburgh Penguins'],['WSH','Washington Capitals']],
  Central: [['CHI','Chicago Blackhawks'],['COL','Colorado Avalanche'],['DAL','Dallas Stars'],['MIN','Minnesota Wild'],['NSH','Nashville Predators'],['STL','St. Louis Blues'],['UTA','Utah Mammoth'],['WPG','Winnipeg Jets']],
  Pacific: [['ANA','Anaheim Ducks'],['CGY','Calgary Flames'],['EDM','Edmonton Oilers'],['LAK','Los Angeles Kings'],['SJS','San Jose Sharks'],['SEA','Seattle Kraken'],['VAN','Vancouver Canucks'],['VGK','Vegas Golden Knights']]
};

let isAdminCreatingEntry = false;

// Set when someone opens a valid late-entry invite link (?late=TOKEN).
// While set, the Sign Up form opens even though picks are locked, and the
// entry is submitted with this token (verified again server-side).
let lateInviteToken = null;

async function renderSignupForm() {
  editingEntryId = null;
  signupPicks = {};
  divisionPicks = {};
  signupFields = { teamName: '', ownerName: '', email: '' };

  // Commissioner adding a late joiner after the public deadline: skip both
  // gates below entirely and go straight to the picking form. The actual
  // enforcement still happens server-side (adminCreateEntry requires the
  // admin password), this is just so the form renders instead of showing
  // the public "locked" screens.
  if (!isAdminCreatingEntry && !lateInviteToken) {
    const deadlinePassed = currentConfig.deadline && new Date() >= new Date(currentConfig.deadline);
    if (currentConfig.picksLocked || deadlinePassed) {
      document.getElementById('signup-form').innerHTML = `
        <div class="panel" style="text-align:center; padding:32px;">
          <h2 style="color:var(--amber); margin-bottom:12px;">Picks Are Locked</h2>
          <p style="color:var(--text-dim); font-size:14px;">The season has started and new entries are no longer being accepted.</p>
        </div>
      `;
      return;
    }

    if (currentConfig.showSignupCta === false) {
      document.getElementById('signup-form').innerHTML = `
        <div class="panel" style="text-align:center; padding:32px;">
          <h2 style="color:var(--amber); margin-bottom:12px;">Sign Ups Are Currently Closed</h2>
          <p style="color:var(--text-dim); font-size:14px;">The commissioner has temporarily closed new entries. Check back soon.</p>
        </div>
      `;
      return;
    }
  }

  await renderSignupFormBody();
}

async function renderSignupFormBody() {
  const el = document.getElementById('signup-form');
  el.innerHTML = `<p class="mono" style="color:var(--text-dim)">Loading boxes...</p>`;

  await Promise.all([ensureBoxesLoaded_(), ensureLastSeasonStandingsLoaded_()]);

  // Entry form always shows LAST season's stats for every player, so
  // picks are compared on a full season - never this season's numbers.
  const seasonHasStats = false;
  const grouped = { F: [], D: [], G: [] };
  allBoxes.forEach(b => grouped[b.boxType].push(b));
  const groupTitles = { F: 'Forwards', D: 'Defense', G: 'Goalies' };

  el.innerHTML = `
    ${isAdminCreatingEntry ? `
      <div style="background:var(--amber); color:#1a1a2e; padding:10px 14px; margin-bottom:16px; font-weight:700; display:flex; justify-content:space-between; align-items:center;">
        <span>⚠️ Admin Mode: Creating a late entry (bypasses the public deadline)</span>
        <button id="admin-cancel-late-entry-btn" style="margin:0; background:#1a1a2e; color:#fff; padding:6px 12px; font-size:12px;">Cancel</button>
      </div>
    ` : ''}
    ${(!isAdminCreatingEntry && lateInviteToken) ? `
      <div style="background:var(--amber); color:#1a1a2e; padding:10px 14px; margin-bottom:16px; font-weight:700;">
        🎟️ Late Entry Invite — you've been invited to join after the deadline. This link works for one entry only.
      </div>
    ` : ''}
    <label>Team Name</label>
    <input type="text" id="f-teamName" value="${escapeHtml(signupFields.teamName)}">
    <div id="team-name-warning" class="status-msg" style="display:none; color:var(--amber);"></div>
    <label>Owner Name</label>
    <input type="text" id="f-ownerName" value="${escapeHtml(signupFields.ownerName)}">
    <label>Email</label>
    <input type="email" id="f-email" value="${escapeHtml(signupFields.email)}">
    <div id="email-validation-msg" class="status-msg" style="display:none; color:#ff5c5c; margin-top:6px; margin-bottom:8px;"></div>
    <div class="picks-count mono" id="picks-count">${Object.keys(signupPicks).length + Object.keys(divisionPicks).length} / ${TOTAL_PICKS} picked</div>

    ${Object.keys(groupTitles).map(type => `
      <h3 class="group-title">${groupTitles[type]}</h3>
      <div class="box-grid">
        ${grouped[type].map(box => `
          <div class="box-picker" id="box-picker-${box.id}">
            <div class="box-picker-label">${escapeHtml(box.boxLabel)}</div>
            <div class="box-picker-options">
              ${[...box.players].map(p => {
                const fullPlayer = allPlayers.find(ap => ap.id === p.playerId);
                // One season for the whole form: once anyone has played this
                // season, everyone shows this season's numbers (0s if their
                // team hasn't played yet) - never a mix of the two seasons.
                const currentSeasonHasStats = seasonHasStats;
                const s = fullPlayer ? (seasonHasStats ? (fullPlayer.stats || {}) : (fullPlayer.prevStats || {})) : {};
                const prevPts = (seasonHasStats && fullPlayer && fullPlayer.prevStats)
                  ? computePlayerPoints({ position: fullPlayer.position, stats: fullPlayer.prevStats }, currentConfig) : 0;
                const ptsNum = fullPlayer ? computePlayerPoints({ position: fullPlayer.position, stats: s }, currentConfig) : 0;
                return { p, fullPlayer, currentSeasonHasStats, s, ptsNum, prevPts };
              }).sort((a, b) => (b.ptsNum - a.ptsNum) || (b.prevPts - a.prevPts)).map(({ p, fullPlayer, currentSeasonHasStats, s, ptsNum, prevPts }) => {
                const currentTeam = fullPlayer ? fullPlayer.team : p.team;
                const headshot = fullPlayer ? fullPlayer.headshotUrl : '';
                const statSourceLabel = currentSeasonHasStats
                  ? (prevPts ? ` <span class="stat-source">(25-26: ${prevPts.toFixed(1)})</span>` : '')
                  : ` <span class="stat-source">(25-26)</span>`;
                const pts = ptsNum.toFixed(1);
                const statLine = box.boxType === 'G'
                  ? `${gpPrefix_(s, ' · ')}${s.wins || 0}W · ${s.shutouts || 0}SO · ${pts}pts${statSourceLabel}`
                  : `${gpPrefix_(s, ' · ')}${s.goals || 0}G · ${s.assists || 0}A${s.hatTricks ? ` · ${s.hatTricks}HT` : ''} · ${pts}pts${statSourceLabel}`;
                const cardStats = box.boxType === 'G'
                  ? `${gpPrefix_(s, ' &middot; ')}${s.wins || 0}W ${s.losses || 0}L ${s.otl || 0}OTL &middot; ${s.shutouts || 0} SO &middot; ${s.saves || 0} SV`
                  : `${gpPrefix_(s, ' &middot; ')}${s.goals || 0}G ${s.assists || 0}A ${s.sog || 0}SOG${box.boxType === 'D' ? ` ${s.pim || 0}PIM` : ''}${s.hatTricks ? ` &middot; ${s.hatTricks} HT` : ''}`;
                return `
                <label class="box-option ${signupPicks[box.id] === p.playerId ? 'box-option-current' : ''}">
                  <input type="radio" name="box-${box.id}" value="${p.playerId}" data-box="${box.id}" ${signupPicks[box.id] === p.playerId ? 'checked' : ''}>
                  <span class="box-option-photo-wrap">
                    ${headshot ? `<a class="player-nhl-link" href="${nhlProfileUrl(p.name, p.playerId)}" target="_blank" rel="noopener"><img class="box-option-photo" src="${headshot}" alt="" loading="lazy"></a>` : `<div class="box-option-photo box-option-photo-empty"></div>`}
                    ${headshot ? `
                    <div class="player-hover-card">
                      <img class="player-hover-photo" src="${headshot}" alt="" loading="lazy">
                      <div class="player-hover-name">${escapeHtml(p.name)}${fullPlayer && fullPlayer.injuryStatus ? ' <span class="ir-badge">🩹</span>' : ''}</div>
                      <div class="player-hover-team mono">${escapeHtml(currentTeam)} ${currentSeasonHasStats ? '· 26-27' : '· 25-26 (last season)'}</div>
                      ${fullPlayer && fullPlayer.injuryStatus ? `<div class="mono" style="color:#ff5c5c; font-size:12px; margin-bottom:6px;">Injured: ${escapeHtml(fullPlayer.injuryStatus)}</div>` : ''}
                      <div class="player-hover-stats mono">${cardStats}</div>
                      <div class="player-hover-pts mono">${pts} pts</div>
                    </div>` : ''}
                  </span>
                  <span class="box-option-name">${escapeHtml(p.name)}${fullPlayer && fullPlayer.injuryStatus ? ` <span class="ir-badge" title="Injured: ${escapeHtml(fullPlayer.injuryStatus)}">🩹</span>` : ''}</span>
                  <span class="mono box-option-stats">${statLine}</span>
                  <span class="mono box-option-meta">${escapeHtml(currentTeam)}</span>
                </label>
              `;}).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `).join('')}

    <h3 class="group-title">Division Winner Picks <span style="color:var(--text-dim); font-weight:400; text-transform:none; font-size:14px;">(+25 pts bonus each, awarded at season end)</span></h3>
    <div class="box-grid">
      ${DIVISIONS.map(division => {
        const teams = [...DIVISION_TEAMS[division]].sort((a, b) => {
          const ra = (lastSeasonStandings[a[0]] || {}).rank ?? 99;
          const rb = (lastSeasonStandings[b[0]] || {}).rank ?? 99;
          return ra - rb;
        });
        return `
        <div class="box-picker" id="division-picker-${division}">
          <div class="box-picker-label">${escapeHtml(division)}</div>
          <div class="box-picker-options">
            ${teams.map(([abbrev, fullName]) => {
              const record = lastSeasonStandings[abbrev];
              const refLabel = record ? `${record.points}pts (${ordinal(record.rank)}, 25-26)` : '';
              return `
              <label class="box-option">
                <input type="radio" name="division-${division}" value="${abbrev}" data-division="${division}" ${divisionPicks[division] === abbrev ? 'checked' : ''}>
                <img class="team-logo" src="https://assets.nhle.com/logos/nhl/svg/${abbrev}_light.svg" alt="" loading="lazy" onerror="this.style.display='none'">
                <span class="box-option-name">${escapeHtml(fullName)}</span>
                <span class="mono box-option-stats">${escapeHtml(refLabel)}</span>
                <span class="mono box-option-meta">${escapeHtml(abbrev)}</span>
              </label>
            `;}).join('')}
          </div>
        </div>
      `;}).join('')}
    </div>

    <button id="submit-entry-btn">Submit Entry</button>
    <div id="signup-status" class="status-msg"></div>
  `;

  el.querySelectorAll('input[type="radio"][name^="box-"]').forEach(radio => {
    radio.addEventListener('change', () => {
      signupPicks[radio.dataset.box] = radio.value;
      updatePicksCount();
      const boxEl = document.getElementById(`box-picker-${radio.dataset.box}`);
      if (boxEl) {
        boxEl.classList.remove('box-missing');
        boxEl.querySelectorAll('.box-option').forEach(label => label.classList.remove('box-option-current'));
      }
      radio.closest('.box-option').classList.add('box-option-current');
    });
  });

  el.querySelectorAll('input[type="radio"][name^="division-"]').forEach(radio => {
    radio.addEventListener('change', () => {
      divisionPicks[radio.dataset.division] = radio.value;
      updatePicksCount();
    });
  });

  el.querySelectorAll('.player-nhl-link').forEach(link => {
    link.addEventListener('click', (e) => e.stopPropagation());
  });

  document.getElementById('submit-entry-btn').addEventListener('click', handleSubmitEntry);

  if (isAdminCreatingEntry) {
    document.getElementById('admin-cancel-late-entry-btn').addEventListener('click', () => {
      isAdminCreatingEntry = false;
      document.querySelector('.nav-link[data-view="admin"]').click();
    });
  }

  document.getElementById('f-teamName').addEventListener('input', (e) => {
    const warningEl = document.getElementById('team-name-warning');
    const typed = e.target.value.trim().toLowerCase();
    const isDuplicate = typed.length > 0 && allStandings.some(s => (s.teamName || '').trim().toLowerCase() === typed);
    if (isDuplicate) {
      warningEl.textContent = `⚠️ "${e.target.value.trim()}" is already taken by another team. You can still use it, but consider something unique so it's easy to tell apart on Standings.`;
      warningEl.style.display = 'block';
    } else {
      warningEl.style.display = 'none';
    }
  });

  document.getElementById('f-email').addEventListener('input', (e) => {
    validateEmailField_(e.target.value.trim());
  });

  updateJumpToMissingButton_(Object.keys(signupPicks).length + Object.keys(divisionPicks).length);
}

/**
 * Live email format check, shown right at the field itself. Returns true
 * if valid (or empty - emptiness is caught separately by the required
 * fields check on submit, not flagged as a format error here).
 */
function validateEmailField_(email) {
  const msgEl = document.getElementById('email-validation-msg');
  const inputEl = document.getElementById('f-email');
  if (!msgEl || !inputEl) return true;

  if (email.length === 0) {
    msgEl.style.display = 'none';
    inputEl.style.borderColor = '';
    return true;
  }

  const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (isValid) {
    msgEl.style.display = 'none';
    inputEl.style.borderColor = '';
  } else {
    msgEl.textContent = "That doesn't look like a valid email — double check it so your confirmation actually arrives.";
    msgEl.style.display = 'block';
    inputEl.style.borderColor = '#ff5c5c';
  }
  return isValid;
}

function updatePicksCount() {
  const countEl = document.getElementById('picks-count');
  const count = Object.keys(signupPicks).length + Object.keys(divisionPicks).length;
  countEl.textContent = `${count} / ${TOTAL_PICKS} picked`;
  countEl.style.color = count === TOTAL_PICKS ? 'var(--ice)' : 'var(--text-dim)';
  updateJumpToMissingButton_(count);
}

/**
 * Floating button, always visible while scrolling the long Sign Up page.
 * Shows remaining pick count and scrolls to the first incomplete box or
 * division on click - addresses the picks-count element scrolling out of
 * view, and having to hunt for whichever box you skipped.
 */
function updateJumpToMissingButton_(count) {
  let btn = document.getElementById('jump-to-missing-btn');
  const remaining = TOTAL_PICKS - count;

  if (remaining <= 0) {
    if (btn) btn.remove();
    return;
  }

  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'jump-to-missing-btn';
    btn.className = 'jump-to-missing-btn';
    btn.addEventListener('click', jumpToNextMissingPick_);
    document.body.appendChild(btn);
  }
  btn.textContent = `${remaining} left — jump to next ↓`;
}

function jumpToNextMissingPick_() {
  const missingBox = allBoxes.find(b => !signupPicks[b.id]);
  if (missingBox) {
    const target = document.getElementById(`box-picker-${missingBox.id}`);
    if (target) { target.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
  }
  const missingDivision = DIVISIONS.find(d => !divisionPicks[d]);
  if (missingDivision) {
    const target = document.getElementById(`division-picker-${missingDivision}`);
    if (target) target.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

async function handleSubmitEntry() {
  const teamName = document.getElementById('f-teamName').value.trim();
  const ownerName = document.getElementById('f-ownerName').value.trim();
  const email = document.getElementById('f-email').value.trim();
  const statusEl = document.getElementById('signup-status');

  if (!teamName || !ownerName || !email) {
    statusEl.textContent = 'Fill in team name, owner name, and email.';
    statusEl.className = 'status-msg error';
    return;
  }

  if (!validateEmailField_(email)) {
    document.getElementById('f-email').scrollIntoView({ behavior: 'smooth', block: 'center' });
    document.getElementById('f-email').focus();
    return;
  }

  document.querySelectorAll('.box-picker').forEach(el => el.classList.remove('box-missing'));

  if (Object.keys(signupPicks).length !== TOTAL_BOXES) {
    const missingBoxes = allBoxes.filter(b => !signupPicks[b.id]);
    missingBoxes.forEach(b => {
      const el = document.getElementById(`box-picker-${b.id}`);
      if (el) el.classList.add('box-missing');
    });

    const labels = missingBoxes.map(b => b.boxLabel);
    statusEl.textContent = labels.length <= 4
      ? `Missing pick: ${labels.join(', ')}`
      : `Missing ${labels.length} picks: ${labels.slice(0, 4).join(', ')}, +${labels.length - 4} more`;
    statusEl.className = 'status-msg error';

    const firstMissing = document.getElementById(`box-picker-${missingBoxes[0].id}`);
    if (firstMissing) firstMissing.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  for (const division of DIVISIONS) {
    if (!divisionPicks[division]) {
      statusEl.textContent = `Pick a division winner for ${division}.`;
      statusEl.className = 'status-msg error';
      return;
    }
  }

  signupFields = { teamName, ownerName, email };
  renderSignupConfirmStep();
}

function renderSignupConfirmStep() {
  const el = document.getElementById('signup-form');
  const groupTitles = { F: 'Forwards', D: 'Defense', G: 'Goalies' };
  const grouped = { F: [], D: [], G: [] };

  Object.keys(signupPicks).forEach(boxId => {
    const box = allBoxes.find(b => String(b.id) === String(boxId));
    if (!box) return;
    const boxPlayer = (box.players || []).find(p => p.playerId === signupPicks[boxId]);
    const fullPlayer = allPlayers.find(ap => ap.id === signupPicks[boxId]);
    grouped[box.boxType].push({
      boxLabel: box.boxLabel,
      name: boxPlayer ? boxPlayer.name : signupPicks[boxId],
      team: fullPlayer ? fullPlayer.team : (boxPlayer ? boxPlayer.team : '')
    });
  });

  const divisionRows = DIVISIONS.map(division => {
    const abbrev = divisionPicks[division];
    const teamEntry = DIVISION_TEAMS[division].find(t => t[0] === abbrev);
    return `<div class="activity-row"><span>${escapeHtml(division)}</span><span class="mono" style="display:flex; align-items:center; gap:6px; justify-content:flex-end;"><img class="team-logo" src="https://assets.nhle.com/logos/nhl/svg/${abbrev}_light.svg" alt="" loading="lazy" onerror="this.style.display='none'">${escapeHtml(teamEntry ? teamEntry[1] : abbrev)}</span></div>`;
  }).join('');

  el.innerHTML = `
    <h2 style="margin-bottom:4px;">${editingEntryId ? 'Review Changes' : 'Review Your Team'}</h2>
    <p style="color:var(--text-dim); font-size:14px; margin-bottom:16px;">${editingEntryId ? "Double-check everything below, then save." : "Double-check everything below. Once confirmed, you'll get an email copy of your picks and payment instructions."}</p>

    <div class="panel" style="margin-bottom:16px;">
      <div class="activity-row"><span>Team Name</span><span class="mono">${escapeHtml(signupFields.teamName)}</span></div>
      <div class="activity-row"><span>Owner Name</span><span class="mono">${escapeHtml(signupFields.ownerName)}</span></div>
      <div class="activity-row"><span>Email</span><span class="mono">${escapeHtml(signupFields.email)}</span></div>
    </div>

    ${Object.keys(groupTitles).map(type => `
      <h3 class="group-title">${groupTitles[type]}</h3>
      <div class="modal-pick-list">
        ${grouped[type].map(p => `
          <div class="modal-pick-row">
            <span class="modal-pick-name">${escapeHtml(p.name)}</span>
            <span class="mono modal-pick-meta">${escapeHtml(p.team)}</span>
          </div>
        `).join('')}
      </div>
    `).join('')}

    <h3 class="group-title">Division Winner Picks</h3>
    <div class="panel">${divisionRows}</div>

    <div style="display:flex; gap:10px; margin-top:20px;">
      <button id="confirm-back-btn" style="background:var(--bg-panel-alt); color:var(--text);">Back to Edit</button>
      <button id="confirm-submit-btn">${editingEntryId ? 'Save Changes' : 'Confirm & Submit'}</button>
    </div>
    <div id="signup-status" class="status-msg"></div>
  `;

  document.getElementById('confirm-back-btn').addEventListener('click', renderSignupFormBody);
  document.getElementById('confirm-submit-btn').addEventListener('click', doFinalSubmit);
}

async function doFinalSubmit() {
  const statusEl = document.getElementById('signup-status');
  statusEl.textContent = editingEntryId ? 'Saving...' : 'Submitting...';
  statusEl.className = 'status-msg';

  if (editingEntryId) {
    const result = await adminUpdateEntry(adminPassword, editingEntryId, {
      teamName: signupFields.teamName,
      ownerName: signupFields.ownerName,
      email: signupFields.email,
      picks: signupPicks,
      divisionPicks: divisionPicks
    });

    if (result.success) {
      const savedId = editingEntryId;
      editingEntryId = null;
      document.getElementById('signup-form').innerHTML = `
        <div class="panel" style="text-align:center; padding:32px;">
          <h2 style="color:var(--ice); margin-bottom:12px;">Changes saved</h2>
          <p style="color:var(--text-dim); font-size:14px;">Entry ID: <span class="mono">${escapeHtml(savedId)}</span></p>
        </div>
      `;
    } else {
      statusEl.textContent = 'Error: ' + result.error;
      statusEl.className = 'status-msg error';
    }
    return;
  }

  const entryPayload = {
    teamName: signupFields.teamName,
    ownerName: signupFields.ownerName,
    email: signupFields.email,
    picks: signupPicks,
    divisionPicks: divisionPicks
  };

  const usedLateInvite = !isAdminCreatingEntry && !!lateInviteToken;
  const result = isAdminCreatingEntry
    ? await adminCreateEntry(adminPassword, entryPayload)
    : (lateInviteToken
        ? await submitLateEntry(entryPayload, lateInviteToken)
        : await submitEntry(entryPayload));

  if (result.success) {
    if (usedLateInvite) {
      // One link = one entry. Clear it and tidy the address bar so a
      // refresh doesn't try to reuse a link that's now spent.
      lateInviteToken = null;
      try { window.history.replaceState({}, '', window.location.pathname); } catch (e) { /* ignore */ }
      applySignupCtaVisibility();
    }
    if (isAdminCreatingEntry) {
      isAdminCreatingEntry = false;
      document.getElementById('signup-form').innerHTML = `
        <div class="panel" style="text-align:center; padding:32px;">
          <h2 style="color:var(--ice); margin-bottom:12px;">Entry created</h2>
          <p style="margin-bottom:8px;">Entry ID: <span class="mono">${escapeHtml(result.entryId)}</span></p>
          <p style="color:var(--text-dim); font-size:14px;">Their confirmation email is on its way to ${escapeHtml(signupFields.email)}.</p>
          <button id="admin-back-to-panel-btn" style="margin-top:16px;">Back to Admin</button>
        </div>
      `;
      document.getElementById('admin-back-to-panel-btn').addEventListener('click', () => {
        document.querySelector('.nav-link[data-view="admin"]').click();
      });
    } else {
      document.getElementById('signup-form').innerHTML = `
        <div class="panel" style="text-align:center; padding:32px;">
          <h2 style="color:var(--ice); margin-bottom:12px;">You're in!</h2>
          <p style="margin-bottom:8px;">Entry ID: <span class="mono">${escapeHtml(result.entryId)}</span></p>
          <p style="color:var(--text-dim); font-size:14px;">A confirmation email with your picks and payment instructions is on its way to ${escapeHtml(signupFields.email)}.</p>
          <p style="color:var(--text-dim); font-size:13px; margin-top:12px;">Don't see it in a few minutes? Check your spam/junk folder.</p>
        </div>
      `;
    }
  } else {
    statusEl.textContent = 'Error: ' + result.error;
    statusEl.className = 'status-msg error';
  }
}


// ---------- My Team (Roster Moves) ----------
let myTeamEntry = null;

function renderManageMoves() {
  const el = document.getElementById('managemoves-content');
  el.innerHTML = `
    <div class="panel" style="margin-bottom:16px;">
      <p style="color:var(--text-dim); font-size:14px; margin-bottom:14px;">Look up your team using the Entry ID and email from your confirmation email. Before the season starts, you can change your picks freely at no cost. Once the season begins, you get 2 roster moves total, each needing commissioner approval before it counts, and all moves must be requested before the NHL trade deadline (March 1, 2027).</p>
      <label>Entry ID</label>
      <input type="text" id="moves-entryid-input" placeholder="From your confirmation email">
      <label>Email</label>
      <input type="email" id="moves-email-input">
      <button id="moves-lookup-btn">Find My Team</button>
      <div id="moves-lookup-status" class="status-msg"></div>
    </div>
    <div id="moves-team-panel"></div>
  `;

  document.getElementById('moves-lookup-btn').addEventListener('click', async () => {
    const entryId = document.getElementById('moves-entryid-input').value.trim();
    const email = document.getElementById('moves-email-input').value.trim();
    const statusEl = document.getElementById('moves-lookup-status');

    if (!entryId || !email) {
      statusEl.textContent = 'Enter both your Entry ID and email.';
      statusEl.className = 'status-msg error';
      return;
    }

    statusEl.textContent = 'Looking up...';
    statusEl.className = 'status-msg';

    const result = await findEntryForMoves(entryId, email);
    if (result.success) {
      statusEl.textContent = '';
      myTeamEntry = result.data;
      renderMyTeamMovesPanel();
    } else {
      statusEl.textContent = result.error || 'Not found';
      statusEl.className = 'status-msg error';
    }
  });
}

let stagedMoves = {}; // boxId -> { oldPlayerId, newPlayerId }
let stagedDivisionChanges = {}; // division -> { oldTeam, newTeam }

function renderMyTeamMovesPanel() {
  const el = document.getElementById('moves-team-panel');
  if (!myTeamEntry) return;
  stagedMoves = {};
  stagedDivisionChanges = {};

  const boxById = {};
  allBoxes.forEach(b => { boxById[b.id] = b; });

  el.innerHTML = `
    <h3 style="margin-bottom:4px;">${escapeHtml(myTeamEntry.teamName)}</h3>
    <p class="mono" style="color:var(--ice); margin-bottom:16px;">${myTeamEntry.movesRemaining} move${myTeamEntry.movesRemaining === 1 ? '' : 's'} remaining</p>

    ${myTeamEntry.moveHistory.length > 0 ? `
      <h4 class="group-title">Move History</h4>
      <div class="panel" style="margin-bottom:16px;">
        ${myTeamEntry.moveHistory.map(m => {
          const box = boxById[m.boxId];
          const outP = allPlayers.find(p => p.id === m.outPlayerId);
          const inP = allPlayers.find(p => p.id === m.inPlayerId);
          const statusColor = m.status === 'approved' ? 'var(--ice)' : (m.status === 'rejected' ? '#ff5c5c' : 'var(--amber)');
          return `<div class="activity-row">
            <span>${escapeHtml(box ? box.boxLabel : m.boxId)}: ${escapeHtml(outP ? outP.fullName : m.outPlayerId)} → ${escapeHtml(inP ? inP.fullName : m.inPlayerId)}</span>
            <span class="mono" style="color:${statusColor}; text-transform:capitalize;">${escapeHtml(m.status)}</span>
          </div>`;
        }).join('')}
      </div>
    ` : ''}

    ${!myTeamEntry.seasonStarted ? `
      <h4 class="group-title">Division Winner Picks <span style="color:var(--text-dim); font-weight:400; text-transform:none; font-size:14px;">(free to change until the season starts, then these lock permanently)</span></h4>
      <div class="box-grid" id="my-team-division-grid"></div>
    ` : ''}

    ${myTeamEntry.movesRemaining > 0 ? `
      <h4 class="group-title">Request Moves <span style="color:var(--text-dim); font-weight:400; text-transform:none; font-size:14px;">(pick as many box changes as you want, then submit together at the bottom)</span></h4>
      <div class="box-grid" id="my-team-box-grid"></div>
    ` : `<p class="mono" style="color:var(--text-dim);">No moves remaining.</p>`}

    <div id="unified-changes-summary" style="margin-top:24px;"></div>
  `;

  if (!myTeamEntry.seasonStarted) {
    renderMyTeamDivisionPicker();
  }

  if (myTeamEntry.movesRemaining > 0) {
    renderMyTeamBoxPicker();
  }

  renderUnifiedChangesSummary_();
}

function renderMyTeamBoxPicker() {
  const grid = document.getElementById('my-team-box-grid');
  const boxById = {};
  allBoxes.forEach(b => { boxById[b.id] = b; });

  grid.innerHTML = REQUIRED_BOX_IDS.map(boxId => {
    const box = boxById[boxId];
    if (!box) return '';
    const currentPlayerId = myTeamEntry.picks[boxId];
    const stagedId = stagedMoves[boxId] ? stagedMoves[boxId].newPlayerId : currentPlayerId;

    return `
      <div class="box-picker">
        <div class="box-picker-label">${escapeHtml(box.boxLabel)}</div>
        <div class="box-picker-options">
          ${box.players.map(p => {
            const isCurrent = p.playerId === currentPlayerId;
            const isSelected = p.playerId === stagedId;
            return `
            <label class="box-option ${isCurrent ? 'box-option-current' : ''}">
              <input type="radio" name="move-target-${boxId}" data-box="${boxId}" value="${p.playerId}" ${isSelected ? 'checked' : ''}>
              <span class="box-option-name">${escapeHtml(p.name)}${isCurrent ? ' <span class="mono" style="color:var(--ice); font-size:11px;">(current)</span>' : ''}</span>
              <span class="mono box-option-meta">${escapeHtml(p.team)}</span>
            </label>
          `;}).join('')}
        </div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('input[type="radio"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const boxId = radio.dataset.box;
      const currentPlayerId = myTeamEntry.picks[boxId];
      if (radio.value === currentPlayerId) {
        delete stagedMoves[boxId]; // reverted back to their original pick
      } else {
        stagedMoves[boxId] = { oldPlayerId: currentPlayerId, newPlayerId: radio.value };
      }
      renderUnifiedChangesSummary_();
    });
  });
}

function renderMyTeamDivisionPicker() {
  const grid = document.getElementById('my-team-division-grid');
  if (!grid) return;

  grid.innerHTML = DIVISIONS.map(division => {
    const currentAbbrev = myTeamEntry.divisionPicks[division];
    const stagedAbbrev = stagedDivisionChanges[division] ? stagedDivisionChanges[division].newTeam : currentAbbrev;

    return `
      <div class="box-picker">
        <div class="box-picker-label">${escapeHtml(division)}</div>
        <div class="box-picker-options">
          ${DIVISION_TEAMS[division].map(([abbrev, fullName]) => {
            const isCurrent = abbrev === currentAbbrev;
            const isSelected = abbrev === stagedAbbrev;
            return `
            <label class="box-option ${isCurrent ? 'box-option-current' : ''}">
              <input type="radio" name="division-target-${division}" data-division="${division}" value="${abbrev}" ${isSelected ? 'checked' : ''}>
              <img class="team-logo" src="https://assets.nhle.com/logos/nhl/svg/${abbrev}_light.svg" alt="" loading="lazy" onerror="this.style.display='none'">
              <span class="box-option-name">${escapeHtml(fullName)}${isCurrent ? ' <span class="mono" style="color:var(--ice); font-size:11px;">(current)</span>' : ''}</span>
              <span class="mono box-option-meta">${escapeHtml(abbrev)}</span>
            </label>
          `;}).join('')}
        </div>
      </div>
    `;
  }).join('');

  grid.querySelectorAll('input[type="radio"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const division = radio.dataset.division;
      const currentAbbrev = myTeamEntry.divisionPicks[division];
      if (radio.value === currentAbbrev) {
        delete stagedDivisionChanges[division];
      } else {
        stagedDivisionChanges[division] = { oldTeam: currentAbbrev, newTeam: radio.value };
      }
      renderUnifiedChangesSummary_();
    });
  });
}

/**
 * ONE combined summary of every staged change (box moves + division picks
 * together) with a single submit button, placed at the bottom of the page
 * so it reads naturally as "review everything, then submit."
 */
function renderUnifiedChangesSummary_() {
  const el = document.getElementById('unified-changes-summary');
  if (!el) return;

  const boxById = {};
  allBoxes.forEach(b => { boxById[b.id] = b; });

  const stagedBoxIds = Object.keys(stagedMoves);
  const stagedDivisions = Object.keys(stagedDivisionChanges);
  const totalStaged = stagedBoxIds.length + stagedDivisions.length;

  if (totalStaged === 0) {
    el.innerHTML = '';
    return;
  }

  const seasonStarted = currentConfig.seasonStartDate && new Date() >= new Date(currentConfig.seasonStartDate);
  const overLimit = seasonStarted && stagedBoxIds.length > myTeamEntry.movesRemaining;

  el.innerHTML = `
    <div class="panel" style="border-color:var(--amber);">
      <h4 style="margin-bottom:10px; color:var(--amber);">Review Your Changes (${totalStaged})</h4>
      ${stagedBoxIds.map(boxId => {
        const box = boxById[boxId];
        const move = stagedMoves[boxId];
        const oldOption = (box.players || []).find(p => p.playerId === move.oldPlayerId);
        const newOption = (box.players || []).find(p => p.playerId === move.newPlayerId);
        return `
          <div class="activity-row">
            <span><strong>${escapeHtml(box.boxLabel)}:</strong> ${escapeHtml(oldOption ? oldOption.name : move.oldPlayerId)} → ${escapeHtml(newOption ? newOption.name : move.newPlayerId)}</span>
            <button class="admin-btn" data-remove-box="${boxId}">Remove</button>
          </div>
        `;
      }).join('')}
      ${stagedDivisions.map(division => {
        const change = stagedDivisionChanges[division];
        const oldTeam = DIVISION_TEAMS[division].find(t => t[0] === change.oldTeam);
        const newTeam = DIVISION_TEAMS[division].find(t => t[0] === change.newTeam);
        return `
          <div class="activity-row">
            <span><strong>${escapeHtml(division)}:</strong> ${escapeHtml(oldTeam ? oldTeam[1] : change.oldTeam)} → ${escapeHtml(newTeam ? newTeam[1] : change.newTeam)}</span>
            <button class="admin-btn" data-remove-division="${division}">Remove</button>
          </div>
        `;
      }).join('')}
      ${overLimit ? `<p class="status-msg error" style="margin-top:10px;">You only have ${myTeamEntry.movesRemaining} move${myTeamEntry.movesRemaining === 1 ? '' : 's'} remaining - remove ${stagedBoxIds.length - myTeamEntry.movesRemaining} player change${stagedBoxIds.length - myTeamEntry.movesRemaining === 1 ? '' : 's'} before submitting.</p>` : ''}
      <button id="submit-all-changes-btn" ${overLimit ? 'disabled' : ''} style="margin-top:12px;">Submit ${totalStaged} Change${totalStaged === 1 ? '' : 's'}</button>
      <div id="unified-changes-status" class="status-msg"></div>
    </div>
  `;

  el.querySelectorAll('[data-remove-box]').forEach(btn => {
    btn.addEventListener('click', () => {
      const boxId = btn.dataset.removeBox;
      delete stagedMoves[boxId];
      const currentPlayerId = myTeamEntry.picks[boxId];
      const radio = document.querySelector(`input[name="move-target-${boxId}"][value="${currentPlayerId}"]`);
      if (radio) radio.checked = true;
      renderUnifiedChangesSummary_();
    });
  });

  el.querySelectorAll('[data-remove-division]').forEach(btn => {
    btn.addEventListener('click', () => {
      const division = btn.dataset.removeDivision;
      delete stagedDivisionChanges[division];
      const currentAbbrev = myTeamEntry.divisionPicks[division];
      const radio = document.querySelector(`input[name="division-target-${division}"][value="${currentAbbrev}"]`);
      if (radio) radio.checked = true;
      renderUnifiedChangesSummary_();
    });
  });

  if (!overLimit) {
    document.getElementById('submit-all-changes-btn').addEventListener('click', submitAllUnifiedChanges_);
  }
}

async function submitAllUnifiedChanges_() {
  const entryId = document.getElementById('moves-entryid-input').value.trim();
  const email = document.getElementById('moves-email-input').value.trim();
  const boxIds = Object.keys(stagedMoves);
  const divisions = Object.keys(stagedDivisionChanges);
  const totalStaged = boxIds.length + divisions.length;

  const btn = document.getElementById('submit-all-changes-btn');
  const statusEl = document.getElementById('unified-changes-status');
  btn.disabled = true;
  btn.textContent = 'Submitting...';
  if (statusEl) statusEl.textContent = `Submitting ${totalStaged} change${totalStaged === 1 ? '' : 's'}...`;

  try {
    const boxChanges = boxIds.map(boxId => ({ boxId, newPlayerId: stagedMoves[boxId].newPlayerId }));
    const divisionChanges = divisions.map(division => ({ division, newTeamAbbrev: stagedDivisionChanges[division].newTeam }));

    // One round trip does everything: applies all changes, writes the entry
    // once, recomputes standings once, and sends one confirmation email -
    // instead of a separate round trip (and full recompute) per change.
    const result = await submitBatchTeamChanges(entryId, email, boxChanges, divisionChanges);

    if (statusEl) statusEl.textContent = 'Refreshing your team...';
    const refreshed = await findEntryForMoves(entryId, email);
    if (refreshed.success) myTeamEntry = refreshed.data;
    renderMyTeamMovesPanel();

    if (!result.success && result.errors && result.errors.length > 0) {
      alert('Some changes could not be submitted:\n\n' + result.errors.join('\n'));
    } else if (result.error) {
      alert('Error: ' + result.error);
    } else {
      alert('Changes submitted!');
    }
  } catch (err) {
    console.error('submitAllUnifiedChanges_ failed:', err);
    if (statusEl) { statusEl.textContent = 'Something went wrong: ' + err.message; statusEl.className = 'status-msg error'; }
    btn.disabled = false;
    btn.textContent = `Submit ${totalStaged} Change${totalStaged === 1 ? '' : 's'}`;
    alert('Something went wrong submitting your changes. Please try again.\n\n' + err.message);
  }
}
