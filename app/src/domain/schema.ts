import { z } from 'zod';

// LP02 extends the envelope; the immutable LP01 seed remains readable.
export const SCHEMA_VERSION = '1.0.0' as const;
export const PRODUCT_IDS = ['P-SB-C3-T1-US', 'P-AQ-E1-ROD-US'] as const;
export const SCOPE_IDS = [...PRODUCT_IDS, 'SB-CURTAIN3-FAMILY', 'AQ-E1-FAMILY'] as const;
const text = z.string().trim().min(1).max(5000);
const identifier = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/);
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(value => {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, '必须是真实日历日期');
const timestamp = z.iso.datetime({ offset: true });
// Prior research retained day precision. Never invent a time for a historical check.
const evidenceDate = z.union([timestamp, dateOnly]);
const httpUrl = text.refine(value => {
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password; }
  catch { return false; }
}, '来源必须为不含登录凭据的HTTP(S)链接');
export const refSchema = z.strictObject({ id: identifier, revision });
const base = {
  id: identifier, revision, createdAt: timestamp, updatedAt: timestamp,
  createdBy: z.enum(['self', 'ai_assisted', 'imported']), archived: z.boolean(),
};
export const quantitySchema = z.strictObject({
  value: z.number().finite().nullable(), unit: text,
  origin: z.enum(['official', 'observed', 'simulated', 'design_assumption', 'derived']),
  missingReason: text.nullable(), sourceRefs: z.array(refSchema), assumptionId: identifier.nullable(),
});
export const rangeSchema = z.strictObject({
  min: z.number().finite(), max: z.number().finite(), unit: text,
  inclusiveMin: z.boolean(), inclusiveMax: z.boolean(),
});
export const productSchema = z.strictObject({
  ...base, brand: text, modelName: text, variant: text, market: z.literal('US'),
  manufacturerSku: text.nullable(), scopeNotes: text, sourceRefs: z.array(refSchema).min(1),
});
export const sourceSchema = z.strictObject({
  ...base, title: text, publisher: text, url: httpUrl,
  sourceType: z.enum(['official_product', 'official_support', 'official_announcement', 'official_job', 'repository', 'user_research', 'third_party']),
  accessedAt: evidenceDate, publishedAt: evidenceDate.nullable(), pageUpdatedAt: evidenceDate.nullable(),
  accessStatus: z.enum(['body_read', 'index_only', 'inherited_unchecked', 'unavailable']),
  locator: text, summary: text, shortQuote: text.nullable(),
  market: z.enum(['US', 'GLOBAL', 'UNKNOWN']), productScope: z.array(z.enum(SCOPE_IDS)).min(1),
  reusePolicy: z.enum(['summary_link_only', 'permission_recorded', 'unknown']),
  limitation: text, checkedBy: text, reviewIntervalDays: z.number().int().positive().nullable(),
  provenance: z.strictObject({
    inheritedProject: text, path: text, commitSha: z.string().regex(/^[0-9a-f]{40}$/).nullable(),
    blobSha: z.string().regex(/^[0-9a-f]{40}$/).nullable(), originalAccessDate: dateOnly,
  }).nullable(),
});
export const factSchema = z.strictObject({
  ...base, statementZh: text, statementEn: text.nullable(), subjectRef: refSchema,
  // The target product is not the source's model scope. F005–F007 must retain that distinction.
  claimScope: z.enum(SCOPE_IDS), predicate: text,
  value: z.union([quantitySchema, rangeSchema, z.boolean(), text, z.null()]),
  missingReason: text.nullable(), conditions: z.array(text).min(1),
  evidenceLinks: z.array(z.strictObject({
    sourceRef: refSchema, locator: text,
    relation: z.enum(['supports', 'contradicts', 'context']), applicabilityNote: text,
  })),
  supportStatus: z.enum(['supported', 'partial', 'contested', 'unsupported']),
  applicability: z.enum(['in_scope', 'out_of_scope', 'unresolved']),
  freshness: z.enum(['current', 'stale', 'unknown']),
  conflictGroupId: identifier.nullable(), supersedesRef: refSchema.nullable(),
  reviewNote: text, reviewedAt: evidenceDate.nullable(),
  assessmentDate: dateOnly.optional(),
});
export const missionSchema = z.strictObject({
  ...base, question: text.max(500), market: z.literal('US'), currency: z.literal('USD'),
  timeZone: z.literal('America/New_York'), asOfDate: dateOnly,
  focalProductRef: refSchema, competitorRefs: z.array(refSchema).length(1),
  decisionDeadline: dateOnly.nullable(), successCriteria: z.array(text).min(1),
  exclusions: z.array(text).min(1), state: z.enum(['draft', 'active', 'archived']),
});
const notImplemented = z.array(z.never()).max(0, '当前里程碑尚未支持此模块数据');
export const hypothesisSchema = z.strictObject({
  ...base, statement: text, segment: text, context: text, basisRefs: z.array(refSchema), basisNote: text,
  falsificationCriterion: text,
  validationPlan: z.strictObject({ method: text, recruitmentCriteria: text, task: text, measure: text, decisionRule: text, plannedSampleSize: z.number().int().min(1).max(1000) }),
  researchStatus: z.enum(['untested', 'in_progress', 'supported_in_sample', 'refuted', 'inconclusive']),
  actualSampleSize: z.number().int().nonnegative(), observationRefs: z.array(refSchema), owner: text, nextReviewDate: dateOnly.nullable(),
});
export const weightsSchema = z.strictObject({ impact: z.number().finite().nonnegative(), relevance: z.number().finite().nonnegative(), actionability: z.number().finite().nonnegative() })
  .refine(w => Math.max(w.impact, w.relevance, w.actionability) > 0, '权重不能全部为0');
