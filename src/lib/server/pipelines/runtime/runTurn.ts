/**
 * One session turn, run as a pipeline.
 *
 * This is the entry point the app calls instead of constructing a
 * `PromptBuilder` and an adapter: load the published spec, build the config
 * world and the host, run, hand back the receipt.
 *
 * **It does not replace anything by itself.** The legacy path is still what
 * `generateResponse.ts` runs; this exists so the switch is a small, deliberate
 * change at one call site rather than a rewrite of the generation path. The
 * parity corpus is what makes that switch safe to make — until it was green,
 * a function like this was a second implementation with a nicer name.
 *
 * ## Streaming
 *
 * Tokens reach the user through the host's `sink`, not through the pipeline's
 * values. A socket handle is not a value: it would land in the receipt and in
 * every downstream node's input. The port still carries the finished text, so
 * the run is complete and replayable while the user watched it arrive.
 */

import { run, type NodeEvent, type Receipt } from "@serene-pub/sdk"
import { createReviewer } from "$lib/server/pipelines/runtime/reviewGate"
import { createHost, type HostScope } from "$lib/server/pipelines/runtime/host"
import { buildWorld } from "$lib/server/pipelines/config/world"
import { coreBindings } from "$lib/server/pipelines/runtime/bindings"
import { pluginNodeBindings } from "$lib/server/pipelines/runtime/pluginBindings"
import {
	loadPublished,
	RESPOND_SPEC_ID
} from "$lib/server/pipelines/boot/bootstrap"
import {
	saveReceipt,
	type RunArtifact
} from "$lib/server/pipelines/runtime/receipts"
import {
	connectionStopsFor,
	makeScriptApplier,
	scriptExtras,
	scriptsEnabledFor
} from "$lib/server/pipelines/scripts/chains"
import { genreFieldsFor } from "$lib/server/pipelines/entities/sessionGenres"
// Imported for `tokenizerFor`, and for the eight loaders that module registers
// with the SDK as it evaluates. Both halves matter: the id below means nothing
// without a loader behind it, and importing the resolver is what guarantees the
// registration cannot be tree-shaken out from under it.
import { tokenizerFor } from "$lib/server/pipelines/runtime/tokenizers"
import { pluginsEnabled } from "$lib/server/plugins/flag"
import { getManager } from "$lib/server/plugins"
import { makePluginHookDispatch } from "$lib/server/plugins/hookDispatch"
import type { PluginHookDispatch } from "$lib/server/pipelines/scripts/pluginDispatch"
import { v4 as uuidv4 } from "uuid"

export class PipelineUnavailableError extends Error {}

// db is the global Db — see db/types.d.ts

