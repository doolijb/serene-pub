/**
 * Everything that moves the data directory around when the database will not
 * open — and the one module the recovery page, the socket handlers and the CLI
 * all share, so the three can never disagree about what "restore" means.
 *
 * **Two hard rules, both structural rather than advisory.**
 *
 * 1. *Nothing here deletes anything unless the caller named it.* Restore and
 *    start-fresh **move** the old database to `serene-pub.db.broken-<ts>`;
 *    backups are never culled. `deleteBackup()` and `deleteBrokenDir()` are the
 *    only functions that unlink, and they take a name the owner picked.
 * 2. *It runs with no database.* No drizzle, no `dbReady`, no query — its whole
 *    reason to exist is the boot where those are unavailable. `backupNow()` is
 *    the single exception, and it is the one function the recovery page does
 *    not offer: dumping a database requires opening it.
 *
 * **Why a child process.** A restore is verified by opening the extracted
 * directory with PGlite and running a query. PGlite's Postgres is WASM, and a
 * directory it cannot start on does not raise — it calls Emscripten's
 * `abort()`, which tears down that runtime instance for good. The trap does
 * surface as a catchable `RuntimeError` (measured), but what is left behind is a
 * dead WASM heap and a half-initialised filesystem inside the very process that
 * is currently serving the page explaining the failure. A throwaway `node`
 * process is allowed to end up in that state; this one is not. The parent reads
 * the child's exit status and nothing else.
 *
 * **Why the archive is validated as well as opened.** Measured, not assumed:
 * `PGlite.create({ loadDataDir })` handed a blob that is not a gzip tar does
 * not fail. It silently ignores it and runs `initdb`, producing an empty
 * database that opens perfectly and answers `select 1`. "It opened" is
 * therefore not evidence that a restore restored anything, and a restore that
 * cannot tell an archive from a text file would swap a damaged database — the
 * owner's only copy of everything since the last backup — for a blank one. So
 * the archive is walked as a tar first, and must contain a `PG_VERSION`.
 */
import { spawn } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { pathToFileURL } from "node:url"
import zlib from "node:zlib"
import * as dbConfig from "./drizzle.config"
import { BACKUPS_DIR_NAME } from "./backup"
import { readMetaFile, writeMetaFile } from "./lock.js"

/** The database directory's name inside the data directory. */
export const DB_DIR_NAME = "serene-pub.db"

/** Where a database that would not open is moved to. Never deleted from here. */
export const BROKEN_DIR_PREFIX = `${DB_DIR_NAME}.broken-`

/** Where an extraction that failed verification is left, as evidence. */
export const RESTORE_FAILED_PREFIX = `${DB_DIR_NAME}.restore-failed-`

/** Where an extraction lands before it has earned the real name. */
const STAGING_DIR_PREFIX = `${DB_DIR_NAME}.restoring-`

/** A meta.json displaced by a restore is kept, not overwritten. */
const REPLACED_META_PREFIX = "meta.json.replaced-"

/** Media, avatars and the import cache, all under the data directory. */
export const USERS_DIR_NAME = "users"

/** Where a `users/` tree displaced by a restore goes. Never deleted from here. */
export const BROKEN_USERS_PREFIX = `${USERS_DIR_NAME}.broken-`

/** Where an unpacked `users/` lands before it has earned the real name. */
const USERS_STAGING_PREFIX = `${USERS_DIR_NAME}.restoring-`

/**
 * The optional second tier, beside the dump: `<archive>.users.tgz`.
 *
 * Beside rather than inside for the same reason `meta.json` is (see
 * `BACKUP_META_SUFFIX`) and one more of its own: a dump is the database and a
 * user-file tree is everything a database only *points* at. They restore
 * separately, they are wanted separately, and an owner who does not want to
 * carry gigabytes of media should be able to see — and delete — the half that
 * is large without touching the half that is irreplaceable.
 */
export const BACKUP_USERS_SUFFIX = ".users.tgz"

/**
 * Skipped at any depth when packing the user-file tier.
 *
 * `users/<uid>/cache/cards` is the card-import cache (ruled 2026-09-09): every
 * byte in it was derived from a file the owner still has, and re-deriving it
 * costs one import. Archiving it would be paying storage forever for something
 * rebuildable, in the one tier whose whole objection is size.
 */
const USERS_EXCLUDED_DIR = "cache"

/**
 * `meta.json` travels **beside** the dump, not inside it.
 *
 * The archive is exactly what PGlite's `dumpDataDir()` produced, byte for byte,
 * and that is what makes one restore procedure work everywhere: the code path
 * (`PGlite.create({ loadDataDir })`), the CLI, and the by-hand route documented
 * in `docs/troubleshooting.md` (`tar xzf` straight over `serene-pub.db/`) all
 * consume the same file. Injecting `meta.json` into the tar would mean
 * rewriting an archive we did not build, dropping a foreign file into `PGDATA`
 * on every hand-restore, and breaking the round-trip through the very API that
 * created it. A companion file costs one `existsSync` to answer "does this
 * backup carry its key?" and nothing else.
 */
export const BACKUP_META_SUFFIX = ".meta.json"

/** Only ever `.tgz`. A stray file in `backups/` is not offered for restore. */
const BACKUP_EXT = ".tgz"

/**
 * How many `recoveryLog` entries `meta.json` keeps.
 *
 * Bounded because this file is read on the boot path and rewritten by the lock
 * heartbeat every nine seconds; an unbounded array in it is a growing cost on
 * an operation that has to stay fast. Not a retention policy — no *data* is
 * culled anywhere in this module (ruling 3).
 */
const RECOVERY_LOG_LIMIT = 200

export interface RecoveryPaths {
	dataDir: string
	dbPath: string
	metaPath: string
	backupsDir: string
}

/**
 * The four paths every function here works from.
 *
 * Taken as an argument rather than read from `drizzle.config` at each call so
 * the tests can point the whole module at a copied fixture, and so the CLI can
 * name a directory explicitly. Defaults to the running instance's.
 */
export function recoveryPaths(
	dataDir: string = dbConfig.dataDir
): RecoveryPaths {
	return {
		dataDir,
		dbPath: path.join(dataDir, DB_DIR_NAME),
		metaPath: path.join(dataDir, "meta.json"),
		backupsDir: path.join(dataDir, BACKUPS_DIR_NAME)
	}
}

export interface BackupEntry {
	/** Filename only — never a path. This is what every action takes back. */
	name: string
	bytes: number
	/** ISO 8601, from the file's mtime. */
	modifiedAt: string
	/**
	 * Whether a companion `meta.json` was archived with it. A backup without
	 * one still restores; the current `meta.json` is simply kept as it is.
	 */
	hasMeta: boolean
	/**
	 * Whether a user-file tier (`<name>.users.tgz`) was archived beside it —
	 * the optional second half that carries media and avatars.
	 */
	hasUsers: boolean
	/** Size of that tier on disk. 0 when there is none. */
	usersBytes: number
}

