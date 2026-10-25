import { describe, expect, test } from "vitest"
import {
	CONNECTION_STATE_DOT,
	CONNECTION_STATE_LABEL,
	CONNECTION_STATE_TEXT,
	CONNECTION_STATE_TONE,
	CONNECTION_STATES,
	connectionRowStatus,
	hostOf,
	needsAttention,
	rowActionClass,
	rowDefaults,
	rowStatusClasses,
	type RowConnection
} from "./connectionRowStatus"
import { loadoutsFilledBy } from "$lib/shared/loadouts/loadoutsFilledBy"

const base: RowConnection = {
	id: 1,
	name: "A connection",
	type: null,
	preset: null,
	baseUrl: "https://openrouter.ai/api/v1/",
	hasCredential: true,
	models: [],
	modelsSync: { at: null, error: null }
}
const model = (over: Partial<RowConnection["models"][number]> = {}) => ({
	name: "gpt-4o",
	model: "openai/gpt-4o",
	missingSince: null,
	...over
})
const timeAgo = () => "3 minutes ago"

describe("hostOf", () => {
	test("drops the scheme and the trailing slash, keeps a path", () => {
		expect(hostOf("https://openrouter.ai/api/v1/")).toBe(
			"openrouter.ai/api/v1"
		)
		expect(hostOf("http://localhost:11434/")).toBe("localhost:11434")
		expect(hostOf("not a url")).toBe("not a url")
		expect(hostOf(null)).toBe("")
	})
})

describe("an API host", () => {
	test("fills the four slots and composes no sentence", () => {
		const status = connectionRowStatus(
			{
				...base,
				models: [model(), model({ name: "claude" })],
				modelsSync: { at: "2026-09-17T10:00:00Z", error: null }
			},
			{ kind: "api", timeAgo }
		)
		expect(status).toEqual({
			state: "ready",
			label: "Ready",
			detail: "openrouter.ai/api/v1",
			metric: "2 models",
			action: null
		})
	})

	test("no slot ever carries a ' · ' joined list", () => {
		const status = connectionRowStatus(
			{
				...base,
				models: [model()],
				modelsSync: { at: "2026-09-17T10:00:00Z", error: null }
			},
			{ kind: "api", timeAgo }
		)
		for (const slot of [status.label, status.detail, status.metric])
			expect(slot ?? "").not.toContain(" · ")
	})

	test("a failed listing is broken, and carries the host's own words", () => {
		const status = connectionRowStatus(
			{ ...base, modelsSync: { at: null, error: "401 Unauthorized" } },
			{ kind: "api", timeAgo }
		)
		expect(status.state).toBe("broken")
		expect(status.label).toBe("Not working")
		expect(status.detail).toBe("401 Unauthorized")
		expect(status.action?.verb).toBe("fix")
	})

	test("never checked is idle, not a failure", () => {
		const status = connectionRowStatus(
			{ ...base, models: [model()] },
			{ kind: "api", timeAgo }
		)
		expect(status.state).toBe("idle")
		expect(status.label).toBe("Not tested")
	})

	test("a model the host stopped listing is unfinished, not red", () => {
		const status = connectionRowStatus(
			{
				...base,
				models: [
					model(),
					model({ missingSince: "2026-09-01T00:00:00Z" })
				],
				modelsSync: { at: "2026-09-17T10:00:00Z", error: null }
			},
			{ kind: "api", timeAgo }
		)
		expect(status.state).toBe("unfinished")
		expect(status.label).toBe("1 no longer listed")
		expect(status.action?.verb).toBe("refresh")
	})

	test("a successful listing that named nothing asks for a refresh", () => {
		const status = connectionRowStatus(
			{
				...base,
				modelsSync: { at: "2026-09-17T10:00:00Z", error: null }
			},
			{ kind: "api", timeAgo }
		)
		expect(status.state).toBe("unfinished")
		expect(status.label).toBe("No models")
	})
})

