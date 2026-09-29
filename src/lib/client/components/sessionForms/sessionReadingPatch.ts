/**
 * Where a session reads its book, as the settings form's save sends it.
 *
 * The line (`lorebookBranchId`) and the story clock go ONLY when the person
 * moved them in this form. Either can move behind the form's back: a
 * pipeline advances the clock, and deleting a branch sends its sessions to
 * main. Posting the loaded value back would undo the first and — for a
 * deleted line — be refused, failing every later save of the tab (#136).
 */

/** The session's story-clock columns, as the update carries them. */
export const STORY_CLOCK_KEYS = [
	"storyClockYear",
	"storyClockMonth",
	"storyClockDay",
	"storyClockHour",
	"storyClockMinute"
] as const

/**
 * Drops the reading fields the person did not move from an update's
 * `session` payload. Mutates and returns `sent`.
 */
export function stripUnmovedReading(
	sent: Record<string, unknown>,
	was: Record<string, unknown>
): Record<string, unknown> {
	if (STORY_CLOCK_KEYS.every((k) => sent[k] === was[k]))
		for (const k of STORY_CLOCK_KEYS) delete sent[k]
	if (sent.lorebookBranchId === was.lorebookBranchId)
		delete sent.lorebookBranchId
	return sent
}
