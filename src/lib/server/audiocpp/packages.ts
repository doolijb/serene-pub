/**
 * audio.cpp, run by Serene Pub — model packages.
 *
 * A package is one speech or transcription model: a set of files under
 * `<audio root>/<tts|asr>/<family>/<target_directory>/` (plan D3b). Packages
 * come from two places: the audio list (`audio.yaml`, confidence `listed`) and
 * a walk of that tree for GGUFs a person copied in by hand (`matched` by a
 * family rule or a confirmed sidecar, else `guessed`). This module owns the
 * paths, the listing and its states, the download, removal, enabling and
 * family confirmation. It never writes server.json and never restarts
 * anything — the socket layer asks the config/process modules for that.
 */
import * as fs from "fs"
import * as fsPromises from "fs/promises"
import * as path from "path"
import { eq } from "drizzle-orm"
import { audiocppSettings } from "$lib/server/db/schema"
import { getAppDataDir } from "$lib/server/utils/appDataDir"
import { ensureAudioCppSettings } from "$lib/server/audiocpp/settings"
import { readGgufMetadataWindow } from "$lib/server/koboldcpp/modelKind"
import {
	downloadFileInParallelChunks,
	resolveHuggingFaceDownload
} from "$lib/server/net/hfDownload"
import {
	createProgressThrottle,
	createUserEmitters,
	type UserEmitterSlot
} from "$lib/server/managed/emitters"
import {
	downloadHref,
	notifyDownloadSettled
} from "$lib/server/notifications/downloads"
import { derivePrecision } from "$lib/shared/audio/precision"
import type { AudioListEntry } from "$lib/server/audio/audioList"
import type { AudioFamily } from "$lib/shared/audio/audioFamilies"

type Task = Sockets.AudioCpp.PackageTask
type PackageRow = Sockets.AudioCpp.PackageRow
type PackageDownloadState =
	Sockets.AudioCpp.PackageDownloadProgress.PackageDownloadState
type Backend = Sockets.AudioCpp.Backend

/** What a family rule says about a file; mirrors `FamilyGuess` (shared/audio/audioFamilies). */
export interface FamilyGuessLike {
	task: Task
	family: string
	variant?: string
	confidence: "listed" | "matched" | "guessed"
}

/** The audio list as the packages code needs it (`getAudioLists` returns a superset). */
export interface AudioLists {
	entries: AudioListEntry[]
	families: AudioFamily[]
}

type FamilyOfFn = (
	input: {
		file: {
			path: string
			ggufArchitecture?: string
			ggufName?: string
			ggufFamily?: string
		}
	},
	lists: AudioLists
) => FamilyGuessLike | null

/** Optional seams, for tests and for callers that already hold the lists. */
export interface PackageOptions {
	lists?: AudioLists
	backend?: Backend | null
	familyOf?: FamilyOfFn
}

export interface EnabledPackage {
	id: string
	family: string
	task: Task
	variant?: string
	/** Absolute path of the package's (first) .gguf. */
	path: string
}

/** `audiocpp:downloadPackage` on a KoboldCPP row. */
export const KOBOLDCPP_ROW_REFUSAL =
	"That one is run by KoboldCPP; get it for KoboldCPP instead."

export const FAMILY_SIDECAR = ".serenepub-family.json"
export const UNKNOWN_FAMILY = "unknown"
const MAX_CONCURRENT_PACKAGE_DOWNLOADS = 2
const KOKORO_ID = "kokoro_82m_q8_0"
const QWEN_CUSTOMVOICE_ID = "qwen3_tts_1_7b_customvoice_q8_0"
const GUESSED_REASON =
	"Serene Pub can't tell which audio family this is — confirm it before it can be used."

// ---------------------------------------------------------------- paths

/** `<settings.modelsDir>` when set, else `<appdata>/models/audio` (D-B2). */
export function resolveAudioModelsDir(settings: {
	modelsDir?: string | null
}): string {
	return settings.modelsDir || path.join(getAppDataDir(), "models", "audio")
}

/** audio.cpp keeps speech and voice design together under `tts`. */
function folderTask(task: Task): "tts" | "asr" {
	return task === "asr" ? "asr" : "tts"
}

