/**
 * Which connection a capability runs on — decided in exactly one place.
 *
 * ## The ruling this file is
 *
 * > "pipelines will not automatically choose a saved connection just because it
 * > exists. it needs to be set somewhere in the app for use."
 * >
 * > "capability default → pipeline config provider set connection → session
 * > override"
 *
 * Three tiers, later wins, and **nothing else**. A connection that merely exists
 * and happens to be capable is not selected; neither is "the only one", nor "the
 * first one that can". Where no tier set anything, the run FAILS with a sentence
 * naming what to set and where — it does not guess.
 *
 * ## Why this is a function and not a rule everyone follows
 *
 * It was a rule everyone followed, and there were eleven of them. `dispatchStep`
 * fell back to `system_settings.default_connection_id`; `dispatchImage` fell back
 * to `connection_defaults`; `resolveTaskConfig` fell back to the column again;
 * `connections:create` STARRED the first connection ever saved as `text->text`
 * regardless of what it could do, so an image-only first connection became the
 * chat default; `dispatch.ts` and `scenes.ts` each added a fourth tier of their
 * own (`?? defaultSampling`, `?? connection`) which was a no-op only for as long
 * as both sides happened to read the same column. Every one of those was a
 * defensible local decision and together they were not a chain at all.
 *
 * So: the chain is data (`RESOLUTION_TIERS`), the walk is one loop, and the five
 * refusals are five strings in one place. A caller supplies what its OWN tiers
 * said and gets back a row or a sentence.
 *
 * ## It returns a problem; it does not throw
 *
 * Callers key on their own error classes — `StepDispatchError`,
 * `ImageDispatchError`, `DispatchError` — and socket handlers return `fail()`
 * rather than throwing at all. A throwing resolver would need a mode flag or a
 * fail-factory handed in, and both are how a second copy of a sentence grows.
 * The `problem` carries the words; the caller carries the type.
 *
 * ## What it resolves is a PAIR, not a connection (0114)
 *
 * The endpoint/model split made "which connection" half an answer. A tier names
 * `(connectionId, connectionModelId)`, and where it names only the endpoint the
 * endpoint's default model is what it meant — which is what every registration
 * the 0114 backfill left behind says, so nothing that was configured before the
 * split resolves differently after it.
 *
 * The two halves are NOT walked independently the way connection and sampling
 * are: a `connection_models` row belongs to one endpoint, so a model surviving a
 * higher tier's endpoint change would name a model of some other connection. The
 * model therefore comes from whichever tier won the connection. See the walk.
 *
 * What comes back is the endpoint row with the model MERGED into it
 * (`mergeEndpointModel`), so `connection.model` is the identifier that will go
 * on the wire, `promptFormat` is the pair's template, and the capability column
 * is the model's layer over the endpoint's. Everything downstream — the guard,
 * the template dereference, the wire mode, the identity projection and all seven
 * adapters — kept working unchanged because what they are handed is still a row.
 *
 * ## ⚠ Nothing here may reach an adapter module
 *
 * Directly or transitively. `capabilityRefusal` reads the manifest (static
 * metadata) and the row's own cached capability set; the adapter modules stay
 * behind their lazy loaders because one of them cannot be PARSED on Android.
 * `adapters/importBoundary.test.ts` polices the rule. `connections/models.ts`
 * inherits the rule for the same reason — it is imported from here.
 */

import { eq } from "drizzle-orm"
import * as schema from "$lib/server/db/schema"
import {
	SCOPE_ORDER,
	capabilityLabel,
	isTransformId,
	type CapabilityId,
	type ScopeKind
} from "@serene-pub/sdk"
import { capabilityDefault } from "./capabilityDefaults"
import { withCompletionTemplate } from "./completionTemplates"
import { withWireMode } from "./resolve"
import {
	connectionModelById,
	defaultConnectionModel,
	mergeEndpointModel
} from "./models"
import { capabilityRefusal } from "$lib/server/pipelines/runtime/capabilityGuard"
import { connectionIdentity, type ConnectionIdentity } from "./visibility"

