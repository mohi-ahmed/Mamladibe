import type { Request, Response } from 'express';
import {
  clearAdminSessionCookie,
  setAdminSessionCookie,
} from '../middleware/admin-auth.middleware.js';
import { requireActorIpHash } from '../middleware/actor.middleware.js';
import {
  getAdminSessionMe,
  loginAdminWithPassword,
  logoutAdminSession,
  verifyAdminTwoFactor,
} from '../services/admin-auth.service.js';
import {
  changeCommentVisibility,
  getAdminCommentDetail,
  getAdminReportDetail,
  listAdminComments,
  listAdminReports,
  purgeCommentPermanently,
  redactComment,
  resolveAdminReport,
} from '../services/admin-comments-reports.service.js';
import {
  createAdminUser,
  deleteAdminUser,
  getActorProfile,
  getAdminSettings,
  listActors,
  listAdminUsers,
  listAuditLogs,
  resetAdminUser2fa,
  restrictActor,
  unrestrictActor,
  updateActorNotes,
  updateAdminSettings,
  updateAdminUser,
} from '../services/admin-governance.service.js';
import {
  changeIncidentVisibility,
  createTeamIncident,
  getAdminIncidentDetail,
  getDashboardSummary,
  listAdminIncidents,
  moderationEditIncident,
  purgeIncidentPermanently,
} from '../services/admin-incidents.service.js';
import type { AuthenticatedAdminContext, ModerationOutcome } from '../types/index.js';
import { internalError } from '../utils/errors.js';
import type {
  AdminActorNotesBody,
  AdminCreateIncidentBody,
  AdminCreateUserBody,
  AdminDeleteUserBody,
  AdminEditCommentBody,
  AdminEditIncidentBody,
  AdminListActorsQuery,
  AdminListAuditQuery,
  AdminListCommentsQuery,
  AdminListIncidentsQuery,
  AdminListReportsQuery,
  AdminResolveReportBody,
  AdminRestrictActorBody,
  AdminUpdateSettingsBody,
  AdminUpdateUserBody,
} from '../validators/admin.validator.js';

function requireAdminContext(req: Request): AuthenticatedAdminContext {
  if (!req.adminSession) {
    throw internalError('Admin session context missing.', 500);
  }
  return req.adminSession;
}

export async function handleAdminLogin(req: Request, res: Response): Promise<void> {
  const { email, password } = req.body as { email: string; password: string };
  const result = await loginAdminWithPassword(email, password, {
    ipHash: requireActorIpHash(req),
  });

  setAdminSessionCookie(
    res,
    result.rawSessionToken,
    req.secure,
    result.pendingExpiresAt.getTime() - Date.now(),
  );

  res.status(200).json({
    pending2fa: result.pending2fa,
    requires2faSetup: result.requires2faSetup,
    ...(result.totpSetup ? { totpSetup: result.totpSetup } : {}),
  });
}

export async function handleAdminVerify2fa(req: Request, res: Response): Promise<void> {
  const sessionCtx = requireAdminContext(req);
  const { code } = req.body as { code: string };

  const result = await verifyAdminTwoFactor(sessionCtx, code, {
    ipHash: requireActorIpHash(req),
    onSessionRevoked: () => clearAdminSessionCookie(res, req.secure),
  });

  setAdminSessionCookie(res, result.rawSessionToken, req.secure);
  res.status(200).json({
    admin: result.admin,
    csrfToken: result.csrfToken,
  });
}

export async function handleAdminLogout(req: Request, res: Response): Promise<void> {
  const sessionCtx = requireAdminContext(req);
  const result = await logoutAdminSession(sessionCtx);
  clearAdminSessionCookie(res, req.secure);
  res.status(200).json(result);
}

export function handleAdminMe(req: Request, res: Response): void {
  const sessionCtx = requireAdminContext(req);
  res.status(200).json(getAdminSessionMe(sessionCtx));
}

export async function handleAdminDashboard(req: Request, res: Response): Promise<void> {
  const sessionCtx = requireAdminContext(req);
  const summary = await getDashboardSummary({
    adminId: sessionCtx.adminId,
    role: sessionCtx.role,
  });
  res.status(200).json(summary);
}

export async function handleAdminListIncidents(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as AdminListIncidentsQuery;
  const result = await listAdminIncidents(query);
  res.status(200).json(result);
}

export async function handleAdminGetIncident(req: Request, res: Response): Promise<void> {
  const sessionCtx = requireAdminContext(req);
  const { id } = req.params as { id: string };
  const result = await getAdminIncidentDetail(id, {
    adminId: sessionCtx.adminId,
    role: sessionCtx.role,
  });
  res.status(200).json(result);
}

