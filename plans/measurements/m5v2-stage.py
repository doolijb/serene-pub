#!/usr/bin/env python3
"""Measurement 5: can a local model judge entrances and exits ("departures, not errands") from the newest lines?
20 hard cases x N seeds. A wrong exit is the costly error (it silences a character), so it is counted apart."""
import json, sys, urllib.request, time
MODEL = sys.argv[1]; N = int(sys.argv[2]) if len(sys.argv) > 2 else 3
SYSTEM = """You keep track of where the characters of an ongoing story are. Read the newest lines and say where each listed character is at the END of them. Answer in JSON only: one key per listed character, each value one of the words below.

For a character In the scene:
"here": still with the others (also: silent, asleep, or saying they will go but not gone yet).
"stepped out": close by and expected back: another room, the porch, a quick errand.
"gone": away for the rest of the scene: went home, stormed off, set off elsewhere, was taken away.

For a character Elsewhere:
"elsewhere": not with the others (also: only mentioned, remembered, imagined, written to, sent for, or heard from another room).
"called": someone in the scene calls out to them directly, and they are close enough to hear and come at once.
"here": the lines show them coming in.

If everyone in the scene travels on together, they are all "here". When unsure, keep "here" for a character In the scene and "elsewhere" for one Elsewhere."""
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
            "keep_alive": "20m", "think": False, "options": {"seed": seed, "temperature": 0.3, "num_predict": 90, "num_ctx": 2048}}
    req = urllib.request.Request("http://127.0.0.1:11434/api/chat", json.dumps(body).encode(), {"Content-Type": "application/json"})
    raw = json.load(urllib.request.urlopen(req, timeout=300))["message"]["content"]
    try:
        j = json.loads(raw)
        ins = [n for n in ("Aldric", "Bren", "Mira") if (case[1] is None or n in case[1].split("In the scene:")[1])]
        gone = sorted(n for n in ins if str(j.get(n, "")).lower() == "gone")
        if len(gone) == len(ins): gone = []  # code: everyone gone together is the group moving on, not an exit
        outs = [n for n in ("Corin", "Dessa", "Tam", "Bren") if n not in ins]
        arrived = sorted(n for n in outs if str(j.get(n, "")).lower() in ("here", "called"))
        return gone, arrived, raw
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
