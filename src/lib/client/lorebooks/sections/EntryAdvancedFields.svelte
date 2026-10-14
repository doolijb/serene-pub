<script lang="ts">
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { getContext, type Snippet } from "svelte"
	import { Switch } from "@skeletonlabs/skeleton-svelte"
	import { Priorities } from "$lib/shared/constants/Priorities"
	import EntryConditionField from "$lib/client/components/lorebookForms/EntryConditionField.svelte"
	import { readsAsRegex } from "$lib/shared/entries/runawayPattern"

	/**
	 * Level two of the editor's two levels of disclosure, shared by every
	 * entry door: one fold, named for what is in it — the matching settings.
	 * The entry's state (Pinned, Off, Archive) is the editor header's ⋯,
	 * never this fold.
	 *
	 * ⚠ **One fold, in the same place, whatever is set.** A disclosure that
	 * moves or disappears with its contents teaches the reader the controls
	 * come and go, so this is always drawn and always here — under the fields
	 * every entry has, above the account of what the run did.
	 *
	 * ⚠ **Nothing here hides when vectorization is on** — not Use regex, Case
	 * sensitive or Priority. The keyword mechanism runs for every entry beside
	 * the semantic one — there is no per-entry retrieval strategy (see the entry
	 * table in `schema.ts`) — and the ranker adds the priority bonus either
	 * way. A hidden control that still changes matching is a setting nobody
	 * can see or undo.
	 */
	interface Props {
		draft: Record<string, any>
		/** Distinguishes this instance's inputs from a sibling editor's. */
		idPrefix: string
		vectorizationEnabled: boolean
		/** Only the kinds that declare a priority role show one. */
		showPriority?: boolean
		/** Fields this door adds to level two, and nowhere else. */
		extra?: Snippet
	}

	let {
		draft = $bindable(),
		idPrefix,
		vectorizationEnabled,
		showPriority = true,
		extra
	}: Props = $props()

	/**
	 * Use regex shows the mode the MATCHER reads (`readsAsRegex`, the same
	 * precedence as `ranking/signals.ts` `modeOf`): a stored `matchMode` wins
	 * over the `useRegex` flag. A SillyTavern import sets `matchMode`, and a
	 * switch drawn from `useRegex` alone could say on while the matcher read
	 * whole words — or flip with no effect at all.
	 */
	let regexOn = $derived(readsAsRegex(draft))

	/**
	 * Writes both columns so they agree: turning regex on or off clears a
	 * stored `matchMode`, leaving `useRegex` the one thing that decides. Whole
	 * words and regex are exclusive, so either way a stored `word` goes.
	 */
	function setRegex(on: boolean) {
		draft.useRegex = on
		if (draft.matchMode != null) draft.matchMode = null
	}

	/**
	 * Admins get a way to the cap. The cap itself is a pipeline setting
	 * resolved per session (pipeline, then config, then the session), so an
	 * entry has no one cap to read here; the note says what it does instead,
	 * and the link goes to the pipelines where it is set.
	 */
	const userCtx = getContext<UserCtx | undefined>("userCtx")
	const isAdmin = $derived(!!userCtx?.user?.isAdmin)

	const switchClass =
		"preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
</script>