/**
 * Plan §A (walk 2026-10-06): OpenRouter read green **Ready · 503 models**
 * beside the strip's "Sessions can't reply yet". A row that serves chat while
 * chat has no model anywhere is waiting on the person's pick.
 */
describe("a listed host while chat is unset", () => {
	const listed: RowConnection = {
		...base,
		id: 7,
		type: "openai",
		preset: "openrouter",
		models: [
			model({ satisfiableCapabilities: ["text->text"] }),
			model({ name: "claude", satisfiableCapabilities: ["text->text"] })
		],
		modelsSync: { at: "2026-10-06T10:00:00Z", error: null }
	}

	test("is gold Pick a model, with Choose, and keeps its count", () => {
		const status = connectionRowStatus(listed, {
			kind: "api",
			timeAgo,
			defaults: { chatSet: false }
		})
		expect(status).toEqual({
			state: "unfinished",
			label: "Pick a model",
			detail: "openrouter.ai/api/v1",
			metric: "2 models",
			action: {
				verb: "choose",
				label: "Choose",
				icon: "ArrowRight",
				emphasis: "tonal"
			}
		})
		expect(CONNECTION_STATE_TONE[status.state]).toBe("primary")
		expect(needsAttention(status.state)).toBe(true)
	})

	test("is Ready once chat is set, here or elsewhere", () => {
		expect(
			connectionRowStatus(listed, {
				kind: "api",
				defaults: { chatSet: true }
			}).label
		).toBe("Ready")
	})

	test("a host whose models can't chat is plainly Ready", () => {
		const images = {
			...listed,
			models: [model({ satisfiableCapabilities: ["text->image"] })]
		}
		expect(
			connectionRowStatus(images, {
				kind: "api",
				defaults: { chatSet: false }
			}).label
		).toBe("Ready")
	})

	test("an unanswered defaults fact claims nothing", () => {
		expect(connectionRowStatus(listed, { kind: "api" }).label).toBe("Ready")
	})

	test("an earlier unfinished state still wins — the key comes first", () => {
		const status = connectionRowStatus(
			{ ...listed, hasCredential: false },
			{ kind: "api", defaults: { chatSet: false } }
		)
		expect(status.label).toBe("Needs a key")
	})
})

describe("rowDefaults", () => {
	const entries = [
		{ capability: "text->text", set: false, connection: undefined },
		{ capability: "text->embedding", set: true, connection: { id: 7 } },
		// An endpoint-only registration resolves as unset (§10).
		{ capability: "text->image", set: false, connection: undefined }
	]

	test("reads resolved pairs only: another job's default doesn't answer chat", () => {
		expect(rowDefaults(entries)).toEqual({ chatSet: false })
	})

	test("chat set on any connection answers chat", () => {
		const set = [
			{ capability: "text->text", set: true, connection: { id: 1 } }
		]
		expect(rowDefaults(set)).toEqual({ chatSet: true })
	})
})

/**
 * The regression this whole split exists for: on a fresh install two of four
 * rows were red with Fix buttons because two connections had no API key yet.
 */
