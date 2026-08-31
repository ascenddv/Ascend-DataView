/**
 * Build a blank CSV template from the canonical schema (GET /api/schema) so a
 * first-time user can fill it in and upload it. Header row = every field name in
 * schema order; one example row with the date column pre-filled and every
 * numeric column left blank.
 */
export function buildTemplateCsv(fields = []) {
  const names = fields.map((f) => f.name);
  const example = fields.map((f) => (f.type === 'date' ? '2025-01-31' : ''));
  return `${names.join(',')}\n${example.join(',')}\n`;
}

/** Trigger a browser download of the template. */
export function downloadTemplateCsv(fields) {
  const blob = new Blob([buildTemplateCsv(fields)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'ascenddv-template.csv';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
