/**
 * The audio lists - `audio.yaml` (the recommended audio.cpp packages) and
 * `audio-families.yaml` (the family detector's rules) - read ONCE per process.
 *
 * Both live in the list repo (plan D3): task and family are data, never read
 * from the audio.cpp binary or one of its specs, so a new family needs a list
 * edit and no app release.
 *
 * ## Where the text comes from
 *   1. fetched   the raw files from the list repo, one fetch per process
 *                (memoised on globalThis so a Vite SSR reload does not refetch);
 *                on success both texts are written to
 *                `system_settings.ggufListCache` for the next offline boot
 *   2. cached    the last successful fetch, when this one fails
 *   3. snapshot  the copy shipped under `./snapshot/` (first boot, offline)
 * `source` says which one answered. Nothing here throws for a bad entry: it is
 * dropped with a console.warn, and a number that does not parse reads as 0 /
 * undefined, never NaN.
 *
 * Unlike recommended.yaml (flat, hand-parsed) these files nest, so they use
 * the `yaml` library.
 */

import { asc, eq } from "drizzle-orm"
import { parse as parseYaml } from "yaml"
import { systemSettings } from "$lib/server/db/schema"
import {
	AUDIO_FAMILIES_SNAPSHOT,
	type AudioFamily,
	type AudioFamilyVariant,
	type AudioTask,
	type AudioVoices
} from "$lib/shared/audio/audioFamilies"
import { derivePrecision } from "$lib/shared/audio/precision"
import audioSnapshotText from "./snapshot/audio.yaml?raw"
import familiesSnapshotText from "./snapshot/audio-families.yaml?raw"

export const AUDIO_LIST_BASE_URL =
	"https://raw.githubusercontent.com/SerenePub/serene-pub-gguf-list/main/"
export const AUDIO_YAML = "audio.yaml"
export const AUDIO_FAMILIES_YAML = "audio-families.yaml"


export { derivePrecision }
export type AudioRuntime = "audiocpp" | "koboldcpp"
const RUNTIMES: readonly string[] = ["audiocpp", "koboldcpp"]

const isBareFile = (f: string) => !/[\\/]/.test(f) && f !== "." && f !== ".."

export interface AudioListEntry {
	id: string
	/** Hugging Face repo. */
	name: string
	revision: string
	displayName: string
	family: string
	task: AudioTask
	variant?: string
	/** Numeric precision of the files (`q8_0`, `bf16`, `f16`, `q4`…); from the list, else derived from the file/id; absent when neither says. */
	precision?: string
	/** Who runs the files. `koboldcpp` rows are never audio.cpp packages. */
	runtime: AudioRuntime
	files: string[]
	/** `""` for a koboldcpp row (files land flat in KoboldCPP's models folder). */
	targetDirectory: string
	stripPrefix: string
	/** Exact bytes of all files; 0 when the list quotes none. */
	sizeBytes: number
	/** GB; 0 = fine on a CPU. */
	recommendedVram: number
	license?: string
	tags: string[]
	details: { description: string }
}

export type AudioListSource = "fetched" | "cached" | "snapshot"

export interface AudioLists {
	entries: AudioListEntry[]
	families: AudioFamily[]
	source: AudioListSource
}

export interface AudioListOptions {
	fetch?: typeof fetch
	/** Refetch even when this process already did. */
	force?: boolean
}

const TASKS: readonly string[] = ["tts", "asr", "vdes"]
const VOICES: readonly string[] = ["catalogue", "listed", "none"]

const isObj = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v)

const str = (v: unknown): string =>
	typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : ""

function num(v: unknown): number {
	const n = typeof v === "number" ? v : parseFloat(String(v ?? ""))
	return Number.isFinite(n) && n >= 0 ? n : 0
}

const strList = (v: unknown): string[] =>
	Array.isArray(v) ? v.map(str).filter((s) => s.length > 0) : []

function load(text: string, key: string): unknown[] {
	try {
		const doc = parseYaml(text)
		const list = isObj(doc) ? doc[key] : null
		return Array.isArray(list) ? list : []
	} catch (e) {
		console.warn(`[audio list] could not parse YAML: ${(e as Error).message}`)
		return []
	}
}

