import { Schema } from 'mongoose';
import { COLLECTIONS, PATTERNS, VOTE_TYPES } from '../constants/index.js';
import type { IVote } from '../types/index.js';
import { BASE_SCHEMA_OPTIONS, getOrCreateModel } from './model-helper.js';

const voteSchema = new Schema<IVote>(
  {
    incidentId: {
      type: Schema.Types.ObjectId,
      ref: 'Incident',
      required: true,
    },
    actorId: {
      type: String,
      required: true,
      match: [PATTERNS.ACTOR_ID_HEX, 'actorId must be a 32-character hex string.'],
    },
    type: {
      type: String,
      required: true,
      enum: VOTE_TYPES,
    },
  },
  {
    ...BASE_SCHEMA_OPTIONS,
    collection: COLLECTIONS.VOTES,
    timestamps: true,
  },
);

// Confirmed PRD indexes (Database.md §7.1 #11-#12).
// Note: PROPOSED index #29 ({ actorId: 1, createdAt: 1 }) is intentionally omitted.
voteSchema.index(
  { incidentId: 1, actorId: 1 },
  { unique: true, name: 'idx_votes_incidentId_actorId_unique' },
);
voteSchema.index(
  { incidentId: 1, type: 1 },
  { name: 'idx_votes_incidentId_type' },
);

export const VoteModel = getOrCreateModel<IVote>('Vote', voteSchema);
export { voteSchema };

