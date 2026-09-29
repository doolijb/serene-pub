/**
 * The editor's small decisions, pure so they can be tested without a page
 * (C6, P6): whether core has moved since a clone, whether a save was refused
 * for being stale, whether the draft differs from what was saved, and who may
 * be on these pages at all.
 */

/** A clone's record of where it started (`Sockets.Components.BasedOn`). */
export interface BasedOnLike {
	component: string
	version: string
	sourceHash?: string
}

/**
 * How a clone stands against core's component today:
 * - `not-a-clone` — written from blank, or imported without a `basedOn`;
 * - `unknown` — cloned, but there is nothing to compare: core's source has
 *   not arrived, core does not have the component, or the clone predates
 *   source hashes;
 * - `same` — core's source is the source it was cloned from;
 * - `changed` — core's source moved since: the banner says so.
 */
export type CoreDrift = "not-a-clone" | "unknown" | "same" | "changed"

export function coreDrift(
	basedOn: BasedOnLike | null | undefined,
	core: { slug: string; sourceHash: string } | null | undefined
): CoreDrift {
	if (!basedOn) return "not-a-clone"
	if (!core || core.slug !== basedOn.component || !basedOn.sourceHash || !core.sourceHash) return "unknown"
	return core.sourceHash === basedOn.sourceHash ? "same" : "changed"
}

/**
 * Is this refusal a stale save — someone (another tab, another admin) saved
 * since this page read the component? The server's sentence
 * (`AuthoredComponentConflict`) is the signal: it is the one refusal that
 * says the row "changed since it was read".
 */
export function isSaveConflict(error: string | null | undefined): boolean {
	return typeof error === "string" && /changed since it was read/i.test(error)
}

/** What a conflict tells the admin, in place of the server's sentence. */
export const SAVE_CONFLICT_TEXT =
	"Someone saved this component after you opened it, so your save was not applied. Copy anything you want to keep, then reload to see their version."

/** Only admins are on these pages; everyone else goes home. Null means stay. */
export function adminRedirect(user: { isAdmin?: boolean | null } | null | undefined): string | null {
	return user?.isAdmin ? null : "/"
}

/** Two file sets with the same paths and the same text. */
export function sameFiles(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean {
	const ak = Object.keys(a)
	if (ak.length !== Object.keys(b).length) return false
	return ak.every((k) => Object.hasOwn(b, k) && a[k] === b[k])
}

/** The widget declaration's side form, as the draft holds it. */
export interface WidgetDraft {
	label: string
	title: string
	icon: string
	scopes: string[]
	reads: string[]
}

/** Two lists holding the same names, in any order. */
export const sameSet = (a: readonly string[], b: readonly string[]) =>
	a.length === b.length && a.every((v) => b.includes(v))

export function sameWidgetDraft(a: WidgetDraft, b: WidgetDraft): boolean {
	return (
		a.label === b.label &&
		a.title === b.title &&
		a.icon === b.icon &&
		sameSet(a.scopes, b.scopes) &&
		sameSet(a.reads, b.reads)
	)
}

/**
 * The display text the side form edits: a bare string as it is, a locale
 * map's `en` (the other locales ride along untouched — see `withEnglish`).
 */
export function englishOf(text: unknown): string {
	if (typeof text === "string") return text
	if (text && typeof text === "object" && typeof (text as { en?: unknown }).en === "string")
		return (text as { en: string }).en
	return ""
}

/** `text` with its English replaced: a bare string becomes `en`, a locale map keeps its other locales. */
export function withEnglish(text: unknown, en: string): string | ({ en: string } & Record<string, string>) {
	if (text && typeof text === "object") return { ...(text as Record<string, string>), en }
	return en
}

/** One file's standing against core's copy of it. */
export type FileDiffStatus = "changed" | "added" | "removed" | "same"

/** Every path in either set, with how it stands; changed ones first, then by path. */
export function fileDiffList(
	core: Readonly<Record<string, string>>,
	mine: Readonly<Record<string, string>>
): { path: string; status: FileDiffStatus }[] {
	const rank: Record<FileDiffStatus, number> = { changed: 0, added: 1, removed: 2, same: 3 }
	const paths = [...new Set([...Object.keys(core), ...Object.keys(mine)])]
	return paths
		.map((path) => {
			const inCore = Object.hasOwn(core, path)
			const inMine = Object.hasOwn(mine, path)
			const status: FileDiffStatus = !inCore ? "added" : !inMine ? "removed" : core[path] === mine[path] ? "same" : "changed"
			return { path, status }
		})
		.sort((a, b) => rank[a.status] - rank[b.status] || a.path.localeCompare(b.path))
}

/* ── the saved version and the component draft ──────────────────────────── */

/** What the editor needs of a component to choose its source (`Sockets.Components.Detail`). */
export interface DraftedLike {
	files: Record<string, string>
	entry: string
	componentDraft?: { files: Record<string, string>; entry: string } | null
}

/**
 * The source the editor opens and measures "Unsaved" against: the component
 * draft when there is one — the admin's latest save, which did not compile —
 * else the saved version.
 */
export function editorSource(c: DraftedLike): { files: Record<string, string>; entry: string; fromDraft: boolean } {
	const d = c.componentDraft
	return d ? { files: d.files, entry: d.entry, fromDraft: true } : { files: c.files, entry: c.entry, fromDraft: false }
}

/** The banner over a component draft. */
export const COMPONENT_DRAFT_TEXT = "Draft — doesn't compile; sessions keep running the last save."

/**
 * Whether Revert to last save is offered: a component draft exists, the
 * compiler is there to have made it, and no save or revert is in flight.
 */
export function canRevertDraft(
	c: { componentDraft?: unknown } | null | undefined,
	state: { busy: boolean; readOnly: boolean }
): boolean {
	return !!c?.componentDraft && !state.busy && !state.readOnly
}

/** What a save's reply tells the admin (a toast). */
export function saveNotice(res: {
	stored: "saved-version" | "component-draft"
	compile: { errors: readonly unknown[] }
}): { tone: "success" | "warning"; title: string; description?: string } {
	if (res.stored === "component-draft")
		return {
			tone: "warning",
			title: "Kept as a draft — it doesn't compile",
			description: "Sessions keep running the last save. Fix it and save again, or revert to the last save. See Problems."
		}
	if (res.compile.errors.length)
		return {
			tone: "warning",
			title: "Saved, but it did not compile",
			description: "It has never compiled, so it is not offered to sessions until it does. See Problems."
		}
	return { tone: "success", title: "Saved" }
}

/** What an export tells the admin beyond the download, or null. */
export function exportNotice(res: { componentDraftLeftOut: boolean }, dirty: boolean): { title: string; description: string } | null {
	if (res.componentDraftLeftOut)
		return {
			title: "Exported the last save",
			description: "The draft doesn't compile, so it is not in the file. Fix and save it, then export again to include it."
		}
	if (dirty)
		return {
			title: "Exported the saved version",
			description: "Your unsaved changes are not in the file. Save, then export again to include them."
		}
	return null
}
