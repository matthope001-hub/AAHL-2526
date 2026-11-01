/* Quote of the Day — AAHL
 * Shows one quote per day in a shuffled order (no repeats until the whole list has shown).
 * Same quote for everyone all day; changes at midnight Toronto time.
 * To add quotes, add a line to QUOTES: ["Quote text", "Who said it"].
 */
(function () {
  var QUOTES = [
    ["You miss 100% of the shots you don't take.", "Wayne Gretzky"],
    ["I skate to where the puck is going to be, not where it has been.", "Wayne Gretzky"],
    ["It's a great day for hockey.", "\"Badger\" Bob Johnson"],
    ["If you can't beat 'em in the alley, you can't beat 'em on the ice.", "Conn Smythe"],
    ["Hockey is a fast body-contact game played by men with clubs in their hands and knives laced to their feet.", "Paul Gallico"],
    ["How would you like it in your job if every time you made a small mistake, a red light went on over your desk and 15,000 people stood up and yelled at you?", "Jacques Plante"],
    ["I went to a fight the other night and a hockey game broke out.", "Rodney Dangerfield"],
    ["Do you believe in miracles? Yes!", "Al Michaels, 1980"],
    ["Henderson has scored for Canada!", "Foster Hewitt, 1972"],
    ["He shoots! He scores!", "Foster Hewitt"],
    ["You were born to be a player. You were meant to be here. This moment is yours.", "Herb Brooks, 1980"],
    ["All hockey players are bilingual. They know English and profanity.", "Gordie Howe"],
    ["Forget about style; worry about results.", "Bobby Orr"],
    ["A puck is a hard rubber disc that hockey players strike when they can't hit one another.", "Jimmy Cannon"],
    ["We're losing at home and we're losing on the road. My failure as a coach is that I can't think of anywhere else to play.", "Harry Neale"],
    ["Goaltending is to hockey like putting is to golf. It really has no relationship to the rest of the game.", "Harry Sinden"],
    ["You're not supposed to still be alive, are you?", "Wayne Gretzky, on seeing a statue of himself"],
    ["There's only one way to stop Wayne, and that's to lock him in the dressing room.", "Gordie Howe"],
    ["A fire hydrant could score 40 goals on Mario's line!", "Luc Robitaille"],
    ["Would it have been fair not to give the fans a chance to see my beautiful face?", "Gump Worsley, on refusing to wear a mask"],
    ["I'd get a penalty every so often so my mother would know I was still playing.", "Pat Hughes"],
    ["The longer we go in the playoffs, the bigger the boat!", "Pat Burns, 2003"],
    ["People in the streets don't come up and ask how much money you make in the playoffs. They want to see your Stanley Cup ring.", "Kevin Lowe"],
    ["You give punishment and you take it.", "Fred Shero"],
    ["I want my players to skate like hell and then get off the ice.", "Fred Shero"],
    ["I like the song, but it won't put the puck in the net.", "Fred Shero, on Kate Smith"],
    ["Win today and we walk together forever.", "Fred Shero, 1974"],
    ["Life is just a place where we spend time between games.", "Fred Shero"],
    ["To win in hockey, you need the glamour boys to get down and dirty.", "Ken Hitchcock"],
    ["North Americans want to win games in the last period, but a well-conditioned team wins in the first ten minutes, maybe less.", "Anatoli Tarasov"],
    ["I don't have bad relationships with my players. But I don't get into long conversations with them either.", "Scotty Bowman"],
    ["It's easy to impress Scotty: just show up, work hard and keep your mouth shut.", "Steve Yzerman"],
    ["Herb Brooks pats you on the back but always lets you know he has the knife in the other hand.", "Buzz Schneider"],
    ["There are goals, and there are Richard goals.", "Dick Irvin"],
    ["The Rocket put me in the Hall of Fame.", "Elmer Lach"],
    ["I never knew in advance what I was going to do on any given play. Everything I did was done spontaneously, without any forethought.", "Maurice Richard"],
    ["When I picked up the Stanley Cup I couldn't believe it. The thing is lighter than a feather.", "Henri Richard"],
    ["Guy Lafleur has more moves than a monkey on a mile of vine.", "Lynn Patrick"],
    ["If I could be a forward, I would want to be Bob Gainey.", "Ken Dryden"],
    ["There's no stop to hockey. You can't pause and recharge your courage.", "Bob Gainey"],
    ["Half the game is mental; the other half is being mental.", "Jim McKenny"],
    ["People would say, 'Girls don't play hockey. Girls don't skate.' I would say, 'Watch this.'", "Hayley Wickenheiser"],
    ["My face is my mask.", "Gump Worsley"],
    ["The only job worse is a javelin catcher at a track and field meet.", "Gump Worsley, on goaltending"],
    ["I can't hear what Jeremy says, because I've got my two Stanley Cup rings plugging my ears.", "Patrick Roy, 1996"],
    ["Elvis has just left the building!", "Mike Lange"]
  ];

  function todayNum() {
    var s = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date());
    var p = s.split('-');
    return Math.floor(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 864e5);
  }
  function rng(seed) {
    return function () {
      seed = (seed + 0x6D2B79F5) | 0;
      var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function pick() {
    var n = QUOTES.length, d = todayNum(), cycle = Math.floor(d / n), r = rng(cycle * 7919 + 406);
    var order = QUOTES.map(function (_, i) { return i; });
    for (var i = n - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = order[i]; order[i] = order[j]; order[j] = t; }
    return QUOTES[order[d % n]];
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function render() {
    var el = document.getElementById('daily-quote');
    if (!el || !QUOTES.length) return;
    var st = document.createElement('style');
    st.textContent = '.dq{margin:0 0 20px;padding:14px 18px;background:var(--bg-panel);border:1px solid var(--border);border-left:3px solid var(--ice)}.dq-l{display:block;font-family:var(--font-mono);font-size:11px;letter-spacing:1px;color:var(--ice);margin-bottom:6px}.dq-q{margin:0;font-family:var(--font-display);font-size:20px;line-height:1.3;color:var(--text)}.dq-a{margin-top:6px;font-family:var(--font-mono);font-size:12px;color:var(--text-dim)}';
    document.head.appendChild(st);
    var q = pick();
    el.innerHTML = '<figure class="dq"><span class="dq-l">QUOTE OF THE DAY</span>' +
      '<blockquote class="dq-q">\u201C' + esc(q[0]) + '\u201D</blockquote>' +
      '<figcaption class="dq-a">\u2014 ' + esc(q[1]) + '</figcaption></figure>';
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render); else render();
})();
