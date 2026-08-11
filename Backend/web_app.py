"""
Text Inspection web app.

Flow:
  1. Upload Master PDF, upload Sample PDF — both preview side-by-side
     immediately, fit-to-screen with zoom in/out controls.
  2. Click Inspect once both are uploaded.
  3. Results appear in a bottom panel: each finding shows Master value,
     Sample value, and the comment (same "Change: X should be Y as in
     the original" / "Missing in sample" / "Extra text in sample" text
     the backend already generates). Click a finding to highlight it —
     only the side(s) that actually have a box light up (Insertion =
     Sample only, Deletion = Master only, Change/Location = both).
     Hover over a highlight box to see its comment as a tooltip.

Run:
    python web_app.py
Then open http://127.0.0.1:5000 in your browser.
"""

import os
import sys
from flask import Flask, request, jsonify, send_from_directory, render_template_string

sys.path.append(os.path.dirname(__file__))
from src.pipelines.comparison_pipeline import run_text_inspection
from src.pipelines.report_builder import build_report, render_page

app = Flask(__name__)

UPLOAD_ROOT = os.path.join("webapp_uploads")
OUTPUT_ROOT = os.path.join("webapp_outputs")
os.makedirs(UPLOAD_ROOT, exist_ok=True)
os.makedirs(OUTPUT_ROOT, exist_ok=True)


@app.route("/")
def index():
    return render_template_string(INDEX_HTML)


@app.route("/api/upload", methods=["POST"])
def api_upload():
    session_id = request.form.get("session_id")
    side = request.form.get("side")
    file = request.files.get("file")

    if not session_id or side not in ("master", "sample") or not file:
        return jsonify({"error": "session_id, side (master/sample), and file are required"}), 400

    session_dir = os.path.join(UPLOAD_ROOT, session_id)
    os.makedirs(session_dir, exist_ok=True)
    pdf_path = os.path.join(session_dir, f"{side}.pdf")
    file.save(pdf_path)

    try:
        preview_dir = os.path.join(OUTPUT_ROOT, session_id)
        os.makedirs(preview_dir, exist_ok=True)
        preview_path = os.path.join(preview_dir, f"{side}_preview_p0.png")
        w, h = render_page(pdf_path, 0, preview_path)
    except Exception as e:
        return jsonify({"error": f"Could not render preview: {str(e)}"}), 500

    return jsonify({
        "side": side,
        "image": f"/images/{session_id}/{side}_preview_p0.png",
        "width": w,
        "height": h,
        "filename": file.filename,
    })


@app.route("/api/inspect", methods=["POST"])
def api_inspect():
    data = request.get_json()
    session_id = data.get("session_id")
    if not session_id:
        return jsonify({"error": "session_id required"}), 400

    session_dir = os.path.join(UPLOAD_ROOT, session_id)
    master_path = os.path.join(session_dir, "master.pdf")
    sample_path = os.path.join(session_dir, "sample.pdf")

    if not os.path.exists(master_path) or not os.path.exists(sample_path):
        return jsonify({"error": "Both Master and Sample must be uploaded first"}), 400

    try:
        result = run_text_inspection(master_path, sample_path)
    except Exception as e:
        return jsonify({"error": f"Inspection failed: {str(e)}"}), 500

    output_dir = os.path.join(OUTPUT_ROOT, session_id)

    try:
        report = build_report(master_path, sample_path, result, output_dir)
    except Exception as e:
        return jsonify({"error": f"Report rendering failed: {str(e)}"}), 500

    for page in report["pages"]:
        if "master_image" in page:
            page["master_image"] = f"/images/{session_id}/{os.path.basename(page['master_image'])}"
        if "sample_image" in page:
            page["sample_image"] = f"/images/{session_id}/{os.path.basename(page['sample_image'])}"

    report["match_stats"] = result["match_stats"]
    return jsonify(report)


@app.route("/images/<session_id>/<filename>")
def serve_image(session_id, filename):
    return send_from_directory(os.path.join(OUTPUT_ROOT, session_id), filename)