describe("a cloud connection with no key yet", () => {
	const keyless: RowConnection = {
		...base,
		type: "openai",
		preset: "openrouter",
		hasCredential: false,
		modelsSync: { at: null, error: "Missing credentials" }
	}

	test("is unfinished and gold, never broken and never red", () => {
		const status = connectionRowStatus(keyless, { kind: "api", timeAgo })
		expect(status.state).toBe("unfinished")
		expect(CONNECTION_STATE_TONE[status.state]).toBe("primary")
		expect(needsAttention(status.state)).toBe(true)
		expect(status.label).toBe("Needs a key")
	})

	test("does not report the listing error a missing key obviously caused", () => {
		const status = connectionRowStatus(keyless, { kind: "api", timeAgo })
		expect(status.detail).toBe("openrouter.ai/api/v1")
		expect(status.detail).not.toContain("Missing credentials")
	})

	test("offers Set up rather than Fix", () => {
		expect(
			connectionRowStatus(keyless, { kind: "api", timeAgo }).action?.verb
		).toBe("setup")
	})

	test("once the key is there, a real rejection IS broken", () => {
		const status = connectionRowStatus(
			{
				...keyless,
				hasCredential: true,
				modelsSync: { at: null, error: "401 Unauthorized" }
			},
			{ kind: "api", timeAgo }
		)
		expect(status.state).toBe("broken")
		expect(status.detail).toBe("401 Unauthorized")
	})

	test("a local host with no key is not unfinished — it wants none", () => {
		const status = connectionRowStatus(
			{
				...base,
				type: "openai",
				preset: null,
				baseUrl: "http://localhost:8080/v1/",
				hasCredential: false,
				models: [model()],
				modelsSync: { at: "2026-09-17T10:00:00Z", error: null }
			},
			{ kind: "api", timeAgo }
		)
		expect(status.state).toBe("ready")
	})
})

describe("a managed KoboldCPP", () => {
	const managed = { ...base, type: "koboldcpp_managed", baseUrl: null }

	test("not installed is unfinished, and offers Set up", () => {
		const status = connectionRowStatus(managed, {
			kind: "koboldcpp-managed",
			kcppInstall: "not-installed"
		})
		expect(status.state).toBe("unfinished")
		expect(status.label).toBe("Not installed")
		expect(status.action?.verb).toBe("setup")
	})

	// Ruled 2026-09-24: the flag off with the install kept is Offline, and
	// Start turns it back on — the same word the view says.
	test("switched off with the install kept is Offline, and offers Start", () => {
		const status = connectionRowStatus(
			{ ...managed, models: [model(), model()] },
			{ kind: "koboldcpp-managed", kcppInstall: "offline" }
		)
		expect(status.state).toBe("idle")
		expect(status.label).toBe("Offline")
		expect(status.metric).toBe("2 on disk")
		expect(status.action?.verb).toBe("start-offline")
		expect(status.action?.label).toBe("Start")
	})

	test("settings not arrived claims nothing about the install", () => {
		const status = connectionRowStatus(managed, {
			kind: "koboldcpp-managed",
			kcppInstall: "loading"
		})
		expect(status.label).toBe("Checking")
		expect(status.action).toBeNull()
	})

	test("with no binary chosen says so rather than offering Start", () => {
		const status = connectionRowStatus(managed, {
			kind: "koboldcpp-managed",
			kcppInstall: "no-binary"
		})
		expect(status.label).toBe("Not set up")
		expect(status.action?.verb).toBe("setup")
	})

	test("running names the loaded file under the name and counts on disk", () => {
		const status = connectionRowStatus(
			{ ...managed, models: [model(), model()] },
			{
				kind: "koboldcpp-managed",
				kcppInstall: "ready",
				kcpp: { run: "running", loadedFiles: ["Nemo 12B"] } as any
			}
		)
		expect(status.state).toBe("ready")
		expect(status.detail).toBe("Nemo 12B")
		expect(status.metric).toBe("2 on disk")
		expect(status.action?.verb).toBe("stop")
	})

	test("stopped is idle — the manager starts it on first use", () => {
		const status = connectionRowStatus(managed, {
			kind: "koboldcpp-managed",
			kcppInstall: "ready",
			kcpp: { run: "stopped" } as any
		})
		expect(status.state).toBe("idle")
		expect(CONNECTION_STATE_TONE[status.state]).toBe("surface")
		expect(needsAttention(status.state)).toBe(false)
		expect(status.action?.verb).toBe("start")
	})

	test("crashed is the one that is red", () => {
		const status = connectionRowStatus(managed, {
			kind: "koboldcpp-managed",
			kcppInstall: "ready",
			kcpp: { run: "crashed" } as any
		})
		expect(status.state).toBe("broken")
		expect(status.action?.verb).toBe("start")
	})

	test("nothing answered claims nothing", () => {
		const status = connectionRowStatus(managed, {
			kind: "koboldcpp-managed",
			kcppInstall: "ready"
		})
		expect(status.state).toBe("idle")
		expect(status.label).toBe("Installed")
	})
})

