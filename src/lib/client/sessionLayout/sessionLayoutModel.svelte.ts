/**
 * The session layout's MODEL: what the session draws right now, and every
 * decision the renderer and the editor both read. The composition root
 * (./SessionLayout) builds one per page.
 *
 * - **The stored layout, read once.** The manager couriers the person's saved
 *   layout; this file is the one seam that reads it — as PANELS
 *   (PLAN-session-panels-2026-10-14), through ./primaryFloor
 *   `readStoredLayout` (the SDK's `panelsOf`: the stored `panels`, else the ⏳
 *   old slots converted — only those get the primary floor). Stored panels
 *   may hold no conversation at all, and their primary any widget (R-B,
 *   owner review 2026-10-14): every reader below degrades to "draw what is
 *   there". Everything downstream
 *   reads the DRAWN layout — `drawn`, the SDK's `resolveDrawn` — never the
 *   blob.
 * - **Measured width, never the viewport** (`containerW`, written by the root's
 *   ResizeObserver), the breakpoint, and the root's offsets.
 * - **The screen-size simulator** and the editor's mode flags the live session
 *   reads (`placing`, `liveStowed`, the toolbar's height).
 * - **The sides**: each a column of panels plus its rail — the rung, the
 *   tuck, the flow widths, the slots, the stage — and **the side rail model**
 *   (the transient open state of each panel, and the column layout over it).
 *
 * A factory rather than a class so the code reads as it did in the component:
 * plain `$derived`s over each other, handed out through getters. Nothing here
 * touches the DOM; the components measure and write the measured fields.
 */
import type { ConversationDossierV1 } from "$lib/shared/widgets/conversation"
import * as Icons from "@lucide/svelte"
import type { SurfaceManager } from "$lib/client/surfaces/panelManager.svelte"
import type { PanelInstance } from "$lib/client/surfaces/types"
import { readStoredLayout, withPrimaryFilled } from "./primaryFloor"
import { primaryLogPick, stageOf, type StagePick } from "./placementRules"
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
	MIN_CENTER_PX,
	emptyColumnPx,
	emptyColumnsPx,
	sideFlowPx,
	sidePopulated,
	sideSlot,
	type SideMode
} from "./sideSlot"
import { createSideRailModel } from "./sideRailModel.svelte"
import { tuckedSidesOf } from "./tuckedSides"
import { stageOnlyActive, stagePanelOf } from "./stageOnly"
import {
	channelClaims,
	channelsForCopy,
	laneClaims,
	type AnnexView,
	pageIdsHolders,
	primaryLogOf
} from "./channelClaims"
import { mobileSidePanels } from "./mobileSidePanels.svelte"
import { widgetSettingValues } from "$lib/client/stores/widgetSettings.svelte"
import { desktop } from "$lib/client/utils/breakpoint.svelte"
import {
	type DrawnPanel,
	drawnInstances,
	isInstanceOf,
	layoutWidgetIds,
	type PanelLayoutV1,
	type PanelV1,
	resolveDrawn,
	type SessionChannelV1,
	type SessionLayoutV1,
	type ZoneRung
} from "@serene-pub/sdk"

/** `.layout-body`'s 0.5rem flex gap — one per side actually in the flow. */
export const BODY_GAP_PX = 8

/** The shell's panels context, as far as the session reads it. */
export type PanelsCtx = {
	leftPanel?: string | null
	rightPanel?: string | null
	stageOnly?: boolean
}

/** The desktop editor's two tabs (PLAN-session-panels-2026-10-14, Q4). */
export type EditTab = "layouts" | "arrange"

/** One side as the live view draws it. */
export interface SideView {
	/** Its panels, top to bottom — only what this session can draw. */
	panels: DrawnPanel[]
	/** Its width ladder's rung at the measured width (`resolveDrawn`). */
	rung: ZoneRung
	/**
	 * The mode it docks at: the rung's, except that the side holding the
	 * layout's primary log is a docked rail whatever its rung or pins (brief
	 * 7a review) — never a drawer, never a rail of icons.
	 */
	mode: SideMode
	/** The rung's footprint, `width × columns`. */
	widthPx: number
	/** It draws at least one panel on a visible rung (./sideSlot `sidePopulated`). */
	populated: boolean
}