/** Segments of a relative path that is safe to join under a root, or a sentence-error. */
function safeSegments(rel: string, what: string): string[] {
	const fail = (why: string): never => {
		throw new Error(
			`The ${what} "${rel}" ${why}, so Serene Pub won't use it. Fix the audio list entry or report it.`
		)
	}
	if (!rel) fail("is empty")
	if (rel.includes("\\")) fail("contains a backslash")
	if (rel.startsWith("/") || /^[A-Za-z]:/.test(rel))
		fail("is an absolute path")
	const segs = rel.split("/")
	for (const s of segs) {
		if (s === "") fail("has an empty path segment")
		if (s === "." || s === "..") fail(`contains "${s}"`)
	}
	return segs
}

export function packageLeafDir(
	root: string,
	pkg: { task: Task; family: string; targetDirectory: string }
): string {
	const family = safeSegments(pkg.family, "audio family")
	if (family.length !== 1)
		throw new Error(
			`The audio family "${pkg.family}" must be a single folder name, so Serene Pub won't use it.`
		)
	const target = safeSegments(pkg.targetDirectory, "target directory")
	return path.join(root, folderTask(pkg.task), family[0], ...target)
}

/** `[repo-relative file, absolute local path]` for each of the entry's files. */
function packageFilePairs(
	root: string,
	entry: AudioListEntry
): Array<{ repoPath: string; relative: string; abs: string }> {
	const leaf = packageLeafDir(root, entry)
	const prefix = entry.stripPrefix ?? ""
	return entry.files.map((repoPath) => {
		safeSegments(repoPath, "file path")
		let rel = repoPath
		if (prefix) {
			if (rel === prefix) rel = ""
			else if (rel.startsWith(prefix + "/")) rel = rel.slice(prefix.length + 1)
		}
		const segs = safeSegments(rel, "file path")
		return { repoPath, relative: segs.join("/"), abs: path.join(leaf, ...segs) }
	})
}

/** Absolute local path of each file, in the entry's order. */
export function packageFilePaths(
	root: string,
	entry: AudioListEntry
): string[] {
	return packageFilePairs(root, entry).map((p) => p.abs)
}

// ------------------------------------------------------------ scanning

interface ScanItem {
	row: PackageRow
	/** Listed entry, when the package came from the list. */
	entry?: AudioListEntry
	/** Absolute leaf directory (listed: where it would live). */
	leaf: string
	/** Absolute paths of the files the package owns. */
	absFiles: string[]
	/** Absolute path of the first .gguf, when downloaded. */
	ggufPath?: string
	downloaded: boolean
}

async function resolveOptions(db: Db, opts?: PackageOptions) {
	const settings = await ensureAudioCppSettings(db)
	let lists = opts?.lists
	if (!lists) {
		const { getAudioLists } = await import("$lib/server/audio/audioList")
		lists = (await getAudioLists(db)) as unknown as AudioLists
	}
	let familyOf = opts?.familyOf
	if (!familyOf) {
		familyOf = (await import("$lib/server/audio/familyOf"))
			.familyOf as unknown as FamilyOfFn
	}
	const backend =
		opts && "backend" in opts ? (opts.backend ?? null) : (settings.backend ?? null)
	return {
		settings,
		lists: audioCppOnly(lists),
		allLists: lists,
		familyOf,
		backend,
		root: resolveAudioModelsDir(settings)
	}
}

/**
 * The part of the audio list audio.cpp itself runs. Entries with
 * `runtime: koboldcpp` and families with `runner: koboldcpp` are KoboldCPP's:
 * download, enable, confirm, auto-pick, server.json config and the folder scan
 * never see them (they are grouped for the finder by `packageFamilies`).
 */
export function audioCppOnly(lists: AudioLists): AudioLists {
	return {
		...lists,
		entries: lists.entries.filter((e) => (e.runtime ?? "audiocpp") === "audiocpp"),
		families: lists.families.filter((f) => f.runner !== "koboldcpp")
	}
}

async function statSize(p: string): Promise<number | null> {
	try {
		const s = await fsPromises.stat(p)
		return s.isFile() ? s.size : null
	} catch {
		return null
	}
}

async function dirEntries(p: string): Promise<fs.Dirent[]> {
	try {
		return await fsPromises.readdir(p, { withFileTypes: true })
	} catch {
		return []
	}
}

