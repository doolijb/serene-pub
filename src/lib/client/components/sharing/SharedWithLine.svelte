<script lang="ts">
	/**
	 * **Shared with** — the people the owner shared a character or a
	 * lorebook with (PLAN-private-messages §6.7), as `xs` initial faces and
	 * names, the rest as `+N`. Renders nothing when there is nobody.
	 */
	import Avatar from "$lib/client/components/Avatar.svelte"
	import { avatarSrc } from "$lib/client/utils/media"
	import type { ConversationPerson } from "$lib/shared/sockets/conversations"

	interface Props {
		people: ConversationPerson[] | null | undefined
		/** How many to name before `+N`. */
		max?: number
		class?: string
	}

	let { people, max = 3, class: className = "" }: Props = $props()

	const label = (p: ConversationPerson) => p.displayName || p.username
	let shown = $derived((people ?? []).slice(0, max))
	let rest = $derived(Math.max(0, (people?.length ?? 0) - max))
	let all = $derived((people ?? []).map(label).join(", "))
</script>

{#if people?.length}
	<p
		class="text-surface-600-400 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs {className}"
		title={all}
	>
		<span>Shared with</span>
		{#each shown as person (person.id)}
			<span class="inline-flex min-w-0 items-center gap-1">
				<Avatar
					src={avatarSrc(person)}
					name={label(person)}
					fallback="initial"
					size="xs"
					decorative
				/>
				<span class="text-surface-800-200 max-w-32 truncate">
					{label(person)}
				</span>
			</span>
		{/each}
		{#if rest > 0}
			<span>+{rest}</span>
			<span class="sr-only">: {all}</span>
		{/if}
	</p>
{/if}
