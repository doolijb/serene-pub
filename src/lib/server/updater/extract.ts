/**
 * Unpack a verified release zip into update staging (CONTRACT §C5 step 3).
 *
 * `yauzl`, because it streams and exposes each entry's external attributes —
 * where a zip made on macOS or Linux keeps the Unix mode bits. Without them
 * `app/node`, the launcher and every executable inside `node_modules` would
 * come out non-executable.
 *
 * Refused, and the whole extraction abandoned, when an entry:
 * - names an absolute path, a drive, or climbs out with `..` (zip-slip);
 * - would land outside the destination once its parent folders are resolved
 *   on disk — a symlink extracted earlier cannot be used as a way out;
 * - is a symlink whose target resolves outside the destination;
 * - repeats a file that was already written.
 */
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import { pipeline } from "node:stream/promises"
import yauzl from "yauzl"
import { isInside } from "$lib/server/launcher/launcherEnv"

export class UnsafeArchiveError extends Error {
	constructor(message: string) {
		super(message)
		this.name = "UnsafeArchiveError"
	}
}

const S_IFMT = 0o170000
const S_IFLNK = 0o120000
const S_IFDIR = 0o040000

/** Made on Unix (3) or macOS (19): the upper 16 bits are a Unix mode. */
function unixModeOf(entry: yauzl.Entry): number | null {
	const madeBy = entry.versionMadeBy >> 8
	if (madeBy !== 3 && madeBy !== 19) return null
	const mode = (entry.externalFileAttributes >>> 16) & 0xffff
	return mode === 0 ? null : mode
}

/** The relative path an entry names, or a refusal. */
export function safeEntryPath(name: string): string {
	const normalised = name.replace(/\\/g, "/")
	if (
		normalised.startsWith("/") ||
		/^[a-zA-Z]:/.test(normalised) ||
		normalised.includes("\0")
	)
		throw new UnsafeArchiveError(`The update contains an absolute path (${name}).`)
	const parts = normalised.split("/").filter((p) => p !== "" && p !== ".")
	if (parts.some((p) => p === ".."))
		throw new UnsafeArchiveError(`The update contains a path that leaves its folder (${name}).`)
	if (parts.length === 0)
		throw new UnsafeArchiveError(`The update contains an empty path.`)
	return parts.join("/")
}

async function readAll(stream: NodeJS.ReadableStream): Promise<string> {
	const chunks: Buffer[] = []
	for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer))
	return Buffer.concat(chunks).toString("utf8")
}

/** Make `dir` (and parents) and prove it still resolves inside `rootReal`. */
async function ensureDirInside(dir: string, rootReal: string): Promise<void> {
	await fsp.mkdir(dir, { recursive: true, mode: 0o755 })
	const real = await fsp.realpath(dir)
	if (!isInside(rootReal, real))
		throw new UnsafeArchiveError("The update tries to write outside its folder through a link.")
}

export interface ExtractResult {
	files: number
	directories: number
	symlinks: number
}

/**
 * Extract `zipPath` into `destDir` (created; must not already hold files of
 * the same names). Directory modes are applied after their contents.
 */
export async function extractZip(
	zipPath: string,
	destDir: string
): Promise<ExtractResult> {
	await fsp.mkdir(destDir, { recursive: true })
	const root = path.resolve(destDir)
	const rootReal = await fsp.realpath(root)
	const result: ExtractResult = { files: 0, directories: 0, symlinks: 0 }
	const dirModes: Array<[string, number]> = []

	let zip: yauzl.ZipFile
	try {
		zip = await yauzl.openPromise(zipPath, {
			lazyEntries: true,
			autoClose: true,
			validateEntrySizes: true
		})
	} catch (err) {
		throw new UnsafeArchiveError(
			`The update could not be opened: ${err instanceof Error ? err.message : String(err)}`
		)
	}

	try {
		await new Promise<void>((resolve, reject) => {
			const fail = (err: unknown) => {
				zip.close()
				reject(
					err instanceof UnsafeArchiveError
						? err
						: new UnsafeArchiveError(
								`The update is damaged: ${err instanceof Error ? err.message : String(err)}`
							)
				)
			}
			zip.on("error", fail)
			zip.on("end", () => resolve())
			zip.on("entry", (entry: yauzl.Entry) => {
				handleEntry(entry).then(() => zip.readEntry(), fail)
			})
			zip.readEntry()
		})
	} finally {
		zip.close()
	}

	// Deepest first, so a read-only parent never blocks its children.
	for (const [dir, mode] of dirModes.sort((a, b) => b[0].length - a[0].length)) {
		await fsp.chmod(dir, mode).catch(() => {})
	}
	return result

	async function handleEntry(entry: yauzl.Entry): Promise<void> {
		const rel = safeEntryPath(entry.fileName)
		const dest = path.resolve(root, rel)
		if (!isInside(root, dest) || dest === root)
			throw new UnsafeArchiveError(`The update contains a path that leaves its folder (${entry.fileName}).`)

		const mode = unixModeOf(entry)
		const type = mode === null ? null : mode & S_IFMT
		const isDir = type === S_IFDIR || entry.fileName.endsWith("/")

		if (isDir) {
			await ensureDirInside(dest, rootReal)
			if (mode !== null) dirModes.push([dest, (mode & 0o777) | 0o700])
			result.directories++
			return
		}

		await ensureDirInside(path.dirname(dest), rootReal)

		if (type === S_IFLNK) {
			const stream = await zip.openReadStreamPromise(entry)
			const target = (await readAll(stream)).trim()
			if (!target || target.includes("\0") || path.isAbsolute(target) || /^[a-zA-Z]:/.test(target))
				throw new UnsafeArchiveError(`The update contains a link that points outside its folder (${entry.fileName}).`)
			const resolved = path.resolve(path.dirname(dest), target)
			if (!isInside(root, resolved))
				throw new UnsafeArchiveError(`The update contains a link that points outside its folder (${entry.fileName}).`)
			await fsp.symlink(target, dest)
			result.symlinks++
			return
		}

		const fileMode = mode === null ? 0o644 : (mode & 0o777) | 0o600
		const stream = await zip.openReadStreamPromise(entry)
		await pipeline(stream, fs.createWriteStream(dest, { flags: "wx", mode: fileMode }))
		// The process umask trims the mode given at creation.
		await fsp.chmod(dest, fileMode)
		result.files++
	}
}
