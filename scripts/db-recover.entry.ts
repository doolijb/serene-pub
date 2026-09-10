/**
 * `npm run db:recover` — the headless half of the recovery page.
 *
 * Same module, same operations, same guarantees: nothing is deleted, the
 * database being replaced is moved to `serene-pub.db.broken-<date>`, and every
 * action lands in `meta.json.recoveryLog[]`. What differs is only who is
 * looking — Docker, a NAS, a machine reached over SSH, and anything else where
 * the recovery page's local-network rule cannot be satisfied by a browser.
 *
 * Deliberately does **not** import `$lib/server/db`. That module opens PGlite,
 * takes the lock and migrates at module scope, and this command already runs
 * inside `check-db-lock.js`'s lock — so importing it would make the app refuse
 * to start against a lock this very process is holding. `--backup` opens its
 * own client instead, which is also the only way to dump a database from
 * outside the app.
 */
import fs from "node:fs"
import path from "node:path"
import readline from "node:readline"
import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import * as dbConfig from "../src/lib/server/db/drizzle.config"
import {
	BACKUP_USERS_SUFFIX,
	backupNow,
	deleteBackup,
	deleteBrokenDir,
	listBackups,
	listBrokenDirs,
	readRecoveryLog,
	recoveryPaths,
	restoreBackup,
	startFresh
} from "../src/lib/server/db/recovery"

