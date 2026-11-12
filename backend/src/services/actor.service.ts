import { ActorModel } from '../models/index.js';
import type { ActorRestrictionScope } from '../types/index.js';
import { forbiddenError } from '../utils/errors.js';

export async function recordActorActivity(actorId: string) {
  const now = new Date();
  return ActorModel.findOneAndUpdate(
    { actorId },
    {
      $set: { lastSeenAt: now },
      $setOnInsert: {
        actorId,
        firstSeenAt: now,
      },
    },
    {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    },
  ).lean();
}

export async function ensureActorCanPerform(
  actorId: string,
  scope: ActorRestrictionScope,
): Promise<void> {
  const now = new Date();
  const actor = await recordActorActivity(actorId);

  if (
    actor?.restriction &&
    actor.restriction.until > now &&
    actor.restriction.scope.includes(scope)
  ) {
    throw forbiddenError('Your activity is temporarily restricted.');
  }
}

