/**
 * The audio finder's grouped view: every model once, with the precisions it
 * comes in, whoever runs it.
 *
 * - audio.cpp rows come from `listAudioCppPackages` (listed, matched and
 *   guessed alike) and are grouped by family + variant.
 * - KoboldCPP rows (`runtime: koboldcpp` in audio.yaml) are built here from the
 *   list; their state is "downloaded" when every file sits at the root of
 *   KoboldCPP's text models folder. They never enter the flat `packages` and
 *   no audio.cpp code path touches them (see `audioCppOnly`).
 */
import * as fsPromises from "fs/promises"
import type { AudioListEntry } from "$lib/server/audio/audioList"
import { derivePrecision } from "$lib/shared/audio/precision"

type PackageRow = Sockets.AudioCpp.PackageRow
type PackageFamily = Sockets.AudioCpp.PackageFamily

const rank = (p: string | undefined): number => {
	const s = (p ?? "").toLowerCase()
	if (s === "q8_0") return 0
	if (s === "bf16") return 1
	if (s === "f16") return 2
	return 3
}

/** "Qwen3-TTS 1.7B CustomVoice (Q8_0)" -> "Qwen3-TTS 1.7B CustomVoice". */
export const nameWithoutPrecision = (name: string): string =>
	name.replace(/\s*\([^()]*\)\s*$/, "").trim() || name

function hfUrl(entry: AudioListEntry, file: string): string {
	const enc = (s: string) => s.split("/").map(encodeURIComponent).join("/")
	return `https://huggingface.co/${enc(entry.name)}/resolve/${encodeURIComponent(entry.revision)}/${enc(file)}`
}

/** One KoboldCPP list entry as a row; `dirFiles` = file names at the root of the models folder. */
export function koboldCppRow(entry: AudioListEntry, dirFiles: ReadonlySet<string>): PackageRow {
	const downloaded = entry.files.length > 0 && entry.files.every((f) => dirFiles.has(f))
	return {
		id: entry.id,
		name: entry.displayName,
		task: entry.task,
		family: entry.family,
		variant: entry.variant,
		files: [...entry.files],
		sizeBytes: entry.sizeBytes,
		recommendedVram: entry.recommendedVram,
		license: entry.license,
		tags: entry.tags ?? [],
		description: entry.details?.description,
		confidence: "listed",
		state: downloaded ? "downloaded" : "available",
		recommended: false,
		precision: entry.precision ?? derivePrecision(entry.files[0] ?? "", entry.id),
		runtime: "koboldcpp",
		koboldCppFiles: entry.files.map((filename) => ({
			filename,
			downloadUrl: hfUrl(entry, filename)
		}))
	}
}

export async function readRootFiles(dir: string | null): Promise<Set<string>> {
	if (!dir) return new Set()
	try {
		return new Set(await fsPromises.readdir(dir))
	} catch {
		return new Set()
	}
}

/**
 * Group rows (already ordered best-first) by runtime + family + variant +
 * model. The model is the display name without its precision: Qwen3-TTS 1.7B
 * Base and 0.6B Base share family and variant but are two models, and keyed
 * without it the one hid the other (MV).
 */
export function groupPackageRows(rows: PackageRow[]): PackageFamily[] {
	const groups = new Map<string, PackageRow[]>()
	for (const r of rows) {
		const runtime = r.runtime ?? "audiocpp"
		const model = nameWithoutPrecision(r.name)
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "_")
			.replace(/^_|_$/g, "")
		const key = `${runtime}:${r.family}:${r.variant ?? ""}:${model}`
		const arr = groups.get(key)
		if (arr) arr.push(r)
		else groups.set(key, [r])
	}
	const out: PackageFamily[] = []
	for (const [key, arr] of groups) {
		const precisions = [...arr].sort((a, b) => rank(a.precision) - rank(b.precision))
		const first = precisions[0]
		const recommended =
			precisions.find((r) => r.recommended) ??
			precisions.find((r) => (r.precision ?? "").toLowerCase() === "q8_0") ??
			first
		out.push({
			key,
			family: first.family,
			variant: first.variant ?? null,
			task: first.task,
			runtime: first.runtime ?? "audiocpp",
			displayName: nameWithoutPrecision(first.name),
			recommendedId: recommended.id,
			precisions
		})
	}
	return out
}

/**
 * `audioCppRows` are the flat audio.cpp packages; `allEntries` the full list
 * (KoboldCPP rows are taken from it); `modelsDir` KoboldCPP's text models folder.
 */
export async function buildPackageFamilies(
	audioCppRows: PackageRow[],
	allEntries: readonly AudioListEntry[],
	modelsDir: string | null
): Promise<PackageFamily[]> {
	const kobold = allEntries.filter((e) => e.runtime === "koboldcpp")
	const rows: PackageRow[] = [...audioCppRows]
	if (kobold.length) {
		const present = await readRootFiles(modelsDir)
		rows.push(...kobold.map((e) => koboldCppRow(e, present)))
	}
	return groupPackageRows(rows)
}
