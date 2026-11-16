/**
 * 🚧 The session store (pr-6s2 G3): the records of the ONE session the session page has
 * open, one per entity id — the session row, its message rows (with the window that pages
 * them), its members, the cards its seats wear, its scenes, the runs in flight and its
 * genre row. Every socket result the page hears merges into it; the page, its scenes and
 * the shell's `openSessionCtx` read it.
 *
 * - One open session: `open(id)` drops every record of the last one.
 * - Module-scoped, like `runProgress`: Layout's view and the page share `sessionStore`.
 * - Every write runs untracked, so a caller inside an effect never subscribes to what the
 *   write reads. Reads are plain and tracked.
 *
 * ⚠ Not `sessionState` (`client/state/sessionState.svelte.ts`, the stats and states cache).
 */
import { SvelteMap } from "svelte/reactivity"
import { untrack } from "svelte"
import { withRevisedAvatar } from "$lib/client/utils/media"
import { mergeRefreshedRows } from "./refreshMerge"
import {
	composeCast,
	splitPayload,
	type SessionCardRecord,
	type SessionCast,
	type SessionGenreRecord,
	type SessionMembersRecord,
	type SessionMessageRecord,
	type SessionMessageWindow,
	type SessionPatch,
	type SessionPayload,
	type SessionRecord,
	type SessionRunRecord,
	type SessionSceneRecord
} from "./records"

type Card = NonNullable<SessionCardRecord>

// ── Cell rows ─────────────────────────────────────────────────────────────────
// A message row the store holds is a *cell row* (not a "live row": NOMENCLATURE §9's live row is the
// server's streaming placeholder, `pipelines/runtime/liveRow.ts`): a plain object whose own fields are
// enumerable, configurable getters, each over its own `$state.raw` cell. A streamed frame
// for a row already held patches the cells that moved and keeps the object, so the rows
// array stays the same and only a reader of a moved field reruns. Spread, JSON, structured
// clone and `$state.snapshot` all read through `[[Get]]`, so every value read is what it was.

const SOURCE = Symbol("sessionRowSource")

interface Cell<T> {
	get(): T
	set(v: T): void
}

function cell<T>(v: T): Cell<T> {
	let s = $state.raw(v)
	return {
		get: () => s,
		set: (n: T) => {
			s = n
		}
	}
}

interface LiveHandle {
	cells: Map<string, Cell<unknown>>
	source: Cell<unknown>
}

const live = new WeakMap<object, LiveHandle>()

/** A new cell row over a plain incoming one (its fields copied into cells; the object itself is the source). */
function cellRow(incoming: SessionMessageRecord): SessionMessageRecord {
	const row = {}
	const cells = new Map<string, Cell<unknown>>()
	for (const key of Object.keys(incoming)) {
		const c = cell((incoming as Record<string, unknown>)[key])
		cells.set(key, c)
		Object.defineProperty(row, key, { get: c.get, enumerable: true, configurable: true })
	}
	const source = cell<unknown>(incoming)
	Object.defineProperty(row, SOURCE, { get: source.get, enumerable: false, configurable: true })
	live.set(row, { cells, source })
	return row as SessionMessageRecord
}

/**
 * The latest plain object a cell row was built or patched from (a tracked read of one cell: it
 * moves on every frame, including one that changed no field), or the row itself for a plain object.
 */
export function sourceOf<T extends object>(row: T): T {
	return ((row as Record<symbol, unknown>)[SOURCE] as T | undefined) ?? row
}

