/**
 * Saving a change form whose server API only takes one setting at a time
 * (a genre's switch, one preset's "offered", one plugin permission): the
 * form holds every edit as a draft, and Save sends the difference as a
 * sequence of single writes, waiting for each answer before the next
 * (owner ruling 2026-10-02, "levers wait for Save"; STYLE-GUIDE §6.14).
 *
 * In order, one at a time, because most of these verbs answer on an
 * `{event}:error` sibling that carries no request id (`awaitReply`): with
 * one write in flight, the refusal that arrives is that write's. Every step
 * runs even when an earlier one is refused — the writes are independent
 * settings, and a refusal of one is no reason to drop the rest — and the
 * result names exactly which landed and which did not, so the form can say
 * "Saved 3 of 4 — <reason>" instead of claiming a save that half happened.
 *
 * A step that must not run after a refusal (a write that depends on an
 * earlier one) says so with `after`.
 */
export interface SaveStep {
	/** In the reader's words: "Offered: Quick start". */
	label: string
	/** Sends the write and settles on ITS answer (an `awaitReply`). */
	run: () => Promise<unknown>
	/** Labels of steps this one needs to have landed; skipped otherwise. */
	after?: readonly string[]
}

export interface SaveRefusal {
	label: string
	error: string
}

export interface SaveOutcome {
	/** Labels of the steps that landed, in order. */
	landed: string[]
	refused: SaveRefusal[]
	/** Steps not sent because a step they need was refused. */
	skipped: string[]
}

export async function saveInSequence(steps: readonly SaveStep[]): Promise<SaveOutcome> {
	const out: SaveOutcome = { landed: [], refused: [], skipped: [] }
	const failed = new Set<string>()
	for (const step of steps) {
		if (step.after?.some((l) => failed.has(l))) {
			failed.add(step.label)
			out.skipped.push(step.label)
			continue
		}
		try {
			await step.run()
			out.landed.push(step.label)
		} catch (e) {
			failed.add(step.label)
			out.refused.push({
				label: step.label,
				error: e instanceof Error && e.message ? e.message : "The server refused the change."
			})
		}
	}
	return out
}

/**
 * The form's error summary lines for an outcome: one per refusal, naming
 * the setting, then one line for what was not sent. Empty when all landed.
 */
export function saveErrors(outcome: SaveOutcome): string[] {
	const lines = outcome.refused.map((r) => `${r.label}: ${r.error}`)
	if (outcome.skipped.length)
		lines.push(`Not sent, because a change it needs was refused: ${outcome.skipped.join(", ")}.`)
	return lines
}

/** "Saved Quick start" / "Saved 3 of 4 changes". */
export function saveSummary(outcome: SaveOutcome, name: string): string {
	const total = outcome.landed.length + outcome.refused.length + outcome.skipped.length
	if (!outcome.refused.length && !outcome.skipped.length) return `Saved ${name}`
	return `Saved ${outcome.landed.length} of ${total} change${total === 1 ? "" : "s"}`
}