export interface TurnRequest {
	db: Db
	sessionId: number
	userId: number
	/** Whose turn it is. Null in narrator mode. */
	currentCharacterId: number | null
	/**
	 * The side character speaking this turn, when one was named (ruling
	 * 2026-09-07) — see `SpecRunRequest.speaker`.
	 */
	speaker?: SpecRunRequest["speaker"]
	/** A message being composed but not stored — see `HostScope.draftMessage`. */
	draftMessage?: { content: string; personaId?: number | null }
	/** The message that triggered this turn. */
	text: string
	/**
	 * Text an in-progress reply has already produced — a **continue** (ruling
	 * 2026-09-08, D-2).
	 *
	 * Absent on every other turn. It travels to the input node's
	 * `continuationPrefill` port and from there, on `core:spec/respond`, to
	 * `core:task/process-messages@1`, which puts it in the seed line the model
	 * writes from. Nothing else reads it.
	 *
	 * ⚠ It is **not** `text`, and the two must not be conflated. A continue
	 * re-retrieves as a full run: the triggering text is whatever an ordinary
	 * turn's would be, the row carrying this partial is excluded from every
	 * message read while it generates, and only the prompt sees it — where it
	 * counts against the budget like anything else in the prompt.
	 */
	continuationPrefill?: string
	/**
	 * Rows this turn is producing that the caller already knows about.
	 *
	 * ⚠ The reply path's message row is created by the **trigger**, before the
	 * run: the pipeline compiles the prompt and the adapter fills the row in, so
	 * no Consumer ever commits and the host records nothing. Seeding the
	 * collector here is what gives a real reply an artifact — and, through that,
	 * what stops the run being recorded as a preview. See `saveReceipt`.
	 *
	 * Everything the run writes *itself* is appended by the host as it goes;
	 * this is only the head start.
	 */
	artifacts?: RunArtifact[]
	/** Which spec to run. Defaults to core's. */
	specId?: string
	/**
	 * The seed for anything that varies.
	 *
	 * **Defaults to a fresh value per turn, not to something derived from the
	 * session.** It first defaulted to `turn:${sessionId}`, which is constant for the
	 * life of a session — so every turn would have picked the same example dialogue
	 * and the variety the seeding exists to preserve would have been quietly
	 * gone. The seed is recorded on the run row, so a caller reproducing a turn
	 * passes the recorded one back rather than reconstructing it.
	 */
	seed?: string
	/**
	 * This run's identity.
	 *
	 * Generated per run unless supplied. The SDK defaults it to the literal
	 * `"run:test"` when a host does not pass one, which is a reasonable default
	 * for a test and a trap for a host: every run would share an id, and the
	 * unique index on the receipt table is what caught it.
	 */
	runId?: string
	/** See `SpecRunRequest.overrides` — the comparison tool, and nothing else. */
	overrides?: SpecRunRequest["overrides"]
	/** Where streamed tokens go while the model is still generating. */
	sink?: HostScope["sink"]
	signal?: AbortSignal
	/** The same stop in the executor's shape — see `SpecRunRequest`. */
	cancelSignal?: () => { by: string; reason: string } | undefined
	/** Stop before the provider call and report what *would* be sent. */
	preview?: boolean
	/**
	 * Skip recording the receipt.
	 *
	 * For the comparison tool, which runs a preview against every session on the
	 * instance and would otherwise fill the run history with rows nobody asked
	 * for. A real turn always records.
	 */
	skipReceipt?: boolean
}

/**
 * Any published spec, run against this session — the entry every trigger shares.
 *
 * `runTurn` shapes the input for a session reply; the summarize and graph-build
 * sockets shape theirs. What none of them get to vary is the substrate: the
 * same world, the same host, the same bindings, the same receipt rule —
 * because two entry points that assembled those differently would be two
 * pipelines wearing one name.
 */
