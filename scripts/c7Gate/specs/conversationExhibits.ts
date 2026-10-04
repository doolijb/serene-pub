/**
 * The conversation's exhibits (DESIGN-default-widget-stylesheet P3f): the
 * states of the compose block the pack snapshot never draws — the selection
 * bar with each of its buttons under the pointer and reached from the
 * keyboard, the bar with nothing selected (a disabled button takes no
 * pointer, so it has no hovered state to show), who is due next with a head (a
 * character, and the narrator), the read-only banner, and the bar and the
 * nudge at a tablet and a phone width; and the composer (P3g): a line typed,
 * each footer control and the Actions toggle hovered and keyboard-focused, the
 * preview, the More panel and a pane in the field's place, the actions row, its
 * overflow menu and the action legend, the `/` palette, two personas and the
 * persona menu, a reply in flight (Stop), a guest's Join, a line's editor
 * (MessageComposer), all at a tablet's and a phone's width, and the minimal and
 * writer skins; and the message (P3h): a line under the pointer and the
 * keyboard (its quick actions, its ⋮ trigger, its name), the ⋮ menu
 * open, swipes, a failed reply with Retry, the thinking and sections
 * disclosures (from fields and from typed parts), a block tree, the state
 * ledger and its proposals with the Review panel, scenes and history entries,
 * a hidden line, a line's selection controls, the widget's settings (newest
 * first, avatars off, timestamps off, the composer on top, the log hidden), an
 * empty session, a line at a phone's width, the line's own Stop while a reply
 * is in flight, and a line's editor's Cancel and Save. Each pack reads every
 * one, judged and recorded like its snapshot (`exhibits` in
 * `pack-<pack>.json`).
 *
 * Every selector is a role or an accessible name, never the markup's own
 * vocabulary, so one exhibit reads the same state before and after the markup
 * moves (the point of recording them first).
 *
 * The fixture is a one-character Chat whose turn order is empty (the snapshot
 * draws the nudge's "Pick" line), and nothing a socket accepts gives it a head
 * with someone else to choose, the narrator at the head, a `list` nudge or a
 * mode that is not installed. So those states hand the page's own listeners a
 * doctored answer — `sessions:turnOrder`, `sessions:get`,
 * `sessions:panelLayout:get`, and for the message's states no socket makes
 * outside a run (swipes, an error, disclosures, parts and blocks, a hidden
 * line, the ledger, scenes) `sessions:get`, `state:ledger`, `state:proposals`,
 * `scenes:list` and `scenes:scenedMessageIds` — built from the server's own: the widget, its
 * host and the stylesheet are the real ones; only the answer is written here.
 * Nothing in these exhibits writes but the draft a typed line leaves (the host
 * keeps it), which the next group empties, and the actions marked seen once
 * met (`meetTheActions`); each group opens the page afresh, so no doctored
 * answer outlives its group.
 */
import type { Locator, Page } from "playwright"
import { SESSION, ask, open, ready, type View } from "../engine"

/** One exhibit group's page: the copy, the conversation's selector. */
export type ExhibitCtx = { page: Page; v: View; sel: string }
export type ExhibitState = { name: string; show: (ctx: ExhibitCtx) => Promise<void> }
/**
 * States that share one page: the group opens it afresh (at `viewport`, if
 * given), runs `setup`, then reads each state in turn. A state leaves the page
 * as the next one expects it.
 */
export type ExhibitGroup = {
	name: string
	viewport?: { width: number; height: number }
	setup?: (ctx: ExhibitCtx) => Promise<void>
	states: ExhibitState[]
}
/** The gate's own viewport (`gatePage`), put back after a group that changed it. */
export const GATE_VIEWPORT = { width: 1440, height: 1000 }
const TABLET = { width: 820, height: 1000 }
const PHONE = { width: 390, height: 844 }

/* ── moving the pointer and the keyboard ─────────────────────────────── */

const conv = (ctx: ExhibitCtx) => ctx.page.locator(ctx.sel)
/** Transitions and the remote's round trip run out. */
const settle = (ctx: ExhibitCtx) => ctx.page.waitForTimeout(700)
/** The pointer let go and parked in the page's corner. */
async function pointerAway(ctx: ExhibitCtx) {
	await ctx.page.mouse.up()
	await ctx.page.mouse.move(0, 0)
}
/** The one control in the conversation with this role and name (refused if there are none or several). */
async function only(ctx: ExhibitCtx, name: string) {
	const found = conv(ctx).getByRole("button", { name, exact: true })
	await found.first().waitFor({ timeout: 10_000 })
	const n = await found.count()
	if (n !== 1) throw new Error(`${n} buttons in the conversation are named "${name}"`)
	return found
}
async function hover(ctx: ExhibitCtx, target: Locator) {
	await pointerAway(ctx)
	await target.hover()
	await settle(ctx)
}
/** Reached from the keyboard, so `:focus-visible` holds: focus it, step off with Shift+Tab and back with Tab. */
async function keyboardTo(ctx: ExhibitCtx, target: Locator) {
	await pointerAway(ctx)
	await target.focus()
	await ctx.page.keyboard.press("Shift+Tab")
	await ctx.page.keyboard.press("Tab")
	const on = await target.evaluate((el) => el === document.activeElement && el.matches(":focus-visible"))
	if (!on) throw new Error(`Tab did not come back to ${await target.getAttribute("title") ?? "the control"} with :focus-visible`)
	await settle(ctx)
}
/**
 * The log stood at its newest end. A state that grows a row (disclosures
 * unfolded, an edited line's field taking more text) leaves the log wherever
 * its own "held while the reader scrolled away" rule put it, which differs run
 * to run; such a state ends here instead.
 */
async function toNewest(ctx: ExhibitCtx) {
	await ctx.page.locator(ctx.sel).evaluate((root) => {
		const region = root.querySelector('[data-widget-part~="messages.log-scroll"] .sp-scroll-region')
		if (region) region.scrollTop = region.scrollHeight
	})
	await settle(ctx)
}
/** Nothing hovered, nothing focused. */
async function rest(ctx: ExhibitCtx) {
	await pointerAway(ctx)
	await ctx.page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.())
	await settle(ctx)
}

/* ── the selection bar ───────────────────────────────────────────────── */

/** From the newest line's menu: "Select this message for summarization" opens the bar with that line selected. */
async function startSelection(ctx: ExhibitCtx) {
	const { page } = ctx
	await conv(ctx).getByRole("button", { name: "Message options" }).last().click()
	// Attached, not "visible": until P3h, Cameo's `:root > *` inline-size
	// container reached the portalled panel and gave it a 0px box, which
	// Playwright never calls visible; kept so the wait reads any panel.
	const menu = page.getByRole("dialog", { name: "Message options" })
	await menu.waitFor({ state: "attached", timeout: 8_000 })
	await menu.getByRole("button", { name: /Select this message for summarization/ }).click()
	await only(ctx, "Select all")
	await rest(ctx)
}

/** Each of the bar's buttons, by the name it is read by (its title where the label is hidden). */
const BAR_BUTTONS = ["Select all", "Select none", "Cancel", "Scene", "World lore", "Character lore"] as const

