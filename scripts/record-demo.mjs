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
const pause = ms => page.waitForTimeout(ms)
try {
  await page.goto((process.env.DEMO_URL || 'http://localhost:5173') + '/?groupBy=none', { waitUntil: 'networkidle' })
  await page.locator('[data-session-id]').first().waitFor()
  await pause(1000)
  await page.screenshot({ path: 'docs/images/dashboard.png' })
  await page.evaluate(() => {
    const style = document.createElement('style')
    style.textContent = 'html{overflow:hidden} body{transform-origin:0 0;will-change:transform} #demo-caption{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:14px 24px;border:1px solid #ffffff22;border-radius:16px;background:#101014ed;color:#fafafa;font:500 18px system-ui;box-shadow:0 12px 40px #0009;z-index:2147483646;white-space:nowrap;pointer-events:none} #demo-cursor{position:fixed;left:600px;top:500px;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 3px 4px #0009)}'
    document.head.append(style)
    const caption = document.createElement('div'); caption.id = 'demo-caption'; caption.textContent = 'All your Codex sessions. One local dashboard.'; document.documentElement.append(caption)
    const cursor = document.createElement('div'); cursor.id = 'demo-cursor'; cursor.innerHTML = '<svg width="28" height="32" viewBox="0 0 28 32"><path d="M3 2L23 19L14 20L10 29Z" fill="white" stroke="#18181b" stroke-width="2" stroke-linejoin="round"/></svg>'; document.documentElement.append(cursor)
  })
  const caption = text => page.evaluate(text => document.querySelector('#demo-caption').textContent = text, text)
  const move = async locator => {
    const box = await locator.boundingBox(); if (!box) throw new Error('Missing target')
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    await page.evaluate(async p => { const c = document.querySelector('#demo-cursor'); const old = c.getBoundingClientRect(); await c.animate([{ left: old.x+'px', top: old.y+'px' }, { left: p.x+'px', top: p.y+'px' }], { duration: 1100, easing: 'cubic-bezier(.22,1,.36,1)', fill: 'forwards' }).finished }, point)
    await page.mouse.move(point.x, point.y)
    return point
  }
  const click = async locator => {
    const p = await move(locator)
    await page.evaluate(p => { const ring = document.createElement('div'); Object.assign(ring.style, { position:'fixed',left:(p.x-18)+'px',top:(p.y-18)+'px',width:'36px',height:'36px',border:'2px solid #fbbf24',borderRadius:'50%',pointerEvents:'none',zIndex:2147483647 });document.documentElement.append(ring);ring.animate([{transform:'scale(.4)',opacity:1},{transform:'scale(1.5)',opacity:0}],{duration:650}).finished.then(()=>ring.remove()) }, p)
    await page.mouse.click(p.x, p.y)
  }
  const zoom = async (scale, x=0, y=0) => page.evaluate(async ({scale,x,y}) => { const b=document.body; const from=getComputedStyle(b).transform;await b.animate([{transform:from==='none'?'translate(0px,0px) scale(1)':from},{transform:`translate(${x}px,${y}px) scale(${scale})`}],{duration:1300,easing:'cubic-bezier(.22,1,.36,1)',fill:'forwards'}).finished },{scale,x,y})
  await pause(4000)
  await caption('See live activity across multiple projects')
  await move(page.locator('[data-session-id="demo-session-004"]'))
  await pause(3000)
  const needYou = page.getByRole('button', { name: 'Need you', exact: true })
  await caption('Need you: focus on sessions waiting for your input')
  await move(needYou)
  await zoom(1.18, -220, -10)
  await click(needYou)
  await expect(page.locator('[data-session-id]')).toHaveCount(3)
  await pause(4000)
  await zoom(1)
  await caption('Review approvals and questions in context')
  await move(page.locator('[data-session-id="demo-session-003"]'))
  await pause(3500)
  await caption('Return to every session with one click')
  await click(needYou)
  await expect(page.locator('[data-session-id]')).toHaveCount(12)
  await pause(2500)
  await caption('AgentHUD · Local. Codex-focused. Open source.')
  await pause(3000)
} finally { await context.close(); await browser.close() }
const video = await page.video().path()
execFileSync('ffmpeg', ['-y','-i',video,'-t','38','-c:v','libx264','-preset','medium','-crf','19','-pix_fmt','yuv420p','-movflags','+faststart','-an','docs/images/agenthud-demo.mp4'], { stdio: 'inherit' })
console.log('Saved docs/images/dashboard.png and docs/images/agenthud-demo.mp4')
