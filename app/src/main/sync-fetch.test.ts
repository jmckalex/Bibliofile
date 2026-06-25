import { describe, it, expect } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { syncFetch } from './sync-fetch.js';

// The server runs in a SEPARATE process: syncFetch blocks the main thread's event
// loop, so an in-process server couldn't answer (it would deadlock). A child has
// its own event loop and responds while we block.
const SERVER = `
const http = require('http');
const s = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain' });
  res.end('hello ' + req.method + ':' + (req.url || ''));
});
s.listen(0, '127.0.0.1', () => process.stdout.write('PORT ' + s.address().port + '\\n'));
`;

async function startServer(): Promise<{ port: number; child: ChildProcess }> {
  const child = spawn(process.execPath, ['-e', SERVER]);
  const port = await new Promise<number>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 5000);
    child.stdout!.on('data', (d) => {
      const m = String(d).match(/PORT (\d+)/);
      if (m) {
        clearTimeout(timer);
        resolve(Number(m[1]));
      }
    });
  });
  return { port, child };
}

describe('syncFetch', () => {
  it('performs a blocking GET and returns status + text', async () => {
    const { port, child } = await startServer();
    try {
      const out = syncFetch(`http://127.0.0.1:${port}/x`);
      expect(out.status).toBe(200);
      expect(out.text).toBe('hello GET:/x');
      expect(out.headers['content-type']).toContain('text/plain');
    } finally {
      child.kill();
    }
  });

  it('throws on a refused connection (no listener)', () => {
    // Port 9 (discard) is virtually never an HTTP listener → connection refused.
    expect(() => syncFetch('http://127.0.0.1:9/', {}, 1500)).toThrow(/failed|refused|timed out/i);
  });
});
