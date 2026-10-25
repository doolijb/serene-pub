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
				for (const r of rows) messages.set(r.id, r)
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
						messages.set(m.id, m)
						if (!had.has(m.id)) added.push(m)
					}
					const ids = next.map((m) => m.id)
					if (window) windows.set(payload.id, { ...window, ids })
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
				const previous = messages.get(row.id)
				messages.set(row.id, row)
				if (previous) return { added: false, previous }
				const ids = [...(windows.get(row.sessionId)?.ids ?? []), row.id].sort((a, b) => a - b)
				setWindowIds(row.sessionId, ids)
				return { added: true }
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
					messages.set(r.id, r)
					added.push(r)
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
				if (frame.status === null) {
					runs.delete(frame.runId)
					return
				}
				runs.set(frame.runId, {
					sessionId: frame.sessionId,
					runId: frame.runId,
					kind: frame.kind,
					status: frame.status,
					...(frame.reply ? { reply: frame.reply } : {})
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
