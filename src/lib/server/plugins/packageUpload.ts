/**
 * **Plugin package upload** — `/api/admin/plugins/package` (K6), in three
 * steps: start (an empty `.part` file under the data dir and an id), pieces
 * (`PUT`, appended at a checked offset), finish (unpack the file with `yauzl`
 * into a fresh folder and hand it to the install `plugins:installLocal`
 * shares). Pieces because the server framework refuses any request body over
 * `BODY_SIZE_LIMIT` (512K by default) before this runs; the whole zip is never
 * held in memory, and every temp path is removed whatever happens. The wire
 * contract is `$lib/shared/plugins/packageUpload.ts`.
 *
 * The zip layout is the one `serene-pub build` and an export write:
 * `dist/plugin/manifest.json` at the root, or inside one wrapper folder.
 */
import fs from "node:fs"
import fsp from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { pipeline } from "node:stream/promises"
import yauzl from "yauzl"
import type { RequestEvent } from "@sveltejs/kit"
import { authenticateRequest } from "$lib/server/auth/authenticateRequest"
import { db } from "$lib/server/db"
import { logbookBegin, logbookCommit } from "$lib/server/adminLogbook/record"
import { isFormOriginAllowed } from "$lib/server/net/formOrigin"
import { pluginsEnabled } from "$lib/server/plugins/flag"
import {
	PLUGIN_FILES_MAX,
	PLUGIN_PACKAGE_MAX_MB,
	packageTooLargeSentence,
	packageTooManyFilesSentence
} from "$lib/server/plugins/pluginPackage"
import {
	installPackageFromDir,
	pluginPushIo,
	PACKAGE_INSTALL_OFF_SENTENCE
} from "$lib/server/sockets/plugins"
import { getAppDataDir } from "$lib/server/utils/appDataDir"
import { PLUGIN_MANIFEST_PATH } from "$lib/shared/plugins/packageManifest"
import {
	PLUGIN_PACKAGE_FILENAME_HEADER,
	PLUGIN_PACKAGE_SIZE_HEADER,
	type PackageUploadPiece,
	type PackageUploadStart
} from "$lib/shared/plugins/packageUpload"

const MIB = 1024 * 1024
const S_IFMT = 0o170000
const S_IFLNK = 0o120000

const outsideFolderSentence = (names: string[]): string =>
	`The package names files outside its own folder (${names
		.slice(0, 3)
		.map((n) => `'${n}'`)
		.join(", ")}). Nothing was installed.`

/** A refusal with the HTTP status the route answers it with. */
export class PackageUploadRefusal extends Error {
	readonly status: number
	constructor(message: string, status = 400) {
		super(message)
		this.name = "PackageUploadRefusal"
		this.status = status
	}
}

/**
 * A zip entry name this will write, or null for one it refuses: absolute
 * (`/x`, `C:\x`, `\\host`), backslashed, or with a `..` / `.` segment.
 */
export function safeEntryPath(name: string): string | null {
	if (!name || name.includes("\0") || name.includes("\\")) return null
	if (name.startsWith("/") || /^[a-zA-Z]:/.test(name)) return null
	const parts = name.split("/")
	if (parts.some((p) => p === ".." || p === ".")) return null
	return name
}

/**
 * Unpack the package zip at `zipPath` into `destDir` and return the package
 * root: `destDir`, or `destDir/<folder>` when the zip wraps its package in one
 * folder. Everything is checked from the central directory before any file is
 * written: entry names, symlinks, file count, inflated size.
 */
