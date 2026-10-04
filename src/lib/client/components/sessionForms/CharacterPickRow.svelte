<script lang="ts">
	/**
	 * One character in a session form's pickers — the cast list ("Characters")
	 * and the "Who you play as" list read the same row, so the two pickers look
	 * and behave alike (note 33, 2026-10-02): avatar, name with its persona and
	 * favourite glyphs, the description line, the first tag chip.
	 *
	 * `kind` is the only difference: the cast is a set (a checkbox), the seat
	 * is one person (a radio). Both are native inputs inside the row's label,
	 * so the whole row is the target and the keyboard behaves as the browser's
	 * own checkbox / radio group does.
	 *
	 * Avatar: today's `Avatar` at 40px, matching the Characters list row.
	 * The shell lane's shared Avatar replaces it when it lands.
	 */
	import * as Icons from "@lucide/svelte"
	import Avatar from "../Avatar.svelte"

	type Row = Sockets.Characters.List.Response["characterList"][number] & {
		id: number
	}

	interface Props {
		character: Row
		kind: "checkbox" | "radio"
		checked: boolean
		/** The radio group's name; ignored for a checkbox. */
		group?: string
		onchange: () => void
	}

	let { character, kind, checked, group, onchange }: Props = $props()

	const label = $derived(
		character.nickname || character.name || "Unnamed character"
	)

	/** The row's tags, coloured from the payload (as the Characters list). */
	const tags = $derived(
		((character as any).characterTags ?? [])
			.map((ct: any) => ct?.tag)
			.filter(Boolean) as Array<{ name: string; colorPreset?: string }>
	)
</script>

<label
	class="hover:bg-surface-200-800 flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-[10px] px-2 py-1.5 {checked
		? 'sidebar-row-active'
		: ''}"
>
	{#if kind === "checkbox"}
		<input
			type="checkbox"
			class="checkbox shrink-0"
			{checked}
			{onchange}
		/>
	{:else}
		<input
			type="radio"
			class="radio shrink-0"
			name={group}
			{checked}
			{onchange}
		/>
	{/if}
	<Avatar char={character} size="md" decorative />
	<span class="min-w-0 flex-1">
		<span class="flex items-center gap-1 text-[15px] font-medium">
			<span class="truncate">{label}</span>
			{#if character.isFavorite}
				<Icons.Star
					size={14}
					class="text-primary-500 shrink-0 fill-current"
					aria-hidden="true"
				/>
				<span class="sr-only">Favorite</span>
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
				<span class="sr-only">
					{character.isDefaultPersona ? "Default persona" : "Persona"}
				</span>
			{/if}
		</span>
		{#if character.description}
			<span class="text-surface-600-400 block truncate text-xs">
				{character.description}
			</span>
		{/if}
	</span>
	{#if tags.length > 0}
		<span class="flex shrink-0 items-center gap-1">
			<span
				class="max-w-24 truncate rounded px-1.5 py-0.5 text-[11px] {tags[0]
					.colorPreset ||
					'bg-primary-500/20 text-primary-600 dark:text-primary-400'}"
			>
				{tags[0].name}
			</span>
			{#if tags.length > 1}
				<span class="text-surface-600-400 text-[11px]">
					+{tags.length - 1}
				</span>
			{/if}
		</span>
	{/if}
</label>
