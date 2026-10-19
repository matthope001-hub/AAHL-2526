/**
 * auth.js - optional sign-in (Supabase Auth) for the My Team page.
 *
 * Sign in with Google, Microsoft, Facebook or an emailed link and the page
 * lists every team on that email (plus any linked accounts' emails). Picking
 * a team runs the normal Entry ID + email lookup, so roster moves / division
 * changes work exactly as before. Signing in is never required - the Entry
 * ID + email lookup is still right underneath.
 *
 * The Worker (myEntries) checks the sign-in with Supabase and only returns
 * teams for verified emails.
 */
(function () {
  const PROVIDERS = [
    { id: 'google',   label: 'Google',             icon: 'G', bg: '#ffffff', fg: '#000000' },
    { id: 'azure',    label: 'Hotmail / Outlook',  icon: 'M', bg: '#00a4ef', fg: '#ffffff' },
    { id: 'facebook', label: 'Facebook',           icon: 'f', bg: '#1877f2', fg: '#ffffff' },
    { id: 'custom:yahoo', label: 'Yahoo',          icon: 'Y', bg: '#6001d2', fg: '#ffffff' }
  ];
  const PROVIDER_NAMES = { google: 'Google', azure: 'Microsoft', facebook: 'Facebook', 'custom:yahoo': 'Yahoo', email: 'Email link' };
  const RETURN_FLAG = 'aahl_auth_return';

  let client = null;
  let session = null;
  let teams = null;      // [{ entryId, teamName, email }]
  let identities = [];   // [{ provider, email }]
  let loadingTeams = false;
  let statusMsg = '';
  let autoOpened = false;

  // ---------- styles (kept here so style.css doesn't change) ----------
  const css = `
  .auth-panel { margin-bottom: 16px; }
  .auth-panel .auth-head { display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap; }
  .auth-panel .auth-title { font-size:20px; font-weight:700; letter-spacing:1px; }
  .auth-panel .auth-sub { color:var(--text-dim); font-size:14px; margin:4px 0 10px; }
  .auth-btn { display:flex; align-items:center; gap:12px; width:100%; margin-top:8px; padding:10px 14px;
    background:var(--bg-panel-alt); color:var(--text); border:1px solid var(--border); text-transform:none; font-weight:600; text-align:left; }
  .auth-btn:hover { border-color:var(--ice); opacity:1; }
  .auth-ic { width:24px; height:24px; border-radius:50%; display:grid; place-items:center; font:700 13px var(--font-mono); flex-shrink:0; }
  .auth-or { text-align:center; color:var(--text-dim); font-size:13px; margin:12px 0 2px; }
  .auth-link-btn { background:none; border:1px solid var(--border); color:var(--text-dim); padding:5px 12px; margin:0; font-size:13px; }
  .auth-link-btn:hover { color:var(--ice); border-color:var(--ice); opacity:1; }
  .auth-team { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:12px 14px; margin-top:8px;
    background:var(--bg-panel-alt); border:1px solid var(--border); cursor:pointer; }
  .auth-team:hover { border-color:var(--ice); }
  .auth-team .t-name { font-size:19px; font-weight:700; }
  .auth-team .t-meta { font:12px var(--font-mono); color:var(--text-dim); }
  .auth-team .t-go { color:var(--ice); font:13px var(--font-mono); white-space:nowrap; }
  .auth-team.active { border-color:var(--ice); }
  .auth-ids { margin-top:14px; border-top:1px solid var(--border); padding-top:10px; }
  .auth-ids .row { display:flex; justify-content:space-between; font:12px var(--font-mono); color:var(--text-dim); margin:4px 0; }
  .auth-linkrow { display:flex; gap:6px; flex-wrap:wrap; margin-top:6px; }
  .header-auth-btn { margin:0; padding:7px 16px; background:transparent; color:var(--ice); border:1px solid var(--ice);
    font-size:14px; letter-spacing:1px; flex-shrink:0; white-space:nowrap; max-width:200px; overflow:hidden; text-overflow:ellipsis; }
  .header-auth-btn:hover { background:var(--ice); color:#fff; opacity:1; }
  .header-auth-btn.signed-in { text-transform:none; letter-spacing:0; font-weight:600; }
  @media (max-width: 640px) {
    .header-auth-btn { position:absolute; top:10px; right:16px; padding:5px 12px; font-size:13px; max-width:150px; }
  }
  `;
  const styleEl = document.createElement('style');
  styleEl.textContent = css;
  document.head.appendChild(styleEl);

  // ---------- helpers ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function returnUrl() { return location.origin + '/'; }

  function waitForSupabase(ms) {
    return new Promise(resolve => {
      const start = Date.now();
      (function check() {
        if (typeof supabase !== 'undefined' && supabase && supabase.createClient) return resolve(true);
        if (Date.now() - start > ms) return resolve(false);
        setTimeout(check, 100);
      })();
    });
  }

  async function getClient() {
    if (client) return client;
    if (!(await waitForSupabase(8000))) return null;
    client = supabase.createClient(SUPABASE_DIRECT_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'aahl-auth' }
    });
    client.auth.onAuthStateChange((event, s) => {
      const changed = (s && s.access_token) !== (session && session.access_token);
      session = s;
      if (event === 'SIGNED_OUT') { teams = null; identities = []; autoOpened = false; }
      if (changed && s && event !== 'TOKEN_REFRESHED') { teams = null; loadTeams(); }
      render();
    });
    const { data } = await client.auth.getSession();
    session = data ? data.session : null;
    return client;
  }

  async function loadTeams() {
    if (!session || loadingTeams) return;
    loadingTeams = true;
    render();
    try {
      const res = await fetch(WORKER_URL + '/', {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'myEntries', accessToken: session.access_token })
      });
      const out = await res.json();
      if (out && out.success) {
        teams = out.data.entries || [];
        identities = out.data.identities || [];
        statusMsg = '';
      } else {
        teams = [];
        statusMsg = (out && out.error) || 'Could not load your teams.';
      }
    } catch (e) {
      teams = [];
      statusMsg = "Couldn't reach the server. Try again.";
    }
    loadingTeams = false;
    render();
  }

  // ---------- actions ----------
  async function signInWith(provider) {
    const c = await getClient();
    if (!c) return setStatus('Sign-in is unavailable right now.');
    try { sessionStorage.setItem(RETURN_FLAG, '1'); } catch (e) { /* ignore */ }
    const { error } = await c.auth.signInWithOAuth({
      provider,
      options: { redirectTo: returnUrl(), scopes: provider === 'azure' ? 'email openid profile' : undefined }
    });
    if (error) setStatus(error.message);
  }

  async function linkWith(provider) {
    const c = await getClient();
    if (!c) return;
    try { sessionStorage.setItem(RETURN_FLAG, '1'); } catch (e) { /* ignore */ }
    const { error } = await c.auth.linkIdentity({
      provider,
      options: { redirectTo: returnUrl(), scopes: provider === 'azure' ? 'email openid profile' : undefined }
    });
    if (error) setStatus(error.message);
  }

  async function sendLink() {
    const input = document.getElementById('auth-email-input');
    const email = input ? input.value.trim() : '';
    if (!email || email.indexOf('@') < 1) return setStatus('Enter your email.');
    const c = await getClient();
    if (!c) return setStatus('Sign-in is unavailable right now.');
    setStatus('Sending…');
    try { sessionStorage.setItem(RETURN_FLAG, '1'); } catch (e) { /* ignore */ }
    const { error } = await c.auth.signInWithOtp({ email, options: { emailRedirectTo: returnUrl() } });
    setStatus(error ? error.message : 'Check your email for the sign-in link (it may take a minute).');
  }

  async function signOut() {
    const c = await getClient();
    if (c) await c.auth.signOut();
    session = null; teams = null; identities = [];
    render();
  }

  function openTeam(entryId, email) {
    const idInput = document.getElementById('moves-entryid-input');
    const emailInput = document.getElementById('moves-email-input');
    const btn = document.getElementById('moves-lookup-btn');
    if (!idInput || !emailInput || !btn) return;
    idInput.value = entryId;
    emailInput.value = email;
    document.querySelectorAll('.auth-team').forEach(el => el.classList.toggle('active', el.dataset.id === entryId));
    btn.click();
    const panel = document.getElementById('moves-team-panel');
    if (panel) setTimeout(() => panel.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400);
  }

  function setStatus(msg) { statusMsg = msg; render(); }

  // ---------- header button ----------
  function updateHeader() {
    const btn = document.getElementById('header-auth-btn');
    if (!btn) return;
    if (session) {
      const email = (session.user && session.user.email) || '';
      btn.textContent = '👤 ' + (email.split('@')[0] || 'My Teams');
      btn.title = 'Signed in as ' + email + ' - open My Teams';
      btn.classList.add('signed-in');
    } else {
      btn.textContent = 'Sign in';
      btn.title = 'Sign in to see all your teams (optional)';
      btn.classList.remove('signed-in');
    }
  }
  function goToMyTeam() {
    const link = document.querySelector('.nav-link[data-view="managemoves"]');
    if (link) link.click();
    setTimeout(() => {
      const panel = document.getElementById('auth-panel');
      if (panel) panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 300);
  }

  // ---------- render ----------
  function render() {
    updateHeader();
    const el = document.getElementById('auth-panel');
    if (!el) return;

    if (!session) {
      el.innerHTML = `
        <div class="panel auth-panel">
          <div class="auth-title">SIGN IN <span class="mono" style="font-size:12px;color:var(--text-dim);font-weight:400;">(optional)</span></div>
          <div class="auth-sub">Sign in once to see all of your teams. No Entry ID needed.</div>
          ${PROVIDERS.map(p => `<button class="auth-btn" data-provider="${p.id}">
            <span class="auth-ic" style="background:${p.bg};color:${p.fg};">${p.icon}</span>Continue with ${p.label}</button>`).join('')}
          <div class="auth-or">— or any email —</div>
          <input type="email" id="auth-email-input" placeholder="you@email.com">
          <button id="auth-email-btn" style="width:100%;">Email me a sign-in link</button>
          <div class="status-msg">${esc(statusMsg)}</div>
        </div>`;
      el.querySelectorAll('[data-provider]').forEach(b => b.addEventListener('click', () => signInWith(b.dataset.provider)));
      el.querySelector('#auth-email-btn').addEventListener('click', sendLink);
      return;
    }

    const who = (session.user && session.user.email) || 'your account';
    let list;
    if (loadingTeams || teams === null) {
      list = `<p class="mono" style="color:var(--text-dim);font-size:13px;margin-top:8px;">Loading your teams…</p>`;
    } else if (!teams.length) {
      list = `<p style="color:var(--text-dim);margin-top:8px;">No teams on this email. Link the account you signed up with below, or use your Entry ID.</p>`;
    } else {
      list = teams.map(t => `<div class="auth-team" data-id="${esc(t.entryId)}" data-email="${esc(t.email)}">
          <div><div class="t-name">${esc(t.teamName || t.entryId)}</div><div class="t-meta">${esc(t.entryId)} · ${esc(t.email)}</div></div>
          <div class="t-go">Manage →</div></div>`).join('');
    }

    const linkedIds = new Set(identities.map(i => i.provider));
    const linkable = PROVIDERS.filter(p => !linkedIds.has(p.id));

    el.innerHTML = `
      <div class="panel auth-panel">
        <div class="auth-head">
          <div class="auth-title">MY TEAMS</div>
          <button class="auth-link-btn" id="auth-signout">Sign out</button>
        </div>
        <div class="auth-sub mono" style="font-size:12px;">Signed in as ${esc(who)}</div>
        ${list}
        <div class="status-msg error">${esc(statusMsg)}</div>
        <div class="auth-ids">
          ${identities.map(i => `<div class="row"><span>${esc(i.email || '')}</span><span>${esc(PROVIDER_NAMES[i.provider] || i.provider)}</span></div>`).join('')}
          ${linkable.length ? `<div class="mono" style="font-size:12px;color:var(--text-dim);margin-top:8px;">Teams on another email? Link that account:</div>
          <div class="auth-linkrow">${linkable.map(p => `<button class="auth-link-btn" data-link="${p.id}">+ ${p.label}</button>`).join('')}</div>` : ''}
        </div>
      </div>`;
    el.querySelector('#auth-signout').addEventListener('click', signOut);
    el.querySelectorAll('[data-link]').forEach(b => b.addEventListener('click', () => linkWith(b.dataset.link)));
    el.querySelectorAll('.auth-team').forEach(row => row.addEventListener('click', () => openTeam(row.dataset.id, row.dataset.email)));
    if (teams && teams.length === 1 && !autoOpened) { autoOpened = true; openTeam(teams[0].entryId, teams[0].email); }
  }

  // ---------- startup ----------
  async function start() {
    const hb = document.getElementById('header-auth-btn');
    if (hb) hb.addEventListener('click', goToMyTeam);
    updateHeader();
    await getClient();
    let returning = false;
    try { returning = sessionStorage.getItem(RETURN_FLAG) === '1'; sessionStorage.removeItem(RETURN_FLAG); } catch (e) { /* ignore */ }
    if (/[#&?](access_token|error_description|code)=/.test(location.href)) returning = true;
    if (session) loadTeams();
    if (returning) {
      try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
      const link = document.querySelector('.nav-link[data-view="managemoves"]');
      if (link) link.click();
    }
    render();
  }

  window.AAHLAuth = { render: function () { render(); if (session && teams === null) loadTeams(); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
