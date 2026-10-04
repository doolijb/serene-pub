/**
 * The store of **authored components** (C6, P2): components an admin writes
 * or clones in the app, kept as `authored_components` rows — artifacts of
 * this instance, owned by no plugin. Each row is its own owner,
 * `authored.<id>` (`shared/widgets/authoredOwner`).
 *
 * Content writes (source, declaration, label, upstream) are **optimistic**:
 * each names the `updatedAt` it read, and a write against a row that moved
 * since loses with {@link AuthoredComponentConflict} rather than overwriting
 * the other admin's (or tab's) save. The switches beside the content — the
 * enable switch, the scope review, a compile's result — are not content and
 * leave `updatedAt` alone, so flipping one never makes an open editor stale.
 *
 * A content write that changes the source clears the compile (artifact,
 * fingerprint, error): the row is not offered again until the source it now
 * holds is compiled (P3), and a compile of any other source never
 * lands ({@link recordAuthoredCompile} is keyed on the source hash).
 *
 * **The saved version and the component draft** (owner ruling 2026-09-26):
 * the row's `files`/`entry`/`framework` are its SAVED version — the last
 * source that compiled, what sessions run and what export ships. A save whose
 * source does not compile, on a component that HAS a saved version, is kept
 * beside it as the **component draft** ({@link saveComponentDraft}) with its
 * located errors, and the saved version, its compiled module and its offer are
 * untouched; a save that compiles, or {@link revertComponentDraft}, clears it.
 * A component that has never compiled has nothing to protect: its source is
 * stored as the source (and not offered) as before.
 *
 * Every function takes the db handle, so it runs inside a caller's `tx` as
 * readily as on the app db.
 */
import { and, asc, eq, sql } from "drizzle-orm"
import {
	COMPONENT_FRAMEWORKS,
	WIDGET_BASE_SECTIONS,
	WIDGET_SCOPED_SECTIONS,
	i18nFindings,
	isServablePanelId,
	type I18n
} from "@serene-pub/sdk"
import {
	COMPONENT_COMPILE_LIMITS,
	componentSourceHash,
	isSafeComponentPath
} from "@serene-pub/cli/component-source"
import { authoredComponents, type AuthoredWidgetShape } from "$lib/server/db/schema"
import { newAuthoredId } from "$lib/shared/widgets/authoredOwner"
import {
	permissionStates,
	reviewMarks,
	widgetScopePermissions,
	type PermissionState
} from "$lib/server/plugins/permissions"

export type AuthoredComponentRow = typeof authoredComponents.$inferSelect

export type AuthoredFramework = (typeof COMPONENT_FRAMEWORKS)[number]

/** What an admin authors: everything but the id, the switches and the compile. */
export interface AuthoredComponentContent {
	slug: string
	label: I18n
	framework: AuthoredFramework
	entry: string
	files: Record<string, string>
	widget: AuthoredWidgetShape
	basedOn?: { component: string; version: string; sourceHash?: string } | null
}

/** One located compile error, as a component draft keeps it (`ComponentCompileError`). */
export interface ComponentDraftError {
	file: string
	line: number
	column: number
	text: string
}

/** A component draft: source that did not compile, kept beside the saved version. */
export interface ComponentDraft {
	files: Record<string, string>
	entry: string
	framework: AuthoredFramework
	errors: ComponentDraftError[]
	updatedAt: Date
}

/** The row's component draft, or null when it has none. */
export function componentDraftOf(row: AuthoredComponentRow): ComponentDraft | null {
	if (!row.draftFiles || row.draftEntry == null || row.draftFramework == null) return null
	return {
		files: row.draftFiles,
		entry: row.draftEntry,
		framework: row.draftFramework as AuthoredFramework,
		errors: row.draftErrors ?? [],
		updatedAt: row.draftUpdatedAt ?? row.updatedAt
	}
}

/**
 * Whether the row has a saved version a broken save must not replace: its
 * source compiled (an artifact, and no error since). A component that has
 * never compiled — or whose saved source fails to compile — has none.
 */
export const hasSavedVersion = (row: Pick<AuthoredComponentRow, "artifactHash" | "lastError">): boolean =>
	!!row.artifactHash && !row.lastError

/** Every draft column cleared — the write that drops a component draft. */
const NO_DRAFT = { draftFiles: null, draftEntry: null, draftFramework: null, draftErrors: null, draftUpdatedAt: null } as const

