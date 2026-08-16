<script lang="ts">
	import { Dialog, Portal, Switch } from "@skeletonlabs/skeleton-svelte"
	import * as Icons from "@lucide/svelte"

	interface Props {
		open: boolean
		onOpenChange: (e: OpenChangeDetails) => void
		onConfirm: (options: {
			includeCharacters: boolean
			includePersonas: boolean
			includeNarrativeGraph: boolean
		}) => void
		onCancel: () => void
	}

	let {
		open = $bindable(),
		onOpenChange,
		onConfirm,
		onCancel
	}: Props = $props()

	// Default to including everything — matches the export's original
	// always-include-everything behavior for anyone who doesn't change these.
	let includeCharacters = $state(true)
	let includePersonas = $state(true)
	let includeNarrativeGraph = $state(true)

	function handleConfirm() {
		onConfirm({ includeCharacters, includePersonas, includeNarrativeGraph })
	}
</script>

<Dialog {open} {onOpenChange}>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 max-w-md space-y-6 p-6 shadow-xl"
			>
				<header class="flex justify-between">
					<h2 class="h2">Export Lorebook</h2>
				</header>
				<article class="space-y-4">
					<p class="text-surface-700-300 text-sm">
						Choose what to include in the export. World lore,
						character lore, and history entries are always included.
					</p>
					<Switch
						name="include-characters"
						checked={includeCharacters}
						onCheckedChange={(e) => (includeCharacters = e.checked)}
						class="flex items-center gap-2"
					>
						<Switch.Control
							class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
						>
							<Switch.Thumb />
						</Switch.Control>
						<Switch.HiddenInput />
						<Switch.Label class="text-sm font-semibold">
							Include bound characters
						</Switch.Label>
					</Switch>
					<Switch
						name="include-personas"
						checked={includePersonas}
						onCheckedChange={(e) => (includePersonas = e.checked)}
						class="flex items-center gap-2"
					>
						<Switch.Control
							class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
						>
							<Switch.Thumb />
						</Switch.Control>
						<Switch.HiddenInput />
						<Switch.Label class="text-sm font-semibold">
							Include bound personas
						</Switch.Label>
					</Switch>
					<Switch
						name="include-narrative-graph"
						checked={includeNarrativeGraph}
						onCheckedChange={(e) =>
							(includeNarrativeGraph = e.checked)}
						class="flex items-center gap-2"
					>
						<Switch.Control
							class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
						>
							<Switch.Thumb />
						</Switch.Control>
						<Switch.HiddenInput />
						<Switch.Label class="text-sm font-semibold">
							Include narrative graph
						</Switch.Label>
					</Switch>
				</article>
				<footer class="flex justify-end gap-2">
					<button
						class="btn preset-filled-surface-500"
						onclick={onCancel}
					>
						Cancel
					</button>
					<button
						class="btn preset-filled-primary-500"
						onclick={handleConfirm}
					>
						<Icons.Download size={16} />
						Export
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