/** Every regular file under `dir`, as POSIX-relative paths (depth-limited). */
async function listFilesRecursive(dir: string, depth = 4): Promise<string[]> {
	const out: string[] = []
	async function walk(d: string, rel: string, left: number) {
		for (const e of await dirEntries(d)) {
			const r = rel ? `${rel}/${e.name}` : e.name
			if (e.isDirectory()) {
				if (left > 0) await walk(path.join(d, e.name), r, left - 1)
			} else if (e.isFile()) out.push(r)
		}
	}
	await walk(dir, "", depth)
	return out.sort()
}

function slug(s: string): string {
	return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "")
}

async function readSidecar(
	leaf: string
): Promise<{ family: string; task: Task } | null> {
	try {
		const j = JSON.parse(
			await fsPromises.readFile(path.join(leaf, FAMILY_SIDECAR), "utf8")
		)
		if (
			typeof j?.family === "string" &&
			j.family &&
			["tts", "asr", "vdes"].includes(j?.task)
		)
			return { family: j.family, task: j.task }
	} catch {}
	return null
}

/**
 * What the GGUF header says, via the app's one GGUF reader:
 * `general.architecture` (`audiocpp` for every audio.cpp package — the runner,
 * not the family) and `audiocpp.model_spec.family` (the family itself, the
 * one signal that decides a family from the file alone).
 */
async function ggufSignalsOf(
	file: string
): Promise<{ ggufArchitecture?: string; ggufFamily?: string }> {
	const meta = await readGgufMetadataWindow(file)
	const str = (key: string) => {
		const v = meta?.get(key)
		return typeof v === "string" && v ? v : undefined
	}
	return {
		ggufArchitecture: str("general.architecture"),
		ggufFamily: str("audiocpp.model_spec.family")
	}
}

function isRecommended(
	entry: AudioListEntry,
	backend: Backend | null,
	parakeetId: string | null
): boolean {
	if (entry.task === "tts") {
		const gpu = backend !== null && backend !== "cpu"
		return entry.id === (gpu ? QWEN_CUSTOMVOICE_ID : KOKORO_ID)
	}
	if (entry.task === "asr") return entry.id === parakeetId
	return false
}

function pickParakeet(entries: AudioListEntry[]): string | null {
	const q8 = entries.filter(
		(e) => e.task === "asr" && e.family === "parakeet_tdt" && /q8/i.test(e.id)
	)
	return (q8.find((e) => /v3/i.test(e.id)) ?? q8[0])?.id ?? null
}

function reasonFor(
	entry: AudioListEntry,
	recommended: boolean,
	backend: Backend | null
): string {
	const vram = entry.recommendedVram
	const needs = vram ? `Wants about ${vram} GB of VRAM.` : "Runs fine on CPU."
	if (recommended) {
		if (entry.task === "asr")
			return "Recommended: accurate, multilingual transcription that stays light enough for most machines."
		if (entry.id === KOKORO_ID)
			return backend === null
				? "Recommended: small and fast, and fine on CPU while your GPU is unknown."
				: "Recommended: small, fast and fine on CPU."
		return `Recommended for your ${backend} build: expressive voices you can steer with instructions. ${needs}`
	}
	if (entry.family === "kitten_tts2")
		return `Not recommended: ${needs.replace("Wants", "needs")} Pick Kokoro instead unless you want this voice.`
	if (entry.id === QWEN_CUSTOMVOICE_ID)
		return `Expressive instruction voices. ${needs} Kokoro suits a CPU-only machine better.`
	if (entry.id === KOKORO_ID)
		return "Small and fast, runs fine on CPU; Qwen3-TTS sounds richer on a GPU build."
	const d = entry.details?.description?.split(/(?<=[.!?])\s/)[0]
	return d ? `${d} ${needs}` : needs
}

const TASK_ORDER: Record<Task, number> = { tts: 0, vdes: 1, asr: 2 }

