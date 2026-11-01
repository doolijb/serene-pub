import { describe, expect, test } from "vitest"
import {
	DEFAULT_SCOPE,
	FINDER_SCOPES,
	capabilityForScope,
	destinationsFor,
	formatCount,
	ggufTierLabel,
	headlineBytes,
	hubDetail,
	isLowQualityQuant,
	isRecommendedQuantLabel,
	kcppHubRows,
	kcppKindForScope,
	kcppRecommendedRows,
	landingNote,
	licenseFromTags,
	matchesQuery,
	ollamaHubRows,
	ollamaRecommendedRows,
	onnxRecommendedRows,
	onnxTierLabel,
	pickDestination,
	primaryRowIndex,
	quantFit,
	quantsFromKcpp,
	quantsFromOllama,
	rankHub,
	scopeForCapability,
	displayTags,
	secondLine,
	type Destination,
	type FinderRow,
	type RowContext,
	SerialAsk,
	repoTitle,
	repoOwner
} from "./finder"
import { CONNECTION_TYPE } from "$lib/shared/constants/ConnectionTypes"

const GB = 1_000_000_000
const none = new Set<string>()
const ctx = (over: Partial<RowContext> = {}): RowContext => ({
	tier: "8gb",
	query: "",
	present: none,
	...over
})

describe("scopes map to the sections' star capabilities", () => {
	test("all four, both ways", () => {
		for (const scope of FINDER_SCOPES) {
			expect(scopeForCapability(scope.capability)).toBe(scope.value)
			expect(capabilityForScope(scope.value)).toBe(scope.capability)
		}
	})
	test("a transform no section stars has no scope", () => {
		expect(scopeForCapability("text->speech")).toBeNull()
		expect(scopeForCapability(null)).toBeNull()
	})
	test("chat is the default and only chat/images have a KoboldCPP kind", () => {
		expect(DEFAULT_SCOPE).toBe("chat")
		expect(kcppKindForScope("chat")).toBe("text")
		expect(kcppKindForScope("images")).toBe("image")
		expect(kcppKindForScope("embeddings")).toBeNull()
		expect(kcppKindForScope("entities")).toBeNull()
	})
})

describe("destinationsFor — only somewhere a file could actually land", () => {
	const rows = [
		{ id: 1, name: "KoboldCPP", type: CONNECTION_TYPE.KOBOLDCPP_MANAGED },
		{
			id: 2,
			name: "KoboldCPP images",
			type: CONNECTION_TYPE.KOBOLDCPP_MANAGED_IMAGE
		},
		{ id: 3, name: "Ollama", type: CONNECTION_TYPE.OLLAMA },
		{
			id: 4,
			name: "Embeddings",
			type: CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS
		},
		{ id: 5, name: "Entities", type: CONNECTION_TYPE.LOCAL_ONNX_NER },
		{ id: 6, name: "OpenRouter", type: CONNECTION_TYPE.OPENAI }
	]

	test("chat offers the managed runtime then Ollama; a title that IS the service's word is not repeated", () => {
		const out = destinationsFor("chat", rows)
		expect(out.map((d) => d.label)).toEqual(["KoboldCPP", "Ollama"])
		expect(out.map((d) => d.serviceLabel)).toEqual(["KoboldCPP", "Ollama"])
		expect(out[0].kcppKind).toBe("text")
	})

	test("images is KoboldCPP only, and the SAME row with kind image", () => {
		const out = destinationsFor("images", rows)
		expect(out).toHaveLength(1)
		// The text row, not the image one: one install, one destination — the
		// download's kind is what routes the file.
		expect(out[0].connectionId).toBe(1)
		expect(out[0].kcppKind).toBe("image")
	})

	test("the image row stands in when it is all there is", () => {
		const out = destinationsFor("images", [rows[1]])
		expect(out[0].connectionId).toBe(2)
	})

	test("embeddings puts the local ONNX connection first", () => {
		const out = destinationsFor("embeddings", [
			...rows,
			{
				id: 7,
				name: "Ollama embed",
				type: CONNECTION_TYPE.OLLAMA_EMBEDDINGS
			}
		])
		expect(out.map((d) => d.label)).toEqual([
			"Embeddings · ONNX",
			// The Ollama CHAT row, now an embeddings destination in its own
			// right — one host, every modality (owner ruling 2026-09-25).
			"Ollama",
			"Ollama embed · Ollama"
		])
	})

	test("an Ollama chat connection takes embedding downloads, no second row needed", () => {
		const out = destinationsFor("embeddings", [
			{ id: 3, name: "Ollama", type: CONNECTION_TYPE.OLLAMA }
		])
		expect(out.map((d) => [d.kind, d.connectionId])).toEqual([
			["ollama", 3]
		])
	})

	test("entities is the NER connection alone", () => {
		expect(
			destinationsFor("entities", rows).map((d) => d.connectionId)
		).toEqual([5])
	})

	test("an API host is never a destination", () => {
		expect(destinationsFor("chat", [rows[5]])).toEqual([])
	})

	test("a nameless row falls back to the service's own word", () => {
		const out = destinationsFor("chat", [
			{ id: 9, name: "  ", type: CONNECTION_TYPE.OLLAMA }
		])
		expect(out[0].title).toBe("Ollama")
		expect(out[0].label).toBe("Ollama")
	})

	test("pickDestination honours the caller, then the first", () => {
		const out = destinationsFor("chat", rows)
		expect(pickDestination(out, 3)?.connectionId).toBe(3)
		// Asked for one that cannot take this scope: the first, not nothing.
		expect(pickDestination(out, 4)?.connectionId).toBe(1)
		expect(pickDestination(out)?.connectionId).toBe(1)
		expect(pickDestination([], 3)).toBeNull()
		// Plan 2026-09-24 C6: a destination that cannot take a file yet
		// (KoboldCPP not installed) is passed over for one that can.
		expect(
			pickDestination(out, null, (d) => d.connectionId !== 1)
				?.connectionId
		).not.toBe(1)
		expect(pickDestination(out, null, () => false)?.connectionId).toBe(1)
	})
})

