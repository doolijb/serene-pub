/**
 * 🚧 Step 0 of the prompt-offer rule, pinned (owner note 37, 2026-10-02; owner
 * D59, 2026-11-16; owner P1, 2026-11-17: a prompt that records no pipeline is
 * offered only to an administrator, or where it is the call's default or in
 * force — rule 3 of `promptsOffered`): for every shipped genre and preset, every model call that
 * has a prompts slot, what its owner is offered in the Pipelines panel. One
 * row per call. The stops: no card past 8 rows; no call offering another
 * call's shipped default in its own pipeline.
 */
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest"
import fs from "fs/promises"
import os from "os"
import path from "path"
import * as schema from "$lib/server/db/schema"
import type { TestDb } from "$lib/server/utils/testDb"

vi.setConfig({ testTimeout: 60_000, hookTimeout: 180_000 })

vi.mock("$lib/server/db", async () => {
	const { createTestDb } = await import("$lib/server/utils/testDb")
	const db = await createTestDb()
	return { db, dbReady: Promise.resolve() }
})

const SECRET = "prompts-offered-secret"

let testDb: TestDb
let dataDir: string

beforeAll(async () => {
	dataDir = await fs.mkdtemp(
		path.join(os.tmpdir(), "serene-pub-prompts-offered-int-test-")
	)
	process.env.SERENE_PUB_DATA_DIR = dataDir
	testDb = (await import("$lib/server/db")).db as unknown as TestDb
	const { bootstrapPipelines } = await import(
		"$lib/server/pipelines/boot/bootstrap"
	)
	await bootstrapPipelines(testDb as any)
})

afterAll(async () => {
	await fs.rm(dataDir, { recursive: true, force: true })
})

