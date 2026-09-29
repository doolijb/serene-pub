/**
 * What the managed connection view SAYS, decided away from the markup.
 *
 * The Ollama and KoboldCPP managers stopped being screens of their own with
 * the 2026-09-17 concept ruling (R2): each is now the connection view of its
 * connection. That fold moved five tabs, two setup flows and a subprocess card
 * into one component, so everything that is a decision rather than a layout
 * lives here — which screen a manager is on, which tabs exist, the three lines
 * of the status card, and the sentence the Remove dialog asks.
 *
 * ⚠ **A silent fact is left out, never guessed** — the same rule
 * `connectionRowStatus` keeps. Every one of these comes from an event the
 * server may not have answered yet, and a card that claimed "Stopped" because
 * nothing had replied would be a card offering to Start something that is
 * already running. So each of these returns `null` where it has nothing true
 * to say, and the view omits the line rather than printing a placeholder.
 *
 * ⚠ Pure, and injected with `now`, so "PID 1234 · 4m 12s" can be asserted in
 * a test rather than described in a comment.
 */
import type { DownloadSource } from "./downloads.svelte"
import { sameHost } from "$lib/shared/connections/hostKey"

export type ManagedKind = "koboldcpp" | "ollama"

/** Same five tones the index row uses, so one dot means one thing app-wide. */
export type StatusDot = "ok" | "pending" | "warning" | "error" | "quiet"

/** What a person calls this runtime. */
export function managedLabel(kind: ManagedKind): string {
	return kind === "koboldcpp" ? "KoboldCPP" : "Ollama"
}

/**
 * Which screen the view is on.
 *
 * KoboldCPP has three states before it has tabs — it has a binary to fetch and
 * a mode to choose — and Ollama has none: it runs outside this pub, so there
 * is nothing to install and the "not reachable" case is a sentence on the
 * status card rather than a screen of its own (ruling R2's "no separate
 * screen"). That asymmetry is the whole of this function.
 */
export type ManagedStage =
	| "kcpp-mode"
	| "kcpp-binary"
	| "kcpp-external-setup"
	| "tabs"

/**
 * Where the managed KoboldCPP install stands, from its settings alone.
 *
 * ONE reading, shared by the index row (`connectionRowStatus`) and this view,
 * so the row and the view it opens always agree. Two readings — the flag on
 * one side, mode and binary on the other — disagree exactly when the flag is
 * off and a binary is still on disk.
 *
 * - `loading` — settings have not arrived; say nothing about the install.
 * - `not-installed` — flag off and nothing set up: the setup flow's job.
 * - `offline` — flag off with a mode (and, when managed, a binary) still
 *   recorded: switched off, files kept. Start turns it back on (ruled
 *   2026-09-24).
 * - `no-mode` / `no-binary` — flag on, setup unfinished.
 * - `ready` — flag on and set up; the process status decides the rest.
 */
export type KcppInstallState =
	| "loading"
	| "not-installed"
	| "offline"
	| "no-mode"
	| "no-binary"
	| "ready"

export interface KcppInstallSettings {
	koboldCppManagerEnabled?: boolean | null
	koboldCppManagedMode?: string | null
	koboldCppManagedBinaryVariant?: string | null
}

export function kcppInstallState(
	settings: KcppInstallSettings | null | undefined
): KcppInstallState {
	if (!settings) return "loading"
	const mode = settings.koboldCppManagedMode ?? null
	const setUp =
		mode === "external" ||
		(mode === "managed" && !!settings.koboldCppManagedBinaryVariant)
	if (!settings.koboldCppManagerEnabled)
		return setUp ? "offline" : "not-installed"
	if (mode === null) return "no-mode"
	return setUp ? "ready" : "no-binary"
}

export interface KcppStageFacts {
	/** `null` until somebody has chosen managed or external. */
	managedMode: "managed" | "external" | null
	/** A binary variant is recorded in settings. */
	hasBinary: boolean
	/** The picker was asked for by hand — "Change binary", or a re-download. */
	pickerRequested: boolean
	/** External mode has answered at its URL at least once this visit. */
	connected: boolean
}

