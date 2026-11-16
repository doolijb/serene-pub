import { afterEach, describe, expect, test } from "vitest"
import {
	llmQueue,
	MAX_QUEUE_DEPTH,
	CancelledError,
	type LLMQueueItemInput
} from "./llmQueue"
import {
	llmLaneHostOf,
	setLlmLaneWidthOverrides
} from "$lib/server/connections/llmLanes"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

const local = (port: number) =>
	llmLaneHostOf({ baseUrl: `http://localhost:${port}` })
const managed = llmLaneHostOf({
	type: CONNECTION_TYPE.KOBOLDCPP_MANAGED,
	baseUrl: "http://localhost:5001"
})
const cloud = llmLaneHostOf({ baseUrl: "https://api.openai.com/v1/" })

function tick() {
	return new Promise((r) => setTimeout(r, 0))
}

/** An item whose execute() the test resolves by hand. */
function manual<T = string>(
	lane: ReturnType<typeof llmLaneHostOf> | undefined,
	extra: Partial<LLMQueueItemInput<T>> = {}
) {
	let started = false
	let release!: (v: T) => void
	const gate = new Promise<T>((r) => (release = r))
	const input: LLMQueueItemInput<T> = {
		taskType: "session",
		connectionName: "c",
		samplingName: "s",
		lane,
		execute: (signal) => {
			started = true
			return Promise.race([
				gate,
				new Promise<never>((_, rej) =>
					signal.addEventListener(
						"abort",
						() => rej(new Error("aborted")),
						{ once: true }
					)
				)
			])
		},
		...extra
	}
	return { input, release, started: () => started }
}

afterEach(() => setLlmLaneWidthOverrides(new Map()))

