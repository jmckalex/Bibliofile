/** Tests for the main-process fetch guards (audit rpt-02 SEV-7). */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  isPubliclyFetchable,
  isRememberedUrl,
  rememberFetchableUrl,
  __clearRememberedUrls,
} from './url-guard.js';

describe('isPubliclyFetchable', () => {
  it('allows ordinary https hosts', () => {
    for (const u of [
      'https://arxiv.org/pdf/2401.00001v1',
      'https://link.springer.com/content/pdf/10.1007/x.pdf',
      'https://api.unpaywall.org/v2/10.1000/xyz',
      'https://例え.jp/a.pdf',
    ]) {
      expect(isPubliclyFetchable(u), u).toBe(true);
    }
  });

  it('refuses anything that is not https', () => {
    expect(isPubliclyFetchable('http://arxiv.org/a.pdf')).toBe(false);
    expect(isPubliclyFetchable('file:///etc/passwd')).toBe(false);
    expect(isPubliclyFetchable('ftp://example.com/a.pdf')).toBe(false);
    expect(isPubliclyFetchable('data:application/pdf;base64,AAAA')).toBe(false);
  });

  it('refuses loopback and localhost spellings', () => {
    for (const u of [
      'https://localhost/a.pdf',
      'https://127.0.0.1/a.pdf',
      'https://127.1.2.3/a.pdf',
      'https://[::1]/a.pdf',
      'https://[::]/a.pdf',
    ]) {
      expect(isPubliclyFetchable(u), u).toBe(false);
    }
  });

  it('refuses private, CGNAT and link-local ranges', () => {
    for (const u of [
      'https://10.0.0.1/a.pdf',
      'https://172.16.0.1/a.pdf',
      'https://172.31.255.254/a.pdf',
      'https://192.168.1.1/a.pdf',
      'https://100.64.0.1/a.pdf',
      'https://0.0.0.0/a.pdf',
      'https://[fe80::1]/a.pdf',
      'https://[fd00::1]/a.pdf',
      'https://[::ffff:10.0.0.1]/a.pdf',
    ]) {
      expect(isPubliclyFetchable(u), u).toBe(false);
    }
  });

  it('refuses the cloud metadata endpoint specifically', () => {
    // The single most valuable SSRF target: instance credentials.
    expect(isPubliclyFetchable('https://169.254.169.254/latest/meta-data/')).toBe(false);
  });

  it('allows public addresses adjacent to the blocked ranges', () => {
    // 172.15/172.32 sit just outside RFC 1918; 100.63/100.128 outside CGNAT.
    expect(isPubliclyFetchable('https://172.15.0.1/a.pdf')).toBe(true);
    expect(isPubliclyFetchable('https://172.32.0.1/a.pdf')).toBe(true);
    expect(isPubliclyFetchable('https://100.63.0.1/a.pdf')).toBe(true);
    expect(isPubliclyFetchable('https://100.128.0.1/a.pdf')).toBe(true);
  });

  it('refuses intranet-shaped names and embedded credentials', () => {
    expect(isPubliclyFetchable('https://printer/a.pdf')).toBe(false); // bare name
    expect(isPubliclyFetchable('https://nas.local/a.pdf')).toBe(false);
    expect(isPubliclyFetchable('https://metadata.internal/a.pdf')).toBe(false);
    expect(isPubliclyFetchable('https://user:pw@example.com/a.pdf')).toBe(false);
  });

  it('refuses garbage rather than throwing', () => {
    expect(isPubliclyFetchable('')).toBe(false);
    expect(isPubliclyFetchable('not a url')).toBe(false);
    expect(isPubliclyFetchable('https://')).toBe(false);
  });
});

describe('the surfaced-URL allowlist', () => {
  beforeEach(() => __clearRememberedUrls());

  it('only admits URLs main itself surfaced', () => {
    const ours = 'https://arxiv.org/pdf/2401.00001v1';
    expect(isRememberedUrl(ours)).toBe(false);
    rememberFetchableUrl(ours);
    expect(isRememberedUrl(ours)).toBe(true);
    // A URL the renderer invented is not fetchable even though it looks fine.
    expect(isRememberedUrl('https://arxiv.org/pdf/9999.99999v1')).toBe(false);
  });

  it('never remembers a URL it would refuse anyway', () => {
    rememberFetchableUrl('https://169.254.169.254/latest/meta-data/');
    rememberFetchableUrl('http://arxiv.org/a.pdf');
    expect(isRememberedUrl('https://169.254.169.254/latest/meta-data/')).toBe(false);
    expect(isRememberedUrl('http://arxiv.org/a.pdf')).toBe(false);
  });

  it('stays bounded over a long session, evicting oldest first', () => {
    for (let i = 0; i < 4100; i++) rememberFetchableUrl(`https://example.com/${i}.pdf`);
    expect(isRememberedUrl('https://example.com/0.pdf')).toBe(false); // evicted
    expect(isRememberedUrl('https://example.com/4099.pdf')).toBe(true); // kept
  });
});
