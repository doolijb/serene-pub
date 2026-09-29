/**
 * Annex declarations, as the host finds them (2026-09-26; SDK `annexFields.ts`).
 *
 * One annex declaration per owner is the single source of truth for that
 * owner's session annex document (owner ruling 2026-09-26): every key it
 * keeps, declared once with its shape, who may see it and — when a person
 * may set it — who (`act`). Held here to:
 *
 * - **writes** — `set-session-annex` writes only declared keys, each value
 *   held to its shape and stored under the declaration's audience
 *   (`annexFieldsOfOwner`, read by the host's write);
 * - **views** — a person's view and the AI's view read the declaration's
 *   audience (`declaredAudiences`); a stored key no declaration covers is
 *   pipelines only, whatever audience an older write stored beside it;
 * - **templates** — the template view (`templateAnnex`, typed templates P6):
 *   every declared key of core and the enabled plugins, and no other key;
 * - **presses** — a field with `act` is offered as one action,
 *   `<owner>:annex#<key>` under the `widget` venue, served by core's one
 *   pipeline, `core:spec/set-annex-field`; one without is pipeline-written
 *   only and a press of it is refused.
 *
 * Owners: core (core-catalog's `CORE_ANNEX_FIELDS`, under `core`) and every
 * plugin, from the plugins table's stored manifests — a switched-off plugin's
 * included, so a press of one is refused with the switch's own sentence
 * rather than "not offered". A stored entry an older SDK built is checked
 * again with `annexFieldFindings`; one that fails is skipped with a warning,
 * never offered.
 */

import {
	annexField,
	annexFieldAction,
	annexFieldFindings,
	annexFieldsInGenre,
	isSettableAnnexField,
	type AnnexFieldDecl,
	type AnnexFieldInput,
	type DataAudiences,
	type ParticipantRef
} from "@serene-pub/sdk"
import { CORE_ANNEX_FIELDS } from "@serene-pub/core-catalog"
import * as schema from "$lib/server/db/schema"
import { notCoreRow } from "$lib/server/plugins/frameHost"

/** One declared annex field in force for a session: whose document it describes, and its declaration. */
export interface DeclaredAnnexField {
	owner: string
	/** `<owner>:annex#<key>` — what a widget invokes, when the field is settable. */
	identity: string
	decl: AnnexFieldDecl
}

/** A stored or live declaration, checked and normalised — null (with a warning) when it fails. */
export function normaliseAnnexField(raw: unknown, where: string): AnnexFieldDecl | null {
	const faults = annexFieldFindings(raw, where)
	if (faults.length) {
		console.warn(`[annexFields] skipped a field that is not one:\n  ${faults.join("\n  ")}`)
		return null
	}
	return annexField(raw as AnnexFieldInput)
}

/** One owner's declaration as stored, and whether the owner is switched on. */
export interface AnnexDeclaration {
	owner: string
	/** Core always; a plugin by its switch. */
	enabled: boolean
	fields: AnnexFieldDecl[]
}

/** Every owner's declaration, unfiltered by genre: core's, then each plugin's stored manifest's. */
async function everyDeclaration(db: Db): Promise<AnnexDeclaration[]> {
	const out: AnnexDeclaration[] = [
		{ owner: "core", enabled: true, fields: [...CORE_ANNEX_FIELDS] }
	]
	const plugins = await db
		.select({
			pluginId: schema.plugins.pluginId,
			manifest: schema.plugins.manifest,
			enabled: schema.plugins.enabled
		})
		.from(schema.plugins)
		.where(notCoreRow())
	for (const p of plugins) {
		const raw = (p.manifest as { annexFields?: unknown } | null)?.annexFields
		if (!Array.isArray(raw)) {
			out.push({ owner: p.pluginId, enabled: p.enabled, fields: [] })
			continue
		}
		const fields: AnnexFieldDecl[] = []
		const taken = new Set<string>()
		for (const r of raw) {
			const decl = normaliseAnnexField(r, `${p.pluginId}.annexFields`)
			// A key has one declaration per owner (the SDK refuses a second);
			// a stored manifest that carries two is read as its first.
			if (!decl || taken.has(decl.key)) continue
			taken.add(decl.key)
			fields.push(decl)
		}
		out.push({ owner: p.pluginId, enabled: p.enabled, fields })
	}
	return out
}

/** Every declared annex field in force for a session of `genreId`: unscoped, or scoped to this genre. */
export async function declaredAnnexFields(
	db: Db,
	genreId: string
): Promise<DeclaredAnnexField[]> {
	const out: DeclaredAnnexField[] = []
	for (const { owner, fields } of await everyDeclaration(db))
		for (const decl of annexFieldsInGenre(fields, genreId))
			out.push({ owner, identity: annexFieldAction(owner, decl.key), decl })
	return out
}

