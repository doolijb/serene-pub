/**
 * The host's `call`: every model, media and tool request a node makes
 * (`core:oracle/*`, and the summarize and graph steps through one
 * dispatcher), each tied to the node's clock (`callTether`).
 */

import type { MediaRef, NodeRef, CallHandles, RunFacts } from "@serene-pub/sdk"
import type { ToolDeclaration } from "$lib/server/adapters/actions"
import { streamingModeFrom } from "$lib/server/connections/streaming"
import { tether } from "$lib/server/pipelines/runtime/callTether"
import {
	type HostScope,
	HostScopeError,
	type CoreHostServices
} from "./host.types"
import {
	STEP_TYPES,
	TOOL_HOOK_TIMEOUT_MS,
	workflowSlotValues,
	refId,
	connectionDescriptorModelId,
	stepUserPrompt,
	tryJson,
	assertScoped,
	embeddingApi
} from "./host.helpers"
import type { ToolContext } from "$lib/server/pipelines/runtime/tools"
import { castWrite } from "./sessionCastWrites"

/**
 * What `hostCall` is handed beside the executor's own arguments: the host's
 * database, scope and self, and the filing tools' doors.
 */
interface HostCallArgs {
	db: Db
	scope: HostScope
	host: CoreHostServices
	toolDoors: (
		toolNode: NodeRef,
		sessionId: number
	) => Required<Pick<ToolContext, "fileLore" | "forgetLore" | "makeImage">>
}

