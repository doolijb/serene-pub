/**
 * 🚧 Who is speaking now (owner 2026-10-29): the turn line says *Mira is
 * speaking…* beside who is typing, for every line a live line-bound run is
 * reading aloud. A run record names no line, so the line is found by its own
 * marker: `metadata.spoken.pending.runId` names the run that speaks it
 * (speech build E3). Pure.
 */

/** The run id a line's speak marker names, or null. */
export function pendingSpeakRunOf(metadata: unknown): string | null {
	const spoken = (metadata as { spoken?: unknown } | null | undefined)?.spoken
	const pending =
		spoken && typeof spoken === "object" ? (spoken as { pending?: unknown }).pending : null
	const runId =
		pending && typeof pending === "object" ? (pending as { runId?: unknown }).runId : null
	return typeof runId === "string" && runId ? runId : null
}

/**
 * The speakers of the lines `runIds` are speaking, in line order, each name
 * once. A run whose line is not loaded names nobody.
 */
export function speakingNamesOf<M extends { metadata?: unknown }>(
	messages: readonly M[],
	runIds: readonly string[],
	nameOf: (m: M) => string
): string[] {
	if (!runIds.length) return []
	const live = new Set(runIds)
	const names: string[] = []
	for (const m of messages) {
		const runId = pendingSpeakRunOf(m.metadata)
		if (!runId || !live.has(runId)) continue
		const name = nameOf(m).trim()
		if (name && !names.includes(name)) names.push(name)
	}
	return names
}

/** *Ann is typing…*, *Ann and Bo are typing…*, *Ann, Bo and Cy are typing…*. */
function clause(names: readonly string[], verb: string): string {
	if (!names.length) return ""
	if (names.length === 1) return `${names[0]} is ${verb}…`
	const last = names[names.length - 1]
	return `${names.slice(0, -1).join(", ")} and ${last} are ${verb}…`
}

/** The turn line's one pill: *Ann is typing… · Mira is speaking…*; empty when nobody is. */
export function bannerSentence(typing: readonly string[], speaking: readonly string[]): string {
	return [clause(typing, "typing"), clause(speaking, "speaking")].filter(Boolean).join(" · ")
}
