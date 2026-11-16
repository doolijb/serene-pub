/**
 * 🚧 **On revision** (PLAN-rulesets §28, ruled 2026-10-16) — what a delete or
 * retake of the latest turn does to the timeline (§29: the message history IS
 * the timeline's pointer, so moving it back is a revision).
 *
 * - `overwrite` (default): the tail goes, and everything anchored to it — state
 *   rows, the session's own notes' entries, clock moves — is retracted by the
 *   cascade; play goes on on the same line.
 * - `branch`: a session branch is forked at the message before the revised
 *   turn (`sessions/branch.ts`, run as the `branch` built-in, as
 *   `sessions:branch` does) and play goes on there. The old tail stays on the
 *   old session, untouched; the session's notes branch with it.
 *
 * The confirmation's sentence is the server's (`revisionNotice`), so the
 * dialog names the mode in effect without knowing the rule.
 *
 * 🚧 The same setting answers a clock moved back past dated things the session
 * already wrote (ruled 2026-11-14, ★12): `overwrite` keeps them in the lorebook
 * (they read again from their dates); `branch` forks the session at its newest
 * message and sets the branch's clock (`branchForClockMove`). A pipeline's move
 * is refused with a sentence (`CLOCK_MOVE_BACK_REFUSALS`), never made silently.
 */

import { and, desc, eq, like, lt } from "drizzle-orm"
import { DEFAULT_CHANNEL } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { liveMessageWhere } from "$lib/server/messages/store"

export const ON_REVISION_MODES = ["overwrite", "branch"] as const
export type OnRevision = (typeof ON_REVISION_MODES)[number]

export function isOnRevision(value: unknown): value is OnRevision {
	return typeof value === "string" && (ON_REVISION_MODES as readonly string[]).includes(value)
}

/** What a revision will do, for the confirmation to say. */
export interface RevisionNotice {
	mode: OnRevision
	/** How many turns the revision takes back. */
	turns: number
	/** The one sentence: "This will overwrite the last turn. There is no undo." / "This will branch here; …" */
	sentence: string
}

/** The confirmation's sentence for `mode` over `turns` turns. Pure. */
export function revisionNotice(mode: OnRevision, turns: number): RevisionNotice {
	const n = Math.max(1, Math.floor(turns))
	const sentence =
		mode === "branch"
			? "This will branch here; the old turns stay on the old branch."
			: n === 1
				? "This will overwrite the last turn. There is no undo."
				: `This will overwrite the last ${n} turns. There is no undo.`
	return { mode, turns: n, sentence }
}

/** The session's On revision setting. A missing session reads the default. */
export async function sessionOnRevision(db: Db, sessionId: number): Promise<OnRevision> {
	const [row] = await db
		.select({ onRevision: schema.sessions.onRevision })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	return isOnRevision(row?.onRevision) ? row.onRevision : "overwrite"
}

/**
 * A person's default for the sessions they start: their own, else the
 * instance's, else `overwrite` — the `lore_write_mode` pattern.
 */
export async function onRevisionDefaultFor(db: Db, userId: number | null | undefined): Promise<OnRevision> {
	if (userId != null) {
		const [own] = await db
			.select({ mode: schema.userSettings.onRevisionDefault })
			.from(schema.userSettings)
			.where(eq(schema.userSettings.userId, userId))
			.limit(1)
		if (isOnRevision(own?.mode)) return own.mode
	}
	const [pub] = await db
		.select({ mode: schema.systemSettings.onRevisionDefault })
		.from(schema.systemSettings)
		.where(eq(schema.systemSettings.id, 1))
		.limit(1)
	return isOnRevision(pub?.mode) ? pub.mode : "overwrite"
}

