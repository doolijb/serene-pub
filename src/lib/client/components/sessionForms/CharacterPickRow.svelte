<script lang="ts" module>
	/** A `characters:list` row, or the subset a select dialog is handed. */
	type Row = Partial<SelectCharacter> & { id: number }

	type RowTag = { name: string; colorPreset?: string }

	/** A row's tags, coloured from the payload (as the Characters list). */
	function rowTags(character: Partial<SelectCharacter>): RowTag[] {
		return ((character as any).characterTags ?? [])
			.map((ct: any) => ct?.tag)
			.filter(Boolean) as RowTag[]
	}

	/**
	 * Whether a picker's search term matches what a row shows: the name (or
	 * nickname), the description, a tag. Every picker drawn with this row
	 * searches through it, so a match always has something on the row to
	 * explain it.
	 */
	export function pickRowMatches(
		character: Partial<SelectCharacter>,
		term: string
	): boolean {
		const needle = term.trim().toLowerCase()
		if (!needle) return true
		return [
			character.name,
			character.nickname,
			character.description,
			...rowTags(character).map((tag) => tag.name)
		].some((text) => !!text && text.toLowerCase().includes(needle))
	}
</script>

<script lang="ts">
	/**
	 * One character in a session form's pickers and selected lists — the cast
	 * ("Characters"), "Who you play as", and the select dialogs that add to
	 * them read the same row, so they look and behave alike (note 33,
	 * 2026-10-02): avatar, name with its persona and favourite glyphs, the
	 * description line, the first tag chip.
	 *
	 * `kind` says what pressing the row does:
	 * - `checkbox` — one of a set: a native checkbox inside the row's label, so
	 *   the whole row is the target and the keyboard behaves as the browser's
	 *   own checkbox does.
	 * - `button` — a press picks it (a single-pick dialog).
	 * - `chosen` — one already chosen, in a selected list. The row itself does
	 *   nothing and drops the tag chip; its controls (reorder, remove, change)
	 *   come in `actions` and sit beside the row's content, never inside an
	 *   interactive (STYLE-GUIDE §9).
	 *
	 * The input or button is named by the character's name alone; the glyphs
	 * and the description describe it.
	 *
	 * Avatar: today's `Avatar` at 40px, matching the Characters list row.
	 * The shell lane's shared Avatar replaces it when it lands.
	 */
	import type { Snippet } from "svelte"
	import * as Icons from "@lucide/svelte"
	import Avatar from "../Avatar.svelte"
	import { characterSummary } from "$lib/shared/characters/characterSummary"

	interface Props {
		character: Row
		kind: "checkbox" | "button" | "chosen"
		/** `checkbox` only: ticked. */
		checked?: boolean
		/** An unticked checkbox at a picker's limit. */
		disabled?: boolean
		/** The input's change, or the button's press. `chosen` has none. */
		onchange?: () => void
		/** `chosen` only: the row's own controls, at its right. */
		actions?: Snippet
	}

	let {
		character,
		kind,
		checked = false,
		disabled = false,
		onchange,
		actions
	}: Props = $props()

	const uid = $props.id()
	const nameId = `${uid}-name`

	const label = $derived(
		character.nickname || character.name || "Unnamed character"
	)

	const tags = $derived(rowTags(character))
	const showTags = $derived(tags.length > 0 && kind !== "chosen")

	/** What describes the row beyond its name: the marks, the line, the tags. */
	const describedBy = $derived(
		[
			character.isFavorite && `${uid}-favorite`,
			character.isPersona && `${uid}-persona`,
			character.description && `${uid}-description`,
			showTags && `${uid}-tags`
		]
			.filter(Boolean)
			.join(" ") || undefined
	)

	const ROW =
		"flex min-h-11 w-full items-center gap-2.5 rounded-base px-2 py-1.5"
</script>

{#snippet body()}
	<Avatar char={character} size="md" decorative />
	<span class="min-w-0 flex-1 text-left">
		<span class="flex items-center gap-1 text-lead font-medium">
			<span id={nameId} class="truncate">{label}</span>
			{#if character.isFavorite}
				<Icons.Star
					size={14}
					class="text-primary-500 shrink-0 fill-current"
					aria-hidden="true"
				/>
				<span id="{uid}-favorite" class="sr-only">Favorite</span>
			{/if}
			{#if character.isPersona}
				<span
					class="inline-flex shrink-0"
					title={character.isDefaultPersona
						? "Default persona"
						: "Persona"}
				>
					<Icons.UserRound
						size={14}
						class="text-primary-500 {character.isDefaultPersona
							? 'fill-current'
							: ''}"
						aria-hidden="true"
					/>
				</span>
				<span id="{uid}-persona" class="sr-only">
					{character.isDefaultPersona ? "Default persona" : "Persona"}
				</span>
			{/if}
		</span>
		{#if character.description}
			<span
				id="{uid}-description"
				class="text-surface-600-400 block truncate text-xs"
			>
				{characterSummary(character)}
			</span>
		{/if}
	</span>
	{#if showTags}
		<span id="{uid}-tags" class="flex shrink-0 items-center gap-1">
			<span
				class="max-w-24 truncate rounded px-1.5 py-0.5 text-meta {tags[0]
					.colorPreset ||
					'bg-primary-500/20 text-primary-ink'}"
			>
				{tags[0].name}
			</span>
			{#if tags.length > 1}
				<span class="text-surface-600-400 text-meta">
					+{tags.length - 1}
				</span>
			{/if}
		</span>
	{/if}
{/snippet}

{#if kind === "chosen"}
	<div class="panel-edge {ROW} border">
		{@render body()}
		{#if actions}
			<span class="flex shrink-0 items-center gap-1">
				{@render actions()}
			</span>
		{/if}
	</div>
{:else if kind === "button"}
	<button
		type="button"
		class="hover:bg-surface-200-800 {ROW}"
		aria-labelledby={nameId}
		aria-describedby={describedBy}
		onclick={onchange}
	>
		{@render body()}
	</button>
{:else}
	<label
		class="{ROW} {disabled
			? 'cursor-not-allowed opacity-60'
			: 'hover:bg-surface-200-800 cursor-pointer'} {checked
			? 'sidebar-row-active'
			: ''}"
	>
		<input
			type="checkbox"
			class="checkbox shrink-0"
			aria-labelledby={nameId}
			aria-describedby={describedBy}
			{checked}
			{disabled}
			{onchange}
		/>
		{@render body()}
	</label>
{/if}
