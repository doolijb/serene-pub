import { describe, expect, it } from "vitest"
import { NO_PAIR_REASON, resolveVoiceFrom, type ResolveVoiceFacts, type VoiceEntryFacts } from "./resolveVoiceCore"
import { fixtureRefusalOf, voiceFixtures } from "./resolveVoice.fixtures"
import { detectScriptLanguage, normaliseLanguage, resolveLanguage } from "./language"

describe("resolveVoiceFrom — shipped fixtures", () => {
	it.each(voiceFixtures.map((f) => [f.name, f] as const))("%s", (_name, fx) => {
		const out = resolveVoiceFrom(fx.facts)
		if ((fx.expect as { ok: boolean }).ok === false) {
			expect(out.ok).toBe(false)
			return
		}
		expect(out).toMatchObject(fx.expect)
	})
	it("the no-pair refusal names the Narration loadout", () => {
		const fx = voiceFixtures.find((f) => f.name === "no pair refuses")!
		expect(resolveVoiceFrom(fx.facts)).toEqual({ ok: false, reason: NO_PAIR_REASON })
	})
})

describe("resolveVoiceFrom — the service step", () => {
	const PAIR = 7
	const entry = (slug: string): VoiceEntryFacts => ({
		slug,
		loadoutId: 1,
		connectionModelId: PAIR,
		voiceId: `v-${slug}`,
		language: null,
		settings: {},
		enabled: true
	})
	const base: ResolveVoiceFacts = {
		pairModelId: PAIR,
		loadoutVoice: null,
		timbre: null,
		timbreEntry: null,
		sessionEntry: null,
		sessionNarratorVoice: null,
		refusalOf: fixtureRefusalOf
	}
	const f = (over: Partial<ResolveVoiceFacts>): ResolveVoiceFacts => ({ ...base, ...over })

	it("serviceVoice set -> from 'service' with it", () => {
		expect(resolveVoiceFrom(f({ serviceVoice: "alloy" }))).toMatchObject({
			ok: true,
			from: "service",
			voiceId: "alloy"
		})
	})
	it("absent or whitespace serviceVoice -> null voice id", () => {
		for (const serviceVoice of [undefined, null, "", "   "])
			expect(resolveVoiceFrom(f({ serviceVoice })), String(serviceVoice)).toMatchObject({
				ok: true,
				from: "service",
				voiceId: null
			})
	})
	it("timbre, session, default and loadout each beat the service voice", () => {
		const sv = { serviceVoice: "alloy" }
		expect(
			resolveVoiceFrom(f({ ...sv, timbreEntry: { slug: "t", entry: entry("t") } }))
		).toMatchObject({ from: "timbre", voiceId: "v-t" })
		expect(
			resolveVoiceFrom(f({ ...sv, sessionEntry: { slug: "s", entry: entry("s") } }))
		).toMatchObject({ from: "session", voiceId: "v-s" })
		expect(
			resolveVoiceFrom(f({ ...sv, loadoutVoiceEntry: { slug: "d", entry: entry("d") } }))
		).toMatchObject({ from: "loadout-voice", voiceId: "v-d" })
		expect(resolveVoiceFrom(f({ ...sv, loadoutVoice: "lv" }))).toMatchObject({ from: "loadout", voiceId: "lv" })
	})
	it("the order is timbre > session > loadout voice > loadout > service", () => {
		const all = f({
			serviceVoice: "alloy",
			loadoutVoice: "lv",
			timbreEntry: { slug: "t", entry: entry("t") },
			sessionEntry: { slug: "s", entry: entry("s") },
			loadoutVoiceEntry: { slug: "d", entry: entry("d") }
		})
		expect(resolveVoiceFrom(all)).toMatchObject({ from: "timbre" })
		expect(resolveVoiceFrom({ ...all, timbreEntry: null })).toMatchObject({ from: "session" })
		expect(resolveVoiceFrom({ ...all, timbreEntry: null, sessionEntry: null })).toMatchObject({
			from: "loadout-voice"
		})
		expect(
			resolveVoiceFrom({ ...all, timbreEntry: null, sessionEntry: null, loadoutVoiceEntry: null })
		).toMatchObject({ from: "loadout" })
	})
})

