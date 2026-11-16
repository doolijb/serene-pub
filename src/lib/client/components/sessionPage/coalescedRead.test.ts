import { describe, expect, test } from "vitest"
import { coalescedRead } from "./sessionPageData.svelte"

function deferred() {
	let done!: () => void
	const promise = new Promise<void>((r) => (done = r))
	return { promise, done }
}
const tick = () => new Promise((r) => setTimeout(r, 0))

describe("coalescedRead", () => {
	test("one request reads once", async () => {
		let reads = 0
		const request = coalescedRead(async () => void reads++)
		request()
		await tick()
		expect(reads).toBe(1)
	})

	test("three requests during one read make exactly one more read", async () => {
		let reads = 0
		const gates = [deferred(), deferred(), deferred()]
		const request = coalescedRead(() => gates[reads++].promise)
		request()
		request()
		request()
		request()
		expect(reads).toBe(1)
		gates[0].done()
		await tick()
		expect(reads).toBe(2)
		gates[1].done()
		await tick()
		expect(reads).toBe(2)
	})

	test("a failed read does not stop the next", async () => {
		let reads = 0
		const request = coalescedRead(async () => {
			reads++
			throw new Error("x")
		})
		request()
		await tick()
		request()
		await tick()
		expect(reads).toBe(2)
	})
})
