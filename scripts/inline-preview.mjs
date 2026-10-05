// Turns the preview build into one self-contained HTML page (CSS and JS inlined).
import fs from 'node:fs'
import path from 'node:path'

const dist = 'dist-preview'
const html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8')
const read = (href) => fs.readFileSync(path.join(dist, href.replace(/^\.?\//, '')), 'utf8')

const css = [...html.matchAll(/<link rel="stylesheet"[^>]*href="([^"]+)"/g)].map((m) => read(m[1])).join('\n')
const js = [...html.matchAll(/<script type="module"[^>]*src="([^"]+)"/g)].map((m) => read(m[1])).join('\n')

const out = `<title>Manika Exhibition</title>
<meta name="theme-color" content="#2a1245">
<style>${css}</style>
<div id="root"></div>
<script type="module">${js.replace(/<\/script/gi, '<\\/script')}</script>
`
fs.writeFileSync(path.join(dist, 'manika-preview.html'), out)
console.log(`dist-preview/manika-preview.html  ${(out.length / 1024).toFixed(0)} KB`)
