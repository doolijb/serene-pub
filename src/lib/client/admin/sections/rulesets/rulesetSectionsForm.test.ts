/**
 * 🚧 The editor on the seven sections (lane A4, 2026-10-23): a draft is read
 * through its sections whichever shape it is written in, and every Save
 * writes the sections — from scratch stays `{ id, version, name }` (R9);
 * a row nobody touched writes what it was read from; the shapes before the
 * sections are left behind; the library rides through its adapter; the
 * handbook and saved tests are kept. Also the words (`rulesetWords.ts`) and
 * the scene (`rulesetScene.ts`).
 */
import { describe, expect, it } from "vitest"
import { PIECE_FIELDS, rulesetAttributeSlotId } from "@serene-pub/sdk"
import {
	documentToSave,
	formChangesDocument,
	formProblems,
	libraryView,
	newAttribute,
	newEntryField,
	newEntryType,
	newFunctionRow,
	newOutcome,
	newZoneType,
	sectionsDocument,
	sectionsFormOf,
	findingsByRow,
	idFromName,
	libraryRowsOf,
	removeAttribute,
	removeEntryType,
	removeFunction,
	removeZoneType,
	zonesHolding
} from "./rulesetSectionsForm"
import { mergeImported, newLibraryRow, parseImportedRows, pieceListOf } from "./rulesetLibraryForm"
import { handbookPages, kindWords, nextSteps, pickNote, playableNote, railCounts, readsAs, sentenceParts } from "./rulesetWords"
import { changeDelta, partyParams, savedOf, sceneOf } from "./rulesetScene"

const ID = "acme.lab:ruleset/sword-and-sail@1"
const SCRATCH = { id: "acme.lab:ruleset/hearts@1", version: "1.0.0", name: { en: "Hollow Hearts" } }

/** A draft in the shape before the sections: a stat, a check, a repertoire with rows, degrees, time. */
const legacy = () => ({
	id: ID,
	version: "1.0.0",
	name: { en: "Sword and Sail" },
	voice: { prose: "Words decide." },
	conventions: {
		methods: { die: { kind: "die-target", sides: 20 } },
		degrees: {
			bands: [
				{ id: "miss", label: { en: "Miss", fr: "Raté" }, five: "fail" },
				{ id: "hit", label: { en: "Hit" }, five: "success", from: 0 }
			]
		},
		time: { unit: "round", roundSeconds: 6 }
	},
	stats: [{ id: "core:slot/hp@1", borrowed: true }],
	selectors: { "attack.melee": { kind: "check", base: "hp" } },
	repertoires: [
		{
			id: "weapons",
			label: { en: "Weapons" },
			prose: "Weapons hurt.",
			piece: { type: "object", fields: { ...PIECE_FIELDS, weight: { type: "number", label: { en: "Weight" } } } },
			entryable: true
		}
	],
	compendium: {
		source: { document: "SRD 5.2.1", licence: "CC-BY-4.0" },
		rows: {
			weapons: [
				{ id: "club", version: "1.1.0", piece: { name: "Club", description: "Blunt.", weight: 2 } },
				{ id: "dagger", version: "1.1.0", source: { document: "Ours", licence: "CC0" }, piece: { name: "Dagger", description: "Short." } }
			]
		}
	}
})

