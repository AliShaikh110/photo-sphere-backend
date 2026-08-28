import type { MediaAccess } from '@alishaikh110/experience-schema';

/**
 * Where a compiled media reference points.
 *
 * The compiler emits a logical delivery location and nothing else. It never
 * signs a URL, never mints a token and never reads a clock, so the same
 * compile produces the same bytes on a server and in a browser. Turning a
 * logical location into a credentialled one is a separate, server-only step.
 */
export interface MediaDeliveryPolicy {
  /** Delivery for creator-facing and private media, behind an access check. */
  readonly protectedUrlTemplate: string;
  /** Delivery for a public publication, addressable without a credential. */
  readonly publicUrlTemplate: string;
}

export const DEFAULT_MEDIA_DELIVERY_POLICY: MediaDeliveryPolicy = Object.freeze({
  protectedUrlTemplate: '/api/v1/media/{derivativeId}',
  publicUrlTemplate:
    '/api/v1/publications/{experienceId}/{publicationRevision}/media/{derivativeId}'
});

export interface MediaLocation {
  readonly access: MediaAccess;
  readonly experienceId: string;
  readonly assetId: string;
  readonly derivativeId: string;
  readonly publicationRevision?: number;
}

const PLACEHOLDER = /\{(experienceId|assetId|derivativeId|publicationRevision)\}/gu;

/**
 * Fills a delivery template. An unknown placeholder is left in place so a
 * misconfigured template fails the compiler's URL policy check loudly rather
 * than silently producing an address that does not resolve.
 */
export function formatMediaLocation(
  policy: MediaDeliveryPolicy,
  location: MediaLocation
): string {
  const template = location.access === 'public'
    ? policy.publicUrlTemplate
    : policy.protectedUrlTemplate;
  return template.replace(PLACEHOLDER, (match, name: string) => {
    switch (name) {
      case 'experienceId':
        return location.experienceId;
      case 'assetId':
        return location.assetId;
      case 'derivativeId':
        return location.derivativeId;
      case 'publicationRevision':
        return location.publicationRevision === undefined
          ? match
          : String(location.publicationRevision);
      default:
        return match;
    }
  });
}
