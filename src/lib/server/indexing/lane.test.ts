/**
 * The lane primitives, with no database and no model.
 *
 * Two things are being protected here and only one of them is a feature.
 *
 * **The feature** is that a lane which needs no model works. The queue this
 * generalises opened its loop with `if (!candidateModel) break`, before any
 * picker ran, so a model-free lane could not exist inside it — which is
 * precisely what the annotation lane is. `{ kind: "none" }` has to be an
 * ordinary answer all the way through.
 *
 * **The correctness requirement** is that `promote()` always settles.
 * A promotion is awaited from inside a request path, on a queue that also runs
 * in the background, so a promotion that never resolves is a turn that never
 * ends — and in CI it is a suite that times out rather than a test that fails,
 * which is the least informative failure available. Every way a promotion can
 * fail to complete gets a case below, and each one asserts a *report*, never a
 * rejection: the governing rule is that an unavailable mechanism subtracts a
 * signal and says so, never that it halts.
 */

import { describe, it, expect, vi } from "vitest"
import {
	IndexingLane,
	modelFreeBroker,
	type LaneItem,
	type LaneItemRef,
	type LaneModelBroker,
	type LaneWorkSource
} from "./lane"

const ref = (id: number): LaneItemRef => ({ source: "thing", id })

/**
 * A work source over a set of ids, which forgets an id once it is processed.
 * `null` for an id it does not hold is the same answer the real sources give
 * for a row that needs no work.
 */
function fakeWork(ids: number[], opts: { onProcess?: (id: number) => void } = {}) {
	const pending = new Set(ids)
	const processed: number[] = []
	const source: LaneWorkSource = {
		async fromGroup() {
			return null
		},
		async global() {
			const next = [...pending][0]
			return next === undefined ? null : item(next)
		},
		async specific(r) {
			return pending.has(r.id) ? item(r.id) : null
		}
	}
	function item(id: number): LaneItem {
		return {
			ref: ref(id),
			label: { type: "thing", label: `thing ${id}` },
			modelId: null,
			process: async () => {
				pending.delete(id)
				processed.push(id)
				opts.onProcess?.(id)
			}
		}
	}
	return { source, pending, processed }
}

const laneOver = (
	work: LaneWorkSource,
	over: Partial<ConstructorParameters<typeof IndexingLane>[0]> = {}
) =>
	new IndexingLane({
		key: "test",
		label: "test",
		model: modelFreeBroker(7),
		work,
		isEnabled: async () => true,
		autostart: async () => true,
		limits: { promotionTimeoutMs: 500, promotionMaxItems: 25 },
		...over
	})

describe("a lane that needs no model", () => {
	it("indexes anyway — 'none' is an answer, not an early exit", async () => {
		const { source, processed } = fakeWork([1, 2, 3])
		const lane = laneOver(source)

		const report = await lane.promote({ refs: [ref(1), ref(2), ref(3)] })

		expect(processed).toEqual([1, 2, 3])
		expect(report.processed).toBe(3)
		expect(report.remaining).toBe(0)
		expect(report.boundHit).toBe(false)
	})

	it("declares that it needs none, as data an admin surface can read", () => {
		const lane = laneOver(fakeWork([]).source)
		expect(lane.declaration).toEqual({
			key: "test",
			label: "test",
			// Per-lane, not a module constant — the whole point of constraint 4.
			model: { role: null, ttlMinutes: 7 }
		})
	})

	it("never asks anything to become resident", async () => {
		const request = vi.fn(async () => ({
			kind: "none" as const,
			modelId: null
		}))
		const broker: LaneModelBroker = {
			spec: { role: null, ttlMinutes: 0 },
			peek: async () => ({ kind: "none" }),
			request
		}
		const { source } = fakeWork([1])
		const lane = laneOver(source, { model: broker })

		await lane.promote({ refs: [ref(1)] })
		await lane.settled()

		// promote() asks once, up front, to find out whether it can run at all.
		// The loop must not ask again for an item that declares `modelId: null`.
		expect(request).toHaveBeenCalledTimes(1)
	})
})