export interface SpecRunRequest {
	db: Db
	sessionId: number
	userId: number
	/** Which spec to run. */
	specId: string
	/**
	 * Whose turn it is, when the spec has one. Null or absent in narrator mode
	 * and for specs with no speaker at all (summarize, graph build).
	 *
	 * Reaches the provider through `HostScope`, because the stop list has to
	 * exclude the speaking character's own name — see the note there.
	 */
	currentCharacterId?: number | null
	/** A message being composed but not stored — see `HostScope.draftMessage`. */
	draftMessage?: { content: string; personaId?: number | null }
	/**
	 * Who is speaking this turn when they are **not a cast member** — the
	 * side-character trigger's first step (ruling 2026-09-07).
	 *
	 * ⚠ **participant ≠ character.** This is a fact about one turn, not a
	 * membership: nothing anywhere writes a `session_characters` row from it,
	 * and the round-robin never sees it — the rotation reads stored messages
	 * and drops narration rows before matching a character id, so exclusion is
	 * a property of the row this turn writes rather than a rule stated here.
	 *
	 * `characterId` is null for a free-form name, which is the whole point of
	 * the free-form case: a full participant for that turn with no row behind
	 * them. `known` is the new-name fact — whether the session's lorebook has
	 * heard of them — resolved once, before the run, and handed to the script
	 * hook as a declared extra rather than recomputed per link.
	 */
	speaker?: {
		name: string
		characterId: number | null
		known: boolean
		/** The card, when the pick was a real character. */
		character?: Record<string, unknown> | null
	} | null
	/** The input node's value, shaped by the caller for the spec it names. */
	input: unknown
	/**
	 * Rows this run is producing that the caller already knows about — see
	 * `TurnRequest.artifacts`. A run whose Consumer writes its own rows leaves
	 * this unset; the host records those as they are written.
	 */
	artifacts?: RunArtifact[]
	seed?: string
	runId?: string
	sink?: HostScope["sink"]
	/**
	 * Node lifecycle observation — the executor's inherent progress (F34).
	 * Fires for every invocation with identity and never a payload, so any
	 * surface can drive a progress card without knowing the pipeline.
	 */
	onNode?: (event: NodeEvent) => void
	signal?: AbortSignal
	/**
	 * The same stop, in the shape the executor speaks (13 §3).
	 *
	 * `signal` reaches the *bindings*, which can listen for an event mid-call.
	 * The executor never listens — it only pauses between nodes — so it polls
	 * this instead, and a returned `{by, reason}` ends the run as `cancelled`
	 * with the actor on the receipt. Both are projections of one
	 * `AbortController`; see `runRegistry.cancellation`, which builds this.
	 *
	 * Absent, the run walks to the end whatever happens to `signal` — a node
	 * whose adapter was aborted but which returns rather than throwing takes
	 * the next node with it.
	 */
	cancelSignal?: () => { by: string; reason: string } | undefined
	/**
	 * Stop before a node and report what *would* happen there. `true` stops at
	 * the first Provider on the spine (debug preview); `{atNode}` stops at a
	 * named node — which is how a generate-and-review flow runs everything
	 * *except* its write, and hands the result to a person instead.
	 */
	preview?: boolean | { atNode: string }
	skipReceipt?: boolean
	/**
	 * Node parameters forced on top of everything the world resolved.
	 *
	 * For the A/B prompt-diff tool (`pipelines/measure/promptDiff.ts`), which
	 * runs one real session twice under two configurations and diffs what
	 * reached the model. It has to run **this** function rather than assembling
	 * its own world and calling `run()` — a comparison against a different
	 * substrate (no scripts, no plugin nodes, no tokenizer, no reviewer) would
	 * be a diff of two things neither of which ships.
	 *
	 * ⚠ **They win, and they have to.** Applied at `session` scope — the top of
	 * `SCOPE_ORDER` — with any existing row at the same address removed first,
	 * because `resolveConfigSources` takes the *first* candidate it finds at a
	 * scope and a stored session override would otherwise silently beat the
	 * value the tool was asked to measure. A measurement that can be overruled
	 * by the thing it is measuring against is worse than no measurement.
	 *
	 * `slot` defaults to `params`, which is where every retrieval and ranking
	 * control lives. Nothing else may set this: it is not reachable from a
	 * socket, a route or a trigger, and it must not become a fourth
	 * user-editable scope — that chain was deliberately narrowed (plan §3,
	 * phase 5).
	 */
	overrides?: Array<{
		nodeKey: string
		slot?: string
		path: string
		value: unknown
	}>
}

/**
 * Force a run's node parameters, ahead of every stored scope.
 *
 * Separate from `buildWorld` deliberately: the world is *what this install is
 * configured to do*, and this is a caller saying "run it as if it were
 * configured differently, without changing anything". Nothing is written.
 */