<details>
	<summary class="cursor-pointer text-sm font-semibold">
		Regex, case, keyword chains, priority, conditions
	</summary>
	<div class="mt-2 flex flex-col gap-3 text-sm">
		{#if vectorizationEnabled}
			<p class="text-surface-600-400 text-xs">
				Use regex and Case sensitive apply to keyword matching, which
				still runs beside Search by meaning.
			</p>
		{/if}
		<Switch
			name="{idPrefix}Regex"
			checked={regexOn}
			onCheckedChange={(e) => setRegex(e.checked)}
			class="flex w-full items-center justify-between gap-2"
		>
			<Switch.Label>Use regex</Switch.Label>
			<Switch.Control class={switchClass}>
				<Switch.Thumb />
			</Switch.Control>
			<Switch.HiddenInput />
		</Switch>
		{#if draft.matchMode === "word"}
			<!-- The one mode the editor has no switch for: an imported file's
			     whole-word flag. Said, and undoable, rather than silent. -->
			<p
				class="text-surface-600-400 flex flex-wrap items-baseline gap-x-2 text-xs"
			>
				Keys match whole words only, as the imported file set.
				<button
					type="button"
					class="anchor"
					onclick={() => (draft.matchMode = null)}
				>
					Match anywhere
				</button>
			</p>
		{/if}
		<Switch
			name="{idPrefix}Case"
			checked={draft.caseSensitive || false}
			onCheckedChange={(e) => (draft.caseSensitive = e.checked)}
			class="flex w-full items-center justify-between gap-2"
		>
			<Switch.Label>Case sensitive</Switch.Label>
			<Switch.Control class={switchClass}>
				<Switch.Thumb />
			</Switch.Control>
			<Switch.HiddenInput />
		</Switch>
		<div class="flex w-full items-center justify-between gap-2">
			<!-- The visible text is the row's caption; Select carries the real
			     (sr-only) label so the row keeps its side-by-side layout. -->
			<!-- "Pull this one in", not "pull in": the depth is how deep in a
			     keyword chain THIS entry may still be found (`keywordQuery`:
			     "about being found, not about finding"). -->
			<span aria-hidden="true">Let other entries pull this one in</span>
			<Select
				label="Let other entries pull this one in"
				labelHidden
				class="w-48 max-w-xs text-sm"
				options={[
					{ value: "", label: "Use pipeline default" },
					{ value: "0", label: "No, the conversation only" },
					{ value: "1", label: "1 level deep" },
					{ value: "2", label: "2 levels deep" },
					{ value: "3", label: "3 levels deep" }
				]}
				value={String(draft.recursionDepth ?? "")}
				onValueChange={(v) => {
					// "" is not 0. Empty means the entry has no opinion and the
					// pipeline's ceiling decides, which is a different answer
					// from "session only" and has to survive as null.
					draft.recursionDepth = v === "" ? null : Number(v)
				}}
			/>
		</div>
		<!-- The entry's depth can only LOWER the pipeline's ceiling
		     (`keywordQuery`: level > entry depth ?? ceiling), and the ceiling
		     is 0 until someone raises it, so every choice here reads as dead
		     unless this says why. The options stay enabled: the ceiling is a
		     per-session pipeline setting no entry can read (less-confusing
		     G7). -->
		<p class="text-surface-600-400 -mt-2 text-xs">
			These do nothing until an admin raises “Follow keyword chains this
			deep” in the pipeline's settings. It is 0 by default.
			{#if isAdmin}
				<a class="anchor" href="/admin/pipelines">Open Admin › Pipelines</a>
			{/if}
		</p>
		<EntryConditionField
			bind:selectiveLogic={draft.selectiveLogic}
			bind:secondaryKeys={draft.secondaryKeys}
			regex={regexOn}
			{idPrefix}
		/>
		<!-- Pinned and Off are not here: they are the entry's state, not
		     expert settings, and live in the editor header's ⋯ beside
		     Archive (DESIGN-ux-simplification A.6). -->
		{#if showPriority}
			<div class="flex w-full items-center justify-between gap-2">
				<span aria-hidden="true" class:opacity-50={draft.constant}>
					Priority
				</span>
				<Select
					label="Priority"
					labelHidden
					class="w-48 max-w-xs text-sm"
					options={Priorities.map((p) => ({
						value: String(p.value),
						label: p.label
					}))}
					value={draft.priority == null ? "" : String(draft.priority)}
					disabled={draft.constant || false}
					onValueChange={(v) => {
						// Priorities are numbers; a clear leaves the stored one.
						if (v) draft.priority = Number(v)
					}}
				/>
			</div>
			{#if draft.constant}
				<!-- The switch that disables Priority is in the ⋯, out of
				     sight from here, so the fold says why. -->
				<p class="text-surface-600-400 -mt-2 text-xs">
					Pinned, in the ⋯ menu: always read in, so priority does not
					apply.
				</p>
			{/if}
		{/if}
		{@render extra?.()}
	</div>
</details>
