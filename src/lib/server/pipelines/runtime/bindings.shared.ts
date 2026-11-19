/**
 * Helpers more than one bindings module reads: the status texts, the band
 * intent read off a source's params, the cast vocabulary and its read shape,
 * a connection descriptor's media reads, the turn-order cast lookup built from
 * candidates, and a step's connection and sampling.
 *
 * A leaf: `bindings.ts` and every `bindings.*.ts` import these from here, and
 * this module imports from no bindings module.
 */

import { bandIntent, type BandIntent, type StatusText } from "@serene-pub/sdk"
import { bindingNames, type EntityRef } from "$lib/server/pipelines/ranking/entities"
import {
	DEFAULT_GROUPS,
	type BandKey
} from "$lib/server/pipelines/ranking/weights"
import {
	type SeatRefOfMember,
	type TurnCandidate
} from "$lib/server/pipelines/runtime/speakerRotation"

/**
 * The statuses core's handlers set (plans/29 R-19; 30 U5h) — what the person
 * watching reads on the reply row, the progress card and the session list
 * while a run works. Locale maps with `en`; the client resolves the language.
 * `{speaker}` is the one variable the HOST fills (`HOST_FILLED_STATUS_VARS`):
 * a handler is blind to who is speaking and stays so. Set at the honest
 * moments and nowhere else — a status persists until the next one, so a node
 * that says nothing leaves the last word standing. The built-in writes say
 * nothing: they are instant.
 */
const STATUS = {
	/** Retrieval — history, lore, the semantic search. */
	thinking: { i18n: { en: "{speaker} is thinking" } },
	/** Assembling the prompt. */
	composing: { i18n: { en: "{speaker} is composing" } },
	/** The turn-taking oracles, before the call. */
	typing: { i18n: { en: "{speaker} is typing" } },
	/** The drafts of a summary, one per batch — `{n}` and `{total}` from `ctx.iteration`. */
	summarisingPart: { i18n: { en: "summarising part {n} of {total}" } },
	/** The merge of a summary's drafts. */
	mergingDrafts: { i18n: { en: "merging the drafts" } },
	/** Naming the entry a summary produced. */
	namingEntry: { i18n: { en: "naming the entry" } },
	/** Reading who took part, for a scene summary. */
	findingCast: { i18n: { en: "finding who was there" } },
	/** A graph build's five steps — `{step}` is the step's own label. */
	buildingGraph: { i18n: { en: "building the graph: {step}" } },
	/** 🚧 O9: the transcribe step, hearing audio the reply cannot. */
	listening: { i18n: { en: "listening to the audio" } }
} satisfies Record<string, StatusText>

/**
 * A source's **band intent**, from its own `params` (R-7 P5).
 *
 * Read field by field over `DEFAULT_GROUPS` — the same table the ranker falls
 * back to for a band nothing declared — so a spec that never wired the
 * source's `params` publishes the declared numbers rather than an empty
 * intent, and the ranker cannot tell the two apart. `runtime/signalWiring.int.test.ts`
 * holds `DEFAULT_GROUPS` equal to what the five definitions declare.
 *
 * `params` is the node's own `params` for the five single-band sources, and a
 * per-band VIEW of them for `lorebook-triggers` (`TRIGGER_BANDS`), which
 * declares three intents under namespaced names in one slot.
 *
 * `maxEntries` is the one field read without a default when the band's
 * default is "no ceiling" (`relationships`): an absent value stays absent,
 * which `select` reads as uncapped, exactly as the query's own cap does.
 */
function bandIntentFrom(
	band: BandKey,
	params: any,
	/**
	 * Which fields the source DECLARES — an intent says only what its
	 * definition has a control for. The lore lanes carry no `minEntries`
	 * (R6: lore has no minimum), so they publish none rather than a zero.
	 */
	declared: { minimum: boolean }
): BandIntent {
	const p = params && typeof params === "object" ? params : {}
	return bandIntent(band, {
		share:
			typeof p.share === "number" ? p.share : DEFAULT_GROUPS.share[band],
		maxEntries:
			typeof p.maxEntries === "number"
				? p.maxEntries
				: DEFAULT_GROUPS.maxEntries[band],
		...(declared.minimum
			? {
					minEntries:
						typeof p.minEntries === "number"
							? p.minEntries
							: DEFAULT_GROUPS.minEntries[band]
				}
			: {}),
		priority:
			typeof p.priority === "string"
				? p.priority
				: DEFAULT_GROUPS.priority[band]
	})
}

