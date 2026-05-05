# EMQX on Railway — Hara Marina

This subfolder deploys an EMQX 5 broker to Railway. It is pre-configured to:

- run a single node (Railway = one container)
- expose **dashboard** on Railway's HTTP domain (port 18083)
- expose **MQTT/TCP (1883)** on Railway's TCP proxy
- forward every `marina/+/telemetry` MQTT message to the marina HTTP ingest
  endpoint via a baked-in EMQX rule + webhook
- persist its data dir across restarts via a Railway volume

Boats authenticate with username/password (built-in DB). Anonymous publish is
disabled.

---

## Required environment variables (set in Railway dashboard)

| Variable                              | Purpose                                                                 |
|---------------------------------------|-------------------------------------------------------------------------|
| `MARINA_INGEST_URL`                   | (optional) Marina ingest endpoint. Default: `https://hara-marina.mereveer.ee/api/ingest/telemetry` |
| `MARINA_INGEST_TOKEN`                 | **Required.** Same token as Vercel's `MARINA_INGEST_TOKEN`.            |
| `EMQX_DASHBOARD__DEFAULT_USERNAME`    | Dashboard login (default `admin`)                                       |
| `EMQX_DASHBOARD__DEFAULT_PASSWORD`    | **Required.** Dashboard password (>= 8 chars).                          |
| `EMQX_API_KEY__BOOTSTRAP_FILE`        | (optional) Path to API key bootstrap file for programmatic admin.       |

The bootstrap entrypoint substitutes `MARINA_INGEST_URL` /
`MARINA_INGEST_TOKEN` into the HOCON template **only on first boot**. After
that, edits made through the dashboard win — re-deploy with the volume wiped
to re-seed.

---

## Volume

Mount a Railway volume at **`/opt/emqx/data`** so:

- The dashboard password isn't reset on every redeploy
- The bootstrapped `cluster.hocon` survives
- The built-in user database survives
- The bridge buffer survives short outages of the marina API

---

## Exposed ports

| Internal port | Purpose      | Railway exposure                        |
|---------------|--------------|------------------------------------------|
| 18083         | Dashboard    | HTTP domain (https://*.up.railway.app)   |
| 1883          | MQTT TCP     | TCP proxy (tcp.railway.app:NNNNN)        |
| 8083          | MQTT WS      | (optional) HTTP domain w/ separate path  |

The dashboard is intended to live behind the public Railway HTTPS URL —
**change the default password before publishing the URL to anyone.**

For production boats, switch to MQTT-over-TLS (8883) with proper certs once a
custom domain is attached. Until then, MQTT/TCP on the Railway TCP proxy is
acceptable for development.

---

## After first deploy

1. Open the Railway HTTP URL → log in to the EMQX dashboard.
2. **Access Control → Authentication → Add → Password-based → built-in DB →
   Create.** This enables username/password authentication.
3. **Access Control → Authorization → Add → built-in DB → Create.** Enable
   ACL enforcement.
4. **Access Control → Users → Add** for each boat:
   - Username: `boat-<slug>` (e.g. `boat-moi`)
   - Password: `openssl rand -hex 16`
5. **Access Control → Authorization → Source: built-in DB**, add ACL rules:
   - `boat-<slug>`: publish/subscribe `marina/<slug>/#` allow
   - All others: deny
6. **Integration → Rules** → confirm `marina_telemetry_forward` exists and
   is **enabled** (it should be auto-created by the bootstrap template).
   - If missing, see `docs/EMQX_SETUP.md` (project root) for the manual rule
     setup.

Smoke test (replacing `<host>`/`<port>` with the Railway TCP proxy values
and `<password>` with the boat's MQTT password):

```bash
mosquitto_pub \
  -h <host> -p <port> \
  -u boat-moi -P <password> \
  -t marina/moi/telemetry -q 1 -r \
  -m '{"battery":{"voltage":12.7,"percent":82}}'
```

Then sign in to https://hara-marina.mereveer.ee/login and open `/moi`. The
telemetry tile should show `● live` with `source: "live"` in the underlying
API response.

---

## Files

| File                       | Purpose                                          |
|----------------------------|--------------------------------------------------|
| `Dockerfile`               | Customised EMQX image                            |
| `cluster.hocon.template`   | Connector + Action + Rule (templated on boot)    |
| `bootstrap.sh`             | Substitutes env vars then execs EMQX             |
| `railway.toml`             | Railway build/deploy config                      |
