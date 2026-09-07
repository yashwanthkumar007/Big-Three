"""
Inspection Registry — maps inspection type strings to their pipeline
configuration.

This is the single place that decides WHICH Python pipeline is invoked
when the frontend calls `/api/inspect` with an `inspection_type`.

Adding a new inspection type requires only:
  1. Implement a pipeline function with the signature
     ``pipeline(master_path, sample_path, filters=None) -> dict``
  2. Add an entry below.

The existing ``run_text_inspection`` is the first registered entry.
"""

from __future__ import annotations

import importlib
import sys
import os
import typing as t

# Ensure the Backend root is on sys.path so `src.*` imports resolve
# regardless of how Flask was launched.
_BACKEND_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND_ROOT not in sys.path:
    sys.path.insert(0, _BACKEND_ROOT)

# Import the text inspection pipeline (currently the only registered one).
from src.pipelines.comparison_pipeline import run_text_inspection  # noqa: E402


class InspectionConfig:
    """Configuration for a single inspection type.

    Attributes
    ----------
    pipeline:
        Callable executed when the frontend requests this inspection.
        Signature: ``pipeline(master_path, sample_path, filters=None) -> dict``
        The returned dict must contain at least ``"findings"`` and
        ``"match_stats"`` keys so ``build_report`` can process it.
    label:
        Human-readable name used in logs and error messages.
    """

    def __init__(
        self,
        pipeline: t.Callable[..., dict],
        label: str,
    ) -> None:
        self.pipeline = pipeline
        self.label = label


# ---------------------------------------------------------------------------
# Registered inspections
# ---------------------------------------------------------------------------

_INSPECTION_REGISTRY: dict[str, InspectionConfig] = {
    "text": InspectionConfig(
        pipeline=run_text_inspection,
        label="Text Inspection",
    ),
}


def get_inspection_config(inspection_type: str | None) -> InspectionConfig:
    """
    Look up the configuration for *inspection_type*.

    Falls back to ``"text"`` when *inspection_type* is ``None`` or
    not explicitly registered (backward compatibility).

    Raises
    ------
    ValueError
        If the inspection type is not recognised AND is not None.
        Callers should provide a clear 400 response.
    """
    if inspection_type is None:
        inspection_type = "text"

    config = _INSPECTION_REGISTRY.get(inspection_type)
    if config is None:
        available = ", ".join(sorted(_INSPECTION_REGISTRY.keys()))
        raise ValueError(
            f"Unknown inspection type '{inspection_type}'. "
            f"Available types: {available}"
        )
    return config


def get_available_inspection_types() -> list[str]:
    """Return a sorted list of all registered inspection type strings."""
    return sorted(_INSPECTION_REGISTRY.keys())
