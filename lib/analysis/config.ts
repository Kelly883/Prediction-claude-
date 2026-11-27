import { z } from 'zod';
import defaults from './defaults.json';
import type { AnalysisSettings, DataSource, MarketType, MarketWeights, StoredAnalysisConfig } from '@/types/analysis';

export const MARKET_ORDER: MarketType[] = [
  'MATCH_RESULT',
  'BTTS',
  'OVER_UNDER_2_5',
  'ASIAN_HANDICAP',
  'DOUBLE_CHANCE',
  'CORRECT_SCORE',
  'FIRST_HALF_RESULT',
  'TOTAL_CORNERS',
  'TOTAL_CARDS',
  'PLAYER_SCORER',
];

export const LEAGUES = defaults.leagues as ReadonlyArray<{ leagueCode: string; leagueName: string }>;
export const DEFAULT_MARKET_WEIGHTS = defaults.marketWeights as unknown as MarketWeights;

export const DEFAULT_ANALYSIS_SETTINGS: AnalysisSettings = {
  threshold: defaults.threshold,
  marketWeights: DEFAULT_MARKET_WEIGHTS,
  dataSourcePriorities: defaults.dataSourcePriorities as DataSource[],
};

const DataSourceSchema = z.enum(['api-football', 'football-data']);
const MarketWeightsSchema = z.record(
  z.string(),
  z.record(z.string(), z.number().min(0).max(1)),
);

export const CONFIG_KEYS = ['confidence_threshold', 'market_weights', 'data_source_priorities'] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

export function isConfigKey(value: string): value is ConfigKey {
  return (CONFIG_KEYS as readonly string[]).includes(value);
}

export function validateConfigUpdate(key: string, value: unknown): unknown {
  if (!isConfigKey(key)) {
    throw new Error(`Unsupported config key: ${key}`);
  }
  if (key === 'confidence_threshold') {
    return z.number().int().min(50).max(99).parse(value);
  }
  if (key === 'data_source_priorities') {
    const priorities = z.array(DataSourceSchema).min(1).parse(value);
    if (new Set(priorities).size !== priorities.length) {
      throw new Error('data_source_priorities must not contain duplicates');
    }
    return priorities;
  }
  const weights = MarketWeightsSchema.parse(value);
  for (const market of MARKET_ORDER) {
    const marketWeights = weights[market];
    if (!marketWeights || Object.keys(marketWeights).length === 0) {
      throw new Error(`market_weights.${market} must define at least one factor`);
    }
    const total = Object.values(marketWeights).reduce((sum, weight) => sum + weight, 0);
    if (total <= 0) {
      throw new Error(`market_weights.${market} must have a positive total`);
    }
    if (Math.abs(total - 1.0) > 0.001) {
      throw new Error(`market_weights.${market} must sum to 1.0 (got ${total.toFixed(4)})`);
    }
  }
  return weights;
}

export function parseStoredConfigs(configs: StoredAnalysisConfig[]): AnalysisSettings {
  const byKey = new Map(configs.map((config) => [config.key, config.value]));
  const threshold = z.number().int().min(50).max(99).catch(DEFAULT_ANALYSIS_SETTINGS.threshold).parse(byKey.get('confidence_threshold'));
  const priorities = z.array(DataSourceSchema).catch(DEFAULT_ANALYSIS_SETTINGS.dataSourcePriorities).parse(byKey.get('data_source_priorities'));
  const weightsResult = MarketWeightsSchema.safeParse(byKey.get('market_weights'));

  let marketWeights = DEFAULT_ANALYSIS_SETTINGS.marketWeights;
  if (weightsResult.success) {
    const candidate = weightsResult.data as MarketWeights;
    const complete = MARKET_ORDER.every((market) => candidate[market] && Object.keys(candidate[market]).length > 0);
    if (complete) marketWeights = candidate;
  }

  return { threshold, marketWeights, dataSourcePriorities: priorities as DataSource[] };
}

export function configValueForSeed(key: ConfigKey): unknown {
  if (key === 'confidence_threshold') return DEFAULT_ANALYSIS_SETTINGS.threshold;
  if (key === 'market_weights') return DEFAULT_ANALYSIS_SETTINGS.marketWeights;
  return DEFAULT_ANALYSIS_SETTINGS.dataSourcePriorities;
}

export function configDescriptionForSeed(key: ConfigKey): string {
  // Deliberately "model score", not "confidence percentage": the threshold gates
  // the heuristic model score, which is not a calibrated win probability (audit §E).
  if (key === 'confidence_threshold') return 'Minimum model score (0-100) for a pick to be generated';
  if (key === 'market_weights') return 'Default factor weights for the ten analysis markets';
  return 'Preferred order of football data providers';
}
