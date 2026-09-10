/**
 * The recovery pages' contents. The shell they sit in is
 * `$lib/server/db/unopenablePage.ts`.
 *
 * Written in plain words on purpose. The reader is somebody whose app stopped
 * working, and every sentence here has to answer one of three questions: what
 * happened, what is still safe, and what will this button do. Nothing says
 * "corrupt", nothing says "fatal", and every action states out loud that it
 * moves rather than deletes — because it does, and because the single most
 * useful thing to tell a person in this state is that their data is still on
 * the disk.
 */
import fs from "node:fs"
import {
	escapeHtml,
	renderRecoveryDocument
} from "$lib/server/db/unopenablePage"
import { TROUBLESHOOTING_DOC, TROUBLESHOOTING_URL } from "$lib/server/db/errors"
import type {
	BackupEntry,
	BrokenDirEntry,
	RecoveryLogEntry,
	RecoveryPaths
} from "$lib/server/db/recovery"

export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
	if (bytes < 1024 * 1024 * 1024)
		return `${(bytes / 1024 / 1024).toFixed(1)} MB`
	return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

function formatWhen(iso: string): string {
	// Deliberately not "3 days ago": a relative time needs a locale and a clock
	// the reader trusts, and this page is often read from a log afterwards.
	return iso.replace("T", " ").replace(/\.\d+Z$/, " UTC")
}

const SHUTDOWN_LINE: Record<string, string> = {
	unclean:
		"The last run ended without shutting down — a force-quit, a kill, an out-of-memory stop, or a power loss. That is the usual cause of this.",
	clean: "The last run shut down normally, so a force-quit is not the explanation here.",
	unknown: "There is no record of how the last run ended."
}

export interface RecoveryPageData {
	paths: RecoveryPaths
	lastShutdown: string
	backups: BackupEntry[]
	brokenDirs: BrokenDirEntry[]
	log: RecoveryLogEntry[]
	/** Shown once above the fold after an action completed. */
	notice?: { kind: "ok" | "warn"; text: string }
}

function backupsTable(backups: BackupEntry[]): string {
	if (!backups.length) {
		return `<p class="empty">There are no backups in
<code>${escapeHtml("backups/")}</code>. One is taken automatically before a
version upgrade changes the database, and only then, so a recent install often
has none.</p>`
	}

	const rows = backups
		.map((backup) => {
			const name = escapeHtml(backup.name)
			return `<tr>
<td><code>${name}</code><br>
<span class="muted">${
				backup.hasMeta
					? "includes meta.json — stored passphrases will still open"
					: "no meta.json — your current one is kept"
			}${
				backup.hasUsers
					? ` · plus ${formatBytes(backup.usersBytes)} of user files (media and avatars)`
					: ""
			}</span></td>
<td class="num">${formatBytes(backup.bytes)}</td>
<td class="num">${escapeHtml(formatWhen(backup.modifiedAt))}</td>
<td class="num">
<form class="inline" method="post" action="/recovery/restore">
<input type="hidden" name="name" value="${name}">
<button class="primary" type="submit">Restore</button>
</form>
<form class="inline" method="post" action="/recovery/delete-backup">
<input type="hidden" name="name" value="${name}">
<button class="danger" type="submit">Delete</button>
</form>
</td>
</tr>`
		})
		.join("\n")

	return `<table>
<thead><tr><th>Backup</th><th>Size</th><th>Taken</th><th></th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`
}

