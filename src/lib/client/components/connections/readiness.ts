/**
 * "What this pub can do", as a pure function over the defaults summary.
 *
 * One row per **job** — a transform the pub needs a default pair for: a dot,
 * one sentence, and at most one button. The button IS the fix — `Set up`
 * where no pair does the job at all, `Download` / `Start` / `Refresh` where
 * one is registered but cannot run, and `Change` for every other fault.
 * Nothing here emits; the view turns a verb into the socket call the sidebar
 * already makes.
 *
 * ## The state is the connection state
 *
 * A row's `state` is a `ConnectionState` — the one scale
 * (`connectionRowStatus.ts`), read from the defaults summary's own words at
 * this seam (R5, `stateOfDefault`):
 *
 * | summary | row state | colour |
 * |---|---|---|
 * | registered, and it runs | `ready` | success |
 * | downloading | `busy` | warning |
 * | registered, and it cannot run | `broken` | error |
 * | nothing registered | `unfinished` | primary (gold) |
 *
 * `idle` is never a row's state here: a job either has a pair or it does not.
 *
 * ## Why it is not just `defaultsSummary`
 *
 * That module answers "does this registration resolve to a model that is
 * here" and stops there, because that is all the LIST ROWS can say. Three of
 * the faults a person actually hits are not on a list row: the managed
 * process has crashed, the manager that owns a connection is switched off,
 * and a local file is still on its way. Those come in as `EntryFacts`,
 * gathered by the view from the live-status events it already holds, and are
 * reconciled with the summary HERE rather than in a template (R5).
 *
 * ## The consequence, not the transform
 *
 * An unset row says what it COSTS — "sessions can't reply", not "no chat
 * model is registered". A person opening this panel for the first time is
 * deciding whether to care; the transform id has never answered that. The
 * four section jobs have hand-written consequences because they are the four
 * that are worth a sentence of their own; the other six fall back to the
 * SDK's tagline, which is already written for a person.
 *
 * ⚠ Bytes and counts, never time estimates (concept ruling R7). A download
 * row says "0.4 of 1.2 GB"; nothing here says "about a minute left".
 */
import { capabilityTagline } from "@serene-pub/sdk"
import { OUTPUT_KIND_ICONS } from "$lib/shared/constants/outputKinds"
import { formatProgress } from "./modelManagement"
import type { ConnectionState } from "./connectionRowStatus"
import type { DefaultState, DefaultsSummaryEntry } from "./defaultsSummary"

/**
 * The defaults summary's word for a pair, on the one scale. The summary keeps
 * its own words (it is the ledger's vocabulary); this is the seam.
 */
export function stateOfDefault(state: DefaultState): ConnectionState {
	switch (state) {
		case "ok":
			return "ready"
		case "pending":
			return "busy"
		case "warning":
			return "broken"
		case "unset":
			return "unfinished"
	}
}

/**
 * The one button a row may carry. `emphasis` is §6.1: gold only for chat's
 * `setup` (`text->text`) — the one unset job that blocks play at all. Every
 * other row's `setup` is tonal, same as a repair fix.
 */
export interface ReadinessAction {
	verb: "setup" | "download" | "start" | "refresh" | "change"
	label: string
	emphasis: "primary" | "tonal"
}

export interface ReadinessRow {
	/** The transform id, e.g. `text->text`. */
	capability: string
	/** What a person is shown for it: "Chat", "Embeddings". */
	label: string
	/** A `@lucide/svelte` export name, resolved by the component. */
	icon: string
	/** On the one scale; see the table above. Never `idle`. */
	state: ConnectionState
	/** The row's second line, whole. Never assembled in the template. */
	sentence: string
	action: ReadinessAction | null
	/** A pair is registered for this job, whatever state it is in. */
	set: boolean
	/** The pair, when the registration resolves — for the fix's emit. */
	connectionId?: number
	modelId?: number
}

/**
 * What the view knows about a resolved pair that the list rows do not.
 *
 * Every field is optional and **absent means "not answered"**, never "no":
 * the managed process, the manager flags and the download feed each come from
 * an event the server may never send, and a row must degrade to the sentence
 * the summary already gave it rather than claim a fault nobody reported.
 */
