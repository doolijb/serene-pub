<script lang="ts">
	/**
	 * The costed confirmations of `chooseJobModel` (contexts/connections),
	 * rendered ONCE per shell rather than by each view that can move a star:
	 * the Connections view and the Models view share one staged choice, so
	 * they share its two questions too. Mounted by Layout and AccessibleShell.
	 */
	import { getContext } from "svelte"
	import EmbeddingSwitchDialog from "./EmbeddingSwitchDialog.svelte"
	import EntitySwitchDialog from "./EntitySwitchDialog.svelte"
	import {
		CONNECTIONS_CONTEXT,
		type ConnectionsCtx
	} from "$lib/client/contexts/connections.svelte"

	const ctx = getContext<ConnectionsCtx>(CONNECTIONS_CONTEXT)
</script>

<!-- Switching the embedding connection re-indexes everything. The number is
     the whole point of this dialog. -->
<EmbeddingSwitchDialog {...ctx.embeddingDialog} />
<!-- Moving the entity star to another model re-scans; the count says how
     much. -->
<EntitySwitchDialog {...ctx.entityDialog} />
