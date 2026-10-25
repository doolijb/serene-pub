/**
 * 🚧 **Since PLAN-layering D7 (2026-10-20) a thin reader of the registrations
 * resolver** (`pipelines/registrations/resolve.ts`): a preset binds no
 * events — it changes the genre's defaults (R2) — and these names
 * answer from those rows. The preset's `bindings` / `config_selections`
 * columns are ⏳ kept unread until the RC1 squash. The note below is the
 * contract as it stood, and still the rule for the fallback.
 *
 * What the session's preset decided (24 §1) — read at run time, not only at
 * write time.
 *
 * A `session_presets` row is the bundle a person chose to start from: for each
 * of the genre's event slots, which pipeline answers and, optionally, with
 * which configuration. Until now that blob was validated on save and then
 * never read again: dispatch resolved the spec off the input lock alone and
 * the config off `resolveSelectedConfig`'s session → instance → shipped chain,
 * so a preset naming a second `message-respond` pipeline, or a tuned
 * configuration, changed nothing about the session it started. This module is
 * the reader that closes that gap, and it is deliberately the *only* one — two
 * places interpreting the same blob is how the picker and the run come to
 * disagree.
 *
 * ## Two questions, deliberately separate
 *
 * **Which spec answers this event** needs the event, so it is asked by the
 * dispatch seams (`resolveSessionEventSpec`, `resolveSubjectSpec`).
 *
 * **Which config that spec runs with** is asked by `resolveSelectedConfig`,
 * which is handed a spec and a session and no event at all — and must stay
 * that way, because it is also the answer for the open `session-action` slot,
 * where the preset curates *presence* through `includedActions` and names the
 * configuration through `configSelections` rather than through an event
 * binding. Keying the config lookup on the spec rather than the event is what
 * lets one rule serve both.
 *
 * ## A binding that no longer resolves falls back, out loud
 *
 * Ruled 2026-09-10: an upgrade or a plugin removal must never stop a session
 * working without an administrator's intervention. So read-time resolution
 * returns a **verdict** rather than throwing — the turn runs on the genre's
 * own answer for that event, which is what a session with no preset would have
 * run all along.
 *
 * The danger the verdict exists to close is the *quiet* substitution: a
 * pipeline the administrator did not choose taking the turn while every screen
 * keeps showing the one they did. That is the failure `selectConfig` refuses
 * for configs — "a selection that silently does nothing is the hardest kind of
 * configuration bug to see". Falling back does not create it; falling back
 * **silently** would. So the fallback is named in four places, and each is a
 * different reader: the run's receipt, the session banner, a persistent notice
 * on the preset, and the admin list.
 *
 * The **save** path stays strict. An administrator naming a pipeline that
 * cannot answer is a mistake to catch while they are looking at the form, not
 * a state to tolerate; `sessionPresets:update` refuses it exactly as before.
 *
 * A *config* that no longer resolves falls through the same way, matching
 * `resolveSelectedConfig`'s existing treatment of a stale selection: a config
 * id is an instance fact that a spec change can legitimately strand, and the
 * shipped default is a correct answer to "which values".
 */

import { asc, eq } from "drizzle-orm"
import { SAVE_MESSAGE_SPEC_ID, sessionEvents } from "@serene-pub/sdk"
import * as schema from "$lib/server/db/schema"
import {
	genreRegistrations,
	onEvent,
	presetRegistrations,
	unpublishedReason,
	type PresetFallback as RegistrationFallback
} from "$lib/server/pipelines/registrations/resolve"

/**
 * A preset binds an event to a pipeline that cannot answer it any more.
 *
 * The **save** path's refusal, and only the save path's: `sessionPresets:update`
 * will not store a binding that does not resolve, because an administrator
 * looking at the form is the cheapest possible place to catch it. Read time
 * answers with a verdict instead (see the module note) — a session must keep
 * working when a plugin leaves, and a throw there is the turn refusing.
 */
export class PresetBindingUnresolvableError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "PresetBindingUnresolvableError"
	}
}

type PresetRow = typeof schema.sessionPresets.$inferSelect

/**
 * A preset's binding for one event, evaluated.
 *
 * Three answers, and the callers must keep them apart:
 *
 * · `preset` — the administrator's choice resolves; run it.
 * · `none` — the session is on no preset, or its preset binds nothing here.
 *   The caller's own layers decide, exactly as before presets existed.
 * · `fallback` — the choice does not resolve, so `spec` is the genre's own
 *   answer for the event and everything else on the verdict is what must be
 *   said out loud about that substitution.
 *
 * `spec` is null on a `fallback` only when the genre has no answer either,
 * which is the ordinary "nothing serves" state rather than a second failure.
 */
export type PresetEventVerdict =
	| { via: "preset"; spec: string; preset: string; presetId: number }
	| { via: "none"; spec: null }
	| ({ via: "fallback"; spec: string | null } & PresetFallback)

