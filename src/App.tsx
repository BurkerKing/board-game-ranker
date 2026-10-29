import { BarChart3, Check, Download, FileDown, Play, RefreshCcw, SquareCheckBig, Trash2, Trophy } from 'lucide-react'
import type { Dispatch, SetStateAction, SyntheticEvent } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { importGamesFromSheet } from './importSheet'
import { applyComparison, chooseNextMatchup, isMatchupEligible, excludeGame, freezeRankings, rankedGames, summaryStats } from './ranking'
import { createSession, createState, exportBackup, loadState, parseBackup, readStoredData, resetState, restoreBackup, saveState } from './storage'
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
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Safari may consume the URL after the click handler returns.
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
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

function rankLabel(index: number) {
  return ['First', 'Second', 'Third', 'Fourth', 'Fifth'][index] || `${index + 1}`
}

function topFiveRows(session: RankingSession) {
  const finalRankings = session.finalRankings || freezeRankings(session)
  return Array.from({ length: 5 }, (_, index) => [
    rankLabel(index),
    finalRankings.Brian[index]?.title || '',
    finalRankings.Sarah[index]?.title || '',
    finalRankings.combined[index]?.title || '',
  ])
}

function exportTopFiveCsv(session: RankingSession) {
  const rows = [
    [formatDate(session.finishedAt || session.createdAt), 'Brian', 'Sarah', 'Combined'],
    ...topFiveRows(session),
  ]
  downloadText(
    `${safeFileName(session.sessionName)}-top-five.csv`,
    rows.map((row) => row.map(csvCell).join(',')).join('\n'),
    'text/csv',
  )
}

