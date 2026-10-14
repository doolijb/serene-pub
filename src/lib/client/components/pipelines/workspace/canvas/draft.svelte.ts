/**
 * The canvas's draft session: one admin's draft of one spec, and every call
 * the editor makes (PLAN-pipeline-canvas-and-genre-authoring §4.2, §4.4).
 *
 * A draft is a document the server has recompiled and validated; this holds
 * the latest one, applies pure edits (`edits.ts`) optimistically, and sends
 * each result up as `pipelines:draft:put`, taking the server's compiled
 * document and findings back. Nothing here toasts: a refusal lands in
 * `error` for the bar to show (views never toast, domain code reports).
 */
import type { Finding, SpecDocument } from "@serene-pub/sdk"
import { awaitReply } from "$lib/client/utils/awaitReply"
import type { TypedSocket } from "$lib/client/sockets/typedSocket"

export interface Draft {
	document: SpecDocument
	findings: Finding[]
	basedOnVersionId: number | null
	basedOnSemver: string | null
	updatedAt: string
}

/** A node definition as the catalogue lists it (the SDK's `RegistryEntry`). */
export interface CatalogueEntry {
	id: string
	version: number
	kind: string
	ports: { in: Record<string, string | undefined>; out: Record<string, string | undefined> }
	slots?: Record<string, { kind?: string; [k: string]: unknown }>
	i18n?: { name?: unknown; description?: unknown }
	owner?: string | null
}

/** A composite step as the library lists it. */
export interface CompositeEntry {
	slug: string
	label: string
	nodeCount: number
	reads: Array<{ key: string; path: string; node: string; port?: string }>
	updatedAt: string
	document: { nodes: any[]; clauses: any[]; reads: CompositeEntry["reads"] }
}

export interface PreviewResult {
	findings: Finding[]
	semverTaken: boolean
	affected: { configId: number; configName: string; culled: string[]; backfilled: string[] }[]
}

type Interest = {
	declareInterest: <K extends string>(event: K, handler: (data: any) => void) => () => void
	requestWithInterest: (event: any, params: any, handler: (data: any) => void) => () => void
}

