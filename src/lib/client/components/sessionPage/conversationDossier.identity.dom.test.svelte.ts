import { describe, expect, it } from "vitest"
import { flushSync } from "svelte"
import { createSessionStore } from "$lib/client/sessions/store/sessionStore.svelte"
import {
	projectConversationDossier,
	type DossierLineCache
} from "./sessionPageProjections"

const N = 40
const FRAMES = 50
const pag = { hasMore: false, olderIn: [] } as any

function rowAt(i: number, extra: Record<string, unknown> = {}) {
	return {
		id: i,
		sessionId: 1,
		channel: "main",
		role: i % 2 ? "user" : "assistant",
		content: `line ${i}`,
		metadata: null,
		isGenerating: false,
		updatedAt: "2026-11-13T00:00:00.000Z",
		...extra
	} as any
}

function payload() {
	const rows = Array.from({ length: N }, (_, k) => rowAt(k + 1))
	rows[N - 1] = rowAt(N, {
		role: "assistant",
		isGenerating: true,
		content: ""
	})
	return {
		id: 1,
		name: "S",
		rewind: { ahead: 0, back: null, forward: null, regenerate: null },
		sessionMessages: rows,
		sessionCharacters: [],
		sessionPersonas: []
	} as any
}

const delta = (n: number, reasoning: string | null) => ({
	sessionId: 1,
	id: N,
	content: "x".repeat(n),
	reasoning
})

/** The page's composition (sessionPageData.svelte.ts) with the rest of the sources stubbed. */
function setup() {
	const store = createSessionStore()
	store.open(1)
	store.load(payload(), pag)
	const userCtx = $state({ user: { id: 1, isAdmin: false } })
	const systemSettingsCtx = $state({
		settings: { contextDebuggingEnabled: false }
	})
	const cache: DossierLineCache = new Map()
	const c = { runs: 0 }
	const v: { dossier: any } = { dossier: null }
	const stop = $effect.root(() => {
		const record = $derived(store.session(1))
		const rows = $derived(record ? store.messagesOf(1) : [])
		const cast = $derived(record ? store.castOf(1) : undefined)
		const session = $derived(
			record && cast
				? ({ ...record, ...cast, sessionMessages: rows } as any)
				: undefined
		)
		const src = {
			data: {
				get session() {
					return session
				},
				isGuest: false,
				lastMessage: undefined,
				lastAuthorMessage: undefined,
				sessionFrames: undefined,
				sessionPlayerLabel: "",
				ownVoice: "You",
				pagination: pag,
				loadingOlderMessages: false,
				extendRefusal: null,
				userPersonasInSession: [],
				currentUserPersona: undefined,
				ownCardlessSeat: null,
				showAddPersonaCTA: false,
				showTakeSeatCTA: false,
				composerHidden: false,
				sessionChannels: ["main"],
				modeMissing: false,
				getMessageCharacter: () => null,
				canControlMessage: () => true,
				// A generating row is not rerunnable: the settle changes its line.
				canRerunMessage: (m: any) => !m.isGenerating,
				rerunRefusals: undefined,
				annex: undefined,
				personLine: () => undefined,
				offersWrite: () => false,
				liveRunIds: [],
				runningRoutineNames: []
			},
			actions: {
				canRegenerateLastMessage: false,
				sessionActions: [],
				composerMenuActions: [],
				paletteActions: [],
				newestItem: null
			},
			turns: {
				turnOrder: null,
				shouldShowNextCharacterBlock: false,
				canChooseDifferentCharacter: false
			},
			controls: {
				showSwipeControls: () => false,
				canSwipeRight: () => false
			},
			composer: {
				draftCompiledPrompt: null,
				composerTray: { view: null, readers: [] }
			},
			scenes: {
				sceneList: [],
				capturedMessageIds: [],
				selectForSummary: false,
				summaryEnded: false
			},
			stateStore: {
				ledgerFor: () => [],
				pendingFor: () => [],
				ledgerHead: () => ({}),
				pending: []
			},
			remoteFaces: { face: (x: unknown) => x, landed: 0 },
			userCtx,
			systemSettingsCtx,
			userSettingsCtx: { settings: {} },
			composerDraft: () => ({}),
			snapshot: (x: unknown) => $state.snapshot(x)
		} as never
		const dossier = $derived.by(() => {
			c.runs++
			return projectConversationDossier(src, cache)
		})
		$effect(() => {
			v.dossier = dossier
		})
	})
	flushSync()
	return { store, userCtx, systemSettingsCtx, c, v, stop }
}

describe("conversation dossier identity", () => {
	it("1. content-only deltas: no rerun, same reference", () => {
		const { store, c, v, stop } = setup()
		const first = v.dossier
		const runs = c.runs
		expect(first).not.toBeNull()
		for (let n = 1; n <= FRAMES; n++) {
			store.applyMessageDelta(delta(n, null))
			flushSync()
		}
		console.log("case 1: runs", runs, "->", c.runs)
		expect(c.runs).toBe(runs)
		expect(v.dossier).toBe(first)
		stop()
	})

	it("2. reasoning deltas: the derived reruns, the reference stays", () => {
		const { store, c, v, stop } = setup()
		const first = v.dossier
		const runs = c.runs
		for (let n = 1; n <= FRAMES; n++) {
			store.applyMessageDelta(delta(n, `r${n}`))
			flushSync()
		}
		console.log("case 2: runs", runs, "->", c.runs)
		expect(c.runs).toBeGreaterThan(runs)
		expect(v.dossier).toBe(first)
		stop()
	})

	it("3. a real change gives a new reference carrying it", () => {
		const { store, c, v, stop } = setup()
		const first = v.dossier
		store.applyMessageDelta(delta(3, "r"))
		flushSync()
		expect(v.dossier).toBe(first)
		const before = first.lines[N]
		store.upsertMessage(
			rowAt(N, {
				role: "assistant",
				isGenerating: false,
				content: "done",
				metadata: { reasoning: "r" }
			})
		)
		flushSync()
		const settled = v.dossier
		expect(settled).not.toBe(first)
		expect(settled.lines[N]).not.toBe(before)
		expect(before.rerunnable).toBe(false)
		expect(settled.lines[N].rerunnable).toBe(true)
		expect(settled.lines[1]).toBe(first.lines[1])
		store.patchSession(1, { settledLine: 7 } as never)
		flushSync()
		expect(v.dossier).not.toBe(settled)
		expect(v.dossier.settledThrough).toBe(7)
		store.patchSession(1, { lorebookId: 9 } as never)
		flushSync()
		expect(v.dossier.composer.tabs.map((t: any) => t.view)).toContain(
			"session-workflow"
		)
		console.log("case 3: runs", c.runs)
		stop()
	})

	it("4. after a change the new object is the one held", () => {
		const { store, v, stop } = setup()
		const first = v.dossier
		store.patchSession(1, { settledLine: 5 } as never)
		flushSync()
		const changed = v.dossier
		expect(changed).not.toBe(first)
		for (let n = 1; n <= 5; n++) {
			store.applyMessageDelta(delta(n, `r${n}`))
			flushSync()
		}
		expect(v.dossier).toBe(changed)
		stop()
	})

	it("5. a field changes with the rows unchanged: new reference", () => {
		const { userCtx, systemSettingsCtx, v, stop } = setup()
		const first = v.dossier
		expect(first.debugPrompts).toBe(false)
		userCtx.user.isAdmin = true
		systemSettingsCtx.settings.contextDebuggingEnabled = true
		flushSync()
		expect(v.dossier).not.toBe(first)
		expect(v.dossier.debugPrompts).toBe(true)
		stop()
	})
})
