/**
 * Live reload of authored components on the session page (C6, P5).
 *
 * The server announces `components:changed { id, ownerId, src }` to every
 * socket that declared it, scoped by the authored owner id. The page declares
 * one scoped key per authored owner it draws ({@link authoredReloadKeys}) —
 * never the bare key, so a page hears only about components it has on screen
 * — and on a push retargets that owner's widgets ({@link retargetAuthoredSrc}):
 * a new `src` remounts the component in place (`RemoteWidget`'s `{#key src}`),
 * `null` draws it as missing.
 *
 * Only an AUTHORED owner is ever retargeted, and only to its own artifact
 * URL: a push can never point core's widgets or a plugin's somewhere else,
 * nor one authored owner's widget at another's module.
 *
 * A component newly switched on that this page does not draw is not added
 * here: it is offered on the page's next `sessions:view` (the page is not
 * re-seeded mid-session for it — that would re-seat every widget).
 */
import { interestKey, type InterestKey } from "$lib/shared/sockets/interest"
import { parseAuthoredArtifactSrc, parseAuthoredOwnerId } from "$lib/shared/widgets/authoredOwner"

/** The part of a panel (a declaration or a placed instance) a reload reads and writes. */
export interface RetargetablePanel {
	surface: { kind: string; owner?: string }
	src?: string
}

/** Every authored owner among these panels, sorted, once each. */
export function authoredOwnersOf(panels: Iterable<RetargetablePanel | null | undefined>): string[] {
	const owners = new Set<string>()
	for (const p of panels) {
		const owner = p?.surface?.kind === "remote" ? p.surface.owner : undefined
		if (parseAuthoredOwnerId(owner)) owners.add(owner!)
	}
	return [...owners].sort()
}

/** The interest keys a page drawing these authored owners declares — one scoped key each. */
export function authoredReloadKeys(owners: readonly string[]): InterestKey[] {
	return owners.filter((o) => parseAuthoredOwnerId(o)).map((o) => interestKey("components:changed", o))
}

/**
 * Point every remote panel of `ownerId` at `src` (none: `undefined`, drawn
 * missing). Returns how many panels changed. Refused — nothing changes — when
 * the owner is not an authored owner, or `src` is not that owner's own
 * artifact URL.
 */
export function retargetAuthoredSrc(
	panels: Iterable<RetargetablePanel | null | undefined>,
	change: { ownerId: string; src: string | null }
): number {
	const id = parseAuthoredOwnerId(change.ownerId)
	if (!id) return 0
	let next: string | undefined
	if (change.src != null) {
		const prefix = "/authored-ui/"
		const parsed = change.src.startsWith(prefix) ? parseAuthoredArtifactSrc(change.src.slice(prefix.length)) : undefined
		if (!parsed || parsed.id !== id) return 0
		next = change.src
	}
	let changed = 0
	for (const p of panels) {
		if (!p || p.surface?.kind !== "remote" || p.surface.owner !== change.ownerId) continue
		if (p.src === next) continue
		p.src = next
		changed++
	}
	return changed
}
