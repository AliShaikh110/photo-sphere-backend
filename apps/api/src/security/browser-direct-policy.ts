import { config } from '../config';

/**
 * Which browser origins may call which route groups directly, and with what.
 *
 * Most authoring traffic reaches this API server-to-server. Three paths cannot:
 * media has to be fetched by the browser that renders it, the event stream has
 * to be held open by the browser that is editing, and telemetry has to be
 * reported by the browser that played the experience. Those three are declared
 * here rather than left to a single blanket allowlist, so widening one does not
 * silently widen the others.
 *
 * No group uses credentialled CORS. Every browser-direct call carries an
 * explicit, narrow, short-lived token instead of an ambient cookie, so a
 * cross-site request cannot borrow a signed-in session.
 */

export type BrowserDirectGroup = 'media' | 'events' | 'telemetry' | 'api';

export interface BrowserDirectRule {
  readonly group: BrowserDirectGroup;
  readonly description: string;
  readonly credentials: 'omit';
  /** Which credentials this group accepts, most specific first. */
  readonly acceptedTokens: readonly string[];
}

export const BROWSER_DIRECT_RULES: Readonly<Record<BrowserDirectGroup, BrowserDirectRule>> =
  Object.freeze({
    media: Object.freeze({
      group: 'media' as const,
      description: 'Signed media derivative fetches made by a player or an editor preview.',
      credentials: 'omit' as const,
      acceptedTokens: Object.freeze([
        'signed media URL token',
        'editor session token',
        'creator bearer token'
      ])
    }),
    events: Object.freeze({
      group: 'events' as const,
      description: 'The one-way server-sent event stream for a live authoring session.',
      credentials: 'omit' as const,
      acceptedTokens: Object.freeze(['editor session token', 'creator bearer token'])
    }),
    telemetry: Object.freeze({
      group: 'telemetry' as const,
      description: 'Runtime telemetry reported by a player.',
      credentials: 'omit' as const,
      acceptedTokens: Object.freeze(['telemetry ingest token'])
    }),
    api: Object.freeze({
      group: 'api' as const,
      description: 'Authoring and administration; normally called server to server.',
      credentials: 'omit' as const,
      acceptedTokens: Object.freeze(['creator bearer token'])
    })
  });

/** The route group a path belongs to. */
export function browserDirectGroup(path: string): BrowserDirectGroup {
  if (path.startsWith('/api/v1/media') || path.startsWith('/api/v1/publications')) return 'media';
  if (path.startsWith('/view/')) return 'media';
  if (path.startsWith('/api/v1/runtime/')) return 'telemetry';
  if (/^\/api\/v1\/projects\/[^/]+\/events\/?$/u.test(path)) return 'events';
  return 'api';
}

export function allowedOriginsFor(group: BrowserDirectGroup): readonly string[] {
  switch (group) {
    case 'media':
      // A player and an embedding site both fetch media directly.
      return [...new Set([
        ...config.corsOrigins,
        ...config.editorOrigins,
        ...config.playerOrigins,
        ...config.embedOrigins
      ])];
    case 'events':
      return [...new Set([...config.corsOrigins, ...config.editorOrigins])];
    case 'telemetry':
      return [...new Set([
        ...config.corsOrigins,
        ...config.playerOrigins,
        ...config.embedOrigins
      ])];
    case 'api':
      return config.corsOrigins;
  }
}

export function isOriginAllowed(group: BrowserDirectGroup, origin: string | undefined): boolean {
  // A request with no Origin is not a cross-origin browser request.
  if (!origin) return true;
  return allowedOriginsFor(group).includes(origin);
}

/** The policy as documentation, for the operator surface and the runbook. */
export function browserDirectPolicy(): Record<string, unknown> {
  return {
    groups: Object.values(BROWSER_DIRECT_RULES).map((rule) => ({
      group: rule.group,
      description: rule.description,
      credentials: rule.credentials,
      acceptedTokens: rule.acceptedTokens,
      allowedOrigins: allowedOriginsFor(rule.group)
    }))
  };
}
