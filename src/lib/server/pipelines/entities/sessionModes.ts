/**
 * Session modes, read from rows (19 §0–§2).
 *
 * The mode *is* the input type: a registry row of kind `input` whose
 * `session_shape` is present. The picker is one SELECT; the bucket for a mode is
 * every spec pinning the type and matching the primary-write signature; and
 * this module is the one place the shape's meaning is interpreted — the
 * validator here is what session creation and mode switching both call, so the
 * two can never disagree about what a shape permits.
 */

import { and, asc, eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import type { SessionShape } from "@serene-pub/sdk"

type Db = { select: any; insert: any; update: any; delete: any }

/** The F29 floor: always present, the default and the backfill. */
export const STANDARD_MODE_ID = "core:input/user-message@1"

/**
 * The primary write a session mode's pipeline must perform (19 §0).
 *
 * A pipeline is in a mode's `respond` bucket only if it both reads the mode's
 * input *and* writes a session message. Reading alone is not membership: the
 * narrative graph builder reads a session exactly as a reply does and produces a
 * proposal, which is a different lifecycle entirely.
 *
 * Bare, without the `@N`, because a bucket is about *what a pipeline does*
 * rather than which version of the consumer it pinned — a `create-message@2`
 * would still be writing the message.
 */
const CHAT_WRITE_TYPE = "core:consumer/create-message"

export interface SessionMode {
	/** The mode id — the pinned input type id. */
	modeId: string
	name: string
	/**
	 * The picker card's subtitle, from the row's display text. Never required
	 * to be present here — the SDK refuses an *untitled* mode at declaration
	 * and the packager warns about a missing description — but by the time a
	 * row exists, absence just renders a plainer card.
	 */
	description: string
	shape: SessionShape
}

const en = (v: unknown): string =>
	typeof v === "string" ? v : ((v as any)?.en ?? "")

/** Every mode this build registers — the picker's one SELECT. */
export async function listSessionModes(db: Db): Promise<SessionMode[]> {
	const rows = await db
		.select()
		.from(schema.pipelineTypeRegistry)
		.where(eq(schema.pipelineTypeRegistry.kind, "input"))
		.orderBy(asc(schema.pipelineTypeRegistry.id))
	return (rows as any[])
		.filter((r) => r.status === "live" && r.sessionShape)
		.map((r) => ({
			modeId: `${r.typeId}@${r.version}`,
			name: en(r.i18n?.name) || r.typeId,
			description: en(r.i18n?.description),
			shape: r.sessionShape as SessionShape
		}))
}

export async function getSessionMode(
	db: Db,
	modeId: string
): Promise<SessionMode | null> {
	return (await listSessionModes(db)).find((m) => m.modeId === modeId) ?? null
}

/**
 * Does this session satisfy the shape? Refusals are sentences, per 15 §1.3 —
 * the reader used a picker that offered the mode, and "constraint violated"
 * tells them nothing they can act on.
 *
 * A capability the shape omits entirely means the system does not exist for
 * the session: zero of it is required *and* permitted. Bounds omit `max` for
 * unlimited.
 */
export function shapeViolations(
	shape: SessionShape,
	session: { characters: number; personas: number; hasLorebook: boolean }
): string[] {
	const out: string[] = []
	const bound = (
		label: string,
		count: number,
		cap?: { min: number; max?: number }
	) => {
		const min = cap?.min ?? 0
		const max = cap ? cap.max : 0 // absent capability: none permitted
		if (count < min)
			out.push(
				`this mode needs at least ${min} ${label}${min === 1 ? "" : "s"} — the session has ${count}`
			)
		if (max != null && count > max)
			out.push(
				max === 0
					? `this mode has no ${label}s — the session has ${count}`
					: `this mode allows at most ${max} ${label}${max === 1 ? "" : "s"} — the session has ${count}`
			)
	}
	bound("character", session.characters, shape.characters)
	bound("persona", session.personas, shape.personas)
	if (shape.lorebook === "required" && !session.hasLorebook)
		out.push("this mode requires a lorebook and the session has none")
	if (!shape.lorebook && session.hasLorebook)
		out.push("this mode has no lorebook attachment — the session has one")
	return out
}

/** The counts the validator needs, read once. */
export async function sessionShapeFacts(
	db: Db,
	sessionId: number
): Promise<{ characters: number; personas: number; hasLorebook: boolean }> {
	const [session] = await db
		.select({ lorebookId: schema.sessions.lorebookId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const characters = await db
		.select({ sessionId: schema.sessionCharacters.sessionId })
		.from(schema.sessionCharacters)
		.where(eq(schema.sessionCharacters.sessionId, sessionId))
	const personas = await db
		.select({ sessionId: schema.sessionPersonas.sessionId })
		.from(schema.sessionPersonas)
		.where(eq(schema.sessionPersonas.sessionId, sessionId))
	return {
		characters: (characters as any[]).length,
		personas: (personas as any[]).length,
		hasLorebook: session?.lorebookId != null
	}
}

/**
 * The mode's declared field values for a session, filtered to the declared
 * schema (19 §1) — the supply side of the fields round-trip. Session settings
 * wrote values to the row; this is where they enter a run, and keys the mode
 * does not declare are dropped here so a mode switch cannot smuggle stale
 * facts under names the new mode never asked for.
 *
 * Best-effort like the other run-shaping reads: a failed lookup supplies
 * `{}`, never a failed turn — and a session on the F29 floor with no registry
 * rows behaves exactly as before fields existed.
 */
export async function modeFieldsFor(
	db: Db,
	sessionId: number
): Promise<Record<string, unknown>> {
	try {
		const [session] = await db
			.select({
				modeId: schema.sessions.modeId,
				modeFields: schema.sessions.modeFields
			})
			.from(schema.sessions)
			.where(eq(schema.sessions.id, sessionId))
			.limit(1)
		if (!session) return {}
		const mode = await getSessionMode(
			db,
			session.modeId ?? STANDARD_MODE_ID
		)
		const declared = Object.keys((mode?.shape as any)?.fields ?? {})
		if (!declared.length) return {}
		const stored = (session.modeFields ?? {}) as Record<string, unknown>
		return Object.fromEntries(
			declared.filter((k) => k in stored).map((k) => [k, stored[k]])
		)
	} catch {
		return {}
	}
}

/** `ns:kind/name@N` → the bare type and its integer version. */
export function parseModeId(modeId: string): {
	bareType: string
	version: number
} {
	const [bareType, versionStr] = modeId.split("@")
	return { bareType: bareType!, version: Number(versionStr ?? 1) }
}

/**
 * Upgrade a session's mode along its own type (19 §6, ruled 2026-08-23):
 * **there is no mid-session mode swap.** A session's mode is chosen at creation and
 * fixed for its life; what a mode *is* allowed to do is evolve — the same
 * bare input type at a higher version. `crawl@1 → crawl@2` is the declaring
 * author saying "this is still the crawl, improved," and the session follows;
 * `crawl → heist` would re-meaning every message already in the session, and is
 * refused no matter how well the cast happens to fit.
 *
 * The target's shape is still validated (the same validator creation calls):
 * an upgrade that tightened a bound refuses with the sentences rather than
 * stranding the session half-legal. Downgrades refuse too — versions move one
 * way, like every other pin in the system. Field values stay on the row; the
 * supply side filters to the current version's declared keys, so a dropped
 * field goes inert and an added one starts empty.
 */
export async function upgradeSessionMode(
	db: Db,
	sessionId: number,
	targetModeId: string
): Promise<{ error?: string }> {
	const [session] = await db
		.select({ modeId: schema.sessions.modeId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return { error: "That session no longer exists." }
	const currentId = session.modeId ?? STANDARD_MODE_ID
	if (currentId === targetModeId) return {}

	const current = parseModeId(currentId)
	const target = parseModeId(targetModeId)
	if (current.bareType !== target.bareType)
		return {
			error:
				`A session keeps its mode for life — '${currentId}' cannot become ` +
				`'${targetModeId}'. Modes upgrade along their own type only.`
		}
	if (target.version <= current.version)
		return {
			error: `'${targetModeId}' is not an upgrade of '${currentId}' — versions move one way.`
		}

	const mode = await getSessionMode(db, targetModeId)
	if (!mode)
		return {
			error: `'${targetModeId}' is not a session mode this build registers.`
		}
	const violations = shapeViolations(
		mode.shape,
		await sessionShapeFacts(db, sessionId)
	)
	if (violations.length)
		return {
			error: `This session does not fit '${mode.name}': ${violations.join("; ")}.`
		}

	await db
		.update(schema.sessions)
		.set({ modeId: targetModeId })
		.where(eq(schema.sessions.id, sessionId))
	return {}
}

/**
 * Is this session's mode available to run (19 §6, ruled 2026-08-23)?
 *
 * A session whose mode disappeared — the declaring plugin disabled, the type
 * retired — goes **read-only**: its history stays readable and curatable,
 * and no new turn starts. Deliberately *not* a fallback to the standard
 * mode: the messages were written under the missing mode's shape, and
 * running them through a different one would silently re-meaning the session.
 *
 * The standard mode is the F29 floor — available by definition, registry or
 * no registry — so this can never make ordinary sessionting worse than today.
 */
export async function sessionModeAvailable(
	db: Db,
	sessionId: number
): Promise<{ available: boolean; modeId: string; reason?: string }> {
	const [session] = await db
		.select({ modeId: schema.sessions.modeId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	const modeId = session?.modeId ?? STANDARD_MODE_ID
	if (modeId === STANDARD_MODE_ID) return { available: true, modeId }
	try {
		if (await getSessionMode(db, modeId)) return { available: true, modeId }
	} catch {
		// A failed read refuses the turn rather than guessing — the reason
		// below says what to check.
	}
	return {
		available: false,
		modeId,
		reason:
			`This session's mode ('${modeId}') is not installed, so the session is ` +
			`read-only. Its messages are safe; new turns resume when the mode returns.`
	}
}

/* --- turn-taking (19 §5, U-C4) ----------------------------------------- */

/** The membership test — publishing this on `main` is being a strategy. */
const SPEAKER_SELECTION_SHAPE = "core:shape/speaker-selection@1"

export interface SpeakerStrategy {
	/** The strategy's pinned type id. */
	typeId: string
	name: string
}

/**
 * The swap list (19 §5): every next-speaker strategy this build registers.
 *
 * Membership is the shape, not a list — a task whose `main` publishes
 * `speaker-selection@1` *is* a strategy, so an extension's appears beside
 * core's by being registered, exactly as a session mode does. Same one-SELECT
 * posture as `listSessionModes`, and the same F29 footing: an empty registry
 * returns an empty list and nothing downstream blocks on it.
 */
export async function listSpeakerStrategies(
	db: Db
): Promise<SpeakerStrategy[]> {
	const rows = await db
		.select()
		.from(schema.pipelineTypeRegistry)
		.where(eq(schema.pipelineTypeRegistry.kind, "task"))
		.orderBy(asc(schema.pipelineTypeRegistry.id))
	return (rows as any[])
		.filter(
			(r) =>
				r.status === "live" &&
				r.ports?.out?.main === SPEAKER_SELECTION_SHAPE
		)
		.map((r) => ({
			typeId: `${r.typeId}@${r.version}`,
			name: en(r.i18n?.name) || r.typeId
		}))
}

/* --- function routing (19 §3, U-C3) ----------------------------------- */

export interface ModeTrigger {
	/** The function key the trigger fires — what routing resolves (§3). */
	function: string
	kind: string
	/** Lucide icon name, as the contributor declared it. */
	icon?: string
	name: string
	/** Who contributed it — the spec whose active version declares it. */
	specSlug: string
	/**
	 * Companion or attachment, decided by namespace (§3).
	 *
	 * A contribution from the mode owner's own namespace is a **companion** —
	 * shipped alongside the mode by the same author, so present by default. A
	 * foreign one is an **attachment**: somebody else's spec reaching into
	 * these sessions, so opt-in.
	 *
	 * Mechanical on purpose. §3's phrasing is "no lists to keep; the namespace
	 * comparison is the rule" — the alternative is a registry of who is
	 * trusted, which is a thing to maintain and a thing to get wrong.
	 */
	origin: "companion" | "attachment"
	/** What `origin` implies: companions on, attachments off. */
	enabledByDefault: boolean
}

/** `core:input/user-message@1` → `core`. The half of an id before the colon. */
const namespaceOf = (id: string): string => {
	const i = id.indexOf(":")
	return i === -1 ? "" : id.slice(0, i)
}

/**
 * The contributed trigger set for a mode (19 §4) — what the session view
 * renders, from rows.
 *
 * The same criteria as `resolveFunctionSpec`'s contributed branch (published
 * status, active version), deliberately: a button whose press cannot resolve,
 * or a resolvable function with no button, would be the two halves of one
 * fact disagreeing. Retiring a spec's version removes its triggers here and
 * its routing there in the same breath — no UI code involved.
 */
export async function listModeTriggers(
	db: Db,
	modeId: string
): Promise<ModeTrigger[]> {
	try {
		// ⚠ Ordered. The tie-break below is "first-published", and an
		// unordered SELECT makes that whatever order the heap returns —
		// which differs between a freshly seeded database and one that has
		// been rewritten a few hundred times. Two installs with identical
		// data would route the same session to different pipelines, and only one
		// of them would ever see it go wrong.
		const specs = await db
			.select()
			.from(schema.pipelineSpecs)
			.orderBy(asc(schema.pipelineSpecs.id))
		const versions = await db
			.select()
			.from(schema.pipelineSpecVersions)
			.where(eq(schema.pipelineSpecVersions.status, "published"))
		const out: ModeTrigger[] = []
		for (const s of specs as any[]) {
			if (s.activeVersionId == null) continue
			const v = (versions as any[]).find(
				(x) => x.id === s.activeVersionId
			)
			const triggers = (v?.contributes as any)?.triggers
			if (!Array.isArray(triggers)) continue
			for (const t of triggers) {
				if (t?.mode !== modeId) continue
				const origin =
					namespaceOf(s.slug) === namespaceOf(modeId)
						? "companion"
						: "attachment"
				out.push({
					function: String(t.function ?? ""),
					kind: String(t.kind ?? "button"),
					icon: typeof t.icon === "string" ? t.icon : undefined,
					name: en(t.i18n) || String(t.function ?? ""),
					specSlug: s.slug,
					origin,
					enabledByDefault: origin === "companion"
				})
			}
		}
		return out
	} catch {
		return []
	}
}

/**
 * Which spec serves a function for sessions of a mode.
 *
 * `respond` is intrinsic: its contributors are the bucket — live published
 * versions whose entry input pins the mode's type. Every other function's
 * contributors declared themselves through `contributes.triggers` (19 §4).
 *
 * When several serve, **the binding selects** (19 §3): rows in
 * `pipeline_function_bindings`, consulted session > instance, each only
 * ever a choice *among the eligible* — a binding whose spec left the bucket
 * (retired, republished elsewhere, deleted) falls through to the next scope
 * rather than routing to something that cannot serve. With no binding, the
 * companion rule made deterministic: a contributor in the mode owner's
 * namespace first, then first-published.
 *
 * Returns null when nothing serves — including when the registry never
 * synced — so callers keep their own floor (the F29 posture: routing failing
 * must degrade to the built-in behaviour, never block the turn).
 */
export async function resolveFunctionSpec(
	db: Db,
	modeId: string,
	functionKey: string,
	scope?: { sessionId?: number | null }
): Promise<string | null> {
	try {
		const [bareType, versionStr] = modeId.split("@")
		const modeNamespace = modeId.split(":")[0]

		// ⚠ Ordered. The tie-break below is "first-published", and an
		// unordered SELECT makes that whatever order the heap returns —
		// which differs between a freshly seeded database and one that has
		// been rewritten a few hundred times. Two installs with identical
		// data would route the same session to different pipelines, and only one
		// of them would ever see it go wrong.
		const specs = await db
			.select()
			.from(schema.pipelineSpecs)
			.orderBy(asc(schema.pipelineSpecs.id))
		const versions = await db
			.select()
			.from(schema.pipelineSpecVersions)
			.where(eq(schema.pipelineSpecVersions.status, "published"))
		const activeBySpec = new Map<number, any>()
		for (const s of specs as any[])
			if (s.activeVersionId != null)
				activeBySpec.set(
					s.id,
					(versions as any[]).find((v) => v.id === s.activeVersionId)
				)

		const candidates: Array<{ slug: string; namespace: string }> = []

		if (functionKey === "respond") {
			/**
			 * The bucket: entry input pins the mode's type **and** the version
			 * matches the primary-write signature (19 §0).
			 *
			 * ⚠ The second half was missing, and it is not academic.
			 * `core:spec/graph-build` pins `core:input/user-message@1` — it
			 * reads a session the same way a reply does — but it writes a *graph
			 * proposal*, not a message. Without the signature check it sat in
			 * the standard mode's respond bucket, so "which pipeline answers a
			 * message" could resolve to the graph builder. `generateResponse`
			 * asks this resolver, so that is the session path, not a panel.
			 *
			 * 19 §0 states the rule plainly: "a spec pinning a shape-bearing
			 * input without the primary consumer fails the lifecycle
			 * signature". Membership is structural, and the structure is both
			 * ends of the pipeline — what it reads and what it writes.
			 */
			for (const s of specs as any[]) {
				const v = activeBySpec.get(s.id)
				if (!v) continue
				const nodes = await db
					.select()
					.from(schema.pipelineNodes)
					.where(eq(schema.pipelineNodes.specVersionId, v.id))
				// The first *input* node, not the first node at position 0 —
				// the entry is a kind, not a coordinate.
				const entry = (nodes as any[])
					.filter((n) => n.kind === "input")
					.sort((a, b) => a.position - b.position)[0]
				if (
					!entry ||
					entry.typeId !== bareType ||
					String(entry.typeVersion) !== versionStr
				)
					continue
				const writesAMessage = (nodes as any[]).some(
					(n) => n.kind === "consumer" && n.typeId === CHAT_WRITE_TYPE
				)
				if (!writesAMessage) continue
				candidates.push({
					slug: s.slug,
					namespace: String(s.slug).split(":")[0]
				})
			}
		} else {
			for (const s of specs as any[]) {
				const v = activeBySpec.get(s.id)
				const triggers = (v?.contributes as any)?.triggers
				if (!Array.isArray(triggers)) continue
				if (
					triggers.some(
						(t: any) =>
							t?.mode === modeId && t?.function === functionKey
					)
				)
					candidates.push({
						slug: s.slug,
						namespace: String(s.slug).split(":")[0]
					})
			}
		}

		if (!candidates.length) return null

		// The binding selects (19 §3, simplified 2026-08-24): session >
		// instance, eligibility re-checked — a bound spec must still be a
		// candidate to win. There is no user layer.
		const slugBySpecId = new Map<number, string>(
			(specs as any[]).map((s) => [s.id, s.slug])
		)
		const eligible = new Set(candidates.map((c) => c.slug))
		const bindings = (await db
			.select()
			.from(schema.pipelineFunctionBindings)
			.where(
				and(
					eq(schema.pipelineFunctionBindings.modeId, modeId),
					eq(schema.pipelineFunctionBindings.functionKey, functionKey)
				)
			)) as any[]
		const addresses: Array<{ kind: string; id: number }> = [
			...(scope?.sessionId != null
				? [{ kind: "session", id: scope.sessionId }]
				: []),
			{ kind: "instance", id: 0 }
		]
		for (const addr of addresses) {
			const row = bindings.find(
				(b) => b.scopeKind === addr.kind && b.scopeId === addr.id
			)
			if (!row) continue
			const slug = slugBySpecId.get(row.specId)
			if (slug && eligible.has(slug)) return slug
		}

		const companion = candidates.find((c) => c.namespace === modeNamespace)
		return (companion ?? candidates[0]!).slug
	} catch {
		return null
	}
}

// ── Which of a mode's functions a session actually has (19 §3) ─────────────────

export interface SessionFunction extends ModeTrigger {
	/** The answer in force, after all three layers. */
	enabled: boolean
	/**
	 * True when a session row states this, false when a lower layer answered.
	 *
	 * Surfaced rather than kept private because it is the difference between
	 * "this session turned the narrator off" and "nobody here has ever said" —
	 * and the second silently follows a later change of preset or default
	 * while the first does not. A control showing only the checkbox would make
	 * those two look identical.
	 */
	explicit: boolean
	/**
	 * Whether the session's preset includes this action.
	 *
	 * The permission line runs here (ruled 2026-08-24): a non-admin may toggle
	 * an **included** action off and back on; turning on something the preset
	 * does not include is an admin's call, because it gives the session a
	 * capability the instance owner did not put in the list.
	 */
	included: boolean
	/** Which layer decided, for the control surface to explain itself. */
	source: "session" | "preset" | "default"
}

/**
 * The preset governing a session, and the actions it includes.
 *
 * "The session's preset" is the config selected for the pipeline that actually
 * serves `respond` for this mode — the one running the session's turns. Not the
 * mode-owner's by namespace, because the *serving* spec is what the binding
 * already resolves and what every other per-session setting resolves against;
 * a second notion of "this session's pipeline" would be a second answer to the
 * same question.
 *
 * Returns `null` for the action list when nothing states one — distinct from
 * `[]`, which is a preset saying *none*.
 */
/**
 * The pipeline running a session's turns, and the preset it is on.
 *
 * "This session's pipeline" is whatever serves `respond` for the mode — the thing
 * actually taking the turns. Not the mode owner by namespace: the *serving*
 * spec is what the binding already resolves and what every other per-session
 * setting resolves against, and a second notion of the same thing would be a
 * second answer to give when they disagree.
 *
 * Shared by the action layering and the preset picker on purpose. A picker
 * offering presets of one pipeline while the actions came from another would
 * be two halves of one fact disagreeing.
 */
export async function sessionPipeline(
	db: Db,
	sessionId: number,
	modeId: string,
	userId?: number | null
): Promise<{
	specId: number
	specSlug: string
	configId: number | null
	configName: string | null
} | null> {
	try {
		const specSlug = await resolveFunctionSpec(db, modeId, "respond", {
			sessionId
		})
		if (!specSlug) return null

		const [spec] = await db
			.select({ id: schema.pipelineSpecs.id })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, specSlug))
			.limit(1)
		if (!spec) return null

		const { resolveSelectedConfig } = await import(
			"$lib/server/pipelines/config/named"
		)
		const selected = await resolveSelectedConfig(db, spec.id, specSlug, {
			sessionId
		})
		return {
			specId: spec.id,
			specSlug,
			configId: selected?.configId ?? null,
			configName: selected?.name ?? null
		}
	} catch {
		return null
	}
}

async function presetActionsFor(
	db: Db,
	sessionId: number,
	modeId: string,
	userId?: number | null
): Promise<{ configId: number | null; included: string[] | null }> {
	try {
		const pipeline = await sessionPipeline(db, sessionId, modeId, userId)
		if (!pipeline?.configId) return { configId: null, included: null }

		const [config] = await db
			.select({
				id: schema.pipelineConfigs.id,
				includedActions: schema.pipelineConfigs.includedActions
			})
			.from(schema.pipelineConfigs)
			.where(eq(schema.pipelineConfigs.id, pipeline.configId))
			.limit(1)

		const raw = config?.includedActions
		return {
			configId: config?.id ?? null,
			included: Array.isArray(raw) ? raw.map(String) : null
		}
	} catch {
		// Routing or config resolution failing must not decide a session has no
		// actions — the F29 posture. Fall through to the companion rule.
		return { configId: null, included: null }
	}
}

/**
 * The mode's functions, with each one's state on this session.
 *
 * The *available* set is the mode's contributed triggers and nothing else, so
 * a function this mode was never offered cannot be turned on here — which is
 * what "explicitly per session mode" means in practice. `respond` is absent by
 * construction: it is intrinsic (§3), not a contribution, and a session that
 * could not reply would not be a session.
 *
 * Ordered companions-first then by name, so the things the mode's own author
 * shipped read as the mode's own surface and other people's additions read as
 * additions.
 */
export async function listSessionFunctions(
	db: Db,
	sessionId: number,
	modeId: string,
	userId?: number | null
): Promise<SessionFunction[]> {
	const available = await listModeTriggers(db, modeId)
	const rows = await db
		.select()
		.from(schema.sessionFunctions)
		.where(
			and(
				eq(schema.sessionFunctions.sessionId, sessionId),
				eq(schema.sessionFunctions.modeId, modeId)
			)
		)
	const stated = new Map<string, boolean>(
		(rows as any[]).map((r) => [r.functionKey as string, !!r.enabled])
	)

	const preset = await presetActionsFor(db, sessionId, modeId, userId)

	return available
		.map((t) => {
			// Three layers, first answer wins: the session's own row, then the
			// preset's included set, then the companion rule. Each is only
			// consulted where the one above it said nothing, which is what
			// lets a preset change reach sessions that never had a view while
			// leaving alone the ones that did.
			const included =
				preset.included === null
					? t.enabledByDefault
					: preset.included.includes(t.function)
			const source: SessionFunction["source"] = stated.has(t.function)
				? "session"
				: preset.included === null
					? "default"
					: "preset"
			return {
				...t,
				included,
				source,
				explicit: stated.has(t.function),
				enabled: stated.has(t.function)
					? stated.get(t.function)!
					: included
			}
		})
		.sort(
			(a, b) =>
				Number(b.origin === "companion") -
					Number(a.origin === "companion") ||
				a.name.localeCompare(b.name)
		)
}

/**
 * The functions actually in force — what the session view renders and what
 * `triggerFunction` will fire.
 *
 * Both callers go through this rather than filtering `listModeTriggers`
 * themselves, for the reason `listModeTriggers` and `resolveFunctionSpec`
 * already share their criteria: a button whose press is refused, or a
 * fireable function with no button, are two halves of one fact disagreeing.
 */
export async function enabledSessionFunctions(
	db: Db,
	sessionId: number,
	modeId: string,
	userId?: number | null
): Promise<SessionFunction[]> {
	return (await listSessionFunctions(db, sessionId, modeId, userId)).filter(
		(f) => f.enabled
	)
}

export interface SetSessionFunctionResult {
	ok: boolean
	error?: string
	/** The state in force afterwards, so a caller need not re-read. */
	enabled?: boolean
}

/**
 * Turn one of the mode's functions on or off for one session.
 *
 * Two refusals, both about meaning rather than safety:
 *
 * - **A function this mode does not offer** is refused by name. Writing it
 *   would store a row that decides nothing, and the next person to read the
 *   table would find an answer to a question nobody asks.
 * - **A mode mismatch** is refused for the same reason: the row is keyed by
 *   the mode it was chosen under, so writing one against a mode the session is
 *   not in produces a row that can never apply.
 *
 * Setting a function back to its default **deletes** the row rather than
 * storing the default (reset-is-delete). That is what keeps "no opinion"
 * distinguishable from "deliberately the same as the default", and it is why
 * a companion added in a later update reaches sessions that never had a view.
 */
export async function setSessionFunction(
	db: Db,
	sessionId: number,
	modeId: string,
	functionKey: string,
	enabled: boolean,
	actor?: { userId?: number | null; isAdmin?: boolean }
): Promise<SetSessionFunctionResult> {
	const [session] = await db
		.select({ modeId: schema.sessions.modeId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (!session) return { ok: false, error: "that session no longer exists" }

	const sessionMode = session.modeId ?? STANDARD_MODE_ID
	if (sessionMode !== modeId)
		return {
			ok: false,
			error:
				`this session is in ${sessionMode}, not ${modeId} — a function choice is ` +
				`stored against the mode it was made under, so one written against ` +
				`another mode could never apply`
		}

	const available = await listSessionFunctions(
		db,
		sessionId,
		modeId,
		actor?.userId
	)
	const decl = available.find((t) => t.function === functionKey)
	if (!decl)
		return {
			ok: false,
			error:
				`no spec contributes '${functionKey}' to ${modeId}. A session can only ` +
				`turn on what its mode was offered — install or publish a spec that ` +
				`contributes it, and it appears here.`
		}

	// The permission line (ruled 2026-08-24). Toggling an action the preset
	// **includes** is the user's own business — it is their session, and the
	// instance owner already put the action in the list. Turning on something
	// the preset leaves out gives the session a capability nobody offered it, so
	// it is an admin's call.
	//
	// Only *turning on* is gated. A non-admin switching an excluded action off
	// is asking for what they already have, and refusing that would be a rule
	// with no one to protect.
	if (enabled && !decl.included && actor && actor.isAdmin !== true)
		return {
			ok: false,
			error:
				`'${decl.name}' is not part of this session's preset. An administrator ` +
				`can add it to this session, or include it in the preset so every session ` +
				`using it has it.`
		}

	const where = and(
		eq(schema.sessionFunctions.sessionId, sessionId),
		eq(schema.sessionFunctions.modeId, modeId),
		eq(schema.sessionFunctions.functionKey, functionKey)
	)

	// Reset-is-delete against the layer *below* this one — the preset's answer,
	// or the companion rule where the preset states nothing. Comparing against
	// the companion rule alone would leave a row behind every time somebody
	// agreed with their preset, and those rows would then outlive the preset.
	if (enabled === decl.included) {
		await db.delete(schema.sessionFunctions).where(where)
		return { ok: true, enabled }
	}

	const [existing] = await db
		.select({ id: schema.sessionFunctions.id })
		.from(schema.sessionFunctions)
		.where(where)
		.limit(1)

	if (existing)
		await db
			.update(schema.sessionFunctions)
			.set({ enabled, updatedAt: new Date() })
			.where(eq(schema.sessionFunctions.id, existing.id))
	else
		await db
			.insert(schema.sessionFunctions)
			.values({ sessionId, modeId, functionKey, enabled })

	return { ok: true, enabled }
}

/**
 * The mode a pipeline serves, from its entry input node.
 *
 * The mode *is* the input type (19 §0), so this is one lookup rather than a
 * declaration anybody maintains: the spec's active version, its first node,
 * its pinned type. A spec whose entry input carries no shape is not serving a
 * mode and returns null — `summarize-request` is the case.
 *
 * Exists so the preset editor can offer the right action list. Without it the
 * editor would need its own idea of which actions belong to a pipeline, which
 * is the second answer this codebase keeps finding at the point where the two
 * disagree.
 */
export async function modeOfSpec(
	db: Db,
	specSlug: string
): Promise<string | null> {
	try {
		const [spec] = await db
			.select()
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.slug, specSlug))
			.limit(1)
		if (!spec?.activeVersionId) return null

		const nodes = await db
			.select()
			.from(schema.pipelineNodes)
			.where(eq(schema.pipelineNodes.specVersionId, spec.activeVersionId))
		const entry = (nodes as any[])
			.filter((n) => n.kind === "input")
			.sort((a, b) => a.position - b.position)[0]
		if (!entry) return null

		const modeId = `${entry.typeId}@${entry.typeVersion}`
		// Only a *shape-bearing* input type is a mode. Checked against the
		// registry rather than assumed, so a pipeline whose entry is an
		// ordinary input does not acquire a mode by having one.
		const [row] = await db
			.select({ sessionShape: schema.pipelineTypeRegistry.sessionShape })
			.from(schema.pipelineTypeRegistry)
			.where(
				and(
					eq(schema.pipelineTypeRegistry.typeId, entry.typeId),
					eq(
						schema.pipelineTypeRegistry.version,
						Number(entry.typeVersion)
					)
				)
			)
			.limit(1)
		return row?.sessionShape ? modeId : null
	} catch {
		return null
	}
}

/**
 * Set which actions a preset includes, and whether it may be chosen.
 *
 * Admin-only at the socket; the refusals here are about meaning. An immutable
 * preset is refused because core's shipped rows are "selectable and copyable,
 * never edited in place" — the same rule the rest of the panel runs under, so
 * the answer to "why can't I edit this" is one answer everywhere. An action no
 * spec contributes to this pipeline's mode is refused by name, because storing
 * it would put a key in the list that can never match anything.
 */
export async function setPresetActions(
	db: Db,
	configId: number,
	patch: { includedActions?: string[] | null; enabled?: boolean }
): Promise<{ ok: boolean; error?: string }> {
	const [config] = await db
		.select()
		.from(schema.pipelineConfigs)
		.where(eq(schema.pipelineConfigs.id, configId))
		.limit(1)
	if (!config) return { ok: false, error: "that preset no longer exists" }

	if (config.isImmutable)
		return {
			ok: false,
			error:
				`'${config.name}' is shipped with Serene Pub and is never edited in ` +
				`place. Duplicate it and edit the copy.`
		}

	if (patch.includedActions != null) {
		const [spec] = await db
			.select({ slug: schema.pipelineSpecs.slug })
			.from(schema.pipelineSpecs)
			.where(eq(schema.pipelineSpecs.id, config.specId))
			.limit(1)
		const modeId = spec ? await modeOfSpec(db, spec.slug) : null
		const offered = modeId ? await listModeTriggers(db, modeId) : []
		const keys = new Set(offered.map((t) => t.function))
		const unknown = patch.includedActions.filter((k) => !keys.has(k))
		if (unknown.length)
			return {
				ok: false,
				error:
					`nothing contributes '${unknown[0]}' to this pipeline's mode, so ` +
					`including it would put a key in the list that can never match.`
			}
	}

	await db
		.update(schema.pipelineConfigs)
		.set({
			...(patch.includedActions !== undefined
				? { includedActions: patch.includedActions }
				: {}),
			...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
			updatedAt: new Date()
		})
		.where(eq(schema.pipelineConfigs.id, configId))

	return { ok: true }
}

// ── The preset a session runs on (19 §7, ruled 2026-08-24) ────────────────────

export interface PresetOption {
	configId: number
	name: string
	/** The pipeline's own default — pre-selected when nothing was chosen. */
	isDefault: boolean
	/** Whether a non-admin may choose it. Admins see disabled ones too. */
	enabled: boolean
	/** Core's shipped preset, or a plugin's: selectable, never edited. */
	readOnly: boolean
}

/**
 * The presets a session may run on, and the one it is on.
 *
 * A *preset* is a pipeline configuration a person is allowed to see and use —
 * the two used to be separate ideas and are one now. What is on offer is
 * therefore the configurations of the pipeline serving this session's mode, minus
 * the ones an administrator has switched off.
 *
 * Disabled presets are still listed **for an admin**, marked, because an admin
 * disabling one and then not finding it in the list would look like it had
 * been deleted. A non-admin never sees them: that is what the switch is for.
 */
export async function listSessionPresets(
	db: Db,
	sessionId: number,
	modeId: string,
	viewer: { userId?: number | null; isAdmin?: boolean }
): Promise<{
	specSlug: string | null
	selectedId: number | null
	options: PresetOption[]
}> {
	const pipeline = await sessionPipeline(db, sessionId, modeId, viewer.userId)
	if (!pipeline) return { specSlug: null, selectedId: null, options: [] }

	const rows = await db
		.select()
		.from(schema.pipelineConfigs)
		.where(eq(schema.pipelineConfigs.specId, pipeline.specId))
		.orderBy(asc(schema.pipelineConfigs.id))

	const options = (rows as any[])
		.filter((c) => viewer.isAdmin === true || c.enabled !== false)
		.map((c) => ({
			configId: c.id as number,
			name: c.name as string,
			isDefault: !!c.isDefault,
			enabled: c.enabled !== false,
			readOnly: !!c.isImmutable
		}))

	return {
		specSlug: pipeline.specSlug,
		selectedId: pipeline.configId,
		options
	}
}

/**
 * Put a session on a preset.
 *
 * Writes a **session-scope** selection, which is the same row `pipelines:
 * selectConfig` writes — one mechanism, so a preset chosen here and one chosen
 * from the pipeline panel are the same fact rather than two that can disagree.
 *
 * The refusal that matters is the disabled one. `enabled` is the
 * administrator's answer to "what may people choose", and a picker that hid a
 * preset while the write accepted it would make the switch advisory — anything
 * able to emit a socket event would still get it.
 */
export async function chooseSessionPreset(
	db: Db,
	sessionId: number,
	modeId: string,
	configId: number,
	viewer: { userId?: number | null; isAdmin?: boolean }
): Promise<{ ok: boolean; error?: string }> {
	const pipeline = await sessionPipeline(db, sessionId, modeId, viewer.userId)
	if (!pipeline)
		return {
			ok: false,
			error: "no pipeline serves this session's mode, so there is nothing to configure"
		}

	const [config] = await db
		.select()
		.from(schema.pipelineConfigs)
		.where(eq(schema.pipelineConfigs.id, configId))
		.limit(1)
	if (!config) return { ok: false, error: "that preset no longer exists" }

	if (config.specId !== pipeline.specId)
		return {
			ok: false,
			error:
				`'${config.name}' belongs to a different pipeline. Presets are ` +
				`namespaced to the pipeline they were written for.`
		}

	if (config.enabled === false && viewer.isAdmin !== true)
		return {
			ok: false,
			error: `'${config.name}' is not available to choose.`
		}

	const { selectConfig } = await import("$lib/server/pipelines/config/named")
	await selectConfig(
		db,
		pipeline.specId,
		"session",
		sessionId,
		configId,
		viewer.userId ?? undefined
	)
	return { ok: true }
}
