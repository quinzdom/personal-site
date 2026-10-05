/*
 * Road Trip router
 * Decodes the compact highway network in data/roads.js, snaps points to the
 * nearest road and finds the fastest route with A*.
 * Coordinates are Albers equal-area (km x 10, i.e. 0.1 km units); see projection.js.
 */
(function (root) {
  'use strict';

  var MI_PER_UNIT = 0.1 * 0.621371;      // one coordinate unit (0.1 km) in miles
  var OFFROAD_FACTOR = 1.25;             // straight-line to road: assume a little winding
  var OFFROAD_MPH = 30;
  var HEUR_MIN_PER_UNIT = MI_PER_UNIT / 80 * 60; // A* heuristic: nobody averages over 80 mph

  function decode(d) {
    var nN = d.n.length / 2, nE = d.eu.length, i, j, k;
    var nx = new Int32Array(nN), ny = new Int32Array(nN), x = 0, y = 0;
    for (i = 0; i < nN; i++) { x += d.n[2 * i]; y += d.n[2 * i + 1]; nx[i] = x; ny[i] = y; }
    var eu = new Int32Array(nE), ev = new Int32Array(nE), emi = new Float64Array(nE), emin = new Float64Array(nE);
    var elab = new Uint16Array(nE), ecls = new Uint8Array(nE), goff = new Int32Array(nE + 1);
    var u = 0, total = 0;
    for (i = 0; i < nE; i++) {
      u += d.eu[i]; eu[i] = u; ev[i] = u + d.ev[i];
      emi[i] = d.mi[i] / 100; emin[i] = emi[i] / d.sp[i] * 60;
      elab[i] = d.lb[i]; ecls[i] = d.cl[i];
      goff[i] = total; total += d.gc[i];
    }
    goff[nE] = total;
    var gx = new Int32Array(total), gy = new Int32Array(total);
    k = 0;
    for (i = 0; i < nE; i++) {
      var px = nx[eu[i]], py = ny[eu[i]];
      for (j = 0; j < d.gc[i]; j++) { px += d.gp[2 * k]; py += d.gp[2 * k + 1]; gx[k] = px; gy[k] = py; k++; }
    }
    var aoff = new Int32Array(nN + 1);
    for (i = 0; i < nE; i++) { aoff[eu[i] + 1]++; aoff[ev[i] + 1]++; }
    for (i = 0; i < nN; i++) aoff[i + 1] += aoff[i];
    var fill = aoff.slice(0, nN), aedge = new Int32Array(aoff[nN]);
    for (i = 0; i < nE; i++) { aedge[fill[eu[i]]++] = i; aedge[fill[ev[i]]++] = i; }
    return { nN: nN, nE: nE, nx: nx, ny: ny, eu: eu, ev: ev, emi: emi, emin: emin, elab: elab, ecls: ecls,
             goff: goff, gx: gx, gy: gy, aoff: aoff, aedge: aedge, labels: d.labels, grid: null };
  }

  // Number of points in edge e's polyline (both end nodes included)
  function npts(g, e) { return g.goff[e + 1] - g.goff[e] + 2; }
  // Point j of edge e: 0 is node eu, last is node ev
  function ptx(g, e, j) { var m = g.goff[e + 1] - g.goff[e]; return j === 0 ? g.nx[g.eu[e]] : j === m + 1 ? g.nx[g.ev[e]] : g.gx[g.goff[e] + j - 1]; }
  function pty(g, e, j) { var m = g.goff[e + 1] - g.goff[e]; return j === 0 ? g.ny[g.eu[e]] : j === m + 1 ? g.ny[g.ev[e]] : g.gy[g.goff[e] + j - 1]; }

  var CELL = 300; // 30 km grid cells for snapping
  function cellKey(cx, cy) { return (cx + 2000) * 4000 + (cy + 2000); }

  function buildGrid(g) {
    var map = new Map(), e, j, n;
    for (e = 0; e < g.nE; e++) {
      n = npts(g, e);
      for (j = 0; j < n - 1; j++) {
        var ax = ptx(g, e, j), ay = pty(g, e, j), bx = ptx(g, e, j + 1), by = pty(g, e, j + 1);
        var x0 = Math.floor(Math.min(ax, bx) / CELL), x1 = Math.floor(Math.max(ax, bx) / CELL);
        var y0 = Math.floor(Math.min(ay, by) / CELL), y1 = Math.floor(Math.max(ay, by) / CELL);
        for (var cx = x0; cx <= x1; cx++) for (var cy = y0; cy <= y1; cy++) {
          var key = cellKey(cx, cy), a = map.get(key);
          if (!a) map.set(key, a = []);
          if (a[a.length - 1] !== e) a.push(e);
        }
      }
    }
    g.grid = map;
  }

  // Nearest point on the road network to (x, y)
  function snap(g, x, y) {
    if (!g.grid) buildGrid(g);
    var cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    var best = { d2: Infinity }, seen = new Set();
    for (var r = 0; r < 40; r++) {
      for (var ix = cx - r; ix <= cx + r; ix++) for (var iy = cy - r; iy <= cy + r; iy++) {
        if (Math.max(Math.abs(ix - cx), Math.abs(iy - cy)) !== r) continue;
        var list = g.grid.get(cellKey(ix, iy));
        if (!list) continue;
        for (var t = 0; t < list.length; t++) {
          var e = list[t];
          if (seen.has(e)) continue;
          seen.add(e);
          var n = npts(g, e);
          for (var j = 0; j < n - 1; j++) {
            var ax = ptx(g, e, j), ay = pty(g, e, j), bx = ptx(g, e, j + 1), by = pty(g, e, j + 1);
            var vx = bx - ax, vy = by - ay, L2 = vx * vx + vy * vy;
            var f = L2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - ax) * vx + (y - ay) * vy) / L2));
            var qx = ax + f * vx, qy = ay + f * vy, d2 = (x - qx) * (x - qx) + (y - qy) * (y - qy);
            if (d2 < best.d2) best = { d2: d2, e: e, seg: j, f: f, px: qx, py: qy };
          }
        }
      }
      if (best.d2 < Infinity && Math.sqrt(best.d2) <= r * CELL) break;
    }
    if (best.e === undefined) return null;
    // fraction of the edge's length at the snap point
    var e2 = best.e, total = 0, before = 0, nn = npts(g, e2);
    for (var k = 0; k < nn - 1; k++) {
      var len = Math.hypot(ptx(g, e2, k + 1) - ptx(g, e2, k), pty(g, e2, k + 1) - pty(g, e2, k));
      if (k < best.seg) before += len; else if (k === best.seg) before += len * best.f;
      total += len;
    }
    best.t = total > 0 ? before / total : 0;
    best.dist = Math.sqrt(best.d2);
    return best;
  }

  // Minimal binary heap keyed by float
  function Heap() { this.k = []; this.v = []; }
  Heap.prototype.push = function (key, val) {
    var k = this.k, v = this.v, i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      var p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p]; i = p;
    }
    k[i] = key; v[i] = val;
  };
  Heap.prototype.pop = function () {
    var k = this.k, v = this.v, top = v[0], lastK = k.pop(), lastV = v.pop(), n = k.length, i = 0;
    if (n > 0) {
      while (true) {
        var l = 2 * i + 1, r = l + 1, m = i, mk = lastK;
        if (l < n && k[l] < mk) { m = l; mk = k[l]; }
        if (r < n && k[r] < mk) { m = r; }
        if (m === i) break;
        k[i] = k[m]; v[i] = v[m]; i = m;
      }
      k[i] = lastK; v[i] = lastV;
    }
    return top;
  };

  // Points of edge e walked from point index `from` toward index `to` (inclusive), skipping the first
  function walk(g, e, from, to, out) {
    var step = to >= from ? 1 : -1;
    for (var j = from + step; step > 0 ? j <= to : j >= to; j += step) out.push([ptx(g, e, j), pty(g, e, j)]);
  }

  function route(g, ax, ay, bx, by) {
    var A = snap(g, ax, ay), B = snap(g, bx, by);
    if (!A || !B) return null;
    var nN = g.nN, S = nN, T = nN + 1;
    var dist = new Float64Array(nN + 2).fill(Infinity), prev = new Int32Array(nN + 2).fill(-1);
    var prevE = new Int32Array(nN + 2).fill(-1), done = new Uint8Array(nN + 2);
    var tx = B.px, ty = B.py;
    function h(n) { return n >= nN ? 0 : Math.hypot(g.nx[n] - tx, g.ny[n] - ty) * HEUR_MIN_PER_UNIT; }
    var heap = new Heap();
    dist[S] = 0;
    var ea = A.e, eb = B.e;
    function relax(from, to, cost, edge) {
      var nd = dist[from] + cost;
      if (nd < dist[to]) { dist[to] = nd; prev[to] = from; prevE[to] = edge; heap.push(nd + h(to), to); }
    }
    relax(S, g.eu[ea], A.t * g.emin[ea], ea);
    relax(S, g.ev[ea], (1 - A.t) * g.emin[ea], ea);
    if (ea === eb) relax(S, T, Math.abs(A.t - B.t) * g.emin[ea], ea);
    while (heap.k.length) {
      var n = heap.pop();
      if (done[n]) continue;
      done[n] = 1;
      if (n === T) break;
      if (n === g.eu[eb]) relax(n, T, B.t * g.emin[eb], eb);
      if (n === g.ev[eb]) relax(n, T, (1 - B.t) * g.emin[eb], eb);
      for (var a = g.aoff[n]; a < g.aoff[n + 1]; a++) {
        var e = g.aedge[a], m = g.eu[e] === n ? g.ev[e] : g.eu[e];
        if (!done[m]) relax(n, m, g.emin[e], e);
      }
    }
    if (dist[T] === Infinity) return null;

    // Rebuild the chain of nodes S -> ... -> T
    var chain = [], c = T;
    while (c !== -1) { chain.push(c); c = prev[c]; }
    chain.reverse();
    var pts = [[ax, ay], [A.px, A.py]], miles = 0, minutes = 0, byLabel = {};
    function addLabel(e, frac) {
      var lab = g.labels[g.elab[e]], mi = g.emi[e] * frac;
      miles += mi; minutes += g.emin[e] * frac;
      if (lab) byLabel[lab] = (byLabel[lab] || 0) + mi;
    }
    var last = npts(g, ea) - 1, lastB = npts(g, eb) - 1;
    for (var s = 1; s < chain.length; s++) {
      var from = chain[s - 1], to = chain[s], e2 = prevE[to];
      if (from === S && to === T) {          // both ends on the same edge
        addLabel(e2, Math.abs(A.t - B.t));
        if (B.t >= A.t) walk(g, e2, A.seg, B.seg, pts); else walk(g, e2, A.seg + 1, B.seg + 1, pts);
      } else if (from === S) {               // from snap point A to the first node
        if (to === g.ev[e2]) { addLabel(e2, 1 - A.t); walk(g, e2, A.seg, last, pts); }
        else { addLabel(e2, A.t); walk(g, e2, A.seg + 1, 0, pts); }
      } else if (to === T) {                 // from the last node to snap point B
        if (from === g.eu[e2]) { addLabel(e2, B.t); walk(g, e2, 0, B.seg, pts); }
        else { addLabel(e2, 1 - B.t); walk(g, e2, lastB, B.seg + 1, pts); }
      } else {
        addLabel(e2, 1);
        if (from === g.eu[e2]) walk(g, e2, 0, npts(g, e2) - 1, pts); else walk(g, e2, npts(g, e2) - 1, 0, pts);
      }
    }
    pts.push([B.px, B.py], [bx, by]);
    var off = (A.dist + B.dist) * MI_PER_UNIT * OFFROAD_FACTOR;
    miles += off; minutes += off / OFFROAD_MPH * 60;
    var via = Object.keys(byLabel).sort(function (p, q) { return byLabel[q] - byLabel[p]; })
      .filter(function (l) { return byLabel[l] >= 0.15 * miles; }).slice(0, 3);
    return { miles: miles, minutes: minutes, via: via, points: pts, offroad: [A.dist, B.dist] };
  }

  var api = { decode: decode, snap: snap, route: route, npts: npts, ptx: ptx, pty: pty, MI_PER_UNIT: MI_PER_UNIT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.RoadRouter = api;
})(typeof window !== 'undefined' ? window : this);
