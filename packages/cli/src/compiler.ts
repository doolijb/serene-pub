/**
 * The packager (04 §5a, U24b).
 *
 * Two halves, and the split is a law rather than a convenience:
 *
 * **Static.** Hooks, components, settings and permissions are extracted by walking the
 * TypeScript AST — *without executing the author's code*. "Hooks are never discovered at
 * runtime" (13/§30), so a registration built by a loop or a variable is a **lint error,
 * never a silent omission**. The manifest has to be a complete statement of what a plugin
 * can do, or the permission model is a guess and the audit screen is fiction.
 *
 * **Evaluated.** Pipelines are compiled by building the spec value and projecting it to a
 * document. That is allowed: F6 says *SP* never evaluates a builder chain — "no importer
 * path evaluates a builder chain" — not that the author's own build tool doesn't. SP
 * imports the document. This is where the document comes from.
 *
 * The line matters because it decides what an attacker can do. A malicious plugin can run
 * whatever it likes on the author's machine at build time; it cannot make SP run anything
 * at install time, because install reads documents and a manifest, both of which are data.
 */

import type { Extension } from '@serene-pub/sdk'
import type { SpecDocument } from '@serene-pub/sdk'
import { compile } from '@serene-pub/sdk'
import { summarizeType, type TypeSummary } from './codegen.js'

// ── Findings ────────────────────────────────────────────────────────────────

export interface CompileFinding {
	severity: 'error' | 'warning'
	file: string
	line: number
	code: string
	message: string
	/** Required on every error — a prohibition without an alternative is a bug (15 §1.3). */
	fix: string
}

// ── The manifest ────────────────────────────────────────────────────────────

export interface Manifest {
	schemaVersion: 1
	slug: string
	name: string
	version: string
	description?: string
	engines?: Record<string, string>
	/** Node types this plugin registers, summarized for the audit screen (10 §10.2). */
	types: TypeSummary[]
	hooks: {
		pipeline: Array<{ typeId: string; visibility: 'private' | 'public'; runtime: 'node' | 'process' }>
		lifecycle: Array<{ moment: string; cadence?: string }>
		event: Array<{ event: string }>
	}
	components: Array<{ surface: string; slug: string; framework: string; entry: string }>
	settings?: Record<string, unknown>
	/** Pipelines shipped, by identity — the documents travel beside the manifest. */
	pipelines: Array<{ id: string; version: string; nodes: number; presets: string[] }>
	/**
	 * **Compiled from usage, never declared.** An author cannot over-request, and cannot
	 * under-declare either — the audit screen shows what the code can actually reach.
	 */
	permissions: string[]
	peerTypes: string[]
}

export interface CompileResult {
	manifest?: Manifest
	documents: SpecDocument[]
	findings: CompileFinding[]
	ok: boolean
}

// ── Static extraction ───────────────────────────────────────────────────────

/** Calls whose arguments must be written out, and why a computed one is refused. */
const MUST_BE_STATIC: Record<string, string> = {
	defineExtension: 'the manifest is built from this call without running it',
	pipelineHook: 'a hook assembled at runtime cannot appear in the manifest, so it could never be permitted',
	lifecycleHook: 'lifecycle moments are fixed; a computed one cannot be audited',
	eventHook: 'an event subscription nobody can see is a side effect nobody consented to',
	component: 'surfaces are declared so core can render them without loading your code',
	defineSettings: 'core renders the form from this, and validates against it on save',
}

/** Injected-surface calls that map to a permission. Compiled from usage (F10, U10). */
const PERMISSION_CALLS: Record<string, string> = {
	readCore: 'core:read',
	read: 'core:read',
	readOwnRows: 'plugin:data.read',
	writeOwnRows: 'plugin:data.write',
	commit: 'core:write',
	emit: 'socket:emit',
	call: 'provider:call',
}

/**
 * Blank out comments and string bodies, **preserving length and newlines**, so indices
 * still map to the original text and a brace inside a string cannot confuse the matcher.
 */
