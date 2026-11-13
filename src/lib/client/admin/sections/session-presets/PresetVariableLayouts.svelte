<script lang="ts">
	/**
	 * A preset's **Variable layouts** fieldset (PLAN variable-layouts W6):
	 * how this preset's sessions write out a variable where it differs from
	 * the pub's choice.
	 *
	 * On a pub preset the entries are a draft behind the form's Save (STYLE-GUIDE
	 * §6.11, §6.14): Remove, Change a variable's layout and Put back only edit
	 * the draft, and `saveSteps()` sends the difference as single writes in
	 * order for the form's `saveInSequence`. A preset declared in code shows
	 * its entries as words. The one act that is not a draft is *Give it a
	 * reference*: it writes a variable layout, not the preset, so it acts when
	 * pressed.
	 *
	 * Listens through the interest registry only; never toasts.
	 */
	import { untrack } from "svelte"
	import * as Icons from "@lucide/svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import AdminFieldset from "$lib/client/components/admin/AdminFieldset.svelte"
	import VariableLayoutPreview from "$lib/client/components/admin/VariableLayoutPreview.svelte"
	import { UnsavedEdits } from "$lib/client/forms/unsavedEdits.svelte"
	import { useTypedSocket } from "$lib/client/sockets/loadSockets.client"
	import {
		requestWithInterest,
		useInterest
	} from "$lib/client/sockets/interest.svelte"
	import { awaitReply } from "$lib/client/utils/awaitReply"
	import type { SaveStep } from "$lib/client/admin/sequentialSave"
	import {
		lastOwnerSlug,
		ownerSlugProblem
	} from "$lib/client/admin/sections/variable-layouts/variableLayoutWords"

	interface Props {
		presetId: number
		dirty?: boolean
	}
	let { presetId, dirty = $bindable(false) }: Props = $props()

	type View = Sockets.Pipelines.PresetVariableLayouts.Response
	type VariableRow = Sockets.Pipelines.VariableLayouts.ListRow
	type LayoutVariable = Sockets.Pipelines.VariableLayouts.Variable
	type LayoutRow = Sockets.Pipelines.VariableLayouts.Row

	const uid = $props.id()
	const DANGLING_TAIL =
		", which no variable layout goes by now. The pub's layout is used."
	const socket = useTypedSocket()

	let view = $state<View | null>(null)
	let loadError = $state<string | null>(null)
	let variables = $state<VariableRow[]>([])
	/** variableId → reference, as the draft stands; reassigned, never mutated. */
	let draft = $state<Record<string, string>>({})
	/** reference → the layout's name, remembered when it is picked here. */
	let names = $state<Record<string, string>>({})

	const savedOf = (v: View | null): Record<string, string> =>
		Object.fromEntries(
			(v?.rows ?? []).map((r) => [r.variableId, r.reference])
		)
	const saved = $derived(savedOf(view))

	const edits = new UnsavedEdits((): Record<string, string> => draft)
	$effect(() => {
		dirty = edits.dirty
	})

	function onView(res: View) {
		if (res.error) {
			loadError = res.error
			return
		}
		if (res.presetId !== presetId) return
		loadError = null
		view = res
		edits.adoptSaved(savedOf(res), (next) => {
			draft = { ...next }
		})
	}

	let seenPreset: number | null = null
	$effect(() => {
		const id = presetId
		untrack(() => {
			if (seenPreset !== null && id !== seenPreset) {
				view = null
				draft = {}
				edits.forget()
			}
			seenPreset = id
		})
		return requestWithInterest(
			"pipelines:presetVariableLayouts",
			{ presetId: id },
			onView
		)
	})
	useInterest<"pipelines:presetVariableLayouts:error">(
		"pipelines:presetVariableLayouts:error",
		(res) => {
			if (res.error) loadError = res.error
		}
	)
	useInterest<"pipelines:setPresetVariableLayout">(
		"pipelines:setPresetVariableLayout",
		(res) => {
			if (res.presetId === presetId && !res.error) onView(res)
		}
	)
	$effect(() =>
		requestWithInterest("pipelines:libraryVariables", {}, (res) => {
			if (res.variables) variables = res.variables
		})
	)

	/* ── the rows ───────────────────────────────────────────────────── */

	const editable = $derived(view?.editable !== false)
	const labelOf = (variableId: string) =>
		view?.rows?.find((r) => r.variableId === variableId)?.variableLabel ??
		variables.find((v) => v.variableId === variableId)?.label ??
		variableId

	type Entry = {
		variableId: string
		label: string
		/** What is written now: the layout's name, else its reference. */
		layoutName: string
		isReference: boolean
		pubName: string | null
		state: "same" | "changed" | "removed" | "added"
		savedRef: string | null
	}
	const entries = $derived.by((): Entry[] => {
		const out: Entry[] = []
		for (const r of view?.rows ?? []) {
			const d = draft[r.variableId]
			const state =
				!editable || d === r.reference
					? "same"
					: d === undefined
						? "removed"
						: "changed"
			const showRef = state === "changed" ? d : r.reference
			const nameOf =
				state === "changed" ? names[d!] : (r.layoutName ?? undefined)
			out.push({
				variableId: r.variableId,
				label: r.variableLabel,
				layoutName: nameOf ?? showRef,
				isReference: !nameOf,
				pubName: r.pubLayout?.name ?? null,
				state,
				savedRef: r.reference
			})
		}
		if (editable) {
			const have = new Set(out.map((e) => e.variableId))
			for (const [variableId, ref] of Object.entries(draft)) {
				if (have.has(variableId)) continue
				out.push({
					variableId,
					label: labelOf(variableId),
					layoutName: names[ref] ?? ref,
					isReference: !names[ref],
					pubName:
						variables.find((v) => v.variableId === variableId)
							?.inUse?.name ?? null,
					state: "added",
					savedRef: null
				})
			}
		}
		return out
	})

	function remove(e: Entry) {
		const { [e.variableId]: _gone, ...rest } = draft
		draft = rest
	}
	function putBack(e: Entry) {
		if (e.savedRef === null) return remove(e)
		draft = { ...draft, [e.variableId]: e.savedRef }
	}

	/* ── Save ───────────────────────────────────────────────────────── */

	export function saveSteps(): SaveStep[] {
		const now = $state.snapshot(draft) as Record<string, string>
		const was = saved
		const ids = [...Object.keys(was), ...Object.keys(now)].filter(
			(id, i, all) => all.indexOf(id) === i
		)
		return ids
			.filter((id) => (now[id] ?? null) !== (was[id] ?? null))
			.map((variableId) => ({
				label: `Variable layouts: ${labelOf(variableId)}`,
				run: () =>
					awaitReply({
						errorEvent: "pipelines:setPresetVariableLayout:error",
						socket,
						event: "pipelines:setPresetVariableLayout",
						params: {
							presetId,
							variableId,
							reference: now[variableId] ?? null
						},
						match: (r) => r.presetId === presetId
					})
			}))
	}

	/* ── Change a variable's layout ─────────────────────────────────── */

	let panelOpen = $state(false)
	let pickedVariableId = $state<string | null>(null)
	let pickedVariable = $state<LayoutVariable | null>(null)
	let pickError = $state<string | null>(null)
	let reloadTick = $state(0)

	const offered = $derived(
		variables
			.filter(
				(v) =>
					v.layoutCount > 0 &&
					(view?.candidates ?? []).includes(v.variableId)
			)
			.map((v) => ({
				value: v.variableId,
				label: v.label,
				group: v.shelfLabel
			}))
	)

	function openPanel() {
		panelOpen = true
		pickedVariableId = null
		pickedVariable = null
		pickError = null
	}
	function closePanel() {
		panelOpen = false
		pickedVariableId = null
		pickedVariable = null
		pickError = null
	}

	$effect(() => {
		const variableId = pickedVariableId
		void reloadTick
		if (!panelOpen || !variableId) return
		return requestWithInterest(
			"pipelines:libraryVariable",
			{ variableId },
			(res) => {
				if (res.error) {
					pickError = res.error
					return
				}
				if (res.variable?.variableId !== variableId) return
				pickError = null
				pickedVariable = res.variable
			}
		)
	})
	useInterest<"pipelines:libraryVariable:error">(
		"pipelines:libraryVariable:error",
		(res) => {
			if (panelOpen && pickedVariableId && res.error)
				pickError = res.error
		}
	)

	function pick(r: LayoutRow) {
		if (!pickedVariableId || !r.reference) return
		draft = { ...draft, [pickedVariableId]: r.reference }
		names = { ...names, [r.reference]: r.name }
		closePanel()
	}

	/* ── a person's older layout: give it a reference ───────────────── */

	let libraryTemplates = $state<Sockets.Pipelines.Library.LibraryTemplate[]>(
		[]
	)
	const needsReference = $derived(
		!!pickedVariable?.rows.some((r) => r.reference === null)
	)
	$effect(() => {
		if (!needsReference) return
		return requestWithInterest("pipelines:library", {}, (res) => {
			libraryTemplates = res.variableTemplates ?? []
		})
	})
	const suggestedOwner = $derived(lastOwnerSlug(libraryTemplates))
	let ownerTyped = $state<Record<number, string>>({})
	const ownerOf = (id: number) => ownerTyped[id] ?? suggestedOwner
	let stamping = $state<number | null>(null)
	let stampErrors = $state<Record<number, string>>({})

	function stamp(r: LayoutRow) {
		const ownerSlug = ownerOf(r.id).trim()
		const problem = ownerSlugProblem(ownerSlug)
		if (problem) {
			stampErrors = { ...stampErrors, [r.id]: problem }
			return
		}
		const { [r.id]: _c, ...rest } = stampErrors
		stampErrors = rest
		stamping = r.id
		socket.emit("pipelines:stampVariableTemplateReference", {
			templateId: r.id,
			ownerSlug
		})
	}
	useInterest<"pipelines:stampVariableTemplateReference">(
		"pipelines:stampVariableTemplateReference",
		(res) => {
			if (stamping === null || res.templateId !== stamping) return
			stamping = null
			reloadTick += 1
		}
	)
	useInterest<"pipelines:stampVariableTemplateReference:error">(
		"pipelines:stampVariableTemplateReference:error",
		(res) => {
			if (stamping === null) return
			stampErrors = {
				...stampErrors,
				[stamping]: res.error ?? "The reference was not given."
			}
			stamping = null
		}
	)