const selectionGroup: ExhibitGroup = {
	name: "selection",
	setup: startSelection,
	states: [
		{ name: "the selection bar, one line selected", show: rest },
		...BAR_BUTTONS.flatMap((b): ExhibitState[] => [
			{ name: `the selection bar, ${b} hovered`, show: async (ctx) => hover(ctx, await only(ctx, b)) },
			{ name: `the selection bar, ${b} focused`, show: async (ctx) => keyboardTo(ctx, await only(ctx, b)) }
		]),
		{
			name: "the selection bar, nothing selected",
			show: async (ctx) => {
				await (await only(ctx, "Select none")).click()
				await rest(ctx)
			}
		}
	]
}

const selectionAt = (label: string, viewport: { width: number; height: number }): ExhibitGroup => ({
	name: `selection at ${label}`,
	viewport,
	setup: startSelection,
	states: [{ name: `the selection bar at ${label}`, show: rest }]
})

/* ── who is due next ─────────────────────────────────────────────────── */

/** Hand the page's listeners an answer as if the server had sent it. */
async function hand(page: Page, event: string, payload: unknown) {
	await page.evaluate(
		async ({ event, payload }) => {
			const live = (globalThis as unknown as { __gateImport: (path: string) => Promise<any> }).__gateImport
			const socket = (await live("/src/lib/client/sockets/socketInstance.ts")).getSocket()
			if (!socket) throw new Error("the app's socket is not there")
			for (const listener of socket.listeners(event)) listener(payload)
		},
		{ event, payload }
	)
}

type Cast = {
	character: { id: number; name: string }
	persona: { id: number; name: string; userId: number | null }
	answer: any
}
/** The session as the server answers the page (`sessions:get`, the page's own page size). */
async function castOf(page: Page): Promise<Cast> {
	const answer = await ask(page, "sessions:get", { id: SESSION, limit: 25 }, { where: { "session.id": SESSION } })
	const cc = answer?.session?.sessionCharacters?.[0]
	const cp = answer?.session?.sessionPersonas?.[0]
	if (!cc?.character || !cp?.persona) throw new Error("the fixture's session answered without its character and persona")
	return {
		character: { id: cc.characterId, name: cc.character.name },
		persona: { id: cp.personaId, name: cp.persona.name, userId: cp.persona.userId ?? null },
		answer
	}
}

/**
 * The session with a second character in its cast, so someone else could take
 * the turn ("Someone else" is offered). The extra member is named nowhere in
 * the conversation and has no face.
 */
async function withSecondCharacter(page: Page, cast: Cast) {
	const answer = structuredClone(cast.answer)
	const first = answer.session.sessionCharacters[0]
	const id = cast.character.id + 100_000
	answer.session.sessionCharacters.push({
		...first,
		id: (first.id ?? 0) + 100_000,
		characterId: id,
		character: { ...first.character, id, name: "C7 gate Extra", nickname: null, avatarMediaId: null, avatarMedia: null }
	})
	await hand(page, "sessions:get", answer)
}

/** A turn order with `order` at its head and the fixture's two as its candidates. */
async function turnOrder(page: Page, cast: Cast, order: Array<{ ref: string | null }>) {
	const candidates = [
		{ ref: `character:${cast.character.id}`, kind: "character", name: cast.character.name },
		{
			ref: `character:${cast.persona.id}`,
			kind: "persona",
			name: cast.persona.name,
			...(cast.persona.userId != null ? { ownerUserId: cast.persona.userId } : {})
		}
	]
	await hand(page, "sessions:turnOrder", { sessionId: SESSION, turnOrder: { order, candidates } })
}

/** The widget's own settings with `nextUp: "list"`: who follows the head is shown too. */
async function nudgeAsList(page: Page) {
	const got = await ask(page, "sessions:panelLayout:get", { sessionId: SESSION }, { where: { sessionId: SESSION } })
	const answer = structuredClone(got)
	answer.widgetSettings = { ...(answer.widgetSettings ?? {}), messages: { ...(answer.widgetSettings?.messages ?? {}), nextUp: "list" } }
	await hand(page, "sessions:panelLayout:get", answer)
}

/** The character at the head, the persona after it, someone else to choose, and the nudge as a list. */
async function characterDue(ctx: ExhibitCtx) {
	const cast = await castOf(ctx.page)
	await nudgeAsList(ctx.page)
	await ctx.page.waitForTimeout(500)
	await withSecondCharacter(ctx.page, cast)
	await ctx.page.waitForTimeout(500)
	await turnOrder(ctx.page, cast, [{ ref: `character:${cast.character.id}` }, { ref: `character:${cast.persona.id}` }])
	await only(ctx, `Continue with ${cast.character.name}`)
	await only(ctx, "Pick someone else to continue")
	await rest(ctx)
}

const dueGroup: ExhibitGroup = {
	name: "a character is due",
	setup: characterDue,
	states: [
		{ name: "who is due next: a character, then the persona", show: rest },
		{ name: "who is due next, Someone else hovered", show: async (ctx) => hover(ctx, await only(ctx, "Pick someone else to continue")) },
		{ name: "who is due next, Someone else focused", show: async (ctx) => keyboardTo(ctx, await only(ctx, "Pick someone else to continue")) },
		{ name: "who is due next, Continue hovered", show: async (ctx) => hover(ctx, ctx.page.locator(ctx.sel).getByRole("button", { name: /^Continue with / })) },
		{ name: "who is due next, Continue focused", show: async (ctx) => keyboardTo(ctx, ctx.page.locator(ctx.sel).getByRole("button", { name: /^Continue with / })) }
	]
}

const narratorGroup: ExhibitGroup = {
	name: "the narrator is due",
	setup: async (ctx) => {
		const cast = await castOf(ctx.page)
		await turnOrder(ctx.page, cast, [{ ref: null }])
		// The narrator is named by the session's own voice (`ownVoiceName`), so
		// any "Continue with …" will do.
		await conv(ctx).getByRole("button", { name: /^Continue with / }).first().waitFor({ timeout: 10_000 })
		await rest(ctx)
	},
	states: [{ name: "who is due next: the narrator", show: rest }]
}

const waitingGroup: ExhibitGroup = {
	name: "waiting",
	states: [
		{ name: "waiting for a message, Pick hovered", show: async (ctx) => hover(ctx, await only(ctx, "Pick")) },
		{ name: "waiting for a message, Pick focused", show: async (ctx) => keyboardTo(ctx, await only(ctx, "Pick")) }
	]
}

const nudgeAt = (label: string, viewport: { width: number; height: number }): ExhibitGroup => ({
	name: `who is due next at ${label}`,
	viewport,
	setup: async (ctx) => {
		await only(ctx, "Pick")
		await rest(ctx)
	},
	states: [
		{ name: `waiting for a message at ${label}`, show: rest },
		{ name: `who is due next at ${label}: a character, then the persona`, show: characterDue }
	]
})

/* ── read-only ───────────────────────────────────────────────────────── */

/**
 * The session's mode is not installed: the banner stands where the composer
 * was. A real `sessions:get` answer the page asked for earlier can land after
 * the doctored one and put the composer back, so the answer is handed again
 * until the banner has held for two seconds — and checked again before a read.
 */
