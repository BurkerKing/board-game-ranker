import { Check, Download, RefreshCcw, Trophy } from 'lucide-react'
import type { Dispatch, SetStateAction } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { importGamesFromSheet } from './importSheet'
import { applyComparison, chooseNextMatchup, excludeGame, rankedGames, summaryStats } from './ranking'
import { createState, loadState, resetState, saveState } from './storage'
import type { AppState, Game, RankingTab, UserName } from './types'

type Screen = 'compare' | 'rankings' | 'summary'
type Choices = Record<UserName, string | undefined>

const USERS: UserName[] = ['Brian', 'Sarah']

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
        selectedBy.length ? 'border-moss ring-4 ring-moss/20' : 'border-stone-200'
      }`}
    >
      <div className="relative flex aspect-[3/4] items-center justify-center bg-stone-100">
        {game.thumbnailUrl ? (
          <img
            src={game.thumbnailUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="eager"
            onError={(event: React.SyntheticEvent<HTMLImageElement>) => {
              event.currentTarget.style.display = 'none'
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-stone-100 to-amber-50 px-3 text-center text-sm font-semibold text-stone-500">
            {game.title}
          </div>
        )}
        {selectedBy.length > 0 && (
          <div className="absolute right-2 top-2 flex h-10 w-10 items-center justify-center rounded-full bg-moss text-white shadow-soft">
            <Check size={25} strokeWidth={3} />
          </div>
        )}
      </div>
      <div className="flex flex-1 flex-col justify-between gap-3 p-3">
        <h2 className="text-balance text-center text-lg font-bold leading-tight text-ink">{game.title}</h2>
        <button
          type="button"
          onClick={onNeverPlayed}
          className="min-h-11 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-700 active:scale-[0.99]"
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
          ? 'border-moss bg-moss text-white shadow-soft'
          : 'border-stone-300 bg-white text-ink hover:border-stone-400'
      }`}
      aria-pressed={active}
    >
      {active && <Check size={20} strokeWidth={3} />}
      {user}
      <span className="sr-only">chooses {side}</span>
    </button>
  )
}

function ImportPanel({ onImport, isImporting, error }: { onImport: () => void; isImporting: boolean; error?: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-10">
      <div className="space-y-6">
        <div>
          <p className="text-sm font-bold uppercase tracking-wide text-moss">Brian and Sarah</p>
          <h1 className="mt-2 text-4xl font-black leading-tight text-ink">Board game preference ranking</h1>
          <p className="mt-4 text-lg leading-relaxed text-stone-700">
            Import the collection, then compare two games at a time. Progress saves automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={onImport}
          disabled={isImporting}
          className="flex min-h-14 w-full items-center justify-center gap-3 rounded-md bg-ink px-5 text-lg font-bold text-white shadow-soft disabled:cursor-wait disabled:opacity-70"
        >
          <Download size={22} />
          {isImporting ? 'Importing games...' : 'Import Google Sheet'}
        </button>
        {error && <p className="rounded-md border border-clay/30 bg-clay/10 p-3 text-sm font-semibold text-clay">{error}</p>}
      </div>
    </main>
  )
}

