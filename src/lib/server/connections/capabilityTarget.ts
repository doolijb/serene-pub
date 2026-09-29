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
 * Later wins, and **nothing else**. A connection that merely exists and happens
 * to be capable is not selected; neither is "the only one", nor "the first one
 * that can". Where no tier set anything, the run FAILS with a sentence naming
 * what to set and where — it does not guess.
 *
 * ## Amended 2026-09-15 — a session names no endpoint and no model
 *
 * > "the session-level connection override is retired. Overrides are always by
 * > model, never by connection."
 *
 * So the chain has two shapes rather than one, and they are the two halves this
 * resolver already walked independently:
 *
 *   - the **pair** — the `(endpoint, model)` a run is sent to — is walked over
 *     `PAIR_TIERS`: the capability default, then the pipeline configuration's
 *     connection slot. There is no third. The one connection override left in the
 *     product is that slot, and it stores both halves.
 *   - **sampling** is still walked over all three of `RESOLUTION_TIERS`, because
 *     `sessions.sampling_config_id` stays. A sampling profile is not a
 *     connection: choosing one says nothing about where the request goes, so it
 *     is the one thing a session may still say on its own.
 *
 * Which is why `WHERE_SET` below has two entries where `SCOPE_FOR_TIER` has
 * three. `WHERE_SET` answers "where was this PAIR set", and a session is not one
 * of the answers any more — so no refusal sentence here can send somebody to a
 * session's settings to fix a connection, where there is now nothing to fix it
 * with. The session tier is not merely ignored, either: `CapabilityTargetRequest`
 * has no field an endpoint could arrive in from a session, so the rule is the
 * request's shape rather than a check somebody has to remember.
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
 * `(connectionId, connectionModelId)`, and BOTH halves are required: a
 * connection has no default model, so a tier naming only an endpoint — with no
 * lower tier having chosen a model for that same endpoint — is an incomplete
 * selection, and resolution says so with the fix attached rather than guessing
 * a row.
 *
 * The two halves are NOT walked independently the way connection and sampling
 * are: a `connection_models` row belongs to one endpoint, so a model surviving a
 * higher tier's endpoint CHANGE would name a model of some other connection. The
 * model therefore comes from whichever tier won the connection, or from the tier
 * below when that tier re-states the same endpoint. See the walk.
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
import { connectionModelById, mergeEndpointModel } from "./models"
import { capabilityRefusal } from "$lib/server/pipelines/runtime/capabilityGuard"
import { connectionIdentity, type ConnectionIdentity } from "./visibility"

/**
 * What every legacy column, and every slot that named nothing, means.
 *
 * A slot authored before `requires` existed cannot say which capability it
 * holds. It resolves to this one, which is what it has always in fact been.
 * Named once here so the files that need it cannot spell it differently — a
 * second spelling of this fact is exactly the kind of drift that costs a
 * release.
 */
export const TEXT_CAPABILITY = "text->text"

/**
 * The chain, in INCREASING precedence. The last tier that named something wins.
 *
 * Ordered rather than named-and-compared, so adding a tier is one entry here and
 * one entry in `SCOPE_FOR_TIER` — and so the monotonicity test below has
 * something to walk.
 *
 * ⚠ This is the SAMPLING chain, and the full one. Only `PAIR_TIERS` may name an
 * endpoint and a model — see the header. `sessionOverride` is still a tier here
 * because a session may still choose a sampling profile; it is the tier the
 * `session` scope belongs to, and dropping it would leave `samplingVia` with no
 * name for the answer it gives most often.
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

/** A tier that may name an `(endpoint, model)` pair. A session may not (0130). */
export type PairTier = Exclude<ResolutionTier, "sessionOverride">

/**
 * The pair chain — `RESOLUTION_TIERS` minus the session, in the same order.
 *
 * Derived rather than written out, so a tier added above is in this walk from
 * the moment it exists unless it is deliberately excluded here. Two hand-kept
 * lists of the same precedence is the shape of the drift this file's header is
 * about, and the cost of it was a release.
 */
export const PAIR_TIERS = RESOLUTION_TIERS.filter(
	(tier): tier is PairTier => tier !== "sessionOverride"
)

/**
 * Each tier's equivalent in the executor's scope chain.
 *
 * The two models must not drift: this resolver decides for the flows that run
 * OUTSIDE the executor (the summarize steps, the graph builder, the legacy
 * generation path), while `world.ts` projects the same facts as `OverrideRow`s
 * for the flows that run inside it. If the two disagreed about precedence, a
 * person's pick would be honoured on one path and ignored on the other — which
 * is the exact failure `world.ts`'s own header calls out about having two
 * sources for one slot.
 *
 * `sessionOverride` maps to `session` because that is the scope
 * `sessions.sampling_config_id` is projected at, and the scope the pipeline
 * panel writes a person's own overrides at — even though a session cannot name
 * a pair.
 *
 * `user` is deliberately unmapped: a user cannot write a connection slot (F20),
 * and `config` rather than `instance` for the pipeline config because that is
 * what a named config IS in 12 §2 — a bundle you select, sitting under the
 * individual overrides.
 */
