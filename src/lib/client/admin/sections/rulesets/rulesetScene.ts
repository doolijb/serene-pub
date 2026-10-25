/**
 * 🚧 **Playtest a scene** on the seven sections (PLAN-rulesets-functions D8,
 * lane A4, 2026-10-23): a party of one to four with values for the
 * ruleset's attributes and library rows held per entry type, the situation
 * in a sentence, what happens (a function used, an attribute changed, an
 * entry given or taken, or nothing), How strict and a seed — and how they go
 * to `rulesets:tryOut` (the party's values keyed by the slot each attribute
 * is filed under; the change as a proposed change, owner and target by
 * name, the shape the server has always read).
 *
 * A scene a person keeps is **saved as a test** in the draft (`playtests`):
 * the same shape a ruleset template's playtest has (`RulesetPlaytest`), with
 * its name, How strict and seed beside it.
 *
 * Pure.
 */
import { rulesetAttributeSlotId, rulesetEntryTypeId, type Rigour, type SlotValue } from "@serene-pub/sdk"
import { isObject, newRowUid, textOf, type Json } from "./rulesetFormParts"
import { splitWords, type AttributeRow, type SavedPlaytest, type SectionsForm } from "./rulesetSectionsForm"

export type TryOutParams = Sockets.Rulesets.TryOut.Params
export type TryOutResult = NonNullable<Sockets.Rulesets.TryOut.Response["result"]>
type Playtest = NonNullable<Sockets.Rulesets.DetailRow["playtest"]>

export interface SceneMember {
	uid: string
	name: string
	/** A typed value per attribute id; absent or "" is where the rules start it. */
	values: Record<string, string>
	/** Library rows held, per entry type id. */
	held: Record<string, string[]>
	/**
	 * 🚧 This member's side of each tie (T1, 2026-10-23): per tie entry type,
	 * per other member's name, that side's field values — carried as the
	 * playtest says them (no editor for them yet).
	 */
	ties?: Record<string, Record<string, Record<string, unknown>>>
}

/** What happens: a function used, an attribute changed, an entry given or taken, or nothing (a read). */
export type ChangeKind = "function" | "attribute" | "entry" | "none"

export interface SceneChange {
	kind: ChangeKind
	/** Who makes it: a member's name. */
	owner: string
	/** function: the reference's key. */
	key: string
	/** attribute: its id. */
	attribute: string
	/** attribute: `add` · `set`; entry: `add` · `remove`. */
	op: string
	/** attribute: the amount or the value; function: a spend or an amount. */
	value: string
	/** entry: the entry type and the library row. */
	entryType: string
	row: string
	/** Who it is aimed at, by name; "" for no one. */
	aimedAt: string
}

export interface PlaytestScene {
	party: SceneMember[]
	situation: string
	change: SceneChange
	rigour: Rigour
	seed: string
}

const NAMES = ["Wren", "Mara", "Dov", "Ada"]

export const blankChange = (): SceneChange => ({
	kind: "none",
	owner: "",
	key: "",
	attribute: "",
	op: "add",
	value: "",
	entryType: "",
	row: "",
	aimedAt: ""
})

const scalar = (v: unknown): string =>
	typeof v === "string" || typeof v === "number" || typeof v === "boolean" ? String(v) : Array.isArray(v) ? v.join(", ") : ""

/** The slot an attribute's value is filed under (the server's `attributeSlotOf`). */
export const slotOfAttribute = (rulesetId: string, a: Pick<AttributeRow, "id" | "slot">): string =>
	a.slot.trim() || rulesetAttributeSlotId(rulesetId, a.id.trim())

/** The attribute a stored key names: its id, its own slot or its derived slot. */
function attributeOfKey(rulesetId: string, form: SectionsForm, key: string): string | null {
	for (const a of form.attributes) if (a.id === key || a.slot === key || (a.id && slotOfAttribute(rulesetId, a) === key)) return a.id
	return null
}

/** The library rows an entry type offers, by id and name. */
export function libraryRows(form: SectionsForm, entryType: string): { id: string; name: string }[] {
	const list = form.library.lists.find((l) => l.repertoireId === entryType)
	return (list?.rows ?? []).map((r) => ({ id: r.id, name: (typeof r.piece.name === "string" && r.piece.name) || r.id }))
}

