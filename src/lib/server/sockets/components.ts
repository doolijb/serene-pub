/**
 * Admin socket API for **authored components** (C6, P4): read core's
 * components, clone one, write one from blank, save, preview, switch on and
 * off, review its scopes, delete, and share it as a `component@1` file.
 *
 * Two gates on every verb, before anything is read: the caller is an admin,
 * and the extension subsystem is on (`SP_PLUGINS_ENABLED`, owner ruling Q7).
 * A refusal is `components:<verb>:error` with a sentence; a reply is
 * `components:<verb>`.
 *
 * - **A clone is always a new widget** (owner ruling Q2): `authored.<id>:<slug>`,
 *   under its own owner, never standing in for core's. `messages` is
 *   view-only (Q3) — its source is readable, never cloned.
 * - **Authoring needs a compiler.** Create, clone, save and preview refuse on
 *   an instance without one (Android, by ruling), in words, before anything
 *   is stored; such an instance runs authored components only from share
 *   files that carry their compiled module.
 * - **Import never trusts a carried module where it can rebuild it**: with a
 *   compiler the source is recompiled under this instance's allowlist and the
 *   carried artifact ignored; without one the artifact is used only when its
 *   bytes hash to the hash it names. Either way the requested scopes arrive
 *   unreviewed, and the component arrives switched off.
 * - **A broken save never breaks a working widget** (owner ruling
 *   2026-09-26): a save whose source does not compile, on a component that
 *   has a saved version, is kept as its **component draft** — the saved
 *   version, its compiled module and every session drawing it untouched — and
 *   `components:revertDraft` discards it. A component that has never compiled
 *   stores the broken source as its source and stays not offered.
 * - **Every change is announced** — `components:changed { id, ownerId, src }`
 *   to every socket that declared it (`emitToInterested`), any user's, so a
 *   session page drawing the widget can reload it. Never the source.
 */
import { db } from "$lib/server/db"
import type { Handler } from "$lib/shared/events"
import { pluginsEnabled } from "$lib/server/plugins/flag"
import { needsReview } from "$lib/server/plugins/permissions"
import { authoredOwnerId } from "$lib/shared/widgets/authoredOwner"
import { emitToInterested } from "./utils/broadcastHelpers"
import {
	AuthoredComponentConflict,
	AuthoredComponentInvalid,
	AuthoredComponentMissing,
	asWidgetManifest,
	authoredComponentFindings,
	authoredScopeStates,
	componentDraftOf,
	createAuthoredComponent,
	deleteAuthoredComponent,
	getAuthoredComponent,
	hasSavedVersion,
	listAuthoredComponents,
	recordAuthoredCompile,
	revertComponentDraft,
	reviewAuthoredScopes,
	saveComponentDraft,
	setAuthoredComponentEnabled,
	updateAuthoredComponent,
	type AuthoredComponentContent,
	type AuthoredComponentRow
} from "$lib/server/components/store"
import {
	ComponentCompilerUnavailable,
	compileAndRecord,
	componentCompilerAvailability,
	previewCompile,
	type ComponentCompileOutcome
} from "$lib/server/components/compile"
import { readArtifact, removeArtifacts, writeArtifact } from "$lib/server/components/cache"
import { componentSourceHash } from "@serene-pub/cli/component-source"
import { authoredWidgetId, offeredAuthoredSrc } from "$lib/server/components/offer"
import { authoredComponentRefusal } from "$lib/server/components/compat"
import { mintComponentPreview } from "$lib/server/components/preview"
import { coreComponentList, coreComponentSource, coreWidgetShape, isCloneableCoreComponent } from "$lib/server/components/core"
import {
	ComponentShareRefused,
	artifactVerifies,
	componentShareFile,
	parseComponentShare,
	shareFileName,
	type ParsedShareFile
} from "$lib/server/components/share"

type Emit = (event: string, data: any) => void

/** A refusal in words — the verb's own `:error`, never the generic fallback. */
export class ComponentRefusal extends Error {
	constructor(message: string) {
		super(message)
		this.name = "ComponentRefusal"
	}
}

export const COMPONENTS_ADMIN_ONLY = "Access denied. Only admin users can manage components."
export const COMPONENTS_SUBSYSTEM_OFF =
	"Authored components are part of the extension subsystem, which is off on this instance — set SP_PLUGINS_ENABLED to use them."

