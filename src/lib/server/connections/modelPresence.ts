/**
 * Which runtimes already hold a model file — `models:presence`'s read.
 *
 * Computed straight from each runtime's own directory or store (no table, no
 * migration): KoboldCPP's models folders, every Ollama host's `/api/tags`, the
 * ONNX cache, audio.cpp's packages. Each source is listed ONCE per request and
 * every query is then matched against the in-memory lists, so a finder page of
 * a hundred rows costs the same disk and network reads as one row.
 *
 * Never throws for a source that is unreachable or unreadable: that source
 * contributes nothing, which is the honest answer ("not known to be here").
 */
import fs from "node:fs/promises"
import path from "node:path"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

type Query = Sockets.Models.Presence.Query
type Holder = Sockets.Models.Presence.Holder
type Result = Sockets.Models.Presence.Result

export const MAX_PRESENCE_QUERIES = 200
export const OLLAMA_TAGS_TIMEOUT_MS = 3000

export interface DirFile {
	name: string
	size: number
}

export interface PresenceDeps {
	/** Root-level regular files of a directory; [] when it cannot be read. */
	listDir: (dir: string) => Promise<DirFile[]>
	/** Tag names a host reports; null when it cannot be reached. */
	ollamaTags: (baseUrl: string) => Promise<string[] | null>
	/** Audio packages that are on disk (downloaded or enabled). */
	audioPackageIds: () => Promise<string[]>
	/** The ONNX cache lanes that hold `repo` (and `dtype`, when given). */
	onnxLanes: (repo: string, dtype?: string) => Promise<string[]>
}

/** The slice of the database this reads — a test hands in fixtures. */
export interface PresenceDb {
	query: {
		connections: {
			findMany: (args?: any) => Promise<
				Array<{ id: number; name: string; type: string; baseUrl?: string | null }>
			>
		}
		koboldCppSettings: {
			findFirst: (args?: any) => Promise<
				| {
						koboldCppManagerModelsDir?: string | null
						koboldCppImageModelsDir?: string | null
				  }
				| undefined
			>
		}
	}
}

const trimUrl = (u: string) => u.trim().replace(/\/+$/, "")

/** `Foo:Latest` → `foo:latest`; a bare `foo` → `foo:latest`. */
export function normaliseOllamaTag(tag: string): string {
	const t = tag.trim().toLowerCase()
	return t.includes(":") ? t : `${t}:latest`
}

const stemOf = (file: string) => {
	const base = path.posix.basename(file.replace(/\\/g, "/"))
	return base.replace(/\.[^.]+$/, "").toLowerCase()
}

/** Ollama's `hf.co/<repo>:<quant>` against a repo + a file the finder shows. */
function hfTagMatches(tag: string, repo: string, file: string): boolean {
	const t = tag.toLowerCase()
	const prefix = `hf.co/${repo.toLowerCase()}:`
	if (!t.startsWith(prefix)) return false
	const quant = t.slice(prefix.length)
	return quant.length > 0 && stemOf(file).includes(quant)
}

/* ------------------------------------------------------------ defaults */

const defaultDeps: PresenceDeps = {
	async listDir(dir) {
		try {
			const entries = await fs.readdir(dir, { withFileTypes: true })
			const out: DirFile[] = []
			for (const e of entries) {
				if (!e.isFile()) continue
				try {
					out.push({
						name: e.name,
						size: (await fs.stat(path.join(dir, e.name))).size
					})
				} catch {
					// vanished between readdir and stat
				}
			}
			return out
		} catch {
			return []
		}
	},
	async ollamaTags(baseUrl) {
		try {
			const res = await fetch(`${trimUrl(baseUrl)}/api/tags`, {
				signal: AbortSignal.timeout(OLLAMA_TAGS_TIMEOUT_MS)
			})
			if (!res.ok) return null
			const body: any = await res.json()
			return (body?.models ?? [])
				.map((m: any) => String(m?.name ?? m?.model ?? ""))
				.filter(Boolean)
		} catch {
			return null
		}
	},
	async audioPackageIds() {
		try {
			const [{ db }, { ensureAudioCppSettings }, { listAudioCppPackages }, { getAudioLists }] =
				await Promise.all([
					import("$lib/server/db"),
					import("$lib/server/audiocpp/settings"),
					import("$lib/server/audiocpp/packages"),
					import("$lib/server/audio/audioList")
				])
			const settings = await ensureAudioCppSettings(db)
			const rows = await listAudioCppPackages(db, {
				lists: (await getAudioLists(db)) as any,
				backend: settings.backend ?? null
			})
			return rows
				.filter((r) => r.state === "downloaded" || r.state === "enabled")
				.map((r) => r.id)
		} catch {
			return []
		}
	},
	async onnxLanes(repo, dtype) {
		try {
			const { isCached, modelDirFor } = await import(
				"$lib/server/localModels/onnxCache"
			)
			const lanes: string[] = []
			for (const lane of ["embeddings", "ner", "matting"] as const) {
				if (!(await isCached(repo, lane))) continue
				if (dtype) {
					const file = ONNX_DTYPE_FILE[dtype.toLowerCase()]
					const dir = modelDirFor(repo, lane)
					// An unknown dtype name cannot be told apart on disk: the
					// repo being cached is the most that can be said.
					if (file && dir) {
						const has = await fs
							.stat(path.join(dir, "onnx", file))
							.then((s) => s.isFile())
							.catch(() => false)
						if (!has) continue
					}
				}
				lanes.push(lane)
			}
			return lanes
		} catch {
			return []
		}
	}
}