export function parseAudioYaml(text: string): AudioListEntry[] {
	const out: AudioListEntry[] = []
	const seen = new Set<string>()
	for (const raw of load(text, "models")) {
		if (!isObj(raw)) {
			console.warn("[audio list] dropped a non-mapping entry in audio.yaml")
			continue
		}
		const id = str(raw.id)
		const family = str(raw.family)
		const task = str(raw.task)
		const files = strList(raw.files)
		if (!id || !family || !TASKS.includes(task) || files.length === 0) {
			console.warn(`[audio list] dropped malformed audio.yaml entry "${id || "?"}"`)
			continue
		}
		if (seen.has(id)) {
			console.warn(`[audio list] dropped duplicate audio.yaml entry "${id}"`)
			continue
		}
		const runtimeRaw = str(raw.runtime) || "audiocpp"
		if (!RUNTIMES.includes(runtimeRaw)) {
			console.warn(`[audio list] dropped audio.yaml entry "${id}": unknown runtime "${runtimeRaw}"`)
			continue
		}
		const runtime = runtimeRaw as AudioRuntime
		// A koboldcpp row downloads file-by-file into one flat folder: its
		// files are bare root names, and it has no directory layout of its own.
		if (runtime === "koboldcpp" && !files.every(isBareFile)) {
			console.warn(
				`[audio list] dropped koboldcpp audio.yaml entry "${id}": files must be bare file names`
			)
			continue
		}
		seen.add(id)
		const license = str(raw.license)
		const variant = str(raw.variant)
		const precision = str(raw.precision).toLowerCase() || derivePrecision(files[0], id)
		out.push({
			id,
			name: str(raw.name) || "audio-cpp/audio.cpp-gguf",
			revision: str(raw.revision) || "main",
			displayName: str(raw.display_name) || id,
			family,
			task: task as AudioTask,
			...(variant ? { variant } : {}),
			...(precision ? { precision } : {}),
			runtime,
			files,
			targetDirectory: runtime === "koboldcpp" ? "" : str(raw.target_directory),
			stripPrefix: runtime === "koboldcpp" ? "" : str(raw.strip_prefix),
			sizeBytes: Math.round(num(raw.size_bytes)),
			recommendedVram: num(raw.recommended_vram),
			...(license ? { license } : {}),
			tags: strList(raw.tags),
			details: {
				description: isObj(raw.details) ? str(raw.details.description) : ""
			}
		})
	}
	return out
}

export function parseAudioFamiliesYaml(text: string): AudioFamily[] {
	const out: AudioFamily[] = []
	const seen = new Set<string>()
	for (const raw of load(text, "families")) {
		if (!isObj(raw)) {
			console.warn("[audio list] dropped a non-mapping entry in audio-families.yaml")
			continue
		}
		const family = str(raw.family)
		const tasks = strList(raw.tasks).filter((t) => TASKS.includes(t)) as AudioTask[]
		if (!family || tasks.length === 0 || seen.has(family)) {
			console.warn(
				`[audio list] dropped malformed audio-families.yaml entry "${family || "?"}"`
			)
			continue
		}
		seen.add(family)
		const m = isObj(raw.match) ? raw.match : {}
		const voices = str(raw.voices)
		const variants: AudioFamilyVariant[] = []
		if (Array.isArray(raw.variants)) {
			for (const v of raw.variants) {
				if (!isObj(v) || !str(v.variant)) {
					console.warn(`[audio list] dropped a malformed variant of "${family}"`)
					continue
				}
				const vm = isObj(v.match) ? v.match : {}
				const task = str(v.task)
				variants.push({
					variant: str(v.variant),
					...(TASKS.includes(task) ? { task: task as AudioTask } : {}),
					match: { repos: strList(vm.repos), files: strList(vm.files) }
				})
			}
		}
		out.push({
			family,
			tasks,
			runner: str(raw.runner) || "audiocpp",
			voices: (VOICES.includes(voices) ? voices : "none") as AudioVoices,
			match: {
				repos: strList(m.repos),
				files: strList(m.files),
				ggufArchitectures: strList(m.gguf_architectures),
				ggufFamilies: strList(m.gguf_families),
				hfPipelineTags: strList(m.hf_pipeline_tags),
				hfTags: strList(m.hf_tags)
			},
			...(variants.length ? { variants } : {})
		})
	}
	return out
}

