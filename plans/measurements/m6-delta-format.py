#!/usr/bin/env python3
"""Measurement 6: a History day's distance from now, in words against a signed delta in the date's own format.
One stale event (3 years old) in the History shape x N seeds. 'Still' = the reply acts as if it just happened."""
import json, sys, urllib.request, re, time
MODEL = sys.argv[1]; N = int(sys.argv[2]) if len(sys.argv) > 2 else 20
HEAD = """You are playing Mira in an ongoing roleplay. Write only Mira's next reply: her words and actions, two to four sentences, in third person past tense. Never write for Ash.

Mira: the innkeeper of the Lantern Inn, steady and discreet.
Ash: a traveller (played by the user).
The story's present: 10-04-12.

Story history (JSON):
"""
FACT = "Mira is furious with Ash: he broke her late husband's lute and left without a word."
def lore(key):
    return json.dumps({key: FACT, "10-04-11": "A quiet day at the Lantern Inn; rain from noon."}, indent=1)
VARIANTS = {
 "date_only":       lore("7-04-12"),
 "words":           lore("7-04-12 (3 years ago)"),
 "signed_same_fmt": lore("7-04-12 (-3-00-00)"),
 "signed_units":    lore("7-04-12 (-3y 0m 0d)"),
}
BASE = HEAD
USER = "Ash: Ash pushed open the inn door, shook the rain from his coat and gave the innkeeper a tentative smile. \"Evening, Mira. Is there a room free?\""
# 'Still furious' markers vs markers of time having passed.
STILL = re.compile(r"furious|fury|glar|cold(ly)?|icy|scowl|you have (some|a) nerve|nerve to|get out|not welcome|how dare|narrow(ed)? (her )?eyes|lips? (thin|press)|stiff", re.I)
PASSED = re.compile(r"years|long time|been a while|after all this time|three|old (grudge|anger|wound)|water under|forgiv|let it go|used to|once", re.I)
def chat(system, seed):
    body = {"model": MODEL, "messages": [{"role": "system", "content": system}, {"role": "user", "content": USER}], "stream": False,
            "keep_alive": "20m", "options": {"seed": seed, "temperature": 0.8, "num_predict": 170, "num_ctx": 4096}}
    req = urllib.request.Request("http://127.0.0.1:11434/api/chat", json.dumps(body).encode(), {"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(req, timeout=300))["message"]["content"]
out = {"model": MODEL, "n": N, "results": {}, "samples": {}}
t0 = time.time()
for name, line in VARIANTS.items():
    still = passed = 0; samples = []
    for seed in range(1, N + 1):
        r = chat(BASE + line, seed)
        s, p = bool(STILL.search(r)), bool(PASSED.search(r)); still += s; passed += p
        if len(samples) < 3: samples.append(f"[still={int(s)} passed={int(p)}] " + r.replace("\n", " ")[:280])
    out["results"][name] = {"acts_still_furious": f"{still}/{N}", "mentions_time_passing": f"{passed}/{N}"}
    out["samples"][name] = samples
    print(name, out["results"][name], f"{time.time()-t0:.0f}s", flush=True)
json.dump(out, open(sys.argv[3], "w"), indent=1)