export async function extractPackageZip(
	zipPath: string,
	destDir: string
): Promise<string> {
	const notReadable = (e: unknown) => {
		// yauzl refuses `..` and absolute names itself, before this sees them.
		const named =
			e instanceof Error
				? /^(?:invalid relative path|absolute path): (.*)$/.exec(
						e.message
					)
				: null
		if (named)
			return new PackageUploadRefusal(outsideFolderSentence([named[1]!]))
		return new PackageUploadRefusal(
			`That file is not a readable zip: ${e instanceof Error ? e.message : String(e)}.`
		)
	}
	let zip: yauzl.ZipFile
	try {
		zip = await yauzl.openPromise(zipPath, {
			lazyEntries: true,
			autoClose: false,
			validateEntrySizes: true
		})
	} catch (e) {
		throw notReadable(e)
	}
	try {
		const entries: yauzl.Entry[] = []
		const unsafe: string[] = []
		let inflated = 0
		await new Promise<void>((resolve, reject) => {
			zip.on("error", reject)
			zip.on("end", () => resolve())
			zip.on("entry", (entry: yauzl.Entry) => {
				if (!entry.fileName.endsWith("/")) {
					if (!safeEntryPath(entry.fileName))
						unsafe.push(entry.fileName)
					else if (
						((entry.externalFileAttributes >>> 16) & S_IFMT) ===
						S_IFLNK
					)
						unsafe.push(entry.fileName)
					else {
						entries.push(entry)
						inflated += entry.uncompressedSize
					}
				}
				zip.readEntry()
			})
			zip.readEntry()
		}).catch((e) => {
			throw notReadable(e)
		})
		if (unsafe.length)
			throw new PackageUploadRefusal(outsideFolderSentence(unsafe))
		if (entries.length > PLUGIN_FILES_MAX)
			throw new PackageUploadRefusal(
				packageTooManyFilesSentence(entries.length)
			)
		if (inflated > PLUGIN_PACKAGE_MAX_MB * MIB)
			throw new PackageUploadRefusal(packageTooLargeSentence(inflated))

		const root = path.resolve(destDir)
		await fsp.mkdir(root, { recursive: true })
		for (const entry of entries) {
			const target = path.resolve(root, entry.fileName)
			// Belt and braces: the joined path must stay inside the folder.
			if (!target.startsWith(root + path.sep))
				throw new PackageUploadRefusal(
					`The package names '${entry.fileName}', outside its folder.`
				)
			await fsp.mkdir(path.dirname(target), { recursive: true })
			try {
				const stream = await zip.openReadStreamPromise(entry)
				await pipeline(
					stream,
					fs.createWriteStream(target, { flags: "wx" })
				)
			} catch (e) {
				throw notReadable(e)
			}
		}

		const names = entries.map((e) => e.fileName)
		if (names.includes(PLUGIN_MANIFEST_PATH)) return root
		const roots = new Set(names.map((n) => n.split("/")[0]))
		const [only] = [...roots]
		if (
			roots.size === 1 &&
			names.includes(`${only}/${PLUGIN_MANIFEST_PATH}`)
		)
			return path.join(root, only!)
		return root
	} finally {
		zip.close()
	}
}

/**
 * Unpack the zip at `zipPath` into a fresh folder under the data dir and
 * install it as `plugins:installLocal` installs a folder. The folder is
 * removed whatever happens.
 */
export async function installUploadedPackage(opts: {
	zipPath: string
	filename?: string
	pushIo?: unknown
}): Promise<Sockets.Plugins.InstallLocal.Response> {
	const dir = path.join(getAppDataDir(), "plugin-uploads", randomUUID())
	try {
		const packageDir = await extractPackageZip(opts.zipPath, dir)
		const manifest = path.join(packageDir, PLUGIN_MANIFEST_PATH)
		if (
			!(await fsp.stat(manifest).then(
				(s) => s.isFile(),
				() => false
			))
		)
			throw new PackageUploadRefusal(
				`${opts.filename ? `'${opts.filename}'` : "That zip"} ` +
					`has no '${PLUGIN_MANIFEST_PATH}'. Install the zip 'serene-pub build' or an ` +
					`export wrote.`
			)
		return await installPackageFromDir(packageDir, {
			via: "installPackage",
			pushIo: opts.pushIo
		})
	} finally {
		await fsp.rm(dir, { recursive: true, force: true })
	}
}

const jsonResponse = (body: unknown, status = 200): Response =>
	new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" }
	})
const refuse = (error: string, status: number): Response =>
	jsonResponse({ error }, status)

/** The chosen file's name from its header, decoded safely and capped. */
function filenameOf(event: RequestEvent): string | undefined {
	const raw = event.request.headers.get(PLUGIN_PACKAGE_FILENAME_HEADER)
	if (!raw) return undefined
	let name = raw
	try {
		name = decodeURIComponent(raw)
	} catch {
		// keep the raw text
	}
	name = name.slice(0, 200)
	return name || undefined
}

/** Whether an install failure is a refusal worded for a person (400), not a bug (500). */
function isOwnWords(e: unknown): e is Error {
	if (!(e instanceof Error) || !e.message) return false
	if (
		e instanceof TypeError ||
		e instanceof ReferenceError ||
		e instanceof RangeError
	)
		return false
	return !("code" in e) && !("query" in e)
}

