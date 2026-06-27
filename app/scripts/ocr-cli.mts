/**
 * Dev CLI to try the OCR engine on a real PDF before it's wired into the UI.
 *
 *   node --experimental-strip-types app/scripts/ocr-cli.mts <input.pdf> [lang]
 *
 * Writes "<input>.searchable.pdf" next to the input. Open it and try selecting /
 * searching the text to judge OCR quality. `lang` defaults to `eng`.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createOcrSession, isLikelyScanned } from '../src/main/ocr.ts';

const input = process.argv[2];
const lang = process.argv[3] ?? 'eng';
if (!input || !existsSync(input)) {
  console.error('Usage: node --experimental-strip-types app/scripts/ocr-cli.mts <input.pdf> [lang]');
  process.exit(1);
}

const langPath = resolve(dirname(fileURLToPath(import.meta.url)), '../resources/tessdata');
const bytes = new Uint8Array(readFileSync(resolve(input)));

console.log(`Input: ${input}`);
console.log(`Looks like a scan (no text layer)? ${await isLikelyScanned(bytes) ? 'yes' : 'no — it already has text'}`);

const t0 = Date.now();
const session = await createOcrSession({ lang, langPath });
const out = await session.ocrPdf(bytes, (done, total) => {
  if (done === 0) console.log(`OCR'ing ${total} page(s) in "${lang}"…`);
  else process.stdout.write(`\r  page ${done}/${total}`);
});
await session.close();

const outPath = join(dirname(resolve(input)), basename(input).replace(/\.pdf$/i, '') + '.searchable.pdf');
writeFileSync(outPath, Buffer.from(out));
console.log(`\nDone in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${outPath}`);
console.log('Open it and try ⌘F / selecting text to check the OCR.');
