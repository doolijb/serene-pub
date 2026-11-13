<script lang="ts">
	/**
	 * W3, write a variable layout: one variable layout's change form (Django's
	 * change form, built on `AdminChangeForm`), at
	 * `/admin/variable-layouts/<variable>/new` and `…/<variable>/<id>`.
	 * Fieldsets: Variable layout (name, how it is referenced, language),
	 * Source with a live Preview beside it, and, on a new layout, **Use it
	 * everywhere**. A built-in layout is read-only here (duplicate it).
	 *
	 * The server owns the variable's scope and sample (`pipelines:libraryVariable`),
	 * so the editor's *Variables available here* is the server's, not a lookup
	 * in this bundle. Nothing here toasts: a refusal is words on the form.
	 */
	import * as Icons from "@lucide/svelte"
	import { onDestroy, untrack } from "svelte"
	import type { TemplateScope } from "@serene-pub/sdk"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import InlineError from "$lib/client/components/InlineError.svelte"
	import LoadingState from "$lib/client/components/LoadingState.svelte"
	import AdminChangeForm, {
		type AdminSaveIntent
	} from "$lib/client/components/admin/AdminChangeForm.svelte"
	import AdminFieldset from "$lib/client/components/admin/AdminFieldset.svelte"
	import AdminField, {
		describedBy
	} from "$lib/client/components/admin/AdminField.svelte"
	import FieldHelp from "$lib/client/components/FieldHelp.svelte"
	import { deletionFor } from "$lib/client/components/admin/changelist"
	import TemplateEditor from "$lib/client/components/templates/TemplateEditor.svelte"
	import {
		adminGoto as goto,
		adminUnsavedEdits
	} from "$lib/client/admin/adminRouter.svelte"
	import { UnsavedEdits } from "$lib/client/forms/unsavedEdits.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import {
		CORE_LIQUID_ENGINE,
		CORE_TEMPLATE_ENGINE
	} from "$lib/shared/pipelines/templateEngines"
	import {
		layoutFormHref,
		layoutSlugOf,
		lastOwnerSlug,
		ownerSlugProblem,
		referenceOf,
		slugProblem,
		useEverywhereSentence,
		variableHref,
		variableKeyOf,
		VARIABLE_LAYOUTS_HREF,
		engineWords
	} from "./variableLayoutWords"

	type Template = Sockets.Pipelines.Library.LibraryTemplate
	type Variable = Sockets.Pipelines.VariableLayouts.Variable

	interface Props {
		/** The variable this layout is for (decoded). */
		variableId: string
		/** The row to edit; absent = add mode. */
		id?: number
		/** Add mode: the row to start from (Duplicate). */
		from?: number | null
	}
	let { variableId, id, from = null }: Props = $props()

	const uid = $props.id()
	const nameId = `${uid}-name`
	const ownerId = `${uid}-owner`
	const slugId = `${uid}-slug`
	const engineId = `${uid}-engine`
	const everywhereId = `${uid}-everywhere`

	const socket = useTypedSocket()
	const change = $derived(id != null)

	// ── what the server says ──────────────────────────────────────
	let variable = $state<Variable | null>(null)
	let variableError = $state<string | null>(null)
	let library = $state<Sockets.Pipelines.Library.Response | null>(null)
	let counts =
		$state<Sockets.Pipelines.VariableLayouts.UseEverywhereCounts.Response | null>(
			null
		)

	$effect(() => {
		const v = variableId
		return requestWithInterest(
			"pipelines:libraryVariable",
			{ variableId: v },
			(res) => {
				if (res.variable && res.variable.variableId === v) {
					variable = res.variable
					variableError = null
				}
			}
		)
	})
	useInterest<"pipelines:libraryVariable:error">(
		"pipelines:libraryVariable:error",
		(res) => {
			variableError = res.error ?? "That variable could not be read."
		}
	)
	$effect(() =>
		requestWithInterest("pipelines:library", {}, (res) => (library = res))
	)
	$effect(() => {
		if (change) return
		const v = variableId
		return requestWithInterest(
			"pipelines:libraryUseEverywhereCounts",
			{ variableId: v },
			(res) => {
				if (!res.variableId || res.variableId === v) counts = res
			}
		)
	})

	const templates = $derived((library?.variableTemplates ?? []) as Template[])
	const row = $derived(
		change
			? templates.find((r) => r.id === id && r.poolId === variableId)
			: undefined
	)
	const fromRow = $derived(
		!change && from != null
			? templates.find((r) => r.id === from && r.poolId === variableId)
			: undefined
	)
	const loading = $derived(!library || (!variable && !variableError))
	const readonly = $derived(!!row?.isImmutable)

	// ── the draft ─────────────────────────────────────────────────
	let name = $state("")
	let ownerSlug = $state("")
	let slug = $state("")
	let slugTouched = $state(false)
	let engine = $state(CORE_TEMPLATE_ENGINE)
	let source = $state("")
	let useEverywhere = $state(false)
	let seeded = $state(false)

	const edits = new UnsavedEdits(() => ({
		name,
		ownerSlug,
		slug,
		engine,
		source,
		useEverywhere
	}))

	/** The form as built from a row (or the blank form). */
	function built(r: Template | undefined, copy: boolean) {
		const nm = r ? (copy ? `${r.name} (copy)` : r.name) : ""
		const ref = !copy && r?.reference ? r.reference : null
		const slash = ref ? ref.indexOf("/") : -1
		const at = ref ? ref.lastIndexOf("@") : -1
		return {
			name: nm,
			ownerSlug:
				ref && slash > 0
					? ref.slice(0, slash)
					: lastOwnerSlug(templates),
			slug:
				ref && slash > 0
					? ref.slice(slash + 1, at > slash ? at : undefined)
					: layoutSlugOf(nm),
			engine:
				r &&
				(r.engine === CORE_TEMPLATE_ENGINE ||
					r.engine === CORE_LIQUID_ENGINE ||
					!copy)
					? r.engine
					: CORE_TEMPLATE_ENGINE,
			source: r?.source ?? "",
			useEverywhere: false
		}
	}
	$effect(() => {
		if (loading || variableError) return
		if (change) {
			if (!row) return
			const next = built(row, false)
			untrack(() =>
				edits.adoptSaved(next, (n) => {
					name = n.name
					ownerSlug = n.ownerSlug
					slug = n.slug
					engine = n.engine
					source = n.source
					useEverywhere = n.useEverywhere
				})
			)
			seeded = true
		} else if (!seeded) {
			if (from != null && !fromRow) return
			const n = built(fromRow, true)
			name = n.name
			ownerSlug = n.ownerSlug
			slug = n.slug
			engine = n.engine
			source = n.source
			useEverywhere = n.useEverywhere
			seeded = true
			untrack(() => edits.markSaved())
		}
	})
	adminUnsavedEdits(() => edits.dirty)

	function onName(value: string) {
		name = value
		if (!slugTouched) slug = layoutSlugOf(value)
	}

	// ── preview ───────────────────────────────────────────────────
	let preview = $state<Sockets.Pipelines.PreviewTemplate.Response | null>(
		null
	)
	useInterest<"pipelines:previewTemplate">(
		"pipelines:previewTemplate",
		(res) => {
			preview = res
		}
	)
	useInterest<"pipelines:previewTemplate:error">(
		"pipelines:previewTemplate:error",
		(res) => {
			preview = { error: res.error ?? "The preview failed." }
		}
	)
	let timer: ReturnType<typeof setTimeout> | null = null
	$effect(() => {
		const s = source
		const e = engine
		if (!seeded) return
		if (timer) clearTimeout(timer)
		timer = null
		if (!s.trim()) {
			preview = null
			return
		}
		timer = setTimeout(() => {
			timer = null
			socket.emit("pipelines:previewTemplate", {
				kind: "variable",
				source: s,
				engine: e,
				poolId: variableId
			})
		}, 400)
	})
	onDestroy(() => {
		if (timer) clearTimeout(timer)
	})

	// ── saving and deleting ───────────────────────────────────────
	let saving = $state(false)
	let pendingIntent: AdminSaveIntent | null = null
	let deleting = false
	let formErrors = $state<string[]>([])
	let nameError = $state<string | null>(null)
	let ownerError = $state<string | null>(null)
	let slugError = $state<string | null>(null)

	const needsReference = $derived(!readonly && !row?.reference)

	function check(): boolean {
		nameError = name.trim() ? null : "A variable layout needs a name."
		ownerError = needsReference ? ownerSlugProblem(ownerSlug) : null
		slugError = needsReference ? slugProblem(slug) : null
		formErrors = []
		return !nameError && !ownerError && !slugError
	}

	function land(intent: AdminSaveIntent, createdId?: number) {
		if (intent === "save") void goto(variableHref(variableId))
		else if (intent === "another")
			void goto(layoutFormHref(variableId, "new"))
		else if (createdId != null)
			void goto(layoutFormHref(variableId, createdId), {
				replaceState: true
			})
	}

	function save(intent: AdminSaveIntent) {
		if (readonly) return
		if (change) {
			if (!edits.dirty) {
				land(intent)
				return
			}
			if (!check()) return
			saving = true
			pendingIntent = intent
			socket.emit("pipelines:libraryUpdateTemplate", {
				kind: "variable",
				id: id!,
				name: name.trim(),
				source,
				engine,
				...(row?.reference
					? {}
					: {
							reference: {
								ownerSlug: ownerSlug.trim(),
								slug: slug.trim()
							}
						})
			})
		} else {
			if (!check()) return
			saving = true
			pendingIntent = intent
			socket.emit("pipelines:libraryCreateTemplate", {
				kind: "variable",
				poolId: variableId,
				name: name.trim(),
				source,
				engine,
				reference: { ownerSlug: ownerSlug.trim(), slug: slug.trim() },
				useEverywhere
			})
		}
	}

	function remove() {
		if (!change || !row) return
		deleting = true
		socket.emit("pipelines:libraryDeleteTemplate", {
			kind: "variable",
			id: id!
		})
	}

	useInterest<"pipelines:libraryCreateTemplate">(
		"pipelines:libraryCreateTemplate",
		(res) => {
			if (res.library) library = res.library
			const intent = pendingIntent
			if (change || !intent) return
			pendingIntent = null
			saving = false
			edits.forget()
			land(intent, res.createdId)
		}
	)
	useInterest<"pipelines:libraryUpdateTemplate">(
		"pipelines:libraryUpdateTemplate",
		(res) => {
			if (res.library) library = res.library
			const intent = pendingIntent
			if (!change || !intent) return
			pendingIntent = null
			saving = false
			edits.markSaved()
			land(intent)
		}
	)
	useInterest<"pipelines:libraryDeleteTemplate">(
		"pipelines:libraryDeleteTemplate",
		(res) => {
			if (res.library) library = res.library
			if (!deleting) return
			deleting = false
			edits.forget()
			void goto(variableHref(variableId), { replaceState: true })
		}
	)
	function refused(res: { error?: string }) {
		if (!pendingIntent && !deleting) return
		pendingIntent = null
		saving = false
		deleting = false
		formErrors = [res.error ?? "The edit was refused."]
	}
	useInterest<"pipelines:libraryCreateTemplate:error">(
		"pipelines:libraryCreateTemplate:error",
		refused
	)
	useInterest<"pipelines:libraryUpdateTemplate:error">(
		"pipelines:libraryUpdateTemplate:error",
		refused
	)
	useInterest<"pipelines:libraryDeleteTemplate:error">(
		"pipelines:libraryDeleteTemplate:error",
		refused
	)

	/** What keeps this layout from being deleted, from what the variable says of its row. */
	function protect(): string | null {
		const vr = variable?.rows.find((r) => r.id === id)
		if (!vr) return null
		if (vr.inUse) return "it is the one in use — choose another first"
		if (vr.chosenByPresets.length) {
			const names = vr.chosenByPresets.map((p) => p.name).join(", ")
			return `chosen by the ${names} preset${vr.chosenByPresets.length === 1 ? "" : "s"}`
		}
		if (vr.namedByTemplates)
			return `named by ${vr.namedByTemplates} context template${vr.namedByTemplates === 1 ? "" : "s"}`
		return null
	}
	const deletion = () =>
		deletionFor([row!], {
			noun: { singular: "variable layout", plural: "variable layouts" },
			label: (r) => r.name,
			protect
		})

	const everywhereHelp = $derived(
		`${useEverywhereSentence(variableKeyOf(variable?.scope, variableId), counts)} Left off, it is offered on the variable's page with Use this.`
	)
	const ENGINE_OPTIONS = [
		{ value: CORE_TEMPLATE_ENGINE, label: "Handlebars" },
		{ value: CORE_LIQUID_ENGINE, label: "Liquid" }
	]
	const title = $derived(
		change
			? name.trim() || row?.name || "Variable layout"
			: "New variable layout"
	)
