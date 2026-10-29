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
  // Saved pairs predate the fairness rules; reselect without changing completed progress.
  return { ...hydrated, currentMatchup: chooseNextMatchup(hydrated) }
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

export class StorageRecoveryError extends Error {}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function requireValid(condition: unknown, message: string): asserts condition {
  if (!condition) throw new StorageRecoveryError(message)
}
const text = (value: unknown) => typeof value === 'string'
const date = (value: unknown) => text(value) && Number.isFinite(Date.parse(value as string))
const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value)
const count = (value: unknown) => finite(value) && Number.isInteger(value) && (value as number) >= 0

function validateGames(value: unknown): asserts value is Game[] {
  requireValid(Array.isArray(value), 'The game list is invalid.')
  const ids = new Set<string>()
  for (const game of value) {
    requireValid(object(game) && text(game.id) && game.id.length > 0 && text(game.title) && date(game.createdAt), 'A saved game is invalid.')
    requireValid(!ids.has(game.id as string), 'Duplicate game IDs were found.')
    ids.add(game.id as string)
    for (const field of ['excluded']) requireValid(game[field] === undefined || typeof game[field] === 'boolean', 'A game exclusion is invalid.')
    for (const field of ['excludedReason', 'thumbnailUrl', 'bestPlayerCount', 'lastPlayed']) requireValid(game[field] === undefined || text(game[field]), 'Game metadata is invalid.')
    for (const field of ['bggRating', 'ourRating', 'playedCount']) requireValid(game[field] === undefined || finite(game[field]), 'Game numbers are invalid.')
    requireValid(game.playerCounts === undefined || (Array.isArray(game.playerCounts) && game.playerCounts.every(count)), 'Player counts are invalid.')
  }
}
function validateProgress(value: Record<string, unknown>) {
  validateGames(value.games)
  requireValid(Array.isArray(value.comparisons), 'Comparison history is missing or invalid.')
  requireValid(object(value.ratings), 'Saved ratings are missing or invalid.')
  for (const user of ['Brian', 'Sarah']) {
    const ratings = value.ratings[user]
    requireValid(object(ratings), 'A player rating list is missing.')
    for (const rating of Object.values(ratings)) {
      requireValid(object(rating) && finite(rating.elo) && count(rating.comparisons) && count(rating.wins), 'A saved rating or count is invalid.')
    }
    for (const game of value.games) requireValid(object(ratings[game.id]), 'A game rating is missing; automatic repair could lose progress.')
  }
  for (const record of value.comparisons) {
    requireValid(object(record) && ['id', 'at', 'leftGameId', 'rightGameId', 'Brian', 'Sarah'].every((key) => text(record[key])), 'A comparison record is invalid.')
  }
}
export function validateState(value: unknown): asserts value is AppState {
  requireValid(object(value) && Array.isArray(value.sessions), 'The saved session list is invalid.')
  const ids = new Set<string>()
  for (const session of value.sessions) {
    requireValid(object(session), 'A saved session is invalid.')
    validateProgress(session)
    requireValid(['sessionId', 'sessionName'].every((key) => text(session[key])) && ['createdAt', 'startedAt', 'importedAt'].every((key) => date(session[key])), 'Session information or dates are invalid.')
    requireValid(typeof session.sessionId === 'string' && session.sessionId.length > 0 && !ids.has(session.sessionId), 'Session IDs are invalid or duplicated.')
    ids.add(session.sessionId)
    requireValid(session.status === 'active' || session.status === 'finished', 'Session status is invalid.')
    requireValid(session.finishedAt === undefined || date(session.finishedAt), 'Session finish date is invalid.')
    if (session.summary !== undefined) {
      requireValid(object(session.summary) && count(session.summary.comparisons) && count(session.summary.excluded) && finite(session.summary.agreement) && text(session.summary.mostDivisive) && text(session.summary.topShared), 'Session summary is invalid.')
    }
    if (session.finalRankings !== undefined) {
      requireValid(object(session.finalRankings), 'Final rankings are invalid.')
      for (const tab of ['combined', 'Brian', 'Sarah']) {
        const entries = session.finalRankings[tab]
        requireValid(Array.isArray(entries) && entries.every((entry) => object(entry) && count(entry.rank) && text(entry.gameId) && text(entry.title) && finite(entry.elo) && count(entry.comparisons)), 'Final ranking entries are invalid.')
      }
    }
  }
  requireValid(value.activeSessionId === undefined || (text(value.activeSessionId) && ids.has(value.activeSessionId as string)), 'The active session reference is invalid.')
}