/**
 * The substitution, in the shape every surface repeats it in — the
 * registrations resolver's (`PresetFallback` there), one shape for the
 * receipt, the session banner, the admin notice and the preset list.
 */
export type PresetFallback = RegistrationFallback

/**
 * The preset a session was born on, or null.
 *
 * Null covers three states that need no telling apart here: the session named
 * no preset, the session is gone, and the preset was deleted (which is
 * allowed — "sessions born from it keep running; they simply reference
 * nothing").
 */
export async function sessionPreset(
	db: Db,
	sessionId: number | null | undefined
): Promise<PresetRow | null> {
	if (sessionId == null) return null
	const [session] = await db
		.select({ presetId: schema.sessions.presetId })
		.from(schema.sessions)
		.where(eq(schema.sessions.id, sessionId))
		.limit(1)
	if (session?.presetId == null) return null
	const [preset] = await db
		.select()
		.from(schema.sessionPresets)
		.where(eq(schema.sessionPresets.id, session.presetId))
		.limit(1)
	return (preset as PresetRow | undefined) ?? null
}

/**
 * Does this version's inlet lock answer `event` (PLAN-turn-order §4.1)?
 *
 * Two spellings, one question: the ordinary one-event lock stores
 * `input_event`, and a lock over several stores `input_events` and leaves
 * the singular null. Asked in one place so read-time resolution and the
 * boot reconcile cannot come to disagree — the same reason
 * `presetBindingRefusal` exists.
 */
export function answersEvent(
	version: { inputEvent?: string | null; inputEvents?: string[] | null },
	event: string
): boolean {
	if (version.inputEvent === event) return true
	return Array.isArray(version.inputEvents)
		? version.inputEvents.includes(event)
		: false
}

/**
 * The one published spec whose active version declares (genre, event).
 *
 * The genre's own answer — what a session on no preset runs, and therefore what
 * a stale binding falls back to. It lives here rather than in `sessionEvents`
 * because the verdict below has to state it, and two copies of "which pipeline
 * does this genre use for this event" is how the fallback and the run come to
 * disagree about what the fallback was.
 *
 * ⚠ Filtered in memory rather than in SQL: the lock columns are nullable and
 * the active-version check compares two tables' columns, so the predicate is
 * cheaper to read here than as a join condition. Genres and specs are both
 * small, closed sets.
 *
 * ⚠ **Ordered by spec id**, for the reason `resolveSubjectSpec` states about
 * its own tie-break: more than one published spec can declare (genre,
 * `message-respond`), and an unordered SELECT makes "the first one" whatever
 * order the heap returns. Two installs with identical data would then name
 * different fallbacks, and only one of them would ever look wrong.
 */
export async function lockedEventSpec(
	db: Db,
	genreId: string,
	event: string
): Promise<string | null> {
	// 🚧 The genre's defaults (PLAN-layering D7): the first registration on
	// the event, in order (R24). The rows ARE the old locks for a package
	// genre that declares no defaults (derived once, `genreDefaults.ts`).
	const own = onEvent(await genreRegistrations(db, genreId), event)[0]
	if (own) return own.pipeline
	// ⏳ A package spec still locked to a genre whose defaults have not been
	// projected yet (a boot that has not reached the projection).
	const rows = await db
		.select({
			slug: schema.pipelineSpecs.slug,
			activeVersionId: schema.pipelineSpecs.activeVersionId,
			versionId: schema.pipelineSpecVersions.id,
			status: schema.pipelineSpecVersions.status,
			inputGenre: schema.pipelineSpecVersions.inputGenre,
			inputEvent: schema.pipelineSpecVersions.inputEvent,
			inputEvents: schema.pipelineSpecVersions.inputEvents
		})
		.from(schema.pipelineSpecs)
		.innerJoin(
			schema.pipelineSpecVersions,
			eq(schema.pipelineSpecVersions.specId, schema.pipelineSpecs.id)
		)
		.orderBy(asc(schema.pipelineSpecs.id))
	const hit = (rows as any[]).find(
		(r) =>
			r.activeVersionId === r.versionId &&
			r.status === "published" &&
			r.inputGenre === genreId &&
			answersEvent(r, event)
	)
	return (hit?.slug as string | undefined) ?? null
}

/**
 * 🚧 Is this core's default save on `message-offered` (owner ruling
 * 2026-10-15)? `core:spec/save-message` declares no lock — it serves every
 * genre, as the built-ins do — so a binding to it is never judged by the lock
 * columns, and a genre whose preset binds nothing there still saves through
 * it (`defaultEventSpec`). Read from the SDK's constants, never a literal.
 */
export const isDefaultSave = (event: string, slug: string): boolean =>
	event === sessionEvents.messageOffered && slug === SAVE_MESSAGE_SPEC_ID

