# ais-cache

Persistent AISStream relay with HTTP/SSE API.

## Why

[aisstream.io](https://aisstream.io) only offers a single WebSocket per API key
and no REST API. This service holds **one** persistent connection, decodes
position reports for a configured bounding box (default = Gulf of Finland +
Estonia), keeps last-known fixes in memory + optional Upstash Redis mirror,
and exposes a small REST/SSE API that stateless callers (Vercel functions,
marina UIs, agents) can hit cheaply.

## Endpoints

| Method | Path                                                        | Purpose                                  |
| ------ | ----------------------------------------------------------- | ---------------------------------------- |
| GET    | `/healthz`                                                  | Railway health probe                     |
| GET    | `/api/v1/snapshot?mmsi=NNN`                                 | Last-known fix for one vessel            |
| GET    | `/api/v1/snapshots?mmsi=A,B,C`                              | Bulk lookup (≤ 50)                       |
| GET    | `/api/v1/bbox?lat1=..&lon1=..&lat2=..&lon2=..`              | All tracked vessels in bbox              |
| GET    | `/api/v1/stream?mmsi=A,B`                                   | Server-Sent Events push (omit mmsi = all)|
| GET    | `/api/v1/stats`                                             | Connection health + counters             |

All `/api/v1/*` endpoints require `Authorization: Bearer $HTTP_AUTH_TOKEN` if
that env var is set.

## Snapshot shape

```json
{
  "mmsi": "276009980",
  "lat": 59.5742,
  "lon": 25.7430,
  "sog": 0.0,
  "cog": 0.0,
  "heading": 511,
  "navStatus": -1,
  "name": "VAIANA",
  "destination": "HARA",
  "type": 36,
  "ts": 1746205820123
}
```

## Configuration

| Env var                    | Default                              | Notes                              |
| -------------------------- | ------------------------------------ | ---------------------------------- |
| `AISSTREAM_API_KEY`        | required                             | from aisstream.io                  |
| `AIS_BBOXES`               | `[[[60.5,22.0],[57.5,30.5]]]`        | JSON list of `[[lat,lon],[lat,lon]]` corners |
| `AIS_MMSI_FILTER`          | empty                                | comma-separated, ≤ 50, optional    |
| `SNAPSHOT_TTL_SECONDS`     | `3600`                               | drop fixes older than this         |
| `HTTP_AUTH_TOKEN`          | empty                                | bearer token; if empty, API is open |
| `UPSTASH_REDIS_REST_URL`   | empty                                | optional mirror (key `ais:snap:NNN`) |
| `UPSTASH_REDIS_REST_TOKEN` | empty                                | matched to URL                     |
| `PORT`                     | `8080`                               | Railway-injected                   |

## Local run

```bash
export AISSTREAM_API_KEY=xxx
go run .
curl localhost:8080/api/v1/stats
curl 'localhost:8080/api/v1/snapshot?mmsi=276009980'
curl -N localhost:8080/api/v1/stream
```

## Deploy on Railway

```bash
cd infra/ais-cache
railway up           # link the service first via `railway link`
railway variables --set AISSTREAM_API_KEY=...
railway variables --set HTTP_AUTH_TOKEN=$(openssl rand -hex 24)
```

The Vercel app reads `AIS_CACHE_URL` + `AIS_CACHE_TOKEN` to call this service.