describe("llmQueue LLM lanes", () => {
	test("two hosts run concurrently; one host serialises", async () => {
		const a = manual(local(7001))
		const b = manual(local(7002))
		const c = manual(local(7001))
		const ra = llmQueue.enqueue(a.input)
		const rb = llmQueue.enqueue(b.input)
		const rc = llmQueue.enqueue(c.input)
		await tick()
		expect(a.started()).toBe(true)
		expect(b.started()).toBe(true)
		expect(c.started()).toBe(false)
		a.release("a")
		await ra.done
		await tick()
		expect(c.started()).toBe(true)
		b.release("b")
		c.release("c")
		await Promise.all([rb.done, rc.done])
	})

	test("a managed host is width 1; a cloud host runs 4 and queues the 5th", async () => {
		const m = [manual(managed), manual(managed)]
		const ms = m.map((x) => llmQueue.enqueue(x.input))
		await tick()
		expect(m.map((x) => x.started())).toEqual([true, false])

		const k = Array.from({ length: 5 }, () => manual(cloud))
		const ks = k.map((x) => llmQueue.enqueue(x.input))
		await tick()
		expect(k.map((x) => x.started())).toEqual([
			true,
			true,
			true,
			true,
			false
		])
		k[0].release("x")
		await ks[0].done
		await tick()
		expect(k[4].started()).toBe(true)
		m.forEach((x) => x.release("m"))
		k.forEach((x) => x.release("k"))
		await Promise.all([...ms, ...ks].map((r) => r.done))
	})

	test("an override plus widthsChanged() starts waiting items at once", async () => {
		const host = local(7010)
		const xs = [manual(host), manual(host), manual(host)]
		const rs = xs.map((x) => llmQueue.enqueue(x.input))
		await tick()
		expect(xs.map((x) => x.started())).toEqual([true, false, false])
		setLlmLaneWidthOverrides(new Map([[host.laneKey, 3]]))
		llmQueue.widthsChanged()
		await tick()
		expect(xs.map((x) => x.started())).toEqual([true, true, true])
		xs.forEach((x) => x.release("x"))
		await Promise.all(rs.map((r) => r.done))
	})

	test("the depth cap is per lane", async () => {
		const x = local(7020)
		const y = local(7021)
		const first = manual(x)
		const all = [llmQueue.enqueue(first.input)]
		const held = [first]
		await tick()
		for (let i = 0; i < MAX_QUEUE_DEPTH; i++) {
			const m = manual(x)
			held.push(m)
			all.push(llmQueue.enqueue(m.input))
		}
		expect(() => llmQueue.enqueue(manual(x).input)).toThrow(/Too many/)
		const other = manual(y)
		const ro = llmQueue.enqueue(other.input)
		await tick()
		expect(other.started()).toBe(true)
		other.release("y")
		await ro.done
		for (const m of held) {
			m.release("x")
			await tick()
		}
		await Promise.all(all.map((r) => r.done))
	})

	test("[C8] a next item enqueued from outside any run does not run inline on a finished run's lane set", async () => {
		const host = local(7030)
		const first = manual(host)
		const second = manual(host)
		const r1 = llmQueue.enqueue(first.input)
		const r2 = llmQueue.enqueue(second.input) // queued behind first; pump later runs from first's finally
		await tick()
		// third arrives from outside any run while second runs
		first.release("1")
		await r1.done
		await tick()
		expect(second.started()).toBe(true)
		const third = manual(host)
		const r3 = llmQueue.enqueue(third.input)
		await tick()
		expect(third.started()).toBe(false) // queued behind second, not inline
		second.release("2")
		await r2.done
		await tick()
		expect(third.started()).toBe(true)
		third.release("3")
		await r3.done
	})

	test("[C8] a run pumped from the previous run's finally does not inherit that run's held lanes", async () => {
		const x = local(7032)
		const y = local(7033)
		// A holds lane Y and, from inside, queues `first` on X — so first's
		// chain holds {Y, X}.
		let releaseA!: () => void
		const aGate = new Promise<void>((r) => (releaseA = r))
		const first = manual(x)
		let r1!: ReturnType<typeof llmQueue.enqueue<string>>
		const a = llmQueue.enqueue({
			taskType: "session",
			connectionName: "c",
			samplingName: "s",
			lane: y,
			execute: async () => {
				r1 = llmQueue.enqueue(first.input)
				await aGate
				return "a"
			}
		})
		await tick()
		// `second` is unrelated (queued from outside any run) and waits on X.
		const probe = manual(y)
		let rProbe!: ReturnType<typeof llmQueue.enqueue<string>>
		const second = llmQueue.enqueue({
			taskType: "session",
			connectionName: "c",
			samplingName: "s",
			lane: x,
			execute: async () => {
				rProbe = llmQueue.enqueue(probe.input)
				return "second"
			}
		})
		await tick()
		// first finishes; pump starts `second` from first's .finally.
		first.release("1")
		await r1.done
		await second.done
		await tick()
		// second's chain never held Y, so its enqueue on Y waits behind A.
		expect(probe.started()).toBe(false)
		releaseA()
		await a.done
		await tick()
		expect(probe.started()).toBe(true)
		probe.release("p")
		await rProbe.done
	})

	test("a nested enqueue on the SAME lane runs inline; on a DIFFERENT lane it queues", async () => {
		const x = local(7040)
		const y = local(7041)
		const blocker = manual(y)
		const rb = llmQueue.enqueue(blocker.input)
		await tick()
		const order: string[] = []
		const outer = llmQueue.enqueue({
			taskType: "session",
			connectionName: "c",
			samplingName: "s",
			lane: x,
			execute: async () => {
				const same = llmQueue.enqueue({
					taskType: "session",
					connectionName: "c",
					samplingName: "s",
					lane: x,
					execute: async () => {
						order.push("same")
						return 1
					}
				})
				await same.done
				const other = llmQueue.enqueue({
					taskType: "session",
					connectionName: "c",
					samplingName: "s",
					lane: y,
					execute: async () => {
						order.push("other")
						return 2
					}
				})
				await tick()
				order.push("after-tick")
				blocker.release("b")
				await other.done
				return 3
			}
		})
		await outer.done
		await rb.done
		expect(order).toEqual(["same", "after-tick", "other"])
	})

	test("an interactive item on lane X is not blocked by routine items filling lane Y", async () => {
		const x = local(7050)
		const y = local(7051)
		const routine = Array.from({ length: 5 }, () =>
			manual(y, { priority: 2 })
		)
		const rr = routine.map((m) => llmQueue.enqueue(m.input))
		const inter = manual(x, { priority: 0 })
		const ri = llmQueue.enqueue(inter.input)
		await tick()
		expect(inter.started()).toBe(true)
		inter.release("i")
		await ri.done
		for (const m of routine) {
			m.release("r")
			await tick()
		}
		await Promise.all(rr.map((r) => r.done))
	})

	test("cancelling one of several running items cancels only it, and the next waiting one starts", async () => {
		const items = Array.from({ length: 5 }, () => manual(cloud))
		const rs = items.map((m) => llmQueue.enqueue(m.input))
		await tick()
		const cancelled = rs[1].done.catch((e) => e)
		llmQueue.cancel(rs[1].id)
		const err = await cancelled
		expect(err).toBeInstanceOf(CancelledError)
		await tick()
		expect(items[4].started()).toBe(true)
		for (const i of [0, 2, 3, 4]) items[i].release("ok")
		const rest = await Promise.all([0, 2, 3, 4].map((i) => rs[i].done))
		expect(rest).toEqual(["ok", "ok", "ok", "ok"])
	})

	test("snapshot lists each running item with its laneKey", async () => {
		const host = local(7060)
		const a = manual(host)
		const b = manual(cloud)
		const noLane = manual(undefined, { connectionName: "bare" })
		const rs = [a, b, noLane].map((m) => llmQueue.enqueue(m.input))
		await tick()
		const snap = llmQueue.snapshot()
		const keys = rs.map((r) => snap.find((s) => s.id === r.id)?.laneKey)
		expect(keys).toEqual([
			"http://localhost:7060",
			"https://api.openai.com",
			"connection:bare"
		])
		;[a, b, noLane].forEach((m) => m.release("x"))
		await Promise.all(rs.map((r) => r.done))
	})
})
