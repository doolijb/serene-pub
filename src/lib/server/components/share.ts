/**
 * **Component share files** (C6, P4): an authored component as one JSON file
 * another instance can import — the `component@1` envelope.
 *
 * ```json
 * {
 *   "serenePub": "component@1",
 *   "component": { "slug", "label", "framework", "entry", "basedOn"? },
 *   "widget":    { "title", "icon"?, "scopes"?, "reads"?, … },
 *   "files":     { "<relative path>": "<source>" },
 *   "artifact":  { "code", "hash", "fingerprint" }   // when it was compiled
 * }
 * ```
 *
 * The source always travels; the compiled module (the artifact) travels too
 * when there is one, for the instances that have no compiler (Android, owner
 * ruling 2026-09-25). An instance WITH a compiler never runs the carried
 * artifact: it recompiles from the source under its own allowlist. One
 * without runs it only when its bytes hash to the hash it names — and in the
 * sandbox, with every requested scope unreviewed until an admin reviews.
 *
 * A single bare source file (a `.svelte`, `.ts` or `.js`) is also accepted:
 * it is a component of one file, named after the file.
 *
 * Everything that arrives is refused in words when it is not exactly this:
 * the whole file is at most {@link SHARE_FILE_MAX_BYTES}, the files keep to
 * the compiler's own path grammar and limits (`authoredComponentFindings`),
 * and an artifact is text of at most the compiler's output limit, with a
 * SHA-256 hash.
 */
import { createHash } from "node:crypto"
import { COMPONENT_COMPILE_LIMITS, isSafeComponentPath } from "@serene-pub/cli/component-source"
import type { AuthoredWidgetShape } from "$lib/server/db/schema"
import {
	authoredComponentFindings,
	type AuthoredComponentContent,
	type AuthoredComponentRow,
	type AuthoredFramework
} from "./store"

/** The envelope's format tag. */
export const COMPONENT_SHARE_FORMAT = "component@1"

/** The largest share file accepted, whole (source + artifact + JSON). */
export const SHARE_FILE_MAX_BYTES = 4 * 1024 * 1024

export interface ComponentShareArtifact {
	/** The compiled module. */
	code: string
	/** SHA-256 of `code`, hex. */
	hash: string
	/** The toolchain fingerprint that built it. */
	fingerprint: string
}

export interface ComponentShareFile {
	serenePub: typeof COMPONENT_SHARE_FORMAT
	component: {
		slug: string
		label: AuthoredComponentContent["label"]
		framework: AuthoredFramework
		entry: string
		basedOn?: { component: string; version: string; sourceHash?: string }
	}
	widget: AuthoredWidgetShape
	files: Record<string, string>
	artifact?: ComponentShareArtifact
}

/** A share file that cannot be imported; `findings` are sentences, one per fault. */
export class ComponentShareRefused extends Error {
	constructor(readonly findings: string[]) {
		super(`that is not a component share file this pub can import: ${findings.join("; ")}`)
		this.name = "ComponentShareRefused"
	}
}

const sha256 = (code: string) => createHash("sha256").update(code, "utf8").digest("hex")
const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

/** The envelope for a stored component; `artifact` when its compiled module is in hand. */
export function componentShareFile(row: AuthoredComponentRow, artifactCode?: string | null): ComponentShareFile {
	const out: ComponentShareFile = {
		serenePub: COMPONENT_SHARE_FORMAT,
		component: {
			slug: row.slug,
			label: row.label,
			framework: row.framework as AuthoredFramework,
			entry: row.entry,
			...(row.basedOn ? { basedOn: row.basedOn } : {})
		},
		widget: row.widget,
		files: row.files
	}
	if (artifactCode && row.artifactHash && row.fingerprint)
		out.artifact = { code: artifactCode, hash: row.artifactHash, fingerprint: row.fingerprint }
	return out
}

/** A download name that is always safe: `<slug>.component.json`. */
export const shareFileName = (slug: string): string =>
	`${slug.replace(/[^a-z0-9_-]/g, "_").slice(0, 64) || "component"}.component.json`

/** What an import offers: the source as content, and the carried artifact (checked only for shape here). */
export interface ParsedShareFile {
	content: AuthoredComponentContent
	artifact?: ComponentShareArtifact
	/** True when it arrived as one bare source file rather than an envelope. */
	singleFile: boolean
}

/** What `components:importPreview` / `components:import` receive. */
export interface ShareInput {
	/** The envelope as parsed JSON. */
	envelope?: unknown
	/** Or the file's text: an envelope as JSON, or one bare source file. */
	text?: string
	/** The file's name — required for a bare source file (it names the component and its framework). */
	filename?: string
}

