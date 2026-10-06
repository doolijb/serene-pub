/**
 * ONE capability's view, as pure functions over the connections list.
 *
 * The view answers three questions and nothing else: what answers when this
 * capability is asked for, what else here could, and how to get something that
 * can. Every sentence, every row and every count on that screen is decided
 * here, so the component assembles nothing and branches on nothing.
 *
 * ## The verb, not the transform id
 *
 * A person standing in this view is thinking "what chats", not
 * "what satisfies `text->text`". The four section capabilities get a verb of
 * their own (chat · draw · embed · find entities) and everything else falls
 * back to **serve <label>**, which is deliberately flatter: a transform this
 * build has no opinion about should read as a machine capability rather than
 * borrow a warmth it has not earned.
 *
 * ## What the list can and cannot say about a switched-off model
 *
 * A model's `satisfiableCapabilities` is judged server-side as the merged pair
 * and is **empty** for a model that is switched off or that the host has
 * stopped listing (`satisfiableTransforms`, `server/sockets/connections.ts`).
 * So the client cannot ask what such a model *would* serve — which is why
 * those two states are counted rather than listed, and why the count is taken
 * over connections already known to serve the capability. The trailing line
 * says only what is true of them ("switched off or not listed") and never that
 * they could do this job.
 *
 * ⚠ Nothing here emits. **Use** is the same capability-default registration as
 * every other (§10), raised to the sidebar so the costed confirmation for
 * embeddings and entities still appears.
 */
import { capabilityTagline } from "@serene-pub/sdk"
import { outputKindOf } from "$lib/shared/capabilities/samplingShape"
import {
	defaultsSummary,
	pairState,
	resolvePair,
	type DefaultsSummaryEntry,
	type SummaryLocalState,
	type SummaryModel
} from "./defaultsSummary"
import type { CapabilityDefaultRef } from "./modelSystemDefaults"
import {
	serviceLabel,
	servesCapability,
	type IndexConnection,
	type IndexModel
} from "./connectionIndexFilter"
import type { ReadinessRow, ReadinessState } from "./readiness"
import { endpointKind, type EndpointKind } from "./modelManagement"
import { scopeForCapability } from "./finder"
import {
	formatContext,
	formatPrice,
	type ModelFacts
} from "$lib/shared/connections/modelFacts"
import { formatSize } from "./modelDisplay"
import { NER_CAPABILITY } from "$lib/shared/constants/ner"
import {
	localOnnxDisabledReason,
	type LocalOnnxAvailability
} from "$lib/shared/utils/connectionServiceItems"

/**
 * One model, as this view reads it: the index's fields plus the disk state the
 * summary reads, so a row can be handed to `pairState` and to
 * `servesCapability` without a second shape.
 */
export interface CapabilityModel extends IndexModel {
	local?: SummaryLocalState
	/** What the host said — context, price, size. See `modelFactLine`. */
	facts?: ModelFacts | null
	/** The admin's override, which wins over `facts.contextWindow`. */
	contextWindow?: number | null
}

export interface CapabilityConnection extends IndexConnection {
	models: CapabilityModel[]
}

/** The verb for the four sections. Everything else is "serve <label>". */
const VERBS: Record<string, string> = {
	"text->text": "chat",
	"text->image": "draw",
	"text->embedding": "embed",
	"text->entities": "find entities"
}

/**
 * What a READY capability means for what happens next, per kind.
 *
 * The two local modalities say what switching COSTS in the same breath, and
 * they say it here rather than in the confirmation dialog: a person reading
 * this card is deciding whether to switch, and the dialog arrives after they
 * already have. Everything else falls back to the SDK's tagline, which is
 * written for a person already.
 */
const READY_SENTENCES: Record<string, string> = {
	"text->text":
		"Every session replies with this unless its pipeline says otherwise.",
	"text->image":
		"Image steps draw with this unless a pipeline says otherwise.",
	"text->embedding":
		"Lore retrieval embeds with this. Switching re-embeds what is stored.",
	"text->entities": "Passages are scanned with this. Switching re-scans."
}

/**
 * The two capabilities whose default is spoken of as ACTIVE (§10).
 *
 * One embedding model and one entity model run app-wide, so "the default
 * embedding model" invites the question of what the non-default ones are doing.
 */
const ACTIVE_CAPABILITIES: ReadonlySet<string> = new Set([
	"text->embedding",
	"text->entities"
])

/** A `@lucide/svelte` export name per endpoint kind — `ConnectionRow`'s marks. */
const KIND_ICONS: Record<EndpointKind, string> = {
	"koboldcpp-managed": "Cpu",
	ollama: "Server",
	"onnx-embeddings": "Zap",
	"onnx-entities": "ScanText",
	api: "Cloud"
}

