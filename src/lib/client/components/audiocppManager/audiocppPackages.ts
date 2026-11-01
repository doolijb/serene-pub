/**
 * The audio.cpp Models tab's view of `audiocpp:listPackages`: pure, no sockets.
 *
 * Groups are the detector's answer (plan D3c): **Speech** (task `tts`, `vdes`)
 * and **Transcription** (`asr`), then family. A row whose family is empty or
 * not a usable id lands under **Unknown family** and can never be enabled.
 */
import { formatBytes } from "../connections/modelManagement"

export type PackageRow = Sockets.AudioCpp.PackageRow
export type PackageTask = PackageRow["task"]

export type PackageGroupKey = "speech" | "transcription"

export interface FamilyBucket {
	/** The audio family id; "" for the Unknown family bucket. */
	family: string
	label: string
	rows: PackageRow[]
}
export interface PackageGroup {
	key: PackageGroupKey
	label: string
	families: FamilyBucket[]
}

export const UNKNOWN_FAMILY_LABEL = "Unknown family"

/**
 * The rows audio.cpp SERVES: on disk or arriving, and run by audio.cpp.
 * Catalogue-only rows (`available`, not arriving) belong to the Get a model
 * dialog, and a `runtime: "koboldcpp"` row is KoboldCPP's, never audio.cpp's.
 */
export function servedRows(
	rows: PackageRow[],
	arriving: ReadonlySet<string> = new Set()
): PackageRow[] {
	return rows.filter(
		(r) =>
			(r.runtime ?? "audiocpp") === "audiocpp" &&
			(r.state !== "available" || arriving.has(r.id))
	)
}

/** The precision shown on a served row: "q8_0" → "Q8_0". */
export function precisionLabel(
	row: Pick<PackageRow, "precision">
): string | null {
	const p = (row.precision ?? "").trim()
	return p ? p.toUpperCase() : null
}

/** The Get more… door: the finder on this connection, for speech models. */
export function getMoreFinder(connectionId: number | undefined) {
	return connectionId == null
		? { capability: "text->audio" }
		: { connectionId, capability: "text->audio" }
}

/** The families the plan names. The list is data: any other id gets a readable fallback. */
const FAMILY_LABELS: Record<string, string> = {
	kokoro_tts: "Kokoro",
	qwen3_tts: "Qwen3-TTS",
	kitten_tts2: "Kitten TTS 2",
	parakeet_tdt: "Parakeet-TDT",
	qwen3_asr: "Qwen3-ASR"
}

/** The known family ids, for the Confirm family picker. */
export const KNOWN_FAMILIES: string[] = Object.keys(FAMILY_LABELS)

export function audioFamilyLabel(family: string | null | undefined): string {
	const id = (family ?? "").trim()
	if (!id) return UNKNOWN_FAMILY_LABEL
	if (FAMILY_LABELS[id]) return FAMILY_LABELS[id]
	const words = id.split(/[_\-\s]+/).filter(Boolean)
	if (!words.length) return UNKNOWN_FAMILY_LABEL
	return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(" ")
}

export const TASK_LABELS: Record<PackageTask, string> = {
	tts: "Speech",
	asr: "Transcription",
	vdes: "Voice design"
}

export function hasKnownFamily(row: PackageRow): boolean {
	return (row.family ?? "").trim() !== "" && row.family !== "unknown"
}

/** "CPU-fine" / "Wants 6 GB VRAM" / null when the list does not say. */
export function vramHint(row: Pick<PackageRow, "recommendedVram">): string | null {
	const n = row.recommendedVram
	if (n == null || !Number.isFinite(n)) return null
	if (n === 0) return "CPU-fine"
	if (n > 0) return `Wants ${n} GB VRAM`
	return null
}

export function sizeLabel(row: Pick<PackageRow, "sizeBytes">): string | null {
	return formatBytes(row.sizeBytes)
}

const STATE_RANK: Record<PackageRow["state"], number> = {
	enabled: 0,
	downloaded: 1,
	downloading: 2,
	available: 3
}