const score = z.number().int().min(0).max(4).nullable();
export const barrierSchema = z.strictObject({
  ...base, hypothesisRef: refSchema, label: text, impact: score, relevance: score, actionability: score,
  scoreRationale: z.strictObject({ impact: z.string().max(5000), relevance: z.string().max(5000), actionability: z.string().max(5000) }),
  weights: weightsSchema, evidenceNote: text,
});
export const insightSchema = z.strictObject({
  ...base, statementZh: text, statementEn: text.nullable(), premiseRefs: z.array(refSchema).min(1), reasoning: text,
  counterEvidenceRefs: z.array(refSchema), limitation: text, reviewState: z.enum(['draft','reviewed','needs_review']),
});
export const DIMENSION_IDS = ['diameter','structure','ecosystem','installation','cost','availability'] as const;
export const claimSchema = z.strictObject({
  id: identifier, kind: z.enum(['fact','inference','hypothesis']), textZh: text, textEn: text.nullable(),
  basisRefs: z.array(refSchema), qualifierZh: text.nullable(), qualifierEn: text.nullable(),
  comparisonScope: z.strictObject({ dimension: z.enum(DIMENSION_IDS), productRefs: z.array(refSchema).length(2), conditions: text }).nullable(),
  humanMeaningReview: z.boolean(),
});
export const messageSchema = z.strictObject({
  ...base, missionRef: refSchema, segmentHypothesisRef: refSchema, barrierRefs: z.array(refSchema),
  headlineZh: text, headlineEn: text.nullable(), valuePropositionZh: text, valuePropositionEn: text.nullable(),
  claimItems: z.array(claimSchema).min(1).max(20), callToAction: text,
  reviewState: z.enum(['draft','blocked','ready_with_limits','needs_review']), reviewerNote: z.string().max(5000),
  inputFingerprint: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
  humanReview: z.strictObject({ authorType: z.enum(['self','ai_assisted']), reviewedAt: timestamp, bilingualConfirmed: z.boolean(), warningsConfirmed: z.boolean(), imported: z.boolean() }).nullable(),
});
export const decisionSchema = z.strictObject({
  ...base, missionRef: refSchema, question: text,
  options: z.array(z.strictObject({id:identifier,summary:text,kind:z.enum(['message','defer']),messageRefs:z.array(refSchema),scenarioRefs:z.array(z.never()).max(0)})).min(1).max(10),
  selectedOptionId: identifier.nullable(), purpose:z.enum(['research_only','external_message']),
  rationale:z.string().max(5000), tradeoffs:z.array(text), supportingRefs:z.array(refSchema), counterRefs:z.array(refSchema), counterSearchNote:z.string().max(5000),
  unresolvedGaps:z.array(text), revisitTriggers:z.array(text), owner:z.string().max(500), decidedAt:timestamp.nullable(),
  nextSteps:z.array(z.strictObject({action:text,owner:text,criterion:text,dueDate:dateOnly.nullable()})),
  state:z.enum(['draft','recorded','needs_review','superseded']), inputFingerprint:z.string().regex(/^[a-f0-9]{64}$/).nullable(), rulesVersion:text,
  previousDecisionRef:refSchema.nullable(),changeReason:z.string().max(5000).nullable(),
  personalReview:z.strictObject({authorType:z.literal('self'),confirmedAt:timestamp,note:text,imported:z.boolean()}).nullable(),
  english:z.record(z.string().regex(/^[A-Za-z0-9@._-]+$/).max(200),text).default({}),
});
export const changeEventSchema = z.strictObject({
  id: identifier, entityRefBefore: refSchema.nullable(), entityRefAfter: refSchema,
  changedFields: z.array(text).min(1), reason: text,
  authorType: z.enum(['self', 'ai_assisted']), occurredAt: timestamp,
  affectedRefs: z.array(refSchema),
});
export const meaningReviewSchema = z.strictObject({
  factRef: refSchema, missionRef: refSchema, sourceRefs: z.array(refSchema),
  note: text, occurredAt: timestamp, authorType: z.enum(['self', 'ai_assisted']),
  imported: z.boolean().default(false),
});
export const projectSchema = z.strictObject({
  schemaVersion: z.enum([SCHEMA_VERSION, '1.1.0', '1.2.0', '1.3.0']), projectId: identifier, projectRevision: revision,
  mission: missionSchema, products: z.array(productSchema).min(2).max(1000),
  missionHistory: z.array(missionSchema).max(1000).default([]),
  meaningReviews: z.array(meaningReviewSchema).max(1000).default([]),
  sources: z.array(sourceSchema).max(1000), facts: z.array(factSchema).max(1000),
  insights: z.array(insightSchema).max(1000), hypotheses: z.array(hypothesisSchema).max(1000), barriers: z.array(barrierSchema).max(1000),
  messages: z.array(messageSchema).max(1000), decisions: z.array(decisionSchema).max(1000), scenarios: notImplemented,
  changeEvents: z.array(changeEventSchema).max(1000),
});
