import { Check, Download, FileDown, Play, RefreshCcw, SquareCheckBig, Trophy } from 'lucide-react'
import type { Dispatch, SetStateAction, SyntheticEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { importGamesFromSheet } from './importSheet'
import { applyComparison, chooseNextMatchup, excludeGame, freezeRankings, rankedGames, summaryStats } from './ranking'
import { createSession, createState, loadState, resetState, saveState } from './storage'
import type { AppState, Game, RankingSession, RankingTab, UserName } from './types'

type Screen = 'compare' | 'rankings' | 'summary' | 'sessions'
type Choices = Record<UserName, string | undefined>

const USERS: UserName[] = ['Brian', 'Sarah']

function formatDate(value?: string) {
  if (!value) return 'Not finished'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function safeFileName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '') || 'session'
}

function downloadText(filename: string, text: string, type: string) {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function csvCell(value: string | number | undefined) {
  const text = String(value ?? '')
  return `"${text.replace(/"/g, '""')}"`
}

function exportSessionJson(session: RankingSession) {
  downloadText(
    `${safeFileName(session.sessionName)}.json`,
    JSON.stringify(
      {
        ...session,
        summary: session.summary || summaryStats(session),
        finalRankings: session.finalRankings || freezeRankings(session),
      },
      null,
      2,
    ),
    'application/json',
  )
}

function exportRankingsCsv(session: RankingSession) {
  const finalRankings = session.finalRankings || freezeRankings(session)
  const rows = [
    ['Ranking', 'Rank', 'Title', 'Elo', 'Comparisons'],
    ...(['combined', 'Brian', 'Sarah'] as const).flatMap((tab) =>
      finalRankings[tab].map((entry) => [tab, entry.rank, entry.title, entry.elo, entry.comparisons]),
    ),
  ]
  downloadText(
    `${safeFileName(session.sessionName)}-rankings.csv`,
    rows.map((row) => row.map(csvCell).join(',')).join('\n'),
    'text/csv',
  )
}

function GameCard({
  game,
  selectedBy,
  onNeverPlayed,
}: {
  game: Game
  selectedBy: UserName[]
  onNeverPlayed: () => void
}) {
  return (
    <article
      className={`flex min-h-64 flex-1 flex-col overflow-hidden rounded-lg border bg-linen shadow-soft transition ${
        selectedBy.length ? 'border-lagoon ring-4 ring-lagoon/20 shadow-lift' : 'border-amber-200'
      }`}
    >
      <div className="relative flex aspect-[3/4] items-center justify-center bg-mint">
        {game.thumbnailUrl ? (
          <img
            src={game.thumbnailUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="eager"
            onError={(event: SyntheticEvent<HTMLImageElement>) => {
              event.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-mint via-amber-50 to-blush px-3 text-center text-sm font-semibold text-stone-600">
            {game.title}
          </div>
        )}
        {selectedBy.length > 0 && (
          <div className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full bg-lagoon text-white shadow-soft">
            <Check size={25} strokeWidth={3} />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col justify-between gap-3 p-3">
        <h2 className="text-balance text-center text-lg font-bold leading-tight text-ink">{game.title}</h2>
        <button
          type="button"
          onClick={onNeverPlayed}
          className="min-h-11 rounded-md border border-clay/30 bg-blush/50 px-3 text-sm font-semibold text-clay active:scale-[0.99]"
        >
          Never Played
        </button>
      </div>
    </article>
  )
}

function ChoiceButton({
  user,
  side,
  active,
  onClick,
}: {
  user: UserName
  side: 'left' | 'right'
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-h-12 flex-1 items-center justify-center gap-2 rounded-md border px-3 text-base font-bold transition active:scale-[0.99] ${
        active
          ? 'border-lagoon bg-lagoon text-white shadow-soft'
          : 'border-amber-200 bg-white text-ink hover:border-saffron'
      }`}
      aria-pressed={active}
    >
      {active && <Check size={20} strokeWidth={3} />}
      {user}
      <span className="sr-only">chooses {side}</span>
    </button>
  )
}

function StartSessionPanel({
  onStart,
  isImporting,
  error,
  compact = false,
}: {
  onStart: (sessionName: string) => void
  isImporting: boolean
  error?: string
  compact?: boolean
}) {
  const [sessionName, setSessionName] = useState(`Session ${new Date().toLocaleDateString()}`)

  return (
    <main className={compact ? 'space-y-4' : 'mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10'}>
      <div className="space-y-6">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-lagoon">Brian and Sarah</p>
          <h1 className="mt-2 text-4xl font-black leading-tight text-ink">
            {compact ? 'Start a new session' : 'Board game preference ranking'}
          </h1>
          <p className="mt-4 text-lg leading-relaxed text-stone-700">
            Each new session imports the current sheet, then keeps that game list fixed for the session.
          </p>
        </div>
        <label className="block">
          <span className="text-sm font-black uppercase tracking-wide text-stone-600">Session name</span>
          <input
            value={sessionName}
            onChange={(event) => setSessionName(event.target.value)}
            className="mt-2 min-h-12 w-full rounded-md border border-amber-200 bg-white px-3 text-base font-bold text-ink outline-none focus:border-lagoon"
          />
        </label>
        <button
          type="button"
          onClick={() => onStart(sessionName)}
          disabled={isImporting}
          className="flex min-h-14 w-full items-center justify-center gap-3 rounded-md bg-lagoon px-5 text-lg font-bold text-white shadow-lift disabled:cursor-wait disabled:opacity-70"
        >
          <Download size={22} />
          {isImporting ? 'Importing games...' : 'Import Sheet and Start'}
        </button>
        {error && <p className="rounded-md border border-clay/30 bg-blush p-3 text-sm font-semibold text-clay">{error}</p>}
      </div>
    </main>
  )
}

function CompareScreen({
  session,
  setSession,
}: {
  session: RankingSession
  setSession: Dispatch<SetStateAction<RankingSession>>
}) {
  const matchup = session.currentMatchup || chooseNextMatchup(session)
  const left = session.games.find((game) => game.id === matchup?.leftId)
  const right = session.games.find((game) => game.id === matchup?.rightId)
  const [choices, setChoices] = useState<Choices>({ Brian: undefined, Sarah: undefined })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setChoices({ Brian: undefined, Sarah: undefined })
  }, [matchup?.leftId, matchup?.rightId])

  if (!left || !right) {
    return (
      <section className="flex flex-1 items-center justify-center px-5 text-center">
        <div>
          <Trophy className="mx-auto text-saffron" size={42} />
          <h2 className="mt-3 text-2xl font-black text-ink">No more matchups available</h2>
          <p className="mt-2 text-stone-600">Finish this session or check the summary.</p>
        </div>
      </section>
    )
  }

  const leftGame = left
  const rightGame = right
  const canSubmit = Boolean(choices.Brian && choices.Sarah) && !submitting

  function select(user: UserName, gameId: string) {
    setChoices((current) => ({ ...current, [user]: gameId }))
  }

  function submit() {
    if (!canSubmit || !choices.Brian || !choices.Sarah) return
    setSubmitting(true)
    setSession((current) => applyComparison(current, leftGame.id, rightGame.id, choices as Record<UserName, string>))
    window.setTimeout(() => setSubmitting(false), 300)
  }

  function neverPlayed(gameId: string) {
    setSession((current) => excludeGame(current, gameId, 'Never Played'))
  }

  return (
    <main className="flex flex-1 flex-col gap-4 px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
      <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
        <GameCard game={leftGame} selectedBy={USERS.filter((user) => choices[user] === leftGame.id)} onNeverPlayed={() => neverPlayed(leftGame.id)} />
        <div className="flex items-center justify-center">
          <div className="rounded-full bg-saffron px-2 py-1 text-xs font-black text-white shadow-sm">OR</div>
        </div>
        <GameCard game={rightGame} selectedBy={USERS.filter((user) => choices[user] === rightGame.id)} onNeverPlayed={() => neverPlayed(rightGame.id)} />
      </div>

      <div className="space-y-3">
        {USERS.map((user) => (
          <div key={user} className="rounded-lg border border-amber-200 bg-white/80 p-2 shadow-sm">
            <div className="mb-2 px-1 text-sm font-black text-lagoon">{user}</div>
            <div className="flex gap-2">
              <ChoiceButton user={user} side="left" active={choices[user] === leftGame.id} onClick={() => select(user, leftGame.id)} />
              <ChoiceButton user={user} side="right" active={choices[user] === rightGame.id} onClick={() => select(user, rightGame.id)} />
            </div>
          </div>
        ))}
      </div>

      <button
        type="button"
        disabled={!canSubmit}
        onClick={submit}
        className="min-h-14 rounded-md bg-berry px-5 text-xl font-black text-white shadow-lift disabled:bg-stone-300 disabled:text-stone-500"
      >
        OK
      </button>
    </main>
  )
}

function RankingsScreen({ session }: { session: RankingSession }) {
  const [tab, setTab] = useState<RankingTab>('combined')
  const rankings = useMemo(() => rankedGames(session, tab), [session, tab])

  return (
    <main className="flex-1 px-4 pb-24 pt-4">
      <div className="mb-4 grid grid-cols-3 rounded-lg border border-amber-200 bg-white p-1 shadow-sm">
        {[
          ['combined', 'Combined'],
          ['Brian', 'Brian'],
          ['Sarah', 'Sarah'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value as RankingTab)}
            className={`min-h-10 rounded-md text-sm font-black ${tab === value ? 'bg-lagoon text-white' : 'text-stone-600'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {rankings.map(({ game, rating }, index) => (
          <div key={game.id} className="grid grid-cols-[2.2rem_3rem_1fr_auto] items-center gap-3 rounded-lg border border-amber-200 bg-white p-2 shadow-sm">
            <div className="text-center text-lg font-black text-saffron">{index + 1}</div>
            <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md bg-mint text-xs font-bold text-moss">
              {game.thumbnailUrl ? <img src={game.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : game.title.slice(0, 1)}
            </div>
            <div className="min-w-0">
              <div className="truncate font-black text-ink">{game.title}</div>
              <div className="text-sm font-semibold text-stone-500">{rating.comparisons} comparisons</div>
            </div>
            <div className="text-right text-lg font-black text-lagoon">{rating.elo}</div>
          </div>
        ))}
      </div>
    </main>
  )
}

function SummaryScreen({
  session,
  onFinish,
}: {
  session: RankingSession
  onFinish: () => void
}) {
  const stats = session.summary || summaryStats(session)
  const finished = session.status === 'finished'

  return (
    <main className="flex-1 px-5 pb-24 pt-5">
      <h1 className="text-3xl font-black text-ink">Session summary</h1>
      <p className="mt-1 text-sm font-bold text-stone-600">{session.sessionName}</p>
      <div className="mt-5 grid gap-3">
        {[
          ['Comparisons completed', stats.comparisons],
          ['Games excluded', stats.excluded],
          ['Brian/Sarah agreement', `${stats.agreement}%`],
          ['Most divisive game', stats.mostDivisive],
          ['Top shared game', stats.topShared],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-amber-200 bg-white p-4 shadow-sm">
            <div className="text-sm font-bold uppercase tracking-wide text-lagoon">{label}</div>
            <div className="mt-1 text-2xl font-black text-ink">{value}</div>
          </div>
        ))}
      </div>
      <div className="mt-5 grid gap-3">
        {!finished && (
          <button
            type="button"
            onClick={onFinish}
            className="flex min-h-13 items-center justify-center gap-2 rounded-md bg-berry px-4 text-base font-black text-white shadow-lift"
          >
            <SquareCheckBig size={20} />
            Finish Session
          </button>
        )}
        {finished && (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => exportSessionJson(session)}
              className="flex min-h-12 items-center justify-center gap-2 rounded-md bg-lagoon px-3 text-sm font-black text-white"
            >
              <FileDown size={18} />
              JSON
            </button>
            <button
              type="button"
              onClick={() => exportRankingsCsv(session)}
              className="flex min-h-12 items-center justify-center gap-2 rounded-md bg-saffron px-3 text-sm font-black text-white"
            >
              <FileDown size={18} />
              CSV
            </button>
          </div>
        )}
      </div>
    </main>
  )
}

function SessionsScreen({
  state,
  onOpenSession,
  onFinish,
  onStart,
  isImporting,
  error,
}: {
  state: AppState
  onOpenSession: (sessionId: string) => void
  onFinish: () => void
  onStart: (sessionName: string) => void
  isImporting: boolean
  error?: string
}) {
  const activeSession = state.sessions.find((session) => session.sessionId === state.activeSessionId)
  const finishedSessions = state.sessions
    .filter((session) => session.status === 'finished')
    .sort((a, b) => new Date(b.finishedAt || b.createdAt).getTime() - new Date(a.finishedAt || a.createdAt).getTime())

  return (
    <main className="flex-1 px-4 pb-24 pt-4">
      <h1 className="text-3xl font-black text-ink">Sessions</h1>

      {activeSession && (
        <section className="mt-4 rounded-lg border border-lagoon/30 bg-white p-4 shadow-sm">
          <div className="text-sm font-black uppercase tracking-wide text-lagoon">Current active session</div>
          <h2 className="mt-1 text-2xl font-black text-ink">{activeSession.sessionName}</h2>
          <p className="mt-1 text-sm font-semibold text-stone-600">
            {activeSession.comparisons.length} comparisons · {activeSession.games.filter((game) => game.excluded).length} excluded
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onOpenSession(activeSession.sessionId)}
              className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-lagoon px-3 text-sm font-black text-white"
            >
              <Play size={18} />
              Continue
            </button>
            <button
              type="button"
              onClick={onFinish}
              className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-berry px-3 text-sm font-black text-white"
            >
              <SquareCheckBig size={18} />
              Finish
            </button>
          </div>
        </section>
      )}

      {!activeSession && (
        <section className="mt-4 rounded-lg border border-amber-200 bg-white p-4 shadow-sm">
          <StartSessionPanel onStart={onStart} isImporting={isImporting} error={error} compact />
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-xl font-black text-ink">Finished sessions</h2>
        <div className="mt-3 space-y-3">
          {finishedSessions.length === 0 && (
            <p className="rounded-lg border border-amber-200 bg-white p-4 text-sm font-semibold text-stone-600">
              Finished sessions will appear here.
            </p>
          )}
          {finishedSessions.map((session) => {
            const stats = session.summary || summaryStats(session)
            return (
              <article key={session.sessionId} className="rounded-lg border border-amber-200 bg-white p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-black text-ink">{session.sessionName}</h3>
                    <p className="mt-1 text-sm font-semibold text-stone-600">{formatDate(session.finishedAt)}</p>
                  </div>
                  <div className="rounded-md bg-mint px-2 py-1 text-sm font-black text-lagoon">{stats.comparisons}</div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm font-semibold text-stone-700">
                  <div>Excluded: {stats.excluded}</div>
                  <div>Top: {stats.topShared}</div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => exportSessionJson(session)}
                    className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-lagoon px-3 text-sm font-black text-white"
                  >
                    <FileDown size={18} />
                    JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => exportRankingsCsv(session)}
                    className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-saffron px-3 text-sm font-black text-white"
                  >
                    <FileDown size={18} />
                    CSV
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </main>
  )
}

export default function App() {
  const [state, setState] = useState<AppState>(() => loadState())
  const [screen, setScreen] = useState<Screen>('compare')
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState<string>()

  const activeSession = state.sessions.find((session) => session.sessionId === state.activeSessionId)

  useEffect(() => {
    saveState(state)
  }, [state])

  function setActiveSession(updater: SetStateAction<RankingSession>) {
    setState((current) => {
      const activeId = current.activeSessionId
      if (!activeId) return current
      return {
        ...current,
        sessions: current.sessions.map((session) => {
          if (session.sessionId !== activeId) return session
          return typeof updater === 'function' ? updater(session) : updater
        }),
      }
    })
  }

  async function startSession(sessionName: string) {
    setIsImporting(true)
    setError(undefined)
    try {
      const games = await importGamesFromSheet()
      setState((current) => {
        const session = createSession(games, sessionName, current.sessions.length)
        return { sessions: [...current.sessions, session], activeSessionId: session.sessionId }
      })
      setScreen('compare')
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Import failed. Check the sheet sharing settings.')
    } finally {
      setIsImporting(false)
    }
  }

  function finishActiveSession() {
    setState((current) => {
      const activeId = current.activeSessionId
      if (!activeId) return current
      const finishedAt = new Date().toISOString()
      return {
        sessions: current.sessions.map((session) => {
          if (session.sessionId !== activeId || session.status === 'finished') return session
          const finishedSession = {
            ...session,
            status: 'finished' as const,
            finishedAt,
            currentMatchup: undefined,
          }
          return {
            ...finishedSession,
            summary: summaryStats(finishedSession),
            finalRankings: freezeRankings(finishedSession),
          }
        }),
        activeSessionId: undefined,
      }
    })
    setScreen('sessions')
  }

  function openSession(sessionId: string) {
    setState((current) => ({ ...current, activeSessionId: sessionId }))
    setScreen('compare')
  }

  function clearAll() {
    resetState()
    setState(createState())
    setScreen('sessions')
  }

  if (!state.sessions.length) {
    return <StartSessionPanel onStart={startSession} isImporting={isImporting} error={error} />
  }

  return (
    <div className="flex min-h-dvh flex-col bg-paper/80 text-ink">
      <header className="sticky top-0 z-10 border-b border-amber-200 bg-linen/95 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.6rem)] backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-lagoon">Game Rank</div>
            <div className="text-sm font-bold text-stone-600">
              {activeSession ? `${activeSession.sessionName} · ${activeSession.comparisons.length} saved` : `${state.sessions.length} sessions saved`}
            </div>
          </div>
          <button
            type="button"
            onClick={clearAll}
            className="flex h-10 w-10 items-center justify-center rounded-md border border-amber-200 bg-white text-clay"
            aria-label="Reset app"
            title="Reset app"
          >
            <RefreshCcw size={18} />
          </button>
        </div>
      </header>

      {screen === 'compare' && activeSession && <CompareScreen session={activeSession} setSession={setActiveSession} />}
      {screen === 'rankings' && activeSession && <RankingsScreen session={activeSession} />}
      {screen === 'summary' && activeSession && <SummaryScreen session={activeSession} onFinish={finishActiveSession} />}
      {screen === 'sessions' && (
        <SessionsScreen
          state={state}
          onOpenSession={openSession}
          onFinish={finishActiveSession}
          onStart={startSession}
          isImporting={isImporting}
          error={error}
        />
      )}
      {!activeSession && screen !== 'sessions' && (
        <SessionsScreen
          state={state}
          onOpenSession={openSession}
          onFinish={finishActiveSession}
          onStart={startSession}
          isImporting={isImporting}
          error={error}
        />
      )}

      <nav className="fixed bottom-0 left-0 right-0 z-20 border-t border-amber-200 bg-linen/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.4rem)] pt-2 backdrop-blur">
        <div className="mx-auto grid max-w-md grid-cols-4 gap-2">
          {[
            ['compare', 'Compare'],
            ['rankings', 'Ranks'],
            ['summary', 'Summary'],
            ['sessions', 'Sessions'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setScreen(value as Screen)}
              className={`min-h-11 rounded-md text-sm font-black ${
                screen === value ? 'bg-lagoon text-white' : 'bg-mint text-stone-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </nav>
    </div>
  )
}
