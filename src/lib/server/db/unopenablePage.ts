/**
 * Every page served while the database will not open.
 *
 * Deliberately the smallest possible thing: strings, built here, returned
 * either from `hooks.server.ts` before SvelteKit resolves a route or from the
 * plain `+server.ts` handlers under `/recovery`. No database (there isn't one),
 * no sockets (they never attached), no Svelte, no fonts, no scripts, no
 * network. Every one of those is either unavailable in this state or a new way
 * for the explanation itself to fail, and a blank screen is exactly what this
 * exists to replace.
 *
 * It grew from P0's single placeholder into P1's small renderer, and the shape
 * of that growth is the point: the recovery pages are the same document with
 * different contents, so `renderRecoveryDocument` owns the shell — one
 * stylesheet, one heading style, one set of colours in both themes — and
 * nothing downstream writes a `<style>` block of its own.
 *
 * The only interactivity anywhere in here is `<form method="post">`. No
 * client-side JavaScript is loaded, generated or inlined on any recovery page:
 * the state these run in is one where things fail, and a confirm dialog that
 * depends on a script is a confirm dialog that can silently not appear before
 * an action that moves a database.
 */
import {
	TROUBLESHOOTING_DOC,
	TROUBLESHOOTING_URL,
	type DatabaseUnopenableError
} from "./errors"

/** Paths come from the filesystem and land in HTML. Nothing goes in raw. */
export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;")
}

const PAGE_STYLE = `
:root { color-scheme: light dark; }
body {
	margin: 0; padding: 2rem 1.25rem;
	font: 16px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
	background: #faf9f7; color: #1f1d1b;
}
main { max-width: 44rem; margin: 0 auto; }
h1 { font-size: 1.5rem; line-height: 1.25; margin: 0 0 1rem; }
h2 { font-size: 1.05rem; margin: 2rem 0 .5rem; }
code {
	font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
	font-size: .9em; word-break: break-all;
	background: rgba(127,127,127,.14); border-radius: .25rem; padding: .1em .35em;
}
.calm {
	border-left: 3px solid #6b8f71; padding: .75rem 1rem;
	background: rgba(107,143,113,.1); border-radius: 0 .25rem .25rem 0;
}
.warn {
	border-left: 3px solid #b07d48; padding: .75rem 1rem;
	background: rgba(176,125,72,.12); border-radius: 0 .25rem .25rem 0;
}
dl { margin: 0; }
dt { font-weight: 600; margin-top: .75rem; }
dd { margin: .15rem 0 0; }
a { color: inherit; }
table { border-collapse: collapse; width: 100%; margin: .5rem 0 0; }
th, td {
	text-align: left; padding: .45rem .6rem .45rem 0;
	border-bottom: 1px solid rgba(127,127,127,.25); vertical-align: top;
}
th { font-weight: 600; font-size: .85rem; text-transform: uppercase;
	letter-spacing: .04em; opacity: .75; }
td.num { white-space: nowrap; opacity: .85; }
form.inline { display: inline; margin: 0; }
button {
	font: inherit; padding: .4rem .75rem; border-radius: .3rem;
	border: 1px solid rgba(127,127,127,.5); background: rgba(127,127,127,.1);
	color: inherit; cursor: pointer;
}
button.primary { border-color: #6b8f71; background: rgba(107,143,113,.22); }
button.danger { border-color: #a4534b; background: rgba(164,83,75,.16); }
.actions { display: flex; flex-wrap: wrap; gap: .5rem; margin-top: 1rem; }
.muted { opacity: .75; font-size: .92em; }
.empty { opacity: .75; font-style: italic; }
@media (prefers-color-scheme: dark) {
	body { background: #17161a; color: #e9e6e2; }
}
`

export interface RecoveryDocument {
	title: string
	/** The `<main>` contents. Already escaped by its caller. */
	body: string
	status?: number
}

/**
 * The shell every page here shares.
 *
 * `no-store` on all of them, and not only on the failure page: a cached copy of
 * "your database is broken" outlives the fix, and a cached copy of a
 * confirmation page would carry a single-use token that has already been spent.
 */
