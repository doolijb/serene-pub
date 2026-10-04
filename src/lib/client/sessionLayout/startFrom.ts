/**
 * The layout editor's **Start from** pane as words and groups (brief 4 of
 * `PLAN-layout-one-format-2026-09-28`), shared by the desktop toolbar and the
 * phone's layouts sheet so both say the same thing.
 *
 * Under the copy model a session's layout is its own (owner L2): a card, the
 * **Updated** offer, **Start again from "X"**, **Reset to genre default
 * layout** and **Start from scratch** all REPLACE it with a copy, so each is
 * confirmed first, in words that say what goes. Where a copied layout
 * CARRIES a widget's settings or style, those win, and the session keeps
 * everything else (owner LB) — a widget it places at its defaults carries
 * nothing, so it resets nothing; scratch puts every widget back at its
 * defaults (owner LC).
 * Where the layout started from is provenance only (NOMENCLATURE §9
 * **started from**): the status line and the offer read it, nothing draws
 * from it.
 */

type LayoutPreset = Sockets.Sessions.LayoutPreset

/** One labelled group of cards in the pane. */
export interface PresetGroup {
	key: string
	label: string
	presets: LayoutPreset[]
}

/** Core's name, as the group and the Updated sentence say it. */
const CORE_NAME = "Serene Pub"

function pluginNameOf(p: LayoutPreset): string {
	return p.pluginName ?? p.pluginId ?? "A plugin"
}

function groupOf(p: LayoutPreset): { key: string; label: string; rank: number } {
	if (p.isGenreDefault)
		return { key: "genre-default", label: "Genre default layout", rank: 0 }
	if (p.origin === "core")
		return { key: "core", label: `From ${CORE_NAME}`, rank: 1 }
	if (p.origin === "plugin")
		return {
			key: `plugin:${p.pluginId ?? ""}`,
			label: `From ${pluginNameOf(p)}`,
			rank: 2
		}
	return p.mine
		? { key: "yours", label: "Your layouts", rank: 3 }
		: { key: "shared", label: "Shared with you", rank: 4 }
}

/**
 * The cards, grouped by who brought them: the **genre default layout**, core's
 * other layouts (_From Serene Pub_), one group per plugin (by name), _Your
 * layouts_, then _Shared with you_. The server already sends them in that
 * order; grouping here does not depend on it. Within a group the order is the
 * server's, and an empty group is never returned.
 */
export function groupLayoutPresets(
	presets: readonly LayoutPreset[]
): PresetGroup[] {
	const groups = new Map<string, PresetGroup & { rank: number }>()
	for (const p of presets) {
		const { key, label, rank } = groupOf(p)
		let g = groups.get(key)
		if (!g) groups.set(key, (g = { key, label, rank, presets: [] }))
		g.presets.push(p)
	}
	return [...groups.values()]
		.sort(
			(a, b) =>
				a.rank - b.rank ||
				(a.rank === 2 ? a.label.localeCompare(b.label) : 0)
		)
		.map(({ key, label, presets }) => ({ key, label, presets }))
}

/** A layout's name as the pane quotes it. */
export const quoted = (name: string) => `“${name}”`

/**
 * The status line's three parts — the lead, the name (drawn strong), and a
 * tail — from what this session's layout **started from**. `null` is scratch,
 * or a source that has since been deleted: then the layout is simply the
 * session's own.
 */
export interface ProvenanceLine {
	lead: string
	name: string | null
	tail: string
}

export function provenanceLine(
	startedFrom: LayoutPreset | null
): ProvenanceLine {
	if (!startedFrom) return { lead: "Your own layout", name: null, tail: "" }
	const name = quoted(startedFrom.name)
	if (startedFrom.isGenreDefault)
		return { lead: "Started from the ", name: "genre default layout", tail: "" }
	if (startedFrom.origin === "core")
		return { lead: "Started from ", name, tail: ` (from ${CORE_NAME})` }
	if (startedFrom.origin === "plugin")
		return { lead: "Started from ", name, tail: ` (from ${pluginNameOf(startedFrom)})` }
	if (startedFrom.mine)
		return { lead: "Started from your layout ", name, tail: "" }
	return {
		lead: "Started from ",
		name,
		tail: ` (shared by ${startedFrom.authorName ?? "someone else"})`
	}
}