export interface BrokenDirEntry {
	name: string
	/** Total size on disk, best effort — an unreadable entry contributes 0. */
	bytes: number
	modifiedAt: string
	/** `"broken"` (a database moved aside) or `"restore-failed"`. */
	kind: "broken" | "restore-failed"
}

export interface RecoveryLogEntry {
	at: string
	action: string
	from?: string
	to?: string
	ok: boolean
	/** Present on failure, and on success where the outcome needs a word. */
	detail?: string
}

/* ------------------------------------------------------------------ names */

/**
 * Turn a name from a form post, a socket message or `argv` into a path inside
 * one known directory — or refuse.
 *
 * Three checks and each rules out a different escape: `basename` inequality
 * catches `../`, a separator or a drive letter; the empty/dot cases catch `.`
 * and `..` outright; and resolving and comparing the parent catches whatever a
 * platform's path rules do that the first two did not anticipate. A name that
 * survives all three addresses a file in `dir` and nothing else.
 */
function resolveInside(dir: string, name: unknown, what: string): string {
	if (typeof name !== "string" || name.length === 0) {
		throw new Error(`No ${what} was named.`)
	}
	if (name.includes("\0")) {
		throw new Error(`That ${what} name is not a valid filename.`)
	}
	if (name === "." || name === ".." || path.basename(name) !== name) {
		throw new Error(
			`"${name}" is not a plain filename. Only a ${what} inside ${dir} can be used here.`
		)
	}
	const full = path.resolve(dir, name)
	if (path.dirname(full) !== path.resolve(dir)) {
		throw new Error(`"${name}" resolves outside ${dir} and was refused.`)
	}
	return full
}

/** Colons are illegal in Windows filenames, so the stamp is dashed. */
function timestampForName(at: Date = new Date()): string {
	return at.toISOString().replace(/[:.]/g, "-").replace("Z", "")
}

/* -------------------------------------------------------------- meta.json */

/**
 * Append one line to `meta.json.recoveryLog[]` and to the server log.
 *
 * Read-modify-write through `lock.js`, and it **refuses a `meta.json` it cannot
 * parse** rather than replacing one: that file holds `cryptoSecretKey`, the
 * only copy of the key that decrypts every stored passphrase on the instance,
 * and no audit line is worth minting a new one. A failure to record is logged
 * and swallowed — the move it describes has already happened, and throwing here
 * would turn a completed restore into a reported failure.
 */
export function appendRecoveryLog(
	metaPath: string,
	entry: RecoveryLogEntry
): void {
	const line =
		`[recovery] ${entry.action}` +
		(entry.from ? ` from=${entry.from}` : "") +
		(entry.to ? ` to=${entry.to}` : "") +
		` ok=${entry.ok}` +
		(entry.detail ? ` — ${entry.detail}` : "")
	if (entry.ok) console.log(line)
	else console.warn(line)

	const read = readMetaFile(metaPath)
	if (!read.ok) {
		console.warn(
			`[recovery] could not record that in ${metaPath} — ` +
				`${read.missing ? "the file does not exist" : String((read.error as Error)?.message ?? read.error)}.`
		)
		return
	}
	try {
		const existing = read.meta.recoveryLog
		const log: RecoveryLogEntry[] = Array.isArray(existing)
			? (existing as RecoveryLogEntry[])
			: []
		log.push(entry)
		read.meta.recoveryLog = log.slice(-RECOVERY_LOG_LIMIT)
		writeMetaFile(metaPath, read.meta)
	} catch (error) {
		console.warn(
			`[recovery] could not record that in ${metaPath} — ` +
				`${String((error as Error)?.message ?? error)}.`
		)
	}
}

export function readRecoveryLog(
	paths: RecoveryPaths = recoveryPaths()
): RecoveryLogEntry[] {
	const read = readMetaFile(paths.metaPath)
	if (!read.ok) return []
	const log = read.meta.recoveryLog
	return Array.isArray(log) ? (log as RecoveryLogEntry[]) : []
}

/* --------------------------------------------------------------- listings */

/**
 * What is in `backups/`, newest first.
 *
 * Never throws: its callers are a boot that has already failed and a page that
 * exists to explain that failure. An absent or unreadable directory is an empty
 * list, which is the truthful answer to "what can I restore?".
 */
export function listBackups(
	paths: RecoveryPaths = recoveryPaths()
): BackupEntry[] {
	let names: string[]
	try {
		names = fs.readdirSync(paths.backupsDir)
	} catch {
		return []
	}

	const out: BackupEntry[] = []
	for (const name of names) {
		if (!name.endsWith(BACKUP_EXT)) continue
		// A user-file tier is a `.tgz` too, and it is not a backup — it is one
		// half of one. Listing it as its own row would offer a restore that
		// would refuse (it has no PG_VERSION) and a delete that would silently
		// orphan the dump it belongs to.
		if (name.endsWith(BACKUP_USERS_SUFFIX)) continue
		try {
			const stat = fs.statSync(path.join(paths.backupsDir, name))
			if (!stat.isFile()) continue
			out.push({
				name,
				bytes: stat.size,
				modifiedAt: new Date(stat.mtimeMs).toISOString(),
				hasMeta: fs.existsSync(
					path.join(paths.backupsDir, name + BACKUP_META_SUFFIX)
				),
				...usersTierOf(paths.backupsDir, name)
			})
		} catch {
			// Vanished between the listing and the stat. Not offerable.
		}
	}
	return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
}

/** Is there a `<name>.users.tgz` beside this dump, and how big is it? */
function usersTierOf(
	backupsDir: string,
	name: string
): { hasUsers: boolean; usersBytes: number } {
	try {
		const stat = fs.statSync(
			path.join(backupsDir, name + BACKUP_USERS_SUFFIX)
		)
		if (stat.isFile()) return { hasUsers: true, usersBytes: stat.size }
	} catch {
		// Not there, which is the normal case — the tier is off by default.
	}
	return { hasUsers: false, usersBytes: 0 }
}

/**
 * Databases moved aside, newest first — both the ones a recovery moved and the
 * ones a failed restore left behind.
 *
 * Listed in the healthy app as well as on the recovery page, because these are
 * the only things this app ever leaves lying around that an owner might
 * genuinely want to reclaim disk from, and the recovery page is unreachable
 * once the instance is working again.
 */
