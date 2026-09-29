/**
 * The member form's draft, as arithmetic.
 *
 * The form draws a member as they READ at the moment being read, so the row it
 * is filled from moves whenever the moment, the line or an amendment does.
 * Three facts keep a save honest across that:
 *
 * 1. **The draft remembers what it was built from** (`pristine`). A save
 *    writes `changedFields(draft, pristine)` — what the author changed — and
 *    never the whole resolved row, which would bake other amendments' values
 *    into wherever it landed.
 * 2. **A clean draft follows the row.** Move the moment and an untouched form
 *    re-reads the member as they are then (`draftFollowsRow`); a dirty one is
 *    left alone, and its diff is still only what was typed.
 * 3. **Both halves are one shape** (`memberPatch`), so the diff compares like
 *    with like: an empty summary is `null` on both sides, a missing state is
 *    `"active"` on both.
 */
import type { CastRow } from "../castPool"

export interface MemberDraft {
	name: string
	aliases: string[]
	summary: string
	nodeState: string
	nodeVisibility: string
	/** Which of the card's sprite sets. "" = the card's default. */
	spriteSet: string
}

/** The draft a row reads as. */
export function memberDraftOf(row: CastRow): MemberDraft {
	return {
		name: row.name ?? "",
		aliases: [...(row.aliases ?? [])],
		summary: row.summary ?? "",
		nodeState: row.nodeState || "active",
		nodeVisibility: row.nodeVisibility || "normal",
		spriteSet: row.spriteSet ?? ""
	}
}

/**
 * What a draft writes — to the member or to a date.
 *
 * A carded member's NAME is the card's (the card sync owns that column), so
 * it is not in the patch. Their aliases are the MEMBER's (#114, cast-first):
 * editable for every member, and a card sync merges the card's names in
 * rather than writing over them.
 */
export function memberPatch(
	draft: MemberDraft,
	linked: boolean
): Record<string, unknown> {
	return {
		summary: draft.summary.trim() || null,
		nodeState: draft.nodeState,
		nodeVisibility: draft.nodeVisibility,
		// ⚠ Empty means "the card's default set", which is NULL on the row —
		// not the empty string, which would be a set nothing is named.
		spriteSet: draft.spriteSet || null,
		aliases: [...draft.aliases],
		...(linked ? {} : { name: draft.name.trim() })
	}
}

/** Whether two drafts would write the same thing. */
export function sameMemberDraft(
	a: MemberDraft,
	b: MemberDraft,
	linked: boolean
): boolean {
	return (
		JSON.stringify(memberPatch(a, linked)) ===
		JSON.stringify(memberPatch(b, linked))
	)
}

/**
 * Whether the form should re-read the row it is drawn from.
 *
 * Only a CLEAN draft follows: edits in flight are never discarded to follow a
 * reading. The row has moved when it differs from the reading the draft was
 * built from.
 */
export function draftFollowsRow(opts: {
	draft: MemberDraft
	pristine: MemberDraft
	row: CastRow
	linked: boolean
}): boolean {
	const { draft, pristine, row, linked } = opts
	if (!sameMemberDraft(draft, pristine, linked)) return false
	return !sameMemberDraft(memberDraftOf(row), pristine, linked)
}
