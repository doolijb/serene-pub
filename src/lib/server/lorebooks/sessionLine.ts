/**
 * 🚧 A session's **line on first write** (plan §32 §5a).
 *
 * A branch session starts out riding its parent's line (`sessions.
 * line_on_first_write`, set by `branch.ts`). On the session's first write to
 * the attached book — a version, an entry or a value — it forks the book a
 * line from the one it rides, at the session's day, names it after itself,
 * moves onto it and clears the flag. Every writer of the attached book calls
 * `ensureSessionLine` before it reads the line it writes at, on its
 * transaction handle and after its own checks, so a refused write forks
 * nothing: the versions writer, `bookWritePlace` (`state/write.ts`; a
 * proposal only reads the line, and its accept forks), `recordToTimeline`
 * (`state/durable.ts`), `loreWriteTargetFor` and `applyOverlayItems` (`lorebooks/ownBook.ts`; Apply forks inside its transaction once something is chosen),
 * `entries:create` for a session write (inside its transaction, after its
 * checks) and the scene compile for a branch session still riding the
 * compiled line (`sockets/scenes.ts`). Pending value proposals for a book-layer owner that were held
 * at the line the session rode move onto the new line (`moveRidingProposals`),
 * and so do the session's own scenes that are not yet compiled into a history
 * entry (`moveRidingScenes`); a compiled scene, another session's scene and a
 * scene on any other line or book never move.
 *
 * The line is the BOOK's. It outlives the session, and other sessions may
 * ride it. Data wise the session is a patron of the lorebook and its branch;
 * it does not own either (owner: "Branch on first write").
 *
 * ⚠ The new `lorebook_branches` row is made under the book's write lock
 * (`lockBookCalendar`), as `amendments:fork` makes one. The lock is an xact
 * lock: given a handle inside a write transaction it lasts to that
 * transaction's commit and the caller gets the full guarantee. Given a handle
 * that is not inside one, it lasts one statement: the flag is still re-read
 * under it, but the insert and the session update that follow are separate
 * statements, so two concurrent first writers can race (the unique branch
 * name then refuses the loser). Every caller in this file's list above passes
 * a transaction handle except one: `loreWriteTargetFor` called on the outer
 * `db` (by `rulesets/ties.ts` and `pipelines/runtime/host.ts`), which gets the
 * one-statement lock only.
 *
 * ⚠ Takes its handle first and never imports `$lib/server/db`, so any module
 * may import it; the modules that import the db are reached by `import()`.
 */
import { and, eq, isNull, sql } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"

/** The longest a line name may be (`amendments:fork` holds the same limit). */
const MAX_NAME = 60

type SessionRow = {
	name: string | null
	lorebookId: number | null
	lorebookBranchId: number | null
	lineOnFirstWrite: boolean
}

async function sessionRowOf(
	tx: Db,
	sessionId: number
): Promise<SessionRow | null> {
	const [row] = await tx
		.select({
			name: schema.sessions.name,
			lorebookId: schema.sessions.lorebookId,
			lorebookBranchId: schema.sessions.lorebookBranchId,
			lineOnFirstWrite: schema.sessions.lineOnFirstWrite
		})
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	return row ?? null
}

/** The session's name for its line: trimmed, else `Session <id>`, deduped in the book, never `main`, at most 60 characters. */
function lineNameFor(
	sessionName: string | null,
	sessionId: number,
	taken: ReadonlySet<string>
): string {
	const base = sessionName?.trim() || `Session ${sessionId}`
	const free = (name: string) =>
		name.toLowerCase() !== "main" && !taken.has(name)
	const plain = base.slice(0, MAX_NAME).trimEnd()
	if (free(plain)) return plain
	for (let n = 2; ; n++) {
		const suffix = ` (${n})`
		const name = base.slice(0, MAX_NAME - suffix.length).trimEnd() + suffix
		if (free(name)) return name
	}
}

/**
 * Moves the session's own scenes that are not yet compiled (`history_entry_id`
 * is null), in the attached book and on the line it rode, onto the line it
 * forked, so they do not stay on the parent's line. Nothing else on the row
 * changes. A null line is main.
 */
async function moveRidingScenes(
	tx: Db,
	sessionId: number,
	bookId: number,
	fromBranchId: number | null,
	toBranchId: number
): Promise<void> {
	await tx
		.update(schema.scenes)
		.set({ branchId: toBranchId })
		.where(
			and(
				eq(schema.scenes.sessionId, sessionId),
				eq(schema.scenes.lorebookId, bookId),
				isNull(schema.scenes.historyEntryId),
				sql`${schema.scenes.branchId} is not distinct from ${fromBranchId}`
			)
		)
}

/**
 * The line the session stands on in its attached book after this call; null
 * is main. Does nothing, and answers the current `lorebook_branch_id`, unless
 * `sessions.line_on_first_write` is set and the session has an attached book
 * (and a session that is not found answers null). Otherwise forks the line:
 * from the session's current line, at the session's day
 * (`sessionReadingOf(…).moment`; none = a fork at now, which stores no date),
 * named after the session; then moves the session onto it, clears the flag,
 * and carries its pending proposals and its uncompiled scenes along. A
 * second call finds the flag cleared and does nothing.
 */
export async function ensureSessionLine(
	tx: Db,
	sessionId: number
): Promise<number | null> {
	const first = await sessionRowOf(tx, sessionId)
	if (!first) return null
	if (!first.lineOnFirstWrite || first.lorebookId == null)
		return first.lorebookBranchId ?? null

	const bookId = first.lorebookId
	const { lockBookCalendar } = await import("$lib/server/state/storyTime")
	await lockBookCalendar(tx, bookId)
	// Another writer may have forked it while this one waited for the lock.
	const session = await sessionRowOf(tx, sessionId)
	if (!session) return null
	if (!session.lineOnFirstWrite || session.lorebookId !== bookId)
		return session.lorebookBranchId ?? null

	const { sessionReadingOf } = await import("$lib/server/state/reading")
	const reading = await sessionReadingOf(tx, sessionId)
	const day = reading?.moment ?? null
	const taken = new Set(
		(
			await tx
				.select({ name: schema.lorebookBranches.name })
				.from(schema.lorebookBranches)
				.where(eq(schema.lorebookBranches.lorebookId, bookId))
		).map((b) => b.name)
	)
	const [line] = await tx
		.insert(schema.lorebookBranches)
		.values({
			lorebookId: bookId,
			name: lineNameFor(session.name, sessionId, taken),
			forkedFromBranchId: reading?.branchId ?? null,
			forkYear: day?.year ?? null,
			forkMonth: day?.month ?? null,
			forkDay: day?.day ?? null
		})
		.returning({ id: schema.lorebookBranches.id })
	await tx
		.update(schema.sessions)
		.set({ lorebookBranchId: line.id, lineOnFirstWrite: false })
		.where(eq(schema.sessions.id, sessionId))
	// Proposals held at the line it rode follow it, or they would land on the parent's.
	const { moveRidingProposals } = await import("$lib/server/state/write")
	await moveRidingProposals(
		tx,
		sessionId,
		session.lorebookBranchId ?? null,
		line.id
	)
	// So do the session's scenes not yet compiled; they would stay on the parent's line.
	await moveRidingScenes(
		tx,
		sessionId,
		bookId,
		session.lorebookBranchId ?? null,
		line.id
	)
	return line.id
}
