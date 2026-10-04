/**
 * Editing the starred embedding connection asks first when the save will
 * re-embed (lorebooks plan A10 follow-up): the same dialog and the same words
 * as moving the star, opened only when the server prices the edit above zero.
 *
 * The server half — what an edit costs — is counted in
 * `embeddingCost.int.test.ts`; this is the screen's half: who is asked, when,
 * and what each answer does to the save.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, tick, unmount } from "svelte"

vi.mock("$app/environment", () => ({ dev: true, building: false }))
const emitted: Array<[string, any]> = []
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => ({
		emit: (event: string, payload: unknown) =>
			emitted.push([event, payload]),
		on: () => {},
		off: () => {}
	})
}))
/** Who listens for what, as the interest registry would route it. */
const listeners = new Map<string, (msg: any) => void>()
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: (key: string, handler: (msg: any) => void) => {
		listeners.set(key, handler)
		return () => {
			if (listeners.get(key) === handler) listeners.delete(key)
		}
	},
	useInterest: (key: string, handler: (msg: any) => void) => {
		listeners.set(key, handler)
	}
}))
const toasts: Array<{ title: string; description?: string }> = []
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: {
		error: (t: any) => toasts.push(t),
		info: () => {},
		success: () => {}
	}
}))

import EmbeddingSwitchDialog from "./EmbeddingSwitchDialog.svelte"
import {
	addressOf,
	useEmbeddingEditConfirm
} from "./useEmbeddingEditConfirm.svelte"

/** The server's price, arriving on the event every screen shares. */
const answer = (msg: any) => listeners.get("vectorization:reindexCost")?.(msg)
/** Let the reply reach the hook: it is heard on a promise. */
const heard = () => new Promise((r) => setTimeout(r, 0))
/** The request's refusal, as `register()` words a throw. */
const refuse = (error: string) =>
	listeners.get("vectorization:reindexCost:error")?.({ error })

function hook() {
	let api!: ReturnType<typeof useEmbeddingEditConfirm>
	const cleanup = $effect.root(() => {
		api = useEmbeddingEditConfirm()
	})
	return { api, cleanup }
}

const mounted: ReturnType<typeof mount>[] = []
beforeEach(() => {
	emitted.length = 0
	toasts.length = 0
	listeners.clear()
})
afterEach(() => {
	for (const app of mounted.splice(0)) unmount(app)
	document.body.innerHTML = ""
	vi.useRealTimers()
})

const addressEdit = {
	connectionId: 4,
	edit: { baseUrl: "https://elsewhere.example.com/v1" },
	currentName: "bge-small at api.example.com/v1",
	nextName: "bge-small at elsewhere.example.com/v1"
}
const priced = (target: any) => ["vectorization:reindexCost", { target }]

