<script lang="ts">
	/**
	 * **Use in…** — a model's loadouts menu (DESIGN-image-generation §14).
	 *
	 * Replaces the direct "make default" press on a model's row and in its
	 * detail: a model is put IN a loadout, and the menu names which. Per job
	 * the model can do, the default loadout first with its gold mark, then the
	 * others by name, each with its state in words; *Open Loadouts* last.
	 * Which loadouts, in which order and with which words is `useInMenu.ts`;
	 * this file only draws them and hands the pick back.
	 */
	import * as Icons from "@lucide/svelte"
	import { Menu, Portal } from "@skeletonlabs/skeleton-svelte"
	import type { UseInGroup, UseInItem } from "./useInMenu"

	interface Props {
		groups: readonly UseInGroup[]
		/** The model's name, for the trigger's accessible label. */
		modelName: string
		/** The trigger's look: the row's quiet chip, or a full-width button. */
		variant?: "row" | "block"
		disabled?: boolean
		/** Why the trigger is disabled, said as its title. */
		disabledReason?: string | null
		onPick: (item: UseInItem) => void
		/** The Loadouts view, on one loadout when the menu has one. */
		onOpenLoadouts?: (loadoutId?: number) => void
	}
	let {
		groups,
		modelName,
		variant = "row",
		disabled = false,
		disabledReason = null,
		onPick,
		onOpenLoadouts
	}: Props = $props()

	const items = $derived(groups.flatMap((g) => g.items))

	function select(value: string) {
		if (value === "open") {
			onOpenLoadouts?.(items[0]?.id)
			return
		}
		const item = items.find((i) => `loadout:${i.id}` === value)
		if (item && !item.current) onPick(item)
	}

	const triggerClass = $derived(
		variant === "row"
			? "btn btn-sm preset-tonal-surface mr-0.5 shrink-0 text-meta font-semibold opacity-100 disabled:cursor-not-allowed @min-[900px]/view:opacity-0 @min-[900px]/view:group-focus-within:opacity-100 @min-[900px]/view:group-hover:opacity-100 data-[state=open]:opacity-100"
			: "btn preset-tonal-surface w-full"
	)
	const menuItem =
		"hover:bg-surface-200-800 data-[highlighted]:bg-surface-200-800 flex min-h-9 cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-chip"
</script>

<Menu onSelect={(details) => select(details.value)}>
	<Menu.Trigger
		class={triggerClass}
		{disabled}
		aria-label={disabledReason
			? `Use ${modelName} in… — ${disabledReason}`
			: `Use ${modelName} in…`}
		title={disabledReason ?? `Use ${modelName} in a loadout`}
	>
		{#if variant === "block"}
			<Icons.Combine size={14} aria-hidden="true" />
		{/if}
		Use in…
	</Menu.Trigger>
	<Portal>
		<Menu.Positioner class="z-[1000]!">
			<Menu.Content
				class="bg-surface-50-950 border-surface-200-800 max-h-[70vh] w-[min(90vw,300px)] overflow-y-auto rounded-container border p-1 shadow-xl"
			>
				{#if !items.length}
					<p class="text-surface-600-400 p-2 text-xs">
						No loadout can run this model.
					</p>
				{/if}
				{#each groups as group, g (group.transform)}
					{#if g > 0}
						<Menu.Separator class="bg-surface-200-800 my-1 h-px" />
					{/if}
					<Menu.ItemGroup>
						{#if groups.length > 1}
							<Menu.ItemGroupLabel
								class="text-surface-600-400 px-2.5 pt-1.5 pb-0.5 text-meta font-semibold"
							>
								{group.label}
							</Menu.ItemGroupLabel>
						{/if}
						{#each group.items as item (item.id)}
							<Menu.Item value={`loadout:${item.id}`} class={menuItem}>
								<span class="flex min-w-0 flex-1 flex-col">
									<span
										class="flex min-w-0 items-center gap-1.5 font-medium"
									>
										{#if item.isDefault}
											<Icons.Star
												size={11}
												fill="currentColor"
												class="text-primary-500 shrink-0"
												aria-label="Default"
											/>
										{/if}
										<Menu.ItemText class="min-w-0 truncate">
											{item.name}
										</Menu.ItemText>
									</span>
									<span
										class="text-surface-600-400 truncate text-xs"
									>
										{item.state}
									</span>
								</span>
								{#if item.current}
									<Icons.Check
										size={13}
										class="text-success-500 shrink-0"
										aria-hidden="true"
									/>
								{/if}
							</Menu.Item>
						{/each}
					</Menu.ItemGroup>
				{/each}
				{#if onOpenLoadouts}
					<Menu.Separator class="bg-surface-200-800 my-1 h-px" />
					<Menu.Item value="open" class={menuItem}>
						<Icons.Combine size={14} aria-hidden="true" />
						<Menu.ItemText>Open Loadouts</Menu.ItemText>
					</Menu.Item>
				{/if}
			</Menu.Content>
		</Menu.Positioner>
	</Portal>
</Menu>