export function createDraftSession(opts: {
	slug: string
	socket: Pick<TypedSocket, "emit">
	interest: Interest
}) {
	const { slug, socket, interest } = opts

	let draft = $state<Draft | null>(null)
	let shipped = $state(false)
	let loaded = $state(false)
	let busy = $state(false)
	let error = $state<string | null>(null)
	let catalogue = $state<CatalogueEntry[] | null>(null)
	let composites = $state<CompositeEntry[]>([])

	const onGet = (res: { slug?: string; draft?: Draft | null; shipped?: boolean; error?: string }) => {
		if (res.error) {
			error = res.error
			loaded = true
			return
		}
		if (res.slug !== slug) return
		draft = res.draft ?? null
		shipped = !!res.shipped
		loaded = true
	}

	/** Subscribe and ask; returns the release for the caller's effect. */
	function connect(): () => void {
		const releases = [
			interest.declareInterest("pipelines:draft:get:error", (r: { error?: string }) => {
				if (r?.error) error = r.error
				loaded = true
			}),
			interest.requestWithInterest("pipelines:draft:get", { slug }, onGet)
		]
		return () => {
			for (const r of releases) r()
		}
	}

	async function put(document: SpecDocument): Promise<boolean> {
		busy = true
		error = null
		try {
			const res = await awaitReply({
				socket,
				event: "pipelines:draft:put" as any,
				errorEvent: "pipelines:draft:put:error" as any,
				params: { slug, document } as any,
				match: (r: any) => r?.slug === slug,
				timeoutMs: 30_000
			})
			draft = (res as any).draft as Draft
			return true
		} catch (e) {
			error = e instanceof Error ? e.message : "The server refused the draft."
			return false
		} finally {
			busy = false
		}
	}

	/** Start editing from the active document. */
	async function start(active: SpecDocument): Promise<boolean> {
		return put(JSON.parse(JSON.stringify(active)))
	}

	/** Apply a pure edit to the draft and send it up. The server's compiled copy replaces the optimistic one. */
	async function apply(fn: (doc: SpecDocument) => SpecDocument): Promise<boolean> {
		if (!draft) return false
		let next: SpecDocument
		try {
			next = fn(draft.document)
		} catch (e) {
			error = e instanceof Error ? e.message : String(e)
			return false
		}
		const before = draft
		draft = { ...before, document: next }
		const ok = await put(next)
		if (!ok) draft = before
		return ok
	}

	async function discard(): Promise<boolean> {
		busy = true
		error = null
		try {
			await awaitReply({
				socket,
				event: "pipelines:draft:discard" as any,
				errorEvent: "pipelines:draft:discard:error" as any,
				params: { slug } as any,
				match: (r: any) => r?.slug === slug
			})
			draft = null
			return true
		} catch (e) {
			error = e instanceof Error ? e.message : "The draft could not be discarded."
			return false
		} finally {
			busy = false
		}
	}

	async function preview(semver: string): Promise<PreviewResult | null> {
		try {
			const res = await awaitReply({
				socket,
				event: "pipelines:draft:preview" as any,
				errorEvent: "pipelines:draft:preview:error" as any,
				params: { slug, semver } as any,
				match: (r: any) => r?.slug === slug,
				timeoutMs: 30_000
			})
			return res as any as PreviewResult
		} catch (e) {
			error = e instanceof Error ? e.message : "The preview failed."
			return null
		}
	}

	async function publish(semver: string): Promise<{ semver: string; culled: number; backfilled: number } | null> {
		busy = true
		error = null
		try {
			const res: any = await awaitReply({
				socket,
				event: "pipelines:draft:publish" as any,
				errorEvent: "pipelines:draft:publish:error" as any,
				params: { slug, semver } as any,
				match: (r: any) => r?.slug === slug,
				timeoutMs: 60_000
			})
			draft = null
			return {
				semver: res.version?.semver ?? semver,
				culled: res.reconcile?.culled ?? 0,
				backfilled: res.reconcile?.backfilled ?? 0
			}
		} catch (e) {
			error = e instanceof Error ? e.message : "Publishing was refused."
			return null
		} finally {
			busy = false
		}
	}

	async function fork(ownerSlug: string, name: string, label: string): Promise<string | null> {
		busy = true
		error = null
		try {
			const res: any = await awaitReply({
				socket,
				event: "pipelines:fork" as any,
				errorEvent: "pipelines:fork:error" as any,
				params: { slug, ownerSlug, name, label } as any,
				match: (r: any) => typeof r?.slug === "string",
				timeoutMs: 60_000
			})
			return res.slug as string
		} catch (e) {
			error = e instanceof Error ? e.message : "The copy was refused."
			return null
		} finally {
			busy = false
		}
	}

	let cataloguePromise: Promise<void> | null = null
	/** One request at a time: concurrent callers share the in-flight read. */
	function loadCatalogue(): Promise<void> {
		if (catalogue) return Promise.resolve()
		if (cataloguePromise) return cataloguePromise
		cataloguePromise = readCatalogue().finally(() => {
			cataloguePromise = null
		})
		return cataloguePromise
	}
	async function readCatalogue(): Promise<void> {
		try {
			const res: any = await awaitReply({
				socket,
				event: "pipelines:catalogue" as any,
				errorEvent: "pipelines:catalogue:error" as any,
				params: {} as any,
				match: (r: any) => Array.isArray(r?.definitions),
				timeoutMs: 30_000
			})
			catalogue = res.definitions as CatalogueEntry[]
			composites = (res.composites ?? []) as CompositeEntry[]
		} catch (e) {
			error = e instanceof Error ? e.message : "The catalogue could not be read."
		}
	}

	/** Save a lifted run of steps to the library under the spec's owner, then re-read the catalogue. */
	async function saveComposite(slug: string, label: string, document: CompositeEntry["document"]): Promise<boolean> {
		busy = true
		error = null
		try {
			await awaitReply({
				socket,
				event: "pipelines:composite:save" as any,
				errorEvent: "pipelines:composite:save:error" as any,
				params: { slug, label, document } as any,
				match: (r: any) => r?.slug === slug,
				timeoutMs: 30_000
			})
			catalogue = null
			await loadCatalogue()
			return true
		} catch (e) {
			error = e instanceof Error ? e.message : "The step could not be saved."
			return false
		} finally {
			busy = false
		}
	}

	return {
		get draft() {
			return draft
		},
		get shipped() {
			return shipped
		},
		get loaded() {
			return loaded
		},
		get busy() {
			return busy
		},
		get error() {
			return error
		},
		set error(v: string | null) {
			error = v
		},
		get catalogue() {
			return catalogue
		},
		get composites() {
			return composites
		},
		get findings(): Finding[] {
			return draft?.findings ?? []
		},
		get errorCount() {
			return (draft?.findings ?? []).filter((f) => f.severity === "error").length
		},
		connect,
		start,
		apply,
		discard,
		preview,
		publish,
		fork,
		loadCatalogue,
		saveComposite
	}
}

export type DraftSession = ReturnType<typeof createDraftSession>

/** The next patch version: 1.20.0 → 1.20.1; anything odd → itself. */
export function bumpPatch(semver: string): string {
	const m = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(semver)
	if (!m) return semver
	return `${m[1]}.${m[2]}.${Number(m[3]) + 1}`
}

export const OWNER_SLUG = /^[a-z0-9]+([.-][a-z0-9]+)*$/
export const SPEC_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/
/** The owner segment of an id (`acme.lab:spec/reply` → `acme.lab`). */
export const ownerOf = (id: string) => id.split(":")[0] ?? ""
