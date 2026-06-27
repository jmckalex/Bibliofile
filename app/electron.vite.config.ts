import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          // Bundled separately so the main process can run it in a worker thread
          // (PDF text extraction off the main loop). Emitted as out/main/pdf-worker.js.
          'pdf-worker': resolve(__dirname, 'src/main/pdf-worker.ts'),
        },
        // The OCR stack must load from node_modules at runtime, NOT be bundled:
        //  • tesseract.js computes its worker-thread script path from `__dirname`
        //    (bundling would point it at out/main and the worker would never start);
        //  • @napi-rs/canvas is a native module whose correct .node binary must be
        //    picked per-architecture at runtime (arm64 vs x64 builds);
        //  • pdf.js / pdf-lib / the WASM core are resolved alongside them.
        // (Packaged builds additionally need electron-builder asarUnpack for these.)
        external: ['tesseract.js', 'tesseract.js-core', '@napi-rs/canvas', 'pdfjs-dist', 'pdf-lib'],
      },
    },
  },
  preload: {
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } },
    },
    plugins: [react()],
  },
});
