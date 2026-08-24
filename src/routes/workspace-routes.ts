import { Router } from 'express';

import {
  acceptInvite,
  changeMemberRole,
  createMyWorkspace,
  inviteMember,
  listDomains,
  listMembers,
  listMyWorkspaces,
  patchDomainStatus,
  registerDomain,
  removeDomain,
  removeMember,
  workspaceAuditLog
} from '../controllers/collaboration-controller';
import { requireAuth } from '../middlewares/auth';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import {
  customDomainParams,
  membershipParams,
  workspaceParams
} from '../validators/request-schemas';

export const workspaceRouter = Router();

workspaceRouter.use(requireAuth);
workspaceRouter.get('/', asyncHandler(listMyWorkspaces));
workspaceRouter.post('/', asyncHandler(createMyWorkspace));

workspaceRouter.get(
  '/:workspaceId/members',
  validate('params', workspaceParams),
  asyncHandler(listMembers)
);
workspaceRouter.post(
  '/:workspaceId/members',
  validate('params', workspaceParams),
  asyncHandler(inviteMember)
);
workspaceRouter.post(
  '/:workspaceId/members/accept',
  validate('params', workspaceParams),
  asyncHandler(acceptInvite)
);
workspaceRouter.patch(
  '/:workspaceId/members/:membershipId',
  validate('params', membershipParams),
  asyncHandler(changeMemberRole)
);
workspaceRouter.delete(
  '/:workspaceId/members/:membershipId',
  validate('params', membershipParams),
  asyncHandler(removeMember)
);

workspaceRouter.get(
  '/:workspaceId/audit-log',
  validate('params', workspaceParams),
  asyncHandler(workspaceAuditLog)
);

workspaceRouter.get(
  '/:workspaceId/custom-domains',
  validate('params', workspaceParams),
  asyncHandler(listDomains)
);
workspaceRouter.post(
  '/:workspaceId/custom-domains',
  validate('params', workspaceParams),
  asyncHandler(registerDomain)
);
workspaceRouter.patch(
  '/:workspaceId/custom-domains/:customDomainId',
  validate('params', customDomainParams),
  asyncHandler(patchDomainStatus)
);
workspaceRouter.delete(
  '/:workspaceId/custom-domains/:customDomainId',
  validate('params', customDomainParams),
  asyncHandler(removeDomain)
);
