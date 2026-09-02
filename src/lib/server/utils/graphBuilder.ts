/**
 * Graph Builder — derive in memory, persist only at commit
 *
 * Per scene/entry:
 *   Pass 1   — Character resolution. ONE uniform rule over every input shape, because a
 *              lorebook's scenes were written by different versions of this app:
 *                 binding ids present  → direct lookup against the seed map (free)
 *                 name strings present → fuzzy-resolve against the seeded cast (free)
 *                 nothing stored       → extract from the summary (one LLM call), then resolve
 *              A name that matches nothing real becomes a *proposed* node with a fresh
 *              `new_N` tempId — never a DB row. Seeded bindings are a pre-seed of the cast,
 *              not its closed universe.
 *   Pass 2   — Per-character perspective: one LLM call per present character to extract
 *              relationships that changed or were newly established in this scene.
 *
 * NOTHING IN HERE TOUCHES THE DATABASE. Discovered characters live in an in-memory ledger
 * (`proposedByName`) so the same name resolves to the same proposed node across scenes; they
 * become real rows only if the user keeps them through review and applies. Cancel or discard
 * and the database is byte-for-byte unchanged. Output is a GraphProposal for review.
 */

import { getConnectionAdapter } from "./getConnectionAdapter"
import { resolveSampling } from "./resolveSampling"
import { TokenCounters } from "./TokenCounterManager"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
import { runQueuedLLMCall } from "./runQueuedLLMCall"
import { SessionTypes } from "$lib/shared/constants/SessionTypes"
import { extractCharactersFromContent } from "./summarizer"
import { extractJson, hasJsonObject } from "./extractJson"
import {
	resolveCharacterRefs,
	namesMatch,
	distinctiveWords
} from "./summarizer/availableSceneCast"
import type { CastEntry, ExtractedCastRef } from "./summarizer/templates"
import {
	DEFAULT_GRAPH_PERSPECTIVE_SYSTEM_PROMPT,
	GRAPH_PERSPECTIVE_RETRY_SYSTEM_PROMPT,
	DEFAULT_GRAPH_NODE_RESOLUTION_SYSTEM_PROMPT,
	DEFAULT_GRAPH_PRE_FILTER_SYSTEM_PROMPT,
	DEFAULT_GRAPH_NODE_DESCRIPTION_SYSTEM_PROMPT,
	DEFAULT_GRAPH_STATE_DETECTION_SYSTEM_PROMPT
} from "./graphPrompts"
import { buildPerspectiveSchema } from "./graphSchema"
import type { JsonSchemaNode } from "$lib/server/connectionAdapters/jsonSchemaToGbnf"
import type { ResponseFormat } from "$lib/server/connectionAdapters/BaseConnectionAdapter"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface GraphBuilderScene {
	id: number
	name: string | null
	summary: string | null
	historyEntryId: number | null
	historyEntry: {
		id: number
		year: number
		month: number | null
		day: number | null
	} | null
	/** Present when this item is a direct history entry (no associated scene) */
	sourceHistoryEntryId?: number
	/**
	 * Cast physically present. Normally lorebookBindings ids (written at
	 * summarization/scene-save time), but scenes predating the
	 * lorebookBindings/narrativeNodes merge still hold name strings here, and
	 * scenes predating cast extraction hold nothing at all. Pass 1 handles all
	 * three shapes — see the header. Typed to admit what the column can
	 * actually contain rather than what it ideally would.
	 */
	participantCharacters?: (number | string)[] | null
	/** Cast referenced but not present. Same three shapes as above. */
	mentionedCharacters?: (number | string)[] | null
	/** Session this scene was derived from — used for raw message fetching during node description generation */
	sessionId?: number | null
	/** Message IDs selected for this scene — used for raw message fetching during node description generation */
	selectedMessageIds?: number[] | null
}

export interface GraphBuilderSeedNode {
	/**
	 * Real lorebookBindings id. Always present now — post-merge, every seed
	 * (extend or replace mode) is already a real row, since binding IS the
	 * graph row. Previously this was optional with a separate `bindingId`
	 * field for replace-mode seeds that had no node row yet; that duality
	 * is gone (see the lorebookBindings/narrativeNodes merge plan).
	 */
	id: number
	name: string
	nodeState: string
	summary: string | null
	/** Combined alias names: node's own aliases column + non-hidden alias-child names */
	aliases?: string[]
}

/**
 * A World Lore entry, used only to screen newly-proposed character nodes.
 *
 * `category` is a free-text, nullable "grouping/filter tag" (schema.ts) with no
 * enforced taxonomy — in practice usually unset — so it cannot carry the
 * filter. It is honoured as a one-way OPT-OUT: an entry a user has tagged as
 * being about a person is not used to screen anything.
 */
export interface GraphBuilderWorldLoreEntry {
	name: string
	category?: string | null
}

export interface GraphBuilderSeedRelationship {
	fromNodeId: number
	toNodeId: number
	relationshipType: string
	visibility: string
	status: string
	description: string | null
	reason: string | null
}

/** Serializable snapshot of mid-build state captured before each scene's LLM calls. */
export interface GraphBuilderResumeState {
	sceneIndex: number
	nodeMap: [string, Sockets.NarrativeGraph.NodeProposal][]
	relMap: [string, Sockets.NarrativeGraph.RelationshipProposal][]
	nextNodeIndex: number
	seedTempIdMap: Record<string, number>
	seedRelKeys: string[]
	updatedSeedRelKeys: string[]
	newNodeTempIds: string[]
	newRelKeys: string[]
	nodeAliasMap: [string, string[]][]
	/**
	 * The in-memory cast ledger (normalized name → proposed tempId). Must be
	 * carried across a resume or the resumed half re-proposes characters the
	 * first half already discovered, duplicating them in the same proposal.
	 */
	proposedByName: [string, string][]
}

/** One LLM step the builder makes. Each is configurable independently. */
export type GraphStepName =
	| "nodeResolution"
	| "preFilter"
	| "perspective"
	| "nodeDescription"
	| "stateDetection"

/** Resolved prompt + model + sampling for a single step. */
export interface GraphStepConfig {
	/** Empty/blank falls back to the code default in graphPrompts.ts. */
	systemPrompt?: string | null
	connection?: SelectConnection | null
	sampling?: SelectSamplingConfig | null
}

/**
 * Code fallback per step, used when no graphBuildConfigs row resolves or when
 * its prompt column is blank — the columns default to "", so an unconfigured
 * step must fall back rather than send an empty system prompt.
 */
const GRAPH_STEP_FALLBACK_PROMPT: Record<GraphStepName, string> = {
	nodeResolution: DEFAULT_GRAPH_NODE_RESOLUTION_SYSTEM_PROMPT,
	preFilter: DEFAULT_GRAPH_PRE_FILTER_SYSTEM_PROMPT,
	perspective: DEFAULT_GRAPH_PERSPECTIVE_SYSTEM_PROMPT,
	nodeDescription: DEFAULT_GRAPH_NODE_DESCRIPTION_SYSTEM_PROMPT,
	stateDetection: DEFAULT_GRAPH_STATE_DETECTION_SYSTEM_PROMPT
}

