import { chooseNextMatchup, createInitialRatings, ensureRatings, freezeRankings, summaryStats } from './ranking'
import type { AppState, Game, RankingSession } from './types'

const STORAGE_KEY = 'board-game-ranker-state-v2'
const LEGACY_STORAGE_KEY = 'board-game-ranker-state-v1'

function defaultSessionName(index: number) {
  return `Session ${index}`
}

export function createSession(games: Game[], sessionName: string, existingCount = 0): RankingSession {
  const now = new Date().toISOString()
  const session: RankingSession = {
    sessionId: crypto.randomUUID(),
    sessionName: sessionName.trim() || defaultSessionName(existingCount + 1),
    createdAt: now,
    startedAt: now,
    status: 'active',
    games,
    ratings: createInitialRatings(games),
    comparisons: [],
    importedAt: now,
  }
  return { ...session, currentMatchup: chooseNextMatchup(session) }
}

export function createState(session?: RankingSession): AppState {
  return session ? { sessions: [session], activeSessionId: session.sessionId } : { sessions: [] }
}

function hydrateSession(session: RankingSession): RankingSession {
  const hydrated = {
    ...session,
    comparisons: session.comparisons || [],
    ratings: ensureRatings(session),
  }
  if (hydrated.status === 'finished') {
    return {
      ...hydrated,
      currentMatchup: undefined,
      summary: hydrated.summary || summaryStats(hydrated),
      finalRankings: hydrated.finalRankings || freezeRankings(hydrated),
    }
  }
  return { ...hydrated, currentMatchup: hydrated.currentMatchup || chooseNextMatchup(hydrated) }
}

function migrateLegacyState(raw: unknown): AppState {
  const legacy = raw as {
    games?: Game[]
    ratings?: RankingSession['ratings']
    history?: RankingSession['comparisons']
    currentMatchup?: RankingSession['currentMatchup']
    importedAt?: string
  }
  if (!legacy.games?.length) return createState()

  const now = new Date().toISOString()
  const session: RankingSession = {
    sessionId: crypto.randomUUID(),
    sessionName: 'Imported previous progress',
    createdAt: legacy.importedAt || now,
    startedAt: legacy.importedAt || now,
    status: 'active',
    games: legacy.games,
    ratings: legacy.ratings || createInitialRatings(legacy.games),
    comparisons: legacy.history || [],
    currentMatchup: legacy.currentMatchup,
    importedAt: legacy.importedAt || now,
  }
  const hydrated = hydrateSession(session)
  return { sessions: [hydrated], activeSessionId: hydrated.sessionId }
}

export function loadState(): AppState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      const state = JSON.parse(saved) as AppState
      const sessions = (state.sessions || []).map(hydrateSession)
      const activeSession = sessions.find((session) => session.sessionId === state.activeSessionId && session.status === 'active')
      return { sessions, activeSessionId: activeSession?.sessionId }
    }

    const legacySaved = localStorage.getItem(LEGACY_STORAGE_KEY)
    if (legacySaved) {
      const migrated = migrateLegacyState(JSON.parse(legacySaved))
      saveState(migrated)
      return migrated
    }

    return createState()
  } catch {
    return createState()
  }
}

export function saveState(state: AppState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function resetState() {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(LEGACY_STORAGE_KEY)
}