export interface EntryFacts {
	/** The pair's model is a local ONNX file in this state. */
	localState?: "not_downloaded" | "downloading" | "on_disk" | "error"
	/** Bytes moved so far on that file, while it is downloading. */
	downloadedBytes?: number
	totalBytes?: number
	/** The endpoint's last model listing failed with this. */
	syncError?: string | null
	/** The pair sits on the managed KoboldCPP, and its process is here. */
	kcppRun?: "stopped" | "starting" | "running" | "crashed" | "stopping" | null
	/** The manager that owns the pair's endpoint is switched on. */
	managerEnabled?: boolean
	/** What that manager is called, for the sentence. */
	managerLabel?: string
}

/** The short cost of NOT having each of the four sections. */
const CONSEQUENCES: Record<string, string> = {
	"text->text": "sessions can't reply",
	"text->image": "pictures stay off until you add one",
	"text->embedding": "lore retrieval answers from keywords",
	"text->entities": "no automatic people and places"
}

/** The SDK's tagline, without its full stop — this sentence has a `·` in it. */
function taglineOf(capability: string): string {
	let tagline: string | undefined
	try {
		tagline = capabilityTagline(capability as any)
	} catch {
		tagline = undefined
	}
	return (tagline ?? "nothing uses it yet").replace(/\.$/, "")
}

/**
 * The last clause of a healthy row: what is known about where the model is.
 *
 * `defaultsSummary` says "loaded" or "on disk" for a local file and "ready"
 * for everything else, and "ready" is the machine shrugging — a remote host
 * LISTS a model, which is the strongest thing anyone can say about it.
 */
function okClause(stateWord: string): string {
	return stateWord === "ready" ? "listed" : stateWord
}

/**
 * The mark for a capability that READS something other than text.
 *
 * The output kind alone gave vision (`text+image->text`) the text mark, a
 * "T", beside a sentence about looking at pictures (walk 2026-09-24, plan
 * C8). What such a capability takes in is what tells it apart.
 */
const READING_ICONS: Record<string, string> = {
	"text+image->text": "Eye",
	"text+document->text": "FileText",
	"audio->text": "AudioLines"
}
function iconFor(capability: string, outputKind: string | undefined): string {
	return (
		READING_ICONS[capability] ??
		OUTPUT_KIND_ICONS[outputKind ?? ""] ??
		"Boxes"
	)
}

/** One row, from the summary entry and whatever the view could add to it. */
export function readinessRow(
	entry: DefaultsSummaryEntry,
	facts: EntryFacts = {}
): ReadinessRow {
	const base = {
		capability: entry.capability,
		label: entry.label,
		icon: iconFor(entry.capability, entry.outputKind),
		set: entry.set,
		connectionId: entry.connection?.id,
		modelId: entry.model?.id
	}

	if (!entry.set)
		return {
			...base,
			state: "unfinished",
			sentence: `Not set · ${CONSEQUENCES[entry.capability] ?? taglineOf(entry.capability)}`,
			action: {
				verb: "setup",
				label: "Set up",
				// Chat is the one job whose absence blocks play; every other
				// unset row is a repair like any other, so it gets the same
				// tonal treatment as `fixFor`'s buttons (§6.1).
				emphasis:
					entry.capability === "text->text" ? "primary" : "tonal"
			}
		}

	const name = entry.model?.name ?? ""
	const where = entry.connection?.name ?? ""

	// A download in flight outranks every other sentence: nothing is wrong,
	// and a row that said "not downloaded" beside a moving bar would be
	// reporting the state the bar is already leaving.
	if (
		stateOfDefault(entry.state) === "busy" ||
		facts.localState === "downloading"
	) {
		const progress = formatProgress(
			facts.downloadedBytes,
			facts.totalBytes,
			"MB"
		)
		return {
			...base,
			state: "busy",
			sentence: progress
				? `Downloading ${name} · ${progress}`
				: `Downloading ${name}`,
			action: null
		}
	}

	// The manager is off, so this connection cannot run at all — a fact that
	// outranks anything the row itself says about being listed and enabled.
	if (facts.managerEnabled === false)
		return {
			...base,
			state: "broken",
			sentence: `${facts.managerLabel ?? "Its manager"} is switched off · ${name} can't run`,
			action: { verb: "change", label: "Change", emphasis: "tonal" }
		}

	if (facts.kcppRun === "crashed")
		return {
			...base,
			state: "broken",
			sentence: `${where} stopped unexpectedly · ${name} can't run`,
			action: { verb: "start", label: "Start", emphasis: "tonal" }
		}

	if (stateOfDefault(entry.state) === "broken")
		return {
			...base,
			state: "broken",
			sentence: `${name} · ${where} · ${entry.stateWord}`,
			action: fixFor(entry, facts)
		}

	return {
		...base,
		state: "ready",
		sentence: [name, where, okClause(entry.stateWord)]
			.filter(Boolean)
			.join(" · "),
		action: null
	}
}