const noCompiler = (reason: string) => `This instance has no component compiler: ${reason}.`

/** The one sentence an error becomes. */
function refusalText(e: unknown): string {
	if (e instanceof ComponentRefusal || e instanceof AuthoredComponentConflict || e instanceof AuthoredComponentMissing)
		return e.message
	if (e instanceof AuthoredComponentInvalid) return `The component was refused: ${e.findings.join("; ")}.`
	if (e instanceof ComponentShareRefused) return `That share file was refused: ${e.findings.join("; ")}.`
	if (e instanceof ComponentCompilerUnavailable) return noCompiler(e.reason)
	console.error("[components]", e)
	return "The component request failed — the server log has the details."
}

/**
 * One verb: the two gates, then `run`; its result is the reply, anything it
 * throws the refusal. Never throws itself, so the generic error fallback in
 * `register` never speaks over a sentence.
 */
function verb<P, R>(
	decl: { event: string },
	run: (socket: any, params: P, emitToUser: Emit) => Promise<R>
): Handler<P, R | Sockets.ErrorResponse> {
	const event = decl.event
	return {
		event,
		handler: async (socket, params, emitToUser) => {
			const gate = !socket?.user?.isAdmin ? COMPONENTS_ADMIN_ONLY : !pluginsEnabled() ? COMPONENTS_SUBSYSTEM_OFF : null
			if (gate) {
				const res = { error: gate }
				emitToUser(`${event}:error`, res)
				return res
			}
			try {
				const res = await run(socket, (params ?? {}) as P, emitToUser)
				emitToUser(event, res)
				return res
			} catch (e) {
				const res = { error: refusalText(e) }
				emitToUser(`${event}:error`, res)
				return res
			}
		}
	}
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

function requireCompiler(): void {
	const a = componentCompilerAvailability()
	if (!a.available) throw new ComponentCompilerUnavailable(a.reason)
}

async function mustGet(id: unknown): Promise<AuthoredComponentRow> {
	if (typeof id !== "string") throw new ComponentRefusal("Name the component by its id.")
	const row = await getAuthoredComponent(db, id)
	if (!row) throw new AuthoredComponentMissing(id)
	return row
}

function stamp(v: unknown): Date {
	const d = typeof v === "string" ? new Date(v) : null
	if (!d || Number.isNaN(d.getTime()))
		throw new ComponentRefusal("expectedUpdatedAt must be the updatedAt you read, as it was sent (an ISO timestamp).")
	return d
}

function summary(row: AuthoredComponentRow): Sockets.Components.Summary {
	return {
		id: row.id,
		ownerId: authoredOwnerId(row.id),
		widgetId: authoredWidgetId(row.id, row.slug),
		slug: row.slug,
		label: row.label,
		framework: row.framework as Sockets.Components.Framework,
		entry: row.entry,
		basedOn: row.basedOn ?? null,
		sourceHash: row.sourceHash,
		artifactHash: row.artifactHash,
		fingerprint: row.fingerprint,
		lastError: row.lastError,
		enabled: row.enabled,
		needsReview: needsReview(asWidgetManifest(row.widget) as never, row.adminDenied),
		src: offeredAuthoredSrc(row),
		refusal: authoredComponentRefusal(row.fingerprint) ?? null,
		hasComponentDraft: componentDraftOf(row) !== null,
		updatedAt: row.updatedAt.toISOString(),
		createdAt: row.createdAt.toISOString()
	}
}

function detail(row: AuthoredComponentRow): Sockets.Components.Detail {
	const draft = componentDraftOf(row)
	return {
		...summary(row),
		files: row.files,
		widget: row.widget as Sockets.Components.Widget,
		scopes: authoredScopeStates(row) as Sockets.Plugins.PermState[],
		componentDraft: draft && { ...draft, updatedAt: draft.updatedAt.toISOString() }
	}
}

async function fresh(id: string): Promise<Sockets.Components.Detail> {
	return detail(await mustGet(id))
}

const outcome = (o: ComponentCompileOutcome): Sockets.Components.CompileOutcome => ({
	errors: o.errors,
	warnings: o.warnings,
	artifactHash: o.errors.length || !o.hash ? null : o.hash,
	fingerprint: o.fingerprint
})

/** `components:changed` to every socket that declared it. Never the source. */
function announce(socket: any, row: Pick<AuthoredComponentRow, "id" | "enabled" | "artifactHash" | "lastError" | "fingerprint"> | { id: string; gone: true }): void {
	const io = socket?.io
	if (!io?.sockets?.sockets) return
	const payload: Sockets.Components.Changed.Response = {
		id: row.id,
		ownerId: authoredOwnerId(row.id),
		src: "gone" in row ? null : offeredAuthoredSrc(row)
	}
	try {
		emitToInterested(io, "components:changed", payload)
	} catch (e) {
		console.warn("[components] components:changed not sent:", e)
	}
}

/** `base`, or `base-2`, `base-3`… — the first slug no authored component holds. */
async function freeSlug(base: string): Promise<string> {
	const taken = new Set((await listAuthoredComponents(db)).map((r) => r.slug))
	const stem = base.slice(0, 60)
	let candidate = base
	for (let n = 2; taken.has(candidate); n++) candidate = `${stem}-${n}`
	return candidate
}

/** Compile and record right after a write; the outcome for the reply. */
async function compileNow(id: string): Promise<Sockets.Components.CompileOutcome> {
	const r = await compileAndRecord(db, id)
	return outcome(r.outcome)
}

/* ── the blank component ─────────────────────────────────────────────────── */

function blankFiles(framework: Sockets.Components.Framework): { files: Record<string, string>; entry: string } {
	if (framework === "vanilla")
		return {
			entry: "widget.ts",
			files: {
				"widget.ts": `import { defineComponent } from '@serene-pub/component-client'

/**
 * What this widget shows. It runs in the page's UI worker: build it from
 * the host elements (plain HTML plus the sp-* set) and style it with classes.
 */
export default defineComponent((root) => {
	const line = document.createElement('p')
	line.setAttribute('class', 'text-sm p-3')
	line.textContent = 'A new widget'
	root.append(line)
})
`
			}
		}
	return {
		entry: "widget.ts",
		files: {
			"Widget.svelte": `<script lang="ts">
	/**
	 * What this widget shows. It runs in the page's UI worker: build it from
	 * the host elements (plain HTML plus the sp-* set) and style it with
	 * classes — a <style> block is dropped at build.
	 */
	let count = $state(0)
</script>

<div class="space-y-2 p-3">
	<p class="text-sm">A new widget</p>
	<button type="button" class="btn preset-tonal" onclick={() => count++}>Clicked {count}</button>
</div>
`,
			"widget.ts": `import { svelteComponent } from '@serene-pub/component-client/svelte'
import Widget from './Widget.svelte'

export default svelteComponent(Widget)
`
		}
	}
}

/* ── import ──────────────────────────────────────────────────────────────── */

interface ImportPlan {
	parsed: ParsedShareFile
	importAs: string
	runs: "recompiled" | "carried-artifact" | "refused"
	compile: Sockets.Components.CompileOutcome | null
	refusal?: string
}

async function planImport(params: Sockets.Components.ImportParams, compileHere: boolean): Promise<ImportPlan> {
	const parsed = parseComponentShare(params)
	const importAs = await freeSlug(parsed.content.slug)
	const a = componentCompilerAvailability()
	if (a.available) {
		const compile = compileHere
			? outcome(await previewCompile(parsed.content.files, parsed.content.entry, parsed.content.framework))
			: null
		return { parsed, importAs, runs: "recompiled", compile }
	}
	if (!parsed.artifact)
		return {
			parsed,
			importAs,
			runs: "refused",
			compile: null,
			refusal: noCompiler(`${a.reason} — and this share file carries no compiled module, so it cannot run here`)
		}
	if (!artifactVerifies(parsed.artifact))
		return {
			parsed,
			importAs,
			runs: "refused",
			compile: null,
			refusal:
				"The share file's compiled module does not match the hash it names — it was changed after it was exported, so it is not run."
		}
	return { parsed, importAs, runs: "carried-artifact", compile: null }
}

/* ── the verbs ───────────────────────────────────────────────────────────── */

export const componentsCoreList = verb<Sockets.Components.CoreList.Params, Sockets.Components.CoreList.Response>({ event: "components:coreList" }, async () => ({
	components: await coreComponentList()
}))

export const componentsCoreSource = verb<Sockets.Components.CoreSource.Params, Sockets.Components.CoreSource.Response>(
	{ event: "components:coreSource" },
	async (_s, params) => {
		const src = typeof params.slug === "string" ? await coreComponentSource(params.slug) : undefined
		if (!src) throw new ComponentRefusal(`Core has no component called ${JSON.stringify(params.slug)}.`)
		return {
			slug: src.slug,
			framework: src.framework ?? "svelte",
			entry: src.entry,
			files: src.files,
			sourceHash: src.sourceHash,
			catalogVersion: src.catalogVersion,
			cloneable: isCloneableCoreComponent(src.slug)
		}
	}
)

export const componentsList = verb<Sockets.Components.List.Params, Sockets.Components.List.Response>({ event: "components:list" }, async () => {
	const a = componentCompilerAvailability()
	return {
		components: (await listAuthoredComponents(db)).map(summary),
		compiler: a.available ? { available: true } : { available: false, reason: a.reason }
	}
})

export const componentsGet = verb<Sockets.Components.Get.Params, Sockets.Components.Get.Response>({ event: "components:get" }, async (_s, params) => ({
	component: detail(await mustGet(params.id))
}))

export const componentsClone = verb<Sockets.Components.Clone.Params, Sockets.Components.Clone.Response>({ event: "components:clone" }, async (socket, params) => {
	const slug = params.slug
	if (typeof slug !== "string" || !(await coreComponentSource(slug)))
		throw new ComponentRefusal(`Core has no component called ${JSON.stringify(slug)}.`)
	if (!isCloneableCoreComponent(slug))
		throw new ComponentRefusal(
			`'${slug}' can be read but not cloned: it runs on core's own trust (no invoke gate, its own element ids), which a clone — always its own widget, never core — cannot have.`
		)
	requireCompiler()
	const src = (await coreComponentSource(slug))!
	const widget = coreWidgetShape(slug) ?? { title: slug }
	const row = await createAuthoredComponent(
		db,
		{
			slug: await freeSlug(slug),
			label: params.label ?? widget.title,
			framework: (src.framework ?? "svelte") as AuthoredComponentContent["framework"],
			entry: src.entry,
			files: { ...src.files },
			widget,
			basedOn: { component: slug, version: src.catalogVersion, sourceHash: src.sourceHash }
		},
		{ createdBy: socket.user?.id ?? null }
	)
	const compile = await compileNow(row.id)
	return { component: await fresh(row.id), compile }
})

export const componentsCreate = verb<Sockets.Components.Create.Params, Sockets.Components.Create.Response>({ event: "components:create" }, async (socket, params) => {
	const framework = params.framework
	if (framework !== "svelte" && framework !== "vanilla")
		throw new ComponentRefusal(`framework must be 'svelte' or 'vanilla', not ${JSON.stringify(framework)}.`)
	requireCompiler()
	const { files, entry } = blankFiles(framework)
	const label = params.label ?? "New widget"
	const row = await createAuthoredComponent(
		db,
		{
			slug: await freeSlug(typeof params.slug === "string" && params.slug ? params.slug : "widget"),
			label,
			framework,
			entry,
			files,
			widget: { title: label }
		},
		{ createdBy: socket.user?.id ?? null }
	)
	const compile = await compileNow(row.id)
	return { component: await fresh(row.id), compile }
})

/**
 * Save. Source that compiles becomes the saved version (any component draft
 * cleared), is recorded and announced. Source that does NOT compile, on a
 * component with a saved version, is kept as the component draft: the saved
 * version, its compiled module and the sessions running it are untouched, and
 * the reply says `stored: 'component-draft'`. A component that has never
 * compiled has no saved version to keep: its source is stored and it stays
 * not offered, as before the ruling.
 */
export const componentsSave = verb<Sockets.Components.Save.Params, Sockets.Components.Save.Response>({ event: "components:save" }, async (socket, params) => {
	requireCompiler()
	const expected = stamp(params.expectedUpdatedAt)
	const current = await mustGet(params.id)
	const patch: Partial<AuthoredComponentContent> = {}
	if (params.files !== undefined) patch.files = params.files
	if (params.entry !== undefined) patch.entry = params.entry
	if (params.framework !== undefined) patch.framework = params.framework
	if (params.label !== undefined) patch.label = params.label
	if (params.widget !== undefined) patch.widget = params.widget as AuthoredComponentContent["widget"]

	const source = {
		files: patch.files ?? current.files,
		entry: patch.entry ?? current.entry,
		framework: (patch.framework ?? current.framework) as AuthoredComponentContent["framework"]
	}
	const sourceMoves =
		componentSourceHash(source.files) !== current.sourceHash ||
		source.entry !== current.entry ||
		source.framework !== current.framework
	if (sourceMoves && hasSavedVersion(current)) {
		// Judge it before the compiler sees it, and refuse a stale writer
		// before spending a compile on them; the write re-checks the token.
		const findings = authoredComponentFindings({
			slug: current.slug,
			label: patch.label ?? current.label,
			widget: patch.widget ?? current.widget,
			basedOn: current.basedOn,
			...source
		})
		if (findings.length) throw new AuthoredComponentInvalid(findings)
		if (current.updatedAt.getTime() !== expected.getTime()) throw new AuthoredComponentConflict(current.id, current.updatedAt)
		const o = await previewCompile(source.files, source.entry, source.framework)
		if (o.errors.length || !o.hash) {
			const declaration = { label: patch.label, widget: patch.widget }
			const row = await saveComponentDraft(db, params.id, expected, { ...source, errors: o.errors }, declaration)
			// Same src: a session drawing it keeps its module (the push only
			// tells the other editors and the list that the row moved).
			announce(socket, row)
			return { component: detail(row), compile: outcome(o), stored: "component-draft" as const }
		}
		const saved = await updateAuthoredComponent(db, params.id, expected, patch)
		await writeArtifact(saved.id, o.hash, o.code)
		await recordAuthoredCompile(db, saved.id, { sourceHash: saved.sourceHash, fingerprint: o.fingerprint, artifactHash: o.hash })
		const row = await mustGet(params.id)
		announce(socket, row)
		return { component: detail(row), compile: outcome(o), stored: "saved-version" as const }
	}

	await updateAuthoredComponent(db, params.id, expected, patch)
	const compile = await compileNow(params.id)
	const row = await mustGet(params.id)
	announce(socket, row)
	return { component: detail(row), compile, stored: "saved-version" as const }
})

/**
 * Discard the component draft, so the editor holds the saved version again.
 * Optimistic: a draft saved after the reverter read the component is never
 * dropped. Nothing a session runs changes, so nothing is recompiled.
 */
export const componentsRevertDraft = verb<Sockets.Components.RevertDraft.Params, Sockets.Components.RevertDraft.Response>(
	{ event: "components:revertDraft" },
	async (socket, params) => {
		const expected = stamp(params.expectedUpdatedAt)
		const current = await mustGet(params.id)
		if (!componentDraftOf(current))
			throw new ComponentRefusal("This component has no draft to revert — what the editor holds is already the last save.")
		const row = await revertComponentDraft(db, params.id, expected)
		announce(socket, row)
		return { component: detail(row) }
	}
)

export const componentsPreview = verb<Sockets.Components.Preview.Params, Sockets.Components.Preview.Response>(
	{ event: "components:preview" },
	async (socket, params) => {
		requireCompiler()
		// The same rules a save is held to, before the compiler sees anything
		// (a placeholder identity; only the source half is being judged).
		const findings = authoredComponentFindings({
			slug: "preview",
			label: "preview",
			widget: { title: "preview" },
			files: params.files,
			entry: params.entry,
			framework: params.framework
		})
		if (findings.length) throw new AuthoredComponentInvalid(findings)
		const o = await previewCompile(params.files, params.entry, params.framework)
		if (o.errors.length || !o.hash) return { compile: outcome(o) }
		const minted = mintComponentPreview(socket.user.id, o.code)
		return { compile: outcome(o), url: minted.url, expiresAt: minted.expiresAt }
	}
)


export const componentsSetEnabled = verb<Sockets.Components.SetEnabled.Params, Sockets.Components.SetEnabled.Response>(
	{ event: "components:setEnabled" },
	async (socket, params) => {
		await mustGet(params.id)
		await setAuthoredComponentEnabled(db, params.id, params.enabled === true)
		const row = await mustGet(params.id)
		announce(socket, row)
		return { component: detail(row) }
	}
)

export const componentsReviewScopes = verb<Sockets.Components.ReviewScopes.Params, Sockets.Components.ReviewScopes.Response>(
	{ event: "components:reviewScopes" },
	async (socket, params) => {
		await mustGet(params.id)
		const denied = Array.isArray(params.denied) ? params.denied.filter((s): s is string => typeof s === "string") : []
		await reviewAuthoredScopes(db, params.id, { denied })
		const row = await mustGet(params.id)
		announce(socket, row)
		return { component: detail(row) }
	}
)

export const componentsDelete = verb<Sockets.Components.Delete.Params, Sockets.Components.Delete.Response>({ event: "components:delete" }, async (socket, params) => {
	const expected = stamp(params.expectedUpdatedAt)
	await mustGet(params.id)
	await deleteAuthoredComponent(db, params.id, expected)
	await removeArtifacts(params.id)
	announce(socket, { id: params.id, gone: true })
	return { id: params.id }
})

export const componentsExport = verb<Sockets.Components.Export.Params, Sockets.Components.Export.Response>({ event: "components:export" }, async (_s, params) => {
	let row = await mustGet(params.id)
	let code: string | null = null
	if (row.artifactHash && !row.lastError) {
		code = await readArtifact(row.id, row.artifactHash)
		// A cache miss is healed where it can be; an export never waits on a compile that fails.
		if (code === null && componentCompilerAvailability().available) {
			await compileAndRecord(db, row.id).catch(() => undefined)
			row = await mustGet(row.id)
			if (row.artifactHash && !row.lastError) code = await readArtifact(row.id, row.artifactHash)
		}
	}
	// The saved version travels; a component draft never does.
	return {
		envelope: componentShareFile(row, code) as Sockets.Components.ShareFile,
		filename: shareFileName(row.slug),
		componentDraftLeftOut: componentDraftOf(row) !== null
	}
})

export const componentsImportPreview = verb<Sockets.Components.ImportPreview.Params, Sockets.Components.ImportPreview.Response>(
	{ event: "components:importPreview" },
	async (_s, params) => {
		const plan = await planImport(params, true)
		const c = plan.parsed.content
		return {
			summary: {
				slug: c.slug,
				importAs: plan.importAs,
				label: c.label,
				framework: c.framework,
				entry: c.entry,
				basedOn: c.basedOn ?? null,
				files: Object.entries(c.files).map(([path, text]) => ({ path, bytes: Buffer.byteLength(text, "utf8") })),
				widget: c.widget as Sockets.Components.Widget,
				requestedScopes: [...(c.widget.scopes ?? [])],
				singleFile: plan.parsed.singleFile,
				artifact: {
					carried: !!plan.parsed.artifact,
					verifies: plan.parsed.artifact ? artifactVerifies(plan.parsed.artifact) : false,
					fingerprint: plan.parsed.artifact?.fingerprint ?? null
				},
				runs: plan.runs,
				compile: plan.compile
			}
		}
	}
)

export const componentsImport = verb<Sockets.Components.Import.Params, Sockets.Components.Import.Response>({ event: "components:import" }, async (socket, params) => {
	const plan = await planImport(params, false)
	if (plan.runs === "refused") throw new ComponentRefusal(plan.refusal!)
	const c = plan.parsed.content
	// Arrives switched off, with every requested scope unreviewed (no review marks).
	const row = await createAuthoredComponent(db, { ...c, slug: plan.importAs }, { createdBy: socket.user?.id ?? null })
	let compile: Sockets.Components.CompileOutcome | null = null
	if (plan.runs === "recompiled") compile = await compileNow(row.id)
	else {
		const a = plan.parsed.artifact!
		await writeArtifact(row.id, a.hash, a.code)
		await recordAuthoredCompile(db, row.id, { sourceHash: row.sourceHash, fingerprint: a.fingerprint, artifactHash: a.hash })
	}
	const after = await mustGet(row.id)
	announce(socket, after)
	return {
		component: detail(after),
		compile,
		...(plan.importAs !== c.slug ? { renamedFrom: c.slug } : {})
	}
})

/** Every verb, in the order they are registered — for the table-driven gate tests. */
export const COMPONENT_HANDLERS: readonly Handler<any, any>[] = [
	componentsCoreList,
	componentsCoreSource,
	componentsList,
	componentsGet,
	componentsClone,
	componentsCreate,
	componentsSave,
	componentsRevertDraft,
	componentsPreview,
	componentsSetEnabled,
	componentsReviewScopes,
	componentsDelete,
	componentsExport,
	componentsImportPreview,
	componentsImport
]

export function registerComponentHandlers(
	socket: any,
	emitToUser: Emit,
	register: (socket: any, handler: Handler<any, any>, emitToUser: Emit) => void
) {
	for (const h of COMPONENT_HANDLERS) register(socket, h, emitToUser)
}