describe("resolveVoiceFrom — the seed", () => {
	const PAIR = 7
	const entry = (seed?: number): VoiceEntryFacts => ({
		slug: "e",
		loadoutId: 1,
		connectionModelId: PAIR,
		voiceId: "v-e",
		language: null,
		settings: seed === undefined ? {} : { seed },
		enabled: true
	})
	const base: ResolveVoiceFacts = {
		pairModelId: PAIR,
		loadoutVoice: null,
		timbre: null,
		timbreEntry: null,
		sessionEntry: null,
		sessionNarratorVoice: null,
		refusalOf: fixtureRefusalOf
	}
	it("a timbre seed overrides the entry's seed", () => {
		const out = resolveVoiceFrom({
			...base,
			timbre: { voice: "e", settings: { seed: 5 } },
			timbreEntry: { slug: "e", entry: entry(9) }
		})
		expect(out).toMatchObject({ ok: true, settings: { seed: 5 } })
	})
	it("the entry's seed flows when the timbre has none", () => {
		const out = resolveVoiceFrom({
			...base,
			timbre: { voice: "e", settings: { speed: 1 } },
			timbreEntry: { slug: "e", entry: entry(9) }
		})
		expect(out).toMatchObject({ ok: true, settings: { seed: 9, speed: 1 } })
	})
	it("a timbre seed still flows on the loadout and service paths", () => {
		const timbre = { settings: { seed: 5 } }
		expect(resolveVoiceFrom({ ...base, timbre, loadoutVoice: "lv" })).toMatchObject({
			from: "loadout",
			settings: { seed: 5 }
		})
		expect(resolveVoiceFrom({ ...base, timbre, serviceVoice: "sv" })).toMatchObject({
			from: "service",
			settings: { seed: 5 }
		})
	})
})

describe("detectScriptLanguage", () => {
	it.each([
		["こんにちは、元気ですか", "ja"],
		["日本語の漢字とかな", "ja"],
		["안녕하세요 여러분", "ko"],
		["你好，世界你好", "zh"],
		["Γειά σου κόσμε", "el"],
		["שלום עולם", "he"],
		["สวัสดีชาวโลก", "th"],
		["გამარჯობა მსოფლიო", "ka"],
		["Բարեւ աշխարհ", "hy"],
		["नमस्ते दुनिया", "hi"]
	])("%s -> %s", (text, lang) => {
		expect(detectScriptLanguage(text)).toBe(lang)
	})
	it("Latin is never detected; Cyrillic and Arabic are ambiguous -> null", () => {
		for (const t of ["Bonjour, comment allez-vous", "Hello there", "Привет, мир", "مرحبا بالعالم"])
			expect(detectScriptLanguage(t), t).toBeNull()
	})
	it("needs a 60% majority of letters", () => {
		expect(detectScriptLanguage("こんにちは world and more english words")).toBeNull()
		expect(detectScriptLanguage("こんにちは こんにちは hi")).toBe("ja")
	})
	it("empty and letterless text -> null", () => {
		expect(detectScriptLanguage("")).toBeNull()
		expect(detectScriptLanguage("123 !!! ...")).toBeNull()
	})
})

describe("language order", () => {
	it("normaliseLanguage accepts two letters only", () => {
		expect(normaliseLanguage(" EN ")).toBe("en")
		for (const v of ["eng", "e", "", null, 3, "en-GB"]) expect(normaliseLanguage(v), String(v)).toBeNull()
	})
	it("cue -> script -> timbre -> session -> pub", () => {
		const all = { cue: "fr", text: "こんにちは", timbre: "de", session: "es", pub: "en" }
		expect(resolveLanguage(all)).toEqual({ language: "fr", from: "cue" })
		expect(resolveLanguage({ ...all, cue: "bad" })).toEqual({ language: "ja", from: "script" })
		expect(resolveLanguage({ ...all, cue: null, text: "Hello" })).toEqual({ language: "de", from: "timbre" })
		expect(resolveLanguage({ session: "es", pub: "en" })).toEqual({ language: "es", from: "session" })
		expect(resolveLanguage({ pub: "en" })).toEqual({ language: "en", from: "pub" })
		expect(resolveLanguage({})).toEqual({ language: null, from: null })
	})
})