function blankNonCode(text: string): string {
	const out = text.split('')
	let i = 0
	const blank = (from: number, to: number) => {
		for (let k = from; k < to && k < out.length; k++) if (out[k] !== '\n') out[k] = ' '
	}
	while (i < text.length) {
		const c = text[i]
		const next = text[i + 1]
		if (c === '/' && next === '/') {
			const end = text.indexOf('\n', i)
			blank(i, end === -1 ? text.length : end)
			i = end === -1 ? text.length : end
		} else if (c === '/' && next === '*') {
			const end = text.indexOf('*/', i + 2)
			blank(i, end === -1 ? text.length : end + 2)
			i = end === -1 ? text.length : end + 2
		} else if (c === "'" || c === '"' || c === '`') {
			const quote = c
			let j = i + 1
			while (j < text.length) {
				if (text[j] === '\\') {
					j += 2
					continue
				}
				if (text[j] === quote) break
				j++
			}
			blank(i, Math.min(j + 1, text.length))
			i = j + 1
		} else {
			i++
		}
	}
	return out.join('')
}

const lineAt = (text: string, index: number) => text.slice(0, index).split('\n').length

/** Index just past the `)` matching the `(` at `open`. Operates on blanked code. */
function matchParen(code: string, open: number): number {
	let depth = 0
	for (let i = open; i < code.length; i++) {
		const c = code[i]
		if (c === '(' || c === '[' || c === '{') depth++
		else if (c === ')' || c === ']' || c === '}') {
			depth--
			if (depth === 0) return i
		}
	}
	return -1
}

function topLevelSplit(code: string, from: number, to: number): Array<{ start: number; end: number }> {
	const parts: Array<{ start: number; end: number }> = []
	let depth = 0
	let start = from
	for (let i = from; i < to; i++) {
		const c = code[i]
		if (c === '(' || c === '[' || c === '{') depth++
		else if (c === ')' || c === ']' || c === '}') depth--
		else if (c === ',' && depth === 0) {
			parts.push({ start, end: i })
			start = i + 1
		}
	}
	if (code.slice(start, to).trim()) parts.push({ start, end: to })
	return parts
}

/**
 * Is this argument written out, rather than computed?
 *
 * A function body is fine — that is the handler, and the packager never reads inside it.
 * What is refused is a *declaration* the packager cannot see: a spread, a ternary, or a
 * template literal standing in for an id.
 */