interface Row {
	genre: string
	preset: string
	pipeline: string
	triggers: string[]
	nodeKey: string
	call: string
	offered: string[]
	inForce: string | null
	row: boolean
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Pinned: names, never ids. Run with the table printed to re-read it (PROMPTS_TABLE in the log). */
const EXPECTED: Row[] = [
	{"genre":"core:genre/chat","preset":"core-chat-agentic","pipeline":"core:spec/assistant-answer-form","triggers":["event"],"nodeKey":"context","call":"Build template context · Prompts","offered":["Answer a question"],"inForce":"Answer a question","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-agentic","pipeline":"core:spec/assistant-memory","triggers":["routine"],"nodeKey":"memory.due.memoryContext","call":"Build template context · Prompts","offered":["Assistant: remember things"],"inForce":"Assistant: remember things","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-agentic","pipeline":"core:spec/assistant-respond","triggers":["reply"],"nodeKey":"mode.agentic.tools.item.prompt","call":"Assemble · Prompts","offered":["Assistant, with tools"],"inForce":"Assistant, with tools","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-agentic","pipeline":"core:spec/speak-message","triggers":["action"],"nodeKey":"spoken.words.speak","call":"Speak the line · Prompts","offered":["Speech direction"],"inForce":"Speech direction","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-agentic","pipeline":"core:spec/summarize-character","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default Character Summarization"],"inForce":"Default Character Summarization","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-agentic","pipeline":"core:spec/summarize-character","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default Character Summarization"],"inForce":"Default Character Summarization","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-agentic","pipeline":"core:spec/summarize-character","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default Character Summarization"],"inForce":"Default Character Summarization","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-agentic","pipeline":"core:spec/summarize-history","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-agentic","pipeline":"core:spec/summarize-history","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-agentic","pipeline":"core:spec/summarize-history","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-agentic","pipeline":"core:spec/summarize-scene","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-agentic","pipeline":"core:spec/summarize-scene","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-agentic","pipeline":"core:spec/summarize-scene","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-agentic","pipeline":"core:spec/summarize-world","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default World Summarization"],"inForce":"Default World Summarization","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-agentic","pipeline":"core:spec/summarize-world","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default World Summarization"],"inForce":"Default World Summarization","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-agentic","pipeline":"core:spec/summarize-world","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default World Summarization"],"inForce":"Default World Summarization","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-basic","pipeline":"core:spec/assistant-answer-form","triggers":["event"],"nodeKey":"context","call":"Build template context · Prompts","offered":["Answer a question"],"inForce":"Answer a question","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-basic","pipeline":"core:spec/assistant-memory","triggers":["routine"],"nodeKey":"memory.due.memoryContext","call":"Build template context · Prompts","offered":["Assistant: remember things"],"inForce":"Assistant: remember things","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-basic","pipeline":"core:spec/assistant-respond","triggers":["reply"],"nodeKey":"mode.agentic.tools.item.prompt","call":"Assemble · Prompts","offered":["Assistant, with tools"],"inForce":"Assistant, with tools","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-basic","pipeline":"core:spec/speak-message","triggers":["action"],"nodeKey":"spoken.words.speak","call":"Speak the line · Prompts","offered":["Speech direction"],"inForce":"Speech direction","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-basic","pipeline":"core:spec/summarize-character","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default Character Summarization"],"inForce":"Default Character Summarization","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-basic","pipeline":"core:spec/summarize-character","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default Character Summarization"],"inForce":"Default Character Summarization","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-basic","pipeline":"core:spec/summarize-character","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default Character Summarization"],"inForce":"Default Character Summarization","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-basic","pipeline":"core:spec/summarize-history","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-basic","pipeline":"core:spec/summarize-history","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-basic","pipeline":"core:spec/summarize-history","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-basic","pipeline":"core:spec/summarize-scene","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-basic","pipeline":"core:spec/summarize-scene","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-basic","pipeline":"core:spec/summarize-scene","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-basic","pipeline":"core:spec/summarize-world","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default World Summarization"],"inForce":"Default World Summarization","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-basic","pipeline":"core:spec/summarize-world","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default World Summarization"],"inForce":"Default World Summarization","row":false},
	{"genre":"core:genre/chat","preset":"core-chat-basic","pipeline":"core:spec/summarize-world","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default World Summarization"],"inForce":"Default World Summarization","row":false},
	{"genre":"core:genre/dungeon-crawler","preset":"core-dungeon-crawler-default","pipeline":"core:spec/dungeon-crawler-answer-form","triggers":["event"],"nodeKey":"context","call":"Build template context · Prompts","offered":["Roleplay - Plain"],"inForce":"Roleplay - Plain","row":false},
	{"genre":"core:genre/dungeon-crawler","preset":"core-dungeon-crawler-default","pipeline":"core:spec/dungeon-crawler-goal","triggers":["action"],"nodeKey":"route.closing.context","call":"Build template context · Prompts","offered":["Dungeon Crawler Narrator: the round"],"inForce":"Dungeon Crawler Narrator: the round","row":false},
	{"genre":"core:genre/dungeon-crawler","preset":"core-dungeon-crawler-default","pipeline":"core:spec/dungeon-crawler-goal","triggers":["action"],"nodeKey":"route.renew.goalContext","call":"Build template context · Prompts","offered":["Dungeon Crawler Planner: a new goal"],"inForce":"Dungeon Crawler Planner: a new goal","row":false},
	{"genre":"core:genre/dungeon-crawler","preset":"core-dungeon-crawler-default","pipeline":"core:spec/dungeon-crawler-interview","triggers":["action"],"nodeKey":"route.classes.classContext","call":"Build template context · Prompts","offered":["Dungeon Crawler Planner: classes"],"inForce":"Dungeon Crawler Planner: classes","row":false},
	{"genre":"core:genre/dungeon-crawler","preset":"core-dungeon-crawler-default","pipeline":"core:spec/dungeon-crawler-interview","triggers":["action"],"nodeKey":"route.sheet.after.begin.genesisContext","call":"Build template context · Prompts","offered":["Dungeon Crawler Planner: build the world"],"inForce":"Dungeon Crawler Planner: build the world","row":false},
	{"genre":"core:genre/dungeon-crawler","preset":"core-dungeon-crawler-default","pipeline":"core:spec/dungeon-crawler-interview","triggers":["action"],"nodeKey":"route.sheet.after.begin.sceneContext","call":"Build template context · Prompts","offered":["Dungeon Crawler Narrator: opening scene"],"inForce":"Dungeon Crawler Narrator: opening scene","row":false},
	{"genre":"core:genre/dungeon-crawler","preset":"core-dungeon-crawler-default","pipeline":"core:spec/dungeon-crawler-interview","triggers":["action"],"nodeKey":"route.sheet.sheetContext","call":"Build template context · Prompts","offered":["Dungeon Crawler Planner: character sheet"],"inForce":"Dungeon Crawler Planner: character sheet","row":false},
	{"genre":"core:genre/dungeon-crawler","preset":"core-dungeon-crawler-default","pipeline":"core:spec/dungeon-crawler-respond","triggers":["reply"],"nodeKey":"channel.parley.editsContext","call":"Build template context · Prompts","offered":["Dungeon Crawler Planner: sheet edits"],"inForce":"Dungeon Crawler Planner: sheet edits","row":false},
	{"genre":"core:genre/dungeon-crawler","preset":"core-dungeon-crawler-default","pipeline":"core:spec/dungeon-crawler-respond","triggers":["reply"],"nodeKey":"channel.parley.talkContext","call":"Build template context · Prompts","offered":["Dungeon Crawler Planner: talk"],"inForce":"Dungeon Crawler Planner: talk","row":false},
	{"genre":"core:genre/dungeon-crawler","preset":"core-dungeon-crawler-default","pipeline":"core:spec/dungeon-crawler-respond","triggers":["reply"],"nodeKey":"channel.story.context","call":"Build template context · Prompts","offered":["Dungeon Crawler Narrator: the round"],"inForce":"Dungeon Crawler Narrator: the round","row":false},
	{"genre":"core:genre/dungeon-crawler","preset":"core-dungeon-crawler-default","pipeline":"core:spec/dungeon-crawler-respond","triggers":["reply"],"nodeKey":"channel.story.plan.fresh.again.retry.replanContext","call":"Build template context · Prompts","offered":["Dungeon Crawler Planner: the round's books"],"inForce":"Dungeon Crawler Planner: the round's books","row":false},
	{"genre":"core:genre/dungeon-crawler","preset":"core-dungeon-crawler-default","pipeline":"core:spec/dungeon-crawler-respond","triggers":["reply"],"nodeKey":"channel.story.plan.fresh.planContext","call":"Build template context · Prompts","offered":["Dungeon Crawler Planner: the round's books"],"inForce":"Dungeon Crawler Planner: the round's books","row":false},
	{"genre":"core:genre/dungeon-crawler","preset":"core-dungeon-crawler-default","pipeline":"core:spec/dungeon-crawler-respond","triggers":["reply"],"nodeKey":"channel.story.plan.words.again.retry.replanContext","call":"Build template context · Prompts","offered":["Dungeon Crawler Planner: the round's books"],"inForce":"Dungeon Crawler Planner: the round's books","row":false},
	{"genre":"core:genre/dungeon-crawler","preset":"core-dungeon-crawler-default","pipeline":"core:spec/dungeon-crawler-respond","triggers":["reply"],"nodeKey":"channel.story.plan.words.planContext","call":"Build template context · Prompts","offered":["Dungeon Crawler Planner: the round's books"],"inForce":"Dungeon Crawler Planner: the round's books","row":false},
	{"genre":"core:genre/dungeon-crawler","preset":"core-dungeon-crawler-default","pipeline":"core:spec/dungeon-crawler-summarize-scene","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Scene Summarization (transcript)"],"inForce":"Scene Summarization (transcript)","row":false},
	{"genre":"core:genre/dungeon-crawler","preset":"core-dungeon-crawler-default","pipeline":"core:spec/dungeon-crawler-summarize-scene","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/dungeon-crawler","preset":"core-dungeon-crawler-default","pipeline":"core:spec/dungeon-crawler-summarize-scene","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/dungeon-crawler","preset":"core-dungeon-crawler-default","pipeline":"core:spec/speak-message","triggers":["action"],"nodeKey":"spoken.words.speak","call":"Speak the line · Prompts","offered":["Speech direction"],"inForce":"Speech direction","row":false},
	{"genre":"core:genre/dungeon-crawler","preset":"core-dungeon-crawler-default","pipeline":"core:spec/summarize-character","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default Character Summarization"],"inForce":"Default Character Summarization","row":false},
	{"genre":"core:genre/dungeon-crawler","preset":"core-dungeon-crawler-default","pipeline":"core:spec/summarize-character","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default Character Summarization"],"inForce":"Default Character Summarization","row":false},
	{"genre":"core:genre/dungeon-crawler","preset":"core-dungeon-crawler-default","pipeline":"core:spec/summarize-character","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default Character Summarization"],"inForce":"Default Character Summarization","row":false},
	{"genre":"core:genre/dungeon-crawler","preset":"core-dungeon-crawler-default","pipeline":"core:spec/summarize-history","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/dungeon-crawler","preset":"core-dungeon-crawler-default","pipeline":"core:spec/summarize-history","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/dungeon-crawler","preset":"core-dungeon-crawler-default","pipeline":"core:spec/summarize-history","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/dungeon-crawler","preset":"core-dungeon-crawler-default","pipeline":"core:spec/summarize-world","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default World Summarization"],"inForce":"Default World Summarization","row":false},
	{"genre":"core:genre/dungeon-crawler","preset":"core-dungeon-crawler-default","pipeline":"core:spec/summarize-world","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default World Summarization"],"inForce":"Default World Summarization","row":false},
	{"genre":"core:genre/dungeon-crawler","preset":"core-dungeon-crawler-default","pipeline":"core:spec/summarize-world","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default World Summarization"],"inForce":"Default World Summarization","row":false},
	{"genre":"core:genre/guide","preset":"core-guide-default","pipeline":"core:spec/guide-answer-form","triggers":["event"],"nodeKey":"context","call":"Build template context · Prompts","offered":["Answer a question"],"inForce":"Answer a question","row":false},
	{"genre":"core:genre/guide","preset":"core-guide-default","pipeline":"core:spec/guide-summarize-scene","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Scene Summarization (transcript)"],"inForce":"Scene Summarization (transcript)","row":false},
	{"genre":"core:genre/guide","preset":"core-guide-default","pipeline":"core:spec/guide-summarize-scene","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/guide","preset":"core-guide-default","pipeline":"core:spec/guide-summarize-scene","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/guide","preset":"core-guide-default","pipeline":"core:spec/speak-message","triggers":["action"],"nodeKey":"spoken.words.speak","call":"Speak the line · Prompts","offered":["Speech direction"],"inForce":"Speech direction","row":false},
	{"genre":"core:genre/guide","preset":"core-guide-default","pipeline":"core:spec/summarize-character","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default Character Summarization"],"inForce":"Default Character Summarization","row":false},
	{"genre":"core:genre/guide","preset":"core-guide-default","pipeline":"core:spec/summarize-character","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default Character Summarization"],"inForce":"Default Character Summarization","row":false},
	{"genre":"core:genre/guide","preset":"core-guide-default","pipeline":"core:spec/summarize-character","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default Character Summarization"],"inForce":"Default Character Summarization","row":false},
	{"genre":"core:genre/guide","preset":"core-guide-default","pipeline":"core:spec/summarize-history","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/guide","preset":"core-guide-default","pipeline":"core:spec/summarize-history","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/guide","preset":"core-guide-default","pipeline":"core:spec/summarize-history","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/guide","preset":"core-guide-default","pipeline":"core:spec/summarize-world","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default World Summarization"],"inForce":"Default World Summarization","row":false},
	{"genre":"core:genre/guide","preset":"core-guide-default","pipeline":"core:spec/summarize-world","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default World Summarization"],"inForce":"Default World Summarization","row":false},
	{"genre":"core:genre/guide","preset":"core-guide-default","pipeline":"core:spec/summarize-world","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default World Summarization"],"inForce":"Default World Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-default","pipeline":"core:spec/lair-answer-form","triggers":["event"],"nodeKey":"context","call":"Build template context · Prompts","offered":["Answer a question"],"inForce":"Answer a question","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-default","pipeline":"core:spec/lair-build-room","triggers":["action"],"nodeKey":"context","call":"Build template context · Prompts","offered":["Lair build room"],"inForce":"Lair build room","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-default","pipeline":"core:spec/lair-file-current-room","triggers":["routine"],"nodeKey":"described.prose.draftContext","call":"Build template context · Prompts","offered":["Lair: file the current room"],"inForce":"Lair: file the current room","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-default","pipeline":"core:spec/lair-file-room","triggers":["action"],"nodeKey":"room.new.context","call":"Build template context · Prompts","offered":["Lair file room"],"inForce":"Lair file room","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-default","pipeline":"core:spec/lair-keeper","triggers":["routine"],"nodeKey":"reckon.on.reckonContext","call":"Build template context · Prompts","offered":["Lair: keep the books"],"inForce":"Lair: keep the books","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-default","pipeline":"core:spec/lair-reply","triggers":["reply"],"nodeKey":"via.narrate.context","call":"Build scene context · Prompts","offered":["Lair Castellan narration"],"inForce":"Lair Castellan narration","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-default","pipeline":"core:spec/lair-reply","triggers":["reply"],"nodeKey":"via.turn.channel.story.pick.picked.context","call":"Build side character context · Prompts","offered":["Lair voice"],"inForce":"Lair voice","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-default","pipeline":"core:spec/lair-reply","triggers":["reply"],"nodeKey":"via.turn.channel.story.pick.planned.planContext","call":"Build planner context · Prompts","offered":["Lair planner"],"inForce":"Lair planner","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-default","pipeline":"core:spec/lair-reveal","triggers":["action"],"nodeKey":"context","call":"Build template context · Prompts","offered":["Lair reveal"],"inForce":"Lair reveal","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-default","pipeline":"core:spec/lair-room-answer","triggers":["action"],"nodeKey":"room.drafted.context","call":"Build template context · Prompts","offered":["Lair knock build"],"inForce":"Lair knock build","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-default","pipeline":"core:spec/lair-scratchpad","triggers":["routine"],"nodeKey":"notesContext","call":"Build template context · Prompts","offered":["Lair Castellan scratchpad"],"inForce":"Lair Castellan scratchpad","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-default","pipeline":"core:spec/lair-summarize-scene","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Lair Scene Summarization"],"inForce":"Lair Scene Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-default","pipeline":"core:spec/lair-summarize-scene","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-default","pipeline":"core:spec/lair-summarize-scene","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-default","pipeline":"core:spec/lair-trap","triggers":["action"],"nodeKey":"context","call":"Build template context · Prompts","offered":["Lair trap"],"inForce":"Lair trap","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-default","pipeline":"core:spec/speak-message","triggers":["action"],"nodeKey":"spoken.words.speak","call":"Speak the line · Prompts","offered":["Speech direction"],"inForce":"Speech direction","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-default","pipeline":"core:spec/summarize-character","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default Character Summarization"],"inForce":"Default Character Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-default","pipeline":"core:spec/summarize-character","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default Character Summarization"],"inForce":"Default Character Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-default","pipeline":"core:spec/summarize-character","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default Character Summarization"],"inForce":"Default Character Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-default","pipeline":"core:spec/summarize-history","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-default","pipeline":"core:spec/summarize-history","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-default","pipeline":"core:spec/summarize-history","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-default","pipeline":"core:spec/summarize-world","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default World Summarization"],"inForce":"Default World Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-default","pipeline":"core:spec/summarize-world","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default World Summarization"],"inForce":"Default World Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-default","pipeline":"core:spec/summarize-world","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default World Summarization"],"inForce":"Default World Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-rules-and-dice","pipeline":"core:spec/lair-answer-form","triggers":["event"],"nodeKey":"context","call":"Build template context · Prompts","offered":["Answer a question"],"inForce":"Answer a question","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-rules-and-dice","pipeline":"core:spec/lair-build-room","triggers":["action"],"nodeKey":"context","call":"Build template context · Prompts","offered":["Lair build room"],"inForce":"Lair build room","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-rules-and-dice","pipeline":"core:spec/lair-file-current-room","triggers":["routine"],"nodeKey":"described.prose.draftContext","call":"Build template context · Prompts","offered":["Lair: file the current room"],"inForce":"Lair: file the current room","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-rules-and-dice","pipeline":"core:spec/lair-file-room","triggers":["action"],"nodeKey":"room.new.context","call":"Build template context · Prompts","offered":["Lair file room"],"inForce":"Lair file room","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-rules-and-dice","pipeline":"core:spec/lair-keeper","triggers":["routine"],"nodeKey":"reckon.on.reckonContext","call":"Build template context · Prompts","offered":["Lair: keep the books"],"inForce":"Lair: keep the books","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-rules-and-dice","pipeline":"core:spec/lair-reply","triggers":["reply"],"nodeKey":"via.narrate.context","call":"Build scene context · Prompts","offered":["Lair Castellan narration"],"inForce":"Lair Castellan narration","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-rules-and-dice","pipeline":"core:spec/lair-reply","triggers":["reply"],"nodeKey":"via.turn.channel.story.pick.picked.context","call":"Build side character context · Prompts","offered":["Lair voice"],"inForce":"Lair voice","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-rules-and-dice","pipeline":"core:spec/lair-reply","triggers":["reply"],"nodeKey":"via.turn.channel.story.pick.planned.planContext","call":"Build planner context · Prompts","offered":["Lair planner"],"inForce":"Lair planner","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-rules-and-dice","pipeline":"core:spec/lair-reveal","triggers":["action"],"nodeKey":"context","call":"Build template context · Prompts","offered":["Lair reveal"],"inForce":"Lair reveal","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-rules-and-dice","pipeline":"core:spec/lair-room-answer","triggers":["action"],"nodeKey":"room.drafted.context","call":"Build template context · Prompts","offered":["Lair knock build"],"inForce":"Lair knock build","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-rules-and-dice","pipeline":"core:spec/lair-scratchpad","triggers":["routine"],"nodeKey":"notesContext","call":"Build template context · Prompts","offered":["Lair Castellan scratchpad"],"inForce":"Lair Castellan scratchpad","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-rules-and-dice","pipeline":"core:spec/lair-summarize-scene","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Lair Scene Summarization"],"inForce":"Lair Scene Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-rules-and-dice","pipeline":"core:spec/lair-summarize-scene","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-rules-and-dice","pipeline":"core:spec/lair-summarize-scene","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-rules-and-dice","pipeline":"core:spec/lair-trap","triggers":["action"],"nodeKey":"context","call":"Build template context · Prompts","offered":["Lair trap"],"inForce":"Lair trap","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-rules-and-dice","pipeline":"core:spec/speak-message","triggers":["action"],"nodeKey":"spoken.words.speak","call":"Speak the line · Prompts","offered":["Speech direction"],"inForce":"Speech direction","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-rules-and-dice","pipeline":"core:spec/summarize-character","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default Character Summarization"],"inForce":"Default Character Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-rules-and-dice","pipeline":"core:spec/summarize-character","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default Character Summarization"],"inForce":"Default Character Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-rules-and-dice","pipeline":"core:spec/summarize-character","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default Character Summarization"],"inForce":"Default Character Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-rules-and-dice","pipeline":"core:spec/summarize-history","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-rules-and-dice","pipeline":"core:spec/summarize-history","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-rules-and-dice","pipeline":"core:spec/summarize-history","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-rules-and-dice","pipeline":"core:spec/summarize-world","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default World Summarization"],"inForce":"Default World Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-rules-and-dice","pipeline":"core:spec/summarize-world","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default World Summarization"],"inForce":"Default World Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-rules-and-dice","pipeline":"core:spec/summarize-world","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default World Summarization"],"inForce":"Default World Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-words-only","pipeline":"core:spec/lair-answer-form","triggers":["event"],"nodeKey":"context","call":"Build template context · Prompts","offered":["Answer a question"],"inForce":"Answer a question","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-words-only","pipeline":"core:spec/lair-keeper","triggers":["routine"],"nodeKey":"reckon.on.reckonContext","call":"Build template context · Prompts","offered":["Lair: keep the books"],"inForce":"Lair: keep the books","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-words-only","pipeline":"core:spec/lair-reply","triggers":["reply"],"nodeKey":"via.narrate.context","call":"Build scene context · Prompts","offered":["Lair Castellan narration"],"inForce":"Lair Castellan narration","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-words-only","pipeline":"core:spec/lair-reply","triggers":["reply"],"nodeKey":"via.turn.channel.story.pick.picked.context","call":"Build side character context · Prompts","offered":["Lair voice"],"inForce":"Lair voice","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-words-only","pipeline":"core:spec/lair-reply","triggers":["reply"],"nodeKey":"via.turn.channel.story.pick.planned.planContext","call":"Build planner context · Prompts","offered":["Lair planner"],"inForce":"Lair planner","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-words-only","pipeline":"core:spec/lair-reveal","triggers":["action"],"nodeKey":"context","call":"Build template context · Prompts","offered":["Lair reveal"],"inForce":"Lair reveal","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-words-only","pipeline":"core:spec/lair-scratchpad","triggers":["routine"],"nodeKey":"notesContext","call":"Build template context · Prompts","offered":["Lair Castellan scratchpad"],"inForce":"Lair Castellan scratchpad","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-words-only","pipeline":"core:spec/lair-summarize-scene","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Lair Scene Summarization"],"inForce":"Lair Scene Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-words-only","pipeline":"core:spec/lair-summarize-scene","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-words-only","pipeline":"core:spec/lair-summarize-scene","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-words-only","pipeline":"core:spec/lair-trap","triggers":["action"],"nodeKey":"context","call":"Build template context · Prompts","offered":["Lair trap"],"inForce":"Lair trap","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-words-only","pipeline":"core:spec/speak-message","triggers":["action"],"nodeKey":"spoken.words.speak","call":"Speak the line · Prompts","offered":["Speech direction"],"inForce":"Speech direction","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-words-only","pipeline":"core:spec/summarize-character","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default Character Summarization"],"inForce":"Default Character Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-words-only","pipeline":"core:spec/summarize-character","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default Character Summarization"],"inForce":"Default Character Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-words-only","pipeline":"core:spec/summarize-character","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default Character Summarization"],"inForce":"Default Character Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-words-only","pipeline":"core:spec/summarize-history","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-words-only","pipeline":"core:spec/summarize-history","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-words-only","pipeline":"core:spec/summarize-history","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-words-only","pipeline":"core:spec/summarize-world","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default World Summarization"],"inForce":"Default World Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-words-only","pipeline":"core:spec/summarize-world","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default World Summarization"],"inForce":"Default World Summarization","row":false},
	{"genre":"core:genre/lair","preset":"core-lair-words-only","pipeline":"core:spec/summarize-world","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default World Summarization"],"inForce":"Default World Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-living","pipeline":"core:spec/speak-message","triggers":["action"],"nodeKey":"spoken.words.speak","call":"Speak the line · Prompts","offered":["Speech direction"],"inForce":"Speech direction","row":false},
	{"genre":"core:genre/story","preset":"core-story-living","pipeline":"core:spec/story-answer-form","triggers":["event"],"nodeKey":"context","call":"Build template context · Prompts","offered":["Answer a question"],"inForce":"Answer a question","row":false},
	{"genre":"core:genre/story","preset":"core-story-living","pipeline":"core:spec/story-generate-image","triggers":["action"],"nodeKey":"render","call":"Generate image · Prompts","offered":["Prompt as written","Prompt with quality tags"],"inForce":"Prompt as written","row":true},
	{"genre":"core:genre/story","preset":"core-story-living","pipeline":"core:spec/story-illustrate-new-scene","triggers":["routine"],"nodeKey":"captionPrompt","call":"Assemble · Prompts","offered":["Scene caption"],"inForce":"Scene caption","row":false},
	{"genre":"core:genre/story","preset":"core-story-living","pipeline":"core:spec/story-illustrate-new-scene","triggers":["routine"],"nodeKey":"context","call":"Build narrator context · Prompts","offered":["Narrator"],"inForce":"Narrator","row":false},
	{"genre":"core:genre/story","preset":"core-story-living","pipeline":"core:spec/story-illustrate-new-scene","triggers":["routine"],"nodeKey":"draw","call":"Picture · Prompts","offered":["Prompt as written"],"inForce":"Prompt as written","row":false},
	{"genre":"core:genre/story","preset":"core-story-living","pipeline":"core:spec/story-illustrate-scene","triggers":["action"],"nodeKey":"captionPrompt","call":"Assemble · Prompts","offered":["Scene caption"],"inForce":"Scene caption","row":false},
	{"genre":"core:genre/story","preset":"core-story-living","pipeline":"core:spec/story-illustrate-scene","triggers":["action"],"nodeKey":"context","call":"Build narrator context · Prompts","offered":["Scene prompt from the last lines","Scene prompt, prose"],"inForce":"Scene prompt from the last lines","row":true},
	{"genre":"core:genre/story","preset":"core-story-living","pipeline":"core:spec/story-illustrate-scene","triggers":["action"],"nodeKey":"draw","call":"Picture · Prompts","offered":["Prompt as written"],"inForce":"Prompt as written","row":false},
	{"genre":"core:genre/story","preset":"core-story-living","pipeline":"core:spec/story-look","triggers":["action"],"nodeKey":"context","call":"Build scene context · Prompts","offered":["Story look"],"inForce":"Story look","row":false},
	{"genre":"core:genre/story","preset":"core-story-living","pipeline":"core:spec/story-narrate","triggers":["action"],"nodeKey":"context","call":"Build narrator context · Prompts","offered":["Narrator"],"inForce":"Narrator","row":false},
	{"genre":"core:genre/story","preset":"core-story-living","pipeline":"core:spec/story-reckoning","triggers":["routine"],"nodeKey":"reckon.on.reckonContext","call":"Build template context · Prompts","offered":["Story: what the reply changed"],"inForce":"Story: what the reply changed","row":false},
	{"genre":"core:genre/story","preset":"core-story-living","pipeline":"core:spec/story-respond","triggers":["reply"],"nodeKey":"context","call":"Build template context · Prompts","offered":["Roleplay - Brief","Roleplay - Living Scene","Roleplay - Plain","Writer"],"inForce":"Roleplay - Living Scene","row":true},
	{"genre":"core:genre/story","preset":"core-story-living","pipeline":"core:spec/story-rest","triggers":["action"],"nodeKey":"context","call":"Build state keeper context · Prompts","offered":["Story rest"],"inForce":"Story rest","row":false},
	{"genre":"core:genre/story","preset":"core-story-living","pipeline":"core:spec/story-side-character","triggers":["action"],"nodeKey":"context","call":"Build side character context · Prompts","offered":["Side Character"],"inForce":"Side Character","row":false},
	{"genre":"core:genre/story","preset":"core-story-living","pipeline":"core:spec/story-summarize-scene","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Scene Summarization (transcript)"],"inForce":"Scene Summarization (transcript)","row":false},
	{"genre":"core:genre/story","preset":"core-story-living","pipeline":"core:spec/story-summarize-scene","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-living","pipeline":"core:spec/story-summarize-scene","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-living","pipeline":"core:spec/story-sweep","triggers":["routine"],"nodeKey":"sweep.due.sweepContext","call":"Build template context · Prompts","offered":["Story: every few turns"],"inForce":"Story: every few turns","row":false},
	{"genre":"core:genre/story","preset":"core-story-living","pipeline":"core:spec/story-turn-order","triggers":["event"],"nodeKey":"decide.model.advise","call":"Model decides who speaks · Prompts","offered":["Default Turn Order Advice"],"inForce":"Default Turn Order Advice","row":false},
	{"genre":"core:genre/story","preset":"core-story-living","pipeline":"core:spec/summarize-character","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default Character Summarization"],"inForce":"Default Character Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-living","pipeline":"core:spec/summarize-character","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default Character Summarization"],"inForce":"Default Character Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-living","pipeline":"core:spec/summarize-character","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default Character Summarization"],"inForce":"Default Character Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-living","pipeline":"core:spec/summarize-history","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-living","pipeline":"core:spec/summarize-history","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-living","pipeline":"core:spec/summarize-history","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-living","pipeline":"core:spec/summarize-world","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default World Summarization"],"inForce":"Default World Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-living","pipeline":"core:spec/summarize-world","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default World Summarization"],"inForce":"Default World Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-living","pipeline":"core:spec/summarize-world","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default World Summarization"],"inForce":"Default World Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-minimal","pipeline":"core:spec/speak-message","triggers":["action"],"nodeKey":"spoken.words.speak","call":"Speak the line · Prompts","offered":["Speech direction"],"inForce":"Speech direction","row":false},
	{"genre":"core:genre/story","preset":"core-story-minimal","pipeline":"core:spec/story-answer-form","triggers":["event"],"nodeKey":"context","call":"Build template context · Prompts","offered":["Answer a question"],"inForce":"Answer a question","row":false},
	{"genre":"core:genre/story","preset":"core-story-minimal","pipeline":"core:spec/story-generate-image","triggers":["action"],"nodeKey":"render","call":"Generate image · Prompts","offered":["Prompt as written","Prompt with quality tags"],"inForce":"Prompt as written","row":true},
	{"genre":"core:genre/story","preset":"core-story-minimal","pipeline":"core:spec/story-illustrate-scene","triggers":["action"],"nodeKey":"captionPrompt","call":"Assemble · Prompts","offered":["Scene caption"],"inForce":"Scene caption","row":false},
	{"genre":"core:genre/story","preset":"core-story-minimal","pipeline":"core:spec/story-illustrate-scene","triggers":["action"],"nodeKey":"context","call":"Build narrator context · Prompts","offered":["Scene prompt from the last lines","Scene prompt, prose"],"inForce":"Scene prompt from the last lines","row":true},
	{"genre":"core:genre/story","preset":"core-story-minimal","pipeline":"core:spec/story-illustrate-scene","triggers":["action"],"nodeKey":"draw","call":"Picture · Prompts","offered":["Prompt as written"],"inForce":"Prompt as written","row":false},
	{"genre":"core:genre/story","preset":"core-story-minimal","pipeline":"core:spec/story-look","triggers":["action"],"nodeKey":"context","call":"Build scene context · Prompts","offered":["Story look"],"inForce":"Story look","row":false},
	{"genre":"core:genre/story","preset":"core-story-minimal","pipeline":"core:spec/story-narrate","triggers":["action"],"nodeKey":"context","call":"Build narrator context · Prompts","offered":["Narrator"],"inForce":"Narrator","row":false},
	{"genre":"core:genre/story","preset":"core-story-minimal","pipeline":"core:spec/story-respond","triggers":["reply"],"nodeKey":"context","call":"Build template context · Prompts","offered":["Roleplay - Brief","Roleplay - Living Scene","Roleplay - Plain","Writer"],"inForce":"Roleplay - Living Scene","row":true},
	{"genre":"core:genre/story","preset":"core-story-minimal","pipeline":"core:spec/story-rest","triggers":["action"],"nodeKey":"context","call":"Build state keeper context · Prompts","offered":["Story rest"],"inForce":"Story rest","row":false},
	{"genre":"core:genre/story","preset":"core-story-minimal","pipeline":"core:spec/story-side-character","triggers":["action"],"nodeKey":"context","call":"Build side character context · Prompts","offered":["Side Character"],"inForce":"Side Character","row":false},
	{"genre":"core:genre/story","preset":"core-story-minimal","pipeline":"core:spec/story-summarize-scene","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Scene Summarization (transcript)"],"inForce":"Scene Summarization (transcript)","row":false},
	{"genre":"core:genre/story","preset":"core-story-minimal","pipeline":"core:spec/story-summarize-scene","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-minimal","pipeline":"core:spec/story-summarize-scene","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-minimal","pipeline":"core:spec/story-turn-order","triggers":["event"],"nodeKey":"decide.model.advise","call":"Model decides who speaks · Prompts","offered":["Default Turn Order Advice"],"inForce":"Default Turn Order Advice","row":false},
	{"genre":"core:genre/story","preset":"core-story-minimal","pipeline":"core:spec/summarize-character","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default Character Summarization"],"inForce":"Default Character Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-minimal","pipeline":"core:spec/summarize-character","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default Character Summarization"],"inForce":"Default Character Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-minimal","pipeline":"core:spec/summarize-character","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default Character Summarization"],"inForce":"Default Character Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-minimal","pipeline":"core:spec/summarize-history","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-minimal","pipeline":"core:spec/summarize-history","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-minimal","pipeline":"core:spec/summarize-history","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-minimal","pipeline":"core:spec/summarize-world","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default World Summarization"],"inForce":"Default World Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-minimal","pipeline":"core:spec/summarize-world","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default World Summarization"],"inForce":"Default World Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-minimal","pipeline":"core:spec/summarize-world","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default World Summarization"],"inForce":"Default World Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-rule-based","pipeline":"core:spec/speak-message","triggers":["action"],"nodeKey":"spoken.words.speak","call":"Speak the line · Prompts","offered":["Speech direction"],"inForce":"Speech direction","row":false},
	{"genre":"core:genre/story","preset":"core-story-rule-based","pipeline":"core:spec/story-answer-form","triggers":["event"],"nodeKey":"context","call":"Build template context · Prompts","offered":["Answer a question"],"inForce":"Answer a question","row":false},
	{"genre":"core:genre/story","preset":"core-story-rule-based","pipeline":"core:spec/story-generate-image","triggers":["action"],"nodeKey":"render","call":"Generate image · Prompts","offered":["Prompt as written","Prompt with quality tags"],"inForce":"Prompt as written","row":true},
	{"genre":"core:genre/story","preset":"core-story-rule-based","pipeline":"core:spec/story-illustrate-new-scene","triggers":["routine"],"nodeKey":"captionPrompt","call":"Assemble · Prompts","offered":["Scene caption"],"inForce":"Scene caption","row":false},
	{"genre":"core:genre/story","preset":"core-story-rule-based","pipeline":"core:spec/story-illustrate-new-scene","triggers":["routine"],"nodeKey":"context","call":"Build narrator context · Prompts","offered":["Narrator"],"inForce":"Narrator","row":false},
	{"genre":"core:genre/story","preset":"core-story-rule-based","pipeline":"core:spec/story-illustrate-new-scene","triggers":["routine"],"nodeKey":"draw","call":"Picture · Prompts","offered":["Prompt as written"],"inForce":"Prompt as written","row":false},
	{"genre":"core:genre/story","preset":"core-story-rule-based","pipeline":"core:spec/story-illustrate-scene","triggers":["action"],"nodeKey":"captionPrompt","call":"Assemble · Prompts","offered":["Scene caption"],"inForce":"Scene caption","row":false},
	{"genre":"core:genre/story","preset":"core-story-rule-based","pipeline":"core:spec/story-illustrate-scene","triggers":["action"],"nodeKey":"context","call":"Build narrator context · Prompts","offered":["Scene prompt from the last lines","Scene prompt, prose"],"inForce":"Scene prompt from the last lines","row":true},
	{"genre":"core:genre/story","preset":"core-story-rule-based","pipeline":"core:spec/story-illustrate-scene","triggers":["action"],"nodeKey":"draw","call":"Picture · Prompts","offered":["Prompt as written"],"inForce":"Prompt as written","row":false},
	{"genre":"core:genre/story","preset":"core-story-rule-based","pipeline":"core:spec/story-look","triggers":["action"],"nodeKey":"context","call":"Build scene context · Prompts","offered":["Story look"],"inForce":"Story look","row":false},
	{"genre":"core:genre/story","preset":"core-story-rule-based","pipeline":"core:spec/story-narrate","triggers":["action"],"nodeKey":"context","call":"Build narrator context · Prompts","offered":["Narrator"],"inForce":"Narrator","row":false},
	{"genre":"core:genre/story","preset":"core-story-rule-based","pipeline":"core:spec/story-reckoning","triggers":["routine"],"nodeKey":"reckon.on.reckonContext","call":"Build template context · Prompts","offered":["Story: what the reply changed"],"inForce":"Story: what the reply changed","row":false},
	{"genre":"core:genre/story","preset":"core-story-rule-based","pipeline":"core:spec/story-respond","triggers":["reply"],"nodeKey":"context","call":"Build template context · Prompts","offered":["Roleplay - Brief","Roleplay - Living Scene","Roleplay - Plain","Writer"],"inForce":"Roleplay - Living Scene","row":true},
	{"genre":"core:genre/story","preset":"core-story-rule-based","pipeline":"core:spec/story-rest","triggers":["action"],"nodeKey":"context","call":"Build state keeper context · Prompts","offered":["Story rest"],"inForce":"Story rest","row":false},
	{"genre":"core:genre/story","preset":"core-story-rule-based","pipeline":"core:spec/story-side-character","triggers":["action"],"nodeKey":"context","call":"Build side character context · Prompts","offered":["Side Character"],"inForce":"Side Character","row":false},
	{"genre":"core:genre/story","preset":"core-story-rule-based","pipeline":"core:spec/story-summarize-scene","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Scene Summarization (transcript)"],"inForce":"Scene Summarization (transcript)","row":false},
	{"genre":"core:genre/story","preset":"core-story-rule-based","pipeline":"core:spec/story-summarize-scene","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-rule-based","pipeline":"core:spec/story-summarize-scene","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-rule-based","pipeline":"core:spec/story-sweep","triggers":["routine"],"nodeKey":"sweep.due.sweepContext","call":"Build template context · Prompts","offered":["Story: every few turns"],"inForce":"Story: every few turns","row":false},
	{"genre":"core:genre/story","preset":"core-story-rule-based","pipeline":"core:spec/story-turn-order","triggers":["event"],"nodeKey":"decide.model.advise","call":"Model decides who speaks · Prompts","offered":["Default Turn Order Advice"],"inForce":"Default Turn Order Advice","row":false},
	{"genre":"core:genre/story","preset":"core-story-rule-based","pipeline":"core:spec/summarize-character","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default Character Summarization"],"inForce":"Default Character Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-rule-based","pipeline":"core:spec/summarize-character","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default Character Summarization"],"inForce":"Default Character Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-rule-based","pipeline":"core:spec/summarize-character","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default Character Summarization"],"inForce":"Default Character Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-rule-based","pipeline":"core:spec/summarize-history","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-rule-based","pipeline":"core:spec/summarize-history","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-rule-based","pipeline":"core:spec/summarize-history","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default Scene Summarization"],"inForce":"Default Scene Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-rule-based","pipeline":"core:spec/summarize-world","triggers":["action"],"nodeKey":"drafting.item.draft","call":"Drafting · Prompts","offered":["Default World Summarization"],"inForce":"Default World Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-rule-based","pipeline":"core:spec/summarize-world","triggers":["action"],"nodeKey":"naming","call":"Naming · Prompts","offered":["Default World Summarization"],"inForce":"Default World Summarization","row":false},
	{"genre":"core:genre/story","preset":"core-story-rule-based","pipeline":"core:spec/summarize-world","triggers":["action"],"nodeKey":"synth","call":"Combining · Prompts","offered":["Default World Summarization"],"inForce":"Default World Summarization","row":false}
]