async function readOnly(ctx: ExhibitCtx) {
	const banner = conv(ctx).getByRole("status").filter({ hasText: "This session is read-only." })
	for (let attempt = 1; ; attempt++) {
		if (!(await banner.count())) {
			const cast = await castOf(ctx.page)
			const answer = structuredClone(cast.answer)
			answer.session.genreId = "gate:genre/not-installed"
			await hand(ctx.page, "sessions:get", answer)
			await banner.waitFor({ timeout: 10_000 })
		}
		await ctx.page.waitForTimeout(2000)
		if (await banner.count()) break
		if (attempt >= 4) throw new Error("the read-only banner never held: the page kept reading the session back")
	}
	await rest(ctx)
}
const readOnlyGroup: ExhibitGroup = {
	name: "read-only",
	setup: readOnly,
	states: [{ name: "the read-only banner", show: readOnly }]
}

/* ── the composer (P3g) ──────────────────────────────────────────────── */

/** The composer's field: the textbox named "Write a message" (the edit composer's is another name). */
const field = (ctx: ExhibitCtx) => conv(ctx).getByRole("textbox", { name: "Write a message", exact: true })
/** A line in the field, the way a person types one; the pointer and focus then leave it. */
async function typed(ctx: ExhibitCtx, text = "A line for the gate to send.") {
	await field(ctx).fill(text)
	await rest(ctx)
}
/** The control in the conversation with this role and name — the last of several (a popover's trigger, an Edit per row). */
const lastNamed = (ctx: ExhibitCtx, role: "button" | "tab", name: string | RegExp) =>
	conv(ctx).getByRole(role, { name, exact: typeof name === "string" }).last()
/** Hover and keyboard focus, as a pair of states on one control. */
const pointedAndFocused = (label: string, target: (ctx: ExhibitCtx) => Promise<Locator> | Locator): ExhibitState[] => [
	{ name: `${label} hovered`, show: async (ctx) => hover(ctx, await target(ctx)) },
	{ name: `${label} focused`, show: async (ctx) => keyboardTo(ctx, await target(ctx)) }
]
/** The widget's own settings with the composer drawn in this skin (`composer`). */
async function composerSkin(page: Page, skin: "minimal" | "writer") {
	const got = await ask(page, "sessions:panelLayout:get", { sessionId: SESSION }, { where: { sessionId: SESSION } })
	const answer = structuredClone(got)
	answer.widgetSettings = { ...(answer.widgetSettings ?? {}), messages: { ...(answer.widgetSettings?.messages ?? {}), composer: skin } }
	await hand(page, "sessions:panelLayout:get", answer)
	await page.waitForTimeout(500)
}
/**
 * A second persona of this user's in the cast, so the persona chip is a switch
 * with a menu. A real `sessions:get` the page asked for earlier can land after
 * the doctored one and put the plain chip back, so the answer is handed again
 * until the switch has held for two seconds (as the read-only banner is).
 */
async function secondPersona(ctx: ExhibitCtx) {
	const cast = await castOf(ctx.page)
	const answer = structuredClone(cast.answer)
	const first = answer.session.sessionPersonas[0]
	const id = cast.persona.id + 100_000
	answer.session.sessionPersonas.push({
		...first,
		id: (first.id ?? 0) + 100_000,
		personaId: id,
		persona: { ...first.persona, id, name: "C7 gate Ash", nickname: null, avatarMediaId: null, avatarMedia: null }
	})
	const sw = conv(ctx).getByRole("button", { name: `Switch persona (currently ${cast.persona.name})`, exact: true })
	for (let attempt = 1; ; attempt++) {
		if (!(await sw.count())) {
			await hand(ctx.page, "sessions:get", answer)
			await sw.waitFor({ timeout: 10_000 })
		}
		await ctx.page.waitForTimeout(2000)
		if (await sw.count()) break
		if (attempt >= 4) throw new Error("the persona switch never held: the page kept reading the session back")
	}
	await rest(ctx)
}
/** A popover's or a menu's panel, open: attached, the wait that read Cameo's 0px panels before P3h. */
async function opened(ctx: ExhibitCtx, trigger: Locator, panel: Locator) {
	await pointerAway(ctx)
	await trigger.click()
	await panel.first().waitFor({ state: "attached", timeout: 8_000 })
	await pointerAway(ctx)
	await settle(ctx)
}
/** The More panel's row for the Pinned images pane, in its portalled panel. */
const paneOption = (ctx: ExhibitCtx) => ctx.page.getByRole("dialog").getByRole("button", { name: "Pinned images" })
/** The second persona's row in the persona menu's portalled panel. */
const personaOption = (ctx: ExhibitCtx) => ctx.page.getByRole("dialog").getByRole("button", { name: /C7 gate Ash/ })
/** Press Edit on the newest line: its editor (MessageComposer) opens in the row, the composer steps aside. */
async function editing(ctx: ExhibitCtx) {
	await lastNamed(ctx, "button", "Edit").click()
	await conv(ctx).getByRole("textbox", { name: "Type your message here" }).waitFor({ timeout: 8_000 })
	await rest(ctx)
}

/**
 * The session's actions met once, as a person meets them: on a fresh instance
 * each is *new* (a dot on More actions, a badge in the palette) until a list
 * that shows it has been opened, and opening one marks them seen — a write, so
 * every later group would otherwise see another state than the first. So the
 * first composer group opens both lists, then opens the page afresh.
 */
async function meetTheActions(ctx: ExhibitCtx) {
	await (await only(ctx, "Actions")).click()
	await actionsRow(ctx).waitFor({ timeout: 8_000 })
	const more = conv(ctx).getByRole("button", { name: /^More actions/ })
	if (await more.count()) {
		await more.click()
		await ctx.page.getByRole("menuitem").first().waitFor({ state: "attached", timeout: 8_000 })
		await ctx.page.waitForTimeout(800)
		await ctx.page.keyboard.press("Escape")
	}
	await field(ctx).fill("/")
	await conv(ctx).getByRole("listbox", { name: "Slash commands" }).waitFor({ timeout: 8_000 })
	await ctx.page.waitForTimeout(800)
	await field(ctx).fill("")
	await ctx.page.waitForTimeout(800)
	await open(ctx.page, ctx.v.url, ctx.v.remote)
	await ready(ctx.page, ctx.v, " textarea")
	await ctx.page.waitForTimeout(1500)
	await rest(ctx)
}

const composerGroup: ExhibitGroup = {
	name: "the composer",
	setup: meetTheActions,
	states: [
		{ name: "the composer, a line typed", show: (ctx) => typed(ctx) },
		...pointedAndFocused("the composer, Send", (ctx) => only(ctx, "Send message")),
		...pointedAndFocused("the composer, Preview", (ctx) => only(ctx, "Preview the formatted draft")),
		...pointedAndFocused("the composer, More", (ctx) => only(ctx, "More composer panels")),
		...pointedAndFocused("the composer, Actions", (ctx) => only(ctx, "Actions")),
		{
			name: "the composer, the draft previewed",
			show: async (ctx) => {
				await (await only(ctx, "Preview the formatted draft")).click()
				await conv(ctx).getByRole("region", { name: "Message preview" }).waitFor({ timeout: 8_000 })
				await rest(ctx)
			}
		},
		...pointedAndFocused("the composer, Preview pressed,", (ctx) => only(ctx, "Preview the formatted draft"))
	]
}