export function listBrokenDirs(
	paths: RecoveryPaths = recoveryPaths()
): BrokenDirEntry[] {
	let names: string[]
	try {
		names = fs.readdirSync(paths.dataDir)
	} catch {
		return []
	}

	const out: BrokenDirEntry[] = []
	for (const name of names) {
		const kind = brokenDirKind(name)
		if (!kind) continue
		try {
			const full = path.join(paths.dataDir, name)
			const stat = fs.statSync(full)
			if (!stat.isDirectory()) continue
			out.push({
				name,
				bytes: directorySize(full),
				modifiedAt: new Date(stat.mtimeMs).toISOString(),
				kind
			})
		} catch {
			// Same reasoning as above.
		}
	}
	return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
}

function brokenDirKind(name: string): BrokenDirEntry["kind"] | null {
	if (name.startsWith(BROKEN_DIR_PREFIX)) return "broken"
	if (name.startsWith(RESTORE_FAILED_PREFIX)) return "restore-failed"
	return null
}

/** Best effort, and deliberately not recursive-symlink-aware: PGlite writes a
 * plain tree of files, and a size shown on a page is not worth a stat storm. */
function directorySize(dir: string): number {
	let total = 0
	let entries: fs.Dirent[]
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true })
	} catch {
		return 0
	}
	for (const entry of entries) {
		const full = path.join(dir, entry.name)
		if (entry.isDirectory()) total += directorySize(full)
		else if (entry.isFile()) {
			try {
				total += fs.statSync(full).size
			} catch {
				// Gone. Contributes nothing.
			}
		}
	}
	return total
}

/* ------------------------------------------------------------ tar reading */

interface TarEntryHeader {
	name: string
	size: number
	typeflag: string
}

/**
 * Walk a ustar stream's headers, ignoring the file bodies.
 *
 * Enough tar to answer one question — "is this really a PostgreSQL data
 * directory?" — and no more. PGlite writes plain ustar with `PG_VERSION` as the
 * second entry, so this stops within the first kilobyte in practice; the caller
 * caps how far it will look regardless.
 */
function* readTarHeaders(buffer: Buffer): Generator<TarEntryHeader> {
	let offset = 0
	while (offset + 512 <= buffer.length) {
		const block = buffer.subarray(offset, offset + 512)
		// Two consecutive zero blocks end an archive; one is enough to stop
		// looking, since nothing after it is a header either way.
		if (block.every((byte) => byte === 0)) return

		const magic = block.subarray(257, 263).toString("latin1")
		if (magic !== "ustar\0" && magic !== "ustar ") return

		const raw = block.subarray(0, 100).toString("latin1")
		const prefix = block.subarray(345, 500).toString("latin1")
		const name = trimNul(prefix)
			? `${trimNul(prefix)}/${trimNul(raw)}`
			: trimNul(raw)
		const size = parseInt(
			trimNul(block.subarray(124, 136).toString("latin1")).trim(),
			8
		)
		const typeflag = String.fromCharCode(block[156])

		yield { name, size: Number.isFinite(size) ? size : 0, typeflag }
		offset +=
			512 + Math.ceil((Number.isFinite(size) ? size : 0) / 512) * 512
	}
}

function trimNul(value: string): string {
	const end = value.indexOf("\0")
	return (end === -1 ? value : value.slice(0, end)).trim()
}

/**
 * How much of a dump is decompressed to decide whether it is one.
 *
 * PGlite's tar puts `PG_VERSION` second and `base/` third, so a megabyte is
 * three orders of magnitude more than needed — it is a ceiling that keeps a
 * hostile or accidental 40 GB archive from being expanded into memory by a
 * validity check, not a budget anything real spends.
 */
const ARCHIVE_PROBE_BYTES = 1024 * 1024

export interface ArchiveCheck {
	ok: boolean
	reason?: string
}

/**
 * Is this file a PGlite data-directory dump?
 *
 * The load-bearing check of the whole module. `PGlite.create({ loadDataDir })`
 * accepts a blob that is not an archive at all and quietly runs `initdb`
 * instead — an empty database that opens and answers queries — so without this,
 * "restore" would happily replace a damaged database with a blank one and
 * report success. See this module's header.
 */
export async function inspectArchive(file: string): Promise<ArchiveCheck> {
	try {
		const fd = fs.openSync(file, "r")
		try {
			const magic = Buffer.alloc(2)
			if (fs.readSync(fd, magic, 0, 2, 0) < 2) {
				return { ok: false, reason: "the file is empty" }
			}
			if (magic[0] !== 0x1f || magic[1] !== 0x8b) {
				return {
					ok: false,
					reason: "it is not a gzip archive (a backup is a .tgz)"
				}
			}
		} finally {
			fs.closeSync(fd)
		}
	} catch (error) {
		return {
			ok: false,
			reason: `it could not be read (${String((error as Error)?.message ?? error)})`
		}
	}

	// Streamed and stopped early rather than decompressed whole. A backup is
	// tens to hundreds of megabytes expanded, this runs on a boot that may
	// already be short of memory, and the answer is in the first kilobyte.
	return await new Promise<ArchiveCheck>((resolve) => {
		const source = fs.createReadStream(file)
		const gunzip = zlib.createGunzip()
		const chunks: Buffer[] = []
		let total = 0
		let settled = false

		const finish = (result: ArchiveCheck) => {
			if (settled) return
			settled = true
			source.destroy()
			gunzip.destroy()
			resolve(result)
		}

		gunzip.on("data", (chunk: Buffer) => {
			chunks.push(chunk)
			total += chunk.length
			const head = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks)
			for (const entry of readTarHeaders(head)) {
				if (entry.name.replace(/^\/+/, "") === "PG_VERSION") {
					return finish({ ok: true })
				}
			}
			if (total >= ARCHIVE_PROBE_BYTES) finish(notADataDir())
		})
		gunzip.on("end", () => finish(notADataDir()))
		gunzip.on("error", (error) =>
			finish({
				ok: false,
				reason: `it could not be decompressed (${error.message})`
			})
		)
		source.on("error", (error) =>
			finish({
				ok: false,
				reason: `it could not be read (${error.message})`
			})
		)
		source.pipe(gunzip)
	})
}

function notADataDir(): ArchiveCheck {
	return {
		ok: false,
		reason: "it does not contain a PostgreSQL data directory (no PG_VERSION)"
	}
}

/* ------------------------------------------------------------ tar writing */

const TAR_BLOCK = 512

