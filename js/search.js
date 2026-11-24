/* Central Park Plot Finder: forgiving plot search.
 * Understands things like: "6 b", "6b", "b6", "B-6", "plot 6 block B", "plot no. 6, b block",
 * "51/1 A", "block b" (all plots in B), "6" (plot 6 in every block), "a1 12", "mosque", "park near d".
 * Works in the browser (window.PlotSearch) and in Node (module.exports) for testing.
 */
(function (root) {
  'use strict';

  var FILLER = /\b(PLOTS?|PLT|PLOTNO|NO|NOS|NUM|NUMBER|NMBR|HOUSE|HOUSES|PROPERTY|BLOCKS?|BLOK|BLOC|BLK|BLCK|SECTOR|SEC|IN|OF|THE|AT|ON|FIND|SHOW|ME|WHERE|IS|LOCATE|SEARCH|PHASE ?(?:I|1|ONE)|CENTRAL|PARK HOUSING|SCHEME|CPHS|AND|FOR|MARLA|KANAL)\b/g;
  var WORD_NUM = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5, SIX: 6, SEVEN: 7, EIGHT: 8, NINE: 9, TEN: 10 };
  var BLOCK_ALIASES = { 'DOUBLE A': 'AA', 'DOUBLE B': 'BB', 'A ONE': 'A1' };

  function PlotSearch(data) {
    this.fields = data.fields;
    this.blockNames = data.blockNames || {};
    this.plots = data.plots.map(function (p, i) {
      return { i: i, block: p[0], label: p[1], n: p[2], sub: p[3] || '', x: p[4], y: p[5], angle: p[6], cat: p[7] || 'R' };
    });
    this.pois = (data.pois || []).map(function (p, i) { return { i: i, name: p.name, x: p.x, y: p.y, kind: 'poi' }; });
    var blocks = {};
    this.byBlock = {};
    this.byNumber = {};
    var self = this;
    this.plots.forEach(function (p) {
      blocks[p.block] = true;
      (self.byBlock[p.block] = self.byBlock[p.block] || []).push(p);
      (self.byNumber[p.n] = self.byNumber[p.n] || []).push(p);
    });
    this.blocks = Object.keys(blocks).sort(blockSort);
    Object.keys(this.byBlock).forEach(function (b) { self.byBlock[b].sort(plotSort); });
  }

  function blockSort(a, b) {
    var ua = /^X/.test(a), ub = /^X/.test(b);
    if (ua !== ub) return ua ? 1 : -1;
    return a.length - b.length || a.localeCompare(b);
  }
  function plotSort(a, b) {
    return a.n - b.n || (a.sub ? +a.sub : 0) - (b.sub ? +b.sub : 0) || a.label.localeCompare(b.label);
  }

  PlotSearch.prototype.blockLabel = function (b) {
    return this.blockNames[b] || ('Block ' + b);
  };

  /* Turn free text into {numbers:[{n,sub}], blocks:[codes], words:[leftover words]} */
  PlotSearch.prototype.parse = function (q) {
    var s = (' ' + String(q || '') + ' ').toUpperCase();
    Object.keys(BLOCK_ALIASES).forEach(function (k) { s = s.replace(new RegExp('\\b' + k + '\\b', 'g'), ' ' + BLOCK_ALIASES[k] + ' '); });
    var poiWords = [];
    // keep meaningful words for landmark search before stripping filler
    s.replace(/[A-Z]{3,}/g, function (w) { poiWords.push(w); return w; });
    s = s.replace(/[#,.;:()_\[\]'"]/g, ' ').replace(FILLER, ' ');
    Object.keys(WORD_NUM).forEach(function (w) { s = s.replace(new RegExp('\\b' + w + '\\b', 'g'), ' ' + WORD_NUM[w] + ' '); });
    // separate glued tokens: "6B" -> "6 B", "B6" -> "B 6" (but keep block codes like A1 when they exist)
    var self = this, numbers = [], blocks = [], words = [];
    var tokens = s.match(/\d+\s*\/\s*\d+|\d+|[A-Z]+\d*/g) || [];
    tokens.forEach(function (t) {
      t = t.replace(/\s+/g, '');
      if (/^\d/.test(t)) {
        var m = t.split('/');
        numbers.push({ n: parseInt(m[0], 10), sub: m[1] ? String(parseInt(m[1], 10)) : null });
        return;
      }
      if (self.byBlock[t]) { blocks.push(t); return; }
      var lm = t.match(/^([A-Z]+)(\d+)$/);
      if (lm) {
        if (self.byBlock[lm[1]]) { blocks.push(lm[1]); numbers.push({ n: parseInt(lm[2], 10), sub: null }); return; }
      }
      if (t.length <= 2 && self.byBlock[t[0]] && t.length === 2 && t[0] === t[1] && !self.byBlock[t]) { blocks.push(t[0]); return; }
      words.push(t);
    });
    // "A 1" could mean Block A1. Remember that possibility.
    var altBlocks = [];
    blocks.forEach(function (b) {
      numbers.forEach(function (nn) { if (!nn.sub && self.byBlock[b + nn.n]) altBlocks.push({ block: b + nn.n, used: nn }); });
    });
    var commercial = poiWords.some(function (w) { return /^(COMMERCIAL|COMM|COMERCIAL|SHOPS?|SHOP|BUSINESS)$/.test(w); });
    return { commercial: commercial, numbers: numbers, blocks: blocks, words: words.filter(function (w) { return w.length >= 3; }), poiWords: poiWords, altBlocks: altBlocks };
  };

  function plotResult(p, score, why) { return { type: 'plot', plot: p, score: score, why: why }; }

  /* Main search. Returns {results:[...], summary:string, intent} */
  PlotSearch.prototype.search = function (q, opts) {
    opts = opts || {};
    var limit = opts.limit || 60;
    var P = this.parse(q), self = this, out = [];
    var summary = '', intent = 'none';
    if (!String(q || '').trim()) return { results: [], summary: '', intent: intent, parsed: P };

    var numbers = P.numbers, blocks = P.blocks;
    var pushPlot = function (p, score, why) {
      if (P.commercial) score += p.cat === 'C' ? 15 : -15; else if (p.cat === 'C') score -= 12;
      out.push(plotResult(p, score, why));
    };

    if (numbers.length && blocks.length) {
      intent = 'plot';
      numbers.forEach(function (nn) {
        blocks.forEach(function (b) {
          (self.byBlock[b] || []).forEach(function (p) {
            if (p.n !== nn.n) return;
            if (nn.sub) { if (p.sub === nn.sub) pushPlot(p, 100, 'exact'); }
            else pushPlot(p, p.sub ? 80 : 100, p.sub ? 'subdivided' : 'exact');
          });
        });
      });
      // number given but did not exist in that block: suggest same number elsewhere
      if (!out.length) {
        numbers.forEach(function (nn) {
          (self.byNumber[nn.n] || []).forEach(function (p) { if (!nn.sub || p.sub === nn.sub) pushPlot(p, 40, 'other-block'); });
        });
        summary = 'No plot ' + fmtNum(numbers[0]) + ' found in ' + blocks.map(function (b) { return self.blockLabel(b); }).join(', ') + '. Showing plot ' + fmtNum(numbers[0]) + ' in other blocks.';
      }
      P.altBlocks.forEach(function (ab) {
        out.push({ type: 'block', block: ab.block, score: 70, why: 'did you mean' });
        numbers.forEach(function (nn) {
          if (nn === ab.used) return;
          (self.byBlock[ab.block] || []).forEach(function (p) { if (p.n === nn.n && (!nn.sub || p.sub === nn.sub)) pushPlot(p, 95, 'exact'); });
        });
      });
    } else if (numbers.length) {
      intent = 'number';
      numbers.forEach(function (nn) {
        (self.byNumber[nn.n] || []).forEach(function (p) {
          if (nn.sub && p.sub !== nn.sub) return;
          pushPlot(p, p.sub && !nn.sub ? 70 : 90, 'number');
        });
      });
      // prefix matches help while typing ("12" -> 120, 121 ...)
      if (out.length < 12 && !numbers[0].sub && String(numbers[0].n).length < 4) {
        var pre = String(numbers[0].n);
        self.plots.forEach(function (p) {
          if (p.n !== numbers[0].n && String(p.n).indexOf(pre) === 0 && !p.sub) pushPlot(p, 30 - String(p.n).length, 'prefix');
        });
      }
      var blocksWith = {};
      out.forEach(function (r) { if (r.why === 'number') blocksWith[r.plot.block] = 1; });
      var nb = Object.keys(blocksWith).length;
      summary = nb ? 'Plot ' + fmtNum(numbers[0]) + ' exists in ' + nb + ' block' + (nb > 1 ? 's' : '') + '. Pick one.' : 'No plot ' + fmtNum(numbers[0]) + ' found.';
    } else if (blocks.length) {
      intent = 'block';
      blocks.forEach(function (b) {
        out.push({ type: 'block', block: b, score: 100, why: 'block' });
        (self.byBlock[b] || []).forEach(function (p) { pushPlot(p, 50, 'in-block'); });
      });
      summary = blocks.map(function (b) { return self.blockLabel(b) + ': ' + (self.byBlock[b] || []).length + ' plots'; }).join(' · ');
    }

    // landmarks / words
    var words = P.poiWords.filter(function (w) { return !/^(PLOTS?|BLOCKS?|BLK|BLOK|NUMBER|PHASE|HOUSE|CENTRAL|SCHEME|SHOW|FIND|WHERE|NEAR|THE|COMMERCIAL|COMM|SHOPS?|AND|FOR)$/.test(w); });
    if (words.length) {
      self.pois.forEach(function (poi) {
        var name = poi.name.toUpperCase(), sc = 0;
        words.forEach(function (w) {
          if (name.indexOf(w) >= 0) sc += 10;
          else if (fuzzyHas(name, w)) sc += 6;
        });
        if (sc) out.push({ type: 'poi', poi: poi, score: 20 + sc, why: 'landmark' });
      });
      if (intent === 'none') { intent = 'poi'; summary = out.length ? 'Landmarks matching "' + words.join(' ').toLowerCase() + '"' : ''; }
      // landmarks near a requested block
      if (blocks.length && intent !== 'plot') {
        var bset = blocks.map(function (b) { return self.blockBox(b); });
        out.forEach(function (r) {
          if (r.type !== 'poi') return;
          bset.forEach(function (bx) { if (bx && r.poi.x >= bx[0] - 30 && r.poi.x <= bx[2] + 30 && r.poi.y >= bx[1] - 30 && r.poi.y <= bx[3] + 30) r.score += 60; });
        });
      }
    }

    // de-duplicate, sort
    var seen = {};
    out = out.filter(function (r) {
      var k = r.type + ':' + (r.plot ? r.plot.i : r.poi ? r.poi.i : r.block);
      if (seen[k]) return false; seen[k] = 1; return true;
    });
    out.sort(function (a, b) {
      if (b.score !== a.score) return b.score - a.score;
      if (a.plot && b.plot) return blockSort(a.plot.block, b.plot.block) || plotSort(a.plot, b.plot);
      return 0;
    });
    if (!out.length && !summary) summary = 'Nothing matched. Try "6 B", "Block C" or a landmark like "mosque".';
    return { results: out.slice(0, limit), total: out.length, summary: summary, intent: intent, parsed: P };
  };

  PlotSearch.prototype.blockBox = function (b) {
    var ps = this.byBlock[b]; if (!ps || !ps.length) return null;
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    ps.forEach(function (p) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
    return [x0, y0, x1, y1];
  };

  PlotSearch.prototype.findExact = function (block, label) {
    var ps = this.byBlock[block] || [];
    for (var i = 0; i < ps.length; i++) if (ps[i].label === label || String(ps[i].n) + (ps[i].sub ? '/' + ps[i].sub : '') === label) return ps[i];
    return null;
  };

  function fmtNum(nn) { return nn.n + (nn.sub ? '/' + nn.sub : ''); }

  // tolerant word match: one typo allowed for words of 5+ letters
  function fuzzyHas(name, w) {
    if (w.length < 5) return false;
    var parts = name.split(/[^A-Z]+/);
    for (var i = 0; i < parts.length; i++) if (lev(parts[i], w) <= 1) return true;
    return false;
  }
  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 1) return 9;
    var d = [], i, j;
    for (i = 0; i <= a.length; i++) d[i] = [i];
    for (j = 0; j <= b.length; j++) d[0][j] = j;
    for (i = 1; i <= a.length; i++) for (j = 1; j <= b.length; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = PlotSearch;
  else root.PlotSearch = PlotSearch;
})(this);