const panelsGroup: ExhibitGroup = {
	name: "the composer's panels",
	states: [
		{
			name: "the composer, the More panel open",
			show: (ctx) => opened(ctx, lastNamed(ctx, "button", "More composer panels"), paneOption(ctx))
		},
		{ name: "the composer, a More panel row hovered", show: (ctx) => hover(ctx, paneOption(ctx)) },
		{
			name: "the composer, a panel in the field's place",
			show: async (ctx) => {
				await paneOption(ctx).click()
				await only(ctx, "Back to compose")
				await rest(ctx)
			}
		},
		...pointedAndFocused("the composer, Back to compose", (ctx) => only(ctx, "Back to compose")),
		...pointedAndFocused("the composer, More with a panel open,", (ctx) => only(ctx, "More composer panels"))
	]
}

/** The actions row's own group, and a control in it by its place (the host views draw them). */
const actionsRow = (ctx: ExhibitCtx) => conv(ctx).getByRole("group", { name: "Session actions" })
const actionsGroup: ExhibitGroup = {
	name: "the composer's actions",
	setup: async (ctx) => {
		await (await only(ctx, "Actions")).click()
		await actionsRow(ctx).waitFor({ timeout: 8_000 })
		await rest(ctx)
	},
	states: [
		{ name: "the composer, the actions open", show: rest },
		{ name: "the composer, a session action hovered", show: (ctx) => hover(ctx, actionsRow(ctx).getByRole("button").first()) },
		{ name: "the composer, a turn control hovered", show: (ctx) => hover(ctx, actionsRow(ctx).getByRole("button").last()) },
		...pointedAndFocused("the composer, More actions", (ctx) => only(ctx, "More actions")),
		{
			name: "the composer, the More actions menu open",
			show: (ctx) => opened(ctx, conv(ctx).getByRole("button", { name: "More actions", exact: true }), ctx.page.getByRole("menuitem"))
		},
		{
			name: "the composer, the action legend open",
			show: async (ctx) => {
				await ctx.page.keyboard.press("Escape")
				await settle(ctx)
				await opened(ctx, conv(ctx).getByRole("button", { name: "What do these do?", exact: true }), ctx.page.getByText("What these do", { exact: true }))
			}
		}
	]
}

const paletteGroup: ExhibitGroup = {
	name: "the slash palette",
	states: [
		{
			name: "the slash palette open",
			show: async (ctx) => {
				await field(ctx).fill("/")
				await conv(ctx).getByRole("listbox", { name: "Slash commands" }).waitFor({ timeout: 8_000 })
				await pointerAway(ctx)
				await settle(ctx)
			}
		},
		{
			name: "the slash palette, a row chosen from the keyboard",
			show: async (ctx) => {
				await field(ctx).press("ArrowDown")
				await field(ctx).press("ArrowDown")
				await settle(ctx)
			}
		},
		{ name: "the slash palette, a row hovered", show: (ctx) => hover(ctx, conv(ctx).getByRole("option").nth(3)) },
		{
			name: "the slash palette, narrowed to one",
			show: async (ctx) => {
				await field(ctx).fill("/narrate-")
				await conv(ctx).getByRole("option").first().waitFor({ timeout: 8_000 })
				await pointerAway(ctx)
				await settle(ctx)
			}
		}
	]
}

const personaGroup: ExhibitGroup = {
	name: "two personas",
	setup: secondPersona,
	states: [
		{ name: "the composer, the persona a switch", show: rest },
		...pointedAndFocused("the composer, the persona switch", (ctx) => conv(ctx).getByRole("button", { name: /^Switch persona/ })),
		{
			name: "the composer, the persona menu open",
			show: (ctx) => opened(ctx, conv(ctx).getByRole("button", { name: /^Switch persona/ }), personaOption(ctx))
		},
		{ name: "the composer, another persona hovered", show: (ctx) => hover(ctx, personaOption(ctx)) }
	]
}

/**
 * A reply in flight: the newest line generating, so Send is Stop and the
 * palette's rows are refused. The line's own ember pulses forever, so the
 * group reads under reduced motion (it runs its course at once); the next
 * group's opening puts motion back.
 */
const generatingGroup: ExhibitGroup = {
	name: "a reply in flight",
	setup: async (ctx) => {
		await ctx.page.emulateMedia({ reducedMotion: "reduce" })
		const cast = await castOf(ctx.page)
		const answer = structuredClone(cast.answer)
		answer.messages[answer.messages.length - 1].isGenerating = true
		const rows = answer.session.sessionMessages
		if (rows?.length) rows[rows.length - 1].isGenerating = true
		await hand(ctx.page, "sessions:get", answer)
		await only(ctx, "Stop generating")
		await rest(ctx)
	},
	states: [
		{ name: "a reply in flight, Stop", show: rest },
		...pointedAndFocused("a reply in flight, Stop", (ctx) => only(ctx, "Stop generating")),
		{
			name: "a reply in flight, the slash palette refused",
			show: async (ctx) => {
				await field(ctx).fill("/")
				await conv(ctx).getByRole("listbox", { name: "Slash commands" }).waitFor({ timeout: 8_000 })
				await pointerAway(ctx)
				await settle(ctx)
			}
		}
,
		// The line's own Stop pill (P3h).
		...pointedAndFocused("a reply in flight, the line's Stop", (ctx) => lines(ctx).last().getByRole("button", { name: "Stop", exact: true }))
	]
}

/** A guest with no persona in the session: the composer offers to add one. */
const joinGroup: ExhibitGroup = {
	name: "a guest with no persona",
	setup: async (ctx) => {
		const cast = await castOf(ctx.page)
		const answer = structuredClone(cast.answer)
		answer.session.userId = (answer.session.userId ?? 0) + 100_000
		answer.session.sessionPersonas = []
		await hand(ctx.page, "sessions:get", answer)
		await only(ctx, "Add your persona")
		await rest(ctx)
	},
	states: [{ name: "the composer, join the conversation", show: rest }, ...pointedAndFocused("the composer, Add your persona", (ctx) => only(ctx, "Add your persona"))]
}

/**
 * Editing a line: MessageComposer's Compose and Preview tabs are a roving
 * tabindex, so only the chosen tab is reached from the keyboard.
 */
