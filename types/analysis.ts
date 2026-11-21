import type { MarketType } from '@prisma/client';

export type { MarketType };

export type DataSource = 'api-football' | 'football-data';

export interface LeagueConfigRecord {
  id?: string;
  leagueName: string;
  leagueCode: string;
  isEnabled: boolean;
  priority: number;
}

export interface Fixture {
  id: string;
  leagueCode: string;
  leagueName: string;
  kickoff: Date;
  homeTeam: string;
  awayTeam: string;
  homeTeamId?: string;
  awayTeamId?: string;
  venueLatitude?: number;
  venueLongitude?: number;
  source: DataSource;
}

export interface TeamStats {
  xgFor?: number;
  xgAgainst?: number;
  goalsFor?: number;
  goalsAgainst?: number;
  form?: string[];
  cornersFor?: number;
  cornersAgainst?: number;
  cardsFor?: number;
  cardsAgainst?: number;
  firstHalfGoalsFor?: number;
  firstHalfGoalsAgainst?: number;
  shotsFor?: number;
  shotsAgainst?: number;
}

export interface H2HRecord {
  matches?: number;
  homeWins?: number;
  draws?: number;
  awayWins?: number;
  bttsRate?: number;
  over25Rate?: number;
  avgGoals?: number;
  firstHalfHomeWins?: number;
  firstHalfDraws?: number;
  firstHalfAwayWins?: number;
}

export interface InjuryRecord {
  home?: number;
  away?: number;
  keyHome?: number;
  keyAway?: number;
}

export interface OddsRecord {
  matchResult?: { home?: number; draw?: number; away?: number };
  btts?: { yes?: number; no?: number };
  overUnder25?: { over?: number; under?: number };
  asianHandicap?: { home?: number; away?: number; line?: number };
  doubleChance?: { homeDraw?: number; homeAway?: number; drawAway?: number };
  correctScore?: Record<string, number>;
  firstHalfResult?: { home?: number; draw?: number; away?: number };
  totalCorners?: { over?: number; under?: number; line?: number };
  totalCards?: { over?: number; under?: number; line?: number };
  playerScorer?: Record<string, number>;
}

export interface WeatherRecord {
  precipitation?: number;
  windSpeed?: number;
  temperature?: number;
  condition?: string;
}

export interface PlayerRecord {
  name: string;
  goals?: number;
  minutes?: number;
  penalties?: number;
  position?: string;
  shots?: number;
}

export interface FixtureEnrichment {
  homeStats?: TeamStats;
  awayStats?: TeamStats;
  h2h?: H2HRecord;
  injuries?: InjuryRecord;
  odds?: OddsRecord;
  weather?: WeatherRecord;
  leagueAvgGoals?: number;
  leagueAvgCorners?: number;
  leagueAvgCards?: number;
  pace?: number;
  motivation?: { home?: number; away?: number };
  schedule?: { homeRestDays?: number; awayRestDays?: number };
  referee?: { cardsPerGame?: number };
  players?: PlayerRecord[];
  errors?: string[];
}

export interface FactorScore {
  name: string;
  score: number;
  weight: number;
}

export interface MarketScore {
  market: MarketType;
  selection: string;
  odds: number;
  confidence: number;
  factors: FactorScore[];
}

export interface AnalysisOutcome {
  fixture: Fixture;
  scores: MarketScore[];
  best: MarketScore;
  topFactors: FactorScore[];
}

export type MarketWeights = Record<MarketType, Record<string, number>>;

export interface AnalysisSettings {
  threshold: number;
  marketWeights: MarketWeights;
  dataSourcePriorities: DataSource[];
}

export interface StoredAnalysisConfig {
  key: string;
  value: unknown;
}
