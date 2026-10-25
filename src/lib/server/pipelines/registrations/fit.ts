/**
 * 🚧 **Re-check fit when anything changes** (A11; PROPOSAL-layering §12;
 * lane 5b, 2026-10-20). A package update can make a pipeline read
 * `cause.subject`; a publish can drop a step a preset sets values on; a genre
 * update can drop an envoy. So on install, update, disable and publish — and
 * once at boot, since the build itself may have changed — the host runs every
 * registration that names the changed thing back through the door
 * (`door.ts`), and one the door now refuses is **broken**: the resolver
 * leaves it out exactly as it leaves out a registration whose pipeline is not
 * published (`resolve.ts`, the stale path — the layer below answers its event
 * in its place), with a notice naming it (the preset reconcile writes one per
 * broken preset registration; a genre's is logged) — never a run that fails at
 * the first turn.
 *
 * What breaks a registration here is what an update can change about it:
 * **fit** (R4 — the trigger does not carry what the pipeline reads), its
 * **values** (a step it sets values on is gone), and the registering genre's
 * **envoys**. A pipeline that is not published at all is the resolver's
 * stale path already, and not repeated here.
 *
 * The verdicts are held in memory per (genre, registration key): recomputed
 * at boot and on every change, never stored — a row is data with an origin
 * (§11-1); whether it fits is a fact about this instance now.
 */
import { eq, inArray, or } from "drizzle-orm"
import type { RegistrationDecl, SpecDocument } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import { declOfRow, registers, type RegistrationRow } from "$lib/server/pipelines/registrations/rows"

/** The laws whose error makes a registration broken (A11) — what a change elsewhere can break. */
export const BREAKING_LAWS: ReadonlySet<string> = new Set([
	"registration fit",
	"registration values",
	"registration envoys"
])

export interface BrokenRegistration {
	key: string
	pipeline: string
	/** The genre it was judged in (its envoys). */
	genreId: string
	/** Where the row lives: `genre`, `preset`, `session`. */
	scopeKind: string
	scopeRef: string
	/** The door's sentence. */
	reason: string
}

/** `scope kind · scope ref · key` → the verdict. */
const broken = new Map<string, BrokenRegistration>()
const idOf = (scopeKind: string, scopeRef: string, key: string) => `${scopeKind}\u0000${scopeRef}\u0000${key}`

/**
 * The sentence a registration row is left out with, or null when it fits
 * (as far as the last check knows) — by the row's scope: the genre's
 * defaults (`genre`, its id), a preset's (`preset`, its id) or a session's.
 */
export function brokenReason(scopeKind: string, scopeRef: string, key: string): string | null {
	return broken.get(idOf(scopeKind, scopeRef, key))?.reason ?? null
}

/** Every broken registration the last checks found, for a report or an admin list. */
export function brokenRegistrations(): BrokenRegistration[] {
	return [...broken.values()]
}

/** Tests: forget every verdict. */
export function _resetFit(): void {
	broken.clear()
}

export interface RefitReport {
	checked: number
	broken: BrokenRegistration[]
	/** Registrations that were broken and fit again. */
	mended: string[]
}

/** The genre a row's registrations run in: its own for genre scope, its preset's or session's genre otherwise. */
async function genreOfRows(db: Db, rows: readonly RegistrationRow[]): Promise<Map<number, string>> {
	const out = new Map<number, string>()
	const presetIds = [...new Set(rows.filter((r) => r.scopeKind === "preset").map((r) => r.presetId!).filter(Boolean))]
	const sessionIds = [...new Set(rows.filter((r) => r.scopeKind === "session").map((r) => r.sessionId!).filter(Boolean))]
	const presets = presetIds.length
		? await db
				.select({ id: schema.sessionPresets.id, genreId: schema.sessionPresets.genreId })
				.from(schema.sessionPresets)
				.where(inArray(schema.sessionPresets.id, presetIds))
		: []
	const sessions = sessionIds.length
		? await db
				.select({ id: schema.sessions.id, genreId: schema.sessions.genreId })
				.from(schema.sessions)
				.where(inArray(schema.sessions.id, sessionIds))
		: []
	for (const r of rows) {
		if (r.scopeKind === "genre") out.set(r.id, r.scopeRef)
		else if (r.scopeKind === "preset") {
			const g = presets.find((p) => p.id === r.presetId)?.genreId
			if (g) out.set(r.id, g)
		} else if (r.scopeKind === "session") {
			const g = sessions.find((s) => s.id === r.sessionId)?.genreId
			out.set(r.id, g ?? "core:genre/story")
		}
	}
	return out
}

/**
 * **Re-check** every registering row that names one of `names` — a spec slug
 * (its pipeline, or an action's declaring spec), a package id (any spec of
 * that package, any registration in a genre of its), or a genre id (any
 * registration in that genre) — or every registering row when `names` is
 * absent (the boot).
 * Updates the verdicts the resolver reads, forgets the resolver's cache, and
 * returns what it found. Never throws: a check that cannot run leaves the old
 * verdicts and is logged.
 */
