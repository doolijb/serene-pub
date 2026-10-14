/**
 * A cast member's **face** (PLAN-cast-retold-fields-2026-10-13): the picture
 * they are drawn with when `retold.face` and a `faceMediaId` say so — a card
 * gallery image or a lorebook-owned upload — else the card's own avatar.
 *
 * ⚠ Not *portrait* (the picture pipeline), not *avatar* (the card's own
 * picture). The member's face is kept when the toggle goes off; it is simply
 * not drawn.
 */
import { avatarSrc } from "$lib/client/utils/media"
import type { RetoldFlags } from "$lib/shared/lorebooks/retold"

/** As much of a member (row or draft) as their face reads. */
export interface FaceSource {
	faceMediaId?: number | null
	retold?: RetoldFlags | null
}

/**
 * The member's own face, when it is the one drawn. Undefined otherwise.
 * Full size by default (the member page's header); a list disc passes
 * `{ full: false }` for the thumbnail, as the card avatars beside it do.
 */
export function memberFaceSrc(
	member: FaceSource,
	opts: { full?: boolean } = { full: true }
): string | undefined {
	if (member.retold?.face !== true || !member.faceMediaId) return undefined
	return avatarSrc({ avatarMediaId: member.faceMediaId }, opts)
}

/**
 * What a member is drawn with: their face when retold, else the card's
 * avatar (undefined for a member with no card, or a card with none).
 */
export function castFaceSrc(
	member: FaceSource,
	card: Parameters<typeof avatarSrc>[0]
): string | undefined {
	return memberFaceSrc(member, { full: false }) ?? avatarSrc(card)
}
