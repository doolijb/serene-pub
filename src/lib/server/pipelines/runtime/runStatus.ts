/**
 * The run's status relay (plans/29 R-19, R-21; 30 U5h) — core's half of
 * `ctx.status`.
 *
 * A node says what it is doing — *{speaker} is thinking*, *{speaker} is
 * typing* — and the executor hands each change to the host as the handler
 * wrote it (`RunOptions.onStatus`). Everything that happens to that text
 * afterwards is here, so the three surfaces that show it cannot disagree:
 *
 *  · **`{speaker}` is filled** — the one host-filled variable
 *    (`HOST_FILLED_STATUS_VARS`). A handler is blind to who is speaking and
 *    stays so; the run knows, once, from its speaker reference.
 *  · **the live row**, when the run has one: the status lands on the row's
 *    `generationStatus` and the row is announced, the same `sessionMessage`
 *    frame the stream uses — where the retired `generationStage` enum went.
 *  · **the session list**: the registry remembers the run's current status
 *    so `sessions:list` can carry it, and `sessions:runStatus` announces each
 *    change to the session's users; `null` when the run ends.
 *  · **the caller's own seam** (`SpecRunRequest.onStatus`) — the progress
 *    card frame a reply or a triggered function emits, handed the FILLED
 *    text so no caller fills a variable a second way.
 *
 * The queue's `queued` / `loading` are host statuses too (`queue()`): a call
 * waiting its turn or a managed backend loading a model is a fact the pipeline
 * cannot know, said in the same voice; `generating` restores the node's own
 * status (*typing*) rather than saying something new. Shown only when the wait
 * lasts (`QUEUE_STATUS_DELAY_MS`): an idle queue reports all three within the
 * same tick, and a wait nobody could notice is not a wait.
 *
 * Statuses are ephemeral (F34). The one record is `Receipt.lastStatus`, which
 * `runSpec` fills through `fill()` before the receipt is stored.
 */

import {
	fillStatusVars,
	isParticipantRef,
	sameStatus,
	statusVarsMentioned,
	type ParticipantRef,
	type StatusText
} from "@serene-pub/sdk"
import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { broadcastToSessionUsers } from "$lib/server/sockets/utils/broadcastHelpers"
import { setStatus as setRegistryStatus } from "$lib/server/pipelines/runtime/runRegistry"
import type { LiveRow, SessionIo } from "$lib/server/pipelines/runtime/liveRow"
import type { LLMQueueStatus } from "$lib/server/utils/llmQueue"
import { resolveCharacterName } from "$lib/shared/utils/resolveCharacterName"
import { i18nTextIn } from "$lib/shared/i18n/i18nText"

// db is the global Db — see db/types.d.ts

/**
 * The queue's two waits, as statuses. `generating` restores the node's own;
 * the terminal three (`done` · `error` · `cancelled`) say nothing — the run's
 * end is the run-end hook's to announce, not the queue's.
 */
export const QUEUE_STATUS: Partial<Record<LLMQueueStatus, StatusText>> = {
	queued: { i18n: { en: "waiting for the model" } },
	loading: { i18n: { en: "loading the model" } }
}

/**
 * How long a queue wait must last before the row says so. The queue reports
 * `queued`, then `loading`, then `generating` synchronously when nothing is
 * ahead and the adapter's preflight is instant — three statuses in one tick
 * that would replace *typing* with two flickers and put it back.
 */
export const QUEUE_STATUS_DELAY_MS = 400

/** One `sessions:runStatus` frame: a run's current status, or its end. */
export interface RunStatusFrame {
	sessionId: number
	runId: string
	/** The filled status, or null when the run ended. */
	status: StatusText | null
}

export interface StatusRelayOptions {
	db: Db
	io?: SessionIo
	sessionId: number
	runId: string
	live: LiveRow
	/**
	 * Who is speaking this run — the inlet's participant reference, the
	 * side character's fact, or nobody (a narrator turn, a summary). What
	 * `{speaker}` resolves from; read lazily, once, on the first status that
	 * mentions it.
	 */
	speaker?: ParticipantRef | null
	sideCharacterName?: string | null
	/** The run owner, whose language an envoy's name is read in. */
	userId?: number
	/** The caller's seam — handed the filled text, in order. */
	onStatus?: (nodeKey: string, text: StatusText) => void
}