/** Is this a panel layout a reader can walk (the editor's working copy)? */
function isPanelLayout(x: unknown): x is PanelLayoutV1 {
	if (!x || typeof x !== "object") return false
	const p = x as Partial<PanelLayoutV1>
	return (
		p.version === 1 &&
		!!p.middle &&
		typeof p.middle === "object" &&
		!!p.middle.primary
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
	 * The editor's working arrangement while it is open — a `PanelLayoutV1`,
	 * what the live view draws then, so the Layouts tab previews
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
	let savedPanels = $derived<PanelLayoutV1>(
		readStoredLayout(
			input.manager.arrangement,
			primaryId,
			input.manager.omitted
		).panels!
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
	 * progress), else the saved ones — with the extras above.
	 */
	let panels = $derived.by((): PanelLayoutV1 => {
		// The working copy draws as it is: no floor (R-B, no lock).
		const base =
			input.editing && isPanelLayout(input.working)
				? input.working
				: savedPanels
		const placed = new Set(layoutWidgetIds({ panels: base }))
		const extras = activeSecondaryIds.filter((id) => !placed.has(id))
		if (!extras.length) return base
		return {
			...base,
			right: [
				...(base.right ?? []),
				...extras.map((id): PanelV1 => ({ key: `x:${id}`, tabs: [id] }))
			]
		}
	})
	/**
	 * The layout the SDK draws: the panels, and — ⏳ only for the width
	 * ladder each side walks (a side's `rules`) — the row's old `zoneLayout`.
	 * With `panels` present the old slots are never read as an arrangement.
	 */
	let layoutDoc = $derived<SessionLayoutV1>({
		panels,
		...(input.manager.zoneLayout !== undefined
			? { zoneLayout: input.manager.zoneLayout as SessionLayoutV1["zoneLayout"] }
			: {})
	})
	/** ⏳ The message pack pinned by name in the old `zoneLayout.styles`. */
	let legacyStyles = $derived(legacyStylesOf(input.manager.zoneLayout))

	/* ── measured width (never the viewport) ───────────────────────────────
	 * Written by the root: `containerW` off its ResizeObserver, the breakpoint
	 * off one matchMedia, the offsets off its own rect (`updateMargins`).
	 *
	 * `mLeft` IS the nav rail — 64px, or 208 while the rail is wide — plus any
	 * sidebar view open beside it, and `mRight` is 0. `bLeft` / `bRight` are
	 * `.layout-body`'s own edges, for the flyout (`bodyEl`, bound by the
	 * renderer). */
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
	 * NO layout space — no rails, no icon strips — and a populated side is
	 * reached only through the header's panels menu.
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
	 * tab shown, its pin and its height, and each side's rung.
	 */
	let drawn = $derived(resolveDrawn(layoutDoc, { inline: containerW }))

	/* ── what a panel holds ─────────────────────────────────────────────── */
	function inst(id: string): PanelInstance | undefined {
		return input.manager.instances.find((p) => p.id === id)
	}
	/**
	 * Is this placed id drawn as the conversation — a `messages` instance, the
	 * bare id included (brief 7a: the log may sit in a side), or a copy
	 * (`messages#sanctum`, S1)? Never a panel instance, so `inst()` does not
	 * know it. A genre that withholds the conversation (R71) draws none.
	 */
	const isConversation = (id: string) =>
		isInstanceOf(id, "messages") && !input.manager.omitted.has("messages")
	/** Something this session can draw: a conversation or a panel instance. */
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
	/** Each side's panels, as this session draws them. */
	let sidePanels = $derived({
		left: live(drawn.left.panels),
		right: live(drawn.right.panels)
	})
	/**
	 * The middle's three places, as this session draws them. A primary that
	 * draws nothing here gives its place to the nearest middle panel
	 * (./primaryFloor `withPrimaryFilled`) — the primary is a place, never a
	 * widget, so it is never left blank while the middle holds something.
	 */
	let middle = $derived(
		withPrimaryFilled({
			above: live(drawn.middle.above),
			primary: liveOf(drawn.middle.primary),
			below: live(drawn.middle.below)
		})
	)

	/* ── one mount per side, three places (the no-reload law) ───────────────
	 * The live render writes each side ONCE and moves the container around
	 * it; `sideSlot` is the whole decision (and its unit tests). */
	let mobileSide = $derived(isNarrow ? mobileSidePanels.open : null)
	let leftSlot = $derived.by(() =>
		sideSlot({
			narrow: isNarrow,
			overlayOwns: mobileSide === "left",
			stage: stageSide === "left"
		})
	)
	let rightSlot = $derived.by(() =>
		sideSlot({
			narrow: isNarrow,
			overlayOwns: mobileSide === "right",
			stage: stageSide === "right"
		})
	)
	const slotOf = (side: "left" | "right") =>
		side === "left" ? leftSlot : rightSlot

	/* ── the sides ──────────────────────────────────────────────────────── */
	function viewOf(side: "left" | "right"): SideView {
		const z = drawn[side]
		const rung = z.rung ?? { mode: "rail" as const, width: 264, columns: 1 }
		const ps = sidePanels[side]
		const mode: SideMode =
			logSide === side && rung.mode !== "hidden" ? "rail" : rung.mode
		return {
			panels: ps,
			rung,
			mode,
			widthPx: rung.width * rung.columns,
			populated: sidePopulated({ mode, panels: ps.length })
		}
	}
	let sides = $derived({ left: viewOf("left"), right: viewOf("right") })
	/**
	 * Is this side RAIL ONLY (lane E1): every panel in the rail, or a rung
	 * that does not dock (a drawer, on a narrow desktop)? Then nothing in it
	 * is docked — every panel is a rail icon until opened — so it is drawn
	 * the way a tucked side is (its rail, the panel asked for out over the
	 * session) and takes a rail's width in the flow, never the ladder's
	 * column (./sideSlot `sideFlowPx`). "Rail only" is not stored: it is
	 * every panel `pinned: false`.
	 *
	 * Never the side holding the primary log: the log is what a session is
	 * read and written in, and it is never put behind a rail icon.
	 */
	function railOnlyAt(side: "left" | "right"): boolean {
		const v = sides[side]
		if (logSide === side || !v.populated) return false
		return v.mode !== "rail" || v.panels.every((p) => !p.pinned)
	}
	/** The rail-only sides (`railOnlyAt`). */
	let railOnly = $derived({
		left: railOnlyAt("left"),
		right: railOnlyAt("right")
	})

	/* ── tucked sides (ruled 2026-09-27; ./tuckedSides) ─────────────────────
	 * Decided from the session's own measured box (`containerW`), never the
	 * viewport. The threshold is each side's DOCKED footprint plus a gap each,
	 * plus the stage's measure, so tucking cannot free the room that would
	 * untuck it. Not below the breakpoint and not while the editor is open. */
	const flowOf = (side: "left" | "right", tucked: boolean) =>
		sideFlowPx({
			slot: slotOf(side),
			populated: sides[side].populated,
			mode: sides[side].mode,
			widthPx: sides[side].widthPx,
			tucked
		})
	let dockedFlow = $derived({
		left: flowOf("left", railOnly.left),
		right: flowOf("right", railOnly.right)
	})
	/**
	 * Which sides the WIDTH tucks (./tuckedSides `tuckedSidesOf`): the side
	 * holding the primary log never is (`logSide`, brief 7a review) and the
	 * other side tucks once the body cannot hold both docked sides and the
	 * middle's own reserve.
	 */
	let tuckedByWidth = $derived.by((): { left: boolean; right: boolean } =>
		mounted && !isNarrow && !input.editing
			? tuckedSidesOf({
					leftPx: dockedFlow.left,
					rightPx: dockedFlow.right,
					gapPx: BODY_GAP_PX,
					bodyPx: containerW,
					logSide,
					middleMinPx: MIN_CENTER_PX
				})
			: { left: false, right: false }
	)
	/**
	 * Which sides are DRAWN tucked — their icon rail, one panel at a time out
	 * over the session: the ones the width tucks, and a rail-only side at any
	 * width, which has nothing docked to draw. Below the breakpoint a side is
	 * stowed or a sheet, and neither has a rail.
	 */
	let tucked = $derived({
		left: tuckedByWidth.left || (railOnly.left && !isNarrow),
		right: tuckedByWidth.right || (railOnly.right && !isNarrow)
	})
	/** Is either side tucked by the WIDTH — for what the whole body does about it. */
	let sidesAreTucked = $derived(tuckedByWidth.left || tuckedByWidth.right)
	/** What each side DRAWS in the row — 0 for an empty side. */
	let drawnFlow = $derived({
		left: flowOf("left", tucked.left),
		right: flowOf("right", tucked.right)
	})
	/**
	 * An EMPTY side keeps its column (ruled 2026-09-29; ./sideSlot
	 * `emptyColumnPx` / `emptyColumnsPx`): a side that docks at this width
	 * asks for the width its first panel will have. The ask is soft: granted
	 * only from room the populated sides and the stage's measure do not need.
	 */
	const emptyAsk = (side: "left" | "right") =>
		emptyColumnPx({
			slot: slotOf(side),
			tucked: tucked[side],
			populated: sides[side].populated,
			mode: sides[side].mode,
			widthPx: sides[side].widthPx
		})
	let emptyColumns = $derived(
		emptyColumnsPx({
			hardLeftPx: drawnFlow.left,
			hardRightPx: drawnFlow.right,
			emptyLeftPx: emptyAsk("left"),
			emptyRightPx: emptyAsk("right"),
			bodyPx: containerW,
			gapPx: BODY_GAP_PX
		})
	)
	let sideWidths = $derived(
		dockedZoneWidths({
			left: drawnFlow.left || emptyColumns.left,
			right: drawnFlow.right || emptyColumns.right,
			bodyPx: containerW,
			gapPx: BODY_GAP_PX
		})
	)

	/* ── reading order, the channel claims, the primary log ──────────────── */
	const ids = (list: readonly DrawnPanel[]) =>
		list.flatMap((p) => p.tabs.map((t) => t.instanceId))
	/**
	 * Every zone's drawn ids in reading order — the middle's primary panel,
	 * left, right, and the strips (above, then below), which the stage never
	 * draws but the claims count.
	 */
	let readingOrder = $derived({
		middle: middle.primary.floor ? [] : ids([middle.primary]),
		left: ids(sidePanels.left),
		right: ids(sidePanels.right),
		strips: [...ids(middle.above), ...ids(middle.below)]
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
		...readingOrder.right,
		// The strips too: `claims` counts a copy placed there, so a primary log
		// picked without them would hand the claiming copy the rest while the
		// strip's unclaimed copy showed it as well — the same rows twice.
		...readingOrder.strips
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
	/**
	 * The dossier one conversation copy is handed: the page's, with its
	 * composer told only this copy's channels. The page's own object when
	 * nothing narrows it.
	 */
	function dossierFor(id: string): ConversationDossierV1 | null {
		const d = input.conversationDossier
		if (!d) return d
		const all = d.composer.channels
		const mine = channelsForCopy(all, claims, id, primaryLog, lanes)
		if (mine.length === all.length && mine.every((c, i) => c === all[i]))
			return d
		return { ...d, composer: { ...d.composer, channels: mine } }
	}

	/* ── the stage (QE, ./placementRules; brief 7a) ─────────────────────────
	 * Stage only and the phone draw ONE widget as the stage — the layout's
	 * primary log, in whichever zone holds it. In a side that side's mount
	 * becomes the stage (./sideSlot's `stage` slot); the middle is hidden with
	 * the rest, and on the phone its panels join the panels menu as "Middle".
	 * Marks and containers only — nothing unmounts, and nothing is written. */
	let stageOnly = $derived(
		!input.editing && stageOnlyActive(input.panelsCtx, desktop.matches)
	)
	/**
	 * With no conversation placed (R-B) the stage is the primary panel, else
	 * — a middle with nothing in it — the first panel drawn anywhere.
	 */
	let stagePick = $derived<StagePick | null>(
		stageOf({ ...readingOrder, claims, primaryId })
	)
	/** Where the layout's primary log IS, whatever QE draws. */
	let logPick = $derived<StagePick | null>(
		primaryLogPick({ ...readingOrder, claims, primaryId })
	)
	/**
	 * The side holding the primary log on the DESKTOP, or null when the middle
	 * holds it (brief 7a review). That side never tucks, is never rail only,
	 * and the panel holding the log is docked whatever its pin. Not below the
	 * breakpoint and not while editing.
	 */
	let logSide = $derived<"left" | "right" | null>(
		mounted &&
			!isNarrow &&
			!input.editing &&
			logPick &&
			logPick.zone !== "middle"
			? logPick.zone
			: null
	)
	/** The panel holding the log, keyed, on the side holding it (else none). */
	function logPanelKeys(side: "left" | "right"): ReadonlySet<string> {
		if (logSide !== side || !logPick) return new Set()
		const p = sidePanels[side].find((x) =>
			x.tabs.some((t) => t.instanceId === logPick!.id)
		)
		return new Set(p ? [p.key] : [])
	}
	/**
	 * The side drawn as the stage right now, or null: on the phone, and in
	 * Stage only, while the stage sits in a side. Never while editing.
	 */
	let stageSide = $derived<"left" | "right" | null>(
		!input.editing &&
			(isNarrow || stageOnly) &&
			stagePick &&
			stagePick.zone !== "middle"
			? stagePick.zone
			: null
	)
	/**
	 * The middle on the phone while a side is the stage: stowed (mounted,
	 * `display: none`), or opened from the panels menu as a sheet of its own.
	 */
	let centerSlot = $derived<"flow" | "stowed" | "overlay">(
		stageSide && isNarrow
			? mobileSide === "middle"
				? "overlay"
				: mobileSide === stageSide
					? "flow"
					: "stowed"
			: "flow"
	)
	/** The key of the panel on `side` holding the stage, or null. */
	function stagePanelKey(side: "left" | "right"): string | null {
		return stagePanelOf(
			sidePanels[side],
			stagePick?.zone === side ? stagePick.id : null
		)
	}
	/** The middle's stage while Stage only draws it there, else null. */
	let stageMiddleId = $derived(
		stageOnly && stagePick?.zone === "middle" ? stagePick.id : null
	)
	/** The middle panel holding the stage while Stage only draws it there. */
	let stageMiddleKey = $derived(
		stagePanelOf(
			[...middle.above, middle.primary, ...middle.below],
			stageMiddleId
		)
	)
	/**
	 * Is this middle panel hidden while Stage only draws the middle's stage?
	 * Never when no panel holds it: hiding every panel would leave it blank.
	 */
	function middleStageHidden(p: DrawnPanel): boolean {
		return stageMiddleKey !== null && p.key !== stageMiddleKey
	}

	/* ── the side rail model (ruled 2026-09-10; ./sideRailModel) ──────────── */
	const rail = createSideRailModel({
		inst,
		iconOf,
		middleWidgetIcon,
		widgetLabel: (id) => input.widgetLabel(id)
	})

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
		get middle() {
			return middle
		},
		get sides() {
			return sides
		},
		// what a panel holds
		inst,
		isConversation,
		middleWidgetLabel,
		middleWidgetIcon,
		iconOf,
		// flows, tuck, slots
		get railOnly() {
			return railOnly
		},
		get tucked() {
			return tucked
		},
		get sidesAreTucked() {
			return sidesAreTucked
		},
		/** The middle is one column of panels, always: it carries the balance. */
		get middleOneColumn() {
			return true
		},
		get emptyColumns() {
			return emptyColumns
		},
		get sideWidths() {
			return sideWidths
		},
		get mobileSide() {
			return mobileSide
		},
		get leftSlot() {
			return leftSlot
		},
		get rightSlot() {
			return rightSlot
		},
		// reading order, claims, stage
		get placedIds() {
			return placedIds
		},
		get pageIdsHeld() {
			return pageIdsHeld
		},
		dossierFor,
		get stageOnly() {
			return stageOnly
		},
		get stagePick() {
			return stagePick
		},
		get stageSide() {
			return stageSide
		},
		get centerSlot() {
			return centerSlot
		},
		stagePanelKey,
		get stageMiddleKey() {
			return stageMiddleKey
		},
		middleStageHidden,
		logPanelKeys,
		// the side rail model
		rail
	}
}

export type SessionLayoutModel = ReturnType<typeof createSessionLayoutModel>