function brokenTable(dirs: BrokenDirEntry[]): string {
	if (!dirs.length) return ""
	const rows = dirs
		.map((dir) => {
			const name = escapeHtml(dir.name)
			return `<tr>
<td><code>${name}</code><br><span class="muted">${
				dir.kind === "broken"
					? "a database that was set aside"
					: "an attempted restore that did not open"
			}</span></td>
<td class="num">${formatBytes(dir.bytes)}</td>
<td class="num">${escapeHtml(formatWhen(dir.modifiedAt))}</td>
<td class="num">
<a href="/recovery/download?name=${encodeURIComponent(dir.name)}"><button type="button">Download</button></a>
<form class="inline" method="post" action="/recovery/delete-broken">
<input type="hidden" name="name" value="${name}">
<button class="danger" type="submit">Delete</button>
</form>
</td>
</tr>`
		})
		.join("\n")

	return `<h2>Databases set aside</h2>
<p>Kept until you delete them. A download is a <code>.tgz</code> you can attach
to a bug report, or repair with the PostgreSQL tools described in the
troubleshooting guide.</p>
<table>
<thead><tr><th>Directory</th><th>Size</th><th>Set aside</th><th></th></tr></thead>
<tbody>
${rows}
</tbody>
</table>`
}

function logList(log: RecoveryLogEntry[]): string {
	if (!log.length) return ""
	const rows = log
		.slice(-8)
		.reverse()
		.map(
			(entry) =>
				`<tr><td class="num">${escapeHtml(formatWhen(entry.at))}</td>
<td>${escapeHtml(entry.action)}${entry.ok ? "" : " — did not complete"}${
					entry.from
						? ` · from <code>${escapeHtml(entry.from)}</code>`
						: ""
				}${entry.to ? ` · to <code>${escapeHtml(entry.to)}</code>` : ""}${
					entry.detail
						? `<br><span class="muted">${escapeHtml(entry.detail)}</span>`
						: ""
				}</td></tr>`
		)
		.join("\n")
	return `<h2>What has been done here</h2>
<table><tbody>
${rows}
</tbody></table>`
}

export function renderRecoveryHome(data: RecoveryPageData): Response {
	const metaPresent = fs.existsSync(data.paths.metaPath)
	const notice = data.notice
		? `<p class="${data.notice.kind === "ok" ? "calm" : "warn"}">${escapeHtml(
				data.notice.text
			)}</p>`
		: ""

	return renderRecoveryDocument({
		title: "Serene Pub — recovery",
		body: `<h1>Serene Pub could not open its database.</h1>

${notice}

<p class="calm"><strong>Nothing has been changed, moved or deleted.</strong>
Your data directory is exactly as it was, and nothing on this page deletes
anything unless you pick it by name.</p>

<p>${escapeHtml(SHUTDOWN_LINE[data.lastShutdown] ?? SHUTDOWN_LINE.unknown)}</p>

<h2>Where things are</h2>
<dl>
<dt>Data directory</dt><dd><code>${escapeHtml(data.paths.dataDir)}</code></dd>
<dt>Database</dt><dd><code>${escapeHtml(data.paths.dbPath)}</code></dd>
<dt>meta.json</dt><dd>${
			metaPresent
				? "present — your login and saved passphrases are safe"
				: "<strong>missing</strong> — saved passphrases cannot be decrypted without it"
		}</dd>
</dl>

<h2>Backups</h2>
${backupsTable(data.backups)}

<h2>Start with an empty database</h2>
<p>Moves the current database aside and creates a new, empty one. Your
characters, sessions and lorebooks are in the database, so they will not be in
the new one — but nothing is deleted, and <code>meta.json</code> stays, so
saved passphrases and your login still work.</p>
<form method="post" action="/recovery/fresh">
<button class="danger" type="submit">Start fresh</button>
</form>

${brokenTable(data.brokenDirs)}

${logList(data.log)}

<h2>Doing this yourself</h2>
<p>The same operations are available from a terminal —
<code>npm run db:recover -- --list</code>,
<code>--restore &lt;file&gt;</code>, <code>--fresh</code> — and the by-hand
steps, including the advanced repair route, are in
<code>${escapeHtml(TROUBLESHOOTING_DOC)}</code>, online at
<a href="${escapeHtml(TROUBLESHOOTING_URL)}">${escapeHtml(TROUBLESHOOTING_URL)}</a>.</p>

<p class="muted">This page answers only requests from this machine and your
local network.</p>`
	})
}