INDEX_HTML = """
<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Text Inspection</title>
<style>
  body { font-family: -apple-system, Segoe UI, sans-serif; margin: 0; background: #f4f4f4; }
  header { background: #1a1a1a; color: white; padding: 12px 20px; display: flex; align-items: center; gap: 16px; }
  header h1 { font-size: 18px; margin: 0; }

  .upload-bar { display: flex; gap: 16px; padding: 14px 20px; background: white; border-bottom: 1px solid #ddd; align-items: center; }
  .upload-slot { display: flex; align-items: center; gap: 8px; }
  .upload-slot label { font-weight: 600; font-size: 13px; color: #444; }
  .upload-slot input[type=file] { font-size: 13px; }
  .upload-status { font-size: 12px; color: #2e7d32; }
  #inspectBtn { padding: 8px 20px; background: #d32f2f; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; margin-left: auto; }
  #inspectBtn:disabled { background: #ccc; cursor: not-allowed; }
  #inspectBtn:hover:not(:disabled) { background: #b71c1c; }

  .zoom-bar { display: flex; gap: 20px; align-items: center; padding: 8px 20px; background: #eee; border-bottom: 1px solid #ddd; }
  .zoom-group { display: flex; gap: 6px; align-items: center; }
  .zoom-group .zoom-label { font-size: 12px; font-weight: 600; color: #444; min-width: 55px; }
  .zoom-bar button { padding: 4px 10px; cursor: pointer; }
  .zoom-bar span.zoom-pct { font-size: 12px; color: #555; min-width: 45px; text-align: center; display: inline-block; }

  .previews { display: flex; gap: 0; padding: 4px; background: #ccc; height: 58vh; }
  .preview-col { flex: 1 1 0; min-width: 80px; background: white; overflow: auto; position: relative; }
  .preview-col .label { position: sticky; top: 0; background: #1a1a1a; color: white; padding: 6px 10px; font-size: 12px; z-index: 10; }
  .preview-placeholder { padding: 60px 20px; text-align: center; color: #999; font-size: 14px; }
  .preview-wrap { position: relative; display: inline-block; transform-origin: top left; }
  .preview-wrap img { display: block; }
  .highlight-box { position: absolute; border: 2px solid #d32f2f; background: rgba(211,47,47,0.18); pointer-events: auto; display: none; cursor: help; }

  .col-resize-handle { flex: 0 0 6px; background: #999; cursor: col-resize; position: relative; z-index: 5; }
  .col-resize-handle:hover, .col-resize-handle.dragging { background: #d32f2f; }
  .col-resize-handle::after { content: ''; position: absolute; top: 50%; left: 50%; width: 2px; height: 26px; background: rgba(255,255,255,0.85); transform: translate(-50%, -50%); }

  .drag-handle { height: 10px; background: #d32f2f; cursor: ns-resize; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .drag-handle::before { content: ''; width: 40px; height: 3px; background: rgba(255,255,255,0.7); border-radius: 2px; }

  .results-panel { position: fixed; bottom: 0; left: 0; right: 0; background: white;
                    max-height: 85vh; min-height: 120px; height: 42vh; display: flex; flex-direction: column;
                    transform: translateY(100%); transition: transform 0.2s ease; box-shadow: 0 -4px 12px rgba(0,0,0,0.2); }
  .results-panel.open { transform: translateY(0); }
  .results-panel.dragging { transition: none; }
  .results-header { padding: 10px 16px; background: #1a1a1a; color: white; font-size: 13px; display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
  .results-header button { background: transparent; border: 1px solid #666; color: white; border-radius: 4px; cursor: pointer; padding: 2px 10px; }
  .results-body { overflow-y: auto; flex: 1; }

  table.findings-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.findings-table thead th { position: sticky; top: 0; background: #263238; color: white; text-align: left; padding: 8px 10px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.3px; }
  table.findings-table tbody tr { cursor: pointer; border-bottom: 1px solid #eee; }
  table.findings-table tbody tr:nth-child(even) { background: #fafafa; }
  table.findings-table tbody tr:hover { background: #e3f2fd; }
  table.findings-table tbody tr.active { background: #fff3e0; box-shadow: inset 3px 0 0 #d32f2f; }
  table.findings-table td { padding: 7px 10px; vertical-align: top; }
  .type-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 700; text-transform: uppercase; color: white; }
  .type-Change { background: #f57c00; }
  .type-Insertion { background: #2e7d32; }
  .type-Deletion { background: #c62828; }
  .type-Location { background: #1565c0; }
  .type-badge.grouped { background: #6a1b9a; }
  .val-master { color: #b71c1c; text-decoration: line-through; text-decoration-color: rgba(183,20,20,0.5); }
  .val-sample { color: #2e7d32; font-weight: 600; }
  .comment-cell { color: #666; font-style: italic; max-width: 300px; }
  .findings-list-empty { padding: 10px 20px; color: #666; font-size: 13px; }
  .count-badge { background: #d32f2f; color: white; border-radius: 10px; padding: 1px 7px; font-size: 10px; margin-left: 4px; }
  .status { padding: 10px 20px; color: #666; font-size: 13px; }
</style>
</head>
<body>
<header><h1>Text Inspection</h1></header>

<div class="upload-bar">
  <div class="upload-slot">
    <label>Master PDF:</label>
    <input type="file" id="masterFile" accept="application/pdf" onchange="uploadFile('master')">
    <span class="upload-status" id="masterStatus"></span>
  </div>
  <div class="upload-slot">
    <label>Sample PDF:</label>
    <input type="file" id="sampleFile" accept="application/pdf" onchange="uploadFile('sample')">
    <span class="upload-status" id="sampleStatus"></span>
  </div>
  <button id="inspectBtn" onclick="runInspection()" disabled>Inspect</button>
</div>

<div class="zoom-bar">
  <span>Zoom:</span>
  <button onclick="adjustZoom(-0.1)">-</button>
  <span id="zoomLevel">Fit</span>
  <button onclick="adjustZoom(0.1)">+</button>
  <button onclick="fitZoom()">Fit to screen</button>
</div>

<div class="previews" id="previewsRow">
  <div class="preview-col" id="col-master" style="flex: 1 1 0;">
    <div class="label">MASTER</div>
    <div class="preview-placeholder">Upload a Master PDF to preview it here</div>
  </div>
  <div class="col-resize-handle" id="colResizeHandle" title="Drag to resize"></div>
  <div class="preview-col" id="col-sample" style="flex: 1 1 0;">
    <div class="label">SAMPLE</div>
    <div class="preview-placeholder">Upload a Sample PDF to preview it here</div>
  </div>
</div>

<div class="results-panel" id="resultsPanel">
  <div class="drag-handle" id="resultsDragHandle" title="Drag to resize"></div>
  <div class="results-header">
    <span id="resultsSummary">Results</span>
    <button onclick="closeResults()">Close</button>
  </div>
  <div class="results-body">
    <div id="findingsList"></div>
  </div>
</div>

<script>
const sessionId = 'sess-' + Math.random().toString(36).slice(2) + Date.now();
let uploaded = {master: false, sample: false};
let currentReport = null;
let zoom = 1.0;

async function uploadFile(side) {
  const input = document.getElementById(side + 'File');
  const file = input.files[0];
  if (!file) return;

  const statusEl = document.getElementById(side + 'Status');
  statusEl.textContent = 'Uploading...';
  statusEl.style.color = '#666';

  const formData = new FormData();
  formData.append('session_id', sessionId);
  formData.append('side', side);
  formData.append('file', file);

  try {
    const res = await fetch('/api/upload', {method: 'POST', body: formData});
    const data = await res.json();
    if (data.error) {
      statusEl.textContent = 'Error: ' + data.error;
      statusEl.style.color = '#d32f2f';
      return;
    }
    statusEl.textContent = '\u2713 ' + data.filename;
    statusEl.style.color = '#2e7d32';
    uploaded[side] = true;

    const col = document.getElementById('col-' + side);
    col.innerHTML = `
      <div class="label">${side.toUpperCase()}</div>
      <div class="preview-wrap" id="wrap-${side}-0" data-natural-width="${data.width}">
        <img src="${data.image}" />
        <div class="highlight-box" id="box-${side}-0"></div>
      </div>
    `;

    document.getElementById('inspectBtn').disabled = !(uploaded.master && uploaded.sample);
    setTimeout(fitZoom, 100);
  } catch (e) {
    statusEl.textContent = 'Upload failed';
    statusEl.style.color = '#d32f2f';
  }
}

async function runInspection() {
  const btn = document.getElementById('inspectBtn');
  btn.disabled = true;
  btn.textContent = 'Inspecting...';

  try {
    const res = await fetch('/api/inspect', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({session_id: sessionId})
    });
    const data = await res.json();
    if (data.error) { alert('Error: ' + data.error); btn.disabled = false; btn.textContent = 'Inspect'; return; }

    currentReport = data;
    renderPreviews(data);
    renderFindings(data);
    document.getElementById('resultsSummary').textContent =
      `${data.findings.length} finding(s) \u2014 matched ${data.match_stats.matched_pairs} pairs, ` +
      `${data.match_stats.unmatched_master} missing in sample, ${data.match_stats.unmatched_sample} extra in sample`;
    document.getElementById('resultsPanel').classList.add('open');
    setTimeout(fitZoom, 100);
  } catch (e) {
    alert('Request failed: ' + e);
  }
  btn.disabled = false;
  btn.textContent = 'Inspect';
}

function renderPreviews(data) {
  const masterCol = document.getElementById('col-master');
  const sampleCol = document.getElementById('col-sample');
  masterCol.innerHTML = '<div class="label">MASTER</div>';
  sampleCol.innerHTML = '<div class="label">SAMPLE</div>';

  data.pages.forEach(page => {
    if (page.master_image) {
      masterCol.innerHTML += `
        <div class="preview-wrap" id="wrap-master-${page.page}" data-natural-width="${page.master_width}">
          <img src="${page.master_image}" />
          <div class="highlight-box" id="box-master-${page.page}"></div>
        </div>`;
    }
    if (page.sample_image) {
      sampleCol.innerHTML += `
        <div class="preview-wrap" id="wrap-sample-${page.page}" data-natural-width="${page.sample_width}">
          <img src="${page.sample_image}" />
          <div class="highlight-box" id="box-sample-${page.page}"></div>
        </div>`;
    }
  });
}

function renderFindings(data) {
  const list = document.getElementById('findingsList');
  if (data.findings.length === 0) {
    list.innerHTML = '<div class="findings-list-empty">No differences found.</div>';
    return;
  }

  const rows = data.findings.map(f => {
    // Strip a trailing "(grouped)" qualifier for the badge's color class,
    // but keep it visible in the label and flag it with a modifier class.
    const isGrouped = /grouped/i.test(f.type);
    const baseType = f.type.replace(/\\s*\\(.*?\\)\\s*/g, '').trim() || 'Change';
    const badgeClass = `type-badge type-${baseType}${isGrouped ? ' grouped' : ''}`;

    return `
    <tr id="finding-${f.id}" onclick="selectFinding(${f.id})">
      <td>
        <span class="${badgeClass}">${escapeHtml(f.type)}</span>
        ${f.group_count ? `<span class="count-badge">${f.group_count}</span>` : ''}
      </td>
      <td class="val-master">${escapeHtml(f.master || '(none)')}</td>
      <td class="val-sample">${escapeHtml(f.sample || '(none)')}</td>
      <td class="comment-cell">${escapeHtml(f.comment)}</td>
    </tr>`;
  }).join('');

  list.innerHTML = `
    <table class="findings-table">
      <thead>
        <tr><th>Type</th><th>Master</th><th>Sample</th><th>Comment</th></tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function selectFinding(id) {
  document.querySelectorAll('#findingsList tbody tr').forEach(el => el.classList.remove('active'));
  document.getElementById('finding-' + id).classList.add('active');

  const finding = currentReport.findings.find(f => f.id === id);
  if (!finding) return;

  document.querySelectorAll('.highlight-box').forEach(b => b.style.display = 'none');

  // Only draw on the side(s) that actually have a box for this finding —
  // Insertion -> Sample only, Deletion -> Master only, Change/Location -> both.
  ['master', 'sample'].forEach(side => {
    const box = finding[side + '_box'];
    const el = document.getElementById(`box-${side}-${finding.page}`);
    if (box && el) {
      el.style.left = box.x + 'px';
      el.style.top = box.y + 'px';
      el.style.width = Math.max(box.width, 4) + 'px';
      el.style.height = Math.max(box.height, 4) + 'px';
      el.style.display = 'block';
      el.title = `${finding.type}: ${finding.comment}`;
      el.scrollIntoView({behavior: 'smooth', block: 'center', inline: 'center'});
    }
  });
}

function closeResults() {
  document.getElementById('resultsPanel').classList.remove('open');
  document.querySelectorAll('.highlight-box').forEach(b => b.style.display = 'none');
}

function adjustZoom(delta) {
  zoom = Math.max(0.1, Math.min(3, zoom + delta));
  applyZoom();
}

function fitZoom() {
  const wraps = document.querySelectorAll('.preview-wrap');
  if (wraps.length === 0) return;
  const containerWidth = document.getElementById('col-master').clientWidth - 20;
  let minRatio = 1.0;
  wraps.forEach(w => {
    const naturalWidth = parseFloat(w.dataset.naturalWidth);
    if (naturalWidth) {
      const ratio = containerWidth / naturalWidth;
      if (ratio < minRatio) minRatio = ratio;
    }
  });
  zoom = minRatio;
  applyZoom();
}

function applyZoom() {
  document.querySelectorAll('.preview-wrap').forEach(w => {
    w.style.transform = `scale(${zoom})`;
  });
  document.getElementById('zoomLevel').textContent = Math.round(zoom * 100) + '%';
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// ---- Resizable results panel (drag the red bar at its top edge) ----
(function setupPanelResize() {
  const panel = document.getElementById('resultsPanel');
  const handle = document.getElementById('resultsDragHandle');
  let dragging = false, startY = 0, startHeight = 0;

  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    startY = e.clientY;
    startHeight = panel.getBoundingClientRect().height;
    panel.classList.add('dragging');
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const delta = startY - e.clientY; // dragging up (negative clientY delta) grows the panel
    const minH = 120;
    const maxH = window.innerHeight * 0.85;
    const newHeight = Math.min(maxH, Math.max(minH, startHeight + delta));
    panel.style.height = newHeight + 'px';
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    panel.classList.remove('dragging');
    document.body.style.userSelect = '';
  });
})();

// ---- Resizable Master/Sample columns (drag the vertical bar between them) ----
(function setupColumnResize() {
  const handle = document.getElementById('colResizeHandle');
  const row = document.getElementById('previewsRow');
  const master = document.getElementById('col-master');
  const sample = document.getElementById('col-sample');
  let dragging = false;

  handle.addEventListener('mousedown', (e) => {
    dragging = true;
    handle.classList.add('dragging');
    document.body.style.userSelect = 'none';
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const rect = row.getBoundingClientRect();
    let pct = ((e.clientX - rect.left) / rect.width) * 100;
    pct = Math.min(85, Math.max(15, pct)); // keep both sides usable
    master.style.flex = `0 0 ${pct}%`;
    sample.style.flex = `0 0 ${100 - pct}%`;
  });

  window.addEventListener('mouseup', () => {
    if (!dragging) return;
    dragging = false;
    handle.classList.remove('dragging');
    document.body.style.userSelect = '';
    fitZoom(); // recompute fit-to-screen zoom for the new column widths
  });
})();
</script>
</body>
</html>
"""

if __name__ == "__main__":
    app.run(debug=True, port=5000)