describe("reading and writing the sections", () => {
	it("from scratch is a name and nothing else, and saving it untouched changes nothing (R9)", () => {
		const form = sectionsFormOf(SCRATCH, "Hollow Hearts")
		expect(form.attributes).toEqual([])
		expect(formChangesDocument(form, sectionsFormOf(SCRATCH, ""))).toBe(false)
		expect(sectionsDocument(SCRATCH, form)).toEqual(SCRATCH)
	})

	it("an attribute added with its sentence is the whole of a playable ruleset", () => {
		const form = sectionsFormOf(SCRATCH, "Hollow Hearts")
		const a = newAttribute(form, "Affection")
		Object.assign(a, { min: "0", max: "10", start: "5", prose: "How much someone likes you.", carriedBy: ["cast"], visibility: "holder", tags: "relationship, warmth", shownAs: "bar", changedBy: ["rules", "gm"] })
		form.attributes.push(a)
		const mood = newAttribute(form, "Mood")
		Object.assign(mood, { kind: "label", of: "shy, warm, guarded", prose: "The mood they are in." })
		form.attributes.push(mood)
		expect(formChangesDocument(form, sectionsFormOf(SCRATCH, ""))).toBe(true)
		const doc = sectionsDocument(SCRATCH, form)
		expect(doc.attributes).toEqual([
			{
				id: "affection",
				name: { en: "Affection" },
				kind: "number",
				bounds: { min: 0, max: 10 },
				start: 5,
				carriedBy: ["cast"],
				visibility: "holder",
				changedBy: ["rules", "gm"],
				tags: ["relationship", "warmth"],
				prose: "How much someone likes you.",
				shownAs: "bar"
			},
			{ id: "mood", name: { en: "Mood" }, kind: "label", of: ["shy", "warm", "guarded"], prose: "The mood they are in." }
		])
		expect(playableNote(form).tone).toBe("success")
		expect(kindWords(form.attributes[0]!)).toBe("A number, 0 to 10, starts at 5")
		expect(kindWords(form.attributes[1]!)).toBe("Words: shy · warm · guarded")
	})

	it("a draft in the shape before the sections reads through its aliases; untouched, it is not an edit", () => {
		const doc = legacy()
		const form = sectionsFormOf(doc, "x")
		expect(form.attributes.map((a) => [a.id, a.slot, a.borrowed])).toEqual([["hp", "core:slot/hp@1", true]])
		expect(form.functions.map((f) => [f.ref, f.key])).toEqual([
			["core:function/die-target@1", "die"],
			["core:function/check@1", "attack.melee"]
		])
		expect(form.entryTypes.map((e) => e.id)).toEqual(["weapons"])
		expect(form.outcomes.map((o) => [o.label, o.five])).toEqual([
			["Miss", "fail"],
			["Hit", "success"]
		])
		expect(form.time.unit).toBe("round")
		expect(formChangesDocument(form, sectionsFormOf(doc, "y"))).toBe(false)
		// Saved anyway (the forms changed elsewhere), it is written in the sections and nothing before them.
		form.description = "A sea story."
		const out = sectionsDocument(doc, form)
		for (const k of ["stats", "selectors", "repertoires", "conventions", "compendium"]) expect(out[k]).toBeUndefined()
		expect(out.description).toEqual({ en: "A sea story." })
		expect((out.outcomes as any[])[0].label).toEqual({ en: "Miss", fr: "Raté" })
		expect((out.library as any).rows.weapons).toEqual(doc.compendium.rows.weapons)
		expect((out.time as any).unit).toBe("round")
		expect((out.functions as any[]).map((f) => f.key ?? f.ref)).toEqual(["die", "attack.melee"])
	})

	it("functions: a key that is the function's own name is left out, cleared options go, a fork drops the pin", () => {
		const form = sectionsFormOf(SCRATCH, "x")
		const row = newFunctionRow(form, "core:function/compare@1", "Compare against a target", { form: { modifierOf: { type: "string" }, draw: { type: "integer", default: 1 } as any } })
		row.bindings = { whom: "", what: ["affection", ""] }
		row.options.modifierOf = ""
		form.functions.push(row)
		const plain = newFunctionRow(form, "core:function/judge@1", "judge")
		form.functions.push(plain)
		const doc = sectionsDocument(SCRATCH, form) as any
		expect(doc.functions[0]).toEqual({ ref: "core:function/compare@1", key: "compare-against-a-target", bindings: { what: ["affection"] }, options: { draw: 1 } })
		expect(doc.functions[1]).toEqual({ ref: "core:function/judge@1" })
		const read = sectionsFormOf({ ...SCRATCH, functions: [{ ref: "acme.lab:function/x@1", hash: "abc", module: { id: "acme.lab:function/x@1", body: "1" } }] }, "x")
		read.functions[0]!.module!.body = "2"
		expect((sectionsDocument(SCRATCH, read) as any).functions[0].hash).toBeUndefined()
	})

	it("entry types, zone types, outcomes, time and options write their own shapes", () => {
		const form = sectionsFormOf(SCRATCH, "x")
		const bond = newEntryType(form, "Bond")
		Object.assign(bond, { prose: "A tie between two people.", relational: true, tags: "relationship" })
		const footing = newEntryField()
		Object.assign(footing, { key: "footing", type: "enum", of: "steady, strained, broken" })
		bond.fields.push(footing)
		form.entryTypes.push(bond)
		const shelf = newZoneType(form, "Shelf")
		Object.assign(shelf, { prose: "Keepsakes on display.", owners: ["cast", "location"], holds: ["bond"], holdsAny: false, limitKind: "number", limit: "6", visibility: "everyone" })
		form.zoneTypes.push(shelf)
		const o = newOutcome(form, "warmed")
		o.five = "success"
		form.outcomes.push(o)
		form.time.unit = "day"
		form.time.perTurn = "2"
		form.options.fields.push({ uid: "o1", name: "pace", label: "Pace", description: "", owner: true, choices: [{ uid: "c1", key: "slow", label: "Slow" }, { uid: "c2", key: "fast", label: "" }], default: "fast", enumField: true, original: null })
		const doc = sectionsDocument(SCRATCH, form) as any
		expect(doc.entryTypes[0]).toEqual({
			id: "bond",
			name: { en: "Bond" },
			prose: "A tie between two people.",
			tags: ["relationship"],
			relational: true,
			fields: {
				footing: {
					type: "enum",
					of: ["steady", "strained", "broken"],
					members: [
						{ key: "steady", label: { en: "steady" } },
						{ key: "strained", label: { en: "strained" } },
						{ key: "broken", label: { en: "broken" } }
					]
				}
			}
		})
		expect(doc.zoneTypes[0]).toEqual({ id: "shelf", name: { en: "Shelf" }, owners: ["cast", "location"], holds: ["bond"], limit: 6, visibility: "everyone", prose: "Keepsakes on display." })
		expect(doc.outcomes).toEqual([{ id: "warmed", label: { en: "warmed" }, five: "success" }])
		expect(doc.time).toEqual({ unit: "day", turns: { perTurn: 2 } })
		expect(doc.options.fields.pace).toMatchObject({ type: "enum", reach: "owner", of: ["slow", "fast"], default: "fast" })
		expect(doc.options.fields.pace.members[1]).toEqual({ key: "fast", label: { en: "fast" } })
		expect(railCounts(form)).toMatchObject({ entryTypes: "1", zoneTypes: "1", outcomes: "2", options: "1" })
		expect(railCounts(sectionsFormOf(SCRATCH, "x")).outcomes).toBe("defaults")
	})

	it("the handbook pages and saved tests are kept in the draft; the Document's text wins when it changed", () => {
		const form = sectionsFormOf({ ...SCRATCH, handbook: [{ title: "A note", body: "Be kind." }], playtests: [{ name: "Pier", party: [{ name: "Wren" }], situation: "Dusk.", change: null }] }, "x")
		expect(form.handbook.map((h) => h.title)).toEqual(["A note"])
		const doc = sectionsDocument(SCRATCH, form) as any
		expect(doc.handbook).toEqual([{ title: "A note", body: "Be kind." }])
		expect(doc.playtests[0].name).toBe("Pier")
		const plan = documentToSave({ saved: SCRATCH, form, formsChanged: true, documentText: JSON.stringify({ ...SCRATCH, description: "typed" }), documentChanged: true })
		expect(plan).toMatchObject({ ok: true, documentWon: true, document: { description: "typed" } })
		expect(documentToSave({ saved: SCRATCH, form, formsChanged: false, documentText: "{", documentChanged: true }).ok).toBe(false)
	})

	it("names what a form cannot write: two of one id, an attribute with no id", () => {
		const form = sectionsFormOf(SCRATCH, "x")
		form.attributes.push(newAttribute(form, "Nerve"), newAttribute(form, ""))
		form.attributes[1]!.id = ""
		const twin = newAttribute(form, "Other")
		twin.id = "nerve"
		form.attributes.push(twin)
		const problems = formProblems(form)
		expect(problems.some((p) => p.includes("no id"))).toBe(true)
		expect(problems.some((p) => p.includes("'nerve'"))).toBe(true)
	})
})