/**
 * Parse and validate what arrived — never partly: anything wrong refuses the
 * whole file with {@link ComponentShareRefused}, naming every fault.
 */
export function parseComponentShare(input: ShareInput): ParsedShareFile {
	let raw: unknown
	if (input.envelope !== undefined) {
		let size: number
		try {
			size = Buffer.byteLength(JSON.stringify(input.envelope) ?? "", "utf8")
		} catch {
			throw new ComponentShareRefused(["the envelope is not plain JSON"])
		}
		if (size > SHARE_FILE_MAX_BYTES) throw new ComponentShareRefused([tooBig(size)])
		raw = input.envelope
	} else if (typeof input.text === "string") {
		const size = Buffer.byteLength(input.text, "utf8")
		if (size > SHARE_FILE_MAX_BYTES) throw new ComponentShareRefused([tooBig(size)])
		const name = typeof input.filename === "string" ? input.filename : ""
		if (/\.(svelte|ts|js)$/i.test(name) && !/\.json$/i.test(name)) return singleFile(input.text, name)
		try {
			raw = JSON.parse(input.text)
		} catch {
			throw new ComponentShareRefused([
				"the file is neither JSON nor a single .svelte, .ts or .js source file (name it so to import one)"
			])
		}
	} else throw new ComponentShareRefused(["nothing arrived — send a share file's text, or its envelope"])
	return envelope(raw)
}

const tooBig = (size: number) => `the file is ${size} bytes, over the ${SHARE_FILE_MAX_BYTES}-byte limit for a share file`

function singleFile(text: string, filename: string): ParsedShareFile {
	const base = filename.split(/[\\/]/).pop() ?? ""
	if (!isSafeComponentPath(base))
		throw new ComponentShareRefused([`${JSON.stringify(base)} is not a component file name (letters, digits, '_', '-', '.', ending .svelte, .ts or .js)`])
	const stem = base.replace(/\.(svelte|ts|js)$/i, "").replace(/\.svelte$/i, "")
	const slug =
		stem
			.toLowerCase()
			.replace(/[^a-z0-9_-]+/g, "-")
			.replace(/^-+|-+$/g, "")
			.slice(0, 64) || "component"
	const framework: AuthoredFramework = /\.svelte$/i.test(base) ? "svelte" : "vanilla"
	const content: AuthoredComponentContent = {
		slug,
		label: stem || slug,
		framework,
		entry: base,
		files: { [base]: text },
		widget: { title: stem || slug }
	}
	const findings = authoredComponentFindings(content)
	if (findings.length) throw new ComponentShareRefused(findings)
	return { content, singleFile: true }
}

function envelope(raw: unknown): ParsedShareFile {
	if (!isPlainObject(raw) || raw.serenePub !== COMPONENT_SHARE_FORMAT)
		throw new ComponentShareRefused([
			`expected a component share file: { serenePub: "${COMPONENT_SHARE_FORMAT}", component, widget, files, artifact? }`
		])
	const findings: string[] = []
	const c = raw.component
	if (!isPlainObject(c)) findings.push("component must be { slug, label, framework, entry, basedOn? }")
	const comp = isPlainObject(c) ? c : {}
	const content = {
		slug: comp.slug,
		label: comp.label,
		framework: comp.framework,
		entry: comp.entry,
		files: raw.files,
		widget: raw.widget,
		...(comp.basedOn != null ? { basedOn: comp.basedOn } : {})
	} as AuthoredComponentContent
	findings.push(...authoredComponentFindings(content))

	let artifact: ComponentShareArtifact | undefined
	if (raw.artifact !== undefined && raw.artifact !== null) {
		const a = raw.artifact
		if (!isPlainObject(a) || typeof a.code !== "string" || typeof a.hash !== "string" || typeof a.fingerprint !== "string")
			findings.push("artifact must be { code, hash, fingerprint }, all text")
		else if (!/^[a-f0-9]{64}$/.test(a.hash)) findings.push("artifact.hash must be a SHA-256, 64 hex characters")
		else if (Buffer.byteLength(a.code, "utf8") > COMPONENT_COMPILE_LIMITS.outputBytes)
			findings.push(`artifact.code is over the ${COMPONENT_COMPILE_LIMITS.outputBytes}-byte limit for a compiled module`)
		else artifact = { code: a.code, hash: a.hash, fingerprint: a.fingerprint }
	}
	if (findings.length) throw new ComponentShareRefused(findings)
	return { content, ...(artifact ? { artifact } : {}), singleFile: false }
}

/** Whether a carried artifact's bytes are the module its hash names. */
export const artifactVerifies = (a: ComponentShareArtifact): boolean => sha256(a.code) === a.hash
