/**
 * Prompt-assembly bindings: card strokes, cue lines, the template context and
 * the context builders built on it (narrator, planner, scene, keeper, side
 * character), message processing, the prose transcript, attachment placement
 * and Assemble. `coreBindings()` spreads this map.
 *
 * Imports helpers from `bindings.shared.ts`, never from `bindings.ts`.
 */

import {
	cardFormRefInCast,
	storedSeatRefInCast,
	type SeatRefCast
} from "$lib/server/pipelines/prompt/seatCards"
import type { Bindings } from "@serene-pub/sdk"
import {
	ok,
	halt,
	reads,
	isParticipantRef,
	parseParticipantRef,
	canonicalParticipantRef,
	envoySlugOfRef,
	// 🚧 A collected clock step's door (§15 G6), the host's own check.
	clockStepRefusal
} from "@serene-pub/sdk"
import { i18nTextIn } from "$lib/shared/i18n/i18nText"
import { clockSpanWords } from "$lib/shared/lorebooks/storyDate"
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
import type { NodeInput, Supplied, TaskCtx } from "./bindingTypes"
import { placeAttachments } from "$lib/server/attachments/placement"
import { allocate, render } from "$lib/server/pipelines/prompt/assemble"
import {
	CORE_TEMPLATE_ENGINE,
	type RenderRun
} from "$lib/server/pipelines/prompt/renderers"
import { resolveContextInput } from "$lib/server/pipelines/prompt/promptFields"
import {
	CARD_STROKES_SCAN_DEPTH,
	resolveCastStrokes
} from "$lib/server/pipelines/prompt/cardStrokes"
import { processMessages } from "$lib/server/pipelines/prompt/messages"
import { type ChannelVoice } from "$lib/server/messages/channels"
import { resolvePostHistoryContext } from "$lib/server/pipelines/prompt/postHistory"
import type {
	AuthorsNoteDiag,
	AuthorsNoteTemplateContext,
	PostHistoryDiag
} from "$lib/server/pipelines/prompt/promptTypes"
import {
	AUTHORS_NOTE_DEPTH_DEFAULT,
	resolveAuthorsNoteContext
} from "$lib/server/pipelines/prompt/authorsNote"
import { stableExamplePick } from "$lib/server/pipelines/prompt/promptFields"
import {
	MESSAGE_SCAFFOLD_TOKENS,
	earlierBlockTokens,
	earlierScenesShown,
	holdCut,
	isCuttableLine,
	planTranscriptCut,
	promptTokens,
	transcriptCutNote
} from "$lib/server/pipelines/prompt/transcriptFit"
import {
	fallBackMedia,
	mediaBudgetNote,
	placedMediaTokens
} from "$lib/server/pipelines/prompt/mediaBudget"
import { buildTemplateContext } from "$lib/server/pipelines/prompt/templateContext"
import {
	locationVariables,
	sceneAnchor,
	slotGuide,
	stateSummary,
	withinEarshot,
	withinReach,
	withinSight
} from "$lib/server/pipelines/prompt/adventureContext"
import { castRelationshipsSection } from "$lib/server/pipelines/prompt/rankedRelationships"
import { promptFormatOf } from "$lib/shared/constants/PromptFormats"
import { cueLines as cueLinesOf } from "$lib/server/pipelines/speech/cueLines"
import { STATUS, readsOfDescriptor } from "./bindings.shared"

/**
 * What the person's own lines are called (lair re-plan R4), off the cast read
 * — already the session's override or the genre's `playerLabel`, resolved by
 * the host. Undefined for a genre that declares none.
 */
function playerLabelOf(cast: unknown): string | undefined {
	const label = (cast as { playerLabel?: unknown } | null | undefined)
		?.playerLabel
	return typeof label === "string" && label.trim() ? label.trim() : undefined
}

/**
 * An envoy's card, from the cast read's `envoys` (U5g): the name the seed
 * line and `{{char}}` carry, and the `{ name, description }` the character
 * card compiles from. Null unless `speaker` is an `envoy:` reference whose
 * seat the cast carries. English, deliberately: the prompt is what the model
 * reads, and the declaration's `en` is the one entry every locale map has.
 */
/**
 * `{{recentStory}}` (lair re-plan R6): transcript rows as prose — one
 * `Name: line` per row, named by the same processor the transcript uses
 * (the player label on a persona-less line included), JSON blocks cut, no
 * seed. What a speaker on another channel reads ABOUT the story; empty rows
 * give nothing, so a template's `{{#if recentStory}}` is false.
 */
function recentStoryOf(
	rows: unknown,
	cast: unknown
): { recentStory?: string } {
	const text = transcriptProseOf(rows, cast)
	return text ? { recentStory: text } : {}
}

/**
 * `{{sideTalk}}` (lair re-plan R13): the unplayed talk on another channel —
 * the Lair's Sanctum talk since the story's last line — as prose, exactly as
 * `{{recentStory}}` is, so a prompt renders it as its own labelled block and
 * never as turns. Absent when unwired or empty.
 */
function sideTalkOf(rows: unknown, cast: unknown): { sideTalk?: string } {
	const text = transcriptProseOf(rows, cast)
	return text ? { sideTalk: text } : {}
}

/**
 * `{{scratchpad}}` (lair re-plan R13): the speaker's own running notes — the
 * Castellan's annex field, already read for it alone. Absent when blank.
 */
function scratchpadOf(text: unknown): { scratchpad?: string } {
	return typeof text === "string" && text.trim() ? { scratchpad: text.trim() } : {}
}

/** Transcript rows as prose — one `Name: line` per row, named as the transcript names them; "" when none. */

function transcriptProseOf(rows: unknown, cast: unknown): string {
	if (!Array.isArray(rows) || !rows.length) return ""
	const result = processMessages({
		messages: rows as never,
		cast: (cast ?? {}) as never,
		charName: "",
		personaName: "",
		narratorName: (cast as { sessionNarratorName?: string } | undefined)
			?.sessionNarratorName,
		seed: false,
		plainProse: true
	})
	const text = result.messages
		.map((m) => {
			const line = typeof m.message === "string" ? m.message.trim() : ""
			return line ? `${m.name ? `${m.name}: ` : ""}${line}` : ""
		})
		.filter(Boolean)
		.join("\n")
	return text
}

function envoySpeakerCard(
	speaker: unknown,
	envoys: unknown
): { name: string; card: { name: string; description: string } } | null {
	const slug = envoySlugOfRef(speaker)
	if (!slug || !Array.isArray(envoys)) return null
	const seat = (
		envoys as Array<{
			slug?: string
			name?: unknown
			description?: unknown
		}>
	).find((e) => e?.slug === slug)
	if (!seat) return null
	const name = i18nTextIn(seat.name) ?? slug
	return {
		name,
		card: { name, description: i18nTextIn(seat.description) ?? "" }
	}
}

/**
 * 🚧 The reply's own label (2026-10-15): the voice the template context casts
 * the model as — its `{{char}}` — on Assemble's record as `replyLabel`, so
 * the dispatch can take a reply's echoed `Name:` off even when no seed line
 * was written (a prose transcript: a Dungeon Crawler Planner's lane). The
 * dispatch reads it only when the prompt carries no seed label and no
 * character speaks (`ownLabelsFor`). Absent when the context names nobody.
 */
const replyLabelOf = (templateContext: unknown): { replyLabel?: string } => {
	const name = (templateContext as { char?: unknown } | null | undefined)?.char
	return typeof name === "string" && name.trim() ? { replyLabel: name.trim() } : {}
}

/**
 * The row a side-character fact names, when it names one: its `characterId`
 * (a number, or digits), else its `ref` when that is a participant reference
 * — `character:<id>` names that row; any other reference (an envoy) names
 * somebody with no card. Undefined when the fact names nobody by row, so the
 * caller resolves it by name.
 */
function factIdentity(fact: {
	characterId?: unknown
	ref?: unknown
}): { id: number | null; ref: string } | undefined {
	const raw = fact.characterId
	if (
		typeof raw === "number" ||
		(typeof raw === "string" && /^\d+$/.test(raw))
	) {
		const id = Number(raw)
		return { id, ref: `character:${id}` }
	}
	if (typeof fact.ref !== "string" || !isParticipantRef(fact.ref)) return undefined
	const ref = canonicalParticipantRef(fact.ref)
	const parsed = parseParticipantRef(ref)
	return {
		id: parsed.kind === "character" ? participantRowId(parsed.id) : null,
		ref
	}
}

