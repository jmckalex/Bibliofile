/**
 * Worker-thread entry for PDF text extraction. The main process owns a small
 * pool of these ({@link PdfPool}) so pdfjs — which is CPU-heavy and synchronous
 * in bursts — never blocks the main event loop (and several PDFs extract in
 * parallel across cores). Protocol: receive `{ id, path }`, reply `{ id, text }`;
 * extraction never throws (empty string on any failure).
 */

import { parentPort } from 'node:worker_threads';

import { extractPdfText } from './pdf-text.js';

parentPort?.on('message', (msg: { id: number; path: string }) => {
  void extractPdfText(msg.path).then(
    (text) => parentPort?.postMessage({ id: msg.id, text }),
    () => parentPort?.postMessage({ id: msg.id, text: '' }),
  );
});