describe("ONNX destinations on a machine that can't run local ONNX", () => {
	const rows = [
		{ id: 3, name: "Ollama", type: CONNECTION_TYPE.OLLAMA },
		{
			id: 4,
			name: "Embeddings",
			type: CONNECTION_TYPE.LOCAL_ONNX_EMBEDDINGS
		},
		{ id: 5, name: "Entities", type: CONNECTION_TYPE.LOCAL_ONNX_NER }
	]
	const localOnnx = {
		available: false,
		reason: "the ONNX runtime didn't load (no binding)"
	}
	const REASON =
		"Not available on this machine: the ONNX runtime didn't load (no binding)"

	test("stay listed, disabled with the reason; nothing else is", () => {
		const out = destinationsFor("embeddings", rows, { localOnnx })
		expect(out.map((d) => [d.kind, d.disabledReason])).toEqual([
			["onnx", REASON],
			["ollama", undefined]
		])
		expect(
			destinationsFor("entities", rows, { localOnnx }).map(
				(d) => d.disabledReason
			)
		).toEqual([REASON])
	})

	test("a machine that runs them, or no verdict yet, disables none", () => {
		for (const verdict of [{ available: true, reason: null }, undefined]) {
			const out = destinationsFor("embeddings", rows, {
				localOnnx: verdict
			})
			expect(out.some((d) => d.disabledReason)).toBe(false)
		}
	})

	test("pickDestination passes a disabled one over, unless asked for it or alone", () => {
		const out = destinationsFor("embeddings", rows, { localOnnx })
		// Ollama, though ONNX comes first and `isReady` says yes to both.
		expect(pickDestination(out)?.connectionId).toBe(3)
		// The ONNX endpoint's own Get tab asks for it by id.
		expect(pickDestination(out, 4)?.connectionId).toBe(4)
		// Entities has nowhere else: the disabled one, so its reason shows.
		const entities = destinationsFor("entities", rows, { localOnnx })
		expect(pickDestination(entities)?.connectionId).toBe(5)
	})

	test("the landing note is the reason", () => {
		const [onnx] = destinationsFor("entities", rows, { localOnnx })
		expect(landingNote(onnx)).toBe(REASON)
	})
})

describe("landingNote names where files go", () => {
	const dest = (kind: Destination["kind"]): Destination => ({
		id: `${kind}:1`,
		kind,
		connectionId: 1,
		title: "T",
		serviceLabel: "S",
		label: "T · S"
	})
	test("KoboldCPP names the directory when settings know it", () => {
		expect(landingNote(dest("koboldcpp"), "/models")).toBe(
			"Files land in /models"
		)
		expect(landingNote(dest("koboldcpp"), "  ")).toBe(
			"Files land in the KoboldCPP models folder"
		)
		expect(landingNote(dest("koboldcpp"), null)).toBe(
			"Files land in the KoboldCPP models folder"
		)
	})
	test("the other two are one sentence each", () => {
		expect(landingNote(dest("ollama"))).toBe("Pulled into Ollama")
		expect(landingNote(dest("onnx"))).toBe("Downloaded into Serene Pub")
	})
})

describe("matchesQuery", () => {
	test("an empty query keeps everything", () => {
		expect(matchesQuery("", "anything")).toBe(true)
		expect(matchesQuery("   ", null)).toBe(true)
	})
	test("case-insensitive substring over any field", () => {
		expect(matchesQuery("mistral", "TheBloke/Mistral-7B")).toBe(true)
		expect(matchesQuery("instruct", "x", "An instruct model")).toBe(true)
		expect(matchesQuery("llama", "TheBloke/Mistral-7B")).toBe(false)
	})
})

describe("tier chip labels", () => {
	test("GGUF keeps the ladder both managers already printed", () => {
		expect(ggufTierLabel(3)).toBe("Ultra Budget")
		expect(ggufTierLabel(6)).toBe("Budget")
		expect(ggufTierLabel(10)).toBe("Mainstream")
		expect(ggufTierLabel(16)).toBe("High-End")
		expect(ggufTierLabel(24)).toBe("Enthusiast")
		expect(ggufTierLabel(null)).toBeNull()
	})
	test("ONNX is the recommended list's three words and no fourth", () => {
		expect(onnxTierLabel("fast")).toBe("Fast")
		expect(onnxTierLabel("balanced")).toBe("Balanced")
		expect(onnxTierLabel("best")).toBe("Best")
		// A row added by Hub id was never graded; it gets no chip.
		expect(onnxTierLabel(undefined)).toBeNull()
		expect(onnxTierLabel("added")).toBeNull()
	})
})

describe("headlineBytes", () => {
	test("prefers the recommended quant", () => {
		expect(
			headlineBytes([
				{ label: "Q8_0", sizeBytes: 8 * GB },
				{ label: "Q4_K_M", sizeBytes: 4 * GB },
				{ label: "Q2_K", sizeBytes: 2 * GB }
			])
		).toBe(4 * GB)
	})
	test("falls back to the smallest sized option", () => {
		expect(
			headlineBytes([
				{ label: "Q8_0", sizeBytes: 8 * GB },
				{ label: "Q5_K_M", sizeBytes: 5 * GB }
			])
		).toBe(5 * GB)
	})
	test("null when nothing quoted a size", () => {
		expect(headlineBytes([{ label: "Q4_K_M" }])).toBeNull()
		expect(headlineBytes([])).toBeNull()
	})
})

