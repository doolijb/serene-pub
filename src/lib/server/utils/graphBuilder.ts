/**
 * Graph Builder — Two-Pass + Pre-Filter
 *
 * Per scene/entry:
 *   Pass 1   — Character extraction: reads pre-extracted participants/mentionedCharacters from
 *              the scene record (populated at summarization time). Falls back to LLM extraction
 *              for scenes that predate this feature.
 *   Pass 2   — Per-character perspective: one LLM call per present character to extract
 *              relationships that changed or were newly established in this scene.
 *
 * Output is a GraphProposal that the user reviews and approves before committing to DB.
 */

import { getConnectionAdapter } from "./getConnectionAdapter"
import { TokenCounters } from "./TokenCounterManager"
import { TokenCounterOptions } from "$lib/shared/constants/TokenCounters"
import { runQueuedLLMCall } from "./runQueuedLLMCall"
import { ChatTypes } from "$lib/shared/constants/ChatTypes"

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
	/** Characters physically present — populated by character extraction at summarization time */
	participantCharacters?: string[] | null
	/** Characters referenced but not present — populated by character extraction at summarization time */
	mentionedCharacters?: string[] | null
	/** Chat this scene was derived from — used for raw message fetching during node description generation */
	chatId?: number | null
	/** Message IDs selected for this scene — used for raw message fetching during node description generation */
	selectedMessageIds?: number[] | null
}

export interface GraphBuilderSeedNode {
	/** Real DB node id — set for extend mode seeds. Omit for binding-only seeds. */
	id?: number
	/** Lorebook binding id — set for replace mode seeds derived from bindings. */
	bindingId?: number
	name: string
	nodeState: string
	summary: string | null
	/** Combined alias names: node's own aliases column + non-hidden alias-child names */
	aliases?: string[]
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
}

export interface GraphBuilderInput {
	scenes: GraphBuilderScene[]
	connection: SelectConnection
	sampling: SelectSamplingConfig
	contextConfig: SelectContextConfig
	promptConfig: SelectPromptConfig
	/** Existing graph nodes to seed the LLM context with (extend mode only) */
	seedNodes?: GraphBuilderSeedNode[]
	/** Existing relationships to seed the LLM context with (extend mode only) */
	seedRelationships?: GraphBuilderSeedRelationship[]
	onProgress?: (data: Sockets.NarrativeGraph.Build.Progress) => void
	onLlmCall?: (entry: Sockets.NarrativeGraph.TraceEntry) => void
	signal?: AbortSignal
	/** Called at the start of each scene (before any LLM calls) with the current build state snapshot. */
	onSceneStart?: (state: GraphBuilderResumeState) => void
	/** If provided, restore this checkpoint and resume the build from its sceneIndex. */
	resumeState?: GraphBuilderResumeState
	/** Fetch raw messages for a scene — called during node description generation for newly introduced nodes */
	fetchSceneMessages?: (chatId: number, messageIds: number[]) => Promise<Array<{senderName: string; content: string}>>
}