/**
 * ⚠ **`castEntityNames` was here and is gone** — plan phase 3.
 *
 * It built the bare-string cast list `entityCooccurrenceSignal` matched by
 * substring, and it carried a careful argument for keeping *aliases out*: the
 * signal returned 1 on the first hit, so a name short enough to fall inside an
 * ordinary word made it fire on nearly everything, and every name added raised
 * the false-positive rate for all of them.
 *
 * That argument was about the matcher, and the matcher changed. `castEntityRefs`
 * below matches on word boundaries and resolves each hit to a row, so `Al` does
 * not fire on `Alchemy` and a character's name, nickname and absorbed aliases
 * are one entity rather than four — which is why it can carry the aliases the
 * old list could not. It is a strict superset of what this returned, so the
 * scoring signal loses no cast member by reading it instead.
 *
 * The `absorbedAliases` caution that shaped the old list still holds and is now
 * satisfied rather than avoided: `session_cast` carries that column, so both
 * halves of the union its schema note makes mandatory reach this seam.
 */

/**
 * What `ctx.read("session_cast")` returns, as much of it as this file names.
 *
 * ⚠ **It was `any`, and that is what let a phantom read survive.** A property
 * misspelt on an `any` is `undefined` at runtime and silent at build, so the
 * only thing standing between this seam and a vocabulary that quietly contains
 * nothing is that somebody types the shape out. Optional and nullable
 * throughout, because the host really can return `null` here — a session that no
 * longer exists — and every field below is one a caller may not have selected.
 */
interface SessionCastRead {
	sessionCharacters?: Array<{
		character?: {
			id?: number | null
			name?: string | null
			nickname?: string | null
			aliases?: unknown
		} | null
		/** Attached by the host from `lorebook_bindings`, not a cast column. */
		absorbedAliases?: unknown
		/** A departed seat, when the read carries the seat's row. */
		removedAt?: Date | string | null
		/** False for a seat switched off in the cast list; the read carries every seat. */
		enabled?: boolean | null
		/** 🚧 Host-filled identity (seat-cast S3/S4): the seat's participant ref, cast member and seat id. */
		ref?: string | null
		castMemberId?: number | null
		seatId?: number | null
	} | null> | null
	/** The characters this session's users voice — character rows. */
	sessionPersonas?: Array<{
		persona?: {
			id?: number | null
			name?: string | null
			nickname?: string | null
			aliases?: unknown
		} | null
		absorbedAliases?: unknown
		/** A departed presence, when the read carries the seat's row. */
		removedAt?: Date | string | null
		/** 🚧 Host-filled identity (seat-cast S3/S4): the seat's participant ref, cast member and seat id. */
		ref?: string | null
		castMemberId?: number | null
		seatId?: number | null
	} | null> | null
	/** The book's whole roster — see `castEntityRefs`. */
	lorebookBindings?: Array<{
		/** `lorebook_bindings.id` — the cast member's id, the key of a member with no live card. */
		id?: number | null
		characterId?: number | null
		/** The linked card is soft-deleted (`characters.is_deleted`); null or absent without a card. */
		cardDeleted?: boolean | null
		name?: string | null
		aliases?: unknown
		absorbedAliases?: unknown
	} | null> | null
}

