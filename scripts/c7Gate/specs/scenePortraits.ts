/**
 * Scene Portraits (R21, R76, R77): faces beside the conversation.
 *
 * Records (Adventure's `source: scene`, bars on): the cast's characters in
 * seat order — Rook, then Wren; no persona (the setting is off) — each
 * drawn as its CURRENT sprite (Rook: the default set's `neutral`, from its
 * "casual" set) or, with no sprites, its face (Wren); a bar row under each
 * holding its own values; the sprite-set menu offered on Rook only (the one
 * member with more than one set).
 * Exhibits (P3c: what the snapshot never draws, judged like it): the sprite-set
 * menu open from the keyboard with the pointer on an item; the pill under
 * the pointer; the `pinned` source with Rook pinned left (the pin grid, its
 * clear button, the empty right side), then with the clear button under the
 * pointer; and with nothing pinned (the empty floor).
 * Flows: the sprite-set menu switches Rook to "armor" (drawn, pushed to a
 * second socket, kept over a reload) and back to the story's; and on the
 * `pinned` source, clearing the pinned left portrait clears the PAGE's pin
 * (its stored `sceneImages:<id>`), and stays cleared.
 */
import type { Page } from "playwright"
import { ask, booted, open, URL_BASE } from "../engine"
import { CAST, FIXTURE_WIDGET_SETTINGS, ROOK_VALUES, storeLayout, type AdventureFixture } from "./adventure"
import { pushArrives, reloadOn, until, type WidgetCtx, type WidgetSpec } from "./kit"

const pinKey = (f: AdventureFixture) => `sceneImages:${f.sessionId}`
const uuidOf = (src: string | null | undefined) => /\/media\/([0-9a-f-]{36})/i.exec(src ?? "")?.[1]?.toLowerCase() ?? null

type Face = { member: string | null; name: string; src: string | null; setButton: string | null; bars: string[] }
const facesOn = (page: Page, sel: string) =>
	page.evaluate((sel) => {
		const flat = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim()
		const part = (name: string) => `[data-widget-part~="scene-portraits.${name}"]`
		return [...document.querySelectorAll(`${sel} ${part("face")}`)].map((f) => ({
			member: f.getAttribute("data-scene-member"),
			name: flat(f.querySelector(part("face-name"))?.textContent),
			src: f.querySelector(`img${part("face-img")}`)?.getAttribute("src") ?? null,
			setButton: f.querySelector(`button${part("set")}`) ? flat(f.querySelector(`button${part("set")}`)?.textContent) : null,
			bars: [...f.querySelectorAll(part("bar"))].map((b) => b.getAttribute("aria-label") ?? "")
		}))
	}, sel) as Promise<Face[]>

/** Rook's face draws the sprite of `set`. */
const rookDraws = ({ sel, member, uuid }: { sel: string; member: string; uuid: string }) =>
	(document.querySelector(`${sel} [data-scene-member="${member}"] img`)?.getAttribute("src") ?? "").toLowerCase().includes(uuid)

async function pickSet(ctx: WidgetCtx, item: string) {
	await ctx.page.locator(ctx.sel).getByRole("button", { name: `Change ${CAST.rook.name}'s sprite set` }).click()
	const menu = ctx.page.getByRole("menu", { name: "Sprite set" })
	await menu.waitFor({ timeout: 8_000 })
	const offered = await menu.getByRole("menuitemradio").evaluateAll((els) =>
		els.map((e) => `${(e.textContent ?? "").trim()}${e.getAttribute("aria-checked") === "true" ? " (checked)" : ""}`)
	)
	await menu.getByRole("menuitemradio", { name: item, exact: true }).click()
	return offered
}

/** The `pinned` source, with Rook's face pinned left as the Scene images tab pins it (or nothing pinned). */
async function onPinned(ctx: WidgetCtx, pinRook: boolean) {
	const { f } = ctx
	await storeLayout(ctx.page, f.sessionId, { ...FIXTURE_WIDGET_SETTINGS, "scene-portraits": { source: "pinned", bars: true } })
	await ctx.page.evaluate(
		({ key, src }) => (src ? localStorage.setItem(key, JSON.stringify({ left: src, right: null })) : localStorage.removeItem(key)),
		{ key: pinKey(f), src: pinRook ? f.thumbs.get(f.cast.rook)! : null }
	)
	await reloadOn(ctx, scenePortraitsSpec)
}

/** The pointer parked in the page's corner, away from every control, so no exhibit inherits a hover. */
const pointerAway = (ctx: WidgetCtx) => ctx.page.mouse.move(0, 0)
/** Long enough for a hover's or a panel's transition to finish (the theme's is 150ms). */
const settle = (ctx: WidgetCtx) => ctx.page.waitForTimeout(700)
const setTrigger = (ctx: WidgetCtx) => ctx.page.locator(ctx.sel).getByRole("button", { name: `Change ${CAST.rook.name}'s sprite set` })

