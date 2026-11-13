/**
 * The shell's one mapping from a server compile activity to
 * `CompileEntryState` (Layout's `activity:update` handler). A field the
 * modal or the workspace reads must pass through here, which the Compile
 * modal's DOM test holds by building its fixtures through it.
 */
export function compileEntryStateOf(a: any): CompileEntryState {
	return {
		activityId: a.id,
		userId: a.userId,
		historyEntryId: a.historyEntryId,
		historyEntryDate: a.historyEntryDate,
		lorebookId: a.lorebookId,
		lorebookLabel: a.lorebookLabel,
		branchId: a.branchId ?? null,
		moment: a.moment ?? null,
		...(a.byDate !== undefined && { byDate: a.byDate }),
		status: a.status,
		phase: a.phase,
		batch: a.batch,
		totalBatches: a.totalBatches,
		errorMessage: a.errorMessage,
		pendingResult: a.pendingResult,
		startedAt: a.startedAt
	}
}