describe("kcppRecommendedRows", () => {
	const models = [
		{
			name: "TheBloke/Mistral-7B-GGUF",
			description: "A small instruct model",
			ollamaName: "mistral",
			recommendedVram: 6,
			parameterSize: "7B",
			pullOptions: [
				{
					label: "Q4_K_M",
					filename: "mistral-q4.gguf",
					downloadUrl: "https://hf/mistral-q4.gguf",
					sizeBytes: 4 * GB
				}
			]
		},
		{
			name: "TheBloke/Goliath-120B-GGUF",
			description: "Enormous",
			ollamaName: "goliath",
			recommendedVram: 48,
			parameterSize: "120B",
			pullOptions: [
				{
					label: "Q4_K_M",
					filename: "goliath-q4.gguf",
					downloadUrl: "https://hf/goliath-q4.gguf",
					sizeBytes: 70 * GB
				}
			]
		}
	]

	test("the list's own size stands in when the Hub quoted none", () => {
		const [row] = kcppRecommendedRows(
			[
				{
					...models[0],
					sizeBytes: 2.74 * GB,
					pullOptions: [
						{
							label: "Q4_K_M",
							filename: "mistral-q4.gguf",
							downloadUrl: "https://hf/mistral-q4.gguf"
						}
					]
				}
			],
			ctx()
		)
		expect(row.bytes).toBe(2.74 * GB)
		expect(row.fit).toBe("fits")
		// The owner leads the line now; the title carries the repo.
		expect(secondLine(row)).toMatch(/^TheBloke · 2\.7 GB · 7B/)
	})

	test("the row is a name, a size, its params and one line", () => {
		const [row] = kcppRecommendedRows(models, ctx())
		expect(row.name).toBe("TheBloke/Mistral-7B-GGUF")
		// The facts line stops at the shape. The description is its own line
		// on the card, so joining it here only got it truncated away.
		expect(secondLine(row)).toBe("TheBloke · 4.0 GB · 7B")
		expect(row.description).toBe("A small instruct model")
		expect(row.tier).toEqual({ label: "Budget", matches: true })
		expect(row.fit).toBe("fits")
		expect(row.presence).toBeNull()
	})

	test("a model past the tier keeps its chip but loses the gold", () => {
		const row = kcppRecommendedRows(models, ctx())[1]
		expect(row.tier).toEqual({ label: "Enthusiast", matches: false })
		expect(row.fit).toBe("too_big")
	})

	test("a file already on disk says so instead of offering Get", () => {
		const [row] = kcppRecommendedRows(
			models,
			ctx({ present: new Set(["mistral-q4.gguf"]) })
		)
		expect(row.presence).toBe("on_disk")
	})

	test("the query narrows on name and description", () => {
		expect(
			kcppRecommendedRows(models, ctx({ query: "goliath" }))
		).toHaveLength(1)
		expect(
			kcppRecommendedRows(models, ctx({ query: "enormous" }))
		).toHaveLength(1)
		expect(kcppRecommendedRows(models, ctx({ query: "zzz" }))).toHaveLength(
			0
		)
	})

	test("Not sure leaves every row unjudged", () => {
		const rows = kcppRecommendedRows(models, ctx({ tier: "unsure" }))
		expect(rows.every((r) => r.fit === "unknown")).toBe(true)
		expect(rows.every((r) => r.tier?.matches === false)).toBe(true)
	})
})

describe("ollamaRecommendedRows", () => {
	const models = [
		{
			name: "llama3.1:8b",
			pull: "llama3.1:8b",
			size: 4.7,
			recommended_vram: 8,
			details: { parameter_size: "8B", description: "Meta's 8B" }
		}
	]
	test("the YAML's GB become decimal bytes", () => {
		const [row] = ollamaRecommendedRows(models, ctx())
		expect(row.bytes).toBeCloseTo(4.7 * GB)
		expect(secondLine(row)).toBe("4.7 GB · 8B")
		expect(row.description).toBe("Meta's 8B")
		expect(row.tier).toEqual({ label: "Mainstream", matches: true })
	})
	test("a pulled model is marked pulled", () => {
		const [row] = ollamaRecommendedRows(
			models,
			ctx({ present: new Set(["llama3.1:8b"]) })
		)
		expect(row.presence).toBe("pulled")
	})
})

describe("onnxRecommendedRows", () => {
	const models = [
		{
			id: 11,
			name: "bge-small-en-v1.5",
			local: {
				state: "not_downloaded" as const,
				sizeBytes: null,
				loaded: false,
				addedByUser: false,
				catalog: {
					tier: "fast" as const,
					sizeMb: 33,
					dimensions: 384,
					description: "Small English embeddings"
				}
			}
		},
		{
			id: 12,
			name: "gliner-small",
			local: {
				state: "downloading" as const,
				sizeBytes: null,
				percent: 42,
				loaded: false,
				addedByUser: false,
				catalog: {
					tier: "balanced" as const,
					sizeMb: 180,
					labels: ["PER", "LOC"]
				}
			}
		}
	]

	test("an embeddings row quotes its dimensions", () => {
		const [row] = onnxRecommendedRows([models[0]], ctx(), "embeddings")
		expect(secondLine(row)).toBe("33 MB · 384 dims")
		expect(row.description).toBe("Small English embeddings")
		expect(row.tier).toEqual({ label: "Fast", matches: true })
	})

	test("an entities row quotes its label count, and a live one its bar", () => {
		const [row] = onnxRecommendedRows([models[1]], ctx(), "entities")
		expect(secondLine(row)).toBe("180 MB · 2 labels")
		expect(row.downloading).toBe(true)
		expect(row.percent).toBe(42)
	})

	// Plan 2026-09-24 C2: the finder lists downloads; a model already on disk
	// is counted beside the list, not mixed into it.
	test("on disk is left out of the download list", () => {
		const rows = onnxRecommendedRows(
			[
				{
					...models[0],
					local: {
						...models[0].local,
						state: "on_disk" as const,
						sizeBytes: 34_000_000
					}
				}
			],
			ctx(),
			"embeddings"
		)
		expect(rows).toEqual([])
	})
})

describe("primaryRowIndex — one gold button, on the first row that fits", () => {
	const row = (over: Partial<FinderRow>): FinderRow => ({
		key: "k",
		name: "n",
		sizeLabel: null,
		facts: null,
		description: null,
		tags: [],
		tier: null,
		bytes: null,
		fit: "unknown",
		presence: null,
		percent: null,
		downloading: false,
		...over
	})
	test("skips what is too big and what is already here", () => {
		expect(
			primaryRowIndex([
				row({ fit: "too_big" }),
				row({ fit: "fits", presence: "on_disk" }),
				row({ fit: "fits" }),
				row({ fit: "fits" })
			])
		).toBe(2)
	})
	test("Not sure golds nothing", () => {
		expect(primaryRowIndex([row({}), row({})])).toBe(-1)
	})
})