/** "Image editing" mid-sentence is "image editing". Acronyms are left alone. */
function lowerLabel(label: string): string {
	if (label.length > 1 && label[1] === label[1].toUpperCase()) return label
	return label.charAt(0).toLowerCase() + label.slice(1)
}

/** "chat" · "draw" · "embed" · "find entities" · "serve vision". */
export function capabilityVerb(capability: string, label: string): string {
	return VERBS[capability] ?? `serve ${lowerLabel(label)}`
}

/** The section's quiet label: "Also able to chat · 3 models". */
export function alsoAbleHeading(
	capability: string,
	label: string,
	count: number
): string {
	const verb = capabilityVerb(capability, label)
	if (!count) return `Also able to ${verb}`
	return `Also able to ${verb} · ${count} ${count === 1 ? "model" : "models"}`
}

/** The empty section's one sentence: "Nothing here can chat yet." */
export function nothingCanSentence(capability: string, label: string): string {
	return `Nothing here can ${capabilityVerb(capability, label)} yet.`
}

/** The same, for a capability that is set but has no alternative. */
export function nothingElseSentence(capability: string, label: string): string {
	return `Nothing else here can ${capabilityVerb(capability, label)} yet.`
}

/** "a" or "an", so the button below reads as English rather than as a template. */
function article(word: string): string {
	return /^[aeiou]/i.test(word) ? "an" : "a"
}

/**
 * The door to the model finder.
 *
 * "Get **another**" only where there already is one: a pub with nothing that
 * can chat is not being offered a second one, and the word is the difference
 * between an invitation and a non sequitur.
 */
export function getModelButtonLabel(label: string, empty: boolean): string {
	const lower = lowerLabel(label)
	return empty
		? `Get ${article(lower)} ${lower} model`
		: `Get another ${lower} model`
}

/**
 * The capabilities only a local ONNX model serves today: named entities. No
 * host has a token-classification endpoint, so the finder's `entities` scope
 * has one destination kind, ONNX. ⏳ Until LLM-prompted extraction on a text
 * connection (plan C3, ruled "later") gives entities a second provider.
 */
const LOCAL_ONNX_ONLY_CAPABILITIES: ReadonlySet<string> = new Set([
	NER_CAPABILITY
])

/**
 * Why there is nothing to get for this capability on this machine, or null:
 * a capability only local ONNX serves, where the runtime didn't load. A door
 * to the finder — the capability view's "Get a named entities model", the
 * first-run Named entities door — is disabled with this sentence rather than
 * opening a finder whose one destination is disabled.
 */
export function getModelDisabledReason(
	capability: string,
	localOnnx: LocalOnnxAvailability | null | undefined
): string | null {
	return LOCAL_ONNX_ONLY_CAPABILITIES.has(capability)
		? localOnnxDisabledReason(localOnnx)
		: null
}

/** The 12px note under it. */
/**
 * What the door under the candidate list actually does.
 *
 * ⚠ It promises a scope only where the finder HAS one. The finder's scopes are
 * the four modalities (`chat` · `images` · `embeddings` · `entities`); vision,
 * document reading, speech and the rest have none, and
 * `scopeForCapability` answers null for them — so the view opens on Chat.
 * Saying "scoped to vision" under a button that lands on Chat is the panel
 * telling a small lie about itself, and a person who notices stops trusting the
 * larger claims.
 */
export function finderNote(label: string, capability?: string | null): string {
	if (capability && !scopeForCapability(capability))
		return "Opens the model finder."
	return `Opens the model finder scoped to ${lowerLabel(label)}.`
}

/** "Default", or "Active" for the two one-per-install modalities. */
export function defaultChipLabel(capability: string): string {
	return ACTIVE_CAPABILITIES.has(capability) ? "Active" : "Default"
}

/** What a ready capability promises, or the SDK's tagline for the rest. */
export function readySentence(capability: string): string {
	if (READY_SENTENCES[capability]) return READY_SENTENCES[capability]
	let tagline: string | undefined
	try {
		tagline = capabilityTagline(capability as any)
	} catch {
		tagline = undefined
	}
	return tagline ?? "Nothing in this build asks for it yet."
}

/** The state card's one word, per readiness state. */
const STATE_WORDS: Record<ReadinessState, string> = {
	ok: "Ready",
	pending: "Downloading",
	warning: "Needs attention",
	unset: "Not set"
}

export function capabilityStateWord(state: ReadinessState): string {
	return STATE_WORDS[state]
}

/**
 * The sentence under that word.
 *
 * A READY capability says what it means for what happens next; every other
 * state says what the readiness row already said, because the fault and its
 * consequence are one sentence there and repeating half of it here would be
 * two sentences about one thing. ⚠ Minus the row's leading state word: the
 * card has just said "Not set" in its headline, so "Not set · sessions can't
 * reply" under it is that word twice — only the consequence is kept.
 */
