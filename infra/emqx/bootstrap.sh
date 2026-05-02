#!/bin/sh
# Bootstrap EMQX:
#   1. Fix volume ownership if mounted as root.
#   2. Start EMQX as the `emqx` user.
#   3. After it's up, provision the marina connector/action/rule via the
#      dashboard REST API (well-tested code path, unlike templating HOCON).
#
# Container starts as root because Railway mounts the data volume as root-owned.
set -eu

if [ "$(id -u)" = "0" ]; then
  chown -R emqx:emqx /opt/emqx/data /opt/emqx/log 2>/dev/null || true
fi

# Remove any stale dashboard-managed cluster.hocon so the API-provisioned
# state below is canonical. Mnesia (users / ACLs) under data/mnesia is kept.
rm -f /opt/emqx/data/configs/cluster.hocon

# Background: provision the marina rule once EMQX is healthy.
if [ -n "${MARINA_INGEST_TOKEN:-}" ]; then
  ( /usr/local/bin/provision.sh 2>&1 | sed 's/^/[provision] /' ) &
else
  echo "[bootstrap] WARNING: MARINA_INGEST_TOKEN not set — skipping auto-provision"
fi

# Drop to emqx user and exec EMQX foreground.
if [ "$(id -u)" = "0" ]; then
  exec su -s /bin/sh emqx -c "exec /usr/bin/docker-entrypoint.sh emqx foreground"
else
  exec /usr/bin/docker-entrypoint.sh emqx foreground
fi
