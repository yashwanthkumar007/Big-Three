/**
 * Presentation helpers for the Barcode Verification metrics block.
 *
 * The engine returns structured JSON and decides nothing about how it is
 * worded; every display decision lives here so the sidebar and the PDF report
 * present the same figures identically.
 *
 * Two rules drive the formatting:
 *
 * 1. A metric the engine could not measure is rendered "N/A" - never 0, never
 *    blank - because the engine returns null precisely to mean "not
 *    measurable", and showing a number there would invent a measurement.
 * 2. A metric that carries a grade renders as "A (85.50)", so the grade and
 *    the measured value are read together.
 */

import type {
  BarcodeVerification,
  BarcodeVerificationMetric,
  BarcodeVerificationValue,
} from "@/shared/api/inspectionApi";

/** Shown for every metric the engine reported as null. */
export const NOT_AVAILABLE = "N/A";

/** Formats a number to fixed decimals, or NOT_AVAILABLE when unusable. */
function fixed(value: number | null | undefined, digits = 2): string {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(digits)
    : NOT_AVAILABLE;
}

/**
 * Formats a graded metric as "A (85.50)".
 *
 * When the engine reported a value but no grade (some metrics have no
 * meaningful grade), only the value is shown. When the value is null the
 * result is "N/A" regardless of any grade.
 */
export function formatMetric(
  metric: BarcodeVerificationMetric | null | undefined,
  digits = 2,
): string {
  if (!metric || metric.value === null || metric.value === undefined) {
    return NOT_AVAILABLE;
  }
  const value = fixed(metric.value, digits);
  if (!metric.grade) {
    return value;
  }
  const unit = metric.unit ? ` ${metric.unit}` : "";
  return `${metric.grade} (${value}${unit})`;
}

/**
 * Formats an ungraded value as "100.00" or "0.00 mm".
 *
 * Used for max reflectance and BWR, which the engine deliberately reports
 * without a grade.
 */
export function formatValue(
  entry: BarcodeVerificationValue | null | undefined,
  digits = 2,
): string {
  if (!entry || entry.value === null || entry.value === undefined) {
    return NOT_AVAILABLE;
  }
  const value = fixed(entry.value, digits);
  return entry.unit ? `${value} ${entry.unit}` : value;
}

/**
 * Formats the magnification percentage, e.g. "A 90.00 %".
 *
 * The unit is separated by a space to match the reference layout.
 */
export function formatMagnification(
  metric: BarcodeVerificationMetric | null | undefined,
): string {
  if (!metric || metric.value === null || metric.value === undefined) {
    return NOT_AVAILABLE;
  }
  const value = fixed(metric.value, 2);
  return metric.grade ? `${metric.grade} ${value} %` : `${value} %`;
}

/** Formats the plain wide-to-narrow ratio, e.g. "2.50" or "N/A". */
export function formatRatio(ratio: number | null | undefined): string {
  return typeof ratio === "number" && Number.isFinite(ratio)
    ? ratio.toFixed(2)
    : NOT_AVAILABLE;
}

/**
 * Formats the quiet zone as "A (Left: 100.00% Right: 100.00%)".
 *
 * A 2D symbol reports all four sides under `other`; those are all shown so
 * the panel matches what the engine actually measured.
 */
export function formatQuietZone(
  quietZone: BarcodeVerification["quietZone"],
): string {
  if (!quietZone) {
    return NOT_AVAILABLE;
  }

  const parts: string[] = [];
  if (quietZone.other) {
    const { left, right, top, bottom } = quietZone.other;
    if (top !== null) parts.push(`Top: ${fixed(top, 2)}%`);
    if (right !== null) parts.push(`Right: ${fixed(right, 2)}%`);
    if (bottom !== null) parts.push(`Bottom: ${fixed(bottom, 2)}%`);
    if (left !== null) parts.push(`Left: ${fixed(left, 2)}%`);
  } else {
    if (typeof quietZone.left === "number") {
      parts.push(`Left: ${fixed(quietZone.left, 2)}%`);
    }
    if (typeof quietZone.right === "number") {
      parts.push(`Right: ${fixed(quietZone.right, 2)}%`);
    }
  }

  if (parts.length === 0) {
    return NOT_AVAILABLE;
  }
  return quietZone.grade ? `${quietZone.grade} (${parts.join(" ")})` : `(${parts.join(" ")})`;
}

/** Formats a millimetre metric as "A 0.30 mm". */
export function formatMillimetres(
  metric: BarcodeVerificationMetric | null | undefined,
): string {
  if (!metric || metric.value === null || metric.value === undefined) {
    return NOT_AVAILABLE;
  }
  const value = `${fixed(metric.value, 2)} mm`;
  return metric.grade ? `${metric.grade} ${value}` : value;
}

/** One rendered line in the verification block. */
export type VerificationRow = {
  /** Stable key, also used as the React list key. */
  key: string;
  /** Left-hand label, e.g. "Symbol Contrast". */
  label: string;
  /** Already-formatted right-hand value. */
  value: string;
};

/**
 * Builds the ordered verification rows shown in the sidebar.
 *
 * The order is fixed and matches the reference layout. Every metric is always
 * included: unmeasurable ones render "N/A", so the reader can see the metric
 * exists but was not measurable rather than wondering where it went.
 */
export function buildVerificationRows(
  verification: BarcodeVerification | null | undefined,
): VerificationRow[] {
  if (!verification) {
    return [];
  }

  const v = verification;

  return [
    {
      key: "decodability",
      label: "Decodability",
      value: formatMetric(v.decodability),
    },
    {
      key: "magnification",
      label: "Magnification",
      value: formatMagnification(v.magnification),
    },
    {
      key: "symbolContrast",
      label: "Symbol Contrast",
      value: formatMetric(v.symbolContrast),
    },
    {
      key: "minimumEdgeContrast",
      label: "Min Edge Contrast",
      value: formatMetric(v.minimumEdgeContrast),
    },
    {
      key: "modulation",
      label: "Modulation",
      value: formatMetric(v.modulation),
    },
    {
      key: "defects",
      label: "Defects",
      value: formatMetric(v.defects),
    },
    {
      key: "decode",
      label: "Decode",
      value: formatMetric(v.decode),
    },
    {
      key: "quietZone",
      label: "Quiet Zone",
      value: formatQuietZone(v.quietZone),
    },
    {
      key: "narrowBar",
      label: "Narrow Bar",
      value: formatMillimetres(v.narrowBar),
    },
    {
      key: "wideBar",
      label: "Wide Bar",
      value: formatMillimetres(v.wideBar),
    },
    {
      key: "wideToNarrowRatio",
      label: "Wide To Narrow Ratio",
      value: formatRatio(v.wideToNarrowRatio),
    },
    {
      key: "gap",
      label: "Gap",
      value: formatMillimetres(v.gap),
    },
    {
      key: "dataStructure",
      label: "Data Structure",
      value: formatMetric(v.dataStructure),
    },
    {
      key: "minReflectance",
      label: "Min Reflectance",
      value: formatMetric(v.minReflectance),
    },
    {
      key: "maxReflectance",
      label: "Max Reflectance",
      value: formatValue(v.maxReflectance),
    },
    {
      key: "bwr",
      label: "BWR",
      value: formatValue(v.bwr),
    },
  ];
}