/** A write against a row that changed since the writer read it. */
export class AuthoredComponentConflict extends Error {
	constructor(
		readonly id: string,
		readonly current: Date
	) {
		super(`authored component '${id}' changed since it was read — reload it and save again`)
		this.name = "AuthoredComponentConflict"
	}
}

/** A write naming an authored component that does not exist. */
export class AuthoredComponentMissing extends Error {
	constructor(readonly id: string) {
		super(`no authored component '${id}'`)
		this.name = "AuthoredComponentMissing"
	}
}

/** A write whose content is refused; `findings` are sentences, one per fault. */
export class AuthoredComponentInvalid extends Error {
	constructor(readonly findings: string[]) {
		super(`authored component refused: ${findings.join("; ")}`)
		this.name = "AuthoredComponentInvalid"
	}
}

/* ── validation ─────────────────────────────────────────────────────────── */

const SLUG_MAX = 64
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
	!!v && typeof v === "object" && !Array.isArray(v)

/**
 * Every fault in `content`, as sentences — empty when it may be stored.
 *
 * The slug is a panel id (`^[a-z0-9_-]+$`) because the widget id is
 * `authored.<id>:<slug>` and must parse back as one. The files are held to
 * the compiler's own grammar and limits (`@serene-pub/cli/component-source`),
 * so what is stored is always something a compile will at least try.
 */
export function authoredComponentFindings(content: Partial<AuthoredComponentContent>): string[] {
	const out: string[] = []
	const { slug, label, framework, entry, files, widget, basedOn } = content
	if (typeof slug !== "string" || !isServablePanelId(slug) || slug.length > SLUG_MAX)
		out.push(`slug ${JSON.stringify(slug)} must be 1–${SLUG_MAX} of lowercase letters, digits, '_' and '-'`)
	out.push(...i18nFindings(label, "label", { required: true }))
	if (!(COMPONENT_FRAMEWORKS as readonly unknown[]).includes(framework))
		out.push(`framework ${JSON.stringify(framework)} is not one of ${COMPONENT_FRAMEWORKS.join(", ")}`)
	if (!isPlainObject(files)) out.push("files must be an object of path → source text")
	else {
		const paths = Object.keys(files)
		if (!paths.length) out.push("files is empty — a component needs at least its entry")
		if (paths.length > COMPONENT_COMPILE_LIMITS.files)
			out.push(`${paths.length} files is more than ${COMPONENT_COMPILE_LIMITS.files}`)
		let total = 0
		for (const p of paths) {
			const text = files[p]
			if (!isSafeComponentPath(p))
				out.push(`file path ${JSON.stringify(p)} is not a component path (a .svelte, .ts or .js file, no '..')`)
			if (typeof text !== "string") {
				out.push(`file ${JSON.stringify(p)} is not text`)
				continue
			}
			const bytes = Buffer.byteLength(text, "utf8")
			total += bytes
			if (bytes > COMPONENT_COMPILE_LIMITS.fileBytes)
				out.push(`file ${JSON.stringify(p)} is ${bytes} bytes, over ${COMPONENT_COMPILE_LIMITS.fileBytes}`)
		}
		if (total > COMPONENT_COMPILE_LIMITS.sourceBytes)
			out.push(`the source is ${total} bytes, over ${COMPONENT_COMPILE_LIMITS.sourceBytes}`)
		if (typeof entry !== "string" || !Object.hasOwn(files, entry))
			out.push(`entry ${JSON.stringify(entry)} is not one of the files`)
	}
	if (!isPlainObject(widget)) out.push("widget must be an object")
	else {
		out.push(...i18nFindings(widget.title, "widget.title", { required: true }))
		if (widget.icon !== undefined && typeof widget.icon !== "string") out.push("widget.icon must be a string")
		for (const [key, known] of [
			["scopes", Object.keys(WIDGET_SCOPED_SECTIONS)],
			["reads", WIDGET_BASE_SECTIONS as readonly string[]]
		] as const) {
			const v = widget[key]
			if (v === undefined) continue
			if (!Array.isArray(v)) out.push(`widget.${key} must be a list`)
			else
				for (const s of v)
					if (typeof s !== "string" || !known.includes(s))
						out.push(`widget.${key} names ${JSON.stringify(s)}, which is not one of ${known.join(", ")}`)
		}
		if (widget.channels !== undefined && !(Array.isArray(widget.channels) && widget.channels.every((c) => typeof c === "string")))
			out.push("widget.channels must be a list of channel slugs")
		if (widget.settings !== undefined && !isPlainObject(widget.settings)) out.push("widget.settings must be a settings schema object")
		if (widget.defaultActive !== undefined && typeof widget.defaultActive !== "boolean")
			out.push("widget.defaultActive must be true or false")
	}
	if (basedOn != null) {
		if (
			!isPlainObject(basedOn) ||
			typeof basedOn.component !== "string" ||
			typeof basedOn.version !== "string" ||
			(basedOn.sourceHash !== undefined && typeof basedOn.sourceHash !== "string")
		)
			out.push("basedOn must be { component, version, sourceHash? }, all text")
	}
	return out
}

