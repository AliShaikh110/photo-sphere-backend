import type { Request, Response } from 'express';

import {
  acceptWorkspaceInvite,
  changeWorkspaceMemberRole,
  createWorkspace,
  grantProjectAccess,
  inviteWorkspaceMember,
  listProjectAccess,
  listWorkspaceMembers,
  listWorkspaces,
  removeWorkspaceMember,
  resolveProjectAccess,
  revokeProjectAccess
} from '../services/access-service';
import { listProjectAuditLog, listWorkspaceAuditLog } from '../services/audit-service';
import {
  listCustomDomains,
  registerCustomDomain,
  removeCustomDomain,
  setCustomDomainStatus
} from '../services/custom-domain-service';
import { sendData } from '../utils/http-response';
import { routeParam } from '../utils/route-param';
import {
  auditLogQuerySchema,
  changeMemberRoleSchema,
  createWorkspaceSchema,
  customDomainStatusSchema,
  grantProjectAccessSchema,
  inviteMemberSchema,
  registerCustomDomainSchema
} from '../validators/request-schemas';

function userId(request: Request): string {
  return request.auth!.userId;
}

/* Workspaces */

export async function listMyWorkspaces(request: Request, response: Response): Promise<void> {
  const workspaces = await listWorkspaces(userId(request));
  sendData(response, { workspaces });
}

export async function createMyWorkspace(request: Request, response: Response): Promise<void> {
  const input = createWorkspaceSchema.parse(request.body ?? {});
  const workspace = await createWorkspace(userId(request), input);
  sendData(response, { workspace }, { status: 201, message: 'Workspace created.' });
}

export async function listMembers(request: Request, response: Response): Promise<void> {
  const members = await listWorkspaceMembers(routeParam(request, 'workspaceId'), userId(request));
  sendData(response, { members });
}

export async function inviteMember(request: Request, response: Response): Promise<void> {
  const input = inviteMemberSchema.parse(request.body ?? {});
  const membership = await inviteWorkspaceMember(
    routeParam(request, 'workspaceId'),
    userId(request),
    input
  );
  sendData(response, { membership }, { status: 201, message: 'Invitation sent.' });
}

export async function acceptInvite(request: Request, response: Response): Promise<void> {
  const membership = await acceptWorkspaceInvite(routeParam(request, 'workspaceId'), userId(request));
  sendData(response, { membership }, { message: 'Invitation accepted.' });
}

export async function changeMemberRole(request: Request, response: Response): Promise<void> {
  const input = changeMemberRoleSchema.parse(request.body ?? {});
  const membership = await changeWorkspaceMemberRole(
    routeParam(request, 'workspaceId'),
    userId(request),
    routeParam(request, 'membershipId'),
    input.role
  );
  sendData(response, { membership });
}

export async function removeMember(request: Request, response: Response): Promise<void> {
  const result = await removeWorkspaceMember(
    routeParam(request, 'workspaceId'),
    userId(request),
    routeParam(request, 'membershipId')
  );
  sendData(response, result);
}

export async function workspaceAuditLog(request: Request, response: Response): Promise<void> {
  const workspaceId = routeParam(request, 'workspaceId');
  const query = auditLogQuerySchema.parse(request.query ?? {});
  // Reading the trail is itself an admin capability.
  const { requireWorkspaceRole } = await import('../services/access-service');
  await requireWorkspaceRole(workspaceId, userId(request), 'admin');
  const entries = await listWorkspaceAuditLog(workspaceId, {
    ...(query.limit === undefined ? {} : { limit: query.limit })
  });
  sendData(response, { entries });
}

/* Project access */

export async function listAccess(request: Request, response: Response): Promise<void> {
  const grants = await listProjectAccess(routeParam(request, 'projectId'), userId(request));
  sendData(response, { access: grants });
}

export async function grantAccess(request: Request, response: Response): Promise<void> {
  const input = grantProjectAccessSchema.parse(request.body ?? {});
  const grant = await grantProjectAccess(routeParam(request, 'projectId'), userId(request), input);
  sendData(response, { grant }, { status: 201, message: 'Access granted.' });
}

export async function revokeAccess(request: Request, response: Response): Promise<void> {
  const result = await revokeProjectAccess(
    routeParam(request, 'projectId'),
    userId(request),
    routeParam(request, 'grantId')
  );
  sendData(response, result);
}

export async function myProjectRole(request: Request, response: Response): Promise<void> {
  const decision = await resolveProjectAccess(routeParam(request, 'projectId'), userId(request));
  sendData(response, {
    projectId: decision.projectId,
    role: decision.role,
    source: decision.source,
    workspaceId: decision.workspaceId
  });
}

export async function projectAuditLog(request: Request, response: Response): Promise<void> {
  const projectId = routeParam(request, 'projectId');
  const query = auditLogQuerySchema.parse(request.query ?? {});
  const { requireProjectRole } = await import('../services/access-service');
  await requireProjectRole(projectId, userId(request), 'admin');
  const entries = await listProjectAuditLog(projectId, {
    ...(query.limit === undefined ? {} : { limit: query.limit })
  });
  sendData(response, { entries });
}

/* Custom domains */

export async function listDomains(request: Request, response: Response): Promise<void> {
  const customDomains = await listCustomDomains(routeParam(request, 'workspaceId'), userId(request));
  sendData(response, { customDomains });
}

export async function registerDomain(request: Request, response: Response): Promise<void> {
  const input = registerCustomDomainSchema.parse(request.body ?? {});
  const result = await registerCustomDomain(
    routeParam(request, 'workspaceId'),
    userId(request),
    input
  );
  sendData(response, result, { status: 201, message: 'Domain registered. Publish the DNS record to verify it.' });
}

export async function patchDomainStatus(request: Request, response: Response): Promise<void> {
  const input = customDomainStatusSchema.parse(request.body ?? {});
  const result = await setCustomDomainStatus(
    routeParam(request, 'workspaceId'),
    userId(request),
    routeParam(request, 'customDomainId'),
    input.status
  );
  sendData(response, result);
}

export async function removeDomain(request: Request, response: Response): Promise<void> {
  const result = await removeCustomDomain(
    routeParam(request, 'workspaceId'),
    userId(request),
    routeParam(request, 'customDomainId')
  );
  sendData(response, result);
}
