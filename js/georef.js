/* Master plan <-> map transform.
 * Plan units are PDF points from the AutoCAD export (x right, y up).
 * The transform is an affine map from plan (x,y) to Web Mercator metres, fitted from control points
 * (least squares, 3+ points) or a similarity from 2 points, or built from simple params
 * (anchor point, rotation, metres per plan unit) when no control points exist yet.
 */
(function (root) {
  'use strict';
  var R = 6378137;
  function toMerc(lng, lat) {
    return [R * lng * Math.PI / 180, R * Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360))];
  }
  function fromMerc(x, y) {
    return [x / R * 180 / Math.PI, (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI];
  }

  function fromParams(p) {
    var lat = p.anchorLngLat[1];
    var k = p.metersPerUnit / Math.cos(lat * Math.PI / 180); // ground metres -> mercator metres
    var th = p.rotationDeg * Math.PI / 180; // compass bearing of the plan's "up" (+y) direction
    // plan +y -> bearing th ; plan +x -> bearing th + 90 (no mirroring)
    var a = k * Math.cos(th), b = k * Math.sin(th);
    var A = [a, b, -b, a]; // [ex_x, ex_y(east from +y), ny_x, ny_y] see below
    // east = x*cos(th) + y*sin(th) ; north = -x*sin(th) + y*cos(th)
    var m = toMerc(p.anchorLngLat[0], p.anchorLngLat[1]);
    var c = m[0] - (A[0] * p.anchorPlan[0] + A[1] * p.anchorPlan[1]);
    var f = m[1] - (A[2] * p.anchorPlan[0] + A[3] * p.anchorPlan[1]);
    return { a: A[0], b: A[1], c: c, d: A[2], e: A[3], f: f };
  }

  function fitSimilarity(pts) {
    var p = pts[0], q = pts[1];
    var m1 = toMerc(p.lngLat[0], p.lngLat[1]), m2 = toMerc(q.lngLat[0], q.lngLat[1]);
    var dx = q.plan[0] - p.plan[0], dy = q.plan[1] - p.plan[1];
    var mx = m2[0] - m1[0], my = m2[1] - m1[1];
    var den = dx * dx + dy * dy;
    var s = (mx * dx + my * dy) / den, t = (my * dx - mx * dy) / den; // complex ratio
    return { a: s, b: -t, c: m1[0] - (s * p.plan[0] - t * p.plan[1]), d: t, e: s, f: m1[1] - (t * p.plan[0] + s * p.plan[1]) };
  }

  function solve3(M, v) { // Cramer's rule
    function det(m) { return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]); }
    var D = det(M); if (Math.abs(D) < 1e-12) return null;
    var r = [];
    for (var i = 0; i < 3; i++) { var Mi = M.map(function (row, k) { var rr = row.slice(); rr[i] = v[k]; return rr; }); r.push(det(Mi) / D); }
    return r;
  }

  function fitAffine(pts) {
    // normalise plan coords for numeric stability
    var cx = 0, cy = 0; pts.forEach(function (p) { cx += p.plan[0]; cy += p.plan[1]; }); cx /= pts.length; cy /= pts.length;
    var S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], bx = [0, 0, 0], by = [0, 0, 0];
    pts.forEach(function (p) {
      var x = p.plan[0] - cx, y = p.plan[1] - cy, m = toMerc(p.lngLat[0], p.lngLat[1]), r = [x, y, 1];
      for (var i = 0; i < 3; i++) { for (var j = 0; j < 3; j++) S[i][j] += r[i] * r[j]; bx[i] += r[i] * m[0]; by[i] += r[i] * m[1]; }
    });
    var X = solve3(S, bx), Y = solve3(S, by);
    if (!X || !Y) return null;
    return { a: X[0], b: X[1], c: X[2] - X[0] * cx - X[1] * cy, d: Y[0], e: Y[1], f: Y[2] - Y[0] * cx - Y[1] * cy };
  }

  function Georef(cfg) { this.set(cfg); }
  Georef.prototype.set = function (cfg) {
    this.cfg = JSON.parse(JSON.stringify(cfg));
    var cps = (this.cfg.controlPoints || []).filter(function (p) { return p.plan && p.lngLat && !p.disabled; });
    var T = null;
    if (cps.length >= 3) T = fitAffine(cps);
    if (!T && cps.length >= 2) T = fitSimilarity(cps);
    if (!T) T = fromParams(this.cfg.params);
    this.T = T;
    var det = T.a * T.e - T.b * T.d;
    this.inv = { a: T.e / det, b: -T.b / det, d: -T.d / det, e: T.a / det };
    this.mode = cps.length >= 3 ? 'affine (' + cps.length + ' points)' : cps.length === 2 ? 'similarity (2 points)' : 'manual placement';
  };
  Georef.prototype.toLngLat = function (x, y) {
    var T = this.T; return fromMerc(T.a * x + T.b * y + T.c, T.d * x + T.e * y + T.f);
  };
  Georef.prototype.toPlan = function (lng, lat) {
    var m = toMerc(lng, lat), T = this.T, I = this.inv, X = m[0] - T.c, Y = m[1] - T.f;
    return [I.a * X + I.b * Y, I.d * X + I.e * Y];
  };
  /* metres on the ground per plan unit (average) */
  Georef.prototype.metersPerUnit = function () {
    var T = this.T, ll = this.toLngLat(975, 2560);
    return Math.sqrt(Math.abs(T.a * T.e - T.b * T.d)) * Math.cos(ll[1] * Math.PI / 180);
  };
  Georef.prototype.residuals = function () {
    var self = this;
    return (this.cfg.controlPoints || []).map(function (p) {
      if (!p.plan || !p.lngLat) return null;
      var ll = self.toLngLat(p.plan[0], p.plan[1]);
      return distance(ll, p.lngLat);
    });
  };
  function distance(a, b) {
    var r = 6371008.8, la1 = a[1] * Math.PI / 180, la2 = b[1] * Math.PI / 180;
    var dla = la2 - la1, dlo = (b[0] - a[0]) * Math.PI / 180;
    var h = Math.sin(dla / 2) * Math.sin(dla / 2) + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) * Math.sin(dlo / 2);
    return 2 * r * Math.asin(Math.sqrt(h));
  }
  Georef.distance = distance;
  Georef.toMerc = toMerc; Georef.fromMerc = fromMerc;

  if (typeof module !== 'undefined' && module.exports) module.exports = Georef;
  else root.Georef = Georef;
})(this);