type Admin = NonNullable<Awaited<ReturnType<typeof authenticateRequest>>>

const KIB = 1024
const UPLOAD_TTL_MS = 60 * 60 * 1000
const EXPIRED_SENTENCE = "That upload has expired. Choose the file again."
const OUT_OF_STEP_SENTENCE =
	"The upload fell out of step. Choose the file again."

/**
 * `BODY_SIZE_LIMIT` as adapter-node reads it: a number of bytes with an
 * optional `K`/`M`/`G` suffix (1024-based, any case), `Infinity` allowed;
 * unset or empty is `512K`. Something unreadable also falls back to `512K`.
 */
export function parseBodySizeLimit(value: string | undefined): number {
	const fallback = 512 * KIB
	const v = value?.trim()
	if (!v) return fallback
	const mult =
		{ K: KIB, M: KIB * KIB, G: KIB * KIB * KIB }[
			v[v.length - 1]!.toUpperCase()
		] ?? 1
	const n = Number(mult === 1 ? v : v.slice(0, -1)) * mult
	return Number.isNaN(n) ? fallback : n
}

/**
 * The most bytes one piece may carry: the adapter's body limit less 16 KiB of
 * headroom, kept within 64 KiB to 8 MiB.
 */
export function pieceBytesFor(limit: number): number {
	return Math.min(8 * KIB * KIB, Math.max(64 * KIB, limit - 16 * KIB))
}

/** The piece size this server answers a start with. */
export const pieceBytes = (): number =>
	pieceBytesFor(parseBodySizeLimit(process.env.BODY_SIZE_LIMIT))

interface UploadEntry {
	userId: number
	filename: string | undefined
	/** When the upload was started or last given a piece; it expires an hour after. */
	touchedAt: number
}

const REGISTRY_KEY = Symbol.for("serene-pub.pluginPackageUploads")
// On globalThis: a Vite SSR reload splits module singletons.
function uploads(): Map<string, UploadEntry> {
	const g = globalThis as Record<symbol, unknown>
	return (g[REGISTRY_KEY] ??= new Map<string, UploadEntry>()) as Map<
		string,
		UploadEntry
	>
}

const uploadsDir = () => path.join(getAppDataDir(), "plugin-uploads")
const partPath = (id: string) => path.join(uploadsDir(), `${id}.part`)

/** Forget an upload and remove its file. */
async function discard(id: string): Promise<void> {
	uploads().delete(id)
	await fsp.rm(partPath(id), { force: true })
}

/** Drop uploads, and stray `.part` files, not added to for over an hour. */
async function sweepUploads(): Promise<void> {
	const now = Date.now()
	for (const [id, e] of uploads())
		if (now - e.touchedAt > UPLOAD_TTL_MS) await discard(id)
	try {
		for (const name of await fsp.readdir(uploadsDir())) {
			if (!name.endsWith(".part")) continue
			const file = path.join(uploadsDir(), name)
			const st = await fsp.stat(file).catch(() => null)
			if (st && now - st.mtimeMs > UPLOAD_TTL_MS)
				await fsp.rm(file, { force: true })
		}
	} catch {
		// the folder may not exist yet
	}
}

/** Who, from where, and whether packages may be installed at all. */
async function gate(
	event: RequestEvent
): Promise<{ user: Admin } | { refusal: Response }> {
	const user = await authenticateRequest(event)
	if (!user) return { refusal: refuse("Sign in to install a package.", 401) }
	if (!user.isAdmin)
		return {
			refusal: refuse("Only an administrator can install a package.", 403)
		}
	if (!isFormOriginAllowed(event))
		return {
			refusal: refuse(
				"This upload must come from Serene Pub's own page.",
				403
			)
		}
	if (!pluginsEnabled())
		return { refusal: refuse(PACKAGE_INSTALL_OFF_SENTENCE, 403) }
	return { user }
}

/** The upload `?upload=` names, when this user started it and it has not expired. */
function ownedUpload(
	event: RequestEvent,
	userId: number
): { id: string; entry: UploadEntry } | null {
	const id = event.url.searchParams.get("upload") ?? ""
	const entry = uploads().get(id)
	if (!entry || entry.userId !== userId) return null
	if (Date.now() - entry.touchedAt > UPLOAD_TTL_MS) return null
	return { id, entry }
}

