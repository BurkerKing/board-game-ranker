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

export type AppState = {
  games: Game[]
  ratings: RatingsByUser
  history: ComparisonRecord[]
  currentMatchup?: Matchup
  importedAt?: string
}

export type RankingTab = 'combined' | 'Brian' | 'Sarah'
