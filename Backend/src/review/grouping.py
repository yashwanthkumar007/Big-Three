"""
Location filtering — separates a genuine, isolated position change from
the noise of a uniform whole-page realignment between Master and
Sample (different export/crop offset, not a real defect).

REDESIGNED: the previous version grouped near-identical shifts into a
summary line ("60 items shifted by X"). That's an improvement over
flooding the findings list, but it still doesn't match GVW's observed
behavior — GVW's real reports don't mention the bulk shift AT ALL, not
even as a summary. This version goes further: the DOMINANT shift (the
one shared by the most elements — almost certainly a global page
realignment, not a content defect) is suppressed entirely. Only
elements whose shift DEVIATES from that dominant pattern — genuine,
isolated repositioning — are reported as real Location findings.

Precision was also widened from 2pt to 5pt buckets: confirmed real case
where four elements sharing the same underlying global shift measured
168.9, 169.2, 170.8, 171.2 (rounding/font-metric noise) — at 2pt
precision these fell into three DIFFERENT buckets and leaked out as
individual "findings" instead of joining the dominant cluster they
actually belong to.

This is a heuristic, not a guaranteed match to GVW's internal algorithm
(which isn't observable) — it's the most sensible approximation of the
behavior actually seen in real GVW reports.
"""

from collections import defaultdict

# Two shifts within this Euclidean distance (in points) of each other are
# treated as the same underlying shift. Replaces independent per-axis
# rounding, which had a real boundary problem: a shift like (-3.64, 170.79)
# rounds its X-axis to a DIFFERENT bucket than a nearby shift's X=0, even
# though they're clearly the same real-world shift with a few points of
# rendering noise. Distance-based clustering doesn't have that boundary
# artifact — it looks at how far apart two shifts actually are, not
# whether they happen to round the same way on each axis independently.
CLUSTER_DISTANCE_THRESHOLD = 8.0

# A shift cluster is treated as "systematic/global realignment" (and
# suppressed) once it reaches this many members. Below this, a shared
# shift among just a couple of elements is more likely a genuine local
# change (e.g. one small block redesigned) than proof of a global shift.
DOMINANT_SHIFT_MIN_SIZE = 5


def _shift_vector(finding: dict):
    mb, sb = finding["master_bbox"], finding["sample_bbox"]
    return (sb[0] - mb[0], sb[1] - mb[1])


def group_location_findings(location_findings: list, min_group_size: int = DOMINANT_SHIFT_MIN_SIZE, suppress_dominant: bool = True) -> dict:
    """
    Clusters findings by real 2D distance between their shift vectors
    (greedy: each finding joins the nearest existing cluster within
    CLUSTER_DISTANCE_THRESHOLD, or starts a new one). A cluster's
    centroid updates as a running average as members are added, so the
    threshold check stays accurate even for larger clusters.

    suppress_dominant:
        True  (default) — dominant/systematic shifts (clusters >=
               min_group_size) are treated as global page realignment and
               excluded from "ungrouped", matching GVW's observed
               behavior of not reporting the bulk shift at all.
        False — nothing suppressed. Every Location finding, including
               ones sharing the dominant shift, is returned in
               "ungrouped" individually.

    Returns:
        {
            "grouped": [{"shift": (dx, dy), "count": N, "sample_members": [...up to 3...], "all_members": [...]}],
            "ungrouped": [...Location findings the pipeline should treat
                       as real, reportable differences...],
        }
    """
    clusters = []  # [{"centroid": (dx, dy), "members": [...]}]

    for f in location_findings:
        dx, dy = _shift_vector(f)
        best_cluster, best_dist = None, None
        for c in clusters:
            cx, cy = c["centroid"]
            dist = ((dx - cx) ** 2 + (dy - cy) ** 2) ** 0.5
            if dist <= CLUSTER_DISTANCE_THRESHOLD and (best_dist is None or dist < best_dist):
                best_cluster, best_dist = c, dist

        if best_cluster is not None:
            best_cluster["members"].append(f)
            n = len(best_cluster["members"])
            ox, oy = best_cluster["centroid"]
            # running average — keeps the centroid representative as the
            # cluster grows, rather than staying pinned to the first member
            best_cluster["centroid"] = (ox + (dx - ox) / n, oy + (dy - oy) / n)
        else:
            clusters.append({"centroid": (dx, dy), "members": [f]})

    grouped, ungrouped = [], []
    for c in clusters:
        is_dominant = len(c["members"]) >= min_group_size
        if is_dominant:
            grouped.append({
                "shift": tuple(round(v, 1) for v in c["centroid"]),
                "count": len(c["members"]),
                "sample_members": c["members"][:3],
                "all_members": c["members"],
            })
        if not is_dominant or not suppress_dominant:
            ungrouped.extend(c["members"])

    grouped.sort(key=lambda g: -g["count"])
    return {"grouped": grouped, "ungrouped": ungrouped}