export interface StatusRelay {
	/** The executor's `onStatus`: a node set its status. Sync; ordered. */
	set(nodeKey: string, text: StatusText): void
	/** The LLM queue's status for this run's oracle call. */
	queue(status: LLMQueueStatus): void
	/** The current filled status, if the run has set one. */
	readonly current: StatusText | undefined
	/** Fill a status's host variables — for the receipt's `lastStatus`. */
	fill(text: StatusText): Promise<StatusText>
	/** The run ended: the list hears `null`. Awaits every frame in flight. */
	end(): Promise<void>
}

/**
 * The speaker's display name for a run: the side character's, an envoy's
 * declared name in the run owner's language, a character's nickname-or-name,
 * else the narrator's configured name. Undefined when the run has nobody to
 * name — a summary, a graph build — and a status mentioning `{speaker}` then
 * keeps its placeholder rather than inventing one.
 */
export async function speakerDisplayName(
	db: Db,
	opts: {
		sessionId: number
		speaker?: ParticipantRef | null
		sideCharacterName?: string | null
		userId?: number
	}
): Promise<string | undefined> {
	if (opts.sideCharacterName?.trim()) return opts.sideCharacterName.trim()
	const ref = opts.speaker
	// `null` and `undefined` are NOT the same "no speaker" (ruled
	// 2026-09-16): `null` is a narrator turn, which does have a name to
	// give — the session's configured narrator — while `undefined` is a
	// run that never had a speaker port at all (`sessions:triggerFunction`,
	// summarize, a scene). The latter falls out here rather than reaching
	// the narrator branch below, so its status keeps `{speaker}` unfilled.
	if (ref === undefined) return undefined
	if (ref && isParticipantRef(ref)) {
		if (ref.startsWith("character:")) {
			const id = Number(ref.slice("character:".length))
			if (Number.isFinite(id)) {
				const [row] = await db
					.select({
						name: schema.characters.name,
						nickname: schema.characters.nickname
					})
					.from(schema.characters)
					.where(eq(schema.characters.id, id))
					.limit(1)
				if (row) return resolveCharacterName(row, "") || undefined
			}
			return undefined
		}
		if (ref.startsWith("envoy:")) {
			const slug = ref.slice("envoy:".length)
			const { sessionDeclaredEnvoys } = await import(
				"$lib/server/pipelines/entities/envoys"
			)
			const declared = (
				await sessionDeclaredEnvoys(db, opts.sessionId)
			).find((d) => d.slug === slug)
			if (!declared) return undefined
			let language: string | undefined
			if (opts.userId != null) {
				const { resolveUserLanguage } = await import("$lib/server/i18n")
				language = (await resolveUserLanguage(opts.userId)).code
			}
			return i18nTextIn(declared.name, language) ?? slug
		}
		return undefined
	}
	// A narrator turn: the session's configured narrator name, as the row
	// it fills was labelled — the same chain the placeholder outlet walks.
	const { narratorNameFor } = await import(
		"$lib/server/pipelines/runtime/host"
	)
	return (await narratorNameFor(db, opts.sessionId, opts.userId)) ?? undefined
}

