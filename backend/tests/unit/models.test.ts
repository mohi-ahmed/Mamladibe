import { Types } from 'mongoose';
import { describe, expect, it } from 'vitest';
import { COLLECTIONS } from '../../src/constants/index.js';
import {
  AbuseSignalModel,
  ActorModel,
  AdminSessionModel,
  AdminUserModel,
  AuditLogModel,
  CommentModel,
  DailyQuotaModel,
  GeoCacheModel,
  IncidentModel,
  IncidentVersionModel,
  REGISTERED_COLLECTIONS,
  ReportModel,
  SettingModel,
  VoteModel,
} from '../../src/models/index.js';

const VALID_ACTOR_ID = '0123456789abcdef0123456789abcdef';
const VALID_SHA256 = 'a'.repeat(64);
const VALID_OBJECT_ID = new Types.ObjectId();

describe('all 13 Mongoose models', () => {
  it('registers the exact 13 approved collections and no extra ones', () => {
    const registeredNames = REGISTERED_COLLECTIONS.map((c) => c.collectionName);
    expect(registeredNames).toEqual([
      COLLECTIONS.INCIDENTS,
      COLLECTIONS.INCIDENT_VERSIONS,
      COLLECTIONS.COMMENTS,
      COLLECTIONS.VOTES,
      COLLECTIONS.REPORTS,
      COLLECTIONS.DAILY_QUOTAS,
      COLLECTIONS.ACTORS,
      COLLECTIONS.ABUSE_SIGNALS,
      COLLECTIONS.GEO_CACHE,
      COLLECTIONS.ADMIN_USERS,
      COLLECTIONS.ADMIN_SESSIONS,
      COLLECTIONS.AUDIT_LOGS,
      COLLECTIONS.SETTINGS,
    ]);
    expect(registeredNames).toHaveLength(13);
    expect(registeredNames).not.toContain('anonymous_sessions');
    expect(registeredNames).not.toContain('blocks');
    expect(registeredNames).not.toContain('rate_events');
  });

  describe('incidents model', () => {
    it('validates a valid Dhaka public incident and preserves Bangla ZWJ/ZWNJ', () => {
      const banglaTitle = 'ঢাকায় সড়ক\u200Dদুর্ঘটনা ও\u200Cযানজট';
      const doc = new IncidentModel({
        trackingId: 'MD-7K3Q9XTB',
        secretHash: VALID_SHA256,
        title: `  ${banglaTitle}  `,
        description:
          'A bus and a truck collided near the airport intersection causing heavy traffic.',
        category: 'infrastructure',
        incidentAt: new Date('2026-11-10T03:30:00.000Z'),
        location: {
          type: 'Point',
          coordinates: [90.4125, 23.8103],
        },
        roadName: 'Airport Road',
        areaName: 'Uttara',
        district: 'Dhaka',
        safetyTip: '  ',
        actorId: VALID_ACTOR_ID,
        contentHash: VALID_SHA256,
      });

      expect(doc.validateSync()).toBeUndefined();
      expect(doc.status).toBe('published');
      expect(doc.isEdited).toBe(false);
      expect(doc.editCount).toBe(0);
      expect(doc.moderatedEdit).toBe(false);
      expect(doc.source).toBe('public');
      expect(doc.title).toBe(banglaTitle.normalize('NFC'));
      expect(doc.title).toContain('\u200D');
      expect(doc.title).toContain('\u200C');
      expect(doc.safetyTip).toBeUndefined();
      expect(doc.get('updatedAt')).toBeUndefined();
    });

    it('supports team incidents without reporter secretHash, actorId, or contentHash', () => {
      const doc = new IncidentModel({
        trackingId: 'MD-7K3Q9XTC',
        title: 'Planned highway maintenance notice',
        description:
          'Bridge maintenance will close one lane overnight near Gazipur.',
        category: 'infrastructure',
        incidentAt: new Date('2026-11-10T03:30:00.000Z'),
        location: {
          type: 'Point',
          coordinates: [90.4125, 23.8103],
        },
        source: 'team',
      });

      expect(doc.validateSync()).toBeUndefined();
    });

    it('rejects reversed or out-of-Bangladesh coordinates', () => {
      const reversed = new IncidentModel({
        trackingId: 'MD-7K3Q9XTD',
        secretHash: VALID_SHA256,
        title: 'Traffic signal failure',
        description:
          'The signal at the main intersection is not working since morning.',
        category: 'road_accident',
        incidentAt: new Date(),
        location: {
          type: 'Point',
          coordinates: [23.8103, 90.4125], // wrong [lat, lng] order
        },
        actorId: VALID_ACTOR_ID,
        contentHash: VALID_SHA256,
      });

      const error = reversed.validateSync();
      expect(error).toBeDefined();
      expect(error?.errors['location.coordinates']).toBeDefined();
    });

    it('rejects unapproved category slug road_infrastructure and unknown fields under strict mode', () => {
      const invalidCategory = new IncidentModel({
        trackingId: 'MD-7K3Q9XTE',
        secretHash: VALID_SHA256,
        title: 'Broken road divider',
        description:
          'The concrete divider on the main road has collapsed into the lane.',
        category: 'road_infrastructure',
        incidentAt: new Date(),
        location: {
          type: 'Point',
          coordinates: [90.4125, 23.8103],
        },
        actorId: VALID_ACTOR_ID,
        contentHash: VALID_SHA256,
      });

      expect(invalidCategory.validateSync()?.errors.category).toBeDefined();

      expect(
        () =>
          new IncidentModel({
            trackingId: 'MD-7K3Q9XTF',
            secretHash: VALID_SHA256,
            title: 'Traffic jam near bridge',
            description:
              'Heavy congestion on the bridge due to a stalled vehicle.',
            category: 'other',
            incidentAt: new Date(),
            location: {
              type: 'Point',
              coordinates: [90.4125, 23.8103],
            },
            actorId: VALID_ACTOR_ID,
            contentHash: VALID_SHA256,
            unexpectedField: 'should-throw',
          }),
      ).toThrow(/strict/i);
    });

    it('protects secretHash via select:false and toJSON transform', () => {
      expect(IncidentModel.schema.path('secretHash').options.select).toBe(false);

      const doc = new IncidentModel({
        trackingId: 'MD-7K3Q9XTG',
        secretHash: VALID_SHA256,
        title: 'Traffic jam near bridge',
        description:
          'Heavy congestion on the bridge due to a stalled vehicle.',
        category: 'other',
        incidentAt: new Date(),
        location: {
          type: 'Point',
          coordinates: [90.4125, 23.8103],
        },
        actorId: VALID_ACTOR_ID,
        contentHash: VALID_SHA256,
      });

      const serialized = doc.toJSON() as unknown as Record<string, unknown>;
      expect(serialized.secretHash).toBeUndefined();
    });
  });

  describe('incident_versions, comments, votes, reports, and daily_quotas', () => {
    it('validates incident_versions and requires reason for moderator edits', () => {
      const reporterVersion = new IncidentVersionModel({
        incidentId: VALID_OBJECT_ID,
        version: 1,
        title: 'Original road incident title',
        description:
          'Original detailed description of at least twenty characters.',
        editedBy: 'reporter',
      });
      expect(reporterVersion.validateSync()).toBeUndefined();

      const modMissingReason = new IncidentVersionModel({
        incidentId: VALID_OBJECT_ID,
        version: 2,
        title: 'Redacted road incident title',
        description:
          'Updated detailed description of at least twenty characters.',
        editedBy: 'moderator',
      });
      expect(modMissingReason.validateSync()?.errors.reason).toBeDefined();
    });

    it('validates comments, enforces max 5 line breaks, and omits updatedAt', () => {
      const valid = new CommentModel({
        incidentId: VALID_OBJECT_ID,
        actorId: VALID_ACTOR_ID,
        type: 'info',
        body: 'The intersection has cleared now.',
      });
      expect(valid.validateSync()).toBeUndefined();
      expect(valid.status).toBe('published');
      expect(valid.redacted).toBe(false);
      expect(CommentModel.schema.path('updatedAt')).toBeUndefined();

      const tooManyLineBreaks = new CommentModel({
        incidentId: VALID_OBJECT_ID,
        actorId: VALID_ACTOR_ID,
        type: 'experience',
        body: 'a\nb\nc\nd\ne\nf\ng',
      });
      expect(tooManyLineBreaks.validateSync()?.errors.body).toBeDefined();
    });

    it('validates votes, reports, and daily_quotas', () => {
      const vote = new VoteModel({
        incidentId: VALID_OBJECT_ID,
        actorId: VALID_ACTOR_ID,
        type: 'support',
      });
      expect(vote.validateSync()).toBeUndefined();
      expect(VoteModel.schema.path('createdAt')).toBeDefined();
      expect(VoteModel.schema.path('updatedAt')).toBeDefined();

      const report = new ReportModel({
        targetType: 'incident',
        targetId: VALID_OBJECT_ID,
        actorId: VALID_ACTOR_ID,
        reason: 'misleading',
        note: 'Location pin is inaccurate.',
      });
      expect(report.validateSync()).toBeUndefined();
      expect(report.status).toBe('open');

      const quota = new DailyQuotaModel({
        actorId: VALID_ACTOR_ID,
        day: '2026-11-11',
        kind: 'comment',
        count: 3,
        expiresAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
      });
      expect(quota.validateSync()).toBeUndefined();

      const invalidQuota = new DailyQuotaModel({
        actorId: VALID_ACTOR_ID,
        day: '2026-11-11',
        kind: 'comment',
        count: 6,
        expiresAt: new Date(),
      });
      expect(invalidQuota.validateSync()?.errors.count).toBeDefined();
    });
  });

  describe('actors, abuse_signals, geo_cache, admin_users, admin_sessions, audit_logs, and settings', () => {
    it('validates actors and restriction subdocument', () => {
      const actor = new ActorModel({
        actorId: VALID_ACTOR_ID,
        restriction: {
          scope: ['comment', 'vote'],
          until: new Date(Date.now() + 86400_000),
          reason: 'Repeated spam comments',
          setBy: VALID_OBJECT_ID,
        },
      });
      expect(actor.validateSync()).toBeUndefined();

      const emptyScope = new ActorModel({
        actorId: VALID_ACTOR_ID,
        restriction: {
          scope: [],
          until: new Date(Date.now() + 86400_000),
          reason: 'Spam',
          setBy: VALID_OBJECT_ID,
        },
      });
      expect(
        emptyScope.validateSync()?.errors['restriction.scope'],
      ).toBeDefined();
    });

    it('validates abuse_signals and geo_cache', () => {
      const signal = new AbuseSignalModel({
        ipHash: VALID_ACTOR_ID,
        type: 'rate_limit_hit',
      });
      expect(signal.validateSync()).toBeUndefined();

      const geo = new GeoCacheModel({
        key: 'rev:23.8103,90.4125',
        result: { district: 'Dhaka' },
      });
      expect(geo.validateSync()).toBeUndefined();
    });

    it('protects admin_users passwordHash & totpSecretEnc and restricts roles to moderator/super', () => {
      expect(AdminUserModel.schema.path('passwordHash').options.select).toBe(
        false,
      );
      expect(AdminUserModel.schema.path('totpSecretEnc').options.select).toBe(
        false,
      );

      const admin = new AdminUserModel({
        email: 'MOD@Example.ORG ',
        passwordHash: '$argon2id$v=19$m=65536,t=3,p=4$salt$hash',
        role: 'moderator',
        totpSecretEnc: 'v1:enc-secret',
      });
      expect(admin.validateSync()).toBeUndefined();
      expect(admin.email).toBe('mod@example.org');
      expect(admin.totpEnabled).toBe(false);
      expect(admin.active).toBe(true);

      const json = admin.toJSON() as unknown as Record<string, unknown>;
      expect(json.passwordHash).toBeUndefined();
      expect(json.totpSecretEnc).toBeUndefined();

      const invalidRole = new AdminUserModel({
        email: 'admin@example.org',
        passwordHash: 'hash',
        role: 'admin',
        totpSecretEnc: 'enc',
      });
      expect(invalidRole.validateSync()?.errors.role).toBeDefined();
    });

    it('protects admin_sessions sessionHash and defaults stage to pending_2fa', () => {
      expect(AdminSessionModel.schema.path('sessionHash').options.select).toBe(
        false,
      );

      const session = new AdminSessionModel({
        adminId: VALID_OBJECT_ID,
        sessionHash: VALID_SHA256,
        csrfToken: 'csrf-token-value',
        expiresAt: new Date(Date.now() + 8 * 3600_000),
      });
      expect(session.validateSync()).toBeUndefined();
      expect(session.stage).toBe('pending_2fa');

      const json = session.toJSON() as unknown as Record<string, unknown>;
      expect(json.sessionHash).toBeUndefined();
    });

    it('enforces append-only behavior on audit_logs', async () => {
      const entry = new AuditLogModel({
        adminId: VALID_OBJECT_ID,
        action: 'incident.hide',
        targetType: 'incident',
        targetId: VALID_OBJECT_ID,
        reason: 'Personal data present',
        before: { status: 'published' },
        after: { status: 'hidden' },
      });
      expect(entry.validateSync()).toBeUndefined();

      await expect(
        AuditLogModel.updateOne({ _id: VALID_OBJECT_ID }, { reason: 'tamper' }),
      ).rejects.toThrow(/append-only/i);
      await expect(
        AuditLogModel.deleteOne({ _id: VALID_OBJECT_ID }),
      ).rejects.toThrow(/append-only/i);
      await expect(
        AuditLogModel.findOneAndUpdate(
          { _id: VALID_OBJECT_ID },
          { reason: 'tamper' },
        ),
      ).rejects.toThrow(/append-only/i);
      await expect(
        AuditLogModel.findOneAndDelete({ _id: VALID_OBJECT_ID }),
      ).rejects.toThrow(/append-only/i);
      await expect(AuditLogModel.deleteMany({})).rejects.toThrow(/append-only/i);
    });

    it('validates settings model with updatedAt only', () => {
      const setting = new SettingModel({
        key: 'freeze_posting',
        value: false,
        updatedBy: VALID_OBJECT_ID,
      });
      expect(setting.validateSync()).toBeUndefined();
      expect(SettingModel.schema.path('createdAt')).toBeUndefined();
      expect(SettingModel.schema.path('updatedAt')).toBeDefined();
    });
  });
});

