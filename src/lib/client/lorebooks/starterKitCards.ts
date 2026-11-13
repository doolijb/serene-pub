import { primerRowEditRefusal } from "$lib/shared/lorebooks/primerRow"

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
 * 🚧 (M2e) Whether a lorebook row is a provided book (comes with the pub or a
 * plugin): the server sends `provided` exactly then, and such a book can only
 * be disabled by an administrator, never deleted. Not an admin's starter
 * lorebook, which stays deletable.
 */
export const isProvidedBook = (
	book: { provided?: unknown } | null | undefined
) => !!book?.provided

/**
 * 🚧 (m3b-F) The one line a provided book shows in place of "Shared by <admin>":
 * whose it comes with, from `provided.pluginName` (null = the pub, Serene Pub).
 * Null when the row is not a provided book. Not `primerRowLine` (the primer
 * row's clone-only sentence) and not `sharedFromLine` (a person's share).
 */
export const providedRowLine = (
	book: { provided?: unknown } | null | undefined
): string | null => {
	if (!book?.provided) return null
	const pluginName = (book.provided as { pluginName?: unknown }).pluginName
	if (pluginName === null) return "Comes with Serene Pub"
	if (typeof pluginName === "string" && pluginName)
		return `Comes with ${pluginName}`
	return "Comes with a plugin"
}

/**
 * 🚧 (m2e-F-C) Whether a lorebook row is a primer row: the server's mark
 * (`readOnly`, ★M2e-D-4). Every edit is refused; the only way to change it is
 * to clone it. Not `isProvidedBook` (that is Delete only), not a shared book.
 */
export const isReadOnlyBook = (
	book: { readOnly?: unknown } | null | undefined
) => !!book?.readOnly

/**
 * The one line a primer row shows in place of its editors — the server's own
 * sentence (`$lib/shared/lorebooks/primerRow`), naming the plugin the row comes
 * with (`readOnly.pluginName`; null = the pub).
 */
export const primerRowLine = (
	book: { readOnly?: unknown } | null | undefined
): string =>
	primerRowEditRefusal(
		(book?.readOnly as { pluginName?: string | null } | undefined)
			?.pluginName ?? null
	)

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

/** The kit's row id (an admin kit's, or — since M2e — a shipped kit's `book:<id>`), or null for a legacy `primer:<id>` card. */
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