/** The last message of the session before `messageId`, or null when it is the first. */
export async function messageBefore(
	db: Db,
	sessionId: number,
	messageId: number
): Promise<number | null> {
	const [row] = await db
		.select({ id: schema.sessionMessages.id })
		.from(schema.sessionMessages)
		.where(
			and(
				eq(schema.sessionMessages.sessionId, sessionId),
				lt(schema.sessionMessages.id, messageId),
				// 🚧 The live history (RF fix 5).
				liveMessageWhere()
			)
		)
		.orderBy(desc(schema.sessionMessages.id))
		.limit(1)
	return row?.id ?? null
}

/** The suffix a revision's branch is named with: `Drowned King · branch 2`. */
const BRANCH_SUFFIX = /\s·\sbranch\s(\d+)$/

/**
 * 🚧 The name a revision's branch takes: the session's own name (without a
 * branch suffix it already carries) and the next branch number among the
 * owner's sessions of that name — the original being branch 1, the first
 * branch is `· branch 2`. Pure.
 */
export function revisionBranchName(sessionName: string, siblingNames: readonly string[]): string {
	const base = (sessionName ?? "").replace(BRANCH_SUFFIX, "").trim() || "Untitled session"
	let highest = 1
	for (const name of siblingNames) {
		const m = BRANCH_SUFFIX.exec(name)
		if (m && name.slice(0, m.index).trim() === base) highest = Math.max(highest, Number(m[1]))
	}
	return `${base} · branch ${highest + 1}`
}

/**
 * 🚧 The message metadata key that marks a revision branch's last line: the
 * turn after it was revised away, so nobody is waiting on the model for it
 * (Home reads "Your turn", not "Waiting on the model"). The mark matters
 * only while that line is the newest; a later line supersedes it.
 */
export const REVISED_TURN_KEY = "revisedTurn"

/** 🚧 Refused when a clock moved back under Branch has no message to branch at. */
export const NO_MESSAGE_TO_BRANCH_AT = "This session has no messages yet, so there is nothing to branch from."

/** 🚧 The confirmation's sentence for a clock moved back past the session's dated writes. Pure. */
export function clockMoveBackSentence(mode: OnRevision, count: number, latestLabel: string, toLabel: string): string {
	const n = count
	return mode === "branch"
		? `This branches the session here and moves the branch's story back to ${toLabel}. What this session has written dated after that stays on the line it leaves.`
		: `This moves the story back before ${n} thing${n === 1 ? "" : "s"} this session has written, the latest dated ${latestLabel}. They stay in the lorebook and read again from their dates.`
}

/** 🚧 Refusals of a pipeline's clock move back past the session's dated writes (P1). */
export const CLOCK_MOVE_BACK_REFUSALS = {
	/** A person's Time passes… press (`cause: 'action'`): its run cannot stop to ask. */
	action: "This would move the story back before things this session has written. Use Move the clock… to choose what happens.",
	/** Any other pipeline or routine move. */
	run: "The story clock was not moved back: this session has written at later dates. Move it by hand to choose what happens."
} as const

/** Refused when there is nothing before the revised turn to branch from. */
export const NOTHING_TO_BRANCH_FROM =
	"This turn is the session's first, so there is nothing before it to branch from."

/**
 * A revision in `branch` mode: fork the session at the message before
 * `firstRevisedId`, through the `branch` built-in (receipted, emitting
 * `session-branched`, the session's notes copied with it). The old session is
 * left exactly as it was. Returns the new session's id.
 */
