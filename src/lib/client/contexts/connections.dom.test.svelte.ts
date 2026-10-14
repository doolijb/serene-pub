/**
 * The connections context is the one subscriber to the list and the events
 * that move it, and the only place their toasts are shown: the list arrives
 * sorted, a forced sync's failure is warned about once (an unforced one not
 * at all), a choice is one write per job and ONE toast when its last ack
 * lands — the defaults patched on every ack — and its interests and
 * listeners go when their holders do.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"

const { listeners, toasts, emitted } = vi.hoisted(() => ({
	listeners: new Map<string, Set<(msg: any) => void>>(),
	toasts: [] as Array<{ kind: string; title: string }>,
	emitted: [] as Array<[string, any]>
}))
vi.mock("$lib/client/sockets/interest.svelte", () => ({
	declareInterest: (key: string, handler: (msg: any) => void) => {
		let set = listeners.get(key)
		if (!set) listeners.set(key, (set = new Set()))
		set.add(handler)
		return () => {
			set!.delete(handler)
			if (!set!.size) listeners.delete(key)
		}
	}
}))
vi.mock("$lib/client/sockets/typedSocket", () => ({
	useTypedSocket: () => ({
		emit: (event: string, params: unknown) => emitted.push([event, params])
	})
}))
vi.mock("$lib/client/utils/toaster", () => ({
	toaster: {
		success: (t: any) => toasts.push({ kind: "success", ...t }),
		warning: (t: any) => toasts.push({ kind: "warning", ...t }),
		error: (t: any) => toasts.push({ kind: "error", ...t })
	}
}))

import { createConnections } from "./connections.svelte"

const CHAT = "text->text"
const IMAGES = "text->image"
const fire = (event: string, msg: unknown) => {
	for (const handler of [...(listeners.get(event) ?? [])]) handler(msg)
}
const row = (id: number, name: string, models: Array<[number, string]>) => ({
	id,
	name,
	type: "openai",
	baseUrl: "https://example.test/v1",
	preset: null,
	hasCredential: true,
	modality: "text-gen",
	modelsSync: { at: null, error: null },
	models: models.map(([mid, mname]) => ({
		id: mid,
		name: mname,
		model: mname.toLowerCase(),
		enabled: true,
		missingSince: null,
		satisfiableCapabilities: [CHAT, IMAGES]
	}))
})

function setup() {
	const systemSettings = $state({
		settings: undefined,
		capabilityDefaults: {} as Record<string, any>
	}) as unknown as SystemSettingsCtx
	let ctx!: ReturnType<typeof createConnections>
	const cleanup = $effect.root(() => {
		ctx = createConnections({ systemSettings })
	})
	return { ctx, systemSettings, cleanup }
}

beforeEach(() => {
	listeners.clear()
	toasts.length = 0
	emitted.length = 0
})

describe("connections context", () => {
	test("nothing is listened for until a view holds it; the list arrives sorted", () => {
		const { ctx, cleanup } = setup()
		expect(listeners.size).toBe(0)
		const release = ctx.hold()
		expect(ctx.loading).toBe(true)
		fire("connections:list", {
			connectionsList: [row(2, "Zed", []), row(1, "Alpha", [])]
		})
		expect(ctx.loading).toBe(false)
		expect(ctx.list.map((c) => c.name)).toEqual(["Alpha", "Zed"])
		expect(ctx.listed).toHaveLength(2)
		release()
		cleanup()
	})

	test("a forced sync's failure is warned about once; an unforced one is not", () => {
		const { ctx, cleanup } = setup()
		const releaseSidebar = ctx.hold()
		const releaseFinder = ctx.hold()
		fire("connections:list", {
			connectionsList: [row(1, "Hosted", []), row(2, "Desk", [])]
		})
		ctx.requestSync(1, true)
		ctx.requestSync(2)
		expect(ctx.syncingIds.has(1)).toBe(true)
		const synced: unknown[] = []
		ctx.onSynced((msg) => synced.push(msg))
		fire("connections:syncModels", {
			results: [
				{ connectionId: 1, error: "401" },
				{ connectionId: 2, error: "timeout" }
			]
		})
		expect(toasts).toEqual([
			{
				kind: "warning",
				title: "Couldn't list models for Hosted",
				description: "401"
			}
		])
		expect(ctx.syncingIds.size).toBe(0)
		expect(synced).toHaveLength(1)
		releaseSidebar()
		releaseFinder()
		cleanup()
	})

	test("a choice writes once per job, patches each ack, and is said once", () => {
		const { ctx, systemSettings, cleanup } = setup()
		const release = ctx.hold()
		fire("connections:list", {
			connectionsList: [row(1, "Hosted", [[11, "Nemo"]])]
		})
		const said: string[] = []
		ctx.onAnnounce((m) => said.push(m))
		ctx.chooseJobModel([CHAT, IMAGES], {
			connectionId: 1,
			model: { id: 11, name: "Nemo" }
		})
		expect(
			emitted.filter(([e]) => e === "connections:setDefault")
		).toHaveLength(2)
		expect(said).toHaveLength(1)

		fire("connections:setDefault", { capability: CHAT, id: 1, modelId: 11 })
		expect(systemSettings.capabilityDefaults[CHAT]).toMatchObject({
			connectionId: 1,
			connectionModelId: 11
		})
		expect(ctx.chatPair.model?.name).toBe("Nemo")
		expect(toasts).toHaveLength(0)

		fire("connections:setDefault", {
			capability: IMAGES,
			id: 1,
			modelId: 11
		})
		expect(toasts).toHaveLength(1)
		expect(toasts[0]).toMatchObject({ kind: "success" })
		expect(toasts[0].title).toMatch(/^Nemo is now in the /)
		release()
		cleanup()
	})

	test("a create is announced only when this tab asked for it", () => {
		const { ctx, cleanup } = setup()
		const release = ctx.hold()
		const heard: boolean[] = []
		ctx.onCreated((_msg, { mine }) => heard.push(mine))
		ctx.expectCreate(" My Server ")
		fire("connections:create", {
			connection: { id: 5, name: "my server", type: "openai" }
		})
		fire("connections:create", {
			connection: { id: 6, name: "Other tab", type: "openai" }
		})
		expect(heard).toEqual([true, false])
		expect(toasts).toEqual([
			{ kind: "success", title: "Connection created" }
		])
		release()
		cleanup()
	})

	test("listeners and interests release with their holders", () => {
		const { ctx, cleanup } = setup()
		const releaseA = ctx.hold()
		const releaseB = ctx.hold()
		let heard = 0
		const stop = ctx.onDefaultSet(() => heard++)
		fire("connections:setDefault", { capability: CHAT, id: 1, modelId: 2 })
		stop()
		fire("connections:setDefault", { capability: CHAT, id: 1, modelId: 2 })
		expect(heard).toBe(1)
		releaseA()
		expect(listeners.has("connections:list")).toBe(true)
		releaseB()
		releaseB()
		expect(listeners.size).toBe(0)
		cleanup()
	})
})
