<script lang="ts">
	/**
	 * **Since the upgrade** — the cast members the character-versions upgrade
	 * lifted with a note (lane cv-member2, B3): where they read a little
	 * differently than before, and **Follow the card's greetings** for those
	 * that were given their own list. Absent while the list is empty. Asked
	 * on mount (admin only: the server refuses anyone else, and the interest
	 * is restricted). Failures are said inline; nothing here toasts.
	 */
	import { useTypedSocket } from "$lib/client/sockets/typedSocket"
	import { requestWithInterest } from "$lib/client/sockets/interest.svelte"
	import { awaitReply } from "$lib/client/utils/awaitReply"
	import {
		CAST_UPGRADE_HELP,
		CAST_UPGRADE_TITLE,
		FOLLOW_GREETINGS_BUTTON,
		FOLLOW_GREETINGS_FALLBACK,
		FOLLOW_GREETINGS_NOTE,
		castUpgradeDifferenceLine,
		castUpgradeMemberTitle
	} from "./castUpgradeWords"

	const socket = useTypedSocket()

	let members = $state<Sockets.Admin.CastLiftNotes.Member[]>([])
	/** The member whose follow is in flight, and the refusal each one last got. */
	let waitingFor = $state<number | null>(null)
	let problems = $state<Record<number, string>>({})

	$effect(() =>
		requestWithInterest("admin:castLiftNotes", {}, (res) => {
			members = res.members
		})
	)

	async function follow(castMemberId: number) {
		if (waitingFor !== null) return
		waitingFor = castMemberId
		delete problems[castMemberId]
		try {
			const res = await awaitReply({
				socket,
				event: "admin:castLiftFollowGreetings",
				params: { castMemberId },
				errorEvent: "admin:castLiftFollowGreetings:error",
				fallbackError: FOLLOW_GREETINGS_FALLBACK,
				match: () => true
			})
			members = res.members
		} catch (err) {
			problems[castMemberId] =
				err instanceof Error ? err.message : FOLLOW_GREETINGS_FALLBACK
		} finally {
			waitingFor = null
		}
	}
</script>

{#if members.length > 0}
	<section
		id="cast-upgrade"
		class="panel-card flex flex-col gap-3"
		aria-labelledby="cast-upgrade-heading"
	>
		<div class="flex flex-col gap-1">
			<h2 id="cast-upgrade-heading" class="text-sm font-medium">
				{CAST_UPGRADE_TITLE}
			</h2>
			<p class="text-surface-600-400 text-xs">{CAST_UPGRADE_HELP}</p>
		</div>
		<ul class="flex flex-col gap-3">
			{#each members as m (m.castMemberId)}
				<li
					class="flex flex-col items-start gap-1"
					data-cast-upgrade-row
				>
					<h3 class="text-sm font-medium">
						{castUpgradeMemberTitle(m.memberName, m.lorebookName)}
					</h3>
					{#each m.note.differences as d, i (i)}
						<p class="text-surface-600-400 text-xs">
							{castUpgradeDifferenceLine(d)}
						</p>
					{/each}
					{#if m.note.mixedGreetings}
						<p class="text-surface-600-400 text-xs">
							{FOLLOW_GREETINGS_NOTE}
						</p>
						<button
							type="button"
							class="btn btn-sm preset-tonal pointer-coarse:min-h-11"
							disabled={waitingFor !== null}
							onclick={() => follow(m.castMemberId)}
						>
							{FOLLOW_GREETINGS_BUTTON}
						</button>
						{#if problems[m.castMemberId]}
							<p
								class="text-error-700-300 text-xs"
								role="alert"
								data-cast-upgrade-problem
							>
								{problems[m.castMemberId]}
							</p>
						{/if}
					{/if}
				</li>
			{/each}
		</ul>
	</section>
{/if}