export function statusSentence(row: ReadinessRow): string {
	if (row.state === "ok") return readySentence(row.capability)
	const word = `${STATE_WORDS[row.state]} · `
	return row.sentence.startsWith(word)
		? row.sentence.slice(word.length)
		: row.sentence
}

/**
 * The last clause of a row: where the model is, in one word or two.
 *
 * `pairState` says "ready" for anything that is not a local file, and "ready"
 * is the machine shrugging — a remote host LISTS a model, which is the
 * strongest thing anyone can say about it. Same substitution `readiness.ts`
 * makes, so the card and the rows under it use one vocabulary.
 */
export function factFromStateWord(stateWord: string): string {
	return stateWord === "ready" ? "listed" : stateWord
}

/** That clause for one model: loaded · on disk · listed · not listed · … */
export function modelFact(model: SummaryModel): string {
	const state = factFromStateWord(pairState(model).stateWord)
	// The state alone ("listed") is true of every row and so distinguishes
	// none of them — and this view IS the chooser: eight Claude models, each
	// row saying `Anthropic (Claude) · listed`, with nothing to pick on. The
	// host's own facts go first because those are what a choice turns on; the
	// state follows, and is dropped once there is anything better to say than
	// "the host still lists it".
	const facts =
		modelFactLine(model as { facts?: ModelFacts | null }) ||
		localCatalogLine(model.local)
	if (!facts) return state
	return state === "listed" ? facts : `${facts} · ${state}`
}

/**
 * Context, price and size, in that order, for one model. Empty when the host
 * said nothing — which is most of them, and reads as no line rather than a
 * line of dashes.
 */
export function modelFactLine(model: {
	facts?: ModelFacts | null
	contextWindow?: number | null
}): string {
	const parts: string[] = []
	const context = formatContext(
		model.contextWindow ?? model.facts?.contextWindow
	)
	if (context) parts.push(`${context} context`)
	const price = formatPrice(
		model.facts?.pricing?.inPerMTok,
		model.facts?.pricing?.currency
	)
	// In-price only: two prices on a row this narrow is a table, and the table
	// is what full page is for.
	if (price) parts.push(price === "Free" ? "Free" : `${price} in`)
	const size = formatSize(model.facts?.sizeBytes)
	if (size) parts.push(size)
	return parts.join(" · ")
}

/**
 * Size and dimensions for a local ONNX model, from its catalogue entry.
 *
 * A local model has no host to report `facts`, so without this the row read as
 * a bare state word ("on disk") beside every other row's context and price.
 */
export function localCatalogLine(local: SummaryLocalState | undefined): string {
	const catalog = local?.catalog
	if (!catalog) return ""
	const parts: string[] = []
	const bytes =
		local?.state === "on_disk" && local.sizeBytes
			? local.sizeBytes
			: catalog.sizeMb != null
				? Math.round(catalog.sizeMb * 1e6)
				: null
	const size = formatSize(bytes)
	if (size) parts.push(size)
	if (catalog.dimensions) parts.push(`${catalog.dimensions} dimensions`)
	return parts.join(" · ")
}

/** The mark for where the compute is — `ConnectionRow`'s table, one copy. */
export function kindIcon(type: string | null | undefined): string {
	return KIND_ICONS[endpointKind(type)] ?? "Cable"
}

/** The chip's word — one function app-wide, hoisted to the filter module. */
export { serviceLabel }

/**
 * One summary entry, with its two halves as THIS view reads them.
 *
 * `DefaultsSummaryEntry` carries the shapes that module reads — which do not
 * include the endpoint's `type`, and the tile and the service chip are both
 * decided by it.
 */
export interface CapabilityViewEntry
	extends Omit<DefaultsSummaryEntry, "connection" | "model"> {
	connection?: CapabilityConnection
	model?: CapabilityModel
}

/**
 * This capability's entry, whether or not the SDK declares the transform.
 *
 * `defaultsSummary` walks `TRANSFORMS`, so a transform it does not declare — a
 * plugin's — is absent from it; that case is resolved the same way and labelled
 * with the id, because a view that renders nothing is a worse answer than one
 * whose heading is ugly.
 *
 * ⚠ The halves are re-found on `rows` by id rather than taken from the summary
 * and cast. They are the same objects, but the summary's TYPE has forgotten the
 * endpoint's `type` — and a cast asserting otherwise would outlive whatever
 * makes it true today.
 */