export interface GraphBuilderResult {
	proposal: Sockets.NarrativeGraph.GraphProposal
	sceneLabels: string[]
	/** Maps seed tempIds (e.g. "existing_5") → real DB node id. Empty in replace mode. */
	seedTempIdMap: Record<string, number>
	/** Maps seed tempIds → display name so the review UI can label relationships involving existing nodes. */
	seedNodeNames: Record<string, string>
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function buildMinimalChat(userPrompt: string): any {
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
		chatType: ChatTypes.SUMMARIZE,
		groupReplyStrategy: null,
		chatMessages: [
			{
				id: 1,
				chatId: 0,
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
	label?: string
): Promise<string> {
	const AdapterClass = await getConnectionAdapter(opts.connection.type)
	// Honor the connection's own configured tokenizer — see the identical
	// fix/comment in generateResponse.ts.
	const tokenCounter = new TokenCounters(
		(opts.connection as any).tokenCounter || TokenCounterOptions.ESTIMATE
	)
	const tokenLimit: number =
		(opts.connection as any).tokenLimit ?? (opts.connection as any).contextSize ?? 4096

	const fakeChat = buildMinimalChat(userPrompt)

	const adapter = new AdapterClass.Adapter({
		connection: opts.connection,
		sampling: opts.sampling,
		contextConfig: opts.contextConfig,
		promptConfig: { ...opts.promptConfig, systemPrompt },
		chat: fakeChat,
		currentCharacterId: null,
		tokenCounter,
		tokenLimit,
		contextThresholdPercent: 0.9,
		isAssistantMode: false
	})

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

function formatEntryDate(entry: { year: number; month: number | null; day: number | null }): string {
	let label = `Year ${entry.year}`
	if (entry.month != null) label += `, Month ${entry.month}`
	if (entry.day != null) label += `, Day ${entry.day}`
	return label
}

// Words stripped before comparing names — honorifics, titles, filler prepositions
const TITLE_WORDS = new Set([
	'lord', 'lady', 'sir', 'dame', 'king', 'queen', 'prince', 'princess',
	'duke', 'duchess', 'count', 'countess', 'baron', 'baroness', 'emperor',
	'empress', 'captain', 'general', 'admiral', 'commander', 'the', 'of', 'von',
	'de', 'van', 'der', 'el', 'al'
])

function distinctiveWords(name: string): string[] {
	return name.toLowerCase().trim().split(/\s+/).filter((w) => w.length > 1 && !TITLE_WORDS.has(w))
}

/**
 * Finds a single unambiguous existing entity whose distinctive name words are a
 * superset of the incoming name's distinctive words. Returns the matched tempId,
 * or undefined if zero or multiple candidates match (ambiguity → create new).
 */
function fuzzyMatchName(incomingName: string, nameToTempId: Map<string, string>): string | undefined {
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
	return distinctiveWords(name).some(w => lower.includes(w))
}

function extractJson(raw: string): string {
	const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim()
	const start = stripped.indexOf("{")
	if (start === -1) throw new GraphParseError("No JSON object found in LLM response", raw)
	// Walk forward tracking depth to find the balanced closing brace,
	// correctly handling strings and escape sequences so embedded {} don't confuse the match.
	let depth = 0
	let inString = false
	let escape = false
	for (let i = start; i < stripped.length; i++) {
		const ch = stripped[i]
		if (escape) { escape = false; continue }
		if (ch === "\\" && inString) { escape = true; continue }
		if (ch === '"') { inString = !inString; continue }
		if (inString) continue
		if (ch === "{") depth++
		else if (ch === "}") {
			if (--depth === 0) return stripped.slice(start, i + 1)
		}
	}
	throw new GraphParseError("No complete JSON object found in LLM response", raw)
}

// ─── System prompts ───────────────────────────────────────────────────────────

function nodeDescriptionSystemPrompt(): string {
	return `You write brief character introductions from roleplay excerpts. Given a character name and messages from the scene where they first appear, write exactly two sentences in present tense describing who this character is — their role, nature, or defining traits — based only on what the provided text shows. No invention, no embellishment.`
}

function nodeStateDetectionSystemPrompt(): string {
	return `You detect when characters reach a new lifecycle state during a story scene.

The four states and when to apply them:

ACTIVE — the character is alive and present in the ongoing story. Only output this if their current state is deceased, missing, or departed and the scene shows them returning or being confirmed alive.

DECEASED — the character died during this scene. Apply when the scene directly depicts or confirms their death:
  • Killed in combat or by another character's action
  • Died from wounds, poison, illness, or other explicitly shown causes
  • Executed, sacrificed, or destroyed
  • Death confirmed by witnesses in the scene
  Do NOT apply for: deaths mentioned in passing that happened before this scene (those would already be reflected in their current state), near-death experiences that end in survival, or ambiguous fates.

MISSING — the character's whereabouts became unknown during this scene. Apply when:
  • They disappeared without explanation
  • They were kidnapped, taken, or seized and their fate is unclear
  • They vanished and no one in the scene can account for them
  Do NOT apply if their death is clearly confirmed, or if they voluntarily left.

DEPARTED — the character voluntarily left the story during this scene. Apply when:
  • They chose to leave the group or location, implying permanence
  • They were exiled or banished (even involuntarily — the key is they are now gone)
  • They retired, withdrew, or set off on a separate path apart from the main narrative
  Do NOT apply for temporary absences where the character is expected to return.

Rules:
- Only output an entry when the state change is clear and definitive — not implied, not ambiguous.
- Only flag a change if the new state differs from the character's current state listed in the prompt.
- When in doubt, omit. A missed change can be caught later; a wrong change corrupts the record.
- Output ONLY a raw JSON object. No prose, no markdown fences.`
}

function characterPerspectiveSystemPrompt(characterName: string): string {
	return `# Purpose
You are an expert cataloger mapping \`${characterName}\`'s perspective on their complex relationships with other characters.
 
# Context provided to you
You will receive a JSON object with:
- \`scene\` — label, optional name, summary
- \`perspective\` — the POV character
- \`otherCharacters\` — each with name, nodeState, summary, and optional \`existingRelationships\` (an array of all currently tracked dynamics between this character and the perspective character)
 
# Relationship Fields

## from
Write \`${characterName}\`'s name exactly as it appears in \`perspective.name\`. This anchors the entry to the correct subject before you write anything else.

## to
The name of the other character, exactly as it appears in \`otherCharacters\`.

## type
A short noun phrase describing the nature of this specific dynamic. Be specific rather than generic — prefer a precise term over forcing an imprecise one from the examples. You may invent appropriate terms as needed.

### Examples:
- \`acquaintance\` — someone ${characterName} briefly met or knows casually with no strong opinion
- \`ally\` — a friend, supporter, or collaborator
- \`enemy\` — a foe or antagonist
- \`rival\` — someone who competes with or challenges ${characterName} meaningfully
- \`mentor\` — someone who guides or instructs ${characterName}
- \`student\` — someone who learns from or is taught by ${characterName}
- \`family\` — a relative or close member of ${characterName}'s household
- \`romantic\` — someone with whom ${characterName} has a romantic interest or involvement
- \`infatuation\` — someone ${characterName} is strongly attracted to but not necessarily romantically involved with
- \`friendship\` — someone with whom ${characterName} shares a friendly bond
- \`grudge\` — someone ${characterName} holds a grievance against
- \`worship\` — someone ${characterName} admires or reveres deeply
- \`fear\` — someone who instills fear in ${characterName}
- \`warded_by\` — someone who defends ${characterName} from harm
- \`ward\` — someone under ${characterName}'s care or protection
- \`contract\` — someone with whom ${characterName} has a formal agreement
- \`life_debt\` — someone ${characterName} owes their life to
- \`obsession\` — someone who consumes ${characterName}'s thoughts and attention
- \`owned_by\` — someone who has ownership or control over ${characterName}
- \`owns\` — someone whom ${characterName} has ownership or control over

## reason
**Identify this before writing any other field.** Quote or closely paraphrase the specific action, words, or narrated interior state from the scene summary that grounds this entry. If you cannot locate a concrete moment in the scene text, stop — do not write the entry. Inferred motives, assumed feelings, and narrative context alone do not qualify.

## description
One sentence in third person describing \`${characterName}\`'s feeling or stance toward this person as evidenced by this scene. Ground it in what the scene actually shows — do not invent feelings or interior states not supported by the scene text.
 
## status
\`active | resolved | broken | evolved\`
 
## visibility
- \`secret\` — ${characterName} has not disclosed this to anyone (e.g. a secret grudge, a secret crush)
- \`acknowledged\` — both ${characterName} and the other character are aware of this dynamic (e.g. a feud, a romance)
- \`public\` — common knowledge among the party or world (e.g. a royal marriage, a king's alliance)
 
# Instructions
 
Write strictly from \`${characterName}\`'s point of view. Each entry captures one distinct relational dynamic with one other character.
 
**How to extract:**
Scan the scene summary for explicit moments — actions, exchanges, or directly narrated interior states — that establish or change a relationship involving \`${characterName}\`. A single moment can reveal multiple distinct dynamics between the same pair (e.g., an alliance formed in the same exchange where a hidden resentment is also shown). For each distinct dynamic you can independently ground in an explicit moment, write one entry. If no qualifying moment exists for a given character, omit them entirely. Do not consider what \`${characterName}\` would plausibly feel; only what the scene text explicitly shows.

A moment qualifies if the scene summary directly describes one of:
- A direct interaction between \`${characterName}\` and another character that establishes or changes a dynamic
- A directly narrated thought, recollection, or explicit emotional state \`${characterName}\` has toward another character
- A change to an existing dynamic — betrayal, reconciliation, power shift, revelation, estrangement, death, new alliance, broken contract, discovered secret, shift in feeling

**Do NOT output an entry if:**
- The basis is what \`${characterName}\` would "plausibly feel" or "logically think" given the circumstances — inference is not evidence
- \`${characterName}\` and the other character share the scene but the summary records no interaction, reaction, or thought between them — proximity is not a relationship
- The dynamic already exists in \`existingRelationships\` and is unchanged by this scene
- \`${characterName}\` was not present for and has not yet been informed of the event — e.g. the death of a family member in a different location

# Rules
- Output one entry per distinct dynamic — marriage, friendship, grudge, debt, worship, ownership are all separate dynamics that can exist between the same pair; each gets its own entry
- Do not collapse multiple dynamics into one entry — each entry captures one clear emotional or relational stance
- Do not invent dynamics not evidenced in the scene or recalled by \`${characterName}\` — every entry must be independently grounded
- Check \`existingRelationships\` before writing an entry — do not duplicate a dynamic that is already tracked and unchanged
- When in doubt, omit — a missed relationship can be captured in a later scene; an invented one corrupts the graph
- Output ONLY valid JSON. No prose, no markdown fences.
 
# Example output
 
The following example shows how to handle a scene where an existing dynamic changed and a new one was created. Mira and Caen had an existing \`romantic\` dynamic tracked in \`existingRelationships\`. This scene ended it and created a new \`grudge\`. Both entries are grounded in the same explicit scene event — Caen's public denial at the council. The grudge is \`secret\` because the scene does not show Mira disclosing her resentment to anyone, not because its existence is inferred. Note that \`reason\` is written first, before \`description\`, reflecting the extraction order: locate the scene evidence first, then characterize the feeling it reveals. Only the changed and new dynamics are output — unchanged dynamics are omitted entirely.

\`\`\`json
{
  "relationships": [
    {
      "from": "Mira",
      "to": "Caen",
      "type": "romantic",
      "reason": "Caen ended the relationship publicly at the council table, denying any involvement with Mira in front of her peers.",
      "description": "Mira believed in something real, but Caen made clear tonight that it meant nothing to him.",
      "status": "broken",
      "visibility": "acknowledged"
    },
    {
      "from": "Mira",
      "to": "Caen",
      "type": "grudge",
      "reason": "Caen publicly dismissed and denied Mira at the council, making her look naive in front of everyone whose trust she needs.",
      "description": "Mira will not forgive being humiliated in front of the people whose trust she needs most.",
      "status": "active",
      "visibility": "secret"
    }
  ]
}
\`\`\`
 
# Example output — nothing changed
\`\`\`json
{ "relationships": [] }
\`\`\``
}

// ─── User prompts ─────────────────────────────────────────────────────────────

function nodeStateDetectionUserPrompt(
	sceneSummary: string,
	presentNodes: Array<{ name: string; nodeState: string; aliases: string[] }>
): string {
	const nodeLines = presentNodes.map((n) => {
		const aliasPart = n.aliases.length > 0 ? ` (also known as: ${n.aliases.join(", ")})` : ""
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
	messages: Array<{senderName: string; content: string}>,
	fallbackText?: string
): string {
	if (messages.length > 0) {
		const formatted = JSON.stringify(
			messages.map(m => ({ speaker: m.senderName, text: m.content.trim() })),
			null, 2
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
	establishedRels: Array<{ toName: string; type: string; status: string; visibility: string; description: string }>
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
				entry.existingRelationships = o.existingRelationships.map((r) => ({
					type: r.relationshipType,
					description: r.description,
					visibility: r.visibility,
					status: r.status
				}))
			}
			return entry
		})
	}
	return JSON.stringify(payload, null, 2)
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
	try { jsonStr = extractJson(raw) } catch { return [] }
	let parsed: any
	try { parsed = JSON.parse(jsonStr) } catch { return [] }
	if (!Array.isArray(parsed.changes)) return []
	const results: Array<{ tempId: string; newState: string; reason: string }> = []
	for (const c of parsed.changes) {
		const newState = String(c.newState ?? "").toLowerCase().trim()
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

function parseCharacterPerspectives(
	raw: string,
	fromTempId: string,
	otherNameToTempId: Map<string, string>
): Sockets.NarrativeGraph.RelationshipProposal[] {
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
	if (!Array.isArray(parsed.relationships)) return []
	const results: Sockets.NarrativeGraph.RelationshipProposal[] = []
	for (const r of parsed.relationships) {
		// Accept both new field names (type/to) and legacy names (relationshipType/toName)
		const relType = r.type ?? r.relationshipType
		if (!relType) continue
		const rawName = String(r.to ?? r.toName ?? "").trim()
		if (!rawName) continue
		const nameLower = rawName.toLowerCase()
		const toTempId =
			otherNameToTempId.get(nameLower) ??
			fuzzyMatchName(rawName, otherNameToTempId)
		if (!toTempId) continue
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

export function sortScenesChronologically(scenes: GraphBuilderScene[]): GraphBuilderScene[] {
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

export async function buildGraphFromScenes(input: GraphBuilderInput): Promise<GraphBuilderResult> {
	const { scenes, connection, sampling, contextConfig, promptConfig, seedNodes, seedRelationships, onProgress, onLlmCall, signal, onSceneStart, resumeState, fetchSceneMessages } =
		input

	if (scenes.length === 0) throw new Error("No scenes to build graph from.")

	const orderedScenes = sortScenesChronologically(scenes)
	const scenesWithSummaries = orderedScenes.filter((s) => s.summary?.trim())

	if (scenesWithSummaries.length === 0) {
		throw new Error("No scenes have summaries. Generate scene summaries first.")
	}

	const sceneLabels = scenesWithSummaries.map((s) =>
		s.historyEntry ? formatEntryDate(s.historyEntry) : `Scene ${s.id}`
	)

	const llmOpts = { connection, sampling, contextConfig, promptConfig }

	async function llm(label: string, system: string, user: string): Promise<string> {
		const response = await runLLM(system, user, llmOpts, label)
		onLlmCall?.({ label, system, user, response })
		return response
	}

	// Running node state keyed by tempId
	const nodeMap = new Map<string, Sockets.NarrativeGraph.NodeProposal>()
	// Running relationship state keyed by "fromTempId|toTempId|relationshipType"
	const relMap = new Map<string, Sockets.NarrativeGraph.RelationshipProposal>()

	let nextNodeIndex = 1
	const seedTempIdMap: Record<string, number> = {}
	const seedRelKeys = new Set<string>()
	const updatedSeedRelKeys = new Set<string>()
	const newNodeTempIds = new Set<string>()
	const newRelKeys = new Set<string>()
	// Maps tempId → alias names for display in node resolution prompt
	const nodeAliasMap = new Map<string, string[]>()

	// Seed with existing nodes (extend mode) or binding-derived nodes (replace mode)
	if (seedNodes?.length) {
		for (const seed of seedNodes) {
			const tempId = seed.bindingId ? `binding_${seed.bindingId}` : `existing_${seed.id!}`
			if (!seed.bindingId && seed.id) seedTempIdMap[tempId] = seed.id
			if (seed.bindingId) newNodeTempIds.add(tempId)
			nodeMap.set(tempId, { tempId, name: seed.name, nodeState: seed.nodeState, summary: seed.summary ?? "" })
			if (seed.aliases?.length) nodeAliasMap.set(tempId, seed.aliases)
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
		for (const k of resumeState.updatedSeedRelKeys) updatedSeedRelKeys.add(k)
		for (const k of resumeState.newNodeTempIds) newNodeTempIds.add(k)
		for (const k of resumeState.newRelKeys) newRelKeys.add(k)
		for (const [k, v] of resumeState.nodeAliasMap) nodeAliasMap.set(k, v)
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
			nodeAliasMap: [...nodeAliasMap.entries()]
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

		// Convert pre-extracted name lists to minimal node proposals.
		// resolveAndStoreNode will match names against existing nodes by name/alias,
		// so tempIds assigned here are only used for genuinely new nodes.
		const presentNodes: Sockets.NarrativeGraph.NodeProposal[] = (scene.participantCharacters ?? []).map((name: string) => ({
			tempId: `node_${nextNodeIndex++}`,
			name,
			nodeState: "active" as const,
			summary: ""
		}))
		const mentionedNodes: Sockets.NarrativeGraph.NodeProposal[] = (scene.mentionedCharacters ?? []).map((name) => ({
			tempId: `node_${nextNodeIndex++}`,
			name,
			nodeState: "active" as const,
			summary: ""
		}))

		// Build name → tempId reverse lookup for dedup (LLM sometimes hallucinates wrong tempIds).
		// Includes known aliases so a reference to an alias name resolves to the canonical node
		// instead of creating a spurious duplicate.
		const nameToTempId = new Map<string, string>()
		for (const [tid, n] of nodeMap) {
			nameToTempId.set(n.name.toLowerCase().trim(), tid)
			for (const alias of (nodeAliasMap.get(tid) ?? [])) {
				const aliasLower = alias.toLowerCase().trim()
				if (!nameToTempId.has(aliasLower)) nameToTempId.set(aliasLower, tid)
			}
		}

		const presentTempIdsThisScene = new Set<string>()
		const mentionedTempIdsThisScene = new Set<string>()
		const seenNamesThisScene = new Set<string>()
		// Guards against double-processing when two different names resolve to the same node
		// (e.g. "Aria" and "The Wanderer" both in the same scene's output)
		const seenTempIdsThisScene = new Set<string>()
		// Tracks nodes first introduced in this specific scene (for description generation)
		const newNodesThisScene = new Set<string>()

		function resolveAndStoreNode(
			node: Sockets.NarrativeGraph.NodeProposal,
			isPresent: boolean
		) {
			const nameLower = node.name.toLowerCase().trim()
			if (seenNamesThisScene.has(nameLower)) return
			seenNamesThisScene.add(nameLower)

			// Match against existing nodes by exact name, alias, or fuzzy word overlap.
			// Aliases include merged child node names, so a merged "Alice Doe" → parent node
			// resolves correctly when the scene only names "Alice".
			const exactMatch = nameToTempId.get(nameLower)
			const fuzzyMatch = exactMatch ? undefined : fuzzyMatchName(node.name, nameToTempId)
			const effectiveTempId = exactMatch ?? fuzzyMatch ?? node.tempId

			// Skip if two different names in this scene resolved to the same existing node
			if (seenTempIdsThisScene.has(effectiveTempId)) return
			seenTempIdsThisScene.add(effectiveTempId)

			if (nodeMap.has(effectiveTempId)) {
				const existing = nodeMap.get(effectiveTempId)!
				nodeMap.set(effectiveTempId, {
					...existing,
					name: existing.name || node.name,
					// Character extraction doesn't track state — preserve the existing nodeState
					summary: node.summary || existing.summary
				})
			} else {
				nodeMap.set(effectiveTempId, {
					...node,
					tempId: effectiveTempId,
					sceneIndex: i,
					sceneId: isDirectEntry ? undefined : scene.id,
					historyEntryId: isDirectEntry ? scene.sourceHistoryEntryId : undefined
				})
				newNodeTempIds.add(effectiveTempId)
				newNodesThisScene.add(effectiveTempId)
				nameToTempId.set(nameLower, effectiveTempId)
			}

			if (isPresent) presentTempIdsThisScene.add(effectiveTempId)
			else mentionedTempIdsThisScene.add(effectiveTempId)
		}

		// Present first (wins the seenNames slot if same character appears in both lists)
		for (const node of presentNodes) resolveAndStoreNode(node, true)
		for (const node of mentionedNodes) resolveAndStoreNode(node, false)

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

			let rawMessages: Array<{senderName: string; content: string}> | undefined
			if (fetchSceneMessages && scene.chatId && scene.selectedMessageIds?.length) {
				try {
					rawMessages = await fetchSceneMessages(scene.chatId, scene.selectedMessageIds)
				} catch {
					// fall through to scene summary fallback
				}
			}

			for (const tempId of newNodesThisScene) {
				signal?.throwIfAborted()
				const node = nodeMap.get(tempId)
				if (!node || node.summary) continue

				const relevant = rawMessages?.filter(
					m => messageContainsName(m.senderName, node.name) || messageContainsName(m.content, node.name)
				) ?? []

				const desc = await llm(
					`Node Description · ${node.name}`,
					nodeDescriptionSystemPrompt(),
					nodeDescriptionUserPrompt(node.name, relevant, sceneSummary)
				)
				nodeMap.set(tempId, { ...node, summary: desc.trim() })
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

			const stateDetectionNodes = [...presentTempIdsThisScene].map((tid) => {
				const node = nodeMap.get(tid)!
				return {
					name: node.name,
					nodeState: node.nodeState,
					aliases: nodeAliasMap.get(tid) ?? []
				}
			})

			const stateRaw = await llm(
				`State Detection · ${sceneLabel}`,
				nodeStateDetectionSystemPrompt(),
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

			const stateChanges = parseNodeStateChanges(stateRaw, presentNameToTempId)
			for (const { tempId, newState, reason: _reason } of stateChanges) {
				const node = nodeMap.get(tempId)
				if (!node || node.nodeState === newState) continue
				nodeMap.set(tempId, { ...node, nodeState: newState })
			}
		}

		if (presentTempIdsThisScene.size < 2) continue

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
				[...presentTempIdsThisScene, ...mentionedTempIdsThisScene].filter((tid) => tid !== fromNode.tempId)
			)
			const speakerEstablishedRels: Array<{ toName: string; type: string; status: string; visibility: string; description: string }> = []
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
					const existingRelationships: GraphBuilderSeedRelationship[] = []
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
					if (existingRelationships.length === 0 && seedRelationships?.length) {
						for (const r of seedRelationships) {
							if (`existing_${r.fromNodeId}` === fromNode.tempId && `existing_${r.toNodeId}` === n.tempId) {
								existingRelationships.push(r)
							}
						}
					}
					return { tempId: n.tempId, name: n.name, nodeState: n.nodeState, summary: n.summary ?? "", presence: (presentTempIdsThisScene.has(n.tempId) ? "present" : "mentioned") as "present" | "mentioned", existingRelationships }
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

			const perspRaw = await llm(
				`Character Perspective · ${sceneLabel} · ${fromNode.name}`,
				characterPerspectiveSystemPrompt(fromNode.name),
				characterPerspectiveUserPrompt(
					sceneLabel,
					scene.name,
					sceneSummary,
					fromNode.name,
					fromNode.nodeState,
					fromNode.summary ?? "",
					others,
					speakerEstablishedRels
				)
			)

			const otherNameToTempId = new Map(others.map((o) => [o.name.toLowerCase().trim(), o.tempId]))
			const rels = parseCharacterPerspectives(perspRaw, fromNode.tempId, otherNameToTempId)

			for (const rel of rels) {
				const key = `${rel.fromTempId}|${rel.toTempId}|${rel.relationshipType}`
				relMap.set(key, {
					...rel,
					sceneIndex: i,
					sceneId: isDirectEntry ? undefined : scene.id,
					historyEntryId: isDirectEntry ? scene.sourceHistoryEntryId : undefined
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

	const proposalNodes = [...nodeMap.values()].filter((n) => newNodeTempIds.has(n.tempId))
	const proposalRelationships = [...relMap.values()].filter((r) => {
		const key = `${r.fromTempId}|${r.toTempId}|${r.relationshipType}`
		if (seedRelKeys.has(key)) return updatedSeedRelKeys.has(key)
		return newRelKeys.has(key)
	})

	const seedNodeNames: Record<string, string> = {}
	for (const [tempId, node] of nodeMap) {
		if (!newNodeTempIds.has(tempId)) seedNodeNames[tempId] = node.name
	}

	return {
		proposal: { nodes: proposalNodes, relationships: proposalRelationships },
		sceneLabels,
		seedTempIdMap,
		seedNodeNames
	}
}