/** The choices rule 2 removed from an administrator's screen outside a session (note-37-only list minus what is offered), once per pipeline and node. */
const REMOVED_ON_ADMIN_SCREENS: Array<{
	pipeline: string
	nodeKey: string
	names: string[]
}> = [
	{"pipeline":"core:spec/dungeon-crawler-goal","nodeKey":"route.closing.context","names":["Dungeon Crawler Planner: a new goal"]},
	{"pipeline":"core:spec/dungeon-crawler-interview","nodeKey":"route.classes.classContext","names":["Dungeon Crawler Narrator: opening scene","Dungeon Crawler Planner: build the world","Dungeon Crawler Planner: character sheet"]},
	{"pipeline":"core:spec/dungeon-crawler-interview","nodeKey":"route.sheet.after.begin.genesisContext","names":["Dungeon Crawler Narrator: opening scene","Dungeon Crawler Planner: character sheet","Dungeon Crawler Planner: classes"]},
	{"pipeline":"core:spec/dungeon-crawler-interview","nodeKey":"route.sheet.after.begin.sceneContext","names":["Dungeon Crawler Planner: build the world","Dungeon Crawler Planner: character sheet","Dungeon Crawler Planner: classes"]},
	{"pipeline":"core:spec/dungeon-crawler-interview","nodeKey":"route.sheet.sheetContext","names":["Dungeon Crawler Narrator: opening scene","Dungeon Crawler Planner: build the world","Dungeon Crawler Planner: classes"]},
	{"pipeline":"core:spec/dungeon-crawler-respond","nodeKey":"channel.parley.editsContext","names":["Dungeon Crawler Narrator: the round","Dungeon Crawler Planner: talk","Dungeon Crawler Planner: the round's books"]},
	{"pipeline":"core:spec/dungeon-crawler-respond","nodeKey":"channel.parley.talkContext","names":["Dungeon Crawler Narrator: the round","Dungeon Crawler Planner: sheet edits","Dungeon Crawler Planner: the round's books"]},
	{"pipeline":"core:spec/dungeon-crawler-respond","nodeKey":"channel.story.context","names":["Dungeon Crawler Planner: sheet edits","Dungeon Crawler Planner: talk","Dungeon Crawler Planner: the round's books"]},
	{"pipeline":"core:spec/dungeon-crawler-respond","nodeKey":"channel.story.plan.fresh.again.retry.replanContext","names":["Dungeon Crawler Narrator: the round","Dungeon Crawler Planner: sheet edits","Dungeon Crawler Planner: talk"]},
	{"pipeline":"core:spec/dungeon-crawler-respond","nodeKey":"channel.story.plan.fresh.planContext","names":["Dungeon Crawler Narrator: the round","Dungeon Crawler Planner: sheet edits","Dungeon Crawler Planner: talk"]},
	{"pipeline":"core:spec/dungeon-crawler-respond","nodeKey":"channel.story.plan.words.again.retry.replanContext","names":["Dungeon Crawler Narrator: the round","Dungeon Crawler Planner: sheet edits","Dungeon Crawler Planner: talk"]},
	{"pipeline":"core:spec/dungeon-crawler-respond","nodeKey":"channel.story.plan.words.planContext","names":["Dungeon Crawler Narrator: the round","Dungeon Crawler Planner: sheet edits","Dungeon Crawler Planner: talk"]}
]