async function scan(
	db: Db,
	opts?: PackageOptions
): Promise<{ items: ScanItem[]; root: string; enabledIds: string[] }> {
	const { settings, lists, familyOf, backend, root } = await resolveOptions(
		db,
		opts
	)
	const enabledIds = settings.enabledPackageIds ?? []
	const enabledSet = new Set(enabledIds)
	const downloads = g().states
	const parakeetId = pickParakeet(lists.entries)
	const items: ScanItem[] = []
	const listedLeaves = new Map<string, AudioListEntry[]>()

	const stateOf = (id: string, downloaded: boolean): PackageRow["state"] => {
		const d = downloads[id]
		if (d && !d.isDone) return "downloading"
		if (downloaded && enabledSet.has(id)) return "enabled"
		return downloaded ? "downloaded" : "available"
	}

	for (const entry of lists.entries) {
		let pairs
		try {
			pairs = packageFilePairs(root, entry)
		} catch (err) {
			console.warn(`audio.cpp: skipping audio list entry ${entry.id}: ${(err as Error).message}`)
			continue
		}
		const leaf = packageLeafDir(root, entry)
		const sizes = await Promise.all(pairs.map((p) => statSize(p.abs)))
		const partials = await Promise.all(
			pairs.map((p) => statSize(p.abs + ".part"))
		)
		const downloaded =
			pairs.length > 0 && sizes.every((s) => s !== null) && partials.every((s) => s === null)
		const anyPresent = sizes.some((s) => s !== null)
		if (anyPresent) {
			const arr = listedLeaves.get(leaf) ?? []
			arr.push(entry)
			listedLeaves.set(leaf, arr)
		}
		const rec = isRecommended(entry, backend, parakeetId)
		const gguf = pairs.find((p) => p.abs.toLowerCase().endsWith(".gguf"))
		items.push({
			entry,
			leaf,
			absFiles: pairs.map((p) => p.abs),
			ggufPath: downloaded ? gguf?.abs : undefined,
			downloaded,
			row: {
				id: entry.id,
				name: entry.displayName,
				task: entry.task,
				family: entry.family,
				variant: entry.variant,
				precision: entry.precision,
				files: pairs.map((p) => p.relative),
				sizeBytes: entry.sizeBytes,
				recommendedVram: entry.recommendedVram,
				license: entry.license,
				tags: entry.tags ?? [],
				description: entry.details?.description,
				confidence: "listed",
				state: stateOf(entry.id, downloaded),
				recommended: rec,
				reason: reasonFor(entry, rec, backend),
				localDir: anyPresent ? leaf : undefined
			}
		})
	}

	// Hand-copied packages: <root>/<tts|asr>/<family>/<leaf>/ holding a .gguf.
	const usedIds = new Set(items.map((i) => i.row.id))
	for (const t of ["tts", "asr"] as const) {
		for (const fam of await dirEntries(path.join(root, t))) {
			if (!fam.isDirectory()) continue
			for (const lf of await dirEntries(path.join(root, t, fam.name))) {
				if (!lf.isDirectory()) continue
				const leaf = path.join(root, t, fam.name, lf.name)
				const all = await listFilesRecursive(leaf)
				const ggufs = all.filter((f) => f.toLowerCase().endsWith(".gguf"))
				if (!ggufs.length) continue
				if (listedLeaves.has(leaf)) {
					// Claimed by listed packages; leftovers they do not own stay unlisted.
					const owned = new Set(
						listedLeaves
							.get(leaf)!
							.flatMap((e) => packageFilePairs(root, e).map((p) => p.relative))
					)
					if (ggufs.every((f) => owned.has(f))) continue
					const rest = all.filter((f) => !owned.has(f) && !isLeaf(f))
					if (!rest.some((f) => f.toLowerCase().endsWith(".gguf"))) continue
					all.length = 0
					all.push(...rest)
					ggufs.length = 0
					ggufs.push(...rest.filter((f) => f.toLowerCase().endsWith(".gguf")))
				}
				const files = all.filter((f) => !isLeaf(f) && !f.endsWith(".part"))
				const first = path.join(leaf, ggufs[0])
				const sidecar = await readSidecar(leaf)
				let family = UNKNOWN_FAMILY
				let task: Task = t
				let variant: string | undefined
				let confidence: PackageRow["confidence"] = "guessed"
				if (sidecar) {
					family = sidecar.family
					task = sidecar.task
					confidence = "matched"
				} else {
					const guess = familyOf(
						{
							file: {
								path: first,
								...(await ggufSignalsOf(first))
							}
						},
						lists
					)
					if (guess) {
						family = guess.family
						task = guess.task
						variant = guess.variant
						confidence = guess.confidence === "guessed" ? "guessed" : "matched"
					}
				}
				// From the path, so a twin leaf appearing or vanishing never
				// renumbers a survivor out of its enabled id (lane V V-3).
				const base = `local_${slug(fam.name) || "family"}_${slug(lf.name) || "package"}`
				let id = base
				for (let n = 2; usedIds.has(id); n++) id = `${base}_${n}`
				usedIds.add(id)
				const sizes = await Promise.all(
					files.map((f) => statSize(path.join(leaf, f)))
				)
				const downloaded = !all.some((f) => f.endsWith(".part"))
				items.push({
					leaf,
					absFiles: files.map((f) => path.join(leaf, f)),
					ggufPath: first,
					downloaded,
					row: {
						id,
						name: lf.name,
						task,
						family,
						variant,
						precision: derivePrecision(files[0] ?? "", lf.name),
						files,
						sizeBytes: sizes.reduce<number>((a, s) => a + (s ?? 0), 0),
						tags: [],
						confidence,
						state: stateOf(id, downloaded),
						recommended: false,
						reason:
							confidence === "guessed"
								? GUESSED_REASON
								: "Copied in by hand; Serene Pub recognised the family.",
						localDir: leaf
					}
				})
			}
		}
	}

	items.sort(
		(a, b) =>
			TASK_ORDER[a.row.task] - TASK_ORDER[b.row.task] ||
			Number(b.row.recommended) - Number(a.row.recommended) ||
			Number(b.row.confidence === "listed") -
				Number(a.row.confidence === "listed") ||
			a.row.name.localeCompare(b.row.name)
	)
	return { items, root, enabledIds }
}