function tarHeader(
	name: string,
	{
		size,
		mode,
		mtime,
		typeflag
	}: {
		size: number
		mode: number
		mtime: number
		typeflag: "0" | "5"
	}
): Buffer | null {
	// ustar splits a long path across `prefix` (155) and `name` (100), joined by
	// a "/". The split has to land on a separator, and the RIGHTMOST one is not
	// always a legal choice — a deep directory can push the prefix past 155
	// while an earlier separator would have fit both halves. So every candidate
	// is tried, right to left, and the first legal one wins (longest prefix,
	// shortest base — the layout every tar writes).
	let prefix = ""
	let base = name
	if (Buffer.byteLength(name) > 100) {
		let cut = name.lastIndexOf("/")
		let found = false
		while (cut > 0) {
			const head = name.slice(0, cut)
			const tail = name.slice(cut + 1)
			if (
				Buffer.byteLength(head) <= 155 &&
				Buffer.byteLength(tail) <= 100
			) {
				prefix = head
				base = tail
				found = true
				break
			}
			cut = name.lastIndexOf("/", cut - 1)
		}
		// No legal split: a single path component over 100 bytes, or a whole
		// path over 256. Neither occurs in a PostgreSQL data directory, and
		// skipping one entry beats aborting a download somebody needs for a bug
		// report. GNU long-name records are the alternative and are not worth
		// carrying for a case that cannot arise.
		if (!found) return null
	}

	const block = Buffer.alloc(TAR_BLOCK)
	const put = (value: string, at: number, len: number) =>
		block.write(value.slice(0, len), at, len, "latin1")
	const octal = (value: number, len: number) =>
		value.toString(8).padStart(len - 1, "0") + "\0"

	put(base, 0, 100)
	put(octal(mode & 0o7777, 8), 100, 8)
	put(octal(0, 8), 108, 8)
	put(octal(0, 8), 116, 8)
	put(octal(size, 12), 124, 12)
	put(octal(Math.floor(mtime / 1000), 12), 136, 12)
	// Checksum is computed over a header whose own checksum field is spaces.
	block.fill(0x20, 148, 156)
	put(typeflag, 156, 1)
	put("ustar\0", 257, 6)
	put("00", 263, 2)
	put(prefix, 345, 155)

	let sum = 0
	for (const byte of block) sum += byte
	put(sum.toString(8).padStart(6, "0") + "\0 ", 148, 8)
	return block
}

/**
 * A `.tgz` of one directory, streamed.
 *
 * `backup.ts` gets its tar from PGlite's own `dumpDataDir()`, which is not
 * available here by definition — the directory being packed is the one that
 * will not open. So the ustar writer above is the deviation this function
 * exists to justify: it is the only place in the app that builds a tar itself,
 * it writes the same plain ustar PGlite does, and `tar xzf` reads its output.
 *
 * Streamed rather than buffered because a data directory is tens to hundreds of
 * megabytes and this runs in a process that may already be under memory
 * pressure from whatever killed it in the first place.
 */
export function packDirectoryStream(
	dir: string,
	rootName: string,
	options: {
		/**
		 * Called with a directory's own name and its path inside the archive.
		 * Returning true drops it and everything under it — no header, no
		 * descent. Only the user-file tier uses it; a data directory is packed
		 * whole.
		 */
		skipDir?: (name: string, rel: string) => boolean
	} = {}
): Readable {
	async function* blocks(): AsyncGenerator<Buffer> {
		const stack: Array<{ abs: string; rel: string }> = [
			{ abs: dir, rel: rootName }
		]
		while (stack.length) {
			const { abs, rel } = stack.shift()!
			let stat: fs.Stats
			try {
				stat = fs.lstatSync(abs)
			} catch {
				continue
			}

			if (stat.isDirectory()) {
				if (
					rel !== rootName &&
					options.skipDir?.(path.basename(rel), rel)
				) {
					continue
				}
				const header = tarHeader(`${rel}/`, {
					size: 0,
					mode: stat.mode,
					mtime: stat.mtimeMs,
					typeflag: "5"
				})
				if (header) yield header
				let entries: string[]
				try {
					entries = fs.readdirSync(abs).sort()
				} catch {
					continue
				}
				for (const name of entries) {
					stack.push({
						abs: path.join(abs, name),
						rel: `${rel}/${name}`
					})
				}
			} else if (stat.isFile()) {
				const header = tarHeader(rel, {
					size: stat.size,
					mode: stat.mode,
					mtime: stat.mtimeMs,
					typeflag: "0"
				})
				// A path too long for ustar is skipped rather than aborting the
				// download; PGlite writes nothing near the limit, and half an
				// archive is more useful for a bug report than none.
				if (!header) continue
				yield header

				let written = 0
				for await (const chunk of fs.createReadStream(abs, {
					highWaterMark: 1024 * 1024
				})) {
					const buf = chunk as Buffer
					// The header already declared `stat.size`. A file being
					// appended to underneath us must not desynchronise the
					// stream, so the declared length is what gets written.
					const room = stat.size - written
					if (room <= 0) break
					const slice =
						buf.length > room ? buf.subarray(0, room) : buf
					written += slice.length
					yield slice
				}
				if (written < stat.size) {
					yield Buffer.alloc(stat.size - written)
				}
				const pad = (TAR_BLOCK - (stat.size % TAR_BLOCK)) % TAR_BLOCK
				if (pad) yield Buffer.alloc(pad)
			}
			// Anything else (a symlink, a socket) is not part of a PGlite data
			// directory and is not worth a representation in the archive.
		}
		// Two zero blocks close a tar.
		yield Buffer.alloc(TAR_BLOCK * 2)
	}

	return Readable.from(blocks()).pipe(zlib.createGzip())
}

export interface PackedBrokenDir {
	filename: string
	stream: Readable
}

/**
 * Stream one moved-aside database as a `.tgz`, for a bug report or a manual
 * repair with the Postgres client tools the app does not ship.
 */
export function packBrokenDir(
	name: string,
	paths: RecoveryPaths = recoveryPaths()
): PackedBrokenDir {
	if (!brokenDirKind(name)) {
		throw new Error(
			`"${name}" is not a set-aside database directory. Only ${BROKEN_DIR_PREFIX}* and ${RESTORE_FAILED_PREFIX}* can be downloaded.`
		)
	}
	const full = resolveInside(paths.dataDir, name, "directory")
	if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) {
		throw new Error(`There is no directory named "${name}".`)
	}
	// The name has already been proved to be one of this module's own prefixes,
	// but it still reaches a Content-Disposition header, so the filename is
	// reduced to characters that cannot terminate one.
	const filename = `${name.replace(/[^A-Za-z0-9._-]/g, "_")}.tgz`
	return { filename, stream: packDirectoryStream(full, name) }
}

/* --------------------------------------------------------- user-file tier */