/**
 * The names this session's world answers to, with the row each belongs to —
 * the gazetteer's first tier.
 *
 * **The only cast input the keyword mechanism has**, since plan phase 3 retired the
 * bare-string list beside it. It feeds the admission gate *and* the entity
 * scoring signal, which is the point: one vocabulary, matched one way, so the
 * two cannot disagree about whether the scene named somebody. It matches on a
 * word boundary and carries the row id, so a character's name and her nickname
 * are one entity instead of two and the count of distinct shared entities means
 * what it says.
 *
 * ## It reaches past the session's cast now, and why it must
 *
 * The old exclusion — *"no reaching past the session's cast"* — was the last
 * thing keeping this seam and `annotations/loadVocabulary` reading two different
 * vocabularies for one lorebook. Annotations resolve every binding in the book;
 * retrieval resolved only the seated ones, so a character the book binds but
 * this scene never seated was a name one subsystem knew and the other did not.
 * The `gazetteer_hash` those annotations are stored under is computed from the
 * annotation vocabulary, so the disagreement was not even observable from a
 * receipt. Both sides read bindings now, through the one `bindingNames` helper.
 *
 * ⚠ **Order is load-bearing, and it is: seated cast, then the rest of the
 * roster, then entry titles** (`keywordQuery` appends the third). `buildGazetteer`
 * lets the first claimant of a name keep it, so a character called "Vell" resolves
 * to the character rather than to an entry titled after her — and, between two
 * bindings claiming one name, to the one actually in the room. Widening the
 * source must not disturb that, which is why the roster is appended *after* the
 * cast rather than replacing it: every name the cast used to claim, it still
 * claims first.
 *
 * A binding with no live card — a background NPC the graph minted, or a member
 * whose card was soft-deleted — is a `cast_member:<binding id>` ref, exactly as
 * `loadVocabulary` keys it (★s4-ner-2), after the carded members.
 *
 * ⚠ **What this does not do is read the clause a name sits in.** Tier one
 * resolves *"the warden was already there"* and *"the warden was four days up
 * the road"* identically — measured, in `measure/vocabularyWidening.test.ts`,
 * along with what that costs. An unseated binding is likelier than a seated one
 * to be named in the abstract, so the widening loads that failure mode as well
 * as the recall it buys. The measurement is why it shipped anyway: on the
 * shipped `admitThreshold` of 0 the gazetteer cannot admit anything the keyword
 * scan did not, so the change is inert at defaults and priced only where an
 * install has turned the gate on.
 *
 * Exported for `castEntityRefs.test.ts` alone. The order it returns names in is
 * the whole of the precedence guarantee above and is invisible from the
 * pipeline's output — the gazetteer reports an entity's *text*, never which row
 * claimed it — so the only place that property can be asserted is here.
 */
export function castEntityRefs(
	cast: SessionCastRead | null | undefined
): Array<{
	name: string
	ref: EntityRef
}> {
	const out: Array<{
		name: string
		ref: EntityRef
	}> = []
	const add = (name: unknown, ref: EntityRef) => {
		const trimmed = typeof name === "string" ? name.trim() : ""
		if (trimmed && Number.isFinite(ref.id)) out.push({ name: trimmed, ref })
	}
	const list = (value: unknown): unknown[] =>
		Array.isArray(value) ? value : []
	for (const cc of cast?.sessionCharacters ?? []) {
		const id = cc?.character?.id
		if (id == null) continue
		const ref = { kind: "character" as const, id }
		add(cc?.character?.name, ref)
		add(cc?.character?.nickname, ref)
		for (const alias of list(cc?.character?.aliases)) add(alias, ref)
		for (const alias of list(cc?.absorbedAliases)) add(alias, ref)
	}
	for (const cp of cast?.sessionPersonas ?? []) {
		const id = cp?.persona?.id
		if (id == null) continue
		// A character, like the cast above — the voice is a role, not a kind.
		// Its own `name` only: `resolvePersonaName` reads no nickname, so a
		// nickname here would be a name nothing else in the prompt answers to.
		const ref = { kind: "character" as const, id }
		add(cp?.persona?.name, ref)
		for (const alias of list(cp?.persona?.aliases)) add(alias, ref)
		for (const alias of list(cp?.absorbedAliases)) add(alias, ref)
	}
	// The rest of the book, after the room. `bindingNames` is the shared
	// spelling of the `name` ∪ `aliases` ∪ `absorbedAliases` union the schema
	// note makes mandatory — the same one `loadVocabulary` calls.
	// 🚧 (★s4-ner-2) A member with a live card is that card (`character`); one
	// with no live card — card-less, or its card soft-deleted — is itself
	// (`cast_member:<binding id>`), as `loadVocabulary` keys it. Carded members
	// go in first and card-less ones next, so a card-less member never takes a
	// name a carded one holds.
	const roster = (cast?.lorebookBindings ?? []).flatMap((b) => {
		if (!b) return []
		const live = b.characterId != null && b.cardDeleted !== true
		const ref: EntityRef | null = live
			? { kind: "character", id: b.characterId as number }
			: b.id != null
				? { kind: "cast_member", id: b.id }
				: null
		return ref ? [{ b, ref, live }] : []
	})
	for (const live of [true, false])
		for (const m of roster)
			if (m.live === live)
				for (const name of bindingNames(m.b)) add(name, m.ref)
	return out
}