describe("an Ollama", () => {
	const ollama = {
		...base,
		type: "ollama",
		baseUrl: "http://localhost:11434/"
	}

	test("reachable is ready, with the host under the name", () => {
		const status = connectionRowStatus(
			{ ...ollama, models: [model(), model(), model(), model()] },
			{ kind: "ollama", ollama: { reachable: true } as any }
		)
		expect(status).toEqual({
			state: "ready",
			label: "Running",
			detail: "localhost:11434",
			metric: "4 models",
			action: null
		})
	})

	test("configured and not answering is broken", () => {
		const status = connectionRowStatus(ollama, {
			kind: "ollama",
			ollama: { reachable: false } as any
		})
		expect(status.state).toBe("broken")
		expect(status.label).toBe("Not reachable")
		expect(status.action?.verb).toBe("fix")
	})

	test("nothing answered is idle", () => {
		expect(connectionRowStatus(ollama, { kind: "ollama" }).state).toBe(
			"idle"
		)
	})

	test("a failed listing is broken, as an API row's is", () => {
		const status = connectionRowStatus(
			{
				...ollama,
				models: [model()],
				modelsSync: { at: null, error: "connect ECONNREFUSED" }
			},
			{ kind: "ollama", ollama: { reachable: true } as any }
		)
		expect(status.state).toBe("broken")
		expect(status.label).toBe("Not working")
		expect(status.detail).toBe("connect ECONNREFUSED")
		expect(status.action?.verb).toBe("fix")
	})

	test("serving chat while chat is unset anywhere asks for a pick", () => {
		const chat = model({ satisfiableCapabilities: ["text->text"] })
		const status = connectionRowStatus(
			{ ...ollama, models: [chat] },
			{
				kind: "ollama",
				ollama: { reachable: true } as any,
				defaults: { chatSet: false }
			}
		)
		expect(status.state).toBe("unfinished")
		expect(status.label).toBe("Pick a model")
		expect(status.action?.verb).toBe("choose")
		// Once chat is answered somewhere, it is Running again.
		expect(
			connectionRowStatus(
				{ ...ollama, models: [chat] },
				{
					kind: "ollama",
					ollama: { reachable: true } as any,
					defaults: { chatSet: true }
				}
			).label
		).toBe("Running")
	})
})