const USAGE = `
Serene Pub — database recovery

  npm run db:recover -- --list                 what is here, and what can be restored
  npm run db:recover -- --backup [label]       take a backup now (needs a database that opens)
  npm run db:recover -- --restore <file>       put a backup in place of the current database
  npm run db:recover -- --fresh                set the current database aside, start empty
  npm run db:recover -- --delete-backup <file> delete one backup file
  npm run db:recover -- --delete-aside <dir>   delete one set-aside database directory

  --yes         answer the confirmation for you (required when not run from a terminal)
  --users       with --backup, archive users/ (media and avatars) beside the dump
  --no-users    with --restore, leave users/ alone even when the backup carries it

A backup is up to three files: the dump, <dump>.meta.json beside it, and — when
user files are included — <dump>.users.tgz. --restore puts back whichever of
them the backup has; --no-users declines the last one.

Nothing is ever deleted unless you name it. --restore and --fresh MOVE the
current database to serene-pub.db.broken-<date> in the same folder, and
--restore moves users/ to users.broken-<date> the same way.
`

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
	if (bytes < 1024 * 1024 * 1024)
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`
	return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/**
 * Ask before moving a database.
 *
 * Not in the flag list the plan sketched, and added on purpose: `--fresh` typed
 * one word short of `--fresh --dry-run` is the kind of mistake this whole
 * feature exists to make survivable, and a CLI has no confirmation page to
 * stand in the way. `--yes` is the escape hatch, and a non-interactive shell
 * requires it rather than hanging on a prompt nobody can answer.
 */
async function confirm(lines: string[], assumeYes: boolean): Promise<boolean> {
	for (const line of lines) console.log(line)
	if (assumeYes) {
		console.log("\n--yes given; going ahead.")
		return true
	}
	if (!process.stdin.isTTY) {
		console.error(
			"\nThis is not an interactive terminal. Re-run with --yes if you are sure."
		)
		return false
	}
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout
	})
	const answer = await new Promise<string>((resolve) =>
		rl.question("\nType yes to go ahead: ", resolve)
	)
	rl.close()
	return answer.trim().toLowerCase() === "yes"
}

function printList(): void {
	const paths = recoveryPaths()
	const backups = listBackups(paths)
	const setAside = listBrokenDirs(paths)
	const dbPresent = fs.existsSync(paths.dbPath)

	console.log(`\nData directory   ${paths.dataDir}`)
	console.log(
		`Database         ${paths.dbPath}${dbPresent ? "" : "   (not there — the next start creates one)"}`
	)
	console.log(
		`meta.json        ${
			fs.existsSync(paths.metaPath)
				? "present — logins and stored passphrases are safe"
				: "MISSING — stored passphrases cannot be decrypted without it"
		}`
	)

	console.log(`\nBackups in ${paths.backupsDir}`)
	if (!backups.length) {
		console.log(
			"  (none — one is taken daily and before a version upgrade, unless daily backups are off)"
		)
	}
	for (const backup of backups) {
		console.log(
			`  ${backup.name}\n      ${formatBytes(backup.bytes)}   ${backup.modifiedAt}   ` +
				`${backup.hasMeta ? "includes meta.json" : "no meta.json (yours is kept)"}` +
				`${backup.hasUsers ? `   + user files ${formatBytes(backup.usersBytes)}` : ""}`
		)
	}

	if (setAside.length) {
		console.log(`\nDatabases set aside (kept until you delete them)`)
		for (const dir of setAside) {
			console.log(
				`  ${dir.name}\n      ${formatBytes(dir.bytes)}   ${dir.modifiedAt}   ${
					dir.kind === "broken"
						? "set aside by a recovery"
						: "an attempted restore that did not open"
				}`
			)
		}
	}

	const log = readRecoveryLog(paths).slice(-5)
	if (log.length) {
		console.log(`\nRecent recovery actions`)
		for (const entry of log) {
			console.log(
				`  ${entry.at}  ${entry.action}${entry.ok ? "" : " (did not complete)"}` +
					`${entry.from ? `  from ${entry.from}` : ""}` +
					`${entry.to ? `  to ${entry.to}` : ""}` +
					`${entry.detail ? `\n      ${entry.detail}` : ""}`
			)
		}
	}
	console.log("")
}

async function main(): Promise<number> {
	const argv = process.argv.slice(2)
	const assumeYes = argv.includes("--yes")
	// `--users` is an affirmation and `--no-users` a decline, which is not
	// symmetry for its own sake: the two commands they modify have opposite
	// defaults. A backup does not include user files unless told to; a restore
	// puts back whatever the backup carries unless told not to.
	const wantUsers = argv.includes("--users")
	const declineUsers = argv.includes("--no-users")
	const args = argv.filter(
		(a) => a !== "--yes" && a !== "--users" && a !== "--no-users"
	)
	const command = args[0]
	const value = args[1]
	const paths = recoveryPaths()

	switch (command) {
		case "--list":
		case undefined:
			printList()
			if (command === undefined) console.log(USAGE)
			return 0

		case "--backup": {
			if (!fs.existsSync(paths.dbPath)) {
				console.error(
					`There is no database at ${paths.dbPath} to back up.`
				)
				return 1
			}
			// Its own client, for the reason in this file's header. A dump has
			// to come out of a database that opens; if this throws with
			// `Aborted()`, the database is the one that will not open and
			// --restore or --fresh is the answer.
			const client = new PGlite(paths.dbPath)
			try {
				await client.waitReady
			} catch (error) {
				console.error(
					`\n${paths.dbPath} would not open, so there is nothing to dump.\n` +
						`This is the failure db:recover exists for — try --list, then --restore.\n` +
						`  ${String((error as Error)?.message ?? error)}`
				)
				return 1
			}
			const created = await backupNow({
				label: value,
				paths,
				db: drizzle(client),
				// Undefined, not false, when the flag is absent: that is what
				// defers to the stored setting rather than overriding it off.
				includeUserFiles: wantUsers || undefined
			})
			await client.close()
			console.log(
				`\nBacked up to ${path.join(paths.backupsDir, created.name)} (${formatBytes(created.bytes)})` +
					`${created.hasMeta ? ", with meta.json beside it." : "."}` +
					`${
						created.hasUsers
							? `\nUser files: ${created.name}${BACKUP_USERS_SUFFIX} (${formatBytes(created.usersBytes)}).`
							: ""
					}`
			)
			return 0
		}

		case "--restore": {
			if (!value) {
				console.error("Name a backup: --restore <file>. Try --list.")
				return 1
			}
			const backup = listBackups(paths).find((b) => b.name === value)
			if (!backup) {
				console.error(
					`There is no backup called "${value}" in ${paths.backupsDir}. Try --list.`
				)
				return 1
			}
			const withUsers = backup.hasUsers && !declineUsers
			const ok = await confirm(
				[
					`\nRestore ${backup.name} (${formatBytes(backup.bytes)}, taken ${backup.modifiedAt}).`,
					`  ${paths.dbPath}`,
					`    is MOVED to serene-pub.db.broken-<date> in the same folder. Nothing is deleted.`,
					backup.hasMeta
						? `  meta.json is replaced by the archived one (yours is kept as meta.json.replaced-<date>).`
						: `  meta.json is left exactly as it is.`,
					!backup.hasUsers
						? `  This backup has no user files, so media and avatars are left exactly as they are.`
						: withUsers
							? `  User files (${formatBytes(backup.usersBytes)}) are put back too; your current users/ is MOVED to users.broken-<date>. Pass --no-users to skip this.`
							: `  --no-users given, so users/ is left exactly as it is — the restored database may point at media it does not have.`,
					`  Anything done since this backup was taken stays in the database being set aside.`
				],
				assumeYes
			)
			if (!ok) {
				console.log("Nothing was changed.")
				return 1
			}
			try {
				const result = await restoreBackup(backup.name, paths, {
					restoreUsers: !declineUsers
				})
				console.log(
					`\nRestored. The previous database is at ${
						result.movedTo
							? path.join(paths.dataDir, result.movedTo)
							: "(there was none)"
					}.` +
						(result.usersRestored
							? `\nUser files restored${
									result.usersMovedTo
										? `; the previous users/ is at ${path.join(paths.dataDir, result.usersMovedTo)}`
										: ""
								}.`
							: "") +
						`\nStart Serene Pub.`
				)
				return 0
			} catch (error) {
				console.error(`\n${String((error as Error)?.message ?? error)}`)
				console.error(
					`Your database has not been touched — it is still at ${paths.dbPath}.`
				)
				return 1
			}
		}

		case "--fresh": {
			const backups = listBackups(paths)
			const ok = await confirm(
				[
					`\nStart with an empty database.`,
					`  ${paths.dbPath}`,
					`    is MOVED to serene-pub.db.broken-<date> in the same folder. Nothing is deleted.`,
					`  The next start creates an empty database: no characters, sessions or lorebooks.`,
					`  meta.json is left alone, so logins and stored passphrases keep working.`,
					backups.length
						? `  There ${backups.length === 1 ? "is" : "are"} ${backups.length} backup${backups.length === 1 ? "" : "s"} you could restore instead — see --list.`
						: `  There are no backups to restore instead.`
				],
				assumeYes
			)
			if (!ok) {
				console.log("Nothing was changed.")
				return 1
			}
			const { movedTo } = startFresh(paths)
			console.log(
				`\nDone. ${
					movedTo
						? `The previous database is at ${path.join(paths.dataDir, movedTo)}.`
						: "There was no database to move aside."
				}\nStart Serene Pub; it will create an empty database.`
			)
			return 0
		}

		case "--delete-backup": {
			if (!value) {
				console.error("Name a backup: --delete-backup <file>.")
				return 1
			}
			const ok = await confirm(
				[
					`\nDelete ${value} from ${paths.backupsDir}.`,
					`  This one really is a delete, not a move. It cannot be undone.`
				],
				assumeYes
			)
			if (!ok) {
				console.log("Nothing was deleted.")
				return 1
			}
			deleteBackup(value, paths)
			console.log("Deleted.")
			return 0
		}

		case "--delete-aside": {
			if (!value) {
				console.error("Name a directory: --delete-aside <dir>.")
				return 1
			}
			const ok = await confirm(
				[
					`\nDelete ${path.join(paths.dataDir, value)} and everything in it.`,
					`  This is the only copy of whatever was in that database. It cannot be undone.`
				],
				assumeYes
			)
			if (!ok) {
				console.log("Nothing was deleted.")
				return 1
			}
			deleteBrokenDir(value, paths)
			console.log("Deleted.")
			return 0
		}

		default:
			console.error(`Unknown option "${command}".`)
			console.log(USAGE)
			return 1
	}
}

main().then(
	(code) => process.exit(code),
	(error) => {
		console.error(String((error as Error)?.message ?? error))
		process.exit(1)
	}
)