export function managedStage(
	kind: ManagedKind,
	facts: KcppStageFacts
): ManagedStage {
	if (kind === "ollama") return "tabs"
	if (facts.managedMode === null) return "kcpp-mode"
	if (facts.managedMode === "managed")
		return !facts.hasBinary || facts.pickerRequested
			? "kcpp-binary"
			: "tabs"
	return facts.connected ? "tabs" : "kcpp-external-setup"
}

/** One tab. `icon` is a `@lucide/svelte` export name, resolved by the view. */
export interface ManagedTab {
	value: "models" | "get" | "downloads" | "settings"
	label: string
	icon: string
}

/**
 * The four tabs, the same four for both runtimes.
 *
 * "Get models" is NOT the managers' old Available tabs: those are retired in
 * favour of the one model finder (ruling R3), so this tab IS that finder,
 * mounted in place and scoped to this connection — it was a single button
 * leading to the same finder until plan 2026-09-24 C3.
 */
export function managedTabs(stage: ManagedStage): ManagedTab[] {
	if (stage !== "tabs") return []
	return [
		// ⚠ One word each. Four labelled tabs share 400px in the dock, and
		// "Get models" / "Downloads" rendered as "Get mo…" / "Downlo…" — a tab
		// strip nobody can read the end of. The icon carries the rest.
		{ value: "models", label: "Models", icon: "Package" },
		{ value: "get", label: "Get", icon: "Search" },
		{ value: "downloads", label: "Arriving", icon: "Download" },
		{ value: "settings", label: "Settings", icon: "Settings" }
	]
}

/** Which download feeds belong to this runtime, for the tab's activity dot. */
export function downloadSourcesFor(
	kind: ManagedKind
): readonly DownloadSource[] {
	return kind === "koboldcpp"
		? (["koboldcpp", "koboldcpp-binary"] as const)
		: (["ollama"] as const)
}

// ── The status card ─────────────────────────────────────────────────────────

/** A dot, a word, and a muted clause after it. */
export interface StatusLine {
	dot: StatusDot
	label: string
	meta: string | null
}

const RUN_LABEL: Record<string, string> = {
	running: "Running",
	starting: "Starting",
	stopping: "Stopping",
	stopped: "Stopped",
	crashed: "Crashed"
}
const RUN_DOT: Record<string, StatusDot> = {
	running: "ok",
	starting: "pending",
	stopping: "pending",
	stopped: "quiet",
	crashed: "error"
}

