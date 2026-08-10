import pc from "picocolors"

/**
 * Monkey-patches console.log/warn/error so any message starting with the
 * "[Tag]" convention already used throughout this codebase (e.g.
 * "[KoboldCPP]", "[VersionCheck]", "[embedding]") gets a colored badge, and
 * warn/error messages get their text tinted yellow/red. Installed globally
 * (rather than as an opt-in logger every call site has to adopt) so it
 * covers the ~450 existing console.* call sites — including third-party
 * output funneled through console, like the KoboldCPP managed subprocess's
 * piped stdout/stderr — without editing every one.
 *
 * picocolors auto-detects color support (NO_COLOR, FORCE_COLOR, TTY) and
 * silently no-ops on unsupported terminals or non-TTY output (piped logs,
 * a log file under a process manager), so this is safe to install
 * unconditionally on any desktop platform.
 */

type ConsoleMethod = "log" | "warn" | "error"

const TAG_PATTERN = /^\[([^\]\x1b]+)\]\s*/
const ESC = ""

const PALETTE: Array<{
	bg: (s: string) => string
	fg: (s: string) => string
}> = [
	{ bg: pc.bgRed, fg: pc.white },
	{ bg: pc.bgGreen, fg: pc.black },
	{ bg: pc.bgYellow, fg: pc.black },
	{ bg: pc.bgBlue, fg: pc.white },
	{ bg: pc.bgMagenta, fg: pc.white },
	{ bg: pc.bgCyan, fg: pc.black },
	{ bg: pc.bgBlackBright, fg: pc.white }
]

const tagColorCache = new Map<string, number>()

function colorIndexForTag(tag: string): number {
	const cached = tagColorCache.get(tag)
	if (cached !== undefined) return cached
	// Deterministic hash so the same tag always gets the same color across
	// runs/restarts, not just within one process's lifetime.
	let hash = 0
	for (let i = 0; i < tag.length; i++) {
		hash = (hash * 31 + tag.charCodeAt(i)) >>> 0
	}
	const idx = hash % PALETTE.length
	tagColorCache.set(tag, idx)
	return idx
}

function formatBadge(tag: string): string {
	const { bg, fg } = PALETTE[colorIndexForTag(tag)]
	return bg(fg(pc.bold(` ${tag} `)))
}

function tintForLevel(method: ConsoleMethod, text: string): string {
	if (method === "error") return pc.red(text)
	if (method === "warn") return pc.yellow(text)
	return text
}

function makeWrapper(
	method: ConsoleMethod,
	original: (...args: any[]) => void
) {
	return (...args: any[]) => {
		const first = args[0]
		// Only strings can be safely tag-matched/tinted — an Error, object,
		// or already-ANSI-colored string (e.g. Vite's own prefixed output)
		// passes straight through unchanged rather than risking double
		// styling or a broken match.
		if (typeof first !== "string" || first.includes(ESC)) {
			original(...args)
			return
		}
		const match = first.match(TAG_PATTERN)
		if (match) {
			const tag = match[1]
			const rest = first.slice(match[0].length)
			original(
				`${formatBadge(tag)} ${tintForLevel(method, rest)}`,
				...args.slice(1)
			)
		} else {
			original(tintForLevel(method, first), ...args.slice(1))
		}
	}
}

let installed = false

export function installPrettyConsole() {
	if (installed) return
	installed = true
	console.log = makeWrapper("log", console.log.bind(console))
	console.warn = makeWrapper("warn", console.warn.bind(console))
	console.error = makeWrapper("error", console.error.bind(console))
}