describe("the prompts each call offers (Step 0)", () => {
	test("the table, the removed list and the stops", async () => {
		const { createTestUser } = await import("$lib/server/utils/testDb")
		const { ensureCoreGenres } = await import(
			"$lib/server/pipelines/registrations/genreDefaults"
		)
		const { genres, getGenre, eventById } = await import("@serene-pub/sdk")
		const { rulesFieldsOf } = await import("$lib/server/sessions/exposure")
		const { effectiveRegistrations } = await import(
			"$lib/server/pipelines/registrations/resolve"
		)
		const { namespaceView } = await import(
			"$lib/server/pipelines/config/panel"
		)
		const { groupOptions } = await import(
			"$lib/server/pipelines/config/panel/groups"
		)
		const { optionId } = await import(
			"$lib/server/pipelines/config/panel/ids"
		)
		const { published, declarations } = await import(
			"$lib/server/pipelines/config/panel/declarations"
		)
		const { shippedConfigValuesOf } = await import(
			"$lib/server/pipelines/config/named"
		)
		const { listPrompts, promptDefaultsOf } = await import(
			"$lib/server/pipelines/entities/prompts"
		)
		await ensureCoreGenres()

		const db = testDb as any
		const owner = await createTestUser(testDb, "prompts-offered-owner")
		const adminUser = await createTestUser(testDb, "prompts-offered-admin")
		const [lorebook] = await testDb
			.insert(schema.lorebooks)
			.values({ name: "Prompts Offered Book", userId: owner.id })
			.returning()

		const presets = await testDb.select().from(schema.sessionPresets)
		const coreGenreIds = (genres() as Array<{ id: string }>)
			.map((g) => g.id)
			.filter((id) => id.startsWith("core:"))
		const cases: Array<{
			genre: string
			preset: string
			presetId: number | null
		}> = presets.map((p: any) => ({
			genre: p.genreId,
			preset: p.seedKey ?? p.name,
			presetId: p.id
		}))
		for (const g of coreGenreIds)
			if (!presets.some((p: any) => p.genreId === g))
				cases.push({ genre: g, preset: "(none)", presetId: null })

		const triggerLabel = (t: any): string => {
			if (t.family === "action") return "action"
			if (t.family === "routine") return "routine"
			const slug = eventById(t.event)?.slug
			if (slug === "session-created") return "create"
			if (slug === "message-respond") return "reply"
			return "event"
		}

		const pubs = new Map<string, any>()
		const pubOf = async (slug: string) => {
			let v = pubs.get(slug)
			if (!v) {
				const at = await published(db, slug)
				if (!at) throw new Error(`not published: ${slug}`)
				const decls = await declarations(db, at.specVersionId)
				const defaults = promptDefaultsOf(
					decls,
					await shippedConfigValuesOf(
						db,
						at.specId,
						at.slug,
						at.specVersionId,
						decls
					)
				)
				v = { at, decls, defaults }
				pubs.set(slug, v)
			}
			return v as {
				at: NonNullable<Awaited<ReturnType<typeof published>>>
				decls: Awaited<ReturnType<typeof declarations>>
				defaults: Map<string, number>
			}
		}
		const addr = (d: { nodeKey: string; slot: string; path: string }) =>
			`${d.nodeKey}\u0000${d.slot}\u0000${d.path}`

		/** Note 37 alone: other pipelines' prompts dropped, hidden ones too for a non-admin. */
		const note37 = (
			pool: any[],
			specId: number,
			inForce: unknown,
			own: number | undefined,
			administrator: boolean
		) =>
			pool.filter((p) => {
				if (Number(p.id) === Number(inForce)) return true
				if (!administrator && p.hidden === true) return false
				if (p.id === own) return true
				return p.createdForSpecId == null || p.createdForSpecId === specId
			})

		const table: Row[] = []
		const counts: string[] = []
		const stopA: string[] = []
		const stopB: string[] = []
		const cardRows = new Map<string, number>()
		const ranOnce = new Set<string>()

		for (const c of cases) {
			const rules = rulesFieldsOf(c.genre) as any
			const g = getGenre(c.genre) as any
			const primaryRuleset =
				rules.ruleset?.default ?? "core:ruleset/freeform@1"
			const rigour = rules.rigour?.default ?? g?.rigour?.default ?? "prose"
			const [session] = await testDb
				.insert(schema.sessions)
				.values({
					userId: owner.id,
					isGroup: false,
					lorebookId: lorebook!.id,
					genreId: c.genre,
					presetId: c.presetId,
					primaryRuleset,
					rigour
				} as any)
				.returning()
			const regs = await effectiveRegistrations(db, session!.id)
			const byPipeline = new Map<string, Set<string>>()
			for (const r of regs!.effective) {
				const set = byPipeline.get(r.pipeline) ?? new Set<string>()
				set.add(triggerLabel(r.trigger))
				byPipeline.set(r.pipeline, set)
			}
			for (const [slug, trig] of [...byPipeline].sort((a, b) =>
				cmp(a[0], b[0])
			)) {
				const { at, decls, defaults } = await pubOf(slug)
				const view = await namespaceView(db, SECRET, slug, {
					userId: owner.id,
					isAdmin: false,
					sessionId: session!.id
				})
				if (!view) continue
				const options = groupOptions(view.groups).filter(
					(o) => o.control === "prompts-ref"
				)
				const card = `${c.genre}|${c.preset}|${slug}`
				for (const o of options) {
					const d = decls.find(
						(x) =>
							x.control === "prompts-ref" &&
							optionId(SECRET, x.nodeKey, x.slot, x.path) === o.id
					)
					if (!d) continue
					const choices = o.choices ?? []
					const held = choices.find((x) => Number(x.id) === Number(o.value))
					const offered = choices.map((x) => x.label)
					const row: Row = {
						genre: c.genre,
						preset: c.preset,
						pipeline: slug,
						triggers: [...trig].sort(),
						nodeKey: d.nodeKey,
						call: `${o.step.heading} · ${o.label}`,
						offered,
						inForce: held?.label ?? null,
						row: offered.length >= 2
					}
					table.push(row)
					cardRows.set(card, (cardRows.get(card) ?? 0) + (row.row ? 1 : 0))

					const pool = d.nodeDefinitionId
						? await listPrompts(db, d.nodeDefinitionId, d.slot)
						: []
					const own = defaults.get(addr(d))
					const before = note37(pool, at.specId, o.value, own, false)
					counts.push(
						`${c.genre} | ${c.preset} | ${slug} | ${row.call} [${d.nodeKey}]: ${pool.length} -> ${before.length} -> ${offered.length}`
					)
					for (const x of choices) {
						if (Number(x.id) === Number(o.value)) continue
						if (Number(x.id) === own) continue
						for (const [a, id] of defaults)
							if (a !== addr(d) && id === Number(x.id))
								stopB.push(
									`${card} ${d.nodeKey}: offers '${x.label}', the shipped default at ${a.split("\u0000")[0]}`
								)
					}
				}
				const key = `${c.genre}|${c.preset}|${slug}`
				if (!ranOnce.has(key)) ranOnce.add(key)
			}
		}
		for (const [card, n] of cardRows)
			if (n > 8) stopA.push(`${card}: ${n} rows`)

		// The administrator's screens outside a session.
		const adminOffered = new Map<string, string[]>()
		const removed = new Map<
			string,
			{ pipeline: string; nodeKey: string; names: string[] }
		>()
		const slugs = [...new Set(table.map((r) => r.pipeline))].sort(cmp)
		// Every pipeline a genre or preset runs, not only those with a row in a card.
		for (const slug of slugs) {
			const { at, decls, defaults } = await pubOf(slug)
			const view = await namespaceView(db, SECRET, slug, {
				userId: adminUser.id,
				isAdmin: true
			})
			if (!view) continue
			for (const o of groupOptions(view.groups)) {
				if (o.control !== "prompts-ref") continue
				const d = decls.find(
					(x) =>
						x.control === "prompts-ref" &&
						optionId(SECRET, x.nodeKey, x.slot, x.path) === o.id
				)
				if (!d?.nodeDefinitionId) continue
				const pool = await listPrompts(db, d.nodeDefinitionId, d.slot)
				const before = note37(pool, at.specId, o.value, defaults.get(addr(d)), true)
				const kept = new Set((o.choices ?? []).map((x) => x.label))
				adminOffered.set(`${slug}|${d.nodeKey}`, [...kept])
				const names = before
					.map((p: any) => p.name as string)
					.filter((n) => !kept.has(n))
				if (!names.length) continue
				const k = `${slug}|${d.nodeKey}`
				const e = removed.get(k) ?? { pipeline: slug, nodeKey: d.nodeKey, names: [] }
				for (const n of names) if (!e.names.includes(n)) e.names.push(n)
				removed.set(k, e)
			}
		}
		const removedList = [...removed.values()]
			.map((e) => ({ ...e, names: e.names.sort(cmp) }))
			.sort((a, b) => cmp(a.pipeline, b.pipeline) || cmp(a.nodeKey, b.nodeKey))

		table.sort(
			(a, b) =>
				cmp(a.genre, b.genre) ||
				cmp(a.preset, b.preset) ||
				cmp(a.pipeline, b.pipeline) ||
				cmp(a.nodeKey, b.nodeKey)
		)
		console.log("PROMPTS_TABLE " + JSON.stringify(table, null, 1))
		console.log("PROMPTS_REMOVED " + JSON.stringify(removedList, null, 1))
		console.log("PROMPTS_COUNTS raw -> note-37 -> offered\n" + counts.join("\n"))

		expect(stopA, `cards with more than 8 rows:\n${stopA.join("\n")}`).toEqual([])
		expect(
			[...new Set(stopB)],
			`calls offering another call's shipped default:\n${[...new Set(stopB)].join("\n")}`
		).toEqual([])
		expect(removedList).toEqual(REMOVED_ON_ADMIN_SCREENS)
		// A prompt that records no pipeline is still offered to an administrator outside a session.
		expect(
			adminOffered.get("core:spec/summarize-character|drafting.item.draft"),
			"administrator's summarize-character drafting"
		).toEqual(
			expect.arrayContaining(["Default Scene Summarization", "Scene Summarization (transcript)"])
		)
		expect(table).toEqual(EXPECTED)
	})
})
