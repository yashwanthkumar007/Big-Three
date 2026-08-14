/**
 * Truncates a file name to the given maximum length.
 *
 * If the name is longer than `maxLength`, it returns the first
 * `maxLength` characters with an ellipsis appended.
 */
export function truncateFileName(
  name: string,
  maxLength = 30
): string {
  if (name.length <= maxLength) {
    return name;
  }

  return `${name.slice(0, maxLength)}…`;
}