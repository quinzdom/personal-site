/*
 * Road Trip Planner
 * Canvas map of the lower 48. Add stops by search or by tapping the map; each leg follows
 * the fastest highway route (router.js). The trip is saved in this browser and in the page link.
 */
(function () {
  'use strict';

  var DATA = window.RoadTripData, Router = window.RoadRouter;
  var graph = Router.decode(DATA.roads);
  var P = DATA.places, NPL = P.name.length;
  var STORE_KEY = 'roadtrip:v1';
  var MAX_STOPS = 60;
  // Trip cost assumptions (prices as of Oct 5, 2026)
  var GAS_PRICE = 4.37;       // $/gal, AAA US average regular
  var GAS_MPG = 27;           // typical US car
  var KWH_PRICE = 0.625;      // $/kWh, US average Tesla Supercharger, non-member
  var MODEL_Y_KWH_MI = 0.28;  // Tesla Model Y at highway speeds
  var STATES = 'AL AZ AR CA CO CT DE DC FL GA ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' ');

  function $(id) { return document.getElementById(id); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
  function fmtMiles(m) { return Math.round(m).toLocaleString('en-US'); }
  function fmtTime(min) {
    min = Math.round(min);
    var h = Math.floor(min / 60), m = min % 60;
    return h ? (m ? h + ' h ' + m + ' m' : h + ' h') : m + ' m';
  }
  function norm(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/\bsaint\b/g, 'st').replace(/\bmount\b/g, 'mt').replace(/\bfort\b/g, 'ft')
      .replace(/[.'’,()]/g, '').replace(/\s+/g, ' ').trim();
  }
  function shortName(name) { return name.replace(/ National Park$/, ' NP'); }

  // ---------------------------------------------------------------- places + search
  var pNorm = [], cities = [], parks = [];
  for (var i = 0; i < NPL; i++) {
    pNorm[i] = norm(P.name[i]).replace(/ national park$/, '');
    if (P.k[i] === 0 && P.lb[i]) cities.push(i); else if (P.k[i] === 1) parks.push(i);
  }
  cities.sort(function (a, b) { return P.pop[b] - P.pop[a]; });

  function search(raw) {
    var q = norm(raw), st = null, m = q.match(/^(.+?)[\s,]+([a-z]{2})$/);
    if (m && STATES.indexOf(m[2].toUpperCase()) >= 0) { q = m[1]; st = m[2].toUpperCase(); }
    if (!q) return [];
    var res = [];
    for (var i = 0; i < NPL; i++) {
      if (st && P.st[i] !== st) continue;
      var nm = pNorm[i];
      var score = nm === q ? 3 : nm.lastIndexOf(q, 0) === 0 ? 2 : nm.indexOf(' ' + q) >= 0 ? 1 : 0;
      // parks and landmarks outrank towns of the same name
      if (score) res.push([score, P.k[i] === 1 ? 2e6 : P.k[i] === 2 ? 4e5 : P.pop[i], i]);
    }
    res.sort(function (a, b) { return b[0] - a[0] || b[1] - a[1]; });
    return res.slice(0, 8).map(function (r) { return r[2]; });
  }
  function placeToStop(i) { return { name: P.name[i], st: P.st[i], k: P.k[i], x: P.x[i], y: P.y[i] }; }
  function nearestPlace(x, y, minPop) {
    var best = -1, bd = Infinity;
    for (var i = 0; i < NPL; i++) {
      if (P.k[i] === 0 && P.pop[i] < minPop) continue;
      var dx = P.x[i] - x, dy = P.y[i] - y, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return { i: best, d: Math.sqrt(bd) };
  }

  // ---------------------------------------------------------------- map shapes
  var B = DATA.basemap;
  function ringsToPath(rings, path) {
    rings.forEach(function (a) {
      var x = 0, y = 0;
      for (var i = 0; i < a.length; i += 2) {
        x += a[i]; y += a[i + 1];
        if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
      }
      path.closePath();
    });
    return path;
  }
  var bounds = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  var states = new Path2D(), neighbors = ringsToPath(B.nb, new Path2D()), lakes = ringsToPath(B.lakes, new Path2D());
  B.states.forEach(function (s) {
    ringsToPath(s.r, states);
    s.r.forEach(function (a) {
      var x = 0, y = 0;
      for (var i = 0; i < a.length; i += 2) {
        x += a[i]; y += a[i + 1];
        bounds.x0 = Math.min(bounds.x0, x); bounds.x1 = Math.max(bounds.x1, x);
        bounds.y0 = Math.min(bounds.y0, y); bounds.y1 = Math.max(bounds.y1, y);
      }
    });
  });
  function roadPath(cls) {
    var p = new Path2D();
    for (var e = 0; e < graph.nE; e++) {
      if (graph.ecls[e] !== cls) continue;
      var n = Router.npts(graph, e);
      p.moveTo(Router.ptx(graph, e, 0), Router.pty(graph, e, 0));
      for (var j = 1; j < n; j++) p.lineTo(Router.ptx(graph, e, j), Router.pty(graph, e, j));
    }
    return p;
  }
  var interstates = roadPath(0), highways = roadPath(1);

  // ---------------------------------------------------------------- view
  var canvas = $('map'), ctx = canvas.getContext('2d'), wrap = $('map-wrap');
  var W = 0, H = 0, DPR = 1, fitS = 0.03, view = { cx: 0, cy: 0, s: 0.03 }, colors = {};
  var FONT = getComputedStyle(document.body).fontFamily;

  function readColors() {
    var cs = getComputedStyle(document.documentElement);
    ['water', 'land', 'neighbor', 'border', 'road', 'interstate', 'label', 'halo', 'route', 'route-ink'].forEach(function (k) {
      colors[k] = cs.getPropertyValue('--map-' + k).trim();
    });
  }
  function fitScale(b, pad) { return Math.min((W - 2 * pad) / Math.max(1, b.x1 - b.x0), (H - 2 * pad) / Math.max(1, b.y1 - b.y0)); }
  function toScreen(x, y) { return [(x - view.cx) * view.s + W / 2, -(y - view.cy) * view.s + H / 2]; }
  function toWorld(X, Y) { return [(X - W / 2) / view.s + view.cx, -(Y - H / 2) / view.s + view.cy]; }
  function setView(cx, cy, s) {
    view.s = clamp(s, fitS * 0.7, fitS * 45);
    view.cx = clamp(cx, bounds.x0, bounds.x1);
    view.cy = clamp(cy, bounds.y0, bounds.y1);
    requestRender();
  }
  function zoomAround(X, Y, s) {
    var w = toWorld(X, Y);
    s = clamp(s, fitS * 0.7, fitS * 45);
    setView(w[0] - (X - W / 2) / s, w[1] + (Y - H / 2) / s, s);
  }
  function fitTrip() {
    if (!W) return;
    if (!stops.length) { setView((bounds.x0 + bounds.x1) / 2, (bounds.y0 + bounds.y1) / 2, fitS); return; }
    var b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    function add(p) { b.x0 = Math.min(b.x0, p[0]); b.x1 = Math.max(b.x1, p[0]); b.y0 = Math.min(b.y0, p[1]); b.y1 = Math.max(b.y1, p[1]); }
    stops.forEach(function (s) { add([s.x, s.y]); });
    legs.forEach(function (l) { if (l) l.points.forEach(add); });
    var s = stops.length === 1 ? fitS * 5 : Math.min(fitScale(b, Math.min(60, W * 0.1)), fitS * 14);
    setView((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2, s);
  }
  var firstSize = true;
  function resize() {
    if (!wrap.clientWidth || !wrap.clientHeight) return;
    var z = view.s / fitS;
    W = wrap.clientWidth; H = wrap.clientHeight; DPR = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
    fitS = fitScale(bounds, Math.min(24, W * 0.04));
    if (firstSize) { firstSize = false; fitTrip(); } else view.s = fitS * z;
    render();
  }
  var raf = 0;
  function requestRender() { if (!raf) raf = requestAnimationFrame(render); }

  // ---------------------------------------------------------------- drawing
  var placed = [], hits = [];
  function reserve(x0, y0, x1, y1) {
    for (var i = 0; i < placed.length; i++) {
      var r = placed[i];
      if (x0 < r[2] && x1 > r[0] && y0 < r[3] && y1 > r[1]) return false;
    }
    placed.push([x0, y0, x1, y1]);
    return true;
  }
  // Label to the right of a point, or the left if that's taken
  function label(text, X, Y, font, gap) {
    ctx.font = font;
    var w = ctx.measureText(text).width, x = X + gap;
    if (!(x + w < W && reserve(x, Y - 8, x + w, Y + 8))) {
      x = X - gap - w;
      if (!(x > 0 && reserve(x, Y - 8, x + w, Y + 8))) return false;
    }
    ctx.lineWidth = 3; ctx.lineJoin = 'round'; ctx.strokeStyle = colors.halo; ctx.strokeText(text, x, Y + 4);
    ctx.fillStyle = colors.label; ctx.fillText(text, x, Y + 4);
    return true;
  }
  function dot(X, Y, r, fill) {
    ctx.beginPath(); ctx.arc(X, Y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill; ctx.fill();
  }

  function render() {
    raf = 0;
    if (!W) return;
    var s = view.s, z = s / fitS;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = colors.water; ctx.fillRect(0, 0, canvas.width, canvas.height);

    // world layers
    ctx.setTransform(s * DPR, 0, 0, -s * DPR, DPR * (W / 2 - view.cx * s), DPR * (H / 2 + view.cy * s));
    ctx.fillStyle = colors.neighbor; ctx.fill(neighbors, 'evenodd');
    ctx.fillStyle = colors.land; ctx.fill(states, 'evenodd');
    ctx.fillStyle = colors.water; ctx.fill(lakes, 'evenodd');
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = colors.border; ctx.lineWidth = 1 / s; ctx.stroke(states);
    if (z >= 3) { ctx.strokeStyle = colors.road; ctx.lineWidth = 1 / s; ctx.stroke(highways); }
    ctx.strokeStyle = colors.interstate; ctx.lineWidth = (z < 3 ? 1 : 2) / s; ctx.stroke(interstates);
    var route = new Path2D();
    legs.forEach(function (l) {
      if (!l) return;
      l.points.forEach(function (p, k) { if (k) route.lineTo(p[0], p[1]); else route.moveTo(p[0], p[1]); });
    });
    ctx.strokeStyle = colors.route; ctx.lineWidth = 4 / s; ctx.stroke(route);

    // screen layers
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    placed = []; hits = [];
    var pos = stops.map(function (st) { return toScreen(st.x, st.y); });
    pos.forEach(function (p) { placed.push([p[0] - 10, p[1] - 10, p[0] + 10, p[1] + 10]); });
    stops.forEach(function (st, i) { label(shortName(st.name), pos[i][0], pos[i][1], '700 13px ' + FONT, 14); });
    for (var i = stops.length - 1; i >= 0; i--) {
      dot(pos[i][0], pos[i][1], 10, colors.route);
      ctx.fillStyle = colors['route-ink']; ctx.font = '700 11px ' + FONT; ctx.textAlign = 'center';
      ctx.fillText(String(i + 1), pos[i][0], pos[i][1] + 4);
      ctx.textAlign = 'left';
    }
    if (z >= 2.4) parks.forEach(function (i) { drawPlace(i, '600 12px ' + FONT); });
    var minPop = z < 1.4 ? 700000 : z < 2 ? 300000 : z < 3 ? 120000 : z < 5 ? 50000 : z < 8 ? 20000 : z < 15 ? 5000 : 0;
    for (var c = 0; c < cities.length && P.pop[cities[c]] >= minPop && hits.length < 150; c++) {
      drawPlace(cities[c], (P.pop[cities[c]] >= 1e6 ? '700 ' : '400 ') + '12px ' + FONT);
    }
  }
  function drawPlace(i, font) {
    var p = toScreen(P.x[i], P.y[i]);
    if (p[0] < 0 || p[0] > W || p[1] < 0 || p[1] > H) return;
    if (!reserve(p[0] - 3, p[1] - 3, p[0] + 3, p[1] + 3)) return;
    if (!label(shortName(P.name[i]), p[0], p[1], font, 6)) { placed.pop(); return; }
    dot(p[0], p[1], 2.5, colors.label);
    hits.push([p[0], p[1], i]);
  }

  // ---------------------------------------------------------------- stops and legs
  var stops = [], legs = [], legCache = new Map(), beforeKerouac = null;
  function computeLegs() {
    legs = [];
    for (var i = 0; i + 1 < stops.length; i++) {
      var a = stops[i], b = stops[i + 1], key = [a.x, a.y, b.x, b.y].join(), leg = legCache.get(key);
      if (leg === undefined) {
        leg = a.x === b.x && a.y === b.y ? { miles: 0, minutes: 0, points: [] } : Router.route(graph, a.x, a.y, b.x, b.y);
        legCache.set(key, leg);
      }
      legs.push(leg);
    }
  }
  function changed(flash) {
    beforeKerouac = null;
    $('kerouac').setAttribute('aria-pressed', 'false');
    computeLegs();
    renderList(flash);
    save();
    requestRender();
  }
  function addStop(st) {
    if (stops.length >= MAX_STOPS) return;
    stops.push(st);
    changed(stops.length - 1);
    fitTrip();
  }

  // ---------------------------------------------------------------- panel
  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function btn(text, labelText, act, i, disabled) {
    var b = el('button', 'icon-btn', text);
    b.type = 'button'; b.title = labelText;
    b.setAttribute('aria-label', labelText);
    b.dataset.act = act; b.dataset.i = i; b.disabled = !!disabled;
    return b;
  }
  function renderList(flash) {
    var list = $('stops'), mi = 0, min = 0;
    list.textContent = '';
    stops.forEach(function (st, i) {
      var leg = legs[i - 1];
      if (i > 0) {
        list.appendChild(el('li', 'leg', !leg ? 'No highway route' : fmtMiles(leg.miles) + ' mi · ' + fmtTime(leg.minutes)));
        if (leg) { mi += leg.miles; min += leg.minutes; }
      }
      var row = el('li', 'stop' + (flash === i ? ' flash' : ''));
      row.dataset.i = i; row.tabIndex = 0;
      row.setAttribute('aria-label', 'Stop ' + (i + 1) + ', ' + st.name + '. Drag, or Alt and arrow keys, to reorder.');
      row.appendChild(el('span', 'num', String(i + 1)));
      row.appendChild(el('span', 'stop-name', st.k === 0 && st.st ? st.name + ', ' + st.st : st.name));
      row.appendChild(btn('×', 'Remove ' + st.name, 'remove', i));
      list.appendChild(row);
    });
    $('summary').textContent = stops.length < 2 ? 'Add stops to plan a drive.'
      : stops.length + ' stops · ' + fmtMiles(mi) + ' mi · ' + fmtTime(min) + ' driving';
    $('cost').hidden = stops.length < 2;
    $('cost').textContent = 'Tesla Model Y \u2248 $' + fmtMiles(mi * MODEL_Y_KWH_MI * KWH_PRICE) +
      ' electricity \u00b7 Gas car \u2248 $' + fmtMiles(mi / GAS_MPG * GAS_PRICE);
    $('empty').hidden = stops.length > 0;
    $('actions').hidden = stops.length === 0;
  }
  function moveStop(from, to) {
    if (to < 0 || to >= stops.length || to === from) return;
    stops.splice(to, 0, stops.splice(from, 1)[0]);
    changed(to);
  }
  $('stops').addEventListener('click', function (ev) {
    var b = ev.target.closest('button[data-act="remove"]');
    if (b) { stops.splice(+b.dataset.i, 1); changed(); }
  });
  $('stops').addEventListener('keydown', function (ev) {
    var row = ev.target.closest('.stop');
    if (!row || !ev.altKey || (ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown')) return;
    ev.preventDefault();
    var i = +row.dataset.i, j = i + (ev.key === 'ArrowUp' ? -1 : 1);
    moveStop(i, j);
    var moved = $('stops').querySelector('.stop[data-i="' + j + '"]');
    if (moved) moved.focus();
  });

  // Drag to reorder: anywhere on a row with a mouse, by the number badge on touch so the list still scrolls
  var drag = null;
  $('stops').addEventListener('pointerdown', function (ev) {
    var row = ev.target.closest('.stop');
    if (!row || ev.button > 0 || ev.target.closest('button')) return;
    if (ev.pointerType !== 'mouse' && !ev.target.closest('.num')) return;
    ev.preventDefault();
    row.setPointerCapture(ev.pointerId);
    drag = { row: row, from: +row.dataset.i, to: +row.dataset.i, y0: ev.clientY, moved: false };
  });
  $('stops').addEventListener('pointermove', function (ev) {
    if (!drag) return;
    var dy = ev.clientY - drag.y0;
    if (!drag.moved && Math.abs(dy) < 4) return;
    drag.moved = true;
    drag.row.classList.add('dragging');
    drag.row.style.transform = 'translateY(' + dy + 'px)';
    // insertion point: how many other stops sit above the pointer
    var rows = Array.prototype.filter.call($('stops').querySelectorAll('.stop'), function (r) { return r !== drag.row; });
    var to = 0;
    rows.forEach(function (r) { var b = r.getBoundingClientRect(); if (ev.clientY > b.top + b.height / 2) to++; });
    drag.to = to;
    rows.forEach(function (r, k) {
      r.classList.toggle('drop-above', k === to);
      r.classList.toggle('drop-below', to === rows.length && k === rows.length - 1);
    });
  });
  function endDrag() {
    if (!drag) return;
    var d = drag;
    drag = null;
    d.row.style.transform = '';
    if (d.moved) moveStop(d.from, d.to);
  }
  $('stops').addEventListener('pointerup', endDrag);
  $('stops').addEventListener('pointercancel', function () { if (drag) { drag.moved = false; endDrag(); renderList(); } });

  // ---------------------------------------------------------------- search box
  // Built-in towns and parks show instantly; any address or place comes from Photon (OpenStreetMap) a moment later
  var q = $('q'), sug = $('suggest'), sugItems = [], sugSel = -1, remoteTimer = 0, remoteReq = null;
  var STATE_CODES = {};
  B.states.forEach(function (s) { STATE_CODES[s.n] = s.p; });

  function localItems(raw) {
    return search(raw).map(function (i) { return { stop: placeToStop(i), name: P.name[i], meta: P.st[i] }; });
  }
  function inLower48(x, y) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    return ctx.isPointInPath(states, x, y, 'evenodd');
  }
  function remoteSearch(raw) {
    if (remoteReq) remoteReq.abort();
    remoteReq = new AbortController();
    var c = window.AlbersUSA.inverse(view.cx, view.cy);
    var url = 'https://photon.komoot.io/api/?limit=10&lang=en&bbox=-125,24,-66,50&lat=' + c[1].toFixed(3) + '&lon=' + c[0].toFixed(3) + '&q=' + encodeURIComponent(raw);
    return fetch(url, { signal: remoteReq.signal }).then(function (r) { return r.json(); }).then(function (data) {
      var out = [];
      data.features.forEach(function (f) {
        var p = f.properties, ll = f.geometry.coordinates, xy = window.AlbersUSA.forward(ll[0], ll[1]);
        var st = STATE_CODES[p.state] || '';
        var name = p.name || [p.housenumber, p.street].filter(Boolean).join(' ') || p.city;
        if (p.countrycode !== 'US' || !name || !inLower48(xy[0], xy[1])) return;
        var place = p.city && p.city !== name ? p.city : p.county || '';
        out.push({ stop: { name: name, st: st, k: 3, x: Math.round(xy[0]), y: Math.round(xy[1]) }, name: name, meta: [place, st].filter(Boolean).join(', ') });
      });
      return out;
    });
  }
  function openSuggest(items, osm, pending) {
    sugItems = items; sugSel = -1;
    sug.textContent = '';
    if (!items.length) sug.appendChild(el('li', 's-none', pending ? 'Searching…' : 'No match.'));
    items.forEach(function (it, n) {
      var li = el('li');
      li.id = 'sug-' + n; li.dataset.n = n;
      li.setAttribute('role', 'option'); li.setAttribute('aria-selected', 'false');
      li.appendChild(el('span', 's-name', it.name));
      li.appendChild(el('span', 's-meta', it.meta));
      sug.appendChild(li);
    });
    if (osm) sug.appendChild(el('li', 's-credit', '© OpenStreetMap'));
    sug.hidden = false;
    q.setAttribute('aria-expanded', 'true');
  }
  function closeSuggest() {
    sug.hidden = true; sugItems = []; sugSel = -1;
    q.setAttribute('aria-expanded', 'false'); q.removeAttribute('aria-activedescendant');
  }
  function highlight(n) {
    sugSel = n;
    Array.prototype.forEach.call(sug.children, function (li, k) { li.setAttribute('aria-selected', String(k === n)); });
    q.setAttribute('aria-activedescendant', 'sug-' + n);
  }
  function choose(n) {
    if (sugItems[n] == null) return;
    q.value = '';
    clearTimeout(remoteTimer);
    if (remoteReq) remoteReq.abort();
    addStop(sugItems[n].stop);
    closeSuggest();
  }
  q.addEventListener('input', function () {
    var raw = q.value.trim();
    clearTimeout(remoteTimer);
    if (!raw) { closeSuggest(); return; }
    var local = localItems(raw);
    openSuggest(local, false, raw.length >= 3);
    if (raw.length < 3) return;
    remoteTimer = setTimeout(function () {
      remoteSearch(raw).then(function (remote) {
        if (q.value.trim() !== raw) return;
        var seen = {};
        local = local.slice(0, 4);
        local.forEach(function (it) { seen[it.name.toLowerCase() + '|' + it.stop.st] = 1; });
        remote = remote.filter(function (it) { return !seen[it.name.toLowerCase() + '|' + it.stop.st]; }).slice(0, 8 - local.length);
        var keep = sugSel >= 0 ? sugItems[sugSel] : null;
        openSuggest(local.concat(remote), true);
        if (keep) highlight(sugItems.indexOf(keep));
      }, function () { /* offline or aborted: keep the built-in results */ });
    }, 300);
  });
  q.addEventListener('keydown', function (ev) {
    var n = sugItems.length;
    if (ev.key === 'ArrowDown' && n) { highlight((sugSel + 1) % n); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp' && n) { highlight(sugSel <= 0 ? n - 1 : sugSel - 1); ev.preventDefault(); }
    else if (ev.key === 'Enter') { choose(Math.max(sugSel, 0)); ev.preventDefault(); }
    else if (ev.key === 'Escape') closeSuggest();
  });
  q.addEventListener('blur', function () { setTimeout(closeSuggest, 120); });
  sug.addEventListener('pointerdown', function (ev) {
    var li = ev.target.closest('li[data-n]');
    if (li) { ev.preventDefault(); choose(+li.dataset.n); }
  });

  // ---------------------------------------------------------------- map input
  // A tap adds the labelled place under it, or a pin named after the nearest town
  function handleTap(X, Y) {
    var best = null, bd = 12;
    hits.forEach(function (h) { var d = Math.hypot(h[0] - X, h[1] - Y); if (d < bd) { bd = d; best = h[2]; } });
    if (best !== null) { addStop(placeToStop(best)); return; }
    var w = toWorld(X, Y);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!ctx.isPointInPath(states, w[0], w[1], 'evenodd')) return;
    var town = nearestPlace(w[0], w[1], 1000);
    addStop({ name: 'Near ' + P.name[town.i], st: P.st[town.i], k: 3, x: Math.round(w[0]), y: Math.round(w[1]) });
  }

  var pointers = new Map(), gesture = null;
  function local(ev) { var r = canvas.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; }
  canvas.addEventListener('pointerdown', function (ev) {
    if (ev.button > 0) return;
    canvas.setPointerCapture(ev.pointerId);
    var p = local(ev);
    pointers.set(ev.pointerId, p);
    if (pointers.size === 1) gesture = { x0: p[0], y0: p[1], cx: view.cx, cy: view.cy, moved: false, pinch: null };
    else if (pointers.size === 2 && gesture) {
      var a = Array.from(pointers.values());
      gesture.pinch = { d0: Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]) || 1, s0: view.s };
      gesture.moved = true;
    }
  });
  canvas.addEventListener('pointermove', function (ev) {
    if (!pointers.has(ev.pointerId) || !gesture) return;
    var c = local(ev);
    pointers.set(ev.pointerId, c);
    if (gesture.pinch && pointers.size >= 2) {
      var a = Array.from(pointers.values());
      zoomAround((a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2,
        gesture.pinch.s0 * Math.hypot(a[0][0] - a[1][0], a[0][1] - a[1][1]) / gesture.pinch.d0);
      return;
    }
    var dx = c[0] - gesture.x0, dy = c[1] - gesture.y0;
    if (Math.hypot(dx, dy) > 5) gesture.moved = true;
    if (gesture.moved) setView(gesture.cx - dx / view.s, gesture.cy + dy / view.s, view.s);
  });
  function endPointer(ev) {
    if (!pointers.delete(ev.pointerId) || !gesture) return;
    if (pointers.size === 0) {
      if (!gesture.moved && ev.type === 'pointerup') { var p = local(ev); handleTap(p[0], p[1]); }
      gesture = null;
    } else {
      var rest = Array.from(pointers.values())[0];
      gesture = { x0: rest[0], y0: rest[1], cx: view.cx, cy: view.cy, moved: true, pinch: null };
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    var p = local(ev);
    zoomAround(p[0], p[1], view.s * Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : ev.ctrlKey ? 0.012 : 0.0022)));
  }, { passive: false });
  $('zoom-in').addEventListener('click', function () { zoomAround(W / 2, H / 2, view.s * 1.8); });
  $('zoom-out').addEventListener('click', function () { zoomAround(W / 2, H / 2, view.s / 1.8); });
  $('zoom-fit').addEventListener('click', fitTrip);

  // ---------------------------------------------------------------- saving and sharing
  function encodeTrip() {
    var bytes = new TextEncoder().encode(JSON.stringify(stops.map(function (s) { return [s.name, s.st || '', s.k, s.x, s.y]; })));
    return btoa(String.fromCharCode.apply(null, bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function decodeTrip(str) {
    try {
      var bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
      return validStops(JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, function (c) { return c.charCodeAt(0); }))));
    } catch (err) { return null; }
  }
  function validStops(arr) {
    if (!Array.isArray(arr)) return null;
    return arr.slice(0, MAX_STOPS).filter(function (a) {
      return Array.isArray(a) && typeof a[0] === 'string' && isFinite(a[3]) && isFinite(a[4]);
    }).map(function (a) {
      return { name: a[0].slice(0, 90), st: STATES.indexOf(a[1]) >= 0 ? a[1] : '', k: a[2] >= 0 && a[2] <= 3 ? +a[2] : 3, x: Math.round(a[3]), y: Math.round(a[4]) };
    });
  }
  function shareUrl() { return location.href.split('#')[0] + (stops.length ? '#trip=' + encodeTrip() : ''); }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(stops.map(function (s) { return [s.name, s.st, s.k, s.x, s.y]; }))); } catch (err) { /* storage unavailable */ }
    try { history.replaceState(null, '', shareUrl()); } catch (err) { /* e.g. sandboxed preview */ }
  }
  function load() {
    var m = location.hash.match(/^#trip=([A-Za-z0-9_-]+)$/), fromLink = m && decodeTrip(m[1]);
    if (fromLink) return fromLink;
    try { return validStops(JSON.parse(localStorage.getItem(STORE_KEY))) || []; } catch (err) { return []; }
  }
  $('copy').addEventListener('click', function () {
    var b = $('copy');
    navigator.clipboard.writeText(shareUrl()).then(function () {
      b.textContent = 'Copied';
      setTimeout(function () { b.textContent = 'Copy link'; }, 1500);
    }, function () { b.textContent = 'Copy from the address bar'; });
  });
  $('clear').addEventListener('click', function () {
    if (!confirm('Clear all stops?')) return;
    stops = []; changed(); fitTrip(); q.focus();
  });

  // Toggle Kerouac's first crossing from On the Road (1947); turning it off restores the previous trip
  var KEROUAC = [['New York City', 'NY'], ['Chicago', 'IL'], ['Des Moines', 'IA'], ['Cheyenne', 'WY'], ['Denver', 'CO'],
    ['Salt Lake City', 'UT'], ['San Francisco', 'CA'], ['Los Angeles', 'CA'], ['Pittsburgh', 'PA'], ['New York City', 'NY']];
  function kerouacStops() {
    return KEROUAC.map(function (w) {
      var best = -1;
      for (var i = 0; i < NPL; i++) if (P.name[i] === w[0] && P.st[i] === w[1] && (best < 0 || P.pop[i] > P.pop[best])) best = i;
      return placeToStop(best);
    });
  }
  $('kerouac').addEventListener('click', function () {
    var on = beforeKerouac === null, prev = stops;
    stops = on ? kerouacStops() : beforeKerouac;
    changed(); fitTrip();
    beforeKerouac = on ? prev : null;
    $('kerouac').setAttribute('aria-pressed', String(on));
  });

  $('theme').addEventListener('click', function () {
    var root = document.documentElement;
    var dark = root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('roadtrip:theme', root.dataset.theme); } catch (err) { /* storage unavailable */ }
  });

  // ---------------------------------------------------------------- start
  readColors();
  stops = load();
  changed();
  new ResizeObserver(resize).observe(wrap);
  if (document.fonts) document.fonts.ready.then(requestRender);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { readColors(); requestRender(); });
  new MutationObserver(function () { readColors(); requestRender(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
})();
