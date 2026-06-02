import type {
  ComparisonRecord,
  FrozenRankings,
  Game,
  Matchup,
  PlayerRating,
  RankingSession,
  RatingsByUser,
  UserName,
} from './types'

const STARTING_ELO = 1000
const K_FACTOR = 32
const USERS: UserName[] = ['Brian', 'Sarah']

export function createInitialRatings(games: Game[]): RatingsByUser {
  return USERS.reduce((ratings, user) => {
    ratings[user] = {}
    games.forEach((game) => {
      ratings[user][game.id] = { elo: STARTING_ELO, comparisons: 0, wins: 0 }
    })
    return ratings
  }, {} as RatingsByUser)
}

export function ensureRatings(session: RankingSession): RatingsByUser {
  const ratings = structuredClone(session.ratings || createInitialRatings([]))
  USERS.forEach((user) => {
    ratings[user] ||= {}
    session.games.forEach((game) => {
      ratings[user][game.id] ||= { elo: STARTING_ELO, comparisons: 0, wins: 0 }
    })
  })
  return ratings
}

export function applyChoice(ratings: RatingsByUser, user: UserName, winnerId: string, loserId: string): RatingsByUser {
  const next = structuredClone(ratings)
  const winner = next[user][winnerId] || { elo: STARTING_ELO, comparisons: 0, wins: 0 }
  const loser = next[user][loserId] || { elo: STARTING_ELO, comparisons: 0, wins: 0 }
  const expectedWinner = 1 / (1 + 10 ** ((loser.elo - winner.elo) / 400))
  const expectedLoser = 1 / (1 + 10 ** ((winner.elo - loser.elo) / 400))

  next[user][winnerId] = {
    elo: Math.round(winner.elo + K_FACTOR * (1 - expectedWinner)),
    comparisons: winner.comparisons + 1,
    wins: winner.wins + 1,
  }
  next[user][loserId] = {
    elo: Math.round(loser.elo + K_FACTOR * (0 - expectedLoser)),
    comparisons: loser.comparisons + 1,
    wins: loser.wins,
  }
  return next
}

export function applyComparison(session: RankingSession, leftId: string, rightId: string, choices: Record<UserName, string>): RankingSession {
  if (session.status === 'finished') return session
  let ratings = ensureRatings(session)
  USERS.forEach((user) => {
    const winnerId = choices[user]
    const loserId = winnerId === leftId ? rightId : leftId
    ratings = applyChoice(ratings, user, winnerId, loserId)
  })

  const record: ComparisonRecord = {
    id: crypto.randomUUID(),
    at: new Date().toISOString(),
    leftGameId: leftId,
    rightGameId: rightId,
    Brian: choices.Brian,
    Sarah: choices.Sarah,
  }

  const nextSession = { ...session, ratings, comparisons: [...session.comparisons, record] }
  return { ...nextSession, currentMatchup: chooseNextMatchup(nextSession) }
}

export function excludeGame(session: RankingSession, gameId: string, reason: string): RankingSession {
  if (session.status === 'finished') return session
  const games = session.games.map((game) =>
    game.id === gameId ? { ...game, excluded: true, excludedReason: reason } : game,
  )
  const nextSession = { ...session, games }
  return { ...nextSession, currentMatchup: chooseNextMatchup(nextSession) }
}

function pairKey(a: string, b: string) {
  return [a, b].sort().join('::')
}

function averageComparisonCount(ratings: RatingsByUser, id: string) {
  return (ratings.Brian[id]?.comparisons || 0) / 2 + (ratings.Sarah[id]?.comparisons || 0) / 2
}

function combinedElo(ratings: RatingsByUser, id: string) {
  return ((ratings.Brian[id]?.elo || STARTING_ELO) + (ratings.Sarah[id]?.elo || STARTING_ELO)) / 2
}

function disagreement(ratings: RatingsByUser, id: string) {
  return Math.abs((ratings.Brian[id]?.elo || STARTING_ELO) - (ratings.Sarah[id]?.elo || STARTING_ELO))
}