export async function handleAdminCreateTeamIncident(req: Request, res: Response): Promise<void> {
  const sessionCtx = requireAdminContext(req);
  const body = req.body as AdminCreateIncidentBody;
  const incident = await createTeamIncident(body, sessionCtx.adminId);
  res.status(201).json({ incident });
}

export async function handleAdminEditIncident(req: Request, res: Response): Promise<void> {
  const sessionCtx = requireAdminContext(req);
  const { id } = req.params as { id: string };
  const body = req.body as AdminEditIncidentBody;
  const incident = await moderationEditIncident(id, body, sessionCtx.adminId);
  res.status(200).json({ incident });
}

export async function handleAdminHideIncident(req: Request, res: Response): Promise<void> {
  const sessionCtx = requireAdminContext(req);
  const { id } = req.params as { id: string };
  const body = req.body as { reason: string; outcome?: ModerationOutcome };
  const incident = await changeIncidentVisibility(id, 'hide', body, sessionCtx.adminId);
  res.status(200).json({ incident });
}

export async function handleAdminUnhideIncident(req: Request, res: Response): Promise<void> {
  const sessionCtx = requireAdminContext(req);
  const { id } = req.params as { id: string };
  const body = req.body as { reason: string };
  const incident = await changeIncidentVisibility(id, 'unhide', body, sessionCtx.adminId);
  res.status(200).json({ incident });
}

export async function handleAdminRestoreIncident(req: Request, res: Response): Promise<void> {
  const sessionCtx = requireAdminContext(req);
  const { id } = req.params as { id: string };
  const body = req.body as { reason: string };
  const incident = await changeIncidentVisibility(id, 'restore', body, sessionCtx.adminId);
  res.status(200).json({ incident });
}

export async function handleAdminSoftDeleteIncident(req: Request, res: Response): Promise<void> {
  const sessionCtx = requireAdminContext(req);
  const { id } = req.params as { id: string };
  const body = req.body as { reason: string; outcome?: ModerationOutcome };
  const incident = await changeIncidentVisibility(id, 'delete', body, sessionCtx.adminId);
  res.status(200).json({ incident });
}

export async function handleAdminPurgeIncident(req: Request, res: Response): Promise<void> {
  const sessionCtx = requireAdminContext(req);
  const { id } = req.params as { id: string };
  const { reason } = req.body as { reason: string };
  const result = await purgeIncidentPermanently(id, reason, sessionCtx.adminId);
  res.status(200).json(result);
}

export async function handleAdminListComments(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as AdminListCommentsQuery;
  const result = await listAdminComments(query);
  res.status(200).json(result);
}

export async function handleAdminGetComment(req: Request, res: Response): Promise<void> {
  const sessionCtx = requireAdminContext(req);
  const { id } = req.params as { id: string };
  const result = await getAdminCommentDetail(id, {
    adminId: sessionCtx.adminId,
    role: sessionCtx.role,
  });
  res.status(200).json(result);
}

export async function handleAdminEditComment(req: Request, res: Response): Promise<void> {
  const sessionCtx = requireAdminContext(req);
  const { id } = req.params as { id: string };
  const body = req.body as AdminEditCommentBody;
  const comment = await redactComment(id, body, sessionCtx.adminId);
  res.status(200).json({ comment });
}

export async function handleAdminHideComment(req: Request, res: Response): Promise<void> {
  const sessionCtx = requireAdminContext(req);
  const { id } = req.params as { id: string };
  const { reason } = req.body as { reason: string };
  const comment = await changeCommentVisibility(id, 'hide', reason, sessionCtx.adminId);
  res.status(200).json({ comment });
}

export async function handleAdminUnhideComment(req: Request, res: Response): Promise<void> {
  const sessionCtx = requireAdminContext(req);
  const { id } = req.params as { id: string };
  const { reason } = req.body as { reason: string };
  const comment = await changeCommentVisibility(id, 'unhide', reason, sessionCtx.adminId);
  res.status(200).json({ comment });
}

export async function handleAdminSoftDeleteComment(req: Request, res: Response): Promise<void> {
  const sessionCtx = requireAdminContext(req);
  const { id } = req.params as { id: string };
  const { reason } = req.body as { reason: string };
  const comment = await changeCommentVisibility(id, 'delete', reason, sessionCtx.adminId);
  res.status(200).json({ comment });
}

export async function handleAdminPurgeComment(req: Request, res: Response): Promise<void> {
  const sessionCtx = requireAdminContext(req);
  const { id } = req.params as { id: string };
  const { reason } = req.body as { reason: string };
  const result = await purgeCommentPermanently(id, reason, sessionCtx.adminId);
  res.status(200).json(result);
}