/**
 * What every legacy column, and every slot that named nothing, means.
 *
 * `sessions.connection_id` predates there being a second capability and cannot
 * say which one it holds; a slot authored before `requires` existed is in the
 * same position. Both resolve to this one, which is what they have always in
 * fact been. Named once here so the five files that need it cannot spell it
 * differently — the dropped `system_settings` columns were two spellings of one
 * fact and that is precisely what cost a release.
 */
export const TEXT_CAPABILITY = "text->text"

/**
 * The chain, in INCREASING precedence. The last tier that named something wins.
 *
 * Ordered rather than named-and-compared, so adding a tier is one entry here and
 * one entry in `SCOPE_FOR_TIER` — and so the monotonicity test below has
 * something to walk.
 *
 * ⚠ `capabilityDefault` is first and is read from the database by this module,
 * never passed in. That is the whole point of piece 1: the instance default has
 * ONE store (`connection_defaults`), so a caller cannot supply a different
 * reading of it, and the day somebody adds a second column there is no seam to
 * put it in.
 */
export const RESOLUTION_TIERS = [
	"capabilityDefault",
	"pipelineConfig",
	"sessionOverride"
] as const

export type ResolutionTier = (typeof RESOLUTION_TIERS)[number]

/**
 * Each tier's equivalent in the executor's scope chain.
 *
 * The two models must not drift: this resolver decides for the flows that run
 * OUTSIDE the executor (the summarize steps, the graph builder, the legacy
 * generation path), while `world.ts` projects the same three facts as
 * `OverrideRow`s for the flows that run inside it. If the two disagreed about
 * precedence, a person's pick would be honoured on one path and ignored on the
 * other — which is the exact failure `world.ts`'s own header calls out about
 * having two sources for one slot.
 *
 * `user` is deliberately unmapped: a user cannot write a connection slot (F20),
 * and `preset` rather than `instance` for the pipeline config because that is
 * what a named config IS in 12 §2 — a bundle you select, sitting under the
 * individual overrides.
 */
export const SCOPE_FOR_TIER: Record<ResolutionTier, ScopeKind> = {
	capabilityDefault: "defaults",
	pipelineConfig: "preset",
	sessionOverride: "session"
}

/** Where a person goes to change what this tier decided, in their words. */
const WHERE_SET: Record<ResolutionTier, string> = {
	capabilityDefault: "Admin → Defaults",
	pipelineConfig: "the pipeline's configuration",
	sessionOverride: "this session's settings"
}

/** One tier's answer. `null`/`undefined` both mean "this tier said nothing". */
export interface CapabilityCandidate {
	connectionId?: number | null
	/**
	 * WHICH MODEL on that endpoint (0114). Absent means "its default model".
	 *
	 * ⚠ Read ONLY from the tier that won `connectionId`, never walked on its
	 * own. A model id is meaningless apart from the endpoint it belongs to, so
	 * a lower tier's model surviving a higher tier's endpoint change would
	 * produce a pair naming a model of some OTHER connection — an incoherent
	 * selection that no picker can display, and which the resolver would then
	 * have to refuse at run time for a choice nobody made. See the walk below.
	 */
	connectionModelId?: number | null
	samplingConfigId?: number | null
}

export type CapabilityProblemKind =
	| "unknown"
	| "unset"
	| "cleared"
	| "missing"
	/**
	 * The endpoint resolved and the MODEL did not (0114) — deleted, switched
	 * off, or belonging to a different connection.
	 *
	 * Its own kind rather than folding into `missing`, because the two have
	 * different fixes: `missing` means choose another connection, this means the
	 * connection is fine and the model beside it is not.
	 *
	 * ⚠ It REFUSES rather than degrading to the endpoint's default model, which
	 * is the opposite of what a dangling sampling id does. A missing sampling
	 * config means "send nothing and let the backend decide", which is a working
	 * run; silently substituting a different MODEL is a run that succeeds
	 * against something the person did not pick — the panel showing one thing
	 * and the wire carrying another, which is the defect class this whole file
	 * exists to close.
	 */
	| "model"
	| "incapable"

