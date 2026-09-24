"""Temporary helper: list every environment variable read by the backend."""
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
PATTERNS = [
    re.compile(r"(?:_get_env|getenv|_get_env_bool)\(\s*[\"']([A-Z][A-Z0-9_]+)[\"']"),
    re.compile(r"environ(?:\.get)?\s*[\(\[]\s*[\"']([A-Z][A-Z0-9_]+)[\"']"),
    re.compile(r"os\.environ\[\s*[\"']([A-Z][A-Z0-9_]+)[\"']"),
]

found = {}
for dirpath, dirnames, filenames in os.walk(ROOT):
    dirnames[:] = [d for d in dirnames if d not in ("__pycache__", "node_modules", "cache", "artifacts", "webapp_outputs", "webapp_uploads", "Data", "debug_output")]
    for name in filenames:
        if not name.endswith(".py"):
            continue
        path = os.path.join(dirpath, name)
        rel = os.path.relpath(path, ROOT)
        if rel.startswith("_"):
            continue
        try:
            text = open(path, "r", encoding="utf-8", errors="ignore").read()
        except OSError:
            continue
        for pattern in PATTERNS:
            for match in pattern.finditer(text):
                found.setdefault(match.group(1), set()).add(rel)

for key in sorted(found):
    print(f"{key:42s} <- {', '.join(sorted(found[key]))}")
