<script lang="ts">
	/**
	 * The five ways something gets into this pub, behind one button.
	 *
	 * Same shape as the Characters view's New menu, deliberately: one tonal
	 * button on its own row above the filter, a `role="menu"` popout of items
	 * with a title and a one-line description, arrow keys between them. A
	 * second popout style for the same idea would be a second thing to learn.
	 *
	 * ## Why five items and not a wizard
	 *
	 * The five are genuinely different destinations — a service, a runtime this
	 * pub installs, a runtime somebody else installed, a model from a list, and
	 * a model whose host will not list it — and each of them is one press away
	 * from here. A wizard would ask the same question in three screens.
	 *
	 * ⚠ Every item CLOSES the menu before it runs: each opens a dialog or
	 * changes the view, and a menu still standing over either is a menu the
	 * pointer has to dismiss a second time.
	 */
	import * as Icons from "@lucide/svelte"
	import { Popover, Portal } from "@skeletonlabs/skeleton-svelte"

	interface Props {
		/** The New connection dialog — any service or preset. */
		onAddConnection: () => void
		/** Switch the KoboldCPP manager on and open its connection. */
		onAddKoboldCpp: () => void
		/** Switch the Ollama manager on and open its connection. */
		onAddOllama: () => void
		/** The model finder. */
		onGetModel: () => void
		/** The small "name a model yourself" dialog. */
		onAddByName: () => void
		/** Hidden when no connection accepts a hand-typed model. */
		canAddByName?: boolean
	}
	let {
		onAddConnection,
		onAddKoboldCpp,
		onAddOllama,
		onGetModel,
		onAddByName,
		canAddByName = true
	}: Props = $props()

	let open = $state(false)
	let focusIndex = $state(0)

	const items = $derived([
		{
			key: "connection",
			icon: Icons.Cable,
			title: "A connection",
			blurb: "Any service or preset · API key or address",
			run: onAddConnection
		},
		{
			key: "koboldcpp",
			icon: Icons.Cpu,
			title: "KoboldCPP, run by Serene Pub",
			blurb: "Install and manage a local runtime",
			run: onAddKoboldCpp
		},
		{
			key: "ollama",
			icon: Icons.Server,
			title: "Ollama",
			blurb: "Point at a running Ollama",
			run: onAddOllama
		},
		{
			key: "model",
			icon: Icons.Boxes,
			title: "A model",
			blurb: "Recommended lists and Hugging Face",
			run: onGetModel
		},
		// `Keyboard` because the distinguishing fact IS the typing: this is
		// the item for a host that serves no list, so the model's id comes
		// off the person's fingers rather than off a catalogue.
		...(canAddByName
			? [
					{
						key: "by-name",
						icon: Icons.Keyboard,
						title: "A model by name",
						blurb: "When a host doesn't list its models",
						run: onAddByName
					}
				]
			: [])
	] as const)

	function run(item: (typeof items)[number]) {
		open = false
		item.run()
	}

	/**
	 * Up and down walk the menu, wrapping at both ends. A `role="menu"` is one
	 * tab stop with a roving focus, so the arrows are the only way between its
	 * items; Escape and the focus return belong to the popover.
	 */
	function handleKeydown(e: KeyboardEvent) {
		const rows = [
			...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
				'[role="menuitem"]'
			)
		]
		if (!rows.length) return
		const at = rows.indexOf(document.activeElement as HTMLElement)
		let next: number
		if (e.key === "ArrowDown") next = at < 0 ? 0 : (at + 1) % rows.length
		else if (e.key === "ArrowUp")
			next =
				at < 0 ? rows.length - 1 : (at - 1 + rows.length) % rows.length
		else if (e.key === "Home") next = 0
		else if (e.key === "End") next = rows.length - 1
		else return
		e.preventDefault()
		focusIndex = next
		rows[next].focus()
	}
</script>

<Popover
	{open}
	onOpenChange={(e) => {
		open = e.open
		if (e.open) focusIndex = 0
	}}
	positioning={{ placement: "bottom-start" }}
>
	<Popover.Trigger
		class="btn btn-sm preset-tonal-surface shrink-0"
		title="Add a connection or a model"
		aria-haspopup="menu"
		aria-expanded={open}
	>
		<Icons.Plus size={16} aria-hidden="true" />
		Add
	</Popover.Trigger>
	<Portal>
		<Popover.Positioner class="z-[1000]!">
			<Popover.Content
				class="card bg-surface-100-900 border-surface-300-700 w-[min(90vw,300px)] border p-1 shadow-xl"
			>
				<!-- `tabindex={-1}` and not 0: the menu is one tab stop, and the
				     stop is whichever ITEM holds the roving focus. -->
				<div
					role="menu"
					aria-label="Add to this pub"
					tabindex={-1}
					class="flex flex-col"
					onkeydown={handleKeydown}
				>
					{#each items as item, i (item.key)}
						<button
							type="button"
							role="menuitem"
							tabindex={i === focusIndex ? 0 : -1}
							class="hover:preset-tonal-primary flex items-start gap-3 rounded-lg px-2.5 py-2 text-left"
							onclick={() => run(item)}
						>
							<item.icon
								size={18}
								class="text-surface-600 dark:text-surface-400 mt-0.5 shrink-0"
								aria-hidden="true"
							/>
							<span class="min-w-0">
								<span class="block text-sm font-medium">
									{item.title}
								</span>
								<span
									class="text-surface-600 dark:text-surface-500 block text-xs"
								>
									{item.blurb}
								</span>
							</span>
						</button>
					{/each}
				</div>
			</Popover.Content>
		</Popover.Positioner>
	</Portal>
</Popover>