export interface GraphBuilderInput {
	scenes: GraphBuilderScene[]
	/** Fallback connection/sampling for any step `steps` leaves unset. */
	connection: SelectConnection
	sampling: SelectSamplingConfig
	contextConfig: SelectContextConfig
	promptConfig: SelectPromptConfig
	/**
	 * Per-step overrides resolved from the active graphBuildConfigs row. Absent
	 * or partial is fine — each step independently falls back to the code
	 * prompt and to `connection`/`sampling` above.
	 */
	steps?: Partial<Record<GraphStepName, GraphStepConfig>>
	/** Existing graph nodes to seed the LLM context with (extend mode only) */
	seedNodes?: GraphBuilderSeedNode[]
	/** Existing relationships to seed the LLM context with (extend mode only) */
	seedRelationships?: GraphBuilderSeedRelationship[]
	/** World Lore entries used to screen newly-proposed character nodes. */
	worldLore?: GraphBuilderWorldLoreEntry[]
	onProgress?: (data: Sockets.NarrativeGraph.Build.Progress) => void
	onLlmCall?: (entry: Sockets.NarrativeGraph.TraceEntry) => void
	signal?: AbortSignal
	/** Called at the start of each scene (before any LLM calls) with the current build state snapshot. */
	onSceneStart?: (state: GraphBuilderResumeState) => void
	/** If provided, restore this checkpoint and resume the build from its sceneIndex. */
	resumeState?: GraphBuilderResumeState
	/** Fetch raw messages for a scene — called during node description generation for newly introduced nodes */
	fetchSceneMessages?: (
		sessionId: number,
		messageIds: number[]
	) => Promise<Array<{ senderName: string; content: string }>>
}

/**
 * A scene whose cast this build had to derive (legacy name strings, or nothing
 * stored at all). Reported so apply can write the resolved ids back onto the
 * row — turning a one-time extraction into a permanent fast path — but only
 * once the user has actually committed the proposal.
 *
 * Carries tempIds, not ids, because a discovered node has no id until apply
 * INSERTs it; apply maps them through the same tempIdMap it uses for
 * relationships.
 */
export interface ResolvedSceneCast {
	sceneId: number | null
	historyEntryId: number | null
	participantTempIds: string[]
	mentionedTempIds: string[]
}

/**
 * Why a build produced the number of relationships it did.
 *
 * Purely diagnostic — deliberately NOT part of GraphProposal, which is the
 * thing apply commits; this describes the run, not the data. It rides on the
 * activity alongside sceneLabels/seedNodeNames instead.
 */
export interface RelationshipDiagnostics {
	/** Perspective calls actually issued — the denominator for everything else. */
	perspectiveCalls: number
	/** Scenes skipped for having no second character to relate anyone to. */
	scenesSkippedNoPair: number
	noJson: number
	badJson: number
	notArray: number
	missingType: number
	missingTarget: number
	/** Entries whose source was a third party, not the perspective character. */
	wrongSource: number
	/** Reversed pairs repaired by swapping rather than dropped. */
	/** Perspective calls re-issued after a non-JSON response. */
	retried: number
	/** Retries that then produced usable JSON. */
	retriedRecovered: number
	/** Named targets that matched no character in their scene, deduped. */
	unresolvedTargets: string[]
}

