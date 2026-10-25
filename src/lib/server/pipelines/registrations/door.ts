/**
 * 🚧 **The registration door** (PROPOSAL-layering §11-2, A11, A16; lane 5b,
 * 2026-10-20) — the one host function every origin of a registration calls:
 * the boot's projection of the genre's defaults and presets, the preset
 * editor's save, a session's own rows (an action switched on, a routine's
 * cadence), the data upgrade's rows (judged by the boot's re-check after
 * it), and any later tool (§11-7).
 *
 * It wraps the SDK's `registrationFindings` (fit R4, cadence options R10/R15,
 * caps R11, values R38, plumbing never exposed, duplicates R34, cycles A12)
 * and adds what only the host knows:
 *
 *  · **the pipelines as installed** — each registration's pipeline (and an
 *    action's declaring spec) read back from its published version, so fit
 *    is judged against what would run, not what a package once shipped;
 *  · **the registering genre's envoys** — a pipeline mounted by
 *    registrations names no genre (D3, the `suits` form), so an envoy it
 *    references (its prompts, a line spoken as `envoy:<slug>`) is checked
 *    against the genre that registers it, here;
 *  · **the system's cron caps** (R11) — a registration's own may not exceed
 *    them;
 *  · **the session's story clock**, when a session is in hand;
 *  · **a preset's requirements** (A16, `presetRequirementFindings`) —
 *    every package it requires installed, enabled and in range.
 *
 * Refusing is the caller's: an administrator's save is refused on an error;
 * a projection is never refused (a boot never fails on a declaration), its
 * broken registrations are left out as stale (`fit.ts`) and said.
 */
import { eq, inArray } from "drizzle-orm"
import {
	ENVOY_CONFIG_PREFIX,
	envoyConfigKeysOf,
	envoySlugOf,
	envoySlugOfRef,
	genreEnvoys,
	parseRequirement,
	registrationFindings,
	type Finding,
	type RegistrationDecl,
	type RoutineCaps,
	type SpecDocument
} from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"

/** The host's trigger families today (LS1): Live is a later one. */
export const HOST_FAMILIES = ["event", "action", "routine"] as const

export interface DoorOptions {
	/** What the registrations are, for sentences — `the genre's defaults of 'core:genre/story'`, `preset 'Minimal'`. */
	layer: string
	/** The genre that registers them — whose envoys a pipeline's references are checked against. */
	genreId?: string | null
	/** The session, when the registrations are its own rows — whose story clock a cadence may need. */
	sessionId?: number | null
	/** Documents already loaded, by spec slug (the refit's batch). */
	docs?: Map<string, SpecDocument | null>
}

export interface DoorVerdict {
	findings: Finding[]
	errors: Finding[]
	/** Per registration key: its errors. */
	byKey: Map<string, Finding[]>
	/** Per registration, in the order handed in: its own errors. */
	perDecl: Finding[][]
}

const CREATE_MESSAGE_ID = "core:outlet/create-message"

/** The published, active document of each slug (null: not published here). */
export async function publishedDocuments(
	db: Db,
	slugs: Iterable<string>,
	into: Map<string, SpecDocument | null> = new Map()
): Promise<Map<string, SpecDocument | null>> {
	const want = [...new Set(slugs)].filter((s) => s && !into.has(s))
	if (!want.length) return into
	const rows = await db
		.select({
			slug: schema.pipelineSpecs.slug,
			activeVersionId: schema.pipelineSpecs.activeVersionId,
			status: schema.pipelineSpecVersions.status
		})
		.from(schema.pipelineSpecs)
		.innerJoin(schema.pipelineSpecVersions, eq(schema.pipelineSpecVersions.id, schema.pipelineSpecs.activeVersionId))
		.where(inArray(schema.pipelineSpecs.slug, want))
	const { loadDocument } = await import("$lib/server/pipelines/boot/store")
	for (const slug of want) {
		const row = rows.find((r) => r.slug === slug)
		if (!row?.activeVersionId || row.status !== "published") {
			into.set(slug, null)
			continue
		}
		try {
			into.set(slug, await loadDocument(db, row.activeVersionId))
		} catch {
			into.set(slug, null)
		}
	}
	return into
}

