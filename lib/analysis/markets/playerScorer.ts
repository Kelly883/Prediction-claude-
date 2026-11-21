import type { MarketScore, PlayerRecord } from '@/types/analysis';
import { clamp, confidenceFromPropensity, evidenceScore, normalize, weightedScore } from '../utils/confidence';
import { goalRateScore, playerPositionScore } from '../utils/normalization';
import { buildFactors, oddsOrDefault, valueOr } from './shared';
import type { MarketContext } from './shared';

function playerFactors(player: PlayerRecord, context: MarketContext) {
  const { enrichment, weights } = context;
  const minutes = Math.max(0, valueOr(player.minutes, 0));
  const goals = Math.max(0, valueOr(player.goals, 0));
  const opponentConceded = valueOr(enrichment.awayStats?.goalsAgainst, 1.3);
  return buildFactors(weights, {
    form: normalize(clamp(45 + (goals / Math.max(minutes / 90, 1)) * 30)),
    position: playerPositionScore(player.position),
    penalties: valueOr(player.penalties, 0) > 0 ? 85 : 45,
    opponentDefense: goalRateScore(opponentConceded, 1.3),
    minutes: normalize(clamp(minutes / 30)),
    homeXgVsAwayXg: 50,
    h2h: 50,
    formScore: normalize(clamp(45 + goals * 8)),
  });
}

export function scorePlayerScorer(context: MarketContext): MarketScore {
  const { enrichment, weights } = context;
  const players = enrichment.players ?? [];
  if (players.length === 0) {
    return {
      market: 'PLAYER_SCORER',
      selection: 'Unavailable',
      odds: 1.91,
      confidence: 50,
      factors: buildFactors(weights, {}),
    };
  }
  let bestPlayer = players[0];
  let bestScore = -1;
  let bestFactors = playerFactors(bestPlayer, context);
  for (const player of players) {
    const factors = playerFactors(player, context);
    const score = weightedScore(factors);
    if (score > bestScore) {
      bestScore = score;
      bestPlayer = player;
      bestFactors = factors;
    }
  }
  const evidence = evidenceScore([
    bestPlayer.goals,
    bestPlayer.minutes,
    bestPlayer.penalties,
    bestPlayer.position ? 1 : undefined,
    enrichment.awayStats?.goalsAgainst,
  ]);
  return {
    market: 'PLAYER_SCORER',
    selection: bestPlayer.name,
    odds: oddsOrDefault(enrichment.odds?.playerScorer?.[bestPlayer.name]),
    confidence: confidenceFromPropensity(bestScore, evidence),
    factors: bestFactors,
  };
}