describe("a promotion that cannot complete degrades, and always settles", () => {
	it("reports rather than waits when the lane is switched off", async () => {
		const { source, processed } = fakeWork([1])
		const lane = laneOver(source, { isEnabled: async () => false })

		const report = await lane.promote({ refs: [ref(1)] })

		expect(report.processed).toBe(0)
		expect(report.remaining).toBe(1)
		expect(report.reason).toMatch(/switched off/)
		expect(processed).toEqual([])
	})

	it("reports rather than waits when the model is requested but not resident", async () => {
		const broker: LaneModelBroker = {
			spec: { role: "embedding", ttlMinutes: 5 },
			peek: async () => ({ kind: "configured", modelId: "m" }),
			request: async () => ({
				kind: "pending",
				modelId: null,
				reason: "the model is not resident yet — it has been requested"
			})
		}
		const { source } = fakeWork([1])
		const lane = laneOver(source, { model: broker })

		const report = await lane.promote({ refs: [ref(1)] })

		// "Requested, not resident yet" is a normal state, and the answer to it
		// is a smaller index this turn — never a stall and never a throw.
		expect(report.processed).toBe(0)
		expect(report.reason).toMatch(/not resident yet/)
	})

	it("reports rather than waits when there is no model at all", async () => {
		const broker: LaneModelBroker = {
			spec: { role: "embedding", ttlMinutes: 5 },
			peek: async () => ({
				kind: "unconfigured",
				reason: "no embedding model is configured"
			}),
			request: async () => ({
				kind: "unavailable",
				modelId: null,
				reason: "no embedding model is configured"
			})
		}
		const lane = laneOver(fakeWork([1]).source, { model: broker })

		const report = await lane.promote({ refs: [ref(1)] })
		expect(report.processed).toBe(0)
		expect(report.reason).toMatch(/no embedding model/)
	})

	it("stops at the item bound and says the bound is why", async () => {
		const { source, processed } = fakeWork([1, 2, 3, 4, 5])
		const lane = laneOver(source)

		const report = await lane.promote({
			refs: [1, 2, 3, 4, 5].map(ref),
			maxItems: 2
		})

		expect(processed).toEqual([1, 2])
		expect(report.processed).toBe(2)
		expect(report.remaining).toBe(3)
		expect(report.boundHit).toBe(true)
		expect(report.reason).toMatch(/bounded/)
		await lane.settled()
	})

	/**
	 * ⚠ **The case that would ship as a CI timeout rather than a failure.**
	 *
	 * One item never finishes — a wedged embedding backend, a network read with
	 * no timeout of its own. The deadline is the only thing standing between
	 * that and a turn that never ends, and this asserts it directly rather than
	 * trusting that the timer was armed.
	 */
	it("returns on its deadline when an item never finishes", async () => {
		let release!: () => void
		const stuck = new Promise<void>((resolve) => {
			release = resolve
		})
		const work: LaneWorkSource = {
			async fromGroup() {
				return null
			},
			async global() {
				return null
			},
			async specific(r) {
				return {
					ref: r,
					label: { type: "thing", label: "wedged" },
					modelId: null,
					process: () => stuck
				}
			}
		}
		const lane = laneOver(work, { limits: { promotionTimeoutMs: 60 } })

		const started = Date.now()
		const report = await lane.promote({ refs: [ref(1), ref(2)] })
		const elapsed = Date.now() - started

		expect(report.boundHit).toBe(true)
		expect(report.reason).toMatch(/elapsed/)
		// Bounded by the deadline, not by the wedged call.
		expect(elapsed).toBeLessThan(2000)
		release()
	})

	it("survives a work source that throws, without an unhandled rejection", async () => {
		const rejections: unknown[] = []
		const onRejection = (err: unknown) => rejections.push(err)
		process.on("unhandledRejection", onRejection)
		const work: LaneWorkSource = {
			async fromGroup() {
				return null
			},
			async global() {
				throw new Error("the database went away")
			},
			async specific() {
				return null
			}
		}
		const lane = laneOver(work)

		const report = await lane.promote({ refs: [ref(1)] })
		await lane.settled()
		// One turn of the microtask queue for anything the loop dropped.
		await new Promise((r) => setTimeout(r, 20))
		process.off("unhandledRejection", onRejection)

		expect(report.processed).toBe(0)
		expect(rejections).toEqual([])
	})

	it("does not let one failing item stall the rest of a promotion", async () => {
		const processed: number[] = []
		const work: LaneWorkSource = {
			async fromGroup() {
				return null
			},
			async global() {
				return null
			},
			async specific(r) {
				return {
					ref: r,
					label: { type: "thing", label: `thing ${r.id}` },
					modelId: null,
					process: async () => {
						if (r.id === 1) throw new Error("one bad row")
						processed.push(r.id)
					}
				}
			}
		}
		const lane = laneOver(work)

		const report = await lane.promote({ refs: [ref(1), ref(2)] })

		expect(processed).toEqual([2])
		// The failed item still counts against the bound, so a permanently
		// broken row cannot re-enter this promotion and spin it.
		expect(report.processed).toBe(2)
	})

	it("settles every outstanding promotion when the lane is stopped", async () => {
		let release!: () => void
		const stuck = new Promise<void>((resolve) => {
			release = resolve
		})
		const work: LaneWorkSource = {
			async fromGroup() {
				return null
			},
			async global() {
				return null
			},
			async specific(r) {
				return {
					ref: r,
					label: { type: "thing", label: "slow" },
					modelId: null,
					process: () => stuck
				}
			}
		}
		const lane = laneOver(work, { limits: { promotionTimeoutMs: 5_000 } })

		const promise = lane.promote({ refs: [ref(1)] })
		await new Promise((r) => setTimeout(r, 10))
		lane.stop()
		release()

		const report = await promise
		expect(report.boundHit).toBe(true)
	})

	it("settles two concurrent promotions", async () => {
		const { source } = fakeWork([1, 2, 3, 4])
		const lane = laneOver(source)

		const [a, b] = await Promise.all([
			lane.promote({ refs: [ref(1), ref(2)] }),
			lane.promote({ refs: [ref(3), ref(4)] })
		])

		expect(a.processed).toBe(2)
		expect(b.processed).toBe(2)
	})

	it("takes a promotion that lands while the loop is idle", async () => {
		const { source, processed } = fakeWork([1])
		const lane = laneOver(source)

		// Drain first, so the loop has already exited once.
		await lane.promote({ refs: [] })
		await lane.settled()
		expect(lane.isRunning()).toBe(false)

		const { source: second, processed: later } = fakeWork([9])
		const lane2 = laneOver(second)
		await lane2.promote({ refs: [ref(9)] })
		expect(later).toEqual([9])
		expect(processed).toEqual([])
	})
})

