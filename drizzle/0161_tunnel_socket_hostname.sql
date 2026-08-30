-- The sockets hostname (26 §7). SP serves the app (PORT) and Socket.IO
-- (SOCKETS_PORT) from two separate HTTP listeners, and a Cloudflare Quick
-- Tunnel fronts exactly one local port on 443 — so a working ephemeral tunnel
-- needs two hostnames, not one. Null where a single hostname fronts both (a
-- named tunnel with two ingress rules, or a self-managed reverse proxy).
ALTER TABLE "tunnels" ADD COLUMN "socket_hostname" text;