export function provenanceText(startedFrom: LayoutPreset | null): string {
	const l = provenanceLine(startedFrom)
	return `${l.lead}${l.name ?? ""}${l.tail}`
}

/** Who changes a layout: its plugin, core, you, or the person who shared it. */
function ownerOf(p: LayoutPreset): string {
	if (p.origin === "plugin") return pluginNameOf(p)
	if (p.origin === "core") return CORE_NAME
	if (p.mine) return "You"
	return p.authorName ?? "Its author"
}

/**
 * The **Updated** sentence: the source this session copied has changed since
 * the copy. Nothing moves until the person starts again from it (NOMENCLATURE
 * §9, decision 7).
 */
export function updatedSentence(source: LayoutPreset): string {
	const who = ownerOf(source)
	const what = source.isGenreDefault ? "the genre default layout" : quoted(source.name)
	const verb = who === "You" ? "have updated" : "has updated"
	return `${who} ${verb} ${what} since this session copied it.`
}

/** A verb that replaces this session's layout, and what it copies in. */
export type CopyAsk =
	/** Reset to genre default layout; `preset` null when the genre ships none. */
	| { kind: "reset"; preset: LayoutPreset | null }
	/** Start again from what the layout started from. */
	| { kind: "again"; preset: LayoutPreset }
	/** A card. */
	| { kind: "card"; preset: LayoutPreset }
	| { kind: "scratch" }

/** The preset a confirmed ask copies; `null` is Start from scratch. */
export function copyTarget(ask: CopyAsk): number | null {
	return ask.kind === "scratch" ? null : (ask.preset?.id ?? null)
}

/**
 * What the Updated offer asks for: the source copied in again — **Reset to
 * genre default layout** when that is the source, else **Start again from**.
 */
export function reCopyAsk(source: LayoutPreset): CopyAsk {
	return source.isGenreDefault
		? { kind: "reset", preset: source }
		: { kind: "again", preset: source }
}

/** The button that makes that ask. */
export function reCopyLabel(source: LayoutPreset): string {
	return source.isGenreDefault
		? "Reset to genre default layout"
		: `Start again from ${quoted(source.name)}`
}

/** One confirmation, as the dialog draws it. */
export interface LayoutConfirm {
	title: string
	/** Paragraphs, in order. */
	lines: string[]
	confirmLabel: string
	/**
	 * `danger` only takes away — a delete, or Start from scratch clearing
	 * every widget's settings and style: the confirm is drawn in error
	 * (STYLE-GUIDE §2). A copy brings a layout back: the primary.
	 */
	tone: "primary" | "danger"
	/** Still finding out what it touches: the confirm waits. */
	pending?: boolean
	/**
	 * A second way out, drawn between Cancel and the confirm: the verb the
	 * question recommends instead (Save changes to over an Updated layout
	 * offers **Start again from "X"**).
	 */
	alternative?: string
}

/**
 * Owner LB, said as built: only what the layout carries replaces yours. A
 * saved layout records a widget's settings or style only where they differ
 * from its defaults, so "the widgets it places" would promise more than a
 * copy does.
 */
const COPY_KEEPS =
	"Where it brings its own settings or style for a widget, those replace yours. Everything else you've set is kept."
/** Owner LC: scratch is the minimal setup AT ITS DEFAULTS. */
const SCRATCH_RESETS = "Every widget's settings and style go back to their defaults."
/** Every copy: it is saved at once, so the editor's Cancel is no way back. */
const NO_WAY_BACK =
	"The editor's Cancel won't bring the current layout back. To keep it, save it as a new layout first."