export interface ConfirmPageData {
	title: string
	heading: string
	/** Paragraphs, in order. Plain text; escaped here. */
	explain: string[]
	action: string
	/** Extra hidden fields, already-safe key/value pairs. */
	fields?: Record<string, string>
	/**
	 * One decision the reader gets to make on the confirmation itself.
	 *
	 * The only one there is, and it earns the exception: a backup's user-file
	 * tier is restored by default (ruled 2026-09-10), and "by default" has to
	 * mean something a reader can see and untick. Everything else on these
	 * pages is stated, not offered.
	 */
	checkbox?: { name: string; label: string; checked: boolean }
	token: string
	submitLabel: string
	danger?: boolean
}

/**
 * The page between "clicked a button" and "it happened".
 *
 * It restates the operation in the same words the button used, names every path
 * involved, and carries a token the action will not run without. Server-side
 * rather than a `confirm()` dialog because there is no JavaScript on any of
 * these pages, and because the token has to come from the server for the
 * single-use property to mean anything.
 */
export function renderConfirmPage(data: ConfirmPageData): Response {
	const hidden = Object.entries(data.fields ?? {})
		.map(
			([key, value]) =>
				`<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(
					value
				)}">`
		)
		.join("\n")

	const checkbox = data.checkbox
		? `<p><label><input type="checkbox" name="${escapeHtml(
				data.checkbox.name
			)}" value="yes"${
				data.checkbox.checked ? " checked" : ""
			}> ${escapeHtml(data.checkbox.label)}</label></p>`
		: ""

	return renderRecoveryDocument({
		title: data.title,
		body: `<h1>${escapeHtml(data.heading)}</h1>
${data.explain.map((line) => `<p>${escapeHtml(line)}</p>`).join("\n")}
<form method="post" action="${escapeHtml(data.action)}">
${hidden}
${checkbox}
<input type="hidden" name="confirm" value="${escapeHtml(data.token)}">
<p class="actions">
<button class="${data.danger ? "danger" : "primary"}" type="submit">${escapeHtml(
			data.submitLabel
		)}</button>
<a href="/recovery"><button type="button">Cancel</button></a>
</p>
</form>`
	})
}

/**
 * A failure that is worth its own page rather than a line on the home page.
 *
 * 503 like every other page here, and for the same reason: the instance really
 * is unavailable while this is showing, whatever went wrong with the particular
 * action. A 200 would also let an intermediary cache a page that names a
 * one-time token.
 */
export function renderProblemPage(
	heading: string,
	explain: string[]
): Response {
	return renderRecoveryDocument({
		title: "Serene Pub — recovery",
		body: `<h1>${escapeHtml(heading)}</h1>
<p class="warn">${escapeHtml(explain[0] ?? "")}</p>
${explain
	.slice(1)
	.map((line) => `<p>${escapeHtml(line)}</p>`)
	.join("\n")}
<p class="actions"><a href="/recovery"><button type="button">Back to recovery</button></a></p>`
	})
}

/**
 * Everything the home page shows, gathered from the filesystem.
 *
 * Nothing here can throw: each of the three listings already answers an
 * unreadable directory with an empty list, and the shutdown marker answers
 * `"unknown"`. A recovery page that failed to render because one `readdir`
 * failed would leave the owner exactly where P0 found them.
 */
export async function collectRecoveryPageData(
	notice?: RecoveryPageData["notice"]
): Promise<RecoveryPageData> {
	const { listBackups, listBrokenDirs, readRecoveryLog, recoveryPaths } =
		await import("$lib/server/db/recovery")
	const { readShutdownMarker } = await import("$lib/server/db/shutdownMarker")
	const paths = recoveryPaths()
	return {
		paths,
		// Read live rather than taken from the boot error: a restore that
		// failed and a start-fresh both rewrite meta.json, and a page rendered
		// straight afterwards should say what is true now.
		lastShutdown: readShutdownMarker(paths.metaPath),
		backups: listBackups(paths),
		brokenDirs: listBrokenDirs(paths),
		log: readRecoveryLog(paths),
		notice
	}
}