const editGroup: ExhibitGroup = {
	name: "editing a line",
	setup: editing,
	states: [
		{ name: "editing a line", show: rest },
		{ name: "editing a line, the Preview tab hovered", show: (ctx) => hover(ctx, lastNamed(ctx, "tab", "Preview")) },
		{ name: "editing a line, the Compose tab focused", show: (ctx) => keyboardTo(ctx, lastNamed(ctx, "tab", "Compose")) },
		{
			name: "editing a line, previewed",
			show: async (ctx) => {
				await lastNamed(ctx, "tab", "Preview").click()
				await conv(ctx).getByRole("region", { name: "Message preview" }).last().waitFor({ timeout: 8_000 })
				await rest(ctx)
			}
		},
		{ name: "editing a line, previewed, the Preview tab focused", show: (ctx) => keyboardTo(ctx, lastNamed(ctx, "tab", "Preview")) },
		{ name: "editing a line, previewed, the Compose tab hovered", show: (ctx) => hover(ctx, lastNamed(ctx, "tab", "Compose")) }
,
		// Its Cancel and Save, and a change typed: Save enabled, the unsaved note (P3h).
		...pointedAndFocused("editing a line, Cancel", (ctx) => conv(ctx).getByRole("button", { name: "Cancel", exact: true })),
		{
			name: "editing a line, a change typed",
			show: async (ctx) => {
				await lastNamed(ctx, "tab", "Compose").click()
				const box = conv(ctx).getByRole("textbox", { name: "Type your message here" })
				await box.fill(`${await box.inputValue()} Changed.`)
				await rest(ctx)
				await toNewest(ctx)
			}
		},
		...pointedAndFocused("editing a line, Save", (ctx) => conv(ctx).getByRole("button", { name: "Save", exact: true }))
	]
}

/** The composer in a narrower box: a tablet's and a phone's. */
const composerAt = (label: string, viewport: { width: number; height: number }): ExhibitGroup => ({
	name: `the composer at ${label}`,
	viewport,
	states: [
		{ name: `the composer at ${label}, a line typed`, show: (ctx) => typed(ctx) },
		{ name: `the composer at ${label}, Send focused`, show: async (ctx) => keyboardTo(ctx, await only(ctx, "Send message")) },
		{ name: `the composer at ${label}, More focused`, show: async (ctx) => keyboardTo(ctx, await only(ctx, "More composer panels")) },
		{
			name: `the composer at ${label}, the actions open`,
			show: async (ctx) => {
				await (await only(ctx, "Actions")).click()
				await actionsRow(ctx).waitFor({ timeout: 8_000 })
				await rest(ctx)
			}
		},
		{
			name: `the composer at ${label}, the More panel open`,
			show: (ctx) => opened(ctx, lastNamed(ctx, "button", "More composer panels"), paneOption(ctx))
		},
		{
			name: `the composer at ${label}, two personas`,
			show: async (ctx) => {
				await ctx.page.keyboard.press("Escape")
				await secondPersona(ctx)
			}
		},
		{ name: `editing a line at ${label}`, show: editing }
	]
})

/** The composer in another skin (the widget's `composer` setting), the states a skin redraws. */
const skinGroup = (skin: "minimal" | "writer", viewport?: { width: number; height: number }, label = ""): ExhibitGroup => ({
	name: `the ${skin} composer${label}`,
	viewport,
	setup: async (ctx) => {
		await composerSkin(ctx.page, skin)
		await rest(ctx)
	},
	states: [
		{ name: `the ${skin} composer${label}`, show: rest },
		{ name: `the ${skin} composer${label}, a line typed`, show: (ctx) => typed(ctx) },
		...(viewport
			? []
			: [
					...pointedAndFocused(`the ${skin} composer, Send`, (ctx) => only(ctx, "Send message")),
					{
						name: `the ${skin} composer, the draft previewed`,
						show: async (ctx: ExhibitCtx) => {
							await (await only(ctx, "Preview the formatted draft")).click()
							await conv(ctx).getByRole("region", { name: "Message preview" }).waitFor({ timeout: 8_000 })
							await rest(ctx)
							await (await only(ctx, "Preview the formatted draft")).click()
							await rest(ctx)
						}
					},
					{
						name: `the ${skin} composer, the slash palette open`,
						show: async (ctx: ExhibitCtx) => {
							await field(ctx).fill("/")
							await conv(ctx).getByRole("listbox", { name: "Slash commands" }).waitFor({ timeout: 8_000 })
							await pointerAway(ctx)
							await settle(ctx)
						}
					}
				]),
		{
			name: `the ${skin} composer${label}, two personas`,
			show: async (ctx) => {
				await field(ctx).fill("")
				await secondPersona(ctx)
			}
		}
	]
})

/* ── the message (P3h) ───────────────────────────────────────────────── */

/** Every line of the log (a message is an `article`), and the one drawn last. */
const lines = (ctx: ExhibitCtx) => conv(ctx).getByRole("article")
const newest = (ctx: ExhibitCtx) => lines(ctx).last()
/** The persona's newest line: the row that says who spoke (`data-msg-role`, the row's own state). */
const personaLine = (ctx: ExhibitCtx) => conv(ctx).locator('[role="article"][data-msg-role="user"]').last()
/** A line's ⋮ trigger, and its panel (portalled). */
const optionsOf = (line: Locator) => line.getByRole("button", { name: "Message options", exact: true })
const optionsPanel = (ctx: ExhibitCtx) => ctx.page.getByRole("dialog", { name: "Message options" })

/** The widget's own settings with these changed (`sessions:panelLayout:get`, doctored). */
async function widgetSettings(page: Page, patch: Record<string, unknown>) {
	const got = await ask(page, "sessions:panelLayout:get", { sessionId: SESSION }, { where: { sessionId: SESSION } })
	const answer = structuredClone(got)
	answer.widgetSettings = { ...(answer.widgetSettings ?? {}), messages: { ...(answer.widgetSettings?.messages ?? {}), ...patch } }
	await hand(page, "sessions:panelLayout:get", answer)
	await page.waitForTimeout(500)
}

/**
 * The session with its rows changed (`sessions:get`, doctored): `edit` gets
 * the rows oldest first (the page's own answer) and changes them in place.
 * A real answer the page asked for earlier can land after the doctored one,
 * so it is handed again until `held` has shown for two seconds.
 */
async function doctored(ctx: ExhibitCtx, edit: (rows: any[], cast: Cast) => void, held: (ctx: ExhibitCtx) => Locator) {
	const cast = await castOf(ctx.page)
	const answer = structuredClone(cast.answer)
	const rows = [...answer.messages].sort((a: any, b: any) => a.id - b.id)
	edit(rows, cast)
	// The session's own copy of the rows, where the page reads them too.
	const byId = new Map(rows.map((m: any) => [m.id, m]))
	if (Array.isArray(answer.session?.sessionMessages))
		answer.session.sessionMessages = answer.session.sessionMessages.map((m: any) => byId.get(m.id) ?? m)
	for (let attempt = 1; ; attempt++) {
		if (!(await held(ctx).count())) {
			await hand(ctx.page, "sessions:get", answer)
			await held(ctx).first().waitFor({ state: "attached", timeout: 10_000 })
		}
		await ctx.page.waitForTimeout(2000)
		if (await held(ctx).count()) break
		if (attempt >= 4) throw new Error("the doctored session never held: the page kept reading the session back")
	}
	await rest(ctx)
}
/** The newest reply among the rows (oldest first). */
const lastReply = (rows: any[]) => [...rows].reverse().find((m) => m.role !== "user" && !m.isNarratorResponse)
/** The reply before it. */
const replyBefore = (rows: any[]) => [...rows].reverse().filter((m) => m.role !== "user" && !m.isNarratorResponse)[1]

