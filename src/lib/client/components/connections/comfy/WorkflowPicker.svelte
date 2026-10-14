<script lang="ts">
	/**
	 * 🚧 **WorkflowPicker** — the one control that chooses a workflow, for any
	 * surface that holds a (ComfyUI, workflow) pair (DESIGN-image-generation
	 * §4.10, §11). An INTEGRATION POINT: the loadout sheet (lane B1) mounts it
	 * where its pair is a template-payload one; nothing in this lane mounts it.
	 *
	 * Mounting contract:
	 *  - `value` / `onChange` — the workflow id (`{ id }` on a slot is the
	 *    caller's to wrap);
	 *  - `connectionId` — the pair's ComfyUI, for each option's validity hint;
	 *  - `onShape` — ⏳ fires with the retired workflow shape id whenever the
	 *    choice changes. Ruling 13 was reversed 2026-10-12: no sampling config
	 *    speaks it; kept only until lane E2 drops the loadout sheet's use.
	 *
	 * Admin-only data (`workflows:*`); never mount it on a member surface.
	 */
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import Select from "$lib/client/components/inputs/Select.svelte"
	import { workflowShapeId } from "$lib/shared/imageGen/workflowShape"
	import { workflowsApi } from "./workflowsApi"
	import { validityChip } from "./workflowsTab"

	interface Props {
		value: number | null | undefined
		onChange: (workflowId: number | null) => void
		connectionId?: number | null
		onShape?: (shape: string | null) => void
		label?: string
		labelHidden?: boolean
		/** Offer "None" (clears the choice). */
		allowNone?: boolean
	}

	let {
		value,
		onChange,
		connectionId = null,
		onShape,
		label = "Workflow",
		labelHidden = false,
		allowNone = false
	}: Props = $props()

	const api = workflowsApi(useTypedSocket())

	let workflows = $state<Sockets.Workflows.Summary[]>([])
	let onServer = $state<Sockets.Workflows.OnServer.Response | null>(null)

	$effect(() => {
		api.list()
			.then((l) => (workflows = l))
			.catch(() => {})
	})
	$effect(() => {
		const id = connectionId
		onServer = null
		if (id == null) return
		api.onServer(id)
			.then((r) => (onServer = r))
			.catch(() => {})
	})

	function pick(raw: string) {
		const id = raw ? Number(raw) : null
		onChange(id)
		onShape?.(id == null ? null : workflowShapeId(id))
	}
</script>

<Select
	{label}
	{labelHidden}
	class="w-full"
	placeholder="Choose a workflow"
	options={[
		...(allowNone ? [{ value: "", label: "None" }] : []),
		...workflows.map((w) => {
			const chip = validityChip(w.id, onServer)
			return {
				value: String(w.id),
				label: w.name,
				hint: chip.tone === "missing" ? chip.label : (w.description ?? undefined)
			}
		})
	]}
	value={value == null ? "" : String(value)}
	onValueChange={pick}
/>
