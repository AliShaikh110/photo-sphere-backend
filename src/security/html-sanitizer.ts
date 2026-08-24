import sanitizeHtml from 'sanitize-html';

import { validateSafeUrl } from './url-validator';

export const RICH_TEXT_ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'em',
  'b',
  'i',
  'u',
  's',
  'ul',
  'ol',
  'li',
  'blockquote',
  'h1',
  'h2',
  'h3',
  'h4',
  'code',
  'pre',
  'a',
] as const;

/**
 * Sanitizes untrusted authored HTML for both preview and publication paths.
 * Media embeds and inline styling are intentionally excluded; authored media
 * is represented by logical asset IDs in the canonical model.
 */
export function sanitizeRichHtml(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0) {
    return '';
  }

  return sanitizeHtml(input, {
    allowedTags: [...RICH_TEXT_ALLOWED_TAGS],
    allowedAttributes: {
      a: ['href', 'title', 'target', 'rel'],
    },
    allowedSchemes: ['https'],
    allowProtocolRelative: false,
    enforceHtmlBoundary: true,
    disallowedTagsMode: 'discard',
    transformTags: {
      a: (tagName, attributes) => {
        const transformed: Record<string, string> = {};
        if (attributes.title !== undefined) {
          transformed.title = attributes.title;
        }

        const href = validateSafeUrl(attributes.href, { allowInternalRelative: true });
        if (href.valid) {
          transformed.href = href.normalizedUrl;
        }

        if (attributes.target === '_blank' && href.valid) {
          transformed.target = '_blank';
          transformed.rel = 'noopener noreferrer nofollow';
        }

        return { tagName, attribs: transformed };
      },
    },
  });
}

/** Removes all markup while retaining the text content in escaped form. */
export function sanitizePlainText(input: unknown): string {
  if (typeof input !== 'string' || input.length === 0) {
    return '';
  }
  return sanitizeHtml(input, {
    allowedTags: [],
    allowedAttributes: {},
    enforceHtmlBoundary: true,
    disallowedTagsMode: 'discard',
  });
}

export const sanitizeHtmlContent = sanitizeRichHtml;

