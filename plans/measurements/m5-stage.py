#!/usr/bin/env python3
"""Measurement 5: can a local model judge entrances and exits ("departures, not errands") from the newest lines?
20 hard cases x N seeds. A wrong exit is the costly error (it silences a character), so it is counted apart."""
import json, sys, urllib.request, time
MODEL = sys.argv[1]; N = int(sys.argv[2]) if len(sys.argv) > 2 else 3
SYSTEM = """You keep track of who is present in a scene of an ongoing story. Read the newest lines and answer in JSON only: {"left": [names], "arrived": [names]}.

"left": characters In the scene who, by the END of the newest lines, have gone away for the rest of the scene: went home, stormed out, set off somewhere else, were taken away.
Not left: stepping into another room or outside for a moment, fetching something, an errand they will be back from, leaving and coming back within these lines, saying they will go but still being here, falling silent or asleep.
If everyone moves to a new place together, nobody left.

"arrived": characters listed as Elsewhere who, by the END of the newest lines, are now with the others: the lines show them coming in, or someone here calls for them and they are close enough to come at once.
Not arrived: only mentioned, remembered, imagined, written to, sent for but not here yet, heard from another room, or too far away to come.

When unsure, leave a list empty."""
SCENE = "In the scene: Aldric, Bren, Mira (the common room of the Lantern Inn)."
ELSE = "Elsewhere: Corin (upstairs in the inn, asleep); Dessa (at the market across town); Tam (in the capital, three days' ride away)."
C = [
 ("tea run in one message", None, 'Mira hurried to the kitchen, set the kettle on, and came back with three cups of tea on a tray.', [], []),
 ("errand, not back yet", None, 'Mira went through to the kitchen to put the kettle on.', [], []),
 ("storms out", None, '"I have heard enough," Bren snapped. He slammed the door behind him and stalked off into the night.', ["Bren"], []),
 ("called from upstairs", None, 'Aldric went to the foot of the stairs and bellowed, "Corin! Get down here, now!"', [], ["Corin"]),
 ("mentioned only", None, '"I wish Corin were awake to hear this," Mira said quietly.', [], []),
 ("called but far away", None, 'Aldric threw open the shutters and shouted into the street, "Tam! Tam, where are you when I need you!"', [], []),
 ("narrated arrival", None, 'The door opened and Dessa came in from the market, a basket on her arm. "You would not believe the price of eggs."', [], ["Dessa"]),
 ("whole group moves", None, 'The three of them left the inn and walked down to the docks together, still arguing.', [], []),
 ("goes home for the night", None, 'Mira yawned, said her goodnights, and went home.', ["Mira"], []),
 ("taken away", None, 'Two guards seized Bren by the arms and hauled him off to the cells.', ["Bren"], []),
 ("steps outside for air", None, 'Bren stepped out onto the porch for a breath of air, leaving the door ajar behind him.', [], []),
 ("falls asleep in the room", None, 'Aldric sank into the chair by the hearth and was snoring within moments.', [], []),
 ("says he will go, stays", None, '"I should be going soon," Bren said, reaching for his coat. "But one more drink first."', [], []),
 ("one leaves as one arrives", None, 'Bren left for his shift at the mill just as Dessa walked in, shaking rain from her shawl.', ["Bren"], ["Dessa"]),
 ("writes a letter", None, 'Aldric sat down at the corner table and began a letter to Tam.', [], []),
 ("sent for, not here yet", None, 'Aldric sent the stable boy running to the market to fetch Dessa.', [], []),
 ("imagined", None, 'Mira could almost see Corin standing in the doorway, as he had that first winter.', [], []),
 ("the group splits", None, 'Aldric and Bren set off for the quarry, leaving Mira to mind the inn.', ["Aldric", "Bren"], []),
 ("heard through the ceiling", None, "Corin's voice came muffled through the ceiling: \"Keep it down, some of us are sleeping!\"", [], []),
 ("comes back after leaving", "Elsewhere: Bren (left a while ago, walking home); Dessa (at the market across town); Tam (in the capital, three days' ride away).\nIn the scene: Aldric, Mira (the common room of the Lantern Inn).",
  'Bren came back through the door, shamefaced. "Forgot my hat."', [], ["Bren"]),
]
def ask(case, seed):
    head = case[1] if case[1] else SCENE + "\n" + ELSE
    user = head + "\n\nNewest lines:\n" + case[2]
    body = {"model": MODEL, "messages": [{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}], "stream": False, "format": "json",
            "keep_alive": "20m", "think": False, "options": {"seed": seed, "temperature": 0.3, "num_predict": 60, "num_ctx": 2048}}
    req = urllib.request.Request("http://127.0.0.1:11434/api/chat", json.dumps(body).encode(), {"Content-Type": "application/json"})
    raw = json.load(urllib.request.urlopen(req, timeout=300))["message"]["content"]
    try:
        j = json.loads(raw); return sorted(map(str, j.get("left", []))), sorted(map(str, j.get("arrived", []))), raw
    except Exception:
        return None, None, raw
out = {"model": MODEL, "n": N, "cases": []}; t0 = time.time(); right = wrong_exit = wrong_entry = missed_exit = missed_entry = bad = 0
for case in C:
    row = {"case": case[0], "want": {"left": case[3], "arrived": case[4]}, "got": []}
    for seed in range(1, N + 1):
        left, arrived, raw = ask(case, seed)
        if left is None: bad += 1; row["got"].append({"raw": raw[:120]}); continue
        ok = left == sorted(case[3]) and arrived == sorted(case[4]); right += ok
        wrong_exit += any(x not in case[3] for x in left); wrong_entry += any(x not in case[4] for x in arrived)
        missed_exit += any(x not in left for x in case[3]); missed_entry += any(x not in arrived for x in case[4])
        row["got"].append({"left": left, "arrived": arrived, "ok": ok})
    out["cases"].append(row)
total = len(C) * N
out["summary"] = {"total": total, "right": right, "wrong_exit": wrong_exit, "wrong_entrance": wrong_entry, "missed_exit": missed_exit, "missed_entrance": missed_entry, "unparsed": bad, "seconds": round(time.time() - t0)}
json.dump(out, open(sys.argv[3], "w"), indent=1)
print(json.dumps(out["summary"]))
for r in out["cases"]:
    n_ok = sum(1 for g in r["got"] if g.get("ok"))
    if n_ok < N: print(f"  {n_ok}/{N} {r['case']}: want {r['want']} got {[ (g.get('left'), g.get('arrived')) for g in r['got']]}")
