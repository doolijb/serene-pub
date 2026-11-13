<script lang="ts">
	/**
	 * `/admin/variable-templates/:id` (the old Variable templates address,
	 * still linked from the logbook and bookmarks): finds the row and moves
	 * to its variable layout's form, or to the list when it is gone.
	 */
	import { onMount } from "svelte"
	import LoadingState from "$lib/client/components/LoadingState.svelte"
	import {
		adminGoto,
		adminPage as page
	} from "$lib/client/admin/adminRouter.svelte"
	import { requestWithInterest } from "$lib/client/sockets/interest.svelte"
	import {
		VARIABLE_LAYOUTS_HREF,
		layoutFormHref
	} from "./variableLayoutWords"

	let done = false

	onMount(() => {
		const id = Number(page.params.id)
		const release = requestWithInterest("pipelines:library", {}, (res) => {
			if (done || !res.variableTemplates) return
			done = true
			const row = res.variableTemplates.find((t) => t.id === id)
			void adminGoto(
				row
					? layoutFormHref(row.poolId, row.id)
					: VARIABLE_LAYOUTS_HREF,
				{
					replaceState: true
				}
			)
		})
		return release
	})
</script>

<LoadingState />
