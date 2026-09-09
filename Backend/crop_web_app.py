"""
Crop Feature Test App.
 
Runs EVERYTHING web_app.py already runs (upload, preview, zoom, full
Inspect) completely unmodified — this file imports the existing Flask
`app` object from web_app.py rather than editing it, and adds:
 
  1. A new endpoint: POST /api/crop_inspect
     Runs crop_text_inspection_pipeline.run_crop_text_inspection()
     scoped to a single page + user-drawn box, and returns findings in
     the same pixel-space shape the existing findings table already
     understands.
 
  2. A "Crop Compare" mode injected into the existing page via a small
     <script> tag appended after web_app.py's own INDEX_HTML, so the
     original HTML/JS is never touched — only added to.
 
     - Click "Crop Compare" to arm crop mode (button highlights).
     - Drag a rectangle directly on the MASTER preview image.
     - On mouse-up, the box is sent to /api/crop_inspect along with the
       page number inferred from which preview-wrap it was drawn on.
     - Results render in a dedicated "Crop Results" panel (kept
       separate from the main Inspect results panel, so you can compare
       crop-scoped output against full-page output side by side).
     - The crop rectangle used for the query stays drawn on screen
       (dashed outline) so you can see exactly what region was searched.
 
Run:
    python crop_web_app.py
Then open http://127.0.0.1:5000, upload Master + Sample as usual, and
use "Crop Compare" instead of (or in addition to) "Inspect".
"""
 
import os
import sys
from datetime import datetime
 
sys.path.append(os.path.dirname(__file__))
from flask import request, jsonify
import pandas as pd
 
from web_app import app, UPLOAD_ROOT, OUTPUT_ROOT, INDEX_HTML  # noqa: reuse existing app + constants, unmodified
from src.pipelines.crop_text_inspection_pipeline import run_crop_text_inspection
from src.logger import logger
 
# Every crop query's findings get written here as a CSV, one file per
# query, so you can cross-check results after the fact without re-running
# anything. Kept alongside the existing per-session output folder
# (webapp_outputs/<session_id>/...), matching where build_report() already
# writes rendered page PNGs — same session, same place to look.
CROP_LOG_SUBDIR = "crop_logs"
 
 
def _log_crop_findings(session_id: str, page: int, box: dict, result: dict) -> str:
    """Writes this crop query's findings + the exact region searched to a
    timestamped CSV under webapp_outputs/<session_id>/crop_logs/. Returns
    the path written, or None if there was nothing to log."""
    log_dir = os.path.join(OUTPUT_ROOT, session_id, CROP_LOG_SUBDIR)
    os.makedirs(log_dir, exist_ok=True)
 
    timestamp = datetime.now().strftime("%Y-%m-%d_%H-%M-%S_%f")
    log_path = os.path.join(log_dir, f"crop_{timestamp}.csv")
 
    findings = result.get("findings", [])
    rows = []
    for f in findings:
        rows.append({
            "id": f["id"], "type": f["type"], "master": f["master"], "sample": f["sample"],
            "comment": f["comment"], "page": f["page"], "source": f.get("source", "pymupdf"),
            "master_box": f.get("master_box"), "sample_box": f.get("sample_box"),
            "query_page": page, "query_box_x": box["x"], "query_box_y": box["y"],
            "query_box_width": box["width"], "query_box_height": box["height"],
        })
 
    df = pd.DataFrame(rows) if rows else pd.DataFrame(
        columns=["id", "type", "master", "sample", "comment", "page", "source",
                 "master_box", "sample_box", "query_page", "query_box_x", "query_box_y",
                 "query_box_width", "query_box_height"]
    )
    df.to_csv(log_path, index=False)
 
    logger.info(
        f"Crop query logged: session={session_id}, page={page}, box={box}, "
        f"{len(findings)} finding(s) -> {log_path}"
    )
    return log_path
 
