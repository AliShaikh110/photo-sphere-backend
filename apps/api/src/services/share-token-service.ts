import { randomBytes } from 'node:crypto';
import { Op } from 'sequelize';

import { AppError, notFound } from '../errors/app-error';
import { Project, PublicationShareToken } from '../models';
import { incrementMetric } from '../observability';
import { sha256 } from '../utils/hash';
import { requireProjectRole } from './access-service';
import { recordAudit } from './audit-service';
import { sanitizePlainText } from '@alishaikh110/experience-schema';

const TOKEN_BYTES = 32;
const MAX_ACTIVE_TOKENS = 25;

/** Only the hash is stored, so the secret exists exactly once: in the response. */
function hashToken(token: string): string {
  return sha256(token);
}

function serialize(token: PublicationShareToken): Record<string, unknown> {
  const revoked = token.revokedAt !== null;
  const expired = token.expiresAt !== null && token.expiresAt.getTime() <= Date.now();
  return {
    id: token.id,
    projectId: token.projectId,
    label: token.label,
    publicationRevision: token.publicationRevision,
    status: revoked ? 'revoked' : expired ? 'expired' : 'active',
    expiresAt: token.expiresAt,
    revokedAt: token.revokedAt,
    lastUsedAt: token.lastUsedAt,
    createdAt: token.createdAt
  };
}

export async function listShareTokens(
  projectId: string,
  userId: string
): Promise<Record<string, unknown>[]> {
  await requireProjectRole(projectId, userId, 'admin');
  const tokens = await PublicationShareToken.findAll({
    where: { projectId },
    order: [['createdAt', 'DESC']]
  });
  return tokens.map(serialize);
}

export async function createShareToken(
  projectId: string,
  userId: string,
  input: { label?: string; expiresInHours?: number; publicationRevision?: number }
): Promise<Record<string, unknown>> {
  const decision = await requireProjectRole(projectId, userId, 'admin');
  const active = await PublicationShareToken.count({
    where: {
      projectId,
      revokedAt: null,
      [Op.or]: [{ expiresAt: null }, { expiresAt: { [Op.gt]: new Date() } }]
    }
  });
  if (active >= MAX_ACTIVE_TOKENS) {
    throw new AppError('SHARE_TOKEN_LIMIT_REACHED', 'Revoke an existing share link first.', {
      status: 409,
      entityId: projectId,
      details: { maximum: MAX_ACTIVE_TOKENS }
    });
  }
  const secret = randomBytes(TOKEN_BYTES).toString('base64url');
  const token = await PublicationShareToken.create({
    projectId,
    tokenHash: hashToken(secret),
    label: input.label === undefined ? null : sanitizePlainText(input.label).trim().slice(0, 120) || null,
    publicationRevision: input.publicationRevision ?? null,
    expiresAt:
      input.expiresInHours === undefined
        ? null
        : new Date(Date.now() + input.expiresInHours * 3_600_000),
    revokedAt: null,
    lastUsedAt: null,
    createdByUserId: userId
  });
  await recordAudit({
    action: 'publication.share_token_created',
    actorUserId: userId,
    projectId,
    workspaceId: decision.workspaceId,
    entityType: 'publicationShareToken',
    entityId: token.id,
    metadata: {
      hasExpiry: token.expiresAt !== null,
      publicationRevision: token.publicationRevision
    }
  });
  // The secret is returned once and never stored in readable form.
  return { shareToken: { ...serialize(token), token: secret } };
}

export async function revokeShareToken(
  projectId: string,
  userId: string,
  shareTokenId: string
): Promise<Record<string, unknown>> {
  const decision = await requireProjectRole(projectId, userId, 'admin');
  const token = await PublicationShareToken.findOne({ where: { id: shareTokenId, projectId } });
  if (!token) throw notFound('share link', shareTokenId);
  if (token.revokedAt === null) await token.update({ revokedAt: new Date() });
  await recordAudit({
    action: 'publication.share_token_revoked',
    actorUserId: userId,
    projectId,
    workspaceId: decision.workspaceId,
    entityType: 'publicationShareToken',
    entityId: shareTokenId
  });
  return { revoked: true, shareTokenId };
}

export interface ShareTokenGrant {
  readonly shareTokenId: string;
  readonly projectId: string;
  readonly publicationRevision: number | null;
}

/**
 * Verifies a presented share link. Revocation and expiry are checked on every
 * use, so a leaked link stops working the moment it is revoked.
 */
export async function verifyShareToken(
  projectId: string,
  presentedToken: string | undefined
): Promise<ShareTokenGrant | undefined> {
  if (typeof presentedToken !== 'string' || presentedToken.length === 0) return undefined;
  const token = await PublicationShareToken.findOne({
    where: { projectId, tokenHash: hashToken(presentedToken) }
  });
  if (!token) return undefined;
  if (token.revokedAt !== null) return undefined;
  if (token.expiresAt !== null && token.expiresAt.getTime() <= Date.now()) return undefined;
  // Best-effort usage stamp: a write failure must not deny a valid visitor.
  void token.update({ lastUsedAt: new Date() }).catch(() => undefined);
  incrementMetric('access.share_token_used', { surface: 'publication' });
  return {
    shareTokenId: token.id,
    projectId: token.projectId,
    publicationRevision: token.publicationRevision
  };
}

/** Resolves a share link presented without a project context, by slug. */
export async function verifyShareTokenForSlug(
  slug: string,
  presentedToken: string | undefined
): Promise<ShareTokenGrant | undefined> {
  if (typeof presentedToken !== 'string' || presentedToken.length === 0) return undefined;
  const token = await PublicationShareToken.findOne({
    where: { tokenHash: hashToken(presentedToken) },
    include: [{ model: Project, as: 'project', attributes: ['id', 'publicationMetadata'] }]
  });
  if (!token?.project) return undefined;
  const metadata = token.project.publicationMetadata as { slug?: unknown };
  if (metadata.slug !== slug) return undefined;
  return verifyShareToken(token.projectId, presentedToken);
}
