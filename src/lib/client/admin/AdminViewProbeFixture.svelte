<script lang="ts">
	/** 🚧 A stand-in admin section for `adminView.dom.test.svelte.ts`: counts its mounts, holds a typed value, registers its unsaved edits. */
	import { adminUnsavedEdits } from "./adminRouter.svelte"
	import { probe } from "./adminViewFixture.svelte"

	probe.mounts++
	let typed = $state("")
	adminUnsavedEdits(() => typed !== "")
</script>

<label>Probe <input id="probe-field" bind:value={typed} /></label>
