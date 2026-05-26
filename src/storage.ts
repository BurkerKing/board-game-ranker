import { chooseNextMatchup, createInitialRatings, ensureRatings } from './ranking'
import type { AppState, Game } from './types'

const STORAGE_KEY = 'board-game-ranker-state-v1'

export function createState(games: Game[] = []): AppState {
  const state: AppState = {
    games,
    ratings: createInitialRatings(games),
    history: [],
    importedAt: games.length ? new Date().toISOString() : undefined,
  }
  return { ...state, currentMatchup: chooseNextMatchup(state) }
}

export function loadState(): AppState {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return createState()
    const state = JSON.parse(saved) as AppState
    const hydrated = { ...state, ratings: ensureRatings(state), history: state.history || [] }
    return { ...hydrated, currentMatchup: hydrated.currentMatchup || chooseNextMatchup(hydrated) }
  } catch {
    return createState()
  }
}

export function saveState(state: AppState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
}

export function resetState() {
  localStorage.removeItem(STORAGE_KEY)
}
