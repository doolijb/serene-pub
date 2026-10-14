/**
 * A server sentence that names an admin screen, with that screen made a link
 * for the person who can open it (PLAN-less-confusing D1, 2026-10-11).
 *
 * The refusals in `server/connections/capabilityTarget.ts` travel as plain
 * strings (`Error.message`, `Receipt.haltReason`), so there is no field to hang
 * a link on; they name the screen in words instead, and this finds those words.
 * An administrator gets the screen as a link; a member, who cannot open Admin,
 * gets the same words as text. Only screens a sentence actually names are
 * listed: Defaults, spelled the way the admin rail groups it ("Admin › Models ›
 * Defaults") and the older spelling the other refusals still use ("Admin →
 * Defaults").
 *
 * Pure, so what gets linked is tested without a DOM.
 */

/** One run of a sentence: text, and the screen it opens when it is a link. */
export interface ScreenSegment {
	text: string
	href?: string
}

const SCREENS: ReadonlyArray<{ phrase: string; href: string }> = [
	{ phrase: "Admin › Models › Loadouts", href: "/admin/defaults" },
	// ⏳ The section's name before 2026-10-12, kept so a stored reason from
	// an older run still links.
	{ phrase: "Admin › Models › Defaults", href: "/admin/defaults" },
	{ phrase: "Admin → Defaults", href: "/admin/defaults" }
]

/**
 * `text` split at every admin screen it names. With `linked` false (a member)
 * the whole sentence comes back as one text segment, unchanged.
 */
export function adminScreenSegments(
	text: string,
	opts: { linked: boolean }
): ScreenSegment[] {
	if (!opts.linked || !text) return text ? [{ text }] : []
	const out: ScreenSegment[] = []
	let rest = text
	while (rest) {
		let hit: { at: number; phrase: string; href: string } | null = null
		for (const s of SCREENS) {
			const at = rest.indexOf(s.phrase)
			if (at >= 0 && (!hit || at < hit.at)) hit = { at, ...s }
		}
		if (!hit) {
			out.push({ text: rest })
			break
		}
		if (hit.at > 0) out.push({ text: rest.slice(0, hit.at) })
		out.push({ text: hit.phrase, href: hit.href })
		rest = rest.slice(hit.at + hit.phrase.length)
	}
	return out
}
