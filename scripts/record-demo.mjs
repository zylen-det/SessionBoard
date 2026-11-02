import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
const require = createRequire(new URL('../apps/web/package.json', import.meta.url))
const { chromium, expect } = require('@playwright/test')
const cache = path.join(os.homedir(), '.cache/ms-playwright')
const executablePath = process.env.CHROMIUM_PATH || fs.readdirSync(cache).filter(n => n.startsWith('chromium-')).sort().reverse().map(n => path.join(cache, n, 'chrome-linux64/chrome')).find(p => fs.existsSync(p))
fs.mkdirSync('artifacts/demo-recording', { recursive: true })
fs.mkdirSync('docs/images', { recursive: true })
const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1.25, colorScheme: 'dark', recordVideo: { dir: 'artifacts/demo-recording', size: { width: 1280, height: 800 } } })
const page = await context.newPage()
page.setDefaultTimeout(10000)
const pause = ms => page.waitForTimeout(ms)
try {
  await page.goto((process.env.DEMO_URL || 'http://localhost:5173') + '/?groupBy=none', { waitUntil: 'networkidle' })
  await page.locator('[data-session-id]').first().waitFor()
  await expect(page).toHaveTitle('Session Board')
  await expect(page.getByRole('banner')).toContainText('Session Board')
  await pause(1000)
  await page.screenshot({ path: 'docs/images/dashboard.png' })
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.textContent = 'html{overflow:hidden} body{transform-origin:0 0;will-change:transform} #demo-cursor{position:fixed;left:600px;top:500px;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 3px 4px #0009)}'
    document.head.append(style)
    const cursor = document.createElement('div')
    cursor.id = 'demo-cursor'
    cursor.innerHTML = '<svg width="28" height="32" viewBox="0 0 28 32"><path d="M3 2L23 19L14 20L10 29Z" fill="white" stroke="#18181b" stroke-width="2" stroke-linejoin="round"/></svg>'
    document.documentElement.append(cursor)
  })
  const move = async locator => {
    await locator.scrollIntoViewIfNeeded()
    const box = await locator.boundingBox(); if (!box) throw new Error('Missing target')
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    await page.evaluate(async p => { const c = document.querySelector('#demo-cursor'); const old = c.getBoundingClientRect(); await c.animate([{ left: old.x+'px', top: old.y+'px' }, { left: p.x+'px', top: p.y+'px' }], { duration: 500, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' }).finished }, point)
    await page.mouse.move(point.x, point.y)
    return point
  }
  const click = async locator => {
    const p = await move(locator)
    await page.evaluate(p => { const ring = document.createElement('div'); Object.assign(ring.style, { position:'fixed',left:(p.x-18)+'px',top:(p.y-18)+'px',width:'36px',height:'36px',border:'2px solid #fbbf24',borderRadius:'50%',pointerEvents:'none',zIndex:2147483647 });document.documentElement.append(ring);ring.animate([{transform:'scale(.4)',opacity:1},{transform:'scale(1.5)',opacity:0}],{duration:650}).finished.then(()=>ring.remove()) }, p)
    await page.mouse.click(p.x, p.y)
  }
  const zoom = async (scale, x=0, y=0) => page.evaluate(async ({scale,x,y}) => { const b=document.body; const from=getComputedStyle(b).transform;await b.animate([{transform:from==='none'?'translate(0px,0px) scale(1)':from},{transform:`translate(${x}px,${y}px) scale(${scale})`}],{duration:700,easing:'cubic-bezier(.22,1,.36,1)',fill:'forwards'}).finished },{scale,x,y})
  // Each completed view stays on screen for two seconds; transitions are separate.
  const hold = () => pause(2000)
  const tab = name => page.getByRole('tab', { name, exact: true })
  await hold()

  // Reduce the board to sessions requiring a decision.
  const needYou = page.getByRole('button', { name: 'Need you', exact: true })
  await zoom(1.12, -150, -5)
  await click(needYou)
  await expect(page.locator('[data-session-id]')).toHaveCount(3)
  await hold()
  await move(page.locator('[data-session-id="demo-session-003"]'))
  await hold()
  await zoom(1)

  // Inspect the selected session, its conversation, and its task checklist.
  await click(page.locator('[data-session-id="demo-session-001"] .session-title'))
  await expect(tab('Overview')).toBeVisible()
  await click(tab('Overview'))
  await hold()
  await zoom(1.1, -128, -40)
  await click(tab('Chat'))
  await expect(page.getByText('The implementation follows the existing React and TypeScript patterns.', { exact: false }).first()).toBeVisible()
  await hold()
  await click(tab('Tasks'))
  await expect(tab('Tasks')).toHaveAttribute('aria-selected', 'true')
  await hold()
  await zoom(1)
  await click(page.getByRole('button', { name: 'Close detail panel', exact: true }))
  await click(needYou)
  await expect(page.locator('[data-session-id]')).toHaveCount(12)

  // Search for related sessions, then group the entire board by project/branch.
  await click(page.getByRole('button', { name: 'Filters', exact: true }))
  const filters = page.getByRole('dialog', { name: 'Board filters' })
  const search = filters.getByRole('textbox', { name: 'Search sessions', exact: true })
  await click(search)
  await search.pressSequentially('OAuth', { delay: 100 })
  await expect(page.locator('[data-session-id]')).toHaveCount(3)
  await click(filters.getByRole('button', { name: 'Close filters', exact: true }))
  await hold()
  await click(page.getByRole('button', { name: 'Filters', exact: true }))
  await click(filters.getByRole('button', { name: 'Clear filters', exact: true }))
  const grouping = page.getByRole('combobox', { name: 'Group', exact: true })
  await move(grouping)
  await grouping.selectOption('project-branch')
  await click(filters.getByRole('button', { name: 'Close filters', exact: true }))
  await expect(page.locator('[data-project-group]')).toHaveCount(4)
  await hold()
  console.log('Verified overview, Need you, question, session details, chat, tasks, search, and project/branch grouping')
} finally { await context.close(); await browser.close() }
const video = await page.video().path()
execFileSync('ffmpeg', ['-y','-i',video,'-c:v','libx264','-preset','medium','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart','-an','docs/images/session-board-demo.mp4'], { stdio: 'inherit' })
console.log('Saved docs/images/dashboard.png and docs/images/session-board-demo.mp4')