describe("the Hugging Face group", () => {
	test("ranks by downloads, keeping the Hub's order on a tie", () => {
		const ranked = rankHub([
			{ name: "a", downloads: 10 },
			{ name: "b", downloads: 500 },
			{ name: "c" },
			{ name: "d", downloads: 500 }
		])
		expect(ranked.map((m) => m.name)).toEqual(["b", "d", "a", "c"])
	})

	test("formatCount is compact", () => {
		expect(formatCount(1_240_000)).toBe("1.2M")
		expect(formatCount(12_400)).toBe("12k")
		expect(formatCount(431)).toBe("431")
		expect(formatCount(null)).toBeNull()
	})

	test("licences come off the Hub's own tag and nowhere else", () => {
		expect(licenseFromTags(["gguf", "license:apache-2.0"])).toBe(
			"apache-2.0"
		)
		expect(licenseFromTags(["gguf"])).toBeNull()
		expect(licenseFromTags(undefined)).toBeNull()
	})

	test("hubDetail drops absent clauses rather than printing unknown", () => {
		expect(
			hubDetail({
				parameterSize: "7B",
				fileCount: 12,
				downloads: 1_240_000,
				license: "apache-2.0"
			})
		).toBe("7B · 12 sizes · 1.2M downloads · apache-2.0")
		expect(hubDetail({ fileCount: 1 })).toBe("1 size")
		expect(hubDetail({})).toBe("")
	})

	test("the KoboldCPP search has no tags, so it quotes no licence", () => {
		const [row] = kcppHubRows([
			{
				name: "TheBloke/Mistral-7B-GGUF",
				downloads: 1_200,
				pullOptions: [
					{ label: "Q4_K_M", filename: "f", downloadUrl: "u" },
					{ label: "Q8_0", filename: "g", downloadUrl: "v" }
				]
			}
		])
		expect(row.detail).toBe("2 sizes · 1k downloads")
		expect(row.fileCount).toBe(2)
	})

	test("the Ollama search does carry one", () => {
		const [row] = ollamaHubRows([
			{
				name: "bartowski/Qwen",
				downloads: 900,
				tags: ["gguf", "license:mit"],
				pullOptions: [
					{ label: "Q4_K_M", pull: "hf.co/bartowski/Qwen:Q4_K_M" }
				]
			}
		])
		expect(row.detail).toBe("1 size · 900 downloads · mit")
	})
})

describe("quant normalisation — two lists, one shape", () => {
	const kcpp = {
		name: "TheBloke/Mistral-7B-GGUF",
		pullOptions: [
			{
				label: "Q4_K_M",
				filename: "mistral-q4.gguf",
				downloadUrl: "https://hf/q4",
				sizeBytes: 4 * GB
			},
			{
				label: "Q2_K",
				filename: "mistral-q2.gguf",
				downloadUrl: "https://hf/q2",
				sizeBytes: 2 * GB
			}
		]
	}

	test("KoboldCPP keeps the url and the filename the download needs", () => {
		const quants = quantsFromKcpp(kcpp, "text")
		expect(quants[0]).toEqual({
			name: "Q4_K_M",
			bytes: 4 * GB,
			url: "https://hf/q4",
			filename: "mistral-q4.gguf",
			recommended: true
		})
		expect(quants[1].recommended).toBe(false)
	})

	test("an image row's labels are checkpoints, so none is Recommended", () => {
		expect(quantsFromKcpp(kcpp, "image").every((q) => !q.recommended)).toBe(
			true
		)
	})

	test("Ollama keeps the tag and quotes no bytes", () => {
		const quants = quantsFromOllama({
			name: "bartowski/Qwen",
			pullOptions: [
				{ label: "Q4_K_M", pull: "hf.co/bartowski/Qwen:Q4_K_M" },
				{ label: "Q8_0" }
			]
		})
		// The option with no tag cannot be pulled, so it is not offered.
		expect(quants).toHaveLength(1)
		expect(quants[0]).toEqual({
			name: "Q4_K_M",
			tag: "hf.co/bartowski/Qwen:Q4_K_M",
			recommended: true
		})
	})

	test("quant labels are read, not guessed", () => {
		expect(isRecommendedQuantLabel("Q4_K_M")).toBe(true)
		expect(isRecommendedQuantLabel("Q5_K_M")).toBe(false)
		expect(isLowQualityQuant("Q2_K")).toBe(true)
		expect(isLowQualityQuant("IQ3_XS")).toBe(true)
		expect(isLowQualityQuant("Q4_K_M")).toBe(false)
	})
})

describe("quantFit — what this file costs on this machine", () => {
	test("the three sizes", () => {
		expect(
			quantFit(
				{ name: "Q4_K_M", bytes: 4 * GB, recommended: true },
				"8gb"
			)
		).toEqual({ tone: "good", sentence: "Fits in 8 GB" })
		expect(
			quantFit(
				{ name: "Q6_K", bytes: 7.5 * GB, recommended: false },
				"8gb"
			)
		).toEqual({ tone: "warn", sentence: "Tight in 8 GB" })
		expect(
			quantFit(
				{ name: "Q8_0", bytes: 12 * GB, recommended: false },
				"8gb"
			)
		).toEqual({ tone: "bad", sentence: "Too big for 8 GB" })
	})
	test("a small file bought with quality says so instead", () => {
		expect(
			quantFit({ name: "Q2_K", bytes: 2 * GB, recommended: false }, "8gb")
		).toEqual({ tone: "muted", sentence: "Fits · lower quality" })
	})
	test("no budget and no bytes both say nothing", () => {
		expect(
			quantFit(
				{ name: "Q4_K_M", bytes: 4 * GB, recommended: true },
				"unsure"
			)
		).toBeNull()
		expect(
			quantFit({ name: "Q4_K_M", recommended: true }, "8gb")
		).toBeNull()
	})
})

