/* Sortable admin tables: click any column header to sort, click again to flip.
 * Works on every <table> with a <thead> on the page, including tables drawn later.
 * Keeps the sort when a table is redrawn. Expanded detail rows (one wide cell) stay under their row.
 * A cell can set data-sort="..." to sort by a different value than it shows.
 * Optional: <script src="sortable.js" data-scope="#admin-panel"> limits it to tables inside that element. */
(function () {
  const SCOPE = (document.currentScript && document.currentScript.dataset.scope) || '';
  const inScope = el => !SCOPE || !!el.closest(SCOPE);
  const MON = /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d/i;
  const css = document.createElement('style');
  css.textContent = 'th.srt{cursor:pointer;user-select:none;white-space:nowrap}th.srt:hover{text-decoration:underline}' +
    'th.srt-asc::after{content:" ▲";font-size:.75em}th.srt-desc::after{content:" ▼";font-size:.75em}';
  document.head.appendChild(css);

  const sortable = th => th && th.closest('thead') && inScope(th) && th.textContent.trim() && !th.querySelector('input,button,select');
  function key(td) {
    if (!td) return { e: true };
    const raw = (td.dataset.sort != null ? td.dataset.sort : td.textContent).trim();
    if (!raw || raw === '—' || raw === '-') return { e: true };
    const n = raw.replace(/[$,%\s]/g, '');
    if (/^-?\d+(\.\d+)?$/.test(n)) return { n: +n };
    if (MON.test(raw) || /^\d{4}-\d{2}-\d{2}/.test(raw)) { const t = Date.parse(/\d{4}/.test(raw) ? raw : raw.replace(/,?\s+(\d{1,2}:\d{2})/, ' 2000 $1')); if (!isNaN(t)) return { n: t }; }
    return { s: raw.toLowerCase() };
  }
  function cmp(a, b) {
    if (a.e || b.e) return a.e && b.e ? 0 : a.e ? 1 : -1;            // blanks always last
    if (a.n != null && b.n != null) return a.n - b.n;
    if (a.n != null) return -1; if (b.n != null) return 1;
    return a.s.localeCompare(b.s, undefined, { numeric: true });
  }
  function apply(table) {
    const col = +table.dataset.srtCol, dir = table.dataset.srtDir === 'desc' ? -1 : 1;
    const tb = table.tBodies[0];
    if (!tb || isNaN(col)) return;
    const groups = [];
    for (const tr of tb.rows) {
      const wide = tr.cells.length === 1 && tr.cells[0].colSpan > 1;
      if (wide && groups.length) groups[groups.length - 1].push(tr);
      else if (wide) return;                                            // "No entries yet." row
      else groups.push([tr]);
    }
    const sorted = groups.slice().sort((a, b) => { const ka = key(a[0].cells[col]), kb = key(b[0].cells[col]); return (ka.e || kb.e) ? cmp(ka, kb) : dir * cmp(ka, kb); });
    if (sorted.every((g, i) => g === groups[i])) return;
    table._srtBusy = true;
    sorted.forEach(g => g.forEach(tr => tb.appendChild(tr)));
    table._srtBusy = false;
  }
  function mark(table) {
    const head = table.tHead && table.tHead.rows[0];
    if (!head) return;
    [...head.cells].forEach((th, i) => {
      if (!sortable(th)) return;
      th.classList.add('srt');
      th.classList.toggle('srt-asc', +table.dataset.srtCol === i && table.dataset.srtDir !== 'desc');
      th.classList.toggle('srt-desc', +table.dataset.srtCol === i && table.dataset.srtDir === 'desc');
      th.title = th.title || 'Sort by ' + th.textContent.trim();
    });
  }
  function watch(table) {
    if (table._srtObs) return;
    table._srtObs = new MutationObserver(() => { if (!table._srtBusy) { mark(table); apply(table); } });
    table._srtObs.observe(table, { childList: true, subtree: false });
    if (table.tBodies[0]) table._srtObs.observe(table.tBodies[0], { childList: true });
  }

  document.addEventListener('click', ev => {
    const th = ev.target.closest('th');
    if (!sortable(th) || ev.target.closest('input,button,select,a')) return;
    const table = th.closest('table'), i = th.cellIndex;
    table.dataset.srtDir = +table.dataset.srtCol === i && table.dataset.srtDir !== 'desc' ? 'desc' : 'asc';
    table.dataset.srtCol = i;
    mark(table); apply(table); watch(table);
  });
  // Show the sort cursor/arrows on tables as they appear.
  let queued = false;
  const scan = () => { queued = false; document.querySelectorAll(SCOPE ? SCOPE + ' table' : 'table').forEach(t => { if (t.tHead) mark(t); }); };
  const later = () => { if (!queued) { queued = true; requestAnimationFrame(scan); } };
  new MutationObserver(later).observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan); else scan();
})();
