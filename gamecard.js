/**
 * gamecard.js — tap a game on the "Today's Games" ticker and it flips over
 * into a card showing which POOL players are in that game and who has
 * points so far (live during the game, final after).
 *
 * Read-only: uses data the page already loads (todaysGamesCache,
 * livePointsCache, players, pick counts). Nothing is saved anywhere.
 * Loaded after main.js / stats.js (uses their helpers).
 */
(function () {
  var openId = null;     // game id of the open card
  var overlay = null;

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function esc(s) { return typeof escapeHtml === 'function' ? escapeHtml(String(s == null ? '' : s)) : String(s == null ? '' : s); }
  function logo(t) {
    return '<img class="gc-logo" src="https://assets.nhle.com/logos/nhl/svg/' + esc(t) + '_light.svg" alt="" onerror="this.style.display=\'none\'">';
  }
  function gameById(id) {
    var games = (typeof todaysGamesData_ !== 'undefined' && todaysGamesData_ && todaysGamesData_.games) || [];
    for (var i = 0; i < games.length; i++) if (String(games[i].id) === String(id)) return games[i];
    return null;
  }
  // Tonight's live/final pool points (kept even after the 4am run, so the
  // card still shows the night's numbers).
  function tonightPts() {
    var lp = (typeof livePoints !== 'undefined') ? livePoints : null;
    if (!lp || !lp.players || (typeof hockeyDay_ === 'function' && lp.date !== hockeyDay_())) return {};
    return lp.players;
  }
  function picked(id) {
    return (typeof pickedCount_ === 'function') ? pickedCount_(id) : 0;
  }
  function statLine(s) {
    if (!s) return '';
    if (s.isGoalie) {
      var dec = s.decision === 'W' ? 'W' : s.decision === 'L' ? 'L' : s.decision === 'O' ? 'OTL' : '';
      return [dec, s.shutout ? 'SO' : '', (s.saves || 0) + ' SV'].filter(Boolean).join(' ');
    }
    var out = (s.goals || 0) + 'G ' + (s.assists || 0) + 'A';
    if ((s.goals || 0) >= 3) out += ' 🎩';
    return out;
  }
  function startTime(g) {
    var t = new Date(g.startTimeUTC);
    return isNaN(t.getTime()) ? '' : t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
  function statusHtml(g) {
    if (g.state === 'final') return '<span class="gc-final">FINAL' + (g.finalType ? '/' + esc(g.finalType) : '') + '</span>';
    if (g.state === 'live') {
      var where = g.period ? (g.intermission ? g.period + ' INT' : (g.clock ? g.period + ' · ' + g.clock : g.period)) : 'LIVE';
      return '<span class="gc-live">● ' + esc(where) + '</span>';
    }
    return '<span class="gc-pre">Puck drop ' + esc(startTime(g)) + '</span>';
  }

  function playerRow(p, s) {
    var n = picked(p.id);
    var pickHtml = n
      ? (typeof pickedLink_ === 'function' ? pickedLink_(p.id, 'on ' + n + ' team' + (n === 1 ? '' : 's')) : 'on ' + n + ' teams')
      : '';
    return '<div class="gc-row' + (s && s.pts > 0 ? '' : ' gc-dim') + '">' +
      (p.headshotUrl ? '<img class="gc-shot" src="' + esc(p.headshotUrl) + '" alt="" loading="lazy">' : '<span class="gc-shot gc-shot-empty"></span>') +
      '<span class="gc-who"><span class="gc-name">' + esc(p.fullName) + '</span>' +
      '<span class="gc-sub">' + esc(p.position || '') + (pickHtml ? ' · ' + pickHtml : '') + '</span></span>' +
      '<span class="gc-stat">' + esc(statLine(s)) + '</span>' +
      '<span class="gc-pts">' + (s && s.pts > 0 ? '+' + s.pts.toFixed(2) : '–') + '</span>' +
      '</div>';
  }

  function teamBlock(team, g, pts) {
    var list = (typeof allPlayers !== 'undefined' ? allPlayers : []).filter(function (p) {
      return p.team === team && poolPlayerIds.has(p.id);
    });
    if (!list.length) {
      return '<div class="gc-team"><div class="gc-team-hd">' + logo(team) + esc(team) + '</div>' +
        '<div class="gc-empty">No pool players.</div></div>';
    }
    var started = g.state === 'live' || g.state === 'final';
    var scored = [], rest = [];
    list.forEach(function (p) { var s = pts[p.id]; (s && s.pts > 0 ? scored : rest).push(p); });
    scored.sort(function (a, b) { return pts[b.id].pts - pts[a.id].pts; });
    rest.sort(function (a, b) { return picked(b.id) - picked(a.id) || a.fullName.localeCompare(b.fullName); });
    var total = scored.reduce(function (t, p) { return t + pts[p.id].pts; }, 0);

    var h = '<div class="gc-team"><div class="gc-team-hd">' + logo(team) + esc(team) +
      (started ? '<span class="gc-team-tot">+' + total.toFixed(2) + '</span>' : '<span class="gc-team-tot gc-dimtxt">' + list.length + ' pool player' + (list.length === 1 ? '' : 's') + '</span>') +
      '</div>';
    if (started) {
      h += scored.length ? scored.map(function (p) { return playerRow(p, pts[p.id]); }).join('')
        : '<div class="gc-empty">No pool points yet.</div>';
      if (rest.length) {
        h += '<details class="gc-more"><summary>' + rest.length + ' more pool player' + (rest.length === 1 ? '' : 's') + ' without points</summary>' +
          rest.map(function (p) { return playerRow(p, pts[p.id]); }).join('') + '</details>';
      }
    } else {
      h += rest.map(function (p) { return playerRow(p, null); }).join('');
    }
    return h + '</div>';
  }

  // Any pool player in this game with 3+ goals?
  function hatTrick(g, pts) {
    return (typeof allPlayers !== 'undefined' ? allPlayers : []).some(function (p) {
      var s = pts[p.id];
      return s && (s.goals || 0) >= 3 && (p.team === g.away || p.team === g.home) && poolPlayerIds.has(p.id);
    });
  }

  function cardHtml(g) {
    var pts = tonightPts();
    var started = g.state === 'live' || g.state === 'final';
    var score = function (v) { return started ? '<span class="gc-score">' + (v == null ? 0 : v) + '</span>' : ''; };
    var updated = '';
    var lp = (typeof livePoints !== 'undefined') ? livePoints : null;
    if (started && lp && lp.updatedAt) {
      var d = new Date(lp.updatedAt);
      if (!isNaN(d.getTime())) updated = 'Points updated ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) +
        (g.state === 'live' ? ' · estimate until the 4am update' : '');
    }
    return '<div class="gc-card" role="dialog" aria-label="Pool players in ' + esc(g.away) + ' at ' + esc(g.home) + '">' +
      '<button type="button" class="gc-x" aria-label="Close">×</button>' +
      '<div class="gc-head">' +
        '<div class="gc-side">' + logo(g.away) + '<span class="gc-abbr">' + esc(g.away) + '</span>' + score(g.awayScore) + '</div>' +
        '<div class="gc-status">' + statusHtml(g) + '</div>' +
        '<div class="gc-side gc-home">' + score(g.homeScore) + '<span class="gc-abbr">' + esc(g.home) + '</span>' + logo(g.home) + '</div>' +
      '</div>' +
      '<div class="gc-title">' + (started ? 'Pool points' : 'Pool players in this game') + '</div>' +
      '<div class="gc-body">' + teamBlock(g.away, g, pts) + teamBlock(g.home, g, pts) + '</div>' +
      ((updated || hatTrick(g, pts)) ? '<div class="gc-foot">' +
        (hatTrick(g, pts) ? '<div class="gc-hat">🎩 = hat trick · bonus points included</div>' : '') +
        esc(updated) + '</div>' : '') +
      '</div>';
  }

  function render() {
    if (!overlay || openId == null) return;
    var g = gameById(openId);
    if (!g) { close(); return; }
    var openMore = overlay.querySelectorAll('details.gc-more[open]').length > 0;
    var body = overlay.querySelector('.gc-body');
    var top = body ? body.scrollTop : 0;
    overlay.innerHTML = cardHtml(g);
    if (openMore) overlay.querySelectorAll('details.gc-more').forEach(function (d) { d.open = true; });
    var b2 = overlay.querySelector('.gc-body');
    if (b2) b2.scrollTop = top;
  }

  function pauseTicker(on) {
    document.querySelectorAll('#todays-games .games-ticker-track').forEach(function (t) {
      t.style.animationPlayState = on ? 'paused' : '';
    });
  }

  async function open(id, chip) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'gc-overlay';
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay || (e.target.closest && e.target.closest('.gc-x'))) close();
      });
      document.body.appendChild(overlay);
    }
    openId = id;
    pauseTicker(true);

    // Flip the chip over, then the card flips in from its back.
    if (chip && !reduceMotion) {
      chip.classList.add('gc-flip');
      setTimeout(function () { chip.classList.remove('gc-flip'); }, 600);
    }
    var g = gameById(id);
    overlay.innerHTML = g ? cardHtml(g).replace('<div class="gc-body">', '<div class="gc-body"><div class="gc-empty">Loading…</div>') : '';
    overlay.classList.add('gc-open');
    document.addEventListener('keydown', onKey);

    try {
      await Promise.all([
        typeof ensurePlayersLoaded === 'function' ? ensurePlayersLoaded() : null,
        typeof ensurePickCountsLoaded_ === 'function' ? ensurePickCountsLoaded_() : null,
        typeof loadTonight_ === 'function' ? loadTonight_(true) : null
      ]);
    } catch (e) { /* show what we have */ }
    render();
  }

  function close() {
    openId = null;
    pauseTicker(false);
    document.removeEventListener('keydown', onKey);
    if (overlay) { overlay.classList.remove('gc-open'); overlay.innerHTML = ''; }
  }
  function onKey(e) { if (e.key === 'Escape') close(); }

  // Tap / click / Enter on any game in the ticker.
  document.addEventListener('click', function (e) {
    var chip = e.target.closest && e.target.closest('#todays-games .game-chip[data-game-id]');
    if (!chip) return;
    open(chip.getAttribute('data-game-id'), chip);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var chip = e.target.closest && e.target.closest('#todays-games .game-chip[data-game-id]');
    if (!chip) return;
    e.preventDefault();
    open(chip.getAttribute('data-game-id'), chip);
  });

  window.GameCard = {
    refresh: function () { if (openId != null) render(); },
    close: close
  };
})();
