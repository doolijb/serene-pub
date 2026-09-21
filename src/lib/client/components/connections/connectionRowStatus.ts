/**
 * ONE sentence per connection, and the one button that goes beside it.
 *
 * Lifted out of `ConnectionCard`, which said the same things in five slots
 * spread down a card. The index is a list now (2026-09-17 concept ruling R1),
 * and a list row is one dot, one line and at most one button (R7) — so the
 * five slots have to collapse into a single sentence per kind, which is what
 * this module is. The row renders what it gets and branches on nothing.
 *
 * ⚠ **A silent fact is left out of the sentence, never guessed.** Every one of
 * these comes from an event the server may not answer: a manager switched
 * off, a host that is down, a build whose handler is not written yet. Where
 * the answer has not come the clause is simply absent, and the row falls back
 * to what the list row itself says — how many models, checked when. A row
 * that claimed "Stopped" because nothing had answered yet would be a row
 * offering to Start something that is already running.
 *
 * ⚠ Pure, and injected with its formatters. `timeAgo` and `now` come in as
 * arguments so a sentence with "checked 3 minutes ago" in it can be asserted
 * in a test rather than described in a comment.
 */
import {
	idleMinutes,
	type KcppStatus,
	type LaneStatus,
	type OllamaStatus
} from "./endpointStatus"
import type { EndpointKind } from "./modelManagement"

export type RowDot = "ok" | "pending" | "warning" | "error" | "quiet"

/** The one action a row may offer. The row itself is what opens the connection. */
export interface RowStatusAction {
	verb: "stop" | "start" | "fix" | "refresh"
	label: string
	/** A `@lucide/svelte` export name, resolved by the component. */
	icon: string
	emphasis: "ghost" | "tonal"
}

export interface RowStatus {
	dot: RowDot
	sentence: string
	action: RowStatusAction | null
}

export interface RowModel {
	name: string
	model: string
	missingSince: string | null
	local?: {
		state?: "not_downloaded" | "downloading" | "on_disk" | "error"
		percent?: number
	}
}

export interface RowConnection {
	id: number
	name?: string | null
	type?: string | null
	baseUrl?: string | null
	models: readonly RowModel[]
	modelsSync: { at: string | null; error: string | null }
}

export interface RowStatusFacts {
	kind: EndpointKind
	/** The managed process, or null when it has not answered. */
	kcpp?: KcppStatus | null
	ollama?: OllamaStatus | null
	lane?: LaneStatus | null
	/** False only when the flag is known to be off. */
	managerEnabled?: boolean
	/**
	 * False when the managed KoboldCPP has no mode chosen yet, or is managed
	 * with no binary recorded — its view is still on a setup stage, and Start
	 * has nothing to start. Undefined when unknown.
	 */
	kcppSetUp?: boolean
	/** A forced listing is in flight for this connection. */
	syncing?: boolean
	/** "3 minutes ago". Injected so the sentence is testable. */
	timeAgo?: (iso: string) => string
	now?: number
}

/** Just the host — a URL's scheme and trailing slash are noise in a row. */
export function hostOf(baseUrl: string | null | undefined): string {
	const raw = baseUrl?.trim()
	if (!raw) return ""
	try {
		const u = new URL(raw)
		return (
			u.host + (u.pathname !== "/" ? u.pathname.replace(/\/$/, "") : "")
		)
	} catch {
		return raw
	}
}

const plural = (n: number, one: string, many = `${one}s`) =>
	`${n} ${n === 1 ? one : many}`

const STOP: RowStatusAction = {
	verb: "stop",
	label: "Stop",
	icon: "Square",
	emphasis: "ghost"
}
const START: RowStatusAction = {
	verb: "start",
	label: "Start",
	icon: "Play",
	emphasis: "ghost"
}
const FIX: RowStatusAction = {
	verb: "fix",
	label: "Fix",
	icon: "TriangleAlert",
	emphasis: "tonal"
}
const REFRESH: RowStatusAction = {
	verb: "refresh",
	label: "Refresh",
	icon: "RefreshCw",
	emphasis: "ghost"
}

export function connectionRowStatus(
	connection: RowConnection,
	facts: RowStatusFacts
): RowStatus {
	const missing = connection.models.filter(
		(m) => m.missingSince != null
	).length

	if (facts.syncing)
		return { dot: "pending", sentence: "Checking models…", action: null }

	switch (facts.kind) {
		case "koboldcpp-managed":
			return managedStatus(connection, facts, missing)
		case "ollama":
			return ollamaStatus(connection, facts, missing)
		case "onnx-embeddings":
		case "onnx-entities":
			return onnxStatus(connection, facts)
		default:
			return apiStatus(connection, facts, missing)
	}
}

/**
 * The managed KoboldCPP: a process this pub started, and the files it has.
 *
 * "Stopped" is not a fault and carries no ember — the manager starts the
 * process on the first request, which is the whole point of it being managed.
 * A CRASHED process is a fault, and it is the one that gets Start.
 */
