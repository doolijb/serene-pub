/**
 * The one toast a character-card import shows, for the view that started it.
 *
 * `characters:importCard` is sent to every socket the person has open, and a
 * Library import runs the same server path, so several views hear one import.
 * Each view toasts only an import it asked for; this is the wording they share.
 *
 * Null for a conflict: the conflict dialog is the answer there, not a toast.
 * "Unchanged" is a success, because the card is there to use. Warnings are a
 * warning and never an error: the character did import, with part of the card
 * (usually an over-sized image) skipped.
 */
export function cardImportedToast(msg: {
	status?: string
	character?: { name?: string | null; nickname?: string | null } | null
	warnings?: string[]
}): { kind: "success" | "warning"; title: string; description: string } | null {
	if (msg.status === "conflict" || !msg.character) return null
	const name = msg.character.nickname || msg.character.name || "The character"
	if (msg.status === "unchanged")
		return {
			kind: "success",
			title: "Character already imported",
			description: `"${name}" is unchanged — using the existing character.`
		}
	if (msg.warnings?.length)
		return {
			kind: "warning",
			title: "Character imported with warnings",
			description: `${name} was imported. ${msg.warnings.join(" ")}`
		}
	return {
		kind: "success",
		title: "Character imported",
		description: `Character ${name} imported successfully.`
	}
}
