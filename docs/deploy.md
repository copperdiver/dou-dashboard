# Deployment

Code isn't copied to the server. It arrives inside images from GHCR.
Only two files are needed from the repository.

## What to copy

| File | Where | Why |
|---|---|---|
| `docker-compose.prod.yml` | into the working directory, as-is | describes the stack |
| `.env.production.example` | same place, **renamed to `.env`** | environment values |

```
/opt/dou-dashboard/
├── docker-compose.prod.yml
└── .env
```

Everything else (source code, `node_modules`, `drizzle/`) is already in the images.
Migrations live in the worker image and are applied by the `dou-migrate` service.

## Images

```
ghcr.io/copperdiver/dou-dashboard-web
ghcr.io/copperdiver/dou-dashboard-worker
```

Image names are derived from `github.repository` in the workflow and aren't
recorded anywhere else. Two images cover three services: `dou-worker` and
`dou-migrate` differ only in their run command.

The packages are private, like the repository, so the server needs to log
in to the registry. It needs a token with `read:packages`:

```sh
echo "$GHCR_TOKEN" | docker login ghcr.io -u <username> --password-stdin
```

## What to fill in in .env

Required:

- `POSTGRES_PASSWORD`: the default password isn't acceptable on a server;
- `DOU_USER_AGENT`: with the default UA the source responds with 403.

Without these, `docker compose` refuses to start rather than coming up with
a silent default.

Worth checking:

- `PUBLIC_HOST`: the domain Traefik routes on; it's also used to build the
  URL for canonical links and `hreflang`;
- `IMAGE_TAG`: `latest` pulls the most recent build of the main branch; for
  predictable deploys, a release tag or a full commit sha is better.

LLM keys are optional: without them, denial reasons stay as the original
Portuguese text with no category.

## Network

Ingress is Traefik on the external `proxy` network; it also terminates TLS
and obtains the certificate (`certresolver=le`). No port is published
externally: `dou-web` only declares 3000 via `expose`, and Traefik reaches
it over the internal network.

The `proxy` network isn't created by this file. It's shared across the
server's projects. If it doesn't exist yet:

```sh
docker network create proxy
```

Postgres and Redis aren't on `proxy` at all and aren't reachable from
outside. Neither is the worker: it doesn't serve anything externally, it
only makes outbound calls to in.gov.br and the LLM provider.

## Startup

```sh
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml ps
```

## Updating and rolling back

```sh
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

`dou-migrate` runs first and exits; `dou-web` and `dou-worker` only start
after it exits successfully, so there's no race on the schema.

To roll back, edit `IMAGE_TAG` in `.env` and run `up -d` again. Migrations
aren't reversible, so a rollback is only safe as long as the previous
version can work with the new schema.

## Checking after deployment

```sh
docker compose -f docker-compose.prod.yml exec dou-web \
  node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>r.text()).then(console.log)"

curl -fsS https://dou.copperdiver.studio/api/health
docker compose -f docker-compose.prod.yml logs --tail=50 dou-worker
```

The "Status" section in the UI shows pump runs, the error rate, and the
schedule. It's how you can tell the pipeline is alive.
