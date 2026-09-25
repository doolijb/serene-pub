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
			"Ollama embed · Ollama"
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
		expect(secondLine(row)).toBe(
			"TheBloke · 4.0 GB · 7B · A small instruct model"
		)
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
		expect(secondLine(row)).toBe("4.7 GB · 8B · Meta's 8B")
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
		expect(secondLine(row)).toBe(
			"33 MB · 384 dims · Small English embeddings"
		)
		expect(row.tier).toEqual({ label: "Fast", matches: true })
	})

	test("an entities row quotes its label count, and a live one its bar", () => {
		const [row] = onnxRecommendedRows([models[1]], ctx(), "entities")
		expect(secondLine(row)).toBe("180 MB · 2 labels")
		expect(row.downloading).toBe(true)
		expect(row.percent).toBe(42)
	})

	test("on disk reads as on disk", () => {
		const [row] = onnxRecommendedRows(
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
		expect(row.presence).toBe("on_disk")
		expect(row.sizeLabel).toBe("34 MB")
	})
})

describe("primaryRowIndex — one gold button, on the first row that fits", () => {
	const row = (over: Partial<FinderRow>): FinderRow => ({
		key: "k",
		name: "n",
		sizeLabel: null,
		facts: null,
		description: null,
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
})