const pointerGroup: ExhibitGroup = {
	name: "a line under the pointer",
	states: [
		{ name: "a line, the newest hovered", show: (ctx) => hover(ctx, newest(ctx)) },
		{ name: "a line, the persona's hovered", show: (ctx) => hover(ctx, personaLine(ctx)) },
		...pointedAndFocused("a line, a quick action", (ctx) => newest(ctx).getByRole("group", { name: "Message actions" }).getByRole("button").first()),
		...pointedAndFocused("a line, the options button", (ctx) => optionsOf(newest(ctx))),
		{
			name: "a line, the name hovered",
			show: async (ctx) => hover(ctx, newest(ctx).getByRole("button", { name: (await castOf(ctx.page)).character.name, exact: true }))
		},
		// The name, not the avatar: Novel draws no avatar, so it takes no focus there.
		{
			name: "a line, the name focused",
			show: async (ctx) => keyboardTo(ctx, newest(ctx).getByRole("button", { name: (await castOf(ctx.page)).character.name, exact: true }))
		}
	]
}

const menuGroup: ExhibitGroup = {
	name: "the message menu",
	states: [
		{ name: "the message menu open", show: (ctx) => opened(ctx, optionsOf(newest(ctx)), optionsPanel(ctx)) },
		{ name: "the message menu, a row hovered", show: (ctx) => hover(ctx, optionsPanel(ctx).getByRole("button").first()) },
		{ name: "the message menu, a row focused", show: (ctx) => keyboardTo(ctx, optionsPanel(ctx).getByRole("button").nth(1)) },
		{
			name: "the persona's line menu open",
			show: async (ctx) => {
				await ctx.page.keyboard.press("Escape")
				await settle(ctx)
				await opened(ctx, optionsOf(personaLine(ctx)), optionsPanel(ctx))
			}
		}
	]
}

/** The newest reply with three alternatives, the second shown: the swipe pair and its count. */
const swipesGroup: ExhibitGroup = {
	name: "swipes",
	setup: (ctx) =>
		doctored(
			ctx,
			(rows) => {
				const r = lastReply(rows)
				r.metadata = { ...(r.metadata ?? {}), swipes: { currentIdx: 1, history: ["An earlier take.", r.content, "A later take."] } }
			},
			(ctx) => conv(ctx).getByRole("button", { name: "Previous swipe" })
		),
	states: [
		{ name: "swipes, the second of three", show: rest },
		...pointedAndFocused("swipes, Previous", (ctx) => conv(ctx).getByRole("button", { name: "Previous swipe" })),
		...pointedAndFocused("swipes, Next", (ctx) => newest(ctx).getByRole("button", { name: "Next swipe" }))
	]
}

/** The newest reply failed: its partial text, the error, what the service said (an admin's), and Retry. */
const errorGroup: ExhibitGroup = {
	name: "an error row",
	setup: (ctx) =>
		doctored(
			ctx,
			(rows) => {
				lastReply(rows).error = {
					message: "The model could not finish this reply.",
					code: "gate_error",
					connection: { name: "C7 gate stream", model: "gate-model", detail: "HTTP 500: the upstream said no" }
				}
			},
			(ctx) => conv(ctx).getByRole("button", { name: "Retry", exact: true })
		),
	states: [
		{ name: "an error row", show: rest },
		...pointedAndFocused("an error row, Retry", (ctx) => conv(ctx).getByRole("button", { name: "Retry", exact: true }))
	]
}

/**
 * The collapsibles a reply carries: on the newest, drawn from its fields (the
 * narrator's extra instructions, two folded sections, the model's thinking);
 * on the reply before it, drawn from its typed parts (thinking, a section with
 * items, a tool call and the markdown body). An image or a file is left out:
 * the receiver drops a `/session-assets/` image source or link (it allows the
 * app's media and a plugin's own files), and says so on the console.
 */
const disclosureGroup: ExhibitGroup = {
	name: "the thinking and sections disclosures",
	setup: (ctx) =>
		doctored(
			ctx,
			(rows) => {
				const r = lastReply(rows)
				const meta = { ...(r.metadata ?? {}) }
				delete meta.swipes
				r.parts = []
				r.metadata = {
					...meta,
					reasoning: "The gate thinks *before* it speaks.",
					narratorInstructions: "Focus on the weather turning.",
					sections: [
						{ kind: "plan", label: "Plan", items: ["Open the door", "Say hello"] },
						{ kind: "notes", label: "Notes", content: "A note with **weight**." }
					]
				}
				const p = replyBefore(rows)
				if (!p) throw new Error("the fixture has one reply: no second to draw its parts")
				const part = (id: number, ordinal: number, type: string, content: string | null, data: unknown = null) => ({
					id,
					messageId: p.id,
					step: 0,
					revision: 0,
					ordinal,
					type,
					content,
					data
				})
				p.activeRevisions = { "0": 0 }
				p.parts = [
					part(900001, 0, "core:reasoning", "Parts think too."),
					part(900002, 1, "core:section", null, { title: "Plan", kind: "plan", items: ["First", "Second"] }),
					part(900003, 2, "core:tool-call", "{\"q\": \"weather\"}", { tool: "lookup" }),
					part(900004, 3, "core:markdown", p.content)
				]
			},
			(ctx) => conv(ctx).getByRole("button", { name: "Extra instructions" })
		),
	states: [
		{ name: "disclosures, folded", show: rest },
		...pointedAndFocused("disclosures, Thinking", (ctx) => newest(ctx).getByRole("button", { name: "Thinking", exact: true })),
		...pointedAndFocused("disclosures, a part's Thinking", (ctx) => lines(ctx).nth(-3).getByRole("button", { name: "Thinking", exact: true })),
		{
			name: "disclosures, unfolded",
			show: async (ctx) => {
				for (const name of ["Extra instructions", "Plan", "Notes", "Thinking", "Tool: lookup"])
					for (const b of await conv(ctx).getByRole("button", { name, exact: true }).all()) await b.click()
				await rest(ctx)
				await toNewest(ctx)
			}
		}
	]
}

/**
 * A reply whose parts carry a block tree (20 §6): markdown, a key-value list,
 * a table, a stat with its meter, a choice to answer, one answered, one
 * superseded, one put to the character (whom the model portrays, so the
 * viewer awaits it), a form to fill (a switch, a choice, a number, a text),
 * one answered, and a group laid out in a row. No image (see the parts').
 */