/**
 * Why the run cannot start, in a sentence a person can act on.
 *
 * The `kind` is for tests and callers that want to branch; `message` is the only
 * thing a user ever sees. Every message names a SCREEN, because the failure this
 * whole change introduces is "it used to quietly use the connection I had" and a
 * refusal that does not say where to go reads as a regression rather than a rule.
 */
export interface CapabilityProblem {
	kind: CapabilityProblemKind
	capability: string
	message: string
	/** Which tier produced the bad value. Absent for `unset`/`unknown`. */
	via?: ResolutionTier
	/** The id that failed to resolve, for `missing`. */
	connectionId?: number
	/**
	 * Which connection the message is about — for `incapable`, the only kind
	 * where a row was actually found and judged.
	 *
	 * Beside the message rather than inside it. Every `message` above names no
	 * connection on purpose (see `capabilityRefusal`), because the strings travel
	 * through `Error.message` and `Receipt.haltReason` where nothing can redact
	 * them; this field travels through payloads, where `withoutConnectionIdentity`
	 * removes it for everyone who is not an administrator. `connectionId` above is
	 * on the same list and has always been removed the same way.
	 */
	connection?: ConnectionIdentity
}

export type CapabilityTargetResult =
	| {
			ok: true
			capability: string
			/**
			 * The PAIR: the endpoint row with its model merged in (0114), and
			 * WITH its completion template dereferenced, because this is the
			 * last place that can do it — an adapter has no database and
			 * `prompt_format` is only a key. See `AdapterConnection`.
			 */
			connection: AdapterConnection
			/**
			 * The ROW, or null. Null is not a failure: `resolveSampling(null)`
			 * means "send nothing and let the backend use its own defaults",
			 * which is a perfectly good answer and the one the seeded "Disabled"
			 * config expresses. The asymmetry with `connection` is the contract
			 * (`Sockets.CapabilityDefault`), not an oversight.
			 */
			sampling: SelectSamplingConfig | null
			connectionVia: ResolutionTier
			samplingVia: ResolutionTier | null
	  }
	| { ok: false; problem: CapabilityProblem }

export interface CapabilityTargetRequest {
	/** A transform id — `text->text`, `text->image`, `text+image->text`. */
	capability: string
	/** Tier 2: what the pipeline's configuration selected for this node. */
	pipelineConfig?: CapabilityCandidate | null
	/** Tier 3: what this session overrode it with. */
	sessionOverride?: CapabilityCandidate | null
}

/**
 * The reads this resolver makes, spelled per table rather than through one
 * `(db: { select: any }, table: any, id) => any` helper.
 *
 * That helper was the hole in miniature. `any` in, `any` out: `connection`
 * below was an `any` for the whole of the function — every field read off it,
 * everything handed to `capabilityRefusal`, `connectionIdentity` and
 * `withCompletionTemplate`, and `connection: AdapterConnection` on the result,
 * which was satisfied by construction rather than by checking. A column this
 * table does not have would have type-checked here and in the four modules
 * downstream. Two three-line reads cost less than that.
 *
 * Reads only; the resolver never writes.
 */
const connectionById = async (db: Db, id: number) =>
	(
		await db
			.select()
			.from(schema.connections)
			.where(eq(schema.connections.id, id))
			.limit(1)
	)[0]

const samplingConfigById = async (db: Db, id: number) =>
	(
		await db
			.select()
			.from(schema.samplingConfigs)
			.where(eq(schema.samplingConfigs.id, id))
			.limit(1)
	)[0]