export function renderRecoveryDocument({
	title,
	body,
	status = 503
}: RecoveryDocument): Response {
	const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`
	return new Response(html, {
		status,
		headers: {
			"content-type": "text/html; charset=utf-8",
			"cache-control": "no-store"
		}
	})
}

/**
 * What a request from anywhere else gets (ruling 2).
 *
 * Says nothing. Not the data directory, not the backup names, not that a
 * recovery surface exists, not even that the reason is a database — a reader
 * off the local network learns only that this instance is not serving. That is
 * the entire point: the recovery actions are unauthenticated by necessity, so
 * their existence is not something to advertise.
 */
export function renderUnavailablePage(): Response {
	return new Response("Service Unavailable\n", {
		status: 503,
		headers: {
			"content-type": "text/plain; charset=utf-8",
			"cache-control": "no-store"
		}
	})
}

const SHUTDOWN_LINE: Record<string, string> = {
	unclean:
		"The last run ended without shutting down — a force-quit, a kill, an out-of-memory stop, or a power loss. That is the usual cause of this.",
	clean: "The last run shut down normally, so a force-quit is not the explanation here.",
	unknown: "There is no record of how the last run ended."
}

/**
 * The page every ordinary route answers with while the database is unopenable.
 *
 * Reached only by a local peer — `hooks.server.ts` sends everyone else to
 * `renderUnavailablePage()` — which is what makes it safe for this to print
 * absolute paths and backup filenames at all.
 */
export function renderDatabaseUnopenablePage(
	error: DatabaseUnopenableError,
	options: { recoveryHref?: string } = {}
): Response {
	const backups =
		error.backupCount > 0
			? `<p>There ${error.backupCount === 1 ? "is" : "are"} <strong>${
					error.backupCount
				}</strong> backup${error.backupCount === 1 ? "" : "s"} in
			<code>${escapeHtml(error.backupsDir)}</code>. The newest is
			<code>${escapeHtml(error.newestBackup ?? "")}</code>.</p>`
			: `<p>No backups were found in <code>${escapeHtml(
					error.backupsDir
				)}</code>. Backups are only taken before a version upgrade changes the
			database, so a fresh install often has none.</p>`

	const recovery = options.recoveryHref
		? `<h2>What to do next</h2>
<p>Serene Pub can put a backup back for you, or start with an empty database and
keep this one aside. Nothing is deleted either way.</p>
<p class="actions"><a href="${escapeHtml(options.recoveryHref)}"><button class="primary" type="button">Open recovery</button></a></p>
<p class="muted">Recovery is only offered to this machine and your local
network. The same thing can be done from a terminal with
<code>npm run db:recover -- --list</code>.</p>
<p class="muted">The manual steps, and the advanced route for repairing a
directory in place, are in <code>${escapeHtml(TROUBLESHOOTING_DOC)}</code> —
online at <a href="${escapeHtml(TROUBLESHOOTING_URL)}">${escapeHtml(
				TROUBLESHOOTING_URL
			)}</a>.</p>`
		: `<h2>What to do next</h2>
<p>The recovery steps — how to set the broken database aside and put a backup in
its place, and the advanced route for repairing one — are in
<code>${escapeHtml(TROUBLESHOOTING_DOC)}</code>, which is also online at
<a href="${escapeHtml(TROUBLESHOOTING_URL)}">${escapeHtml(TROUBLESHOOTING_URL)}</a>.</p>

<p>Every page of Serene Pub will show this message until the database opens
again. Restart Serene Pub after making a change.</p>`

	return renderRecoveryDocument({
		title: "Serene Pub — the database could not be opened",
		body: `<h1>Serene Pub started, but the database could not be opened.</h1>

<p class="calm"><strong>Nothing has been changed, moved or deleted.</strong>
Your data directory is exactly as it was. Serene Pub did not attempt any repair,
and it will not do anything to that directory on its own.</p>

<p>${escapeHtml(SHUTDOWN_LINE[error.lastShutdown] ?? SHUTDOWN_LINE.unknown)}</p>

<h2>Where things are</h2>
<dl>
<dt>Data directory</dt><dd><code>${escapeHtml(error.dataDir)}</code></dd>
<dt>Database</dt><dd><code>${escapeHtml(error.dbPath)}</code></dd>
</dl>

<h2>Backups</h2>
${backups}

${recovery}`
	})
}