function managedStatus(
	connection: RowConnection,
	facts: RowStatusFacts,
	missing: number
): RowStatus {
	const onDisk = plural(connection.models.length, "on disk", "on disk")
	// The manager flag is what "Add → KoboldCPP, run by Serene Pub" sets, so
	// a managed row with the flag off is one nobody has finished installing.
	if (facts.managerEnabled === false)
		return {
			dot: "quiet",
			sentence: "Not installed · one tap to set up",
			action: null
		}
	// The flag on but no mode or binary chosen: the view is on a setup stage
	// and the process status, whatever it says, is about nothing yet.
	if (facts.kcppSetUp === false)
		return {
			dot: "quiet",
			sentence: "Not set up · choose how to run it",
			action: null
		}
	const run = facts.kcpp?.run ?? null
	const loaded = facts.kcpp?.loadedFiles?.[0]
	switch (run) {
		case "running":
			return {
				dot: "ok",
				sentence: ["Running", loaded, onDisk]
					.filter(Boolean)
					.join(" · "),
				action: STOP
			}
		case "starting":
			return {
				dot: "pending",
				sentence: `Starting · ${onDisk}`,
				action: null
			}
		case "stopping":
			return {
				dot: "pending",
				sentence: `Stopping · ${onDisk}`,
				action: null
			}
		case "crashed":
			return {
				dot: "error",
				sentence: `Crashed · ${onDisk}`,
				action: START
			}
		case "stopped":
			return {
				dot: "quiet",
				sentence: `Stopped · starts on first use · ${onDisk}`,
				action: START
			}
		default:
			// Nothing has answered. Say only what the list row knows.
			return {
				dot: missing ? "warning" : "quiet",
				sentence: onDisk,
				action: missing ? REFRESH : null
			}
	}
}

function ollamaStatus(
	connection: RowConnection,
	facts: RowStatusFacts,
	missing: number
): RowStatus {
	const host = hostOf(connection.baseUrl)
	const models = plural(connection.models.length, "model")
	if (facts.ollama?.reachable === false)
		return {
			dot: "warning",
			sentence: ["Not reachable", host].filter(Boolean).join(" · "),
			action: FIX
		}
	if (facts.ollama?.reachable)
		return {
			dot: "ok",
			sentence: ["Running", models, host].filter(Boolean).join(" · "),
			action: missing ? REFRESH : null
		}
	return {
		dot: missing ? "warning" : "quiet",
		sentence: [models, host].filter(Boolean).join(" · "),
		action: missing ? REFRESH : null
	}
}

/**
 * A local ONNX endpoint: one model active app-wide, and files on this disk.
 *
 * The downloading clause comes off the ROW rather than the lane, because a
 * file can be arriving for a model that is not the active one.
 */
function onnxStatus(
	connection: RowConnection,
	facts: RowStatusFacts
): RowStatus {
	const downloading = connection.models.find(
		(m) => m.local?.state === "downloading"
	)
	if (downloading) {
		const percent = downloading.local?.percent
		return {
			dot: "pending",
			sentence:
				percent == null
					? `Downloading ${downloading.name}`
					: `Downloading ${downloading.name} · ${Math.round(percent)}%`,
			action: null
		}
	}
	const onDisk = connection.models.filter(
		(m) => m.local?.state === "on_disk"
	).length
	const lane = facts.lane
	if (!lane?.modelId)
		return {
			dot: "quiet",
			sentence: `Nothing active · ${onDisk} on disk`,
			action: null
		}
	const active =
		connection.models.find((m) => m.model === lane.modelId)?.name ??
		lane.modelId
	if (lane.loaded) {
		const minutes = idleMinutes(lane.lastUsedAt, facts.now)
		return {
			dot: "ok",
			sentence:
				minutes == null
					? `${active} active · loaded`
					: `${active} active · loaded, idle ${minutes} min`,
			action: null
		}
	}
	const row = connection.models.find((m) => m.model === lane.modelId)
	return {
		dot: row?.local?.state === "on_disk" ? "ok" : "warning",
		sentence:
			row?.local?.state === "on_disk"
				? `${active} active · on disk, not loaded`
				: `${active} active · not downloaded`,
		action: row?.local?.state === "on_disk" ? null : FIX
	}
}

function apiStatus(
	connection: RowConnection,
	facts: RowStatusFacts,
	missing: number
): RowStatus {
	const host = hostOf(connection.baseUrl)
	if (connection.modelsSync.error)
		return {
			dot: "warning",
			sentence: `Couldn't list models · ${connection.modelsSync.error}`,
			action: FIX
		}
	if (missing)
		return {
			dot: "warning",
			sentence: `${missing} of ${connection.models.length} no longer listed`,
			action: REFRESH
		}
	const checked =
		connection.modelsSync.at && facts.timeAgo
			? `checked ${facts.timeAgo(connection.modelsSync.at)}`
			: connection.modelsSync.at
				? null
				: "not checked yet"
	return {
		dot: connection.models.length ? "ok" : "quiet",
		sentence: [plural(connection.models.length, "model"), host, checked]
			.filter(Boolean)
			.join(" · "),
		action: null
	}
}
