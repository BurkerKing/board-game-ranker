import type { Game } from './types'

const SHEET_ID = '1OATCavnc3lgVzES7GdzxsXr6OUBoNhfRB6EHbu_R7_M'
const CSV_URLS = [
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`,
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&sheet=Sheet1`,
  `https://docs.google.com/spreadsheets/d/e/${SHEET_ID}/pub?output=csv`,
]

function parseNumber(value: string): number | undefined {
  const parsed = Number(value.replace(/[^0-9.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : undefined
}

function parseImageUrl(value: string): string | undefined {
  const url = value.trim()
  return /^https?:\/\//i.test(url) ? url : undefined
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]
    const next = text[i + 1]
    if (char === '"' && inQuotes && next === '"') {
      cell += '"'
      i += 1
    } else if (char === '"') {
      inQuotes = !inQuotes
    } else if (char === ',' && !inQuotes) {
      row.push(cell)
      cell = ''
    } else if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
    } else {
      cell += char
    }
  }
  if (cell || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

function slugifyTitle(title: string) {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

export async function importGamesFromSheet(): Promise<Game[]> {
  let csv = ''
  let lastError = ''

  for (const url of CSV_URLS) {
    try {
      const response = await fetch(url, { cache: 'no-store' })
      if (!response.ok) {
        lastError = `Google returned ${response.status}.`
        continue
      }
      const text = await response.text()
      if (text.includes('<!DOCTYPE html') || text.includes('<html')) {
        lastError = 'Google returned a web page instead of CSV.'
        continue
      }
      csv = text
      break
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'The browser blocked the sheet request.'
    }
  }

  if (!csv) {
    throw new Error(
      `${lastError || 'Could not load the Google Sheet.'} Make sure the sheet is shared as “Anyone with the link can view”.`,
    )
  }

  const rows = parseCsv(csv).filter((row) => row.some(Boolean))
  const dataRows = rows[0]?.[0]?.toLowerCase().includes('game') ? rows.slice(1) : rows
  const now = new Date().toISOString()

  const games: Game[] = []

  dataRows.forEach((row, index) => {
      const title = row[0]?.trim()
      if (!title) return
      const playerCounts = row
        .slice(3, 11)
        .map((value, playerIndex) => (value.trim() ? playerIndex + 1 : undefined))
        .filter((value): value is number => Boolean(value))

      games.push({
        id: `${slugifyTitle(title)}-${index}`,
        title,
        bggRating: parseNumber(row[1] || ''),
        ourRating: parseNumber(row[2] || ''),
        playerCounts,
        bestPlayerCount: row[11]?.trim() || undefined,
        playedCount: parseNumber(row[12] || ''),
        lastPlayed: row[13]?.trim() || undefined,
        thumbnailUrl: parseImageUrl(row[14] || ''),
        createdAt: now,
      })
    })

  return games
}