/**
 * The ONE button a broken row offers.
 *
 * Ordered by how directly it undoes the fault: files that never arrived, a
 * process that is not up, a host that would not answer, and — for everything
 * else, including a model somebody switched off or one the host has stopped
 * listing — the job's own view, where the pair can be changed.
 */
function fixFor(
	entry: DefaultsSummaryEntry,
	facts: EntryFacts
): ReadinessAction {
	if (facts.localState === "not_downloaded" || facts.localState === "error")
		return { verb: "download", label: "Download", emphasis: "tonal" }
	if (facts.kcppRun === "stopped")
		return { verb: "start", label: "Start", emphasis: "tonal" }
	if (facts.syncError)
		return { verb: "refresh", label: "Refresh", emphasis: "tonal" }
	return { verb: "change", label: "Change", emphasis: "tonal" }
}

export function readinessRows(
	entries: readonly DefaultsSummaryEntry[],
	factsFor: (entry: DefaultsSummaryEntry) => EntryFacts = () => ({})
): ReadinessRow[] {
	return entries.map((entry) => readinessRow(entry, factsFor(entry)))
}

// ── Chat, while nothing is registered for it ───────────────────────────────

/**
 * A connection as the chat decision reads it: the fields the chat capability
 * view's candidate list reads (`candidateRows`), so the count said here is the
 * count that view then offers with **Use**.
 */
export interface ChatSource {
	name?: string | null
	models: readonly {
		enabled?: boolean
		missingSince?: string | null
		satisfiableCapabilities?: readonly string[] | null
		local?: { state?: string } | null
	}[]
}

/**
 * Some model on it can serve chat at all — switched on or off, listed or not.
 * The question `servesCapability` asks for the index's Chat filter, and the
 * one "only when nothing serves chat" turns on.
 */
export function servesChat(connection: ChatSource): boolean {
	return connection.models.some((m) =>
		(m.satisfiableCapabilities ?? []).includes("text->text")
	)
}

/** Its chat models the job picker would offer with **Use**. */
export function chatModelCount(connection: ChatSource): number {
	return connection.models.filter(
		(m) =>
			m.enabled !== false &&
			m.missingSince == null &&
			(m.satisfiableCapabilities ?? []).includes("text->text") &&
			m.local?.state !== "not_downloaded"
	).length
}

/**
 * What an UNSET chat offers, and so where its one gold button goes.
 *
 * ⚠ The Set up chat stepper installs and runs KoboldCPP. It is the answer only
 * while NOTHING here can serve chat: a person whose OpenRouter listed 503
 * models pressed **Set up chat** and was handed a build picker, and left with
 * a stray `KoboldCPP · Not set up` row (walk 2026-10-06). Once anything serves
 * chat the button is **Choose a model** and opens the job picker for Chat
 * replies, which lists every candidate with **Use** — the person picks; this only
 * points (no auto-pick, the owner's no-magic rule).
 */
export interface ChatChoice {
	/** Something here serves chat: choose among it rather than set up anew. */
	choose: boolean
	/** "OpenRouter lists 503 models · pick one"; null with nothing to pick. */
	sentence: string | null
}

export function chatChoice(connections: readonly ChatSource[]): ChatChoice {
	const listing = connections
		.map((c) => ({ name: c.name, count: chatModelCount(c) }))
		.filter((c) => c.count > 0)
	const total = listing.reduce((sum, c) => sum + c.count, 0)
	const models = `${total} ${total === 1 ? "model" : "models"}`
	return {
		choose: connections.some(servesChat),
		sentence:
			listing.length === 1
				? `${listing[0].name || "Untitled connection"} lists ${models} · pick one`
				: listing.length > 1
					? `${listing.length} connections list ${models} · pick one`
					: null
	}
}