describe("SerialAsk — replies that carry no echo of the ask", () => {
	test("a second ask waits for the first reply, and that reply is stale", () => {
		const sent: string[] = []
		const asks = new SerialAsk()
		asks.ask(() => sent.push("cat"))
		asks.ask(() => sent.push("cata"))
		asks.ask(() => sent.push("catal"))
		expect(sent).toEqual(["cat"])
		expect(asks.pending).toBe(true)
		// The reply to "cat" lands: it is stale, and only the latest held
		// ask goes out — "cata" was never sent.
		expect(asks.settle()).toBe(true)
		expect(sent).toEqual(["cat", "catal"])
		// The reply to "catal" is the one to show.
		expect(asks.settle()).toBe(false)
		expect(asks.pending).toBe(false)
	})
	test("a lone ask settles clean", () => {
		const asks = new SerialAsk()
		asks.ask(() => {})
		expect(asks.settle()).toBe(false)
		expect(asks.pending).toBe(false)
	})
	test("reset drops the held ask", () => {
		const sent: string[] = []
		const asks = new SerialAsk()
		asks.ask(() => sent.push("a"))
		asks.ask(() => sent.push("b"))
		asks.reset()
		expect(asks.settle()).toBe(false)
		expect(sent).toEqual(["a"])
	})
})

describe("repoTitle / repoOwner — the owner is information, not a prefix", () => {
	test("splits owner from repo so the title is what differs", () => {
		expect(repoTitle("unsloth/Qwen3.5-4B-GGUF")).toBe("Qwen3.5-4B-GGUF")
		expect(repoOwner("unsloth/Qwen3.5-4B-GGUF")).toBe("unsloth")
	})

	test("keeps the size and format, so four sizes stay four rows", () => {
		// The one reason this is not `nameFromIdentifier`: the finder lists
		// several sizes of one model at once.
		expect(repoTitle("unsloth/Qwen3.5-4B-GGUF")).not.toBe(
			repoTitle("unsloth/Qwen3.5-9B-GGUF")
		)
	})

	test("a bare Ollama tag has no owner and keeps its whole name", () => {
		expect(repoTitle("llama3.1:8b")).toBe("llama3.1:8b")
		expect(repoOwner("llama3.1:8b")).toBe("")
	})

	test("survives an empty or odd id rather than rendering blank", () => {
		expect(repoTitle("")).toBe("")
		expect(repoTitle("/trailing")).toBe("trailing")
		expect(repoOwner("/trailing")).toBe("")
	})

	test("secondLine leads with the owner", () => {
		expect(
			secondLine({
				name: "bartowski/MN-12B-Lyra-v4-GGUF",
				sizeLabel: "7.1 GB",
				facts: "12B"
			} as any)
		).toBe("bartowski · 7.1 GB · 12B")
	})

	test("secondLine never carries the description", () => {
		// Regression: four clauses in one truncate line meant the sentence
		// was quoted and never seen. It has its own line now.
		expect(
			secondLine({
				name: "x/y",
				sizeLabel: "1 GB",
				facts: "7B",
				description: "A sentence long enough to be cut off"
			} as any)
		).toBe("x · 1 GB · 7B")
	})
})

describe("tags a person should actually see", () => {
	test("machine metadata is dropped, human tags are kept in order", () => {
		expect(
			displayTags([
				"license:apache-2.0",
				"text-generation",
				"region:us",
				"conversational",
				"arxiv:2401.04088",
				"base_model:mistralai/Mistral-7B",
				"en"
			])
		).toEqual(["text-generation", "conversational", "en"])
	})

	test("duplicates collapse, case-insensitively", () => {
		expect(displayTags(["English", "english", "EN", "en"])).toEqual([
			"English",
			"EN"
		])
	})

	test("nothing, empty and blanks are all no tags", () => {
		expect(displayTags(undefined)).toEqual([])
		expect(displayTags(null)).toEqual([])
		expect(displayTags(["", "   "])).toEqual([])
	})

	test("an ollama hub row carries its description and its human tags", () => {
		const [row] = ollamaHubRows([
			{
				name: "org/model",
				description: "A small instruct model",
				tags: ["license:mit", "text-generation", "en"],
				downloads: 1_200_000,
				pullOptions: [{ label: "Q4_K_M", pull: "x:q4" }]
			}
		])
		expect(row.description).toBe("A small instruct model")
		expect(row.tags).toEqual(["text-generation", "en"])
		// The licence is not lost — it belongs in the facts line.
		expect(row.detail).toContain("mit")
	})

	test("a kcpp hub row carries its description and no tags at all", () => {
		const [row] = kcppHubRows([
			{
				name: "TheBloke/Mistral-7B-GGUF",
				description: "A small instruct model",
				downloads: 431,
				pullOptions: [{ label: "Q4_K_M", filename: "a.gguf" }]
			} as any
		])
		expect(row.description).toBe("A small instruct model")
		expect(row.tags).toEqual([])
	})
})

describe("tags from the recommended list reach the card", () => {
	test("an Ollama row carries the list's human tags", () => {
		const [row] = ollamaRecommendedRows(
			[
				{
					name: "unsloth/Qwen3.5-4B-GGUF",
					pull: "hf.co/unsloth/Qwen3.5-4B-GGUF:Q4_K_M",
					size: 2.74,
					tags: ["roleplay", "vision", "long-context"]
				}
			],
			{
				query: "",
				tier: "mid",
				present: new Set(),
				pulled: new Set()
			} as any
		)
		expect(row.tags).toEqual(["roleplay", "vision", "long-context"])
	})

	test("the `embedding` tag is dropped from the chips — the scope already says it", () => {
		const [row] = ollamaRecommendedRows(
			[
				{
					name: "nomic-embed-text",
					pull: "nomic-embed-text",
					tags: ["embedding", "english"]
				}
			],
			{
				query: "",
				tier: "mid",
				present: new Set(),
				pulled: new Set()
			} as any
		)
		expect(row.tags).toEqual(["english"])
	})

	test("a KoboldCPP row carries its tags too", () => {
		const [row] = kcppRecommendedRows(
			[
				{
					name: "bartowski/L3-8B-Stheno-v3.2-GGUF",
					ollamaName: "x",
					pullOptions: [],
					tags: ["roleplay", "uncensored"]
				} as any
			],
			{
				query: "",
				tier: "mid",
				present: new Set(),
				pulled: new Set()
			} as any
		)
		expect(row.tags).toEqual(["roleplay", "uncensored"])
	})
})

