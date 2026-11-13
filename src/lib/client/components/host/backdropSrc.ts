/**
 * 🚧 The session backdrop's `fitted` address (DESIGN-image-generation §6.4):
 * the by-id form, which redirects to the uuid one. `null` for no backdrop.
 */
export function sessionBackdropSrc(
	mediaId: number | null | undefined
): string | null {
	return typeof mediaId === "number" &&
		Number.isInteger(mediaId) &&
		mediaId > 0
		? `/media/${mediaId}?v=fitted`
		: null
}
