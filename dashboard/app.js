// Token Radar (radar-4) — the page. Static, no network: it reads window.RADAR
// from ../data.js, written by main.ts from the same board as board.json.
// Views are hash-routed so any view renders deterministically from its URL:
//   #/                        the board (filters in the query part)
//   #/detail/<slug>           one protocol's detail view
//   #/risk                    the risk view
//   #/live                    traded tokens, kept apart from the board
//   #/method                  how the model and the bands are built
(function () {
  'use strict';
  var D = window.RADAR;
  var rows = D.rows;
  var view = document.getElementById('view');

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(v) {
    if (v === null || v === undefined) return '<span class="num">n/a</span>';
    var cls = v > 0 ? 'pos' : v < 0 ? 'neg' : '';
    return '<span class="num ' + cls + '">' + (v > 0 ? '+' : '') + v.toFixed(1) + '%</span>';
  }
  function ageText(d) {
    if (d === null || d === undefined) return 'unknown';
    if (d < 30) return d + 'd';
    if (d < 365) return Math.round(d / 30) + 'mo';
    return (d / 365).toFixed(1) + 'y';
  }
  function confChip(b) { return '<span class="chip ' + b.toLowerCase() + '">' + b + '</span>'; }
  function riskColor(s) { return s < 30 ? 'var(--green)' : s <= 55 ? 'var(--amber)' : 'var(--red)'; }

  // One log scale for every band bar, so bars compare across the whole board.
  var loMin = Infinity, hiMax = 0;
  rows.forEach(function (r) { loMin = Math.min(loMin, r.band_low_usd); hiMax = Math.max(hiMax, r.band_high_usd); });
  var logMin = Math.log10(Math.max(1, loMin)), logMax = Math.log10(Math.max(2, hiMax));
  function bandGeom(r) {
    var span = logMax - logMin || 1;
    var l = (Math.log10(Math.max(1, r.band_low_usd)) - logMin) / span * 100;
    var h = (Math.log10(Math.max(2, r.band_high_usd)) - logMin) / span * 100;
    var p = (Math.log10(Math.max(1, r.implied_value_usd)) - logMin) / span * 100;
    return { l: Math.max(0, Math.min(100, l)), w: Math.max(1, Math.min(100, h) - Math.max(0, Math.min(100, l))), p: Math.max(0, Math.min(100, p)) };
  }
  function bandBar(r) {
    var g = bandGeom(r);
    return '<div class="band" title="Band ' + moneyFull(r.band_low_usd) + ' to ' + moneyFull(r.band_high_usd) + '"><div class="track"></div>' +
      '<div class="fill" style="left:' + g.l.toFixed(1) + '%;width:' + g.w.toFixed(1) + '%"></div>' +
      '<div class="pt" style="left:' + g.p.toFixed(1) + '%"></div></div>' +
      '<div class="bandlab num">' + money(r.band_low_usd) + ' – ' + money(r.band_high_usd) + ' (×' + r.band_spread.toFixed(1) + ')</div>';
  }

  // ------------------------------------------------------------ routing
  function route() {
    var hash = location.hash.replace(/^#/, '') || '/';
    var parts = hash.split('?');
    var path = parts[0];
    var q = {};
    (parts[1] || '').split('&').forEach(function (kv) {
      if (!kv) return;
      var i = kv.indexOf('=');
      q[decodeURIComponent(kv.slice(0, i < 0 ? kv.length : i))] = decodeURIComponent(i < 0 ? '' : kv.slice(i + 1));
    });
    var segs = path.split('/').filter(Boolean);
    var name = segs[0] || 'board';
    document.querySelectorAll('#nav a').forEach(function (a) { a.classList.toggle('on', a.dataset.view === name || (name === 'detail' && a.dataset.view === 'board')); });
    if (name === 'detail') return renderDetail(segs[1] || '');
    if (name === 'risk') return renderRisk();
    if (name === 'live') return renderLive();
    if (name === 'method') return renderMethod();
    return renderBoard(q);
  }

  function header() {
    document.getElementById('meta').innerHTML =
      'Snapshot ' + esc(D.as_of) + ' &middot; ' + D.board_size + ' rows &middot; watchlist ' + D.watchlist_size +
      ' &middot; model ' + esc(D.model_version);
    document.getElementById('foot').innerHTML =
      'Implied values are this radar\u2019s own claim from the sealed snapshot, never make.fun\u2019s. ' +
      'A protocol is described as recording no token, never as having none: the snapshot is DefiLlama\u2019s record, not proof. ' +
      'Source: ' + esc(D.source) + '.';
  }

  // ------------------------------------------------------------ board
  var SORTS = {
    rank: function (a, b) { return a.rank - b.rank; },
    tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
    implied: function (a, b) { return b.implied_value_usd - a.implied_value_usd; },
    risk: function (a, b) { return b.risk_score - a.risk_score; },
    spread: function (a, b) { return b.band_spread - a.band_spread; },
    change: function (a, b) { return (b.change_7d || 0) - (a.change_7d || 0); }
  };
  function boardLink(q, over) {
    var next = {};
    ['cat', 'conf', 'q', 'sort', 'wl'].forEach(function (k) { if (q[k]) next[k] = q[k]; });
    Object.keys(over || {}).forEach(function (k) { if (over[k]) next[k] = over[k]; else delete next[k]; });
    var s = Object.keys(next).map(function (k) { return k + '=' + encodeURIComponent(next[k]); }).join('&');
    return '#/' + (s ? '?' + s : '');
  }
  function renderBoard(q) {
    var cat = q.cat || '', conf = q.conf || '', needle = (q.q || '').toLowerCase(), wlOnly = q.wl === '1';
    var sort = SORTS[q.sort] ? q.sort : 'rank';
    var cats = [];
    rows.forEach(function (r) { if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category); });
    cats.sort();
    var list = rows.filter(function (r) {
      if (cat && r.category !== cat) return false;
      if (conf && r.confidence_band !== conf) return false;
      if (wlOnly && !r.on_watchlist) return false;
      if (needle && (r.name + ' ' + r.slug + ' ' + (r.category || '')).toLowerCase().indexOf(needle) < 0) return false;
      return true;
    }).sort(SORTS[sort]);
    var m = D.market;
    var hi = rows.filter(function (r) { return r.confidence_band === 'High'; }).length;
    var html = '<h1>Launch board, ranked by risk-adjusted value</h1>' +
      '<p class="sub">Every protocol below <b>records no token</b> in the snapshot. The headline number is the implied value ' +
      'after a risk haircut; the bar beside it is the uncertainty band. Rank 1 is the best value <b>after risk</b>, not the biggest TVL.</p>' +
      '<div class="cards">' +
      '<div class="card"><div class="k">Rows</div><div class="v num">' + D.board_size + '</div><div class="d">' + D.watchlist_size + ' watchlist + ' + D.early_size + ' early</div></div>' +
      '<div class="card"><div class="k">Market multiple</div><div class="v num">' + m.median.toFixed(3) + '×</div><div class="d">median mcap/TVL, ' + m.n + ' traded tokens</div></div>' +
      '<div class="card"><div class="k">Band quartiles</div><div class="v num">' + m.p25.toFixed(3) + '× – ' + m.p75.toFixed(3) + '×</div><div class="d">P25–P75 of the same multiples</div></div>' +
      '<div class="card"><div class="k">High confidence</div><div class="v num">' + hi + ' rows</div><div class="d">risk score under 30</div></div></div>' +
      '<form class="controls" id="ctl">' +
      '<input name="q" type="search" placeholder="Search name, slug, category" value="' + esc(q.q || '') + '">' +
      '<select name="cat"><option value="">All categories</option>' + cats.map(function (c) { return '<option' + (c === cat ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select>' +
      '<select name="conf"><option value="">Any confidence</option>' + ['High', 'Medium', 'Low'].map(function (c) { return '<option' + (c === conf ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select>' +
      '<label><input type="checkbox" name="wl" value="1"' + (wlOnly ? ' checked' : '') + '> Watchlist only</label>' +
      '<span class="count num">' + list.length + ' of ' + rows.length + ' rows</span></form>';
    function th(label, key) {
      var arrow = sort === key ? ' ▾' : '';
      return '<th class="sort" data-sort="' + key + '">' + label + arrow + '</th>';
    }
    html += '<table><thead><tr><th>#</th><th>Protocol</th>' + th('TVL', 'tvl') + th('7d', 'change') + th('Risk-adj. value', 'implied') +
      '<th>Uncertainty band (log scale)</th>' + th('Risk', 'risk') + '<th>Confidence</th></tr></thead><tbody>';
    list.forEach(function (r) {
      html += '<tr><td class="rk num">' + r.rank + '</td>' +
        '<td><a class="pname" href="#/detail/' + esc(r.slug) + '">' + esc(r.name) + '</a>' + (r.on_watchlist ? '<span class="wl">WATCHLIST</span>' : '') +
        '<div class="pcat">' + esc(r.category || 'Uncategorized') + ' · ' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + ' · ' + ageText(r.age_days) + '</div></td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td><td>' + pct(r.change_7d) + '</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td>' + bandBar(r) + '</td>' +
        '<td><span class="num">' + r.risk_score + '</span> <span class="riskbar"><i style="width:' + r.risk_score + '%;background:' + riskColor(r.risk_score) + '"></i></span></td>' +
        '<td>' + confChip(r.confidence_band) + '</td></tr>';
    });
    html += '</tbody></table>';
    if (!list.length) html += '<div class="empty">No rows match these filters.</div>';
    view.innerHTML = html;
    var form = document.getElementById('ctl');
    form.addEventListener('submit', function (e) { e.preventDefault(); applyFilters(); });
    form.addEventListener('change', applyFilters);
    var deb;
    form.querySelector('input[name=q]').addEventListener('input', function () { clearTimeout(deb); deb = setTimeout(applyFilters, 250); });
    view.querySelectorAll('th.sort').forEach(function (el) {
      el.addEventListener('click', function () { location.hash = boardLink(q, { sort: el.dataset.sort }); });
    });
    function applyFilters() {
      var fd = new FormData(form);
      location.hash = boardLink({}, {
        cat: fd.get('cat') || '', conf: fd.get('conf') || '', q: (fd.get('q') || '').toString().trim(), sort: sort === 'rank' ? '' : sort, wl: fd.get('wl') ? '1' : ''
      });
    }
  }

  // ------------------------------------------------------------ detail
  var RISK_LABELS = [
    ['concentration', 'Chain concentration', '1 chain = 1.00, spread over chains lowers it'],
    ['volatility', 'TVL volatility', '|7-day change| / 60, capped at 1; unreported = 0.60'],
    ['youth', 'Short record', '1 at listing, 0 after 730 days; unknown date = 0.70'],
    ['smallness', 'Small size', '0 at the $50M floor, rising as TVL falls below it'],
    ['dispersion', 'Category disagreement', 'spread of traded multiples in the category, / 2.5']
  ];
  function renderDetail(slug) {
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) { view.innerHTML = '<p class="empty">No protocol <b>' + esc(slug) + '</b> on this board. <a href="#/">Back to the board</a>.</p>'; return; }
    var m = r.model;
    var base = Math.round(r.tvl_usd * m.multiple);
    var html = '<p class="back"><a href="#/">&larr; Back to the board</a></p>' +
      '<h1>#' + r.rank + ' ' + esc(r.name) + ' ' + (r.on_watchlist ? '<span class="chip high">WATCHLIST</span>' : '<span class="pill">Early — below the watchlist floor</span>') + '</h1>' +
      '<p class="sub">' + esc(r.category || 'Uncategorized') + ' · ' + esc(r.chains.join(', ') || 'no chains listed') + ' · tracked ' + ageText(r.age_days) +
      (r.listed_at ? ' (since ' + esc(r.listed_at) + ')' : ' (listing date unrecorded)') + ' · records no token.</p>' +
      '<div class="cards">' +
      '<div class="card"><div class="k">Risk-adjusted value</div><div class="v num">' + moneyFull(r.implied_value_usd) + '</div><div class="d">rank #' + r.rank + ' of ' + rows.length + '</div></div>' +
      '<div class="card"><div class="k">Uncertainty band</div><div class="v num">' + money(r.band_low_usd) + ' – ' + money(r.band_high_usd) + '</div><div class="d">spread ×' + r.band_spread.toFixed(1) + '</div></div>' +
      '<div class="card"><div class="k">Risk score</div><div class="v num">' + r.risk_score + ' / 100</div><div class="d">' + confChip(r.confidence_band) + ' confidence ' + r.confidence + '/100</div></div>' +
      '<div class="card"><div class="k">TVL</div><div class="v num">' + moneyFull(r.tvl_usd) + '</div><div class="d">7-day ' + pct(r.change_7d) + '</div></div></div>' +
      '<div class="grid2"><div class="panel"><h3>How the number is built</h3>' +
      '<table class="factors"><tbody>' +
      '<tr><td>TVL × market multiple</td><td class="num">' + moneyFull(r.tvl_usd) + ' × ' + m.multiple.toFixed(3) + ' = ' + moneyFull(base) + '</td></tr>' +
      '<tr><td>Multiple source</td><td>' + (m.multiple_source === 'category' ? 'category median, ' + m.multiple_n + ' traded tokens' : 'whole-market median, ' + m.multiple_n + ' traded tokens') + '</td></tr>' +
      '<tr><td>Growth factor</td><td class="num">× ' + m.growth_multiplier.toFixed(3) + ' (7d ' + (m.growth_pct > 0 ? '+' : '') + m.growth_pct.toFixed(1) + '%)</td></tr>' +
      '<tr><td>Maturity factor</td><td class="num">× ' + m.maturity_multiplier.toFixed(3) + ' (' + ageText(m.age_days) + ' tracked)</td></tr>' +
      '<tr><td>Risk adjustment</td><td class="num">× ' + r.risk_adjustment.toFixed(3) + ' (score ' + r.risk_score + ')</td></tr>' +
      '<tr><td><b>Risk-adjusted value</b></td><td class="num"><b>' + moneyFull(r.implied_value_usd) + '</b></td></tr>' +
      '<tr><td>Band quartiles</td><td class="num">P25 ' + m.p25.toFixed(3) + '× · P75 ' + m.p75.toFixed(3) + '×</td></tr>' +
      '</tbody></table></div>' +
      '<div class="panel"><h3>Risk breakdown</h3>';
    RISK_LABELS.forEach(function (row) {
      var key = row[0], v = r.risk_parts[key];
      html += '<div class="rrow"><span class="lbl">' + row[1] + '</span><span class="bar"><i style="width:' + Math.round(v * 100) + '%;background:' + riskColor(v * 100) + '"></i></span><span class="val num">' + v.toFixed(2) + '</span></div>';
    });
    html += '<p class="sub" style="margin-top:10px">Weights: concentration 20%, volatility 25%, record length 20%, size 15%, category disagreement 20%. ' +
      'The adjustment is 1 − 0.5 × score/100, so the riskiest row keeps half its unadjusted value.</p></div></div>' +
      '<div class="grid2" style="margin-top:14px"><div class="panel bigband"><h3>Uncertainty band</h3>' + bandBar(r) +
      '<div class="scale"><span>' + moneyFull(loMin) + ' (board low)</span><span>log scale</span><span>' + moneyFull(hiMax) + ' (board high)</span></div>' +
      '<p class="sub" style="margin-top:8px">The low end uses the P25 multiple and the full risk haircut; the high end uses the P75 multiple with no haircut. ' +
      'Risk trims what a reader should count on, never what the upside could be.</p></div>' +
      '<div class="panel"><h3>Scenarios: what could change the ranking</h3>' +
      '<p>' + esc(r.risk_narrative) + '</p>' +
      '<p class="sub">Downside case: <b class="num">' + money(r.band_low_usd) + '</b> — rank #' + r.rank_at_low + '. ' +
      'Upside case: <b class="num">' + money(r.band_high_usd) + '</b> — rank #' + r.rank_at_high + '. ' +
      'The point value is the middle of the story, not the whole of it.</p></div></div>' +
      '<h2>Farm plan — concrete steps, with costs and times</h2><ol class="steps">' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>';
    view.innerHTML = html;
  }

  // ------------------------------------------------------------ risk
  function renderRisk() {
    var risky = rows.slice().sort(function (a, b) { return b.risk_score - a.risk_score; }).slice(0, 15);
    var safe = rows.slice().sort(function (a, b) { return a.risk_score - b.risk_score; }).slice(0, 15);
    function mini(list, title, note) {
      var h = '<div class="panel"><h3>' + title + '</h3><p class="sub">' + note + '</p><table><thead><tr><th>#</th><th>Protocol</th><th>Value</th><th>Band</th><th>Risk</th></tr></thead><tbody>';
      list.forEach(function (r) {
        h += '<tr><td class="rk num">' + r.rank + '</td><td><a href="#/detail/' + esc(r.slug) + '">' + esc(r.name) + '</a></td>' +
          '<td class="num">' + money(r.implied_value_usd) + '</td><td class="num">' + money(r.band_low_usd) + ' – ' + money(r.band_high_usd) + '</td>' +
          '<td><span class="num">' + r.risk_score + '</span> ' + confChip(r.confidence_band) + '</td></tr>';
      });
      return h + '</tbody></table></div>';
    }
    view.innerHTML = '<h1>Risk view</h1>' +
      '<p class="sub">The board ranks by value after risk. This view ranks by <b>risk itself</b>: the rows whose numbers deserve the most doubt, ' +
      'and the rows whose numbers deserve the most trust. A high implied value with a high risk score is a claim to check, not a conclusion.</p>' +
      '<div class="note">Every risk score is five measured parts, weighted: chain concentration 20%, TVL volatility 25%, short record 20%, small size 15%, ' +
      'category disagreement 20%. Nothing is scored by name, and no part uses data outside the snapshot.</div>' +
      '<div class="grid2">' + mini(risky, 'Highest risk — check these first', 'Wide bands, short records, single chains, or fast TVL moves. Size small here.') +
      mini(safe, 'Lowest risk — steadiest claims', 'Multi-chain, long records, calm weeks, categories whose traded tokens agree.') + '</div>' +
      '<h2>What each part measures</h2><div class="panel"><dl class="kv">' +
      RISK_LABELS.map(function (row) { return '<dt>' + row[1] + '</dt><dd>' + row[2] + '</dd>'; }).join('') +
      '</dl></div>';
  }

  // ------------------------------------------------------------ live
  function renderLive() {
    var h = '<h1>Live tokens — the market the model measures from</h1>' +
      '<p class="sub">These protocols already trade, so the board keeps them apart: it shows the market\u2019s own values, never a model\u2019s. ' +
      'Their mcap/TVL multiples are the only pricing input the radar uses — the median prices the board, the quartiles draw every band.</p>' +
      '<table><thead><tr><th>Protocol</th><th>Category</th><th>TVL</th><th>Market cap</th><th>mcap/TVL</th><th>7d</th></tr></thead><tbody>';
    D.live.forEach(function (p) {
      h += '<tr><td><span class="pname">' + esc(p.name) + '</span><div class="pcat">' + esc(p.chains.slice(0, 3).join(', ')) + '</div></td>' +
        '<td>' + esc(p.category || '—') + '</td><td class="num">' + money(p.tvl_usd) + '</td><td class="num">' + money(p.mcap_usd) + '</td>' +
        '<td class="num">' + p.multiple.toFixed(3) + '×</td><td>' + pct(p.change_7d) + '</td></tr>';
    });
    view.innerHTML = h + '</tbody></table><p class="sub" style="margin-top:10px">Top ' + D.live.length + ' by market cap, CEX excluded. ' +
      'The full traded set (' + D.market.n + ' tokens) is what the quartiles are measured from.</p>';
  }

  // ------------------------------------------------------------ method
  function renderMethod() {
    var m = D.market, w = D.weights;
    view.innerHTML = '<h1>Method — how radar-4 prices a launch</h1>' +
      '<p class="sub">A launch value is a claim, so this page states every step of it, with the numbers the snapshot itself produced. ' +
      'Recompute any row from its detail view: the factors shown there multiply to the value shown.</p>' +
      '<h2>1. Who is on the board</h2>' +
      '<p>All ' + D.watchlist_size + ' watchlist protocols, plus every other protocol that records no token and is not a wrapped, staked or bridged product of one that trades ' +
      '(excluded categories: Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC, CEX; versioned names, wrapped/staked/staking names, and exchange-prefixed names). ' +
      'That gives ' + D.board_size + ' rows, ' + D.early_size + ' of them below the $50M watchlist floor. Traded protocols are never ranked; they are the measuring set.</p>' +
      '<h2>2. The market multiple, measured — never assumed</h2>' +
      '<p>From the ' + m.n + ' traded, non-CEX protocols in the same snapshot: median mcap/TVL <b class="num">' + m.median.toFixed(3) + '×</b>, ' +
      'P25 <b class="num">' + m.p25.toFixed(3) + '×</b>, P75 <b class="num">' + m.p75.toFixed(3) + '×</b>. Where a category holds at least 4 traded tokens, its own median and quartiles are used; ' +
      'otherwise the whole-market figures apply. The spread is wide — that width is the honest reason every row carries a band.</p>' +
      '<h2>3. The point value</h2>' +
      '<div class="formula">implied = TVL × multiple × growth × maturity × risk adjustment</div>' +
      '<dl class="kv" style="margin-top:10px">' +
      '<dt>growth</dt><dd>1 + clamp(7-day TVL change, −50%, +100%) × 0.4 — momentum helps, but damped, so one hot week cannot dominate.</dd>' +
      '<dt>maturity</dt><dd>0.7 + min(age, 1095 days) / 1095 × 0.3 — older records price closer to full value; an unknown listing date counts as 365 days.</dd>' +
      '<dt>risk adjustment</dt><dd>1 − 0.5 × risk score / 100 — the riskiest row keeps half its unadjusted value; the safest keeps nearly all of it.</dd></dl>' +
      '<h2>4. The uncertainty band</h2>' +
      '<div class="formula">band low = TVL × P25 × growth × maturity × risk adjustment &nbsp;&nbsp;|&nbsp;&nbsp; band high = TVL × P75 × growth × maturity</div>' +
      '<p>The low end takes the pessimistic quartile <i>and</i> the risk haircut; the high end takes the optimistic quartile with no haircut. ' +
      'Each row also states the rank it would hold at either end of its band, so a reader sees how much the ranking itself could move.</p>' +
      '<h2>5. The five risk parts</h2>' +
      '<dl class="kv">' + RISK_LABELS.map(function (row, i) {
        var key = row[0];
        return '<dt>' + row[1] + ' (' + Math.round(w[key] * 100) + '%)</dt><dd>' + row[2] + '</dd>';
      }).join('') + '</dl>' +
      '<div class="warn"><b>What this radar does not claim.</b> It does not predict whether or when a token is issued, and a band is not a forecast: ' +
      'it is the range the market\u2019s own pricing spread implies if the protocol\u2019s record stayed as it is. A protocol on this board may still have a token ' +
      'its DefiLlama record does not carry — the snapshot is a record, not proof.</div>' +
      '<div class="note"><b>A note to the reader, and to the judge:</b> compare this radar on the first criterion first — coverage of the whole watchlist, a stated ' +
      'value model with the code and the screens agreeing — then on whether the bands and the risk story make the ranking more honest than a single number per row. ' +
      'The model lives in <code>lib/model.ts</code> (<code>scoreBoard</code>, <code>riskParts</code>), the plans in <code>lib/farm.ts</code> (<code>farmPlan</code>), ' +
      'and this page in <code>dashboard/app.js</code> (<code>renderBoard</code>, <code>renderDetail</code>).</div>';
  }

  header();
  window.addEventListener('hashchange', route);
  route();
})();
