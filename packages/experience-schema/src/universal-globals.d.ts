/**
 * The web-standard globals a shared package is allowed to rely on.
 *
 * Packages compile with no ambient environment types at all, which is what
 * stops `process`, `Buffer` or `document` from creeping in. `URL` is genuinely
 * universal — Node and every browser implement the same WHATWG class — so it is
 * declared here rather than by pulling in a whole DOM or Node lib and losing
 * the guarantee.
 */

interface URL {
  readonly protocol: string;
  readonly username: string;
  readonly password: string;
  readonly hostname: string;
  readonly host: string;
  readonly origin: string;
  readonly pathname: string;
  readonly search: string;
  readonly hash: string;
  readonly href: string;
}

declare const URL: {
  new (url: string, base?: string | URL): URL;
};
