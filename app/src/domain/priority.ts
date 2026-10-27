import type { Barrier, Weights } from './entities';
import { weightsSchema } from './schema';
export const SCORE_KEYS = ['impact','relevance','actionability'] as const;
export type ScoreKey = typeof SCORE_KEYS[number];
export const DEFAULT_WEIGHTS: Weights = { impact: .5, relevance: .3, actionability: .2 };
export function normalizeWeights(input: Weights): Weights {
  const w = weightsSchema.parse(input); const scale = Math.max(...SCORE_KEYS.map(k => w[k]));
  const sum = SCORE_KEYS.reduce((n,k) => n + w[k]/scale,0);
  return Object.fromEntries(SCORE_KEYS.map(k => [k,(w[k]/scale)/sum])) as Weights;
}
export function scoreBarrier(b: Pick<Barrier,'impact'|'relevance'|'actionability'>, weights: Weights) {
  const w = normalizeWeights(weights);
  for (const k of SCORE_KEYS) if (b[k] !== null && (!Number.isInteger(b[k]) || b[k]! < 0 || b[k]! > 4)) throw new Error('评分必须为0–4整数或未知');
  const min = SCORE_KEYS.reduce((n,k) => n + w[k]*(b[k] ?? 0)/4*100,0);
  const max = SCORE_KEYS.reduce((n,k) => n + w[k]*(b[k] ?? 4)/4*100,0);
  return { min, max, point: SCORE_KEYS.every(k => b[k] !== null) ? min : null };
}
export function rankBarriers(barriers: Barrier[], weights: Weights) {
  normalizeWeights(weights);
  const results = barriers.filter(b => !b.archived).map(b => ({ id: b.id, label:b.label,...scoreBarrier(b,weights) }));
  const ranked = results.filter(x => x.point !== null).sort((a,b) => b.point! - a.point! || a.id.localeCompare(b.id,'en'));
  return { results, ranked: ranked.map((x,i) => ({...x, tied: ranked.some((y,j) => i !== j && Math.abs(x.point! - y.point!) <= 1e-9),
    nearTie: ranked.some((y,j) => i !== j && Math.abs(x.point! - y.point!) <= 1 + 1e-9) })),
    unranked: results.filter(x => x.point === null), leaders: ranked.filter(x => Math.abs(x.point! - (ranked[0]?.point ?? 0)) <= 1e-9).map(x => x.id) };
}
export function sensitivity(barriers: Barrier[], raw: Weights) {
  const stable = normalizeWeights(raw); // Scaling all raw weights preserves all six perturbations, avoids overflow.
  const base = rankBarriers(barriers,stable);
  return SCORE_KEYS.flatMap(key => [.8,1.2].map(multiplier => {
    const weights = normalizeWeights({...stable,[key]:stable[key]*multiplier});
    const ranking = rankBarriers(barriers,weights);
    return { key, multiplier, weights, ...ranking, leaderChanged: JSON.stringify(ranking.leaders) !== JSON.stringify(base.leaders) };
  }));
}

