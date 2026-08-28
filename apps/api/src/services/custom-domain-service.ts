import { randomBytes } from 'node:crypto';

import { AppError, notFound } from '../errors/app-error';
import { CustomDomain } from '../models';
import { CUSTOM_DOMAIN_STATUSES, type CustomDomainStatus } from '../models/custom-domain.model';
import { requireWorkspaceRole } from './access-service';

/**
 * Custom domain mapping for published experiences.
 *
 * The platform owns the registration, ownership proof and status; issuing
 * certificates and routing traffic belongs to the deployment's edge. Keeping
 * that split explicit means a hosting change never touches customer data.
 */

const HOSTNAME_PATTERN = /^(?!-)[a-z0-9-]{1,63}(?:\.(?!-)[a-z0-9-]{1,63})+$/u;
const RESERVED_SUFFIXES = ['localhost', 'local', 'internal', 'example', 'invalid', 'test'];

function normalizeHostname(value: unknown): string {
  if (typeof value !== 'string') {
    throw new AppError('INVALID_HOSTNAME', 'Enter a domain such as tours.example.com.', {
      status: 422,
      path: 'hostname'
    });
  }
  const hostname = value.trim().toLowerCase().replace(/\.$/, '');
  if (!HOSTNAME_PATTERN.test(hostname) || hostname.length > 253) {
    throw new AppError('INVALID_HOSTNAME', 'Enter a domain such as tours.example.com.', {
      status: 422,
      path: 'hostname'
    });
  }
  const suffix = hostname.split('.').pop() ?? '';
  if (RESERVED_SUFFIXES.includes(suffix)) {
    throw new AppError('HOSTNAME_NOT_ALLOWED', 'That domain cannot be used.', {
      status: 422,
      path: 'hostname'
    });
  }
  return hostname;
}

function serialize(domain: CustomDomain): Record<string, unknown> {
  return {
    id: domain.id,
    workspaceId: domain.workspaceId,
    hostname: domain.hostname,
    status: domain.status,
    // The proof record the operator must publish in DNS before verification.
    verification: {
      recordType: 'TXT',
      recordName: `_sphere-verification.${domain.hostname}`,
      recordValue: domain.verificationToken
    },
    verifiedAt: domain.verifiedAt,
    createdAt: domain.createdAt,
    updatedAt: domain.updatedAt
  };
}

export async function listCustomDomains(
  workspaceId: string,
  userId: string
): Promise<Record<string, unknown>[]> {
  await requireWorkspaceRole(workspaceId, userId, 'admin');
  const domains = await CustomDomain.findAll({
    where: { workspaceId },
    order: [['hostname', 'ASC']]
  });
  return domains.map(serialize);
}

export async function registerCustomDomain(
  workspaceId: string,
  userId: string,
  input: { hostname: unknown }
): Promise<Record<string, unknown>> {
  await requireWorkspaceRole(workspaceId, userId, 'admin');
  const hostname = normalizeHostname(input.hostname);
  const existing = await CustomDomain.findOne({ where: { hostname } });
  if (existing) {
    throw new AppError('HOSTNAME_ALREADY_REGISTERED', 'That domain is already in use.', {
      status: 409,
      path: 'hostname'
    });
  }
  const domain = await CustomDomain.create({
    workspaceId,
    hostname,
    status: 'pending',
    verificationToken: randomBytes(24).toString('base64url'),
    verifiedAt: null
  });
  return { customDomain: serialize(domain) };
}

/**
 * Records the outcome of an ownership check. The DNS lookup itself belongs to
 * the operations pipeline, which calls this once it has a verdict, so the API
 * never performs an outbound request to a customer-controlled name.
 */
export async function setCustomDomainStatus(
  workspaceId: string,
  userId: string,
  customDomainId: string,
  status: CustomDomainStatus
): Promise<Record<string, unknown>> {
  await requireWorkspaceRole(workspaceId, userId, 'admin');
  if (!CUSTOM_DOMAIN_STATUSES.includes(status)) {
    throw new AppError('INVALID_DOMAIN_STATUS', 'That domain status is not valid.', {
      status: 422,
      path: 'status'
    });
  }
  const domain = await CustomDomain.findOne({ where: { id: customDomainId, workspaceId } });
  if (!domain) throw notFound('custom domain', customDomainId);
  await domain.update({
    status,
    verifiedAt: status === 'verified' ? new Date() : null
  });
  return { customDomain: serialize(domain) };
}

export async function removeCustomDomain(
  workspaceId: string,
  userId: string,
  customDomainId: string
): Promise<Record<string, unknown>> {
  await requireWorkspaceRole(workspaceId, userId, 'admin');
  const domain = await CustomDomain.findOne({ where: { id: customDomainId, workspaceId } });
  if (!domain) throw notFound('custom domain', customDomainId);
  await domain.destroy();
  return { removed: true, customDomainId };
}

/** Resolves a request hostname to a verified workspace, for edge routing. */
export async function resolveVerifiedCustomDomain(
  hostname: string
): Promise<{ workspaceId: string; hostname: string } | undefined> {
  const domain = await CustomDomain.findOne({
    where: { hostname: hostname.trim().toLowerCase(), status: 'verified' },
    attributes: ['workspaceId', 'hostname']
  });
  return domain === null ? undefined : { workspaceId: domain.workspaceId, hostname: domain.hostname };
}