function isLeaf(rel: string): boolean {
	return rel === FAMILY_SIDECAR
}

export async function listAudioCppPackages(
	db: Db,
	opts: PackageOptions & { lists: AudioLists; backend: Backend | null }
): Promise<PackageRow[]> {
	return (await scan(db, opts)).items.map((i) => i.row)
}

// ----------------------------------------------------- enable / confirm

export async function setAudioCppPackageEnabled(
	db: Db,
	id: string,
	enabled: boolean,
	opts?: PackageOptions
): Promise<PackageRow> {
	const { items } = await scan(db, opts)
	const item = items.find((i) => i.row.id === id)
	if (!item)
		throw new Error(`There is no audio package "${id}" — refresh the list and try again.`)
	if (enabled) {
		if (item.row.confidence === "guessed")
			throw new Error(
				`Confirm which audio family "${item.row.name}" is before you enable it.`
			)
		if (!item.downloaded)
			throw new Error(
				`Download "${item.row.name}" before you enable it — its files aren't all on disk yet.`
			)
	}
	const settings = await ensureAudioCppSettings(db)
	const current = settings.enabledPackageIds ?? []
	const next = enabled
		? current.includes(id)
			? current
			: [...current, id]
		: current.filter((x) => x !== id)
	await db
		.update(audiocppSettings)
		.set({ enabledPackageIds: [...new Set(next)] })
		.where(eq(audiocppSettings.id, settings.id))
	const after = await scan(db, opts)
	return after.items.find((i) => i.row.id === id)!.row
}

