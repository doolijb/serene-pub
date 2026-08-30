-- Reverts 0161. That column existed only because SP served the app and
-- Socket.IO from two HTTP listeners, so a quick tunnel needed two hostnames to
-- front them both. Socket.IO now shares the app's server — one port, one
-- hostname, one tunnel process — so the column has nothing left to hold.
--
-- IF EXISTS because 0161 shipped and was reverted inside the same pre-release
-- window: an instance that never applied it must not fail here.
ALTER TABLE "tunnels" DROP COLUMN IF EXISTS "socket_hostname";
