/**
 * Sharing authored components (C6, P7): the pure half of the import dialog
 * and of Export.
 *
 * What arrives is one of two things. A **share file** — the `component@1`
 * envelope, `<slug>.component.json` — or **one bare source file** (a
 * `.svelte`, `.ts` or `.js`), picked, dropped or pasted, which imports as a
 * component of one file named after it. Either way the server is given the
 * file's text and its name (`{ text, filename }`) and does all the judging;
 * the checks here only spare a round trip (the size cap, the file type).
 *
 * Nothing is stored until the admin has seen the preview
 * (`components:importPreview`) and confirmed (`components:import`). The
 * preview's summary becomes sentences here — how it will run on this
 * instance, whether the compiled module it carries verifies, whether it
 * imports under another slug — so the dialog only lays them out.
 *
 * The replies reach every tab of this admin that declared the verb, so the
 * dialog takes one only while it is waiting for it: {@link onPreviewReply}
 * and {@link onImportReply} return `null` for a reply nobody here asked for.
 */
import { coreDrift, type CoreDrift } from "./editorState"
import { errorPlace } from "./compileErrors"

/** The client's cap on what it sends, whole — the server's share-file limit (it stays authoritative). */
export const SHARE_CLIENT_MAX_BYTES = 4 * 1024 * 1024

/** What kind of file a name is, for importing: a share file, one bare source file, or neither. */
export type ShareFileKind = "share-file" | "source-file"

export function shareFileKind(filename: string): ShareFileKind | null {
	const base = (filename ?? "").split(/[\\/]/).pop() ?? ""
	if (/\.json$/i.test(base)) return "share-file"
	if (/\.(svelte|ts|js)$/i.test(base)) return "source-file"
	return null
}

/** The `accept` list for the file picker. */
export const SHARE_FILE_ACCEPT = ".json,.svelte,.ts,.js,application/json,text/javascript"

/** What `components:importPreview` / `components:import` are sent. */
export interface ShareInput {
	text: string
	filename: string
}

export type ShareInputResult = { ok: true; input: ShareInput } | { ok: false; problem: string }

const byteLength = (text: string) => new TextEncoder().encode(text).length

const mib = (bytes: number) => `${(bytes / (1024 * 1024)).toFixed(1)} MiB`

/** A size a person reads: `812 B`, `3.4 KB`, `1.2 MiB`. */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return ""
	if (bytes < 1024) return `${bytes} B`
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
	return mib(bytes)
}

const tooBig = (bytes: number) =>
	`That file is ${mib(bytes)}. A share file can be at most ${mib(SHARE_CLIENT_MAX_BYTES)}.`

const wrongType = (name: string) =>
	`${name ? `"${name}" is` : "That is"} not a file this can import. Pick a .component.json share file, or one .svelte, .ts or .js file.`

/** Just the size and type — before reading a picked or dropped file's text. */
export function fileProblem(file: { name: string; size: number }): string | null {
	if (!shareFileKind(file.name)) return wrongType(file.name)
	if (file.size > SHARE_CLIENT_MAX_BYTES) return tooBig(file.size)
	return null
}

/** A picked or dropped file, read: its text and name, or why it is not sent. */
export async function readShareFile(file: {
	name: string
	size: number
	text(): Promise<string>
}): Promise<ShareInputResult> {
	const problem = fileProblem(file)
	if (problem) return { ok: false, problem }
	let text: string
	try {
		text = await file.text()
	} catch {
		return { ok: false, problem: `"${file.name}" could not be read.` }
	}
	return shareInput(text, file.name)
}

/** The default name for pasted source when none is typed. */
export const PASTED_DEFAULT_NAME = "Component.svelte"

/**
 * Pasted text with the name typed beside it. A pasted share file (JSON that
 * opens with `{`) needs no name; pasted source is named by it — the name
 * says whether it is Svelte or vanilla, and names the component.
 */
