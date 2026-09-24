/**
 * Setup Levels and Comments runtime helpers.
 *
 * These helpers centralize configuration-aware logic used by the Inspection
 * Result UI and the PDF report generator so placeholder detection and label
 * resolution are never duplicated across components.
 */
import type {
  SetupLevelsComments,
  SetupLevels,
  SetupComments,
} from "@/features/admin/systemApi";

/** Reserved default level keys — always read-only. */
export const DEFAULT_LEVEL_KEYS: (keyof SetupLevels)[] = ["default1", "default2"];
/** Reserved default comment keys — always read-only. */
export const DEFAULT_COMMENT_KEYS: (keyof SetupComments)[] = ["default1"];

/** Custom level keys (1-5) — administrator-editable. */
export const CUSTOM_LEVEL_KEYS: (keyof SetupLevels)[] = [
  "custom1",
  "custom2",
  "custom3",
  "custom4",
  "custom5",
];

/** Custom comment keys (1-10) — administrator-editable. */
export const CUSTOM_COMMENT_KEYS: (keyof SetupComments)[] = [
  "custom1",
  "custom2",
  "custom3",
  "custom4",
  "custom5",
  "custom6",
  "custom7",
  "custom8",
  "custom9",
  "custom10",
];

/**
 * Detects a "Comment1"/"Comment 1"/"Comment10" style placeholder.
 *
 * A value that matches "Comment" followed by an optional space and a number is
 * treated as a placeholder — the end user provides their own comment for that
 * difference/review. Normal configured comments such as "Approved" are NOT
 * placeholders.
 */
export function isEditableCommentPlaceholder(value: string | null | undefined): boolean {
  if (!value) return false;
  return /^comment\s*[0-9]+$/i.test(value.trim());
}

/** Ordered comment keys for the result-page dropdown (empty customs excluded). */
export function configuredCommentOptions(config: SetupLevelsComments | null): string[] {
  if (!config) return [];
  return CUSTOM_COMMENT_KEYS.map((key) => config.comments[key]).filter((value) => value && value.trim() !== "");
}

/** Ordered level options for the result page (all levels). */
export function configuredLevelOptions(config: SetupLevelsComments | null): string[] {
  if (!config) return [];
  return [...DEFAULT_LEVEL_KEYS, ...CUSTOM_LEVEL_KEYS].map((key) => config.levels[key]);
}

/**
 * Resolve the comment to DISPLAY for a difference.
 * Priority: persisted user comment > current configured comment > empty.
 */
export function resolveDisplayComment(
  userComment: string | null | undefined,
  configuredComment: string | null | undefined
): string {
  if (userComment && userComment.trim() !== "") return userComment.trim();
  return configuredComment ?? "";
}