/** The system's cron caps (R11) — the ceiling every registration's own caps sit under. */
export async function systemCronCaps(db: Db): Promise<RoutineCaps> {
	try {
		const [row] = await db
			.select({
				idle: schema.systemSettings.cronIdleTimeoutMinutes,
				runs: schema.systemSettings.cronMaxRunsInRow
			})
			.from(schema.systemSettings)
			.limit(1)
		return row ? { idleTimeoutMinutes: row.idle, maxRunsInRow: row.runs } : {}
	} catch {
		return {}
	}
}

/** Whether a session has a story clock — a lorebook it reads, whose calendar keeps the clock. */
async function storyClockOf(db: Db, sessionId: number): Promise<boolean | undefined> {
	const [row] = await db
		.select({ lorebookId: schema.sessions.lorebookId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	return row ? row.lorebookId != null : undefined
}

/** The envoy keys a genre declares — its published declaration's, else the SDK registry's. */
async function genreEnvoyKeys(db: Db, genreId: string): Promise<Set<string> | null> {
	const { getSessionGenre } = await import("$lib/server/pipelines/entities/sessionGenres")
	const genre = await getSessionGenre(db, genreId).catch(() => null)
	const declared = genre?.envoys ?? genreEnvoys(genreId)
	if (!genre && !declared.length) return null
	return new Set(declared.map((e) => e.key))
}

/**
 * The envoys a pipeline references that the registering genre does not
 * declare (lane 1: a `suits` pipeline names no genre, so its envoys are the
 * registering genre's to check). A locked document was checked against its
 * own genre at compile and is not judged again here.
 */
export function envoyFindingsOf(
	decl: RegistrationDecl,
	doc: SpecDocument,
	genreId: string,
	declared: ReadonlySet<string>,
	layer: string
): Finding[] {
	if ((doc as { input?: { genre?: string } }).input?.genre) return []
	const at = `registration '${decl.key}'${layer ? ` in ${layer}` : ""}`
	const out: Finding[] = []
	const missing = (slug: string, how: string) =>
		out.push({
			law: "registration envoys",
			severity: "error",
			message: `${at}: '${doc.id}' ${how} envoy '${slug}', which '${genreId}' does not declare`,
			fix: `register it on a genre that brings the envoy '${slug}', or declare the envoy on '${genreId}'`
		})
	for (const target of envoyConfigKeysOf(doc)) {
		const key = target.slice(ENVOY_CONFIG_PREFIX.length)
		if (!declared.has(key)) missing(key, "reads the prompts of")
	}
	const own = new Set(
		((doc.contributes as { actions?: Array<{ envoy?: { key?: string } }> } | undefined)?.actions ?? []).flatMap((a) =>
			a.envoy?.key ? [envoySlugOf({ action: { specId: doc.id } }, a.envoy.key)] : []
		)
	)
	for (const n of doc.nodes) {
		if (n.definitionId !== CREATE_MESSAGE_ID) continue
		const slug = envoySlugOfRef((n.config as { speaker?: unknown } | undefined)?.speaker)
		if (slug === null || own.has(slug) || declared.has(slug)) continue
		missing(slug, `speaks (step '${n.key}') as`)
	}
	return out
}

/** The spec slugs a list of registrations needs read: each pipeline, and each action's declaring spec. */
export function pipelinesNamed(decls: readonly RegistrationDecl[]): string[] {
	const out = new Set<string>()
	for (const d of decls) {
		if (d.pipeline) out.add(d.pipeline)
		if (d.trigger?.family === "action") {
			const hash = d.trigger.action.lastIndexOf("#")
			if (hash > 0) out.add(d.trigger.action.slice(0, hash))
		}
	}
	return [...out]
}

/**
 * **The door.** Every finding the SDK's door and the host's facts give for
 * `decls`, and per registration key its own errors. Never throws for a bad
 * registration: a malformed one is a finding.
 */
export async function registrationDoor(
	db: Db,
	decls: readonly RegistrationDecl[],
	opts: DoorOptions
): Promise<DoorVerdict> {
	const docs = await publishedDocuments(db, pipelinesNamed(decls), opts.docs ?? new Map())
	const caps = await systemCronCaps(db)
	const storyClock = opts.sessionId != null ? await storyClockOf(db, opts.sessionId) : undefined
	const ctx = {
		pipeline: (id: string) => docs.get(id) ?? undefined,
		families: HOST_FAMILIES,
		caps,
		...(storyClock !== undefined ? { storyClock } : {}),
		layer: opts.layer
	}
	const byKey = new Map<string, Finding[]>()
	const seen = new Set<string>()
	const findings: Finding[] = []
	const add = (f: Finding, key?: string) => {
		const id = `${f.law}\u0000${f.message}`
		if (!seen.has(id)) {
			seen.add(id)
			findings.push(f)
		}
		if (key && f.severity === "error") byKey.set(key, [...(byKey.get(key) ?? []), f])
	}
	const envoys = opts.genreId ? await genreEnvoyKeys(db, opts.genreId) : null
	const perDecl: Finding[][] = []
	for (const d of decls) {
		const own = [...registrationFindings([d], ctx)]
		const doc = d?.pipeline ? docs.get(d.pipeline) : null
		if (doc && envoys && opts.genreId) own.push(...envoyFindingsOf(d, doc, opts.genreId, envoys, opts.layer))
		for (const f of own) add(f, d?.key)
		perDecl.push(own.filter((f) => f.severity === "error"))
	}
	// Across the list: duplicates (warn, R34) and cycles among emitted events (A12).
	for (const f of registrationFindings(decls, ctx))
		if (f.law === "registration duplicate" || f.law === "emits cycle") add(f)
	return { findings, errors: findings.filter((f) => f.severity === "error"), byKey, perDecl }
}

/** One sentence for a refusal: the first error's message and its fix. */
export const doorSentence = (errors: readonly Finding[]): string =>
	errors.length ? `${errors[0]!.message} — ${errors[0]!.fix}.` : ""

/* ── A16: a preset's requirements ───────────────────────────────────────── */

/**
 * What a preset (or a package) requires that this instance does not have
 * (A16): each `requires` entry naming a package — `acme.dice@^1.2`,
 * `acme.dice:spec/roll@^1.2` — whose package is not installed, is disabled,
 * or whose version is out of the range. One sentence per entry; empty when
 * everything is there. An entry with no range asks only that the package be
 * installed and enabled. A core id (`core:…`) is the build's, never a package.
 */
export async function presetRequirementFindings(db: Db, requires: readonly string[] | null | undefined): Promise<string[]> {
	const parsed = (requires ?? []).map((r) => ({ raw: r, req: parseRequirement(r) }))
	const packages = [...new Set(parsed.map((p) => p.req?.package).filter((p): p is string => !!p && p !== "core"))]
	if (!packages.length) return []
	const rows = await db
		.select({ pluginId: schema.plugins.pluginId, version: schema.plugins.version, enabled: schema.plugins.enabled })
		.from(schema.plugins)
		.where(inArray(schema.plugins.pluginId, packages))
	const { satisfiesRange } = await import("$lib/server/plugins/versionRange")
	const out: string[] = []
	for (const { raw, req } of parsed) {
		if (!req || req.package === "core") continue
		const row = rows.find((r) => r.pluginId === req.package)
		if (!row) out.push(`'${req.package}' is not installed (required as '${raw}')`)
		else if (!row.enabled) out.push(`'${req.package}' is switched off (required as '${raw}')`)
		else if (req.range && !satisfiesRange(row.version, req.range))
			out.push(`'${req.package}' is version ${row.version}, and '${raw}' asks for ${req.range}`)
	}
	return out
}
