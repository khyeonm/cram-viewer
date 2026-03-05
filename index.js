// AutoPipe Plugin: cram-viewer
// CRAM file structure/metadata viewer

(function() {
  var rootEl = null;
  var fileInfo = {};
  var containers = [];

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  // Read ITF-8 encoded integer (CRAM spec)
  function readITF8(data, pos) {
    var b0 = data[pos];
    if ((b0 & 0x80) === 0) return { val: b0, end: pos + 1 };
    if ((b0 & 0xc0) === 0x80) return { val: ((b0 & 0x3f) << 8) | data[pos + 1], end: pos + 2 };
    if ((b0 & 0xe0) === 0xc0) return { val: ((b0 & 0x1f) << 16) | (data[pos + 1] << 8) | data[pos + 2], end: pos + 3 };
    if ((b0 & 0xf0) === 0xe0) return { val: ((b0 & 0x0f) << 24) | (data[pos + 1] << 16) | (data[pos + 2] << 8) | data[pos + 3], end: pos + 4 };
    return { val: ((b0 & 0x0f) << 28) | (data[pos + 1] << 20) | (data[pos + 2] << 12) | (data[pos + 3] << 4) | (data[pos + 4] & 0x0f), end: pos + 5 };
  }

  function parseCRAM(buf) {
    var data = new Uint8Array(buf);
    var view = new DataView(buf);

    // File definition (26 bytes)
    var magic = String.fromCharCode(data[0], data[1], data[2], data[3]);
    if (magic !== 'CRAM') throw new Error('Not a valid CRAM file');

    var majorVersion = data[4];
    var minorVersion = data[5];

    // File ID (20 bytes)
    var fileId = '';
    for (var i = 6; i < 26; i++) {
      if (data[i] === 0) break;
      fileId += String.fromCharCode(data[i]);
    }

    fileInfo = {
      magic: magic,
      version: majorVersion + '.' + minorVersion,
      fileId: fileId || '(none)',
      fileSize: formatSize(data.length)
    };

    // Parse container headers
    containers = [];
    var pos = 26;
    var maxContainers = 100;

    while (pos < data.length && containers.length < maxContainers) {
      if (pos + 4 > data.length) break;

      // Container header
      var containerLen = view.getInt32(pos, false); // big-endian in CRAM
      // Try little-endian if big-endian gives unreasonable values
      if (containerLen < 0 || containerLen > data.length) {
        containerLen = view.getInt32(pos, true);
      }
      if (containerLen < 0 || containerLen > data.length) break;
      pos += 4;

      if (pos + 20 > data.length) break;

      var refSeqId, refPos, alignSpan, nRecords, recCounter, nBases, nBlocks;
      try {
        var r1 = readITF8(data, pos); refSeqId = r1.val; pos = r1.end;
        var r2 = readITF8(data, pos); refPos = r2.val; pos = r2.end;
        var r3 = readITF8(data, pos); alignSpan = r3.val; pos = r3.end;
        var r4 = readITF8(data, pos); nRecords = r4.val; pos = r4.end;
        var r5 = readITF8(data, pos); recCounter = r5.val; pos = r5.end;
        var r6 = readITF8(data, pos); nBases = r6.val; pos = r6.end;
        var r7 = readITF8(data, pos); nBlocks = r7.val; pos = r7.end;
      } catch(e) { break; }

      containers.push({
        idx: containers.length,
        length: containerLen,
        refSeqId: refSeqId,
        refPos: refPos,
        alignSpan: alignSpan,
        nRecords: nRecords,
        nBlocks: nBlocks
      });

      // Skip to next container
      pos += containerLen;
      if (containerLen <= 0) break;
    }
  }

  function render() {
    if (!rootEl) return;
    var totalRecords = 0;
    for (var i = 0; i < containers.length; i++) totalRecords += containers[i].nRecords;

    var html = '<div class="cram-plugin">';

    // Summary
    html += '<div class="cram-summary">';
    html += '<span class="stat">CRAM <b>v' + fileInfo.version + '</b></span>';
    html += '<span class="stat">Size: <b>' + fileInfo.fileSize + '</b></span>';
    html += '<span class="stat"><b>' + containers.length + '</b> containers</span>';
    html += '<span class="stat"><b>' + totalRecords.toLocaleString() + '</b> records</span>';
    html += '</div>';

    // File info
    html += '<div class="cram-info-section">';
    html += '<div class="cram-info-header">File Definition</div>';
    html += '<div class="cram-info-content">';
    html += '<div class="cram-info-row"><span class="cram-info-label">Magic</span><span class="cram-info-value">' + fileInfo.magic + '</span></div>';
    html += '<div class="cram-info-row"><span class="cram-info-label">Version</span><span class="cram-info-value">' + fileInfo.version + '</span></div>';
    html += '<div class="cram-info-row"><span class="cram-info-label">File ID</span><span class="cram-info-value">' + fileInfo.fileId + '</span></div>';
    html += '<div class="cram-info-row"><span class="cram-info-label">File Size</span><span class="cram-info-value">' + fileInfo.fileSize + '</span></div>';
    html += '</div></div>';

    // Container table
    html += '<div class="cram-table-wrap" style="max-height:400px;overflow:auto;">';
    html += '<table class="cram-table"><thead><tr>';
    html += '<th>#</th><th>Ref ID</th><th>Ref Pos</th><th>Span</th><th>Records</th><th>Blocks</th><th>Size</th>';
    html += '</tr></thead><tbody>';

    for (var ci = 0; ci < containers.length; ci++) {
      var c = containers[ci];
      html += '<tr>';
      html += '<td style="color:#aaa">' + c.idx + '</td>';
      html += '<td>' + (c.refSeqId === -1 ? 'unmapped' : c.refSeqId === -2 ? 'multi-ref' : c.refSeqId) + '</td>';
      html += '<td>' + c.refPos.toLocaleString() + '</td>';
      html += '<td>' + c.alignSpan.toLocaleString() + '</td>';
      html += '<td>' + c.nRecords.toLocaleString() + '</td>';
      html += '<td>' + c.nBlocks + '</td>';
      html += '<td>' + formatSize(c.length) + '</td>';
      html += '</tr>';
    }
    html += '</tbody></table></div>';

    // Note
    html += '<div class="cram-note">CRAM uses reference-based compression. Full alignment decoding requires a matching reference genome. This viewer shows file structure and container metadata.</div>';

    html += '</div>';
    rootEl.innerHTML = html;
  }

  window.AutoPipePlugin = {
    render: function(container, fileUrl, filename) {
      rootEl = container;
      rootEl.innerHTML = '<div class="cram-loading">Loading ' + filename + '...</div>';
      fileInfo = {}; containers = [];

      fetch(fileUrl)
        .then(function(resp) { return resp.arrayBuffer(); })
        .then(function(buf) {
          try {
            parseCRAM(buf);
            render();
          } catch(e) {
            rootEl.innerHTML = '<div class="cram-error">Error parsing CRAM: ' + e.message + '</div>';
          }
        })
        .catch(function(err) {
          rootEl.innerHTML = '<div class="cram-error">Error loading file: ' + err.message + '</div>';
        });
    },
    destroy: function() { fileInfo = {}; containers = []; rootEl = null; }
  };
})();
