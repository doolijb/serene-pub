<script lang="ts">
	/**
	 * Admin › Pub › History › <record> — one logbook record's **change
	 * view**, read-only (Django's view-only change form: no save row). The
	 * record is read by id (`admin:logbook` with `recordId`). Its header opens
	 * the object (unless the change deleted it) and the object's whole
	 * history (`/admin/history?type=&id=`, the change forms' History link).
	 *
	 * Secrets were withheld when the record was written — a redacted line
	 * says only that the field changed.
	 */
	import { getContext, untrack } from "svelte"
	import * as Icons from "@lucide/svelte"
	import {
		adminGoto as goto,
		adminPage as page
	} from "$lib/client/admin/adminRouter.svelte"
	import { getInterestContext } from "$lib/client/sockets/interest.svelte"
	import AdminPageHeader from "$lib/client/components/admin/AdminPageHeader.svelte"
	import AdminFieldset from "$lib/client/components/admin/AdminFieldset.svelte"
	import AdminField from "$lib/client/components/admin/AdminField.svelte"
	import {
		LOGBOOK_ACTION_LABELS,
		type LogbookRecordView
	} from "$lib/shared/adminLogbook"
	import {
		ACTION_ICON,
		ACTION_TONE,
		fmtValue,
		fmtWhen,
		objectHistoryHref,
		objectHref,
		objectName,
		typeLabel
	} from "./logbookView"

	const userCtx: { user: SelectUser } = getContext("userCtx")
	const interest = getInterestContext()

	const id = $derived(page.params.id ?? "")
	const recordId = $derived(/^\d+$/.test(id) ? Number(id) : null)

	let record = $state<LogbookRecordView | null>(null)
	let loading = $state(true)

	let seq = 0
	let currentRequest = ""
	$effect(() => {
		if (!userCtx.user?.isAdmin) return
		const wanted = recordId
		return untrack(() => {
			record = null
			if (wanted == null) {
				loading = false
				return
			}
			loading = true
			const requestId = `hr${++seq}`
			currentRequest = requestId
			return interest.requestWithInterest(
				"admin:logbook",
				{ recordId: wanted, limit: 1, requestId },
				(res) => {
					if (res.requestId !== currentRequest) return
					record = res.records.find((r) => r.id === wanted) ?? null
					loading = false
				}
			)
		})
	})

	$effect(() => {
		if (userCtx.user && !userCtx.user.isAdmin) goto("/")
	})

	const openHref = $derived(record ? objectHref(record) : null)
</script>

{#if loading}
	<div
		class="text-surface-600-400 flex items-center justify-center gap-2 py-16 text-sm"
		role="status"
	>
		<Icons.LoaderCircle size={16} class="animate-spin" aria-hidden="true" />
		Loading the change…
	</div>
{:else if !record}
	<div class="m-auto flex flex-col items-center gap-3 py-16 text-center">
		<p class="text-surface-600-400 text-sm">There is no change {id}.</p>
		<a href="/admin/history" class="btn btn-sm preset-tonal-surface">All changes</a>
	</div>
{:else}
	{@const Icon = Icons[ACTION_ICON[record.action]]}
	<div class="@container/record flex min-w-0 flex-1 flex-col">
		<AdminPageHeader
			title={record.summary}
			purpose="One change, as it was recorded. Read-only: the history is never edited."
		>
			{#snippet actions()}
				{#if openHref}
					<a class="btn btn-sm preset-tonal-surface" href={openHref}>
						<Icons.ExternalLink size={16} aria-hidden="true" />
						Open {typeLabel(record!.objectType)}
					</a>
				{/if}
				<a class="btn btn-sm preset-tonal-surface" href={objectHistoryHref(record!)}>
					<Icons.History size={16} aria-hidden="true" />
					This object's history
				</a>
			{/snippet}
		</AdminPageHeader>

		<div class="flex min-w-0 flex-col gap-3">
			<AdminFieldset title="Change">
				<div class="grid gap-4 @min-[36rem]/record:grid-cols-2">
					<AdminField id="record-when" label="When" value={fmtWhen(record.at, true)} />
					<AdminField id="record-who" label="Who" value={record.actorName} />
					<div class="flex min-w-0 flex-col gap-1.5">
						<span class="text-surface-600-400 text-xs" id="record-action-label">Action</span>
						<p aria-labelledby="record-action-label">
							<span
								class="{ACTION_TONE[record.action]} inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]"
							>
								<Icon size={12} aria-hidden="true" />
								{LOGBOOK_ACTION_LABELS[record.action]}
							</span>
						</p>
					</div>
					<AdminField
						id="record-object"
						label="Object"
						value={objectName(record.objectType, record.objectLabel)}
					/>
					<AdminField
						id="record-event"
						label="Event"
						value={record.event}
						class="[&>p]:font-mono [&>p]:text-xs"
					/>
				</div>
			</AdminFieldset>

			<AdminFieldset
				title="Changed fields"
				description="Each field as it was, then as it became."
			>
				{#if record.changes.length}
					<ul class="flex flex-col gap-2" aria-label="Changed fields">
						{#each record.changes as c (c.field)}
							<li
								class="bg-surface-100-900 flex flex-col gap-1 rounded-[10px] px-3 py-2 text-sm @min-[36rem]/record:grid @min-[36rem]/record:grid-cols-[minmax(8rem,14rem)_1fr] @min-[36rem]/record:gap-3"
							>
								<span class="font-medium">{c.label}</span>
								{#if c.redacted}
									<span class="text-surface-600-400 flex items-center gap-1.5 text-xs">
										<Icons.LockKeyhole size={14} aria-hidden="true" />
										Changed — the value is a secret and was not recorded.
									</span>
								{:else}
									<span
										class="flex min-w-0 flex-col gap-1 @min-[56rem]/record:flex-row @min-[56rem]/record:items-start @min-[56rem]/record:gap-2"
									>
										{#if c.before !== undefined}
											<span
												class="text-surface-600-400 decoration-surface-500/60 min-w-0 text-xs break-words whitespace-pre-wrap line-through"
											>
												<span class="sr-only">Before: </span>{fmtValue(c.before)}
											</span>
											<Icons.ArrowRight
												size={14}
												class="text-surface-600-400 hidden shrink-0 @min-[56rem]/record:block"
												aria-hidden="true"
											/>
										{/if}
										<span class="min-w-0 text-xs break-words whitespace-pre-wrap">
											<span class="sr-only"
												>{c.before !== undefined ? "After: " : "Value: "}</span
											>{fmtValue(c.after)}
										</span>
									</span>
								{/if}
							</li>
						{/each}
					</ul>
				{:else}
					<p class="text-surface-600-400 text-sm">No field-level detail for this change.</p>
				{/if}
			</AdminFieldset>
		</div>
	</div>
{/if}