/** The declared fields a person may set — the ones offered as actions (`act` present). */
export async function settableAnnexFields(
	db: Db,
	genreId: string
): Promise<DeclaredAnnexField[]> {
	return (await declaredAnnexFields(db, genreId)).filter((f) => isSettableAnnexField(f.decl))
}

/** The one declared field an identity names for this session's genre, settable or not — or null. */
export async function annexFieldFor(
	db: Db,
	genreId: string,
	identity: string
): Promise<DeclaredAnnexField | null> {
	return (await declaredAnnexFields(db, genreId)).find((f) => f.identity === identity) ?? null
}

/**
 * One owner's declaration in force for a session of `genreId` — what a
 * `set-session-annex` write is held to. `[]` for an owner that declares
 * nothing (a plugin with no `annexFields`, a user-authored spec's
 * `user:<slug>`), so every key it writes is refused.
 */
export async function annexFieldsOfOwner(
	db: Db,
	genreId: string,
	owner: string
): Promise<AnnexFieldDecl[]> {
	const all = await everyDeclaration(db)
	const mine = all.find((d) => d.owner === owner)
	return mine ? annexFieldsInGenre(mine.fields, genreId) : []
}

/**
 * Who may see each declared key, besides pipelines (R57) — owner → key →
 * the declaration's `see`, for a session of `genreId`. What every reader's
 * view is built from: the declaration, never what an older write stored
 * beside the value. A key no declaration covers is absent, so it is
 * pipelines only (R59) — still in the annex, still read by every pipeline.
 * A key declared for pipelines only is absent too.
 */
export async function declaredAudiences(db: Db, genreId: string): Promise<DataAudiences> {
	const out: DataAudiences = {}
	for (const f of await declaredAnnexFields(db, genreId)) {
		if (!f.decl.see.length) continue
		;(out[f.owner] ??= {})[f.decl.key] = [...f.decl.see] as ParticipantRef[]
	}
	return out
}

/** The genre a session runs, for the declarations above — Chat when it names none. */
export async function sessionGenreOf(db: Db, sessionId: number): Promise<string> {
	const { eq } = await import("drizzle-orm")
	const [row] = await db
		.select({ genreId: schema.sessions.genreId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	return row?.genreId ?? "core:genre/chat"
}

/**
 * What a template may read of the annex (typed templates P6, owner ruling Q1:
 * "The AI should be able to see anything in the annex that's rendered into the
 * context; nothing dangerous should ever be stored there") — `{ <owner>: {
 * <key>: value } }`, `annex.<owner>.<key>` in a template.
 *
 * Every DECLARED key of every owner in scope, and nothing else:
 *
 * - **owners in scope** are core and the ENABLED plugins — a switched-off
 *   plugin's document stays where it is and reaches no prompt;
 * - **declared** means in force for this session's genre
 *   (`annexFieldsInGenre`) — a key no declaration covers (legacy data an
 *   older write left) never arrives, whatever it holds;
 * - no audience filter: the declaration is the guarantee, refusing a secret
 *   at write time (R61), and a pipeline reads every declared key anyway.
 *
 * An owner with none of its declared keys stored is absent, not `{}`, so
 * `{{#if annex.[owner]}}` is honest. Pure: `core:query/session-annex@1`
 * (`view: 'template'`) hands it the stored annex and the declarations.
 */
export function templateAnnexFrom(
	annex: Record<string, unknown>,
	declarations: readonly AnnexDeclaration[],
	genreId: string
): Record<string, Record<string, unknown>> {
	const out: Record<string, Record<string, unknown>> = {}
	for (const { owner, enabled, fields } of declarations) {
		if (!enabled) continue
		const doc = annex[owner]
		if (!doc || typeof doc !== "object" || Array.isArray(doc)) continue
		const stored = doc as Record<string, unknown>
		const kept: Record<string, unknown> = {}
		for (const decl of annexFieldsInGenre(fields, genreId))
			if (Object.prototype.hasOwnProperty.call(stored, decl.key) && stored[decl.key] !== undefined)
				kept[decl.key] = stored[decl.key]
		if (Object.keys(kept).length) out[owner] = kept
	}
	return out
}

/** {@link templateAnnexFrom} over the stored declarations — the host's `view: 'template'` read. */
export async function templateAnnex(
	db: Db,
	genreId: string,
	annex: Record<string, unknown>
): Promise<Record<string, Record<string, unknown>>> {
	return templateAnnexFrom(annex, await everyDeclaration(db), genreId)
}