export const scenePortraitsSpec: WidgetSpec = {
	name: "scene-portraits",
	title: "Scene Portraits",
	root: '[data-state-widget="scene-portraits"]',
	drawn: async (ctx, page) => {
		await until(
			page,
			(sel) => {
				const root = document.querySelector(sel)
				const part = (name: string) => `[data-widget-part~="scene-portraits.${name}"]`
				return (
					!!root?.querySelector(`${part("face")} img, ${part("empty")}, ${part("pins")} img`) &&
					!!root.querySelector(`${part("bar")}, ${part("empty")}, ${part("pins")}`)
				)
			},
			ctx.sel,
			30_000,
			() => "Scene Portraits drew nothing"
		)
	},
	records: async (ctx) => {
		const wrong: string[] = []
		const { f } = ctx
		const faces = await facesOn(ctx.page, ctx.sel)
		const want = [`character:${f.cast.rook}`, `character:${f.cast.wren}`]
		if (JSON.stringify(faces.map((x) => x.member)) !== JSON.stringify(want))
			wrong.push(`the faces are ${faces.map((x) => x.member).join(", ") || "none"}; the scene's cast is ${want.join(", ")} (no persona: the setting is off)`)
		const rook = faces.find((x) => x.member === want[0])
		const wren = faces.find((x) => x.member === want[1])
		if (rook) {
			if (rook.name !== CAST.rook.name) wrong.push(`Rook's face is named ${JSON.stringify(rook.name)}`)
			if (uuidOf(rook.src) !== f.rookSprites.get("casual"))
				wrong.push(`Rook draws ${rook.src}, not the current sprite (its default set "casual"'s neutral, ${f.rookSprites.get("casual")})`)
			if (rook.setButton !== "Sprite set") wrong.push(`Rook's sprite-set button reads ${JSON.stringify(rook.setButton)}; with no pick it reads "Sprite set"`)
			if (!rook.bars.includes(`Health ${ROOK_VALUES.hp}/20`)) wrong.push(`Rook's bars read ${rook.bars.join(", ") || "nothing"}; the fixture set Health ${ROOK_VALUES.hp}/20`)
		}
		if (wren) {
			if (uuidOf(wren.src) !== f.faces.get(f.cast.wren)) wrong.push(`Wren draws ${wren.src}, not its face (it has no sprites)`)
			if (wren.setButton !== null) wrong.push("Wren offers a sprite-set menu with no sprite sets")
			if (!wren.bars.includes("Health 20/20")) wrong.push(`Wren's bars read ${wren.bars.join(", ") || "nothing"}`)
		}
		return wrong
	},
	exhibits: [
		{
			// Opened from the keyboard, so the item the panel focuses shows its
			// focus ring; the pointer rests on "armor", so that item shows its hover.
			name: "sprite-set menu",
			show: async (ctx) => {
				await pointerAway(ctx)
				await setTrigger(ctx).focus()
				await ctx.page.keyboard.press("Enter")
				const menu = ctx.page.getByRole("menu", { name: "Sprite set" })
				await menu.waitFor({ timeout: 8_000 })
				await settle(ctx)
				await menu.getByRole("menuitemradio", { name: "armor", exact: true }).hover()
				await settle(ctx)
			}
		},
		{
			name: "sprite-set pill hovered",
			show: async (ctx) => {
				await pointerAway(ctx)
				await setTrigger(ctx).hover()
				await settle(ctx)
			}
		},
		{
			name: "pinned",
			show: async (ctx) => {
				await onPinned(ctx, true)
				await pointerAway(ctx)
				await settle(ctx)
			}
		},
		{
			name: "pinned, clear hovered",
			show: async (ctx) => {
				await onPinned(ctx, true)
				await pointerAway(ctx)
				await ctx.page.locator(ctx.sel).getByRole("button", { name: "Clear left portrait" }).hover()
				await settle(ctx)
			}
		},
		{
			name: "pinned, nothing pinned",
			show: async (ctx) => {
				await onPinned(ctx, false)
				await pointerAway(ctx)
				await settle(ctx)
			}
		}
	],
	flows: [
		{
			name: "sprite set",
			run: async (ctx) => {
				const member = `character:${ctx.f.cast.rook}`
				const armor = ctx.f.rookSprites.get("armor")!
				const casual = ctx.f.rookSprites.get("casual")!
				const t0 = Date.now()
				const offered = await pickSet(ctx, "armor")
				await until(ctx.page, rookDraws, { sel: ctx.sel, member, uuid: armor }, 10_000, async () => `Rook still draws ${(await facesOn(ctx.page, ctx.sel))[0]?.src}`)
				await pushArrives(ctx, "sprite set", t0, rookDraws, { sel: ctx.sel, member, uuid: armor })
				const label = (await facesOn(ctx.page, ctx.sel))[0]?.setButton
				if (label !== "armor") throw new Error(`the button reads ${JSON.stringify(label)} with "armor" picked`)
				await reloadOn(ctx, scenePortraitsSpec)
				if (!(await ctx.page.evaluate(rookDraws, { sel: ctx.sel, member, uuid: armor }))) throw new Error("after a reload Rook no longer draws armor")
				await pickSet(ctx, "As the story has it")
				await until(ctx.page, rookDraws, { sel: ctx.sel, member, uuid: casual }, 10_000, () => "Rook did not go back to its default set")
				await until(ctx.second, rookDraws, { sel: ctx.sel, member, uuid: casual }, 10_000, () => "the second socket's copy did not go back to the default set")
				return `the menu offers ${offered.join(" | ")}; "armor" draws that set's sprite, reaches a second socket and survives a reload; "As the story has it" goes back`
			}
		},
		{
			name: "only where allowed",
			run: async (ctx) => {
				const faces = await facesOn(ctx.page, ctx.sel)
				const offering = faces.filter((x) => x.setButton !== null).map((x) => x.name)
				if (JSON.stringify(offering) !== JSON.stringify([CAST.rook.name])) throw new Error(`the sprite-set menu is offered on ${offering.join(", ") || "nobody"}`)
				return "the sprite-set menu is offered only on the member with sets to switch between (never on one with none, never on a persona)"
			}
		},
		{
			name: "clear a pinned portrait",
			run: async (ctx) => {
				const { f } = ctx
				// The pinned source, and Rook's face pinned left as the Scene images tab pins it.
				await storeLayout(ctx.page, f.sessionId, { ...FIXTURE_WIDGET_SETTINGS, "scene-portraits": { source: "pinned", bars: true } })
				await ctx.page.evaluate(({ key, src }) => localStorage.setItem(key, JSON.stringify({ left: src, right: null })), { key: pinKey(f), src: f.thumbs.get(f.cast.rook)! })
				await reloadOn(ctx, scenePortraitsSpec)
				const drawn = await ctx.page.evaluate((sel) => {
					const root = document.querySelector(sel)!
					return {
						img: root.querySelector("img")?.getAttribute("src") ?? null,
						bars: root.querySelector("[data-state-bars]")?.getAttribute("data-state-bars") ?? null,
						empty: (root.textContent ?? "").includes("Empty")
					}
				}, ctx.sel)
				if (uuidOf(drawn.img) !== f.faces.get(f.cast.rook)) throw new Error(`the pinned left side draws ${drawn.img}, not Rook's face`)
				if (drawn.bars !== "c7_gate_rook") throw new Error(`the pinned portrait's bars are ${drawn.bars ?? "none"}, not Rook's`)
				if (!drawn.empty) throw new Error("the unpinned right side does not say Empty")
				await ctx.page.locator(ctx.sel).getByRole("button", { name: "Clear left portrait" }).click()
				await until(
					ctx.page,
					(sel) => (document.querySelector(sel)?.textContent ?? "").includes("No scene portraits set."),
					ctx.sel,
					10_000,
					() => "the portrait did not clear"
				)
				const stored = await ctx.page.evaluate((key) => localStorage.getItem(key), pinKey(f))
				if (stored !== null) throw new Error(`the page kept its pin: ${pinKey(f)} holds ${stored}`)
				await reloadOn(ctx, scenePortraitsSpec)
				if (!((await ctx.page.evaluate((sel) => document.querySelector(sel)?.textContent ?? "", ctx.sel)) ?? "").includes("No scene portraits set."))
					throw new Error("after a reload the cleared portrait is back")
				return "a portrait pinned from Rook's face draws it with Rook's bars; clearing it clears the page's own pin, and it stays cleared over a reload"
			}
		}
	],
	reset: async (ctx) => {
		const { f } = ctx
		await open(ctx.page, URL_BASE)
		await booted(ctx.page)
		await ctx.page.evaluate((key) => localStorage.removeItem(key), pinKey(f))
		await storeLayout(ctx.page, f.sessionId)
		await ask(ctx.page, "sessions:setSpriteSet", { sessionId: f.sessionId, characterId: f.cast.rook, set: null }, { where: { sessionId: f.sessionId }, refusable: true })
	}
}