export function chooseNextMatchup(session: RankingSession): Matchup | undefined {
  if (session.status === 'finished') return undefined
  const activeGames = session.games.filter((game) => !game.excluded)
  if (activeGames.length < 2) return undefined

  const ratings = ensureRatings(session)
  const totalComparisons = session.comparisons.length
  const seenPairs = session.comparisons.reduce<Record<string, number>>((pairs, item) => {
    const key = pairKey(item.leftGameId, item.rightGameId)
    pairs[key] = (pairs[key] || 0) + 1
    return pairs
  }, {})

  let best: { pair: Matchup; score: number } | undefined

  for (let i = 0; i < activeGames.length; i += 1) {
    for (let j = i + 1; j < activeGames.length; j += 1) {
      const left = activeGames[i]
      const right = activeGames[j]
      const key = pairKey(left.id, right.id)
      const repeats = seenPairs[key] || 0
      const leftCount = averageComparisonCount(ratings, left.id)
      const rightCount = averageComparisonCount(ratings, right.id)
      const underSampled = 1 / (1 + leftCount + rightCount)
      const eloGap = Math.abs(combinedElo(ratings, left.id) - combinedElo(ratings, right.id))
      const closeness = 1 / (1 + eloGap / 80)
      const uncertainty = 1 / (1 + Math.min(leftCount, rightCount))
      const divisive = (disagreement(ratings, left.id) + disagreement(ratings, right.id)) / 500
      const repeatPenalty = repeats === 0 ? 0 : repeats > 1 ? 3 : 0.9
      const sessionProgress = Math.min(totalComparisons / Math.max(activeGames.length * 4, 1), 1)
      const earlyWeight = 1 - sessionProgress
      const lateWeight = sessionProgress
      const noise = Math.random() * 0.04
      const score =
        earlyWeight * underSampled * 3.8 +
        lateWeight * closeness * 2.8 +
        uncertainty * 1.8 +
        lateWeight * divisive +
        noise -
        repeatPenalty

      if (!best || score > best.score) {
        best = { pair: { leftId: left.id, rightId: right.id }, score }
      }
    }
  }

  return best?.pair
}

export function rankedGames(session: RankingSession, tab: 'combined' | UserName) {
  const ratings = ensureRatings(session)
  return session.games
    .filter((game) => !game.excluded)
    .map((game) => {
      const brian = ratings.Brian[game.id]
      const sarah = ratings.Sarah[game.id]
      const rating: PlayerRating =
        tab === 'combined'
          ? {
              elo: Math.round((brian.elo + sarah.elo) / 2),
              comparisons: Math.round((brian.comparisons + sarah.comparisons) / 2),
              wins: brian.wins + sarah.wins,
            }
          : ratings[tab][game.id]
      return { game, rating, brian, sarah }
    })
    .sort((a, b) => b.rating.elo - a.rating.elo)
}

export function summaryStats(session: RankingSession) {
  const combined = rankedGames(session, 'combined')
  const active = session.games.filter((game) => !game.excluded)
  const ratings = ensureRatings(session)
  const agreements = session.comparisons.filter((record) => record.Brian === record.Sarah).length
  const divisive = active
    .map((game) => ({ game, gap: disagreement(ratings, game.id) }))
    .sort((a, b) => b.gap - a.gap)[0]

  return {
    comparisons: session.comparisons.length,
    excluded: session.games.filter((game) => game.excluded).length,
    agreement: session.comparisons.length ? Math.round((agreements / session.comparisons.length) * 100) : 0,
    mostDivisive: divisive?.game.title || 'Not enough data yet',
    topShared: combined[0]?.game.title || 'Not enough data yet',
  }
}

export function freezeRankings(session: RankingSession): FrozenRankings {
  return {
    combined: rankedGames(session, 'combined').map(({ game, rating }, index) => ({
      rank: index + 1,
      gameId: game.id,
      title: game.title,
      elo: rating.elo,
      comparisons: rating.comparisons,
    })),
    Brian: rankedGames(session, 'Brian').map(({ game, rating }, index) => ({
      rank: index + 1,
      gameId: game.id,
      title: game.title,
      elo: rating.elo,
      comparisons: rating.comparisons,
    })),
    Sarah: rankedGames(session, 'Sarah').map(({ game, rating }, index) => ({
      rank: index + 1,
      gameId: game.id,
      title: game.title,
      elo: rating.elo,
      comparisons: rating.comparisons,
    })),
  }
}