/** Whole seconds as "12s", "4m 12s", "1h 04m". */
export function formatUptime(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds < 0) return "0s"
	if (seconds < 60) return `${Math.floor(seconds)}s`
	if (seconds < 3600)
		return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`
	const h = Math.floor(seconds / 3600)
	const m = Math.floor((seconds % 3600) / 60)
	return `${h}h ${String(m).padStart(2, "0")}m`
}

/** How long the process has been up, or null for an absent or future start. */
export function uptimeSince(
	startedAt: string | null | undefined,
	now: number = Date.now()
): string | null {
	if (!startedAt) return null
	const then = Date.parse(startedAt)
	if (!Number.isFinite(then)) return null
	const seconds = (now - then) / 1000
	return seconds >= 0 ? formatUptime(seconds) : null
}

export interface KcppProcessFacts {
	status: "stopped" | "starting" | "running" | "crashed" | "stopping" | null
	pid?: number | null
	startedAt?: string | null
}

/**
 * The managed process's own line: what it is doing, and which process it is.
 *
 * Null while nothing has answered — see the module note. "Stopped" is not a
 * fault and carries no ember: the manager starts the process on the first
 * request, which is the point of it being managed.
 */
export function kcppProcessLine(
	facts: KcppProcessFacts,
	now: number = Date.now()
): StatusLine | null {
	if (!facts.status) return null
	const uptime =
		facts.status === "running" || facts.status === "stopping"
			? uptimeSince(facts.startedAt, now)
			: null
	const meta = [facts.pid ? `PID ${facts.pid}` : null, uptime]
		.filter(Boolean)
		.join(" · ")
	return {
		dot: RUN_DOT[facts.status] ?? "quiet",
		label: RUN_LABEL[facts.status] ?? facts.status,
		meta: meta || null
	}
}

/**
 * A context window as a person says it: 8192 tokens is "8k".
 *
 * Under 1024 it is said in full — "512 context" is a real setting, and "0k"
 * would be a lie about it.
 */
export function contextLabel(tokens: number | null | undefined): string | null {
	if (tokens == null || !Number.isFinite(tokens) || tokens <= 0) return null
	if (tokens < 1024) return String(Math.round(tokens))
	return `${Math.round(tokens / 1024)}k`
}

export interface KcppResident {
	text?: { file: string; contextSize?: number } | null
	image?: { file: string } | null
}

export interface LoadedLine {
	text: string
	/** There is something to unload. */
	loaded: boolean
}

/**
 * What the process is holding.
 *
 * Both keys are read, and either may be absent: an image-only load is an
 * ordinary state now, not an edge case, and a card that gated on the text
 * entry would call a loaded image model "nothing".
 */
export function kcppLoadedLine(
	resident: KcppResident | null | undefined
): LoadedLine {
	const files = [resident?.text?.file, resident?.image?.file].filter(
		(f): f is string => !!f
	)
	if (!files.length)
		return { text: "Nothing loaded · loads on first use", loaded: false }
	const context = contextLabel(resident?.text?.contextSize)
	return {
		text: [
			"Loaded",
			files.join(", "),
			context ? `${context} context` : null
		]
			.filter(Boolean)
			.join(" · "),
		loaded: true
	}
}

export interface KcppPerfFacts {
	idle: boolean
	avgGenSpeed: number
	totalGens: number
	queue: number
}

/**
 * The meter line. Bare numbers, never a time estimate (ruling R7).
 *
 * The speed clause is dropped rather than printed as a dash: koboldcpp reports
 * 0 until it has generated anything, and "0.0 tok/s" reads as a fault on a
 * process that is simply idle.
 */
export function kcppPerfLine(
	perf: KcppPerfFacts | null | undefined
): string | null {
	if (!perf) return null
	const speed =
		perf.avgGenSpeed > 0 ? `${perf.avgGenSpeed.toFixed(1)} tok/s` : null
	const gens = `${perf.totalGens} ${perf.totalGens === 1 ? "generation" : "generations"}`
	return [perf.idle ? "Idle" : "Busy", speed, gens, `queue ${perf.queue}`]
		.filter(Boolean)
		.join(" · ")
}

/** A KoboldCPP somebody else runs: reached, or not. */
export function kcppExternalLine(facts: {
	connected: boolean
	version?: string | null
}): StatusLine {
	return facts.connected
		? {
				dot: "ok",
				label: "Connected",
				meta: facts.version ?? null
			}
		: { dot: "warning", label: "Not reachable", meta: null }
}

export interface OllamaFacts {
	/** `null` until `ollama:version` has answered either way. */
	reachable: boolean | null
	version?: string | null
	/** How many models the host lists, or null when it has not said. */
	modelCount?: number | null
	/** How many it is holding in memory, or null when it has not said. */
	runningCount?: number | null
}

/**
 * Ollama's line. Null while nothing has answered — see the module note.
 *
 * The counts ride in `meta` because they are the second thing a person wants
 * and the first is whether it is up at all.
 */
export function ollamaStatusLine(facts: OllamaFacts): StatusLine | null {
	if (facts.reachable == null) return null
	if (!facts.reachable)
		return { dot: "warning", label: "Not reachable", meta: null }
	const clauses: string[] = []
	if (facts.modelCount != null)
		clauses.push(
			`${facts.modelCount} ${facts.modelCount === 1 ? "model" : "models"}`
		)
	if (facts.runningCount != null && facts.runningCount > 0)
		clauses.push(`${facts.runningCount} in memory`)
	return {
		dot: "ok",
		label: "Running",
		meta: [facts.version, clauses.join(" · ") || null]
			.filter(Boolean)
			.join(" · ")
	}
}

/**
 * The sentence for an Ollama nobody answered.
 *
 * It names the URL and says whose job the fix is: Ollama is not a process this
 * pub can start, so an error that only said "not reachable" would leave a
 * person pressing a button that can never work.
 */
export function ollamaUnreachableSentence(
	baseUrl: string | null | undefined
): string {
	const where = baseUrl?.trim() || "http://localhost:11434"
	return `Nothing answered at ${where}. Ollama runs outside Serene Pub, so start it there, or point this at another machine.`
}

// ── Removing a manager ──────────────────────────────────────────────────────

/**
 * The rows one manager owns. KoboldCPP's is one endpoint (⏳ the image id is
 * listed until the boot fold has retired it); Ollama's, every host's row.
 */
export function managedConnectionIds(
	kind: ManagedKind,
	rows: readonly { id?: number | null; type?: string | null }[]
): number[] {
	const types =
		kind === "koboldcpp"
			? ["koboldcpp_managed", "koboldcpp_managed_image"]
			: ["ollama"]
	return rows
		.filter((r) => r.id != null && types.includes(r.type ?? ""))
		.map((r) => r.id as number)
}

/** The transforms whose capability default points at one of these rows. */
export function capabilitiesServedBy(
	connectionIds: readonly number[],
	capabilityDefaults: Record<
		string,
		{ connectionId?: number | null } | undefined
	>
): string[] {
	const ids = new Set(connectionIds)
	return Object.entries(capabilityDefaults ?? {})
		.filter(([, d]) => d?.connectionId != null && ids.has(d.connectionId))
		.map(([capability]) => capability)
}

export interface RemoveConfirmation {
	title: string
	body: string
	/** What stops working, when anything does. Null when nothing points here. */
	cost: string | null
	confirmLabel: string
}

/**
 * The Remove dialog's words.
 *
 * It names the capability defaults that point at this runtime BEFORE the
 * press, because that is the one consequence a person cannot see from the
 * screen they are standing on — the connection is listed here, but "chat
 * answers through it" is recorded somewhere else entirely.
 */
export function removeConfirmation(
	kind: ManagedKind,
	capabilityLabels: readonly string[]
): RemoveConfirmation {
	const label = managedLabel(kind)
	const names = [...capabilityLabels]
	const listed =
		names.length === 0
			? null
			: names.length === 1
				? names[0]
				: `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`
	// Ollama removes ONE connection: each is managed on its own host, and
	// the others stay (plan 2026-09-24 B4).
	if (kind === "ollama")
		return {
			title: "Remove this Ollama connection?",
			body: "The connection goes. Ollama itself keeps running, and its models stay where they are.",
			cost: listed
				? `This connection currently answers for ${listed}. Those stop until you pick another model.`
				: null,
			confirmLabel: "Remove connection"
		}
	return {
		title: `Remove ${label} from this pub?`,
		body: "The connection goes, and Serene Pub stops running KoboldCPP. Downloaded models stay on disk.",
		cost: listed
			? `${label} currently answers for ${listed}. Those stop until you pick another model.`
			: null,
		confirmLabel: `Remove ${label}`
	}
}

// ── Duplicate Ollama hosts ───────────────────────────────────────────────────


/**
 * Other Ollama connections pointing at the same host as this one.
 *
 * One Ollama connection per host serves every modality it has (owner ruling
 * 2026-09-25), and the server now refuses a second — but installs that had
 * both an Ollama and an Ollama-embeddings connection to one host were left
 * with two Ollama rows to it by the rename that merged the types. That rename
 * was deliberately in place rather than a fold, because a fold deletes a row
 * other rows may reference by id. So the duplicate exists, and the view says
 * so instead of silently showing one host twice.
 *
 * `sameHost` is the SAME rule the server's refusal reads.
 */
export function duplicateOllamaHosts<
	T extends { id?: number | null; type?: string | null; baseUrl?: string | null; name?: string | null }
>(self: T | undefined, connections: readonly T[]): T[] {
	if (!self || self.id == null) return []
	return connections.filter(
		(c) =>
			c.id != null &&
			c.id !== self.id &&
			c.type === self.type &&
			sameHost(c.baseUrl, self.baseUrl)
	)
}
