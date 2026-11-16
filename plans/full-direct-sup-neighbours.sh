#!/bin/bash
cd /home/jody/github/serene-pub
for d in pipelines/runtime lorebooks sessions state; do
  n=$(echo $d | tr / -)
  timeout 900 bash -c 'while ps -eo args | grep -E "node.*vitest" | grep -v grep >/dev/null; do sleep 15; done'
  flock plans/full-direct-vitest.lock systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 src/lib/server/$d > /home/jody/github/serene-pub/plans/full-direct-sup-n-$n.log 2>&1"
done
timeout 900 bash -c 'while ps -eo args | grep -E "node.*vitest" | grep -v grep >/dev/null; do sleep 15; done'
flock plans/full-direct-vitest.lock systemd-run --user --scope -p MemoryMax=10G -p MemorySwapMax=0 --quiet bash -c "npx vitest run --maxWorkers=3 $(ls src/lib/server/sockets/sessions.lair*.int.test.ts | tr '\n' ' ') > /home/jody/github/serene-pub/plans/full-direct-sup-n-lair.log 2>&1"
echo done