describe("The library, through the sections", () => {
	it("an added row, an edited one and the source land in the library; untouched rows are as read", () => {
		const doc = legacy()
		const form = sectionsFormOf(doc, "x")
		const list = form.library.lists.find((l) => l.repertoireId === "weapons")!
		list.rows[1]!.piece = { ...list.rows[1]!.piece, description: "Short and sharp.", weight: null }
		const row = newLibraryRow()
		row.id = "spear"
		row.lang = "en"
		row.piece = { name: "Spear", description: "Long." }
		list.rows.push(row)
		form.library.sourceLicence = "CC-BY-4.0 (attribution in Licences)"
		const out = sectionsDocument(doc, form) as any
		expect(out.library.source).toEqual({ document: "SRD 5.2.1", licence: "CC-BY-4.0 (attribution in Licences)" })
		expect(out.library.rows.weapons).toEqual([
			doc.compendium.rows.weapons[0],
			{ ...doc.compendium.rows.weapons[1], piece: { name: "Dagger", description: "Short and sharp." } },
			{ id: "spear", version: "1.0.0", lang: "en", piece: { name: "Spear", description: "Long." } }
		])
	})

	it("a row's form is its entry type's whole shape, read through the adapter", () => {
		const view = libraryView(legacy())
		const list = pieceListOf("weapons", view, [])!
		expect(list.label).toBe("Weapons")
		expect(Object.keys(list.piece.fields ?? {})).toContain("weight")
		expect(pieceListOf("spells", view, [])).toBe(null)
	})

	it("Import rows from JSON checks the shape and names each problem by row", () => {
		expect(parseImportedRows("not json")).toMatchObject({ ok: false })
		const bad = parseImportedRows(JSON.stringify([{ id: "Long Sword", version: "1", piece: { name: "Long sword" } }, { id: "axe", piece: {}, damage: 3 }]))
		expect(bad.ok).toBe(false)
		const errors = bad.ok ? [] : bad.errors
		expect(errors.some((e) => e.startsWith("Row 1") && e.includes("lowercase"))).toBe(true)
		expect(errors.some((e) => e.startsWith("Row 2") && e.includes("“damage”"))).toBe(true)
		const good = parseImportedRows(JSON.stringify({ id: "club", version: "2.0.0", piece: { name: "Big club", description: "Bigger." } }))
		const form = sectionsFormOf(legacy(), "x")
		const merged = mergeImported(form.library.lists[0]!.rows, good.ok ? good.rows : [])
		expect([merged.added, merged.replaced]).toEqual([0, 1])
	})
})