function scratchBody(mainWidget: string): string {
	return `${mainWidget} and this genre's panels, where they go by default.`
}

/**
 * What a copy's confirmation says. `mainWidget` names what scratch keeps in
 * the middle: the conversation, or the genre's own main widget where it
 * withholds the conversation (Battleship's board).
 */
export function copyConfirm(
	ask: CopyAsk,
	mainWidget = "Messages"
): LayoutConfirm {
	const main = `the ${mainWidget} widget`
	if (ask.kind === "scratch" || (ask.kind === "reset" && !ask.preset)) {
		const reset = ask.kind === "reset"
		return {
			title: reset ? "Reset to the genre default layout?" : "Start from scratch?",
			lines: [
				reset
					? `This genre has no default layout of its own, so this starts from scratch: ${scratchBody(main)}`
					: `This replaces this session's layout with the least it needs: ${scratchBody(main)}`,
				SCRATCH_RESETS,
				NO_WAY_BACK
			],
			confirmLabel: reset ? "Reset layout" : "Start from scratch",
			tone: "danger"
		}
	}
	const p = ask.preset!
	const what = p.isGenreDefault ? "the genre default layout" : quoted(p.name)
	if (ask.kind === "card")
		return {
			title: `Start from ${what}?`,
			lines: [
				`This replaces this session's layout with a copy of ${what}.`,
				COPY_KEEPS,
				NO_WAY_BACK
			],
			confirmLabel: "Use this layout",
			tone: "primary"
		}
	return {
		title:
			ask.kind === "reset"
				? "Reset to the genre default layout?"
				: `Start again from ${what}?`,
		lines: [
			`This replaces this session's layout with a fresh copy of ${what}.`,
			COPY_KEEPS,
			NO_WAY_BACK
		],
		confirmLabel: ask.kind === "reset" ? "Reset layout" : "Start again",
		tone: "primary"
	}
}

/**
 * What deleting a layout touches, as the page hands it down: the counts, or
 * `unknown` when the ask failed (the page has already said why).
 */
export interface LayoutPresetUsage {
	id: number
	sessions: number
	newSessionLayoutUsers: number
	/** The ask failed: the counts are not known (and read as nothing). */
	unknown?: boolean
}

/**
 * What deleting one of your layouts says. No session's layout changes (each
 * holds its own copy); a person using it for new sessions gets the genre
 * default layout instead, which is worth knowing BEFORE — so while the usage
 * answer is in flight the confirm waits (`pending`), and an unknown count is
 * never drawn as zero. An ask that FAILED does not hold the delete: the
 * question says it could not check, and the delete may go ahead (it passes
 * the same gate on its own).
 */
export function deleteConfirm(
	preset: LayoutPreset,
	usage: Omit<LayoutPresetUsage, "id"> | null
): LayoutConfirm {
	const title = `Delete ${quoted(preset.name)}?`
	// An admin deleting someone else's shared layout: whose it is, first.
	const whose = preset.mine
		? []
		: [`It's ${authorOf(preset)} layout: deleting it takes it from ${authorName(preset)} too.`]
	if (!usage)
		return {
			title,
			lines: [...whose, "Checking where it is used…"],
			confirmLabel: "Delete layout",
			tone: "danger",
			pending: true
		}
	const lines = [...whose, "Sessions that started from it keep their layout."]
	if (usage.unknown) {
		lines.push(
			"Couldn't check whether anyone uses it for new sessions; anyone who does gets the genre default layout instead."
		)
		return { title, lines, confirmLabel: "Delete layout", tone: "danger", pending: false }
	}
	const n = usage.newSessionLayoutUsers
	if (n > 0)
		lines.push(
			`${n} ${n === 1 ? "person uses" : "people use"} it for new sessions; they'll get the genre default layout instead.`
		)
	return { title, lines, confirmLabel: "Delete layout", tone: "danger", pending: false }
}