/**
 * The optional second half of a backup: `<dataDir>/users/`, minus its caches.
 *
 * A dump covers `serene-pub.db/` and nothing else, which was fine while the
 * database was self-contained and stopped being fine at 0109 — `files` rows are
 * foreign keys behind every avatar now, so a database restored on its own points
 * at bytes that were never archived. This is the tier that carries those bytes.
 *
 * **Off by default** (ruled 2026-09-10) and written as its own file rather than
 * folded into the dump: the two halves differ by orders of magnitude in size,
 * they are wanted separately, and the dump has to stay byte-for-byte what PGlite
 * produced for every restore route to keep working (see `BACKUP_META_SUFFIX`).
 *
 * Returns `null` when there is no `users/` directory at all — a fresh install
 * that has imported nothing — because an empty tier file would be a promise of
 * media where there is none.
 */
export async function packUserFiles(
	dataDir: string,
	archivePath: string
): Promise<{ path: string; bytes: number } | null> {
	const usersDir = path.join(dataDir, USERS_DIR_NAME)
	try {
		if (!fs.statSync(usersDir).isDirectory()) return null
	} catch {
		return null
	}

	const out = archivePath + BACKUP_USERS_SUFFIX
	// Same temp-then-rename as the dump: an interrupted pack must never be
	// mistaken for a tier that can be restored.
	const tmp = `${out}.partial`
	await pipeline(
		packDirectoryStream(usersDir, USERS_DIR_NAME, {
			skipDir: (name) => name === USERS_EXCLUDED_DIR
		}),
		fs.createWriteStream(tmp)
	)
	fs.renameSync(tmp, out)
	return { path: out, bytes: fs.statSync(out).size }
}

/**
 * Unpack a ustar `.tgz` into a directory, streamed.
 *
 * Written here rather than pulled in, for the same reason `packDirectoryStream`
 * is: this app ships no tar library, the dump's extraction is PGlite's own
 * `loadDataDir` and is unavailable for anything that is not a data directory,
 * and the alternative — decompressing a media tree into a Buffer to walk it —
 * is unbounded memory on the one tier with no size ceiling.
 *
 * Every entry name is resolved against `target` and refused if it lands outside
 * it. The archives this reads are ones this app wrote, but it also reads a file
 * an owner copied into `backups/` by hand, and a `../` in a tar is the oldest
 * trick there is.
 */
async function extractTarGz(archive: string, target: string): Promise<void> {
	const source = fs.createReadStream(archive).pipe(zlib.createGunzip())

	let pending: Buffer = Buffer.alloc(0)
	/** The entry being written. `fd: null` means "skip these bytes". */
	let current: { fd: number | null; remaining: number; pad: number } | null =
		null
	let ended = false

	const closeCurrent = () => {
		if (current?.fd != null) fs.closeSync(current.fd)
		current = null
	}

	try {
		for await (const chunk of source) {
			if (ended) continue
			pending = pending.length
				? Buffer.concat([pending, chunk as Buffer])
				: (chunk as Buffer)
			let off = 0

			while (!ended) {
				if (current) {
					const take = Math.min(
						current.remaining,
						pending.length - off
					)
					if (take > 0) {
						if (current.fd != null) {
							fs.writeSync(current.fd, pending, off, take)
						}
						off += take
						current.remaining -= take
					}
					if (current.remaining > 0) break
					const padTake = Math.min(current.pad, pending.length - off)
					off += padTake
					current.pad -= padTake
					if (current.pad > 0) break
					closeCurrent()
					continue
				}

				if (pending.length - off < 512) break
				const block = pending.subarray(off, off + 512)
				// Two zero blocks close a tar; one is enough to stop, since
				// nothing after it is a header either way.
				if (block.every((byte) => byte === 0)) {
					ended = true
					break
				}
				const magic = block.subarray(257, 263).toString("latin1")
				if (magic !== "ustar\0" && magic !== "ustar ") {
					throw new Error("it is not a ustar archive")
				}
				off += 512

				const raw = trimNul(block.subarray(0, 100).toString("latin1"))
				const prefix = trimNul(
					block.subarray(345, 500).toString("latin1")
				)
				const name = prefix ? `${prefix}/${raw}` : raw
				const parsedSize = parseInt(
					trimNul(block.subarray(124, 136).toString("latin1")),
					8
				)
				const size = Number.isFinite(parsedSize) ? parsedSize : 0
				const typeflag = String.fromCharCode(block[156])
				const pad = (512 - (size % 512)) % 512

				const full = resolveUnder(target, name)
				if (typeflag === "5") {
					if (full) fs.mkdirSync(full, { recursive: true })
					continue
				}
				if (typeflag !== "0" && typeflag !== "\0") {
					// A link, a device, a GNU extension header. Not something
					// this app writes; its bytes are skipped rather than
					// guessed at.
					current = { fd: null, remaining: size, pad }
					continue
				}
				if (!full) {
					current = { fd: null, remaining: size, pad }
					continue
				}
				fs.mkdirSync(path.dirname(full), { recursive: true })
				current = { fd: fs.openSync(full, "w"), remaining: size, pad }
			}

			pending =
				off >= pending.length ? Buffer.alloc(0) : pending.subarray(off)
		}
	} finally {
		closeCurrent()
		source.destroy()
	}

	if (current) throw new Error("the archive ended in the middle of a file")
}

/**
 * An archive entry's path inside `target`, or null if it escapes.
 *
 * Null rather than a throw: one hostile entry in an otherwise good tier should
 * cost that entry, not the whole restore.
 */
function resolveUnder(target: string, name: string): string | null {
	const clean = name.replace(/^\/+/, "")
	if (!clean || clean.includes("\0")) return null
	const root = path.resolve(target)
	const full = path.resolve(root, clean)
	if (full !== root && !full.startsWith(root + path.sep)) return null
	return full
}

export interface UsersRestoreResult {
	/** Whether a tier was found and unpacked. */
	restored: boolean
	/** Where the `users/` that was there went. Null when there was none. */
	movedTo: string | null
	/** Present when a tier was there and could not be unpacked. */
	detail?: string
}

/**
 * Put a backup's user-file tier in place of `<dataDir>/users/`.
 *
 * Staged and then swapped, exactly like the database restore above and for the
 * same reason: the state after a failure equals the state before, without
 * anything having to be undone. The tree that was there is **moved** to
 * `users.broken-<ts>` — never deleted (ruling 4) — because it holds every image
 * added since the backup was taken, and those are files nothing else has a copy
 * of.
 *
 * Best effort on purpose. By the time this runs the database has already been
 * swapped, and a tier that will not unpack is a reason to tell the owner about
 * their media, not a reason to report that a completed restore failed.
 */