export async function confirmAudioCppFamily(
	db: Db,
	input: { localDir: string; family: string; task: Task },
	opts?: PackageOptions
): Promise<PackageRow> {
	const settings = await ensureAudioCppSettings(db)
	const root = path.resolve(resolveAudioModelsDir(settings))
	const dir = path.resolve(input.localDir)
	const rel = path.relative(root, dir)
	if (!rel || rel.startsWith("..") || path.isAbsolute(rel))
		throw new Error(
			`That folder isn't inside your audio models folder (${root}), so Serene Pub won't write to it.`
		)
	if (!["tts", "asr", "vdes"].includes(input.task))
		throw new Error(`"${input.task}" isn't a task — choose speech, transcription or voice design.`)
	if (!/^[a-z0-9_]+$/i.test(input.family))
		throw new Error(`"${input.family}" isn't a family name — use letters, numbers and underscores, like qwen3_tts.`)
	{
		// Only a family this pub's audio families list knows (lane V V-4):
		// audio.cpp refuses anything else at start, and a made-up family
		// would otherwise read as `matched`.
		const { lists, allLists } = await resolveOptions(db, opts)
		if (allLists.families.some((f) => f.family === input.family && f.runner === "koboldcpp"))
			throw new Error(KOBOLDCPP_ROW_REFUSAL)
		const known = lists.families.find((f) => f.family === input.family)
		// An empty families list (no snapshot, as in unit tests) cannot judge.
		if (!known && lists.families.length)
			throw new Error(
				`"${input.family}" isn't a family this version knows. Known families: ${lists.families.map((f) => f.family).join(", ")}.`
			)
		if (known && !known.tasks.includes(input.task))
			throw new Error(`${input.family} does ${known.tasks.join(" and ")}, not ${input.task}.`)
	}
	let st: fs.Stats
	try {
		st = await fsPromises.stat(dir)
	} catch {
		throw new Error(`The folder ${dir} doesn't exist.`)
	}
	if (!st.isDirectory()) throw new Error(`${dir} is not a folder.`)
	await fsPromises.writeFile(
		path.join(dir, FAMILY_SIDECAR),
		JSON.stringify(
			{
				family: input.family,
				task: input.task,
				confirmedAt: new Date().toISOString()
			},
			null,
			2
		)
	)
	const { items } = await scan(db, opts)
	const item = items.find((i) => path.resolve(i.leaf) === dir)
	if (!item)
		throw new Error(
			`There is no .gguf file in ${dir}, so there is no package to confirm there.`
		)
	return item.row
}

export async function enabledPackagesForConfig(
	db: Db,
	lists?: AudioLists
): Promise<EnabledPackage[]> {
	const { items, enabledIds } = await scan(db, lists ? { lists } : undefined)
	const out: EnabledPackage[] = []
	for (const id of enabledIds) {
		const item = items.find((i) => i.row.id === id)
		if (!item || !item.downloaded || !item.ggufPath || item.row.confidence === "guessed") {
			console.warn(`audio.cpp: package ${id} is enabled but not on disk; leaving it out of the config.`)
			continue
		}
		out.push({
			id,
			family: item.row.family,
			task: item.row.task,
			variant: item.row.variant,
			path: item.ggufPath
		})
	}
	return out
}

// -------------------------------------------------------------- removal

export async function removeAudioCppPackage(
	db: Db,
	id: string,
	opts?: PackageOptions
): Promise<void> {
	const { items, root } = await scan(db, opts)
	const item = items.find((i) => i.row.id === id)
	if (!item)
		throw new Error(`There is no audio package "${id}" — refresh the list and try again.`)
	if (item.row.state === "downloading")
		throw new Error(`"${item.row.name}" is downloading — cancel the download before removing it.`)
	const leafRoot = path.resolve(item.leaf)
	if (!path.resolve(leafRoot).startsWith(path.resolve(root) + path.sep))
		throw new Error(`"${item.row.name}" is outside your audio models folder, so Serene Pub won't delete it.`)

	const present = await listFilesRecursive(leafRoot)
	const own = new Set(
		item.absFiles.map((f) => path.relative(leafRoot, f).split(path.sep).join("/"))
	)
	// Files of other listed packages that share this folder are not "extra".
	const siblings = new Set<string>()
	if (item.entry) {
		const { lists } = await resolveOptions(db, opts)
		for (const e of lists.entries) {
			if (e.id === id) continue
			try {
				if (path.resolve(packageLeafDir(root, e)) !== leafRoot) continue
				for (const p of packageFilePairs(root, e)) siblings.add(p.relative)
			} catch {}
		}
	}
	const extra = present.filter((f) => {
		const base = f.endsWith(".part") ? f.slice(0, -5) : f
		return !own.has(base) && !isLeaf(f) && !siblings.has(base)
	})
	if (extra.length)
		throw new Error(
			`"${item.row.name}" can't be removed automatically: its folder ${leafRoot} also holds ${extra
				.slice(0, 3)
				.join(", ")}${extra.length > 3 ? ` and ${extra.length - 3} more` : ""}. Move those files out, or delete the folder yourself.`
		)
	const keepsSiblings = present.some((f) => siblings.has(f.endsWith(".part") ? f.slice(0, -5) : f))
	if (keepsSiblings) {
		for (const f of present) {
			const base = f.endsWith(".part") ? f.slice(0, -5) : f
			if (own.has(base)) await fsPromises.rm(path.join(leafRoot, f), { force: true })
		}
		await pruneEmptyDirs(leafRoot)
	} else {
		await fsPromises.rm(leafRoot, { recursive: true, force: true })
	}
	const settings = await ensureAudioCppSettings(db)
	if ((settings.enabledPackageIds ?? []).includes(id))
		await db
			.update(audiocppSettings)
			.set({
				enabledPackageIds: settings.enabledPackageIds.filter((x) => x !== id)
			})
			.where(eq(audiocppSettings.id, settings.id))
}

