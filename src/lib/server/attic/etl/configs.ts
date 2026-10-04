/**
 * What the upgrade does NOT carry from a 0.5.3 config, said once.
 *
 * The attic wiring brings a config's **prompt text** across and nothing else
 * (owner ruling, 2026-10-01: "No need to customize the pipelines/presets other
 * than the prompt text. Do not patch in the context templates during the
 * upgrade."). Everything else a person set on one is an accepted loss, and
 * each kind is one upgrade note naming the configs it touched:
 *
 *   · a prompt or narrator config's own post-history placement or trigger;
 *   · a config's own connection or sampling pick for any of its steps;
 *   · every context config a person wrote — 0.6 renders through its own
 *     context templates, and the text stays in the pre-upgrade backup.
 *
 * Read here, in the restore, because the restore's summary counts the notes.
 */
import * as attic from "../tables"
import type { RestoreContext } from "../context"

/** What 0.5.3 seeded these with — a row still holding them changed nothing. */
const SEEDED_POST_HISTORY = {
	prompt_configs: { postHistoryDepth: 0, postHistoryTokenTrigger: 3000 },
	narrator_prompt_configs: { postHistoryDepth: 0, postHistoryTokenTrigger: 0 }
} as const

const isPick = (column: string) =>
	column === "connectionId" ||
	column === "samplingConfigId" ||
	column.endsWith("ConnectionId") ||
	column.endsWith("SamplingConfigId")

const list = (names: string[]) => names.map((n) => `"${n}"`).join(", ")

export async function noteUncarriedConfigParts(ctx: RestoreContext): Promise<void> {
	const { tx } = ctx

	const tuned: Array<{ name: string; was: string }> = []
	for (const [table, rows] of [
		["prompt_configs", await tx.select().from(attic.promptConfigs)],
		["narrator_prompt_configs", await tx.select().from(attic.narratorPromptConfigs)]
	] as const) {
		const seeded = SEEDED_POST_HISTORY[table]
		for (const r of rows) {
			if (r.seedKey) continue
			const depth = r.postHistoryDepth ?? seeded.postHistoryDepth
			const trigger = r.postHistoryTokenTrigger ?? seeded.postHistoryTokenTrigger
			if (depth !== seeded.postHistoryDepth || trigger !== seeded.postHistoryTokenTrigger)
				tuned.push({ name: r.name, was: `depth ${depth}, trigger ${trigger}` })
		}
	}
	if (tuned.length)
		ctx.notes.add({
			topic: "accepted-loss",
			objectLabel: "post-history settings on configs",
			summary: `${tuned.length} prompt or narrator config(s) placed or triggered the post-history reminder their own way (${list(tuned.map((t) => t.name))}). The upgrade carries prompt text only, so they follow the pipeline's settings now; set them again under Admin → Pipelines if you want them.`,
			changes: tuned.map((t) => ({ field: t.name, label: t.name, before: t.was }))
		})

	const picked: Array<{ name: string; was: string }> = []
	for (const table of [
		attic.promptConfigs,
		attic.narratorPromptConfigs,
		attic.worldSummarizeConfigs,
		attic.characterSummarizeConfigs,
		attic.sceneSummarizeConfigs,
		attic.graphBuildConfigs
	]) {
		for (const r of (await tx.select().from(table)) as Array<Record<string, unknown>>) {
			const picks = Object.entries(r).filter(([k, v]) => isPick(k) && v != null)
			if (picks.length)
				picked.push({
					name: String(r.name),
					was: picks.map(([k, v]) => `${k} ${v}`).join(", ")
				})
		}
	}
	if (picked.length)
		ctx.notes.add({
			topic: "accepted-loss",
			objectLabel: "connection and sampling picks on configs",
			summary: `${picked.length} config(s) chose their own connection or sampling for a step (${list(picked.map((p) => p.name))}). The upgrade carries prompt text only, so those steps use the pub's defaults now; pick them again under Admin → Pipelines if you want them.`,
			changes: picked.map((p) => ({ field: p.name, label: p.name, before: p.was }))
		})

	const contexts = (await tx.select().from(attic.contextConfigs)).filter((c) => !c.seedKey)
	if (contexts.length)
		ctx.notes.add({
			topic: "accepted-loss",
			objectLabel: "context configs",
			summary: `${contexts.length} context config(s) you wrote (${list(contexts.map((c) => c.name))}) were not carried over: 0.6 renders every prompt through its own context templates, and whichever one was selected, the shipped template is selected now. The text is in the pre-upgrade backup.`,
			changes: contexts.map((c) => ({ field: c.name, label: c.name, before: c.template ?? "" }))
		})
}
