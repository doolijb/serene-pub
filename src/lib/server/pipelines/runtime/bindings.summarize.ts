/**
 * Summarization bindings and the task nodes beside them: the summary source,
 * transcript and batches, tool advertising and parsing, duties, text joins and
 * splits, the pure pick and cast choices, the pair, forms, JSON parsing, the
 * summary and naming oracles, turn advice, cast extraction and entry keys.
 * `coreBindings()` spreads this map.
 *
 * Imports helpers from `bindings.shared.ts`, never from `bindings.ts`.
 */

import {
	hostSeatRefOf,
	storedSeatRefInCast
} from "$lib/server/pipelines/prompt/seatCards"
import { memberFormOn } from "$lib/server/state/memberForm"
import { dutyModes } from "$lib/server/pipelines/runtime/duties"
import { notePeopleHalt } from "./host.types"
import type { Bindings } from "@serene-pub/sdk"
import {
	ok,
	halt,
	err,
	roughTokens,
	reads,
	isParticipantRef,
	parseParticipantRef,
	fieldLabel,
	formAnswerSchema,
	// D-4a: the pick hash, shared with plugin authors so that two readers of
	// one session can never reach different suspects. Never re-implemented here.
	rendezvousPick,
	// Lair pass B5: the Plan section's reading and the write's own checks.
	sectionItemsOf,
	checkFoldedSections,
	type FormBlock,
	type MessageBlock,
	type ParticipantRef,
	readLibraryDraft
} from "@serene-pub/sdk"
import { i18nTextIn } from "$lib/shared/i18n/i18nText"
import { participantRowId } from "$lib/server/pipelines/runtime/portrayals"
/**
 * The node declarations themselves, as types.
 *
 * `import type`, so `verbatimModuleSyntax` erases it outright: importing
 * contracts for real would run `describeQueryDefinition`'s `register()` for every core
 * type as a side effect of loading the runtime, which is the boot sequence's job
 * and not this file's.
 */
import type * as C from "@serene-pub/contracts"
import type {
	CoreQueryCtx,
	NodeInput,
	OracleCtx,
	TaskCtx
} from "./bindingTypes"
import { withAttachmentNames } from "$lib/server/attachments/placement"
import {
	proposeKeys,
	MAX_KEYS,
	MAX_TERM_KEYS
} from "$lib/server/pipelines/ranking/keyProposal"
import {
	CORE_TEMPLATE_ENGINE,
	renderTemplate,
	type RenderRun
} from "$lib/server/pipelines/prompt/renderers"
import {
	batchUnits,
	renderTranscript as renderTranscriptUnits,
	type TranscriptRow
} from "$lib/server/pipelines/runtime/transcript"
import {
	buildBatchPrompt,
	buildTranscriptBatchPrompt,
	buildCharacterExtractionPrompt,
	buildNamePrompt,
	buildSynthesisPrompt,
	formatMessagesAsJson,
	type JsonDraft
} from "$lib/server/utils/summarizer/templates"
import { parseSummaryOutput } from "$lib/server/utils/summarizer/parser"
import { resolveBatchBudget } from "$lib/server/utils/summarizer/batchBudget"
import {
	senderRefOf,
	roundRobinEntries,
	spokenRefsSince,
	type RotationMessage,
	type TurnCandidate,
	type TurnEntry
} from "$lib/server/pipelines/runtime/speakerRotation"
import {
	STATUS,
	type SessionCastRead,
	castEntityRefs,
	seatRefLookupOfCandidates,
	stepSlots
} from "./bindings.shared"

/**
 * Who a model's `addressee` names, as a participant reference (U5d): a cast
 * member or a member's **presence** by name — a character's name or
 * nickname, an envoy's name or slug — case-insensitively, or a reference
 * that names a **seated** cast member, a live presence or an envoy of this
 * session (U5d review, W8: a model that writes `character:7` is believed
 * only when 7 is here — a reference to a character of another session, or
 * to nobody, would otherwise address a form to someone the resolver says
 * nobody here portrays). Null when nobody here bears the name: the block
 * goes out unaddressed rather than to the wrong person.
 *
 * A presence — a live `session_personas` row — resolves to `character:<id>`
 * exactly as a cast member does: a persona IS a character row (0132), and
 * the resolver already answers `character:<id>` for both. A narrator that
 * puts a question to the player's persona by name addresses the player
 * (2026-09-17: "Rook" resolved to nobody, the block went out unaddressed,
 * and the player's press landed as nobody's line). The cast is searched
 * first, so a name both a cast member and a presence bear goes to the cast.
 */
function resolveAddresseeName(
	named: unknown,
	cast: SessionCastRead | null | undefined
): ParticipantRef | null {
	if (typeof named !== "string" || !named.trim()) return null
	// 🚧 (seat-cast S2/S4) a seat reference is read as the form the session
	// stores (`storedSeatRefInCast`: the card form off, the member form —
	// `seated-member:` / `player-seat:` — once `state/memberForm.ts` is on),
	// which then passes the seated check below; nobody here seated as that
	// member → nobody.
	const text = storedSeatRefInCast(cast, named.trim())
	if (text === null) return null
	// Live seats only, on both sides: a departed participant — a cast
	// member or a presence with `removedAt` — is nobody's, and a block put
	// to one would be owner-only (the resolver says nobody portrays them)
	// where one put to nobody in particular is open to the action's
	// audience. The same `removedAt` test the turn strategies apply.
	// A seat counts with a card OR a member: a card-less character seat has
	// `castMemberId` and a card-shaped `character` with no `id`.
	const seated = (cast?.sessionCharacters ?? []).filter(
		(cc) =>
			cc &&
			(cc.character?.id != null || cc.castMemberId != null) &&
			cc.removedAt == null
	)
	const presences = (cast?.sessionPersonas ?? []).filter(
		(cp) => cp?.persona?.id && cp.removedAt == null
	)
	const seatedCharacters = new Set<number>()
	for (const cc of seated)
		if (cc!.character?.id != null) seatedCharacters.add(cc!.character.id)
	for (const cp of presences) seatedCharacters.add(cp!.persona!.id!)
	const envoys = ((cast as { envoys?: unknown } | null)?.envoys ?? []) as Array<{
		slug?: string
		name?: unknown
	}>
	/** ⏳ A live seat's own ref: the row's host-filled one, else `hostSeatRefOf`. */
	const seatRefOf = (
		kind: "character" | "player",
		row: { ref?: string | null; castMemberId?: number | null; seatId?: number | null },
		cardId: number | null
	): string | null =>
		(typeof row.ref === "string" && row.ref ? row.ref : null) ??
		(kind === "player" && row.seatId == null ? null : hostSeatRefOf({
			kind,
			seatId: row.seatId ?? 0,
			castMemberId: row.castMemberId ?? null,
			cardId
		}))
	if (isParticipantRef(text)) {
		const ref = parseParticipantRef(text)
		if (ref.kind === "character") {
			const id = participantRowId(ref.id)
			return id !== null && seatedCharacters.has(id) ? text : null
		}
		// ⏳ Member form (flip on): a `seated-member:` / `player-seat:` is believed only when a live seat here carries it.
		if (
			memberFormOn() &&
			(ref.kind === "seated-member" || ref.kind === "player-seat")
		) {
			const here = new Set<string>()
			for (const cc of seated) {
				const r = seatRefOf("character", cc!, cc!.character?.id ?? null)
				if (r) here.add(r)
			}
			for (const cp of presences) {
				const r = seatRefOf("player", cp!, cp!.persona!.id!)
				if (r) here.add(r)
			}
			return here.has(text) ? text : null
		}
		if (ref.kind === "envoy")
			return envoys.some((e) => e?.slug === ref.slug) ? text : null
		// A role or a user: not a cast member, so not a form's addressee by
		// the model's say-so.
		return null
	}
	const wanted = text.toLowerCase()
	const bearsName = (c: { name?: string | null; nickname?: string | null }) =>
		[c.name, c.nickname]
			.filter((n): n is string => typeof n === "string" && !!n.trim())
			.some((n) => n.trim().toLowerCase() === wanted)
	// The cast first: a name both a cast member and a presence bear goes
	// to the cast.
	for (const cc of seated) {
		const c = cc!.character
		if (c && bearsName(c)) {
			// A card-less seat has no card id: its ref is the host's, never `character:undefined`.
			const ref = seatRefOf("character", cc!, c.id ?? null)
			if (ref) return ref as ParticipantRef
			if (c.id != null) return `character:${c.id}` as ParticipantRef
		}
	}
	for (const cp of presences) {
		const c = cp!.persona!
		if (bearsName(c))
			return (seatRefOf("player", cp!, c.id!) ?? `character:${c.id}`) as ParticipantRef
	}
	for (const e of envoys) {
		if (!e?.slug) continue
		const name = i18nTextIn(e.name)
		if (
			e.slug.toLowerCase() === wanted ||
			(name && name.trim().toLowerCase() === wanted)
		)
			return `envoy:${e.slug}`
	}
	return null
}

