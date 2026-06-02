export type UserName = 'Brian' | 'Sarah'

export type Game = {
  id: string
  title: string
  bggRating?: number
  ourRating?: number
  playerCounts?: number[]
  bestPlayerCount?: string
  playedCount?: number
  lastPlayed?: string
  thumbnailUrl?: string
  excluded?: boolean
  excludedReason?: string
  createdAt: string
}

export type PlayerRating = {
  elo: number
  comparisons: number
  wins: number
}

export type RatingsByUser = Record<UserName, Record<string, PlayerRating>>

export type ComparisonRecord = {
  id: string
  at: string
  leftGameId: string
  rightGameId: string
  Brian: string
  Sarah: string
}

export type Matchup = {
  leftId: string
  rightId: string
}

export type SessionStatus = 'active' | 'finished'

export type SummaryStats = {
  comparisons: number
  excluded: number
  agreement: number
  mostDivisive: string
  topShared: string
}

export type RankingSnapshotEntry = {
  rank: number
  gameId: string
  title: string
  elo: number
  comparisons: number
}

export type FrozenRankings = {
  combined: RankingSnapshotEntry[]
  Brian: RankingSnapshotEntry[]
  Sarah: RankingSnapshotEntry[]
}

export type RankingSession = {
  sessionId: string
  sessionName: string
  createdAt: string
  startedAt: string
  finishedAt?: string
  status: SessionStatus
  games: Game[]
  ratings: RatingsByUser
  comparisons: ComparisonRecord[]
  currentMatchup?: Matchup
  importedAt: string
  summary?: SummaryStats
  finalRankings?: FrozenRankings
}

export type AppState = {
  sessions: RankingSession[]
  activeSessionId?: string
}

export type RankingTab = 'combined' | 'Brian' | 'Sarah'