/** transformers.js dtype → the weights file it loads from a repo's `onnx/` folder. */
const ONNX_DTYPE_FILE: Record<string, string> = {
	fp32: "model.onnx",
	fp16: "model_fp16.onnx",
	q8: "model_quantized.onnx",
	int8: "model_int8.onnx",
	uint8: "model_uint8.onnx",
	q4: "model_q4.onnx",
	q4f16: "model_q4f16.onnx",
	bnb4: "model_bnb4.onnx"
}

/* ---------------------------------------------------------------- core */

export async function modelPresence(
	db: PresenceDb,
	queries: Query[],
	deps?: Partial<PresenceDeps>
): Promise<Result[]> {
	if (queries.length > MAX_PRESENCE_QUERIES)
		throw new Error(
			`Ask about at most ${MAX_PRESENCE_QUERIES} models at a time.`
		)
	const d: PresenceDeps = { ...defaultDeps, ...deps }

	const [conns, settings] = await Promise.all([
		db.query.connections.findMany(),
		db.query.koboldCppSettings.findFirst()
	])
	const firstOfType = (...types: string[]) =>
		conns.find((c) => types.includes(c.type))?.id ?? null

	// ---- list each source once
	const textDir = settings?.koboldCppManagerModelsDir || null
	const imageDir = settings?.koboldCppImageModelsDir || null
	const kcppSources: Array<{ where: "text" | "image"; dir: string }> = []
	if (textDir) kcppSources.push({ where: "text", dir: textDir })
	// Image falls back to the text folder: scanning it twice would report one
	// file as held in two places.
	if (imageDir && imageDir !== textDir)
		kcppSources.push({ where: "image", dir: imageDir })

	const needsOllama = queries.some((q) => q.tag || (q.repo && q.file))
	const needsKcpp = queries.some((q) => q.file)
	const needsAudio = queries.some((q) => q.packageId)
	const needsOnnx = queries.some((q) => q.repo)

	// One Ollama host per distinct address; a plain Ollama connection names it
	// in preference to an Ollama-embeddings one on the same host.
	const hosts = new Map<string, { id: number; name: string; plain: boolean }>()
	for (const c of conns) {
		if (
			c.type !== CONNECTION_TYPE.OLLAMA &&
			c.type !== CONNECTION_TYPE.OLLAMA_EMBEDDINGS
		)
			continue
		const url = trimUrl(c.baseUrl ?? "")
		if (!url) continue
		const plain = c.type === CONNECTION_TYPE.OLLAMA
		const have = hosts.get(url)
		if (!have || (plain && !have.plain))
			hosts.set(url, { id: c.id, name: c.name, plain })
	}

	const [kcppLists, ollamaLists, audioIds] = await Promise.all([
		needsKcpp
			? Promise.all(
					kcppSources.map(async (s) => ({
						...s,
						files: await d.listDir(s.dir).catch(() => [] as DirFile[])
					}))
				)
			: [],
		needsOllama
			? Promise.all(
					[...hosts.entries()].map(async ([url, h]) => ({
						host: h,
						tags: (await d.ollamaTags(url).catch(() => null)) ?? []
					}))
				)
			: [],
		needsAudio ? d.audioPackageIds().catch(() => [] as string[]) : []
	])
	const audioSet = new Set(audioIds)

	const kcppConn = {
		text: firstOfType(CONNECTION_TYPE.KOBOLDCPP_MANAGED),
		image: firstOfType(CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE)
	}
	const onnxConn: Record<string, number | null> = {
		embeddings: firstOfType(CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS),
		ner: firstOfType(CONNECTION_TYPE.LOCAL_ONNX_NER),
		matting: null
	}
	const audioConn = firstOfType(CONNECTION_TYPE.AUDIOCPP_MANAGED)

	// ONNX is per (repo, dtype): cache the lookups so repeat rows cost nothing.
	const onnxMemo = new Map<string, Promise<string[]>>()
	const onnxFor = (repo: string, dtype?: string) => {
		const k = `${repo}\u0000${dtype ?? ""}`
		let p = onnxMemo.get(k)
		if (!p) {
			p = needsOnnx
				? d.onnxLanes(repo, dtype).catch(() => [] as string[])
				: Promise.resolve([])
			onnxMemo.set(k, p)
		}
		return p
	}

	// ---- match every query
	const results: Result[] = []
	for (const q of queries) {
		const holders: Holder[] = []

		if (q.file) {
			const name = path.posix.basename(q.file.replace(/\\/g, "/"))
			for (const src of kcppLists) {
				const hit = src.files.find(
					(f) =>
						f.name === name &&
						(typeof q.bytes !== "number" || f.size === q.bytes)
				)
				if (hit)
					holders.push({
						runtime: "koboldcpp",
						connectionId: kcppConn[src.where],
						where: src.where,
						match: hit.name
					})
			}
		}

		for (const { host, tags } of ollamaLists) {
			let match: string | null = null
			if (q.tag) {
				const want = normaliseOllamaTag(q.tag)
				match = tags.find((t) => normaliseOllamaTag(t) === want) ?? null
			} else if (q.repo && q.file) {
				const repo = q.repo
				const file = q.file
				match = tags.find((t) => hfTagMatches(t, repo, file)) ?? null
			}
			if (match)
				holders.push({
					runtime: "ollama",
					connectionId: host.id,
					where: host.name,
					match
				})
		}

		if (q.repo) {
			for (const lane of await onnxFor(q.repo, q.dtype))
				holders.push({
					runtime: "onnx",
					connectionId: onnxConn[lane] ?? null,
					where: lane,
					match: q.repo
				})
		}

		if (q.packageId && audioSet.has(q.packageId))
			holders.push({
				runtime: "audiocpp",
				connectionId: audioConn,
				where: null,
				match: q.packageId
			})

		results.push({ key: q.key, holders })
	}
	return results
}