/** Recommended first, then enabled, downloaded, available; then name. */
export function compareRows(a: PackageRow, b: PackageRow): number {
	if (a.recommended !== b.recommended) return a.recommended ? -1 : 1
	const s = STATE_RANK[a.state] - STATE_RANK[b.state]
	if (s !== 0) return s
	return a.name.localeCompare(b.name)
}

/**
 * The view: Speech then Transcription; inside each, the family holding the
 * recommended package first (so the proposal is the first row read), the
 * rest alphabetical, Unknown last.
 */
export function groupPackages(rows: PackageRow[]): PackageGroup[] {
	const groups: PackageGroup[] = [
		{ key: "speech", label: "Speech", families: [] },
		{ key: "transcription", label: "Transcription", families: [] }
	]
	for (const row of rows) {
		const group = groups[row.task === "asr" ? 1 : 0]
		const family = hasKnownFamily(row) ? row.family : ""
		let bucket = group.families.find((f) => f.family === family)
		if (!bucket) {
			bucket = { family, label: audioFamilyLabel(family), rows: [] }
			group.families.push(bucket)
		}
		bucket.rows.push(row)
	}
	for (const g of groups) {
		for (const f of g.families) f.rows.sort(compareRows)
		const leads = (f: FamilyBucket) => f.rows.some((r) => r.recommended)
		g.families.sort((a, b) => {
			if (!a.family !== !b.family) return a.family ? -1 : 1
			if (leads(a) !== leads(b)) return leads(a) ? -1 : 1
			return a.label.localeCompare(b.label)
		})
	}
	return groups.filter((g) => g.families.length > 0)
}

export type RowAction =
	| "get"
	| "arriving"
	| "enable"
	| "disable"
	| "confirm-family"

export interface RowActions {
	/** The one main action; null when there is none (unknown family, nothing to do). */
	primary: { action: RowAction; label: string } | null
	/** Cancel while arriving. */
	canCancel: boolean
	/** Remove, once on disk. */
	canRemove: boolean
	/** A line explaining why there is no Enable. */
	note: string | null
}

export function rowActions(row: PackageRow): RowActions {
	const known = hasKnownFamily(row)
	switch (row.state) {
		case "available":
			return {
				primary: { action: "get", label: "Get" },
				canCancel: false,
				canRemove: false,
				note: null
			}
		case "downloading":
			return {
				primary: { action: "arriving", label: "Arriving" },
				canCancel: true,
				canRemove: false,
				note: null
			}
		case "downloaded":
		case "enabled": {
			const enabled = row.state === "enabled"
			// Lane B sends these as family "unknown", confidence "guessed": a
			// person names the family (`confirmFamily`) before it can be enabled.
			if (!known) {
				return {
					primary: enabled
						? { action: "disable", label: "Disable" }
						: { action: "confirm-family", label: "Confirm family" },
					canCancel: false,
					canRemove: true,
					note: "Serene Pub could not tell which audio family this is. Confirm it before it can be enabled."
				}
			}
			if (row.confidence === "guessed" && !enabled) {
				return {
					primary: { action: "confirm-family", label: "Confirm family" },
					canCancel: false,
					canRemove: true,
					note: `Looks like ${audioFamilyLabel(row.family)}. Confirm it before it can be enabled.`
				}
			}
			return {
				primary: enabled
					? { action: "disable", label: "Disable" }
					: { action: "enable", label: "Enable" },
				canCancel: false,
				canRemove: true,
				note: null
			}
		}
	}
}

/** A progress push merged into the rows' bytes: "120 MB of 1.2 GB". */
export function arrivingLabel(
	p: { downloaded: number; total: number } | undefined
): string | null {
	if (!p) return null
	const done = formatBytes(p.downloaded)
	if (!done) return null
	const total = p.total > 0 ? formatBytes(p.total) : null
	return total ? `${done} of ${total}` : done
}