function CompareScreen({
  state,
  setState,
}: {
  state: AppState
  setState: Dispatch<SetStateAction<AppState>>
}) {
  const matchup = state.currentMatchup || chooseNextMatchup(state)
  const left = state.games.find((game) => game.id === matchup?.leftId)
  const right = state.games.find((game) => game.id === matchup?.rightId)
  const [choices, setChoices] = useState<Choices>({ Brian: undefined, Sarah: undefined })
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    setChoices({ Brian: undefined, Sarah: undefined })
  }, [matchup?.leftId, matchup?.rightId])

  if (!left || !right) {
    return (
      <section className="flex flex-1 items-center justify-center px-5 text-center">
        <div>
          <Trophy className="mx-auto text-moss" size={42} />
          <h2 className="mt-3 text-2xl font-black text-ink">No more matchups available</h2>
          <p className="mt-2 text-stone-600">Add more games or check the summary.</p>
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
    setState((current) => applyComparison(current, leftGame.id, rightGame.id, choices as Record<UserName, string>))
    window.setTimeout(() => setSubmitting(false), 300)
  }

  function neverPlayed(gameId: string) {
    setState((current) => excludeGame(current, gameId, 'Never Played'))
  }

  return (
    <main className="flex flex-1 flex-col gap-4 px-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-3">
      <div className="grid grid-cols-[1fr_auto_1fr] items-stretch gap-2">
        <GameCard
          game={left}
          selectedBy={USERS.filter((user) => choices[user] === left.id)}
          onNeverPlayed={() => neverPlayed(left.id)}
        />
        <div className="flex items-center justify-center">
          <div className="rounded-full bg-white px-2 py-1 text-xs font-black text-stone-500 shadow-sm">OR</div>
        </div>
        <GameCard
          game={right}
          selectedBy={USERS.filter((user) => choices[user] === right.id)}
          onNeverPlayed={() => neverPlayed(right.id)}
        />
      </div>

      <div className="space-y-3">
        {USERS.map((user) => (
          <div key={user} className="rounded-lg border border-stone-200 bg-white/70 p-2">
            <div className="mb-2 px-1 text-sm font-black text-stone-600">{user}</div>
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
        className="min-h-14 rounded-md bg-clay px-5 text-xl font-black text-white shadow-soft disabled:bg-stone-300 disabled:text-stone-500"
      >
        OK
      </button>
    </main>
  )
}

function RankingsScreen({ state }: { state: AppState }) {
  const [tab, setTab] = useState<RankingTab>('combined')
  const rankings = useMemo(() => rankedGames(state, tab), [state, tab])

  return (
    <main className="flex-1 px-4 pb-24 pt-4">
      <div className="mb-4 grid grid-cols-3 rounded-lg border border-stone-200 bg-white p-1">
        {[
          ['combined', 'Combined'],
          ['Brian', 'Brian'],
          ['Sarah', 'Sarah'],
        ].map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value as RankingTab)}
            className={`min-h-10 rounded-md text-sm font-black ${tab === value ? 'bg-ink text-white' : 'text-stone-600'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        {rankings.map(({ game, rating }, index) => (
          <div key={game.id} className="grid grid-cols-[2.2rem_3rem_1fr_auto] items-center gap-3 rounded-lg border border-stone-200 bg-white p-2">
            <div className="text-center text-lg font-black text-stone-500">{index + 1}</div>
            <div className="flex aspect-square items-center justify-center overflow-hidden rounded-md bg-stone-100 text-xs font-bold text-stone-500">
              {game.thumbnailUrl ? <img src={game.thumbnailUrl} alt="" className="h-full w-full object-cover" loading="lazy" /> : game.title.slice(0, 1)}
            </div>
            <div className="min-w-0">
              <div className="truncate font-black text-ink">{game.title}</div>
              <div className="text-sm font-semibold text-stone-500">{rating.comparisons} comparisons</div>
            </div>
            <div className="text-right text-lg font-black text-moss">{rating.elo}</div>
          </div>
        ))}
      </div>
    </main>
  )
}

function SummaryScreen({ state }: { state: AppState }) {
  const stats = summaryStats(state)
  return (
    <main className="flex-1 px-5 pb-24 pt-5">
      <h1 className="text-3xl font-black text-ink">Session summary</h1>
      <div className="mt-5 grid gap-3">
        {[
          ['Comparisons completed', stats.comparisons],
          ['Games excluded', stats.excluded],
          ['Brian/Sarah agreement', `${stats.agreement}%`],
          ['Most divisive game', stats.mostDivisive],
          ['Top shared game', stats.topShared],
        ].map(([label, value]) => (
          <div key={label} className="rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
            <div className="text-sm font-bold uppercase tracking-wide text-stone-500">{label}</div>
            <div className="mt-1 text-2xl font-black text-ink">{value}</div>
          </div>
        ))}
      </div>
    </main>
  )
}

export default function App() {
  const [state, setState] = useState<AppState>(() => loadState())
  const [screen, setScreen] = useState<Screen>('compare')
  const [isImporting, setIsImporting] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    saveState(state)
  }, [state])

  async function handleImport() {
    setIsImporting(true)
    setError(undefined)
    try {
      const games = await importGamesFromSheet()
      setState(createState(games))
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Import failed. Check the sheet sharing settings.')
    } finally {
      setIsImporting(false)
    }
  }

  function clearAll() {
    resetState()
    setState(createState())
    setScreen('compare')
  }

  if (!state.games.length) {
    return <ImportPanel onImport={handleImport} isImporting={isImporting} error={error} />
  }

  return (
    <div className="flex min-h-dvh flex-col bg-paper text-ink">
      <header className="sticky top-0 z-10 border-b border-stone-200 bg-paper/95 px-4 pb-2 pt-[calc(env(safe-area-inset-top)+0.6rem)] backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-black uppercase tracking-wide text-moss">Game Rank</div>
            <div className="text-sm font-bold text-stone-600">{state.history.length} comparisons saved</div>
          </div>
          <button
            type="button"
            onClick={clearAll}
            className="flex h-10 w-10 items-center justify-center rounded-md border border-stone-300 bg-white text-stone-700"
            aria-label="Reset app"
            title="Reset app"
          >
            <RefreshCcw size={18} />
          </button>
        </div>
      </header>

      {screen === 'compare' && <CompareScreen state={state} setState={setState} />}
      {screen === 'rankings' && <RankingsScreen state={state} />}
      {screen === 'summary' && <SummaryScreen state={state} />}

      <nav className="fixed bottom-0 left-0 right-0 z-20 border-t border-stone-200 bg-white/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.4rem)] pt-2 backdrop-blur">
        <div className="mx-auto grid max-w-md grid-cols-3 gap-2">
          {[
            ['compare', 'Compare'],
            ['rankings', 'Rankings'],
            ['summary', 'Summary'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setScreen(value as Screen)}
              className={`min-h-11 rounded-md text-sm font-black ${
                screen === value ? 'bg-ink text-white' : 'bg-stone-100 text-stone-600'
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
