/**
 * What a form does about the crop once the avatar has actually been uploaded.
 *
 * An avatar is uploaded with the character or persona it belongs to, so the
 * file does not exist — and has no id to frame — until the save comes back.
 * The editor's answer is held until then, and this is the decision it feeds:
 * pure, so the rule is testable without mounting a form.
 */
import type { MediaFrame } from "$lib/shared/media/frame"

/** The crop editor's answer, held between choosing a file and saving the form.
 *  Null when the editor was cancelled, which means "upload it as it is". */
export interface PendingAvatarFrame {
	/** Null when the user reset the crop: the stored frame is cleared so the
	 *  default rule applies, rather than the rule's current output being
	 *  written down. */
	frame: MediaFrame | null
}

/** The `media:setFrame` call to make, or null when there is nothing to say. */
export function avatarFrameCommit(
	pending: PendingAvatarFrame | null | undefined,
	avatarMediaId: number | null | undefined
): { mediaId: number; frame: MediaFrame | null } | null {
	if (!pending || !avatarMediaId) return null
	return { mediaId: avatarMediaId, frame: pending.frame }
}
