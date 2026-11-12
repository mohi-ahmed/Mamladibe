import { Router } from 'express';
import {
  handleAdminCreateTeamIncident,
  handleAdminCreateUser,
  handleAdminDashboard,
  handleAdminDeleteUser,
  handleAdminEditComment,
  handleAdminEditIncident,
  handleAdminGetActor,
  handleAdminGetComment,
  handleAdminGetIncident,
  handleAdminGetReport,
  handleAdminGetSettings,
  handleAdminHideComment,
  handleAdminHideIncident,
  handleAdminListActors,
  handleAdminListAudit,
  handleAdminListComments,
  handleAdminListIncidents,
  handleAdminListReports,
  handleAdminListUsers,
  handleAdminLogin,
  handleAdminLogout,
  handleAdminMe,
  handleAdminPurgeComment,
  handleAdminPurgeIncident,
  handleAdminResetUser2fa,
  handleAdminResolveReport,
  handleAdminRestoreIncident,
  handleAdminRestrictActor,
  handleAdminSoftDeleteComment,
  handleAdminSoftDeleteIncident,
  handleAdminUnhideComment,
  handleAdminUnhideIncident,
  handleAdminUnrestrictActor,
  handleAdminUpdateActorNotes,
  handleAdminUpdateSettings,
  handleAdminUpdateUser,
  handleAdminVerify2fa,
} from '../controllers/admin.controller.js';
import {
  requireActiveAdminSession,
  requireCsrfToken,
  requireModeratorOrSuper,
  requirePending2faSession,
  requireSuperAdmin,
  setAdminNoCacheHeadersMiddleware,
} from '../middleware/admin-auth.middleware.js';
import {
  validateBody,
  validateParams,
  validateQuery,
} from '../middleware/validate.middleware.js';
import {
  adminActorExactIdParamSchema,
  adminActorIdParamSchema,
  adminActorNotesBodySchema,
  adminCreateIncidentBodySchema,
  adminCreateUserBodySchema,
  adminDeleteUserBodySchema,
  adminEditCommentBodySchema,
  adminEditIncidentBodySchema,
  adminIncidentIdParamSchema,
  adminListActorsQuerySchema,
  adminListAuditQuerySchema,
  adminListCommentsQuerySchema,
  adminListIncidentsQuerySchema,
  adminListReportsQuerySchema,
  adminLoginBodySchema,
  adminReasonActionBodySchema,
  adminReset2faBodySchema,
  adminResolveReportBodySchema,
  adminRestrictActorBodySchema,
  adminUpdateSettingsBodySchema,
  adminUpdateUserBodySchema,
  adminVerify2faBodySchema,
  objectIdParamSchema,
} from '../validators/admin.validator.js';

const adminRouter = Router();

// Mandatory Cache-Control: no-store + X-Robots-Tag: noindex on all admin routes (PRD §11.4)
adminRouter.use(setAdminNoCacheHeadersMiddleware);

// Stage 0 & 1 authentication routes (before active session guard)
adminRouter.post(
  '/auth/login',
  validateBody(adminLoginBodySchema),
  handleAdminLogin,
);

adminRouter.post(
  '/auth/verify-2fa',
  requirePending2faSession,
  validateBody(adminVerify2faBodySchema),
  handleAdminVerify2fa,
);

// Single authorization layer for all active admin routes (PRD §11.1 & Architecture §D.7)
const protectedAdminRouter = Router();
protectedAdminRouter.use(
  requireActiveAdminSession,
  requireCsrfToken,
  requireModeratorOrSuper,
);

protectedAdminRouter.post('/auth/logout', handleAdminLogout);
protectedAdminRouter.get('/auth/me', handleAdminMe);

protectedAdminRouter.get('/dashboard', handleAdminDashboard);

// Incidents moderation
protectedAdminRouter.get(
  '/incidents',
  validateQuery(adminListIncidentsQuerySchema),
  handleAdminListIncidents,
);
protectedAdminRouter.get(
  '/incidents/:id',
  validateParams(adminIncidentIdParamSchema),
  handleAdminGetIncident,
);
protectedAdminRouter.post(
  '/incidents',
  validateBody(adminCreateIncidentBodySchema),
  handleAdminCreateTeamIncident,
);
protectedAdminRouter.patch(
  '/incidents/:id',
  validateParams(adminIncidentIdParamSchema),
  validateBody(adminEditIncidentBodySchema),
  handleAdminEditIncident,
);
protectedAdminRouter.post(
  '/incidents/:id/hide',
  validateParams(adminIncidentIdParamSchema),
  validateBody(adminReasonActionBodySchema),
  handleAdminHideIncident,
);
protectedAdminRouter.post(
  '/incidents/:id/unhide',
  validateParams(adminIncidentIdParamSchema),
  validateBody(adminReasonActionBodySchema),
  handleAdminUnhideIncident,
);
protectedAdminRouter.post(
  '/incidents/:id/restore',
  validateParams(adminIncidentIdParamSchema),
  validateBody(adminReasonActionBodySchema),
  handleAdminRestoreIncident,
);
protectedAdminRouter.delete(
  '/incidents/:id',
  validateParams(adminIncidentIdParamSchema),
  validateBody(adminReasonActionBodySchema),
  handleAdminSoftDeleteIncident,
);
protectedAdminRouter.delete(
  '/incidents/:id/permanent',
  requireSuperAdmin,
  validateParams(adminIncidentIdParamSchema),
  validateBody(adminReasonActionBodySchema),
  handleAdminPurgeIncident,
);