// ── Plan 2026-10-29: audio scopes, the picker rule, presence ────────────────

import {
	audioFamilyRows,
	audioLiveMatch,
	audioRuntimeFor,
	defaultQuant,
	kcppDownloadKind,
	kcppSpeechDownloads,
	presenceBatches,
	presenceFor,
	presenceNote,
	presenceQueryFor,
	presenceSignature,
	preselectedQuantIndex,
	quantChoice,
	quantLine,
	quantsForAddById,
	quantsFromFamily,
	quantsFromOllamaRecommended,
	quantsFromOnnx,
	type QuantFile
} from "./finder"

const q = (name: string, extra: Partial<QuantFile> = {}): QuantFile => ({
	name,
	recommended: false,
	...extra
})

describe("the Speech and Transcription scopes", () => {
	test("labels, capabilities and phrases are exact", () => {
		const speech = FINDER_SCOPES.find((s) => s.value === "speech")!
		const asr = FINDER_SCOPES.find((s) => s.value === "transcription")!
		expect([speech.label, speech.capability, speech.phrase]).toEqual([
			"Speech",
			"text->audio",
			"a speech model"
		])
		expect([asr.label, asr.capability, asr.phrase]).toEqual([
			"Transcription",
			"audio->text",
			"a transcription model"
		])
		expect(scopeForCapability("audio->text")).toBe("transcription")
	})

	test("Speech lists audio.cpp then KoboldCPP; Transcription only audio.cpp", () => {
		const rows = [
			{
				id: 1,
				name: "KoboldCPP",
				type: CONNECTION_TYPE.KOBOLDCPP_MANAGED
			},
			{ id: 2, name: "audio.cpp", type: CONNECTION_TYPE.AUDIOCPP_MANAGED }
		]
		expect(
			destinationsFor("speech", rows).map((d) => [d.kind, d.connectionId])
		).toEqual([
			["audiocpp", 2],
			["koboldcpp", 1]
		])
		expect(
			destinationsFor("transcription", rows).map((d) => d.kind)
		).toEqual(["audiocpp"])
		// No audio.cpp row, no audiocpp pill.
		expect(destinationsFor("transcription", rows.slice(0, 1))).toEqual([])
	})

	test("a KoboldCPP speech download declares kind speech", () => {
		expect(kcppDownloadKind("speech")).toBe("speech")
		expect(kcppDownloadKind("images")).toBe("image")
		expect(kcppDownloadKind("chat")).toBe("text")
		expect(kcppKindForScope("speech")).toBeNull()
	})

	test("the old transform id still has no scope", () => {
		expect(scopeForCapability("text->speech")).toBeNull()
	})

	test("audio runtimes follow destination and scope", () => {
		expect(audioRuntimeFor({ kind: "audiocpp" }, "speech")).toBe("audiocpp")
		expect(audioRuntimeFor({ kind: "koboldcpp" }, "speech")).toBe(
			"koboldcpp"
		)
		expect(
			audioRuntimeFor({ kind: "koboldcpp" }, "transcription")
		).toBeNull()
		expect(audioRuntimeFor({ kind: "koboldcpp" }, "chat")).toBeNull()
	})
})

describe("the picker rule", () => {
	test("quantChoice", () => {
		expect(quantChoice([])).toBe("none")
		expect(quantChoice([q("a")])).toBe("single")
		expect(quantChoice([q("a"), q("b")])).toBe("picker")
	})

	test("preselectedQuantIndex: recommended, else largest that fits, else first", () => {
		expect(preselectedQuantIndex([], "8gb")).toBe(-1)
		expect(
			preselectedQuantIndex(
				[q("a"), q("b", { recommended: true })],
				"8gb"
			)
		).toBe(1)
		const sized = [
			q("Q2", { bytes: 1 * GB }),
			q("Q4", { bytes: 4 * GB }),
			q("Q8", { bytes: 40 * GB })
		]
		expect(preselectedQuantIndex(sized, "8gb")).toBe(1)
		expect(preselectedQuantIndex([q("a"), q("b")], "unsure")).toBe(0)
	})

	test("quantLine: a single file names itself, none shows the note", () => {
		expect(
			quantLine({ quants: [q("Q4_K_M", { filename: "m-Q4_K_M.gguf" })] })
		).toBe("m-Q4_K_M.gguf")
		expect(quantLine({ quants: [q("q8")] })).toBe("q8")
		expect(quantLine({ quants: [], quantsNote: "Library name" })).toBe(
			"Library name"
		)
		expect(quantLine({ quants: [q("a"), q("b")] })).toBeNull()
	})

	test("defaultQuant is what the picker opens on", () => {
		expect(defaultQuant([])).toBeNull()
		expect(
			defaultQuant([q("a"), q("b", { recommended: true })])?.name
		).toBe("b")
	})

	test("KoboldCPP rows carry their files for the rule", () => {
		const rec = {
			name: "org/m",
			description: "",
			parameterSize: "7B",
			recommendedVram: 8,
			tags: [],
			pullOptions: [
				{
					label: "Q4_K_M",
					filename: "a.gguf",
					downloadUrl: "u",
					sizeBytes: GB
				},
				{
					label: "Q8_0",
					filename: "b.gguf",
					downloadUrl: "u2",
					sizeBytes: 2 * GB
				}
			]
		} as any
		const [row] = kcppRecommendedRows([rec], ctx())
		expect(quantChoice(row.quants!)).toBe("picker")
		expect(preselectedQuantIndex(row.quants!, "8gb")).toBe(0)
		const [one] = kcppRecommendedRows(
			[{ ...rec, pullOptions: [rec.pullOptions[0]] }],
			ctx()
		)
		expect(quantLine(one)).toBe("a.gguf")
		expect(row.presenceQuery).toMatchObject({
			key: "kcpp:org/m",
			repo: "org/m",
			file: "a.gguf"
		})
	})
})

