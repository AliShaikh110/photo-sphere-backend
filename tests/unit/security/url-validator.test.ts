import { describe, expect, it } from 'vitest';

import {
  assertSafeUrl,
  validateSafeUrl,
} from '@alishaikh110/experience-schema';

describe('central URL policy', () => {
  it('allows and normalizes HTTPS URLs', () => {
    expect(validateSafeUrl(' HTTPS://Example.COM/path?q=1 ')).toEqual({
      valid: true,
      normalizedUrl: 'https://example.com/path?q=1',
      kind: 'https',
    });
  });

  it('allows only opted-in root-relative internal paths', () => {
    expect(validateSafeUrl('/view/example?mode=embed', { allowInternalRelative: true })).toEqual({
      valid: true,
      normalizedUrl: '/view/example?mode=embed',
      kind: 'internal-relative',
    });
    expect(validateSafeUrl('/view/example')).toMatchObject({
      valid: false,
      code: 'URL_RELATIVE_NOT_ALLOWED',
    });
    expect(validateSafeUrl('//evil.example/path', { allowInternalRelative: true })).toMatchObject({
      valid: false,
      code: 'URL_PROTOCOL_RELATIVE_NOT_ALLOWED',
    });
  });

  it.each([
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'http://example.com',
    'vbscript:msgbox(1)',
  ])('rejects dangerous or non-HTTPS scheme %s', (url) => {
    expect(validateSafeUrl(url)).toMatchObject({
      valid: false,
      code: 'URL_SCHEME_NOT_ALLOWED',
    });
  });

  it('enforces credential and host policy', () => {
    expect(validateSafeUrl('https://user:password@example.com')).toMatchObject({
      valid: false,
      code: 'URL_CREDENTIALS_NOT_ALLOWED',
    });
    expect(validateSafeUrl('https://other.example/path', {
      allowedHosts: ['trusted.example'],
    })).toMatchObject({ valid: false, code: 'URL_HOST_NOT_ALLOWED' });
    expect(assertSafeUrl('https://assets.trusted.example/path', {
      allowedHosts: ['trusted.example'],
      allowSubdomainsOfAllowedHosts: true,
    })).toBe('https://assets.trusted.example/path');
  });
});

