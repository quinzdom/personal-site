/* Albers equal-area conic (spherical), matching the generated data. Units: 0.1 km. */
(function (root) {
  'use strict';
  var R = 6371.0088, rad = Math.PI / 180;
  var p1 = 29.5 * rad, p2 = 45.5 * rad, p0 = 37.5 * rad, l0 = -96 * rad;
  var n = (Math.sin(p1) + Math.sin(p2)) / 2, C = Math.cos(p1) * Math.cos(p1) + 2 * n * Math.sin(p1);
  var rho0 = R * Math.sqrt(C - 2 * n * Math.sin(p0)) / n, Q = 10;
  function forward(lon, lat) {
    var rho = R * Math.sqrt(C - 2 * n * Math.sin(lat * rad)) / n, th = n * (lon * rad - l0);
    return [rho * Math.sin(th) * Q, (rho0 - rho * Math.cos(th)) * Q];
  }
  function inverse(x, y) {
    x /= Q; y /= Q;
    var rho = Math.hypot(x, rho0 - y), th = Math.atan2(x, rho0 - y);
    var lat = Math.asin((C - Math.pow(rho * n / R, 2)) / (2 * n));
    return [(l0 + th / n) / rad, lat / rad];
  }
  var api = { forward: forward, inverse: inverse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.AlbersUSA = api;
})(typeof window !== 'undefined' ? window : this);