describe("Ollama recommended quants", () => {
	const model = {
		name: "Gemma",
		pull: "hf.co/org/gemma-GGUF:Q4_K_M",
		quants: [
			{
				label: "Q4_K_M",
				tag: "hf.co/org/gemma-GGUF:Q4_K_M",
				sizeBytes: 3 * GB,
				recommended: true
			},
			{
				label: "Q8_0",
				tag: "hf.co/org/gemma-GGUF:Q8_0",
				sizeBytes: 6 * GB,
				recommended: false
			}
		]
	}
	test("maps tags and the recommended flag", () => {
		const out = quantsFromOllamaRecommended(model)
		expect(out.map((x) => [x.name, x.tag, x.recommended])).toEqual([
			["Q4_K_M", "hf.co/org/gemma-GGUF:Q4_K_M", true],
			["Q8_0", "hf.co/org/gemma-GGUF:Q8_0", false]
		])
		expect(out[0].bytes).toBe(3 * GB)
	})
	test("a library name has none and the row carries the note", () => {
		const [row] = ollamaRecommendedRows(
			[
				{
					name: "Llama",
					pull: "llama3.2",
					quants: [],
					quantsNote: "No quants listed"
				}
			],
			ctx()
		)
		expect(quantChoice(row.quants!)).toBe("none")
		expect(quantLine(row)).toBe("No quants listed")
		expect(row.presenceQuery).toEqual({
			key: "ollama:llama3.2",
			tag: "llama3.2"
		})
	})
	test("a listed row asks presence by the pre-selected tag", () => {
		const [row] = ollamaRecommendedRows([model as any], ctx())
		expect(row.presenceQuery).toEqual({
			key: `ollama:${model.pull}`,
			tag: "hf.co/org/gemma-GGUF:Q4_K_M"
		})
	})
})

describe("ONNX precisions", () => {
	test("a list that publishes dtypes offers them all, default pre-selected", () => {
		const out = quantsFromOnnx({ dtype: "q8", dtypes: ["q4", "fp32"] })
		expect(out.map((x) => x.dtype)).toEqual(["fp32", "q8", "q4"])
		expect(out.find((x) => x.recommended)?.dtype).toBe("q8")
	})
	test("one dtype is a single; none is none", () => {
		expect(quantChoice(quantsFromOnnx({ dtype: "q8" }))).toBe("single")
		expect(quantChoice(quantsFromOnnx({}))).toBe("none")
		expect(quantsFromOnnx(undefined)).toEqual([])
	})
	test("rows carry them and ask presence by model + dtype", () => {
		const [row] = onnxRecommendedRows(
			[
				{
					id: 4,
					name: "org/bge",
					local: {
						state: "not_downloaded",
						catalog: { dtype: "q8", dtypes: ["fp32"] }
					} as any
				}
			],
			ctx(),
			"embeddings"
		)
		expect(row.quants?.map((x) => x.dtype)).toEqual(["fp32", "q8"])
		expect(row.presenceQuery).toEqual({
			key: "onnx:4",
			repo: "org/bge",
			dtype: "q8"
		})
	})
	test("add-by-id offers every dtype with the default pre-selected", () => {
		const out = quantsForAddById(["fp32", "fp16", "q8", "q4"], "fp32")
		expect(out.map((x) => x.recommended)).toEqual([
			true,
			false,
			false,
			false
		])
	})
})