export interface GraphBuilderResult {
	proposal: Sockets.NarrativeGraph.GraphProposal
	sceneLabels: string[]
	/** Scenes whose cast was derived rather than read — see ResolvedSceneCast. */
	resolvedSceneCast: ResolvedSceneCast[]
	/** Maps seed tempIds (e.g. "existing_5") → real DB node id. Empty in replace mode. */
	seedTempIdMap: Record<string, number>
	/** Maps seed tempIds → display name so the review UI can label relationships involving existing nodes. */
	seedNodeNames: Record<string, string>
	/** Attribution for an empty or thin relationship set — see RelationshipDiagnostics. */
	relationshipDiagnostics: RelationshipDiagnostics
	/**
	 * Proposed names that matched a World Lore entry and were NOT created.
	 * Reported so a false positive is visible and recoverable — never dropped
	 * in silence.
	 */
	filteredWorldLoreNames: string[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildMinimalSession(userPrompt: string): any {
	return {
		id: 0,
		userId: 0,
		name: null,
		createdAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		scenario: null,
		metadata: null,
		lorebookId: null,
		isGroup: false,
		sessionType: SessionTypes.SUMMARIZE,
		groupReplyStrategy: null,
		sessionMessages: [
			{
				id: 1,
				sessionId: 0,
				role: "user",
				content: userPrompt,
				createdAt: new Date().toISOString(),
				isHidden: false,
				isGenerating: false,
				metadata: null
			}
		],
		lorebook: {
			id: 0,
			userId: 0,
			name: "",
			description: null,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			lorebookBindings: []
		}
	}
}

async function runLLM(
	systemPrompt: string,
	userPrompt: string,
	opts: {
		connection: SelectConnection
		sampling: SelectSamplingConfig
		contextConfig: SelectContextConfig
		promptConfig: SelectPromptConfig
	},
	label?: string,
	responseSchema?: JsonSchemaNode,
	responseFormat: ResponseFormat = "json"
): Promise<string> {
	const AdapterClass = await getConnectionAdapter(opts.connection.type)
	// Honor the connection's own configured tokenizer — see the identical
	// fix/comment in generateResponse.ts.
	const tokenCounter = new TokenCounters(
		(opts.connection as any).tokenCounter || TokenCounterOptions.ESTIMATE
	)
	const tokenLimit: number =
		(opts.connection as any).tokenLimit ??
		(opts.connection as any).contextSize ??
		4096

	const fakeSession = buildMinimalSession(userPrompt)

	const adapter = new AdapterClass.Adapter({
		connection: opts.connection,
		// The adapter takes VALUES; the row is kept here because it is also
		// what names the config in the queue (samplingName, below).
		sampling: resolveSampling(opts.sampling),
		contextConfig: opts.contextConfig,
		promptConfig: { ...opts.promptConfig, systemPrompt },
		session: fakeSession,
		currentCharacterId: null,
		tokenCounter,
		tokenLimit,
		contextThresholdPercent: 0.9
	})

	// Every call this builder makes must come back as a JSON object. Each
	// adapter translates this into whatever its provider supports; ones that
	// support nothing ignore it and the prompt + retry path still applies.
	//
	// Assigned rather than passed to the constructor on purpose — see
	// BaseConnectionAdapter.responseFormat. The default is "text", so session and
	// every other caller are unaffected by this line existing.
	// Defaults to "json" because most calls here parse one. NOT every call does:
	// node descriptions are prose ("exactly two sentences in present tense"), and
	// constraining those to a JSON object made the model wrap its prose to
	// satisfy the decoder — `{"introduction": "The Glimmer-Scuttler is …"}` was
	// stored verbatim as a node summary and rendered to the user that way. A
	// grammar wins against the prompt, so any call whose result is not parsed as
	// JSON must opt out here.
	adapter.responseFormat = responseFormat
	// When the caller supplies a shape, the constraint tightens from "any JSON
	// object" to exactly that shape. Adapters whose providers cannot take a
	// schema ignore it and stay at object level — see
	// BaseConnectionAdapter.responseSchema.
	if (responseSchema && responseFormat === "json")
		adapter.responseSchema = responseSchema

	const { text } = await runQueuedLLMCall({
		adapter,
		taskType: "graph_perspective",
		connectionName: opts.connection.name,
		samplingName: opts.sampling.name,
		label
	})
	let raw = text

	// Strip any trailing FAILURE messages appended by the adapter's stream error handler
	const failureIdx = raw.lastIndexOf("FAILURE:")
	if (failureIdx !== -1) {
		const before = raw.slice(0, failureIdx).trim()
		if (before.length === 0) {
			throw new Error(raw.slice(failureIdx))
		}
		raw = before
	}

	return raw
}

function formatEntryDate(entry: {
	year: number
	month: number | null
	day: number | null
}): string {
	let label = `Year ${entry.year}`
	if (entry.month != null) label += `, Month ${entry.month}`
	if (entry.day != null) label += `, Day ${entry.day}`
	return label
}

// ─── System prompts ───────────────────────────────────────────────────────────

// ─── User prompts ─────────────────────────────────────────────────────────────

function nodeStateDetectionUserPrompt(
	sceneSummary: string,
	presentNodes: Array<{ name: string; nodeState: string; aliases: string[] }>
): string {
	const nodeLines = presentNodes.map((n) => {
		const aliasPart =
			n.aliases.length > 0
				? ` (also known as: ${n.aliases.join(", ")})`
				: ""
		return `- ${n.name}${aliasPart} — current state: ${n.nodeState}`
	})
	return `Scene summary:
${sceneSummary}

Characters present in this scene:
${nodeLines.join("\n")}

For each character whose lifecycle state clearly and definitively changed during this scene, output an entry. Only include characters whose new state differs from their current state listed above. If no states changed, output an empty changes array.

JSON output:
{"changes":[{"name":"...","newState":"active|deceased|missing|departed","reason":"Direct quote or close paraphrase from the scene summary that grounds this change."}]}`
}

function nodeDescriptionUserPrompt(
	name: string,
	messages: Array<{ senderName: string; content: string }>,
	fallbackText?: string
): string {
	if (messages.length > 0) {
		const formatted = JSON.stringify(
			messages.map((m) => ({
				speaker: m.senderName,
				text: m.content.trim()
			})),
			null,
			2
		)
		return `Character: ${name}\n\nScene messages:\n${formatted}\n\nWrite a two-sentence description of ${name}:`
	}
	return `Character: ${name}\n\nScene text:\n${fallbackText ?? ""}\n\nWrite a two-sentence description of ${name}:`
}

function characterPerspectiveUserPrompt(
	sceneLabel: string,
	sceneName: string | null,
	sceneSummary: string,
	fromName: string,
	fromState: string,
	fromSummary: string,
	others: Array<{
		name: string
		nodeState: string
		summary: string
		presence: "present" | "mentioned"
		existingRelationships: GraphBuilderSeedRelationship[]
	}>,
	establishedRels: Array<{
		toName: string
		type: string
		status: string
		visibility: string
		description: string
	}>
): string {
	const payload = {
		scene: {
			label: sceneLabel,
			...(sceneName ? { name: sceneName } : {}),
			summary: sceneSummary
		},
		perspective: {
			name: fromName,
			state: fromState,
			summary: fromSummary || null,
			...(establishedRels.length > 0
				? {
						establishedRelationships: establishedRels.map((r) => ({
							with: r.toName,
							type: r.type,
							status: r.status,
							visibility: r.visibility,
							description: r.description
						}))
					}
				: {})
		},
		otherCharacters_note: `Characters present in or mentioned in this scene. Being listed here does NOT establish a relationship with ${fromName} — only output an entry if the scene summary contains an explicit moment involving both ${fromName} and this character.`,
		otherCharacters: others.map((o) => {
			const entry: Record<string, unknown> = {
				name: o.name,
				state: o.nodeState,
				summary: o.summary || null,
				presence: o.presence
			}
			if (o.existingRelationships.length > 0) {
				entry.existingRelationships = o.existingRelationships.map(
					(r) => ({
						type: r.relationshipType,
						description: r.description,
						visibility: r.visibility,
						status: r.status
					})
				)
			}
			return entry
		})
	}
	return JSON.stringify(payload, null, 2)
}

/**
 * Finds a single unambiguous existing entity whose distinctive name words are a
 * superset of the incoming name's distinctive words. Returns the matched tempId,
 * or undefined if zero or multiple candidates match (ambiguity → create new).
 */
function fuzzyMatchName(
	incomingName: string,
	nameToTempId: Map<string, string>
): string | undefined {
	const incomingWords = distinctiveWords(incomingName)
	if (incomingWords.length === 0) return undefined
	const candidates: string[] = []
	for (const [existingName, tempId] of nameToTempId) {
		const existingWords = distinctiveWords(existingName)
		if (incomingWords.every((w) => existingWords.includes(w))) {
			candidates.push(tempId)
		}
	}
	return candidates.length === 1 ? candidates[0] : undefined
}

function messageContainsName(text: string, name: string): boolean {
	const lower = text.toLowerCase()
	return distinctiveWords(name).some((w) => lower.includes(w))
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

export class GraphParseError extends Error {
	public raw: string
	public truncated: boolean
	constructor(message: string, raw: string, truncated = false) {
		super(message)
		this.name = "GraphParseError"
		this.raw = raw
		this.truncated = truncated
	}
}

const VALID_NODE_STATES = new Set(["active", "deceased", "missing", "departed"])

function parseNodeStateChanges(
	raw: string,
	nameToTempId: Map<string, string>
): Array<{ tempId: string; newState: string; reason: string }> {
	let jsonStr: string
	try {
		jsonStr = extractJson(raw)
	} catch {
		return []
	}
	let parsed: any
	try {
		parsed = JSON.parse(jsonStr)
	} catch {
		return []
	}
	if (!Array.isArray(parsed.changes)) return []
	const results: Array<{ tempId: string; newState: string; reason: string }> =
		[]
	for (const c of parsed.changes) {
		const newState = String(c.newState ?? "")
			.toLowerCase()
			.trim()
		if (!VALID_NODE_STATES.has(newState)) continue
		const rawName = String(c.name ?? "").trim()
		if (!rawName) continue
		const tempId =
			nameToTempId.get(rawName.toLowerCase()) ??
			fuzzyMatchName(rawName, nameToTempId)
		if (!tempId) continue
		results.push({ tempId, newState, reason: String(c.reason ?? "") })
	}
	return results
}

/**
 * Mutable accumulator for every reason a perspective response yielded nothing.
 *
 * Passed in rather than returned so the parser keeps its single return type,
 * and because the interesting number is the total across a whole build, not
 * per call. buildGraphFromScenes owns the only instance.
 *
 * This exists because "No relationships extracted" was previously
 * indistinguishable from "the parser threw all of them away": six separate
 * bail-outs below, none of them logged, plus the model legitimately abstaining.
 * Attributing that needed a re-run and a guess. Now it needs neither.
 */
export interface PerspectiveDrops {
	/** Response text held no balanced `{...}`. */
	noJson: number
	/** A balanced object was found but did not parse. */
	badJson: number
	/** Parsed, but `relationships` was not an array. */
	notArray: number
	/** Entry carried no recognisable relationship type. */
	missingType: number
	/** Entry named no target. */
	missingTarget: number
	/**
	 * Entry named a SOURCE that is not the perspective character — a
	 * relationship between two third parties, outside this call's contract.
	 */
	wrongSource: number
	/**
	 * Entries whose source/target labels were reversed and were SWAPPED rather
	 * than dropped — recovered content, not a loss. Tracked separately so the
	 * repair stays visible instead of silently inflating the success count.
	 */
	/** Perspective calls re-issued after a non-JSON response. */
	retried: number
	/** Retries that then produced usable JSON. */
	retriedRecovered: number
	/** Named targets that matched no character in the scene, deduped. */
	unresolvedTargets: Set<string>
}

export function emptyPerspectiveDrops(): PerspectiveDrops {
	return {
		noJson: 0,
		badJson: 0,
		notArray: 0,
		missingType: 0,
		missingTarget: 0,
		wrongSource: 0,
		retried: 0,
		retriedRecovered: 0,
		unresolvedTargets: new Set()
	}
}

/**
 * Do two written names refer to the same character?
 *
 * Reuses distinctiveWords, so titles are stripped and either name may be the
 * fuller form: "Commander Thorne" refers to "Maren Thorne", "Maren" to "Maren".
 */
function namesRefer(a: string, b: string): boolean {
	const wa = distinctiveWords(a)
	const wb = distinctiveWords(b)
	if (wa.length === 0 || wb.length === 0) return false
	return wa.every((w) => wb.includes(w)) || wb.every((w) => wa.includes(w))
}

function parseCharacterPerspectives(
	raw: string,
	fromTempId: string,
	fromName: string,
	otherNameToTempId: Map<string, string>,
	drops: PerspectiveDrops = emptyPerspectiveDrops()
): Sockets.NarrativeGraph.RelationshipProposal[] {
	let jsonStr: string
	try {
		jsonStr = extractJson(raw)
	} catch {
		drops.noJson++
		return []
	}
	let parsed: any
	try {
		parsed = JSON.parse(jsonStr)
	} catch {
		drops.badJson++
		return []
	}
	if (!Array.isArray(parsed.relationships)) {
		drops.notArray++
		return []
	}
	const results: Sockets.NarrativeGraph.RelationshipProposal[] = []
	for (const r of parsed.relationships) {
		/*
		 * Field-name tolerance, widened from observation rather than guesswork.
		 *
		 * A live build against Dark-Scarlett-v1.0-26B returned nine perfectly
		 * good relationships and the parser discarded all nine: the model
		 * writes the pair as `person_1`/`person_2` and the type as any of
		 * `type`, `relationship_type` or `relation`. The content was correct
		 * every time — only the keys differed from the prompt's schema. The
		 * prompt now states the key names as a hard rule (see
		 * characterPerspectiveSystemPrompt), but a local model will drift
		 * again, and silently dropping good extractions over a synonym is far
		 * worse than accepting one.
		 */
		const rawSource = String(
			r.from ?? r.fromName ?? r.person_1 ?? r.person1 ?? ""
		).trim()
		const relType =
			r.type ?? r.relationshipType ?? r.relationship_type ?? r.relation
		if (!relType) {
			drops.missingType++
			continue
		}
		const rawName = String(
			r.to ?? r.toName ?? r.person_2 ?? r.person2 ?? ""
		).trim()
		if (!rawName) {
			drops.missingTarget++
			continue
		}

		/*
		 * The source must be the subject of this call. Anything else is
		 * discarded — including the reversed case, `{from: "Maren", to: "Corb"}`
		 * on Corb's call.
		 *
		 * This used to swap the endpoints instead, on the reasoning that the
		 * content was Corb's stance and only the labels were the wrong way
		 * round. That was a guess about whose stance the entry described, and a
		 * wrong guess records a relationship the subject never held — with a
		 * plausible reason and description attached, which makes it very hard
		 * to spot afterwards. A relationship the model got backwards is
		 * evidence the extraction is unreliable, not raw material to repair.
		 *
		 * The cost of the stricter rule is carried by the decoder rather than
		 * by recall: `from` is pinned to the subject's literal name in
		 * buildPerspectiveSchema, so on any provider that honours the schema a
		 * reversed pair is unemittable and this branch never fires. It stays as
		 * the backstop for providers that cannot take one.
		 *
		 * A MISSING `from` is not a wrong direction and is not discarded — the
		 * source then comes from the caller, as it always did. Only a positive
		 * claim that contradicts the call's contract drops the entry.
		 */
		if (rawSource && !namesRefer(rawSource, fromName)) {
			drops.wrongSource++
			continue
		}
		const nameLower = rawName.toLowerCase()
		const toTempId =
			otherNameToTempId.get(nameLower) ??
			fuzzyMatchName(rawName, otherNameToTempId)
		if (!toTempId) {
			// The name itself is the diagnostic: it distinguishes an LLM
			// hallucinating a character from a real one the matcher missed.
			drops.unresolvedTargets.add(rawName)
			continue
		}
		results.push({
			fromTempId,
			toTempId,
			relationshipType: String(relType),
			description: String(r.description ?? ""),
			visibility: String(r.visibility ?? "acknowledged"),
			status: String(r.status ?? "active"),
			reason: r.reason ? String(r.reason) : undefined
		})
	}
	return results
}

// ─── Chronological sort ───────────────────────────────────────────────────────

export function sortScenesChronologically(
	scenes: GraphBuilderScene[]
): GraphBuilderScene[] {
	return [...scenes].sort((a, b) => {
		const aHe = a.historyEntry
		const bHe = b.historyEntry
		if (!aHe && !bHe) return a.id - b.id
		if (!aHe) return 1
		if (!bHe) return -1
		if (aHe.year !== bHe.year) return aHe.year - bHe.year
		const aMonth = aHe.month ?? 0
		const bMonth = bHe.month ?? 0
		if (aMonth !== bMonth) return aMonth - bMonth
		const aDay = aHe.day ?? 0
		const bDay = bHe.day ?? 0
		if (aDay !== bDay) return aDay - bDay
		return a.id - b.id
	})
}

// ─── Main builder ─────────────────────────────────────────────────────────────

export async function buildGraphFromScenes(
	input: GraphBuilderInput
): Promise<GraphBuilderResult> {
	const {
		scenes,
		connection,
		sampling,
		contextConfig,
		promptConfig,
		steps,
		seedNodes,
		seedRelationships,
		worldLore,
		onProgress,
		onLlmCall,
		signal,
		onSceneStart,
		resumeState,
		fetchSceneMessages
	} = input

	if (scenes.length === 0) throw new Error("No scenes to build graph from.")

	const orderedScenes = sortScenesChronologically(scenes)
	const scenesWithSummaries = orderedScenes.filter((s) => s.summary?.trim())

	if (scenesWithSummaries.length === 0) {
		throw new Error(
			"No scenes have summaries. Generate scene summaries first."
		)
	}

	const sceneLabels = scenesWithSummaries.map((s) =>
		s.historyEntry ? formatEntryDate(s.historyEntry) : `Scene ${s.id}`
	)

	const llmOpts = { connection, sampling, contextConfig, promptConfig }

	// Every call in this builder runs on the resolved connection and sampling
	// config it was handed. Sampling belongs to configuration — samplingConfigs,
	// and graphBuildConfigs' per-sub-task override resolved by resolveTaskConfig
	// — never to hardcoded values in here. An override buried at the call site
	// bypasses the config the user chose, contradicts what the UI reports as
	// being in effect, and is invisible when the output is wrong.
	//
	// Keyed by STEP rather than handed a prompt: the prompt, the model and the
	// sampling profile for a step are one decision, and passing them separately
	// is how they drifted apart before (every step shared the perspective
	// config, and the configured prompts were never read at all).
	async function llm(
		step: GraphStepName,
		label: string,
		user: string,
		opts: {
			/** Only for the perspective retry, which deliberately re-asks with
			 *  a stripped prompt rather than the configured one. */
			systemPromptOverride?: string
			responseSchema?: JsonSchemaNode
			responseFormat?: ResponseFormat
		} = {}
	): Promise<string> {
		const cfg = steps?.[step]
		const system =
			opts.systemPromptOverride ??
			(cfg?.systemPrompt?.trim() || GRAPH_STEP_FALLBACK_PROMPT[step])
		const response = await runLLM(
			system,
			user,
			{
				...llmOpts,
				connection: cfg?.connection ?? llmOpts.connection,
				sampling: cfg?.sampling ?? llmOpts.sampling
			},
			label,
			opts.responseSchema,
			opts.responseFormat ?? "json"
		)
		onLlmCall?.({ label, system, user, response })
		return response
	}

	// Running node state keyed by tempId
	const nodeMap = new Map<string, Sockets.NarrativeGraph.NodeProposal>()
	// Running relationship state keyed by "fromTempId|toTempId|relationshipType"
	const relMap = new Map<
		string,
		Sockets.NarrativeGraph.RelationshipProposal
	>()

	let nextNodeIndex = 1
	const seedTempIdMap: Record<string, number> = {}
	const seedRelKeys = new Set<string>()
	const updatedSeedRelKeys = new Set<string>()
	const newNodeTempIds = new Set<string>()
	const newRelKeys = new Set<string>()
	// Maps tempId → alias names for display in node resolution prompt
	const nodeAliasMap = new Map<string, string[]>()
	/**
	 * The cast ledger: normalized name → proposed tempId, holding ONLY
	 * discovered (non-seed) nodes. This is what makes "Bram" in scene 3 and
	 * "bram" in scene 9 the same proposed node without creating a DB row to
	 * dedup against — the job the old code did by committing a binding
	 * mid-build.
	 *
	 * Deliberately NOT done by pushing id-less entries into `seedCastEntries`:
	 * CastEntry.id is nullable, so that typechecks and runs, but
	 * resolveCharacterRefs resolves via `if (existing?.id != null)` — a
	 * matching entry with a null id falls through to `suggestedNames`, so the
	 * same name would be re-suggested in every later scene and dedup would
	 * silently never happen.
	 */
	const proposedByName = new Map<string, string>()
	/** Stored binding ids that no longer resolve to a seed (deleted binding). */
	let droppedDanglingIds = 0
	/**
	 * Seeds whose summary or state changed during this build — proposed as
	 * UPDATEs. Kept strictly separate from `newNodeTempIds`, which drives
	 * INSERT: merging them would insert a duplicate binding per existing
	 * character on every apply.
	 */
	const updatedNodeTempIds = new Set<string>()
	const stateChangeInfo = new Map<
		string,
		{ reason: string; sceneIndex: number }
	>()
	/** Pre-build values, for rendering the review diff. */
	const seedOriginals = new Map<
		string,
		{ nodeState: string; summary: string | null }
	>()
	/** Scenes whose cast this build derived — written back at apply. */
	const resolvedSceneCast: ResolvedSceneCast[] = []
	/** Scenes that resolved at least one character — drives the tripwire below. */
	let scenesWithAnyCast = 0
	/**
	 * Names screened out as World Lore subjects (places, objects, factions)
	 * rather than minted as characters. Reported, never silently dropped.
	 */
	const filteredWorldLoreNames = new Set<string>()

	/**
	 * Non-character World Lore titles. `category` is free-text and usually
	 * unset, so it works only as an opt-out: an entry the user tagged as being
	 * about a person screens nothing.
	 */
	const screenableLoreTitles = (worldLore ?? []).filter(
		(e) => !/char|person|people|cast|npc|folk/i.test(e.category ?? "")
	)

	function isScreenedByWorldLore(name: string): boolean {
		return screenableLoreTitles.some((e) => namesMatch(e.name, name))
	}

	/** Why the relationship set came out the size it did — see RelationshipDiagnostics. */
	const perspectiveDrops = emptyPerspectiveDrops()
	let perspectiveCalls = 0
	let scenesSkippedNoPair = 0

	/**
	 * Seeds as a cast list for fuzzy name matching. Built once — matching is
	 * global across the lorebook, which is the build's existing semantics (the
	 * seed set is every parent binding, never timeline-scoped). Per-scene
	 * scoping would make a character unmatchable in scenes earlier than their
	 * introduction, which is wrong for a whole-history rebuild.
	 */
	const seedCastEntries: CastEntry[] = (seedNodes ?? []).map((s) => ({
		name: s.name,
		aliases: s.aliases ?? [],
		id: s.id
	}))

	// Seed with existing rows — every seed is already a real lorebookBindings
	// row (bound or background/NPC), so every tempId maps into
	// seedTempIdMap from the start. No more "replace mode seeds have no row
	// yet" branch (see the lorebookBindings/narrativeNodes merge plan).
	if (seedNodes?.length) {
		for (const seed of seedNodes) {
			const tempId = `existing_${seed.id}`
			seedTempIdMap[tempId] = seed.id
			nodeMap.set(tempId, {
				tempId,
				name: seed.name,
				nodeState: seed.nodeState,
				summary: seed.summary ?? ""
			})
			if (seed.aliases?.length) nodeAliasMap.set(tempId, seed.aliases)
			seedOriginals.set(tempId, {
				nodeState: seed.nodeState,
				summary: seed.summary
			})
		}
	}

	// Seed with existing relationships (extend mode)
	if (seedRelationships?.length) {
		for (const rel of seedRelationships) {
			const fromTempId = `existing_${rel.fromNodeId}`
			const toTempId = `existing_${rel.toNodeId}`
			if (!seedTempIdMap[fromTempId] || !seedTempIdMap[toTempId]) continue
			const key = `${fromTempId}|${toTempId}|${rel.relationshipType}`
			seedRelKeys.add(key)
			relMap.set(key, {
				fromTempId,
				toTempId,
				relationshipType: rel.relationshipType,
				description: rel.description ?? "",
				visibility: rel.visibility ?? "acknowledged",
				status: rel.status,
				reason: rel.reason ?? undefined
			})
		}
	}

	// Restore intermediate state when resuming a failed build
	let startSceneIndex = 0
	if (resumeState) {
		startSceneIndex = resumeState.sceneIndex
		nextNodeIndex = resumeState.nextNodeIndex
		for (const [k, v] of resumeState.nodeMap) nodeMap.set(k, v)
		for (const [k, v] of resumeState.relMap) relMap.set(k, v)
		Object.assign(seedTempIdMap, resumeState.seedTempIdMap)
		for (const k of resumeState.seedRelKeys) seedRelKeys.add(k)
		for (const k of resumeState.updatedSeedRelKeys)
			updatedSeedRelKeys.add(k)
		for (const k of resumeState.newNodeTempIds) newNodeTempIds.add(k)
		for (const k of resumeState.newRelKeys) newRelKeys.add(k)
		for (const [k, v] of resumeState.nodeAliasMap) nodeAliasMap.set(k, v)
		// `?? []` is defensive only — buildResumeStates is an in-process Map,
		// so a snapshot can't outlive a restart into a newer build.
		for (const [k, v] of resumeState.proposedByName ?? [])
			proposedByName.set(k, v)
	}

	for (let i = startSceneIndex; i < scenesWithSummaries.length; i++) {
		signal?.throwIfAborted()

		const scene = scenesWithSummaries[i]
		const sceneLabel = sceneLabels[i]
		const sceneSummary = scene.summary!.trim()

		// Snapshot state before any LLM calls for this scene — allows resuming here on failure
		onSceneStart?.({
			sceneIndex: i,
			nodeMap: [...nodeMap.entries()],
			relMap: [...relMap.entries()],
			nextNodeIndex,
			seedTempIdMap: { ...seedTempIdMap },
			seedRelKeys: [...seedRelKeys],
			updatedSeedRelKeys: [...updatedSeedRelKeys],
			newNodeTempIds: [...newNodeTempIds],
			newRelKeys: [...newRelKeys],
			nodeAliasMap: [...nodeAliasMap.entries()],
			proposedByName: [...proposedByName.entries()]
		})
		const isDirectEntry = scene.sourceHistoryEntryId != null

		// ── Pass 1: Character extraction ─────────────────────────────────────

		onProgress?.({
			phase: "extracting_characters",
			sceneIndex: i,
			totalScenes: scenesWithSummaries.length,
			nodesFound: newNodeTempIds.size,
			relationshipsFound: newRelKeys.size,
			currentSceneLabel: sceneLabel
		})

		const idToTempId = new Map<number, string>()
		for (const [tempId, id] of Object.entries(seedTempIdMap)) {
			idToTempId.set(id, tempId)
		}

		const presentTempIdsThisScene = new Set<string>()
		const mentionedTempIdsThisScene = new Set<string>()
		// Tracks nodes offered to the description pass for this scene.
		const newNodesThisScene = new Set<string>()

		function admit(tempId: string, isPresent: boolean) {
			if (isPresent) presentTempIdsThisScene.add(tempId)
			else if (!presentTempIdsThisScene.has(tempId))
				mentionedTempIdsThisScene.add(tempId)
			// "Newly introduced" means "still has no summary" — the
			// description loop below re-checks that, so it's safe (and
			// simplest) to offer every resolved node here each time it's seen.
			newNodesThisScene.add(tempId)
		}

		/**
		 * A stored binding id. Direct lookup against the seed map; a miss means
		 * the binding was deleted after this scene was summarized. Drop the
		 * *id*, never the scene — a scene with one dead reference and two live
		 * participants still has a relationship to contribute. (Dangling ids
		 * are possible at all because participantCharacters is untyped JSON
		 * with no FK; see the join-table item in the plan.)
		 */
		function resolveStoredId(id: number, isPresent: boolean) {
			const tempId = idToTempId.get(id)
			if (!tempId) {
				droppedDanglingIds++
				return
			}
			admit(tempId, isPresent)
		}

		/**
		 * Names — from legacy string entries or from extraction. Resolves
		 * against the seeded cast (which matches on aliases too, via
		 * entryMatches); anything left over becomes a proposed node, deduped
		 * through the ledger so a name recurring across scenes is one node.
		 */
		function resolveNameRefs(refs: ExtractedCastRef[], isPresent: boolean) {
			if (refs.length === 0) return
			const { ids, suggestedNames } = resolveCharacterRefs(
				refs,
				seedCastEntries
			)
			for (const id of ids) resolveStoredId(id, isPresent)
			for (const rawName of suggestedNames) {
				const name = rawName.trim()
				if (!name) continue
				// Ledger lookup uses the same normalizer the cast matcher does,
				// so "Bram" and "bram " collapse. Exact-normalized-name only:
				// proposed nodes carry no aliases, and inferring them from
				// near-variants would silently merge distinct characters with
				// no review. Genuine variants are handled post-apply by the
				// existing merge/absorb flow.
				let tempId: string | undefined
				for (const [known, existingTempId] of proposedByName) {
					if (namesMatch(known, name)) {
						tempId = existingTempId
						break
					}
				}
				if (!tempId) {
					// Places and objects are not characters. The extraction
					// prompt says so and is routinely ignored — a station, the
					// literal setting of every scene in its lorebook, was
					// proposed as a person with an `active` node state.
					//
					// Scoped deliberately to names about to be MINTED. A name
					// that matched the seeded cast already resolved above, so a
					// real character who also happens to have a World Lore page
					// is never at risk here.
					//
					// And it reports rather than drops: a silent filter would
					// just recreate the failure this pass spent its time
					// removing. The build result names what it screened out, so
					// a false positive is visible and the user can add the
					// character by hand.
					if (isScreenedByWorldLore(name)) {
						filteredWorldLoreNames.add(name)
						continue
					}
					tempId = `new_${nextNodeIndex++}`
					proposedByName.set(name, tempId)
					newNodeTempIds.add(tempId)
					nodeMap.set(tempId, {
						tempId,
						name,
						nodeState: "active",
						summary: ""
					})
				}
				admit(tempId, isPresent)
			}
		}

		// ── The uniform rule ──────────────────────────────────────────────
		// ids → lookup, names → resolve, nothing → extract. One path, chosen
		// by what the row actually holds, not by a legacy-data branch.
		const storedParticipants = scene.participantCharacters ?? []
		const storedMentioned = scene.mentionedCharacters ?? []
		const nothingStored =
			storedParticipants.length === 0 && storedMentioned.length === 0

		if (nothingStored) {
			// No cast was ever recorded for this scene. Derive it from the
			// summary. This is the only LLM call Pass 1 ever makes, and only
			// for scenes that need it — a scene with ids costs nothing.
			signal?.throwIfAborted()
			const extracted = await extractCharactersFromContent({
				content: sceneSummary,
				connection,
				sampling,
				contextConfig,
				promptConfig,
				knownCast: seedCastEntries,
				// Without this the Debug pane silently omits every Pass 1 call,
				// which is not a cosmetic gap: during an incident these were the
				// only calls still succeeding, and their absence from the trace
				// led to "no extraction calls were made at all" — the opposite of
				// what had happened. Anything that talks to a model during a
				// build has to show up here.
				onLlmCall: (entry) =>
					onLlmCall?.({
						...entry,
						label: `Character Extraction · ${sceneLabel}`
					}),
				signal
			})
			// Re-check after the call: an aborted extraction now throws
			// (summarizer/index.ts), but a *cooperating* abort can still let it
			// resolve normally with a degraded result, which must not be
			// mistaken for "this scene has no cast".
			signal?.throwIfAborted()
			resolveNameRefs(extracted.participantCharacters, true)
			resolveNameRefs(extracted.mentionedCharacters, false)
		} else {
			// Present first — present wins if a character is in both lists.
			const numeric = (xs: (number | string)[]) =>
				xs.filter((x): x is number => typeof x === "number")
			const named = (xs: (number | string)[]) =>
				xs
					.filter((x): x is string => typeof x === "string")
					.map((name) => ({ name }) as ExtractedCastRef)

			for (const id of numeric(storedParticipants))
				resolveStoredId(id, true)
			resolveNameRefs(named(storedParticipants), true)
			for (const id of numeric(storedMentioned))
				resolveStoredId(id, false)
			resolveNameRefs(named(storedMentioned), false)
		}

		if (
			presentTempIdsThisScene.size > 0 ||
			mentionedTempIdsThisScene.size > 0
		) {
			scenesWithAnyCast++
		}

		// Report scenes whose cast we had to derive, so apply can persist it.
		// Scenes that already held usable ids are skipped — nothing to write.
		const derivedCast =
			nothingStored ||
			storedParticipants.some((x) => typeof x === "string") ||
			storedMentioned.some((x) => typeof x === "string")
		if (derivedCast) {
			resolvedSceneCast.push({
				sceneId: isDirectEntry ? null : scene.id,
				historyEntryId: isDirectEntry
					? (scene.sourceHistoryEntryId ?? null)
					: null,
				participantTempIds: [...presentTempIdsThisScene],
				mentionedTempIds: [...mentionedTempIdsThisScene]
			})
		}

		// ── Description pass: one LLM call per newly introduced node ─────────
		if (newNodesThisScene.size > 0) {
			onProgress?.({
				phase: "generating_descriptions",
				sceneIndex: i,
				totalScenes: scenesWithSummaries.length,
				nodesFound: newNodeTempIds.size,
				relationshipsFound: newRelKeys.size,
				currentSceneLabel: sceneLabel
			})

			let rawMessages:
				| Array<{ senderName: string; content: string }>
				| undefined
			if (
				fetchSceneMessages &&
				scene.sessionId &&
				scene.selectedMessageIds?.length
			) {
				try {
					rawMessages = await fetchSceneMessages(
						scene.sessionId,
						scene.selectedMessageIds
					)
				} catch {
					// fall through to scene summary fallback
				}
			}

			for (const tempId of newNodesThisScene) {
				signal?.throwIfAborted()
				const node = nodeMap.get(tempId)
				if (!node || node.summary) continue

				const relevant =
					rawMessages?.filter(
						(m) =>
							messageContainsName(m.senderName, node.name) ||
							messageContainsName(m.content, node.name)
					) ?? []

				// Prose, not JSON — this text is stored as the node summary and
				// shown to the user as-is. Under the default JSON constraint the
				// model wrapped it in an object to satisfy the grammar.
				const desc = await llm(
					"nodeDescription",
					`Node Description · ${node.name}`,
					nodeDescriptionUserPrompt(
						node.name,
						relevant,
						sceneSummary
					),
					{ responseFormat: "text" }
				)
				nodeMap.set(tempId, { ...node, summary: desc.trim() })
				// Fill-blanks-only: the `node.summary` guard above means we
				// only ever get here for a node that had none, so a seed
				// reaching this point is a genuine blank being filled, never an
				// existing summary being overwritten. (Seeds normally arrive
				// with a summary from the character/persona sheet fallback, so
				// in practice this is mostly newly-discovered NPCs.)
				if (seedTempIdMap[tempId] != null)
					updatedNodeTempIds.add(tempId)
			}
		}

		// ── State detection pass: one LLM call per scene ─────────────────────
		//
		// Checks whether any present node's lifecycle state (active/deceased/missing/departed)
		// clearly changed during this scene. Runs even for single-character scenes.
		if (presentTempIdsThisScene.size > 0) {
			onProgress?.({
				phase: "detecting_state_changes",
				sceneIndex: i,
				totalScenes: scenesWithSummaries.length,
				nodesFound: newNodeTempIds.size,
				relationshipsFound: newRelKeys.size,
				currentSceneLabel: sceneLabel
			})

			const stateDetectionNodes = [...presentTempIdsThisScene].map(
				(tid) => {
					const node = nodeMap.get(tid)!
					return {
						name: node.name,
						nodeState: node.nodeState,
						aliases: nodeAliasMap.get(tid) ?? []
					}
				}
			)

			const stateRaw = await llm(
				"stateDetection",
				`State Detection · ${sceneLabel}`,
				nodeStateDetectionUserPrompt(sceneSummary, stateDetectionNodes)
			)

			// Build name→tempId map including aliases for resolution
			const presentNameToTempId = new Map<string, string>()
			for (const tid of presentTempIdsThisScene) {
				const node = nodeMap.get(tid)!
				presentNameToTempId.set(node.name.toLowerCase().trim(), tid)
				for (const alias of nodeAliasMap.get(tid) ?? []) {
					if (!presentNameToTempId.has(alias.toLowerCase().trim()))
						presentNameToTempId.set(alias.toLowerCase().trim(), tid)
				}
			}

			const stateChanges = parseNodeStateChanges(
				stateRaw,
				presentNameToTempId
			)
			for (const { tempId, newState, reason } of stateChanges) {
				const node = nodeMap.get(tempId)
				if (!node || node.nodeState === newState) continue
				nodeMap.set(tempId, { ...node, nodeState: newState })
				// A seed's state change is a proposed UPDATE. A discovered
				// node's isn't — it's still unsaved, so the change just lands
				// in its INSERT.
				if (seedTempIdMap[tempId] != null) {
					updatedNodeTempIds.add(tempId)
					stateChangeInfo.set(tempId, { reason, sceneIndex: i })
				}
			}
		}

		// Relationships need a pair, so a solo scene has no perspective work.
		// Deliberately placed AFTER the description and state passes above so
		// it skips Pass 2 only — a one-character scene still contributes that
		// character's description and any state change. Do not hoist it.
		//
		// A pair is one SOURCE and one TARGET, which are not the same role.
		// Only a present character has a point of view to write from, so the
		// source must be present — but a target may be merely mentioned, and
		// already is: mentionedNodeList is passed as relationship targets a few
		// lines below. Counting present characters alone therefore skipped any
		// scene where extraction marked one participant present and the rest
		// mentioned, discarding a perfectly relatable pair.
		if (
			presentTempIdsThisScene.size < 1 ||
			presentTempIdsThisScene.size + mentionedTempIdsThisScene.size < 2
		) {
			scenesSkippedNoPair++
			continue
		}

		// ── Pass 2: Per-character perspective ─────────────────────────────────
		//
		// One LLM call per present character. Each character sees the full list of
		// other present + mentioned characters, and outputs only the relationships
		// that changed or were newly established in this scene.
		// Mentioned characters can be relationship targets but not perspective originators.

		const presentNodeList = [...presentTempIdsThisScene]
			.map((tid) => nodeMap.get(tid))
			.filter((n): n is Sockets.NarrativeGraph.NodeProposal => !!n)

		const mentionedNodeList = [...mentionedTempIdsThisScene]
			.map((tid) => nodeMap.get(tid))
			.filter((n): n is Sockets.NarrativeGraph.NodeProposal => !!n)

		for (const fromNode of presentNodeList) {
			const sceneOtherTempIds = new Set(
				[
					...presentTempIdsThisScene,
					...mentionedTempIdsThisScene
				].filter((tid) => tid !== fromNode.tempId)
			)
			const speakerEstablishedRels: Array<{
				toName: string
				type: string
				status: string
				visibility: string
				description: string
			}> = []
			for (const [key, relEntry] of relMap) {
				if (!key.startsWith(`${fromNode.tempId}|`)) continue
				if (!sceneOtherTempIds.has(relEntry.toTempId)) continue
				const toNode = nodeMap.get(relEntry.toTempId)
				if (!toNode) continue
				speakerEstablishedRels.push({
					toName: toNode.name,
					type: relEntry.relationshipType,
					status: relEntry.status,
					visibility: relEntry.visibility,
					description: relEntry.description ?? ""
				})
			}

			const others = [...presentNodeList, ...mentionedNodeList]
				.filter((n) => n.tempId !== fromNode.tempId)
				.map((n) => {
					const pairPrefix = `${fromNode.tempId}|${n.tempId}|`
					const existingRelationships: GraphBuilderSeedRelationship[] =
						[]
					for (const [key, relEntry] of relMap) {
						if (key.startsWith(pairPrefix)) {
							existingRelationships.push({
								fromNodeId: 0,
								toNodeId: 0,
								relationshipType: relEntry.relationshipType,
								visibility: relEntry.visibility,
								status: relEntry.status,
								description: relEntry.description ?? "",
								reason: relEntry.reason ?? null
							})
						}
					}
					if (
						existingRelationships.length === 0 &&
						seedRelationships?.length
					) {
						for (const r of seedRelationships) {
							if (
								`existing_${r.fromNodeId}` ===
									fromNode.tempId &&
								`existing_${r.toNodeId}` === n.tempId
							) {
								existingRelationships.push(r)
							}
						}
					}
					return {
						tempId: n.tempId,
						name: n.name,
						nodeState: n.nodeState,
						summary: n.summary ?? "",
						presence: (presentTempIdsThisScene.has(n.tempId)
							? "present"
							: "mentioned") as "present" | "mentioned",
						existingRelationships
					}
				})

			onProgress?.({
				phase: "extracting_perspectives",
				sceneIndex: i,
				totalScenes: scenesWithSummaries.length,
				nodesFound: newNodeTempIds.size,
				relationshipsFound: newRelKeys.size,
				currentPair: fromNode.name,
				currentSceneLabel: sceneLabel
			})

			const userPrompt = characterPerspectiveUserPrompt(
				sceneLabel,
				scene.name,
				sceneSummary,
				fromNode.name,
				fromNode.nodeState,
				fromNode.summary ?? "",
				others,
				speakerEstablishedRels
			)

			perspectiveCalls++
			// The schema is per-subject: it pins `from` to this character's
			// literal name, so the decoder cannot emit a relationship pointing
			// the other way. See buildPerspectiveSchema.
			const perspectiveSchema = buildPerspectiveSchema(fromNode.name)

			let perspRaw = await llm(
				"perspective",
				`Character Perspective · ${sceneLabel} · ${fromNode.name}`,
				userPrompt,
				{ responseSchema: perspectiveSchema }
			)

			/*
			 * One retry when the response contains no JSON at all.
			 *
			 * Measured: 45% of responses from a roleplay-finetuned model came
			 * back as narrative prose rather than an object — a single
			 * non-compliant reply was a permanent loss of that character's
			 * whole perspective. The retry re-asks with a prompt stripped of
			 * every scrap of character framing.
			 *
			 * It runs on the SAME resolved connection and sampling as the first
			 * attempt. Sampling is configuration; if extraction needs different
			 * decoding that belongs in a sampling config the user can see and
			 * change, resolved through graphBuildConfigs — not forced from in
			 * here. Re-prompting alone recovered 1 in 13 on the model measured,
			 * so do not expect much of this on its own.
			 *
			 * Strictly once: a model that ignores the bare contract twice will
			 * not be talked round by a third attempt, and perspective calls are
			 * the most expensive part of a build.
			 */
			if (!hasJsonObject(perspRaw)) {
				perspectiveDrops.retried++
				perspRaw = await llm(
					"perspective",
					`Character Perspective (retry) · ${sceneLabel} · ${fromNode.name}`,
					userPrompt,
					{
						systemPromptOverride:
							GRAPH_PERSPECTIVE_RETRY_SYSTEM_PROMPT,
						responseSchema: perspectiveSchema
					}
				)
				if (hasJsonObject(perspRaw)) perspectiveDrops.retriedRecovered++
			}

			const otherNameToTempId = new Map(
				others.map((o) => [o.name.toLowerCase().trim(), o.tempId])
			)
			const rels = parseCharacterPerspectives(
				perspRaw,
				fromNode.tempId,
				fromNode.name,
				otherNameToTempId,
				perspectiveDrops
			)

			for (const rel of rels) {
				const key = `${rel.fromTempId}|${rel.toTempId}|${rel.relationshipType}`
				relMap.set(key, {
					...rel,
					sceneIndex: i,
					sceneId: isDirectEntry ? undefined : scene.id,
					// A relationship carries WHEN it was established, whatever
					// it was derived from. This used to be set only for direct
					// history entries, so every scene-derived relationship —
					// the large majority — persisted with a null historyEntryId
					// and no date of its own. A scene already knows its entry
					// (`scene.historyEntryId`), so the association was available
					// and simply not written.
					//
					// sceneId and historyEntryId are not alternatives here, as
					// they are in resolvedSceneCast above where they identify
					// WHICH ROW to write back to: a scene-derived relationship
					// legitimately has both.
					historyEntryId: isDirectEntry
						? scene.sourceHistoryEntryId
						: (scene.historyEntryId ?? undefined)
				})
				if (seedRelKeys.has(key)) updatedSeedRelKeys.add(key)
				newRelKeys.add(key)
			}
		}
	}

	// Check abort after completing the last scene — the per-scene check at the top of the loop
	// cannot fire after the final iteration exits, so a cancel during the last scene would
	// otherwise fall through and return a full proposal.
	signal?.throwIfAborted()

	onProgress?.({
		phase: "parsing",
		sceneIndex: scenesWithSummaries.length,
		totalScenes: scenesWithSummaries.length,
		nodesFound: newNodeTempIds.size,
		relationshipsFound: newRelKeys.size
	})

	const proposalNodes = [...nodeMap.values()].filter((n) =>
		newNodeTempIds.has(n.tempId)
	)
	// Proposed UPDATEs to existing bindings. Carries previous values so review
	// can render a diff. An entry whose values ended up unchanged is dropped —
	// no point asking the user to approve a no-op.
	const proposalUpdatedNodes: Sockets.NarrativeGraph.NodeUpdateProposal[] = []
	for (const tempId of updatedNodeTempIds) {
		const node = nodeMap.get(tempId)
		const original = seedOriginals.get(tempId)
		if (!node || !original) continue
		const info = stateChangeInfo.get(tempId)
		const stateChanged = node.nodeState !== original.nodeState
		const summaryChanged = (node.summary ?? "") !== (original.summary ?? "")
		if (!stateChanged && !summaryChanged) continue
		proposalUpdatedNodes.push({
			tempId,
			name: node.name,
			...(stateChanged
				? {
						nodeState: node.nodeState,
						previousNodeState: original.nodeState,
						nodeStateReason: info?.reason
					}
				: {}),
			...(summaryChanged
				? {
						summary: node.summary ?? "",
						previousSummary: original.summary
					}
				: {}),
			sceneIndex: info?.sceneIndex
		})
	}
	const proposalRelationships = [...relMap.values()].filter((r) => {
		const key = `${r.fromTempId}|${r.toTempId}|${r.relationshipType}`
		if (seedRelKeys.has(key)) return updatedSeedRelKeys.has(key)
		return newRelKeys.has(key)
	})

	const seedNodeNames: Record<string, string> = {}
	for (const [tempId, node] of nodeMap) {
		if (!newNodeTempIds.has(tempId)) seedNodeNames[tempId] = node.name
	}

	// Tripwire, not a user-facing path. Keyed on RESOLUTION failing everywhere,
	// deliberately not on the proposal being empty: a story where every scene
	// features one character resolves fine and legitimately yields no
	// relationships, and a re-run over an unchanged lorebook legitimately
	// yields no *new* ones. Both must reach review. What must never happen
	// again is returning an empty proposal as a successful build when in fact
	// nobody could be resolved at all — that is how this subsystem hid a total
	// failure for an entire release.
	if (scenesWithSummaries.length > 0 && scenesWithAnyCast === 0) {
		// The World Lore screen can be the whole reason nothing resolved — a
		// scene naming only its own setting extracts a name, and then that name
		// is filtered. Saying "no characters were found" there would be false
		// and unactionable, so name what was screened, exactly as the dangling
		// -id case names its cause.
		if (filteredWorldLoreNames.size > 0) {
			throw new Error(
				`Nothing could be extracted from ${scenesWithSummaries.length} scene(s): the only name(s) found — ${[...filteredWorldLoreNames].join(", ")} — match World Lore entries, so they were treated as places or things rather than characters. Add them as characters if that is wrong.`
			)
		}
		throw new Error(
			droppedDanglingIds > 0
				? `Nothing could be extracted from ${scenesWithSummaries.length} scene(s): ${droppedDanglingIds} character reference(s) point at bindings that no longer exist. Re-process the affected scenes to refresh their cast.`
				: `Nothing could be extracted from ${scenesWithSummaries.length} scene(s) — no characters were found in any summary.`
		)
	}

	return {
		proposal: {
			nodes: proposalNodes,
			relationships: proposalRelationships,
			updatedNodes: proposalUpdatedNodes
		},
		sceneLabels,
		resolvedSceneCast,
		seedTempIdMap,
		seedNodeNames,
		relationshipDiagnostics: {
			perspectiveCalls,
			scenesSkippedNoPair,
			noJson: perspectiveDrops.noJson,
			badJson: perspectiveDrops.badJson,
			notArray: perspectiveDrops.notArray,
			missingType: perspectiveDrops.missingType,
			missingTarget: perspectiveDrops.missingTarget,
			wrongSource: perspectiveDrops.wrongSource,
			retried: perspectiveDrops.retried,
			retriedRecovered: perspectiveDrops.retriedRecovered,
			unresolvedTargets: [...perspectiveDrops.unresolvedTargets]
		},
		filteredWorldLoreNames: [...filteredWorldLoreNames]
	}
}