export async function handleAdminListReports(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as AdminListReportsQuery;
  const result = await listAdminReports(query);
  res.status(200).json(result);
}

export async function handleAdminGetReport(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const result = await getAdminReportDetail(id);
  res.status(200).json(result);
}

export async function handleAdminResolveReport(req: Request, res: Response): Promise<void> {
  const sessionCtx = requireAdminContext(req);
  const { id } = req.params as { id: string };
  const body = req.body as AdminResolveReportBody;
  const result = await resolveAdminReport(id, body, sessionCtx.adminId);
  res.status(200).json(result);
}

export async function handleAdminListActors(req: Request, res: Response): Promise<void> {
  const sessionCtx = requireAdminContext(req);
  const query = req.query as unknown as AdminListActorsQuery;
  const result = await listActors(query, sessionCtx.adminId);
  res.status(200).json(result);
}

export async function handleAdminGetActor(req: Request, res: Response): Promise<void> {
  const sessionCtx = requireAdminContext(req);
  const { id } = req.params as { id: string };
  const result = await getActorProfile(id, sessionCtx.adminId);
  res.status(200).json(result);
}

export async function handleAdminUpdateActorNotes(req: Request, res: Response): Promise<void> {
  const sessionCtx = requireAdminContext(req);
  const { id } = req.params as { id: string };
  const { notes, reason } = req.body as AdminActorNotesBody;
  const actor = await updateActorNotes(id, notes, sessionCtx.adminId, reason);
  res.status(200).json({ actor });
}

export async function handleAdminRestrictActor(req: Request, res: Response): Promise<void> {
  const sessionCtx = requireAdminContext(req);
  const { id } = req.params as { id: string };
  const body = req.body as AdminRestrictActorBody;
  const actor = await restrictActor(id, body, sessionCtx.adminId);
  res.status(200).json({ actor });
}

export async function handleAdminUnrestrictActor(req: Request, res: Response): Promise<void> {
  const sessionCtx = requireAdminContext(req);
  const { id } = req.params as { id: string };
  const { reason } = req.body as { reason: string };
  const actor = await unrestrictActor(id, reason, sessionCtx.adminId);
  res.status(200).json({ actor });
}

export async function handleAdminListUsers(_req: Request, res: Response): Promise<void> {
  const result = await listAdminUsers();
  res.status(200).json(result);
}

export async function handleAdminCreateUser(req: Request, res: Response): Promise<void> {
  const sessionCtx = requireAdminContext(req);
  const body = req.body as AdminCreateUserBody;
  const result = await createAdminUser(body, sessionCtx.adminId);
  res.status(201).json(result);
}

export async function handleAdminUpdateUser(req: Request, res: Response): Promise<void> {
  const sessionCtx = requireAdminContext(req);
  const { id } = req.params as { id: string };
  const body = req.body as AdminUpdateUserBody;
  const result = await updateAdminUser(id, body, sessionCtx.adminId);
  res.status(200).json(result);
}

export async function handleAdminDeleteUser(req: Request, res: Response): Promise<void> {
  const sessionCtx = requireAdminContext(req);
  const { id } = req.params as { id: string };
  const { reason } = (req.body as AdminDeleteUserBody | undefined) ?? {};
  const result = await deleteAdminUser(id, sessionCtx.adminId, reason);
  res.status(200).json(result);
}

export async function handleAdminResetUser2fa(req: Request, res: Response): Promise<void> {
  const sessionCtx = requireAdminContext(req);
  const { id } = req.params as { id: string };
  const { reason } = req.body as { reason: string };
  const result = await resetAdminUser2fa(id, reason, sessionCtx.adminId);
  res.status(200).json(result);
}

export async function handleAdminListAudit(req: Request, res: Response): Promise<void> {
  const sessionCtx = requireAdminContext(req);
  const query = req.query as unknown as AdminListAuditQuery;
  const result = await listAuditLogs(query, {
    adminId: sessionCtx.adminId,
    role: sessionCtx.role,
  });
  res.status(200).json(result);
}

export async function handleAdminGetSettings(_req: Request, res: Response): Promise<void> {
  const result = await getAdminSettings();
  res.status(200).json(result);
}

export async function handleAdminUpdateSettings(req: Request, res: Response): Promise<void> {
  const sessionCtx = requireAdminContext(req);
  const body = req.body as AdminUpdateSettingsBody;
  const result = await updateAdminSettings(body, sessionCtx.adminId);
  res.status(200).json(result);
}