const blocksGroup: ExhibitGroup = {
	name: "a block tree",
	setup: (ctx) =>
		doctored(
			ctx,
			(rows, cast) => {
				const r = lastReply(rows)
				const at = "2026-01-01T00:00:00.000Z"
				r.activeRevisions = { "0": 0 }
				r.parts = [
					{ id: 900101, messageId: r.id, step: 0, revision: 0, ordinal: 0, type: "core:markdown", content: r.content, data: null },
					{
						id: 900102,
						messageId: r.id,
						step: 0,
						revision: 0,
						ordinal: 1,
						type: "gate:blocks",
						content: null,
						data: {
							blocks: [
								{ kind: "md", text: "A block of *markdown*." },
								{ kind: "kv", rows: [{ label: "Place", value: "The gate" }, { label: "Weather", value: "Rain" }] },
								{ kind: "table", columns: ["Name", "Count"], rows: [["Keys", "2"], ["Coins", "12"]] },
								{ kind: "stat", label: "Health", value: 14, max: 20 },
								{ kind: "choices", id: "gate-open", question: "Which door?", actions: [{ fn: "pick", choice: "left", label: "Left" }, { fn: "pick", choice: "right", label: "Right" }] },
								{ kind: "choices", id: "gate-answered", question: "Answered?", answered: { by: "gate", at, choice: "yes" }, actions: [{ fn: "pick", choice: "yes", label: "Yes" }] },
								{ kind: "choices", id: "gate-stale", question: "Stale?", head: 1, actions: [{ fn: "pick", choice: "a", label: "A" }] },
								{ kind: "choices", id: "gate-other", question: "Someone else's?", addressee: `character:${cast.character.id}`, actions: [{ fn: "pick", choice: "a", label: "A" }] },
								{
									kind: "form",
									id: "gate-form",
									fn: "fill",
									question: "Fill this in",
									label: "Send it",
									fields: {
										ready: { type: "boolean", label: "Ready" },
										mood: { type: "enum", of: ["calm", "wary"], default: "calm" },
										count: { type: "integer", default: 2 },
										name: { type: "string", label: "Name" }
									}
								},
								{ kind: "form", id: "gate-form-answered", fn: "fill", question: "Filled", answered: { by: "gate", at }, fields: {} },
								{ kind: "group", layout: "row", blocks: [{ kind: "kv", rows: [{ label: "Left", value: "1" }] }, { kind: "kv", rows: [{ label: "Right", value: "2" }] }] }
							]
						}
					}
				]
			},
			(ctx) => conv(ctx).getByRole("button", { name: "Left", exact: true })
		),
	states: [
		{ name: "a block tree", show: rest },
		...pointedAndFocused("a block tree, a choice", (ctx) => conv(ctx).getByRole("button", { name: "Left", exact: true })),
		{ name: "a block tree, a form's text field focused", show: (ctx) => keyboardTo(ctx, conv(ctx).getByRole("textbox", { name: "Name", exact: true })) },
		...pointedAndFocused("a block tree, the form's submit", (ctx) => conv(ctx).getByRole("button", { name: "Send it", exact: true }))
	]
}

/**
 * What the newest reply changed (the state ledger) and what it asked for (a
 * pending proposal, and a superseded one), and the Review panel of everything
 * waiting. No socket makes a model's proposal outside a run, so the ledger's
 * and the proposals' answers are handed to the page's listeners (doctored),
 * again until the ledger has held.
 */
async function ledger(ctx: ExhibitCtx) {
	const cast = await castOf(ctx.page)
	const newestId = Math.max(...cast.answer.messages.map((m: any) => m.id))
	const owner = `character:${cast.character.id}`
	const rows = [
		{ id: 900201, kind: "value", messageId: newestId, ownerKey: owner, ownerLabel: cast.character.name, updatedBy: "narrator", slotId: "hp", slotLabel: "Health", value: 14 },
		{ id: 900202, kind: "value", messageId: newestId, ownerKey: owner, ownerLabel: cast.character.name, updatedBy: "narrator", slotId: "mood", slotLabel: "Mood", value: "wary" }
	]
	const proposals = [
		{ id: 900211, kind: "value", status: "pending", messageId: newestId, payload: { slotId: "gold", value: 12 }, proposedBy: "narrator" },
		{ id: 900212, kind: "value", status: "superseded", messageId: newestId, payload: { slotId: "hp", value: 3 }, proposedBy: "narrator" }
	]
	const held = conv(ctx).getByRole("button", { name: /^Review 1 change/ })
	for (let attempt = 1; ; attempt++) {
		if (!(await held.count())) {
			await hand(ctx.page, "state:ledger", { sessionId: SESSION, rows, baselines: [{ ownerKey: owner, slotId: "hp", value: 20 }] })
			await hand(ctx.page, "state:proposals", { sessionId: SESSION, proposals })
			await held.waitFor({ timeout: 10_000 })
		}
		await ctx.page.waitForTimeout(2000)
		if (await held.count()) break
		if (attempt >= 4) throw new Error("the ledger never held: the page kept reading the state back")
	}
	await rest(ctx)
}
const ledgerGroup: ExhibitGroup = {
	name: "the ledger and proposals",
	setup: ledger,
	states: [
		{ name: "the ledger", show: rest },
		...pointedAndFocused("the ledger, Review", (ctx) => conv(ctx).getByRole("button", { name: /^Review 1 change/ })),
		...pointedAndFocused("the ledger, Accept", (ctx) => conv(ctx).getByRole("button", { name: "Accept", exact: true }).first()),
		{ name: "the ledger, Reject hovered", show: (ctx) => hover(ctx, conv(ctx).getByRole("button", { name: "Reject", exact: true }).first()) },
		{
			name: "the ledger, the Review panel open",
			show: (ctx) => opened(ctx, conv(ctx).getByRole("button", { name: /^Review 1 change/ }), ctx.page.getByRole("dialog", { name: "Waiting for you" }))
		}
	]
}

/**
 * Scenes and history entries (doctored `scenes:list` and
 * `scenes:scenedMessageIds`): the first two lines a scene of a finished entry
 * with a next one, the next two a scene of a finished entry with none, the
 * last two a scene still open. Each scene's title, its edge and badge, the
 * entries' date markers, and a line a scene has taken (In Scene) while
 * selecting.
 */
async function scenes(ctx: ExhibitCtx) {
	const cast = await castOf(ctx.page)
	const ids = cast.answer.messages.map((m: any) => m.id).sort((a: number, b: number) => a - b)
	if (ids.length < 6) throw new Error(`the fixture has ${ids.length} lines; the scenes need six`)
	const lorebookId = cast.answer.session.lorebookId ?? 1
	const entry = (id: number, month: number | null, day: number | null, isCompleted: boolean, nextEntry: unknown = null) => ({
		id,
		year: 1024,
		month,
		day,
		isCompleted,
		nextEntry
	})
	const scene = (id: number, name: string | null, msgIds: number[], historyEntryId: number | null, historyEntry: unknown) => ({
		id,
		sessionId: SESSION,
		name,
		lorebookId,
		historyEntryId,
		selectedMessageIds: msgIds,
		historyEntry
	})
	const sceneList = [
		scene(900301, "The gate opens", ids.slice(0, 2), 900311, entry(900311, 3, 5, true, { id: 900312, year: 1024, month: 4, day: null })),
		scene(900302, null, ids.slice(2, 4), 900312, entry(900312, 4, null, true)),
		scene(900303, "Still going", ids.slice(-2), 900313, entry(900313, null, null, false))
	]
	const held = conv(ctx).getByRole("button", { name: /The gate opens/ })
	for (let attempt = 1; ; attempt++) {
		if (!(await held.count())) {
			// Both are scoped on the session (`interestKey`): the answer carries it.
			await hand(ctx.page, "scenes:list", { sessionId: SESSION, sceneList })
			await hand(ctx.page, "scenes:scenedMessageIds", { sessionId: SESSION, scenedMessageIds: ids.slice(0, 4) })
			await held.waitFor({ timeout: 10_000 })
		}
		await ctx.page.waitForTimeout(2000)
		if (await held.count()) break
		if (attempt >= 4) throw new Error("the scenes never held: the page kept reading them back")
	}
	await rest(ctx)
}
const scenesGroup: ExhibitGroup = {
	name: "scenes",
	setup: scenes,
	states: [
		{ name: "scenes and history entries", show: rest },
		...pointedAndFocused("scenes, a scene's title", (ctx) => conv(ctx).getByRole("button", { name: /The gate opens/ })),
		{ name: "scenes, a history marker hovered", show: (ctx) => hover(ctx, conv(ctx).getByRole("button", { name: /^Next: / })) },
		{ name: "scenes, Start a new entry focused", show: (ctx) => keyboardTo(ctx, conv(ctx).getByRole("button", { name: /Start a new entry/ })) },
		{ name: "scenes, selecting: lines a scene has taken", show: startSelection }
	]
}

