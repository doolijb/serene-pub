/**
 * Open a cast member in Lorebooks: address first, then open
 * (shell/openJumpHit.ts). Worn by the cast line and the editing sentence, so
 * the order lives once. Does nothing outside the shell.
 */
export function openCastMember(
	panelsCtx: PanelsCtx | undefined,
	member: { lorebookId: number; castId: number }
): void {
	if (!panelsCtx) return
	panelsCtx.digest.lore = {
		lorebookId: member.lorebookId,
		scope: "cast",
		castId: member.castId
	}
	panelsCtx.openPanel({ key: "lorebooks", toggle: false })
}
