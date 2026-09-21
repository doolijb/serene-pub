<script lang="ts">
	/**
	 * Mounts one atmosphere into an absolutely-positioned layer.
	 *
	 * Drop it as the first child of a `relative` element and it fills it. It is
	 * `aria-hidden` and takes no pointer events: an atmosphere is scenery, and
	 * nothing about a screen's meaning may depend on which one is running.
	 *
	 * Reduced motion freezes it on a single rendered frame rather than removing
	 * it — see AtmosphereHost.setStill, and the global rule in app.css that
	 * does the same for the CSS-kind ones.
	 */
	import { browser } from "$app/environment"
	import { AtmosphereHost } from "./host"
	import type { AtmosphereDefinition } from "./types"
	import "./atmospheres.css"

	interface Props {
		definition: AtmosphereDefinition
		/** Density and opacity, 0.12–1.4. */
		intensity?: number
	}

	let { definition, intensity = 0.55 }: Props = $props()

	let root: HTMLDivElement | null = $state(null)
	let host: AtmosphereHost | null = $state(null)

	$effect(() => {
		if (!browser || !root) return
		const mounted = new AtmosphereHost(root)
		host = mounted

		const motion = window.matchMedia("(prefers-reduced-motion: reduce)")
		const onMotionChange = () => mounted.setStill(motion.matches)
		onMotionChange()
		motion.addEventListener("change", onMotionChange)

		// The theme's stops are read once and kept, so the layer has to be told
		// when the shell swaps a theme or flips light/dark.
		const themeWatcher = new MutationObserver(() =>
			mounted.refreshPalette()
		)
		themeWatcher.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["data-theme", "data-mode"]
		})

		return () => {
			motion.removeEventListener("change", onMotionChange)
			themeWatcher.disconnect()
			host = null
			mounted.destroy()
		}
	})

	$effect(() => {
		host?.set(definition)
	})

	$effect(() => {
		host?.setIntensity(intensity)
	})
</script>

<div bind:this={root} class="sp-atmosphere" aria-hidden="true"></div>