describe("audio family rows", () => {
	const pkg = (
		id: string,
		precision: string,
		state = "available",
		extra = {}
	) => ({
		id,
		name: `Qwen ${precision}`,
		task: "tts",
		family: "qwen3_tts",
		files: [],
		tags: [],
		confidence: "listed",
		state,
		recommended: false,
		precision,
		sizeBytes: 2 * GB,
		...extra
	})
	const family = (over: any = {}) => ({
		key: "audiocpp:qwen3_tts:",
		family: "qwen3_tts",
		variant: null,
		task: "tts",
		runtime: "audiocpp",
		displayName: "Qwen3-TTS",
		recommendedId: "p-q8",
		precisions: [pkg("p-q8", "q8_0"), pkg("p-bf16", "bf16")],
		...over
	})
	test("one row per family, picker over precisions, recommendedId pre-selected", () => {
		const [row] = audioFamilyRows([family()] as any, ctx(), {
			scope: "speech",
			runtime: "audiocpp"
		})
		expect(row.name).toBe("Qwen3-TTS")
		expect(quantChoice(row.quants!)).toBe("picker")
		expect(preselectedQuantIndex(row.quants!, "8gb")).toBe(0)
		expect(row.quants!.map((x) => x.packageId)).toEqual(["p-q8", "p-bf16"])
		expect(row.presenceQuery).toMatchObject({
			key: row.key,
			packageId: "p-q8"
		})
	})
	test("the recommendedId need not be first", () => {
		const [row] = audioFamilyRows(
			[family({ recommendedId: "p-bf16" })] as any,
			ctx(),
			{ scope: "speech", runtime: "audiocpp" }
		)
		expect(preselectedQuantIndex(row.quants!, "8gb")).toBe(1)
	})
	test("task and runtime filter; vdes is Speech, asr is Transcription", () => {
		const fams = [
			family(),
			family({
				key: "audiocpp:parakeet:",
				task: "asr",
				displayName: "Parakeet"
			}),
			family({
				key: "audiocpp:vd:",
				task: "vdes",
				displayName: "Voice design"
			}),
			family({
				key: "koboldcpp:kokoro:",
				runtime: "koboldcpp",
				displayName: "Kokoro"
			})
		] as any
		const names = (scope: any, runtime: any) =>
			audioFamilyRows(fams, ctx(), { scope, runtime }).map((r) => r.name)
		expect(names("speech", "audiocpp")).toEqual([
			"Qwen3-TTS",
			"Voice design"
		])
		expect(names("transcription", "audiocpp")).toEqual(["Parakeet"])
		expect(names("speech", "koboldcpp")).toEqual(["Kokoro"])
	})
	test("a single precision is a single; presence needs every precision held", () => {
		const [one] = audioFamilyRows(
			[family({ precisions: [pkg("p-q8", "q8_0")] })] as any,
			ctx(),
			{ scope: "speech", runtime: "audiocpp" }
		)
		expect(quantLine(one)).toBe("q8_0")
		const [half] = audioFamilyRows(
			[
				family({
					precisions: [
						pkg("p-q8", "q8_0", "downloaded"),
						pkg("p-bf16", "bf16")
					]
				})
			] as any,
			ctx(),
			{ scope: "speech", runtime: "audiocpp" }
		)
		expect(half.presence).toBeNull()
		expect(half.facts).toContain("q8_0 on disk")
		const [all] = audioFamilyRows(
			[family({ precisions: [pkg("p-q8", "q8_0", "enabled")] })] as any,
			ctx(),
			{ scope: "speech", runtime: "audiocpp" }
		)
		expect(all.presence).toBe("on_disk")
	})
	test("KoboldCPP files go one call each, model first", () => {
		const fam = family({
			runtime: "koboldcpp",
			precisions: [
				pkg("k", "q8_0", "available", {
					koboldCppFiles: [
						{
							filename: "model.gguf",
							downloadUrl: "u1",
							sizeBytes: 5
						},
						{ filename: "codec.gguf", downloadUrl: "u2" }
					]
				})
			],
			recommendedId: "k"
		}) as any
		const [quant] = quantsFromFamily(fam)
		const calls = kcppSpeechDownloads("Kokoro", quant)
		expect(calls.map((c) => [c.filename, c.kind, c.modelName])).toEqual([
			["model.gguf", "speech", "Kokoro"],
			["codec.gguf", "speech", "Kokoro"]
		])
	})
	test("live downloads match by package id or family name", () => {
		const row = {
			name: "Qwen3-TTS",
			quants: [q("q8_0", { packageId: "p-q8" })]
		}
		const items = [
			{
				id: "audiocpp:p-q8",
				source: "audiocpp",
				name: "x",
				state: "in_flight"
			},
			{
				id: "koboldcpp:m.gguf",
				source: "koboldcpp",
				name: "Qwen3-TTS",
				state: "in_flight"
			}
		]
		expect(audioLiveMatch(row, "audiocpp", items)?.id).toBe("audiocpp:p-q8")
		expect(audioLiveMatch(row, "koboldcpp", items)?.id).toBe(
			"koboldcpp:m.gguf"
		)
		expect(audioLiveMatch(row, "audiocpp", [])).toBeNull()
	})
})

describe("presence", () => {
	const ollama = {
		kind: "ollama",
		connectionId: 5,
		serviceLabel: "Ollama"
	} as const
	const kcpp = {
		kind: "koboldcpp",
		connectionId: 1,
		serviceLabel: "KoboldCPP"
	} as const
	const holder = (
		runtime: any,
		connectionId: number | null = null,
		where: string | null = null
	) => ({
		runtime,
		connectionId,
		where,
		match: "m"
	})
	test("nobody holds it", () => {
		const s = presenceNote([], kcpp)
		expect(s).toMatchObject({ here: false, text: null, getLabel: "Get" })
	})
	test("the destination's own runtime holds it", () => {
		const s = presenceNote([holder("koboldcpp", 1, "text")], kcpp)
		expect(s.here).toBe(true)
		expect(s.text).toBe("You have this on KoboldCPP")
		expect(s.getLabel).toBe("Get")
		expect(presenceFor("koboldcpp")).toBe("on_disk")
		expect(presenceFor("ollama")).toBe("pulled")
	})
	test("another runtime holds it: Also on, and Get for … too", () => {
		const s = presenceNote(
			[holder("koboldcpp", 1), holder("onnx", 9)],
			ollama
		)
		expect(s.here).toBe(false)
		expect(s.text).toBe("Also on KoboldCPP, ONNX")
		expect(s.getLabel).toBe("Get for Ollama too")
	})
	test("an Ollama copy on another host is not this host", () => {
		const s = presenceNote([holder("ollama", 6, "Den")], ollama)
		expect(s.here).toBe(false)
		expect(s.text).toBe("Also on Ollama (Den)")
		expect(presenceNote([holder("ollama", 5, "Home")], ollama).here).toBe(
			true
		)
	})
	test("here and elsewhere together", () => {
		const s = presenceNote(
			[holder("koboldcpp", 1), holder("ollama", 5)],
			kcpp
		)
		expect(s.text).toBe("You have this on KoboldCPP · Also on Ollama")
		expect(s.getLabel).toBe("Get")
	})
	test("queries are signature-stable and batched at 200", () => {
		const a = { key: "a", repo: "r" }
		const b = { key: "b", tag: "t" }
		expect(presenceSignature([a, b])).toBe(presenceSignature([b, a]))
		expect(presenceSignature([a])).not.toBe(presenceSignature([a, b]))
		const many = Array.from({ length: 450 }, (_, i) => ({ key: String(i) }))
		expect(presenceBatches(many).map((x) => x.length)).toEqual([
			200, 200, 50
		])
	})
	test("presenceQueryFor speaks each runtime's words", () => {
		expect(
			presenceQueryFor("k", "org/r", [
				q("Q4", { filename: "f.gguf", bytes: 9, recommended: true })
			])
		).toEqual({ key: "k", repo: "org/r", file: "f.gguf", bytes: 9 })
		expect(
			presenceQueryFor("o", "org/r", [q("Q4", { tag: "hf.co/org/r:Q4" })])
		).toEqual({
			key: "o",
			tag: "hf.co/org/r:Q4"
		})
		expect(presenceQueryFor("e", undefined, [])).toEqual({ key: "e" })
	})
})
