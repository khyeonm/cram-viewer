// AutoPipe Plugin: cram-viewer
// CRAM alignment viewer — IGV-only (requires reference genome)
// Supported extensions: cram

(function() {
  var _container = null;

  // ── IGV.js integration ──
  var KNOWN_GENOMES = [
    {id:'hg38', label:'Human (GRCh38/hg38)'},
    {id:'hg19', label:'Human (GRCh37/hg19)'},
    {id:'mm39', label:'Mouse (GRCm39/mm39)'},
    {id:'mm10', label:'Mouse (GRCm38/mm10)'},
    {id:'rn7',  label:'Rat (mRatBN7.2/rn7)'},
    {id:'rn6',  label:'Rat (Rnor_6.0/rn6)'},
    {id:'dm6',  label:'Fruit fly (BDGP6/dm6)'},
    {id:'ce11', label:'C. elegans (WBcel235/ce11)'},
    {id:'danRer11', label:'Zebrafish (GRCz11/danRer11)'},
    {id:'sacCer3',  label:'Yeast (sacCer3)'},
    {id:'tair10',   label:'Arabidopsis (TAIR10)'},
    {id:'galGal6',  label:'Chicken (GRCg6a/galGal6)'}
  ];
  var _igvRef = null;
  var _selectedGenome = null;
  var _igvBrowser = null;

  // Width of the region IGV opens at. Alignment tracks stop rendering past
  // their 30kb visibility window; 2kb keeps individual reads legible as bands.
  var IGV_WINDOW = 2000;

  function _escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // The reference arrives either as a genome ID, a bare filename, or a full
  // path (show_results passes whatever the caller supplied). /file/ is keyed by
  // filename alone, so strip any directory part.
  function _refUrl(ref) {
    var base = String(ref).replace(/\\/g, '/').split('/').pop();
    return '/file/' + encodeURIComponent(base);
  }

  function _disposeIgvBrowser() {
    if (_igvBrowser) {
      // The host never calls destroy(), and igv.js keeps every browser it
      // creates in a module-level list. Without this, each re-render leaks a
      // browser plus its listeners and caches.
      try { igv.removeBrowser(_igvBrowser); } catch (e) { /* already detached */ }
      _igvBrowser = null;
    }
  }

  // Probe for a sidecar index. igv.js otherwise guesses "<url>.crai" and fails
  // silently when the guess is wrong or the server never registered the index.
  // A 1-byte ranged GET is used rather than HEAD so this works on any server
  // that serves /file/.
  function _probeUrl(url) {
    return fetch(url, { headers: { Range: 'bytes=0-0' } })
      .then(function(r) { return r.ok ? url : null; })
      .catch(function() { return null; });
  }

  function _findIndex(fileUrl, exts) {
    var candidates = [];
    for (var i = 0; i < exts.length; i++) {
      candidates.push(fileUrl + '.' + exts[i]);                       // reads.cram.crai
      candidates.push(fileUrl.replace(/\.[^.\/]+$/, '.' + exts[i]));  // reads.crai
    }
    return candidates.reduce(function(chain, url) {
      return chain.then(function(found) { return found || _probeUrl(url); });
    }, Promise.resolve(null));
  }

  // Without an explicit locus igv.js opens at the whole first chromosome (or
  // the whole genome when the reference has several contigs), which is far past
  // the alignment track's visibility window — the track renders nothing.
  //
  // CRAM has no /data/ source to read a first alignment from, so fall back to
  // the head of the reference's first contig. That leaves the track live and
  // navigable instead of permanently blank; jumping straight to the first read
  // would need a server-side data source like the one bam-viewer has.
  function _resolveLocus(refIndexUrl) {
    if (!refIndexUrl) return Promise.resolve(null);
    return fetch(refIndexUrl)
      .then(function(r) { return r.ok ? r.text() : null; })
      .then(function(text) {
        var line = text && text.split('\n')[0];
        var name = line && line.split('\t')[0];
        return name ? name + ':1-' + IGV_WINDOW : null;
      })
      .catch(function() { return null; });
  }

  function _fetchReference() {
    return fetch('/api/reference').then(function(r) { return r.json(); })
      .then(function(d) { _igvRef = d.reference || null; })
      .catch(function() { _igvRef = null; });
  }

  function _loadIgvJs() {
    return new Promise(function(resolve, reject) {
      if (window.igv) { resolve(); return; }
      var s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/igv@3/dist/igv.min.js';
      s.onload = function() { resolve(); };
      s.onerror = function() { reject(new Error('Failed to load igv.js')); };
      document.head.appendChild(s);
    });
  }

  function _buildGenomeDropdown() {
    var current = _selectedGenome || _igvRef || '';
    var refLabel = _igvRef ? String(_igvRef).replace(/\\/g, '/').split('/').pop() : '';
    var html = '<span style="font-size:12px;color:#888;font-weight:500;margin-right:4px">Reference:</span>';
    html += '<select id="__igv_genome_select__" style="font-size:12px;padding:4px 8px;max-width:220px;border:1px solid #ddd;border-radius:4px">';
    html += '<option value="' + _escapeHtml(_igvRef || '') + '"' + (current === _igvRef ? ' selected' : '') + '>' + _escapeHtml(refLabel || 'none') + '</option>';
    KNOWN_GENOMES.forEach(function(g) {
      if (g.id !== _igvRef) {
        html += '<option value="' + g.id + '"' + (current === g.id ? ' selected' : '') + '>' + g.label + '</option>';
      }
    });
    html += '</select>';
    return html;
  }

  function _renderIgv(container, fileUrl, filename) {
    _disposeIgvBrowser();
    container.innerHTML = '';
    var div = document.createElement('div');
    div.className = 'ap-loading';
    div.textContent = 'Loading...';
    container.appendChild(div);

    var activeRef = _selectedGenome || _igvRef;
    var knownIds = KNOWN_GENOMES.map(function(g) { return g.id; });
    var isKnownGenome = knownIds.indexOf(activeRef) >= 0;

    return Promise.all([
      _loadIgvJs(),
      _findIndex(fileUrl, ['crai']),
      isKnownGenome ? Promise.resolve(null) : _findIndex(_refUrl(activeRef), ['fai'])
    ]).then(function(results) {
      var trackIndex = results[1], refIndex = results[2];
      return _resolveLocus(refIndex).then(function(locus) {
        // The user may have switched views while the probes were in flight.
        if (!div.isConnected) return;
        div.textContent = '';
        div.className = '';

        var opts = {};
        if (isKnownGenome) {
          opts.genome = activeRef;
        } else {
          opts.reference = { fastaURL: _refUrl(activeRef) };
          if (refIndex) {
            // Indexed means igv.js range-reads the FASTA instead of pulling the
            // whole file into memory — the difference between a few KB and the
            // entire reference.
            opts.reference.indexURL = refIndex;
            opts.reference.indexed = true;
          } else {
            opts.reference.indexed = false;
          }
        }
        if (locus) opts.locus = locus;

        var track = { type: 'alignment', format: 'cram', url: fileUrl, name: filename };
        if (trackIndex) track.indexURL = trackIndex;
        opts.tracks = [track];

        // Returned, not fire-and-forget: a rejected createBrowser used to become
        // an unhandled rejection and leave a blank pane with no explanation.
        return igv.createBrowser(div, opts).then(function(browser) {
          _igvBrowser = browser;
        });
      });
    }).catch(function(e) {
      container.innerHTML = '<div style="color:red;padding:16px;">IGV Error: ' +
        _escapeHtml(e && e.message ? e.message : String(e)) + '</div>';
    });
  }

  function _showView(container, fileUrl, filename) {
    // Every path through here replaces container.innerHTML, detaching any live
    // IGV browser — drop it before the DOM goes away.
    _disposeIgvBrowser();
    if (_igvRef) {
      // Reference available → IGV viewer with genome dropdown
      var html = '<div style="margin-bottom:12px">' + _buildGenomeDropdown() + '</div>';
      html += '<div id="__plugin_content__"></div>';
      container.innerHTML = html;

      var genomeSelect = container.querySelector('#__igv_genome_select__');
      if (genomeSelect) genomeSelect.onchange = function() { _selectedGenome = this.value; _showView(container, fileUrl, filename); };

      var content = container.querySelector('#__plugin_content__');
      _renderIgv(content, fileUrl, filename);
    } else {
      // No reference → warning
      container.innerHTML =
        '<div style="padding:24px;text-align:center;color:#666">' +
        '<div style="font-size:48px;margin-bottom:16px">&#9888;</div>' +
        '<h3 style="margin:0 0 8px 0;color:#333">Reference Genome Required</h3>' +
        '<p style="margin:0 0 12px 0">CRAM files use reference-based compression and require a reference genome for viewing.</p>' +
        '<p style="margin:0;font-size:13px;color:#888">Provide a reference genome (FASTA) in your working directory to enable IGV visualization.</p>' +
        '</div>';
    }
  }

  window.AutoPipePlugin = {
    render: function(container, fileUrl, filename) {
      // The host caches the plugin instance and only ever calls render(), so
      // this is the one reliable teardown point between files.
      _disposeIgvBrowser();
      _container = container;
      _container.innerHTML = '<div class="ap-loading">Loading...</div>';
      _selectedGenome = null;

      _fetchReference().then(function() {
        _showView(container, fileUrl, filename);
      });
    },
    destroy: function() {
      _disposeIgvBrowser();
      _container = null;
    }
  };
})();
