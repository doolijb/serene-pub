<script lang="ts">
	/**
	 * The phone's side panels (P6, ruled 2026-08-30; the panels menu, ruled
	 * 2026-09-10) — the session's half of ./mobileSidePanels, drawn by the
	 * live layout (./SessionLayoutRender).
	 *
	 * Below 1024px the side zones are hidden inline entirely — the centre takes
	 * the full width. A populated side is reached from the ONE panels button the
	 * app header grows (Header.svelte + mobileSidePanels.svelte.ts): it opens
	 * this menu, which LISTS the side groups — icon, title, which side, and
	 * which are pinned — and tapping one slides that side in over the session
	 * as a modal sheet, one at a time. The list is what scales: another widget
	 * is another line here, not another button in the header.
	 *
	 * The sheet itself is the side's ONE mount wearing `.zone-flyout.mobile`
	 * (./SideMount's `overlay` slot) — or the middle's, while a side is the
	 * stage — never a second render, so opening it reloads nothing. What is
	 * drawn here is the backdrop, which belongs to no side, and the menu,
	 * which mounts nothing. Its zone head is the renderer's chrome.
	 */
	import { untrack } from "svelte"
	import * as Icons from "@lucide/svelte"
	import type { ResolvedZone } from "./schema"
	import { zonePopulated } from "./sideSlot"
	import {
		mobileSidePanels,
		type MobileGroup
	} from "./mobileSidePanels.svelte"
	import type { SessionLayoutModel } from "./sessionLayoutModel.svelte"
	import type { WidgetSettingsFlow } from "./widgetSettingsFlow.svelte"
	import { focusablesIn } from "./liveFlyouts.svelte"

	interface Props {
		model: SessionLayoutModel
		flow: WidgetSettingsFlow
		/** `.live-body`, where a tapped group is scrolled into view. */
		liveEl: HTMLElement | null
		/**
		 * The open sheet's element — a side's mount, or the middle — for the
		 * focus trap: which element is the dialog changes with the sheet.
		 */
		sheetEl: HTMLElement | null
	}

	let { model, flow, liveEl, sheetEl }: Props = $props()

	/* While a side is the phone's stage (QE, `stageSide`), its conversation is
	 * the stage rather than a line here, and the MIDDLE's widgets are listed
	 * instead ("Middle"), opening the middle as a sheet of its own. An arranged
	 * side lists its render units — the same groups the rail draws — and a side
	 * with no arrangement yet lists its zone widgets, so the menu is never
	 * empty while the button is showing. */
	// A side shows on mobile exactly when it is POPULATED on the desktop: a
	// visible mode with at least one entry, conversation copies included
	// (./sideSlot `zonePopulated`, the same test the empty column asks).
	function mobileZonesOf(side: "left" | "right"): ResolvedZone[] {
		return (side === "left" ? model.leftZones : model.rightZones).filter(
			(z) => zonePopulated(model.zoneFill(z))
		)
	}
	function mobileGroupsOf(side: "left" | "right"): MobileGroup[] {
		const stageId =
			model.stageSide === side ? model.stagePick?.id : undefined
		const units = side === "left" ? model.leftUnits : model.rightUnits
		if (units.length)
			return units
				.filter(
					(u) => !stageId || !u.members.some((m) => m.id === stageId)
				)
				.map((u) => ({
					side,
					key: u.key,
					title: model.rail.groupTitle(u),
					icon: model.rail.groupIconName(u),
					pinned: model.rail.groupPinned(u)
				}))
		return mobileZonesOf(side).flatMap((z) =>
			model
				.zoneEntriesOf(z)
				.filter((p) => p.id !== stageId)
				.map((p) => ({
					side,
					key: p.id,
					title: p.title,
					icon: p.icon || "LayoutPanelTop",
					pinned: model.zonePinned(side)
				}))
		)
	}
	/** The middle's widgets as menu lines, while a side is the phone's stage. */
	function mobileMiddleGroups(): MobileGroup[] {
		if (!(model.stageSide && model.isNarrow)) return []
		const units: { key: string; members: { id: string }[] }[] =
			model.frameOf(model.drawn.middle)
				? model.rail.columnUnits(model.drawn.middle)
				: model.drawn.middle.instances.map((i) => ({
						key: i.instanceId,
						members: [{ id: i.instanceId }]
					}))
		return units.map((u) => ({
			side: "middle" as const,
			key: u.key,
			title: u.members.map((m) => flow.widgetLabel(m.id)).join(" · "),
			icon:
				u.members.length > 1
					? "Layers"
					: model.isConversation(u.members[0].id)
						? "MessagesSquare"
						: model.inst(u.members[0].id)?.icon || "LayoutPanelTop",
			pinned: true
		}))
	}
	let mobileGroups = $derived<MobileGroup[]>(
		model.isNarrow
			? [
					...mobileGroupsOf("left"),
					...mobileGroupsOf("right"),
					...mobileMiddleGroups()
				]
			: []
	)
	// The one writer of the shared store: the breakpoint plus how many lines
	// each sheet lists. `untrack` because setSides also RESOLVES `open`
	// (dropping an overlay a resize just invalidated), and reading that back
	// would make this effect depend on its own write.
	$effect(() => {
		const n = model.isNarrow
		const count = (side: MobileGroup["side"]) =>
			mobileGroups.filter((g) => g.side === side).length
		const l = count("left")
		const r = count("right")
		const m = count("middle")
		untrack(() => mobileSidePanels.setSides(n, l, r, m))
	})
	$effect(() => {
		const groups = mobileGroups
		untrack(() => mobileSidePanels.setGroups(groups))
	})
	/**
	 * A group tapped in the menu: its side's sheet is already opening (the store
	 * set `open`), so all that is left is to make sure the group itself is not
	 * folded, and to bring it into view. Taken exactly once — a pending value is
	 * a request, not a state.
	 */
	$effect(() => {
		if (!mobileSidePanels.pending) return
		untrack(() => {
			const p = mobileSidePanels.takePending()
			if (!p) return
			if (p.side !== "middle") {
				model.rail.groupOpen[model.rail.groupKey(p.side, p.key)] = true
				model.rail.groupFocus[p.side] = p.key
			}
			requestAnimationFrame(() =>
				liveEl
					?.querySelector(
						`:is(.slot-overlay, .center-sheet) [data-group-key="${CSS.escape(p.key)}"]`
					)
					?.scrollIntoView({ block: "nearest" })
			)
		})
	})
	$effect(() => {
		if (!mobileSidePanels.menuOpen) return
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") mobileSidePanels.closeMenu()
		}
		document.addEventListener("keydown", onKey)
		return () => document.removeEventListener("keydown", onKey)
	})
	function closeMobilePanels() {
		mobileSidePanels.close()
	}
	// Focus moves into the overlay on open and returns to the header button on
	// close (mobileSidePanels owns the return trip). Tab cycles inside it, which
	// is what makes `aria-modal` honest: the session behind the scrim is not
	// reachable while the overlay is up.
	$effect(() => {
		const el = sheetEl
		// The sheet itself is a box inside the live session, so a STOWED
		// session has no sheet on screen — but this trap is a document
		// listener, and the one thing here that would outlive the box it
		// belongs to. (Reachable only by narrowing the window below the
		// breakpoint while a tier is previewed — enough to swallow Tab and
		// Escape with nothing visible to swallow them for.)
		if (!model.mobileSide || !el || model.liveStowed) return
		el.focus()
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault()
				closeMobilePanels()
				return
			}
			if (e.key !== "Tab") return
			const f = focusablesIn(el)
			if (!f.length) {
				e.preventDefault()
				el.focus()
				return
			}
			const i = f.indexOf(document.activeElement as HTMLElement)
			const next = e.shiftKey
				? f[i <= 0 ? f.length - 1 : i - 1]
				: f[i === -1 || i === f.length - 1 ? 0 : i + 1]
			e.preventDefault()
			next.focus()
		}
		document.addEventListener("keydown", onKey)
		return () => document.removeEventListener("keydown", onKey)
	})
