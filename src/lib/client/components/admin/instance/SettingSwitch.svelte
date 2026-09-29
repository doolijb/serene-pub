<script lang="ts">
	/**
	 * The one on/off row the Instance pages repeat: a Skeleton Switch with its
	 * label. Each card still owns what the change does (`onCheckedChange`).
	 */
	import { Switch } from "@skeletonlabs/skeleton-svelte"

	interface Props {
		name: string
		label: string
		checked: boolean
		disabled?: boolean
		onCheckedChange: (event: { checked: boolean }) => void
	}

	let { name, label, checked, disabled, onCheckedChange }: Props = $props()
</script>

<!-- `data-field`: the name is what an admin address lands on (`#name`,
     AdminView) and what Jump's settings index points at. -->
<div class="flex items-center gap-2" data-field={name}>
	<Switch {name} {checked} {disabled} {onCheckedChange}>
		<Switch.Control
			class="preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
		>
			<Switch.Thumb />
		</Switch.Control>
		<Switch.HiddenInput />
		<Switch.Label class="text-sm font-medium">{label}</Switch.Label>
	</Switch>
</div>