/**
 * What a resolved connection descriptor's pair reads (PLAN-composer-
 * attachments §5.2): the model's own verdict when the slot named one
 * (`metadata.readsByModel`), else the endpoint's (`metadata.reads`, judged on
 * the capability default's model when this is its endpoint — the pair
 * dispatch resolves a model-less slot to). `null` — reads no media — for an
 * unwired slot or a world that published no verdict.
 */
function readsOfDescriptor(
	descriptor:
		| { metadata?: Record<string, unknown>; modelId?: unknown }
		| null
		| undefined
): import("@serene-pub/sdk").ConnectionReadsV1 | null {
	const md = descriptor?.metadata
	if (!md) return null
	const byModel = md.readsByModel as Record<string, unknown> | undefined
	const modelId = descriptor?.modelId
	const own =
		modelId != null && byModel ? byModel[String(modelId)] : undefined
	const reads = (own ?? md.reads) as
		| import("@serene-pub/sdk").ConnectionReadsV1
		| undefined
	return reads && typeof reads === "object" ? reads : null
}

/**
 * ⏳ The cast lookup the turn-order rules take, built from the candidates the
 * pool admitted (the strategies hold no cast port): a candidate carries its
 * seat's `castMemberId` once `state/memberForm.ts` is on, so a row's cast
 * member answers the candidate's ref — a person's line the `persona`
 * candidate (`'player-seat'`), a reply the `character` one (`'character-seat'`),
 * no hint character before persona. Undefined while no candidate carries one
 * (the flip off): the rules then read the card form, as they always did.
 */
function seatRefLookupOfCandidates(
	candidates: readonly TurnCandidate[]
): SeatRefOfMember | undefined {
	const seats = candidates.filter(
		(c) =>
			typeof c.castMemberId === "number" &&
			(c.kind === "character" || c.kind === "persona")
	)
	if (!seats.length) return undefined
	return (castMemberId, seatKind) => {
		const mine = seats.filter((c) => c.castMemberId === castMemberId)
		const first = (kind: string) => mine.find((c) => c.kind === kind)
		const wanted = seatKind === "player-seat" ? "persona" : "character"
		const other = wanted === "persona" ? "character" : "persona"
		return (first(wanted) ?? first(other))?.ref
	}
}

/**
 * A step's own Connection and Sampling, on the way to `ctx.call`.
 *
 * ⚠ Neither was forwarded at all, and `dispatchStep` reads them off exactly
 * this payload — so every summarize and graph step ran on the capability
 * default no matter what its pickers said, while `core:task/batch-messages@1`
 * cut the transcript against the window of the config that WAS picked (it takes
 * the drafting step's slot by reference for that very purpose). The prompt was
 * sized for one model and sent to another.
 *
 * The two travel together on purpose: sending a config's temperature and
 * context window to a connection it was never chosen for is the same
 * divergence, one field along.
 *
 * Values, not ids — the host reduces them (`refId`), and for sampling that
 * reduction reads the row reference the executor carries beside the values.
 */
const stepSlots = (input: { connection?: unknown; sampling?: unknown }) => ({
	connection: input?.connection ?? null,
	sampling: input?.sampling ?? null
})

export {
	STATUS,
	bandIntentFrom,
	type SessionCastRead,
	readsOfDescriptor,
	seatRefLookupOfCandidates,
	stepSlots
}

/**
 * 🚧 `speakerInCast` as a lore read carries it to the host: omitted while on
 * (the host's default), `{ speakerInCast: false }` when the query that asked has
 * the param off. Every read that passes `knownToSpeaker` spreads this beside it,
 * so a pipeline that turns the switch off turns it off on every read of the run.
 * Core tools carry no params and follow the default.
 */
export function speakerInCastQuery(
	params: object | null | undefined
): { speakerInCast?: false } {
	return (params as { speakerInCast?: unknown } | null | undefined)
		?.speakerInCast === false
		? { speakerInCast: false }
		: {}
}