/**
 * Resolve one capability to the connection and sampling config it runs on.
 *
 * The two halves are walked INDEPENDENTLY, which is why they are not one
 * lookup: a pipeline config that names a connection but no sampling profile
 * should keep the instance's sampling default rather than clearing it, and a
 * session that overrides only the sampling should not drag the connection along
 * with it. Collapsing them was how "set the connection here, the sampling
 * silently came from somewhere else" became unanswerable.
 */
export async function resolveCapabilityTarget(
	db: Db,
	req: CapabilityTargetRequest
): Promise<CapabilityTargetResult> {
	const { capability } = req

	// Guarded here rather than trusted, because the value can arrive from a
	// node's `requires` — authored text, possibly from a plugin. A capability
	// that is not a transform keys nothing in `connection_defaults` (whose
	// primary key IS the transform, as its two sides since 0183), so it can
	// never be satisfied by any connection however capable, and the honest
	// answer is to say so rather than to report "nothing is set" forever.
	//
	// It is also the guard that keeps `sidesOf` from being reached with a
	// feature id from this direction — it throws rather than splitting one into
	// an empty output side.
	if (!isTransformId(capability))
		return {
			ok: false,
			problem: {
				kind: "unknown",
				capability,
				message:
					`"${capability}" is not a capability this build recognises, so no default can ` +
					`be registered for it. Defaults are keyed by transform (for example ` +
					`"text->text" or "text->image") — check what the node declares it requires.`
			}
		}

	// THE one store. Read here rather than accepted as a parameter — see
	// RESOLUTION_TIERS.
	const registered = await capabilityDefault(db, capability)

	const byTier: Record<ResolutionTier, CapabilityCandidate | null> = {
		capabilityDefault: registered ?? null,
		pipelineConfig: req.pipelineConfig ?? null,
		sessionOverride: req.sessionOverride ?? null
	}

	let connectionId: number | null = null
	let connectionModelId: number | null = null
	let connectionVia: ResolutionTier | null = null
	let samplingConfigId: number | null = null
	let samplingVia: ResolutionTier | null = null
	// Increasing precedence, so the LAST tier that named something wins. Written
	// as a walk over the constant rather than as a `??` chain, so the order lives
	// in data one test can assert about instead of in an expression three files
	// have to spell identically.
	for (const tier of RESOLUTION_TIERS) {
		const at = byTier[tier]
		if (at?.connectionId != null) {
			connectionId = at.connectionId
			// ⚠ The model is taken FROM THE SAME TIER, and reset to null when
			// that tier named none. It is the one value here that is not walked
			// independently, because it is not independent: `connection_models`
			// rows belong to one endpoint, so carrying a lower tier's model past
			// a higher tier's endpoint change would build a pair whose two
			// halves name different connections. That pair cannot be displayed
			// (no picker would find the model under the endpoint it shows) and
			// cannot be run (the guard below refuses it), so it would turn a
			// perfectly ordinary "the pipeline overrides the default connection"
			// into a hard failure about a model nobody selected.
			//
			// Naming only the endpoint therefore means "its default model",
			// everywhere, at every tier — which is also what every row the 0114
			// backfill left behind says.
			connectionModelId = at.connectionModelId ?? null
			connectionVia = tier
		}
		if (at?.samplingConfigId != null) {
			samplingConfigId = at.samplingConfigId
			samplingVia = tier
		}
	}

	if (connectionId == null || connectionVia == null)
		return {
			ok: false,
			problem: registered
				? {
						kind: "cleared",
						capability,
						via: "capabilityDefault",
						// A row with a null `connection_id` is a different state
						// from no row at all, and the FK is one way to reach it:
						// `connection_defaults.connection_id` is ON DELETE SET
						// NULL, so deleting a connection releases every
						// capability it held rather than stranding a dangling id
						// (see the delete paths in sockets/connections.ts and
						// sockets/koboldcpp.ts, which rely on exactly this).
						//
						// ⚠ It is NOT the only way, which is why this sentence
						// says "deleting one releases..." rather than diagnosing
						// a deletion. `db/defaults.ts` seeds the shipped SAMPLING
						// default for `text->text` and `text->image` on every
						// boot while unset, and `setCapabilityDefault` inserts
						// the row when there is none — so both of those
						// capabilities reach this branch on a completely fresh
						// install where nothing was ever cleared. An earlier
						// draft asserted "most likely the connection it pointed
						// at was deleted" here, which would have been a confident
						// lie on first run.
						message:
							`No connection is set for ${capabilityLabel(capability as CapabilityId)}. ` +
							`Choose one in Admin → Defaults — a connection is never picked ` +
							`automatically, and deleting one releases every capability it held.`
					}
				: {
						kind: "unset",
						capability,
						message:
							`Nothing is set to handle ${capabilityLabel(capability as CapabilityId)}. ` +
							`A connection is never chosen just because it exists, even if it is the only ` +
							`one — register the default in Admin → Defaults, or select one in the ` +
							`pipeline's configuration.`
					}
		}

	const connection = await connectionById(db, connectionId)
	if (!connection)
		return {
			ok: false,
			problem: {
				kind: "missing",
				capability,
				via: connectionVia,
				connectionId,
				message:
					`The connection set for ${capabilityLabel(capability as CapabilityId)} in ` +
					`${WHERE_SET[connectionVia]} no longer exists. Choose another in Admin → Defaults.`
			}
		}

	/**
	 * The MODEL half of the pair (0114), resolved before anything judges the
	 * connection — because what a pair can DO is the model's answer layered over
	 * the endpoint's, and judging the bare endpoint would offer a vision slot a
	 * text-only checkpoint sitting behind a vision-capable host.
	 *
	 * Named model: it must exist, belong to THIS endpoint, and be switched on.
	 * All three are refusals rather than fallbacks — see the `model` problem
	 * kind for why substituting the default here would be the worst of the
	 * available answers.
	 *
	 * No model named: the endpoint's default. An endpoint with no models at all
	 * merges to itself, which is exactly the pre-0114 row, so an install that
	 * never filled in a model behaves the way it always did.
	 */
	const model =
		connectionModelId == null
			? await defaultConnectionModel(db, connectionId)
			: await connectionModelById(db, connectionModelId)

	if (connectionModelId != null) {
		const wrong = !model
			? "no longer exists"
			: model.connectionId !== connectionId
				? "belongs to a different connection"
				: !model.enabled
					? "is switched off"
					: null
		if (wrong)
			return {
				ok: false,
				problem: {
					kind: "model",
					capability,
					via: connectionVia,
					connectionId,
					message:
						`The model chosen for ${capabilityLabel(capability as CapabilityId)} in ` +
						`${WHERE_SET[connectionVia]} ${wrong}. Pick another model on that ` +
						`connection, or clear the choice to use its default model.`,
					// WHICH endpoint, for an administrator — the same key the
					// projection removes for everyone else. The sentence above
					// names neither the connection nor the model on purpose: it
					// travels through `Error.message` and `Receipt.haltReason`,
					// where nothing can redact it.
					connection: connectionIdentity(connection)
				}
			}
	}

	// THE MERGE. From here down, `pair` is a connection row in every respect
	// that matters — `model`, `promptFormat`, `tokenCounter`, `extraJson` and
	// the layered capability column are the MODEL's answers — which is why the
	// guard below, `withCompletionTemplate`, `withWireMode`, `connectionIdentity`
	// and all seven adapters read it without having moved a line.
	const pair = mergeEndpointModel(connection, model)

	// Asked BEFORE any adapter is loaded, so an image-only connection is refused
	// with a sentence naming the capability rather than by `getConnectionAdapter`
	// failing to find a text adapter for its type. `capabilityRefusal` judges a
	// connection somebody chose; it never selects one — see its header.
	//
	// Judged on the PAIR and not the endpoint: after 0114 "what can this do" is
	// a question about a model, and one host can serve a vision checkpoint and a
	// text-only one at the same base URL.
	const refusal = capabilityRefusal(pair, capability as CapabilityId)
	if (refusal)
		return {
			ok: false,
			problem: {
				kind: "incapable",
				capability,
				via: connectionVia,
				connectionId,
				// The guard's own words, plus where the choice was made. The
				// guard cannot know that: it is handed a row, not a chain.
				message: `${refusal} It is set in ${WHERE_SET[connectionVia]}.`,
				// WHICH row it was, for an administrator. The sentence above
				// deliberately does not say — this is where the fact goes
				// instead: a key the projection removes, rather than a name
				// no projection could find. Built from the PAIR, so the `model`
				// it carries is the one that would actually have been sent.
				connection: connectionIdentity(pair)
			}
		}

	const sampling =
		samplingConfigId == null
			? null
			: ((await samplingConfigById(db, samplingConfigId)) ?? null)

	return {
		ok: true,
		capability,
		/**
		 * The row, plus the `completion_templates` row its `prompt_format`
		 * names — see `AdapterConnection`.
		 *
		 * Attached here because this is where a connection destined for a run
		 * is LOADED, and the alternative was threading `db` into five adapter
		 * construction sites (two of which import none) to fetch one row an
		 * adapter cannot fetch for itself. `prompt_format` is a key, and a bare
		 * key resolves against the built-ins, so without this every
		 * admin-authored template stopped generation on the DEFAULT's markers —
		 * markers its own prompt does not contain, which does not error; it
		 * runs on.
		 *
		 * One indexed `SELECT` on a table with single-digit rows, once per
		 * resolution. Not cached, for the reason
		 * `connections/completionTemplates.ts` gives at length: a cache here
		 * would pin the template at first use, and an admin's save would appear
		 * to do nothing until a restart.
		 *
		 * And the WIRE MODE, from the same row and for the same reason: chat or
		 * completion is resolved from the connection's four capability layers,
		 * an adapter has no way to do that reading and no accessor on it may
		 * become async, and — the half that matters — it has to be the SAME value
		 * `config/world.ts` handed the render. Two independent answers to which
		 * shape a prompt takes is the whole of the defect this closes.
		 */
		connection: withWireMode(await withCompletionTemplate(db, pair)),
		// A dangling sampling id degrades to null rather than failing, for the
		// same reason an absent one does: no sampling means backend defaults,
		// which is a working run. A dangling CONNECTION id cannot degrade —
		// there is nothing to send to.
		sampling,
		connectionVia,
		samplingVia: sampling ? samplingVia : null
	}
}

/**
 * Does this instance have this capability at all?
 *
 * This settles a question that was open, and the answer is not the intuitive
 * one: it means **a default is registered for it**, NOT "some capable connection
 * exists". Under the no-implicit-pickup ruling those two came apart — an
 * instance can hold three connections that all draw and still have nothing that
 * will draw, because nobody said which one. A screen that answered from
 * capability rather than from registration would report the feature as available
 * and then fail on first use, which is the shape of the bug this whole change
 * removes.
 */
export async function capabilityIsSetUp(
	db: Db,
	capability: string
): Promise<boolean> {
	if (!isTransformId(capability)) return false
	const registered = await capabilityDefault(db, capability)
	return registered?.connectionId != null
}

/**
 * The scope-chain position of each tier, for anything projecting these onto
 * `OverrideRow`s. Exported so `world.ts` and this file cannot disagree about
 * which layer a tier is.
 */
export const scopeIndexForTier = (tier: ResolutionTier): number =>
	SCOPE_ORDER.indexOf(SCOPE_FOR_TIER[tier])
