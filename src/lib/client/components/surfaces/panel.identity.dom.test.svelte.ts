/**
 * What `Panel` hands a remote widget — the session, the settings in force and
 * each granted scoped section — is posted by REFERENCE (perf-N w1): a streamed
 * frame moves none of them, so none is posted or serialised; a real change
 * (the settings store written, a scoped context replaced, a scoped context's
 * derived rebuilt from a deep in-place change) is posted exactly once, and a
 * context that empties is withdrawn.
 *
 * The page's UI workers are stood in for; the panel, the host, the wire and
 * the settings store are real.
 */
import { afterEach, describe, expect, test, vi } from "vitest"
import { flushSync, mount, unmount } from "svelte"
import { normalizeLayout, type PanelInstance } from "$lib/client/surfaces/types"
import {
	setWidgetSettingValues,
	patchWidgetSettings,
	setWidgetSettingDecls,
	setWidgetSettingsWriter
} from "$lib/client/stores/widgetSettings.svelte"
import Fixture from "./PanelFixture.svelte"

const posted = vi.hoisted(() => [] as Array<Record<string, unknown>>)
vi.mock("$lib/client/components/host/uiWorkers", () => ({
	acquireWorker: () => ({}),
	releaseWorker: () => {},
	listenForRemoteEvents: () => {},
	currentEvent: () => undefined,
	routeMount: () => () => {},
	postToWorker: (_worker: unknown, m: Record<string, unknown>) =>
		posted.push(m)
}))

const settle = () => new Promise((r) => setTimeout(r, 20))
const FRAMES = 50

type Member = {
	ref: string
	characterId: number
	isPersona: boolean
	mine: boolean
	name: string
}
const members = (): Member[] => [
	{
		ref: "character:1",
		characterId: 1,
		isPersona: false,
		mine: false,
		name: "Ada"
	},
	{
		ref: "character:9",
		characterId: 9,
		isPersona: true,
		mine: true,
		name: "Cy"
	}
]
const charactersOf = (m: Member[]) => ({
	members: m,
	sceneImages: { left: null, right: null }
})

const instance: PanelInstance = {
	id: "probe",
	title: "Probe",
	role: "secondary",
	surface: { kind: "remote", owner: "acme", component: "w" },
	src: "/plugin-ui/acme/w.js",
	channels: [],
	layout: normalizeLayout(undefined, "secondary"),
	active: true,
	collapsed: false,
	drawered: false,
	order: 0,
	grants: ["session:full", "persona"],
	settings: {
		density: {
			type: "enum",
			label: "Density",
			of: ["cosy", "compact"],
			default: "cosy"
		}
	}
}

/** Each scoped context's `current`, one `$state.raw` cell (or a getter) apiece. */
function open(opts: { characters?: () => unknown } = {}) {
	let dossier = $state.raw<unknown>({ dossier: 1 })
	let characters = $state.raw<unknown>(charactersOf(members()))
	const session = $state({
		id: 7,
		name: "S",
		sessionMessages: [{ id: 1, content: "Hel" }]
	})
	const supplies = {
		get dossier() {
			return dossier
		},
		get characters() {
			return opts.characters ? opts.characters() : characters
		}
	}
	const target = document.createElement("div")
	document.body.appendChild(target)
	const app = mount(Fixture, {
		target,
		props: { instance, session, supplies }
	})
	flushSync()
	return {
		session,
		setDossier: (v: unknown) => (dossier = v),
		setCharacters: (v: unknown) => (characters = v),
		close: () => {
			unmount(app)
			target.remove()
		}
	}
}

async function widget(opts?: Parameters<typeof open>[0]) {
	const p = open(opts)
	const mounted = posted.find((m) => m.k === "mount") as { port: MessagePort }
	const got: Array<Record<string, unknown>> = []
	mounted.port.onmessage = (e) => got.push(e.data)
	mounted.port.postMessage({ t: "ready" })
	await settle()
	return {
		...p,
		got,
		close: () => {
			mounted.port.close()
			p.close()
		}
	}
}

const scopedOf = (got: Array<Record<string, unknown>>, section: string) =>
	got.filter((m) => m.t === "scoped" && m.section === section)

async function flush() {
	flushSync()
	await settle()
}

afterEach(() => {
	vi.restoreAllMocks()
	posted.length = 0
	setWidgetSettingValues({})
	setWidgetSettingDecls({})
	setWidgetSettingsWriter(null)
})