describe("resolveVoiceFrom — resolution by cue kind (B7 + C10)", () => {
	const PAIR = 7
	const e = (slug: string, over: Partial<VoiceEntryFacts> = {}): VoiceEntryFacts => ({
		slug,
		loadoutId: 1,
		connectionModelId: PAIR,
		voiceId: `v-${slug}`,
		language: null,
		settings: {},
		enabled: true,
		...over
	})
	const a = (slug: string, over: Partial<VoiceEntryFacts> = {}) => ({ slug, entry: e(slug, over) })
	const ghost = (slug: string) => ({ slug, entry: null })
	const off = (slug: string) => a(slug, { enabled: false })
	const base: ResolveVoiceFacts = {
		pairModelId: PAIR,
		loadoutVoice: "lv",
		timbre: null,
		timbreEntry: null,
		sessionEntry: null,
		sessionNarratorVoice: null,
		refusalOf: fixtureRefusalOf
	}
	const run = (over: Partial<ResolveVoiceFacts>) =>
		resolveVoiceFrom({ ...base, ...over }) as Extract<ReturnType<typeof resolveVoiceFrom>, { ok: true }>

	// Every arm present, each knocked out in turn, so each arrow is hit.
	const dialogue = {
		timbreEntry: a("card"),
		envoyEntry: a("envoy"),
		otherSpeakersEntry: a("others"),
		autoEntry: a("auto"),
		sessionEntry: a("session"),
		loadoutVoiceEntry: a("lvoice"),
		loadoutFirstEntry: a("first")
	}
	it("dialogue: card -> envoy -> other speakers -> auto -> session -> loadout voice -> first -> loadout", () => {
		expect(run({ ...dialogue, cueVoice: "speaker", hasSpeaker: true })).toMatchObject({ from: "timbre", voicebankSlug: "card" })
		const w1 = { ...dialogue, timbreEntry: null }
		expect(run(w1)).toMatchObject({ from: "envoy", voicebankSlug: "envoy" })
		const w2 = { ...w1, envoyEntry: null }
		expect(run(w2)).toMatchObject({ from: "other-speakers", voicebankSlug: "others" })
		const w3 = { ...w2, otherSpeakersEntry: null }
		expect(run(w3)).toMatchObject({ from: "auto", voicebankSlug: "auto" })
		const w4 = { ...w3, autoEntry: null }
		expect(run(w4)).toMatchObject({ from: "session" })
		const w5 = { ...w4, sessionEntry: null }
		expect(run(w5)).toMatchObject({ from: "loadout-voice", voicebankSlug: "lvoice" })
		const w6 = { ...w5, loadoutVoiceEntry: null }
		expect(run(w6)).toMatchObject({ from: "loadout-first", voicebankSlug: "first" })
		expect(run({})).toMatchObject({ from: "loadout", voiceId: "lv" })
	})
	it("other speakers beats auto; auto beats the session narrator", () => {
		expect(run({ ...dialogue, timbreEntry: null, envoyEntry: null })).toMatchObject({ from: "other-speakers" })
		expect(run({ ...dialogue, timbreEntry: null, envoyEntry: null, otherSpeakersEntry: null })).toMatchObject({ from: "auto" })
	})
	it("a dialogue cue with no speaker takes the narrator chain", () => {
		expect(run({ ...dialogue, timbreEntry: null, envoyEntry: null, cueVoice: "speaker", hasSpeaker: false })).toMatchObject({ from: "session" })
	})
	it("dialogue never reads the narration arms", () => {
		const r = run({
			cueVoice: "speaker",
			timbreNarrationEntry: a("nc"),
			envoyNarrationEntry: a("ne")
		})
		expect(r.from).toBe("loadout")
	})
	it("dialogue: unknown / off arms are recorded and the chain moves on", () => {
		const r = run({
			...dialogue,
			timbreEntry: ghost("g1"),
			envoyEntry: off("o1"),
			otherSpeakersEntry: off("o2"),
			autoEntry: ghost("g3"),
			sessionEntry: ghost("g2")
		})
		expect(r).toMatchObject({ from: "loadout-voice" })
		expect(r.skipped.map((s) => [s.from, s.slug])).toEqual([
			["timbre", "g1"],
			["envoy", "o1"],
			["other-speakers", "o2"],
			["auto", "g3"],
			["session", "g2"]
		])
	})

	const inLine = {
		cueVoice: "narrator" as const,
		hasSpeaker: true,
		timbreNarrationEntry: a("ncard"),
		envoyNarrationEntry: a("nenvoy"),
		sessionEntry: a("session"),
		loadoutVoiceEntry: a("lvoice"),
		loadoutFirstEntry: a("first"),
		otherSpeakersEntry: a("others"),
		autoEntry: a("auto"),
		timbreEntry: a("card"),
		envoyEntry: a("envoy")
	}
	it("narration in a line: card narration -> envoy narration -> session -> loadout voice -> first -> loadout", () => {
		expect(run(inLine)).toMatchObject({ from: "narration-timbre", voicebankSlug: "ncard" })
		const w1 = { ...inLine, timbreNarrationEntry: null }
		expect(run(w1)).toMatchObject({ from: "envoy-narration", voicebankSlug: "nenvoy" })
		const w2 = { ...w1, envoyNarrationEntry: null }
		expect(run(w2)).toMatchObject({ from: "session" })
		const w3 = { ...w2, sessionEntry: null }
		expect(run(w3)).toMatchObject({ from: "loadout-voice", voicebankSlug: "lvoice" })
		const w4 = { ...w3, loadoutVoiceEntry: null }
		expect(run(w4)).toMatchObject({ from: "loadout-first", voicebankSlug: "first" })
		expect(run({ ...w4, loadoutFirstEntry: null })).toMatchObject({ from: "loadout" })
	})
	it("narration in a line never uses the dialogue voices (card, envoy, other speakers, auto)", () => {
		const r = run({ ...inLine, timbreNarrationEntry: null, envoyNarrationEntry: null, sessionEntry: null, loadoutVoiceEntry: null, loadoutFirstEntry: null })
		expect(r.from).toBe("loadout")
	})
	it("narration in a line: unknown / off arms recorded in order", () => {
		const r = run({
			...inLine,
			timbreNarrationEntry: ghost("g"),
			envoyNarrationEntry: off("o"),
			sessionEntry: off("s"),
			loadoutVoiceEntry: ghost("nd")
		})
		expect(r.from).toBe("loadout-first")
		expect(r.skipped.map((s) => s.from)).toEqual(["narration-timbre", "envoy-narration", "session", "loadout-voice"])
	})

	const plain = {
		cueVoice: "narrator" as const,
		hasSpeaker: false,
		sessionEntry: a("session"),
		loadoutVoiceEntry: a("lvoice"),
		loadoutFirstEntry: a("first")
	}
	it("plain narration: session -> loadout voice -> first -> loadout", () => {
		expect(run(plain)).toMatchObject({ from: "session" })
		expect(run({ ...plain, sessionEntry: ghost("x") })).toMatchObject({
			from: "loadout-voice",
			skipped: [{ from: "session", slug: "x" }]
		})
		expect(run({ ...plain, sessionEntry: null, loadoutVoiceEntry: off("nd") })).toMatchObject({
			from: "loadout-first",
			skipped: [{ from: "loadout-voice", slug: "nd" }]
		})
		expect(run({ cueVoice: "narrator", hasSpeaker: false })).toMatchObject({ from: "loadout" })
	})
	it("plain narration ignores card, envoy, other-speakers and auto arms", () => {
		const r = run({ ...plain, timbreEntry: a("card"), timbreNarrationEntry: a("ncard"), envoyEntry: a("env"), envoyNarrationEntry: a("nenv"), otherSpeakersEntry: a("o"), autoEntry: a("au"), sessionEntry: null, loadoutVoiceEntry: null, loadoutFirstEntry: null })
		expect(r.from).toBe("loadout")
	})

	it("descriptions, dialogue: the card's, else the chosen entry's own", () => {
		const entry = a("lvoice", { description: "entry words" })
		const f = { cueVoice: "speaker" as const, hasSpeaker: true, loadoutVoiceEntry: entry }
		expect(run({ ...f, timbre: { description: "card" } }).description).toBe("card")
		expect(run(f).description).toBe("entry words")
	})
	it("descriptions, narration in a line: the entry's own; the card contributes a voice, never prose", () => {
		const entry = a("lvoice", { description: "entry words" })
		const f = { cueVoice: "narrator" as const, hasSpeaker: true, loadoutVoiceEntry: entry, timbre: { description: "card-d" } }
		expect(run(f).description).toBe("entry words")
	})
	it("descriptions, plain narration: only the entry's own", () => {
		const entry = a("lvoice", { description: "entry words" })
		expect(run({ cueVoice: "narrator", hasSpeaker: false, loadoutVoiceEntry: entry }).description).toBe("entry words")
	})
	it("no envoy description reaches any cue (facts no longer carry one)", () => {
		const entry = a("lvoice", { description: "entry words" })
		const extra = { envoyDescription: "env", envoyNarrationDescription: "envn" } as unknown as Partial<ResolveVoiceFacts>
		expect(run({ ...extra, cueVoice: "speaker", hasSpeaker: true, loadoutVoiceEntry: entry }).description).toBe("entry words")
		expect(run({ ...extra, cueVoice: "narrator", hasSpeaker: true, loadoutVoiceEntry: entry }).description).toBe("entry words")
	})
	it("a retired stored voiceFrom value is not a current arm", async () => {
		const { VOICE_FROM } = await import("../../shared/speech/voicebank")
		expect(VOICE_FROM).not.toContain("voicebank-default")
		expect(VOICE_FROM).not.toContain("narration-default")
	})
})

