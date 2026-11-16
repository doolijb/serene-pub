<script lang="ts">
	import * as Icons from "@lucide/svelte"
	import type { BindingWithRelations } from "$lib/client/components/lorebookForms/entryManager"
	import LoreContentField from "$lib/client/components/lorebookForms/LoreContentField.svelte"
	import KeywordChips from "../editor/KeywordChips.svelte"
	import PartOfField from "../editor/PartOfField.svelte"
	import { getLorePoolCtx } from "./poolContext"
	import { readsAsRegex } from "$lib/shared/entries/runawayPattern"
	import type { ZoneField } from "../time/entryVersions"
	import {
		DIFFERS_BY_VERSION_LABEL,
		SAME_EVERYWHERE_CONFIRM,
		SAME_EVERYWHERE_LABEL,
		getVersionZones,
		sameEverywhereQuestion
	} from "../time/versionZones"

	/**
	 * Level one of the editor: the fields every entry door asks for, in the
	 * order they are read — name, what it says, what reaches it, where it is
	 * filed.
	 *
	 * Fields that differ by version draw here, under Name and Content: the
	 * form's entry row holds Keywords, Part of, Pinned and Off while they are
	 * the entry's (`zones.entryZoneRow`); a form with no row (History) draws
	 * Keywords and Part of here always.
	 *
	 * Name is shown only by the doors whose kind declares a title role —
	 * History is not named, it is dated, and its heading is the date. Keywords
	 * are shown whatever the instance does, because the keyword mechanism runs
	 * whether or not an embedding model is loaded; what changes with the model
	 * is the hint, which is a claim about semantic matching and is only made
	 * where semantic matching is actually happening.
	 */
	interface Props {
		draft: Record<string, any>
		idPrefix: string
		bindings: BindingWithRelations[]
		vectorizationEnabled: boolean
		showName?: boolean
		namePlaceholder?: string
	}

	let {
		draft = $bindable(),
		idPrefix,
		bindings = $bindable(),
		vectorizationEnabled,
		showName = true,
		namePlaceholder = ""
	}: Props = $props()

	const poolCtx = getLorePoolCtx()
	const zones = getVersionZones()

	/** Keywords and Part of leave this form while the entry row holds them. */
	const drawn = (f: ZoneField) =>
		!zones?.entryZoneRow || zones.zoneOf(f) === "version"
	const differs = (f: ZoneField) =>
		!!zones?.railed && zones.zoneOf(f) === "version"
	const answer = (f: ZoneField) => zones?.sameEverywhere(f)

	/** The field whose confirmation is open, if any. */
	let asking = $state<ZoneField | null>(null)
</script>

{#snippet markToggle(
	on: boolean,
	Icon: typeof Icons.Pin,
	label: string,
	hint: string,
	mark: string,
	toggle: () => void
)}
	<!-- An entry mark as a toggle: `preset-pressed` with `aria-pressed` while
	     ON (STYLE-GUIDE §2.4), the check saying it without colour. -->
	<button
		class="btn btn-sm w-full justify-start {on
			? 'preset-pressed'
			: 'preset-tonal-surface'}"
		type="button"
		aria-pressed={on}
		data-lore-mark={mark}
		onclick={toggle}
	>
		<Icon size={14} aria-hidden="true" />
		<span>{label}</span>
		<span class="text-meta ml-auto font-normal opacity-75">{hint}</span>
		<Icons.Check
			size={14}
			class="shrink-0 {on ? '' : 'invisible'}"
			aria-hidden="true"
		/>
	</button>
{/snippet}

