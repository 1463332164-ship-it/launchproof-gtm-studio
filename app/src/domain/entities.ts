import type { z } from 'zod';
import type { factSchema, missionSchema, productSchema, projectSchema, quantitySchema, rangeSchema, refSchema, sourceSchema, hypothesisSchema, barrierSchema, insightSchema, messageSchema, claimSchema, weightsSchema, decisionSchema } from './schema';

// Inferred from the runtime contract: field types and validation cannot drift apart.
export type Ref = z.infer<typeof refSchema>;
export type Product = z.infer<typeof productSchema>;
export type Source = z.infer<typeof sourceSchema>;
export type Fact = z.infer<typeof factSchema>;
export type Mission = z.infer<typeof missionSchema>;
export type Quantity = z.infer<typeof quantitySchema>;
export type Range = z.infer<typeof rangeSchema>;
export type Project = z.infer<typeof projectSchema>;
export type Hypothesis = z.infer<typeof hypothesisSchema>;
export type Barrier = z.infer<typeof barrierSchema>;
export type Insight = z.infer<typeof insightSchema>;
export type Message = z.infer<typeof messageSchema>;
export type ClaimItem = z.infer<typeof claimSchema>;
export type Weights = z.infer<typeof weightsSchema>;
export type Decision = z.infer<typeof decisionSchema>;
export type VersionedEntity = Product | Source | Fact | Mission | Hypothesis | Barrier | Insight | Message | Decision;
export type Author = 'self' | 'ai_assisted';
export interface ValidationIssue { path: string; code: string; message: string }
export type ValidationResult =
  | { ok: true; data: Project; warnings: ValidationIssue[] }
  | { ok: false; errors: ValidationIssue[] };