describe("a streamed frame moves only the log", () => {
	test("50 frames: no `session`, `settings` or scoped post, and none of them serialised", async () => {
		const w = await widget()
		for (const t of ["session", "settings"])
			expect(w.got.filter((m) => m.t === t)).toHaveLength(1)
		expect(scopedOf(w.got, "session_full")).toHaveLength(1)
		expect(scopedOf(w.got, "persona")).toHaveLength(1)
		const before = w.got.length
		const stringify = vi.spyOn(JSON, "stringify")
		for (let n = 1; n <= FRAMES; n++) {
			w.session.sessionMessages[0].content = "Hel" + "l".repeat(n)
			await flush()
		}
		const count = (f: (x: { t?: string; section?: string }) => boolean) =>
			stringify.mock.calls.filter(
				(a) => a[0] && f(a[0] as { t?: string; section?: string })
			).length
		const serialised = {
			session: count((x) => x.t === "session"),
			settings: count((x) => x.t === "settings"),
			session_full: count(
				(x) => x.t === "scoped" && x.section === "session_full"
			),
			persona: count((x) => x.t === "scoped" && x.section === "persona")
		}
		stringify.mockRestore()
		const after = w.got.slice(before)
		console.log(
			`[panel] stringifies over ${FRAMES} frames: ${JSON.stringify(serialised)}`
		)
		expect(serialised).toEqual({
			session: 0,
			settings: 0,
			session_full: 0,
			persona: 0
		})
		expect(
			after.filter((m) => m.t !== "message" && m.t !== "messages")
		).toEqual([])
		expect(after.length).toBeGreaterThan(0)
		w.close()
	})
})

describe("settings", () => {
	test("one write through the store reaches the widget once; an equal write posts nothing", async () => {
		setWidgetSettingDecls({
			probe: {
				id: "probe",
				title: "Probe",
				settings: instance.settings
			} as never
		})
		const w = await widget()
		const before = w.got.length
		setWidgetSettingValues({ probe: { density: "compact" } })
		await flush()
		let posts = w.got.slice(before).filter((m) => m.t === "settings")
		expect(posts).toHaveLength(1)
		expect((posts[0].settings as { density: string }).density).toBe(
			"compact"
		)
		const mid = w.got.length
		setWidgetSettingValues({ probe: { density: "compact" } })
		await flush()
		expect(w.got.slice(mid).filter((m) => m.t === "settings")).toEqual([])
		// The patch path builds `next` and calls the registered writer, which
		// pushes it back through `setWidgetSettingValues` (the one writer).
		setWidgetSettingsWriter((next) => setWidgetSettingValues(next))
		const mid2 = w.got.length
		patchWidgetSettings("probe", { density: "cosy" })
		await flush()
		posts = w.got.slice(mid2).filter((m) => m.t === "settings")
		expect(posts).toHaveLength(1)
		expect((posts[0].settings as { density: string }).density).toBe("cosy")
		w.close()
	})
})

describe("scoped sections", () => {
	test("a replaced context posts its section once; the other sections stay quiet", async () => {
		const w = await widget()
		const before = w.got.length
		w.setDossier({ dossier: 2 })
		await flush()
		const after = w.got.slice(before)
		expect(scopedOf(after, "session_full")).toEqual([
			{ t: "scoped", section: "session_full", value: { dossier: 2 } }
		])
		expect(scopedOf(after, "persona")).toEqual([])
		w.close()
	})

	test("a context that becomes undefined is withdrawn once", async () => {
		const w = await widget()
		const before = w.got.length
		w.setDossier(undefined)
		await flush()
		expect(scopedOf(w.got.slice(before), "session_full")).toEqual([
			{ t: "scoped", section: "session_full", value: null }
		])
		w.close()
	})

	test("a context whose `current` is a derived over a $state proxy, mutated deep in place: one post", async () => {
		const source = $state({ members: members() })
		let derived!: () => unknown
		const stop = $effect.root(() => {
			// Rebuilt (a new reference) whenever anything it reads moves.
			const d = $derived(
				charactersOf(source.members.map((m) => ({ ...m })))
			)
			derived = () => d
		})
		const w = await widget({ characters: () => derived() })
		const before = w.got.length
		source.members[1].name = "Cyrus"
		await flush()
		const personas = scopedOf(w.got.slice(before), "persona")
		expect(personas).toHaveLength(1)
		expect((personas[0].value as Member[])[0].name).toBe("Cyrus")
		expect(scopedOf(w.got.slice(before), "session_full")).toEqual([])
		w.close()
		stop()
	})
})