async function pruneEmptyDirs(dir: string): Promise<boolean> {
	let empty = true
	for (const e of await dirEntries(dir)) {
		if (e.isDirectory()) {
			if (!(await pruneEmptyDirs(path.join(dir, e.name)))) empty = false
		} else empty = false
	}
	if (empty) await fsPromises.rmdir(dir).catch(() => (empty = false))
	return empty
}

// ------------------------------------------------------------ downloads

interface DownloadBag {
	states: Record<string, PackageDownloadState>
	controllers: Map<string, AbortController>
	emitterBacking: Map<number, UserEmitterSlot<Sockets.AudioCpp.PackageDownloadProgress.Response>>
	throttle: ReturnType<typeof createProgressThrottle>
}

/** On globalThis: Vite SSR HMR re-evaluates this module (see managed/supervisor.ts). */
function g(): DownloadBag {
	const k = "__serenePubAudioCppPackageDownloads"
	const gt = globalThis as unknown as Record<string, DownloadBag>
	return (gt[k] ??= {
		states: {},
		controllers: new Map(),
		emitterBacking: new Map(),
		throttle: createProgressThrottle()
	})
}

export const packageDownloadEmitters = createUserEmitters<Sockets.AudioCpp.PackageDownloadProgress.Response>(
	g().emitterBacking
)

export function getAudioCppPackageDownloads(): Record<string, PackageDownloadState> {
	return { ...g().states }
}

export function cancelAudioCppPackageDownload(id: string): boolean {
	const c = g().controllers.get(id)
	if (!c) return false
	c.abort()
	return true
}

function push(id: string, force: boolean) {
	const bag = g()
	if (!force && !bag.throttle.ready(id)) return
	packageDownloadEmitters.emit({ downloads: { [id]: { ...bag.states[id] } } })
}

export interface DownloadOptions extends PackageOptions {
	/** The admin who started it; gets the settled notification. */
	userId?: number | null
	/** Where a repo file is fetched from; defaults to Hugging Face. */
	urlFor?: (entry: AudioListEntry, repoPath: string) => string
}

function hfUrl(entry: AudioListEntry, repoPath: string): string {
	const enc = (s: string) => s.split("/").map(encodeURIComponent).join("/")
	return `https://huggingface.co/${enc(entry.name)}/resolve/${encodeURIComponent(entry.revision)}/${enc(repoPath)}`
}

/**
 * Starts the download and resolves once it is running; progress and the outcome
 * arrive through `packageDownloadEmitters`. Resolve the returned `done` to wait.
 */
