/**
 * 🚧 `start-history-entry` (PLAN-core-widgets W3): core's Chronicle adds the
 * next history entry after the one the session reads now, on the session's
 * line, one step on by the book's calendar — the lorebook's *Add the next
 * date in sequence*, through the same `entries:iterateNext` the composer's
 * Lore pane pressed. Core's widgets only (the askers table, `./askers.ts`);
 * the server judges who may (the book's owner). Resolves with the new
 * entry's id: opening it is the asking widget's (`open-lore`), and only for
 * the press made there — the reply reaches every tab of the person, and the
 * ask's `requestId` is what tells this press its own answer.
 */
import type { WidgetRequests } from "@serene-pub/sdk"
import { readChronicle, type HistoryEntriesDeps } from "./historyEntries"

type Result = WidgetRequests["start-history-entry"]["result"]

/** What this answer needs of the page: the Chronicle's reads, and the step itself. */
export interface StartHistoryEntryDeps extends HistoryEntriesDeps {
	/**
	 * One `entries:iterateNext` from `id` (an entry of `lorebookId`) onto the
	 * line `branchId` (null is main), settled on ITS reply (its `requestId`);
	 * resolves with the new entry's id, rejects with the server's refusal.
	 */
	startNextEntry(ask: {
		lorebookId: number
		id: number
		branchId: number | null
	}): Promise<number>
}

/** Answer one `start-history-entry` for the page's session. Rejects, in words. */
export async function answerStartHistoryEntry(
	_params: unknown,
	deps: StartHistoryEntryDeps
): Promise<Result> {
	const { answer, currentRow, branchId } = await readChronicle(deps, 0)
	if (answer.lorebookId === null)
		throw new Error("this session reads no lorebook")
	if (answer.ownerOnly)
		throw new Error("only the lorebook's owner starts a history entry")
	if (!currentRow)
		throw new Error(
			"there is no history entry to follow yet: open the lorebook to write the first"
		)
	// The session's line, not the source entry's: a session on a branch
	// continuing from a shared entry writes the next one on its branch.
	return {
		entryId: await deps.startNextEntry({
			lorebookId: answer.lorebookId,
			id: currentRow.id,
			branchId
		})
	}
}
