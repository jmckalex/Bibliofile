// Load the packaged app's runtime-required modules the way the app does, from
// INSIDE the packaged bundle, and fail if any of them cannot load.
//
// Run by scripts/verify-packaged-app.cjs with the packaged app's own Electron binary
// in Node mode (ELECTRON_RUN_AS_NODE=1), so module resolution goes through
// Electron's asar support exactly as it does at launch:
//
//   ELECTRON_RUN_AS_NODE=1 Bibliofile.app/Contents/MacOS/Bibliofile \
//     scripts/packaged-app-probe.cjs Bibliofile.app/Contents/Resources
//
// Why this exists: 0.12.0 was signed, notarized and "verified" by checking that
// tesseract.js etc. were PRESENT in the bundle — and crashed on launch, because
// electron-builder 24 had not collected their own dependencies (regenerator-runtime
// first). Presence is not loadability. This loads them.
//
// Must be CommonJS (.cjs) because the root package.json is `type: module`.

const path = require('node:path');
const { createRequire } = require('node:module');
const { pathToFileURL } = require('node:url');

const resources = process.argv[2];
if (!resources) {
  console.error('usage: packaged-app-probe.cjs <Contents/Resources>');
  process.exit(2);
}
// Resolve as the bundled main process does: from out/main/index.js inside the asar.
const appRequire = createRequire(path.join(resources, 'app.asar', 'out', 'main', 'index.js'));

const failures = [];
async function check(label, fn) {
  try {
    const note = await fn();
    console.log(`  ok    ${label}${note ? ` — ${note}` : ''}`);
  } catch (e) {
    const msg = String(e && e.message ? e.message : e).split('\n')[0];
    console.log(`  FAIL  ${label} — ${msg}`);
    failures.push(label);
  }
}

(async () => {
  console.log(`[probe] ${resources}`);

  // The statically imported externals: any one of these failing kills the app at launch.
  await check('pdf-lib', () => {
    appRequire('pdf-lib');
  });
  await check('@napi-rs/canvas', () => {
    appRequire('@napi-rs/canvas').createCanvas(8, 8).getContext('2d');
  });
  await check('tesseract.js', () => {
    appRequire('tesseract.js');
  });

  // Loaded lazily, but no full-text search without it.
  await check('better-sqlite3 + FTS5', () => {
    const Database = appRequire('better-sqlite3');
    const db = new Database(':memory:');
    db.exec('CREATE VIRTUAL TABLE t USING fts5(x)');
    db.close();
  });

  // ocr.ts / pdf-text.ts import pdf.js by file URL.
  await check('pdfjs-dist', async () => {
    const pdfjs = await import(
      pathToFileURL(appRequire.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href
    );
    if (typeof pdfjs.getDocument !== 'function') throw new Error('no getDocument export');
    return pdfjs.version;
  });

  // tesseract.js's Node worker IGNORES corePath and require()s the core variant it
  // picks (relaxed-SIMD on current hardware) from tesseract.js's own location. So
  // resolve every variant from there — a core one major version behind lacks the
  // relaxedsimd builds, which is exactly what 0.12.0 shipped.
  await check('tesseract.js-core (as tesseract.js resolves it)', () => {
    const tessRequire = createRequire(appRequire.resolve('tesseract.js'));
    for (const v of ['', '-lstm', '-simd', '-simd-lstm', '-relaxedsimd', '-relaxedsimd-lstm']) {
      tessRequire.resolve(`tesseract.js-core/tesseract-core${v}`);
    }
    return tessRequire('tesseract.js-core/package.json').version;
  });

  // End to end: what Publication ▸ OCR Scanned PDFs does, minus the PDF plumbing —
  // spawn tesseract's worker thread inside the bundle, load the shipped English
  // traineddata, and read back a line of text.
  await check('OCR round trip', async () => {
    const { createCanvas } = appRequire('@napi-rs/canvas');
    const canvas = createCanvas(640, 120);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, 640, 120);
    ctx.fillStyle = '#000';
    ctx.font = '64px sans-serif';
    ctx.fillText('BIBLIOFILE', 30, 85);

    const { createWorker } = appRequire('tesseract.js');
    const worker = await createWorker('eng', 1, {
      corePath: path.dirname(appRequire.resolve('tesseract.js-core/package.json')),
      langPath: path.join(resources, 'tessdata'),
      gzip: true,
      cacheMethod: 'none',
    });
    try {
      const { data } = await worker.recognize(canvas.toBuffer('image/png'));
      const text = data.text.trim();
      if (!/BIBLIOFILE/i.test(text)) throw new Error(`recognized ${JSON.stringify(text)}`);
      return JSON.stringify(text);
    } finally {
      await worker.terminate();
    }
  });

  if (failures.length) {
    console.log(`[probe] ${failures.length} FAILED: ${failures.join(', ')}`);
    process.exit(1);
  }
  console.log('[probe] all runtime modules load.');
})().catch((e) => {
  console.error('[probe] crashed:', e);
  process.exit(1);
});