export async function startAudioCppPackageDownload(
	db: Db,
	id: string,
	opts: DownloadOptions = {}
): Promise<{ done: Promise<void> }> {
	const bag = g()
	const { lists, allLists, root } = await resolveOptions(db, opts)
	if (allLists.entries.some((e) => e.id === id && e.runtime === "koboldcpp"))
		throw new Error(KOBOLDCPP_ROW_REFUSAL)
	const entry = lists.entries.find((e) => e.id === id)
	if (!entry)
		throw new Error(
			`Only packages from the audio list can be downloaded. "${id}" isn't one — copy its files into your audio models folder by hand instead.`
		)
	const existing = bag.states[id]
	if (existing && !existing.isDone && bag.controllers.has(id))
		throw new Error(`"${entry.displayName}" is already downloading.`)
	const active = [...bag.controllers.keys()].length
	if (active >= MAX_CONCURRENT_PACKAGE_DOWNLOADS)
		throw new Error(
			`${MAX_CONCURRENT_PACKAGE_DOWNLOADS} audio packages are already downloading — wait for one to finish, then try again.`
		)
	const pairs = packageFilePairs(root, entry)
	const controller = new AbortController()
	bag.controllers.set(id, controller)
	const state: PackageDownloadState = {
		packageId: id,
		name: entry.displayName,
		status: "starting",
		downloaded: 0,
		total: entry.sizeBytes ?? 0,
		isDone: false,
		filesDone: 0,
		filesTotal: pairs.length
	}
	bag.states[id] = state
	push(id, true)
	const urlFor = opts.urlFor ?? hfUrl

	const run = async () => {
		const requests = new Set<import("http").ClientRequest>()
		const registerRequest = (req: import("http").ClientRequest) => {
			requests.add(req)
			req.on("close", () => requests.delete(req))
			if (controller.signal.aborted) req.destroy()
		}
		controller.signal.addEventListener("abort", () => {
			for (const r of requests) r.destroy()
		})
		const aborted = () => controller.signal.aborted
		let knownTotals = 0
		try {
			for (const p of pairs) {
				if (aborted()) throw new Error("cancelled")
				state.currentFile = p.relative
				state.status = "downloading"
				push(id, true)
				await fsPromises.mkdir(path.dirname(p.abs), { recursive: true })
				let resolved
				try {
					resolved = await resolveHuggingFaceDownload(
						urlFor(entry, p.repoPath),
						registerRequest
					)
				} catch (err) {
					if (aborted()) throw new Error("cancelled")
					throw err
				}
				if (aborted()) throw new Error("cancelled")
				if (!entry.sizeBytes) {
					knownTotals += resolved.total
					state.total = knownTotals
				}
				const have = await statSize(p.abs)
				if (have !== null && resolved.total > 0 && have === resolved.total) {
					if (resolved.kind === "fallback") resolved.initialResponse.destroy()
					state.downloaded += have
					state.filesDone++
					push(id, false)
					continue
				}
				const part = p.abs + ".part"
				const onBytes = (n: number) => {
					state.downloaded += n
					push(id, false)
				}
				if (resolved.kind === "ranged" && resolved.total > 0) {
					await downloadFileInParallelChunks({
						resolvedUrl: resolved.resolvedUrl,
						total: resolved.total,
						destPath: part,
						onBytes,
						registerRequest,
						isAborted: aborted
					})
				} else {
					await new Promise<void>((resolve, reject) => {
						const res = (resolved as Extract<typeof resolved, { kind: "fallback" }>).initialResponse
						const w = fs.createWriteStream(part)
						res.on("data", (c: Buffer) => onBytes(c.length))
						res.on("error", reject)
						res.on("aborted", () => reject(new Error("The connection dropped mid-download.")))
						w.on("error", reject)
						w.on("finish", () => resolve())
						res.pipe(w)
					})
				}
				if (aborted()) throw new Error("cancelled")
				await fsPromises.rename(part, p.abs)
				state.filesDone++
				push(id, false)
			}
			state.status = "success"
		} catch (err) {
			const cancelled = aborted() || (err as Error)?.message === "cancelled"
			state.status = cancelled ? "cancelled" : "error"
			if (!cancelled) state.error = err instanceof Error ? err.message : String(err)
			for (const p of pairs) await fsPromises.rm(p.abs + ".part", { force: true }).catch(() => {})
		} finally {
			state.isDone = true
			state.currentFile = undefined
			bag.controllers.delete(id)
			bag.throttle.forget(id)
			push(id, true)
			if (state.status === "success") {
				// One click (owner, 2026-10-29): a package that finished
				// downloading is enabled at once and served by the next start,
				// the way the binary download switches audio.cpp on. A person
				// who wants it off presses Disable on the Models tab.
				try {
					await setAudioCppPackageEnabled(db, id, true)
					const { applyAudioCppConfig } = await import("./process")
					await applyAudioCppConfig(db)
				} catch (e) {
					console.warn(`audio.cpp: ${id} downloaded but could not be enabled:`, e)
				}
				const { resyncManagedAudioCpp } = await import("./resync")
				await resyncManagedAudioCpp(db)
			}
			if (state.status !== "cancelled")
				await notifyDownloadSettled(
					{
						userId: opts.userId,
						source: "audiocpp",
						key: id,
						model: entry.displayName,
						href: downloadHref(null),
						...(state.status === "error" ? { error: state.error } : {})
					},
					db
				).catch((e) => console.warn("audio.cpp: download notification failed:", e))
		}
	}
	return { done: run() }
}