function changeOf(rulesetId: string, form: SectionsForm, c: Json | null | undefined): SceneChange {
	if (!c) return blankChange()
	const op = String(c.op ?? "")
	const base = { ...blankChange(), owner: String(c.owner ?? ""), aimedAt: String(c.aimedAt ?? ""), value: scalar(c.value) }
	if (typeof c.check === "string") return { ...base, kind: "function", key: c.check }
	if (typeof c.slot === "string") return { ...base, kind: "attribute", attribute: attributeOfKey(rulesetId, form, c.slot) ?? c.slot, op: op === "set" ? "set" : "add" }
	if (typeof c.repertoire === "string") {
		const type = String(c.repertoire)
		const id = form.entryTypes.find((e) => e.id === type || rulesetEntryTypeId(rulesetId, e.id) === type)?.id ?? type
		return { ...base, kind: "entry", entryType: id, row: String(c.piece ?? ""), op: op === "remove" ? "remove" : "add" }
	}
	return base
}

function memberOf(
	rulesetId: string,
	form: SectionsForm,
	m: { name: string; stats?: Record<string, unknown>; pieces?: Record<string, readonly string[]>; ties?: Record<string, Record<string, Record<string, unknown>>> }
): SceneMember {
	const values: Record<string, string> = {}
	for (const [k, v] of Object.entries(m.stats ?? {})) {
		const id = attributeOfKey(rulesetId, form, k)
		if (id) values[id] = scalar(v)
	}
	return {
		uid: newRowUid(),
		name: m.name,
		values,
		held: Object.fromEntries(Object.entries(m.pieces ?? {}).map(([k, v]) => [k, [...v]])),
		...(m.ties && Object.keys(m.ties).length ? { ties: JSON.parse(JSON.stringify(m.ties)) } : {})
	}
}

/**
 * The scene a page opens with: the first test saved in the draft, else the
 * template's (when the ruleset was made from one), else a party of two at
 * the attributes' starts, each holding a row of each entry type, and
 * nothing happening yet.
 */
export function sceneOf(rulesetId: string, form: SectionsForm, playtest: Playtest | null): PlaytestScene {
	const saved = form.playtests[0]?.value
	if (saved) return sceneFromSaved(rulesetId, form, saved)
	if (playtest)
		return {
			party: playtest.party.map((m) => memberOf(rulesetId, form, m as never)),
			situation: textOf(playtest.situation),
			change: changeOf(rulesetId, form, playtest.change as unknown as Json),
			rigour: "mechanics",
			seed: ""
		}
	const party: SceneMember[] = [0, 1].map((i) => ({
		uid: newRowUid(),
		name: NAMES[i]!,
		values: {},
		held: Object.fromEntries(form.entryTypes.map((e) => [e.id, libraryRows(form, e.id)[i] ? [libraryRows(form, e.id)[i]!.id] : []]))
	}))
	return { party, situation: "", change: { ...blankChange(), owner: party[0]!.name }, rigour: "mechanics", seed: "" }
}

export function sceneFromSaved(rulesetId: string, form: SectionsForm, saved: SavedPlaytest): PlaytestScene {
	return {
		party: (saved.party ?? []).map((m) => memberOf(rulesetId, form, m as never)),
		situation: saved.situation ?? "",
		change: changeOf(rulesetId, form, saved.change),
		rigour: (["prose", "mechanics", "scripts"].includes(String(saved.rigour)) ? saved.rigour : "mechanics") as Rigour,
		seed: saved.seed ?? ""
	}
}

export const newSceneMember = (scene: PlaytestScene): SceneMember => {
	const taken = new Set(scene.party.map((m) => m.name))
	const name = NAMES.find((n) => !taken.has(n)) ?? `Someone ${scene.party.length + 1}`
	return { uid: newRowUid(), name, values: {}, held: {} }
}

const NUMBER = /^\s*-?\d+(\.\d+)?\s*$/

/** A typed value as its attribute takes it: a number, a word, a list. */
export function attributeValue(a: AttributeRow, text: string): SlotValue | undefined {
	const t = text.trim()
	if (!t) return undefined
	if (a.kind === "list") return splitWords(t) as unknown as SlotValue
	if (a.kind === "label") return t
	return NUMBER.test(t) ? Number(t) : (t as SlotValue)
}

/** The party as `rulesets:tryOut` takes it: values by the slot each attribute is filed under, the rows held. */
export function partyParams(rulesetId: string, form: SectionsForm, party: readonly SceneMember[]): NonNullable<TryOutParams["party"]> {
	return party.map((m) => {
		const stats: Record<string, SlotValue> = {}
		for (const a of form.attributes) {
			if (!a.id.trim()) continue
			const v = attributeValue(a, m.values[a.id] ?? "")
			if (v !== undefined) stats[slotOfAttribute(rulesetId, a)] = v
		}
		return {
			name: m.name.trim() || undefined,
			stats,
			pieces: Object.fromEntries(Object.entries(m.held).filter(([, v]) => v.length)),
			...(m.ties && Object.keys(m.ties).length ? { ties: m.ties as NonNullable<NonNullable<TryOutParams["party"]>[number]["ties"]> } : {})
		}
	})
}