/** Only the declared widget keys, so a stored `widget` never carries an `id`, `role` or `component` it was handed. */
function widgetOf(w: AuthoredWidgetShape): AuthoredWidgetShape {
	const out: AuthoredWidgetShape = { title: w.title }
	if (w.icon !== undefined) out.icon = w.icon
	if (w.scopes !== undefined) out.scopes = [...new Set(w.scopes)]
	if (w.reads !== undefined) out.reads = [...new Set(w.reads)]
	if (w.channels !== undefined) out.channels = [...w.channels]
	if (w.settings !== undefined) out.settings = w.settings
	if (w.defaultActive !== undefined) out.defaultActive = w.defaultActive
	return out
}

/* ── reads ──────────────────────────────────────────────────────────────── */

export async function getAuthoredComponent(db: Db, id: string): Promise<AuthoredComponentRow | undefined> {
	const [row] = await db.select().from(authoredComponents).where(eq(authoredComponents.id, id)).limit(1)
	return row
}

/** Every authored component, by slug. */
export async function listAuthoredComponents(db: Db): Promise<AuthoredComponentRow[]> {
	return db.select().from(authoredComponents).orderBy(asc(authoredComponents.slug))
}

/* ── content writes (optimistic) ────────────────────────────────────────── */

/**
 * The next `updatedAt`: now, but always strictly after the one it replaces —
 * two saves in one millisecond must still be two tokens, or the stale one
 * would match. Millisecond-exact (a JS `Date`), so it round-trips.
 */
const nextStamp = (prev?: Date): Date =>
	new Date(Math.max(Date.now(), prev ? prev.getTime() + 1 : 0))

/** Store a new authored component, disabled and uncompiled, under a fresh authored id. */
export async function createAuthoredComponent(
	db: Db,
	content: AuthoredComponentContent,
	opts: { createdBy?: number | null } = {}
): Promise<AuthoredComponentRow> {
	const findings = authoredComponentFindings(content)
	if (findings.length) throw new AuthoredComponentInvalid(findings)
	const now = nextStamp()
	const [row] = await db
		.insert(authoredComponents)
		.values({
			id: newAuthoredId(),
			slug: content.slug,
			label: content.label,
			framework: content.framework,
			entry: content.entry,
			files: content.files,
			widget: widgetOf(content.widget),
			basedOn: content.basedOn ?? null,
			sourceHash: componentSourceHash(content.files),
			createdBy: opts.createdBy ?? null,
			createdAt: now,
			updatedAt: now
		})
		.returning()
	return row!
}

/**
 * Change an authored component's content — only if it is still the version
 * the writer read (`expectedUpdatedAt`). A stale token throws
 * {@link AuthoredComponentConflict}; an unknown id {@link AuthoredComponentMissing}.
 * A changed source clears the compile. A patch naming the source (`files`,
 * `entry` or `framework`) becomes the saved version and clears any component
 * draft — the caller writes here only source that compiled, or source of a
 * component with no saved version ({@link hasSavedVersion}).
 */