export const SCOPE_FOR_TIER: Record<ResolutionTier, ScopeKind> = {
	capabilityDefault: "defaults",
	pipelineConfig: "config",
	sessionOverride: "session"
}

/**
 * Where a person goes to change the PAIR this tier decided, in their words.
 *
 * Keyed by `PairTier`, which is what keeps the retirement honest: there is no
 * entry to write here for a session, so no sentence below can name one as a
 * place to set a connection. Before 0130 there was one, and it was the last
 * place in the product still claiming a session could choose compute.
 */
const WHERE_SET: Record<PairTier, string> = {
	capabilityDefault: "Admin → Defaults",
	pipelineConfig: "the pipeline's configuration"
}

/** One tier's answer. `null`/`undefined` both mean "this tier said nothing". */
export interface CapabilityCandidate {
	connectionId?: number | null
	/**
	 * WHICH MODEL on that endpoint. Absent is an INCOMPLETE selection, not a
	 * default: connections have no default model.
	 *
	 * ⚠ Read from the tier that won `connectionId`, never walked on its own. A
	 * model id is meaningless apart from the endpoint it belongs to, so a lower
	 * tier's model surviving a higher tier's endpoint CHANGE would produce a
	 * pair naming a model of some OTHER connection — an incoherent selection
	 * that no picker can display, and which the resolver would then have to
	 * refuse at run time for a choice nobody made. Where the endpoint does not
	 * change, both halves still name one connection and the lower tier's model
	 * stands. See the walk below.
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
 * thing a user ever sees. Every message names a SCREEN: a refusal that does not
 * say where to go reads as a silent failure rather than a rule for fixing it.
 */
export interface CapabilityProblem {
	kind: CapabilityProblemKind
	capability: string
	message: string
	/**
	 * Which tier produced the bad value. Absent for `unset`/`unknown`.
	 *
	 * A `PairTier`, because every problem here is a problem with the pair — a
	 * sampling id that resolves to nothing degrades to "send nothing" rather
	 * than becoming one of these.
	 */
	via?: PairTier
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
			connectionVia: PairTier
			samplingVia: ResolutionTier | null
	  }
	| { ok: false; problem: CapabilityProblem }

export interface CapabilityTargetRequest {
	/** A transform id — `text->text`, `text->image`, `text+image->text`. */
	capability: string
	/** Tier 2: what the pipeline's configuration selected for this node. */
	pipelineConfig?: CapabilityCandidate | null
	/**
	 * Tier 3, and SAMPLING ONLY — a `sampling_configs` id, or null.
	 *
	 * An id rather than a `CapabilityCandidate`, and that is the retirement
	 * (0130) written into the type: there is no field here for an endpoint or a
	 * model to arrive in, so a session cannot name compute even by mistake. It
	 * was a candidate until 2026-09-15, it outranked everything, and
	 * `sessions:update` handed it whatever the client sent.
	 */
	sessionSampling?: number | null
	/**
	 * The session's genre, when this request is for one turn of a session —
	 * wording only. `text->text`'s display name is "Chat" (the transform's
	 * generic label, `TRANSFORMS` in the SDK), which reads as if it named the
	 * session's own genre when the session is not `core:genre/chat` — an
	 * adventure or a guide session with no connection set would be told
	 * nothing is set "for Chat". Given here rather than resolved from a
	 * `sessionId`, because this module reads connections and sampling, never
	 * sessions or genres — the caller who already has the row hands over the
	 * one fact its wording needs.
	 */
	genreId?: string | null
}

/**
 * `core:genre/chat` (24 §3) — the one genre whose sessions this file may call
 * "Chat" without confusing it for the transform label above. A literal
 * rather than an import of `STANDARD_GENRE_ID`: that constant lives in
 * `pipelines/entities`, which imports connection resolution, not the other
 * way around.
 */
const STANDARD_CHAT_GENRE_ID = "core:genre/chat"

/**
 * The capability's display name for one refusal sentence — "Chat" (the
 * transform's own label), unless this request names a session whose genre is
 * not the standard one, in which case that would misname the session's own
 * genre and "text generation" says the same thing without the confusion.
 * Only `text->text` is ever "Chat"; every other capability's label already
 * names what it does (`Image generation`, `Vision`, …) and is left alone.
 */
const wordingLabelFor = (
	capability: string,
	req: Pick<CapabilityTargetRequest, "genreId">
): string =>
	capability === TEXT_CAPABILITY &&
	req.genreId != null &&
	req.genreId !== STANDARD_CHAT_GENRE_ID
		? "text generation"
		: capabilityLabel(capability as CapabilityId)

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
 *
 * The two chains do not even run to the same depth — the pair stops at
 * `PAIR_TIERS`, sampling goes on to the session — which is that independence
 * becoming a fact about the chains rather than a discipline about the loop.
 */
export async function resolveCapabilityTarget(
	db: Db,
	req: CapabilityTargetRequest
): Promise<CapabilityTargetResult> {
	const { capability } = req

	// Guarded here rather than trusted, because the value can arrive from a
	// node's `requires` — authored text, possibly from a plugin. A capability
	// that is not a transform keys nothing in `connection_defaults` (whose
	// primary key IS the transform's two sides), so it can never be satisfied
	// by any connection however capable, and the honest
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
		// Built HERE, from an id, rather than accepted as a candidate — so the
		// session tier has no pair half for the walk below to find (0130).
		sessionOverride:
			req.sessionSampling != null
				? { samplingConfigId: req.sessionSampling }
				: null
	}

