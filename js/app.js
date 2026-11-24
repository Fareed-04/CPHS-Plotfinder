/* Central Park Plot Finder: map, overlay, search UI, panorama hotspots, alignment tool. */
(function () {
  'use strict';

  var qs = new URLSearchParams(location.search);
  var CALIBRATE = qs.has('calibrate');
  var STORE_KEY = 'cphs-georef-draft-v1';
  var NEARBY_RADIUS = 450; // metres
  var state = { georef: null, search: null, overlay: null, panos: [], tour: null, selected: null, calib: { pending: null } };
  var map;

  function $(s) { return document.querySelector(s); }
  function el(tag, cls, html) { var e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtDist(m) { return m < 1000 ? Math.round(m / 5) * 5 + ' m' : (m / 1000).toFixed(1) + ' km'; }
  function getJSON(u) { return fetch(u, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(u + ' ' + r.status); return r.json(); }); }

  Promise.all([getJSON('data/georef.json'), getJSON('data/plots.json'), getJSON('overlay/tiles.json'), getJSON('data/panoramas.json').catch(function () { return { panoramas: [] }; })])
    .then(function (r) { init(r[0], r[1], r[2], r[3]); })
    .catch(function (e) {
      document.body.insertAdjacentHTML('beforeend', '<div class="fatal">Could not load data files. If you opened index.html straight from disk, run it from a local web server instead (see README).<br><small>' + esc(e.message) + '</small></div>');
    });

  function init(georefCfg, plots, overlay, panoData) {
    if (CALIBRATE) {
      try { var d = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); if (d && d.params) georefCfg = d; } catch (e) { /* storage blocked */ }
    }
    state.georef = new Georef(georefCfg);
    state.search = new PlotSearch(plots);
    state.overlay = overlay;
    state.tour = panoData.tour || null;
    state.panoRaw = panoData.panoramas || [];
    computePanos();

    var c = state.georef.toLngLat(975, 2560);
    map = new maplibregl.Map({
      container: 'map',
      style: baseStyle(),
      center: [c[0], c[1]],
      zoom: 15.6,
      bearing: 0,
      maxZoom: 21,
      attributionControl: { compact: true },
      hash: false
    });
    window.__cpMap = map;
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
    map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true }, trackUserLocation: true }), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');

    var ready = false;
    function onReady() {
      if (ready) return; ready = true;
      addOverlay();
      addPanoLayers();
      addSelectionLayers();
      buildBlockChips();
      wireSearch();
      wireLayerControls();
      if (CALIBRATE) initCalibration();
      fitScheme(false);
      var p = qs.get('plot');
      if (p) { var parts = p.split('-'); var hit = state.search.findExact(parts[0], parts.slice(1).join('-')); if (hit) selectPlot(hit, true); else { $('#q').value = p.replace('-', ' '); runSearch(); } }
    }
    // Do not wait for satellite tiles: start as soon as the style is usable.
    map.once('style.load', onReady);
    map.once('load', onReady);
    (function poll() { if (ready) return; if (map.isStyleLoaded()) onReady(); else setTimeout(poll, 50); })();
  }

  /* ---------------- base map ---------------- */
  function baseStyle() {
    return {
      version: 8,
      glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
      sources: {
        sat: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19,
          attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics' },
        roads: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19 },
        places: { type: 'raster', tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}'], tileSize: 256, maxzoom: 19 },
        osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, maxzoom: 19, attribution: '&copy; OpenStreetMap contributors' }
      },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': '#1b1f24' } },
        { id: 'osm', type: 'raster', source: 'osm', layout: { visibility: 'none' } },
        { id: 'sat', type: 'raster', source: 'sat' },
        { id: 'roads', type: 'raster', source: 'roads', paint: { 'raster-opacity': 0.75 } },
        { id: 'places', type: 'raster', source: 'places', paint: { 'raster-opacity': 0.9 } }
      ]
    };
  }

  /* ---------------- master plan overlay ---------------- */
  function tileCoords(t) {
    var g = state.georef;
    return [t.tl, t.tr, t.br, t.bl].map(function (p) { return g.toLngLat(p[0], p[1]); });
  }
  function addOverlay() {
    state.overlay.tiles.forEach(function (t, i) {
      map.addSource('plan' + i, { type: 'image', url: 'overlay/' + t.url.replace(/^overlay\//, ''), coordinates: tileCoords(t) });
      map.addLayer({ id: 'plan' + i, type: 'raster', source: 'plan' + i, paint: { 'raster-opacity': 0.82, 'raster-fade-duration': 0, 'raster-resampling': 'linear' } }, 'roads');
    });
  }
  function refreshGeoref() {
    state.overlay.tiles.forEach(function (t, i) { var s = map.getSource('plan' + i); if (s) s.setCoordinates(tileCoords(t)); });
    computePanos();
    var s = map.getSource('panos'); if (s) s.setData(panoGeoJSON());
    if (state.selected) selectPlot(state.selected, false, true);
    if (CALIBRATE) renderCalib();
  }
  function setOverlayOpacity(v) {
    state.overlay.tiles.forEach(function (t, i) { map.setPaintProperty('plan' + i, 'raster-opacity', v); });
  }

  /* ---------------- panoramas ---------------- */
  function computePanos() {
    var g = state.georef;
    state.panos = state.panoRaw.map(function (p) {
      var ll = p.lngLat ? p.lngLat : p.plan ? g.toLngLat(p.plan[0], p.plan[1]) : null;
      return ll ? Object.assign({}, p, { ll: ll }) : null;
    }).filter(Boolean);
  }
  function panoGeoJSON(highlight) {
    highlight = highlight || {};
    return { type: 'FeatureCollection', features: state.panos.map(function (p, i) {
      return { type: 'Feature', id: i, properties: { i: i, title: p.title, kind: p.type || 'street', ph: p.placeholder ? 1 : 0, near: highlight[i] ? 1 : 0, rank: highlight[i] || 0 },
        geometry: { type: 'Point', coordinates: p.ll } };
    }) };
  }
  function addPanoLayers() {
    map.addSource('panos', { type: 'geojson', data: panoGeoJSON() });
    map.addLayer({ id: 'pano-halo', type: 'circle', source: 'panos', paint: {
      'circle-radius': ['case', ['==', ['get', 'near'], 1], 14, 9], 'circle-color': '#ffffff', 'circle-opacity': ['case', ['==', ['get', 'near'], 1], 0.35, 0.18] } });
    map.addLayer({ id: 'pano', type: 'circle', source: 'panos', paint: {
      'circle-radius': ['case', ['==', ['get', 'near'], 1], 8, 5.5],
      'circle-color': ['case', ['==', ['get', 'rank'], 1], '#ffb020', ['==', ['get', 'near'], 1], '#2f9bff', '#1677ff'],
      'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    map.on('mouseenter', 'pano', function () { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'pano', function () { map.getCanvas().style.cursor = ''; });
    var pop = new maplibregl.Popup({ closeButton: false, offset: 12 });
    map.on('mousemove', 'pano', function (e) { var f = e.features[0]; pop.setLngLat(f.geometry.coordinates).setHTML('<b>360° view</b><br>' + esc(f.properties.title)).addTo(map); });
    map.on('mouseleave', 'pano', function () { pop.remove(); });
    map.on('click', 'pano', function (e) { if (state.calib.pending) return; openPano(state.panos[e.features[0].properties.i]); });
  }
  function nearbyPanos(ll) {
    return state.panos.map(function (p, i) { return { p: p, i: i, d: Georef.distance(ll, p.ll) }; })
      .filter(function (x) { return x.d <= NEARBY_RADIUS; }).sort(function (a, b) { return a.d - b.d; }).slice(0, 5);
  }
  function openPano(p) {
    var v = $('#viewer'), body = $('#viewer-body');
    $('#viewer-title').textContent = p.title || 'Street view';
    body.innerHTML = '';
    var media = p.tour && p.tour.media != null ? p.tour.media : null;
    if (state.tour && state.tour.url && media != null && !p.placeholder) {
      var url = (state.tour.deepLink || '{url}#media={media}').replace('{url}', state.tour.url).replace('{media}', encodeURIComponent(media));
      var f = el('iframe'); f.src = url; f.allow = 'fullscreen; gyroscope; accelerometer; xr-spatial-tracking'; f.setAttribute('allowfullscreen', '');
      body.appendChild(f);
    } else {
      body.appendChild(el('div', 'viewer-empty', '<div class="ve-icon">360°</div><h3>Panorama not connected yet</h3><p>This is a test hotspot placed along a main road. When the 3DVista tour is added, each hotspot opens its panorama here.</p><code>' + esc(p.id) + '</code>'));
    }
    v.hidden = false;
  }
  $('#viewer-close').addEventListener('click', function () { $('#viewer').hidden = true; $('#viewer-body').innerHTML = ''; });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('#viewer').hidden) $('#viewer-close').click(); });

  /* ---------------- selection ---------------- */
  function addSelectionLayers() {
    map.addSource('sel', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addSource('sel-link', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addSource('results', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'sel-link', type: 'line', source: 'sel-link', paint: { 'line-color': '#ffb020', 'line-width': 2.5, 'line-dasharray': [1.5, 1.5] } });
    map.addLayer({ id: 'results', type: 'circle', source: 'results', paint: { 'circle-radius': 6, 'circle-color': '#e5484d', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'results-label', type: 'symbol', source: 'results', minzoom: 14, layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-offset': [0, 1.3], 'text-font': ['Open Sans Semibold'], 'text-allow-overlap': false },
      paint: { 'text-color': '#fff', 'text-halo-color': '#000', 'text-halo-width': 1.5 } });
    map.on('click', 'results', function (e) {
      var r = state.lastResults && state.lastResults[e.features[0].properties.k];
      if (r) chooseResult(r);
    });
    map.on('mouseenter', 'results', function () { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'results', function () { map.getCanvas().style.cursor = ''; });
  }

  var marker = null;
  function plotLL(p) { return state.georef.toLngLat(p.x, p.y); }

  function selectPlot(p, fly, silent) {
    state.selected = p;
    var ll = plotLL(p);
    if (!marker) {
      var m = el('div', 'pin', '<div class="pin-pulse"></div><svg viewBox="0 0 32 44" width="34" height="46"><path d="M16 0C7.2 0 0 7 0 15.7 0 27.5 16 44 16 44s16-16.5 16-28.3C32 7 24.8 0 16 0z" fill="#e5484d"/><circle cx="16" cy="15.5" r="6" fill="#fff"/></svg>');
      marker = new maplibregl.Marker({ element: m, anchor: 'bottom', offset: [0, 6] }).setLngLat(ll).addTo(map);
    } else marker.setLngLat(ll);
    var near = nearbyPanos(ll), hl = {};
    near.forEach(function (n, k) { hl[n.i] = k + 1; });
    map.getSource('panos').setData(panoGeoJSON(hl));
    map.getSource('sel-link').setData({ type: 'FeatureCollection', features: near.length ? [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [ll, near[0].p.ll] }, properties: {} }] : [] });
    if (fly) map.flyTo({ center: ll, zoom: Math.max(map.getZoom(), 18.2), speed: 1.4, curve: 1.3, essential: true, offset: window.innerWidth < 720 ? [0, -150] : [190, 0] });
    if (!silent) {
      setResultsOnMap([]);
      history.replaceState(null, '', '?plot=' + encodeURIComponent(p.block + '-' + p.label) + (CALIBRATE ? '&calibrate' : ''));
    }
    showPlotCard(p, ll, near);
  }

  function showPlotCard(p, ll, near) {
    var card = $('#card');
    var dupCount = (state.search.byBlock[p.block] || []).filter(function (q) { return q.label === p.label && q.cat === p.cat; }).length;
    var cat = p.cat === 'C' ? 'Commercial plot' : 'Residential plot';
    var html = '<button class="card-x" aria-label="Close">&times;</button>' +
      '<div class="card-kicker">' + esc(cat) + '</div>' +
      '<h2>Plot ' + esc(p.label) + '</h2>' +
      '<div class="card-sub">' + esc(state.search.blockLabel(p.block)) + ' · Central Park Housing Scheme</div>' +
      (dupCount > 1 ? '<div class="warn">This number appears ' + dupCount + ' times in this block on the master plan. Check the pin against the plan.</div>' : '') +
      '<div class="card-actions">' +
      (near.length ? '<button class="btn primary" data-act="pano">Street view nearby <span>' + fmtDist(near[0].d) + '</span></button>' : '<button class="btn" disabled>No street view within ' + NEARBY_RADIUS + ' m yet</button>') +
      '<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=' + ll[1].toFixed(6) + ',' + ll[0].toFixed(6) + '">Directions</a>' +
      '<button class="btn" data-act="share">Share</button>' +
      '</div>';
    if (near.length) {
      html += '<div class="near-h">360° views around this plot</div><ul class="near">';
      near.forEach(function (n, k) {
        html += '<li data-i="' + n.i + '"><span class="dot' + (k === 0 ? ' first' : '') + '"></span><span class="nt">' + esc(n.p.title) + '</span><span class="nd">' + fmtDist(n.d) + ' ' + compass(ll, n.p.ll) + '</span></li>';
      });
      html += '</ul>';
    }
    html += '<div class="coords">' + ll[1].toFixed(6) + ', ' + ll[0].toFixed(6) + '</div>';
    card.innerHTML = html;
    card.hidden = false;
    card.querySelector('.card-x').onclick = function () { card.hidden = true; };
    var b = card.querySelector('[data-act=pano]'); if (b) b.onclick = function () { openPano(near[0].p); };
    card.querySelector('[data-act=share]').onclick = function () {
      var url = location.origin + location.pathname + '?plot=' + encodeURIComponent(p.block + '-' + p.label);
      if (navigator.share) navigator.share({ title: 'Plot ' + p.label + ', ' + state.search.blockLabel(p.block), url: url }).catch(function () {});
      else if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast('Link copied'); });
    };
    card.querySelectorAll('.near li').forEach(function (li) { li.onclick = function () { openPano(state.panos[+li.dataset.i]); }; });
  }
  function compass(a, b) {
    var y = Math.sin((b[0] - a[0]) * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180);
    var x = Math.cos(a[1] * Math.PI / 180) * Math.sin(b[1] * Math.PI / 180) - Math.sin(a[1] * Math.PI / 180) * Math.cos(b[1] * Math.PI / 180) * Math.cos((b[0] - a[0]) * Math.PI / 180);
    var brg = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    return ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(brg / 45) % 8];
  }

  function selectPoi(poi) {
    var ll = state.georef.toLngLat(poi.x, poi.y);
    setResultsOnMap([{ type: 'poi', poi: poi }]);
    map.flyTo({ center: ll, zoom: 18, essential: true });
    var near = nearbyPanos(ll);
    var card = $('#card');
    card.innerHTML = '<button class="card-x" aria-label="Close">&times;</button><div class="card-kicker">Landmark</div><h2>' + esc(poi.name) + '</h2><div class="card-sub">From the master plan</div><div class="card-actions">' +
      (near.length ? '<button class="btn primary" data-act="pano">Street view nearby <span>' + fmtDist(near[0].d) + '</span></button>' : '') +
      '<a class="btn" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&destination=' + ll[1].toFixed(6) + ',' + ll[0].toFixed(6) + '">Directions</a></div>';
    card.hidden = false;
    card.querySelector('.card-x').onclick = function () { card.hidden = true; };
    var b = card.querySelector('[data-act=pano]'); if (b) b.onclick = function () { openPano(near[0].p); };
  }

  function selectBlock(b) {
    var box = state.search.blockBox(b); if (!box) return;
    var pts = [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]].map(function (q) { return state.georef.toLngLat(q[0], q[1]); });
    var lngs = pts.map(function (q) { return q[0]; }), lats = pts.map(function (q) { return q[1]; });
    map.fitBounds([[Math.min.apply(null, lngs), Math.min.apply(null, lats)], [Math.max.apply(null, lngs), Math.max.apply(null, lats)]], { padding: padding(), duration: 900 });
  }
  function padding() { var w = window.innerWidth; return w < 720 ? { top: 150, bottom: 40, left: 20, right: 20 } : { top: 60, bottom: 60, left: 420, right: 60 }; }
  function fitScheme(anim) {
    var b = state.overlay.bounds, pts = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]].map(function (q) { return state.georef.toLngLat(q[0], q[1]); });
    var lngs = pts.map(function (q) { return q[0]; }), lats = pts.map(function (q) { return q[1]; });
    map.fitBounds([[Math.min.apply(null, lngs), Math.min.apply(null, lats)], [Math.max.apply(null, lngs), Math.max.apply(null, lats)]], { padding: padding(), duration: anim ? 900 : 0 });
  }

  /* ---------------- search UI ---------------- */
  function wireSearch() {
    var q = $('#q'), t = null;
    q.addEventListener('input', function () { clearTimeout(t); t = setTimeout(runSearch, 90); });
    q.addEventListener('keydown', function (e) {
      var items = Array.prototype.slice.call(document.querySelectorAll('#results .res'));
      var cur = items.findIndex(function (x) { return x.classList.contains('active'); });
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); if (!items.length) return;
        var n = e.key === 'ArrowDown' ? Math.min(items.length - 1, cur + 1) : Math.max(0, cur - 1);
        items.forEach(function (x) { x.classList.remove('active'); }); items[n].classList.add('active'); items[n].scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') {
        e.preventDefault();
        var pick = cur >= 0 ? items[cur] : items[0];
        if (pick) pick.click();
      } else if (e.key === 'Escape') { q.value = ''; runSearch(); }
    });
    $('#clear').addEventListener('click', function () { q.value = ''; runSearch(); q.focus(); });
  }

  function runSearch() {
    var q = $('#q').value, box = $('#results'), sum = $('#summary');
    $('#clear').hidden = !q;
    if (!q.trim()) { box.innerHTML = ''; sum.textContent = ''; box.hidden = true; setResultsOnMap([]); return; }
    var r = state.search.search(q, { limit: 400 });
    state.lastResults = r.results;
    sum.textContent = r.summary || '';
    box.innerHTML = '';
    box.hidden = !r.results.length && !r.summary;
    var shown = 0;
    r.results.forEach(function (res, k) {
      if (shown >= 120) return;
      var d = el('button', 'res');
      if (res.type === 'plot') {
        var p = res.plot;
        d.innerHTML = '<span class="r-main">Plot ' + esc(p.label) + '</span><span class="r-sub">' + esc(state.search.blockLabel(p.block)) + (p.cat === 'C' ? ' · Commercial' : '') + '</span>';
      } else if (res.type === 'block') {
        d.innerHTML = '<span class="r-main">' + esc(state.search.blockLabel(res.block)) + '</span><span class="r-sub">' + (state.search.byBlock[res.block] || []).length + ' plots · show on map</span>';
        d.classList.add('is-block');
      } else {
        d.innerHTML = '<span class="r-main">' + esc(res.poi.name) + '</span><span class="r-sub">Landmark</span>';
        d.classList.add('is-poi');
      }
      d.addEventListener('click', function () { chooseResult(res); });
      box.appendChild(d); shown++;
    });
    if (r.total > shown) box.appendChild(el('div', 'more', 'Showing ' + shown + ' of ' + r.total + '. Add a block or number to narrow it down.'));
    // multiple plot matches (e.g. "6") -> show them all on the map so users can see where each is
    var mapRes = r.results.filter(function (x) { return x.type === 'plot' && (r.intent === 'number' ? x.why === 'number' || x.why === 'subdivided' : r.intent === 'plot'); }).slice(0, 80);
    setResultsOnMap(mapRes.length > 1 ? mapRes : []);
    if (r.intent === 'plot' && r.results[0] && r.results[0].type === 'plot' && r.results[0].score >= 95 && mapRes.length === 1) {
      // single confident hit: preview it on the map while typing, without stealing focus
      selectPlot(r.results[0].plot, true);
    } else if (mapRes.length > 1) {
      fitToResults(mapRes);
    }
  }

  function fitToResults(res) {
    var lls = res.map(function (r) { return r.plot ? plotLL(r.plot) : state.georef.toLngLat(r.poi.x, r.poi.y); });
    var lngs = lls.map(function (q) { return q[0]; }), lats = lls.map(function (q) { return q[1]; });
    map.fitBounds([[Math.min.apply(null, lngs), Math.min.apply(null, lats)], [Math.max.apply(null, lngs), Math.max.apply(null, lats)]], { padding: padding(), maxZoom: 18, duration: 700 });
  }

  function setResultsOnMap(res) {
    var src = map.getSource('results'); if (!src) return;
    var idx = state.lastResults || [];
    src.setData({ type: 'FeatureCollection', features: res.map(function (r) {
      var ll = r.plot ? plotLL(r.plot) : state.georef.toLngLat(r.poi.x, r.poi.y);
      return { type: 'Feature', geometry: { type: 'Point', coordinates: ll }, properties: { k: idx.indexOf(r), name: r.plot ? r.plot.block + ' ' + r.plot.label : r.poi.name } };
    }) });
  }

  function chooseResult(res) {
    if (res.type === 'plot') { selectPlot(res.plot, true); collapseResults(); }
    else if (res.type === 'block') { $('#q').value = 'Block ' + res.block + ' '; runSearch(); selectBlock(res.block); $('#q').focus(); }
    else { selectPoi(res.poi); collapseResults(); }
  }
  function collapseResults() { if (window.innerWidth < 720) $('#results').hidden = true; }

  function buildBlockChips() {
    var wrap = $('#chips');
    state.search.blocks.filter(function (b) { return !/^X/.test(b); }).forEach(function (b) {
      var c = el('button', 'chip', esc(b));
      c.title = state.search.blockLabel(b);
      c.onclick = function () { $('#q').value = 'Block ' + b + ' '; runSearch(); selectBlock(b); $('#q').focus(); };
      wrap.appendChild(c);
    });
  }

  /* ---------------- layer controls ---------------- */
  function wireLayerControls() {
    $('#op').addEventListener('input', function (e) { setOverlayOpacity(+e.target.value); });
    $('#t-plan').addEventListener('change', function (e) { state.overlay.tiles.forEach(function (t, i) { map.setLayoutProperty('plan' + i, 'visibility', e.target.checked ? 'visible' : 'none'); }); });
    $('#t-pano').addEventListener('change', function (e) { ['pano', 'pano-halo'].forEach(function (l) { map.setLayoutProperty(l, 'visibility', e.target.checked ? 'visible' : 'none'); }); });
    $('#t-labels').addEventListener('change', function (e) { ['roads', 'places'].forEach(function (l) { map.setLayoutProperty(l, 'visibility', e.target.checked ? 'visible' : 'none'); }); });
    $('#t-base').addEventListener('change', function (e) {
      var osm = e.target.value === 'map';
      map.setLayoutProperty('osm', 'visibility', osm ? 'visible' : 'none');
      map.setLayoutProperty('sat', 'visibility', osm ? 'none' : 'visible');
    });
    $('#layers-btn').addEventListener('click', function () { $('#layers').classList.toggle('open'); });
    $('#home').addEventListener('click', function () { fitScheme(true); });
  }

  function toast(msg) { var t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(t._h); t._h = setTimeout(function () { t.hidden = true; }, 1800); }

  /* ---------------- alignment (calibration) tool ---------------- */
  function initCalibration() {
    var panel = $('#calib'); panel.hidden = false;
    setOverlayOpacity(0.6); $('#op').value = 0.6;
    panel.addEventListener('click', function (e) {
      var b = e.target.closest('[data-nudge]');
      if (b) { nudge(b.dataset.nudge); return; }
      if (e.target.id === 'cp-add') startPoint();
      if (e.target.id === 'cp-export') exportGeoref();
      if (e.target.id === 'cp-reset') { if (confirmInline(e.target)) { try { localStorage.removeItem(STORE_KEY); } catch (er) {} location.reload(); } }
      var del = e.target.closest('[data-del]');
      if (del) { var cfg = state.georef.cfg; cfg.controlPoints.splice(+del.dataset.del, 1); applyCfg(cfg); }
      var tog = e.target.closest('[data-tog]');
      if (tog) { var c2 = state.georef.cfg, cp = c2.controlPoints[+tog.dataset.tog]; cp.disabled = !cp.disabled; applyCfg(c2); }
    });
    map.on('click', function (e) {
      var pend = state.calib.pending; if (!pend) return;
      if (pend.step === 1) {
        pend.plan = state.georef.toPlan(e.lngLat.lng, e.lngLat.lat);
        pend.step = 2;
        pend.m1 = new maplibregl.Marker({ color: '#ffb020' }).setLngLat(e.lngLat).addTo(map);
        setOverlayOpacity(0.25);
        renderCalib();
      } else if (pend.step === 2) {
        var cfg = state.georef.cfg; cfg.controlPoints = cfg.controlPoints || [];
        cfg.controlPoints.push({ label: 'P' + (cfg.controlPoints.length + 1), plan: [round(pend.plan[0], 2), round(pend.plan[1], 2)], lngLat: [round(e.lngLat.lng, 7), round(e.lngLat.lat, 7)] });
        pend.m1.remove(); state.calib.pending = null; map.getCanvas().style.cursor = '';
        setOverlayOpacity(+$('#op').value);
        applyCfg(cfg);
      }
    });
    document.addEventListener('keydown', function (e) {
      if (document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName)) return;
      var k = { ArrowUp: 'n', ArrowDown: 's', ArrowLeft: 'w', ArrowRight: 'e', q: 'rl', e: 'rr', '+': 'si', '=': 'si', '-': 'so' }[e.key];
      if (k) { e.preventDefault(); nudge(k, e.shiftKey ? 10 : 1); }
    });
    renderCalib();
  }
  function confirmInline(btn) { if (btn.dataset.armed) return true; btn.dataset.armed = 1; btn.textContent = 'Click again to reset'; setTimeout(function () { delete btn.dataset.armed; btn.textContent = 'Reset to saved file'; }, 2500); return false; }
  function round(v, d) { var k = Math.pow(10, d); return Math.round(v * k) / k; }
  function startPoint() {
    state.calib.pending = { step: 1 }; map.getCanvas().style.cursor = 'crosshair'; renderCalib();
  }
  function nudge(dir, mult) {
    mult = mult || 1;
    var cfg = state.georef.cfg;
    if ((cfg.controlPoints || []).filter(function (p) { return !p.disabled; }).length >= 2) { toast('Nudging is for rough placement. Remove control points to nudge.'); return; }
    var p = cfg.params, step = +$('#step').value * mult; // metres
    var dLat = step / 111320, dLng = step / (111320 * Math.cos(p.anchorLngLat[1] * Math.PI / 180));
    if (dir === 'n') p.anchorLngLat[1] += dLat;
    if (dir === 's') p.anchorLngLat[1] -= dLat;
    if (dir === 'e') p.anchorLngLat[0] += dLng;
    if (dir === 'w') p.anchorLngLat[0] -= dLng;
    if (dir === 'rl') p.rotationDeg -= 0.1 * mult * Math.max(1, step / 5);
    if (dir === 'rr') p.rotationDeg += 0.1 * mult * Math.max(1, step / 5);
    if (dir === 'si') p.metersPerUnit *= 1 + 0.002 * mult * Math.max(1, step / 5);
    if (dir === 'so') p.metersPerUnit /= 1 + 0.002 * mult * Math.max(1, step / 5);
    // keep the plan centre fixed on screen while rotating/scaling
    applyCfg(cfg);
  }
  function applyCfg(cfg) {
    state.georef.set(cfg);
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state.georef.cfg)); } catch (e) { /* ignore */ }
    refreshGeoref();
  }
  function renderCalib() {
    var g = state.georef, cfg = g.cfg, res = g.residuals(), pend = state.calib.pending;
    var html = '<h3>Align master plan</h3>' +
      '<p class="muted">Mode: <b>' + esc(g.mode) + '</b> · scale ' + g.metersPerUnit().toFixed(3) + ' m per plan unit</p>' +
      '<div class="nudge"><label>Step <select id="step"><option value="1">1 m</option><option value="5" selected>5 m</option><option value="25">25 m</option><option value="100">100 m</option></select></label>' +
      '<div class="pad"><button data-nudge="n">↑</button><button data-nudge="w">←</button><button data-nudge="e">→</button><button data-nudge="s">↓</button></div>' +
      '<div class="pad2"><button data-nudge="rl">⟲ rotate</button><button data-nudge="rr">⟳ rotate</button><button data-nudge="so">− smaller</button><button data-nudge="si">+ bigger</button></div>' +
      '<p class="muted small">Keyboard: arrows move, Q/E rotate, +/− scale, hold Shift for 10×. Rough placement first, then add control points.</p></div>' +
      '<div class="cp-h">Control points</div>';
    if (pend) html += '<div class="cp-step">' + (pend.step === 1 ? '1. Click a sharp feature on the <b>master plan</b> (road junction, roundabout, corner).' : '2. Now click the <b>same spot on the satellite</b> image.') + '</div>';
    html += '<ol class="cps">';
    (cfg.controlPoints || []).forEach(function (p, i) {
      html += '<li class="' + (p.disabled ? 'off' : '') + '"><span>' + esc(p.label || 'P' + (i + 1)) + '</span><span class="err">' + (res[i] != null ? res[i].toFixed(1) + ' m' : '') + '</span><button data-tog="' + i + '">' + (p.disabled ? 'use' : 'skip') + '</button><button data-del="' + i + '">✕</button></li>';
    });
    html += '</ol>';
    html += '<div class="calib-actions"><button id="cp-add" class="btn primary">+ Add control point</button><button id="cp-export" class="btn">Download georef.json</button><button id="cp-reset" class="btn ghost">Reset to saved file</button></div>' +
      '<p class="muted small">Use 4–8 points spread around the scheme edges. Errors under 2 m are good. Save the downloaded file as <code>data/georef.json</code>.</p>';
    var step = $('#step') ? $('#step').value : '5';
    $('#calib').innerHTML = html;
    $('#step').value = step;
  }
  function exportGeoref() {
    var blob = new Blob([JSON.stringify(state.georef.cfg, null, 2)], { type: 'application/json' });
    var a = el('a'); a.href = URL.createObjectURL(blob); a.download = 'georef.json'; a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }
})();
