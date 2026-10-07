/**
 * Barcode Inspection configuration.
 *
 * Single source of truth for the Barcode Inspection filter panel. The panel
 * deliberately exposes only four settings (Profiles, Resolution, Options,
 * Select Page) plus Reset To Default — matching the GlobalVision reference
 * layout. Everything else (1D/2D decoding, preprocessing, quality analysis,
 * Data Matrix fallback, 3D/depth) is performed internally by the barcode
 * engine and is NOT surfaced as a filter.
 *
 * The same object is stored in the upload store and posted to the backend as
 * `barcode_config`. Keep the property names aligned with
 * `Backend/src/inspection/barcode/config.py`.
 */

export type BarcodeConfig = {
  /** Inspection profile (Default / Rotated). */
  profile: string;
  /** Rasterisation DPI used by the engine; drives real resolution. */
  resolution: number;
  /** Overprint analysis toggle. */
  enableOverprint: boolean;
  /** "all", a single 1-based page number, or a list of them. */
  pages: "all" | number | number[];
};

/** Barcode inspection profiles offered by the panel. */
export const BARCODE_PROFILES: { id: string; label: string }[] = [
  { id: "default", label: "Default" },
  { id: "rotated", label: "Rotated" },
];

/** Supported render/inspection resolutions. Default is 300 dpi. */
export const BARCODE_RESOLUTIONS = [150, 200, 300, 400, 600] as const;

/** The exact defaults restored by "Reset To Default". */
export const DEFAULT_BARCODE_CONFIG: BarcodeConfig = {
  profile: "default",
  resolution: 300,
  enableOverprint: true,
  pages: "all",
};

/** Fresh copy of the defaults (never mutate the constant itself). */
export const createDefaultBarcodeConfig = (): BarcodeConfig =>
  ({ ...DEFAULT_BARCODE_CONFIG });

/* -------------------------------------------------------------------------- */
/*                     Barcode Inspection processing stages                  */
/* -------------------------------------------------------------------------- */

/**
 * Stage ids reported by the barcode engine. These are the ONLY stages the
 * processing screen shows — there is no Master/Sample/Difference vocabulary
 * because Barcode Inspection is a single-file workflow.
 */
export const BARCODE_STAGES = [
  "barcode_detection",
  "barcode_decoding",
  "barcode_validation",
  "barcode_quality",
  "saving_results",
  "inspection_complete",
] as const;

export type BarcodeStage = (typeof BARCODE_STAGES)[number];

/** Stage id -> label rendered under the spinner. */
export const BARCODE_STAGE_LABELS: Record<BarcodeStage, string> = {
  barcode_detection: "Barcode Detection",
  barcode_decoding: "Barcode Decoding",
  barcode_validation: "Barcode Validation",
  barcode_quality: "Barcode Quality Inspection",
  saving_results: "Saving Results",
  inspection_complete: "Inspection Complete",
};

/** Stage shown before the backend reports anything. */
export const INITIAL_BARCODE_STAGE: BarcodeStage = "barcode_detection";

/**
 * Resolves a backend stage value to a known stage, defaulting to the initial
 * stage so the screen never renders an unknown/empty label.
 */
export const resolveBarcodeStage = (
  stage?: string | null,
): BarcodeStage => {
  const normalized = (stage ?? "").trim().toLowerCase();
  const match = BARCODE_STAGES.find(
    (candidate) => candidate === normalized,
  );
  return match ?? INITIAL_BARCODE_STAGE;
};

/** Result of validating the configuration before the engine is started. */
export type BarcodeConfigValidation = {
  valid: boolean;
  errors: string[];
};

/**
 * Validates the configuration (including the page selection against the real
 * document page count) before the inspection is started.
 */
export const validateBarcodeConfig = (
  config: BarcodeConfig,
  pageCount = 0,
): BarcodeConfigValidation => {
  const errors: string[] = [];

  if (!BARCODE_PROFILES.some((profile) => profile.id === config.profile)) {
    errors.push("Select a valid profile.");
  }

  if (!BARCODE_RESOLUTIONS.includes(config.resolution as 300)) {
    errors.push("Select a supported resolution.");
  }

  if (Array.isArray(config.pages)) {
    if (config.pages.length === 0) {
      errors.push("Select at least one page to inspect.");
    } else if (pageCount > 0) {
      const outOfRange = config.pages.filter(
        (page) => page < 1 || page > pageCount,
      );
      if (outOfRange.length > 0) {
        errors.push(
          `Page ${outOfRange.join(", ")} is not in this document (1-${
            pageCount
          }).`,
        );
      }
    }
  } else if (typeof config.pages === "number") {
    if (pageCount > 0 && (config.pages < 1 || config.pages > pageCount)) {
      errors.push(
        `Page ${config.pages} is not in this document (1-${pageCount}).`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
};
