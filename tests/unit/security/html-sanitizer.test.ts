import { describe, expect, it } from 'vitest';

import {
  sanitizePlainText,
  sanitizeRichHtml,
} from '../../../apps/api/src/security/html-sanitizer';

describe('shared HTML sanitizer', () => {
  it('removes executable tags, event handlers, inline styles, and unsafe links', () => {
    const result = sanitizeRichHtml(
      '<script>alert(1)</script><p onclick="steal()" style="color:red">Safe</p>'
      + '<a href="javascript:alert(2)" target="_blank">bad</a>',
    );

    expect(result).toBe('<p>Safe</p><a>bad</a>');
    expect(result).not.toContain('script');
    expect(result).not.toContain('onclick');
    expect(result).not.toContain('javascript');
  });

  it('keeps policy-approved links and hardens new tabs', () => {
    expect(sanitizeRichHtml(
      '<a href="https://EXAMPLE.com/docs" target="_blank" rel="opener">Docs</a>',
    )).toBe(
      '<a href="https://example.com/docs" target="_blank" rel="noopener noreferrer nofollow">Docs</a>',
    );
    expect(sanitizeRichHtml('<a href="/help">Help</a>')).toBe('<a href="/help">Help</a>');
  });

  it('provides a markup-free plain-text boundary', () => {
    expect(sanitizePlainText('<b>Hello</b><img src=x onerror=alert(1)>')).toBe('Hello');
  });
});