describe("useEmbeddingEditConfirm", () => {
	test("every address edit is priced by the server — this screen never decides it touches no star", async () => {
		// No defaults are read here at all: a screen whose copy has not loaded
		// yet would otherwise wave through an edit that re-embeds everything.
		const { api, cleanup } = hook()
		const saved = api.confirmEdit(addressEdit)
		expect(emitted).toEqual([
			priced({ connectionId: 4, edit: addressEdit.edit })
		])
		answer({ rows: 12, target: emitted[0]![1].target })
		await heard()
		expect(api.dialog.open).toBe(true)
		api.dialog.onCancel()
		expect(await saved).toBe(false)
		cleanup()
	})

	test("an edit the server prices at nothing — no star on it, or a respelled address — saves without the dialog", async () => {
		const { api, cleanup } = hook()
		const saved = api.confirmEdit({ ...addressEdit, connectionId: 5 })
		answer({ rows: 0, target: emitted[0]![1].target })
		expect(await saved).toBe(true)
		expect(api.dialog.open).toBe(false)
		cleanup()
	})

	test("renaming a model names the model it renames", async () => {
		const { api, cleanup } = hook()
		const saved = api.confirmEdit({
			connectionId: 4,
			modelId: 10,
			edit: { model: "other" },
			currentName: "a",
			nextName: "b"
		})
		expect(emitted).toEqual([
			priced({ connectionId: 4, modelId: 10, edit: { model: "other" } })
		])
		answer({ rows: 0, target: emitted[0]![1].target })
		expect(await saved).toBe(true)
		cleanup()
	})

	test("an edit that re-embeds opens the dialog; another screen's price does not; keeping the model refuses the save", async () => {
		const { api, cleanup } = hook()
		const saved = api.confirmEdit(addressEdit)
		// Another screen's question on the same event is not this one's answer.
		answer({ rows: 3, target: { connectionId: 4, modelId: 9 } })
		await heard()
		expect(api.dialog.open).toBe(false)
		answer({ rows: 12, target: emitted[0]![1].target })
		await heard()
		expect(api.dialog).toMatchObject({
			open: true,
			currentName: "bge-small at api.example.com/v1",
			nextName: "bge-small at elsewhere.example.com/v1"
		})
		api.dialog.onCancel()
		expect(await saved).toBe(false)
		expect(api.dialog.open).toBe(false)
		cleanup()
	})

	test("Switch and re-embed lets the save go ahead", async () => {
		const { api, cleanup } = hook()
		const saved = api.confirmEdit({
			connectionId: 4,
			modelId: 9,
			edit: { model: "text-embedding-3-large" },
			currentName: "text-embedding-3-small",
			nextName: "text-embedding-3-large"
		})
		answer({ rows: 12, target: emitted[0]![1].target })
		await heard()
		api.dialog.onConfirm()
		expect(await saved).toBe(true)
		cleanup()
	})

	test("a refused price does not save — the refusal is already on screen", async () => {
		const { api, cleanup } = hook()
		const saved = api.confirmEdit(addressEdit)
		refuse("Unauthorized")
		expect(await saved).toBe(false)
		expect(api.dialog.open).toBe(false)
		// Layout toasts every `:error`; this does not say it twice.
		expect(toasts).toEqual([])
		cleanup()
	})

	test("a price that never comes does not save, and says so", async () => {
		vi.useFakeTimers()
		const { api, cleanup } = hook()
		const saved = api.confirmEdit(addressEdit)
		await vi.advanceTimersByTimeAsync(60_000)
		expect(await saved).toBe(false)
		expect(toasts).toHaveLength(1)
		expect(toasts[0]!.title).toBe("Not saved")
		cleanup()
	})

	test("a second save while the first is being priced replaces it", async () => {
		const { api, cleanup } = hook()
		const first = api.confirmEdit(addressEdit)
		const second = api.confirmEdit({
			...addressEdit,
			edit: { baseUrl: "https://third.example.com/v1" }
		})
		expect(await first).toBe(false)
		answer({ rows: 0, target: emitted[1]![1].target })
		expect(await second).toBe(true)
		cleanup()
	})

	test("an address reads without its scheme or trailing slash", () => {
		expect(addressOf("https://api.example.com/v1/")).toBe(
			"api.example.com/v1"
		)
		expect(addressOf("http://localhost:11434")).toBe("localhost:11434")
	})
})

describe("EmbeddingSwitchDialog", () => {
	async function render(props: Record<string, unknown>) {
		const host = document.createElement("div")
		document.body.append(host)
		const app = mount(EmbeddingSwitchDialog, {
			target: host,
			props: {
				open: true,
				cost: { rows: 12, lorebooks: 2, sessions: 1 },
				currentName: "bge-small at api.example.com/v1",
				nextName: "bge-small at elsewhere.example.com/v1",
				currentIsLocal: false,
				onConfirm: () => {},
				onCancel: () => {},
				...props
			} as any
		})
		mounted.push(app)
		flushSync()
		await tick()
		await new Promise((r) => setTimeout(r, 0))
		flushSync()
		return document.body.textContent?.replace(/\s+/g, " ") ?? ""
	}

	test("says the star's words: what it switches to, what it costs, what Keep keeps", async () => {
		const text = await render({})
		expect(text).toContain(
			"Switch embeddings to bge-small at elsewhere.example.com/v1?"
		)
		expect(text).toContain(
			"Replaces bge-small at api.example.com/v1 as the one embedding model for this pub."
		)
		expect(text).toContain("12 stored vectors are re-embedded")
		expect(text).toContain(
			"every entry in 2 lorebooks and the history of 1 session."
		)
		expect(text).toContain(
			"Until it finishes, retrieval answers from keywords only."
		)
		expect(text).toContain("Keep bge-small at api.example.com/v1")
		expect(text).toContain("Switch and re-embed")
	})
})