function isWrittenOut(raw: string, blanked: string): boolean {
	const t = blanked.trim()
	const r = raw.trim()
	// The scanner blanks string bodies so that a call written inside a comment or a string
	// cannot be mistaken for a real one — which means a *legitimate* quoted argument also
	// blanks to nothing. `eventHook('core:event/chat-created@1', h)` is the most written-out
	// form there is, so emptiness only means "computed" when the raw text was not a literal.
	const quoted = /^['"`]/.test(r)
	if (!t && !quoted) return false
	if (r.startsWith('...')) return false
	if (t.startsWith('...')) return false
	// A top-level ternary or concatenation means the value depends on something.
	let depth = 0
	for (let i = 0; i < t.length; i++) {
		const c = t[i]
		if (c === '(' || c === '[' || c === '{') depth++
		else if (c === ')' || c === ']' || c === '}') depth--
		else if (depth === 0 && (c === '?' || c === '+')) {
			// `?.` and `??` are not ternaries; `=>` bodies are fine.
			if (c === '?' && (t[i + 1] === '.' || t[i + 1] === '?')) continue
			if (c === '+' && t[i + 1] === '+') continue
			return false
		}
	}
	// A template literal used as a value: blanked to spaces, so the raw tells us.
	if (/^`/.test(raw.trim()) && raw.includes('${')) return false
	return true
}

export interface StaticScan {
	findings: CompileFinding[]
	permissions: string[]
	/** Declaration call sites found, for cross-checking against the evaluated module. */
	declared: { extensions: number; pipelineHooks: number; lifecycleHooks: number; eventHooks: number; components: number }
}

/**
 * Walk source text. **Never evaluates.**
 *
 * ⚠ This is a lexical scanner, not a parser. It is dependency-free and version-stable,
 * which is right for a draft, and it will miss things a real AST would catch — an
 * identifier named `component` used for something else, for one. **Core should swap in a
 * proper parser**; the interface is the part that matters, and the findings it produces
 * are the contract.
 */
export function scanSource(files: Array<{ path: string; text: string }>): StaticScan {
	const findings: CompileFinding[] = []
	const permissions = new Set<string>()
	const declared = { extensions: 0, pipelineHooks: 0, lifecycleHooks: 0, eventHooks: 0, components: 0 }

	for (const f of files) {
		const code = blankNonCode(f.text)

		for (const name of Object.keys(MUST_BE_STATIC)) {
			const re = new RegExp(`(?<![\\w.$])${name}\\s*\\(`, 'g')
			let m: RegExpExecArray | null
			while ((m = re.exec(code))) {
				const open = code.indexOf('(', m.index)
				const close = matchParen(code, open)
				if (close === -1) continue
				if (name === 'defineExtension') declared.extensions++
				if (name === 'pipelineHook') declared.pipelineHooks++
				if (name === 'lifecycleHook') declared.lifecycleHooks++
				if (name === 'eventHook') declared.eventHooks++
				if (name === 'component') declared.components++

				for (const [i, part] of topLevelSplit(code, open + 1, close).entries()) {
					if (isWrittenOut(f.text.slice(part.start, part.end), code.slice(part.start, part.end))) continue
					findings.push({
						severity: 'error',
						file: f.path,
						line: lineAt(f.text, m.index),
						code: 'E_DYNAMIC_DECLARATION',
						message: `${name}() argument ${i + 1} is computed, not written out`,
						fix:
							`write the value literally at the call site — ${MUST_BE_STATIC[name]}. ` +
							`A registration the packager cannot read is one core can never permit, so this ` +
							`is an error rather than a silent omission (13/§30).`,
					})
				}
			}
		}

		for (const [call, perm] of Object.entries(PERMISSION_CALLS)) {
			if (new RegExp(`\\.\\s*${call}\\s*\\(`).test(code)) permissions.add(perm)
		}

		// A hook reaching for the network directly walks around the kind boundary: a Query
		// may not reach the network at all (16 §1), and a Provider reaches it through its
		// injected `call`, never `fetch`.
		const fetchAt = new RegExp(`(?<![\\w.$])fetch\\s*\\(`, 'g')
		let fm: RegExpExecArray | null
		while ((fm = fetchAt.exec(code))) {
			findings.push({
				severity: 'error',
				file: f.path,
				line: lineAt(f.text, fm.index),
				code: 'E_DIRECT_NETWORK',
				message: 'a hook calls fetch() directly',
				fix:
					'cross the network from a Provider, through the injected `ctx.call` — that is what gets the ' +
					'call a receipt, a budget, a timeout and the review gate. A Query may not reach the network ' +
					'at all (16 §1).',
			})
		}
	}

	return { findings, permissions: [...permissions].sort(), declared }
}

// ── Assembly ────────────────────────────────────────────────────────────────

export interface CompileInput {
	/** Source files, for the static half. */
	sources: Array<{ path: string; text: string }>
	/** The evaluated extension, for the pipeline half. */
	extension?: Extension
}

/**
 * Produce the manifest and the pipeline documents.
 *
 * Cross-checks the two halves against each other: if the AST found three hooks and the
 * evaluated module exposes two, something is being registered conditionally, and the
 * manifest would understate what the plugin can do.
 */
export function compilePlugin(input: CompileInput): CompileResult {
	const scan = scanSource(input.sources)
	const findings = [...scan.findings]
	const e = input.extension

	if (!e) {
		findings.push({
			severity: 'error',
			file: input.sources[0]?.path ?? '(none)',
			line: 1,
			code: 'E_NO_EXTENSION',
			message: 'no extension was produced by the entry module',
			fix: 'export the result of defineExtension({ … }) as the default export of your entry file',
		})
		return { documents: [], findings, ok: false }
	}

	const pipelineHooks = (e.hooks ?? []).filter((h) => h.__decl === 'pipeline-hook') as any[]
	const lifecycle = (e.hooks ?? []).filter((h) => h.__decl === 'lifecycle-hook') as any[]
	const events = (e.hooks ?? []).filter((h) => h.__decl === 'event-hook') as any[]

	const mismatch = (kind: string, statically: number, evaluated: number) => {
		if (statically === evaluated || statically === 0) return
		findings.push({
			severity: 'error',
			file: input.sources[0]?.path ?? '(none)',
			line: 1,
			code: 'E_CONDITIONAL_REGISTRATION',
			message: `${statically} ${kind} declaration(s) in the source, ${evaluated} in the built extension`,
			fix:
				'register every hook unconditionally at module scope. A hook behind an `if` is absent from ' +
				'the manifest on some machines and present on others, so the audit screen stops being true.',
		})
	}
	mismatch('pipelineHook', scan.declared.pipelineHooks, pipelineHooks.length)
	mismatch('lifecycleHook', scan.declared.lifecycleHooks, lifecycle.length)
	mismatch('eventHook', scan.declared.eventHooks, events.length)
	mismatch('component', scan.declared.components, (e.components ?? []).length)

	const documents: SpecDocument[] = []
	for (const p of e.pipelines ?? []) {
		try {
			documents.push(compile(p))
		} catch (err) {
			findings.push({
				severity: 'error',
				file: input.sources[0]?.path ?? '(none)',
				line: 1,
				code: 'E_SPEC_COMPILE',
				message: `pipeline '${p.id}' did not compile: ${(err as Error).message}`,
				fix: 'fix the spec so it publishes — the error above names the law it violates',
			})
		}
	}

	// Subscriptions are a permission surface: a pipeline that runs on every message is a
	// side effect a user consents to (11 §4), so it belongs in the manifest.
	const permissions = new Set(scan.permissions)
	for (const p of e.pipelines ?? []) for (const s of p.subscribes) permissions.add(`event:${s}`)
	for (const h of events) permissions.add(`event:${h.event}`)

	const manifest: Manifest = {
		schemaVersion: 1,
		slug: e.slug,
		name: e.name,
		version: e.version,
		description: e.description,
		engines: e.engines as Record<string, string> | undefined,
		types: pipelineHooks.map((h) => summarizeType(h.type)),
		hooks: {
			pipeline: pipelineHooks.map((h) => ({
				typeId: h.type.id,
				visibility: h.visibility,
				runtime: h.runtime ?? 'node',
			})),
			lifecycle: lifecycle.map((h) => ({ moment: h.moment, cadence: h.cadence })),
			event: events.map((h) => ({ event: h.event })),
		},
		components: (e.components ?? []).map((c) => ({
			surface: c.surface,
			slug: c.slug,
			framework: c.framework,
			entry: c.entry,
		})),
		settings: e.settings?.schema as Record<string, unknown> | undefined,
		pipelines: documents.map((d) => ({
			id: d.id,
			version: d.version,
			nodes: d.nodes.length,
			presets: (d.presets ?? []).map((p) => p.slug),
		})),
		permissions: [...permissions].sort(),
		peerTypes: (e.peerTypes ?? []).slice().sort(),
	}

	const ok = !findings.some((f) => f.severity === 'error')
	return { manifest: ok ? manifest : undefined, documents, findings, ok }
}

export function renderFindings(findings: CompileFinding[]): string {
	if (!findings.length) return 'compiled cleanly'
	return findings
		.map((f) => `${f.severity === 'error' ? '✗' : '⚠'} ${f.file}:${f.line}  [${f.code}] ${f.message}\n    → ${f.fix}`)
		.join('\n')
}

/**
 * The install-time counterpart to "permissions are compiled from usage": what a plugin
 * says it *cannot* do. Generated, so it cannot flatter (U32).
 */
export function cannotDo(m: Manifest): string[] {
	const has = (p: string) => m.permissions.includes(p)
	const out: string[] = []
	if (!has('core:write')) out.push('cannot write to any of your data')
	if (!has('core:read')) out.push('cannot read your chats, characters or messages')
	if (!has('provider:call')) out.push('cannot call a model or reach any external service')
	if (!m.hooks.event.length && !m.permissions.some((p) => p.startsWith('event:')))
		out.push('cannot run in response to anything you do')
	if (!m.components.length) out.push('cannot render anything in the interface')
	if (!m.hooks.lifecycle.some((h) => h.cadence)) out.push('cannot run on a schedule')
	return out
}
