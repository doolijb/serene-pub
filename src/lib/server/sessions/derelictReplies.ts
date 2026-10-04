import { and, eq, lt, notInArray } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { updateLegacyWhere } from "$lib/server/messages/store"

/**
 * What a derelict reply says on its row. Our words, naming nobody, so it is
 * the same sentence for everyone the row is served to.
 */
export const DERELICT_REPLY_SENTENCE =
	"The server restarted before this reply finished."

/**
 * Settle every **derelict reply** — a message row still marked generating
 * whose run died with the process that ran it (a crash, a kill, a power cut)
 * — and say which rows it settled.
 *
 * Nothing in this process is filling such a row: the run registry and the LLM
 * queue live in memory and began empty. Left alone, the row says "generating"
 * until someone presses Stop, every Regenerate, Continue and swipe in its
 * session is refused ("a response is already generating"), and the embedding
 * queue never takes it (`MESSAGE_STORE.settled`). It is settled the way a run
 * that failed settles its row (`persistGenerationErrorRow`): the text that
 * arrived stays, and the row says why it stopped. No session event is
 * recorded: nobody pressed Stop, and a turn order answering a reply landing at
 * boot could start a reply nobody asked for.
 *
 * ⚠ Only rows last written before `bootedAt`, this process's start. Every
 * write that makes a row generate moves its `updated_at`, so a row this
 * process is generating is never taken — also when this runs again on a live
 * instance (a dev reload re-runs the startup tasks). A run's live row is left
 * out as well.
 */
export async function settleDerelictReplies(
	db: Db,
	bootedAt: Date
): Promise<Array<{ id: number; sessionId: number }>> {
	const { active } = await import("$lib/server/pipelines/runtime/runRegistry")
	const live = active()
		.map((run) => run.liveRow)
		.filter((id): id is number => typeof id === "number")
	const settled = await updateLegacyWhere(
		db,
		and(
			eq(schema.sessionMessages.isGenerating, true),
			lt(schema.sessionMessages.updatedAt, bootedAt),
			live.length
				? notInArray(schema.sessionMessages.id, live)
				: undefined
		),
		{
			isGenerating: false,
			generationStatus: null,
			queueItemId: null,
			error: { message: DERELICT_REPLY_SENTENCE }
		}
	)
	return settled.map((row) => ({ id: row.id, sessionId: row.sessionId }))
}

/**
 * The boot half: settle the derelict replies, then hand each session that had
 * one to the embedding queue (`autoEnqueueSession`, which does nothing while
 * embeddings are off). The queue judges a row by its text's hash, so a
 * settled reply is embedded once — and not at all when its vector already
 * holds the text it kept (a Continue that died before a word arrived), or
 * when it kept no text (`messageHasText`: a reply still waiting in the queue).
 *
 * Never throws into boot for a session it could not enqueue: the next sweep
 * of the queue finds the row anyway, now that it is settled.
 */
export async function reconcileDerelictReplies(opts: {
	db: Db
	/** This process's start; a test names its own. */
	bootedAt?: Date
	/** Where a session goes to be embedded; a test records it. */
	enqueue?: (sessionId: number) => Promise<void>
}): Promise<number> {
	const settled = await settleDerelictReplies(
		opts.db,
		opts.bootedAt ?? processStartedAt()
	)
	if (!settled.length) return 0
	const enqueue =
		opts.enqueue ??
		(async (sessionId: number) => {
			const { autoEnqueueSession } = await import(
				"$lib/server/embedding/vectorizationQueue"
			)
			await autoEnqueueSession(sessionId)
		})
	for (const sessionId of new Set(settled.map((row) => row.sessionId))) {
		try {
			await enqueue(sessionId)
		} catch (err) {
			console.error(
				`[replies] session ${sessionId}'s settled replies could not be queued for embedding:`,
				err
			)
		}
	}
	return settled.length
}

/** When this process started: a dev reload re-evaluating modules does not move it. */
const processStartedAt = () => new Date(performance.timeOrigin)
