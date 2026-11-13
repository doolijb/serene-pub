import { formatDate } from "$lib/shared/lorebooks/storyDate"

/**
 * The words of Admin › Data and backups › **Since the upgrade** and its
 * Overview line (lane cv-member2, B3). 🚧 Provisional (★, cv-client's
 * proposal) except the button's words, which are ruled. Pure, so the
 * sentences are tested apart from the card.
 */

export const CAST_UPGRADE_TITLE = "Since the upgrade"
export const CAST_UPGRADE_HELP =
	"These cast members read a little differently than before the upgrade to character versions."
export const FOLLOW_GREETINGS_NOTE =
	"Their greetings became their own list, because only some of them were told in their own words before."
/** Ruled. */
export const FOLLOW_GREETINGS_BUTTON = "Follow the card's greetings"
export const FOLLOW_GREETINGS_FALLBACK =
	"The greetings could not be set to follow the card."

/** The profile field names a difference carries, as a reader says them. */
const FIELD_WORDS: Record<string, string> = {
	name: "name",
	nickname: "nickname",
	aliases: "aliases",
	summary: "summary",
	description: "description",
	personality: "personality",
	scenario: "scenario",
	greetings: "greetings",
	exampleDialogues: "example dialogues",
	postHistoryInstructions: "post-history instructions",
	creatorNotes: "creator notes",
	strokes: "strokes",
	faceMediaId: "face",
	face: "face",
	likeness: "likeness",
	timbre: "voice",
	spriteSet: "sprite set",
	extensions: "extensions"
}

/** "a", "a and b", "a, b and c" — no Oxford comma. */
export function joinWords(words: readonly string[]): string {
	if (words.length <= 1) return words.join("")
	return `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`
}

/** Fields as words, in the order given, once each; an unknown name is said as it is. */
export function fieldsInWords(fields: readonly string[]): string {
	const words: string[] = []
	for (const f of fields) {
		const w = FIELD_WORDS[f] ?? f
		if (!words.includes(w)) words.push(w)
	}
	return joinWords(words)
}

/** The Overview line: "1 cast member reads differently since the upgrade". */
export function castLiftOverviewLine(count: number): string {
	return count === 1
		? "1 cast member reads differently since the upgrade"
		: `${count} cast members read differently since the upgrade`
}

/** "Bianca in Porto Alto". */
export function castUpgradeMemberTitle(
	memberName: string,
	lorebookName: string
): string {
	return `${memberName} in ${lorebookName}`
}

export interface CastUpgradeDifference {
	branchId: number | null
	line: string
	at:
		| {
				kind: "date"
				date: { year: number; month: number | null; day: number | null }
		  }
		| { kind: "before-first-change" }
	appearance: number | null
	fields: string[]
}

/**
 * One difference as a sentence: "On main, from Year 412, at life point 34,
 * reads the description and greetings differently than before the upgrade."
 */
export function castUpgradeDifferenceLine(d: CastUpgradeDifference): string {
	const where = d.branchId === null ? "On main" : `On ${d.line}`
	const when =
		d.at.kind === "date"
			? `from ${formatDate(d.at.date)}`
			: "before their first change"
	const life = d.appearance === null ? "" : `, at life point ${d.appearance}`
	const what = fieldsInWords(d.fields)
	return `${where}, ${when}${life}, reads the ${what} differently than before the upgrade.`
}