{#snippet sameEverywhere(field: ZoneField)}
	{@const a = answer(field)}
	<div class="flex flex-col gap-1 text-xs" data-lore-differs={field}>
		<span class="text-surface-700-300">{DIFFERS_BY_VERSION_LABEL}</span>
		{#if a && "blocked" in a}
			<button
				type="button"
				class="text-surface-700-300 min-h-11 self-start text-left underline disabled:no-underline disabled:opacity-60"
				disabled
				title={a.blocked}
			>
				{SAME_EVERYWHERE_LABEL}
			</button>
			<span class="text-surface-700-300">{a.blocked}</span>
		{:else if a && asking === field}
			<div
				class="flex flex-col gap-2"
				role="group"
				aria-label={SAME_EVERYWHERE_LABEL}
			>
				<p>{sameEverywhereQuestion(a.count)}</p>
				<div class="flex gap-2">
					<button
						type="button"
						class="btn btn-sm preset-tonal-warning"
						onclick={() => {
							a.run()
							asking = null
						}}
					>
						{SAME_EVERYWHERE_CONFIRM}
					</button>
					<button
						type="button"
						class="btn btn-sm preset-tonal-surface"
						onclick={() => (asking = null)}
					>
						Cancel
					</button>
				</div>
			</div>
		{:else}
			<button
				type="button"
				class="text-surface-700-300 min-h-11 self-start text-left underline"
				onclick={() => {
					// Nothing dated to remove: there is nothing to confirm.
					if (a && a.count === 0) a.run()
					else asking = field
				}}
			>
				{SAME_EVERYWHERE_LABEL}
			</button>
		{/if}
	</div>
{/snippet}

{#if showName}
	<div class="flex flex-col gap-1">
		<label
			class="flex items-center gap-1 text-sm font-semibold"
			for="{idPrefix}Name"
		>
			Name <span class="text-error-600-400">*</span>
			<Icons.ScanEye
				size={13}
				class="text-surface-600-400 relative top-[1px]"
			/>
		</label>
		<input
			id="{idPrefix}Name"
			class="input preset-filled-surface-200-800 w-full rounded-lg"
			type="text"
			bind:value={draft.name}
			placeholder={namePlaceholder}
			required
		/>
	</div>
{/if}

<!-- `data-lore-field` names the fields a Loose ends row opens focused
     (`looseEnds.ts`): content, keywords, and History's date. -->
<div class="flex flex-col gap-1" data-lore-field="content">
	<!-- A span, not a label: the editor is a contenteditable div, which a
	     label cannot target. It names the editor through aria-labelledby. -->
	<span
		class="flex items-center gap-1 text-sm font-semibold"
		id="{idPrefix}ContentLabel"
	>
		Content
		<Icons.ScanEye
			size={13}
			class="text-surface-600-400 relative top-[1px]"
			aria-hidden="true"
		/>
	</span>
	<LoreContentField
		bind:content={draft.content}
		bind:lorebookBindingList={bindings as any}
		labelledBy="{idPrefix}ContentLabel"
	/>
</div>

{#if drawn("keys")}
	<div class="contents" data-lore-field="keywords">
		<KeywordChips
			bind:keys={draft.keys}
			{idPrefix}
			regex={readsAsRegex(draft)}
			semantic={vectorizationEnabled}
		/>
	</div>
	{#if differs("keys")}{@render sameEverywhere("keys")}{/if}
{/if}

{#if drawn("anchorEntryId")}
	<PartOfField
		bind:draft
		pool={poolCtx.pool}
		newRowBranchId={poolCtx.newRowBranchId}
		{idPrefix}
	/>
	{#if differs("anchorEntryId")}{@render sameEverywhere("anchorEntryId")}{/if}
{/if}

{#if differs("constant")}
	{@render markToggle(
		!!draft.constant,
		Icons.Pin,
		"Pinned",
		"Always in the prompt",
		"pinned",
		() => (draft.constant = !draft.constant)
	)}
	{@render sameEverywhere("constant")}
{/if}

{#if differs("enabled")}
	{@render markToggle(
		draft.enabled === false,
		Icons.Ghost,
		"Off",
		"Out of every prompt",
		"off",
		() => (draft.enabled = draft.enabled === false)
	)}
	{@render sameEverywhere("enabled")}
{/if}
