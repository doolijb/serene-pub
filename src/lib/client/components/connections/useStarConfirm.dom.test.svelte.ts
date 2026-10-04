/**
 * The one flow in front of a costly star move (`useStarConfirm`), as every
 * screen that moves a star uses it: what is asked, in what order, and what
 * each answer writes. The screens' wiring is pinned where they are
 * (`defaultsStarConfirm`, `documentViewStarConfirm`).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("$app/environment", () => ({ dev: true, building: false }))
const { emitted, listeners, toasts } = vi.hoisted(() => ({
	emitted: [] as Array<[string, any]>,
	listeners: new Map<string, (msg: any) => void>(),
	toasts: [] as Array<{ title: string }>
}))
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => ({
		emit: (event: string, payload: unknown) =>
			emitted.push([event, payload])
	})
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: (key: string, handler: (msg: any) => void) => {
		listeners.set(key, handler)
		return () => {
			if (listeners.get(key) === handler) listeners.delete(key)
		}
	}
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: { error: (t: any) => toasts.push(t) }
}))

import { useStarConfirm, type StarMove } from "./useStarConfirm.svelte"

const EMBED = "text->embedding"
const NER = "text->entities"
const DEFAULTS = {
	[EMBED]: { connectionId: 1, connectionModelId: 11 },
	[NER]: { connectionId: 3, connectionModelId: 31 }
}
const NAMES: Record<number, string> = {
	11: "bge-small",
	21: "bge-large",
	31: "distilbert-NER",
	41: "xlm-NER"
}

function hook() {
	const commits: StarMove[][] = []
	const drops: StarMove[][] = []
	let api!: ReturnType<typeof useStarConfirm>
	const cleanup = $effect.root(() => {
		api = useStarConfirm({
			getDefaults: () => DEFAULTS,
			modelOf: (_c, m) =>
				m != null && NAMES[m]
					? { name: NAMES[m]!, isLocal: m === 11 }
					: null,
			commit: (moves) => commits.push(moves),
			dropped: (moves) => drops.push(moves)
		})
	})
	return { api, commits, drops, cleanup }
}
const heard = () => new Promise((r) => setTimeout(r, 0))
const price = (rows: number, target = { connectionId: 2, modelId: 21 }) =>
	listeners.get("vectorization:reindexCost")!({ rows, target })

beforeEach(() => {
	emitted.length = 0
	listeners.clear()
	toasts.length = 0
})
afterEach(() => vi.useRealTimers())

const toLarge = { capability: EMBED, connectionId: 2, modelId: 21 }
const toXlm = { capability: NER, connectionId: 4, modelId: 41 }

describe("useStarConfirm", () => {
	test("a press that changes nothing asks nothing and writes nothing", () => {
		const { api, commits, cleanup } = hook()
		api.stage([{ capability: EMBED, connectionId: 1, modelId: 11 }])
		expect(emitted).toEqual([])
		expect(commits).toEqual([])
		cleanup()
	})

	test("a move the server prices at zero writes at once", async () => {
		const { api, commits, cleanup } = hook()
		api.stage([toLarge])
		price(0)
		await heard()
		expect(commits).toEqual([[toLarge]])
		cleanup()
	})

	test("a priced move names both models; Keep drops it", async () => {
		const { api, commits, drops, cleanup } = hook()
		api.stage([toLarge])
		price(12)
		await heard()
		expect(api.embeddingDialog).toMatchObject({
			open: true,
			currentName: "bge-small",
			nextName: "bge-large",
			currentIsLocal: true
		})
		api.embeddingDialog.onCancel()
		expect(commits).toEqual([])
		expect(drops).toEqual([[toLarge]])
		// A late close after the cancel does nothing more.
		api.embeddingDialog.onCancel()
		expect(drops).toHaveLength(1)
		cleanup()
	})

	test("a press for both stars asks re-embed, then re-scan, then writes both at once", async () => {
		const { api, commits, cleanup } = hook()
		api.stage([toLarge, toXlm])
		price(12)
		await heard()
		api.embeddingDialog.onConfirm()
		expect(commits).toEqual([])
		expect(api.entityDialog).toMatchObject({
			open: true,
			rows: null,
			currentName: "distilbert-NER",
			nextName: "xlm-NER"
		})
		expect(emitted).toContainEqual(["ner:status", {}])
		listeners.get("ner:status")!({ annotatedRows: 80 })
		expect(api.entityDialog.rows).toBe(80)
		api.entityDialog.onConfirm()
		expect(commits).toEqual([[toLarge, toXlm]])
		cleanup()
	})

	test("an unstar asks nothing: what is stored stays", () => {
		const { api, commits, cleanup } = hook()
		api.stage([
			{ capability: EMBED, connectionId: null, modelId: null },
			{ capability: NER, connectionId: null, modelId: null }
		])
		expect(emitted).toEqual([])
		expect(commits).toHaveLength(1)
		cleanup()
	})

	test("a refused price moves nothing", async () => {
		const { api, commits, drops, cleanup } = hook()
		api.stage([toLarge])
		listeners.get("vectorization:reindexCost:error")!({
			error: "Unauthorized"
		})
		await heard()
		expect(commits).toEqual([])
		expect(drops).toEqual([[toLarge]])
		expect(toasts).toEqual([])
		cleanup()
	})

	test("a price that never comes moves nothing, and says so", async () => {
		vi.useFakeTimers()
		const { api, commits, drops, cleanup } = hook()
		api.stage([toLarge])
		await vi.advanceTimersByTimeAsync(60_000)
		expect(commits).toEqual([])
		expect(drops).toHaveLength(1)
		expect(toasts.map((t) => t.title)).toEqual(["Not switched"])
		cleanup()
	})

	test("a second press replaces the first; the first's late price is ignored", async () => {
		const { api, commits, drops, cleanup } = hook()
		api.stage([toLarge])
		const other = { capability: EMBED, connectionId: 5, modelId: 51 }
		api.stage([other])
		expect(drops).toEqual([[toLarge]])
		price(12)
		await heard()
		expect(api.embeddingDialog.open).toBe(false)
		price(0, { connectionId: 5, modelId: 51 })
		await heard()
		expect(commits).toEqual([[other]])
		cleanup()
	})
})