function forceOverrides(
	world: Awaited<ReturnType<typeof buildWorld>>,
	overrides: SpecRunRequest["overrides"],
	sessionId: number
): void {
	for (const o of overrides ?? []) {
		const slot = o.slot ?? "params"
		// Removed rather than shadowed — see the note on `overrides` above.
		for (let i = world.overrides.length - 1; i >= 0; i--) {
			const row = world.overrides[i]!
			if (
				row.nodeKey === o.nodeKey &&
				row.slot === slot &&
				row.path === o.path
			)
				world.overrides.splice(i, 1)
		}
		world.overrides.push({
			nodeKey: o.nodeKey,
			slot,
			path: o.path,
			value: o.value,
			scopeKind: "session",
			scopeId: sessionId
		})
	}
}

export async function runSpec(request: SpecRunRequest): Promise<Receipt> {
	const { specId } = request
	const loaded = await loadPublished(request.db, specId)
	if (!loaded)
		throw new PipelineUnavailableError(
			`no published version of '${specId}'. Core publishes its own at startup, so ` +
				`this usually means the type registry refused to sync — check the server log ` +
				`for a pipeline bootstrap warning.`
		)

	// Scope node rebinds (19 §5): a session that swapped its next-speaker
	// strategy — or any future node-type swap — lands here, on the freshly
	// loaded copy, shape-guarded so a stale row degrades to the pin. The
	// receipt then names the substituted type with no extra bookkeeping.
	const { applyNodeRebinds } = await import(
		"$lib/server/pipelines/entities/bindings"
	)
	const doc = await applyNodeRebinds(request.db, loaded, {
		specSlug: specId,
		sessionId: request.sessionId
	})

	// The same run id the executor stamps below, hoisted so a plugin link's
	// invocation-log row soft-links to the run that fired it — and so the host
	// scope built just below can name the run its effects belong to.
	const runId = request.runId ?? uuidv4()
	// Who is running it, in the form every hook-facing call takes. Hoisted
	// beside the run id because the three consumers below — plugin nodes, the
	// script applier, and the rendering bindings — must name the same person.
	const user = request.userId != null ? String(request.userId) : undefined

	/**
	 * What this run leaves behind, collected as it happens.
	 *
	 * Seeded with whatever the caller already owns (the reply path's message
	 * row), then appended to by every host commit that writes — and by
	 * `dispatchImage`, which is the only place a rendered file's row id exists.
	 * `saveReceipt` turns it into `pipeline_run_artifacts` rows and derives
	 * `is_preview` from whether it stayed empty.
	 *
	 * A fresh array rather than the caller's, so a caller reusing a request
	 * object across runs does not accumulate the previous run's output.
	 */
	const artifacts: RunArtifact[] = [...(request.artifacts ?? [])]

	const scope: HostScope = {
		// Everything the host does outside the graph is attributed to this run:
		// the progress an image render reports back to the person watching, and
		// the run a prompts-slot template renders under. This is the one place
		// holding both the run and the host wiring, the same reason
		// `coreBindings` is handed the run rather than reading it off `ctx`.
		runId,
		sessionId: request.sessionId,
		userId: request.userId,
		currentCharacterId: request.currentCharacterId,
		draftMessage: request.draftMessage,
		artifacts,
		sink: request.sink,
		signal: request.signal
	}

	// Hoisted so the run and the script applier share one seed — a script's
	// rolls are a function of the run seed and the link's address (18 §6), and
	// two seeds would make "replay with the recorded seed" a half-truth.
	const seed = request.seed ?? uuidv4()

	// The kill switch (18 §10): off means the host supplies no engine at all,
	// and the executor's seam makes that mean "every spec runs exactly as
	// before scripts existed" — chains and attachments kept, waiting.
	const scriptsOn = await scriptsEnabledFor(request.db)

	// The extension-hook executor. Behind the same seam as core scripts and
	// gated three ways: chains must be on at all, the plugin subsystem must be
	// enabled (dark by default in 0.6), and startup must have finished so a
	// link never stalls a turn on the ready-gate. When any is false, plugin
	// links are absorbed as skips and the pipeline is untouched.
	let pluginDispatch: PluginHookDispatch | undefined
	// A plugin's *nodes* on the spine (20 §9) — same gates as its chain
	// links: subsystem on, startup finished. Empty when dark, so the spread
	// below is a no-op and core specs run exactly as before.
	let pluginNodes: Awaited<ReturnType<typeof pluginNodeBindings>> = {}
	if (scriptsOn && pluginsEnabled()) {
		const manager = getManager()
		if (manager.isReady()) {
			pluginDispatch = makePluginHookDispatch(request.db, manager)
			pluginNodes = await pluginNodeBindings(request.db, manager, {
				seed,
				nowMs: Date.now(),
				runId,
				user
			})
		}
	}

	const world = await buildWorld(request.db, {
		sessionId: request.sessionId,
		// Which pipeline is running, so its own configs and overrides are
		// read. Without it the run resolves against the legacy projection
		// only, and everything a person set in the pipeline panel is
		// invisible to the thing it was supposed to configure.
		specId
	})
	// A no-op on every path but the comparison tool's, which is the only caller
	// that supplies any. In memory, on this run's copy of the world — nothing
	// is written and the next turn resolves exactly as it would have.
	forceOverrides(world, request.overrides, request.sessionId)

	const receipt = await run(doc, {
		world,
		input: request.input,
		runId,
		seed,
		triggerSource: request.preview ? "ui" : "event",
		preview: request.preview,
		// Core's bindings, with a plugin's process-transport nodes beside
		// them — a collision is impossible by construction (namespaced ids,
		// core: reserved at registration).
		// The run travels into core's bindings for one reason: a context
		// template or a variable layout can name a *plugin's* template engine,
		// and that render is a sandboxed hook call. Without the run id on it,
		// cancelling this run stops the executor between nodes and leaves the
		// render going — the SDK's `TaskCtx` carries no run id for a binding to
		// read, so this is where the association has to be made.
		bindings: { ...coreBindings({ runId, user }), ...pluginNodes },
		host: createHost(request.db, scope),
		// The script engine, behind the executor's seam (18 §4a). Chains are
		// config, so which ones run is already decided by the world above;
		// this is only *how* a link executes — sandboxed, seeded, recorded.
		...(scriptsOn
			? {
					applyScripts: makeScriptApplier(request.db, {
						seed,
						nowMs: Date.now(),
						// The speaker rides in beside the cast names: the
						// side-character hook declares `speakerName`,
						// `speakerCharacterId` and `speakerIsKnown` as extras,
						// and a declared extra a host never supplies is a
						// control with no effect wearing a contract.
						extras: await scriptExtras(request.db, {
							...scope,
							speaker: request.speaker ?? null
						}),
						// The connection's own stop guards ride along (18 §4b):
						// resolved by the same rule dispatch uses — the instance
						// default — so every spec running against that endpoint
						// inherits its model knowledge.
						connectionStops: await connectionStopsFor(request.db),
						// The extension-hook executor and the identity a plugin
						// link's invocation record carries. Undefined here means
						// the applier runs core scripts exactly as before.
						pluginDispatch,
						runId,
						user
					})
				}
			: {}),
		onNode: request.onNode,
		cancelSignal: request.cancelSignal,
		// The connection's `tokenCounter` column, reaching the thing it was
		// always supposed to configure. An id rather than a function: the SDK
		// loads it once before the run and counts synchronously afterwards, so
		// the allocation loop stays a loop. An id nobody can load degrades to the
		// rough estimate and says so on the receipt — a tokenizer never fails a
		// turn.
		tokenizer: await tokenizerFor(request.db, request.sessionId),
		// Every run can park at a gated node — the review position is a
		// config option (`settings.review`), so whether it *does* is the
		// person's to decide in the panel, never the trigger's to wire.
		reviewer: createReviewer({
			userId: request.userId,
			sessionId: request.sessionId,
			specId,
			signal: request.signal
		})
	})

	// Recorded before returning, and never allowed to fail the turn. A run that
	// produced a good reply and then could not write its own receipt has still
	// produced a good reply.
	if (!request.skipReceipt)
		await saveReceipt(request.db, receipt, {
			sessionId: request.sessionId,
			userId: request.userId,
			/**
			 * What the caller named, then everything the run actually wrote,
			 * in the order it wrote it.
			 *
			 * One list rather than a precedence rule between two sources: a run
			 * can legitimately do both — write into a row the trigger created
			 * *and* create rows of its own — and the old "the Consumer's id
			 * wins, else the caller's" could only ever record one of them.
			 */
			artifacts
		})

	return receipt
}