// Comments moderation
protectedAdminRouter.get(
  '/comments',
  validateQuery(adminListCommentsQuerySchema),
  handleAdminListComments,
);
protectedAdminRouter.get(
  '/comments/:id',
  validateParams(objectIdParamSchema),
  handleAdminGetComment,
);
protectedAdminRouter.patch(
  '/comments/:id',
  validateParams(objectIdParamSchema),
  validateBody(adminEditCommentBodySchema),
  handleAdminEditComment,
);
protectedAdminRouter.post(
  '/comments/:id/hide',
  validateParams(objectIdParamSchema),
  validateBody(adminReasonActionBodySchema),
  handleAdminHideComment,
);
protectedAdminRouter.post(
  '/comments/:id/unhide',
  validateParams(objectIdParamSchema),
  validateBody(adminReasonActionBodySchema),
  handleAdminUnhideComment,
);
protectedAdminRouter.delete(
  '/comments/:id',
  validateParams(objectIdParamSchema),
  validateBody(adminReasonActionBodySchema),
  handleAdminSoftDeleteComment,
);
protectedAdminRouter.delete(
  '/comments/:id/permanent',
  requireSuperAdmin,
  validateParams(objectIdParamSchema),
  validateBody(adminReasonActionBodySchema),
  handleAdminPurgeComment,
);

// Reports queue
protectedAdminRouter.get(
  '/reports',
  validateQuery(adminListReportsQuerySchema),
  handleAdminListReports,
);
protectedAdminRouter.get(
  '/reports/:id',
  validateParams(objectIdParamSchema),
  handleAdminGetReport,
);
protectedAdminRouter.post(
  '/reports/:id/resolve',
  validateParams(objectIdParamSchema),
  validateBody(adminResolveReportBodySchema),
  handleAdminResolveReport,
);

// Anonymous actor tracking & temporary restrictions
protectedAdminRouter.get(
  '/actors',
  validateQuery(adminListActorsQuerySchema),
  handleAdminListActors,
);
protectedAdminRouter.get(
  '/actors/:id',
  validateParams(adminActorIdParamSchema),
  handleAdminGetActor,
);
protectedAdminRouter.patch(
  '/actors/:id/notes',
  validateParams(adminActorExactIdParamSchema),
  validateBody(adminActorNotesBodySchema),
  handleAdminUpdateActorNotes,
);
protectedAdminRouter.post(
  '/actors/:id/restrict',
  validateParams(adminActorExactIdParamSchema),
  validateBody(adminRestrictActorBodySchema),
  handleAdminRestrictActor,
);
protectedAdminRouter.post(
  '/actors/:id/unrestrict',
  validateParams(adminActorExactIdParamSchema),
  validateBody(adminReasonActionBodySchema),
  handleAdminUnrestrictActor,
);

// Super-Admin-only user management & platform settings
protectedAdminRouter.get('/users', requireSuperAdmin, handleAdminListUsers);
protectedAdminRouter.post(
  '/users',
  requireSuperAdmin,
  validateBody(adminCreateUserBodySchema),
  handleAdminCreateUser,
);
protectedAdminRouter.patch(
  '/users/:id',
  requireSuperAdmin,
  validateParams(objectIdParamSchema),
  validateBody(adminUpdateUserBodySchema),
  handleAdminUpdateUser,
);
protectedAdminRouter.delete(
  '/users/:id',
  requireSuperAdmin,
  validateParams(objectIdParamSchema),
  validateBody(adminDeleteUserBodySchema),
  handleAdminDeleteUser,
);
protectedAdminRouter.post(
  '/users/:id/reset-2fa',
  requireSuperAdmin,
  validateParams(objectIdParamSchema),
  validateBody(adminReset2faBodySchema),
  handleAdminResetUser2fa,
);

protectedAdminRouter.get(
  '/audit',
  validateQuery(adminListAuditQuerySchema),
  handleAdminListAudit,
);

protectedAdminRouter.get('/settings', requireSuperAdmin, handleAdminGetSettings);
protectedAdminRouter.patch(
  '/settings',
  requireSuperAdmin,
  validateBody(adminUpdateSettingsBodySchema),
  handleAdminUpdateSettings,
);

adminRouter.use('/', protectedAdminRouter);

export default adminRouter;

