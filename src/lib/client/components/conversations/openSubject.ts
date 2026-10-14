/**
 * Open what an attachment card or a person detail row names, exactly as a
 * Jump hit opens it (PLAN-private-messages §6.4, `openJumpHit.ts`): a session
 * is a page (`goto`), a character opens its read-only detail
 * (`digest.viewCharacterId`), a lorebook its workspace (`digest.lore`). One
 * path, so a card and a jump can never open the same thing two ways.
 */
import { openJumpHit } from "$lib/client/shell/openJumpHit"

export type OpenableKind = "session" | "character" | "lorebook"

export function openSubject(
	panelsCtx: PanelsCtx,
	kind: OpenableKind,
	id: number,
	title = ""
): Promise<void> {
	return openJumpHit(panelsCtx, { kind, id, title })
}

/** A media address with `download=1`, whether or not it already has a query. */
export function downloadHref(src: string): string {
	return `${src}${src.includes("?") ? "&" : "?"}download=1`
}