export function capabilityEntry(
	rows: readonly CapabilityConnection[],
	defaults: Record<string, CapabilityDefaultRef | undefined> | undefined,
	capability: string
): CapabilityViewEntry {
	const resolved = resolvePair(rows, defaults?.[capability])
	const connection = resolved.connection
		? rows.find((r) => r.id === resolved.connection?.id)
		: undefined
	const model = resolved.model
		? connection?.models.find((m) => m.id === resolved.model?.id)
		: undefined
	const found = defaultsSummary(rows, defaults).entries.find(
		(e) => e.capability === capability
	)
	if (found) return { ...found, connection, model }
	const status = model
		? pairState(model)
		: { state: "unset" as const, stateWord: "not set" }
	return {
		capability,
		label: capability,
		outputKind: outputKindOf(capability),
		connection,
		model,
		set: !!(connection && model),
		state: status.state,
		stateWord: status.stateWord
	}
}

/** One (endpoint, model) pair the capability could be pointed at. */
export interface CandidateRow {
	connectionId: number
	/**
	 * Where this model is, in the words somebody gave it.
	 *
	 * ⚠ No **service chip** beside it, and that is not an oversight: R5 binds a
	 * row that STANDS FOR a connection, and this row stands for a model. The
	 * title is context for the name above it, and a chip on every row of a list
	 * grouped by connection is the same word printed down a column.
	 */
	connectionTitle: string
	/** A `@lucide/svelte` export name, resolved by the component. */
	icon: string
	/** The connection's type — its brand mark wins over `icon` (`connectionTypeIcon`). */
	connectionType: string | null
	modelId: number
	modelName: string
	/** The second line's last clause: loaded · on disk · listed · … */
	fact: string
	/**
	 * Whether **Use** may be offered. False for a local file that is still
	 * arriving or failed: the server refuses to register a local ONNX model
	 * that is not on disk, and a button the server will refuse is a lie.
	 */
	usable: boolean
}

export interface CandidateList {
	rows: CandidateRow[]
	/**
	 * Models on these connections that are switched off or missing from the host's list.
	 * A count, never rows — see the module header for why it cannot be a list.
	 */
	hidden: number
	/**
	 * Local models this capability could use once downloaded. A count, never
	 * rows: this view chooses between what is HERE, and the finder is where a
	 * download is chosen — the two lists stay apart (plan 2026-09-24 C2).
	 */
	toDownload: number
}

/** Rows past this are behind the "Show all N" toggle. */
export const CANDIDATE_LIMIT = 8

/**
 * Every pair that could serve this capability, minus the one that already does.
 *
 * Grouped by connection with the default's connection first — the person is
 * most likely swapping within the endpoint they already chose — and the rest
 * by title, so the order is the same on every visit. Within a connection the
 * server's order is kept: it is `sortOrder`, which somebody may have set.
 */
export function candidateRows(
	connections: readonly CapabilityConnection[],
	capability: string,
	current?: { connectionId?: number; modelId?: number }
): CandidateList {
	const serving = connections.filter((c) => servesCapability(c, capability))
	const ordered = [...serving].sort((a, b) => {
		const aCurrent = current?.connectionId === a.id
		const bCurrent = current?.connectionId === b.id
		if (aCurrent !== bCurrent) return aCurrent ? -1 : 1
		return (a.name ?? "").localeCompare(b.name ?? "", undefined, {
			sensitivity: "base"
		})
	})

	const rows: CandidateRow[] = []
	let hidden = 0
	let toDownload = 0
	for (const connection of ordered) {
		const title = connection.name ?? "Untitled connection"
		const icon = kindIcon(connection.type)
		for (const model of connection.models) {
			// The registered pair is on the card above, whatever state it is
			// in — counting it among the ones not shown would be counting it
			// twice, in a line that says it is not here.
			if (
				current?.connectionId === connection.id &&
				current?.modelId === model.id
			)
				continue
			if (!model.enabled || model.missingSince != null) {
				hidden++
				continue
			}
			if (!(model.satisfiableCapabilities ?? []).includes(capability))
				continue
			const localState = model.local?.state
			if (localState === "not_downloaded") {
				toDownload++
				continue
			}
			rows.push({
				connectionId: connection.id,
				connectionTitle: title,
				icon,
				connectionType: connection.type ?? null,
				modelId: model.id,
				modelName: model.name,
				fact: modelFact(model),
				usable: localState == null || localState === "on_disk"
			})
		}
	}
	return { rows, hidden, toDownload }
}

/** "5 more can be downloaded", or null at zero. */
export function toDownloadSentence(count: number): string | null {
	if (!count) return null
	return `${count} more ${count === 1 ? "is" : "are"} available to download`
}

/** "2 more are switched off or not listed", or null at zero. */
export function hiddenSentence(hidden: number): string | null {
	if (!hidden) return null
	return `${hidden} more ${hidden === 1 ? "is" : "are"} switched off or not listed`
}