describe("the words", () => {
	it("a sentence is cut at its holes: bindings, options, and words as written", () => {
		const decl = { prose: "When {{when}}, restore {{what}} to {{to}}.", bindings: { what: { to: "attribute" } }, form: { to: { type: "string" } } }
		expect(sentenceParts(decl)).toEqual([
			{ text: "When " },
			{ hole: "when", as: "unknown" },
			{ text: ", restore " },
			{ hole: "what", as: "binding" },
			{ text: " to " },
			{ hole: "to", as: "option" },
			{ text: "." }
		])
		const form = sectionsFormOf(SCRATCH, "x")
		const row = newFunctionRow(form, "acme.lab:function/refill@1", "refill")
		row.bindings.what = "nerve"
		row.options.to = "its maximum"
		expect(readsAs(row, decl as never, (id) => (id === "nerve" ? "Nerve" : id))).toBe("When [when], restore Nerve to its maximum.")
	})

	it("Playable now needs every attribute's sentence; Next suggests what the draft lacks", () => {
		const form = sectionsFormOf(SCRATCH, "x")
		expect(playableNote(form).strong).toBe("Plays as no rules.")
		expect(nextSteps(form).map((n) => n.view)).toEqual(["attributes", "entryTypes"])
		form.attributes.push(newAttribute(form, "Nerve"))
		expect(playableNote(form).strong).toBe("Almost playable.")
		form.attributes[0]!.prose = "Spent to be brave."
		expect(playableNote(form).text).toMatch(/^One attribute with its sentence/)
		expect(nextSteps(form)[0]!.view).toBe("functions")
	})

	it("the handbook: generated pages from the sentences, an authored page of the same title takes its place", () => {
		const form = sectionsFormOf(
			{
				...SCRATCH,
				description: { en: "Feelings, kept." },
				attributes: [{ id: "nerve", name: { en: "Nerve" }, kind: "pool", prose: "Spent to be brave" }],
				outcomes: [{ id: "warmed", label: { en: "warmed" }, five: "success" }],
				handbook: [{ title: "How outcomes read", body: "Mine." }, { title: "A note from the author", body: "Hello." }]
			},
			"Hollow Hearts"
		)
		const pages = handbookPages(form)
		expect(pages.map((p) => [p.title, p.source])).toEqual([
			["How to play Hollow Hearts", "generated"],
			["What people carry", "generated"],
			["How outcomes read", "authored"],
			["A note from the author", "authored"]
		])
		expect(pages[1]!.body).toBe("**Nerve** — Spent to be brave.")
	})
})

