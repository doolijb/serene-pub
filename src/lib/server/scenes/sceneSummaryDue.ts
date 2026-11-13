/**
 * 🚧 **Which finished scene is due a summary** — the scene summaries routine's
 * look (`core:query/scene-summary-due@1`; the name is provisional). Read-only:
 * it writes nothing and asks no model.
 *
 * One scene at most, the oldest first (smallest `closedAtMessageId`), on
 * `main`, closed, still `none`, and not decided about: its summary is blank
 * and no summarize-scene spec has processed it — a summary a person saved
 * and a boundary move reset, and a review a person discarded, are never taken.
 * The one exception is a routine-saved summary that Back reset
 * (`summaryOrigin: "routine"`), which the routine may write again. It closed at
 * least `depth` rounds ago, counted by `replayStoryLane` as the scenes routine
 * counts them. Not due: the session's Summaries is Never, any turn is taken
 * back, or (a branch) the scene is one of the copied lines' — a branch copies
 * messages, never scene rows, so a scene row on a branch is the branch's own
 * and the rule is a guard on the lines it opens over.
 *
 * ⚠ Not *Summarize all* (`scenesToSummarize`, a person's press).
 */
import { and, asc, desc, eq, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import { sessionSceneContext } from "$lib/server/sessions/sceneSettings"

export async function sceneSummaryDueOf(
	db: Db,
	sessionId: number,
	opts: { depth: number }
): Promise<{ sceneId: number | null; why?: string }> {
	const none = (why: string) => ({ sceneId: null, why })
	const ctx = await sessionSceneContext(db, sessionId)
	if (!ctx) return none("this session is not there")
	if (ctx.settings.summary === "never")
		return none("this session's Summaries is Never")

	const [rewound] = await db
		.select({ id: schema.sessionMessages.id })
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				sql`${schema.sessionMessages.rewindOrdinal} IS NOT NULL`
			)
		)
		.limit(1)
	if (rewound) return none("turns are taken back")

	// One at a time: a `running` scene holds back every automatic Apply from
	// its start, and a backlog of old scenes must not start a summary every
	// two rounds on top of one still being written.
	const [writing] = await db
		.select({ id: schema.scenes.id })
		.from(schema.scenes)
		.where(
			and(
				eq(schema.scenes.sessionId, sessionId),
				eq(schema.scenes.summaryStatus, "running")
			)
		)
		.limit(1)
	if (writing) return none("a scene's summary is being written")

	const [session] = await db
		.select({ branchOf: schema.sessions.branchOfSessionId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	let copiedEnd = 0
	if (session?.branchOf != null) {
		const [copied] = await db
			.select({ id: schema.sessionMessages.id })
			.from(schema.sessionMessages)
			.where(
				and(
					eq(schema.sessionMessages.sessionId, sessionId),
					sql`${schema.sessionMessages.metadata} ->> 'copyOf' IS NOT NULL`
				)
			)
			.orderBy(desc(schema.sessionMessages.id))
			.limit(1)
		copiedEnd = copied?.id ?? 0
	}

	const rows = await db
		.select({
			id: schema.scenes.id,
			opened: schema.scenes.openedAtMessageId,
			closed: schema.scenes.closedAtMessageId,
			summary: schema.scenes.summary,
			processedBySpecId: schema.scenes.processedBySpecId,
			origin: schema.scenes.summaryOrigin
		})
		.from(schema.scenes)
		.where(
			and(
				eq(schema.scenes.sessionId, sessionId),
				eq(schema.scenes.channel, "main"),
				eq(schema.scenes.summaryStatus, "none"),
				sql`${schema.scenes.openedAtMessageId} IS NOT NULL`,
				sql`${schema.scenes.closedAtMessageId} IS NOT NULL`
			)
		)
		.orderBy(asc(schema.scenes.closedAtMessageId), asc(schema.scenes.id))
	// Undecided: nobody has drafted it since it last became due (a draft a
	// person discarded, a pressed run, stays theirs), and it holds no summary
	// but the routine's own that Back or a moved boundary reset (that reset
	// clears the draft mark, `summaryResetPatch`).
	const candidates = rows.filter(
		(s) =>
			s.processedBySpecId == null &&
			(s.origin === "routine" || !(s.summary ?? "").trim()) &&
			(s.opened ?? 0) > copiedEnd
	)
	if (!candidates.length) return none("no finished scene is due a summary")

	const { replayStoryLane } = await import(
		"$lib/server/pipelines/routines/moments"
	)
	const { tally, lines } = await replayStoryLane(db, sessionId)
	const cur = tally?.round ?? 1
	for (const s of candidates) {
		const at = s.closed!
		const exact = lines.find((l) => l.id === at)
		const before = exact ?? [...lines].reverse().find((l) => l.id < at)
		const closeRound = before?.round ?? 1
		if (closeRound <= cur - opts.depth) return { sceneId: s.id }
	}
	return none("no finished scene is due a summary")
}
