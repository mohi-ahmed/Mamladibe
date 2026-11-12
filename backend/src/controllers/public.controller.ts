import type { Request, Response } from 'express';
import { extractClientIp } from '../lib/crypto.js';
import { reverseGeocodePoint, searchBangladeshPlaces } from '../lib/geocoding.js';
import { consumeGeoRateLimit } from '../lib/ratelimit.js';
import {
  requireActorIpHash,
  resolveOptionalActorId,
} from '../middleware/actor.middleware.js';
import {
  createComment,
  deleteOwnComment,
  getMyCommentQuota,
  listPublicComments,
} from '../services/comment.service.js';
import {
  removeIncidentVote,
  reportComment,
  reportIncident,
  upsertIncidentVote,
} from '../services/engagement.service.js';
import {
  createPublicIncident,
  getPublicIncidentByTrackingId,
  listPublicIncidents,
  quickEditIncident,
  trackIncidentByCredentials,
} from '../services/incident.service.js';
import { getPublicMetaPayload } from '../services/meta.service.js';
import type { FlagReason, VoteType } from '../types/index.js';
import { internalError } from '../utils/errors.js';
import type {
  CreateCommentInput,
  CreateIncidentInput,
  ListIncidentsQuery,
  QuickEditInput,
} from '../validators/public.validator.js';

function requireRequestActorId(req: Request): string {
  if (!req.actorId) {
    throw internalError('Actor identity middleware did not run.', 500);
  }
  return req.actorId;
}

export function handleGetMeta(_req: Request, res: Response): void {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.status(200).json(getPublicMetaPayload());
}

export async function handleGeoReverse(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as { lat: number; lng: number };
  const rateKey = requireActorIpHash(req);
  await consumeGeoRateLimit(rateKey);

  const result = await reverseGeocodePoint(query.lat, query.lng);
  res.status(200).json(result);
}

export async function handleGeoSearch(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as { q: string };
  const rateKey = requireActorIpHash(req);
  await consumeGeoRateLimit(rateKey);

  const result = await searchBangladeshPlaces(query.q);
  res.status(200).json(result);
}

export async function handleCreateIncident(req: Request, res: Response): Promise<void> {
  const actorId = requireRequestActorId(req);
  const body = req.body as CreateIncidentInput;

  const result = await createPublicIncident(body, {
    actorId,
    ipHash: requireActorIpHash(req),
    clientIp: extractClientIp(req),
  });

  res.status(201).json(result);
}

export async function handleListIncidents(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListIncidentsQuery;
  const result = await listPublicIncidents(query);
  res.status(200).json(result);
}

export async function handleGetIncident(req: Request, res: Response): Promise<void> {
  const { trackingId } = req.params as { trackingId: string };
  const callerActorId = resolveOptionalActorId(req);
  const result = await getPublicIncidentByTrackingId(trackingId, callerActorId);
  res.status(200).json(result);
}

export async function handleQuickEditIncident(req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  const { trackingId } = req.params as { trackingId: string };
  const body = req.body as QuickEditInput;

  const result = await quickEditIncident(trackingId, body, {
    actorId: resolveOptionalActorId(req),
    ipHash: requireActorIpHash(req),
  });
  res.status(200).json(result);
}

export async function handleVoteIncident(req: Request, res: Response): Promise<void> {
  const actorId = requireRequestActorId(req);
  const { trackingId } = req.params as { trackingId: string };
  const { type } = req.body as { type: VoteType };

  const result = await upsertIncidentVote(
    trackingId,
    actorId,
    type,
    requireActorIpHash(req),
  );
  res.status(200).json(result);
}

export async function handleRemoveVote(req: Request, res: Response): Promise<void> {
  const actorId = requireRequestActorId(req);
  const { trackingId } = req.params as { trackingId: string };

  const result = await removeIncidentVote(
    trackingId,
    actorId,
    requireActorIpHash(req),
  );
  res.status(200).json(result);
}

export async function handleReportIncident(req: Request, res: Response): Promise<void> {
  const actorId = requireRequestActorId(req);
  const { trackingId } = req.params as { trackingId: string };
  const body = req.body as { reason: FlagReason; note?: string };

  const result = await reportIncident(
    trackingId,
    actorId,
    body,
    requireActorIpHash(req),
  );
  res.status(201).json(result);
}

export async function handleListComments(req: Request, res: Response): Promise<void> {
  const { trackingId } = req.params as { trackingId: string };
  const query = req.query as unknown as { limit: number; cursor?: string };
  const callerActorId = resolveOptionalActorId(req);

  const result = await listPublicComments(trackingId, callerActorId, query);
  res.status(200).json(result);
}

export async function handleCreateComment(req: Request, res: Response): Promise<void> {
  const actorId = requireRequestActorId(req);
  const ipHash = requireActorIpHash(req);
  const { trackingId } = req.params as { trackingId: string };
  const body = req.body as CreateCommentInput;

  const result = await createComment(trackingId, body, {
    actorId,
    ipHash,
    clientIp: extractClientIp(req),
  });
  res.status(201).json(result);
}

export async function handleDeleteOwnComment(req: Request, res: Response): Promise<void> {
  const actorId = requireRequestActorId(req);
  const { id } = req.params as { id: string };

  const result = await deleteOwnComment(id, actorId);
  res.status(200).json(result);
}

export async function handleReportComment(req: Request, res: Response): Promise<void> {
  const actorId = requireRequestActorId(req);
  const { id } = req.params as { id: string };
  const body = req.body as { reason: FlagReason; note?: string };

  const result = await reportComment(
    id,
    actorId,
    body,
    requireActorIpHash(req),
  );
  res.status(201).json(result);
}

export async function handleTrackIncident(req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  const body = req.body as { trackingId: string; secret: string };

  const result = await trackIncidentByCredentials(body.trackingId, body.secret, {
    actorId: resolveOptionalActorId(req),
    ipHash: requireActorIpHash(req),
  });
  res.status(200).json(result);
}

export async function handleGetMyQuota(req: Request, res: Response): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  const actorId = requireRequestActorId(req);
  const result = await getMyCommentQuota(actorId);
  res.status(200).json(result);
}