describe("the scene", () => {
	const doc = {
		...SCRATCH,
		attributes: [
			{ id: "affection", name: { en: "Affection" }, kind: "number", prose: "x" },
			{ id: "hp", slot: "core:slot/hp@1", borrowed: true },
			{ id: "mood", kind: "label", of: ["shy", "warm"], prose: "y" }
		],
		functions: [{ ref: "core:function/compare@1", key: "confession" }],
		entryTypes: [{ id: "keepsakes", name: { en: "Keepsakes" }, prose: "z" }],
		library: { rows: { keepsakes: [{ id: "note", version: "1.0.0", piece: { name: "Dov's note" } }] } }
	}

	it("the party goes as values by the slot each attribute is filed under", () => {
		const form = sectionsFormOf(doc, "x")
		const scene = sceneOf(doc.id, form, null)
		expect(scene.party.map((m) => m.name)).toEqual(["Wren", "Mara"])
		expect(scene.party[0]!.held).toEqual({ keepsakes: ["note"] })
		scene.party[0]!.values = { affection: "6", hp: "9", mood: "warm" }
		expect(partyParams(doc.id, form, scene.party)[0]).toEqual({
			name: "Wren",
			stats: { [rulesetAttributeSlotId(doc.id, "affection")]: 6, "core:slot/hp@1": 9, [rulesetAttributeSlotId(doc.id, "mood")]: "warm" },
			pieces: { keepsakes: ["note"] }
		})
	})

	it("what happens goes as a proposed change, the shape the server has always read; a template's scene maps its keys back", () => {
		const form = sectionsFormOf(doc, "x")
		const base = sceneOf(doc.id, form, null)
		expect(changeDelta(doc.id, form, base.change)).toEqual({ ok: true, delta: null })
		expect(changeDelta(doc.id, form, { ...base.change, kind: "function", owner: "Wren", key: "confession", aimedAt: "Mara" })).toEqual({
			ok: true,
			delta: { owner: "Wren", aimedAt: "Mara", op: "use", check: "confession" }
		})
		expect(changeDelta(doc.id, form, { ...base.change, kind: "attribute", owner: "Wren", attribute: "affection", op: "add", value: "1" })).toEqual({
			ok: true,
			delta: { owner: "Wren", op: "add", slot: rulesetAttributeSlotId(doc.id, "affection"), value: 1 }
		})
		expect(changeDelta(doc.id, form, { ...base.change, kind: "attribute", owner: "Wren", attribute: "affection", value: "lots" }).ok).toBe(false)
		const scene = sceneOf(doc.id, form, {
			party: [{ name: "Ann", stats: { "core:slot/hp@1": 4, [rulesetAttributeSlotId(doc.id, "affection")]: 2 } }],
			situation: { en: "A lock." },
			change: { owner: "Ann", op: "use", check: "confession" }
		} as never)
		expect(scene.party[0]!.values).toEqual({ hp: "4", affection: "2" })
		expect(scene.change).toMatchObject({ kind: "function", key: "confession", owner: "Ann" })
		const saved = savedOf(doc.id, form, scene, "Lock")
		expect(saved).toMatchObject({ name: "Lock", situation: "A lock.", change: { owner: "Ann", op: "use", check: "confession" }, rigour: "mechanics" })
	})
})