/**
 * 🚧 The spec an event falls to when nothing the session, its preset or the
 * genre's lock names answers it: core's default save for `message-offered`,
 * else null. The one default there is — the stored preset already shows it
 * (`preset()` writes it in, the boot backfill writes it into older rows), so
 * this answers only a session on no preset.
 */
export const defaultEventSpec = (event: string): string | null =>
	event === sessionEvents.messageOffered ? SAVE_MESSAGE_SPEC_ID : null

/**
 * Why a bound slug does not answer (genre, event), or null when it does.
 *
 * The predicate, in one place: read-time resolution and the boot reconcile ask
 * the same question about the same blob, and a second copy would let a session
 * fall back over something the admin screen called healthy.
 */
export async function bindingRefusal(
	db: Db,
	opts: { genreId: string; event: string; slug: string }
): Promise<string | null> {
	const rows = await db
		.select({
			slug: schema.pipelineSpecs.slug,
			activeVersionId: schema.pipelineSpecs.activeVersionId,
			versionId: schema.pipelineSpecVersions.id,
			status: schema.pipelineSpecVersions.status,
			inputGenre: schema.pipelineSpecVersions.inputGenre,
			inputEvent: schema.pipelineSpecVersions.inputEvent,
			inputEvents: schema.pipelineSpecVersions.inputEvents
		})
		.from(schema.pipelineSpecs)
		.innerJoin(
			schema.pipelineSpecVersions,
			eq(schema.pipelineSpecVersions.specId, schema.pipelineSpecs.id)
		)
		.where(eq(schema.pipelineSpecs.slug, opts.slug))
	const hit = (rows as any[]).find(
		(r) => r.activeVersionId === r.versionId && r.status === "published"
	)
	if (!hit) return unpublishedReason(opts.slug)
	// 🚧 Core's default save (owner ruling 2026-10-15) has no lock: like the
	// built-ins it serves every genre, on `message-offered` only.
	if (isDefaultSave(opts.event, opts.slug)) return null
	// 🚧 A pipeline mounted by registrations has no lock (D3): what it may
	// answer is fit, the registration door's (lane 5b). ⏳ A spec still
	// locked is judged by its lock, as before.
	if (!hit.inputGenre) return null
	if (hit.inputGenre !== opts.genreId || !answersEvent(hit, opts.event))
		return (
			`'${opts.slug}' now answers '${hit.inputEvent ?? "nothing"}' for ` +
			`'${hit.inputGenre ?? "no genre"}', not '${opts.event}' of '${opts.genreId}' (24 §4).`
		)
	return null
}

/**
 * One preset row's verdict for one event — the reconcile's door onto the same
 * predicate the run uses, without a session to read the preset from.
 */
export async function presetBindingVerdict(
	db: Db,
	preset: PresetRow,
	genreId: string,
	event: string
): Promise<PresetEventVerdict> {
	void genreId
	const resolved = await presetRegistrations(db, preset.id)
	if (!resolved) return { via: "none", spec: null }
	const fallback = resolved.fallbacks.find((f) => f.event === event)
	if (fallback)
		return {
			via: "fallback",
			// The layer below's answer — the genre's defaults on this event.
			// Null here is "nothing serves", not a second failure.
			spec: onEvent(resolved.offered, event)[0]?.pipeline ?? null,
			...fallback
		}
	// The preset decided this event when its own rows touch a registration
	// on it — registered, changed or dropped one there.
	const touched = new Set(resolved.rows.preset.map((r) => r.key))
	const onIt = onEvent(resolved.offered, event)
	const genreOnIt = onEvent(resolved.defaults, event)
	if (onIt.some((r) => touched.has(r.key)) || genreOnIt.some((r) => touched.has(r.key)))
		return onIt[0]
			? { via: "preset", spec: onIt[0].pipeline, preset: preset.name, presetId: preset.id }
			: { via: "none", spec: null }
	return { via: "none", spec: null }
}

/**
 * What the session's preset decided about this event.
 *
 * Never throws. A binding that stopped resolving comes back as a `fallback`
 * verdict carrying the genre's own answer and everything a surface needs to
 * name the substitution — see the module note for why that is the ruling.
 */
export async function presetEventSpec(
	db: Db,
	opts: {
		sessionId: number | null | undefined
		genreId: string
		event: string
	}
): Promise<PresetEventVerdict> {
	const preset = await sessionPreset(db, opts.sessionId)
	if (!preset) return { via: "none", spec: null }
	return await presetBindingVerdict(db, preset, opts.genreId, opts.event)
}

/**
 * ⏳ Which config the session's preset names for this spec — **always null**
 * since configurations retired (R38, PLAN-layering D5): a preset's choices
 * are its registrations' `values` now, read by `config/world.ts`. Kept so a
 * caller still asking compiles until the RC1 squash.
 */
export async function presetConfigForSpec(
	_db: Db,
	_opts: { sessionId: number | null | undefined; specSlug: string }
): Promise<number | null> {
	return null
}
