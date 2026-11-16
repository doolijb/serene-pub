#!/usr/bin/env python3
"""Measurement 1 (plan §7.1): does leaving out messages a character was not present for stop a secret slipping?
Three conditions x N seeds x two probes, per model. Slip = the reply reveals the hiding place."""
import json, sys, urllib.request, re, time
MODEL = sys.argv[1]; N = int(sys.argv[2]) if len(sys.argv) > 2 else 20
SYSTEM = """You are playing Tobin in an ongoing roleplay. Write only Tobin's next reply: his words and actions, two to four sentences, in third person past tense. Never write for Ash or Mira.

Tobin: a courier in his twenties, quick, curious, a little too fond of gossip. He arrived at the Lantern Inn this evening after a week on the north road.
Mira: the innkeeper of the Lantern Inn, steady and discreet.
Ash: a traveller staying at the inn (played by the user).

The Lantern Inn: a two-storey coaching inn with a great hearth in the common room."""
SCENE_A = [  # Tobin is NOT present: he is still on the road
 ("user", "Ash: Ash waited until the common room emptied, then leaned over the counter. \"Mira, I need to hide something before the tax men come through.\""),
 ("assistant", "Mira: Mira set down the mug she was drying. \"Go on, then. Quietly.\""),
 ("user", "Ash: \"The silver key. I've sewn it into the lining of the grey mule's saddle blanket, out in the stable. Nobody else is to know.\""),
 ("assistant", "Mira: \"In the mule's saddle blanket. I'll see nobody borrows the beast,\" Mira said, and went back to her mugs as if nothing had passed between them."),
]
SCENE_B_OPEN = [  # Tobin arrives; present from here
 ("user", "Ash: That evening the door banged open on a gust of rain and a mud-spattered courier came in, shaking out his cloak. Ash looked up from the fire. \"You look like you've ridden hard.\""),
 ("assistant", "Tobin: \"A week on the north road,\" Tobin said, dropping onto the bench by the hearth and stretching his boots toward the flames. \"Tobin. I carry letters, and I'd trade any of them for a bowl of something hot.\""),
 ("user", "Ash: Mira brought stew and left them to it. Ash turned his cup in his hands for a while."),
]
PROBES = {
 "direct": "Ash: \"Tobin, you've an eye for things. If a man had a silver key he wanted kept from the tax men, where in this inn do you suppose he'd have hidden it?\"",
 "indirect": "Ash: \"Tell me honestly, Tobin. Do you know anything about what Mira and I arranged this morning?\"",
}
NOTE = "(Tobin was not present for the conversation between Ash and Mira earlier and does not know what was said.)"
SLIP = re.compile(r"saddle|blanket|mule|lining|sewn", re.I)
def chat(messages, seed):
    body = {"model": MODEL, "messages": messages, "stream": False, "keep_alive": "20m",
            "options": {"seed": seed, "temperature": 0.8, "num_predict": 170, "num_ctx": 4096}}
    req = urllib.request.Request("http://127.0.0.1:11434/api/chat", json.dumps(body).encode(), {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=300))["message"]["content"]
def build(cond, probe):
    msgs = [{"role": "system", "content": SYSTEM + ("\n\n" + NOTE if cond == "told" else "")}]
    hist = (SCENE_A if cond in ("full", "told") else []) + SCENE_B_OPEN + [("user", PROBES[probe])]
    for role, text in hist: msgs.append({"role": role, "content": text})
    return msgs
out = {"model": MODEL, "n": N, "results": {}, "samples": {}}
t0 = time.time()
for probe in PROBES:
    for cond in ("full", "told", "left_out"):
        slips = 0; samples = []
        for seed in range(1, N + 1):
            r = chat(build(cond, probe), seed)
            hit = bool(SLIP.search(r)); slips += hit
            if len(samples) < 2 or (hit and len(samples) < 4): samples.append(("SLIP " if hit else "ok   ") + r.replace("\n", " ")[:260])
        out["results"][f"{probe}/{cond}"] = f"{slips}/{N}"
        out["samples"][f"{probe}/{cond}"] = samples
        print(probe, cond, f"{slips}/{N}", f"{time.time()-t0:.0f}s", flush=True)
json.dump(out, open(sys.argv[3], "w"), indent=1)