export async function branchForRevision(
	db: Db,
	opts: {
		sessionId: number
		userId: number
		firstRevisedId: number
		io?: unknown
		/**
		 * 🚧 The revised turn's runs (2026-10-18, the 100-turn walk B8): what
		 * they wrote under the rows the branch copies — a seated card's change
		 * filed under its player's line — is left out of the branch, so the
		 * turn taken again (or the delete) starts from the sheet before it.
		 */
		runs?: Array<{ runId: number; runUuid: string }>
	}
): Promise<{ ok: true; sessionId: number } | { ok: false; error: string }> {
	const fork = await messageBefore(db, opts.sessionId, opts.firstRevisedId)
	if (fork == null) return { ok: false, error: NOTHING_TO_BRANCH_FROM }
	const branched = await branchAt(db, opts, fork)
	if (!branched.ok) return branched
	const id = branched.sessionId
	if (opts.runs?.length) {
		const { takeRunWritesElsewhere } = await import("$lib/server/sessions/rewind")
		await takeRunWritesElsewhere(db, { sessionId: id, runs: opts.runs, unitIds: [], landedBefore: false })
	}
	await markRevisedTurn(db, id)
	return { ok: true, sessionId: id }
}

/**
 * 🚧 The branch a clock moved back takes under Branch: fork the session at its
 * newest live message through the `branch` built-in. No revised-turn mark: the
 * branch loses no turn, it only stands at an earlier date.
 */
export async function branchForClockMove(
	db: Db,
	opts: { sessionId: number; userId: number; io?: unknown }
): Promise<{ ok: true; sessionId: number } | { ok: false; error: string }> {
	const newest = await newestLiveMessage(db, opts.sessionId)
	if (newest == null) return { ok: false, error: NO_MESSAGE_TO_BRANCH_AT }
	return await branchAt(db, opts, newest)
}

/** The session's newest live message, or null when it has none: where a clock move's branch forks. */
export async function newestLiveMessage(db: Db, sessionId: number): Promise<number | null> {
	const [newest] = await db
		.select({ id: schema.sessionMessages.id })
		.from(schema.sessionMessages)
		.where(and(eq(schema.sessionMessages.sessionId, sessionId), liveMessageWhere()))
		.orderBy(desc(schema.sessionMessages.id))
		.limit(1)
	return newest?.id ?? null
}

/** The one branch call both revisions share: name the branch, run the `branch` built-in at `fromMessage`. */
async function branchAt(
	db: Db,
	opts: { sessionId: number; userId: number; io?: unknown },
	fromMessage: number
): Promise<{ ok: true; sessionId: number } | { ok: false; error: string }> {
	const [source] = await db
		.select({ name: schema.sessions.name, userId: schema.sessions.userId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, opts.sessionId))
		.limit(1)
	const siblings = source
		? await db
				.select({ name: schema.sessions.name })
				.from(schema.sessions)
				.where(and(eq(schema.sessions.userId, source.userId), like(schema.sessions.name, "%· branch %")))
		: []
	const title = revisionBranchName(source?.name ?? "", siblings.map((r) => r.name ?? ""))
	const { runBuiltIn, writtenId } = await import("$lib/server/pipelines/runtime/builtins")
	const branched = await runBuiltIn(db, {
		kind: "branch",
		sessionId: opts.sessionId,
		actor: opts.userId,
		payload: { fromMessage, title },
		...(opts.io ? { io: opts.io as any } : {})
	})
	const id = writtenId(branched.write)
	if (!branched.ok || id === null)
		return { ok: false, error: branched.error ?? "The session could not be branched." }
	return { ok: true, sessionId: id }
}

/** Mark the branch's newest line (`REVISED_TURN_KEY`): the turn after it was revised away. */
async function markRevisedTurn(db: Db, sessionId: number): Promise<void> {
	const [last] = await db
		.select({ id: schema.sessionMessages.id, metadata: schema.sessionMessages.metadata })
		.from(schema.sessionMessages)
		.where(and(eq(schema.sessionMessages.sessionId, sessionId), eq(schema.sessionMessages.channel, DEFAULT_CHANNEL)))
		.orderBy(desc(schema.sessionMessages.id))
		.limit(1)
	if (!last) return
	await db
		.update(schema.sessionMessages)
		.set({ metadata: { ...((last.metadata as Record<string, unknown> | null) ?? {}), [REVISED_TURN_KEY]: true } as any })
		.where(eq(schema.sessionMessages.id, last.id))
}
