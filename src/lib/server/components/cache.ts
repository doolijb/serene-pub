/**
 * The **component cache** (C6, P3): where authored components' compiled
 * modules (artifacts) live on disk —
 * `getAppDataDir()/cache/components/<authored owner id>/<artifact hash>.js`.
 *
 * A cache, never the record: the source is durable in `authored_components`,
 * and a missing or damaged artifact is rebuilt from it (`compile.ts`
 * `readOrRebuildArtifact`). So everything here may be deleted at any time.
 *
 * - Writes are atomic: a temp file in the SAME directory, then a rename, so a
 *   reader sees the whole module or none of it — never a half-written one.
 * - Reads verify the bytes: the artifact hash IS the SHA-256 of the module
 *   (`compileComponentSource`), so a file whose bytes do not hash to its own
 *   name reads as missing, and is rebuilt rather than served.
 * - Every path is built from a checked owner id and a checked hash — nothing
 *   a request carries reaches the filesystem unparsed.
 */
import { createHash, randomUUID } from "node:crypto"
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { getAppDataDir } from "$lib/server/utils/appDataDir"
import { authoredOwnerId, parseAuthoredOwnerId } from "$lib/shared/widgets/authoredOwner"

const ARTIFACT_HASH = /^[a-f0-9]{64}$/

/** The cache's root: `<app data>/cache/components`. */
export const componentCacheDir = (): string => join(getAppDataDir(), "cache", "components")

function artifactPath(id: string, artifactHash: string): string {
	if (!ARTIFACT_HASH.test(artifactHash)) throw new Error(`'${artifactHash}' is not an artifact hash`)
	return join(componentCacheDir(), authoredOwnerId(id), `${artifactHash}.js`)
}

const sha256 = (code: string) => createHash("sha256").update(code, "utf8").digest("hex")

/** Write an authored component's artifact, atomically. `artifactHash` must be the SHA-256 of `code`. */
export async function writeArtifact(id: string, artifactHash: string, code: string): Promise<void> {
	const file = artifactPath(id, artifactHash)
	if (sha256(code) !== artifactHash) throw new Error(`artifact for '${id}' does not hash to ${artifactHash}`)
	const dir = join(componentCacheDir(), authoredOwnerId(id))
	await mkdir(dir, { recursive: true })
	const temp = join(dir, `.${artifactHash}.${randomUUID()}.tmp`)
	try {
		await writeFile(temp, code, "utf8")
		await rename(temp, file)
	} catch (e) {
		await rm(temp, { force: true })
		throw e
	}
}

/** The artifact's code, or `null` when it is missing or its bytes are not the hash it is filed under. */
export async function readArtifact(id: string, artifactHash: string): Promise<string | null> {
	let code: string
	try {
		code = await readFile(artifactPath(id, artifactHash), "utf8")
	} catch {
		return null
	}
	return sha256(code) === artifactHash ? code : null
}

/** True when the artifact is on disk (not verified — see {@link readArtifact}). */
export async function hasArtifact(id: string, artifactHash: string): Promise<boolean> {
	try {
		return (await stat(artifactPath(id, artifactHash))).isFile()
	} catch {
		return false
	}
}

/**
 * Remove every artifact the cache holds except `keep` (authored id → the one
 * artifact hash its row names): a deleted component's whole directory, a
 * superseded compile's module, a temp file a crash left. Never throws — a
 * cache that cannot be tidied is still a cache. Returns how many entries went.
 */
export async function pruneArtifacts(keep: ReadonlyMap<string, string | null | undefined>): Promise<number> {
	const root = componentCacheDir()
	let removed = 0
	let owners: string[]
	try {
		owners = await readdir(root)
	} catch {
		return 0
	}
	for (const owner of owners) {
		const id = parseAuthoredOwnerId(owner)
		const dir = join(root, owner)
		const wanted = id ? keep.get(id) : undefined
		if (!id || !keep.has(id)) {
			await rm(dir, { recursive: true, force: true }).catch(() => {})
			removed++
			continue
		}
		let files: string[] = []
		try {
			files = await readdir(dir)
		} catch {
			continue
		}
		for (const f of files) {
			if (wanted && f === `${wanted}.js`) continue
			await rm(join(dir, f), { recursive: true, force: true }).catch(() => {})
			removed++
		}
	}
	return removed
}

/** Remove every artifact of one authored component (it was deleted). Never throws. */
export async function removeArtifacts(id: string): Promise<void> {
	await rm(join(componentCacheDir(), authoredOwnerId(id)), { recursive: true, force: true }).catch(() => {})
}