describe("🚧 RF fix 2 (2026-10-23)", () => {
	const HEARTS = {
		...SCRATCH,
		attributes: [
			{ id: "affection", name: { en: "Affection" }, kind: "number", bounds: { min: 0, max: 10 }, prose: "How much someone likes you." },
			{ id: "nerve", name: { en: "Nerve" }, kind: "pool", bounds: { max: 3 }, prose: "Spent to be brave." }
		],
		functions: [
			{ ref: "core:function/compare@1", key: "confess", options: { modifierOf: "bond.affection", target: 7 } },
			{ ref: "core:function/rungs@1", key: "standing", bindings: { what: "bond.affection" }, options: { into: "standing" } },
			{ ref: "core:function/spend@1", key: "be-brave", options: { resource: "nerve" } },
			{ ref: "core:function/move@1", key: "pocket-it", bindings: { into: ["pocket", "shelf"] } }
		],
		entryTypes: [
			{ id: "bond", name: { en: "Bond" }, relational: true, farEnd: "person", prose: "A tie.", fields: { affection: { type: "integer" }, standing: { type: "enum", of: ["cold", "warm"] } } },
			{ id: "keepsake", name: { en: "Keepsake" }, prose: "Something kept." }
		],
		zoneTypes: [
			{ id: "pocket", name: { en: "Pocket" }, owners: ["cast"], holds: ["keepsake"], limit: { attribute: "nerve" }, prose: "Kept close." },
			{ id: "shelf", name: { en: "Shelf" }, owners: ["cast"], holds: "*", prose: "On display." }
		],
		library: { source: { document: "d", licence: "l" }, rows: { keepsake: [{ id: "note", version: "1.0.0", piece: { name: "A note" } }] } }
	}

	it("removing an entry type: zone types stop holding it, its functions show the hole, its rows go when asked", () => {
		const form = sectionsFormOf(HEARTS, "Hearts")
		const keepsake = form.entryTypes[1]!
		expect(libraryRowsOf(form, keepsake)).toBe(1)
		removeEntryType(form, keepsake.uid, { rows: true })
		expect(form.zoneTypes[0]!.holds).toEqual([])
		expect(form.zoneTypes[0]!.holdsAny).toBe(false)
		// The keepsake's list is gone; the bond keeps its own (empty) one.
		expect(form.library.lists.map((l) => l.repertoireId)).toEqual(["bond"])
		const doc = sectionsDocument(HEARTS, form)
		expect((doc.zoneTypes as any[])[0].holds).toEqual([])
		expect((doc.zoneTypes as any[])[1].holds).toBe("*")

		const again = sectionsFormOf(HEARTS, "Hearts")
		removeEntryType(again, again.entryTypes[0]!.uid, { rows: false })
		// A binding to it or to one of its fields, and an option naming one, are emptied — and said.
		expect(again.functions[1]!.bindings).toEqual({})
		expect(again.functions[1]!.cleared).toEqual([{ hole: "what", was: "affection on a bond" }])
		expect(again.functions[0]!.options).toEqual({ target: 7 })
		expect(again.functions[0]!.cleared).toEqual([{ hole: "modifierOf", was: "affection on a bond" }])
		expect(again.library.lists.map((l) => l.repertoireId)).toEqual(["keepsake"])
		expect(again.entryTypes.map((e) => e.id)).toEqual(["keepsake"])
		// The emptied holes are never written and never make a row dirty by themselves.
		const written = sectionsDocument(HEARTS, again) as any
		expect(written.functions[0]).toEqual({ ref: "core:function/compare@1", key: "confess", options: { target: 7 } })
		expect("cleared" in written.functions[0]).toBe(false)
	})

	it("removing an attribute clears what named it — a function's option, a zone's limit; removing a zone type, a binding of several", () => {
		const form = sectionsFormOf(HEARTS, "Hearts")
		removeAttribute(form, form.attributes[1]!.uid)
		expect(form.functions[2]!.options).toEqual({})
		expect(form.functions[2]!.cleared).toEqual([{ hole: "resource", was: "Nerve" }])
		expect(form.zoneTypes[0]!.limitKind).toBe("none")
		removeZoneType(form, form.zoneTypes[0]!.uid)
		expect(form.functions[3]!.bindings).toEqual({ into: ["shelf"] })
		expect(form.functions[3]!.cleared).toEqual([{ hole: "into", was: "Pocket" }])
		// Where an entry type lives: a zone type holding it by name, else one that holds anything.
		expect(zonesHolding(form, form.entryTypes[1]!).map((z) => z.id)).toEqual(["shelf"])
	})

	it("a row never typed into is not written; a name gives a new row its id, clear of the others", () => {
		const form = sectionsFormOf(HEARTS, "Hearts")
		form.entryTypes = [...form.entryTypes, newEntryType(form)]
		form.zoneTypes = [...form.zoneTypes, newZoneType(form)]
		form.attributes = [...form.attributes, newAttribute(form)]
		const doc = sectionsDocument(HEARTS, form) as any
		expect(doc.entryTypes.length).toBe(2)
		expect(doc.zoneTypes.length).toBe(2)
		expect(doc.attributes.length).toBe(2)
		const row = form.entryTypes[2]!
		expect(idFromName(row, form.entryTypes, "Keepsake", "entry")).toBe("keepsake-2")
		row.id = idFromName(row, form.entryTypes, "Ribbon", "entry")
		row.name = "Ribbon"
		expect(row.id).toBe("ribbon")
		// An id typed by hand stays; a read row keeps its own.
		row.id = "my-ribbon"
		expect(idFromName(row, form.entryTypes, "Ribbons", "entry")).toBe("my-ribbon")
		expect(idFromName(form.entryTypes[0]!, form.entryTypes, "Ties", "entry")).toBe("bond")
	})

	it("the saved draft's findings land on their rows and sections, never on the form at large", () => {
		const id = SCRATCH.id
		const form = sectionsFormOf(HEARTS, "Hearts")
		const f = findingsByRow(form, [
			`[missing-prose] ${id}.entryTypes[1] has no prose. Say in a sentence what the model reads about it.`,
			`[bad-function-binding] ${id}.functions[1].bindings.what: 'x' is none of the ruleset's attributes.`,
			`[bad-time-unit] ${id}.time.unit is 'week'. Say one of round, minute, hour, day, scene.`,
			`[unknown-entry-type] ${id}.library has rows for 'gone', which is none of ${id}'s entry types.`,
			`[bad-version] ${id}.version is 'x'; a version reads major.minor.patch — '1.0.0'.`
		], id)
		expect(f.rows[form.entryTypes[1]!.uid]).toEqual([{ reason: "missing-prose", sentence: "Has no prose. Say in a sentence what the model reads about it." }])
		expect(f.rows[form.functions[1]!.uid]![0]!.sentence).toBe("Bindings.what: 'x' is none of the ruleset's attributes.")
		expect(f.sections.outcomes!.map((x) => x.reason)).toEqual(["bad-time-unit"])
		expect(f.sections.library!.map((x) => x.reason)).toEqual(["unknown-entry-type"])
		expect(f.rest.map((x) => x.reason)).toEqual(["bad-version"])
	})

	it("free text and required are written as the SDK reads them; free text says so in words", () => {
		const form = sectionsFormOf(SCRATCH, "Hearts")
		const vow = { ...newAttribute(form, "Vow"), kind: "text", start: "  To see the sea once. ", prose: "What someone has sworn.", required: true, min: "1", max: "3" }
		form.attributes = [vow]
		const doc = sectionsDocument(SCRATCH, form) as any
		expect(doc.attributes).toEqual([{ id: "vow", name: { en: "Vow" }, kind: "text", start: "To see the sea once.", prose: "What someone has sworn.", required: true }])
		expect(kindWords(vow)).toBe("Free text")
		expect(sectionsFormOf(doc, "Hearts").attributes[0]!.required).toBe(true)
	})

	it("the rail's note counts the saved draft's problems before publish", () => {
		const form = sectionsFormOf(HEARTS, "Hearts")
		expect(playableNote(form, [], 0).strong).toBe("Playable now.")
		expect(playableNote(form, [], 3)).toMatchObject({ tone: "warning", strong: "3 problems before publish." })
	})
})