</script>

<AdminFieldset
	id="variable-layouts"
	title="Variable layouts"
	description="How this preset's sessions write out a variable, where it differs from the pub's choice."
>
	{#if loadError}
		<p class="text-error-600-400 text-sm" role="alert">{loadError}</p>
	{/if}

	{#if !entries.length && !view?.dangling?.length}
		<p class="text-surface-600-400 text-sm">
			Uses the pub's layout for every variable.
		</p>
	{/if}

	{#if entries.length}
		<ul
			class="flex flex-col gap-2"
			aria-label="Variable layouts of this preset"
		>
			{#each entries as e (e.variableId)}
				<li
					class="bg-surface-50-950 rounded-base flex flex-wrap items-center gap-x-3 gap-y-1 p-3"
					data-preset-variable-layout={e.variableId}
				>
					<span class="text-sm font-medium">{e.label}</span>
					{#if e.state === "removed"}
						<span class="text-surface-600-400 text-sm">
							Removed — waiting for Save
						</span>
						<button
							type="button"
							class="btn btn-sm preset-tonal-surface ml-auto"
							onclick={() => putBack(e)}
						>
							Put back
							<span class="sr-only">{e.label}</span>
						</button>
					{:else}
						<span
							class="text-sm {e.isReference
								? 'font-mono text-xs'
								: ''}"
						>
							{e.layoutName}
						</span>
						{#if e.pubName}
							<span class="text-surface-600-400 text-xs">
								(pub's: {e.pubName})
							</span>
						{/if}
						{#if e.state === "changed" || e.state === "added"}
							<span
								class="preset-tonal-surface rounded-full px-2 py-0.5 text-xs"
							>
								Waiting for Save
							</span>
						{/if}
						{#if editable}
							<span class="ml-auto flex gap-2">
								{#if e.state === "changed"}
									<button
										type="button"
										class="btn btn-sm preset-tonal-surface"
										onclick={() => putBack(e)}
									>
										Put back
										<span class="sr-only">{e.label}</span>
									</button>
								{/if}
								<button
									type="button"
									class="btn btn-sm hover:preset-tonal-surface"
									onclick={() => remove(e)}
								>
									Remove
									<span class="sr-only">{e.label}</span>
								</button>
							</span>
						{/if}
					{/if}
				</li>
			{/each}
		</ul>
	{/if}

	{#each view?.dangling ?? [] as d (d.variableId)}
		<p
			class="text-warning-700-300 flex items-start gap-1.5 text-xs"
			data-dangling-variable-layout={d.variableId}
		>
			<Icons.TriangleAlert
				size={14}
				class="mt-0.5 shrink-0"
				aria-hidden="true"
			/>
			<!-- prettier-ignore -->
			<span>{labelOf(d.variableId)} names <span class="font-mono">{d.reference}</span>{DANGLING_TAIL}
			</span>
		</p>
	{/each}

	{#if !editable}
		<p class="text-surface-600-400 text-xs italic">
			This preset ships with Serene Pub or a plugin, and updates replace
			it. Clone it to change its variable layouts.
		</p>
	{:else if !panelOpen}
		<div>
			<button
				type="button"
				class="btn btn-sm preset-tonal-surface"
				onclick={openPanel}
			>
				Change a variable's layout
			</button>
		</div>
	{:else}
		<section
			class="border-surface-200-800 rounded-base flex flex-col gap-3 border p-3"
			aria-labelledby="{uid}-panel"
			data-variable-layout-panel
		>
			<h3 id="{uid}-panel" class="text-sm font-medium">
				Change a variable's layout
			</h3>
			<div class="max-w-sm">
				<Select
					label="Variable"
					options={offered}
					value={pickedVariableId}
					onValueChange={(v) => {
						pickedVariableId = v || null
						pickedVariable = null
						pickError = null
					}}
				/>
			</div>
			{#if pickError}
				<p class="text-error-600-400 text-xs" role="alert">
					{pickError}
				</p>
			{/if}
			{#if pickedVariable}
				<ul
					class="flex flex-col gap-2"
					aria-label="Layouts of this variable"
				>
					{#each pickedVariable.rows as r (r.id)}
						<li
							class="bg-surface-50-950 rounded-base flex flex-col gap-1.5 p-3"
							data-layout-choice={r.id}
						>
							<div
								class="flex flex-wrap items-center gap-x-3 gap-y-1"
							>
								{#if r.reference}
									<button
										type="button"
										class="btn btn-sm preset-tonal-surface"
										aria-pressed={draft[
											pickedVariableId ?? ""
										] === r.reference}
										onclick={() => pick(r)}
									>
										{r.name}
									</button>
								{:else}
									<span class="text-sm font-medium">
										{r.name}
									</span>
								{/if}
								<span class="text-surface-600-400 text-xs">
									{r.ownerLabel}
								</span>
								{#if r.inUse}
									<span class="text-surface-600-400 text-xs">
										the pub's
									</span>
								{/if}
							</div>
							<VariableLayoutPreview
								preview={r.preview}
								error={r.previewError}
							/>
							{#if r.reference === null}
								<div class="flex flex-col gap-1.5">
									<p class="text-surface-600-400 text-xs">
										Give it a reference to pick it.
									</p>
									<div class="flex flex-wrap items-end gap-2">
										<label
											class="flex flex-col gap-1 text-xs"
										>
											<span class="font-medium">
												Owner slug
											</span>
											<input
												class="input rounded-base w-48 font-mono"
												type="text"
												value={ownerOf(r.id)}
												oninput={(ev) =>
													(ownerTyped = {
														...ownerTyped,
														[r.id]: ev.currentTarget
															.value
													})}
											/>
										</label>
										<button
											type="button"
											class="btn btn-sm preset-tonal-surface"
											disabled={stamping === r.id}
											onclick={() => stamp(r)}
										>
											Give it a reference
										</button>
									</div>
									{#if stampErrors[r.id]}
										<p
											class="text-error-600-400 text-xs"
											role="alert"
										>
											{stampErrors[r.id]}
										</p>
									{/if}
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
			<div>
				<button
					type="button"
					class="btn btn-sm preset-tonal-surface"
					onclick={closePanel}
				>
					Cancel
				</button>
			</div>
		</section>
	{/if}
</AdminFieldset>
