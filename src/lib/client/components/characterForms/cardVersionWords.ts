/**
 * The words of card versions in the card editor: the picker's option text and
 * the "cast members stay on v1.0" line. Pure, so the sentences are tested
 * without a form.
 */

/** A card version as the picker lists it (`Sockets.Characters.CardVersionSummary`). */
export interface CardVersionOption {
	id: number
	number: number
	label: string | null
}

/** A cast member that stays on an older card version (`Sockets.Characters.StayingMember`). */
export interface StayingCastMember {
	castMemberId: number
	lorebookId: number
	name: string
	cardVersionId: number
	label: string | null
}

/**
 * How a card version reads: `v1.0` when its label starts with a digit, the
 * label as is otherwise, `Version 3` when it has no label.
 */
export function versionLabelText(
	label: string | null | undefined,
	number: number
): string {
	const text = label?.trim()
	if (!text) return `Version ${number}`
	return /^\d/.test(text) ? `v${text}` : text
}

/** One picker option: the version's words, ` · current` on the current one. */
export function versionOptionText(
	version: CardVersionOption,
	currentCardVersionId: number | null | undefined
): string {
	const words = versionLabelText(version.label, version.number)
	return version.id === currentCardVersionId ? `${words} · current` : words
}

/** The card version with the highest number: the current one. */
export function highestVersion(
	versions: readonly CardVersionOption[]
): CardVersionOption | undefined {
	let top: CardVersionOption | undefined
	for (const v of versions) if (!top || v.number > top.number) top = v
	return top
}

/** What the muted line under the picker says while an older version is shown. */
export function inPlaceNote(
	shown: CardVersionOption,
	current: CardVersionOption
): string {
	return `Saving changes ${versionLabelText(shown.label, shown.number)} in place; ${versionLabelText(current.label, current.number)} is the current version.`
}

/** One group of the staying line: the words before its names, and the names. */
export interface StayingGroup {
	/** E.g. `3 cast members stay on v1.0:` (the first group), `1 stays on v1.1:` (the next). */
	lead: string
	members: StayingCastMember[]
}

/**
 * The staying line: the members grouped by the card version they stay on, in
 * the order the groups first appear. The words of each group; the names are
 * the view's buttons.
 */
export function stayingGroups(
	staying: readonly StayingCastMember[],
	versions: readonly CardVersionOption[]
): StayingGroup[] {
	const byVersion = new Map<number, StayingCastMember[]>()
	for (const m of staying) {
		const list = byVersion.get(m.cardVersionId)
		if (list) list.push(m)
		else byVersion.set(m.cardVersionId, [m])
	}
	const groups: StayingGroup[] = []
	for (const [versionId, members] of byVersion) {
		const version = versions.find((v) => v.id === versionId)
		const label = members[0].label
		const words = version
			? versionLabelText(label ?? version.label, version.number)
			: label
				? versionLabelText(label, 0)
				: "an earlier version"
		const n = members.length
		const lead =
			groups.length === 0
				? `${n} cast ${n === 1 ? "member stays" : "members stay"} on ${words}:`
				: `${n} ${n === 1 ? "stays" : "stay"} on ${words}:`
		groups.push({ lead, members })
	}
	return groups
}
