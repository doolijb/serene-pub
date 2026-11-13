/**
 * 🚧 `compile-history-entry` (★S6-1, owner 2026-11-04; core only): the
 * Chronicle's per-day Compile — the lorebook's *Not yet compiled* Compile,
 * with no window: one by-date `scenes:compile` on the session's line at now.
 * Settled on its own answer (the running activity carrying the ask's
 * `requestId`, or the refusal carrying it); the run and its review then
 * arrive through the compile activity as for any compile. Its refusal is the
 * asking widget's to say. The server judges who may (the book's owner) and
 * which scenes wait.
 */
import { v4 as uuid } from "uuid"
import type { TypedSocket } from "$lib/client/sockets/typedSocket"
import { awaitReply } from "$lib/client/utils/awaitReply"
import type { StoryDate } from "$lib/shared/lorebooks/storyDate"
import { readChronicle, type HistoryEntriesDeps } from "./historyEntries"

/** One by-date compile: the day (null is Undated), on the line `branchId` (null is main). */
interface ByDateAsk {
	lorebookId: number
	date: StoryDate | null
	branchId: number | null
}

/** What this answer needs of the page: the Chronicle's reads, and the ask itself. */
export interface CompileHistoryEntryDeps extends HistoryEntriesDeps {
	/**
	 * One by-date `scenes:compile` at now, settled on ITS answer: resolves
	 * when the day's compile is running, rejects with the server's refusal.
	 */
	compileByDate(ask: ByDateAsk): Promise<void>
}

const BAD_DATE =
	"compile-history-entry takes a date of whole parts, or null for Undated"

const absentOrWhole = (v: unknown): boolean =>
	v === undefined || v === null || Number.isInteger(v)

/** Answer one `compile-history-entry` for the page's session. Rejects, in words. */
export async function answerCompileHistoryEntry(
	params: unknown,
	deps: CompileHistoryEntryDeps
): Promise<void> {
	const raw = params as { date?: unknown } | null | undefined
	if (raw == null || typeof raw !== "object" || raw.date === undefined)
		throw new Error(BAD_DATE)
	let date: StoryDate | null = null
	if (raw.date !== null) {
		const d = raw.date as Record<string, unknown>
		if (
			typeof d !== "object" ||
			!Number.isInteger(d.year) ||
			!absentOrWhole(d.month) ||
			!absentOrWhole(d.day) ||
			!absentOrWhole(d.hour) ||
			!absentOrWhole(d.minute)
		)
			throw new Error(BAD_DATE)
		// The day is what counts: hour and minute are dropped.
		date = {
			year: d.year as number,
			month: (d.month as number | null | undefined) ?? null,
			day: (d.day as number | null | undefined) ?? null
		}
	}
	const { answer, branchId } = await readChronicle(deps, 0)
	if (answer.lorebookId === null)
		throw new Error("this session reads no lorebook")
	if (answer.ownerOnly)
		throw new Error("only the lorebook's owner compiles its history")
	await deps.compileByDate({ lorebookId: answer.lorebookId, date, branchId })
}

/** The activity frame's compile, as far as this ask reads it. */
interface CompileFrame {
	kind?: string
	status?: string
	byDate?: { date: StoryDate | null; requestId?: string }
}

/**
 * Send one by-date `scenes:compile` and wait for ITS answer: the running
 * compile carrying this ask's `requestId` (resolves), or the refusal
 * carrying it (rejects with its sentence). Every exit releases both
 * interests.
 *
 * Both interests are declared BEFORE the emit, and the typed `emit` flushes
 * the pending interest sync ahead of the request, so neither answer can
 * overtake the key it needs.
 */
export function compileByDate(
	socket: Pick<TypedSocket, "emit">,
	ask: ByDateAsk,
	timeoutMs?: number
): Promise<void> {
	const requestId = uuid()
	return awaitReply({
		socket,
		event: "scenes:compile",
		params: {
			lorebookId: ask.lorebookId,
			date: ask.date,
			branchId: ask.branchId,
			moment: null,
			requestId
		} satisfies Sockets.Scenes.Compile.ByDate,
		replyKey: "activity:update",
		errorEvent: "scenes:compile:error",
		// The reply is really an `activity:update` frame, not `scenes:compile`'s response.
		match: (data) => {
			const frames = (data as unknown as { activities?: CompileFrame[] })
				?.activities
			return (
				Array.isArray(frames) &&
				frames.some(
					(a) =>
						a?.kind === "compile_history_entry" &&
						a.status === "running" &&
						a.byDate?.requestId === requestId
				)
			)
		},
		matchError: (d) =>
			(d as { requestId?: unknown } | null)?.requestId === requestId,
		fallbackError: "the day's scenes could not be compiled",
		...(timeoutMs !== undefined && { timeoutMs })
	}).then(() => undefined)
}
