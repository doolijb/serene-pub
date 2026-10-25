/**
 * 🚧 Starter lorebooks as the pickers and Admin draw them (PLAN-lorebook-kinds §B):
 * the words on a kit's card, and the request a picked card sends. Pure, so
 * the sentences are tested as sentences.
 *
 * The person reads **Starter lorebook** and **Rules**, never the SDK's nouns
 * (NOMENCLATURE §28).
 */

type Card = Sockets.StarterKits.Card
type Ref = Sockets.StarterKits.Ref

/** The book kind a starter lorebook's row carries (`lorebooks.kind`). */
export const STARTER_KIT_KIND = "starter_kit"

/** Whether a lorebook row is a starter lorebook. */
export const isStarterKit = (
	book: { kind?: string | null } | null | undefined
) => book?.kind === STARTER_KIT_KIND

/**
 * A card back to the kit it names, for `lorebooks:create` and
 * `sessions:create`: `primer:<id>` is a kit that comes with the pub,
 * `book:<id>` an admin's. Null when the id names neither.
 */
export function refOfCard(card: Pick<Card, "id">): Ref | null {
	if (card.id.startsWith("primer:")) {
		const primerId = card.id.slice("primer:".length)
		return primerId ? { primerId } : null
	}
	if (card.id.startsWith("book:")) {
		const n = Number(card.id.slice("book:".length))
		return Number.isSafeInteger(n) && n > 0 ? { lorebookId: n } : null
	}
	return null
}

/** The admin kit's row id, or null for a kit that comes with the pub. */
export function kitBookId(card: Pick<Card, "id">): number | null {
	const ref = refOfCard(card)
	return ref && "lorebookId" in ref ? ref.lorebookId : null
}

const counted = (n: number, one: string, many: string) =>
	`${n} ${n === 1 ? one : many}`

/** What a kit holds, in words: "12 entries, 3 places and 2 cast members". */
export function kitHoldsLine(counts: Card["counts"]): string {
	const parts = [
		counts.entries > 0 && counted(counts.entries, "entry", "entries"),
		counts.places > 0 && counted(counts.places, "place", "places"),
		counts.cast > 0 && counted(counts.cast, "cast member", "cast members")
	].filter((p): p is string => !!p)
	if (!parts.length) return "A fresh start on its rules"
	if (parts.length === 1) return `Holds ${parts[0]}`
	return `Holds ${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`
}

/** Where a kit comes from: the pub, a plugin, or the admin who made it. */
export function kitSourceLine(
	card: Pick<Card, "source" | "ownerName" | "mine">
): string {
	if (card.source === "core") return "Comes with Serene Pub"
	if (card.source === "plugin") return "Comes with a plugin"
	if (card.mine) return "Made by you"
	return card.ownerName ? `Made by ${card.ownerName}` : "Made by an admin"
}

/** The one line a session from a kit is told at the start form. */
export const KIT_SESSION_NOTE =
	"This story starts in its own notes, with the starter lorebook already in them. Make a lorebook from its notes in session settings whenever you want to keep them and build on them."