# ---------------------------------------------------------------------
# New endpoint — additive only, no existing route touched.
# ---------------------------------------------------------------------
 
 
@app.route("/api/crop_inspect", methods=["POST"])
def api_crop_inspect():
    data = request.get_json()
    session_id = data.get("session_id")
    page = data.get("page", 0)
    box = data.get("box")
 
    if not session_id:
        return jsonify({"error": "session_id required"}), 400
    if not box:
        return jsonify({"error": "box required"}), 400
 
    session_dir = os.path.join(UPLOAD_ROOT, session_id)
    master_path = os.path.join(session_dir, "master.pdf")
    sample_path = os.path.join(session_dir, "sample.pdf")
 
    if not os.path.exists(master_path) or not os.path.exists(sample_path):
        return jsonify({"error": "Both Master and Sample must be uploaded first"}), 400
 
    try:
        result = run_crop_text_inspection(master_path, sample_path, page, box)
    except Exception as e:
        return jsonify({"error": f"Crop inspection failed: {str(e)}"}), 500
 
    log_path = _log_crop_findings(session_id, page, box, result)
    result["log_file"] = os.path.relpath(log_path, OUTPUT_ROOT) if log_path else None
 
    return jsonify(result)
 
 
@app.route("/api/crop_logs/<session_id>")
def api_list_crop_logs(session_id):
    """Lists every crop query CSV logged so far for this session, most
    recent first — lets you see the full history of crop queries run
    during testing, not just the latest one."""
    log_dir = os.path.join(OUTPUT_ROOT, session_id, CROP_LOG_SUBDIR)
    if not os.path.isdir(log_dir):
        return jsonify({"logs": []})
    files = sorted(os.listdir(log_dir), reverse=True)
    return jsonify({"logs": files})
 
 
# ---------------------------------------------------------------------
# Inject the Crop Compare UI into the existing page by wrapping the
# original index route's HTML — web_app.py's own "/" route and HTML
# string are never edited, just extended here.
# ---------------------------------------------------------------------
 
