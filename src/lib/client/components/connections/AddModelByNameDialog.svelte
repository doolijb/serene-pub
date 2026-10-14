<script lang="ts">
	/**
	 * Add a model by name — a model whose host will not list it.
	 *
	 * It exists for a host that serves no model list at all — a compatible
	 * endpoint with no `/models`, a catalogue that lags a launch — which is
	 * why the connection has to be PICKED: it is reached from the Models
	 * view's toolbar, which stands outside any one connection, so the
	 * connection is the dialog's first field. Moved whole from the
	 * Connections index (plan 2026-10-11).
	 */
	import { Dialog, Portal } from "@skeletonlabs/skeleton-svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"

	type Target = { id: number; name?: string | null }

	interface Props {
		open?: boolean
		/** The connections a model may be added to by name (`manualAddAllowed`). */
		targets: readonly Target[]
		onAdd: (connectionId: number, model: string, name: string) => void
	}
	let { open = $bindable(false), targets, onAdd }: Props = $props()

	let connectionId = $state<string>("")
	let model = $state("")
	let label = $state("")

	/** Each opening starts blank, on the first connection. */
	let wasOpen = false
	$effect(() => {
		if (open && !wasOpen) {
			connectionId = String(targets[0]?.id ?? "")
			model = ""
			label = ""
		}
		wasOpen = open
	})

	function submit() {
		const target = targets.find((c) => String(c.id) === connectionId)
		if (!target || !model.trim()) return
		onAdd(target.id, model.trim(), label.trim())
		open = false
	}
</script>

<Dialog {open} onOpenChange={(e) => (open = e.open)}>
	<Portal>
		<Dialog.Backdrop
			class="bg-surface-50-950/50 fixed inset-0 z-50 backdrop-blur-sm"
		/>
		<Dialog.Positioner
			class="fixed inset-0 z-50 flex items-center justify-center p-4"
		>
			<Dialog.Content
				class="card bg-surface-100-900 w-full max-w-md space-y-4 p-6 shadow-xl"
			>
				<Dialog.Title
					class="[font-family:var(--typo-heading--font-family)] text-lg font-semibold"
				>
					Add a model by name
				</Dialog.Title>
				<p class="text-surface-600-400 text-xs">
					For a host that doesn't list its models. The name has to be
					the one the host answers to.
				</p>
				<form
					class="flex flex-col gap-3"
					onsubmit={(e) => {
						e.preventDefault()
						submit()
					}}
				>
					<Select
						label="Connection"
						options={targets.map((c) => ({
							value: String(c.id),
							label: c.name || "Untitled connection"
						}))}
						bind:value={connectionId}
						placeholder="Pick a connection"
					/>
					<label class="flex flex-col gap-1">
						<span class="text-surface-600-400 text-xs">
							Model identifier
						</span>
						<input
							class="input"
							bind:value={model}
							placeholder="meta-llama/Llama-3.1-8B-Instruct"
						/>
					</label>
					<label class="flex flex-col gap-1">
						<span class="text-surface-600-400 text-xs">
							Display name (optional)
						</span>
						<input
							class="input"
							bind:value={label}
							placeholder="Llama 3.1 8B"
						/>
					</label>
				</form>
				<footer class="flex justify-end gap-2">
					<button
						type="button"
						class="btn preset-tonal-surface"
						onclick={() => (open = false)}
					>
						Cancel
					</button>
					<button
						type="button"
						class="btn preset-filled-primary-500"
						disabled={!model.trim() || !connectionId}
						onclick={submit}
					>
						Add model
					</button>
				</footer>
			</Dialog.Content>
		</Dialog.Positioner>
	</Portal>
</Dialog>
