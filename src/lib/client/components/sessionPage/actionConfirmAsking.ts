/**
 * 🚧 pr-6 (D §D-9): one confirm sentence as `ActionConfirm` asks it — the
 * question up to and including its first "? ", the rest under it. The
 * sentences are the shared modules' (`$lib/shared/lorebooks/sessionNotes`,
 * `$lib/shared/sessions/archive`), quoted whole; this only splits them.
 */
export function askingOf(
	sentence: string,
	confirmLabel: string
): { question: string; description?: string; confirmLabel: string } {
	const at = sentence.indexOf("? ")
	if (at < 0) return { question: sentence, confirmLabel }
	const description = sentence.slice(at + 2).trim()
	return {
		question: sentence.slice(0, at + 1),
		...(description ? { description } : {}),
		confirmLabel
	}
}
