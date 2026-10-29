// Use a supplied Playwright installation; no browser profile or real user storage is reused.
const { chromium } = await import(process.env.BOARD_RANKER_PLAYWRIGHT_MODULE || '/opt/codex/cua_node/lib/node_modules/playwright-core/index.mjs')
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'

const root = new URL('..', import.meta.url).pathname
const temp = await mkdtemp(join(tmpdir(), 'ranker-ui-'))
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5174', '--strictPort'], { cwd: root, stdio: 'ignore' })
let browser
try {
  for (let i = 0; i < 60; i++) {
    try { if ((await fetch('http://127.0.0.1:5174/')).ok) break } catch {}
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'], timeout: 20000 })
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true })
  await context.addInitScript(() => { Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false }) })
  const page = await context.newPage()
  const key = 'board-game-ranker-state-v2'
  await page.goto('http://127.0.0.1:5174/')
  await page.evaluate((key) => localStorage.setItem(key, '{corrupted-original'), key)
  await page.reload()
  await page.getByRole('heading', { name: 'Saved data needs attention' }).waitFor()
  await page.waitForTimeout(200)
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), key), '{corrupted-original')
  const rawDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Saved Data', exact: true }).click()
  const rawFile = await (await rawDownload).path()
  assert.equal(JSON.parse(await readFile(rawFile, 'utf8')).storedData[key], '{corrupted-original')
  console.log('PASS: recovery warning pauses saving; raw recovery download preserves original text at mobile width')

  const date = '2026-10-29T12:00:00Z'
  const games = [0, 1, 2, 3, 4].map((id) => ({ id: String(id), title: `Game ${id}`, createdAt: date, ...(id === 4 ? { excluded: true, excludedReason: 'Never Played' } : {}) }))
  const ratings = {}
  for (const user of ['Brian', 'Sarah']) ratings[user] = Object.fromEntries(games.map((g, i) => [g.id, { elo: 1000 + i, comparisons: [80, 90, 5, 6, 0][i], wins: 0 }]))
  const session = { sessionId: 'restored', sessionName: 'Imported session', games, ratings, comparisons: [], status: 'active', createdAt: date, startedAt: date, importedAt: date, currentMatchup: { leftId: '0', rightId: '1' } }
  const backup = { format: 'board-game-ranker-backup', version: 1, state: { sessions: [session], activeSessionId: session.sessionId } }
  const file = join(temp, 'backup.json')
  await writeFile(file, JSON.stringify(backup))
  await page.locator('input[type=file]').setInputFiles(file)
  await page.getByText(/Backup checked: 1 sessions/).waitFor()
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), key), '{corrupted-original')
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), key), '{corrupted-original')
  await page.locator('input[type=file]').setInputFiles(file)
  await page.getByRole('button', { name: 'Restore Backup', exact: true }).waitFor()
  page.once('dialog', (dialog) => dialog.dismiss())
  await page.getByRole('button', { name: 'Restore Backup', exact: true }).click()
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), key), '{corrupted-original')
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Restore Backup', exact: true }).click()
  await page.getByText('Backup restored. All sessions are available on this device.').waitFor()
  const restored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key)
  assert.deepEqual(restored.sessions[0].ratings, ratings)
  assert.deepEqual(restored.sessions[0].games, games)
  assert.deepEqual(restored.sessions[0].currentMatchup, { leftId: '2', rightId: '3' })
  console.log('PASS: import previews without writing; cancel/dismiss preserve data; confirmed restore preserves counts, ratings, exclusions and reselects stale pair')

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Backup', exact: true }).click()
  const exported = JSON.parse(await readFile(await (await download).path(), 'utf8'))
  assert.deepEqual(exported.state.sessions[0].ratings, ratings)
  assert.deepEqual(exported.state.sessions[0].games, games)
  assert.equal(exported.state.sessions[0].sessionName, session.sessionName)
  const secondContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const otherDevice = await secondContext.newPage()
  await otherDevice.goto('http://127.0.0.1:5174/')
  await otherDevice.getByRole('button', { name: 'Export Backup', exact: true }).waitFor()
  const exportedFile = join(temp, 'exported.json')
  await writeFile(exportedFile, JSON.stringify(exported))
  await otherDevice.locator('input[type=file]').setInputFiles(exportedFile)
  await otherDevice.getByRole('button', { name: 'Restore Backup', exact: true }).waitFor()
  otherDevice.once('dialog', (dialog) => dialog.accept())
  await otherDevice.getByRole('button', { name: 'Restore Backup', exact: true }).click()
  await otherDevice.getByText('Backup restored. All sessions are available on this device.').waitFor()
  assert.deepEqual((await otherDevice.evaluate((key) => JSON.parse(localStorage.getItem(key)), key)).sessions[0].ratings, ratings)
  console.log('PASS: full backup downloads and restores in a separate browser storage context')

  await page.evaluate(() => {
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
    Object.defineProperty(navigator, 'share', { configurable: true, writable: true, value: async ({ files }) => { window.sharedBackup = JSON.parse(await files[0].text()) } })
  })
  await page.getByRole('button', { name: 'Export Backup', exact: true }).click()
  await page.getByText('Use Save to Files in the share sheet to keep your backup.').waitFor()
  assert.deepEqual((await page.evaluate(() => window.sharedBackup)).state.sessions[0].ratings, ratings)
  await page.evaluate(() => { navigator.share = async () => { throw new Error('Share unavailable') } })
  const fallback = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export Backup', exact: true }).click()
  assert.ok(await (await fallback).path())
  await page.getByRole('button', { name: 'Download Backup', exact: true }).waitFor()
  const explicitFallback = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download Backup', exact: true }).click()
  assert.ok(await (await explicitFallback).path())
  console.log('PASS: supported file-sharing path receives full backup; sharing failure provides automatic and explicit-tap downloads')

  await writeFile(file, '{broken-import')
  const before = await page.evaluate((key) => localStorage.getItem(key), key)
  await page.locator('input[type=file]').setInputFiles(file)
  await page.getByRole('status').filter({ hasText: /JSON/ }).waitFor()
  await page.waitForTimeout(100)
  assert.equal(await page.getByRole('button', { name: 'Restore Backup', exact: true }).count(), 0)
  assert.equal(await page.evaluate((key) => localStorage.getItem(key), key), before)
  console.log('PASS: malformed import exposes no restore action and preserves existing saved data')

  const deniedContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  await deniedContext.addInitScript(({ key, saved }) => {
    localStorage.setItem(key, saved)
    const read = Storage.prototype.getItem
    const write = Storage.prototype.setItem
    window.readOriginal = () => read.call(localStorage, key)
    window.denyReads = true
    window.saveAttempts = 0
    Storage.prototype.getItem = function (name) {
      if (window.denyReads) throw new DOMException('Denied', 'SecurityError')
      return read.call(this, name)
    }
    Storage.prototype.setItem = function (name, value) {
      window.saveAttempts++
      return write.call(this, name, value)
    }
  }, { key, saved: JSON.stringify(backup.state) })
  const denied = await deniedContext.newPage()
  await denied.goto('http://127.0.0.1:5174/')
  await denied.getByRole('heading', { name: 'Saved data needs attention' }).waitFor()
  assert.equal(await denied.evaluate(() => window.saveAttempts), 0)
  assert.equal(await denied.evaluate(() => window.readOriginal()), JSON.stringify(backup.state))
  await denied.evaluate(() => { window.denyReads = false })
  await denied.getByRole('button', { name: 'Retry Saved Data', exact: true }).click()
  await denied.getByText('Saved data reloaded successfully.').waitFor()
  assert.deepEqual((await denied.evaluate((key) => JSON.parse(localStorage.getItem(key)), key)).sessions[0].ratings, ratings)
  console.log('PASS: unreadable storage causes no autosave; explicit retry restores access without losing counts')

  const quotaContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, acceptDownloads: true })
  await quotaContext.addInitScript(({ key, saved }) => {
    localStorage.setItem(key, saved)
    Storage.prototype.setItem = () => { throw new DOMException('Storage full', 'QuotaExceededError') }
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => false })
  }, { key, saved: JSON.stringify(backup.state) })
  const quota = await quotaContext.newPage()
  await quota.goto('http://127.0.0.1:5174/')
  await quota.getByRole('heading', { name: 'Saved data needs attention' }).waitFor()
  assert.equal(await quota.evaluate((key) => localStorage.getItem(key), key), JSON.stringify(backup.state))
  const quotaExport = quota.waitForEvent('download')
  await quota.getByRole('button', { name: 'Export Backup', exact: true }).click()
  assert.deepEqual(JSON.parse(await readFile(await (await quotaExport).path(), 'utf8')).state.sessions[0].ratings, ratings)
  console.log('PASS: quota failure shows recovery while preserving saved data and allowing loaded-data backup')
} finally {
  await browser?.close()
  server.kill('SIGTERM')
  await rm(temp, { recursive: true, force: true })
}