export function createStatusRelay(opts: StatusRelayOptions): StatusRelay {
	const { db, io, sessionId, runId, live } = opts
	/** The node's own status, filled — what `generating` restores. */
	let current: StatusText | undefined
	/** The last status shown, whoever set it — what a repeat is judged against. */
	let shown: StatusText | undefined
	let speaker: Promise<string | undefined> | undefined
	/** Frames leave in the order their statuses arrived — see `LiveRow.announce`. */
	let chain: Promise<void> = Promise.resolve()
	/** A queue wait not yet long enough to show, and whether one is showing. */
	let queueTimer: ReturnType<typeof setTimeout> | undefined
	let queueShown = false

	/**
	 * Memoized: resolved once for the whole run, on the first status that
	 * mentions `{speaker}`, and reused after. For an envoy this reads
	 * `opts.userId` — the RUN OWNER's language, not each viewer's — so
	 * every participant watching this run's `sessions:runStatus` frames
	 * sees the envoy's name in the same language. A known decision, not a
	 * per-viewer localization gap: the surrounding status prose still
	 * resolves per viewer from its locale map, only the name inside it is
	 * fixed at the owner's.
	 */
	/**
	 * Who speaks, named from the **trigger** again (PLAN-turn-order §4.6,
	 * §7; A7).
	 *
	 * The run does not decide any more: the entry being fired names the
	 * speaker, and it arrives on the request — so `opts.speaker` is known
	 * before the first node, and the `onOpened` relay that waited for the
	 * placeholder to say who has gone with the node that made it necessary.
	 * A run that names nobody is a narrator turn or a run with no speaker
	 * at all (a summary, a scene); both are unfilled throughout, without a
	 * read, exactly as before.
	 */
	const speakerName = (): Promise<string | undefined> => {
		if (speaker) return speaker
		if (opts.speaker == null && !opts.sideCharacterName?.trim())
			return Promise.resolve(undefined)
		return (speaker = speakerDisplayName(db, {
			sessionId,
			speaker: opts.speaker,
			sideCharacterName: opts.sideCharacterName,
			userId: opts.userId
		}).catch(() => undefined))
	}

	const fill = async (text: StatusText): Promise<StatusText> => {
		// Only a text that mentions the variable pays for the read — read
		// through the SDK, which walks both spellings of `i18n` (R-20).
		const mentions = statusVarsMentioned(text).includes("speaker")
		if (!mentions || text.vars?.speaker !== undefined) return text
		return fillStatusVars(text, { speaker: await speakerName() })
	}

	const show = async (nodeKey: string, filled: StatusText) => {
		if (shown && sameStatus(shown, filled)) return
		shown = filled
		setRegistryStatus(runId, filled)
		await live.status(filled)
		if (io)
			await broadcastToSessionUsers(io, sessionId, "sessions:runStatus", {
				sessionId,
				runId,
				status: filled
			} satisfies RunStatusFrame).catch(() => {})
		try {
			opts.onStatus?.(nodeKey, filled)
		} catch {
			// A status display must never take a run down.
		}
	}

	const enqueue = (work: () => Promise<void>) => {
		chain = chain.then(work).catch(() => {})
	}

	/** The list hears `null`: nothing shown any more, whatever was. */
	const clearShown = () =>
		enqueue(async () => {
			if (!shown) return
			shown = undefined
			setRegistryStatus(runId, undefined)
			if (io)
				await broadcastToSessionUsers(io, sessionId, "sessions:runStatus", {
					sessionId,
					runId,
					status: null
				} satisfies RunStatusFrame).catch(() => {})
		})

	return {
		get current() {
			return current
		},
		set(nodeKey, text) {
			enqueue(async () => {
				/**
				 * A status that says *{speaker} is thinking* with nobody to
				 * put in it is withheld rather than shown mangled.
				 *
				 * Since A7 this is only ever a run with no speaker at all —
				 * a narrator turn, a summary, a scene — because the entry
				 * being fired names the speaker before the first node, so
				 * there is no window in which a character's turn has nobody
				 * to name.
				 */
				if (
					statusVarsMentioned(text).includes("speaker") &&
					text.vars?.speaker === undefined &&
					opts.speaker == null &&
					!opts.sideCharacterName?.trim()
				)
					return
				const filled = await fill(text)
				current = filled
				await show(nodeKey, filled)
			})
		},
		queue(status) {
			const text = QUEUE_STATUS[status]
			if (text) {
				// A wait: said only once it has lasted. A later queue status
				// restarts the clock with its own words.
				if (queueTimer) clearTimeout(queueTimer)
				queueTimer = setTimeout(() => {
					queueTimer = undefined
					queueShown = true
					enqueue(() => show("queue", text))
				}, QUEUE_STATUS_DELAY_MS)
				queueTimer.unref?.()
				return
			}
			// The wait is over — `generating`, or the call settled. What the
			// node said stands again, if a wait had replaced it.
			if (queueTimer) {
				clearTimeout(queueTimer)
				queueTimer = undefined
			}
			if (queueShown && status === "generating") {
				queueShown = false
				const restore = current
				if (restore) enqueue(() => show("queue", restore))
				// A queued oracle that never called `ctx.status` before
				// `ctx.call` has nothing to restore. Leaving "waiting for
				// the model" up would misreport a call already generating
				// as still queued, so the wait is cleared instead — every
				// oracle SHOULD set its own status before calling; this is
				// only the fallback for one that does not.
				else clearShown()
			}
		},
		fill,
		async end() {
			if (queueTimer) {
				clearTimeout(queueTimer)
				queueTimer = undefined
			}
			clearShown()
			await chain
		}
	}
}