export async function restoreUserFiles(
	archive: string,
	paths: RecoveryPaths,
	stamp: string
): Promise<UsersRestoreResult> {
	const tier = archive + BACKUP_USERS_SUFFIX
	if (!fs.existsSync(tier)) return { restored: false, movedTo: null }

	const usersPath = path.join(paths.dataDir, USERS_DIR_NAME)
	const staging = path.join(paths.dataDir, USERS_STAGING_PREFIX + stamp)
	// `recursive: false`: a collision means another restore is in flight in
	// this same second, and the correct response is to stop.
	fs.mkdirSync(staging)

	let unpacked: string
	try {
		await extractTarGz(tier, staging)
		unpacked = path.join(staging, USERS_DIR_NAME)
		if (!fs.existsSync(unpacked)) {
			throw new Error(`it contains no ${USERS_DIR_NAME}/ directory`)
		}
	} catch (error) {
		fs.rmSync(staging, { recursive: true, force: true })
		const detail = String((error as Error)?.message ?? error)
		console.warn(
			`[recovery] the user-file tier could not be unpacked — ${detail}. ` +
				`Your media is untouched at ${usersPath}.`
		)
		return { restored: false, movedTo: null, detail }
	}

	let movedTo: string | null = null
	if (fs.existsSync(usersPath)) {
		movedTo = BROKEN_USERS_PREFIX + stamp
		fs.renameSync(usersPath, path.join(paths.dataDir, movedTo))
	}
	try {
		fs.renameSync(unpacked, usersPath)
	} catch (error) {
		// Put it back. Leaving the instance with no media at all would be a
		// worse outcome than not having restored the tier.
		if (movedTo) {
			fs.renameSync(path.join(paths.dataDir, movedTo), usersPath)
		}
		fs.rmSync(staging, { recursive: true, force: true })
		const detail = String((error as Error)?.message ?? error)
		console.warn(
			`[recovery] the user-file tier could not be put in place — ${detail}.`
		)
		return { restored: false, movedTo: null, detail }
	}
	// The staging shell is now empty and is ours, not the owner's.
	fs.rmSync(staging, { recursive: true, force: true })

	return { restored: true, movedTo }
}

/* --------------------------------------------------------------- backup */

export interface BackupCreated extends BackupEntry {
	path: string
}

/**
 * Take a backup on demand.
 *
 * **The one function here that needs a working database** — a dump comes out of
 * PGlite, so there is nothing to dump when it will not open. That is why the
 * recovery page offers "download the broken directory" instead: it is the same
 * intent (get a copy off this machine) served by the only mechanism available
 * in that state.
 *
 * `db` is imported dynamically rather than at module scope, and that is a real
 * cycle rather than a style choice: `./index` is what would import this module
 * to reopen after a restore, and a static import back into it is the shape that
 * deadlocks the production bundle (see `db/index.ts`).
 */
export async function backupNow(
	options: {
		label?: string
		paths?: RecoveryPaths
		/** Injected by tests and by the CLI; defaults to the running instance. */
		db?: MigrationDb
		/**
		 * Archive `users/` beside the dump. Undefined defers to the stored
		 * setting, which is what every caller but a one-shot override wants.
		 */
		includeUserFiles?: boolean
		/**
		 * Write a line into `meta.json.recoveryLog[]`. Default true.
		 *
		 * False for exactly one caller — the daily service — and for a reason
		 * about what that log is *for*. It is the record of the times something
		 * moved a data directory around: a restore, a start-fresh, a deletion,
		 * a backup somebody asked for. It is capped at 200 entries (see
		 * `RECOVERY_LOG_LIMIT`, and the cap is not optional — the file is
		 * rewritten by the lock heartbeat every nine seconds). An entry a day
		 * would evict every real recovery action inside seven months and leave
		 * an owner reading a log of nothing happening.
		 *
		 * Nothing is lost by omitting it: the daily backup announces itself on
		 * stdout, and the archive it wrote is in `backups/` with its timestamp
		 * on it.
		 */
		record?: boolean
	} = {}
): Promise<BackupCreated> {
	const paths = options.paths ?? recoveryPaths()
	const read = readMetaFile(paths.metaPath)
	const label =
		options.label?.trim() ||
		(read.ok && typeof read.meta.version === "string"
			? (read.meta.version as string)
			: "manual")

	const database = options.db ?? (await import("./index")).db
	const { backupDatabase } = await import("./backup")
	const result = await backupDatabase(database, {
		dataDir: paths.dataDir,
		label,
		includeUserFiles: options.includeUserFiles
	})

	const name = path.basename(result.path)
	const entry: BackupCreated = {
		name,
		path: result.path,
		bytes: result.bytes,
		modifiedAt: new Date().toISOString(),
		hasMeta: fs.existsSync(result.path + BACKUP_META_SUFFIX),
		...usersTierOf(paths.backupsDir, name)
	}
	if (options.record !== false) {
		appendRecoveryLog(paths.metaPath, {
			at: entry.modifiedAt,
			action: "backup",
			to: name,
			ok: true,
			detail:
				`${(entry.bytes / 1024 / 1024).toFixed(1)} MB` +
				(entry.hasUsers
					? ` + ${(entry.usersBytes / 1024 / 1024).toFixed(1)} MB of user files`
					: "")
		})
	}
	return entry
}

/** Remove one named backup, and its companion `meta.json` if it has one. */
export function deleteBackup(
	name: string,
	paths: RecoveryPaths = recoveryPaths()
): void {
	if (!name.endsWith(BACKUP_EXT) || name.endsWith(BACKUP_USERS_SUFFIX)) {
		throw new Error(`"${name}" is not a backup archive.`)
	}
	const full = resolveInside(paths.backupsDir, name, "backup")
	if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
		throw new Error(`There is no backup named "${name}".`)
	}
	fs.rmSync(full, { force: true })
	fs.rmSync(full + BACKUP_META_SUFFIX, { force: true })
	// Both companions go with it. A tier left behind is gigabytes of media
	// keyed to a dump that no longer exists, which nothing would ever list
	// again and nobody would think to look for.
	fs.rmSync(full + BACKUP_USERS_SUFFIX, { force: true })
	appendRecoveryLog(paths.metaPath, {
		at: new Date().toISOString(),
		action: "delete-backup",
		from: name,
		ok: true
	})
}

/** Remove one set-aside database directory. The owner asked for this by name. */
export function deleteBrokenDir(
	name: string,
	paths: RecoveryPaths = recoveryPaths()
): void {
	if (!brokenDirKind(name)) {
		throw new Error(
			`"${name}" is not a set-aside database directory. Only ${BROKEN_DIR_PREFIX}* and ${RESTORE_FAILED_PREFIX}* can be deleted here.`
		)
	}
	const full = resolveInside(paths.dataDir, name, "directory")
	if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) {
		throw new Error(`There is no directory named "${name}".`)
	}
	fs.rmSync(full, { recursive: true, force: true })
	appendRecoveryLog(paths.metaPath, {
		at: new Date().toISOString(),
		action: "delete-broken",
		from: name,
		ok: true
	})
}

