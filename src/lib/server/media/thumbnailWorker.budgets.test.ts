// Timing: while one 2,000 x 2,000 thumbnail is made, how long does the event
// loop go without a turn? Runs only under `npm run test:budgets`.
import { afterEach, expect, test, vi } from "vitest"
import { PNG } from "pngjs"
import { makeThumbnail } from "./thumbnail"
import { __setThumbnailWorkerForTests } from "./thumbnailWorker"

afterEach(() => __setThumbnailWorkerForTests())

function noisyPng(size: number): Buffer {
	const p = new PNG({ width: size, height: size })
	let s = 12345
	for (let i = 0; i < p.data.length; i++) {
		s = (Math.imul(s, 1664525) + 1013904223) >>> 0
		p.data[i] = i % 4 === 3 ? 255 : s >>> 24
	}
	return PNG.sync.write(p)
}

async function measure(png: Buffer) {
	let last = performance.now()
	let gap = 0
	let running = true
	const ticker = (async () => {
		while (running) {
			await new Promise<void>((r) => setTimeout(r, 0))
			const now = performance.now()
			gap = Math.max(gap, now - last)
			last = now
		}
	})()
	const t0 = performance.now()
	last = t0
	await makeThumbnail(png, "image/png")
	const total = performance.now() - t0
	running = false
	await ticker
	return { gap, total }
}

test("the thumbnail worker keeps the event loop turning", async () => {
	vi.spyOn(console, "warn").mockImplementation(() => {})
	const png = noisyPng(2000)
	const inThreadSource = {
		source: 'throw new Error("in-thread for this test")'
	}

	__setThumbnailWorkerForTests(inThreadSource)
	await makeThumbnail(png, "image/png")
	const inThread = await measure(png)

	__setThumbnailWorkerForTests()
	await makeThumbnail(png, "image/png")
	const worker = await measure(png)

	console.log(
		`[budget] largest event-loop gap: in-thread ${inThread.gap.toFixed(1)} ms ` +
			`(job ${inThread.total.toFixed(0)} ms), thumbnail worker ${worker.gap.toFixed(1)} ms ` +
			`(job ${worker.total.toFixed(0)} ms)`
	)
	expect(worker.gap).toBeLessThanOrEqual(25)
	expect(inThread.gap).toBeGreaterThan(worker.gap)
}, 120_000)