describe("the card's settings never reach a narration cue (owner report 2026-10-29)", () => {
	const PAIR = 7
	const mk = (slug: string, seed: number): VoiceEntryFacts => ({
		slug,
		loadoutId: 1,
		connectionModelId: PAIR,
		voiceId: `v-${slug}`,
		language: null,
		settings: { seed },
		enabled: true
	})
	const base: ResolveVoiceFacts = {
		pairModelId: PAIR,
		loadoutVoice: null,
		timbre: null,
		timbreEntry: null,
		sessionEntry: null,
		sessionNarratorVoice: null,
		refusalOf: fixtureRefusalOf
	}
	it("narration inside the character's line keeps the narrator entry's seed, not the card's", () => {
		const out = resolveVoiceFrom({
			...base,
			cueVoice: "narrator",
			hasSpeaker: true,
			timbre: { voice: "e", settings: { seed: 5, speed: 1.3 } },
			timbreEntry: { slug: "e", entry: mk("e", 9) },
			sessionNarratorVoice: "n",
			sessionEntry: { slug: "n", entry: mk("n", 42) }
		})
		expect(out).toMatchObject({ ok: true, voicebankSlug: "n", settings: { seed: 42 } })
		expect((out as { settings: { speed?: number } }).settings.speed).toBeUndefined()
	})
	it("dialogue still layers the card's seed over the entry's", () => {
		const out = resolveVoiceFrom({
			...base,
			cueVoice: "speaker",
			timbre: { voice: "e", settings: { seed: 5 } },
			timbreEntry: { slug: "e", entry: mk("e", 9) }
		})
		expect(out).toMatchObject({ ok: true, voicebankSlug: "e", settings: { seed: 5 } })
	})
})

