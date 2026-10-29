import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

// Run the actual TypeScript modules without a build output or browser storage.
const moduleUrl = (source) => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText).toString('base64')}`
const rankingUrl = moduleUrl(await readFile(new URL('../src/ranking.ts', import.meta.url), 'utf8'))
const ranking = await import(rankingUrl)
const storageSource = await readFile(new URL('../src/storage.ts', import.meta.url), 'utf8')
const storage = await import(moduleUrl(storageSource.replace("'./ranking'", JSON.stringify(rankingUrl))))
const { chooseNextMatchup, applyComparison, isMatchupEligible, excludeGame } = ranking

function session(counts) {
  const games = counts.map((_, i) => ({ id: String(i), title: `Game ${i}`, createdAt: '2026-01-01' }))
  const result = storage.createSession(games, 'Fairness')
  for (const user of ['Brian', 'Sarah']) {
    games.forEach((game, i) => { result.ratings[user][game.id].comparisons = counts[i] })
  }
  return result
}
const count = (s, id) => (s.ratings.Brian[id].comparisons + s.ratings.Sarah[id].comparisons) / 2
const selected = (s, pair) => [pair.leftId, pair.rightId].map((id) => count(s, id))
function play(s) {
  const pair = chooseNextMatchup(s)
  assert.ok(pair)
  return applyComparison(s, pair.leftId, pair.rightId, { Brian: pair.leftId, Sarah: pair.rightId })
}
function record(left, right, i = 0) {
  return { id: String(i), at: '2026-01-01', leftGameId: left, rightGameId: right, Brian: left, Sarah: right }
}
function withStorage(values, fn) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const data = new Map(Object.entries(values))
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: (key) => data.delete(key),
  } })
  try { fn(data) } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous)
    else delete globalThis.localStorage
  }
}

test('fresh collections enforce bands for 1,000 comparisons, including odd collection sizes', () => {
  for (const size of [2, 3, 7, 12]) {
    let s = session(Array(size).fill(0))
    for (let i = 0; i < 1000; i++) {
      const counts = s.games.map((g) => count(s, g.id))
      const ceiling = (Math.floor(Math.min(...counts) / 8) + 1) * 8
      const below = s.games.filter((g) => count(s, g.id) < ceiling)
      const pair = chooseNextMatchup(s)
      assert.ok(pair)
      const appearances = selected(s, pair)
      if (below.length >= 2) assert.ok(appearances.every((n) => n < ceiling))
      else {
        assert.ok([pair.leftId, pair.rightId].includes(below[0].id))
        const other = [pair.leftId, pair.rightId].find((id) => id !== below[0].id)
        assert.equal(count(s, other), Math.min(...s.games.filter((g) => g.id !== below[0].id).map((g) => count(s, g.id))))
      }
      s = applyComparison(s, pair.leftId, pair.rightId, { Brian: pair.leftId, Sarah: pair.rightId })
      assert.ok(Math.max(...s.games.map((g) => count(s, g.id))) - Math.min(...s.games.map((g) => count(s, g.id))) <= 8)
    }
  }
})

for (const ceiling of [8, 16, 24]) {
  test(`games at ${ceiling} cannot play while two games are below ${ceiling}`, () => {
    let s = session([ceiling - 1, ceiling - 1, ceiling, ceiling + 30])
    assert.deepEqual(selected(s, chooseNextMatchup(s)), [ceiling - 1, ceiling - 1])
    s = play(s)
    assert.equal(count(s, '0'), ceiling)
    assert.equal(count(s, '1'), ceiling)
    assert.ok(selected(s, chooseNextMatchup(s)).every((n) => n < ceiling + 8))
  })
}

test('900-comparison history: 80/90 outliers stay frozen while 5/6 games catch up', () => {
  let s = session([80, 90, 5, 6, 7, 8])
  s.comparisons = Array.from({ length: 900 }, (_, i) => record('0', '1', i))
  const history = structuredClone(s.comparisons)
  let steps = 0
  while (Math.min(...s.games.map((g) => count(s, g.id))) < 80) {
    s = play(s)
    assert.equal(count(s, '1'), 90)
    assert.equal(count(s, '0'), 80)
    assert.ok(++steps < 500)
  }
  assert.deepEqual(s.comparisons.slice(0, 900), history)
  assert.ok(steps > 100)
})

test('Never Played games do not set the ceiling or appear in matchups', () => {
  let s = session([0, 16, 16, 16])
  s = excludeGame(s, '0', 'Never Played')
  const pair = chooseNextMatchup(s)
  assert.ok(![pair.leftId, pair.rightId].includes('0'))
  assert.equal(s.games[0].excludedReason, 'Never Played')
  assert.equal(count(s, '0'), 0)
  assert.ok(isMatchupEligible(s, pair))
})

test('one lagging game must play a least-compared opponent; exception stays minimal', () => {
  for (const counts of [[7, 8, 8, 90], [5, 80, 90], [15, 16, 24], [23, 24, 90]]) {
    let s = session(counts)
    const pair = chooseNextMatchup(s)
    assert.ok([pair.leftId, pair.rightId].includes('0'))
    assert.equal(Math.max(...selected(s, pair)), counts[1])
    s = play(s)
    assert.equal(count(s, '0'), counts[0] + 1)
    assert.ok(chooseNextMatchup(s))
  }
})

test('zero or one active game returns no matchup; all at ceiling opens next band', () => {
  assert.equal(chooseNextMatchup(session([])), undefined)
  assert.equal(chooseNextMatchup(session([0])), undefined)
  const s = session([8, 8, 8])
  assert.ok(chooseNextMatchup(s))
  assert.equal(chooseNextMatchup({ ...s, status: 'finished' }), undefined)
})

test('stale, excluded, duplicate and unknown matchups cannot be submitted', () => {
  const s = session([5, 6, 80, 90])
  s.games[3].excluded = true
  for (const [leftId, rightId] of [['2', '3'], ['0', '3'], ['0', '0'], ['0', 'missing'], ['0', '2']]) {
    assert.equal(isMatchupEligible(s, { leftId, rightId }), false)
    assert.equal(applyComparison(s, leftId, rightId, { Brian: leftId, Sarah: rightId }), s)
  }
})

test('v2 resume reselects saved matchup, preserving ratings, history, exclusions and storage', () => {
  const s = session([5, 6, 80, 90, 0])
  s.games[4].excluded = true
  s.games[4].excludedReason = 'Never Played'
  s.ratings.Brian['2'].elo = 1712
  s.comparisons = Array.from({ length: 900 }, (_, i) => record('2', '3', i))
  s.currentMatchup = { leftId: '2', rightId: '3' }
  const raw = JSON.stringify({ sessions: [s], activeSessionId: s.sessionId })
  withStorage({ 'board-game-ranker-state-v2': raw }, (data) => {
    const loaded = storage.loadState().sessions[0]
    assert.deepEqual(selected(loaded, loaded.currentMatchup), [5, 6])
    assert.deepEqual(loaded.ratings, s.ratings)
    assert.deepEqual(loaded.comparisons, s.comparisons)
    assert.deepEqual(loaded.games, s.games)
    assert.equal(data.get('board-game-ranker-state-v2'), raw)
    storage.saveState({ sessions: [loaded], activeSessionId: loaded.sessionId })
    assert.deepEqual(storage.loadState().sessions[0].comparisons, s.comparisons)
  })
})

test('legacy resume preserves history and counts while replacing the old matchup', () => {
  const s = session([5, 6, 80, 90])
  const legacy = { games: s.games, ratings: s.ratings, history: [record('2', '3')], currentMatchup: { leftId: '2', rightId: '3' } }
  withStorage({ 'board-game-ranker-state-v1': JSON.stringify(legacy) }, (data) => {
    const loaded = storage.loadState().sessions[0]
    assert.deepEqual(selected(loaded, loaded.currentMatchup), [5, 6])
    assert.deepEqual(loaded.ratings, s.ratings)
    assert.deepEqual(loaded.comparisons, legacy.history)
    assert.ok(data.has('board-game-ranker-state-v1'))
    assert.ok(data.has('board-game-ranker-state-v2'))
  })
})

test('repeat avoidance takes priority over extreme Elo disagreement when alternatives exist', () => {
  const s = session([4, 4, 4, 4])
  s.comparisons = Array.from({ length: 100 }, (_, i) => record('0', '1', i))
  s.ratings.Brian['0'].elo = 100000
  for (let i = 0; i < 50; i++) {
    const pair = chooseNextMatchup(s)
    assert.notDeepEqual([pair.leftId, pair.rightId], ['0', '1'])
  }
})

test('among equally repeated eligible pairs, Elo closeness and disagreement still guide selection', () => {
  const s = session([8, 8, 8])
  // Enough history to activate the existing late-session Elo weights.
  s.comparisons = Array.from({ length: 30 }, (_, i) => record('excluded-a', 'excluded-b', i))
  for (const user of ['Brian', 'Sarah']) {
    s.ratings[user]['0'].elo = 1000
    s.ratings[user]['1'].elo = 1000
    s.ratings[user]['2'].elo = 3000
  }
  for (let i = 0; i < 20; i++) assert.deepEqual(chooseNextMatchup(s), { leftId: '0', rightId: '1' })
  s.ratings.Brian['2'].elo = 10000
  s.ratings.Sarah['2'].elo = -8000
  for (let i = 0; i < 20; i++) {
    const pair = chooseNextMatchup(s)
    assert.ok([pair.leftId, pair.rightId].includes('2'))
  }
})

test('a forced repeat remains possible when only two active games exist', () => {
  const s = session([7, 8])
  s.comparisons = Array.from({ length: 100 }, (_, i) => record('0', '1', i))
  const next = play(s)
  assert.equal(count(next, '0'), 8)
  assert.equal(count(next, '1'), 9)
  assert.equal(next.comparisons.length, 101)
})

test('finished saved sessions retain their frozen results and cannot accept comparisons', () => {
  const s = session([8, 8, 8])
  s.status = 'finished'
  s.summary = ranking.summaryStats(s)
  s.finalRankings = ranking.freezeRankings(s)
  s.comparisons = [record('0', '1')]
  withStorage({ 'board-game-ranker-state-v2': JSON.stringify({ sessions: [s] }) }, () => {
    const loaded = storage.loadState().sessions[0]
    assert.equal(loaded.currentMatchup, undefined)
    assert.deepEqual(loaded.finalRankings, s.finalRankings)
    assert.deepEqual(loaded.summary, s.summary)
    assert.deepEqual(loaded.ratings, s.ratings)
    assert.deepEqual(loaded.comparisons, s.comparisons)
    assert.equal(applyComparison(loaded, '0', '1', { Brian: '0', Sarah: '1' }), loaded)
  })
})

test('choosing a matchup leaves all saved progress untouched', () => {
  const s = session([5, 6, 80, 90])
  const original = structuredClone(s)
  chooseNextMatchup(s)
  assert.deepEqual(s, original)
})

const currentKey = 'board-game-ranker-state-v2'
const legacyKey = 'board-game-ranker-state-v1'
const stateOf = (s) => ({ sessions: [s], activeSessionId: s.sessionId })

for (const raw of ['{broken json', '', 'null', '{}', '{"sessions":{}}', '{"sessions":[null]}']) {
  test(`invalid stored JSON/structure is never overwritten: ${JSON.stringify(raw)}`, () => {
    withStorage({ [currentKey]: raw }, (data) => {
      assert.throws(() => storage.loadState(), storage.StorageRecoveryError)
      assert.throws(() => storage.saveState(storage.createState()))
      assert.equal(data.get(currentKey), raw)
      assert.equal(data.size, 1)
    })
  })
}

test('partial/malformed progress is blocked instead of initializing zero counts', () => {
  for (const corrupt of [
    (s) => { delete s.ratings.Brian['0'] },
    (s) => { s.ratings.Sarah['0'].comparisons = -1 },
    (s) => { s.ratings.Brian['0'].elo = 'bad' },
    (s) => { s.games[0].excluded = 'yes' },
    (s) => { s.comparisons = [null] },
    (s) => { s.comparisons = {} },
    (s) => { s.games.push(s.games[0]) },
    (s) => { s.finalRankings = { combined: null } },
  ]) {
    const s = session([80, 6])
    corrupt(s)
    const raw = JSON.stringify(stateOf(s))
    withStorage({ [currentKey]: raw }, (data) => {
      assert.throws(() => storage.loadState(), storage.StorageRecoveryError)
      assert.throws(() => storage.saveState(storage.createState()))
      assert.equal(data.get(currentKey), raw)
    })
  }
})

test('invalid primary data does not silently fall back to or migrate legacy data', () => {
  const s = session([8, 8])
  const legacy = JSON.stringify({ games: s.games, ratings: s.ratings, history: [] })
  withStorage({ [currentKey]: '{broken', [legacyKey]: legacy }, (data) => {
    const before = new Map(data)
    assert.throws(() => storage.loadState())
    assert.deepEqual(data, before)
  })
})

test('corrupt legacy data is preserved without creating a primary save', () => {
  for (const raw of ['{broken', '{}', JSON.stringify({ games: [{ id: '0' }], history: [] })]) {
    withStorage({ [legacyKey]: raw }, (data) => {
      assert.throws(() => storage.loadState())
      assert.throws(() => storage.saveState(storage.createState()))
      assert.equal(data.get(legacyKey), raw)
      assert.equal(data.has(currentKey), false)
    })
  }
})

test('legacy games with history but missing ratings require recovery', () => {
  const s = session([5, 6])
  const raw = JSON.stringify({ games: s.games, history: [record('0', '1')] })
  withStorage({ [legacyKey]: raw }, (data) => {
    assert.throws(() => storage.loadState())
    assert.equal(data.get(legacyKey), raw)
    assert.equal(data.has(currentKey), false)
  })
})

test('new storage and untouched legacy collections continue to load and save', () => {
  withStorage({}, (data) => {
    assert.deepEqual(storage.loadState(), { sessions: [] })
    const state = stateOf(session([0, 0]))
    storage.saveState(state)
    assert.deepEqual(storage.loadState().sessions[0].ratings, state.sessions[0].ratings)
    assert.ok(data.has(currentKey))
  })
  const s = session([0, 0])
  withStorage({ [legacyKey]: JSON.stringify({ games: s.games }) }, (data) => {
    const loaded = storage.loadState()
    assert.deepEqual(loaded.sessions[0].ratings, s.ratings)
    assert.ok(data.has(currentKey))
    assert.ok(data.has(legacyKey))
  })
})

test('storage read denial blocks both load and autosave without a write', () => {
  withStorage({}, () => {
    let writes = 0
    localStorage.getItem = () => { throw new Error('SecurityError') }
    localStorage.setItem = () => { writes++ }
    assert.throws(() => storage.loadState(), storage.StorageRecoveryError)
    assert.throws(() => storage.saveState(storage.createState()), storage.StorageRecoveryError)
    assert.equal(writes, 0)
  })
})

test('quota failure reports an error and preserves the previous save', () => {
  const original = JSON.stringify(stateOf(session([8, 8])))
  withStorage({ [currentKey]: original }, (data) => {
    localStorage.setItem = () => { throw new Error('QuotaExceededError') }
    assert.throws(() => storage.saveState(stateOf(session([16, 16]))), /QuotaExceededError/)
    assert.equal(data.get(currentKey), original)
  })
})

test('complete backup restores multiple active/finished sessions on another device without losing data', () => {
  const active = session([80, 90, 5, 6, 0])
  active.games[4].excluded = true
  active.games[4].excludedReason = 'Never Played'
  active.comparisons = Array.from({ length: 900 }, (_, i) => record('0', '1', i))
  active.currentMatchup = { leftId: '0', rightId: '1' }
  active.ratings.Sarah['0'].elo = 1234
  const finished = session([24, 24])
  finished.status = 'finished'
  finished.finishedAt = '2026-10-29T10:00:00Z'
  finished.summary = ranking.summaryStats(finished)
  finished.finalRankings = ranking.freezeRankings(finished)
  const original = { sessions: [active, finished], activeSessionId: active.sessionId }
  let backup
  withStorage({ [legacyKey]: '{old raw data}' }, (data) => {
    const before = new Map(data)
    backup = storage.exportBackup(original)
    assert.deepEqual(data, before)
    assert.equal(JSON.parse(backup).storedData[legacyKey], '{old raw data}')
  })
  withStorage({}, () => {
    const parsed = storage.parseBackup(backup)
    assert.deepEqual(parsed.sessions[0].ratings, active.ratings)
    assert.deepEqual(parsed.sessions[0].games, active.games)
    assert.deepEqual(parsed.sessions[0].comparisons, active.comparisons)
    assert.deepEqual(parsed.sessions[1].finalRankings, finished.finalRankings)
    const restored = storage.restoreBackup(parsed, storage.readStoredData(), true)
    const reloaded = storage.loadState()
    assert.deepEqual(reloaded.sessions.map((s) => s.ratings), original.sessions.map((s) => s.ratings))
    assert.equal(restored.activeSessionId, original.activeSessionId)
    assert.ok(isMatchupEligible(reloaded.sessions[0], reloaded.sessions[0].currentMatchup))
    assert.deepEqual(selected(reloaded.sessions[0], reloaded.sessions[0].currentMatchup), [5, 6])
    assert.equal(reloaded.sessions[1].finishedAt, finished.finishedAt)
  })
})

test('import validation rejects damaged, incomplete, unknown and raw-recovery files without writes', () => {
  const valid = stateOf(session([8, 8]))
  const invalidState = structuredClone(valid)
  delete invalidState.sessions[0].ratings.Brian['0']
  const files = ['broken', '{}', JSON.stringify(valid),
    JSON.stringify({ format: 'board-game-ranker-backup', version: 99, state: valid }),
    JSON.stringify({ format: 'board-game-ranker-backup', version: 1, state: invalidState }),
    JSON.stringify({ format: 'board-game-ranker-recovery', version: 1, storedData: {} })]
  withStorage({ [currentKey]: '{original}' }, (data) => {
    for (const file of files) assert.throws(() => storage.parseBackup(file))
    assert.equal(data.get(currentKey), '{original}')
  })
})

test('cancelled/unconfirmed recovery cannot overwrite data; explicit restore can replace corrupt primary data', () => {
  const raw = '{corrupted original}'
  const imported = stateOf(session([16, 16]))
  withStorage({ [currentKey]: raw, [legacyKey]: '{keep legacy}' }, (data) => {
    const expected = storage.readStoredData()
    assert.throws(() => storage.restoreBackup(imported, expected, false), /confirmation/)
    assert.equal(data.get(currentKey), raw)
    storage.restoreBackup(imported, expected, true)
    assert.deepEqual(storage.loadState().sessions[0].ratings, imported.sessions[0].ratings)
    assert.equal(data.get(legacyKey), '{keep legacy}')
  })
})

test('backup preview/parse makes no writes and later changes invalidate restore confirmation', () => {
  const original = stateOf(session([8, 8]))
  withStorage({ [currentKey]: JSON.stringify(original) }, (data) => {
    const before = new Map(data)
    const parsed = storage.parseBackup(storage.exportBackup(original))
    const expected = storage.readStoredData()
    assert.deepEqual(data, before)
    data.set(currentKey, 'changed in another tab')
    assert.throws(() => storage.restoreBackup(parsed, expected, true), /changed/)
    assert.equal(data.get(currentKey), 'changed in another tab')
  })
})

test('restore write failure never removes the previous save or legacy data', () => {
  withStorage({ [currentKey]: 'corrupt', [legacyKey]: 'legacy' }, (data) => {
    const expected = storage.readStoredData()
    localStorage.setItem = () => { throw new Error('QuotaExceededError') }
    assert.throws(() => storage.restoreBackup(stateOf(session([8, 8])), expected, true), /QuotaExceededError/)
    assert.equal(data.get(currentKey), 'corrupt')
    assert.equal(data.get(legacyKey), 'legacy')
  })
})

test('loaded in-memory progress can still be exported when browser storage becomes unreadable', () => {
  const state = stateOf(session([8, 8]))
  withStorage({}, () => {
    localStorage.getItem = () => { throw new Error('SecurityError') }
    const exported = storage.exportBackup(state)
    assert.ok(JSON.parse(exported).storageWarning)
    assert.deepEqual(storage.parseBackup(exported).sessions[0].ratings, state.sessions[0].ratings)
  })
})

test('raw saved text remains accessible for recovery export and does not modify storage', () => {
  withStorage({ [currentKey]: '{damaged', [legacyKey]: 'legacy original' }, (data) => {
    const before = new Map(data)
    const raw = storage.readStoredData()
    assert.equal(raw[currentKey], '{damaged')
    assert.equal(raw[legacyKey], 'legacy original')
    assert.deepEqual(data, before)
  })
})

test('invalid session dates enter recovery before the session UI can crash', () => {
  for (const field of ['createdAt', 'startedAt', 'importedAt', 'finishedAt']) {
    const s = session([8, 8])
    s[field] = 'not a valid date'
    const raw = JSON.stringify(stateOf(s))
    withStorage({ [currentKey]: raw }, (data) => {
      assert.throws(() => storage.loadState(), storage.StorageRecoveryError)
      assert.equal(data.get(currentKey), raw)
    })
  }
})

test('explicit retry can load valid data after storage is repaired without resetting progress', () => {
  const s = session([80, 90, 5, 6])
  s.comparisons = Array.from({ length: 900 }, (_, i) => record('0', '1', i))
  withStorage({ [currentKey]: '{damaged}' }, (data) => {
    assert.throws(() => storage.loadState())
    const repaired = JSON.stringify(stateOf(s))
    data.set(currentKey, repaired)
    const loaded = storage.loadState()
    assert.deepEqual(loaded.sessions[0].ratings, s.ratings)
    assert.deepEqual(loaded.sessions[0].comparisons, s.comparisons)
    assert.equal(data.get(currentKey), repaired)
  })
})