/** `POST` without `?upload=` starts an upload; with it, finishes one. */
export async function handlePackagePost(
	event: RequestEvent
): Promise<Response> {
	const g = await gate(event)
	if ("refusal" in g) return g.refusal
	if (event.url.searchParams.has("upload")) return finishUpload(event, g.user)
	return startUpload(event, g.user)
}

async function startUpload(
	event: RequestEvent,
	user: Admin
): Promise<Response> {
	const declared = Number(
		event.request.headers.get(PLUGIN_PACKAGE_SIZE_HEADER)
	)
	if (
		event.request.headers.get(PLUGIN_PACKAGE_SIZE_HEADER) &&
		Number.isFinite(declared) &&
		declared > PLUGIN_PACKAGE_MAX_MB * MIB
	)
		return refuse(packageTooLargeSentence(declared), 413)
	try {
		const id = randomUUID()
		await fsp.mkdir(uploadsDir(), { recursive: true })
		await fsp.writeFile(partPath(id), "")
		uploads().set(id, {
			userId: user.id,
			filename: filenameOf(event),
			touchedAt: Date.now()
		})
		await sweepUploads()
		const body: PackageUploadStart = {
			upload: id,
			pieceBytes: pieceBytes()
		}
		return jsonResponse(body)
	} catch (e) {
		console.warn("[plugins] package upload could not start:", e)
		return refuse("The upload could not be started.", 500)
	}
}

/** `PUT ?upload=<id>&offset=<n>`: append one piece. */
export async function handlePackagePiece(
	event: RequestEvent
): Promise<Response> {
	const g = await gate(event)
	if ("refusal" in g) return g.refusal
	const found = ownedUpload(event, g.user.id)
	if (!found) return refuse(EXPIRED_SENTENCE, 404)
	const { id } = found
	try {
		const size = await fsp.stat(partPath(id)).then(
			(s) => s.size,
			() => -1
		)
		if (size < 0) {
			uploads().delete(id)
			return refuse(EXPIRED_SENTENCE, 404)
		}
		const offset = Number(event.url.searchParams.get("offset"))
		if (!Number.isInteger(offset) || offset !== size) {
			await discard(id)
			return refuse(OUT_OF_STEP_SENTENCE, 409)
		}
		const declared = Number(event.request.headers.get("content-length"))
		if (Number.isFinite(declared) && declared > pieceBytes())
			return refuse("A piece of the upload was too large.", 413)
		const piece = Buffer.from(await event.request.arrayBuffer())
		if (piece.length > pieceBytes())
			return refuse("A piece of the upload was too large.", 413)
		if (piece.length === 0) return refuse("That piece is empty.", 400)
		const total = size + piece.length
		if (total > PLUGIN_PACKAGE_MAX_MB * MIB) {
			await discard(id)
			return refuse(packageTooLargeSentence(total), 413)
		}
		await fsp.appendFile(partPath(id), piece)
		// The hour runs from the last piece, so a slow upload of a big package is not cut off.
		found.entry.touchedAt = Date.now()
		const body: PackageUploadPiece = { received: total }
		return jsonResponse(body)
	} catch (e) {
		await discard(id)
		console.warn("[plugins] package piece failed:", e)
		return refuse("The upload failed. Choose the file again.", 500)
	}
}

/** `POST ?upload=<id>`: unpack and install what the pieces added up to. */
async function finishUpload(
	event: RequestEvent,
	user: Admin
): Promise<Response> {
	const found = ownedUpload(event, user.id)
	if (!found) return refuse(EXPIRED_SENTENCE, 404)
	const { id, entry } = found
	uploads().delete(id)
	const zipPath = partPath(id)
	try {
		const pending = await logbookBegin(
			user,
			"plugins:installPackage",
			{ filename: entry.filename },
			db
		)
		const result = await installUploadedPackage({
			zipPath,
			filename: entry.filename,
			pushIo: pluginPushIo()
		})
		if (pending) await logbookCommit(pending, result, db)
		return jsonResponse(result)
	} catch (e) {
		if (e instanceof PackageUploadRefusal)
			return refuse(e.message, e.status)
		if (isOwnWords(e)) return refuse(e.message, 400)
		console.warn("[plugins] package upload failed:", e)
		return refuse("The package could not be installed.", 500)
	} finally {
		await fsp.rm(zipPath, { force: true })
	}
}