/**
 * Run a turn and return its receipt.
 *
 * The receipt is the return value rather than the generated text, and that is
 * deliberate: a caller needs to know *whether* it ran, what it decided, and what
 * it wrote, and a turn that halted legibly is a normal outcome rather than an
 * exception. Text is on the receipt for callers that only want that.
 */
export async function runTurn(request: TurnRequest): Promise<Receipt> {
	return await runSpec({
		db: request.db,
		sessionId: request.sessionId,
		userId: request.userId,
		specId: request.specId ?? RESPOND_SPEC_ID,
		currentCharacterId: request.currentCharacterId,
		draftMessage: request.draftMessage,
		speaker: request.speaker ?? null,
		artifacts: request.artifacts,
		input: {
			text: request.text,
			/**
			 * The continue verb's one value (ruling 2026-09-08, D-2). Empty on
			 * every other turn — the port resolves, the seed line renders
			 * empty, and the model starts the reply as it always did. Specs
			 * whose input type declares no such port never resolve it.
			 */
			continuationPrefill: request.continuationPrefill ?? "",
			// The side-character trigger's first step, on the input node's own
			// port — so the receipt answers "why did this turn sound like
			// Vell" afterwards rather than only the trigger knowing. Null on
			// every other pipeline, whose input types declare no such port and
			// therefore never resolve it.
			speaker: request.speaker ?? null,
			// Both as ports and bundled. A query that wants the pair takes the
			// scope; a node that wants only the speaker takes the id, instead
			// of accepting the whole scope and reaching into it.
			sessionId: request.sessionId,
			characterId: request.currentCharacterId ?? null,
			// The speaker rides on the session scope: a scope for a turn is this
			// session *and* whose turn it is.
			sessionScope: {
				sessionId: request.sessionId,
				currentCharacterId: request.currentCharacterId
			},
			// The mode's declared fields, supplied back (19 §1): session settings
			// wrote them to the row; this is where they enter the run, filtered
			// to the shape's declared keys — see genreFieldsFor.
			fields: await genreFieldsFor(request.db, request.sessionId)
		},
		seed: request.seed,
		runId: request.runId,
		sink: request.sink,
		signal: request.signal,
		cancelSignal: request.cancelSignal,
		preview: request.preview,
		skipReceipt: request.skipReceipt,
		overrides: request.overrides
	})
}

/** The text a completed turn produced, or null if it did not produce one. */
export function generatedText(receipt: Receipt): string | null {
	const node = receipt.nodes.find(
		(n) => n.typeId === "core:provider/generate-text@1"
	)
	const text = (node?.output as { text?: unknown } | null | undefined)?.text
	return typeof text === "string" && text.length > 0 ? text : null
}

/**
 * Why a turn produced nothing, in a sentence a user could be shown.
 *
 * A halt is not a failure — an aborted generation and an empty completion both
 * halt — so this reads the receipt rather than assuming an error. Returns null
 * when the run finished normally.
 */
export function haltExplanation(receipt: Receipt): string | null {
	if (receipt.outcome === "ok") return null
	const at = receipt.haltNodeKey
	const why = receipt.haltReason ?? "the run stopped without saying why"
	return at ? `${why} (at '${at}')` : why
}
