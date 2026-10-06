(function () {
  const L = listening;
  const esc = window.PageUtils.escapeHtml;
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const DAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const COUNTRY = {
    JP: 'Japan', US: 'United States', SG: 'Singapore', MY: 'Malaysia', GB: 'United Kingdom', FR: 'France',
    DE: 'Germany', HK: 'Hong Kong', NP: 'Nepal', TH: 'Thailand', KR: 'South Korea', GR: 'Greece',
    RO: 'Romania', CA: 'Canada', IN: 'India', TR: 'Türkiye',
  };
  const SHORT = { 'Johann Sebastian Bach': 'Bach', 'Ludwig van Beethoven': 'Beethoven', 'Franz Liszt': 'Liszt' };
  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

  const short = (name) => SHORT[name] || name;
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const nf = (x, d = 0) => Number(x).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  const hrs = (h) => `${h >= 100 ? nf(h) : nf(h, 1)} h`;
  const pct = (x, d = 0) => `${nf(Math.round(x * 100 * 10 ** d + 1e-9) / 10 ** d, d)}%`;
  const mins = (h) => `${Math.round(h * 60)} min`;
  const dlab = (s) => { const [y, m, d] = s.split('-'); return `${MON[+m - 1]} ${+d}, ${y}`; };
  const ymlab = (s) => { const [y, m] = s.split('-'); return `${MON[+m - 1]} ${y}`; };
  const $ = (id) => document.getElementById(id);
  const set = (id, text) => { $(id).textContent = text; };
  const sumBy = (list, f) => list.reduce((a, x) => a + f(x), 0);

  const T = L.totals;
  const M = L.meta;
  const YEARS = L.years;
  const YR = Object.fromEntries(L.yearly.map((r) => [r.year, r]));
  const US = L.eras.US;
  const JP = L.eras.JP;
  const gUS = L.clock.US_all;
  const gJP = L.clock.JP_all;
  const firstYear = YEARS[0];
  const lastYear = YEARS[YEARS.length - 1];
  const regularYear = +US.regular_from.slice(0, 4);
  const perDayRatio = JP.hours_per_day_regular / US.hours_per_day_regular;
  const EVEN_WEEKEND = 2 / 7;

  // ------------------------------------------------------------ tooltip
  const tip = $('ls-tip');
  const KEYS = { music: 'var(--music)', podcast: 'var(--podcast)', all: 'var(--all)', ink: 'var(--ink)' };
  function placeTip(e) {
    let x;
    let y;
    if (e.type && e.type.indexOf('pointer') === 0) { x = e.clientX; y = e.clientY; }
    else { const r = e.currentTarget.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top; }
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const vw = document.documentElement.clientWidth;
    let left = x + 14;
    let top = y - th - 14;
    if (left + tw > vw - 8) left = Math.max(8, x - tw - 14);
    if (top < 8) top = Math.min(window.innerHeight - th - 8, y + 18);
    tip.style.left = `${left}px`;
    tip.style.top = `${top}px`;
  }
  function showTip(e, data) {
    tip.innerHTML = `<div class="tip-t">${esc(data.title)}</div>${data.rows
      .filter((r) => r.v)
      .map((r) => `<div class="tip-r"><span class="tip-k${KEYS[r.c] ? '' : ' none'}"${KEYS[r.c] ? ` style="background:${KEYS[r.c]}"` : ''}></span>`
        + `<span class="tip-v">${esc(r.v)}</span>${r.l ? `<span class="tip-l">${esc(r.l)}</span>` : ''}</div>`)
      .join('')}`;
    tip.hidden = false;
    placeTip(e);
  }
  const hideTip = () => { tip.hidden = true; };
  function bindTip(node, get, enter, leave) {
    node.addEventListener('pointerenter', (e) => { if (enter) enter(); showTip(e, get()); });
    node.addEventListener('pointermove', placeTip);
    node.addEventListener('pointerleave', (e) => { if (leave) leave(); if (e.pointerType !== 'touch') hideTip(); });
    node.addEventListener('focus', (e) => showTip(e, get()));
    node.addEventListener('blur', hideTip);
  }
  function bindDataTips(root) {
    root.querySelectorAll('[data-tt]').forEach((n) => bindTip(n, () => ({
      title: n.dataset.tt,
      rows: [{ c: n.dataset.tc, v: n.dataset.tv, l: n.dataset.tl }, { v: n.dataset.tv2, l: n.dataset.tl2 }],
    })));
  }
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('[data-tt],[data-tip]')) hideTip(); });
  window.addEventListener('scroll', hideTip, { passive: true });
  const tipAttrs = (title, value, label, key, value2, label2) => ` data-tt="${esc(title)}" data-tv="${esc(value)}" data-tl="${esc(label)}"`
    + `${key ? ` data-tc="${key}"` : ''}${value2 ? ` data-tv2="${esc(value2)}" data-tl2="${esc(label2)}"` : ''}`;

  // ------------------------------------------------------------ copy helpers
  function timesPhrase(ratio, unit) {
    if (ratio >= 1.75 && ratio < 2.1) return `almost twice as ${unit}`;
    if (ratio >= 2.1) return `${nf(ratio, 1)} times as ${unit}`;
    return `${nf(ratio, 1)} times as ${unit}`;
  }
  function changePhrase(ratio) {
    if (ratio >= 1.75 && ratio < 2.1) return 'nearly doubled';
    if (ratio >= 2.1) return `grew ${nf(ratio, 1)}-fold`;
    if (ratio >= 1.1) return `rose ${pct(ratio - 1)}`;
    if (ratio > 0.9) return 'held steady';
    return `fell ${pct(1 - ratio)}`;
  }
  function season(iso) {
    const m = +iso.slice(5, 7);
    return ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'][m - 1];
  }
  function joinList(parts) {
    if (parts.length <= 1) return parts.join('');
    return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  }
  function leaderSentence(name, years) {
    const runs = [];
    years.forEach((y) => {
      const last = runs[runs.length - 1];
      if (last && y === last[1] + 1) last[1] = y; else runs.push([y, y]);
    });
    const fmt = (r) => (r[0] === r[1] ? `${r[0]}` : `${r[0]}–${r[1]}`);
    const current = runs.find((r) => r[1] === lastYear);
    const past = runs.filter((r) => r !== current);
    const pastText = past.length === 2 ? `${fmt(past[0])} and again in ${fmt(past[1])}` : joinList(past.map(fmt));
    let text = past.length ? `${short(name)} led ${pastText}` : short(name);
    if (current) {
      const now = current[0] === current[1] ? `leads ${lastYear} so far` : `has led since ${current[0]}`;
      text += past.length ? ` and ${now}` : ` ${now}`;
    }
    return `${text}.`;
  }

  // ------------------------------------------------------------ header and summary
  const total = T.hours_all;
  const wholeDays = Math.floor(total / 24);
  const restHours = Math.round(total - wholeDays * 24);
  set('listening-subline', `Spotify · ${ymlab(M.first)} – ${ymlab(M.last)} · ${nf(T.streams_all)} streams`);
  $('hero-hours').innerHTML = `${esc(nf(total))}<span>hours</span>`;
  set('hero-sub', `${wholeDays} days and ${restHours} hours of sound, spread over ${nf(T.days_active)} of the ${nf(T.span_days)} days since my first stream.`);
  const jpUs = sumBy(L.countries.filter((c) => c.cc === 'JP' || c.cc === 'US'), (c) => c.hours) / total;
  const kpi = (label, value, sub) => `<div class="ls-kpi"><dt>${esc(label)}</dt><dd>${esc(value)}<small>${esc(sub)}</small></dd></div>`;
  $('kpis').innerHTML = [
    kpi('Music', hrs(T.hours_music), `${nf(T.plays_music)} plays of 30 s or more`),
    kpi('Podcasts', hrs(T.hours_podcast), `${nf(T.episodes)} episodes`),
    kpi('Artists', nf(T.artists), `${nf(T.artists_5plays)} with five or more plays`),
    kpi('Songs', nf(T.tracks), 'different titles'),
    kpi('Shows', nf(T.shows), 'podcasts played at least once'),
    kpi('Countries', String(T.countries), `${pct(jpUs)} of it in Japan and the US`),
  ].join('');

  // ------------------------------------------------------------ month by month
  const podYears = L.yearly.filter((r) => r.year >= regularYear);
  const takeoff = podYears.find((r) => r.hours_podcast >= 50);
  let majority = null;
  for (let i = podYears.length - 1; i >= 0 && podYears[i].podcast_share > 0.5; i -= 1) majority = podYears[i];
  set('take-months', [
    `Spotify became my everyday player in ${season(US.regular_from)} ${regularYear}.`,
    takeoff && majority ? `Podcasts took off in ${takeoff.year} and have outweighed music every year since ${majority.year}.` : '',
    `After my first stream from Japan on ${dlab(M.move_date)}, daily listening ${changePhrase(perDayRatio)}.`,
  ].filter(Boolean).join(' '));

  function barPath(x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h));
    if (!r) return `M${x},${y + h}V${y}H${x + w}V${y + h}Z`;
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  const NS = 'http://www.w3.org/2000/svg';
  function sv(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    Object.entries(attrs).forEach(([k, v]) => e.setAttribute(k, v));
    if (parent) parent.appendChild(e);
    return e;
  }
  function label(parent, x, y, text, anchor, cls) {
    const t = sv('text', { x, y, 'text-anchor': anchor || 'start' }, parent);
    if (cls) t.setAttribute('class', cls);
    t.textContent = text;
  }

  function drawMonthly(host) {
    const W = Math.floor(host.getBoundingClientRect().width);
    if (!W) return;
    const narrow = W < 600;
    const H = narrow ? 240 : 300;
    const m = { l: 28, r: 4, t: 42, b: 24 };
    const pw = W - m.l - m.r;
    const ph = H - m.t - m.b;
    const data = L.monthly;
    const peak = Math.max(...data.map((d) => d.music + d.podcast));
    const step = peak > 150 ? 50 : 25;
    const maxV = Math.max(step, Math.ceil(peak / step) * step);
    const Y = (v) => m.t + ph - (v / maxV) * ph;
    const bw = pw / data.length;
    const gap = bw >= 6 ? 2 : (bw >= 3 ? 1 : 0);
    const barW = Math.max(1, bw - gap);
    host.replaceChildren();
    const svg = sv('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, 'aria-hidden': 'true' }, host);
    const hl = sv('rect', { x: 0, y: m.t, width: bw, height: ph, class: 'hl', visibility: 'hidden' }, svg);
    for (let t = 0; t <= maxV; t += step) {
      const yy = Math.round(Y(t)) + 0.5;
      sv('line', { x1: m.l, x2: W - m.r, y1: yy, y2: yy, class: t ? 'grid' : 'axis' }, svg);
      label(svg, m.l - 6, yy + 3.5, String(t), 'end');
    }
    data.forEach((d, i) => {
      if (!d.m.endsWith('-01')) return;
      const yv = +d.m.slice(0, 4);
      if (narrow && yv % 2) return;
      const x = Math.round(m.l + i * bw) + 0.5;
      sv('line', { x1: x, x2: x, y1: m.t + ph, y2: m.t + ph + 4, class: 'axis' }, svg);
      label(svg, x + 3, H - 7, narrow ? `’${String(yv).slice(2)}` : String(yv), 'start');
    });
    const mi = data.findIndex((d) => d.m === M.move_date.slice(0, 7));
    if (mi >= 0) {
      const xs = m.l + (mi + (+M.move_date.slice(8, 10) - 1) / 31) * bw;
      const by = 18.5;
      [[m.l, xs - 3, 'UNITED STATES'], [xs + 3, W - m.r, 'JAPAN']].forEach(([a, b, t]) => {
        sv('line', { x1: a, x2: b, y1: by, y2: by, class: 'band' }, svg);
        sv('line', { x1: a + 0.5, x2: a + 0.5, y1: by, y2: by + 5, class: 'band' }, svg);
        sv('line', { x1: b - 0.5, x2: b - 0.5, y1: by, y2: by + 5, class: 'band' }, svg);
        label(svg, a, by - 7, t, 'start', 'band-t');
      });
      sv('line', { x1: Math.round(xs) + 0.5, x2: Math.round(xs) + 0.5, y1: by + 7, y2: m.t + ph, class: 'divider' }, svg);
    }
    const base = m.t + ph;
    data.forEach((d, i) => {
      const x = m.l + i * bw + gap / 2;
      const hm = (d.music / maxV) * ph;
      const hp = (d.podcast / maxV) * ph;
      const surfaceGap = hm >= 2.5 && hp >= 2.5 ? 2 : 0;
      if (hm >= 0.3) sv('path', { d: barPath(x, base - hm, barW, hm, hp >= 0.3 ? 0 : 3), class: 'b-music' }, svg);
      if (hp >= 0.3) sv('path', { d: barPath(x, base - hm - hp, barW, Math.max(0.5, hp - surfaceGap), 3), class: 'b-pod' }, svg);
    });
    const hit = sv('g', { 'data-tip': '' }, svg);
    data.forEach((d, i) => {
      const r = sv('rect', { x: m.l + i * bw, y: m.t, width: bw, height: ph + 2, fill: 'transparent', 'data-tip': '' }, hit);
      bindTip(r, () => ({
        title: ymlab(d.m),
        rows: [
          { c: 'podcast', v: hrs(d.podcast), l: 'podcasts' },
          { c: 'music', v: hrs(d.music), l: 'music' },
          { v: hrs(d.music + d.podcast), l: 'total' },
        ],
      }), () => { hl.setAttribute('x', m.l + i * bw); hl.setAttribute('visibility', 'visible'); },
      () => hl.setAttribute('visibility', 'hidden'));
    });
  }
  const monthlyHost = $('monthly-chart');
  let monthlyWidth = 0;
  const redrawMonthly = () => {
    const w = Math.floor(monthlyHost.getBoundingClientRect().width);
    if (w && w !== monthlyWidth) { monthlyWidth = w; drawMonthly(monthlyHost); }
  };
  redrawMonthly();
  if ('ResizeObserver' in window) new ResizeObserver(redrawMonthly).observe(monthlyHost);
  else window.addEventListener('resize', redrawMonthly);
  $('monthly-table').innerHTML = `<table><thead><tr><th>Month</th><th class="num">Music h</th><th class="num">Podcasts h</th><th class="num">Total h</th></tr></thead><tbody>${
    L.monthly.map((d) => `<tr><td>${ymlab(d.m)}</td><td class="num">${nf(d.music, 1)}</td><td class="num">${nf(d.podcast, 1)}</td><td class="num">${nf(d.music + d.podcast, 1)}</td></tr>`).join('')
  }</tbody></table>`;

  // ------------------------------------------------------------ two sides
  set('take-sides', `In the US years ${short(US.top_artists[0].name)} led and ${pct(US.night_share)} of my listening happened after midnight. `
    + `In Japan I listen ${timesPhrase(perDayRatio, 'long')} each day, and ${pct(JP.podcast_share)} of it is talk.`);
  const small = (s) => `<small>${esc(s)}</small>`;
  const lrow = (k, a, b) => `<div class="ls-lrow"><div class="k">${esc(k)}</div><div class="v">${a}</div><div class="v">${b}</div></div>`;
  $('ledger').innerHTML = [
    `<div class="ls-lrow head"><div class="k"></div><div class="v"><span class="ls-side">Side A</span>United States${small(`${ymlab(US.first)} – ${dlab(US.last)}`)}</div>`
      + `<div class="v"><span class="ls-side">Side B</span>Japan${small(`${dlab(JP.first)} – ${dlab(JP.last)}`)}</div></div>`,
    lrow('Listening per day', esc(mins(US.hours_per_day_regular)) + small(`average from ${ymlab(US.regular_from)}, when daily use began`),
      esc(mins(JP.hours_per_day_regular)) + small('average')),
    lrow('Podcasts’ share of time', esc(pct(US.podcast_share)), esc(pct(JP.podcast_share))),
    lrow('Music and podcasts', esc(`${hrs(US.hours_music)} music`) + small(`${hrs(US.hours_podcast)} podcasts`),
      esc(`${hrs(JP.hours_music)} music`) + small(`${hrs(JP.hours_podcast)} podcasts`)),
    lrow('Between midnight and 5 a.m.', esc(pct(US.night_share)), esc(pct(JP.night_share))),
    lrow('Saturdays and Sundays', esc(pct(US.weekend_share)) + small(`an even week would be ${pct(EVEN_WEEKEND)}`), esc(pct(JP.weekend_share))),
    lrow('Top artist', esc(US.top_artists[0].name) + small(hrs(US.top_artists[0].hours)), esc(JP.top_artists[0].name) + small(hrs(JP.top_artists[0].hours))),
    lrow('Top podcast', esc(US.top_shows[0].name) + small(hrs(US.top_shows[0].hours)), esc(JP.top_shows[0].name) + small(hrs(JP.top_shows[0].hours))),
    lrow('Artists played', esc(nf(US.artists)), esc(nf(JP.artists))),
  ].join('');

  // ------------------------------------------------------------ year by year
  const leaders = L.yearly.filter((r) => r.year >= regularYear && r.top_artists.length).map((r) => [r.year, r.top_artists[0].name]);
  const leadCount = {};
  leaders.forEach(([, n]) => { leadCount[n] = (leadCount[n] || 0) + 1; });
  const topLeaders = Object.entries(leadCount).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([n]) => n)
    .sort((a, b) => leaders.find(([, n]) => n === a)[0] - leaders.find(([, n]) => n === b)[0]);
  set('take-years', topLeaders.map((n) => leaderSentence(n, leaders.filter(([, x]) => x === n).map(([y]) => y))).join(' '));
  const maxYearTotal = Math.max(...L.yearly.map((r) => r.hours_music + r.hours_podcast));
  const maxYear = L.yearly.find((r) => r.hours_music + r.hours_podcast === maxYearTotal).year;
  $('year-table').innerHTML = `<table class="ls-ytable"><thead><tr><th>Year</th><th>Listening</th><th>Top artist</th><th>Most-played song</th><th>Top podcast</th><th class="num">New artists</th></tr></thead><tbody>${
    L.yearly.map((r) => {
      const tot = r.hours_music + r.hours_podcast;
      let note = '';
      if (r.year === firstYear) note = `${MON[+M.first.slice(5, 7) - 1]} ${+M.first.slice(8, 10)}–31 only`;
      if (r.year === lastYear) note = `through ${MON[+M.last.slice(5, 7) - 1]} ${+M.last.slice(8, 10)}`;
      const segs = `${r.hours_music > 0 ? `<span class="s-m" style="width:${(r.hours_music / maxYearTotal * 100).toFixed(2)}%"></span>` : ''}`
        + `${r.hours_podcast >= 0.5 ? `<span class="s-p" style="width:${(r.hours_podcast / maxYearTotal * 100).toFixed(2)}%"></span>` : ''}`;
      const ta = r.top_artists[0];
      const tt = r.top_tracks[0];
      const ts = r.top_shows[0] && r.top_shows[0].hours >= 1 ? r.top_shows[0] : null;
      return `<tr><td><span class="yr">${r.year}</span>${note ? small(note) : ''}</td>`
        + `<td class="hcell"><div class="stack" aria-hidden="true">${segs}</div>${esc(hrs(tot))}${small(`${hrs(r.hours_music)} music · ${hrs(r.hours_podcast)} podcasts`)}</td>`
        + `<td data-l="Top artist">${ta ? esc(ta.name) + small(hrs(ta.hours)) : '<span class="dim">—</span>'}</td>`
        + `<td data-l="Most-played song">${tt ? esc(tt.track) + small(`${tt.artist} · ${tt.plays} plays`) : '<span class="dim">—</span>'}</td>`
        + `<td data-l="Top podcast">${ts ? esc(ts.name) + small(hrs(ts.hours)) : '<span class="dim">—</span>'}</td>`
        + `<td class="num" data-l="New artists">${nf(r.new_artists)}</td></tr>`;
    }).join('')
  }</tbody></table>`;
  $('year-note').innerHTML = `<i class="key music"></i>Music <i class="key podcast" style="margin-left:12px"></i>Podcasts`
    + ` · Bars share one scale; the longest is ${esc(nf(maxYearTotal))} hours (${maxYear}). New artists are artists first played that year.`;

  // ------------------------------------------------------------ ranked lists with year strips
  const CW = 14;
  const GAP = 3;
  const CH = 14;
  const stripWidth = YEARS.length * CW + (YEARS.length - 1) * GAP;
  function strip(byYear, key, name) {
    const mx = Math.max(...byYear) || 1;
    return `<svg class="strip" width="${stripWidth}" height="${CH + 6}" viewBox="0 0 ${stripWidth} ${CH + 6}" aria-hidden="true">${
      YEARS.map((y, i) => {
        const v = byYear[i];
        const x = i * (CW + GAP);
        const o = v < 0.05 ? 0 : 0.14 + 0.86 * (v / mx);
        return `<g class="hc"${tipAttrs(`${name} · ${y}`, hrs(v), 'that year', key)}>`
          + `<rect class="hit" x="${x - GAP / 2}" y="0" width="${CW + GAP}" height="${CH + 6}"/>`
          + `<rect class="hb" x="${x}" y="3" width="${CW}" height="${CH}" rx="2"/>`
          + (o ? `<rect x="${x}" y="3" width="${CW}" height="${CH}" rx="2" style="fill:var(--${key});fill-opacity:${o.toFixed(2)}"/>` : '')
          + `<rect class="ring" x="${x + 0.5}" y="3.5" width="${CW - 1}" height="${CH - 1}" rx="2"/></g>`;
      }).join('')
    }</svg>`;
  }
  function stripHead() {
    const marks = [firstYear, firstYear + 3, firstYear + 6, firstYear + 9, lastYear].filter((y, i, a) => a.indexOf(y) === i && YEARS.includes(y));
    return `<svg class="strip-h" width="${stripWidth}" height="14" viewBox="0 0 ${stripWidth} 14" aria-hidden="true">${
      marks.map((y) => {
        const i = YEARS.indexOf(y);
        const anchor = i === 0 ? 'start' : (i === YEARS.length - 1 ? 'end' : 'middle');
        const x = anchor === 'start' ? i * (CW + GAP) : (anchor === 'end' ? i * (CW + GAP) + CW : i * (CW + GAP) + CW / 2);
        return `<text x="${x}" y="11" text-anchor="${anchor}">${y}</text>`;
      }).join('')
    }</svg>`;
  }
  function rankList(items, key, kind) {
    const mx = Math.max(...items.map((it) => it.hours));
    return `<div class="ls-row head"><span></span><span class="ls-label">${kind === 'artist' ? 'Artist' : 'Show'}</span>`
      + `<span class="ls-label hide-sm">Hours</span><span class="hide-sm">${stripHead()}</span></div>${
        items.map((it, n) => {
          const meta = kind === 'artist'
            ? `${nf(it.plays)} plays · ${nf(it.tracks)} songs · since ${it.first.slice(0, 4)}`
            : `${nf(it.episodes)} episodes · since ${ymlab(it.first)}`;
          const video = kind === 'show' && it.hours && it.video_hours / it.hours >= 0.5
            ? `<span class="ls-tag" title="${esc(pct(it.video_hours / it.hours))} watched as video">Video</span>` : '';
          return `<div class="ls-row"><span class="ls-rk">${n + 1}</span>`
            + `<div class="ls-id"><div class="ls-name">${esc(it.name)}${video}</div><div class="ls-meta">${esc(meta)}</div></div>`
            + `<div class="ls-bar"><span class="fill" style="--p:${(it.hours / mx).toFixed(4)};background:var(--${key})"></span><span class="val">${esc(hrs(it.hours))}</span></div>`
            + `<div class="strip-cell">${strip(it.by_year, key, it.name)}</div></div>`;
        }).join('')
      }`;
  }
  function byYearTable(items, head) {
    return `<table><thead><tr><th>${head}</th>${YEARS.map((y) => `<th class="num">${y}</th>`).join('')}</tr></thead><tbody>${
      items.map((it) => `<tr><td>${esc(it.name)}</td>${it.by_year.map((v) => `<td class="num">${nf(v, 1)}</td>`).join('')}</tr>`).join('')
    }</tbody></table>`;
  }
  const artists = L.top_artists.slice(0, 10);
  const [a0, a1] = artists;
  set('take-artists', `${short(a0.name)} and ${a1.name} together hold ${pct((a0.hours + a1.hours) / T.hours_music)} of my music time. `
    + `${short(a0.name)} cleared an hour in ${a0.years_active} of the ${YEARS.length} years, ${a1.name} in ${a1.years_active}.`);
  $('artist-list').innerHTML = rankList(artists, 'music', 'artist');
  $('artist-table').innerHTML = byYearTable(artists, 'Artist');

  // ------------------------------------------------------------ songs and albums
  const tracks = L.top_tracks.slice(0, 10);
  const t0 = tracks[0];
  const songName = t0.track === 'Goldberg Variations, BWV 988: Aria'
    ? 'the Aria from Bach’s Goldberg Variations' : `“${t0.track}” by ${t0.artist}`;
  const artistCounts = {};
  tracks.forEach((t) => { artistCounts[t.artist] = (artistCounts[t.artist] || 0) + 1; });
  const [domArtist, domCount] = Object.entries(artistCounts).sort((a, b) => b[1] - a[1])[0];
  const albumCounts = {};
  tracks.filter((t) => t.artist === domArtist && t.album).forEach((t) => { albumCounts[t.album] = (albumCounts[t.album] || 0) + 1; });
  const [domAlbum, domAlbumCount] = Object.entries(albumCounts).sort((a, b) => b[1] - a[1])[0] || [];
  let songTake = `My most-played song is ${songName}, at ${t0.plays} plays.`;
  if (domCount >= 3) {
    songTake += ` ${cap(WORDS[domCount] || String(domCount))} of the top ten are ${domArtist}`;
    songTake += domAlbumCount >= 2 ? `, ${WORDS[domAlbumCount] || domAlbumCount} of them from ${domAlbum}.` : '.';
  }
  set('take-songs', songTake);
  const span = (a, b) => (a.slice(0, 4) === b.slice(0, 4) ? a.slice(0, 4) : `${a.slice(0, 4)}–${b.slice(0, 4)}`);
  $('song-list').innerHTML = tracks.map((t, n) => `<li><span class="ls-rk">${n + 1}</span><span><span class="t">${esc(t.track)}</span><span class="a">${esc(t.artist)}</span></span>`
    + `<span class="n">${t.plays} plays<small>${span(t.first, t.last)}</small></span></li>`).join('');
  $('album-list').innerHTML = L.top_albums.slice(0, 8).map((a, n) => `<li><span class="ls-rk">${n + 1}</span><span><span class="t">${esc(a.album)}</span><span class="a">${esc(a.artist)}</span></span>`
    + `<span class="n">${esc(hrs(a.hours))}<small>since ${a.first.slice(0, 4)}</small></span></li>`).join('');

  // ------------------------------------------------------------ podcasts
  const shows = L.top_shows.slice(0, 10);
  const s0 = shows[0];
  const s0video = s0.video_hours / s0.hours;
  set('take-podcasts', `${nf(T.hours_podcast)} hours across ${nf(T.shows)} shows. ${s0.name} alone is ${nf(s0.hours)} hours`
    + (s0video >= 0.5 ? `, and ${pct(s0video)} of that was watched as video.` : '.'));
  $('show-list').innerHTML = rankList(shows, 'podcast', 'show');
  $('show-table').innerHTML = byYearTable(shows, 'Show');

  // ------------------------------------------------------------ daily rhythm
  const gridTotal = (g) => g.grid.reduce((a, row) => a + row.reduce((b, v) => b + v, 0), 0);
  const gmax = Math.max(...[gUS, gJP].map((g) => Math.max(...g.grid.flat()) / gridTotal(g)));
  function heatmap(era, g) {
    const tot = gridTotal(g);
    const weeks = L.eras[era].weeks_regular;
    const who = era === 'US' ? 'US-years' : 'Japan-years';
    const cells = ['<span></span>'].concat(Array.from({ length: 24 }, (_, h) => `<span class="hm-h">${h % 6 === 0 ? String(h).padStart(2, '0') : ''}</span>`));
    g.grid.forEach((row, d) => {
      cells.push(`<span class="hm-d">${DAYS[d]}</span>`);
      row.forEach((v, h) => {
        const share = v / tot;
        const o = v <= 0 ? 0 : 0.06 + 0.94 * share / gmax;
        const perWeek = v / weeks * 60;
        cells.push(`<span class="hm-cell" style="--o:${o.toFixed(3)}"${tipAttrs(
          `${DAYS_LONG[d]} · ${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00`,
          pct(share, 1), `of ${who} listening`, 'ink', perWeek < 1 ? 'under 1 min' : `${Math.round(perWeek)} min`, 'a week, on average',
        )}></span>`);
      });
    });
    return `<div class="hm" role="img" aria-label="${esc(who)} listening by weekday and hour">${cells.join('')}</div>`;
  }
  const cstats = (g) => `<div class="ls-cstats"><span><b>${pct(g.night_share)}</b>after midnight</span>`
    + `<span><b>${pct(g.weekend_share)}</b>on weekends</span><span><b>${String(g.peak_hour).padStart(2, '0')}:00</b>busiest hour</span></div>`;
  $('clocks').innerHTML = `<figure class="ls-panel"><h3>Side A · United States<small>${ymlab(US.first)} – ${ymlab(US.last)}, Pacific time</small></h3>${heatmap('US', gUS)}${cstats(gUS)}</figure>`
    + `<figure class="ls-panel"><h3>Side B · Japan<small>${ymlab(JP.first)} – ${ymlab(JP.last)}, Japan time</small></h3>${heatmap('JP', gJP)}${cstats(gJP)}</figure>`;
  set('scale-max', `${pct(gmax, 1)} of that side’s listening in one weekday-hour`);
  const usWeekend = US.weekend_share > EVEN_WEEKEND + 0.02 ? ', and weekends ran heavier' : '';
  const jpEven = Math.abs(JP.weekend_share - EVEN_WEEKEND) <= 0.02 ? ' and every day of the week looks about the same' : '';
  set('take-clock', `In the US years, ${pct(US.night_share)} of my listening happened between midnight and 5 a.m.${usWeekend}. `
    + `In Japan that share ${JP.night_share < US.night_share ? 'fell' : 'rose'} to ${pct(JP.night_share)}${jpEven}.`);
  const profile = (g) => Array.from({ length: 24 }, (_, h) => g.grid.reduce((a, row) => a + row[h], 0) / gridTotal(g));
  const pUS = profile(gUS);
  const pJP = profile(gJP);
  $('hour-table').innerHTML = `<table><thead><tr><th>Hour</th><th class="num">United States</th><th class="num">Japan</th></tr></thead><tbody>${
    pUS.map((v, h) => `<tr><td>${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00</td><td class="num">${pct(v, 1)}</td><td class="num">${pct(pJP[h], 1)}</td></tr>`).join('')
  }</tbody></table>`;

  // ------------------------------------------------------------ habits
  const HY = YEARS.filter((y) => y >= regularYear);
  const HABITS = [
    ['hours_per_day', 'Listening per day', 'Music and podcasts per calendar day', 'all', (v) => `${Math.round(v * 60)} min`],
    ['podcast_share', 'Podcasts’ share', 'Share of all listening time', 'podcast', (v) => pct(v)],
    ['night_share', 'After midnight', 'Share of listening from 00:00 to 05:00', 'all', (v) => pct(v)],
    ['skip_rate', 'Songs skipped', 'Share of songs ended by pressing Next', 'music', (v) => pct(v)],
    ['shuffle_share', 'Shuffle', 'Share of music time with shuffle on', 'music', (v) => pct(v)],
    ['new_artist_share', 'First-year artists', 'Share of music time on artists first played that year', 'music', (v) => pct(v)],
  ];
  $('habit-charts').innerHTML = HABITS.map(([key, title, sub, color, f]) => {
    const vals = HY.map((y) => YR[y][key]);
    const mx = Math.max(...vals) || 1;
    const pk = HY[vals.indexOf(Math.max(...vals))];
    return `<figure class="ls-panel ls-mini"><h3>${esc(title)}</h3><p>${esc(sub)}</p>`
      + `<div class="ls-mini-fig"><b>${esc(f(vals[vals.length - 1]))}</b><span>in ${HY[HY.length - 1]} so far · peak ${esc(f(Math.max(...vals)))} in ${pk}</span></div>`
      + `<div class="mc" role="img" aria-label="${esc(title)} by year, ${HY[0]} to ${HY[HY.length - 1]}">${
        HY.map((y, i) => `<span class="mc-col"${tipAttrs(String(y), f(vals[i]), title.toLowerCase(), color)}><i style="height:${Math.max(vals[i] / mx * 100, 1.5).toFixed(1)}%;background:var(--${color})"></i></span>`).join('')
      }</div><div class="mc-x"><span>${HY[0]}</span><span>${HY[HY.length - 1]}</span></div></figure>`;
  }).join('');
  $('habit-table').innerHTML = `<table><thead><tr><th>Year</th>${HABITS.map(([, t]) => `<th class="num">${esc(t)}</th>`).join('')}</tr></thead><tbody>${
    HY.map((y) => `<tr><td>${y}</td>${HABITS.map(([k, , , , f]) => `<td class="num">${esc(f(YR[y][k]))}</td>`).join('')}</tr>`).join('')
  }</tbody></table>`;
  const shuffleVals = HY.map((y) => YR[y].shuffle_share);
  const shuffleMax = Math.max(...shuffleVals);
  const shuffleMin = Math.min(...shuffleVals);
  const skipVals = HY.map((y) => YR[y].skip_rate);
  const skipTop = Math.max(...skipVals);
  const skipYears = HY.filter((y) => YR[y].skip_rate >= skipTop - 0.03);
  const skipRange = skipYears.length > 1 ? `${skipYears[0]}–${skipYears[skipYears.length - 1]}` : `${skipYears[0]}`;
  const newShares = HY.filter((y) => y > regularYear).map((y) => YR[y].new_artist_share).sort((a, b) => a - b);
  const newMedian = newShares[Math.floor(newShares.length / 2)];
  const fifth = newMedian >= 0.17 && newMedian <= 0.23 ? 'about a fifth' : `about ${pct(newMedian)}`;
  set('take-habits', `Shuffle peaked at ${pct(shuffleMax)} of music time in ${HY[shuffleVals.indexOf(shuffleMax)]} and fell to ${pct(shuffleMin)} in ${HY[shuffleVals.indexOf(shuffleMin)]}. `
    + `Skipping peaked in ${skipRange}, and ${fifth} of each year’s music goes to artists I first played that year.`);

  // ------------------------------------------------------------ records
  const bd = L.biggest_day;
  const [bdKey, bdHours] = Object.entries(bd.top).sort((a, b) => b[1] - a[1])[0];
  const bdName = short(bdKey.split('|').slice(1).join('|'));
  set('take-records', `The heaviest day on record was ${dlab(bd.date)}, with ${nf(bd.hours, 1)} hours of listening, ${nf(bdHours, 1)} of them ${bdName}.`);
  const rep = L.repeat_days[0];
  const binge = L.binges[0];
  const firstSong = L.firsts.first_track;
  const firstParts = firstSong.track.split(': ');
  const firstTitle = firstParts[firstParts.length - 1];
  const firstWork = firstParts.slice(0, -1).join(': ');
  const jpSong = L.firsts.first_track_japan;
  const rec = (labelText, big, det) => `<div class="ls-rec"><div class="ls-label">${esc(labelText)}</div><div class="big">${esc(big)}</div><div class="det">${esc(det)}</div></div>`;
  $('record-grid').innerHTML = [
    rec('Heaviest day', dlab(bd.date), `${nf(bd.hours, 1)} hours of listening, ${nf(bdHours, 1)} of them ${bdName}`),
    rec('One song on repeat', `${rep.plays} plays of “${rep.track}”`, `${rep.artist} · ${dlab(rep.date)}, all in one day`),
    rec('Biggest month for one artist', `${nf(binge.hours)} hours of ${short(binge.artist)}`, `${binge.artist} · ${ymlab(binge.month)}, ${pct(binge.share)} of that month’s music`),
    rec('Longest daily streak', `${L.streak.days} days in a row`, `${dlab(L.streak.start)} – ${dlab(L.streak.end)}`),
    rec('First song on record', firstTitle, `${firstWork ? `${firstWork} · ` : ''}${firstSong.artist} · ${dlab(firstSong.date)}`),
    jpSong ? rec('First song streamed in Japan', jpSong.track, `${jpSong.artist} · ${dlab(jpSong.date)}`) : '',
  ].join('');
  $('lost-list').innerHTML = L.lost.slice(0, 10).map((l) => `<li><span><span class="t">${esc(l.track)}</span><span class="a">${esc(l.artist)}</span></span>`
    + `<span class="n">${l.plays} plays<small>last ${ymlab(l.last)}</small></span></li>`).join('');
  set('country-note', `${T.countries} countries, by hours streamed.`);
  $('country-chips').innerHTML = L.countries.map((c) => `<span class="ls-chip">${esc(COUNTRY[c.cc] || c.cc)}<b>${c.hours >= 1 ? esc(hrs(c.hours)) : '&lt;1 h'}</b></span>`).join('');

  // ------------------------------------------------------------ notes
  const notes = [
    `Source: my Spotify Extended Streaming History export (audio and video files), ${nf(M.rows_raw)} rows from ${dlab(M.first)} to ${dlab(M.last)}.`,
    `Removed ${nf(M.dupes)} exact duplicate rows and ${nf(M.audiobook_or_other_rows)} rows that were neither songs nor podcast episodes (muted music-video clips and audiobook previews).`,
    'Hours count all playback time. A play is a stream of at least 30 seconds, Spotify’s own threshold. Song rankings use plays; artist and podcast rankings use hours.',
    M.capped_streams ? `${cap(WORDS[M.capped_streams] || String(M.capped_streams))} video-podcast stream${M.capped_streams === 1 ? '' : 's'} logged impossible lengths, up to ${nf(M.capped_max_hours)} hours for a single episode. Each was capped at 4 hours, which removed ${nf(M.capped_hours_removed, 1)} hours.` : '',
    `Spotify logs the moment each stream ended, in UTC. Every stream is shown in the local time of the country it was played in, with US streams in Pacific time, where nearly all of them happened. Offline plays only get logged when the phone next syncs, so ${nf(M.offline_retimed)} of them (${nf(M.offline_hours, 1)} hours) were moved back to when they were actually played. The clock spreads each stream across the hours it covered.`,
    `Side A and Side B split at my first stream from Japan. Per-day averages for Side A start in ${ymlab(US.regular_from)}; before that Spotify saw only occasional use.`,
    'The artist is the album artist Spotify records, so classical recordings usually count under the composer. Songs with the same title and artist count together across releases and recordings.',
    `Habit charts start in ${regularYear} because the years before it hold too few songs. ${lastYear} runs through ${dlab(M.last)}. Last rebuilt ${dlab(M.built)}.`,
  ].filter(Boolean);
  $('notes-list').innerHTML = notes.map((n) => `<li>${esc(n)}</li>`).join('');

  bindDataTips(document);
})();
