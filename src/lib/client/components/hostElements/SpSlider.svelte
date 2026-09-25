<script lang="ts">
	/** `sp-slider` — host-owned; `input` while dragging and `change` on release carry `{ value }`. */
	import { Slider } from "@skeletonlabs/skeleton-svelte"
	import { flag, type SpElementProps } from "./spElement.svelte"

	let { attrs, writes, emit }: SpElementProps = $props()
	const num = (v: string | null, d: number) => (v !== null && Number.isFinite(Number(v)) ? Number(v) : d)
	let value = $state([0])
	$effect(() => {
		void writes.value
		value = [num(attrs.value, num(attrs.min, 0))]
	})
</script>

<Slider
	{value}
	min={num(attrs.min, 0)}
	max={num(attrs.max, 100)}
	step={num(attrs.step, 1)}
	disabled={flag(attrs.disabled)}
	onValueChange={(e) => {
		value = e.value
		emit("input", { value: e.value[0] })
	}}
	onValueChangeEnd={(e) => emit("change", { value: e.value[0] })}
>
	{#if attrs.label}<Slider.Label class="sp-slider-label">{attrs.label}</Slider.Label>{/if}
	<Slider.Control class="sp-slider-control">
		<Slider.Track>
			<Slider.Range />
		</Slider.Track>
		<Slider.Thumb index={0}>
			<Slider.HiddenInput />
		</Slider.Thumb>
	</Slider.Control>
</Slider>