function exportAllTopFiveCsv(sessions: RankingSession[]) {
  const finishedSessions = sessions.filter((session) => session.status === 'finished')
  const rows = finishedSessions.flatMap((session, index) => {
    const section = [
      [formatDate(session.finishedAt || session.createdAt), 'Brian', 'Sarah', 'Combined'],
      ...topFiveRows(session),
    ]
    return index === 0 ? section : [['', '', '', ''], ...section]
  })
  downloadText('board-game-session-top-fives.csv', rows.map((row) => row.map(csvCell).join(',')).join('\n'), 'text/csv')
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
      className={`flex flex-1 flex-col overflow-hidden rounded-lg border bg-linen shadow-soft transition ${
        selectedBy.length ? 'border-lagoon ring-4 ring-lagoon/20 shadow-lift' : 'border-amber-200'
      }`}
    >
      <div className="relative flex aspect-square max-h-44 items-center justify-center bg-mint">
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
      <div className="flex flex-1 flex-col justify-between gap-2 p-2.5">
        <h2 className="text-balance text-center text-base font-bold leading-tight text-ink">{game.title}</h2>
        <button
          type="button"
          onClick={onNeverPlayed}
          className="min-h-10 rounded-md border border-clay/30 bg-blush/50 px-3 text-sm font-semibold text-clay active:scale-[0.99]"
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
  const matchup = session.currentMatchup && isMatchupEligible(session, session.currentMatchup)
    ? session.currentMatchup
    : chooseNextMatchup(session)
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
    <main className="flex flex-1 flex-col gap-3 px-3 pb-[calc(env(safe-area-inset-bottom)+6.75rem)] pt-2">
      <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-1.5">
        <GameCard game={leftGame} selectedBy={USERS.filter((user) => choices[user] === leftGame.id)} onNeverPlayed={() => neverPlayed(leftGame.id)} />
        <div className="flex items-center justify-center">
          <div className="rounded-full bg-saffron px-2 py-1 text-xs font-black text-white shadow-sm">OR</div>
        </div>
        <GameCard game={rightGame} selectedBy={USERS.filter((user) => choices[user] === rightGame.id)} onNeverPlayed={() => neverPlayed(rightGame.id)} />
      </div>

      <div className="space-y-2">
        {USERS.map((user) => (
          <div key={user} className="rounded-lg border border-amber-200 bg-white/80 p-2 shadow-sm">
            <div className="mb-1.5 px-1 text-sm font-black text-lagoon">{user}</div>
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
        className="min-h-12 rounded-md bg-berry px-5 text-xl font-black text-white shadow-lift disabled:bg-stone-300 disabled:text-stone-500"
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
  onDeleteSession,
  isImporting,
  error,
}: {
  state: AppState
  onOpenSession: (sessionId: string) => void
  onFinish: () => void
  onStart: (sessionName: string) => void
  onDeleteSession: (sessionId: string) => void
  isImporting: boolean
  error?: string
}) {
  const [expandedSessionId, setExpandedSessionId] = useState<string>()
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
            {activeSession.comparisons.length} comparisons - {activeSession.games.filter((game) => game.excluded).length} excluded
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
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-xl font-black text-ink">Finished sessions</h2>
          {finishedSessions.length > 0 && (
            <button
              type="button"
              onClick={() => exportAllTopFiveCsv(finishedSessions)}
              className="flex min-h-10 items-center justify-center gap-2 rounded-md bg-saffron px-3 text-sm font-black text-white"
            >
              <FileDown size={17} />
              Top 5s
            </button>
          )}
        </div>
        <div className="mt-3 space-y-3">
          {finishedSessions.length === 0 && (
            <p className="rounded-lg border border-amber-200 bg-white p-4 text-sm font-semibold text-stone-600">
              Finished sessions will appear here.
            </p>
          )}
          {finishedSessions.map((session) => {
            const stats = session.summary || summaryStats(session)
            const expanded = expandedSessionId === session.sessionId
            const topRows = topFiveRows(session)
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
                {expanded && (
                  <div className="mt-4 rounded-lg border border-amber-100 bg-linen p-3">
                    <div className="grid grid-cols-2 gap-2 text-sm font-semibold text-stone-700">
                      <div>Agreement: {stats.agreement}%</div>
                      <div>Divisive: {stats.mostDivisive}</div>
                    </div>
                    <div className="mt-3 overflow-hidden rounded-md border border-amber-200 bg-white">
                      <div className="grid grid-cols-[4.6rem_1fr_1fr_1fr] bg-mint text-xs font-black uppercase tracking-wide text-lagoon">
                        <div className="p-2">Rank</div>
                        <div className="p-2">Brian</div>
                        <div className="p-2">Sarah</div>
                        <div className="p-2">Combined</div>
                      </div>
                      {topRows.map(([rank, brian, sarah, combined]) => (
                        <div key={rank} className="grid grid-cols-[4.6rem_1fr_1fr_1fr] border-t border-amber-100 text-xs font-semibold text-stone-700">
                          <div className="p-2 font-black text-ink">{rank}</div>
                          <div className="min-w-0 truncate p-2">{brian}</div>
                          <div className="min-w-0 truncate p-2">{sarah}</div>
                          <div className="min-w-0 truncate p-2">{combined}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setExpandedSessionId(expanded ? undefined : session.sessionId)}
                    className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-mint px-3 text-sm font-black text-lagoon"
                  >
                    <BarChart3 size={18} />
                    Stats
                  </button>
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
                  <button
                    type="button"
                    onClick={() => exportTopFiveCsv(session)}
                    className="flex min-h-11 items-center justify-center gap-2 rounded-md bg-saffron px-3 text-sm font-black text-white"
                  >
                    <FileDown size={18} />
                    Top 5
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteSession(session.sessionId)}
                    className="flex min-h-11 items-center justify-center gap-2 rounded-md border border-clay/30 bg-blush px-3 text-sm font-black text-clay"
                  >
                    <Trash2 size={18} />
                    Delete
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

function BackupControls({ state, onRestore, recovery = false, hasLoadedData = true }: {
  state: AppState
  onRestore: (state: AppState) => void
  recovery?: boolean
  hasLoadedData?: boolean
}) {
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState<{ state: AppState; original: Record<string, string | null> }>()
  const [busy, setBusy] = useState(false)
  const [downloadFallback, setDownloadFallback] = useState<{ filename: string; contents: string }>()
  const buttonClass = 'min-h-12 rounded-md border border-amber-200 bg-white px-3 py-2 text-base font-bold text-lagoon'

  async function exportAll() {
    setMessage('')
    setDownloadFallback(undefined)
    try {
      const rawOnly = !hasLoadedData
      const contents = rawOnly
        ? JSON.stringify({ format: 'board-game-ranker-recovery', version: 1, exportedAt: new Date().toISOString(), storedData: readStoredData() }, null, 2)
        : exportBackup(state)
      const filename = `board-game-ranker-${rawOnly ? 'recovery' : 'backup'}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
      const file = new File([contents], filename, { type: 'application/json' })
      // Called directly from a tap, preserving Safari's user activation.
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Board Game Ranker backup' })
          setMessage('Use Save to Files in the share sheet to keep your backup.')
          return
        } catch (error) {
          if (error instanceof Error && error.name === 'AbortError') return
          // Some installed-app contexts advertise sharing but deny the call.
          // A second explicit tap also preserves user activation if an installed
          // app blocks the automatic download after an asynchronous share failure.
          setDownloadFallback({ filename, contents })
        }
      }
      downloadText(filename, contents, 'application/json')
      setMessage('Backup download requested. Check Downloads or Files before replacing any data.')
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return
      setMessage(error instanceof Error ? error.message : 'Backup export failed. Your saved data was not changed.')
    }
  }

  async function selectBackup(file?: File) {
    setPending(undefined)
    setMessage('')
    if (!file) return
    setBusy(true)
    try {
      // Capture before the asynchronous file read, then recheck on confirmation.
      const original = readStoredData()
      const restored = parseBackup(await file.text())
      setPending({ state: restored, original })
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'This backup could not be read.')
    } finally {
      setBusy(false)
    }
  }

  function confirmRestore() {
    if (!pending || !window.confirm('Replace all sessions on this device with this backup? Export your current data first. This cannot be undone in the app.')) return
    try {
      const restored = restoreBackup(pending.state, pending.original, true)
      onRestore(restored)
      setPending(undefined)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Restore failed. Existing data was not replaced.')
    }
  }

  return (
    <section aria-label="Data backup" className="mx-auto w-full max-w-md space-y-3 px-4 py-3">
      <div className="grid grid-cols-2 gap-2">
        <button type="button" className={buttonClass} onClick={exportAll}>{hasLoadedData ? 'Export Backup' : 'Export Saved Data'}</button>
        <label className={`${buttonClass} flex cursor-pointer items-center justify-center text-center`}>
          {busy ? 'Reading backup…' : 'Import Backup'}
          <input type="file" accept=".json,application/json" disabled={busy} className="sr-only" onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            void selectBackup(file)
          }} />
        </label>
      </div>
      {recovery && <p className="text-sm text-stone-700">{hasLoadedData ? 'Export Backup preserves the currently loaded data, including unsaved progress.' : 'Export Saved Data preserves the original stored text for recovery; a damaged recovery file is not a restorable backup.'} Import a complete backup only when you are ready to replace saved sessions.</p>}
      {pending && <div className="space-y-2 rounded-md border border-amber-200 bg-linen p-3">
        <p className="text-sm font-bold">Backup checked: {pending.state.sessions.length} sessions, {pending.state.sessions.reduce((n, session) => n + session.games.length, 0)} game entries, {pending.state.sessions.reduce((n, session) => n + session.comparisons.length, 0)} completed comparisons.</p>
        <p className="text-sm">Restoring replaces all current sessions. Export your current data first.</p>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" className={buttonClass} onClick={confirmRestore}>Restore Backup</button>
          <button type="button" className={buttonClass} onClick={() => setPending(undefined)}>Cancel</button>
        </div>
      </div>}
      {downloadFallback && <button type="button" className={buttonClass} onClick={() => downloadText(downloadFallback.filename, downloadFallback.contents, 'application/json')}>Download Backup</button>}
      {downloadFallback && <p className="text-sm text-stone-700">If no file appeared, tap Download Backup to save it directly.</p>}
      {message && <p role="status" className="break-words text-sm font-semibold text-clay">{message}</p>}
    </section>
  )
}

export default function App() {
  const [initial] = useState(() => {
    try { return { state: loadState(), warning: undefined as string | undefined, loaded: true } }
    catch (error) { return { state: createState(), warning: error instanceof Error ? error.message : 'Saved data could not be read.', loaded: false } }
  })
  const [state, setState] = useState<AppState>(initial.state)
  const [recoveryWarning, setRecoveryWarning] = useState(initial.warning)
  const [hasLoadedData, setHasLoadedData] = useState(initial.loaded)
  const [restoreNotice, setRestoreNotice] = useState('')
  const [screen, setScreen] = useState<Screen>('compare')
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState<string>()

  const activeSession = state.sessions.find((session) => session.sessionId === state.activeSessionId)

  useEffect(() => {
    if (recoveryWarning) return
    try { saveState(state) }
    catch (error) { setRecoveryWarning(error instanceof Error ? error.message : 'Progress could not be saved.') }
  }, [state, recoveryWarning])

  function acceptRestored(restored: AppState, notice = 'Backup restored. All sessions are available on this device.') {
    setRestoreNotice(notice)
    setState(restored)
    setHasLoadedData(true)
    setRecoveryWarning(undefined)
    setScreen('sessions')
  }

  function retryStorage() {
    if (hasLoadedData && !window.confirm('Reload the saved data on this device? Unsaved changes on this page will be discarded. Export Backup first to preserve them.')) return
    try { acceptRestored(loadState(), 'Saved data reloaded successfully.') }
    catch (error) { setRecoveryWarning(error instanceof Error ? error.message : 'Storage is still unavailable.') }
  }

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

  function deleteSession(sessionId: string) {
    const session = state.sessions.find((item) => item.sessionId === sessionId)
    if (!session) return
    if (!window.confirm(`Delete "${session.sessionName}" from this device? Export it first if you want a backup.`)) return
    setState((current) => ({
      sessions: current.sessions.filter((item) => item.sessionId !== sessionId),
      activeSessionId: current.activeSessionId === sessionId ? undefined : current.activeSessionId,
    }))
  }

  function clearAll() {
    if (!window.confirm('Delete all sessions from this device? Export Backup first. This cannot be undone.')) return
    resetState()
    setState(createState())
    setScreen('sessions')
  }

  if (recoveryWarning) {
    return <main className="mx-auto min-h-dvh max-w-md bg-paper px-3 py-10 text-ink">
      <div role="alert" className="space-y-3 rounded-md border border-clay/30 bg-blush p-4">
        <h1 className="text-2xl font-black">Saved data needs attention</h1>
        <p>{recoveryWarning}</p>
        <p>Automatic saving is paused. Existing saved data has not been cleared or replaced. Keep this page open if it contains unsaved progress.</p>
        <button type="button" className="min-h-12 rounded-md bg-white px-4 font-bold" onClick={retryStorage}>Retry Saved Data</button>
        <p className="text-sm">Retry reloads the device’s saved data. Export any loaded progress first; unsaved changes will be replaced when retry succeeds.</p>
      </div>
      <BackupControls state={state} onRestore={acceptRestored} recovery hasLoadedData={hasLoadedData} />
    </main>
  }

  if (!state.sessions.length) {
    return <>{restoreNotice && <p role="status" className="px-4 py-2 text-sm font-bold text-lagoon">{restoreNotice}</p>}<BackupControls state={state} onRestore={acceptRestored} /><StartSessionPanel onStart={startSession} isImporting={isImporting} error={error} /></>
  }

  return (
    <div className="flex min-h-dvh flex-col bg-paper/80 text-ink">
      <header className="sticky top-0 z-10 border-b border-amber-200 bg-linen/95 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.6rem)] backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-lagoon">Game Rank</div>
            <div className="text-sm font-bold text-stone-600">
              {activeSession ? `${activeSession.sessionName} - ${activeSession.comparisons.length} saved` : `${state.sessions.length} sessions saved`}
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

      {restoreNotice && <p role="status" className="px-4 py-2 text-sm font-bold text-lagoon">{restoreNotice}</p>}
      <BackupControls state={state} onRestore={acceptRestored} />

      {screen === 'compare' && activeSession && <CompareScreen session={activeSession} setSession={setActiveSession} />}
      {screen === 'rankings' && activeSession && <RankingsScreen session={activeSession} />}
      {screen === 'summary' && activeSession && <SummaryScreen session={activeSession} onFinish={finishActiveSession} />}
      {screen === 'sessions' && (
        <SessionsScreen
          state={state}
          onOpenSession={openSession}
          onFinish={finishActiveSession}
          onStart={startSession}
          onDeleteSession={deleteSession}
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
          onDeleteSession={deleteSession}
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