CROP_UI_HTML = """
<style>
  #cropBtn { padding: 8px 20px; background: #6a1b9a; color: white; border: none; border-radius: 4px;
             cursor: pointer; font-size: 14px; margin-left: 10px; }
  #cropBtn.active { background: #4a148c; box-shadow: inset 0 0 0 2px #ce93d8; }
  #cropBtn:disabled { background: #ccc; cursor: not-allowed; }
  #cropHint { font-size: 12px; color: #6a1b9a; margin-left: 10px; display: none; }
  #cropHint.show { display: inline; }
 
  .crop-selection-box { position: absolute; border: 2px dashed #6a1b9a; background: rgba(106,27,154,0.12);
                         pointer-events: none; display: none; z-index: 20; }
 
  .crop-results-panel { position: fixed; bottom: 0; left: 0; right: 0; background: white;
                         max-height: 60vh; height: 32vh; display: flex; flex-direction: column;
                         transform: translateY(100%); transition: transform 0.2s ease;
                         box-shadow: 0 -4px 12px rgba(0,0,0,0.25); border-top: 3px solid #6a1b9a; }
  .crop-results-panel.open { transform: translateY(0); }
  .crop-results-header { padding: 10px 16px; background: #4a148c; color: white; font-size: 13px;
                          display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
  .crop-results-header button { background: transparent; border: 1px solid #ce93d8; color: white;
                                 border-radius: 4px; cursor: pointer; padding: 2px 10px; }
  .crop-results-body { overflow-y: auto; flex: 1; }
  .crop-findings-empty { padding: 14px 20px; color: #666; font-size: 13px; }
 
  table.crop-findings-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  table.crop-findings-table thead th { position: sticky; top: 0; background: #4a148c; color: white;
                                        text-align: left; padding: 8px 10px; font-size: 11px;
                                        text-transform: uppercase; letter-spacing: 0.3px; }
  table.crop-findings-table tbody tr { border-bottom: 1px solid #eee; }
  table.crop-findings-table tbody tr:nth-child(even) { background: #faf5fc; }
  table.crop-findings-table td { padding: 7px 10px; vertical-align: top; }
  .crop-val-master { color: #b71c1c; text-decoration: line-through; text-decoration-color: rgba(183,20,20,0.5); }
  .crop-val-sample { color: #2e7d32; font-weight: 600; }
  .crop-comment-cell { color: #666; font-style: italic; max-width: 300px; }
  .crop-type-badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 10px;
                      font-weight: 700; text-transform: uppercase; color: white; background: #6a1b9a; }
</style>
 
<div class="crop-results-panel" id="cropResultsPanel">
  <div class="crop-results-header">
    <span id="cropResultsSummary">Crop Results</span>
    <button onclick="closeCropResults()">Close</button>
  </div>
  <div class="crop-results-body">
    <div id="cropFindingsList"></div>
  </div>
</div>
 
<script>
(function setupCropFeature() {
  // Wait for the page's existing elements (from web_app.py's own HTML) to exist.
  const inspectBtn = document.getElementById('inspectBtn');
  const cropBtn = document.createElement('button');
  cropBtn.id = 'cropBtn';
  cropBtn.textContent = 'Crop Compare';
  cropBtn.disabled = true;
  inspectBtn.insertAdjacentElement('afterend', cropBtn);
 
  const hint = document.createElement('span');
  hint.id = 'cropHint';
  hint.textContent = 'Drag a rectangle on the MASTER preview \u2192';
  cropBtn.insertAdjacentElement('afterend', hint);
 
  // Mirror the disabled/enabled state of the real Inspect button by
  // polling — avoids touching uploadFile() in web_app.py.
  setInterval(() => {
    cropBtn.disabled = inspectBtn.disabled && !currentReport;
  }, 300);
 
  let cropModeActive = false;
  let dragging = false;
  let dragStartPxNatural = null;
  let currentWrapEl = null;
  let currentPage = 0;
 
  cropBtn.addEventListener('click', () => {
    cropModeActive = !cropModeActive;
    cropBtn.classList.toggle('active', cropModeActive);
    hint.classList.toggle('show', cropModeActive);
  });
 
  function findWrapAndPage(target) {
    const wrap = target.closest('.preview-wrap');
    if (!wrap || !wrap.id.startsWith('wrap-master-')) return null;
    const page = parseInt(wrap.id.replace('wrap-master-', ''), 10);
    return { wrap, page };
  }
 
  function ensureSelectionBox(wrap) {
    let box = wrap.querySelector('.crop-selection-box');
    if (!box) {
      box = document.createElement('div');
      box.className = 'crop-selection-box';
      wrap.appendChild(box);
    }
    return box;
  }
 
  document.getElementById('col-master').addEventListener('mousedown', (e) => {
    if (!cropModeActive) return;
    const found = findWrapAndPage(e.target);
    if (!found) return;
    dragging = true;
    currentWrapEl = found.wrap;
    currentPage = found.page;
 
    const rect = found.wrap.getBoundingClientRect();
    // Natural (unzoomed) pixel space = same DPI=150 space the app already
    // uses for master_box/sample_box.
    dragStartPxNatural = {
      x: (e.clientX - rect.left) / zoom,
      y: (e.clientY - rect.top) / zoom,
    };
 
    // IMPORTANT: .preview-wrap already has a CSS "transform: scale(zoom)"
    // applied to it (see applyZoom() in web_app.py's own JS). Since the
    // selection box is appended AS A CHILD of that wrap, it is already
    // inside the scaled coordinate system — the browser scales it for us.
    // We must therefore position it using NATURAL (unscaled) pixel values
    // here, NOT multiplied by zoom again, or it renders at the wrong
    // place/size (this was the bug: double-scaling pushed it off to a
    // fixed corner).
    const box = ensureSelectionBox(found.wrap);
    box.style.left = dragStartPxNatural.x + 'px';
    box.style.top = dragStartPxNatural.y + 'px';
    box.style.width = '0px';
    box.style.height = '0px';
    box.style.display = 'block';
    e.preventDefault();
  });
 
  window.addEventListener('mousemove', (e) => {
    if (!dragging || !currentWrapEl) return;
    const rect = currentWrapEl.getBoundingClientRect();
    const curX = (e.clientX - rect.left) / zoom;
    const curY = (e.clientY - rect.top) / zoom;
 
    const x0 = Math.min(dragStartPxNatural.x, curX);
    const y0 = Math.min(dragStartPxNatural.y, curY);
    const w = Math.abs(curX - dragStartPxNatural.x);
    const h = Math.abs(curY - dragStartPxNatural.y);
 
    // Same fix as above — natural pixel values only, parent transform
    // handles the zoom scaling automatically.
    const box = ensureSelectionBox(currentWrapEl);
    box.style.left = x0 + 'px';
    box.style.top = y0 + 'px';
    box.style.width = w + 'px';
    box.style.height = h + 'px';
 
    box.dataset.x = x0;
    box.dataset.y = y0;
    box.dataset.w = w;
    box.dataset.h = h;
  });
 
  window.addEventListener('mouseup', async () => {
    if (!dragging) return;
    dragging = false;
    if (!currentWrapEl) return;
 
    const box = currentWrapEl.querySelector('.crop-selection-box');
    if (!box) return;
    const w = parseFloat(box.dataset.w || 0);
    const h = parseFloat(box.dataset.h || 0);
    if (w < 5 || h < 5) {
      box.style.display = 'none';
      return; // too small — treat as an accidental click, not a real crop
    }
 
    const cropBoxPx = {
      x: parseFloat(box.dataset.x),
      y: parseFloat(box.dataset.y),
      width: w,
      height: h,
    };
 
    await runCropInspect(currentPage, cropBoxPx);
  });
 
  async function runCropInspect(page, box) {
    document.getElementById('cropResultsSummary').textContent = 'Running crop inspection...';
    document.getElementById('cropResultsPanel').classList.add('open');
    document.getElementById('cropFindingsList').innerHTML = '<div class="crop-findings-empty">Working...</div>';
 
    try {
      const res = await fetch('/api/crop_inspect', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({session_id: sessionId, page: page, box: box}),
      });
      const data = await res.json();
      if (data.error) {
        document.getElementById('cropResultsSummary').textContent = 'Error';
        document.getElementById('cropFindingsList').innerHTML =
          `<div class="crop-findings-empty">${escapeHtml(data.error)}</div>`;
        return;
      }
      renderCropFindings(data);
    } catch (e) {
      document.getElementById('cropResultsSummary').textContent = 'Request failed';
      document.getElementById('cropFindingsList').innerHTML =
        `<div class="crop-findings-empty">${escapeHtml(String(e))}</div>`;
    }
  }
 
  function renderCropFindings(data) {
    const stats = data.match_stats || {};
    document.getElementById('cropResultsSummary').textContent =
      `Crop: ${data.findings.length} finding(s) in region \u2014 matched ${stats.matched_pairs || 0} pairs, ` +
      `${stats.unmatched_master || 0} missing in sample, ${stats.unmatched_sample || 0} extra in sample` +
      (data.log_file ? `  |  logged: ${data.log_file}` : '');
 
    const list = document.getElementById('cropFindingsList');
    if (!data.findings.length) {
      list.innerHTML = '<div class="crop-findings-empty">No differences found in the cropped region.' +
        (data.log_file ? ` (still logged to ${escapeHtml(data.log_file)})` : '') + '</div>';
      return;
    }
 
    const rows = data.findings.map(f => `
      <tr>
        <td><span class="crop-type-badge">${escapeHtml(f.type)}</span></td>
        <td class="crop-val-master">${escapeHtml(f.master || '(none)')}</td>
        <td class="crop-val-sample">${escapeHtml(f.sample || '(none)')}</td>
        <td class="crop-comment-cell">${escapeHtml(f.comment)}</td>
      </tr>`).join('');
 
    list.innerHTML = `
      <table class="crop-findings-table">
        <thead><tr><th>Type</th><th>Master</th><th>Sample</th><th>Comment</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>`;
  }
 
  window.closeCropResults = function () {
    document.getElementById('cropResultsPanel').classList.remove('open');
  };
})();
</script>
"""
 
# Append the crop UI right before </body> in the existing INDEX_HTML,
# without modifying web_app.py's own INDEX_HTML string.
PATCHED_INDEX_HTML = INDEX_HTML.replace("</body>", CROP_UI_HTML + "\n</body>")
 
 
# NOTE: we can't just add a second @app.route("/") — Flask/Werkzeug
# matches the FIRST-registered rule for a given path, so a naive second
# route here would silently never fire (web_app.py's original index()
# would keep winning). Instead, swap the view function already bound to
# the existing "index" endpoint in place — same route, same endpoint
# name, new implementation. web_app.py's source file itself is still
# never edited.
def index_with_crop():
    return PATCHED_INDEX_HTML
 
 
app.view_functions["index"] = index_with_crop
 
 
if __name__ == "__main__":
    print("Crop Feature Test App running — includes all of web_app.py's features plus Crop Compare.")
    app.run(debug=True, port=5000)