export async function updateAuthoredComponent(
	db: Db,
	id: string,
	expectedUpdatedAt: Date,
	patch: Partial<AuthoredComponentContent>
): Promise<AuthoredComponentRow> {
	const current = await getAuthoredComponent(db, id)
	if (!current) throw new AuthoredComponentMissing(id)
	const merged: AuthoredComponentContent = {
		slug: patch.slug ?? current.slug,
		label: patch.label ?? current.label,
		framework: (patch.framework ?? current.framework) as AuthoredFramework,
		entry: patch.entry ?? current.entry,
		files: patch.files ?? current.files,
		widget: patch.widget ?? current.widget,
		basedOn: patch.basedOn !== undefined ? patch.basedOn : current.basedOn
	}
	const findings = authoredComponentFindings(merged)
	if (findings.length) throw new AuthoredComponentInvalid(findings)
	const sourceHash = componentSourceHash(merged.files)
	// A new framework or entry is a new build even over the same files.
	const rebuild =
		sourceHash !== current.sourceHash || merged.framework !== current.framework || merged.entry !== current.entry
	const [row] = await db
		.update(authoredComponents)
		.set({
			slug: merged.slug,
			label: merged.label,
			framework: merged.framework,
			entry: merged.entry,
			files: merged.files,
			widget: widgetOf(merged.widget),
			basedOn: merged.basedOn ?? null,
			sourceHash,
			...(rebuild ? { fingerprint: null, artifactHash: null, lastError: null } : {}),
			...(patch.files !== undefined || patch.entry !== undefined || patch.framework !== undefined ? NO_DRAFT : {}),
			updatedAt: nextStamp(expectedUpdatedAt)
		})
		.where(and(eq(authoredComponents.id, id), sameStamp(expectedUpdatedAt)))
		.returning()
	if (!row) return conflictOrMissing(db, id)
	return row
}

/**
 * Keep source that did not compile as the component's **component draft**,
 * beside its saved version — which stays exactly as it was: its source, its
 * compiled module, its offer. Optimistic like any content write, and it bumps
 * `updatedAt`. The declaration half of the same save (`label`, `widget`) is
 * not source and needs no compile, so it lands on the component itself.
 *
 * Refused ({@link AuthoredComponentInvalid}) for a component with no saved
 * version: there is nothing for the draft to sit beside, and its source is
 * written with {@link updateAuthoredComponent} instead.
 */
export async function saveComponentDraft(
	db: Db,
	id: string,
	expectedUpdatedAt: Date,
	draft: { files: Record<string, string>; entry: string; framework: AuthoredFramework; errors: ComponentDraftError[] },
	declaration: Pick<Partial<AuthoredComponentContent>, "label" | "widget"> = {}
): Promise<AuthoredComponentRow> {
	const current = await getAuthoredComponent(db, id)
	if (!current) throw new AuthoredComponentMissing(id)
	if (!hasSavedVersion(current))
		throw new AuthoredComponentInvalid(["it has never compiled, so there is no saved version for a component draft to sit beside"])
	const findings = authoredComponentFindings({
		slug: current.slug,
		label: declaration.label ?? current.label,
		framework: draft.framework,
		entry: draft.entry,
		files: draft.files,
		widget: declaration.widget ?? current.widget,
		basedOn: current.basedOn
	})
	if (findings.length) throw new AuthoredComponentInvalid(findings)
	const stamp = nextStamp(expectedUpdatedAt)
	const [row] = await db
		.update(authoredComponents)
		.set({
			...(declaration.label !== undefined ? { label: declaration.label } : {}),
			...(declaration.widget !== undefined ? { widget: widgetOf(declaration.widget) } : {}),
			draftFiles: draft.files,
			draftEntry: draft.entry,
			draftFramework: draft.framework,
			draftErrors: draft.errors.map((e) => ({ file: e.file, line: e.line, column: e.column, text: e.text })),
			draftUpdatedAt: stamp,
			updatedAt: stamp
		})
		.where(and(eq(authoredComponents.id, id), sameStamp(expectedUpdatedAt)))
		.returning()
	if (!row) return conflictOrMissing(db, id)
	return row
}

/**
 * Discard the component draft: the editor goes back to the saved version.
 * Optimistic (a revert never drops a draft saved after the reverter read
 * it), and it bumps `updatedAt`. Harmless on a component with no draft.
 */
export async function revertComponentDraft(db: Db, id: string, expectedUpdatedAt: Date): Promise<AuthoredComponentRow> {
	const [row] = await db
		.update(authoredComponents)
		.set({ ...NO_DRAFT, updatedAt: nextStamp(expectedUpdatedAt) })
		.where(and(eq(authoredComponents.id, id), sameStamp(expectedUpdatedAt)))
		.returning()
	if (!row) return conflictOrMissing(db, id)
	return row
}