export async function refitRegistrations(db: Db, names?: readonly string[]): Promise<RefitReport> {
	const report: RefitReport = { checked: 0, broken: [], mended: [] }
	try {
		let slugs: string[] | null = null
		let pkgs: string[] = []
		let genres: string[] = []
		if (names) {
			const set = new Set(names.filter(Boolean))
			// A genre id names every registration in that genre (its envoys,
			// its fields, may have changed).
			genres = [...set].filter((n) => n.includes(":genre/"))
			for (const g of genres) set.delete(g)
			// A package id names every spec its package installed, and every
			// registration in a genre of its own.
			pkgs = [...set].filter((n) => !n.includes(":"))
			if (pkgs.length) {
				const owned = await db
					.select({ slug: schema.pipelineSpecs.slug })
					.from(schema.pipelineSpecs)
					.innerJoin(schema.plugins, eq(schema.plugins.id, schema.pipelineSpecs.sourcePluginId))
					.where(inArray(schema.plugins.pluginId, pkgs))
				for (const o of owned) set.add(o.slug)
				for (const p of pkgs) set.delete(p)
			}
			slugs = [...set]
			if (!slugs.length && !pkgs.length && !genres.length) return report
		}
		const names_ = (r: RegistrationRow) =>
			!slugs ||
			slugs.includes(r.specSlug ?? "") ||
			(r.triggerFamily === "action" && slugs.some((s) => (r.triggerRef ?? "").startsWith(`${s}#`)))
		// A registering row names its pipeline, and an action's names its
		// declaring spec in its identity (`<spec>#<key>`).
		const candidates = (
			(await db
				.select()
				.from(schema.registrations)
				.where(
					slugs && !pkgs.length && !genres.length
						? or(inArray(schema.registrations.specSlug, slugs.length ? slugs : [""]), eq(schema.registrations.triggerFamily, "action"))
						: eq(schema.registrations.dropped, false)
				)) as RegistrationRow[]
		).filter(registers)
		const genreOf = await genreOfRows(db, candidates)
		const inPackageGenre = (r: RegistrationRow) => {
			const g = genreOf.get(r.id) ?? ""
			return pkgs.some((p) => g.startsWith(`${p}:`)) || genres.includes(g)
		}
		const rows = candidates.filter((r) => names_(r) || inPackageGenre(r))
		const { registrationDoor, publishedDocuments, pipelinesNamed } = await import(
			"$lib/server/pipelines/registrations/door"
		)
		const decls = rows.map((r) => ({ row: r, decl: declOfRow(r) })).filter((x): x is { row: RegistrationRow; decl: RegistrationDecl } => !!x.decl)
		const docs: Map<string, SpecDocument | null> = await publishedDocuments(db, pipelinesNamed(decls.map((d) => d.decl)))
		// One door per genre, so each is judged against its registering genre's envoys.
		const byGenre = new Map<string, Array<{ row: RegistrationRow; decl: RegistrationDecl }>>()
		for (const x of decls) {
			const g = genreOf.get(x.row.id)
			if (!g) continue
			byGenre.set(g, [...(byGenre.get(g) ?? []), x])
		}
		// Every verdict this check covers is judged afresh: one whose row is
		// gone (a preset's registration removed, a package uninstalled) is
		// forgotten — mended, as far as anything here can tell.
		const covered = (b: BrokenRegistration) =>
			!slugs ||
			slugs.includes(b.pipeline) ||
			genres.includes(b.genreId) ||
			pkgs.some((p) => b.genreId.startsWith(`${p}:`) || b.pipeline.startsWith(`${p}:`))
		const before = new Map([...broken].filter(([, b]) => covered(b)))
		for (const id of before.keys()) broken.delete(id)
		for (const [genreId, list] of byGenre) {
			const verdict = await registrationDoor(
				db,
				list.map((x) => x.decl),
				{ layer: `the registrations of '${genreId}'`, genreId, docs }
			)
			for (const [i, { row, decl }] of list.entries()) {
				report.checked++
				const id = idOf(row.scopeKind, row.scopeRef, decl.key)
				// Not published: the resolver's stale path says it already.
				const errors = docs.get(decl.pipeline)
					? (verdict.perDecl[i] ?? []).filter((f) => BREAKING_LAWS.has(f.law))
					: []
				if (errors.length) {
					const b: BrokenRegistration = {
						key: decl.key,
						pipeline: decl.pipeline,
						genreId,
						scopeKind: row.scopeKind,
						scopeRef: row.scopeRef,
						reason: `'${decl.pipeline}' no longer fits here: ${errors[0]!.message.replace(/^registration '[^']*'(?: in .*?)?: /, "")}`
					}
					broken.set(id, b)
					report.broken.push(b)
				}
			}
		}
		for (const [id, b] of before) if (!broken.has(id)) report.mended.push(b.key)
		for (const b of report.broken)
			console.warn(`[registrations] '${b.key}' (${b.scopeKind} ${b.scopeRef}) is left out: ${b.reason}`)
	} catch (err) {
		console.warn("[registrations] the fit re-check did not finish:", err)
	}
	const { invalidateRegistrations } = await import("$lib/server/pipelines/registrations/resolve")
	invalidateRegistrations()
	return report
}

/**
 * The re-check after a change (A11): `refitRegistrations` for what changed,
 * then the preset reconcile, which writes a notice per broken preset
 * registration (and clears the notice of one that fits again). Best-effort,
 * like every reconcile: a change that landed is never refused here.
 */
export async function refitAfterChange(db: Db, names?: readonly string[]): Promise<RefitReport> {
	const report = await refitRegistrations(db, names)
	try {
		const { reconcilePresetBindings } = await import("$lib/server/pipelines/boot/presetReconcile")
		await reconcilePresetBindings(db)
	} catch (err) {
		console.warn("[registrations] the preset reconcile after a re-check failed:", err)
	}
	return report
}