	let connectionId: number | null = null
	let connectionModelId: number | null = null
	let connectionVia: PairTier | null = null
	let samplingConfigId: number | null = null
	let samplingVia: ResolutionTier | null = null
	// Increasing precedence, so the LAST tier that named something wins. Written
	// as walks over the constants rather than as `??` chains, so the order lives
	// in data one test can assert about instead of in an expression three files
	// have to spell identically.
	//
	// TWO walks over two chains, because the halves do not run to the same
	// depth. One loop with the session's pair half left permanently null would
	// do the same arithmetic and say something false while doing it:
	// that the tier is asked about a connection and merely never has one.
	for (const tier of PAIR_TIERS) {
		const at = byTier[tier]
		if (at?.connectionId != null) {
			// ⚠ The model is taken FROM THE SAME TIER, EXCEPT where this tier
			// re-states the endpoint the tier below it already chose.
			//
			// It is the one value here that is not walked independently, because
			// it is not independent: `connection_models` rows belong to one
			// endpoint, so carrying a lower tier's model past a higher tier's
			// endpoint CHANGE would build a pair whose two halves name different
			// connections. That pair cannot be displayed (no picker would find
			// the model under the endpoint it shows) and cannot be run (the
			// guard below refuses it).
			//
			// An endpoint that did not change raises none of that: both halves
			// still name the same connection. And re-stating it is what a great
			// deal of stored configuration does — the executor hands a node's
			// `connection` slot down as tier 2 even when nobody picked one (it
			// falls through to the instance default and forwards THAT id), every
			// slot value authored before the endpoint/model split is a bare
			// connection id, and the legacy per-config overrides in
			// `resolveTaskConfig` have an endpoint column and no model column at
			// all. Resetting on those would unconfigure a capability whose
			// default names a perfectly good pair, at the tier that agreed with
			// it — which is a refusal for a choice nobody made, the same failure
			// the reset exists to prevent.
			//
			// So: the model is cleared when the endpoint CHANGES, which is what
			// every picker does too ("choosing a different connection clears the
			// model, always"), and kept when it does not.
			const sameEndpoint = connectionId === at.connectionId
			connectionModelId =
				at.connectionModelId ??
				(sameEndpoint ? connectionModelId : null)
			connectionId = at.connectionId
			connectionVia = tier
		}
	}
	for (const tier of RESOLUTION_TIERS) {
		const at = byTier[tier]
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
							`No connection is set for ${wordingLabelFor(capability, req)}. ` +
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
	 * The MODEL half of the pair, resolved before anything judges the
	 * connection — because what a pair can DO is the model's answer layered over
	 * the endpoint's, and judging the bare endpoint would offer a vision slot a
	 * text-only checkpoint sitting behind a vision-capable host.
	 *
	 * Named model: it must exist, belong to THIS endpoint, and be switched on.
	 * All three are refusals rather than fallbacks.
	 *
	 * No model named: connections have no default model, so there is nothing
	 * to fall back to. An endpoint-only choice is incomplete, and the resolver
	 * says so with the fix attached rather than guessing a row.
	 */
	const model =
		connectionModelId == null
			? undefined
			: await connectionModelById(db, connectionModelId)

	if (connectionModelId == null) {
		return {
			ok: false,
			problem: {
				kind: "model",
				capability,
				via: connectionVia,
				connectionId,
				message:
					`No model is chosen for ${capabilityLabel(capability as CapabilityId)} in ` +
					`${WHERE_SET[connectionVia]}. Pick a model on that ` +
					`connection.`,
				connection: connectionIdentity(connection)
			}
		}
	}

	{
		// `missingSince` is the fourth refusal, and it is a refusal rather
		// than a warning on purpose: the host stopped listing the model, so a
		// request naming it would fail at the wire with the host's own
		// sentence — or, worse, be silently served by whatever the host
		// substitutes. Saying so here, with the fix, is the "unavailable
		// globally" half of the availability ruling.
		const wrong = !model
			? "no longer exists"
			: model.connectionId !== connectionId
				? "belongs to a different connection"
				: !model.enabled
					? "is switched off"
					: model.missingSince
						? "is no longer listed by its host"
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
						`${WHERE_SET[connectionVia]} ${wrong}. ` +
						(model?.missingSince
							? `Refresh that connection's models once the host serves it again, pick another model, or clear the choice.`
							: `Pick another model on that connection, or clear the choice.`),
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
