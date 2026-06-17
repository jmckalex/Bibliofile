// Test fixture worker for PdfPool: echoes `TEXT:<path>`. The sentinel
// "__throw__" throws so the pool's worker-error/respawn path can be exercised.
import { parentPort } from 'node:worker_threads';

parentPort.on('message', ({ id, path }) => {
  if (path === '__throw__') throw new Error('boom');
  parentPort.postMessage({ id, text: `TEXT:${path}` });
});
