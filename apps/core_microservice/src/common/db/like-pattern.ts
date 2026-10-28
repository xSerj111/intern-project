/**
 * Escapes `\`, `%` and `_` so `value` is matched literally in a LIKE pattern
 * used with `ESCAPE '\'`. The backslash is escaped first, then `%` and `_`.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
}