// ---- loading ----------------------------------------------------------------

const MEMO_KEY = "__serenePubAudioLists" as const
type Memo = { lists: AudioLists | null; pending: Promise<AudioLists> | null }
const memo = (): Memo => {
	const g = globalThis as unknown as Record<string, Memo | undefined>
	return (g[MEMO_KEY] ??= { lists: null, pending: null })
}

/** Forget the process memo (tests). */
export function resetAudioListsMemo(): void {
	const m = memo()
	m.lists = null
	m.pending = null
}

async function fetchText(f: typeof fetch, name: string): Promise<string> {
	const res = await f(AUDIO_LIST_BASE_URL + name)
	if (!res.ok) throw new Error(`${name} fetch failed: ${res.status}`)
	return await res.text()
}

async function settingsRowId(db: Db): Promise<number | null> {
	const [row] = await db
		.select({ id: systemSettings.id })
		.from(systemSettings)
		.orderBy(asc(systemSettings.id))
		.limit(1)
	return row?.id ?? null
}

async function readCache(
	db: Db
): Promise<Record<string, { text: string; fetchedAt: string }>> {
	try {
		const [row] = await db
			.select({ cache: systemSettings.ggufListCache })
			.from(systemSettings)
			.orderBy(asc(systemSettings.id))
			.limit(1)
		return row?.cache ?? {}
	} catch {
		return {}
	}
}

async function writeCache(db: Db, audio: string, families: string): Promise<void> {
	try {
		const id = await settingsRowId(db)
		if (id === null) return
		const [{ cache }] = await db
			.select({ cache: systemSettings.ggufListCache })
			.from(systemSettings)
			.orderBy(asc(systemSettings.id))
			.limit(1)
		const fetchedAt = new Date().toISOString()
		const next = {
			...(cache ?? {}),
			[AUDIO_YAML]: { text: audio, fetchedAt },
			[AUDIO_FAMILIES_YAML]: { text: families, fetchedAt }
		}
		await db
			.update(systemSettings)
			.set({ ggufListCache: next })
			.where(eq(systemSettings.id, id))
	} catch (e) {
		console.warn(`[audio list] could not cache the lists: ${(e as Error).message}`)
	}
}

function build(audio: string, families: string, source: AudioListSource): AudioLists {
	const entries = parseAudioYaml(audio)
	let fams = parseAudioFamiliesYaml(families)
	if (fams.length === 0) fams = AUDIO_FAMILIES_SNAPSHOT
	return { entries, families: fams, source }
}

async function load3(db: Db, opts: AudioListOptions): Promise<AudioLists> {
	const f = opts.fetch ?? fetch
	try {
		const [audio, families] = await Promise.all([
			fetchText(f, AUDIO_YAML),
			fetchText(f, AUDIO_FAMILIES_YAML)
		])
		const lists = build(audio, families, "fetched")
		if (lists.entries.length === 0) throw new Error("audio.yaml had no usable entries")
		await writeCache(db, audio, families)
		return lists
	} catch (e) {
		console.warn(`[audio list] fetch failed (${(e as Error).message}); using the fallback`)
	}
	const cache = await readCache(db)
	const a = cache[AUDIO_YAML]?.text
	const b = cache[AUDIO_FAMILIES_YAML]?.text
	if (a && b) {
		const lists = build(a, b, "cached")
		if (lists.entries.length > 0) return lists
	}
	return build(audioSnapshotText, familiesSnapshotText, "snapshot")
}

export async function getAudioLists(
	db: Db,
	opts: AudioListOptions = {}
): Promise<AudioLists> {
	const m = memo()
	if (!opts.force) {
		if (m.lists) return m.lists
		if (m.pending) return m.pending
	}
	const pending = load3(db, opts)
		.then((lists) => {
			m.lists = lists
			return lists
		})
		.finally(() => {
			if (m.pending === pending) m.pending = null
		})
	m.pending = pending
	return pending
}

/** Refetch now, whatever the memo says. */
export const refreshAudioLists = (db: Db, opts: AudioListOptions = {}) =>
	getAudioLists(db, { ...opts, force: true })