/* ── the card menu (brief 6b) ─────────────────────────────────────────
 * Every card carries a `⋯` menu (STYLE-GUIDE §6.6, `RowMenu`): the person's
 * **new-session layout** for the genre, **Make a copy**, and on a layout
 * they manage — theirs, or for an admin someone else's SHARED one —
 * **Share with everyone on this server** / **Stop sharing**, **Rename** and
 * **Delete**. None of these replaces this session's layout, so none asks
 * but Delete. */

/** What one menu item does. */
export type CardMenuAction =
	/** _Use for new *Genre* sessions_ (`setNewSessionLayout`). */
	| "new-session"
	/** _Stop using for new sessions_ (`setNewSessionLayout`, `null`). */
	| "stop-new-session"
	/** _Make a copy_ (`clone`). */
	| "copy"
	/** _Share with everyone on this server_ (`share`, `shared`). */
	| "share"
	/** _Stop sharing_ (`share`, `private`). */
	| "unshare"
	| "rename"
	| "delete"

export interface CardMenuItem {
	action: CardMenuAction
	label: string
}

/** An item, or a rule between groups of items. */
export type CardMenuEntry = CardMenuItem | "separator"

/** What a card's menu depends on beyond the card. */
export interface CardMenuContext {
	/** The genre's name, for _Use for new *Genre* sessions_; null while it loads. */
	genreName: string | null
	/**
	 * A guest in THIS session: publishing a layout is not theirs, so no share
	 * control is drawn (the server refuses publishing anyway; a guest is a
	 * guest on a session, not an account — owner question open).
	 */
	isGuest: boolean
	/** An admin also manages someone else's SHARED layout (never a shipped one). */
	isAdmin: boolean
	/** What new sessions of this genre start from now (`newSessionLayoutOf`). */
	newSessionLayoutId: number | null
}

/**
 * May this person rename, share, re-capture or delete it? Theirs (`mine`),
 * or — for an admin — someone else's shared layout. Shipped rows never.
 */
export function canManageLayout(p: LayoutPreset, isAdmin: boolean): boolean {
	return p.mine || (isAdmin && p.origin === "user" && p.visibility === "shared")
}

/**
 * What new sessions of this genre start from: the person's **new-session
 * layout** when they chose one, else the **genre default layout**, else
 * nothing (scratch). The card that wears the star.
 */
export function newSessionLayoutOf(
	presets: readonly LayoutPreset[]
): LayoutPreset | null {
	return (
		presets.find((p) => p.isNewSessionLayout) ??
		presets.find((p) => p.isGenreDefault) ??
		null
	)
}

/** The menu item that makes a layout the new-session layout. */
export function newSessionUseLabel(genreName: string | null): string {
	return genreName
		? `Use for new ${genreName} sessions`
		: "Use for new sessions of this genre"
}

/** What the star on the new-session layout's card says. */
export function newSessionMark(genreName: string | null): string {
	return genreName
		? `New ${genreName} sessions start from this layout`
		: "New sessions of this genre start from this layout"
}

/** Who made a person's layout, for the words about it; plainer when the wire has no name. */
const authorName = (p: LayoutPreset): string => p.authorName ?? "its author"
/** …and as a possessive: _Ash's_. */
const authorOf = (p: LayoutPreset): string => `${authorName(p)}'s`

/**
 * What choosing a card for new sessions stores: its id, except for the
 * **genre default layout**, which is what no choice already means — so its
 * card CLEARS the choice (`null`). One stored way to say it, and no pin that
 * would stop following the genre if its default row were ever replaced (the
 * server answers a pin to it as a clear too).
 */
export function newSessionChoice(p: LayoutPreset): number | null {
	return p.isGenreDefault ? null : p.id
}

