/* schedule.js — AAHL 2526 weekly schedule grid
 * Usage:
 *   ScheduleGrid.mount('#schedule-grid');                         // uses apiGet() from data.js
 *   ScheduleGrid.mount('#schedule-grid', { highlight: ['COL','TOR'] });
 *   ScheduleGrid.highlight(['EDM']);  // optional: mark teams (e.g. an entry's players' teams)
 */
(function () {
  var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var MON = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  var LIGHT = 8; // fewer than 8 games on the slate = light night
  var st = { el: null, api: '', start: null, hl: [], data: null, mine: false };
  var mem = {};

  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function ymd(s) { var p = s.split('-'); return new Date(+p[0], p[1] - 1, +p[2]); }
  function fmt(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function shift(s, n) { var d = ymd(s); d.setDate(d.getDate() + n); return fmt(d); }
  function label(s) { var d = ymd(s); return MON[d.getMonth()] + ' ' + d.getDate(); }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }

  function load(date) {
    var k = date || 'cur';
    if (mem[k]) { st.data = mem[k]; st.start = mem[k].start; render(); return; }
    st.el.innerHTML = '<div class="sg-msg">Loading schedule…</div>';
    var req;
    if (!st.api && typeof apiGet === 'function') {
      req = apiGet('schedule', date ? { date: date } : null); // site helper (data.js) → Apps Script
    } else {
      var base = st.api || (typeof WEBAPP_URL !== 'undefined' ? WEBAPP_URL : '');
      var url = base + (base.indexOf('?') < 0 ? '?' : '&') + 'action=schedule' + (date ? '&date=' + date : '');
      req = fetch(url).then(function (r) { return r.json(); });
    }
    req
      .then(function (j) {
        if (!j || !j.success) throw new Error((j && j.error) || 'Unknown error');
        mem[k] = mem[j.data.start] = j.data;
        st.data = j.data; st.start = j.data.start;
        render();
      })
      .catch(function (e) {
        st.el.innerHTML = '<div class="sg-msg sg-err">Schedule unavailable — ' + esc(e.message) +
          ' <button class="sg-btn" data-sg="retry">Retry</button></div>';
      });
  }

  function build() {
    var teams = {}, slate = [];
    st.data.days.forEach(function (d, i) {
      var n = d.games.length, light = n > 0 && n < LIGHT;
      slate.push({ n: n, light: light });
      d.games.forEach(function (g) {
        add(g.home, i, g.away, true, light);
        add(g.away, i, g.home, false, light);
      });
    });
    function add(t, i, opp, home, light) {
      var r = teams[t] || (teams[t] = { team: t, cells: [], g: 0, ln: 0 });
      r.cells[i] = { opp: opp, home: home };
      r.g++; if (light) r.ln++;
    }
    var rows = Object.keys(teams).map(function (k) { return teams[k]; });
    rows.sort(function (a, b) { return b.g - a.g || b.ln - a.ln || a.team.localeCompare(b.team); });
    return { rows: rows, slate: slate };
  }

  function render() {
    var b = build(), hl = st.hl;
    var rows = st.mine && hl.length ? b.rows.filter(function (r) { return hl.indexOf(r.team) > -1; }) : b.rows;
    var maxG = b.rows.length ? b.rows[0].g : 0;
    var minG = b.rows.length ? b.rows[b.rows.length - 1].g : 0;

    var h = '<div class="sg-head">' +
      '<div><div class="sg-kicker">' + label(st.data.start) + ' to ' + label(st.data.end) + '</div>' +
      '<div class="sg-sub">Every team, night by night. Shaded = light night (fewer than ' + LIGHT + ' games).</div></div>' +
      '<div class="sg-nav">' +
      '<button class="sg-btn" data-sg="prev" aria-label="Previous week">◀</button>' +
      '<button class="sg-btn" data-sg="now">This week</button>' +
      '<button class="sg-btn" data-sg="next" aria-label="Next week">▶</button>' +
      (hl.length ? '<button class="sg-btn' + (st.mine ? ' sg-on' : '') + '" data-sg="mine">My teams</button>' : '') +
      '</div></div>';

    h += cards(b);

    h += '<div class="sg-wrap"><table class="sg-table"><thead><tr><th class="sg-team">Team</th>';
    b.slate.forEach(function (s, i) {
      h += '<th class="' + (s.light ? 'sg-light' : '') + '"><span class="sg-day">' + DAYS[i] + '</span>' +
        '<span class="sg-cnt">' + s.n + ' gm</span></th>';
    });
    h += '<th class="sg-num">G</th><th class="sg-num">LN</th></tr></thead><tbody>';

    if (!rows.length) {
      h += '<tr><td colspan="10" class="sg-msg">No regular season games this week.</td></tr>';
    }
    rows.forEach(function (r) {
      var gc = r.g === maxG && maxG !== minG ? 'sg-good' : (r.g === minG && maxG !== minG ? 'sg-bad' : '');
      h += '<tr class="' + (hl.indexOf(r.team) > -1 ? 'sg-hl' : '') + '"><td class="sg-team">' + esc(r.team) + '</td>';
      for (var i = 0; i < 7; i++) {
        var c = r.cells[i], lc = b.slate[i].light ? ' class="sg-light"' : '';
        h += '<td' + lc + '>' + (c
          ? '<span class="sg-chip ' + (c.home ? 'sg-home' : 'sg-away') + '">' + (c.home ? '' : '@') + esc(c.opp) + '</span>'
          : '') + '</td>';
      }
      h += '<td class="sg-num ' + gc + '">' + r.g + '</td><td class="sg-num sg-ln">' + r.ln + '</td></tr>';
    });
    h += '</tbody></table></div>' +
      '<div class="sg-legend">filled = home · @ = away · G = games · LN = light-night games · regular season only</div>';
    st.el.innerHTML = h;
  }

  // Best / worst schedule cards (like the r/fantasyhockey grids)
  function cards(b) {
    if (!b.rows.length) return '';
    var best = b.rows.slice(0, 6);
    var worst = b.rows.slice().sort(function (a, c) {
      return a.g - c.g || a.ln - c.ln || a.team.localeCompare(c.team);
    }).slice(0, 8);
    return '<div class="sg-cards">' +
      card('Best schedules', best, 'sg-good', b) +
      card('Worst schedules', worst, 'sg-bad', b) +
      '</div>';
  }

  function card(title, rows, tone, b) {
    var h = '<div class="sg-card"><div class="sg-card-title">' + title + '</div>' +
      '<div class="sg-crow sg-chead"><span></span>';
    for (var i = 0; i < 7; i++) {
      h += '<span class="sg-ccell' + (b.slate[i].light ? ' sg-light' : '') + '">' + DAYS[i].charAt(0) + '</span>';
    }
    h += '<span class="sg-ctot">G · LN</span></div>';
    rows.forEach(function (r) {
      h += '<div class="sg-crow' + (st.hl.indexOf(r.team) > -1 ? ' sg-hl' : '') + '"><span class="sg-cteam">' + esc(r.team) + '</span>';
      for (var i = 0; i < 7; i++) {
        var c = r.cells[i];
        h += '<span class="sg-ccell' + (b.slate[i].light ? ' sg-light' : '') + '">' + (c
          ? '<span class="sg-mini ' + (c.home ? 'sg-home' : 'sg-away') + '">' + esc(c.opp) + '</span>'
          : '<span class="sg-dash">—</span>') + '</span>';
      }
      h += '<span class="sg-ctot ' + tone + '">' + r.g + ' · ' + r.ln + '</span></div>';
    });
    return h + '</div>';
  }

  function onClick(e) {
    var a = e.target.closest('[data-sg]'); if (!a) return;
    var act = a.getAttribute('data-sg');
    if (act === 'prev') load(shift(st.start, -7));
    else if (act === 'next') load(shift(st.start, 7));
    else if (act === 'now') load();
    else if (act === 'retry') load(st.start);
    else if (act === 'mine') { st.mine = !st.mine; render(); }
  }

  window.ScheduleGrid = {
    mount: function (sel, opts) {
      st.el = typeof sel === 'string' ? document.querySelector(sel) : sel;
      if (!st.el) return;
      opts = opts || {};
      st.api = opts.api || '';
      st.hl = (opts.highlight || []).map(function (t) { return String(t).toUpperCase(); });
      st.el.classList.add('sg-root');
      if (!st.el._sgBound) { st.el.addEventListener('click', onClick); st.el._sgBound = true; }
      if (st.data) render(); else load();
    },
    highlight: function (teams) {
      st.hl = (teams || []).map(function (t) { return String(t).toUpperCase(); });
      if (!st.hl.length) st.mine = false;
      if (st.data) render();
    }
  };
})();
