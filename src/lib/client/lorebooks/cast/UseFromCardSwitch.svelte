<!-- One *Use from card* switch on the cast member form: the card's value reads
     through while it is on; off, the book's own is edited. -->
<script lang="ts">
	import { Switch } from "@skeletonlabs/skeleton-svelte"

	interface Props {
		/** The switch's form `name`. */
		name: string
		/** The field's name, read before "Use from card" by screen readers. */
		label: string
		checked: boolean
		onCheckedChange: (checked: boolean) => void
	}

	let { name, label, checked, onCheckedChange }: Props = $props()

	const switchClass =
		"preset-filled-surface-300-700 data-[state=checked]:preset-filled-primary-500"
</script>

<Switch
	{name}
	{checked}
	onCheckedChange={(e) => onCheckedChange(e.checked)}
	class="flex items-center gap-2 text-xs"
>
	<Switch.Control class={switchClass}>
		<Switch.Thumb />
	</Switch.Control>
	<Switch.Label>
		<span class="sr-only">{label}:</span>
		Use from card
	</Switch.Label>
	<Switch.HiddenInput />
</Switch>