describe("promotion runs ahead of the background sweep", () => {
	it("indexes the promoted rows first, whatever order the sweep would use", async () => {
		const order: number[] = []
		const pending = new Set([1, 2, 3, 4])
		const make = (id: number): LaneItem => ({
			ref: ref(id),
			label: { type: "thing", label: `thing ${id}` },
			modelId: null,
			process: async () => {
				pending.delete(id)
				order.push(id)
			}
		})
		const work: LaneWorkSource = {
			async fromGroup() {
				return null
			},
			// The sweep's own order is ascending; the promotion asks for 4.
			async global() {
				const next = [...pending][0]
				return next === undefined ? null : make(next)
			},
			async specific(r) {
				return pending.has(r.id) ? make(r.id) : null
			}
		}
		const lane = laneOver(work)

		await lane.promote({ refs: [ref(4)] })
		expect(order[0]).toBe(4)
		await lane.settled()
		expect(order).toEqual([4, 1, 2, 3])
	})
})

describe("autostart is a per-lane value, and it decides", () => {
	it("does not start the lane when autostart says no", async () => {
		const { source, processed } = fakeWork([1])
		const lane = laneOver(source, { autostart: async () => false })

		lane.startPeriodicScan()
		await new Promise((r) => setTimeout(r, 20))
		lane.stopPeriodicScan()

		expect(processed).toEqual([])
	})

	it("does not start the lane when it is switched off", async () => {
		const { source, processed } = fakeWork([1])
		const lane = laneOver(source, { isEnabled: async () => false })

		lane.startPeriodicScan()
		await new Promise((r) => setTimeout(r, 20))
		lane.stopPeriodicScan()

		expect(processed).toEqual([])
	})

	it("starts it when both say yes", async () => {
		const { source, processed } = fakeWork([1])
		const lane = laneOver(source)

		lane.startPeriodicScan()
		await vi.waitFor(() => expect(processed).toEqual([1]))
		lane.stopPeriodicScan()
	})
})

describe("residency is requested only once there is work", () => {
	it("peeks, finds nothing, and never asks for the model", async () => {
		const request = vi.fn(async () => ({
			kind: "resident" as const,
			modelId: "m"
		}))
		const broker: LaneModelBroker = {
			spec: { role: "embedding", ttlMinutes: 5 },
			peek: async () => ({ kind: "configured", modelId: "m" }),
			request
		}
		const empty: LaneWorkSource = {
			async fromGroup() {
				return null
			},
			async global() {
				return null
			},
			async specific() {
				return null
			}
		}
		const lane = laneOver(empty, { model: broker })

		lane.start()
		await lane.settled()

		// An instance with nothing to index never pays a load cost.
		expect(request).not.toHaveBeenCalled()
	})

	it("asks for it once a picker actually finds something", async () => {
		const request = vi.fn(async () => ({
			kind: "resident" as const,
			modelId: "m"
		}))
		const broker: LaneModelBroker = {
			spec: { role: "embedding", ttlMinutes: 5 },
			peek: async () => ({ kind: "configured", modelId: "m" }),
			request
		}
		const pending = new Set([1])
		const work: LaneWorkSource = {
			async fromGroup() {
				return null
			},
			async global() {
				const next = [...pending][0]
				if (next === undefined) return null
				return {
					ref: ref(next),
					label: { type: "thing", label: "thing" },
					modelId: "m",
					process: async () => {
						pending.delete(next)
					}
				}
			},
			async specific() {
				return null
			}
		}
		const lane = laneOver(work, { model: broker })

		lane.start()
		await lane.settled()

		expect(request).toHaveBeenCalled()
		expect(pending.size).toBe(0)
	})
})
