// Usage: node shake-1-sweep.mjs <baseUrl> <sessionId>
// Sweeps the viewport height 1px at a time at widths 1920, 1536 and 1366 and
// prints every size at which a widget box's clientWidth or the
// `.layout-center` box alternates over 30 animation frames. Needs scrollbars
// that take width: runs headed, never with --hide-scrollbars.
import { chromium } from "playwright"

const [base, sessionId] = process.argv.slice(2)
if (!base || !sessionId) {
	console.error("usage: node shake-1-sweep.mjs <baseUrl> <sessionId>")
	process.exit(2)
}
const SWEEPS = [
	{ width: 1920, from: 1010, to: 850 },
	{ width: 1536, from: 860, to: 700 },
	{ width: 1366, from: 780, to: 620 }
]
const FRAMES = 30

const browser = await chromium.launch({
	headless: false,
	ignoreDefaultArgs: ["--hide-scrollbars"]
})
const page = await browser.newPage({ viewport: { width: 1920, height: 1010 } })
await page.goto(`${base.replace(/\/$/, "")}/sessions/${sessionId}`)
await page.waitForSelector("[data-sp-widget-box]", { timeout: 60000 })

const probe = await page.evaluate(() => {
	const d = document.createElement("div")
	d.style.cssText = "overflow:scroll;width:100px;height:100px;position:absolute;left:-999px"
	document.body.appendChild(d)
	const w = d.offsetWidth - d.clientWidth
	d.remove()
	return w
})
if (!(probe > 0)) {
	console.error(`scrollbars take no width here (probe ${probe}); the sweep proves nothing`)
	await browser.close()
	process.exit(2)
}
console.log(`scrollbar probe: ${probe}px`)

const sample = (frames) =>
	page.evaluate(
		(n) =>
			new Promise((resolve) => {
				const seen = {}
				let i = 0
				const take = () => {
					document.querySelectorAll("[data-sp-widget-box]").forEach((el, k) => {
						const key = `box#${k} ${el.getAttribute("aria-label") ?? ""}`
						;(seen[key] ??= new Set()).add(el.clientWidth)
					})
					const c = document.querySelector(".layout-center")
					if (c) {
						const r = c.getBoundingClientRect()
						;(seen["layout-center"] ??= new Set()).add(
							`${r.left.toFixed(1)},${r.width.toFixed(1)}`
						)
					}
					if (++i < n) requestAnimationFrame(take)
					else resolve(Object.fromEntries(Object.entries(seen).map(([k, v]) => [k, [...v]])))
				}
				requestAnimationFrame(take)
			}),
		frames
	)

let unstable = 0
for (const { width, from, to } of SWEEPS) {
	for (let height = from; height >= to; height--) {
		await page.setViewportSize({ width, height })
		await page.waitForTimeout(60)
		const seen = await sample(FRAMES)
		for (const [key, values] of Object.entries(seen)) {
			if (values.length > 1) {
				unstable++
				console.log(`UNSTABLE ${width}x${height} ${key}: ${values.join(" | ")}`)
			}
		}
	}
	console.log(`done width ${width}`)
}
console.log(unstable === 0 ? "stable at every size" : `${unstable} unstable samples`)
await browser.close()
process.exit(unstable === 0 ? 0 : 1)