/** Structural equality for JSON-shaped data; stops at the first difference. */
function deepEqual(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true
	if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false
	const arr = Array.isArray(a)
	if (arr !== Array.isArray(b)) return false
	if (arr) {
		const x = a as unknown[]
		const y = b as unknown[]
		if (x.length !== y.length) return false
		for (let i = 0; i < x.length; i++) if (!deepEqual(x[i], y[i])) return false
		return true
	}
	if (Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false
	const ka = Object.keys(a)
	if (ka.length !== Object.keys(b).length) return false
	for (const k of ka) {
		if (!Object.prototype.hasOwnProperty.call(b, k)) return false
		if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false
	}
	return true
}

/** Sets each cell of a cell row whose value differs, then the source. Only when the incoming row has exactly the held row's keys. */
function patchCells(held: SessionMessageRecord, incoming: SessionMessageRecord): boolean {
	const handle = live.get(held)
	if (!handle) return false
	const keys = Object.keys(incoming)
	if (keys.length !== handle.cells.size) return false
	for (const k of keys) if (!handle.cells.has(k)) return false
	for (const k of keys) {
		const c = handle.cells.get(k)!
		const next = (incoming as Record<string, unknown>)[k]
		if (!deepEqual(c.get(), next)) c.set(next)
	}
	handle.source.set(incoming)
	return true
}

function sameIds(a: readonly number[], b: readonly number[]): boolean {
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
	return true
}

export function createSessionStore() {
	const sessions = new SvelteMap<number, SessionRecord>()
	const messages = new SvelteMap<number, SessionMessageRecord>()
	const windows = new SvelteMap<number, SessionMessageWindow>()
	const members = new SvelteMap<number, SessionMembersRecord>()
	const cards = new SvelteMap<number, Card>()
	const scenes = new SvelteMap<number, SessionSceneRecord>()
	const sceneIds = new SvelteMap<number, readonly number[]>()
	const scened = new SvelteMap<number, readonly number[]>()
	const runs = new SvelteMap<string, SessionRunRecord>()
	const genres = new SvelteMap<number, SessionGenreRecord>()
	let openSessionId = $state<number | null>(null)

	/** Puts one incoming row in the map: the held cell row patched in place when the keys match, else a new cell row. */
	function place(incoming: SessionMessageRecord): SessionMessageRecord {
		const held = messages.get(incoming.id)
		if (held === incoming) return held
		if (held && !live.has(incoming) && patchCells(held, incoming)) return held
		const next = live.has(incoming) ? incoming : cellRow(incoming)
		messages.set(incoming.id, next)
		return next
	}

	function setWindowIds(sessionId: number, ids: number[]) {
		const w = windows.get(sessionId)
		if (w) windows.set(sessionId, { ...w, ids })
	}

	return {
		get openSessionId(): number | null {
			return openSessionId
		},
		session(id: number): SessionRecord | undefined {
			return sessions.get(id)
		},
		messagesOf(id: number): SessionMessageRecord[] {
			const ids = windows.get(id)?.ids ?? []
			const out: SessionMessageRecord[] = []
			for (const i of ids) {
				const m = messages.get(i)
				if (m) out.push(m)
			}
			return out
		},
		windowOf(id: number): SessionMessageWindow | undefined {
			return windows.get(id)
		},
		castOf(id: number): SessionCast | undefined {
			const m = members.get(id)
			return m ? composeCast(m, (cid) => cards.get(cid)) : undefined
		},
		scenesOf(id: number): SessionSceneRecord[] {
			const out: SessionSceneRecord[] = []
			for (const sid of sceneIds.get(id) ?? []) {
				const s = scenes.get(sid)
				if (s) out.push(s)
			}
			return out
		},
		scenedOf(id: number): readonly number[] {
			return scened.get(id) ?? []
		},
		runsOf(id: number): SessionRunRecord[] {
			return [...runs.values()].filter((r) => r.sessionId === id)
		},
		genreOf(id: number): SessionGenreRecord | undefined {
			return genres.get(id)
		},

		/** Opens a session: every record of any other session is dropped. */
		open(id: number | null): void {
			return untrack(() => {
				if (id === openSessionId) return
				openSessionId = id
				for (const k of [...sessions.keys()]) if (k !== id) sessions.delete(k)
				for (const k of [...windows.keys()]) if (k !== id) windows.delete(k)
				for (const k of [...members.keys()]) if (k !== id) members.delete(k)
				for (const k of [...sceneIds.keys()]) if (k !== id) sceneIds.delete(k)
				for (const k of [...scened.keys()]) if (k !== id) scened.delete(k)
				for (const k of [...genres.keys()]) if (k !== id) genres.delete(k)
				for (const [k, r] of [...runs]) if (r.sessionId !== id) runs.delete(k)
				messages.clear()
				cards.clear()
				scenes.clear()
			})
		},

		/** The `sessions:get` reply without `beforeId`. False (nothing written) when the session is not the open one. */
		load(payload: SessionPayload, pagination: SessionMessageWindow["pagination"]): boolean {
			return untrack(() => {
				if (payload.id !== openSessionId) return false
				const { session, rows, members: seats, cards: seated } = splitPayload(payload)
				const ids = rows.map((r) => r.id)
				const keep = new Set(ids)
				for (const old of windows.get(payload.id)?.ids ?? []) if (!keep.has(old)) messages.delete(old)
				sessions.set(payload.id, session)
				for (const r of rows) place(r)
				windows.set(payload.id, { ids, pagination })
				for (const c of seated) cards.set(c.id, c)
				members.set(payload.id, seats)
				return true
			})
		},

		/** The `sessions:refresh` push. Returns the rows the merge added. */
		merge(
			payload: Partial<SessionPayload> & { id: number },
			coversFromId: number | null
		): SessionMessageRecord[] {
			return untrack(() => {
				const held = sessions.get(payload.id)
				if (!held) return []
				const { sessionMessages, sessionCharacters, sessionPersonas, sessionGuests, ...rest } = payload
				sessions.set(payload.id, { ...held, ...rest } as SessionRecord)
				const added: SessionMessageRecord[] = []
				if (Array.isArray(sessionMessages)) {
					const window = windows.get(payload.id)
					const before = (window?.ids ?? [])
						.map((i) => messages.get(i))
						.filter((m): m is SessionMessageRecord => !!m)
					const next = mergeRefreshedRows(before, sessionMessages as SessionMessageRecord[], coversFromId)
					const had = new Set(before.map((m) => m.id))
					const keep = new Set(next.map((m) => m.id))
					for (const m of before) if (!keep.has(m.id)) messages.delete(m.id)
					for (const m of next) {
						const placed = place(m)
						if (!had.has(m.id)) added.push(placed)
					}
					const ids = next.map((m) => m.id)
					if (window && !sameIds(window.ids, ids)) windows.set(payload.id, { ...window, ids })
				}
				const seats = members.get(payload.id)
				if (seats && (Array.isArray(sessionCharacters) || Array.isArray(sessionPersonas) || Array.isArray(sessionGuests))) {
					const split = splitPayload({
						sessionCharacters: Array.isArray(sessionCharacters) ? sessionCharacters : [],
						sessionPersonas: Array.isArray(sessionPersonas) ? sessionPersonas : []
					} as unknown as SessionPayload)
					const nextMembers: SessionMembersRecord = { ...seats }
					if (Array.isArray(sessionCharacters)) nextMembers.characters = split.members.characters
					if (Array.isArray(sessionPersonas)) nextMembers.personas = split.members.personas
					if (Array.isArray(sessionGuests)) nextMembers.guests = sessionGuests
					for (const c of split.cards) cards.set(c.id, c)
					members.set(payload.id, nextMembers)
				}
				return added
			})
		},

		/** One message row landed or changed. Null when its session is not held. */
		upsertMessage(row: SessionMessageRecord): { added: boolean; previous?: SessionMessageRecord } | null {
			return untrack(() => {
				if (!sessions.has(row.sessionId)) return null
				const held = messages.get(row.id)
				// The snapshot is taken before the patch: a caller compares it with the new values.
				const previous = held ? ({ ...held } as SessionMessageRecord) : undefined
				place(row)
				if (previous) return { added: false, previous }
				const ids = [...(windows.get(row.sessionId)?.ids ?? []), row.id].sort((a, b) => a - b)
				setWindowIds(row.sessionId, ids)
				return { added: true }
			})
		},

		/** A mid-stream frame patches the held generating row's content (and reasoning) in place; null when nothing is patched. */
		applyMessageDelta(
			delta: Sockets.SessionMessageDelta.Response
		): { row: SessionMessageRecord; previous: SessionMessageRecord } | null {
			return untrack(() => {
				if (!sessions.has(delta.sessionId)) return null
				const held = messages.get(delta.id)
				if (!held || held.sessionId !== delta.sessionId || !live.has(held)) return null
				if (held.isGenerating !== true) return null
				const previous = { ...held } as SessionMessageRecord
				const source = sourceOf(held)
				const incoming = { ...source, content: delta.content } as SessionMessageRecord
				if (typeof delta.reasoning === "string")
					incoming.metadata = {
						...((source.metadata as object | null) ?? {}),
						reasoning: delta.reasoning
					} as SessionMessageRecord["metadata"]
				if (!patchCells(held, incoming)) return null
				return { row: held, previous }
			})
		},

		/** Drops one row. Returns the row it held. */
		removeMessage(sessionId: number, id: number): SessionMessageRecord | undefined {
			return untrack(() => {
				if (!sessions.has(sessionId)) return undefined
				const held = messages.get(id)
				const w = windows.get(sessionId)
				if (w && w.ids.includes(id)) setWindowIds(sessionId, w.ids.filter((i) => i !== id))
				messages.delete(id)
				return held
			})
		},

		/** Load-older: adds the rows not held. Returns the ones added. */
		prependMessages(sessionId: number, rows: readonly SessionMessageRecord[]): SessionMessageRecord[] {
			return untrack(() => {
				if (!sessions.has(sessionId)) return []
				const added: SessionMessageRecord[] = []
				for (const r of rows) {
					if (messages.has(r.id)) continue
					added.push(place(r))
				}
				if (added.length) {
					const ids = [...(windows.get(sessionId)?.ids ?? []), ...added.map((r) => r.id)].sort((a, b) => a - b)
					setWindowIds(sessionId, ids)
				}
				return added
			})
		},

		setPagination(sessionId: number, pagination: SessionMessageWindow["pagination"]): void {
			return untrack(() => {
				const w = windows.get(sessionId)
				if (w) windows.set(sessionId, { ...w, pagination })
			})
		},

		patchSession(id: number, patch: SessionPatch): void {
			return untrack(() => {
				const held = sessions.get(id)
				if (held) sessions.set(id, { ...held, ...patch } as SessionRecord)
			})
		},

		/** `characters:update`: only a card the store holds is replaced. */
		mergeCard(card: Card): void {
			return untrack(() => {
				if (cards.has(card.id)) cards.set(card.id, card)
			})
		},

		/** `media:changed`: every held card through `withRevisedAvatar`; set only those it changed. */
		reviseAvatars(change: Sockets.Media.Changed.Response): void {
			return untrack(() => {
				for (const [id, card] of [...cards]) {
					const next = withRevisedAvatar(card as any, change as any) as Card
					if (next !== card) cards.set(id, next)
				}
			})
		},

		mergeSceneList(msg: Sockets.Scenes.List.Response): void {
			return untrack(() => {
				if (msg.sessionId !== openSessionId) return
				const list = msg.sceneList as SessionSceneRecord[]
				const listed = new Set(list.map((s) => s.id))
				for (const old of sceneIds.get(msg.sessionId) ?? []) if (!listed.has(old)) scenes.delete(old)
				for (const s of list) scenes.set(s.id, s)
				sceneIds.set(msg.sessionId, list.map((s) => s.id))
			})
		},

		mergeScenedMessageIds(msg: Sockets.Scenes.SenedMessageIds.Response): void {
			return untrack(() => {
				if (msg.sessionId === openSessionId) scened.set(msg.sessionId, [...msg.scenedMessageIds])
			})
		},

		mergeRunStatus(frame: Sockets.Sessions.RunStatus.Response): void {
			return untrack(() => {
				if (frame.sessionId !== openSessionId) return
				const held = runs.get(frame.runId)
				if (frame.status === null) {
					// 🚧 A routine run shown by its own start frame is dropped by its own end frame
					// (it carries `routine`); the status relay's clear mid-run leaves it shown.
					if (held?.routine && !frame.routine) return
					runs.delete(frame.runId)
					return
				}
				const routine = frame.routine ?? held?.routine
				runs.set(frame.runId, {
					sessionId: frame.sessionId,
					runId: frame.runId,
					kind: frame.kind,
					status: frame.status,
					...(frame.reply ? { reply: frame.reply } : {}),
					...(frame.lineBound ? { lineBound: true as const } : {}),
					...(routine ? { routine } : {})
				})
			})
		},

		mergeGenreOf(msg: Sockets.Sessions.GenreOf.Response): void {
			return untrack(() => {
				if (msg.sessionId === openSessionId) genres.set(msg.sessionId, msg.genre)
			})
		}
	}
}

export type SessionStore = ReturnType<typeof createSessionStore>

/** 🚧 The session store (pr-6s2 G3): the open session's records, one per entity id. ⚠ Not `sessionState` (stats and states). */
export const sessionStore = createSessionStore()