/**
 * The mark on a layout of yours that other people see: _Shared_, the same
 * word on both editors (the menu's _Share with everyone on this server_ says
 * with whom). Someone else's shared layout is marked _by *Author*_ instead;
 * a private one, nothing.
 */
export function sharedMark(p: LayoutPreset): string | null {
	return p.mine && p.visibility === "shared" ? "Shared" : null
}

/**
 * Does _Stop sharing_ ask first? Only on someone ELSE's layout — an admin
 * acting on a shared one. It becomes its author's private layout again, so it
 * drops out of the admin's list, and only its author can share it again:
 * nothing the admin can take back. Your own you can simply share again.
 */
export function unshareAsks(p: LayoutPreset): boolean {
	return !p.mine
}

/** The question before an admin stops sharing someone else's layout. */
export function unshareConfirm(p: LayoutPreset): LayoutConfirm {
	const author = authorName(p)
	return {
		title: `Stop sharing ${quoted(p.name)}?`,
		lines: [
			`It becomes ${authorOf(p)} private layout again: it leaves everyone else's layouts, yours included. Only ${author} can share it again.`,
			"Sessions that started from it keep their layout."
		],
		confirmLabel: "Stop sharing",
		// It only takes away (STYLE-GUIDE §6.6).
		tone: "danger"
	}
}

/**
 * A card's menu, in order: the new-session item (_Use for new *Genre*
 * sessions_ on any card that is not what new sessions start from already;
 * _Stop using for new sessions_ on the one chosen, unless it is the genre
 * default layout, which new sessions get either way), _Make a copy_, then
 * — on a layout this person manages — the share toggle (never for a guest
 * in this session), _Rename_, and _Delete_ last, set apart.
 */
export function cardMenu(p: LayoutPreset, ctx: CardMenuContext): CardMenuEntry[] {
	const out: CardMenuEntry[] = []
	if (p.isNewSessionLayout && !p.isGenreDefault)
		out.push({ action: "stop-new-session", label: "Stop using for new sessions" })
	else if (p.id !== ctx.newSessionLayoutId)
		out.push({ action: "new-session", label: newSessionUseLabel(ctx.genreName) })
	out.push({ action: "copy", label: "Make a copy" })
	if (!canManageLayout(p, ctx.isAdmin)) return out
	out.push("separator")
	if (!ctx.isGuest)
		out.push(
			p.visibility === "shared"
				? {
						action: "unshare",
						// An admin on someone else's: say whose (it asks, too).
						label: p.mine ? "Stop sharing" : `Stop sharing ${authorOf(p)} layout`
					}
				: { action: "share", label: "Share with everyone on this pub" }
		)
	out.push({ action: "rename", label: "Rename" }, "separator", {
		action: "delete",
		label: "Delete"
	})
	return out
}

/**
 * **Save changes to "*Name*"**: this session's layout written back into the
 * layout of yours it started from. Asked first, because other sessions that
 * started from it will read it as **Updated**. When THIS session reads it as
 * Updated, changes were saved into it since the copy (from another session):
 * saving here would replace them, so the question says so, is drawn in
 * error, and offers **Start again from "*Name*"** instead.
 */
export function saveChangesConfirm(p: LayoutPreset, updated: boolean): LayoutConfirm {
	const name = quoted(p.name)
	const title = `Save changes to ${name}?`
	if (!updated)
		return {
			title,
			lines: [
				`This saves this session's layout into ${name}, with the settings and styles you've changed on the widgets it shows.`,
				"Sessions that started from it keep their own layout. They'll show it as updated, to start again from if they want."
			],
			confirmLabel: "Save changes",
			tone: "primary"
		}
	return {
		title,
		lines: [
			updatedSentence(p),
			"Saving here replaces those changes with this session's layout.",
			`To keep them, start again from ${name} instead.`
		],
		confirmLabel: "Save over them",
		tone: "danger",
		alternative: "Start again instead"
	}
}
