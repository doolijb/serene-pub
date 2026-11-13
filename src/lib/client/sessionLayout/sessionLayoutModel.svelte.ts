/**
 * The session layout's MODEL: what the session draws right now, and every
 * decision the renderer and the editor both read. The composition root
 * (./SessionLayout) builds one per page.
 *
 * - **The stored layout, read once.** The manager couriers the person's saved
 *   layout; this file is the one seam that reads it — as PANELS v2 (PLAN
 *   2026-11-05: three flat stacks, no primary panel, no pin), through
 *   ./primaryFloor `readStoredLayout` (the SDK's `panelsOf`: the stored
 *   `panels` of version 1 or 2, else the ⏳ old slots converted — only those
 *   get the primary floor). Stored panels may hold no conversation at all
 *   (R-B, owner review 2026-10-14): every reader below degrades to "draw
 *   what is there". Everything downstream reads the DRAWN layout — `drawn`,
 *   the SDK's `resolveDrawn` — never the blob.
 * - **Measured width, never the viewport** (`containerW`, written by the root's
 *   ResizeObserver), the breakpoint, and the root's offsets.
 * - **The screen-size simulator** and the editor's mode flags the live session
 *   reads (`placing`, `liveStowed`, the toolbar's height).
 * - **The zones and the zone switch** (PLAN D11): the three zones' panels,
 *   the width each side takes, and — when the sides do not fit beside a
 *   readable middle, and always below `lg` — which one zone is drawn
 *   (`shownZone`). Full screen draws the whole opening zone and no switch.
 *   There is no rail, no pin, no tuck and no stage: every panel is open.
 * - **A Composer / Turn line follows a Messages copy** (PLAN D7): the
 *   dossier it is handed is its target's, told which channel and style.
 *
 * A factory rather than a class so the code reads as it did in the component:
 * plain `$derived`s over each other, handed out through getters. Nothing here
 * touches the DOM; the components measure and write the measured fields. The
 * model never writes `sessionZones` — the render publishes it.
 */