/* -------------------------------------------------------------- restoring */

/**
 * The tables a restore reads end to end before it trusts the archive: the
 * lorebooks, which no other file can rebuild.
 */
const RESTORE_PROBE_TABLES = ["lorebooks", "lorebook_entries"] as const

/**
 * Open a data directory with PGlite in a process of its own, and run one query
 * — then read every row of the lorebook tables (`RESTORE_PROBE_TABLES`).
 *
 * The verification step, and the extraction step, in one child: PGlite's
 * `loadDataDir` untars into `dataDir` as part of opening it, so "did it extract"
 * and "does it open" are answered by the same call and cannot disagree.
 *
 * Its own process because the failure mode is a WASM abort — a trap that kills
 * the runtime rather than raising something catchable — and losing the server
 * that is currently explaining the problem would be a worse outcome than a
 * failed restore.
 */
async function extractAndVerify(
	archive: string,
	target: string
): Promise<void> {
	const script = `
const fs = await import("node:fs")
const [entry, archive, target] = process.argv.slice(1)
const { PGlite } = await import(entry)
const pg = await PGlite.create({
	dataDir: target,
	loadDataDir: new Blob([fs.readFileSync(archive)])
})
await pg.waitReady
const res = await pg.query("select current_setting('server_version') as v")
if (!res?.rows?.length) throw new Error("the restored database answered nothing")
// Opening proves the catalog; it reads none of the data. Every page of the
// lorebook tables is read too, when the backup has them (an empty database,
// or one from before they existed, does not), so a dump whose user data is
// unreadable fails here rather than after it replaced the live database.
for (const table of ${JSON.stringify(RESTORE_PROBE_TABLES)}) {
	const has = await pg.query("select to_regclass($1) as t", ["public." + table])
	if (!has.rows[0]?.t) continue
	try {
		await pg.query("select count(*) from " + table)
	} catch (e) {
		// One line on stderr, which is what the failure names (\`lastLine\`).
		process.stderr.write("its " + table + " table cannot be read: " + String(e?.message ?? e).split("\\n")[0] + "\\n")
		process.exit(2)
	}
}
await pg.close()
process.stdout.write("ok " + res.rows[0].v)
`
	const entry = resolvePgliteEntry()
	await new Promise<void>((resolve, reject) => {
		const child = spawn(
			process.execPath,
			["--input-type=module", "-e", script, entry, archive, target],
			{ stdio: ["ignore", "pipe", "pipe"], cwd: process.cwd() }
		)
		let out = ""
		let err = ""
		child.stdout.on("data", (d) => (out += String(d)))
		child.stderr.on("data", (d) => (err += String(d)))
		child.on("error", reject)
		child.on("close", (code, signal) => {
			if (code === 0 && out.startsWith("ok")) return resolve()
			reject(
				new Error(
					`the restored database did not open (${
						signal ? `killed by ${signal}` : `exit ${code}`
					})${err.trim() ? `: ${lastLine(err)}` : ""}`
				)
			)
		})
	})
}

function lastLine(text: string): string {
	const lines = text.trim().split("\n").filter(Boolean)
	return lines[lines.length - 1]?.slice(0, 400) ?? ""
}

/**
 * Where the child should import PGlite from.
 *
 * Resolved by the parent because the parent is inside the app's module graph
 * and the child is a `-e` string with no file of its own to resolve from. Falls
 * back to the bare specifier, which works whenever the process's working
 * directory is the install root — the normal case for every way this app is
 * started.
 */
function resolvePgliteEntry(): string {
	const from = [
		() => createRequire(import.meta.url).resolve("@electric-sql/pglite"),
		() =>
			createRequire(path.join(process.cwd(), "index.js")).resolve(
				"@electric-sql/pglite"
			)
	]
	for (const attempt of from) {
		try {
			return pathToFileURL(attempt()).href
		} catch {
			// Try the next one; the bare specifier below is the last resort.
		}
	}
	return "@electric-sql/pglite"
}

export interface RestoreResult {
	/** Where the database that was there went. Null when there was none. */
	movedTo: string | null
	/** The backup that was restored. */
	from: string
	/** Whether the archive's companion `meta.json` was applied. */
	metaRestored: boolean
	/** Where the previous `meta.json` was kept, if one was replaced. */
	previousMetaAt: string | null
	/** Whether the backup's user-file tier was unpacked over `users/`. */
	usersRestored: boolean
	/** Where the `users/` that was there went. Null when it was left alone. */
	usersMovedTo: string | null
}

/**
 * Put a backup in place of the current database.
 *
 * **Extraction happens off to the side, and the swap is two renames.** The plan
 * described moving the broken directory aside first and undoing that move on
 * failure; staging instead reaches the same stated property — *the state after a
 * failed restore equals the state before* — without ever needing to undo
 * anything, because on the failing path the live database is not touched at
 * all. The window in which the data directory has no `serene-pub.db` shrinks
 * from "an entire extraction" to "between two renames".
 *
 * A failed attempt is left as `serene-pub.db.restore-failed-<ts>` rather than
 * removed: it is evidence about the archive, it is never automatically deleted
 * (ruling 4), and its absence would leave an owner with a failure message and
 * nothing to look at.
 */
