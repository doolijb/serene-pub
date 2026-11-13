/**
 * A cast member's own name and nickname in a book (playtest §0-D): the
 * `lorebooks:updateBinding` side. The reading of them is
 * `shared/lorebooks/memberIdentity.ts`; the stored shown name is kept by
 * `syncLorebookBindingsForCharacter`.
 *
 * ⚠ Must not statically import `$lib/server/db`.
 */
import {
	markedBook,
	PROVIDED_BOOK_CAST_REFUSAL,
	providedOwnerPresent
} from "$lib/server/plugins/providedMarks"
import { ownNameValue } from "$lib/shared/lorebooks/memberIdentity"

/** The refusal for a non-text own name or nickname. */
export const OWN_NAME_NOT_TEXT =
	"A cast member's name in this book must be text."

/**
 * Normalises `ownName` / `ownNickname` on an update IN PLACE and returns the
 * refusal text when one is not allowed (owner ★L-3b, 2026-11-04). Per key:
 * absent stays absent; `null` stays `null` (*Use from card* on); text is
 * trimmed, and a trimmed `""` is kept for `ownNickname` (*no nickname in this
 * book*) but refused for `ownName`; anything else is refused.
 */
export function normaliseOwnNames(
	update: Record<string, unknown>
): string | null {
	for (const key of ["ownName", "ownNickname"] as const) {
		const v = update[key]
		if (v === undefined) continue
		if (v === null) continue
		if (typeof v !== "string") return OWN_NAME_NOT_TEXT
		const text = v.trim()
		if (key === "ownName" && text === "") return OWN_NAME_NOT_TEXT
		update[key] = text
	}
	return null
}

/**
 * Whether a book is provided AND keeps its cast's names and faces: it carries
 * its own genuine mark and the mark's owner is present (core, or a plugin
 * still installed). A book whose plugin was uninstalled is a person's book.
 */
export async function providedBookKeepsCast(
	db: Db,
	book: { uuid: string; extraJson: unknown }
): Promise<boolean> {
	const mark = markedBook(book.extraJson, book.uuid)
	return !!mark && (await providedOwnerPresent(db, mark.plugin))
}

/**
 * The refusal text when `update` CHANGES an own name, own nickname, face or
 * the face flag of a member in a provided book, else null. Compares to the
 * member as it is now (`stored`: the frozen columns as the member's base
 * version holds them; the member form sends every retold field on every
 * save), never "present". The book is provided when `providedBookKeepsCast` says so (its
 * mark's owner is present).
 */
export async function providedCastProblem(
	db: Db,
	book: { uuid: string; extraJson: unknown },
	stored: {
		ownName: string | null
		ownNickname: string | null
		faceMediaId: number | null
		retold: { face?: boolean } | null
	},
	update: Record<string, unknown>
): Promise<string | null> {
	if (!(await providedBookKeepsCast(db, book))) return null
	const differs = (key: "ownName" | "ownNickname") =>
		update[key] !== undefined &&
		ownNameValue(update[key]) !== ownNameValue(stored[key])
	const face =
		update.faceMediaId !== undefined &&
		(update.faceMediaId ?? null) !== (stored.faceMediaId ?? null)
	const retold = update.retold as { face?: boolean } | null | undefined
	const flag =
		retold !== undefined &&
		(retold?.face === true) !== (stored.retold?.face === true)
	return differs("ownName") || differs("ownNickname") || face || flag
		? PROVIDED_BOOK_CAST_REFUSAL
		: null
}