export function summarizeBindings(run: RenderRun = {}): Bindings {
	return {
		// ── Summarization ───────────────────────────────────────────────────
		//
		// The two-phase shape of `utils/summarizer`, as nodes. Every prompt below
		// comes from the node's `prompts` slot, resolved through the scope chain
		// — so a user who retuned "Default World Summarization" gets their
		// wording here without this file knowing anything about it.

		"core:inlet/summarize-request@1": reads<typeof C.summarizeRequest>(
			async (input: NodeInput<typeof C.summarizeRequest>) => ok(input),
			{ ports: [] }
		),

		"core:query/summarize-source@1": reads<typeof C.summarizeSource>(
			async (
				input: NodeInput<typeof C.summarizeSource>,
				ctx: CoreQueryCtx
			) => {
				// `summarize_source`, not `session_messages`: a summary wants a
				// chosen range with sender names resolved, and the host owns
				// both rules so no binding can get the hidden-message convention
				// wrong.
				const messages = await ctx.read("summarize_source", {
					sessionId: input?.scope?.sessionId,
					messageIds: input?.request?.messageIds,
					limit: input?.request?.limit ?? 5000
				})
				return ok({ main: messages, messages })
			},
			{ ports: ["scope", "request"] }
		),

		/**
		 * 🚧 A scene's span (PROPOSAL-live-scenes §12.2, §14 B): the story
		 * rows of one lane between the scene's boundaries, and the aside rows
		 * of the named aside channels over the same ids, each attached to the
		 * story line it follows (`afterMessageId`). The host owns both reads
		 * (`summarize_span`) so no binding can get the hidden-row rule or the
		 * lane order wrong.
		 */
		"core:query/summarize-source@2": reads<typeof C.summarizeSource.v2>(
			async (
				input: NodeInput<typeof C.summarizeSource.v2>,
				ctx: CoreQueryCtx
			) => {
				// The range is the request's; which channel is the story and
				// which are asides is the spec's (its params, §13).
				const r = (input?.request ?? {}) as Record<string, any>
				const span = (await ctx.read("summarize_span", {
					sessionId: input?.scope?.sessionId,
					sceneId: r.sceneId,
					messageIds: r.messageIds,
					openedAt: r.openedAt,
					closedAt: r.closedAt,
					channel: input?.params?.channel ?? "main",
					asides: input?.params?.asides ?? [],
					limit: r.limit ?? 5000
				})) as { messages?: unknown[]; asides?: unknown[] } | null
				const messages = span?.messages ?? []
				const asides = span?.asides ?? []
				return ok({ main: messages, messages, asides })
			},
			{ ports: ["scope", "request"], params: ["channel", "asides"] }
		),

		/**
		 * 🚧 The transcript as units (§12.2): one `preamble`, then a unit per
		 * story line, each followed by a unit per aside attached to it — so
		 * the cut that follows never splits a unit. The template is the
		 * `template` slot's three inline partials, rendered through core's
		 * engine seam (`renderTemplate`); a section it does not define, or no
		 * template at all, renders the shipped Default's
		 * (`runtime/transcript.ts`). The `scene` port is wired to the request;
		 * its `scene` field is read. A line's files arrive on `attachments`
		 * and render as the line section's `{{{attachments}}}`.
		 */
		"core:task/render-transcript@1": reads<typeof C.renderTranscript>(
			async (input: NodeInput<typeof C.renderTranscript>, ctx: TaskCtx) => {
				const slot = input?.template as
					| string
					| { source?: unknown; engine?: unknown }
					| null
					| undefined
				const source =
					typeof slot === "string"
						? slot
						: typeof slot?.source === "string"
							? slot.source
							: ""
				const engine =
					typeof slot === "object" && slot !== null && typeof slot.engine === "string"
						? slot.engine
						: CORE_TEMPLATE_ENGINE
				if (source && engine !== CORE_TEMPLATE_ENGINE)
					return halt(
						`render-transcript renders Handlebars partials, and its template is written for '${engine}'.`
					)
				const run = ctx as unknown as RenderRun
				const rendered = await renderTranscriptUnits(
					{
						messages: (Array.isArray(input?.messages)
							? input.messages
							: []) as TranscriptRow[],
						asides: (Array.isArray(input?.asides)
							? input.asides
							: []) as TranscriptRow[],
						// The story rows' files (`history-attachments@1`),
						// named after each line's text as `batch-messages@1`
						// names them. Unwired: none.
						attachments: input?.attachments,
						// 🚧 The aside rows' files, the same way (lane E).
						asideAttachments: (input as { asideAttachments?: unknown })
							?.asideAttachments,
						cast: input?.cast,
						scene: input?.scene
					},
					source || null,
					(template, variables) =>
						renderTemplate(CORE_TEMPLATE_ENGINE, {
							template,
							variables,
							runId: run?.runId,
							user: run?.user
						}),
					roughTokens
				)
				return ok({
					main: rendered.units,
					preamble: rendered.preamble,
					units: rendered.units
				})
			},
			{
				ports: [
					"messages",
					"asides",
					"attachments",
					"asideAttachments",
					"cast",
					"scene",
					"template"
				]
			}
		),

		/**
		 * 🚧 The cut, over rendered units (§12.2): `@1`'s budget and
		 * `minBatchMessages` rule, never inside a unit, the preamble opening
		 * every batch and counted in its budget. A unit larger than the
		 * budget ships alone. Out: one string per batch; no units, none.
		 */
		"core:task/batch-messages@2": reads<typeof C.batchMessages.v2>(
			async (input: NodeInput<typeof C.batchMessages.v2>) => {
				const resolved = resolveBatchBudget({
					batchTokens: input?.params?.batchTokens,
					sampling: input?.sampling
				})
				if (!resolved.fits) return halt(resolved.reason)
				const minBatch = Math.max(
					1,
					Math.floor(Number(input?.params?.minBatchMessages) || 1)
				)
				const batches = batchUnits(
					typeof input?.preamble === "string" ? input.preamble : "",
					Array.isArray(input?.units) ? (input.units as any[]) : [],
					resolved.tokens,
					minBatch,
					roughTokens
				)
				return ok({ main: batches, batches })
			},
			{
				ports: ["preamble", "units", "sampling"],
				params: ["batchTokens", "minBatchMessages"]
			}
		),

		/**
		 * The cut into batches.
		 *
		 * A Task, so it is inspectable and its parameters are a user's to tune.
		 * The 1500-token headroom is the legacy reserve for the prompt template
		 * and the draft the model writes back — without it a batch sized exactly
		 * to the window leaves no room for the answer.
		 */
		/**
		 * Tool calling's pure halves (20 §9). A tool is any same-shaped
		 * provider — canonically a sandboxed plugin hook on the spine — and
		 * these two only decide how the model learns about it and how its
		 * answer is read back. Which door (`style`) is a bind-time match
		 * against the connection's capability report, never a runtime guess.
		 */
		"core:task/advertise-tools@1": reads<typeof C.advertiseTools>(
			async (input: NodeInput<typeof C.advertiseTools>) => {
				const tools: any[] = Array.isArray(input?.tools)
					? input.tools.filter(
							(t: any) => t && typeof t.name === "string"
						)
					: []
				// Normalized for a native tool API: name/description/parameters,
				// nothing else — an adapter maps this onto its provider's shape.
				const native = tools.map((t) => ({
					name: t.name,
					description: String(t.description ?? ""),
					parameters:
						t.parameters && typeof t.parameters === "object"
							? t.parameters
							: { type: "object", properties: {} }
				}))
				// The emulated door: the advertisement as prompt text, with one
				// unambiguous call convention the parse task's grammar mirrors.
				const prompt = tools.length
					? [
							"# Tools",
							"To use a tool, reply with ONLY a fenced block:",
							"```tool_call",
							'{"tool": "<name>", "args": { ... }}',
							"```",
							"Reply normally when no tool is needed.",
							"",
							...tools.map(
								(t) =>
									`- ${t.name}: ${String(t.description ?? "")}` +
									(t.parameters
										? `\n  args schema: ${JSON.stringify(t.parameters)}`
										: "")
							)
						].join("\n")
					: ""
				const style =
					input?.params?.style === "native" ? "native" : "prompt"
				return ok({
					main: style === "native" ? native : prompt,
					native,
					prompt
				})
			},
			{ ports: ["tools"], params: ["style"] }
		),

		"core:task/parse-tool-call@1": reads<typeof C.parseToolCall>(
			async (input: NodeInput<typeof C.parseToolCall>) => {
				const text = String(input?.text ?? "")
				const known = new Set(
					(Array.isArray(input?.tools) ? input.tools : [])
						.map((t: any) => t?.name)
						.filter((n: any) => typeof n === "string")
				)
				/** First match wins: the fenced convention, then a bare object. */
				const fenced = /```tool_call\s*\n([\s\S]*?)```/.exec(text)
				// The bare form needs *balanced* extraction — a lazy regex stops
				// at the first `}` and beheads any call with nested args.
				let bare: string | null = null
				if (!fenced) {
					const at = text.search(/\{\s*"(tool|name)"\s*:/)
					if (at >= 0) {
						let depth = 0
						for (let i = at; i < text.length; i++) {
							const c = text[i]
							if (c === "{") depth++
							else if (c === "}" && --depth === 0) {
								bare = text.slice(at, i + 1)
								break
							}
						}
					}
				}
				const raw = fenced?.[1] ?? bare ?? null

				let call: {
					tool: string
					args: Record<string, unknown>
				} | null = null
				if (raw) {
					try {
						const parsed = JSON.parse(raw)
						const tool =
							typeof parsed?.tool === "string"
								? parsed.tool
								: typeof parsed?.name === "string"
									? parsed.name
									: null
						if (tool && (!known.size || known.has(tool)))
							call = {
								tool,
								args:
									parsed.args &&
									typeof parsed.args === "object"
										? parsed.args
										: (parsed.arguments ?? {})
							}
					} catch {
						// An unparseable block is prose, not a crash: the loop's
						// predicate sees no call and the turn settles as text.
					}
				}
				// What renders is prose; what dispatches is data. Stripping only
				// the matched block keeps a reply that mixed narration and a call
				// readable.
				const matched = fenced?.[0] ?? bare ?? undefined
				const stripped =
					call && matched ? text.replace(matched, "").trim() : text
				return ok({ main: call, call, text: stripped })
			},
			{ ports: ["text", "tools"] }
		),

		/**
		 * What tools this session has, as declarations a model can read.
		 *
		 * A Query so that the answer is the install's, not the spec's: which
		 * extensions are enabled is a fact about this moment, and a spec
		 * listing its tools by hand would advertise one that was uninstalled
		 * and refuse one that was added. The host resolves the list; this is
		 * the shape.
		 */
		/**
		 * 🚧 **Duties** (PLAN-layering §4, R5, R37; 2026-10-20) — a switch
		 * each, the step's own params, read where its pipeline branches. A
		 * duty that is on runs at the routine's mode (`full` applies, `review`
		 * holds each write); off is off. Every duties step reads its
		 * `routine` in-port; unwired (a reply's duties, as shipped) it is
		 * `full`. Publishes `modes` keyed as the steps that read
		 * them name them (`dutyModes`), `any`, and `main` (both).
		 *
		 * The reply's duties write no lorebook.
		 */
		"core:task/reply-duties@1": reads<typeof C.replyDuties>(
			async (input: NodeInput<typeof C.replyDuties>) =>
				ok(dutyModes("core:task/reply-duties@1", input?.params, input?.routine)),
			// 🚧 `changes` (D7): *Replies carry changes*, published as `reply-changes`.
			{ ports: ["routine"], params: ["lore", "scene", "changes"] }
		),
		/**
		 * 🚧 S2 (PLAN-genres-seams, ★B, 2026-10-23): while the session's reply
		 * carries changes at Full, *Keep the sheets* and *Track conditions*
		 * read Off here — the reply filed what the scene changed — and the
		 * output's `main.ceded` says so. The session is the routine run's
		 * (`routineRunOf`); a run no routine made reads the duties as set.
		 */
		"core:task/reckoning-duties@1": reads<typeof C.reckoningDuties>(
			async (input: NodeInput<typeof C.reckoningDuties>) => {
				const { routineRunOf } = await import("$lib/server/pipelines/routines/runs")
				const sessionId = routineRunOf(run.runId)?.sessionId
				const facts =
					sessionId != null
						? {
								replyChanges: await (await import("$lib/server/pipelines/routines/sessionRoutines")).sessionReplyChangesMode(
									(await import("$lib/server/db")).db as never,
									sessionId
								)
							}
						: {}
				return ok(dutyModes("core:task/reckoning-duties@1", input?.params, input?.routine, facts))
			},
			{ ports: ["routine"], params: ["attributes", "conditions", "time", "placesOnMove", "timedExpiry"] }
		),
		/** 🚧 Sprint 2 (pass 7, R-i): *Notice when the scene moves on* is asked only when the host's judged scene check is due (`judgedSceneDuty.ts`); its `sceneCheck` rides on the output. */
		"core:task/sweep-duties@1": reads<typeof C.sweepDuties>(
			async (input: NodeInput<typeof C.sweepDuties>) => {
				const out = dutyModes("core:task/sweep-duties@1", input?.params, input?.routine)
				const { judgedSceneCheckFor, withJudgedSceneCheck } = await import("$lib/server/pipelines/runtime/judgedSceneDuty")
				const db = (await import("$lib/server/db")).db as never
				return ok(withJudgedSceneCheck(out, await judgedSceneCheckFor(db, out.modes, run.runId ?? "")))
			},
			{
				ports: ["routine"],
				params: ["lore", "cast", "relationships", "worldState", "scenes", "goals", "goalReached", "sceneMovedOn"]
			}
		),
		"core:query/available-tools@1": reads<typeof C.availableTools>(
			async (
				input: NodeInput<typeof C.availableTools>,
				ctx: CoreQueryCtx
			) => {
				const tools = await ctx.read("available_tools", {
					sessionId: input?.scope?.sessionId,
					include: input?.params?.include ?? [],
					plugins: input?.params?.plugins !== false,
					// 🚧 Which kinds a session switched on (2026-10-19); unwired = all.
					kinds: (input as any)?.kinds
				})
				const list = Array.isArray(tools) ? tools : []
				return ok({ main: list, tools: list })
			},
			{ ports: ["scope", "kinds"], params: ["include", "plugins"] }
		),


		/**
		 * A repeated block's outputs, joined.
		 *
		 * `path` reads one key off each entry because an iteration's value is
		 * its chain's last node's ports object, and empty entries are skipped
		 * — which is what makes "every iteration's `answer`" resolve to the one
		 * iteration that had an answer without a filter node in between.
		 */
		"core:task/join-text@1": reads<typeof C.joinText>(
			async (input: NodeInput<typeof C.joinText>) => {
				const items = Array.isArray(input?.items) ? input.items : []
				const path = input?.params?.path ?? "text"
				const separator = input?.params?.separator ?? "\n\n"
				const parts = items
					.map((entry: any) => {
						const value =
							path && entry && typeof entry === "object"
								? entry[path]
								: entry
						return typeof value === "string"
							? value
							: value == null
								? ""
								: String(value)
					})
					.map((t: string) => t.trim())
					.filter((t: string) => t.length > 0)
				const text = parts.join(separator)
				return ok({ main: text, text })
			},
			{ ports: ["items"], params: ["path", "separator"] }
		),

		/**
		 * A document's lists as one folded section (lair pass B5, D5): the
		 * Lair's planner beats and speakers under "Plan", as readable lines,
		 * never JSON. The reading is the SDK's `sectionItemsOf`; the checks
		 * are the ones the write makes, so a bad `kind` halts HERE, on the
		 * node that chose it, rather than at the save.
		 */
		"core:task/list-section@1": reads<typeof C.listSection>(
			async (input: NodeInput<typeof C.listSection>) => {
				const items = sectionItemsOf(input?.json, input?.params?.path ?? "")
				const checked = checkFoldedSections(
					items.length
						? [
								{
									kind: input?.params?.kind ?? "notes",
									label: input?.params?.label ?? "Notes",
									items
								}
							]
						: []
				)
				if (checked.refusal) return halt(checked.refusal)
				const sections = checked.sections ?? []
				// The same lines as a markdown list (lair pass R8): the body
				// of a row whose text IS the list — the Lair's beats row.
				const text = items.map((line) => `- ${line}`).join("\n")
				return ok({ main: sections, sections, text })
			},
			{ ports: ["json"], params: ["path", "kind", "label"] }
		),

		/**
		 * A list's first item and the rest (lair pass R8): the Lair's lead
		 * delver, whose line streams, and the party after them. Pure — the
		 * contract's rules: anything that is not a list is a list of one,
		 * `first` absent on an empty list, `rest` always a list.
		 */
		// 🚧 A drafted card or book read out of a reply (M2c path B): pure, the SDK's `readLibraryDraft`.
		"core:task/read-library-draft@1": reads<typeof C.readLibraryDraft>(
			async (input: NodeInput<typeof C.readLibraryDraft>) => {
				const read = readLibraryDraft(input?.text)
				return ok({
					main: { make: read.make, ...(read.draft ? { draft: read.draft } : {}) },
					text: read.text,
					make: read.make,
					...(read.draft ? { draft: read.draft } : {})
				})
			},
			{ ports: ["text"] }
		),
		"core:task/split-first@1": reads<typeof C.splitFirst>(
			async (input: NodeInput<typeof C.splitFirst>) => {
				const raw = input?.items
				const items = Array.isArray(raw) ? raw : raw == null ? [] : [raw]
				const [first, ...rest] = items
				return ok({
					main: { first, rest },
					...(first !== undefined ? { first } : {}),
					rest
				})
			},
			{ ports: ["items"] }
		),

		// ── D-4a: the pure pick, and the room as options ───────────────────
		//
		// Two Tasks that compute rather than fetch. Neither touches `ctx` at
		// all — no read, no commit, no model — which is what lets a genre
		// DERIVE a hidden fact (which suspect did it) instead of authoring it
		// or asking a model that can change its mind.

		/**
		 * The item this session picks, by a hash of its identity.
		 *
		 * ## Why rendezvous and not `items[hash % items.length]`
		 *
		 * Each candidate is scored on its own — `hash(key + '#' + itemKey)` —
		 * and the highest wins, so a candidate arriving mid-session displaces
		 * the pick with probability 1/n instead of moving every session's
		 * answer at once. The function is the SDK's (`pick.ts`), not a copy:
		 * the same numbers run in the app, in a plugin's sandbox and in the
		 * test, because this pick IS the record — nothing writes the answer
		 * down, so a drifted second implementation would not fail, it would
		 * quietly disagree with last week's receipt.
		 *
		 * ## Halting is the only honest empty
		 *
		 * The definition declares no `optional`, so an empty list stops the
		 * run. `optional: true` would publish an `ok` whose ports all read
		 * absent — indistinguishable downstream from a pick that chose
		 * nothing — and "nobody did it" is not a case a mystery can carry on
		 * from.
		 */
		"core:task/pick-by-hash@1": reads<typeof C.pickByHash>(
			async (input: NodeInput<typeof C.pickByHash>) => {
				const items = Array.isArray(input?.items) ? input.items : []
				// The key in the two spellings a spec can actually supply: the
				// session's scope (`$.input.sessionScope`), which is the whole
				// point — the same session reaches the same item on every turn
				// — or a literal string for a pick that is not per-session.
				// Deliberately no third reading: a bare row id could mean a
				// session, a character or an entry, and guessing would key two
				// genres' picks on one number.
				const scoped = input?.scopeKey as { sessionId?: unknown } | null
				const key =
					typeof input?.scopeKey === "string"
						? input.scopeKey.trim()
						: typeof scoped?.sessionId === "number" &&
							Number.isFinite(scoped.sessionId)
							? `session:${scoped.sessionId}`
							: ""
				if (!key)
					return halt(
						"there is nothing to pick under — wire the session's scope " +
							"(`$.input.sessionScope`), or a literal string, into `scopeKey`; " +
							"a pick with no key would answer differently every run"
					)
				const by =
					typeof input?.params?.by === "string"
						? input.params.by.trim()
						: ""
				// The identity, in the two shapes a core list actually arrives
				// in: `cast-choices` publishes `{ key, label }`, a lore listing
				// publishes rows with an `id`, and a plain string is its own
				// name. Anything else is skipped rather than scored under a
				// shared empty key, which would make every unnameable entry one
				// candidate.
				const identityOf = (item: unknown): string | null => {
					const raw =
						by && item && typeof item === "object"
							? (item as Record<string, unknown>)[by]
							: typeof item === "string"
								? item
								: item && typeof item === "object"
									? (item as Record<string, unknown>).id
									: undefined
					if (typeof raw === "string") return raw.trim() || null
					if (typeof raw === "number" && Number.isFinite(raw))
						return String(raw)
					return null
				}
				const picked = rendezvousPick(items, key, identityOf)
				if (!picked)
					return halt(
						by
							? `there was nothing to pick from — no entry carried a \`${by}\` to be identified by`
							: "there was nothing to pick from — the list was empty, or no entry could be identified"
					)
				return ok({
					main: picked.item,
					pickIndex: picked.index,
					chosenKey: picked.key
				})
			},
			{ ports: ["items", "scopeKey"], params: ["by"] }
		),

		/**
		 * The room, as options a question can be put with.
		 *
		 * `make-choices` needs `{ key, label }` and nothing turned a cast into
		 * that list, so a picker spent a whole model call reading the cast
		 * back out as JSON — a request, a schema and a wait for a fact the run
		 * already held, with a model free to misspell a suspect or invent one.
		 *
		 * The key is a **participant reference** (R-18 (3)), which is what
		 * makes the round trip work: it lands on the pressed option, comes
		 * back on `read-answer`'s `choice`, and a junction can compare that
		 * against a `pick-by-hash` `chosenKey` derived over these same
		 * options. A name would not — two cast members can bear one, and an
		 * author can edit it between two turns.
		 *
		 * Live seats only, and never an envoy: `exclude` offers no way to turn
		 * one off, so a narrator among the suspects could not be removed.
		 *
		 * It publishes the whole `{ question, options }` document beside the
		 * bare list (ruled (b), 2026-09-17). `make-choices` reads the question
		 * and the options off ONE `json` port, so a spec handed only the
		 * options had nowhere to put the question — and the obvious repair, a
		 * second in-port there, would move the hash of a node already wired
		 * into shipped specs.
		 */
		"core:task/cast-choices@1": reads<typeof C.castChoices>(
			async (input: NodeInput<typeof C.castChoices>) => {
				const cast = (input?.cast ?? null) as SessionCastRead | null
				const exclude = input?.params?.exclude ?? "none"
				const question =
					typeof input?.question === "string" ? input.question : ""
				const options: Array<{ key: string; label: string }> = []
				const seen = new Set<string>()
				const add = (
					id: number | null | undefined,
					name: unknown,
					nickname?: unknown,
					seatRef?: string | null
				) => {
					// A card-less seat has no card id: it is an option by its host-filled ref alone.
					if (!seatRef && (id == null || !Number.isFinite(id))) return
					// ⏳ The seat's own ref — the row's host-filled one (member form once `state/memberForm.ts` is on), else the card form.
					const key = seatRef || `character:${id}`
					if (seen.has(key)) return
					const label = [name, nickname]
						.map((n) => (typeof n === "string" ? n.trim() : ""))
						.find((n) => !!n)
					if (!label) return
					seen.add(key)
					options.push({ key, label })
				}
				// The cast first, then the presences — the order every other
				// reader of this document uses, so an option list and an
				// addressee resolution cannot disagree about who comes first.
				if (exclude !== "characters")
					for (const cc of cast?.sessionCharacters ?? []) {
						// The turn strategies' own eligibility: a soft-removed
						// seat is nobody, and a switched-off one is not taking
						// part — the cast read carries it with `enabled: false`.
						const seat = cc
						if (!seat?.character || seat.removedAt != null) continue
						if (seat.enabled === false) continue
						add(seat.character.id, seat.character.name, seat.character.nickname, seat.ref)
					}
				if (exclude !== "personas")
					for (const cp of cast?.sessionPersonas ?? []) {
						if (!cp?.persona || cp.removedAt != null) continue
						// A persona's own name only, as `castEntityRefs` has
						// it: nothing else in the prompt answers to a
						// persona's nickname.
						add(cp.persona.id, cp.persona.name, undefined, cp.ref)
					}
				// `json` is the document `make-choices` reads off its own `json`
				// port, in exactly that shape. No `addressee`: the document's is
				// a NAME that node resolves against the cast, and this one has no
				// more idea who the question is for than the cast document does —
				// a spec that knows wires that node's own `addressee` port, which
				// wins over the document's anyway.
				return ok({ main: options, options, json: { question, options } })
			},
			{ ports: ["cast", "question"], params: ["exclude"] }
		),

		// ── Contracts batch 2: the two-document pair ───────────────────
		//
		// A junction branches on ONE port and `equalsPath` compares two paths
		// of ONE document, so *is the accused the culprit?* is unaskable until
		// something has put both in the same document. This is that something,
		// and it is the dullest handler in the file on purpose.

		/**
		 * Two values, side by side under names the spec chose.
		 *
		 * ⚠ **An absent side is OMITTED, never written as null**, and that is
		 * the whole of this handler worth reading. `predicateHolds` answers
		 * `false` when either side of an `equalsPath` is `undefined` — two
		 * absences are not a match — so a turn on which nothing was decided
		 * falls through to the default branch. A `null` would destroy it:
		 * `null` is a value, `readPath` returns it, and `null === null`, so a
		 * document with both sides nulled compares EQUAL and a verdict fires
		 * on a turn where nobody accused anybody.
		 *
		 * Two keys that are the same string halt rather than collapse: one key
		 * holding whichever side was written last is a document that compares
		 * equal to itself, which is the one answer this node must never
		 * produce by accident.
		 */
		"core:task/pair@1": reads<typeof C.pair>(
			async (input: NodeInput<typeof C.pair>) => {
				const keyOf = (raw: unknown, fallback: string) =>
					(typeof raw === "string" ? raw.trim() : "") || fallback
				const firstKey = keyOf(input?.params?.firstKey, "first")
				const secondKey = keyOf(input?.params?.secondKey, "second")
				if (firstKey === secondKey)
					return halt(
						`both sides of the pair would be called “${firstKey}”, so the document would ` +
							`compare equal to itself — give the two values different names`
					)
				const main: Record<string, unknown> = {}
				if (input?.first !== undefined) main[firstKey] = input.first
				if (input?.second !== undefined) main[secondKey] = input.second
				return ok({ main })
			},
			{ ports: ["first", "second"], params: ["firstKey", "secondKey"] }
		),

		// ── Forms (plans/29 R-15 *Forms*; U5d, 2026-09-17) ─────────────────
		//
		// Three pure tasks around the block vocabulary: the form as a prompt
		// and a schema (the answer pipeline's), an oracle's question as a
		// `choices` block (the asking spec's), and a press taken apart for
		// the action it fires. No rows, no model, no host.

		/**
		 * The form the answer pipeline is answering, as the prompt sees it and
		 * as the oracle's schema. `formQuestion` and `formOptions` land on the
		 * template context for `ANSWER_FORM_TEMPLATE` to render as the last
		 * user turn; `schema` is `formAnswerSchema(form)` — an enum of the
		 * option keys, or the field schema.
		 */
		"core:task/form-context@1": reads<typeof C.formContext>(
			async (input: NodeInput<typeof C.formContext>) => {
				const form = input?.form as FormBlock | undefined
				if (!form || (form.kind !== "choices" && form.kind !== "form"))
					return halt(
						"there is no form to answer — the inlet's `form` port carried no choices or form block"
					)
				const question = form.question ?? ""
				const formOptions =
					form.kind === "choices"
						? form.actions
								.filter((o) => o.choice)
								.map((o) => `- ${o.choice}: ${o.label}`)
								.join("\n")
						: Object.entries(form.fields)
								.map(([key, decl]) => `- ${key}: ${fieldLabel(decl) ?? key}`)
								.join("\n")
				const templateContext = {
					...((input?.templateContext as Record<string, unknown> | undefined) ?? {}),
					formQuestion: question,
					formOptions
				}
				return ok({
					main: templateContext,
					templateContext,
					schema: formAnswerSchema(form),
					question
				})
			},
			{ ports: ["form", "templateContext"] }
		),

		/**
		 * An oracle's `{ addressee, question, options }` as a `choices` block.
		 * The addressee is resolved against the cast and the members'
		 * presences by name (or taken as a reference when it already is
		 * one); the `addressee` port wins when wired. The host stamps
		 * identity and id at the write.
		 */
		"core:task/make-choices@1": reads<typeof C.makeChoices>(
			async (input: NodeInput<typeof C.makeChoices>) => {
				const doc = (input?.json ?? null) as {
					addressee?: unknown
					question?: unknown
					options?: unknown
				} | null
				const fn = typeof input?.fn === "string" ? input.fn : ""
				const options = Array.isArray(doc?.options)
					? (doc!.options as Array<{ key?: unknown; label?: unknown }>)
							.filter((o) => typeof o?.key === "string" && o.key && typeof o?.label === "string")
							.map((o) => ({ key: String(o.key), label: String(o.label) }))
					: []
				const question = typeof doc?.question === "string" ? doc.question.trim() : ""
				if (!fn || !options.length || !question)
					return ok({ main: [], blocks: [], text: question, addressee: null })
				const wired =
					typeof input?.addressee === "string" && isParticipantRef(input.addressee)
						? input.addressee
						: null
				const addressee =
					wired ?? resolveAddresseeName(doc?.addressee, input?.cast as SessionCastRead | null)
				// One key per option — a repeated key is the model's slip and
				// the validator would refuse the block; the first wins.
				const seen = new Set<string>()
				const action =
					typeof input?.action === "string" && input.action ? input.action : undefined
				const actions = options
					.filter((o) => (seen.has(o.key) ? false : (seen.add(o.key), true)))
					.map((o) => ({
						fn,
						...(action ? { action } : {}),
						label: o.label,
						choice: o.key
					}))
				// What the question is about, by name (lair pass B12) — the
				// knock's room, read back by `read-answer` on the press's run.
				const referent =
					typeof input?.referent === "string" ? input.referent.trim() : ""
				// Where it was asked from (plan A27) — the room the Lair's
				// planner said the party stood in. Words only: a JSON port,
				// because it is read off a model's document.
				const vantage =
					typeof input?.vantage === "string" ? input.vantage.trim() : ""
				const block: MessageBlock = {
					kind: "choices",
					question,
					...(addressee ? { addressee } : {}),
					...(referent ? { referent } : {}),
					...(vantage ? { vantage } : {}),
					actions
				}
				return ok({ main: [block], blocks: [block], text: question, addressee })
			},
			{ ports: ["json", "fn", "action", "addressee", "cast", "referent", "vantage"] }
		),

		/**
		 * A form's answer, port by port, for the action it fired: the option's
		 * key and label, who answered and their row, the question, the values.
		 * Halts when the press carried no form — a fire naming no block, which
		 * no listing offers since the `form` venue (U5d review, S1) but a
		 * hand-made `sessions:fireAction` can still send.
		 */
		"core:task/read-answer@1": reads<typeof C.readAnswer>(
			async (input: NodeInput<typeof C.readAnswer>) => {
				const form = (input?.form ?? null) as {
					blockId?: string
					question?: string | null
					referent?: string | null
					vantage?: string | null
					addressee?: string | null
					characterId?: number | null
					choice?: string
					label?: string
				} | null
				if (!form || typeof form.blockId !== "string") {
					const sentence =
						"nothing to answer — this action was fired with no form; it answers a question a message put to you"
					notePeopleHalt(run.runId, sentence, sentence)
					return halt(sentence)
				}
				const values =
					input?.payload && typeof input.payload === "object"
						? (input.payload as Record<string, unknown>)
						: {}
				return ok({
					main: values,
					choice: form.choice ?? null,
					label: form.label ?? null,
					addressee: form.addressee ?? null,
					characterId: form.characterId ?? null,
					question: form.question ?? null,
					referent: typeof form.referent === "string" ? form.referent : "",
					vantage: typeof form.vantage === "string" ? form.vantage : null,
					values
				})
			},
			{ ports: ["payload", "form"] }
		),

		/**
		 * A model's JSON answer, read back as data.
		 *
		 * ## Three failures, one answer
		 *
		 * A fenced block, a preamble the model could not resist, and a reply cut
		 * off by the token limit are all "there is no readable answer here", and
		 * `extractJson` separates the third from the other two by walking brace
		 * depth rather than slicing to the last `}`. Every reader of a model's
		 * JSON goes through that one walker, so a trailing "hope that helps!"
		 * costs the same nothing everywhere.
		 *
		 * ## `err`, never `halt`
		 *
		 * The type declares `optional`, so an `err` is absorbed as
		 * `recoveredAsEmpty` with the reason on the receipt and every downstream
		 * port reads absent — a `map` over the missing list runs zero times, a
		 * template renders no block. A halt would stop the turn instead, which
		 * is the wrong cost: a planner that ignored its schema should lose the
		 * turn its plan, not its reply.
		 *
		 * ## `path` is what makes the answer wireable
		 *
		 * A data reference is `{node, port}` with no sub-path, so a `map` cannot
		 * iterate `plan.speakers` off a port carrying the whole document. `json`
		 * is always the document; `value` and `items` are whatever `path`
		 * selects, and `items` is that as a list so a map wired to it never has
		 * to defend itself.
		 */
		"core:task/parse-json@1": reads<typeof C.parseJson>(
			async (input: NodeInput<typeof C.parseJson>) => {
				const raw = typeof input?.text === "string" ? input.text : ""
				if (!raw.trim())
					return err(
						"there was nothing to read — the step above produced no text"
					)
				const { extractJson, JsonExtractionError } = await import(
					"$lib/server/utils/extractJson"
				)
				let json: unknown
				try {
					json = JSON.parse(extractJson(raw))
				} catch (e) {
					const truncated =
						e instanceof JsonExtractionError && e.truncated
					return err(
						truncated
							? "the answer stopped in the middle of its JSON, which usually means the reply hit its token limit"
							: "the answer was not readable as JSON"
					)
				}
				const path =
					typeof input?.params?.path === "string"
						? input.params.path.trim()
						: ""
				let value: unknown = json
				for (const segment of path ? path.split(".") : []) {
					if (value == null || typeof value !== "object") {
						value = undefined
						break
					}
					value = (value as Record<string, unknown>)[segment]
				}
				// A single value becomes a one-element list and an absent one an
				// empty list, so a `map` wired to `items` is always wired to a list.
				const items = Array.isArray(value)
					? value
					: value == null
						? []
						: [value]
				return ok({ main: json, json, value, items })
			},
			{ ports: ["text"], params: ["path"] }
		),

		/**
		 * The cut, and the one decision it is allowed to make.
		 *
		 * `batchTokens` is the admin's knob — *how many tokens of chat one draft
		 * is written against* — and it arrives through the node's `params` slot
		 * with the declared default already applied by the executor. The
		 * `sampling` slot is the drafting step's own, shared by reference so the
		 * window clamped against here is by construction the window the batch is
		 * sent against; `resolveBatchBudget` holds the arithmetic, shared with
		 * `summarizer/index.ts` so the two cannot drift again.
		 *
		 * ⚠ The reserve is no longer subtracted from the declared size. It was —
		 * `Math.max(batchTokens - 1500, 500)` — which made an admin asking for
		 * 2048 tokens of chat receive 548, contradicting the declaration's own
		 * words. The reserve is what the CLAMP accounts for now, so the number
		 * an admin types is the number of chat tokens they get.
		 */
		"core:task/batch-messages@1": reads<typeof C.batchMessages>(
			async (input: NodeInput<typeof C.batchMessages>) => {
				/**
				 * Each message's files named after its text (attachments
				 * follow-ups, owner ruling 2026-10-03) — before the cut, so
				 * the names count against the batch like the words do. A
				 * message with no files is the same object, so a transcript
				 * with none batches exactly as it did.
				 */
				const messages: any[] = withAttachmentNames(
					Array.isArray(input?.messages) ? input.messages : [],
					input?.attachments as any
				)
				const resolved = resolveBatchBudget({
					batchTokens: input?.params?.batchTokens,
					sampling: input?.sampling
				})
				// A window too small to hold the reserve plus a batch worth drafting
				// cannot be summarized against at all. Said out loud, once, rather
				// than sent as a prompt the model has no room for — which is what
				// this path did, with no truncation anywhere to catch it.
				if (!resolved.fits) return halt(resolved.reason)
				const budget = resolved.tokens
				/**
				 * The minimum under a cut: a batch never closes below this many
				 * messages unless the source is exhausted (the last batch is
				 * whatever is left). Declared since the node was written and read
				 * by nothing until R-12 (2026-09-16); the declared default of 1 is
				 * exactly the `current.length > 0` guard that has always run, so
				 * an install at defaults cuts the same batches it always did.
				 *
				 * Clamped at 1: a minimum of 0 would let an over-budget message
				 * open a batch and close it again on the next, which is the guard
				 * this replaces. Over the budget the minimum wins, deliberately —
				 * the person who set it asked for at least N messages per draft,
				 * and a prompt that runs long is visible where a draft written
				 * from one message is not.
				 */
				const minBatch = Math.max(
					1,
					Math.floor(Number(input?.params?.minBatchMessages) || 1)
				)

				const batches: any[][] = []
				let current: any[] = []
				let tokens = 0

				for (const msg of messages) {
					// Deliberately the flat estimate rather than the run's
					// tokenizer. This is not context fitting: it decides how many
					// messages go into one summarization batch, and the reserve that
					// keeps room for the prompt and the draft is accounted for in the
					// budget above. Making it exact would change nothing a person can
					// observe, and it would make `ctx` a parameter of a binding that
					// otherwise needs none.
					const cost =
						roughTokens(
							JSON.stringify({
								speaker: msg?.senderName ?? msg?.role,
								text: msg?.content ?? ""
							})
						) + 5
					if (current.length >= minBatch && tokens + cost > budget) {
						batches.push(current)
						current = [msg]
						tokens = cost
					} else {
						current.push(msg)
						tokens += cost
					}
				}
				if (current.length > 0) batches.push(current)

				// One empty batch rather than none: a map over nothing produces
				// nothing to synthesize, and "there is no summary" reads as a failure
				// when the honest answer is "there was nothing to summarize".
				const out = batches.length > 0 ? batches : [[]]
				return ok({ main: out, batches: out })
			},
			{
				ports: ["messages", "attachments", "sampling"],
				params: ["batchTokens", "minBatchMessages"]
			}
		),

		/**
		 * Phase 1, one batch.
		 *
		 * The user prompt comes from `summarizer/templates.ts` — the same
		 * builder the legacy path uses, called with the same arguments. That is
		 * the whole parity claim for this step: the rules, the `<content>`
		 * contract and the per-lore-type wording are not restated here, so they
		 * cannot drift from the path they are being migrated off.
		 *
		 * `loreType` is authored on the node rather than configured, because
		 * *which kind of entry this pipeline writes* is what distinguishes the
		 * four summarize namespaces from each other. It is not a user's to tune.
		 * A declared in-port carrying an authored literal, not a parameter —
		 * see the contract, which rules on why the call site settles it.
		 */
		"core:oracle/summarize-batch@1": reads<typeof C.summarizeBatch>(
			async (
				input: NodeInput<typeof C.summarizeBatch>,
				ctx: OracleCtx
			) => {
				// Which draft this is, from the each clause's own count (R-19):
				// the node cannot know its place otherwise, and a batch carries
				// no index. Outside an each — a spec drafting once — plain.
				if (ctx.iteration)
					ctx.status?.({
						...STATUS.summarisingPart,
						vars: {
							n: ctx.iteration.index + 1,
							total: ctx.iteration.count ?? ctx.iteration.index + 1
						}
					})
				/**
				 * 🚧 A batch that is TEXT (live scenes §13–§14): the
				 * genre-owned summarize-scene specs lay the transcript out
				 * with the genre's template and cut it into strings
				 * (`batch-messages@2`); their drafting rows place each with
				 * `{{batch}}`. A batch of message rows — world, character,
				 * history and the shared scene spec — takes the JSON path
				 * below, unchanged.
				 */
				const { systemPrompt, userPrompt } =
					typeof input?.batch === "string"
						? buildTranscriptBatchPrompt({
								transcript: input.batch,
								loreType: input?.loreType ?? "world",
								topic: input?.request?.topic,
								prompt: input?.prompts?.batch
							})
						: buildBatchPrompt({
								jsonMessages: formatMessagesAsJson(
									Array.isArray(input?.batch) ? input.batch : []
								),
								loreType: input?.loreType ?? "world",
								// From the wired `request` port. The flat `input.topic` that used
								// to sit behind it had no supplier (R-12).
								topic: input?.request?.topic,
								// The prompts slot, resolved through the scope chain. Blank falls
								// back to the template's own default, which is what the legacy
								// columns do — they default to "" and an unconfigured step must
								// fall back rather than send an empty system prompt.
								systemPromptOverride: input?.prompts?.batch?.trim()
									? input.prompts.batch
									: null
							})

				const result: any = await ctx.call({
					systemPrompt,
					userPrompt,
					...stepSlots(input),
					label: "summarize:batch"
				})
				if (!result?.text)
					return halt("the model returned nothing for this batch")

				// `<content>` unwrapped here rather than at synthesis: a draft is
				// what phase 2 merges, and handing it the tags as well would put the
				// contract's own scaffolding into the finished entry.
				const raw =
					parseSummaryOutput(result.text).content ?? result.text
				// The interior point (18 §4e): the user's `each-draft` chain runs
				// over every intermediate draft before synthesis reads it — slop
				// killed in the material summaries are built *from*. `ctx.scripts`
				// exists only because the descriptor declares the point; absent an
				// engine, the draft passes through untouched.
				const draft = ctx.scripts
					? await ctx.scripts.applyText("each-draft", raw)
					: raw
				return ok({ main: draft, draft })
			},
			{
				ports: [
					"batch",
					"request",
					"loreType",
					"prompts",
					"connection",
					"sampling"
				]
			}
		),

		/** Phase 2 — the ordered drafts, merged. */
		"core:oracle/summarize-synth@1": reads<typeof C.summarizeSynth>(
			async (
				input: NodeInput<typeof C.summarizeSynth>,
				ctx: OracleCtx
			) => {
				ctx.status?.(STATUS.mergingDrafts)
				const raw: any[] = Array.isArray(input?.drafts)
					? input.drafts
					: []
				// Order is load-bearing: the drafts are chronological slices and the
				// synthesis prompt asks the model to preserve that order. `part` is
				// the field the template names.
				//
				// A map block aggregates as `branch-results@1` — one entry per
				// iteration carrying `{branchKey, index, result}` in declaration
				// order (13 §1) — so each draft is unwrapped from its result
				// envelope. The bare forms stay accepted for callers that hand the
				// drafts over directly. A halted iteration contributes nothing
				// rather than an empty part the model would dutifully summarize.
				const drafts: JsonDraft[] = raw
					.map((d) => {
						if (typeof d === "string") return d
						const v = d?.result?.value ?? d
						return v?.draft ?? v?.main ?? ""
					})
					.filter((text: string) => text.length > 0)
					.map((draft, i) => ({ part: i + 1, draft }))

				const { systemPrompt, userPrompt } = buildSynthesisPrompt({
					jsonDrafts: JSON.stringify(drafts, null, 2),
					loreType: input?.loreType ?? "world",
					// From the wired `request` port alone — see `summarize-batch`.
					topic: input?.request?.topic,
					systemPromptOverride: input?.prompts?.synth?.trim()
						? input.prompts.synth
						: null
				})

				const result: any = await ctx.call({
					systemPrompt,
					userPrompt,
					...stepSlots(input),
					label: "summarize:synth"
				})
				if (!result?.text)
					return halt("the model returned nothing to synthesize into")

				const content =
					parseSummaryOutput(result.text).content ?? result.text
				return ok({ main: content, content })
			},
			{
				ports: [
					"drafts",
					"request",
					"loreType",
					"prompts",
					"connection",
					"sampling"
				]
			}
		),

		"core:oracle/name-entry@1": reads<typeof C.nameEntry>(
			async (input: NodeInput<typeof C.nameEntry>, ctx: OracleCtx) => {
				ctx.status?.(STATUS.namingEntry)
				const { systemPrompt, userPrompt } = buildNamePrompt({
					content: String(input?.content ?? ""),
					loreType: input?.loreType ?? "world",
					systemPromptOverride: input?.prompts?.name?.trim()
						? input.prompts.name
						: null
				})

				const result: any = await ctx.call({
					systemPrompt,
					userPrompt,
					...stepSlots(input),
					label: "summarize:name"
				})

				// A nameless entry is still an entry. The content is the valuable
				// part, and halting here would throw away a finished summary over
				// its title.
				const name = (result?.text ?? "").trim()
				return ok({ main: name, name })
			},
			{
				ports: [
					"content",
					"loreType",
					"prompts",
					"connection",
					"sampling"
				]
			}
		),

		/**
		 * The model decides who speaks (PLAN-turn-order R41, M4) — the oracle
		 * on the turn-order spec's model path. The prompt's instruction comes
		 * from the node's prompts slot; the binding appends the candidates
		 * (reference and name) and the recent conversation, and holds the
		 * answer to the candidates: a reference the pool did not admit is
		 * dropped with a note. No usable answer — a failed call, no order
		 * list, or a list naming nobody seatable — falls back to round robin,
		 * noted, never a halt: a model hiccup must not leave the session
		 * without an order. An empty list the model chose is its answer
		 * ("nobody now") and stands.
		 */
		"core:oracle/turn-advise@1": reads<typeof C.turnAdvise>(
			async (input: NodeInput<typeof C.turnAdvise>, ctx: OracleCtx) => {
				const messages = (input?.messages ?? []) as RotationMessage[]
				// The model orders the round, it does not extend it: only
				// candidates not yet heard from since the person last spoke are
				// asked about — round robin's own rule — so a `round` under the
				// model path ends when everyone has had their turn, instead of
				// running to the auto-advance cap on a model that keeps picking.
				const everyone = (input?.candidates ?? []) as TurnCandidate[]
				// ⏳ The cast lookup, from the candidates (member form once on).
				const refOfMember = seatRefLookupOfCandidates(everyone)
				const spoken = spokenRefsSince(messages, refOfMember)
				const candidates = everyone.filter((c) => !spoken.has(c.ref))
				const done = (order: TurnEntry[]) => ok({ main: order, order })
				if (!candidates.length) return done([])
				const fallback = (why: string) => {
					ctx.log("warn", `${why} — round robin stands`)
					return done(roundRobinEntries(candidates, messages, refOfMember))
				}

				// Names from every candidate — who already spoke this round is
				// still named in the transcript — and a person's line under their
				// persona (a persona is a character row, R15), so the model can
				// tell who said what (M4 review).
				const nameOf = new Map<string, string>()
				for (const c of everyone) nameOf.set(c.ref, c.name)
				const seatable = new Set(candidates.map((c) => c.ref))
				const who = (m: RotationMessage & { content?: unknown }) => {
					// ⏳ By seat: a person's line is its sender (`senderRefOf`), a
					// reply its seat by `castMemberId` (member form once on), else the
					// card form, then the projected speaker.
					const ref =
						m.role === "user"
							? senderRefOf(m, refOfMember)
							: ((m.castMemberId != null
									? refOfMember?.(m.castMemberId, "character-seat")
									: undefined) ??
								(m.characterId != null
									? `character:${m.characterId}`
									: (m.speaker ?? null)))
					return (ref && nameOf.get(ref)) || (m.role === "user" ? "User" : "Narrator")
				}
				const recent = messages
					.slice(-20)
					.map((m) => `${who(m)}: ${String((m as { content?: unknown }).content ?? "")}`)
					.join("\n")
				const participants = candidates.map((c) => `- ${c.ref}: ${c.name}`).join("\n")
				const systemPrompt =
					input?.prompts?.turnAdvice?.trim() ||
					'Decide who speaks next. Output ONLY {"order": ["<reference>", ...]} using the references given.'
				const userPrompt =
					`Participants who may speak:\n${participants}\n\n` +
					`Recent conversation:\n${recent || "(nothing yet)"}`

				// Its own deadline, inside the node's `timeoutMs` (60s): a call the
				// executor timed out would fail the run with no order written;
				// one this binding abandons falls back to round robin (M4 review).
				const ADVISE_DEADLINE_MS = 50_000
				let result: any
				try {
					result = await Promise.race([
						ctx.call({
							systemPrompt,
							userPrompt,
							...stepSlots(input),
							label: "turn-order:advise",
							// The answer's shape, carried as far as the connection
							// can (json_schema → json_object → the prompt's own
							// words): an `order` list whose items can only be the
							// references that may speak now, so a grammar-capable
							// backend cannot even spell a wrong one.
							schema: {
								type: "object",
								properties: {
									order: {
										type: "array",
										items: { type: "string", enum: [...seatable] }
									}
								},
								required: ["order"],
								additionalProperties: false
							}
						}),
						new Promise((_, reject) =>
							setTimeout(
								() => reject(new Error(`no answer in ${ADVISE_DEADLINE_MS / 1000}s`)),
								ADVISE_DEADLINE_MS
							).unref?.()
						)
					])
				} catch (e) {
					return fallback(
						`the model call failed (${e instanceof Error ? e.message : String(e)})`
					)
				}
				const refs = result?.json?.order
				if (!Array.isArray(refs)) return fallback("the model's answer had no order list")

				const order: TurnEntry[] = []
				const dropped: string[] = []
				for (const r of refs) {
					if (typeof r === "string" && seatable.has(r as TurnEntry["ref"] & string) && !order.some((e) => e.ref === r))
						order.push({ ref: r as TurnEntry["ref"], via: "model" })
					else dropped.push(String(r))
				}
				if (dropped.length)
					ctx.log("warn", `dropped ${dropped.join(", ")}: not a candidate this turn`)
				if (refs.length && !order.length)
					return fallback("the model's answer named nobody who may speak")
				return done(order)
			},
			{ ports: ["candidates", "messages", "prompts", "connection", "sampling"] }
		),

		"core:oracle/extract-cast@1": reads<typeof C.extractCast>(
			async (
				input: NodeInput<typeof C.extractCast>,
				ctx: OracleCtx
			) => {
				ctx.status?.(STATUS.findingCast)
				// From the wired `request` port. The flat `input.knownCast` that used
				// to sit behind it had no supplier (R-12); the `messages` in-port
				// this node declared and never read is culled with it — the
				// extractor works from `content`.
				const knownCast = Array.isArray(input?.request?.knownCast)
					? input.request.knownCast
					: undefined
				const { systemPrompt, userPrompt } =
					buildCharacterExtractionPrompt(
						String(input?.content ?? ""),
						input?.prompts?.characterExtraction?.trim()
							? input.prompts.characterExtraction
							: null,
						knownCast
					)

				const result: any = await ctx.call({
					systemPrompt,
					userPrompt,
					...stepSlots(input),
					label: "summarize:cast"
				})

				// The extraction contract is a raw JSON object, so a model that
				// wrapped it in prose is salvaged rather than lost — the host does
				// the salvaging, and an unparseable answer yields no cast rather
				// than a crash. An empty cast is a legitimate answer here.
				const parsed: any = result?.json ?? {}
				return ok({
					main: parsed,
					cast: {
						participants: parsed?.participants ?? [],
						mentioned: parsed?.mentioned ?? []
					}
				})
			},
			{
				ports: [
					"content",
					"request",
					"prompts",
					"connection",
					"sampling"
				]
			}
		),

		/**
		 * The keywords an entry is proposed to be found by — no model, no
		 * network, nothing it can invent.
		 *
		 * A wrapper around `proposeKeys`, like every other binding here: the
		 * rules, the gates and the measurements live in
		 * `ranking/keyProposal.ts`, and this only decides what the lorebook and
		 * the cast are.
		 *
		 * ⚠ **The reads are the ones `loreFor` makes, with the same arguments.**
		 * `currentCharacterId` is passed through rather than nulled, so the host
		 * withholds character lore that is not the speaker's own exactly as it
		 * does for retrieval. A key proposer that read *more* of the book than
		 * the ranker can would be a second visibility rule, free to disagree
		 * with the first — which is the shape of bug 2, arriving from the
		 * authoring side.
		 */
		"core:query/entry-keys@1": reads<typeof C.entryKeys>(
			async (input: NodeInput<typeof C.entryKeys>, ctx: CoreQueryCtx) => {
				const content =
					typeof input?.content === "string" ? input.content : ""
				const empty = { main: [], keys: [], rejected: [] }
				if (!content.trim()) return ok(empty)

				const [entries, cast] = await Promise.all([
					ctx.read("lorebook_entries", {
						sessionId: input?.scope?.sessionId,
						currentCharacterId:
							input?.scope?.currentCharacterId ?? null,
						...(input?.scope?.currentCastMemberId != null
							? { currentCastMemberId: input.scope.currentCastMemberId }
							: {}),
					}),
					// Read for its names alone — see `castEntityRefs`. A session
					// that no longer exists reads as `null`, which is an empty cast,
					// which is a proposer with one of its two guards missing rather
					// than one that fails.
					ctx.read("session_cast", {
						sessionId: input?.scope?.sessionId
					})
				])
				const rows: any[] = entries ?? []

				/**
				 * ⚠ **The entry being keyed must not be in its own corpus.**
				 *
				 * On the summarize path it cannot be — the row does not exist yet.
				 * On a re-key of a saved entry it would be, and its own text would
				 * put a guaranteed hit into every key's footprint, which is the one
				 * count the ceiling is measured against. Dropping the document that
				 * *contains* the passage is exact for that case and a no-op for the
				 * one where the row is absent.
				 */
				const documents = rows
					.map((e) => `${e?.name ?? ""} ${e?.content ?? ""}`.trim())
					.filter((d) => !d.includes(content))

				const proposal = proposeKeys({
					text: content,
					corpus: documents,
					cast: castEntityRefs(cast),
					// Entry titles are eligible keys and cast names are not: a thing
					// the book has a row for is a subject, a person in it is a
					// participant. Appended after the cast because `buildGazetteer`
					// lets the first claimant keep a name.
					entryNames: rows.flatMap((e) =>
						typeof e?.name === "string" && e.name.trim()
							? [
									{
										name: e.name.trim(),
										ref: {
											kind: "entry" as const,
											id: e.id
										}
									}
								]
							: []
					),
					options: {
						maxKeys: Math.max(
							0,
							input?.params?.maxKeys ?? MAX_KEYS
						),
						maxTermKeys: Math.max(
							0,
							input?.params?.maxOrdinaryWords ?? MAX_TERM_KEYS
						)
					}
				})

				// `main` carries the proposals themselves rather than the bare
				// strings, for `session-history`'s reason: an unrefined `$.keys`
				// should resolve to the useful thing, and what a review gate needs
				// is the evidence beside each key, not a list of words.
				return ok({
					main: proposal.keys,
					keys: proposal.keys,
					rejected: proposal.rejected
				})
			},
			{
				ports: ["scope", "content"],
				params: ["maxKeys", "maxOrdinaryWords"]
			}
		),
	}
}
