<script lang="ts">
	/**
	 * 🚧 The `workflow-ref` control (DESIGN-image-generation §4.10): the
	 * oracle's `workflow` slot, a select of workflows, value `{ id }`.
	 *
	 * **Self-hiding.** Shown only when the sibling connection slot's resolved
	 * pair says `payload: "template"` (a ComfyUI — the connection choice
	 * carries it). Hidden, it renders one `data-self-hidden` marker and the row
	 * that holds it collapses (`has-[[data-self-hidden]]:hidden` on the row) —
	 * the one mechanism, kept inside the control so the settings group has no
	 * rule of its own about workflows.
	 *
	 * A slot left to inherit its pair (the Images default) is hidden: the
	 * loadout carries the workflow there (§11). A workflow already set stays
	 * visible whatever the pair, so it can be seen and cleared.
	 */
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { slotConnectionId } from "$lib/shared/connections/slotRef"

	interface Props {
		option: Sockets.Pipelines.Option
		/** The other options of the same step — where the connection slot is. */
		siblings: readonly Sockets.Pipelines.Option[]
		label: string
		onSet: (value: { id: number }) => void
		onClear: () => void
	}

	let { option, siblings, label, onSet, onClear }: Props = $props()

	/** The sibling connection slot's chosen connection, from its own choices. */
	const pairChoice = $derived.by(() => {
		const conn = siblings.find((o) => o.control === "connection-ref")
		if (!conn) return null
		const id = slotConnectionId(conn.value)
		return id == null ? null : (conn.choices?.find((c) => c.id === id) ?? null)
	})

	const currentId = $derived(
		option.value && typeof option.value === "object" && "id" in (option.value as object)
			? Number((option.value as { id: unknown }).id)
			: typeof option.value === "number"
				? option.value
				: null
	)

	const shown = $derived(pairChoice?.payload === "template" || currentId != null)
</script>

{#if shown}
	<Select
		{label}
		labelHidden
		class="w-full"
		placeholder="Choose a workflow"
		options={[
			{ value: "", label: "None" },
			...(option.choices ?? [])
				.filter((c) => !c.dialect || c.dialect === "comfyui")
				.map((c) => ({
					value: String(c.id),
					label: c.label,
					hint: c.description,
					disabled: !!c.disabled
				}))
		]}
		value={currentId == null ? "" : String(currentId)}
		onValueChange={(raw) => (raw === "" ? onClear() : onSet({ id: Number(raw) }))}
	/>
	{#if pairChoice && pairChoice.payload !== "template"}
		<p class="text-surface-600-400 text-xs">
			This step's connection does not draw with a workflow; this one is ignored.
		</p>
	{/if}
{:else}
	<span data-self-hidden hidden></span>
{/if}
