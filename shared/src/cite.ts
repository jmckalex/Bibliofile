/**
 * Expand a cite-command template (see {@link Settings.citeCommandTemplate}) for a
 * set of cite keys. `%K` is replaced by the comma-joined keys; a literal `%%`
 * yields a single `%`. Used for drag-out-to-TeX and the "Copy \cite{}" command.
 */
export function formatCiteCommand(template: string, keys: readonly string[]): string {
  const joined = keys.join(',');
  // Single pass so a literal %% and a %K can't interfere with one another.
  return template.replace(/%%|%K/g, (token) => (token === '%%' ? '%' : joined));
}