export function promptBindings(run: RenderRun = {}): Bindings {
	const bindings: Bindings = {
		/**
		 * Card strokes (DESIGN-card-strokes A.4): every stroked card in the
		 * cast gets its keyword strokes marked fired or not against the last
		 * `scanDepth` messages, through the lore keyword matcher
		 * (`prompt/cardStrokes.ts`). The builder after it then compiles the
		 * `always` + fired strokes only. Pure, and it never ranks or budgets.
		 *
		 * No diagnostics line: the definition declares `main` and `cast` and
		 * nothing else, and the resolved strokes on the cast ARE the receipt —
		 * each one carries its own `fired`.
		 */
		"core:task/card-strokes@1": reads<typeof C.cardStrokes>(
			async (input: NodeInput<typeof C.cardStrokes>) => {
				const cast = resolveCastStrokes(
					input?.cast ?? null,
					Array.isArray(input?.messages) ? input.messages : [],
					input?.params?.scanDepth ?? CARD_STROKES_SCAN_DEPTH
				)
				return ok({ main: cast, cast })
			},
			{ ports: ["cast", "messages"], params: ["scanDepth"] }
		),

		/**
		 * 🚧 **Cue a line** (speech build, seam S3) — the line's text as the
		 * speech cues it is spoken from. Pure and deterministic: `cueLines`
		 * (`pipelines/speech/cueLines.ts`) is regex and locale tables, so the same
		 * text, label and cast give the same cues. `inflection` takes a sprite
		 * pick as it is; `cast` takes names, a cast document, or a settings
		 * document carrying `.cast`.
		 *
		 * `speaker` is declared by the contract and used by `speak`, which names
		 * whose voice a `speaker` cue takes; this task never needs it (a `Name:`
		 * run is switched by `cast` alone), so it is listed in the read
		 * declaration but not consulted.
		 */
		"core:task/cue-lines@1": reads<typeof C.cueLines>(
			async (input: NodeInput<typeof C.cueLines>) => {
				const cues = cueLinesOf({
					text: typeof input?.text === "string" ? input.text : "",
					inflection: input?.inflection,
					cast: input?.cast,
					quoteStyles: Array.isArray(input?.params?.quoteStyles)
						? (input.params.quoteStyles as string[])
						: null,
					asterisks: input?.params?.asterisks,
					voices: input?.params?.voices as never,
					language:
						typeof input?.params?.language === "string" && input.params.language.trim()
							? input.params.language.trim()
							: null
				})
				return ok({ main: cues, cues })
			},
			{
				ports: ["text", "speaker", "inflection", "cast"],
				params: ["quoteStyles", "asterisks", "voices", "language"]
			}
		),

		/**
		 * Build the object a context template renders against.
		 *
		 * Pure — and it took a failing end-to-end run to make it so. The first
		 * version read the cast itself and died on `ctx.read is not a function`,
		 * because a Task is handed no services (F11) and the executor enforces it.
		 * That was the ledger catching a decomposition mistake, not an obstacle:
		 * the read is a read and belongs in `core:query/session-cast@1`, and what is
		 * left here is the part anyone should be able to replace — which characters
		 * appear, which get named, which scenario wins.
		 *
		 * The example-dialogue pick comes from `ctx.random`, the run-seeded RNG the
		 * SDK supplies to a type that declares randomness. The legacy builder calls
		 * `Math.random()` mid-compile, so the same turn compiled twice produces two
		 * different prompts and the receipt cannot say which examples went in. Same
		 * variety across turns, same answer twice within one.
		 */
		"core:task/build-template-context@1": reads<
			typeof C.buildTemplateContext
		>(
			async (
				input: NodeInput<
					typeof C.buildTemplateContext,
					Supplied<
						"fields",
						"a SIBLING BINDING supplies it: the four adventure wrappers at the bottom of this file call this handler with the variables their prompt rows interpolate, and each of their own definitions declares the `fields` in-port the value came in on. Undeclared on THIS definition on purpose — its supplier is code rather than a spec, and no spec that binds this pin directly wires one"
					>
				>,
				ctx: TaskCtx
			) => {
				// From the declared `cast` port alone. Every read below is a name
				// this definition declares: no `main` for the cast, no
				// `promptConfig` for the prompts slot, no flat `narratorName`, no
				// `characterLore` port (R-12).
				const cast = input?.cast
				if (!cast)
					return halt(
						"there is no cast to build a prompt context from — the session query " +
							"returned nothing, which usually means the session was deleted mid-run"
					)

				const random: () => number = ctx?.random ?? (() => 0)
				/**
				 * An **envoy's** turn (plans/29 R-18; U5g): the `speaker`
				 * port names `envoy:<slug>`, and the envoy has no character
				 * row — so its card is compiled here, where a cast member's
				 * would be, from the declaration the cast read carries:
				 * the name on the seed line and as `{{char}}`, the
				 * description as the card. Through the same `speakerName` /
				 * `speakerCharacter` seam a side character uses, so the
				 * resolver takes exactly the branch it already has. A
				 * `character:` reference changes nothing: `currentCharacterId`
				 * already says it.
				 */
				const envoyCard = envoySpeakerCard(
					input?.speaker,
					(cast as { envoys?: unknown }).envoys
				)
				const currentCharacterId =
					input?.currentCharacterId ?? cast.currentCharacterId ?? null
				// 🚧 A card-less seat's speaker (S4): no card names it, so the seat
				// is the cast row with no card whose host-filled `ref` is the
				// `speaker` — matched, never parsed. Its member is the speaker.
				// Unwired `speaker`: the cast's own `currentCastMemberId` (from the
				// run's scope, `session-cast@1`).
				const castSpeakerMember = (
					cast as { currentCastMemberId?: number | null }
				).currentCastMemberId
				const currentCastMemberId: number | null =
					currentCharacterId == null
						? typeof input?.speaker === "string"
							? ((
									(cast.sessionCharacters ?? []) as Array<{
										ref?: string | null
										castMemberId?: number | null
										character?: { id?: number | null } | null
									}>
								).find(
									(cc) =>
										cc?.ref === input.speaker &&
										cc.character != null &&
										cc.character.id == null
								)?.castMemberId ?? null)
							: (castSpeakerMember ?? null)
						: null
				const resolved = resolveContextInput({
					...cast,
					// The `prompts` slot, resolved through the scope chain by
					// `buildWorld`. Called `promptConfig` downstream because that is what
					// the field-selection rules take — the slot is where it came from,
					// not what it is.
					promptConfig: input?.prompts ?? {},
					currentCharacterId,
					currentCastMemberId,
					// Inside the prompts slot, where `build-narrator-context@1`
					// declares the field.
					narratorName: input?.prompts?.narratorName,
					// The side-character turn's speaker (ruling 2026-09-07).
					// Absent on every other pipeline, where both are undefined and
					// the resolver takes exactly the branches it always did.
					//
					// ⚠ Declared in-ports on `build-template-context@1` now (D-I),
					// which is what makes these four reads typed rather than
					// exempted. The supplier is still a sibling binding rather than
					// a spec: the side-character wrapper at the bottom of this file
					// unwraps its own `speaker` port and calls this handler with the
					// name and the card spread on. Declaring them is the only place
					// that fact is written down — an undeclared key arriving at a
					// handler reads exactly like a typo until someone opens both
					// files at once.
					speakerName: envoyCard?.name ?? input?.speakerName,
					speakerCharacter: envoyCard
						? envoyCard.card
						: input?.speakerCharacter,
					relationshipsPerspectives: input?.relationshipsPerspectives,
					relationshipsKnown: input?.relationshipsKnown,
					session: cast,
					// The turn's channel voice, on the cast read (R-C). Named
					// rather than left to the spread above so the one thing
					// this node takes off the cast that is a fact about the
					// TURN is visible at the call — see `HostScope.channel`.
					// Undefined for every genre that shapes no channel, which
					// is what keeps `seedName` byte-identical for them.
					turnChannelVoice: (
						cast as { turnChannelVoice?: ChannelVoice }
					).turnChannelVoice,
					/**
					 * The example dialogue, picked ONCE per session and speaker
					 * (B2, 2026-10-03) — never re-drawn from the run's seed, which
					 * is fresh every turn: a pick that changes moves the reminder
					 * block's bytes, and a backend that reuses its cache only on an
					 * exact prefix reprocesses everything after it. A regenerate
					 * or a swipe keeps it too. The run's random draw stays only for
					 * a cast read with no session behind it (a test's literal).
					 */
					pickExample: stableExamplePick(
						(cast as { sessionId?: unknown }).sessionId,
						// A card-less speaker keys by its member as a string
						// (`seated-member:<id>`), which no numeric card id equals.
						currentCharacterId ??
							(currentCastMemberId != null
								? `seated-member:${currentCastMemberId}`
								: null),
						random
					)
				})

				// The `variables` slot, resolved through the scope chain and already
				// dereferenced from row ids into template sources by `world.ts` —
				// the same treatment `prompts` gets, and for the same reason: this
				// node needs the template, not the number.
				const playerLabel = playerLabelOf(cast)
				// ⚠ Within earshot (R1) — computed once, read by the rooms'
				// location lookup and by the builder below.
				// 🚧 A `seated-member:` speaker is read as its seat's card form
				// (seat-cast S3), in both modes: `withinEarshot` reads a card id
				// off the speaker (`holderOf`, `prompt/adventureContext.ts`), so
				// ⏳ it stays card form until that reader takes member form.
				const heard = withinEarshot(
					input?.state,
					typeof input?.speaker === "string"
						? (cardFormRefInCast(cast as SeatRefCast, input.speaker) ?? input.speaker)
						: input?.speaker
				)
				const coreVariables: Record<string, unknown> = {
					...(playerLabel ? { playerLabel } : {}),
					...(typeof input?.turnDirection === "string" &&
					input.turnDirection.trim()
						? { turnDirection: input.turnDirection.trim() }
						: {}),
					// The rooms (lair re-plan R6): `{{knownLocations}}` and
					// `{{locationEntry}}`, exactly as the planner's surface
					// renders them — for the Castellan in the Sanctum.
					// Unwired everywhere else, where this adds nothing.
					...(input?.locationEntries !== undefined
						? locationVariables(input.locationEntries, heard as never)
						: {}),
					// The story's newest rows as prose (R6), `{{recentStory}}`
					// — background for a speaker on another channel, never
					// turns it continues. Absent when unwired or empty.
					...recentStoryOf(input?.recentStory, cast),
					// The speaker's own running notes (R13), `{{scratchpad}}`
					// — the Castellan's, read for it alone. Absent when blank.
					...scratchpadOf(input?.scratchpad)
				}
				const built = await buildTemplateContext({
					...resolved,
					variables: input?.variables,
					// The variables an authored prompt row interpolates beside
					// `{{char}}`: a genre's own fields, and whatever the surface
					// that called this computed for them. They have to arrive here
					// rather than be merged onto the answer, because `instructions`
					// is interpolated inside the builder — see `fields` there.
					//
					// `turnDirection` (lair pass B17): what the person typed
					// with a press that reads it as direction — Trigger trap,
					// Reveal. Joined here for the same reason: the prompt row
					// renders `{{#if turnDirection}}`. Absent when blank.
					//
					// `playerLabel` (lair re-plan R4): what the person's own
					// lines are called, off the cast read — `{{playerLabel}}`
					// in every context builder, since every one of them is
					// this handler. Absent for a genre that declares none.
					fields: Object.keys(coreVariables).length
						? {
								...((input?.fields as
									| Record<string, unknown>
									| undefined) ?? {}),
								...coreVariables
							}
						: (input?.fields as Record<string, unknown> | undefined),
					// Unwired on every shipped spec, which is why it is read
					// defensively rather than required: a chat has no state block
					// and must not grow one by declaring a port.
					//
					// ⚠ **Within earshot** (lair pass R1): a slot only its holder
					// may hear (the Lair's whisper) is taken off every member but
					// the one `speaker` names — nobody, on a trap, a reveal or a
					// room build. One of the two places state reaches a template;
					// `mergeContext` below is the other. See `withinEarshot`.
					state: heard,
					// 🚧 The session's AI replies before this one (AN1), for
					// the author's note's interval — on the cast read only for
					// a genre that declares the note (`host.ts`).
					replyCount: (cast as { replyCount?: unknown }).replyCount as
						| number
						| undefined,
					// Every layout here may be a plugin's engine, so the run rides
					// along — without it a cancelled run cannot stop them.
					...run
				})
				/**
				 * The book's story time (DESIGN-story-time P5 + the lorebook
				 * clock), off the cast read, for `assemble`'s `currentDate`:
				 * the line's stored clock wins over the newest allocated
				 * history entry, and a declared calendar spells it. Absent — no
				 * key — without a book, so a chat's context is unchanged.
				 */
				const storyTime = (cast as { storyTime?: unknown }).storyTime
				// And `{{playerLabel}}` for the assembly template too (R4) —
				// a template variable, not a port, so no type pin moves.
				const templateContext =
					storyTime || playerLabel
						? {
								...built,
								...(storyTime ? { storyTime } : {}),
								...(playerLabel ? { playerLabel } : {})
							}
						: built
				return ok({
					main: templateContext,
					templateContext,
					// Travels alongside the context rather than inside it: it is not
					// a template variable, it is the name on the line the model
					// continues from.
					seedName: resolved.seedName,
					// Reported so the receipt can answer "why did this prompt differ
					// from that one" without re-running anything.
					exampleDialogueIndex: resolved.exampleDialogueIndex
				})
			},
			{
				ports: [
					"cast",
					"currentCharacterId",
					"relationshipsPerspectives",
					"relationshipsKnown",
					"speakerName",
					"speakerCharacter",
					"speaker",
					"state",
					"turnDirection",
					"locationEntries",
					"recentStory",
					// The genre fields (R13): declared on this type now, read
					// by the handler below as every surface's are.
					"fields",
					"scratchpad",
					"prompts",
					"variables"
				]
			}
		),

		/**
		 * Name and interpolate the conversation, and add the seed.
		 *
		 * Pure, and it reuses `SessionMessageProcessor` rather than reimplementing it
		 * — the name-resolution chain reaches through removed participants to a
		 * name snapshotted at removal time, and a second version of that agrees on
		 * every session until someone leaves one.
		 */
		"core:task/process-messages@1": reads<typeof C.processMessages>(
			async (input: NodeInput<typeof C.processMessages>) => {
				const ctxValue = input?.templateContext ?? {}
				const result = processMessages({
					messages: input?.messages ?? [],
					cast: input?.cast ?? {},
					charName: ctxValue.char ?? "",
					personaName: ctxValue.user ?? "",
					// A line nobody claims, when the genre declares no
					// fallback envoy (ruled 2026-09-26) — off the cast read.
					narratorName: (
						input?.cast as { sessionNarratorName?: string } | undefined
					)?.sessionNarratorName,
					seedName: input?.seedName ?? ctxValue.seedName,
					// The other half of the seed decision, off the same cast
					// read the context builder resolved the name from (R-C) —
					// so "is there a seed row" and "whose name is on it" are
					// answered from one fact rather than two readings of the
					// history.
					turnChannelVoice: (
						input?.cast as
							| { turnChannelVoice?: ChannelVoice }
							| undefined
					)?.turnChannelVoice,
					continuationPrefill: input?.continuationPrefill
				})
				return ok({
					main: result.messages,
					messages: result.messages,
					includedIds: result.includedIds
				})
			},
			{
				ports: [
					"messages",
					"cast",
					"templateContext",
					"seedName",
					"continuationPrefill"
				]
			}
		),

		/**
		 * The same conversation, as prose, with no turn to continue.
		 *
		 * One implementation with the two differences on it as flags, rather
		 * than a second copy of the naming chain: `SessionMessageProcessor`
		 * reaches through participants who have since left to a name
		 * snapshotted at removal, and a second version of that agrees on every
		 * session until somebody leaves one.
		 */
		"core:task/prose-transcript@1": reads<typeof C.proseTranscript>(
			async (input: NodeInput<typeof C.proseTranscript>) => {
				const ctxValue = input?.templateContext ?? {}
				const result = processMessages({
					messages: input?.messages ?? [],
					cast: input?.cast ?? {},
					charName: ctxValue.char ?? "",
					personaName: ctxValue.user ?? "",
					narratorName: (
						input?.cast as { sessionNarratorName?: string } | undefined
					)?.sessionNarratorName,
					// The two that make this node what it is. No name is needed
					// for a line that is not written.
					seed: false,
					plainProse: true
				})
				return ok({
					main: result.messages,
					messages: result.messages,
					includedIds: result.includedIds
				})
			},
			{ ports: ["messages", "cast", "templateContext"] }
		),

		/**
		 * 🚧 Each line's attachments, placed (PLAN-composer-attachments §3.5;
		 * D2/D3). Pure: what the call reads arrives on its connection slot's
		 * descriptor as `metadata.reads` (computed by the one reading
		 * predicate, `attachments/readers.ts` `pairReads`, in `world.ts`), the
		 * way `assemble` reads `metadata.promptFormat`. An unwired slot reads
		 * no media, so every image is a name. Lines with no files come back
		 * as the same objects — see `attachments/placement.ts`. Imported
		 * statically: the contract's 1s budget is for placing, and a module
		 * load inside the timed body spends it.
		 */
		"core:task/place-attachments@1": reads<typeof C.placeAttachments>(
			async (input: NodeInput<typeof C.placeAttachments>, ctx: TaskCtx) => {
				const descriptor = input?.connection as
					| { metadata?: Record<string, unknown>; modelId?: unknown }
					| null
					| undefined
				const result = placeAttachments({
					lines: (input?.messages ?? []) as any[],
					attachments: (input?.attachments ?? {}) as any,
					reads: readsOfDescriptor(descriptor),
					mediaLookback: input?.params?.mediaLookback,
					textFileTokens: input?.params?.textFileTokens,
					countTokens: (t: string) => ctx.countTokens(t)
				})
				return ok({
					main: result.lines,
					messages: result.lines,
					notes: result.notes,
					// 🚧 O10: what went as media and its estimated cost — read by
					// the receipt; `assemble` counts it per line.
					placed: result.placed
				})
			},
			{
				ports: ["messages", "attachments", "connection"],
				params: ["mediaLookback", "textFileTokens"]
			}
		),

		/**
		 * Allocate and render.
		 *
		 * Pure, and rendering happens through core's own Handlebars — the same
		 * construction the legacy path uses — so a template behaves identically
		 * on both paths by construction rather than by review (assemble.ts).
		 *
		 * The context it renders against now arrives on a port, from
		 * `core:task/build-template-context@1` — so nothing on this path needs a
		 * `PromptBuilder`. What is still missing before it can replace the legacy
		 * path is the generation Provider and a corpus proving the two paths
		 * render the same bytes; rendering itself is no longer the gap.
		 */
		"core:task/assemble@2": reads<typeof C.assemble>(
			async (input: NodeInput<typeof C.assemble>, ctx: TaskCtx) => {
				ctx.status?.(STATUS.composing)
				const slot = input?.template
				/**
				 * The story string, and **only** a real string.
				 *
				 * ⚠ This was `String(slot?.source ?? slot ?? "")`, and that
				 * `String(...)` was quietly load-bearing in the worst way. A slot
				 * that resolved to nothing arrives as `{}` — an empty object, not
				 * undefined — so `slot?.source ?? slot` fell through to the object
				 * itself and `String({})` produced the literal text
				 * `"[object Object]"`. Truthy, so the halt below never fired; a
				 * valid Handlebars template, so the renderer accepted it; and the
				 * whole prompt for that run was the seven characters of a
				 * stringified empty object, sent to the model as prose.
				 *
				 * It is reachable on a real install: a pipeline config that never
				 * had a template selected stores no value for this slot, and it
				 * resolves to `{}` on that config's every run. (`bootstrapPipelines`
				 * does not return early on a changed declaration — it archives the
				 * old one and republishes the changed one, ruling 2026-09-10 — so a
				 * missing value here is a config nobody set, not a skipped boot
				 * pass.) The halt is the correct outcome, and it names the missing
				 * thing.
				 */
				const template =
					typeof slot === "string"
						? slot
						: typeof slot?.source === "string"
							? slot.source
							: ""
				if (!template)
					return halt(
						"assemble has no template — the template slot did not resolve to a " +
							"story string, so there is nothing to render into. Check that " +
							"this pipeline's configuration selects a context template."
					)

				/**
				 * The language the template is written in.
				 *
				 * A resolved row arrives as an object carrying `source` and
				 * `engine` together — `world.ts`'s `pushTemplate` emits both paths
				 * or neither, so an object with a source and no engine cannot be
				 * produced by the config layer. A bare **string** is the other
				 * case: an in-code author default, which has nowhere to record a
				 * language and is core's by construction.
				 *
				 * Anything else is a delivery fault and halts here rather than
				 * being guessed at. Guessing is what this whole change removes:
				 * `renderTemplate` used to answer "then it must be Handlebars", and
				 * that answer was wrong on every non-core template ever written,
				 * silently, for a whole release.
				 */
				const engine =
					typeof slot === "object" && slot !== null
						? slot.engine
						: CORE_TEMPLATE_ENGINE
				if (!engine)
					return halt(
						"assemble's template resolved to a row but carried no engine, so " +
							"there is no way to know what language it is written in. The " +
							"template slot must deliver `source` and `engine` together — " +
							"rendering it as Handlebars on a guess is how a foreign template " +
							"reaches the model as raw markup."
					)

				const decisions = input?.decisions ?? []
				// Candidates without decisions means the ranker was skipped. Rendering
				// anyway produces a prompt with every block missing and no error —
				// which is what the first parity run looked like, and it took a byte
				// comparison to notice. A halt names the missing node instead.
				if (!decisions.length && (input?.candidates ?? []).length)
					return halt(
						`assemble was given ${input.candidates.length} candidates but no ranking ` +
							`decisions. Wire a ranker (core:task/rank-hybrid@1) between retrieval and ` +
							`assembly — without one there is nothing that says which candidates fit ` +
							`the budget, and rendering would drop all of them silently.`
					)
				const allocation = allocate(decisions, {
					// The declared `budget` in-port. `params.budget`, a spelling the
					// schema never carried, used to sit behind it (R-12).
					budgetTotal: input?.budget?.total ?? 0,
					// The per-band groups the ranker computed, on a declared
					// in-port fed by a declared out-port (D-H). It was published by
					// `core:task/rank-hybrid@1` and wired by nobody, so this read
					// took `allocate`'s own `{}` on every run — two adjacent nodes,
					// one computing exactly what the other needed, with no edge
					// between them and nothing to say so, because neither port was
					// declared.
					//
					// ⚠ It moves no prompt. `allocate` copies this onto
					// `AllocatedContext.groups` and reads it nowhere else, so
					// `blocks`, `totalTokens` and `budget` are the same bytes either
					// way. What it fills in is `dispatch.ts`'s `sources` — the
					// budget panel's whole data set, empty until now.
					groups: input?.groups
				})
				// The reminder's position, resolved against the messages that are
				// actually going out. The context builder ships a placeholder index
				// because the final message array does not exist when it runs.
				let messages = input?.messages ?? []
				const ctxPostHistory = (input?.templateContext as any)
					?.postHistory
				let postHistory = ctxPostHistory
				/**
				 * The decision, for the receipt.
				 *
				 * The trigger is a suppression, and a suppressed reminder leaves no
				 * trace in the prompt: the only difference between "the trigger held
				 * it back" and "nobody configured one" is a block that is not there.
				 * This node is where the difference is known, so it is where it is
				 * written down.
				 */
				let postHistoryDiag: PostHistoryDiag | undefined
				if (ctxPostHistory?.hasContent && messages.length) {
					const resolved = await resolvePostHistoryContext({
						renderMessages: messages,
						instructions: ctxPostHistory.instructions,
						charInstructions: ctxPostHistory.charInstructions,
						exampleDialogue: ctxPostHistory.exampleDialogue,
						postHistoryDepth: input?.params?.postHistoryDepth ?? 0,
						postHistoryTokenTrigger:
							input?.params?.postHistoryTokenTrigger ?? 0,
						// Where the reminder lands is a function of how deep the
						// messages above it are, so it is context fitting and
						// measures with the run's tokenizer like everything else
						// that decides what fits.
						tokenCounter: {
							countTokens: (t: string) => ctx.countTokens(t)
						}
					})
					postHistory = resolved.postHistory
					postHistoryDiag = resolved.diagnostics
				}

				/**
				 * 🚧 The author's note (AN1), placed against the same messages
				 * by the same arithmetic — and decided on its own terms: no
				 * token trigger, an `interval` over the session's replies.
				 * Absent — no key, no diagnostic — when the context carries
				 * no note, which is every genre that declares none.
				 */
				const ctxAuthorsNote = (input?.templateContext as any)
					?.authorsNote as AuthorsNoteTemplateContext | undefined
				let authorsNote: AuthorsNoteTemplateContext | undefined
				let authorsNoteDiag: AuthorsNoteDiag | undefined
				if (ctxAuthorsNote && messages.length) {
					const resolved = resolveAuthorsNoteContext({
						renderMessages: messages,
						note: {
							text: ctxAuthorsNote.text ?? "",
							depth: ctxAuthorsNote.depth ?? AUTHORS_NOTE_DEPTH_DEFAULT,
							interval: ctxAuthorsNote.interval ?? 1,
							role: ctxAuthorsNote.role
						},
						replyCount: ctxAuthorsNote.replyCount
					})
					authorsNote = resolved.authorsNote
					authorsNoteDiag = resolved.diagnostics
				}

				/**
				 * The wire format this prompt is being written FOR.
				 *
				 * From the node's own `connection` slot, which every shipped spec
				 * wires to the SENDING Provider (`slot.connectionOf("generate")`) —
				 * so the format the render uses and the format the request goes out
				 * in are one value by construction, not two that must agree.
				 *
				 * ⚠ This read is the whole of the fix it belongs to. `input.
				 * promptFormat` used to be read here and no spec, no port and no
				 * slot ever supplied it: it was `undefined` on every run, so
				 * `renderers.ts` fell back to Vicuna and every ChatML, Llama-2,
				 * Alpaca and Claude connection was sent Vicuna markers — while
				 * `dispatch.ts` stamped the receipt with the connection's REAL
				 * format, so the receipt asserted a format the render had not used.
				 *
				 * `promptFormatOf` and not `??`: see its own note. A cleared
				 * `prompt_format` column is an empty string, and `"" ?? "vicuna"`
				 * is `""`, which `makeBlock` renders as ChatML.
				 *
				 * A slot that resolves to nothing — no connection registered, or a
				 * spec that did not wire it — arrives as `null`, and Vicuna is what
				 * this path has always produced in that case.
				 */
				const promptFormat = promptFormatOf(
					input?.connection?.metadata?.promptFormat
				)

				/**
				 * The template ROW, dereferenced by `world.ts` from the key above.
				 *
				 * ⚠ The key alone is not enough, and that was the second half of
				 * the same defect. `completionTemplateOf` resolves a bare key
				 * against the BUILT-INS, so a template an admin authored named no
				 * built-in and rendered as Vicuna: the format wire reached the
				 * render, and then the render could only find eight of the
				 * templates it might have been pointed at.
				 *
				 * Absent for a connection with no format at all, and for a world
				 * built before this field existed. Both fall through to the key
				 * below, which is what this path has always done.
				 */
				const completionTemplate =
					input?.connection?.metadata?.completionTemplate

				/**
				 * Which METHOD the sending connection wants to be called by.
				 *
				 * From the SAME slot as the two fields above — `slot.connectionOf(
				 * "generate")` — so the shape this render produces and the shape the
				 * Provider sends are one value rather than two that have to agree.
				 * That they did NOT agree is the defect: the render always produced
				 * one flat string, while a chat adapter branched on a local
				 * `extraJson` flag and looked for `messages` that were never built.
				 * Anthropic's empty-messages floor then filled in the word "Hello"
				 * and sent that in place of the assembled prompt.
				 *
				 * Absent for a caller with no connection in scope (the debug preview,
				 * the parity harness, a spec that did not wire the slot); `render`
				 * treats that as "the connection did not say", which leaves the
				 * template's own `renderMode` deciding exactly as before.
				 */
				const wireMode = input?.connection?.metadata?.wireMode
				// AN3: whether this connection's chat wire folds depth-placed
				// system text (`midSystemFor`, projected by `world.ts`).
				const midSystem = input?.connection?.metadata?.midSystem

				/**
				 * 🚧 *Earlier in the story*: the port's scenes, only a well-formed
				 * `{ maxTokens, scenes }` (malformed entries dropped, a malformed
				 * whole reads as no block). Which show is decided per render, from
				 * the first line that render keeps (`earlierScenesShown`).
				 */
				const earlierPort = (() => {
					const raw = (input as { earlierScenes?: unknown } | undefined)
						?.earlierScenes as
						| { maxTokens?: unknown; scenes?: unknown }
						| null
						| undefined
					if (!raw || typeof raw !== "object" || !Array.isArray(raw.scenes))
						return undefined
					const maxTokens =
						typeof raw.maxTokens === "number" && Number.isFinite(raw.maxTokens)
							? raw.maxTokens
							: null
					if (raw.maxTokens !== null && maxTokens === null) return undefined
					const scenes = (raw.scenes as unknown[]).flatMap((e) => {
						const x = e as
							| {
									name?: unknown
									summary?: unknown
									firstLineId?: unknown
									openedStoryClock?: unknown
							  }
							| null
						if (
							!x ||
							typeof x.name !== "string" ||
							typeof x.summary !== "string" ||
							typeof x.firstLineId !== "number" ||
							!Number.isFinite(x.firstLineId)
						)
							return []
						// A clock that is not well-formed reads as none; the scene stays.
						const c = x.openedStoryClock as Record<string, unknown> | null | undefined
						const part = (v: unknown) => v === null || typeof v === "number"
						const openedStoryClock =
							c &&
							typeof c === "object" &&
							typeof c.year === "number" &&
							Number.isFinite(c.year) &&
							[c.month, c.day, c.hour, c.minute].every((v) => v === undefined || part(v))
								? {
										year: c.year,
										month: (c.month as number | null | undefined) ?? null,
										day: (c.day as number | null | undefined) ?? null,
										hour: (c.hour as number | null | undefined) ?? null,
										minute: (c.minute as number | null | undefined) ?? null
									}
								: null
						return [
							{
								name: x.name,
								summary: x.summary,
								firstLineId: x.firstLineId,
								openedStoryClock
							}
						]
					})
					return scenes.length ? { maxTokens, scenes } : undefined
				})()
				const earlierCost = (e: { name: string; summary: string }) => {
					const text = JSON.stringify({ name: e.name, summary: e.summary })
					return typeof ctx?.countTokens === "function"
						? ctx.countTokens(text)
						: Math.ceil(text.length / 4)
				}
				const earlierCosts = earlierPort
					? earlierPort.scenes.map((e) => ({
							firstLineId: e.firstLineId,
							tokens: earlierCost(e)
						}))
					: []
				/** The scenes shown for a render of `lines`: older than its first cuttable line, within the share. */
				const earlierShownFor = (lines: typeof messages) => {
					if (!earlierPort) return []
					const first = (lines as any[]).find(isCuttableLine)
					return earlierScenesShown(
						earlierPort.scenes,
						first ? (first.id as number) : Infinity,
						earlierPort.maxTokens,
						earlierCost
					)
				}

				const renderWith = (
					lines: typeof messages,
					placedReminder: typeof postHistory,
					placedNote: typeof authorsNote
				) =>
					render({
						earlierScenes: earlierShownFor(lines).map(
							({ name, summary, openedStoryClock }) => ({
								name,
								summary,
								openedStoryClock
							})
						),
						allocation,
						postHistory: placedReminder,
						authorsNote: placedNote,
						template,
						blocks: input?.params?.blocks,
						// Resolved from the template slot, so a config written in a
						// plugin's engine renders with the plugin's assembler rather
						// than being run through core's (12 §2a).
						engine,
						prompts: input?.prompts,
						templateContext: input?.templateContext,
						// The template view of the annex, when a spec wired it
						// (typed templates P6; law T2 says only session-annex with
						// `view: 'template'` may). Absent otherwise, and then the
						// template's scope has no `annex` either.
						annex: input?.annex,
						// This node's own `variables` slot: how the lore and history
						// *it* produced are laid out. Separate from the context
						// builder's slot, because these are post-budget — what fits is
						// only known here.
						variables: input?.variables,
						messages: lines,
						promptFormat,
						completionTemplate,
						wireMode,
						midSystem,
						// The story string and this node's layouts both render here, and
						// both can be somebody's engine. Same reason as the context
						// builder above.
						...run
					})
				let rendered = await renderWith(messages, postHistory, authorsNote)
				// The block counts only where the template places it. A custom
				// template that leaves `earlierScenes` out, or a Prompt blocks
				// list with it switched off, renders no block: the cut must not
				// make room for one, and the receipt must not say it is there.
				const earlierPlaced =
					!!earlierPort &&
					rendered.usedVariables.includes("earlierScenes")

				/**
				 * 🚧 Placed media in the budget (O10, `prompt/mediaBudget.ts`):
				 * what placement estimated the lines' pictures and sounds cost
				 * is added to what was rendered; over the budget, media goes
				 * back to its names, oldest line first, BEFORE any line is
				 * cut — and the receipt says so. A prompt with no placed media
				 * is untouched.
				 */
				let mediaFit: Record<string, unknown> | undefined
				const mediaBudget = Number(input?.budget?.total ?? 0)
				let mediaLeft = placedMediaTokens(messages as unknown[])
				if (
					mediaBudget > 0 &&
					mediaLeft > 0 &&
					typeof ctx?.countTokens === "function"
				) {
					const textSize = promptTokens(rendered, (t) => ctx.countTokens(t))
					const over = textSize + mediaLeft - mediaBudget
					if (over > 0) {
						const fb = fallBackMedia(messages as any[], over, (t) =>
							ctx.countTokens(t)
						)
						if (fb.files) {
							messages = fb.lines as typeof messages
							rendered = await renderWith(messages, postHistory, authorsNote)
							const before = mediaLeft
							mediaLeft = placedMediaTokens(messages as unknown[])
							mediaFit = {
								files: fb.files,
								freed: fb.freed,
								media: before,
								measured: textSize + before,
								budget: mediaBudget
							}
							rendered = {
								...rendered,
								notes: [
									...(rendered.notes ?? []),
									mediaBudgetNote({
										files: fb.files,
										media: before,
										measured: textSize + before,
										budget: mediaBudget
									})
								]
							}
						}
					}
				}

				/**
				 * The conversation, fitted to the window (B2, 2026-10-03;
				 * `prompt/transcriptFit.ts`). Measured on what was RENDERED —
				 * only this node knows the finished size — and only when that
				 * is over the budget does anything change: the oldest lines are
				 * left out in a chunk, at a cut an earlier turn made when one
				 * still fits, the reminder and the note are placed again among
				 * the lines that remain, and the prompt is rendered again. A
				 * prompt that fits is returned exactly as rendered.
				 *
				 * The reminder's token trigger is NOT asked again: it was
				 * answered on the whole conversation, and a cut that made the
				 * conversation look shorter must not switch the reminder off.
				 */
				let transcriptFit: Record<string, unknown> | undefined
				// The lines the final render was handed, for the earlier-scenes note.
				let finalLines = messages
				const fitBudget = Number(input?.budget?.total ?? 0)
				const count = (t: string) => ctx.countTokens(t)
				// The executor always hands a counter; a binding called
				// directly (a unit test's literal ctx) may not, and then there
				// is nothing to measure with — the render stands as it is.
				if (
					fitBudget > 0 &&
					messages.length &&
					typeof ctx?.countTokens === "function"
				) {
					// 🚧 O10: the media still placed counts too.
					const measured = promptTokens(rendered, count) + mediaLeft
					const cuttable = (messages as any[]).filter(isCuttableLine)
					// Each line's cost is only worth counting once the prompt
					// is over: the ordinary turn pays one measurement.
					let plan = measured <= fitBudget ? null : planTranscriptCut({
						ids: cuttable.map((m) => m.id as number),
						tokens: cuttable.map(
							(m) =>
								count(`${m.name ?? ""}: ${m.message ?? ""}`) +
								MESSAGE_SCAFFOLD_TOKENS +
								placedMediaTokens([m])
						),
						total: measured,
						budget: fitBudget,
						...(earlierPort && earlierPlaced
							? {
									earlier: {
										scenes: earlierCosts,
										maxTokens: earlierPort.maxTokens,
										measured: earlierBlockTokens(
											earlierShownFor(messages),
											earlierCost
										)
									}
								}
							: {})
					})
					let from = 0
					let held = false
					let size = measured
					// A few passes at most: each one re-measures, and a
					// render that still does not fit cuts again from where
					// the last cut left it.
					for (let pass = 0; plan && pass < 4; pass++) {
						from += plan.from
						held = pass === 0 && plan.held
						holdCut(cuttable[from].id as number)
						const keep = new Set(cuttable.slice(from))
						const lines = (messages as any[]).filter(
							(m) => !isCuttableLine(m) || keep.has(m)
						) as typeof messages
						finalLines = lines
						let placedReminder = postHistory
						if (postHistory?.hasContent)
							placedReminder = (
								await resolvePostHistoryContext({
									renderMessages: lines,
									instructions: postHistory.instructions,
									charInstructions: postHistory.charInstructions,
									exampleDialogue: postHistory.exampleDialogue,
									postHistoryDepth: input?.params?.postHistoryDepth ?? 0,
									postHistoryTokenTrigger: 0,
									tokenCounter: { countTokens: count }
								})
							).postHistory
						const placedNote =
							ctxAuthorsNote && authorsNote
								? resolveAuthorsNoteContext({
										renderMessages: lines,
										note: {
											text: ctxAuthorsNote.text ?? "",
											depth: ctxAuthorsNote.depth ?? AUTHORS_NOTE_DEPTH_DEFAULT,
											interval: ctxAuthorsNote.interval ?? 1,
											role: ctxAuthorsNote.role
										},
										replyCount: ctxAuthorsNote.replyCount
									}).authorsNote
								: authorsNote
						rendered = await renderWith(lines, placedReminder, placedNote)
						size = promptTokens(rendered, count) + placedMediaTokens(lines as unknown[])
						// The receipt's placements follow the lines that went out.
						if (postHistoryDiag && placedReminder?.hasContent)
							postHistoryDiag = {
								...postHistoryDiag,
								targetIndex: placedReminder.targetIndex
							}
						if (authorsNoteDiag && placedNote && placedNote !== authorsNote)
							authorsNoteDiag = {
								...authorsNoteDiag,
								targetIndex: placedNote.targetIndex
							} as typeof authorsNoteDiag
						const rest = cuttable.slice(from)
						plan = planTranscriptCut({
							ids: rest.map((m) => m.id as number),
							tokens: rest.map(
								(m) =>
									count(`${m.name ?? ""}: ${m.message ?? ""}`) +
									MESSAGE_SCAFFOLD_TOKENS +
									placedMediaTokens([m])
							),
							total: size,
							budget: fitBudget,
							fresh: true,
							...(earlierPort && earlierPlaced
								? {
										earlier: {
											scenes: earlierCosts,
											maxTokens: earlierPort.maxTokens,
											measured: earlierBlockTokens(
												earlierShownFor(lines),
												earlierCost
											)
										}
									}
								: {})
						})
					}
					if (from > 0) {
						transcriptFit = {
							measured,
							budget: fitBudget,
							dropped: from,
							heldAt: cuttable[from].id,
							held,
							final: size
						}
						rendered = {
							...rendered,
							notes: [
								...(rendered.notes ?? []),
								transcriptCutNote({
									dropped: from,
									measured,
									budget: fitBudget,
									heldAt: cuttable[from].id as number,
									held
								})
							]
						}
					}
				}

				/**
				 * 🚧 The receipt's note for *Earlier in the story* (P1: the cause,
				 * and how to switch it off). Only when a scene lost a line from
				 * the final render; the ordinary payload is untouched.
				 */
				if (earlierPort && earlierPlaced) {
					const first = (finalLines as any[]).find(isCuttableLine)
					const firstKept = first ? (first.id as number) : Infinity
					const qualified = earlierPort.scenes.filter(
						(e) => e.firstLineId < firstKept
					)
					if (qualified.length) {
						const shown = earlierScenesShown(
							earlierPort.scenes,
							firstKept,
							earlierPort.maxTokens,
							earlierCost
						)
						const left = qualified.length - shown.length
						const scenesOf = (n: number) => `${n} scene${n === 1 ? "" : "s"}`
						const stop =
							"Leave Earlier in the story out under Prompt blocks to stop it."
						const note = shown.length
							? `earlier scenes: the ${shown.length === 1 ? "summary" : "summaries"} of ${scenesOf(shown.length)} ${shown.length === 1 ? "is" : "are"} in the prompt (${shown.map((e) => e.name).join(", ")}), because some of their lines are no longer in it.` +
								(left
									? ` ${left} older ${left === 1 ? "one was" : "ones were"} left out to keep the block within its share of the window (${earlierPort.maxTokens} tokens).`
									: "") +
								` ${stop}`
							: `earlier scenes: ${scenesOf(qualified.length)} lost lines from the prompt, but none of their summaries fit the block's share of the window (${earlierPort.maxTokens} tokens). ${stop}`
						rendered = {
							...rendered,
							notes: [...(rendered.notes ?? []), note]
						}
					}
				}

				return ok({
					/**
					 * `promptFormat` rides the payload, and that is what makes the
					 * receipt honest rather than plausible.
					 *
					 * `toCompiledPrompt` used to derive `meta.promptFormat` from the
					 * connection it had just resolved — a second resolution, on a
					 * second path (`resolveTaskConfig`), of a question this node had
					 * already answered. The two agree on the pipeline path by
					 * construction and are free to disagree on the legacy one, where
					 * the preview renders through the world manifest and the send
					 * resolves its own row. Reporting the value that was USED
					 * removes the disagreement instead of documenting it.
					 *
					 * ⚠ It rides on `rendered`, and the trailing `promptFormat` that
					 * used to be spread after it is GONE rather than tidied away. The
					 * render is what picks the template — in chat wire mode it renders
					 * `split_chat` and ignores the connection's delimiters entirely
					 * — so re-appending the value computed up here would have put the
					 * connection's format on a receipt for a prompt rendered in
					 * something else. The same lie, one layer along.
					 */
					main: { ...allocation, ...rendered, ...replyLabelOf(input?.templateContext) },
					context: { ...allocation, ...rendered, ...replyLabelOf(input?.templateContext) },
					/**
					 * ⚠ **Allocations, not blocks** — one retrieved item each, with
					 * its verdict, where a *block* is one message (NOMENCLATURE
					 * §15). A dozen of these render into the variables inside one
					 * block, so the old name described a container's granularity.
					 *
					 * Undeclared, like `budget` beside it: `ports.out` is `main` and
					 * `context`, so nothing core wires this and no shape check
					 * reaches it. The same array rides `main`/`context` as `.blocks`
					 * — that field is the SDK's word at the seam and is deliberately
					 * left alone (assemble.ts, NOMENCLATURE §24).
					 */
					allocations: allocation.blocks,
					budget: allocation.budget,
					/**
					 * Whether the post-history reminder went in, and on what
					 * numbers. Undeclared, like the two fields above it: nothing
					 * core wires this, and the receipt is the reader.
					 *
					 * Absent when this node made no decision — a context carrying
					 * no reminder at all, or a render with no messages to place one
					 * among. Absence is drawn as absence, so the inspector never
					 * reports a verdict that was never reached.
					 */
					...(postHistoryDiag ? { postHistory: postHistoryDiag } : {}),
					/**
					 * 🚧 Whether the author's note went in, where, and why not
					 * (AN1). Undeclared, like `postHistory` beside it: the
					 * receipt is the reader — the inspector, and the Author's
					 * note widget's last-reply line.
					 */
					...(authorsNoteDiag ? { authorsNote: authorsNoteDiag } : {}),
					/**
					 * Whether the conversation was cut to fit, by how much and
					 * where (B2). Undeclared, like the two above: the receipt is
					 * the reader. Absent when everything fit.
					 */
					...(transcriptFit ? { transcriptFit } : {}),
					/**
					 * 🚧 Whether placed media fell back to names to fit (O10),
					 * and on what numbers. Undeclared, like the three above.
					 */
					...(mediaFit ? { mediaFit } : {})
				})
			},
			{
				ports: [
					"template",
					"prompts",
					"variables",
					"connection",
					"candidates",
					"budget",
					"templateContext",
					"decisions",
					"messages",
					"groups",
					"annex",
					"earlierScenes"
				],
				// `truncation` left this schema (R-12): assemble drops nothing —
				// what fits is the ranker's `select`, per band.
				params: [
					"postHistoryDepth",
					"postHistoryTokenTrigger",
					"blocks"
				]
			}
		),
	}

	/**
	 * Both context builders, one implementation.
	 *
	 * They are separate *types* because they declare different configurable
	 * surfaces — see `buildNarratorContext` in contracts — not because they
	 * behave differently. Narrator mode is still chosen the way it always was,
	 * by there being no speaking character, and this function already handles
	 * both branches. Delegating rather than copying is what keeps "two
	 * surfaces" from quietly becoming "two implementations to keep in step".
	 *
	 * ⚠ Through an arrow rather than as the same function object, because the
	 * two pins READ differently and a read declaration attaches to the function
	 * (R-12): the narrator declares `cast` and `currentCharacterId` and none of
	 * the relationship or speaker ports, so its declaration is its own.
	 *
	 * `turnDirection` (genre uplift C2, 2026-09-29): what the person asked
	 * this narration to do — read by the shared handler exactly as it reads
	 * the Lair's (`{{turnDirection}}`, absent when blank).
	 */
	const templateContext = bindings["core:task/build-template-context@1"]!
	bindings["core:task/build-narrator-context@1"] = reads<
		typeof C.buildNarratorContext
	>(
		(input: NodeInput<typeof C.buildNarratorContext>, ctx: TaskCtx) =>
			templateContext(input, ctx),
		{
			ports: [
				"cast",
				"currentCharacterId",
				"turnDirection",
				"prompts",
				"variables"
			]
		}
	)

	/**
	 * The Adventure genre's four agent surfaces, on the same one implementation.
	 *
	 * They are separate *types* for a mechanical reason rather than a stylistic
	 * one: a shipped prompt is resolved per (node definition, slot) per spec, so four
	 * agents sharing a context type would ship four agents one set of
	 * instructions. What they add on top of the shared builder is one merge each
	 * — the facts the shared builder has no port for — and `mergeContext` is the
	 * one place that happens, so the four cannot come to disagree about how a
	 * key reaches a template.
	 *
	 * ⚠ Every extra key is a VARIABLE — something an authored prompt row and an
	 * authored template render (`{{tone}}`, `{{location}}`) and nothing else
	 * reads. None of them reaches the resolution input: `resolveContextInput`
	 * owns the card rules and nothing here may reach into them.
	 *
	 * ⚠ **Typed per surface, not `(input: any)`** (R-12, 2026-09-16). Each of
	 * the four registrations below is `NodeInput<its own definition>`, computes
	 * its variables from the ports IT declares, and carries a `reads`
	 * declaration naming exactly those — so a surface reading a port its
	 * definition does not carry fails to compile, where the untyped wrappers
	 * read `input.plan` on every surface and got `undefined` on two of them.
	 *
	 * @param prepared What the shared builder is asked — the surface's input,
	 *   or a re-shaped copy of it where the surface asks something different
	 *   (`asNarrator`, `asSideCharacter`).
	 * @param variables The facts this surface computed for its template.
	 */
	const mergeContext = async (
		prepared: { state?: unknown },
		/**
		 * Whose voice this prompt is (earshot, lair pass R1): a
		 * `character:<id>` reference for a cast member's own voice, `null`
		 * for every agent that is nobody's voice — the planner, the scene,
		 * the keeper. Decides which holder-only slots the state keeps.
		 */
		voice: string | null,
		/** The facts this surface computes for its template, from the state as it may hear it. */
		variablesFrom: (state: any) => Record<string, unknown>,
		ctx: TaskCtx
	) => {
		/**
		 * ⚠ **Within earshot, once, before anything reads the state** — the
		 * second of the two places state reaches a template (the shared
		 * builder is the first). The surface variables (`{{stateSummary}}`,
		 * `{{slots}}`, `{{location}}`) and the `{{state}}` the builder
		 * projects are both computed from what this voice may hear, so no
		 * prompt shows a whisper through one door that the other withheld.
		 * The builder filters again by the `speaker` it is handed, which
		 * takes nothing more away: a state already heard by this voice is
		 * what that voice hears.
		 */
		const state = withinEarshot(prepared.state, voice)
		const variables = variablesFrom(state)
		/**
		 * ⚠ **Handed to the builder, not merged onto its answer.**
		 *
		 * `instructions` is interpolated INSIDE the builder, so a shipped
		 * prompt saying "Difficulty is {{difficulty}}" rendered
		 * "Difficulty is " for as long as these were merged afterwards.
		 * The merge below stays, because the same keys are read by the
		 * assembly template; what changed is that the builder sees them
		 * first.
		 */
		const base = await templateContext(
			{
				...prepared,
				state,
				// The builder's own filter reads `speaker`: the same voice.
				speaker: voice,
				fields: variables
			},
			ctx
		)
		if (base.kind !== "ok") return base
		const value = base.value as {
			main: unknown
			templateContext: Record<string, unknown>
		}
		const merged = { ...value.templateContext, ...variables }
		return ok({ ...value, main: merged, templateContext: merged })
	}

	/**
	 * The genre's declared fields, by their own names.
	 *
	 * `{{tone}}` and `{{difficulty}}` are what a shipped Adventure prompt
	 * writes, and this is the step that makes them render: declared on the
	 * genre, edited in session settings, stored on the row, published by the
	 * input node, and read here off the surface's own `fields` port. Filtered
	 * to a plain object because it is a `json` port and a list or a string
	 * arriving there must not spread.
	 */
	const genreFields = (fields: unknown): Record<string, unknown> =>
		fields && typeof fields === "object" && !Array.isArray(fields)
			? (fields as Record<string, unknown>)
			: {}

	/**
	 * The facts every agent in a planned turn is given before it writes:
	 * `{{location}}`, `{{timeOfDay}}`, `{{weather}}`, `{{beats}}`,
	 * `{{stateSummary}}` and `{{slots}}`.
	 *
	 * Computed here rather than left to the template, because `state` and
	 * `plan` are STRUCTURE: a template writing `{{{state}}}` over an object
	 * renders `[object Object]`, which is exactly what the shipped narrator
	 * template did on every live turn. See `prompt/adventureContext.ts`.
	 *
	 * Gated on there being a state or a plan at all, so the one non-adventure
	 * pipeline that shares a surface here — `core:spec/story-side-character`,
	 * which wires neither — gets the context it always got, key for key.
	 *
	 * Takes the three ports by name rather than the whole input, so a surface
	 * whose definition declares no `plan` (the planner, the keeper) passes none
	 * rather than reading a key it does not declare.
	 */
	const adventureVariables = (scene: {
		// Port values are `any` by design (a `ShapeId` has no TS payload);
		// what is typed here is which NAMES a surface hands over.
		state?: any
		plan?: any
		cast?: any
	}): Record<string, unknown> => {
		if (!scene.state && !scene.plan) return {}
		const cast = scene.cast
		const names = (
			Array.isArray(cast?.sessionCharacters) ? cast.sessionCharacters : []
		)
			.map((cc: any) => cc?.character?.name)
			.filter((n: unknown): n is string => typeof n === "string")
		return {
			...sceneAnchor(scene.state, scene.plan),
			stateSummary: stateSummary(scene.state, names),
			slots: slotGuide(scene.state)
		}
	}

	/**
	 * This turn's direction (lair pass B11): what the person sent, for a genre
	 * that reads its composer as instructions — `{{turnDirection}}`. Absent
	 * when blank, so `{{#if turnDirection}}` is false on a turn nobody
	 * directed. Never bare `direction`: that is the Lair's standing-note slot.
	 */
	const turnDirectionOf = (turnDirection: unknown): Record<string, unknown> =>
		typeof turnDirection === "string" && turnDirection.trim()
			? { turnDirection: turnDirection.trim() }
			: {}

	/**
	 * How the cast stand with each other (genre plan F6(a), 2026-09-29):
	 * `{{castRelationships}}`, the cast-view ties the ranker admitted, as JSON
	 * keyed by holder and then by whom the view is of — at the indent the graph
	 * has always been shown at. Absent when nothing was admitted, so
	 * `{{#if castRelationships}}` is false on a band at share 0 or a cast with
	 * no ties. The planner's and the scene's alone: no voice declares the port.
	 */
	const castRelationshipsOf = (band: unknown): Record<string, unknown> => {
		const section = castRelationshipsSection(band)
		return section
			? { castRelationships: JSON.stringify(section, null, 1) }
			: {}
	}

	/**
	 * Whose lines a party call writes (the Lair's party speech, owner ruling
	 * 2026-09-30): `{{partySpeakers}}`, one line per speaker in order — the
	 * name the cast gives them (by row for a picked delver's
	 * `{ characterId }`, else the name the planner wrote), then what they
	 * mean to do when the fact says. A nested list is read flat, so
	 * `[first, rest]` off `split-first@1` arrives as one list. Absent when
	 * nobody is named, so `{{#if partySpeakers}}` is false.
	 */
	const partySpeakersOf = (
		list: unknown,
		cast: unknown
	): Record<string, unknown> => {
		const facts = (Array.isArray(list) ? list : list == null ? [] : [list])
			.flat()
			.filter(
				(f): f is Record<string, unknown> => !!f && typeof f === "object"
			)
		const lines = facts
			.map((fact) => {
				const who = sideCharacterIdentity({
					sideCharacter: fact,
					cast
				} as NodeInput<typeof C.buildSideCharacterContext>)
				const intent =
					typeof fact.intent === "string" ? fact.intent.trim() : ""
				if (!who.name) return ""
				return intent ? `${who.name} — ${intent}` : who.name
			})
			.filter(Boolean)
		return lines.length ? { partySpeakers: lines.join("\n") } : {}
	}

	/**
	 * 🚧 A collected clock step as the keeper reads it (§15 G6): `3 hours`,
	 * `2 hours back` — `{{clockStep}}`. Nothing for anything that is not a
	 * well-formed step, so a prompt's `{{#if clockStep}}` reads it absent.
	 */
	const clockStepOf = (raw: unknown): { clockStep?: string } => {
		if (clockStepRefusal(raw) !== null) return {}
		const { by, unit } = raw as { by: number; unit: string }
		return { clockStep: `${clockSpanWords(by, unit)}${by < 0 ? " back" : ""}` }
	}

	bindings["core:task/build-planner-context@1"] = reads<
		typeof C.buildPlannerContext
	>(
		async (input: NodeInput<typeof C.buildPlannerContext>, ctx: TaskCtx) =>
			mergeContext(
				input,
				// Nobody's voice: the planner hears no holder's slot.
				null,
				(state) => ({
					...genreFields(input?.fields),
					...adventureVariables({
						state,
						cast: input?.cast
					}),
					...turnDirectionOf(input?.turnDirection),
					...locationVariables(input?.locationEntries, state as never),
					// The unplayed side talk and the planner's own notes
					// (R13): `{{sideTalk}}`, `{{scratchpad}}` — each absent
					// when unwired, so a switched-off session renders neither.
					...sideTalkOf(input?.sideTalk, input?.cast),
					...scratchpadOf(input?.scratchpad),
					// How the cast stand with each other (F6(a)).
					...castRelationshipsOf(input?.castRelationships)
				}),
				ctx
			),
		{
			ports: [
				"cast",
				"state",
				"fields",
				"turnDirection",
				"locationEntries",
				"sideTalk",
				"scratchpad",
				"castRelationships",
				"prompts",
				"variables"
			]
		}
	)

	/**
	 * Nobody is speaking, and that is the whole of the narrator step.
	 *
	 * `resolveContextInput` keys everything off `currentCharacterId`: the card
	 * shown at full visibility, what `{{char}}` renders, and — the one that
	 * decides how the reply reads — the NAME on the line the model continues
	 * from. With the session's speaker still set, the narrator's prompt ended
	 * `Verity:` and the scene came back as Verity in the first person, however
	 * plainly the instructions said to narrate.
	 *
	 * Cleared on the cast bundle as well as on the input, because the speaker
	 * travels WITH the cast (`session-cast@1`) and the builder falls through to
	 * it. Clearing one of the two is clearing neither.
	 *
	 * The seed name then falls to the prompts slot's `narratorName`, which is
	 * the same rung `build-narrator-context@1` lands on and the reason that
	 * field is declared on this node's prompts slot.
	 */
	const asNarrator = (input: NodeInput<typeof C.buildSceneContext>) => {
		const cast = input?.cast
		return {
			...input,
			currentCharacterId: null,
			...(cast && typeof cast === "object"
				? { cast: { ...cast, currentCharacterId: null } }
				: {})
		}
	}

	bindings["core:task/build-scene-context@1"] = reads<
		typeof C.buildSceneContext
	>(
		async (input: NodeInput<typeof C.buildSceneContext>, ctx: TaskCtx) =>
			mergeContext(
				// 🚧 The party's reach (`placeSight: 'reach'`, owner ruling
				// 2026-09-30): the stats of the party's room and the rooms one
				// way on, before any variable reads the state. Absent: the
				// session's sight. ⏳ No core spec wires it since the Lair
				// rewrite retired the Castellan speaking for the party (R13);
				// the port is the contract's, so the host still honours it.
				input?.placeSight === "reach" && input?.state !== undefined
					? {
							...asNarrator(input),
							state: withinReach(input.state, input?.plan, input?.locationEntries)
						}
					: asNarrator(input),
				// Nobody's voice: the scene hears no holder's slot.
				null,
				(state) => ({
					...genreFields(input?.fields),
					...adventureVariables({
						state,
						plan: input?.plan,
						cast: input?.cast
					}),
					// What the planning step decided this turn is about, as
					// structure, for a template that wants to walk it. The
					// narrator reads its beats through `{{beats}}` instead, which
					// is text.
					plan: input?.plan,
					...turnDirectionOf(input?.turnDirection),
					// The room `{{location}}` names, the planner's hint included.
					...locationVariables(input?.locationEntries, state as never, input?.plan),
					// The unplayed side talk (R13), `{{sideTalk}}`: the
					// Castellan's narration, when the talk steers or Narrate
					// was pressed in the Sanctum. Absent when unwired.
					...sideTalkOf(input?.sideTalk, input?.cast),
					// How the cast stand with each other (F6(a)).
					...castRelationshipsOf(input?.castRelationships),
					// Whose lines a party call writes (the Lair's party speech).
					...partySpeakersOf(input?.partySpeakers, input?.cast)
				}),
				ctx
			),
		{
			ports: [
				"cast",
				"state",
				"plan",
				"fields",
				"turnDirection",
				"locationEntries",
				"sideTalk",
				"castRelationships",
				"partySpeakers",
				"placeSight",
				"prompts",
				"variables"
			]
		}
	)

	bindings["core:task/build-keeper-context@1"] = reads<
		typeof C.buildKeeperContext
	>(
		async (input: NodeInput<typeof C.buildKeeperContext>, ctx: TaskCtx) =>
			mergeContext(
				input,
				// Nobody's voice: the keeper hears no holder's slot.
				null,
				(state) => ({
					...genreFields(input?.fields),
					...adventureVariables({
						state,
						cast: input?.cast
					}),
					// The reply this keeper is reporting on. The transcript does
					// not carry it yet: it was written by the node immediately
					// above.
					reply:
						typeof input?.reply === "string"
							? input.reply
							: undefined,
					// 🚧 The span the player chose on *Time passes…* (live
					// scenes §15 G6), spelled — `{{clockStep}}`. Absent when
					// unwired, so Rest's and the reply keeper's render as
					// they did.
					...clockStepOf(input?.clockStep)
					// ⚠ `afterWrite` stays off the template context AND off the
					// read declaration. It is an ordering edge — the reply's
					// write result, taken on a port so this node runs after the
					// write rather than beside it — and a write result in a
					// prompt is a row id the model reads as prose. Allow-listed
					// in `boot/declaredReads.ts` as the one port a definition
					// declares for sequencing alone.
				}),
				ctx
			),
		{ ports: ["cast", "state", "reply", "fields", "clockStep", "prompts", "variables"] }
	)

	/**
	 * **Who the `sideCharacter` fact names** — the one resolution the card,
	 * `{{char}}`, the seed line and the `speaker` out-port all read.
	 *
	 * By row when the fact says so: its `characterId` (a Lair pick names the
	 * delver, lair pass B15) or its `ref`, a participant reference (a
	 * Whodunit Answer press names the suspect by the option it carried; plan
	 * A28 review). A fact that names a row IS that person — the name is a
	 * label and never a second lookup, so two suspects sharing a name stay
	 * two people, a renamed card is still them, and a row the cast does not
	 * seat is still the person it names rather than the first card whose
	 * name matches. Only a fact with no row resolves by name, and a name the
	 * cast does not hold is a free-form side character.
	 *
	 * - `seated` — the cast member whose card is compiled, or null;
	 * - `ref` — who the voice is, as a participant reference: the row the
	 *   fact named, else the seated match, else null (free-form);
	 * - `named` — whether the fact named anybody at all.
	 */
	const sideCharacterIdentity = (
		input: NodeInput<typeof C.buildSideCharacterContext>
	): {
		name: string
		seated: number | null
		ref: string | null
		named: boolean
		card: object | null
	} => {
		const fact = (input?.sideCharacter ?? {}) as {
			name?: unknown
			characterId?: unknown
			ref?: unknown
			character?: unknown
		}
		const cast = input?.cast as any
		const seats = Array.isArray(cast?.sessionCharacters)
			? cast.sessionCharacters
			: []
		// 🚧 (seat-cast S2) A `seated-member:<memberId>` ref is read as its
		// seat's card form first; nobody seated as that member → the fact
		// names no row, and resolves by name like any other.
		const given = factIdentity(
			typeof fact.ref === "string"
				? { ...fact, ref: cardFormRefInCast(cast, fact.ref) ?? undefined }
				: fact
		)
		const byRow =
			given?.id != null
				? (seats.find((cc: any) => cc?.character?.id === given.id)
						?.character ?? null)
				: null
		const name =
			typeof fact.name === "string" && fact.name.trim()
				? fact.name.trim()
				: typeof byRow?.name === "string"
					? byRow.name.trim()
					: ""
		// Matched on name and nickname alike: either can open a line in a
		// transcript, and a planner names whichever the conversation uses.
		const matches = (character: any) => {
			const known = [character?.name, character?.nickname]
				.filter((n: unknown): n is string => typeof n === "string")
				.map((n) => n.trim().toLowerCase())
			return known.includes(name.toLowerCase())
		}
		const seated = given
			? byRow
				? (byRow.id as number)
				: null
			: name
				? (seats.find((cc: any) => matches(cc?.character))?.character
						?.id ?? null)
				: null
		return {
			name,
			seated,
			// ⏳ The voice's seat ref: member form once `state/memberForm.ts` is on (the cast's seat answering the card), else as named.
			ref: ((): string | null => {
				const named = given ? given.ref : seated != null ? `character:${seated}` : null
				return named === null ? null : (storedSeatRefInCast(cast, named) ?? named)
			})(),
			named: !!given || !!name,
			card:
				fact.character && typeof fact.character === "object"
					? (fact.character as object)
					: null
		}
	}

	/**
	 * The third surface, and the one place the implementation genuinely differs.
	 *
	 * Not an alias, because this node takes a `speaker` in-port the other two do
	 * not have and the name on it has to reach `{{char}}` and the seed line.
	 * Everything after that is the shared builder called with two more fields —
	 * `resolveContextInput` owns both rules, so a side character's card and a
	 * cast member's are compiled by one function rather than two.
	 *
	 * ⚠ The speaker is read from the port and never invented here. A missing or
	 * malformed `speaker` degrades to the no-perspective branch — the narrator's
	 * — rather than halting: a turn with no name is a turn the trigger failed to
	 * shape, and the receipt shows an empty speaker on the input node, which
	 * says so far more precisely than a halt in the context builder would.
	 *
	 * ⚠ **The port decides who is speaking — the name, the card AND the id.**
	 *
	 * `resolveContextInput` keys everything off `currentCharacterId`: the card
	 * at full visibility, what `{{char}}` renders, the example dialogue, and the
	 * name on the line the model continues from. A spec that names a speaker on
	 * the port and leaves the session's own speaker in place is therefore asking
	 * for one person's turn and building another's prompt — which is what two
	 * voices in a multi-agent turn both seeded with the same name is.
	 *
	 * So the id is DERIVED from the port rather than taken beside it, which
	 * keeps one source for one fact: a name the cast holds resolves to that
	 * member, a name it does not resolves to nobody, and that second branch is
	 * the one a genuine side character takes so `speakerName` reaches the seed.
	 * A spec that wires no speaker at all keeps the session's, untouched.
	 */
	const asSideCharacter = (
		input: NodeInput<typeof C.buildSideCharacterContext>
	) => {
		const who = sideCharacterIdentity(input)
		const cast = input?.cast as any
		return {
			...input,
			speakerName: who.name || undefined,
			speakerCharacter: who.card,
			// Only when the port named somebody: a spec that wires no
			// speaker at all keeps the session's, which is every pipeline
			// this node served before the adventure genre existed.
			...(who.named
				? {
						currentCharacterId: who.seated,
						...(cast && typeof cast === "object"
							? {
									cast: {
										...cast,
										currentCharacterId: who.seated
									}
								}
							: {})
					}
				: {})
		}
	}

	/**
	 * ⚠ **Through `mergeContext` like its three siblings**, so a voice is told
	 * where it is standing and who else is there. Without it a voice answered
	 * from whatever the transcript suggested and walked the scene to a harbour
	 * the plan had never mentioned. `core:spec/story-side-character` wires neither
	 * `state` nor `plan`, so its context is unchanged key for key. This
	 * definition declares no `fields` port, so no genre fields are read here —
	 * which is what the untyped wrapper did too, one `undefined` later.
	 */
	bindings["core:task/build-side-character-context@1"] = reads<
		typeof C.buildSideCharacterContext
	>(
		async (
			input: NodeInput<typeof C.buildSideCharacterContext>,
			ctx: TaskCtx
		) => {
			const side = asSideCharacter(input)
			const voice = sideCharacterIdentity(input).ref
			// A voice reads the stats of the place the scene is at, and no
			// other place's (place sight's third looker, `withinSight`) —
			// before earshot and before any variable reads the state.
			const prepared =
				input?.state !== undefined
					? {
							...side,
							state: withinSight(input.state, input?.plan, input?.locationEntries)
						}
					: side
			const built = await mergeContext(
				prepared,
				// The one voice that is somebody's: the member this node
				// derived keeps the slots only they may hear (their whisper),
				// and nobody else's. A name the cast does not hold is nobody.
				voice,
				(state) => ({
					...adventureVariables({
						state,
						plan: input?.plan,
						cast: input?.cast
					}),
					// The rooms, when wired (lair pass R8): a voice names
					// the room it stands in now that nothing narrates it.
					...(input?.locationEntries !== undefined
						? locationVariables(input.locationEntries, state as never, input?.plan)
						: {}),
					// A room described only in prose (lair pass R9):
					// `{{locationPassage}}`, absent when blank.
					...(typeof input?.locationPassage === "string" &&
					input.locationPassage.trim()
						? { locationPassage: input.locationPassage.trim() }
						: {}),
					// What the person asked a side character's turn to do
					// (genre uplift C2): `{{turnDirection}}`, absent when
					// blank — wired by `narrate-character` alone.
					...turnDirectionOf(input?.turnDirection)
				}),
				ctx
			)
			if (built.kind !== "ok") return built
			/**
			 * ⚠ **The `speaker` out-port is the identity this node ALREADY
			 * derived** (W1, 2026-09-17), spelled as a participant reference —
			 * not a second resolution (`sideCharacterIdentity`).
			 *
			 * The same answer decides whose card is compiled and what `{{char}}`
			 * renders, so a lore lane in the same clause is told whose secrets
			 * this voice may read — `core:query/character-lore@1` wired
			 * `speaker: $.voices.item.context.speaker` beside it. A fact that
			 * named a row publishes that row, seated or not.
			 *
			 * ⚠ `null` for a free-form name the cast does not hold, and the lore
			 * read takes a null `speaker` as unwired: the run's scope decides
			 * (`speakerLore.int.test.ts` pins that rule). Where the scope is
			 * nobody — an action, a multi-agent turn — a free-form voice reads
			 * as the narrator: an open question (plan A28 review).
			 */
			return ok({
				...(built.value as Record<string, unknown>),
				speaker: voice
			})
		},
		{
			ports: [
				"cast",
				"sideCharacter",
				"state",
				"plan",
				"locationEntries",
				"locationPassage",
				"turnDirection",
				"prompts",
				"variables"
			]
		}
	)

	return bindings
}