</script>

<!-- The sheet's backdrop: one side (or the middle) at a time, slid in over
     the session; the sheet is that zone's own mount. -->
{#if model.mobileSide}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="pop-scrim"
		data-stage-hidden={model.stageOnly ? "" : undefined}
		onclick={closeMobilePanels}
	></div>
{/if}

{#if mobileSidePanels.menuOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
	<div
		class="pop-scrim"
		data-stage-hidden={model.stageOnly ? "" : undefined}
		onclick={() => mobileSidePanels.closeMenu()}
	></div>
	<div
		class="panels-menu"
		data-stage-hidden={model.stageOnly ? "" : undefined}
		role="dialog"
		aria-modal="true"
		aria-label="Session panels"
		data-pop-keep
	>
		<div class="zone-head">
			<span class="zone-label always">Panels</span>
			<span class="flex-1"></span>
			<button
				class="zone-head-btn"
				title="Close"
				aria-label="Close panels menu"
				onclick={() => mobileSidePanels.closeMenu()}
			>
				<Icons.X size={16} />
			</button>
		</div>
		<ul class="panels-menu-list">
			{#each mobileSidePanels.groups as g (`${g.side}:${g.key}`)}
				{@const GroupIcon =
					(Icons as any)[g.icon] || Icons.LayoutPanelTop}
				<li>
					<button
						class="panels-menu-item"
						onclick={() =>
							mobileSidePanels.openGroup(g.side, g.key)}
					>
						<GroupIcon size={18} />
						<span class="pm-title">{g.title}</span>
						{#if g.pinned}
							<Icons.Pin size={12} />
						{/if}
						<span class="pm-side">
							{g.side === "left"
								? "Left"
								: g.side === "right"
									? "Right"
									: "Middle"}
						</span>
					</button>
				</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	/* The renderer's pop-over backdrop, the same face. */
	.pop-scrim {
		position: absolute;
		inset: 0;
		z-index: 25;
		background: rgba(0, 0, 0, 0.32);
	}
	/* The panels menu: a sheet from the top, under the header the button is in,
	   so it reads as that button's menu rather than as a page of its own. */
	.panels-menu {
		position: absolute;
		inset-block-start: 0;
		inset-inline: 0;
		z-index: 30;
		max-block-size: 70%;
		display: flex;
		flex-direction: column;
		padding: 0.4rem 0.5rem 0.6rem;
		border-radius: 0 0 0.8rem 0.8rem;
		background: var(--color-surface-50);
		box-shadow: 0 14px 34px rgba(0, 0, 0, 0.28);
		animation: fly-in-menu 180ms cubic-bezier(0.22, 1, 0.36, 1);
	}
	:global([data-mode="dark"]) .panels-menu {
		background: var(--color-surface-950);
	}
	@keyframes fly-in-menu {
		from {
			transform: translateY(-8px);
			opacity: 0;
		}
	}
	.panels-menu-list {
		flex: 1;
		min-block-size: 0;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 0.15rem;
	}
	.panels-menu-item {
		inline-size: 100%;
		min-block-size: 2.75rem;
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding-inline: 0.5rem;
		border-radius: 0.5rem;
		text-align: start;
		color: inherit;
	}
	.panels-menu-item:hover,
	.panels-menu-item:focus-visible {
		background: color-mix(
			in oklab,
			var(--color-primary-500) 12%,
			transparent
		);
	}
	.pm-title {
		flex: 1;
		min-inline-size: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.85rem;
		font-weight: 600;
	}
	.pm-side {
		flex: none;
		font-size: 0.6875rem;
		font-weight: 700;
		color: var(--color-surface-500);
	}
</style>