</script>

{#if loading}
	<LoadingState />
{:else if variableError || !variable}
	<div class="m-auto flex flex-col items-center gap-3 py-16 text-center">
		<p class="text-surface-600-400 text-sm">
			{variableError ?? "That variable could not be read."}
		</p>
		<a href={VARIABLE_LAYOUTS_HREF} class="btn btn-sm preset-tonal-surface">
			Variable layouts
		</a>
	</div>
{:else if change && !row}
	<div class="m-auto flex flex-col items-center gap-3 py-16 text-center">
		<p class="text-surface-600-400 text-sm">
			There is no variable layout {id} for {variable.label}.
		</p>
		<a
			href={variableHref(variableId)}
			class="btn btn-sm preset-tonal-surface"
		>
			{variable.label}
		</a>
	</div>
{:else}
	<AdminChangeForm
		mode={change ? "change" : "add"}
		{title}
		purpose={readonly
			? "A variable layout that ships with Serene Pub or a plugin: read-only. Duplicate it to make one you can change."
			: undefined}
		noun="variable layout"
		changelistHref={VARIABLE_LAYOUTS_HREF}
		changelistLabel="Variable layouts"
		trail={[{ label: variable.label, href: variableHref(variableId) }]}
		dirty={edits.dirty}
		{saving}
		canSave={readonly ? false : undefined}
		errors={formErrors}
		fieldErrors={{
			[nameId]: nameError,
			[ownerId]: ownerError,
			[slugId]: slugError
		}}
		deletion={change && !readonly ? deletion : undefined}
		onDelete={change && !readonly ? remove : undefined}
		onSave={save}
	>
		{#snippet headerActions()}
			{#if change}
				<a
					href={layoutFormHref(variableId, "new", id)}
					class="btn btn-sm preset-tonal-surface"
				>
					<Icons.Copy size={16} aria-hidden="true" /> Duplicate
				</a>
			{/if}
		{/snippet}

		<AdminFieldset title="Variable layout">
			<div class="grid gap-4 @min-[36rem]/content:grid-cols-2">
				{#if readonly}
					<AdminField id={nameId} label="Name" value={name} />
				{:else}
					<AdminField
						id={nameId}
						label="Name"
						required
						error={nameError}
					>
						<input
							id={nameId}
							class="input"
							type="text"
							value={name}
							oninput={(e) => onName(e.currentTarget.value)}
							aria-invalid={!!nameError}
							aria-describedby={describedBy(nameId, !!nameError)}
						/>
					</AdminField>
				{/if}
				{#if row?.reference || readonly}
					<AdminField
						id="{uid}-reference"
						label="Referenced as"
						value={row?.reference ?? null}
						help="Fixed once saved, so templates that name it keep working."
						class="[&_p]:font-mono"
					/>
				{:else}
					<div
						class="flex min-w-0 flex-col gap-1.5 @min-[36rem]/content:col-span-2"
					>
						<div
							class="grid gap-4 @min-[36rem]/content:grid-cols-2"
						>
							<AdminField
								id={ownerId}
								label="Owner slug"
								required
								error={ownerError}
								help="Lowercase letters and digits, dots or hyphens between. Every variable layout you make is named under it."
							>
								<input
									id={ownerId}
									class="input font-mono"
									type="text"
									autocomplete="off"
									spellcheck="false"
									bind:value={ownerSlug}
									aria-invalid={!!ownerError}
									aria-describedby={describedBy(
										ownerId,
										!!ownerError
									)}
								/>
							</AdminField>
							<AdminField
								id={slugId}
								label="Name to reference it by"
								required
								error={slugError}
								help="Lowercase letters and digits, single hyphens between. It follows the name until you change it."
							>
								<input
									id={slugId}
									class="input font-mono"
									type="text"
									autocomplete="off"
									spellcheck="false"
									value={slug}
									oninput={(e) => {
										slug = e.currentTarget.value
										slugTouched = true
									}}
									aria-invalid={!!slugError}
									aria-describedby={describedBy(
										slugId,
										!!slugError
									)}
								/>
							</AdminField>
						</div>
						<!-- prettier-ignore -->
						<p class="text-surface-600-400 text-xs">
							Referenced as <span class="font-mono" data-testid="layout-reference">{referenceOf(variableId, ownerSlug.trim(), slug.trim())}</span>. Fixed once saved, so templates that name it keep working.
						</p>
					</div>
				{/if}
				{#if change}
					<AdminField
						id={engineId}
						label="Language"
						value={engineWords(engine)}
						help="Fixed once made: storing text under another language does not translate it."
					/>
				{:else}
					<AdminField
						id={engineId}
						label="Language"
						help="Fixed once made: storing text under another language does not translate it."
					>
						<Select
							label="Language"
							labelHidden
							options={ENGINE_OPTIONS}
							bind:value={engine}
							describedBy={describedBy(engineId, false)}
						/>
					</AdminField>
				{/if}
			</div>
		</AdminFieldset>

		<AdminFieldset title="Source">
			<div class="grid gap-4 @min-[64rem]/content:grid-cols-2">
				<div class="min-w-0">
					<TemplateEditor
						value={source}
						scope={variable.scope as TemplateScope}
						{engine}
						{readonly}
						rows={16}
						label="Source"
						oninput={(v) => (source = v)}
					/>
				</div>
				<div class="flex min-w-0 flex-col gap-2" aria-live="polite">
					<h3 class="text-sm font-medium">Preview</h3>
					<p class="text-surface-600-400 text-xs">
						Written against the variable's example value.
					</p>
					{#if preview?.error}
						<InlineError>{preview.error}</InlineError>
					{/if}
					{#if preview?.issues?.length}
						<ul
							class="text-warning-600-400 list-inside list-disc text-xs"
						>
							{#each preview.issues as issue, i (i)}
								<li>{issue}</li>
							{/each}
						</ul>
					{/if}
					{#if preview?.rendered != null}
						<pre
							class="bg-surface-50-950 rounded-base overflow-x-auto p-2 font-mono text-xs whitespace-pre-wrap">{preview.rendered}</pre>
					{/if}
				</div>
			</div>
		</AdminFieldset>

		{#if !change}
			<AdminFieldset title="Use it everywhere">
				<label
					class="flex min-h-10 items-center gap-2 text-sm"
					for={everywhereId}
				>
					<input
						id={everywhereId}
						type="checkbox"
						role="switch"
						class="checkbox"
						bind:checked={useEverywhere}
						aria-describedby="{everywhereId}-help"
					/>
					Use it everywhere
				</label>
				<FieldHelp id="{everywhereId}-help">{everywhereHelp}</FieldHelp>
			</AdminFieldset>
		{/if}
	</AdminChangeForm>
{/if}
