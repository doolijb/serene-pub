<script lang="ts">
	/**
	 * Add a model by name — a model whose host will not list it.
	 *
	 * It exists for a host that serves no model list at all — a compatible
	 * endpoint with no `/models`, a catalogue that lags a launch — which is
	 * why the connection has to be PICKED: it is reached from the Models
	 * view's toolbar, which stands outside any one connection, so the
	 * connection is the form's first field. Moved whole from the Connections
	 * index (plan 2026-10-11).
	 *
	 * A pane in the Models view's detail column (owner, 2026-11-04), as Get a
	 * model is: a pinned `PanelNavHeader` with **Back** at every width, focus
	 * on its heading, everything under the header one scroller. Back is the
	 * cancel; **Add model** sends and then goes back.
	 */
	import PanelNavHeader from "$lib/client/components/panels/PanelNavHeader.svelte"
	import Select from "$lib/client/components/inputs/Select.svelte"

	type Target = { id: number; name?: string | null }

	interface Props {
		/** The connections a model may be added to by name (`manualAddAllowed`). */
		targets: readonly Target[]
		onAdd: (connectionId: number, model: string, name: string) => void
		onBack: () => void
	}
	let { targets, onAdd, onBack }: Props = $props()

	// Each opening is a fresh mount: blank, on the first connection.
	let connectionId = $state<string>("")
	let model = $state("")
	let label = $state("")
	$effect.pre(() => {
		if (connectionId === "") connectionId = String(targets[0]?.id ?? "")
	})

	let root = $state<HTMLElement>()
	$effect(() => {
		if (!root) return
		const heading = root.querySelector<HTMLElement>("[data-panel-title]")
		heading?.setAttribute("tabindex", "-1")
		heading?.focus()
	})

	function submit() {
		const target = targets.find((c) => String(c.id) === connectionId)
		if (!target || !model.trim()) return
		onAdd(target.id, model.trim(), label.trim())
		onBack()
	}
</script>

<div class="flex h-full min-h-0 flex-col gap-3" bind:this={root}>
	<PanelNavHeader title="Add a model by name" {onBack} backLabel="Back" />

	<div class="min-h-0 flex-1 overflow-y-auto">
		<div class="flex flex-col gap-3 pb-2">
			<p class="text-surface-600-400 text-xs">
				For a host that doesn't list its models. The name has to be the
				one the host answers to.
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
				<div class="flex justify-end">
					<button
						type="submit"
						class="btn preset-filled-primary-500"
						disabled={!model.trim() || !connectionId}
					>
						Add model
					</button>
				</div>
			</form>
		</div>
	</div>
</div>
