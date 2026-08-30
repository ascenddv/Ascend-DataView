/**
 * Convert a CSV fixture to an equivalent .xlsx (every cell written as text, so
 * SheetJS parses it back to the exact same strings the CSV produces).
 *
 *   node scripts/csv-to-xlsx.mjs <in.csv> <out.xlsx>
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const Papa = require('papaparse');

const [inCsv, outXlsx] = process.argv.slice(2);
const parsed = Papa.parse(readFileSync(inCsv, 'utf8'), { skipEmptyLines: 'greedy' });
const aoa = parsed.data.map((row) => row.map((cell) => String(cell))); // force text cells

const ws = XLSX.utils.aoa_to_sheet(aoa);
const wb = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(wb, ws, 'data');
XLSX.writeFile(wb, outXlsx, { bookType: 'xlsx' });
console.log(`wrote ${outXlsx} — ${aoa.length - 1} data rows, ${aoa[0].length} columns`);