import type { ConversationDossierV1 } from "$lib/shared/widgets/conversation"
import * as Icons from "@lucide/svelte"
import { untrack } from "svelte"
import type { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
import type { PanelInstance } from "$lib/client/surfaces/types"
import { CORE_WIDGETS } from "$lib/shared/widgets/types"
import { shownChannels } from "$lib/client/components/sessionPage/requests/showChannel"
import { clearShownLine } from "$lib/client/components/sessionPage/requests/showLine"
import { readStoredLayout } from "./primaryFloor"
import { fullscreenActive, openingZone as openingZoneOf } from "./placementRules"
import {
	SIM_HEIGHT_PX,
	SIM_OPTIONS,
	mobileEditing,
	narrowWidth,
	simulatedGeometry,
	type SimGeometry,
	type SimTier
} from "./simulator"
import {
	dockedZoneWidths,
	emptyColumnPx,
	emptyColumnsPx,
	sideFlowPx,
	sidePopulated,
	sideSlot,
	sideWidthPx
} from "./sideSlot"
import { createSideRailModel } from "./sideRailModel.svelte"
import {
	channelClaims,
	channelsForCopy,
	laneClaims,
	type AnnexView,
	pageIdsHolders,
	primaryLogOf
} from "./channelClaims"
import { conversationKindOf, conversationTargetOf } from "./conversationTarget"
import {
	sessionZones,
	switchOn as switchOnFn,
	type ZoneId
} from "./sessionZones.svelte"
import { widgetSettingValues } from "$lib/client/stores/widgetSettings.svelte"
import {
	type DrawnPanel,
	drawnInstances,
	isInstanceOf,
	layoutWidgetIds,
	type PanelLayoutV1,
	type PanelLayoutV2,
	type PanelV2,
	panelsOf,
	resolveDrawn,
	type SessionChannelV1,
	type SessionLayoutV1
} from "@serene-pub/sdk"

/** The shell's panels context, as far as the session reads it. */
export type PanelsCtx = {
	leftPanel?: string | null
	rightPanel?: string | null
	fullscreen?: boolean
}

/** The desktop editor's two tabs (PLAN-session-panels-2026-10-14, Q4). */
export type EditTab = "layouts" | "arrange"

/** One side as the live view draws it. */
export interface SideView {
	/** Its panels, top to bottom — only what this session can draw. */
	panels: DrawnPanel[]
	/** Its width in the flow (./sideSlot `sideWidthPx`). */
	widthPx: number
	/** It draws at least one panel (./sideSlot `sidePopulated`). */
	populated: boolean
}

/** Is this a panel layout (version 1 or 2) a reader can walk (the editor's working copy)? */
function isPanelLayout(x: unknown): x is PanelLayoutV1 | PanelLayoutV2 {
	if (!x || typeof x !== "object") return false
	const p = x as Partial<PanelLayoutV1> & Partial<PanelLayoutV2>
	if (p.version === 2)
		return (
			Array.isArray(p.left) && Array.isArray(p.middle) && Array.isArray(p.right)
		)
	return (
		p.version === 1 &&
		!!p.middle &&
		typeof p.middle === "object" &&
		!!(p.middle as { primary?: unknown }).primary
	)
}

/** The ⏳ `zoneLayout.styles` of a stored blob (the message pack by name), or null. */
function legacyStylesOf(zoneLayout: unknown): { chat?: string } | null {
	if (!zoneLayout || typeof zoneLayout !== "object") return null
	const styles = (zoneLayout as { styles?: unknown }).styles
	if (!styles || typeof styles !== "object" || Array.isArray(styles))
		return null
	const chat = (styles as { chat?: unknown }).chat
	return typeof chat === "string" ? { chat } : {}
}

export interface SessionLayoutModelInput {
	readonly manager: SurfaceManager
	/** The layout editor is open. */
	readonly editing: boolean
	/**
	 * The editor's working arrangement while it is open — a `PanelLayoutV1` or
	 * `PanelLayoutV2` (the editor still emits v1), what the live view draws then, so the Layouts tab previews
	 * the arrangement in progress. Anything else (null while it is closed)
	 * draws the saved layout.
	 */
	readonly working: unknown
	readonly conversationDossier: ConversationDossierV1 | null
	/**
	 * 🚧 The viewer's user id and annex view: a Messages copy's
	 * `channelLaneFrom` resolves their lane from them (./channelClaims
	 * `laneClaims`). Absent, every lane claim shows nothing.
	 */
	readonly viewerId?: number | null
	readonly annex?: AnnexView
	/**
	 * 🚧 The session's channels as this viewer has them (`SessionV1.channels`,
	 * from `sessions:get`): a `channelLane: 'mine'` copy reads the viewer's
	 * own lane off them (./channelClaims `laneClaimOf`, the 100-turn walk's
	 * B2). Absent, such a copy shows its whole claimed channel.
	 */
	readonly channels?: ReadonlyArray<SessionChannelV1> | null
	readonly panelsCtx: PanelsCtx | undefined
	/**
	 * A placed id's title (./widgetSettingsFlow `widgetLabel`). Read lazily: the
	 * flow reads this model too, so neither can be built inside the other.
	 */
	widgetLabel(id: string): string
}

export function createSessionLayoutModel(input: SessionLayoutModelInput) {
	/* ── the stored layout (the one seam that reads it) ─────────────────────
	 * The genre's PRIMARY widget is the conversation, or — for a genre that
	 * withholds it (R71) — its own (Battleship's board). */
	let primaryId = $derived(
		input.manager.omitted.has("messages")
			? (input.manager.decls.find((p) => p.role === "primary")?.id ??
					"messages")
			: "messages"
	)
	/**
	 * The saved layout, as panels: what the row stores, read the way every
	 * reader reads a stored layout (./primaryFloor `readStoredLayout`): the
	 * omitted widgets' tabs out; the floor only for a converted blob.
	 */
	let savedPanels = $derived<PanelLayoutV2>(
		readStoredLayout(
			input.manager.arrangement,
			primaryId,
			input.manager.omitted
		).panels
	)
	// Widgets activated after the layout was saved (channel intents, the old
	// grid menu) still need a home: each becomes a panel of its own at the
	// foot of the right side. Never written — the layout is the person's.
	let activeSecondaryIds = $derived(
		input.manager.instances
			.filter((p) => p.role !== "primary" && p.active)
			.map((p) => p.id)
	)
	/**
	 * What the LIVE view draws: the editor's working panels while it is open
	 * (so the preview under the Layouts tab shows the arrangement in
	 * progress; a version 1 working copy is converted), else the saved ones
	 * — with the extras above.
	 */
	let panels = $derived.by((): PanelLayoutV2 => {
		// The working copy draws as it is: no floor (R-B, no lock).
		const w = input.working
		const base: PanelLayoutV2 =
			input.editing && isPanelLayout(w)
				? w.version === 2
					? w
					: panelsOf({ panels: w })
				: savedPanels
		const placed = new Set(layoutWidgetIds({ panels: base }))
		const extras = activeSecondaryIds.filter((id) => !placed.has(id))
		if (!extras.length) return base
		return {
			...base,
			right: [
				...base.right,
				...extras.map((id): PanelV2 => ({ key: `x:${id}`, tabs: [id] }))
			]
		}
	})
	/** The layout the SDK draws: the panels (the old slots are never read beside them). */
	let layoutDoc = $derived<SessionLayoutV1>({ panels })
	/** ⏳ The message pack pinned by name in the old `zoneLayout.styles`. */
	let legacyStyles = $derived(legacyStylesOf(input.manager.zoneLayout))

	/* ── measured width (never the viewport) ───────────────────────────────
	 * Written by the root: `containerW` off its ResizeObserver, the breakpoint
	 * off one matchMedia, the offsets off its own rect (`updateMargins`).
	 *
	 * `mLeft` IS the nav rail — 64px, or 208 while the rail is wide — plus any
	 * sidebar view open beside it, and `mRight` is 0. `bLeft` / `bRight` are
	 * `.layout-body`'s own edges (`bodyEl`, bound by the renderer). */
	let containerW = $state(1024)
	let vw = $state(1024)
	let mLeft = $state(0)
	let mRight = $state(0)
	let mTop = $state(0)
	let bLeft = $state(0)
	let bRight = $state(0)
	let bodyEl = $state.raw<HTMLElement | null>(null)
	let isDesktop = $state(false)
	/**
	 * Below the app's 1024px breakpoint (P6, ruled 2026-08-30): side zones take
	 * NO layout space, and the zone switch is always on (`switchOn`).
	 *
	 * `mounted` guards the pre-hydration frame: `isDesktop` starts optimistically
	 * false and is only told the truth on mount, so without it every desktop
	 * first paint would drop its side zones for a frame and snap them back.
	 */
	let mounted = $state(false)
	let isNarrow = $derived(mounted && !isDesktop)

	/* ── the screen-size simulator (P5, ruled 2026-08-30) ──────────────────
	 * `simTier` is the editor's width preset: null = Actual (the real
	 * viewport), otherwise a tier's width from ./simulator. The simulator is
	 * a LENS, not a second layout: nothing about it is persisted. */
	let simTier = $state<SimTier | null>(null)
	let simWidth = $derived(
		SIM_OPTIONS.find((o) => o.tier === simTier)?.width ?? null
	)
	let editTab = $state<EditTab>("arrange")
	let placing = $derived(input.editing && editTab === "arrange")
	// The editor's zone widths, for the real viewport or a simulated tier.
	let editGeom: SimGeometry = $derived(
		simulatedGeometry(simWidth ?? vw, {
			available: simWidth == null ? undefined : containerW - 24
		})
	)
	/** Frame scale as a percent; 100 = drawn at true size. */
	let simPct = $derived(Math.round(editGeom.scale * 100))
	/** The previewed device's height (the tier table's, not the window's). */
	let simHeight = $derived(simTier ? SIM_HEIGHT_PX[simTier] : 0)
	/** Is the previewed width below the app's breakpoint? */
	let simNarrow = $derived(narrowWidth(simWidth ?? vw))
	/** The editor draws rows (the PHONE editor, ruled 2026-09-10). */
	let mobileEdit = $derived(
		mobileEditing({ narrow: isNarrow, simNarrow })
	)
	/**
	 * A canvas is up, so the live session is STOWED under it — mounted and
	 * `display: none`, never unmounted. A REAL narrow window's row editor is
	 * drawn over the live session instead.
	 */
	let liveStowed = $derived(placing && (!mobileEdit || simWidth != null))
	/** The toolbar's measured height: its panel wraps, so it is never a constant. */
	let toolbarH = $state(0)
	/** The px the fixed toolbar takes above the root while it is up. */
	let editorTop = $derived(input.editing && !isNarrow ? toolbarH : 0)
	/** Where the LIVE view's viewport-pinned boxes start. */
	let liveTop = $derived(mTop + editorTop)

	/* ── the drawn layout ───────────────────────────────────────────────── */
	/**
	 * What this layout DRAWS, and where, at the measured width — the SDK's one
	 * reader (`resolveDrawn`): per zone its panels, each with its tabs, the
	 * tab shown, its height and priority (the declared defaults come from the
	 * core widgets: Messages fill / low, Composer fit / high, Turn line fit /
	 * normal), and the layout's look.
	 */
	let drawn = $derived(
		resolveDrawn(layoutDoc, { inline: containerW }, { widgets: CORE_WIDGETS })
	)
	/** The layout's look (backing, opacity, gap), read. */
	let look = $derived(drawn.look)
	/** The gap between panels, and between the zones, in px. */
	let gapPx = $derived(drawn.look.gapPx)

	/* ── what a panel holds ─────────────────────────────────────────────── */
	function inst(id: string): PanelInstance | undefined {
		return input.manager.instances.find((p) => p.id === id)
	}
	/** A `messages` instance — the bare id or a copy (`messages#sanctum`, S1). */
	const isMessages = (id: string) => isInstanceOf(id, "messages")
	/**
	 * Is this placed id drawn as the conversation — a `messages`, `composer` or
	 * `turn-line` instance, the bare id included (brief 7a: the log may sit in
	 * a side) or a copy? Never a panel instance, so `inst()` does not know it.
	 * A genre that withholds the conversation (R71) draws none.
	 */
	const isConversation = (id: string) =>
		conversationKindOf(id) !== null && !input.manager.omitted.has("messages")
	/** Something this session can draw: a conversation part or a panel instance. */
	const drawable = (id: string) => isConversation(id) || !!inst(id)
	/** A panel narrowed to the tabs this session can draw (none: not drawn). */
	function liveOf(p: DrawnPanel): DrawnPanel {
		const tabs = p.tabs.filter((t) => drawable(t.instanceId))
		if (tabs.length === p.tabs.length) return p
		return {
			...p,
			tabs,
			open: tabs.some((t) => t.instanceId === p.open)
				? p.open
				: (tabs[0]?.instanceId ?? "")
		}
	}
	const live = (list: readonly DrawnPanel[]) =>
		list.map(liveOf).filter((p) => p.tabs.length > 0)
	function middleWidgetLabel(id: string): string {
		return isInstanceOf(id, "messages") ? "Messages" : id
	}
	function middleWidgetIcon(_id: string) {
		return Icons.MessagesSquare
	}
	function iconOf(p: PanelInstance) {
		return (p.icon && (Icons as any)[p.icon]) || Icons.LayoutPanelTop
	}
	/** Each zone's panels, as this session draws them — a plain stack, top to bottom. */
	let zones = $derived({
		left: live(drawn.left.panels),
		middle: live(drawn.middle.panels),
		right: live(drawn.right.panels)
	})

	/* ── the sides ──────────────────────────────────────────────────────── */
	function viewOf(side: "left" | "right"): SideView {
		const ps = zones[side]
		return {
			panels: ps,
			widthPx: sideWidthPx(containerW),
			populated: sidePopulated({ panels: ps.length })
		}
	}
	let sides = $derived({ left: viewOf("left"), right: viewOf("right") })

	/* ── reading order, the channel claims, the primary log ──────────────── */
	const ids = (list: readonly DrawnPanel[]) =>
		list.flatMap((p) => p.tabs.map((t) => t.instanceId))
	/** Every zone's drawn ids in reading order (top to bottom). */
	let readingOrder = $derived({
		middle: ids(zones.middle),
		left: ids(zones.left),
		right: ids(zones.right)
	})
	/**
	 * Every id this layout places, anywhere: what its panels name and what
	 * they draw. The one list the channel claims (S1), the titles and the
	 * copies' declarations read.
	 */
	let placedIds = $derived(
		new Set<string>([
			...layoutWidgetIds({ panels }),
			...drawnInstances(drawn).map((i) => i.instanceId)
		])
	)
	/**
	 * Which placed conversation copy claims which channel (S1): a copy with a
	 * `channel` setting shows that channel alone; the others share the rest.
	 */
	let claims = $derived(
		channelClaims(placedIds, (id) => widgetSettingValues(id))
	)
	/** 🚧 Which claiming copy shows which lane of its channel to this viewer. */
	let lanes = $derived(
		laneClaims(placedIds, (id) => widgetSettingValues(id), {
			viewerId: input.viewerId,
			annex: input.annex,
			channels: input.channels ?? null
		})
	)
	let readingIds = $derived([
		...readingOrder.middle,
		...readingOrder.left,
		...readingOrder.right
	])
	/** The layout's primary log (./channelClaims `primaryLogOf`). */
	let primaryLog = $derived.by(() => primaryLogOf(readingIds, claims))
	/** The conversation mounts that hold the page's message ids. */
	let pageIdsHeld = $derived.by(() =>
		pageIdsHolders(
			readingIds,
			claims,
			input.conversationDossier?.composer.channels ?? []
		)
	)

	/* ── the zone switch (PLAN ★2/D11, ★3) ───────────────────────────────── */
	/** Full screen (never while editing): the whole opening zone, no switch. */
	let fullscreen = $derived(
		!input.editing && fullscreenActive(input.panelsCtx)
	)
	/** The zones that draw at least one panel, in Left · Middle · Right order. */
	let availableZones = $derived(
		(["left", "middle", "right"] as const).filter((z) => zones[z].length > 0)
	)
	/**
	 * The zone a phone or full screen opens on (★3): the zone of the layout's
	 * primary log, else the first holding a Messages copy, else the middle —
	 * and, if that zone draws nothing, the first one that does.
	 */
	let openingZone = $derived.by((): ZoneId => {
		const z = openingZoneOf({
			...readingOrder,
			claims,
			primaryId,
			isMessages
		})
		return availableZones.includes(z) ? z : (availableZones[0] ?? "middle")
	})
	/**
	 * What a side takes in the flow IF it were inline — the zone switch's
	 * question is whether the sides fit, so it is asked of the inline width
	 * whatever slot the side is in now, which keeps it from flickering.
	 */
	let dockedFlow = $derived({
		left: sideFlowPx({
			slot: "inline",
			populated: sides.left.populated,
			widthPx: sides.left.widthPx
		}),
		right: sideFlowPx({
			slot: "inline",
			populated: sides.right.populated,
			widthPx: sides.right.widthPx
		})
	})
	/**
	 * Is the zone switch on (./sessionZones `switchOn`)? Always below `lg`; on
	 * a desktop when the sides, their gaps and the stage's measure do not fit
	 * the box. Never before mount, while editing or in full screen.
	 */
	let switchOn = $derived(
		mounted &&
			!input.editing &&
			!fullscreen &&
			switchOnFn({
				narrow: isNarrow,
				bodyPx: containerW,
				leftPx: dockedFlow.left,
				rightPx: dockedFlow.right,
				gapPx
			})
	)
	/**
	 * The one zone drawn right now, or null for all three. Full screen: the
	 * opening zone. Switch on: the person's choice (`sessionZones.shown`, which
	 * the render publishes) while that zone is still available, else the
	 * opening zone.
	 */
	let shownZone = $derived.by((): ZoneId | null => {
		if (fullscreen) return openingZone
		if (!switchOn) return null
		const chosen = sessionZones.shown
		return chosen !== null && availableZones.includes(chosen)
			? chosen
			: openingZone
	})

	/* ── one mount per side, three places (the no-reload law) ───────────────
	 * The live render writes each side ONCE and moves the container around
	 * it; `sideSlot` is the whole decision (and its unit tests). */
	let leftSlot = $derived(
		sideSlot({ narrow: isNarrow, shown: shownZone, side: "left" })
	)
	let rightSlot = $derived(
		sideSlot({ narrow: isNarrow, shown: shownZone, side: "right" })
	)
	/** The middle: in the flow, or stowed while a side is the one zone drawn. */
	let centerSlot = $derived<"flow" | "stowed">(
		shownZone === null || shownZone === "middle" ? "flow" : "stowed"
	)
	const slotOf = (side: "left" | "right") =>
		side === "left" ? leftSlot : rightSlot
	/** What each side DRAWS in the row — 0 for an empty, stowed or solo side. */
	let drawnFlow = $derived({
		left: sideFlowPx({
			slot: slotOf("left"),
			populated: sides.left.populated,
			widthPx: sides.left.widthPx
		}),
		right: sideFlowPx({
			slot: slotOf("right"),
			populated: sides.right.populated,
			widthPx: sides.right.widthPx
		})
	})
	/**
	 * An EMPTY side keeps its column (ruled 2026-09-29; ./sideSlot
	 * `emptyColumnPx` / `emptyColumnsPx`): a side in the flow asks for the
	 * width its first panel will have. The ask is soft: granted only from room
	 * the populated sides and the stage's measure do not need.
	 */
	const emptyAsk = (side: "left" | "right") =>
		emptyColumnPx({
			slot: slotOf(side),
			populated: sides[side].populated,
			widthPx: sides[side].widthPx
		})
	let emptyColumns = $derived(
		emptyColumnsPx({
			hardLeftPx: drawnFlow.left,
			hardRightPx: drawnFlow.right,
			emptyLeftPx: emptyAsk("left"),
			emptyRightPx: emptyAsk("right"),
			bodyPx: containerW,
			gapPx
		})
	)
	let sideWidths = $derived(
		dockedZoneWidths({
			left: drawnFlow.left || emptyColumns.left,
			right: drawnFlow.right || emptyColumns.right,
			bodyPx: containerW,
			gapPx
		})
	)

	/* ── the dossier a conversation part is handed ───────────────────────── */
	/**
	 * The dossier one Messages copy is handed: the page's, with its composer
	 * told only this copy's channels. The page's own object when nothing
	 * narrows it.
	 */
	function narrowedDossier(id: string): ConversationDossierV1 | null {
		const d = input.conversationDossier
		if (!d) return d
		const all = d.composer.channels
		const mine = channelsForCopy(all, claims, id, primaryLog, lanes)
		if (mine.length === all.length && mine.every((c, i) => c === all[i]))
			return d
		return { ...d, composer: { ...d.composer, channels: mine } }
	}
	/**
	 * True when a drawn tab is a Dialogue box. Every tab stays mounted, so a
	 * Messages copy beside it would otherwise autoplay the newest line and take
	 * the one automatic voice from the box.
	 */
	let holdsDialogueBox = $derived(
		(["left", "middle", "right"] as const).some((z) =>
			zones[z].some((p) =>
				p.tabs.some((t) => isInstanceOf(t.instanceId, "dialogue-box"))
			)
		)
	)
	/**
	 * While a Dialogue box is drawn, a Messages copy's dossier waits for a click
	 * (`auto` becomes `click`; `never` and `click` stay): the box speaks on its
	 * own, the Log's player still plays a line when pressed. The same object when
	 * nothing changes.
	 */
	function oneVoice(d: ConversationDossierV1 | null): ConversationDossierV1 | null {
		if (!d || !holdsDialogueBox) return d
		if (d.spokenPlayback !== undefined && d.spokenPlayback !== "auto") return d
		return { ...d, spokenPlayback: "click" }
	}
	// The Dialogue box sends nothing when it unmounts (SDK `show-line`), so
	// without this the stage stays held on an old line after a switch to a
	// layout with no box. The clear is untracked: it writes the map it reads.
	$effect(() => {
		if (!holdsDialogueBox) untrack(clearShownLine)
	})
	// Leaving the page drops the line too.
	$effect(() => () => untrack(clearShownLine))
	/**
	 * The Messages copy each Composer / Turn line last followed (memory, not
	 * state: it feeds the pick and must never become a dependency loop). A
	 * panel showing a non-Messages tab keeps writing to it ("Writing to").
	 */
	const lastTargets = new Map<string, string>()
	/** The Messages copy a Composer / Turn line follows (./conversationTarget, PLAN D7). */
	function targetPick(id: string) {
		const kind = conversationKindOf(id)
		if (kind !== "composer" && kind !== "turn-line") return null
		const asZones = (list: readonly DrawnPanel[]) =>
			list.map((p) => ({
				key: p.key,
				tabs: p.tabs.map((t) => t.instanceId),
				open: p.open
			}))
		const pick = conversationTargetOf({
			zones: {
				left: asZones(zones.left),
				middle: asZones(zones.middle),
				right: asZones(zones.right)
			},
			instanceId: id,
			isMessages,
			last: lastTargets.get(id) ?? null
		})
		if (pick) lastTargets.set(id, pick.target)
		return pick
	}
	/**
	 * The Messages copy a Composer / Turn line follows, or null (not one of
	 * those, or no Messages placed). The render uses it so a Composer / Turn
	 * line WEARS its target's style unless pinned its own (D8).
	 */
	function conversationTargetFor(id: string): string | null {
		return targetPick(id)?.target ?? null
	}
	const titleCased = (slug: string) =>
		slug
			.split(/[-_\s]+/)
			.filter(Boolean)
			.map((w) => w[0].toUpperCase() + w.slice(1))
			.join(" ")
	/**
	 * The dossier one conversation part is handed. A Messages copy: the page's,
	 * narrowed to its channels. A Composer / Turn line: its target's, told the
	 * channel that copy shows, its label, and its line width and presentation
	 * (PLAN D7). With no target, the page's own (the Composer then writes to the
	 * first writable channel).
	 */
	function dossierFor(id: string): ConversationDossierV1 | null {
		const pick = targetPick(id)
		if (!pick) {
			const n = narrowedDossier(id)
			return conversationKindOf(id) === "messages" ? oneVoice(n) : n
		}
		const td = narrowedDossier(pick.target)
		if (!td) return td
		const channel =
			shownChannels.get(pick.target) ?? td.composer.channels[0] ?? "main"
		const slug = channel.split(":")[0]
		const label = td.composer.channelLabels?.[slug] ?? titleCased(slug)
		const settings = widgetSettingValues(pick.target)
		const lineWidth = settings.lineWidth
		const presentation = settings.presentation
		return {
			...td,
			composer: {
				...td.composer,
				target: {
					instance: pick.target,
					channel,
					label,
					...(lineWidth === "column" ||
					lineWidth === "full" ||
					lineWidth === "comfortable"
						? { lineWidth }
						: {}),
					...(presentation === "rows" || presentation === "folio"
						? { presentation }
						: {})
				},
				...(pick.writingTo ? { writingTo: { channel, label } } : {})
			}
		}
	}

	/* ── the panel placement and tab icons (./sideRailModel) ──────────────── */
	const rail = createSideRailModel({ inst, iconOf, middleWidgetIcon })

	return {
		// the stored layout
		get primaryId() {
			return primaryId
		},
		get savedPanels() {
			return savedPanels
		},
		get panels() {
			return panels
		},
		get activeSecondaryIds() {
			return activeSecondaryIds
		},
		get legacyStyles() {
			return legacyStyles
		},
		// measured
		get containerW() {
			return containerW
		},
		set containerW(v: number) {
			containerW = v
		},
		get vw() {
			return vw
		},
		set vw(v: number) {
			vw = v
		},
		get mLeft() {
			return mLeft
		},
		set mLeft(v: number) {
			mLeft = v
		},
		get mRight() {
			return mRight
		},
		set mRight(v: number) {
			mRight = v
		},
		get mTop() {
			return mTop
		},
		set mTop(v: number) {
			mTop = v
		},
		get bLeft() {
			return bLeft
		},
		set bLeft(v: number) {
			bLeft = v
		},
		get bRight() {
			return bRight
		},
		set bRight(v: number) {
			bRight = v
		},
		get bodyEl() {
			return bodyEl
		},
		set bodyEl(v: HTMLElement | null) {
			bodyEl = v
		},
		get isDesktop() {
			return isDesktop
		},
		set isDesktop(v: boolean) {
			isDesktop = v
		},
		get mounted() {
			return mounted
		},
		set mounted(v: boolean) {
			mounted = v
		},
		get isNarrow() {
			return isNarrow
		},
		// the simulator and the editor's mode flags
		get editing() {
			return input.editing
		},
		get simTier() {
			return simTier
		},
		set simTier(v: SimTier | null) {
			simTier = v
		},
		get simWidth() {
			return simWidth
		},
		get editTab() {
			return editTab
		},
		set editTab(v: EditTab) {
			editTab = v
		},
		get placing() {
			return placing
		},
		get editGeom() {
			return editGeom
		},
		get simPct() {
			return simPct
		},
		get simHeight() {
			return simHeight
		},
		get simNarrow() {
			return simNarrow
		},
		get mobileEdit() {
			return mobileEdit
		},
		get liveStowed() {
			return liveStowed
		},
		get toolbarH() {
			return toolbarH
		},
		set toolbarH(v: number) {
			toolbarH = v
		},
		get editorTop() {
			return editorTop
		},
		get liveTop() {
			return liveTop
		},
		// the drawn layout
		get drawn() {
			return drawn
		},
		get look() {
			return look
		},
		get gapPx() {
			return gapPx
		},
		get zones() {
			return zones
		},
		get holdsDialogueBox() {
			return holdsDialogueBox
		},
		get sides() {
			return sides
		},
		// what a panel holds
		inst,
		isConversation,
		isMessages,
		middleWidgetLabel,
		middleWidgetIcon,
		iconOf,
		// flows, slots
		get emptyColumns() {
			return emptyColumns
		},
		get sideWidths() {
			return sideWidths
		},
		get leftSlot() {
			return leftSlot
		},
		get rightSlot() {
			return rightSlot
		},
		get centerSlot() {
			return centerSlot
		},
		// the zone switch
		get availableZones() {
			return availableZones
		},
		get openingZone() {
			return openingZone
		},
		get switchOn() {
			return switchOn
		},
		get shownZone() {
			return shownZone
		},
		get fullscreen() {
			return fullscreen
		},
		// reading order, claims, the dossier
		get placedIds() {
			return placedIds
		},
		get pageIdsHeld() {
			return pageIdsHeld
		},
		dossierFor,
		conversationTargetFor,
		// panel placement and tab icons
		rail
	}
}

export type SessionLayoutModel = ReturnType<typeof createSessionLayoutModel>
