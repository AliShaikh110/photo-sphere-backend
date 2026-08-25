import { describe, expect, it } from 'vitest';

import { assertAllowedLiveSourceUrl } from '../../src/integrations/live';

/**
 * Sprint 04 §17 requires the live-source interface to be allow-listed and
 * non-SSRF-capable, and §22 requires that to be proven rather than assumed.
 * The provider stays feature-flagged, but this validation runs before any
 * provider would ever be handed a URL.
 */
describe('Live source URL policy', () => {
  const allowed = ['stream.example.test', 'cdn.example.test'];

  function reject(url: string): void {
    expect(() => assertAllowedLiveSourceUrl(url, allowed), url).toThrowError();
  }

  it('accepts an allow-listed https host', () => {
    const parsed = assertAllowedLiveSourceUrl('https://stream.example.test/live.m3u8', allowed);
    expect(parsed.hostname).toBe('stream.example.test');
  });

  it('refuses a host that is not on the allowlist', () => {
    reject('https://attacker.example.test/live.m3u8');
    reject('https://stream.example.test.attacker.test/live.m3u8');
  });

  it('refuses loopback, link-local and metadata addresses', () => {
    for (const host of [
      'localhost',
      'app.localhost',
      'metadata',
      'metadata.google.internal',
      '127.0.0.1',
      '127.1.1.1',
      '0.0.0.0',
      '169.254.169.254',
      '[::1]'
    ]) {
      reject(`https://${host}/live.m3u8`);
    }
  });

  it('refuses private and carrier-grade NAT ranges', () => {
    for (const host of [
      '10.0.0.5',
      '172.16.4.4',
      '172.31.255.255',
      '192.168.1.10',
      '100.64.0.1',
      '224.0.0.1',
      '[fd00::1]',
      '[fe80::1]'
    ]) {
      reject(`https://${host}/live.m3u8`);
    }
  });

  it('refuses schemes that are not stream transports', () => {
    for (const url of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,<script>alert(1)</script>',
      'gopher://stream.example.test/',
      'http://stream.example.test/live.m3u8'
    ]) {
      reject(url);
    }
  });

  it('refuses every source when no allowlist is configured', () => {
    expect(() => assertAllowedLiveSourceUrl('https://stream.example.test/live.m3u8', []))
      .toThrowError();
  });
});