export function pastedInput(text: string, filename: string): ShareInputResult {
	const name = (filename ?? "").trim()
	if (!text.trim()) return { ok: false, problem: "Paste a component's source first." }
	if (!name && /^\s*\{/.test(text)) return shareInput(text, "pasted.component.json")
	return shareInput(text, name || PASTED_DEFAULT_NAME)
}

function shareInput(text: string, filename: string): ShareInputResult {
	if (!shareFileKind(filename)) return { ok: false, problem: wrongType(filename) }
	const bytes = byteLength(text)
	if (bytes > SHARE_CLIENT_MAX_BYTES) return { ok: false, problem: tooBig(bytes) }
	return { ok: true, input: { text, filename } }
}

/* ── the preview, as sentences ─────────────────────────────────────────── */

type Summary = Sockets.Components.ImportSummary

export interface ImportSummaryView {
	/** How it will run on this instance. */
	runs: { tone: "ok" | "error"; text: string }
	/** What the file says about a compiled module, and whether it checks out. */
	verify: { tone: "ok" | "warning" | "error" | "quiet"; text: string }
	/** "`stats` is taken here, so it imports as `stats-2`" — null when the slug is free. */
	rename: string | null
	/** Its clone ancestry, and whether core's component has moved on — null when not a clone. */
	basedOn: { text: string; drift: CoreDrift } | null
	files: { path: string; size: string; entry: boolean }[]
	totalSize: string
	/** Every scope its widget asks for: all unreviewed on arrival. */
	scopes: string[]
	/** The compile here, when there is a compiler: problems with their places. */
	compile: { ok: boolean; problems: { place: string; text: string }[]; warnings: string[] } | null
	/** Whether Import can go ahead (false only when it cannot run here at all). */
	canImport: boolean
}

export const IMPORT_LANDS_TEXT =
	"It arrives switched off, and every scope it asks for waits for your review — refused until you decide."

export function importSummaryView(
	summary: Summary,
	coreComponents: readonly { slug: string; sourceHash: string }[] = []
): ImportSummaryView {
	const a = summary.artifact
	let runs: ImportSummaryView["runs"]
	if (summary.runs === "recompiled")
		runs = { tone: "ok", text: "Recompiled here from its source. This pub has a compiler, so it never runs a module built elsewhere." }
	else if (summary.runs === "carried-artifact")
		runs = { tone: "ok", text: "Runs the compiled module the file carries. This pub has no compiler to rebuild it." }
	else if (!a.carried)
		runs = {
			tone: "error",
			text: "Cannot run here. This pub has no compiler, and the file carries no compiled module."
		}
	else
		runs = {
			tone: "error",
			text: "Cannot run here. The compiled module does not match the hash it names, so it was changed after it was exported."
		}

	let verify: ImportSummaryView["verify"]
	const unused = summary.runs === "recompiled" ? " It is not used here." : ""
	if (!a.carried) verify = { tone: "quiet", text: "Source only: no compiled module." }
	else if (a.verifies)
		verify = {
			tone: summary.runs === "recompiled" ? "quiet" : "ok",
			// The toolchain is named only where it matters: when the carried build is what runs.
			text: `Carries a compiled module that matches its hash${a.fingerprint && !unused ? ` (built by ${a.fingerprint})` : ""}.${unused}`
		}
	else
		verify = {
			tone: summary.runs === "recompiled" ? "warning" : "error",
			text: `Carries a compiled module that does not match its hash.${unused}`
		}

	const rename =
		summary.importAs !== summary.slug
			? `"${summary.slug}" is taken here, so it imports as "${summary.importAs}".`
			: null

	let basedOn: ImportSummaryView["basedOn"] = null
	if (summary.basedOn) {
		const b = summary.basedOn
		const core = coreComponents.find((c) => c.slug === b.component) ?? null
		const drift = coreDrift(b, core)
		const tail =
			drift === "changed"
				? ` Core's ${b.component} here differs from the one it was cloned from.`
				: drift === "same"
					? ` Core's ${b.component} here is the one it was cloned from.`
					: core
						? ""
						: ` This pub has no core ${b.component}.`
		basedOn = { text: `Clone of core's ${b.component} (${b.version}).${tail}`, drift }
	}

	const total = summary.files.reduce((n, f) => n + f.bytes, 0)
	const compile = summary.compile
		? {
				ok: summary.compile.errors.length === 0,
				problems: summary.compile.errors.map((e) => ({ place: errorPlace(e), text: e.text })),
				warnings: [...summary.compile.warnings]
			}
		: null

	return {
		runs,
		verify,
		rename,
		basedOn,
		files: summary.files.map((f) => ({ path: f.path, size: formatBytes(f.bytes), entry: f.path === summary.entry })),
		totalSize: formatBytes(total),
		scopes: [...summary.requestedScopes],
		compile,
		canImport: summary.runs !== "refused"
	}
}

/* ── the dialog's flow ─────────────────────────────────────────────────── */

/**
 * Where the dialog is: choosing a file, waiting for the preview, showing it,
 * waiting for the import, or showing why something was refused.
 */
export type ImportPhase =
	| { kind: "choose" }
	| { kind: "previewing"; input: ShareInput }
	| { kind: "ready"; input: ShareInput; summary: Summary }
	| { kind: "importing"; input: ShareInput; summary: Summary }
	| { kind: "refused"; input: ShareInput | null; message: string }

export const CHOOSE: ImportPhase = { kind: "choose" }

/** A preview reply: the next phase, or null when this dialog did not ask for one. */
export function onPreviewReply(phase: ImportPhase, res: Sockets.Components.ImportPreview.Response): ImportPhase | null {
	if (phase.kind !== "previewing") return null
	return { kind: "ready", input: phase.input, summary: res.summary }
}

export function onPreviewError(phase: ImportPhase, res: { error?: string }): ImportPhase | null {
	if (phase.kind !== "previewing") return null
	return { kind: "refused", input: phase.input, message: res.error || "That file could not be read as a component." }
}

/** An import reply: the new component's id, or null when this dialog did not ask for one. */
export function onImportReply(
	phase: ImportPhase,
	res: Sockets.Components.Import.Response
): { id: string; label: unknown; renamedFrom?: string; compiled: boolean } | null {
	if (phase.kind !== "importing") return null
	return {
		id: res.component.id,
		label: res.component.label,
		...(res.renamedFrom ? { renamedFrom: res.renamedFrom } : {}),
		compiled: !res.compile || res.compile.errors.length === 0
	}
}

export function onImportError(phase: ImportPhase, res: { error?: string }): ImportPhase | null {
	if (phase.kind !== "importing") return null
	return { kind: "refused", input: phase.input, message: res.error || "The component could not be imported." }
}

/* ── export ────────────────────────────────────────────────────────────── */

/**
 * The download name, always `<slug>.component.json` with a safe slug —
 * whatever name the reply carried (the server sanitizes too).
 */
export function safeShareFileName(name: string | null | undefined, slug?: string): string {
	const fromName = typeof name === "string" ? name.replace(/\.component\.json$/i, "") : ""
	const stem = (fromName || slug || "")
		.toLowerCase()
		.replace(/[^a-z0-9_-]/g, "_")
		.replace(/^[_-]+/, "")
		.slice(0, 64)
	return `${stem || "component"}.component.json`
}

/** Save an export reply as a file (the browser's download). */
export function downloadShareFile(res: Sockets.Components.Export.Response): void {
	const blob = new Blob([JSON.stringify(res.envelope, null, 2)], { type: "application/json" })
	const url = URL.createObjectURL(blob)
	const a = document.createElement("a")
	a.href = url
	a.download = safeShareFileName(res.filename, res.envelope?.component?.slug)
	document.body.appendChild(a)
	a.click()
	a.remove()
	URL.revokeObjectURL(url)
}