export async function hostCall(
	{ db, scope, host, toolDoors }: HostCallArgs,
	payload: unknown,
	node: NodeRef,
	run: RunFacts,
	handles?: CallHandles
): Promise<unknown> {
	const p = (payload ?? {}) as Record<string, any>
	/**
	 * The node's clock, tied to the request below (`callTether`): the
	 * dispatch aborts on the run's cancel or the node's own timeout,
	 * and the request's signs of life keep an idle node's window open.
	 */
	const line = tether(handles, scope.signal)

	// The loadout chain this model call resolved through (I12), onto the
	// request the receipt holds — *Extraction (merged) → Reply
	// (unfilled fallback)*. Said by `buildWorld`, never recomputed here.
	const loadoutChain = scope.loadoutChains?.[node.key]
	if (loadoutChain && payload && typeof payload === "object")
		(payload as Record<string, unknown>).loadout = loadoutChain

	switch (node.definitionId) {
		case "core:oracle/embed-text": {
			// The embedding call is a Provider because it reaches a model
			// (16 §1) — a Query may not. Splitting it out also means the
			// run's budget and receipt see the embedding call, which they
			// would not if retrieval quietly made it.
			const { embed, batchEmbed, isModelReady } =
				await embeddingApi()
			if (!isModelReady())
				throw new Error(
					"no embedding model is loaded and validated, so text cannot be embedded"
				)

			const texts: string[] = Array.isArray(p.texts)
				? p.texts.filter((t: unknown) => typeof t === "string")
				: p.text !== undefined && p.text !== null
					? [String(p.text)]
					: []

			// **No texts means no vectors**, not one vector of an empty
			// string. A session on its first turn has no "recent" window,
			// so this is a normal state rather than an edge case — and
			// the previous shape embedded `undefined`, which crashed
			// inside the model wrapper and surfaced as a provider error
			// on a perfectly healthy session.
			if (texts.length === 0) return { vectors: [], vector: null }

			const vectors =
				texts.length > 1
					? await batchEmbed(texts)
					: [await embed(texts[0]!)]
			return { vectors, vector: vectors[0] }
		}

		case "core:oracle/pick-sprite": {
			/**
			 * The sprite picker's two effects (DESIGN-sprites §5.2):
			 * what the speaker can show, and the vectors to choose
			 * with. The binding decides who is speaking and does the
			 * arithmetic; this reads and embeds, and nothing else.
			 *
			 * ⚠ The line's text arrives on the payload, wired from the
			 * step that wrote it — never re-read from the row (owner,
			 * 2026-10-05). The run's own row is named only to leave it
			 * out of the speaker's recent faces.
			 *
			 * The set is decided in `spriteChoicesFor` — the spec's
			 * `set`, then the override, the amendment, the default
			 * (the seated cast member's own sets when it has any,
			 * else the card's) — and `decidedBy` rides out on the
			 * receipt.
			 */
			const sessionId = p.sessionId ?? scope.sessionId
			assertScoped(node, p.sessionId, scope.sessionId)
			if (sessionId === undefined)
				throw new HostScopeError(
					`${node.key} has no session to choose a sprite in — wire 'scope' from the inlet.`
				)
			// 🚧 A card-less seat's speaker arrives as `castMemberId` (a
			// member id), never as `characterId` (a card id): exactly one.
			const castMemberId =
				p.castMemberId != null ? Number(p.castMemberId) : undefined
			const characterId =
				castMemberId === undefined ? Number(p.characterId) : undefined
			const { spriteChoicesFor } = await import(
				"$lib/server/sprites/choices"
			)
			const choices = await spriteChoicesFor(db, {
				sessionId,
				...(castMemberId !== undefined
					? { castMemberId }
					: { characterId }),
				set: p.set,
				excludeMessageId:
					typeof run.liveRow === "number" ? run.liveRow : undefined
			})
			if (choices.labels.length === 0)
				return { choices, lineVector: null, labelVectors: null }
			// Through the install's active embedding connection — the
			// star, by policy: the picker has no connection slot, as
			// `embed-text` has none. ⚠ With an embedding service that
			// is a provider call, one per reply whose speaker has
			// sprites; a speaker without sprites never reaches here.
			// Label vectors are cached per model (`sprites/vectors.ts`).
			const { spriteVectors } = await import(
				"$lib/server/sprites/vectors"
			)
			const { getLoadedModelId, batchEmbed } = await embeddingApi()
			const text = typeof p.text === "string" ? p.text : ""
			const vectors = await spriteVectors(text, choices.labels, {
				modelId: getLoadedModelId(),
				batchEmbed
			})
			return { choices, ...vectors }
		}

		/**
		 * 🚧 Transcribe audio (O9): the files the binding found the
		 * reply cannot hear, heard by the Transcription loadout's
		 * model (the step's own slot, else the `audio->text`
		 * default) and cached on each file. Never a failure of the
		 * reply — `transcribeFiles` answers in notes.
		 */
		case "core:oracle/transcribe-audio": {
			const files = Array.isArray(p.files)
				? (p.files as Array<{ uuid: string; mime?: string; filename?: string }>)
				: []
			if (!files.length) return { transcripts: {}, notes: [] }
			const { transcribeFiles } = await import(
				"$lib/server/attachments/transcribe"
			)
			return await line.hold(() =>
				transcribeFiles(db, {
					files,
					connectionId: refId(p.connection),
					connectionModelId: connectionDescriptorModelId(p.connection),
					language: typeof p.language === "string" ? p.language : undefined,
					sessionId: scope.sessionId,
					userId: scope.userId ?? undefined,
					signal: line.signal
				})
			)
		}

		/**
		 * All three generate nodes, through one dispatcher (20 §9).
		 *
		 * `generate-with-tools` is `generate-text` with a `tools`
		 * in-port and a `toolCall` out-port; `generate-json` is the same
		 * request asking for a shape instead of a turn. Both are
		 * separate pins only because the first is published and frozen.
		 * Three cases would be three copies of a fifty-line forward,
		 * which is how they would come to differ about a stop sequence.
		 */
		case "core:oracle/generate-json":
		case "core:oracle/generate-with-tools":
		case "core:oracle/generate-text": {
			/**
			 * The generation itself, through the existing adapters.
			 *
			 * This is the point of the whole split: the prompt was built by
			 * Tasks that anyone can inspect, and this sends it. Note what
			 * the binding does *not* get back — no connection, no URL, no
			 * key, no headers. See `dispatch.ts` for why that line is not
			 * negotiable rather than merely tidy.
			 */
			const { dispatchGeneration } = await import(
				"$lib/server/pipelines/runtime/dispatch"
			)
			if (scope.sessionId === undefined)
				throw new HostScopeError(
					`${node.key} has no session to generate in — the run was started without a session scope`
				)

			/**
			 * Streaming is run-level (R-21 (2)). The executor says
			 * which row this run is filling; core decides whether THIS
			 * oracle's stream is the reply's prose (declared — `streamingSteps`)
			 * and routes it there. The binding asked for text and gets
			 * text — it never learns there was a row.
			 *
			 * The live row is also what the queue's stage lands on and
			 * what the client's Stop cancels by, so the queue item is
			 * put on it before the call is enqueued — a very fast Stop
			 * must never find a generating row with nothing to cancel.
			 */
			const liveRow =
				typeof run.liveRow === "number"
					? run.liveRow
					: undefined
			// The reply's phase, off the same split as its text: the
			// status reads *{speaker} is reasoning* while the trace
			// streams and goes back to the node's own (*is typing*) at
			// the first body token (`StatusRelay.reasoning`).
			const stream = scope.live?.attach(run.liveRow, node.key, {
				onPhase: (phase) =>
					scope.status?.reasoning(phase === "reasoning")
			})
			const queueItemId =
				liveRow !== undefined && scope.live
					? await scope.live.claim(liveRow)
					: undefined

			let result: Awaited<ReturnType<typeof dispatchGeneration>>
			try {
				const sessionId = scope.sessionId
				result = await line.hold(() => dispatchGeneration({
					compiledPrompt: p.compiledPrompt,
					db,
					sessionId,
					userId: scope.userId,
					// The payload's value when a caller supplied one,
					// otherwise the run's. Neither is authoritative alone:
					// a dispatch-only caller knows the speaker, and a spec
					// has no port to put it on.
					currentCharacterId:
						p.currentCharacterId ??
						scope.currentCharacterId ??
						null,
					// 🚧 A card-less seat's speaker, only when no card speaks.
					currentCastMemberId:
						(p.currentCharacterId ??
							scope.currentCharacterId ??
							null) === null
							? (scope.currentCastMemberId ?? null)
							: null,
					generatingMessageMetadata:
						p.generatingMessageMetadata ?? {},
					// The `attachments` in-port: media REFERENCES, in the
					// order they are to be sent. `dispatch` turns them into
					// bytes — checking each one against this run's session
					// and user on the way, the same rule `mediaParts` above
					// applies to media posted into a message.
					attachments: Array.isArray(p.attachments)
						? (p.attachments as unknown[] as MediaRef[])
						: undefined,
					// Tier 2 — this node's own slots, exactly as the
					// `generate-image` sibling below already forwards them.
					// Omitting them was why the panel's Connection and
					// Sampling pickers on the reply step did nothing.
					connectionId: refId(p.connection),
					// The MODEL half of the same slot (0114), off the
					// resolved descriptor. A slot authored before the split
					// names none, and that resolves as unconfigured through
					// the tiers below — so nothing stored needs migrating
					// and nothing already configured changes.
					connectionModelId: connectionDescriptorModelId(
						p.connection
					),
					samplingId: refId(p.sampling),
					// 🚧 O6/O7: what the step asks the model to write, and
					// the speech sampling's values when that is audio.
					outputs: Array.isArray(p.outputs)
						? (p.outputs as unknown[]).filter(
								(k): k is string => typeof k === "string"
							)
						: undefined,
					speechSampling:
						p.speechSampling && typeof p.speechSampling === "object"
							? (p.speechSampling as Record<string, unknown>)
							: null,
					// The author's own stop sequences, off the node's
					// `params` slot (ruling 2026-09-10). Forwarded, never
					// interpreted: the dispatch composes them together with
					// the connection's completion template and the scene's
					// speaker labels, and applies the wire rule once.
					stopSequences: Array.isArray(p.stopSequences)
						? (p.stopSequences as string[])
						: undefined,
					// The author's send shape, off the same `params` slot.
					// Forwarded, never interpreted: which wire `auto`
					// resolves to needs the connection, and the connection
					// is resolved one layer down.
					streaming: streamingModeFrom(p.streaming),
					// The `tools` in-port — `advertise-tools`' `native`
					// door, forwarded verbatim. Empty on `generate-text`,
					// which declares no such port, so that node's requests
					// are byte-identical to what they always were.
					tools: Array.isArray(p.tools)
						? (p.tools as ToolDeclaration[])
						: undefined,
					/**
					 * The structured-output ask — `generate-json`'s and
					 * nobody else's.
					 *
					 * Forwarded as a REQUEST, never as an answer: which
					 * door it actually goes out through needs the
					 * connection, and the connection is resolved one layer
					 * down. Absent on the other two pins, so their requests
					 * are byte-identical to what they always were.
					 */
					structured:
						node.definitionId === "core:oracle/generate-json"
							? { schema: p.schema ?? undefined }
							: undefined,
					// Every chunk, body or reasoning, is a sign of life
					// for the node's idle clock (`callTether`).
					onChunk: (chunk) => {
						line.pulse()
						stream?.onChunk(chunk)
						scope.sink?.onChunk?.(chunk)
					},
					onReasoning: (chunk) => {
						line.pulse()
						stream?.onReasoning(chunk)
						scope.sink?.onReasoning?.(chunk)
					},
					onReplyFacts: (facts) => stream?.onReplyFacts(facts),
					// The run's cancel OR the node's own timeout: a node
					// that timed out must not leave the request running.
					signal: line.signal,
					/**
					 * Through the LLM queue — one model call at a time
					 * across the application, the same lane every other
					 * generating step takes (`dispatchStep`,
					 * `runQueuedLLMCall`). The queue's status reaches
					 * the run's status relay (R-19), which says
					 * *waiting for the model* / *loading the model* on
					 * the live row while the call waits its turn or a
					 * managed backend loads, and restores the node's
					 * own status (*typing*) once it generates.
					 */
					queue: {
						// What the row this run fills IS — narration
						// or a character's turn — read off the live
						// row, which learned it from the placeholder's
						// commit. The payload's metadata is the
						// fallback for a dispatch-only caller with no
						// row: the narrate specs never set it, so
						// reading it first filed every narrator call
						// as `session`.
						taskType: (scope.live?.narration ??
						p.generatingMessageMetadata?.isNarratorResponse)
							? "narratorPrompt"
							: "session",
						sessionId: scope.sessionId,
						messageId: liveRow,
						userId: scope.userId,
						queueItemId,
						// Waiting its turn and a model loading are the
						// node's honest wait, not a stall: each change
						// pulses, and `hold` keeps beating between them.
						onStatusChange: (status) => {
							line.pulse()
							scope.status?.queue(status)
						}
					}
				}))
			} catch (err) {
				// The object, for the row's error write at the end of
				// the run — the executor keeps only the message, and
				// the redaction rule needs the class. See `LiveRow`.
				scope.live?.failedWith(err)
				throw err
			}
			// The stream has drained: whatever the throttle held back
			// lands now, before the port value moves on to the write.
			if (stream) await scope.live?.flush()
			// 🚧 O5: media the model wrote — a spoken reply's audio —
			// stored as files with their provenance (run, step,
			// model), handed on as references in the model's order.
			if (result.media?.length) {
				const { storeGeneratedMedia } = await import(
					"$lib/server/media/generatedMedia"
				)
				const refs = await storeGeneratedMedia(db, result.media, {
					userId: scope.userId ?? null,
					sessionId: scope.sessionId ?? null,
					runId: scope.runId ?? null,
					step: node.key
				})
				// Recorded as the run's files where a write shows them
				// (`create-message` / `update-message` `parts`).
				return { ...result, media: refs }
			}
			return result
		}

		/**
		 * 🚧 Describe image (D1): one instruction and the pictures, to
		 * the job that reads pictures — in a session or out of one (a
		 * card action). `describeImage` explains the request.
		 */
		case "core:oracle/describe-image": {
			const { describeImage } = await import(
				"$lib/server/pipelines/runtime/describeImage"
			)
			return await line.hold(() =>
				describeImage(db, {
					payload: p,
					sessionId: scope.sessionId,
					userId: scope.userId,
					characterId: scope.cardCharacterId,
					signal: line.signal,
					onChunk: () => line.pulse()
				})
			)
		}

		case "core:oracle/generate-image": {
			/**
			 * The render, through the image adapters.
			 *
			 * Same line as generate-text: the binding hands over the ids
			 * its slots resolved to and gets media REFERENCES back — never
			 * the connection, never its key, and never the bytes.
			 * `dispatchImage` explains why the bytes stop there.
			 */
			const { dispatchImage } = await import(
				"$lib/server/pipelines/runtime/dispatchImage"
			)
			// The picture's params (DESIGN-image-generation §4.1), read
			// off the `params` slot only: `references` is ALSO an in-port
			// name, and the port is the images, the param the policy.
			const imageParams = (p.params ?? {}) as Record<string, unknown>
			const oneOf = <T extends string>(v: unknown, of: readonly T[]) =>
				of.includes(v as T) ? (v as T) : null
			// A render pulses like a reply: on every progress report
			// and on the in-flight beat (`callTether`).
			return await line.hold(() => dispatchImage(db, {
				series: Array.isArray(p.series) ? p.series : null,
				references: Array.isArray(p.references)
					? p.references
					: null,
				init: p.init ?? null,
				mask: p.mask ?? null,
				orientation: oneOf(imageParams.orientation, [
					"free",
					"square",
					"portrait",
					"landscape"
				] as const),
				cutOut: oneOf(imageParams.cutOut, [
					"off",
					"native-or-task",
					"native-only"
				] as const),
				referencesPolicy: oneOf(imageParams.references, [
					"preferred",
					"required"
				] as const),
				// 🚧 One seed for the whole step (I5).
				seedPolicy: oneOf(imageParams.seed, [
					"as-set",
					"per-run"
				] as const),
				// The call plan, onto the request the receipt already
				// holds (the executor records the payload before this
				// call), BEFORE the first adapter call — so a render
				// that fails still says what it meant to do.
				onPlan: (plan) => {
					if (payload && typeof payload === "object")
						(payload as Record<string, unknown>).callPlan = plan
				},
				prompt: String(p.prompt ?? ""),
				negative:
					p.negative === undefined || p.negative === null
						? undefined
						: String(p.negative),
				prompts: p.prompts ?? null,
				connectionId: refId(p.connection),
				connectionModelId: connectionDescriptorModelId(
					p.connection
				),
				samplingId: refId(p.sampling),
				// The `workflow` slot (§4.10): `{ id }`, or the panel's
				// stored `{ "": { id } }`; null = none chosen.
				workflowId: refId(
					p.workflow && typeof p.workflow === "object" && "" in p.workflow
						? (p.workflow as Record<string, unknown>)[""]
						: p.workflow
				),
				// The loadout's dials, riding on the slot's `{ id, values }`
				// (lane E2; `applyLoadoutLayer`).
				workflowValues: workflowSlotValues(p.workflow),
				sessionId: scope.sessionId ?? null,
				userId: scope.userId ?? null,
				// The run, for the prompts-slot render. Inert while that
				// slot renders in core's engine and load-bearing the
				// moment it names a plugin's — see `dispatchImage`'s
				// `render`.
				runId: scope.runId,
				// The run's artifact collector, handed down because the
				// `files` and `variants` ids only exist inside
				// `createMedia` — a Provider that writes rows publishes
				// media REFERENCES on its port, so there is nothing on
				// the receipt for the run to be reconstructed from.
				artifacts: scope.artifacts,
				nodeKey: node.key,
				signal: line.signal,
				// The author's send shape. On a render `off` is what
				// stops the progress poll and the previews, so it is
				// read where `onProgress` is decided rather than here.
				streaming: streamingModeFrom(p.streaming),
				// Forwarded only when somebody is listening AND the run
				// can be named. The first half is so an adapter that can
				// report progress does not pay to compute it for a run
				// nobody is watching (a background trigger, a test); the
				// second is because `runId` is what a client keys its
				// progress card on and what Cancel sends back, so an
				// event carrying one that identifies nothing opens a card
				// nobody can clear and nobody can stop. Never stamp `""`
				// here: the listening socket overwrites it with its own
				// id, which hides the hole.
				onProgress:
					scope.sink?.onProgress && scope.runId
						? (e) => {
								line.pulse()
								scope.sink!.onProgress!({
									runId: scope.runId!,
									nodeKey: node.key,
									...e
								})
							}
						: undefined
			}))
		}

		/**
		 * 🚧 Speak (speech build, seam S3): a line's speech cues in, one
		 * stored audio file out. Like generate-image the binding hands
		 * over ids and gets a media REFERENCE back — never the
		 * connection, never its key, never bytes. The connection the
		 * line was spoken on rides on the REQUEST (`speakPlan`), not on
		 * a port: plugins are blind to connections (R53).
		 *
		 * `streaming` is accepted and treated as off (A5). A failure
		 * throws a `SpeechDispatchError`; the binding turns it into
		 * "nothing spoken" so a delivered reply is never failed by its
		 * read-aloud.
		 */
		case "core:oracle/speak": {
			const { dispatchSpeech } = await import(
				"$lib/server/pipelines/runtime/dispatchSpeech"
			)
			const speakParams = (p.params ?? {}) as Record<string, unknown>
			return await line.hold(() =>
				dispatchSpeech(db, {
					cues: Array.isArray(p.cues) ? p.cues : null,
					text: typeof p.text === "string" ? p.text : null,
					speaker:
						typeof p.speaker === "string" && p.speaker.trim()
							? p.speaker
							: null,
					language:
						typeof p.language === "string" && p.language.trim()
							? p.language
							: null,
					template: p.template ?? null,
					prompts: p.prompts ?? null,
					variables: p.variables ?? null,
					connectionId: refId(p.connection),
					connectionModelId: connectionDescriptorModelId(p.connection),
					samplingId: refId(p.sampling),
					gapMs:
						typeof speakParams.gapMs === "number" ? speakParams.gapMs : null,
					streaming: speakParams.streaming,
					sessionId: scope.sessionId ?? null,
					userId: scope.userId ?? null,
					runId: scope.runId,
					nodeKey: node.key,
					artifacts: scope.artifacts,
					signal: line.signal,
					// The plan, onto the request the receipt already holds,
					// before the first call: a speak that fails still says
					// which connection and voices it meant to use.
					onPlan: (plan) => {
						if (payload && typeof payload === "object")
							(payload as Record<string, unknown>).speakPlan = plan
					}
				})
			)
		}

		case "core:oracle/run-tool": {
			/**
			 * The one node that runs a tool (20 §9).
			 *
			 * Behind `call` rather than `read` because a tool is not a
			 * read: the canonical one is an extension's sandboxed hook,
			 * which may reach the network under its own grants, and the
			 * outward calls of a run all live behind this seam.
			 *
			 * ⚠ **A failing tool returns, it does not throw.** The model
			 * asked for something; "there is no such entry" is an answer
			 * it can act on, and a throw would end the turn at the one
			 * moment the agent could have recovered. Only an internal
			 * fault — a bug in this host — escapes, and `run-tool`'s
			 * binding turns even that into a result the loop can carry.
			 */
			const name = String(p.tool ?? "")
			const args =
				p.args &&
				typeof p.args === "object" &&
				!Array.isArray(p.args)
					? (p.args as Record<string, unknown>)
					: {}

			const { resolveTool } = await import(
				"$lib/server/pipelines/runtime/tools/resolve"
			)
			const provider = await resolveTool(db, name)
			{
				// Advertisement and dispatch agree: a web tool a session may not
				// call is refused here too, by name, as a result the model reads.
				const { WEB_TOOL_NAMES, webToolsAllowed } = await import(
					"$lib/server/pipelines/runtime/tools/webTools"
				)
				if (WEB_TOOL_NAMES.has(name) && !(await webToolsAllowed(db, scope.sessionId)))
					return {
						tool: name,
						error: `${name} is not available in this kind of session.`
					}
				// 🚧 The filing tools (lane 2): only what the session switched on.
				const { WRITE_TOOL_NAMES, writeToolsAllowed } = await import(
					"$lib/server/pipelines/runtime/tools/writeTools"
				)
				if (WRITE_TOOL_NAMES.has(name) && !(await writeToolsAllowed(db, scope.sessionId)).has(name))
					return {
						tool: name,
						error: `${name} is not switched on in this session.`
					}
			}
			if (!provider)
				return {
					tool: name,
					error: `there is no tool called '${name}'.`
				}

			try {
				if (provider.kind === "core") {
					const { ToolError } = await import(
						"$lib/server/pipelines/runtime/tools"
					)
					try {
						const result = await provider.tool.run(args, {
							// The host's own read, handed to the tool:
							// one enumerated seam, so a tool inherits
							// the hidden-message convention and the
							// character-lore privacy gate without
							// knowing they exist. `node` travels with
							// it so a scoping refusal names the node
							// that asked.
							// `read` is optional on `HostServices` —
							// a host may implement none, and a tool
							// asking one of those sees an empty
							// session rather than a crash. The same
							// shape the executor uses for the same
							// reason.
							read: async (
								table: any,
								query?: unknown
							) =>
								host.read
									? await host.read(
											table,
											query,
											node
										)
									: [],
							sessionId: scope.sessionId,
							currentCharacterId:
								scope.currentCharacterId ?? null,
							// The run's cancel or the node's timeout.
							signal: line.signal,
							// The state tools' one door. Granted only
							// where there is a session to propose
							// against; absent, they refuse by name.
							propose: scope.sessionId
								? async (change: unknown) => {
										const { proposeChange } =
											await import(
												"$lib/server/state/write"
											)
										return await castWrite(() =>
											proposeChange(
												db,
												{
													sessionId:
														scope.sessionId!,
													updatedBy: `run:${scope.runId ?? "unknown"}`
												},
												change as never
											)
										)
									}
								: undefined,
							// 🚧 The filing tools' doors (lane 2, `writeTools.ts`).
							...(scope.sessionId !== undefined
								? toolDoors(node, scope.sessionId)
								: {})
						})
						return { tool: name, result }
					} catch (e) {
						if (e instanceof ToolError)
							return { tool: name, error: e.message }
						throw e
					}
				}

				/**
				 * An extension's tool, through the hook dispatch that
				 * already exists — permissions, deadline, seeded RNG and
				 * the invocation log all apply because none of them is
				 * reimplemented here.
				 *
				 * The seed label carries the tool name and the run, so
				 * two calls to one tool in a single loop roll
				 * differently and a replay with the recorded seed rolls
				 * the same. Dark when the plugin subsystem is off, which
				 * is where `toolProviders` finds no enabled rows at all
				 * — so this branch is unreachable rather than guarded
				 * twice.
				 */
				const { pluginsEnabled } = await import(
					"$lib/server/plugins/flag"
				)
				const { getManager } = await import(
					"$lib/server/plugins"
				)
				if (!pluginsEnabled())
					return {
						tool: name,
						error: `'${name}' is provided by an extension, and extensions are switched off on this pub.`
					}
				const manager = getManager()
				const r = await manager.callHook(
					provider.binding.pluginId,
					provider.binding.hook,
					{ input: { tool: name, args } },
					{
						// A tool is the oracle's own reach outward,
						// delegated: storage and fetch (R-3).
						kind: "oracle",
						timeoutMs: TOOL_HOOK_TIMEOUT_MS,
						seedLabel: `${scope.runId ?? "run"}:tool:${name}`,
						user:
							scope.userId != null
								? String(scope.userId)
								: undefined,
						frameCause: scope.frameCause,
						runId: scope.runId,
						// A tool called from another package's pipeline —
						// or a person's — runs with only the secrets its
						// owner lends (R63).
						foreignPipeline: provider.binding.pluginId !== scope.ownerPluginId
					}
				)
				return r.ok
					? { tool: name, result: r.value }
					: {
							tool: name,
							error:
								r.reason ??
								`the extension providing '${name}' could not answer.`
						}
			} catch (e) {
				// The internal fault. Reported as a result rather than
				// thrown for the same reason the tool's own failure is:
				// a loop that ends on a host bug loses the whole turn,
				// and the receipt records this node's output either way.
				return {
					tool: name,
					error: `'${name}' failed: ${(e as Error).message}`
				}
			}
		}

		default: {
			/**
			 * Every summarize and graph step, through one dispatcher.
			 *
			 * They differ in how the *user* prompt is built and in
			 * nothing else — same adapter, same queue, same resolution of
			 * connection and sampling from the node's slots. Listing them
			 * case by case would be eleven copies of one call.
			 */
			if (STEP_TYPES.has(node.definitionId)) {
				const { dispatchStep } = await import(
					"$lib/server/pipelines/runtime/dispatchStep"
				)
				// Queued, then unstreamed: the in-flight beat is its
				// only sign of life (`callTether`).
				const { text, connection } = await line.hold(() => dispatchStep(db, {
					systemPrompt: String(p.systemPrompt ?? ""),
					userPrompt: stepUserPrompt(p),
					connectionId: refId(p.connection),
					connectionModelId: connectionDescriptorModelId(
						p.connection
					),
					samplingId: refId(p.sampling),
					label: p.label,
					signal: line.signal,
					// A step that asks for a shape (turn-advise) gets the
					// strongest structured door its connection has.
					...(p.schema ? { schema: p.schema } : {})
				}))
				// Steps that ask for JSON get it parsed here rather than
				// in each binding: the models wrap it in prose often
				// enough that every caller would need the same salvage.
				//
				// `connection` rather than the old `via` string: this
				// value is the node's receipt output, and a non-admin can
				// read their own receipt (`pipelines:run`). Under this key
				// the projection takes it away from them and leaves it for
				// an administrator.
				return { text, connection, json: tryJson(text) }
			}

			throw new Error(
				`${node.key} (${node.definitionId}) has no dispatch path in core. A Provider core ` +
					`cannot call is one a user could add to a pipeline and watch fail at run time.`
			)
		}
	}
}