describe("a local ONNX lane", () => {
	const onnx = { ...base, type: "local_onnx_embeddings", baseUrl: null }
	const local = (state: string, over: Record<string, unknown> = {}) => ({
		...model({ name: "bge-small", model: "bge-small" }),
		local: { state, ...over } as any
	})

	test("nothing active is unfinished", () => {
		const status = connectionRowStatus(
			{ ...onnx, models: [local("on_disk")] },
			{ kind: "onnx-embeddings", lane: {} as any }
		)
		expect(status.state).toBe("unfinished")
		expect(status.label).toBe("Loadout unfilled")
	})

	test("loaded reads its idle time in the metric slot", () => {
		const now = Date.parse("2026-09-17T10:04:00Z")
		const status = connectionRowStatus(
			{ ...onnx, models: [local("on_disk")] },
			{
				kind: "onnx-embeddings",
				lane: {
					modelId: "bge-small",
					loaded: true,
					lastUsedAt: "2026-09-17T10:00:00Z"
				} as any,
				now
			}
		)
		expect(status.state).toBe("ready")
		expect(status.detail).toBe("bge-small")
		expect(status.metric).toBe("idle 4 min")
	})

	test("a download in flight is busy, with its percent as the metric", () => {
		const status = connectionRowStatus(
			{ ...onnx, models: [local("downloading", { percent: 42 })] },
			{ kind: "onnx-embeddings", lane: {} as any }
		)
		expect(status.state).toBe("busy")
		expect(status.label).toBe("Downloading")
		expect(status.metric).toBe("42%")
	})

	test("a lane held by ANOTHER connection is not this row's", () => {
		// Same model identity on both endpoints: without the connection check
		// this row read the other's star as its own "Active".
		const status = connectionRowStatus(
			{ ...onnx, id: 1, models: [local("on_disk")] },
			{
				kind: "onnx-embeddings",
				lane: {
					modelId: "bge-small",
					connectionId: 2,
					loaded: true,
					lastUsedAt: null
				} as any
			}
		)
		expect(status.state).toBe("idle")
		expect(status.label).toBe("Not in use")
		expect(status.action).toBeNull()
	})

	test("another connection's star never says Not downloaded here", () => {
		const status = connectionRowStatus(
			{ ...onnx, id: 1, models: [local("not_downloaded")] },
			{
				kind: "onnx-embeddings",
				lane: {
					modelId: "bge-small",
					connectionId: 2,
					loaded: false
				} as any
			}
		)
		expect(status.label).not.toBe("Not downloaded")
		expect(status.state).toBe("idle")
	})

	test("a lane held by THIS connection reads as before", () => {
		const status = connectionRowStatus(
			{ ...onnx, id: 1, models: [local("on_disk")] },
			{
				kind: "onnx-embeddings",
				lane: {
					modelId: "bge-small",
					connectionId: 1,
					loaded: false
				} as any
			}
		)
		expect(status.state).toBe("ready")
		expect(status.label).toBe("In use")
	})

	test("an active model whose files are gone is unfinished", () => {
		const status = connectionRowStatus(
			{ ...onnx, models: [local("not_downloaded")] },
			{
				kind: "onnx-embeddings",
				lane: { modelId: "bge-small", loaded: false } as any
			}
		)
		expect(status.state).toBe("unfinished")
		expect(status.label).toBe("Not downloaded")
	})
})

describe("a sync in flight", () => {
	test("is busy, whatever kind the endpoint is", () => {
		const status = connectionRowStatus(base, { kind: "api", syncing: true })
		expect(status.state).toBe("busy")
		expect(status.label).toBe("Checking")
		expect(status.action).toBeNull()
	})
})

describe("the connection state scale", () => {
	test("five states, each in exactly one role, and only broken is error", () => {
		expect(CONNECTION_STATES).toEqual([
			"ready",
			"idle",
			"unfinished",
			"busy",
			"broken"
		])
		expect(CONNECTION_STATE_TONE).toEqual({
			ready: "success",
			idle: "surface",
			unfinished: "primary",
			busy: "warning",
			broken: "error"
		})
		const errors = CONNECTION_STATES.filter(
			(s) => CONNECTION_STATE_TONE[s] === "error"
		)
		expect(errors).toEqual(["broken"])
	})

	test("every state has a word, a dot and a text tone in its own role", () => {
		for (const s of CONNECTION_STATES) {
			expect(CONNECTION_STATE_LABEL[s]).toMatch(/^[A-Z]/)
			const role = CONNECTION_STATE_TONE[s]
			expect(CONNECTION_STATE_DOT[s]).toContain(`bg-${role}-`)
			expect(CONNECTION_STATE_TEXT[s]).toContain(`text-${role}-`)
		}
		// Something in flight moves; nothing else does.
		expect(
			CONNECTION_STATES.filter((s) =>
				CONNECTION_STATE_DOT[s].includes("animate-pulse")
			)
		).toEqual(["busy"])
	})

	test("needs attention is red and gold, and nothing else", () => {
		expect(CONNECTION_STATES.filter(needsAttention)).toEqual([
			"unfinished",
			"broken"
		])
	})
})

