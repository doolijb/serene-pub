<script lang="ts">
	/**
	 * The Actions card on the settings form: what the session can do besides
	 * reply, in two lists (the preset's included actions, then the genre's
	 * others). The form owns the fetch, the busy flag and the socket emit; this
	 * draws the checkboxes and reports a toggle.
	 */
	import { actionIdentity } from "$lib/shared/actions/identity"
	import { CARD_CLASS } from "./editSessionForm"

	type SessionFunction =
		Sockets.Sessions.Functions.Response["functions"][number]

	interface Props {
		/** The actions the session's preset includes. */
		presetActions: SessionFunction[]
		/** The mode's actions the preset left out. */
		outsideActions: SessionFunction[]
		/** The identity of the action whose switch is in flight, if any. */
		functionsBusy: string | null
		/** True where this person may add an action the preset left out. */
		canAddOutsidePreset: boolean
		/** One action's switch, by the form. */
		toggleSessionFunction: (
			f: { specSlug: string; key: string },
			enabled: boolean
		) => void
	}

	let {
		presetActions,
		outsideActions,
		functionsBusy,
		canAddOutsidePreset,
		toggleSessionFunction
	}: Props = $props()
</script>

<section class={CARD_CLASS}>
	<h3 class="mb-1 text-sm font-medium">Actions</h3>
	<p class="text-surface-600-400 mb-2 text-xs">
		What this session can do besides reply. Replying
		is intrinsic and always available. Applies at
		once.
	</p>

	{#each presetActions as f (actionIdentity(f))}
		{@const id = `fn-${actionIdentity(f)}`}
		<label
			class="flex items-start gap-2 text-sm"
			for={id}
		>
			<input
				{id}
				type="checkbox"
				class="checkbox mt-0.5"
				checked={f.enabled}
				disabled={functionsBusy ===
					actionIdentity(f) ||
					!!f.unavailable}
				onchange={(e) =>
					toggleSessionFunction(
						f,
						e.currentTarget.checked
					)}
			/>
			<span class="flex flex-col">
				<span>
					{f.name}
					{#if f.source === "session"}
						<span
							class="text-surface-600-400 text-meta"
						>
							· set for this session
						</span>
					{/if}
				</span>
				{#if f.description}
					<span
						class="text-surface-600-400 text-xs"
					>
						{f.description}
					</span>
				{/if}
				{#if f.unavailable}
					<!-- 🚧 R56: off until an administrator sets a model for it. -->
					<span
						class="text-warning-700-300 text-xs"
					>
						{f.unavailable}
					</span>
				{/if}
			</span>
		</label>
	{/each}

	{#if presetActions.length === 0}
		<p class="text-surface-600-400 text-xs italic">
			This session's preset includes no actions.
		</p>
	{/if}

	{#if outsideActions.length > 0}
		<div class="mt-3 flex flex-col gap-2">
			<p class="text-xs font-medium">
				Not in this preset
			</p>
			<p class="text-surface-600-400 text-xs">
				{#if canAddOutsidePreset}
					Offered by this genre but left out
					of the preset. Adding one affects
					this session only.
				{:else}
					Offered by this genre but not part
					of your preset. An administrator can
					add these.
				{/if}
			</p>
			{#each outsideActions as f (actionIdentity(f))}
				{@const id = `fn-${actionIdentity(f)}`}
				<label
					class="flex items-start gap-2 text-sm"
					for={id}
				>
					<input
						{id}
						type="checkbox"
						class="checkbox mt-0.5"
						checked={f.enabled}
						disabled={functionsBusy ===
							actionIdentity(f) ||
							(!canAddOutsidePreset &&
								!f.enabled)}
						onchange={(e) =>
							toggleSessionFunction(
								f,
								e.currentTarget.checked
							)}
					/>
					<span class="flex flex-col">
						<span>{f.name}</span>
						{#if f.description}
							<span
								class="text-surface-600-400 text-xs"
							>
								{f.description}
							</span>
						{/if}
					</span>
				</label>
			{/each}
		</div>
	{/if}
</section>