describe("🚧 RF fix 6: removing a function, and what a role takes (2026-10-23)", () => {
	const WAYS = {
		...SCRATCH,
		attributes: [{ id: "nerve", name: { en: "Nerve" }, kind: "pool", bounds: { max: 3 }, prose: "Spent to be brave." }],
		functions: [
			{ ref: "core:function/die-target@1", key: "d20" },
			{ ref: "core:function/compare@1", key: "weigh" },
			{ ref: "core:function/check@1", key: "climb", options: { way: "d20", base: "nerve" } },
			{ ref: "core:function/outcome-moves@1", key: "moves", bindings: { what: "nerve" }, options: { check: "climb" } },
			{ ref: "acme.lab:function/hearts-near@1", key: "near", module: { id: "acme.lab:function/hearts-near@1", name: { en: "Near" }, meaning: { en: "m" }, kind: "scope", prose: "Who is near." } },
			{ ref: "core:function/restore@1", key: "refill", bindings: { what: "nerve" } }
		],
		playtests: [{ name: "A climb", party: [], situation: "", change: { owner: "Wren", op: "use", check: "climb" } }]
	}
	const ways = new Set(["core:function/die-target@1", "core:function/compare@1"])
	const isWay = (r: { ref: string }) => ways.has(r.ref)

	it("its key goes from every option that named it, said on the row; the saved test that used it loses its change", () => {
		const form = sectionsFormOf(WAYS, "Hearts")
		const climb = form.functions[2]!
		const r = removeFunction(form, climb.uid, { isWay, name: "A check" })
		expect(r.removed?.key).toBe("climb")
		expect(r.wasDefault).toBe(false)
		expect(form.functions.map((f) => f.key)).toEqual(["d20", "weigh", "moves", "near", "refill"])
		// The outcome move named it as its check: emptied, and the row says what it was.
		expect(form.functions[2]!.options).toEqual({})
		expect(form.functions[2]!.cleared).toEqual([{ hole: "check", was: "A check" }])
		// Its role named an attribute, not the key: untouched.
		expect(form.functions[2]!.bindings).toEqual({ what: "nerve" })
		expect(r.tests).toEqual(["A climb"])
		expect((form.playtests[0]!.value as { change: unknown }).change).toBeNull()
		const doc = sectionsDocument(WAYS, form) as any
		expect(JSON.stringify(doc.functions)).not.toContain("climb")
	})

	it("the default way goes to the next way, or to none; a way a check named leaves the check on the default", () => {
		const form = sectionsFormOf(WAYS, "Hearts")
		const r = removeFunction(form, form.functions[0]!.uid, { isWay, name: "One die against a target" })
		expect(r.wasDefault).toBe(true)
		expect(r.nowDefault?.key).toBe("weigh")
		expect(form.functions.find((f) => f.key === "climb")!.options).toEqual({ base: "nerve" })
		expect(form.functions.find((f) => f.key === "climb")!.cleared).toEqual([{ hole: "way", was: "One die against a target" }])
		const last = removeFunction(form, form.functions[0]!.uid, { isWay })
		expect(last).toMatchObject({ wasDefault: true, nowDefault: null })
		// Removing what is not the default says nothing of the default.
		expect(removeFunction(form, form.functions.find((f) => f.key === "refill")!.uid, { isWay }).wasDefault).toBe(false)
	})

	it("a scope only this draft carried goes from the roles that named it", () => {
		const form = sectionsFormOf(
			{ ...WAYS, functions: [...WAYS.functions, { ref: "core:function/reveal@1", key: "show", bindings: { whom: "acme.lab:function/hearts-near@1" } }] },
			"Hearts"
		)
		removeFunction(form, form.functions.find((f) => f.key === "near")!.uid, { isWay, name: "Near" })
		const show = form.functions.find((f) => f.key === "show")!
		expect(show.bindings).toEqual({})
		expect(show.cleared).toEqual([{ hole: "whom", was: "Near" }])
	})

	it("findings judged as the draft stands land on their rows, a blank row not counted", () => {
		const form = sectionsFormOf(WAYS, "Hearts")
		form.attributes = [newAttribute(form), ...form.attributes]
		const f = findingsByRow(form, [`[bad-binding-kind] ${SCRATCH.id}.attributes[0].kind: x.`], SCRATCH.id)
		expect(Object.keys(f.rows)).toEqual([form.attributes[1]!.uid])
	})

	it("a pick says what its role takes, and names what it leaves out", () => {
		expect(pickNote({ role: "Restore", takes: "a number, a pool or a tally", fieldTypes: [], leftOut: ["Mood"], offered: 1 })).toBe(
			"Restore takes a number, a pool or a tally, so Mood is not offered."
		)
		expect(pickNote({ role: "The number", takes: "a number, a pool or a tally", fieldTypes: ["number", "integer"], leftOut: ["Mood", "Note on a bond"], offered: 2 })).toBe(
			"The number takes a number, a pool or a tally, or an entry's field that is a number, so Mood and Note on a bond are not offered."
		)
		expect(pickNote({ role: "The word", takes: "a word or free text", fieldTypes: [], leftOut: [], offered: 0 })).toBe(
			"The word takes a word or free text. None of yours is yet: add one under Attributes."
		)
		expect(pickNote({ role: "Restore", takes: "a number, a pool or a tally", fieldTypes: [], leftOut: [], offered: 3 })).toBeUndefined()
	})
})