export function readStoredData(): Record<string, string | null> {
  // A denied read is a recovery condition, never evidence of an empty store.
  try {
    return { [STORAGE_KEY]: localStorage.getItem(STORAGE_KEY), [LEGACY_STORAGE_KEY]: localStorage.getItem(LEGACY_STORAGE_KEY) }
  } catch {
    throw new StorageRecoveryError('Browser storage cannot be read. Allow storage access and retry; your data has not been replaced.')
  }
}
function parseStored(data: Record<string, string | null>): AppState {
  if (data[STORAGE_KEY] !== null) {
    const state: unknown = JSON.parse(data[STORAGE_KEY]!)
    validateState(state)
    return { ...state, sessions: state.sessions.map(hydrateSession) }
  }
  if (data[LEGACY_STORAGE_KEY] !== null) {
    const legacy: unknown = JSON.parse(data[LEGACY_STORAGE_KEY]!)
    requireValid(object(legacy), 'Legacy data is invalid.')
    // Keep the existing empty/new-session defaults, but never invent missing ratings
    // for games with completed history or nonempty partially saved ratings.
    validateGames(legacy.games)
    const history = legacy.history === undefined ? [] : legacy.history
    const ratings = legacy.ratings === undefined && Array.isArray(history) && history.length === 0
      ? createInitialRatings(legacy.games) : legacy.ratings
    validateProgress({ ...legacy, ratings, comparisons: history })
    return migrateLegacyState({ ...legacy, ratings, history })
  }
  return createState()
}
export function loadState(): AppState {
  try {
    const data = readStoredData()
    const state = parseStored(data)
    if (data[STORAGE_KEY] === null && data[LEGACY_STORAGE_KEY] !== null) saveState(state)
    return state
  } catch (error) {
    throw new StorageRecoveryError(error instanceof StorageRecoveryError ? error.message : 'Saved data could not be loaded safely. Export the original data or restore a validated backup.')
  }
}
export function saveState(state: AppState) {
  validateState(state)
  // Also guard callers outside React: corrupt or unreadable existing data must
  // never be overwritten by an empty/default state or a delayed autosave.
  parseStored(readStoredData())
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function exportBackup(state: AppState): string {
  validateState(state)
  let storedData: Record<string, string | null> | undefined
  let storageWarning: string | undefined
  try { storedData = readStoredData() }
  catch { storageWarning = 'Browser storage was unreadable. This backup contains all currently loaded application data, including unsaved progress.' }
  return JSON.stringify({ format: 'board-game-ranker-backup', version: 1, exportedAt: new Date().toISOString(), state, storedData, storageWarning }, null, 2)
}
export function parseBackup(json: string): AppState {
  const backup: unknown = JSON.parse(json)
  requireValid(object(backup) && backup.format === 'board-game-ranker-backup' && backup.version === 1, 'Choose a complete Board Game Ranker backup (version 1).')
  validateState(backup.state)
  const state = backup.state
  return { ...state, sessions: state.sessions.map(hydrateSession) }
}
export function restoreBackup(state: AppState, expectedData: Record<string, string | null>, confirmed: boolean): AppState {
  requireValid(confirmed, 'Restoring a backup requires explicit confirmation.')
  validateState(state)
  requireValid(JSON.stringify(readStoredData()) === JSON.stringify(expectedData), 'Saved data changed while you reviewed the backup. Select the file again before restoring.')
  const restored = { ...state, sessions: state.sessions.map(hydrateSession) }
  // One atomic write: quota/access failures leave the previous value intact.
  // Do not delete the old legacy key. This is the only recovery overwrite path.
  localStorage.setItem(STORAGE_KEY, JSON.stringify(restored))
  return restored
}

export function resetState() {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.removeItem(LEGACY_STORAGE_KEY)
}