export async function restoreBackup(
	name: string,
	paths: RecoveryPaths = recoveryPaths(),
	options: {
		/**
		 * Also put the backup's `users/` tier back, when it has one.
		 *
		 * Defaults to true, which is the offer's default (ruled 2026-09-10):
		 * a database restored without the media its `files` rows name is a
		 * half-restore, and the owner who has to notice that is the one least
		 * equipped to. Passing false is how the UI and the CLI carry a
		 * decline; a backup with no tier is unaffected either way.
		 */
		restoreUsers?: boolean
	} = {}
): Promise<RestoreResult> {
	if (!name.endsWith(BACKUP_EXT) || name.endsWith(BACKUP_USERS_SUFFIX)) {
		throw new Error(`"${name}" is not a backup archive.`)
	}
	const archive = resolveInside(paths.backupsDir, name, "backup")
	if (!fs.existsSync(archive) || !fs.statSync(archive).isFile()) {
		throw new Error(`There is no backup named "${name}".`)
	}

	const stamp = timestampForName()
	const staging = path.join(paths.dataDir, STAGING_DIR_PREFIX + stamp)
	// `recursive: false` on purpose: a collision means another restore is in
	// flight in this same second, and the correct response is to stop.
	fs.mkdirSync(staging)

	try {
		const check = await inspectArchive(archive)
		if (!check.ok) {
			throw new Error(
				`"${name}" is not a usable backup — ${check.reason}`
			)
		}
		await extractAndVerify(archive, staging)
	} catch (error) {
		const failed = path.join(paths.dataDir, RESTORE_FAILED_PREFIX + stamp)
		try {
			fs.renameSync(staging, failed)
		} catch {
			// Nothing to keep. The live database was never touched either way.
		}
		const detail = String((error as Error)?.message ?? error)
		appendRecoveryLog(paths.metaPath, {
			at: new Date().toISOString(),
			action: "restore",
			from: name,
			to: path.basename(failed),
			ok: false,
			detail
		})
		throw new Error(`Restoring "${name}" failed: ${detail}`)
	}

	// Verified. Now the only two operations that touch the live database, and
	// they are renames within one directory — atomic, and reversible.
	let movedTo: string | null = null
	if (fs.existsSync(paths.dbPath)) {
		movedTo = BROKEN_DIR_PREFIX + stamp
		fs.renameSync(paths.dbPath, path.join(paths.dataDir, movedTo))
	}
	try {
		fs.renameSync(staging, paths.dbPath)
	} catch (error) {
		// Put it back. Failing here with the database missing would turn a
		// recoverable situation into the one this module exists to prevent.
		if (movedTo) {
			fs.renameSync(path.join(paths.dataDir, movedTo), paths.dbPath)
		}
		const detail = String((error as Error)?.message ?? error)
		appendRecoveryLog(paths.metaPath, {
			at: new Date().toISOString(),
			action: "restore",
			from: name,
			ok: false,
			detail
		})
		throw new Error(`Restoring "${name}" failed: ${detail}`)
	}

	const meta = applyCompanionMeta(archive, paths, stamp)

	// After the database, and deliberately: the tier is best effort, and it
	// must not be able to turn a completed database restore into a failure.
	const users =
		options.restoreUsers === false
			? { restored: false, movedTo: null, detail: undefined }
			: await restoreUserFiles(archive, paths, stamp)

	appendRecoveryLog(paths.metaPath, {
		at: new Date().toISOString(),
		action: "restore",
		from: name,
		to: movedTo ?? DB_DIR_NAME,
		ok: true,
		detail:
			(meta.restored
				? "the archived meta.json was applied"
				: "the current meta.json was kept") +
			(users.restored
				? `; user files restored${users.movedTo ? ` (yours kept as ${users.movedTo})` : ""}`
				: users.detail
					? `; the user-file tier did not unpack — ${users.detail}`
					: "")
	})

	return {
		movedTo,
		from: name,
		metaRestored: meta.restored,
		previousMetaAt: meta.previousAt,
		usersRestored: users.restored,
		usersMovedTo: users.movedTo
	}
}

/**
 * Pair the restored database with the `meta.json` that was current when it was
 * dumped — or keep the live one when the backup has no companion (ruling 3).
 *
 * Only two fields cross over, and both have to: `cryptoSecretKey`, because the
 * API passphrases *inside* the restored database were encrypted with it and are
 * unreadable without it, and `version`, because the migration gate compares it
 * against the app's to decide what to run. Everything else stays live —
 * `lock` above all, which is this process's own claim on the directory and
 * would be a stale lock from months ago if it were restored.
 *
 * The displaced file is copied to `meta.json.replaced-<ts>`, never overwritten:
 * a login session and every stored passphrase hang off the key it carries.
 */
function applyCompanionMeta(
	archive: string,
	paths: RecoveryPaths,
	stamp: string
): { restored: boolean; previousAt: string | null } {
	const companion = archive + BACKUP_META_SUFFIX
	if (!fs.existsSync(companion)) return { restored: false, previousAt: null }

	let archived: Record<string, unknown>
	try {
		const parsed = JSON.parse(fs.readFileSync(companion, "utf-8"))
		if (!parsed || typeof parsed !== "object")
			throw new Error("not an object")
		archived = parsed as Record<string, unknown>
	} catch (error) {
		console.warn(
			`[recovery] the backup's companion meta.json could not be read (${String(
				(error as Error)?.message ?? error
			)}) — keeping the current one.`
		)
		return { restored: false, previousAt: null }
	}

	const current = readMetaFile(paths.metaPath)
	if (!current.ok) {
		// No parseable meta.json to merge into. Writing the archived one whole
		// is strictly better than leaving the instance with no key at all.
		try {
			writeMetaFile(paths.metaPath, archived)
			return { restored: true, previousAt: null }
		} catch {
			return { restored: false, previousAt: null }
		}
	}

	const sameKey =
		current.meta.cryptoSecretKey === archived.cryptoSecretKey &&
		current.meta.version === archived.version
	if (sameKey) return { restored: false, previousAt: null }

	let previousAt: string | null = null
	try {
		previousAt = REPLACED_META_PREFIX + stamp
		fs.copyFileSync(paths.metaPath, path.join(paths.dataDir, previousAt))
	} catch {
		previousAt = null
	}

	const next = { ...current.meta }
	if (typeof archived.cryptoSecretKey === "string")
		next.cryptoSecretKey = archived.cryptoSecretKey
	if (typeof archived.version === "string") next.version = archived.version
	writeMetaFile(paths.metaPath, next)
	return { restored: true, previousAt }
}

/* ------------------------------------------------------------ start fresh */

export interface StartFreshResult {
	/** Where the database that was there went. Null when there was none. */
	movedTo: string | null
}

/**
 * Move the current database aside and leave nothing in its place.
 *
 * Deliberately does **not** create a database. A first run creates one by
 * simply opening a path that does not exist — `drizzle(dbConfig.dbPath)` in
 * `db/index.ts` hands PGlite a missing directory and PGlite runs `initdb`, and
 * migrations and seeds follow from there. Reproducing any of that here would be
 * a second, divergent copy of the boot path; the next open is the first one.
 */
export function startFresh(
	paths: RecoveryPaths = recoveryPaths()
): StartFreshResult {
	let movedTo: string | null = null
	if (fs.existsSync(paths.dbPath)) {
		movedTo = BROKEN_DIR_PREFIX + timestampForName()
		fs.renameSync(paths.dbPath, path.join(paths.dataDir, movedTo))
	}
	appendRecoveryLog(paths.metaPath, {
		at: new Date().toISOString(),
		action: "start-fresh",
		from: movedTo ? DB_DIR_NAME : undefined,
		to: movedTo ?? undefined,
		ok: true,
		detail: movedTo
			? "the next start creates an empty database"
			: "there was no database to move aside"
	})
	return { movedTo }
}