export type DeltaPlan = { ok: true; delta: Record<string, unknown> | null } | { ok: false; error: string }

/** What happens, as a proposed change (owner and aimedAt by name, as the server reads them); null when nothing does. */
export function changeDelta(rulesetId: string, form: SectionsForm, c: SceneChange): DeltaPlan {
	if (c.kind === "none") return { ok: true, delta: null }
	if (!c.owner.trim()) return { ok: false, error: "Say who does it." }
	const d: Record<string, unknown> = { owner: c.owner.trim() }
	if (c.aimedAt.trim()) d.aimedAt = c.aimedAt.trim()
	switch (c.kind) {
		case "function":
			if (!c.key) return { ok: false, error: "Pick the function." }
			d.op = "use"
			d.check = c.key
			if (c.value.trim()) d.value = NUMBER.test(c.value) ? Number(c.value) : c.value.trim()
			break
		case "attribute": {
			const a = form.attributes.find((x) => x.id === c.attribute)
			if (!a) return { ok: false, error: "Pick the attribute." }
			const t = c.value.trim()
			if (!t) return { ok: false, error: c.op === "set" ? "Say what to set it to." : "Say by how much." }
			if (c.op !== "set" && !NUMBER.test(t)) return { ok: false, error: `'${t}' is not an amount.` }
			d.op = c.op === "set" ? "set" : "add"
			d.slot = slotOfAttribute(rulesetId, a)
			d.value = c.op === "set" ? attributeValue(a, t) : Number(t)
			break
		}
		case "entry":
			if (!c.entryType || !c.row) return { ok: false, error: "Pick which one." }
			d.op = c.op === "remove" ? "remove" : "add"
			d.repertoire = c.entryType
			d.piece = c.row
			break
	}
	return { ok: true, delta: d }
}

/** The scene as a test the draft keeps (`playtests`). */
export function savedOf(rulesetId: string, form: SectionsForm, scene: PlaytestScene, name: string): SavedPlaytest {
	const plan = changeDelta(rulesetId, form, scene.change)
	return {
		name: name.trim() || "A scene",
		party: partyParams(rulesetId, form, scene.party).map((m, i) => ({
			name: m.name ?? scene.party[i]!.name,
			...(m.stats && Object.keys(m.stats).length ? { stats: m.stats as Record<string, unknown> } : {}),
			...(m.pieces && Object.keys(m.pieces).length ? { pieces: m.pieces } : {}),
			...(m.ties && Object.keys(m.ties).length ? { ties: m.ties as Record<string, Record<string, Record<string, never>>> } : {})
		})),
		situation: scene.situation.trim(),
		change: plan.ok && plan.delta ? plan.delta : null,
		rigour: scene.rigour,
		...(scene.seed.trim() ? { seed: scene.seed.trim() } : {})
	}
}

/** An outcome in the ruleset's words: a decided check's label, else its band, else what happened. */
export const outcomeWord = (o: TryOutResult["outcomes"][number]): string => o.check?.label || o.check?.band || o.text

/** The prompt's blocks in the order a prompt reads them: the voice, then the rules' own, then the sheets. */
const BLOCK_ORDER = ["voice", "sections", "gm", "sheet", "pieces", "ties", "custom", "outcomes"]
export function blocksInOrder(result: TryOutResult | null): TryOutResult["blocks"] {
	const rank = (k: string) => (BLOCK_ORDER.includes(k) ? BLOCK_ORDER.indexOf(k) : BLOCK_ORDER.length)
	return [...(result?.blocks ?? [])].sort((a, b) => rank(a.key) - rank(b.key))
}

/** Every block's words, as one text: what the model will read. */
export const promptText = (result: TryOutResult | null): string =>
	blocksInOrder(result)
		.map((b) => b.text.trim())
		.filter(Boolean)
		.join("\n\n")

export const promptTokens = (result: TryOutResult | null): number => (result?.blocks ?? []).reduce((n, b) => n + (b.tokens || 0), 0)

/** 🚧 What the prompt-cost meter is measured against: a guide, not a limit, until the context meter reads the pub's budget (Sprint B3). */
export const PROMPT_COST_GUIDE = 1500

export { isObject }