describe("entries on their own loadouts (voice loadouts lane)", () => {
	const base2 = (over: Partial<ResolveVoiceFacts>): ResolveVoiceFacts => ({
		pairModelId: null,
		loadoutVoice: null,
		timbre: null,
		timbreEntry: null,
		sessionEntry: null,
		sessionNarratorVoice: null,
		refusalOf: fixtureRefusalOf,
		...over
	})
	const ent = (slug: string, over: Partial<VoiceEntryFacts> = {}): VoiceEntryFacts => ({
		slug, loadoutId: 3, connectionModelId: 11, voiceId: `v-${slug}`, language: null, settings: {}, enabled: true, ...over
	})
	it("an entry on its own filled loadout speaks while the speaking loadout is unfilled", () => {
		const r = resolveVoiceFrom(base2({ timbreEntry: { slug: "a", entry: ent("a") } }))
		expect(r).toMatchObject({ ok: true, from: "timbre", loadoutId: 3, connectionModelId: 11 })
	})
	it("an unassigned entry is skipped with a note, then the fallback pair speaks", () => {
		const r = resolveVoiceFrom(base2({
			pairModelId: 7,
			timbreEntry: { slug: "a", entry: ent("a", { loadoutId: null, connectionModelId: null }) },
			serviceVoice: "sv"
		}))
		expect(r).toMatchObject({ ok: true, from: "service", loadoutId: null, connectionModelId: 7 })
		if (r.ok) expect(r.skipped[0]).toMatchObject({ slug: "a" })
	})
	it("the fallback arms refuse without a fallback pair", () => {
		expect(resolveVoiceFrom(base2({}))).toEqual({ ok: false, reason: NO_PAIR_REASON })
	})
	it("narration in a line takes no card prose", () => {
		const r = resolveVoiceFrom(base2({
			cueVoice: "narrator", hasSpeaker: true,
			timbre: { description: "card" },
			loadoutVoiceEntry: { slug: "d", entry: ent("d", { description: "entry words" }) }
		}))
		expect(r).toMatchObject({ ok: true, description: "entry words" })
	})
})