/**
 * ★R2 / PLAN-0-5-polish-parity L4.1 (2026-10-24): the walk's index was eight
 * bold red rows with a gold Fix on each. A row's state is a dot and muted
 * words; red is kept for the Admin Needs you case — broken AND a loadout runs
 * on it.
 */
describe("a row wears its state quietly; red only when a loadout is blocked", () => {
	const failing: RowConnection = {
		...base,
		id: 4,
		models: [model()],
		modelsSync: { at: "2026-10-24T10:00:00Z", error: "connection error" }
	}
	const fills = { "text->text": { connectionId: 4 } }
	const elsewhere = { "text->text": { connectionId: 9 } }

	test("loadoutsFilledBy reads the endpoint half, as Needs you does", () => {
		expect(loadoutsFilledBy(fills, 4)).toEqual(["text->text"])
		expect(loadoutsFilledBy(elsewhere, 4)).toEqual([])
		expect(loadoutsFilledBy(undefined, 4)).toEqual([])
		// A registration whose model is gone still points its runs here.
		expect(
			loadoutsFilledBy({ "text->image": { connectionId: 4 } }, 4)
		).toEqual(["text->image"])
	})

	test("broken and nothing relies on it: quiet dot, muted words, tonal Fix", () => {
		const status = connectionRowStatus(failing, {
			kind: "api",
			defaults: rowDefaults([], elsewhere)
		})
		expect(status.state).toBe("broken")
		expect(status.blocked).toBeUndefined()
		expect(status.action?.emphasis).toBe("tonal")
		expect(rowStatusClasses(status)).toEqual({
			dot: CONNECTION_STATE_DOT.idle,
			text: "text-surface-600-400",
			edge: ""
		})
		expect(rowActionClass(status.action!.emphasis)).toBe(
			"preset-tonal-surface"
		)
	})

	test("broken and it fills a loadout: the one red row, its Fix filled", () => {
		const status = connectionRowStatus(failing, {
			kind: "api",
			defaults: rowDefaults([], fills)
		})
		expect(status.blocked).toBe(true)
		expect(status.action).toMatchObject({ verb: "fix", emphasis: "filled" })
		const marks = rowStatusClasses(status)
		expect(marks.dot).toBe("bg-error-500")
		expect(marks.text).toContain("text-error-")
		expect(marks.edge).toContain("--color-error-500")
		expect(rowActionClass("filled")).toBe("preset-filled-primary-500")
	})

	test("an unanswered defaults fact draws no row red", () => {
		const status = connectionRowStatus(failing, { kind: "api" })
		expect(status.blocked).toBeUndefined()
	})

	test("every other state is muted words beside its own dot", () => {
		for (const state of ["ready", "idle", "unfinished", "busy"] as const) {
			const marks = rowStatusClasses({
				state,
				label: "x",
				detail: null,
				metric: null,
				action: null
			})
			expect(marks.text).toBe("text-surface-600-400")
			expect(marks.dot).toBe(CONNECTION_STATE_DOT[state])
			expect(marks.edge).toBe("")
		}
	})

	test("Start is filled on the row that can start; nothing else is gold", () => {
		const managed = { ...base, type: "koboldcpp_managed", baseUrl: null }
		const stopped = connectionRowStatus(managed, {
			kind: "koboldcpp-managed",
			kcppInstall: "ready",
			kcpp: { run: "stopped" } as any
		})
		expect(stopped.action).toMatchObject({ verb: "start", emphasis: "filled" })
		const offline = connectionRowStatus(managed, {
			kind: "koboldcpp-managed",
			kcppInstall: "offline"
		})
		expect(offline.action?.emphasis).toBe("filled")
		const noKey = connectionRowStatus(
			{ ...base, type: "anthropic", hasCredential: false },
			{ kind: "api" }
		)
		expect(noKey.action?.emphasis).not.toBe("filled")
	})
})