/**
 * Delete an authored component — only the version the deleter saw, so a
 * delete never takes away a save it did not see. Its widgets simply stop
 * being offered; the layouts and settings rows naming them stay, drawn as
 * missing, as a disabled plugin's are.
 */
export async function deleteAuthoredComponent(db: Db, id: string, expectedUpdatedAt: Date): Promise<void> {
	const gone = await db
		.delete(authoredComponents)
		.where(and(eq(authoredComponents.id, id), sameStamp(expectedUpdatedAt)))
		.returning({ id: authoredComponents.id })
	if (!gone.length) await conflictOrMissing(db, id)
}

/** `updated_at` equal to the token, at the millisecond a JS `Date` carries. */
function sameStamp(expected: Date) {
	return sql`date_trunc('milliseconds', ${authoredComponents.updatedAt}) = ${expected.toISOString()}::timestamp`
}

async function conflictOrMissing(db: Db, id: string): Promise<never> {
	const now = await getAuthoredComponent(db, id)
	if (!now) throw new AuthoredComponentMissing(id)
	throw new AuthoredComponentConflict(id, now.updatedAt)
}

/* ── switches (not content: no token, no bump) ──────────────────────────── */

/** The enable switch. False when no such component. */
export async function setAuthoredComponentEnabled(db: Db, id: string, enabled: boolean): Promise<boolean> {
	const rows = await db
		.update(authoredComponents)
		.set({ enabled })
		.where(eq(authoredComponents.id, id))
		.returning({ id: authoredComponents.id })
	return rows.length > 0
}

/**
 * Record a compile's result (P3) — landed only when the row still holds the
 * source that was compiled (`sourceHash`): a compile that finished after a
 * newer save is dropped, never stamped onto source it did not see. Exactly
 * one of `artifactHash` / `error`. True when it landed.
 */
export async function recordAuthoredCompile(
	db: Db,
	id: string,
	result: { sourceHash: string; fingerprint: string } & (
		| { artifactHash: string; error?: undefined }
		| { artifactHash?: undefined; error: string }
	)
): Promise<boolean> {
	const rows = await db
		.update(authoredComponents)
		.set({
			fingerprint: result.fingerprint,
			artifactHash: result.error === undefined ? result.artifactHash : null,
			lastError: result.error ?? null
		})
		.where(and(eq(authoredComponents.id, id), eq(authoredComponents.sourceHash, result.sourceHash)))
		.returning({ id: authoredComponents.id })
	return rows.length > 0
}

/* ── scope review (the plugin permission model, one record) ─────────────── */

/**
 * The review of an authored component's requested scopes, in the plugin
 * model's own record: every scope its widget asks for is marked reviewed,
 * and those in `denied` are also denied. A scope asked for LATER has no
 * mark and is refused until the next review — the same rule a plugin
 * update lives by. Replaces the previous record. False when no such component.
 */
export async function reviewAuthoredScopes(
	db: Db,
	id: string,
	decision: { denied: string[] }
): Promise<boolean> {
	const row = await getAuthoredComponent(db, id)
	if (!row) return false
	const declared = widgetScopePermissions(row.widget.scopes)
	const keys = new Set(declared.map((p) => p.key))
	const denied = decision.denied.map((s) => (s.startsWith("widget:") ? s : `widget:${s}`)).filter((k) => keys.has(k))
	await db
		.update(authoredComponents)
		.set({ adminDenied: [...new Set(denied), ...reviewMarks(declared)] })
		.where(eq(authoredComponents.id, id))
	return true
}

/** The scope picture for the admin surface — one row per requested scope. */
export function authoredScopeStates(row: Pick<AuthoredComponentRow, "widget" | "adminDenied">): PermissionState[] {
	return permissionStates(asWidgetManifest(row.widget), row.adminDenied)
}

/**
 * The widget half as the permission model's manifest shape, so
 * `permissionStates` / `effectivePermissions` read it as they read a plugin's.
 * Only `widget:<scope>` permissions can come out of it.
 */
export function asWidgetManifest(widget: AuthoredWidgetShape) {
	return { genres: [{ shape: { panels: [{ scopes: widget.scopes ?? [] }] } }] }
}