/** A hidden line: out of what the model reads (its ghost badge, the dimmed row, Unhide pressed in its menu). */
const hiddenGroup: ExhibitGroup = {
	name: "a hidden line",
	setup: (ctx) =>
		doctored(
			ctx,
			(rows) => {
				rows[1].isHidden = true
				lastReply(rows).isHidden = true
			},
			(ctx) => conv(ctx).getByRole("img", { name: "Hidden from the model" })
		),
	states: [
		{ name: "a hidden line", show: rest },
		{ name: "a hidden line hovered", show: (ctx) => hover(ctx, newest(ctx)) },
		{ name: "a hidden line, its menu open", show: (ctx) => opened(ctx, optionsOf(newest(ctx)), optionsPanel(ctx)) }
	]
}

/** Selecting lines for a summary: a line's own choice and the two range selections, under the pointer and the keyboard. */
const selectingGroup: ExhibitGroup = {
	name: "selecting lines",
	setup: startSelection,
	states: [
		...pointedAndFocused("selecting, Select message", (ctx) => conv(ctx).getByRole("button", { name: "Select message", exact: true }).first()),
		...pointedAndFocused("selecting, Deselect message", (ctx) => conv(ctx).getByRole("button", { name: "Deselect message", exact: true })),
		{ name: "selecting, Select all above hovered", show: (ctx) => hover(ctx, conv(ctx).getByRole("button", { name: "Select all above up to nearest selected" }).first()) }
	]
}

/** The widget's own settings, one per group (doctored `sessions:panelLayout:get`). */
const settingGroup = (name: string, patch: Record<string, unknown>, more: ExhibitState[] = []): ExhibitGroup => ({
	name: `setting: ${name}`,
	setup: async (ctx) => {
		await widgetSettings(ctx.page, patch)
		await rest(ctx)
	},
	states: [{ name: `setting: ${name}`, show: rest }, ...more]
})

/** No line yet: the log's empty floor. */
const emptyGroup: ExhibitGroup = {
	name: "an empty session",
	setup: async (ctx) => {
		const cast = await castOf(ctx.page)
		const answer = structuredClone(cast.answer)
		answer.messages = []
		if (Array.isArray(answer.session?.sessionMessages)) answer.session.sessionMessages = []
		const held = conv(ctx).getByText("Send a message to start")
		for (let attempt = 1; ; attempt++) {
			if (!(await held.count())) {
				await hand(ctx.page, "sessions:get", answer)
				await held.waitFor({ timeout: 10_000 })
			}
			await ctx.page.waitForTimeout(2000)
			if (await held.count()) break
			if (attempt >= 4) throw new Error("the empty session never held")
		}
		await rest(ctx)
	},
	states: [{ name: "an empty session", show: rest }]
}

/** A line in a phone's box: hovered, and its menu. */
const lineAtPhone: ExhibitGroup = {
	name: "a line at 390px",
	viewport: PHONE,
	states: [
		{ name: "a line at 390px, hovered", show: (ctx) => hover(ctx, newest(ctx)) },
		{ name: "a line at 390px, the message menu open", show: (ctx) => opened(ctx, optionsOf(newest(ctx)), optionsPanel(ctx)) }
	]
}

/** The message's groups (P3h), read after the composer's. */
const MESSAGE_EXHIBITS: ExhibitGroup[] = [
	pointerGroup,
	menuGroup,
	swipesGroup,
	errorGroup,
	disclosureGroup,
	blocksGroup,
	ledgerGroup,
	scenesGroup,
	hiddenGroup,
	selectingGroup,
	settingGroup("newest first", { order: "newest-first" }, [{ name: "setting: newest first, the newest hovered", show: (ctx) => hover(ctx, newest(ctx)) }]),
	settingGroup("avatars off", { showAvatars: false }),
	settingGroup("timestamps off", { showTimestamps: false }),
	settingGroup("the composer on top", { composerPosition: "top" }),
	settingGroup("the log hidden", { showMessages: false }),
	emptyGroup,
	lineAtPhone
]

/** Every group, in the order a pack reads them. */
export const CONVERSATION_EXHIBITS: ExhibitGroup[] = [
	selectionGroup,
	selectionAt("820px", TABLET),
	selectionAt("390px", PHONE),
	waitingGroup,
	dueGroup,
	narratorGroup,
	nudgeAt("820px", TABLET),
	nudgeAt("390px", PHONE),
	readOnlyGroup,
	composerGroup,
	panelsGroup,
	actionsGroup,
	paletteGroup,
	personaGroup,
	generatingGroup,
	joinGroup,
	editGroup,
	composerAt("820px", TABLET),
	composerAt("390px", PHONE),
	skinGroup("minimal"),
	skinGroup("writer"),
	skinGroup("minimal", PHONE, " at 390px"),
	skinGroup("writer", PHONE, " at 390px"),
	...MESSAGE_EXHIBITS
]

/** Open the group's page afresh, at its width, and set it up. */
export async function openGroup(ctx: ExhibitCtx, group: ExhibitGroup) {
	await ctx.page.setViewportSize(group.viewport ?? GATE_VIEWPORT)
	// Motion as a person has it, whatever a group before this one asked for.
	await ctx.page.emulateMedia({ reducedMotion: null })
	await open(ctx.page, ctx.v.url, ctx.v.remote)
	await ready(ctx.page, ctx.v, " textarea")
	await ctx.page.waitForTimeout(1500)
	// The host keeps a draft across loads: one a group before this typed is
	// emptied, and the page opened again, so every group starts with an empty
	// field (and a `/` left there opens no palette).
	const draft = ctx.page.locator(ctx.sel).getByRole("textbox", { name: "Write a message", exact: true })
	if ((await draft.count()) && (await draft.inputValue())) {
		await draft.fill("")
		await ctx.page.waitForTimeout(800)
		await open(ctx.page, ctx.v.url, ctx.v.remote)
		await ready(ctx.page, ctx.v, " textarea")
		await ctx.page.waitForTimeout(1500)
	}
	if (group.setup) await group.setup(ctx)
}
