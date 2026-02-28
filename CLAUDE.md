# Claude Code Context

This is the **Onix AI fork** of [OneUptime](https://github.com/OneUptime/oneuptime), an open-source infrastructure monitoring platform. Deployed at `monitor.onixai.ai`.

## Key Facts

- **Branch:** `onix` (19 commits ahead of upstream `release`)
- **Upstream remote:** `upstream` pointing to `github.com/OneUptime/oneuptime`
- **Deployment:** GCP Spot VM (e2-standard-4, northamerica-northeast1-a), Cloudflare proxied
- **Patching strategy:** Extract files from Docker containers, edit, mount back via `docker-compose.override.yml` read-only volume mounts. This keeps upstream source unmodified for clean merges.

## Important Directories

- `Onix/` — All fork-specific files (docs, patches, infrastructure config exports)
  - `Onix/README.md` — Directory overview and deploy instructions
  - `Onix/INFRASTRUCTURE.md` — Full infrastructure docs with GCP recreation commands
  - `Onix/PATCHES.md` — All code patches + SSL certs + disabled services documentation
  - `Onix/UPGRADES.md` — Step-by-step upgrade procedure
  - `Onix/patches/` — Patched TypeScript files mounted into containers
  - `Onix/fetch-secrets.sh` — Reads GCP Secret Manager, writes `config.env`
- `docker-compose.override.yml` — SSL cert mount, patch mounts, postgres port closed, probe-2 disabled

## Active Patches (3)

All patches are single-file volume mounts defined in `docker-compose.override.yml`:

1. **CustomCodeMonitorCriteria.ts** → `probe-ingest` — JSON object result handling for custom code monitors
2. **StatusPageService.ts** → `app` — SSO redirect fix for custom domains with Cloudflare SSL
3. **RouteHandler.ts** → `mcp` — Per-session McpServer to fix SDK >=1.26.0 single-transport enforcement

## MCP Tools

The OneUptime MCP server is available as a configured MCP tool. Use it to interact with monitors, incidents, status pages, teams, and other OneUptime resources directly. Tool names are prefixed with `mcp__oneuptime__` (e.g., `mcp__oneuptime__list_monitors`).

## VM Operations

### SSH Access
```bash
gcloud compute ssh oneuptime-production \
  --zone=northamerica-northeast1-a \
  --project=onix-ai-oneuptime-production \
  --tunnel-through-iap
```

### Docker Commands on the VM
All commands run from `/opt/oneuptime`. Docker compose requires `config.env` environment variables, but the `npm run` scripts handle this automatically.

**Prefer npm scripts** — they handle env vars, `--remove-orphans`, and status checks:
```bash
cd /opt/oneuptime
npm start                              # docker compose up -d + status check
npm run stop                           # docker compose down
npm run pull                           # docker compose pull
npm run update                         # pull + start (full upgrade)
npm start --services=app               # restart just one service
```

**Raw docker compose** — when you need finer control, you must export env vars first:
```bash
export $(grep -v '^#' config.env | xargs) && docker compose <command>
```

**Commands that don't need env vars:**
```bash
docker compose ps                      # container status
docker compose logs -f <service>       # tail logs
docker system df                       # docker disk usage
```

Note: `docker restart` won't pick up volume mount changes — always use `npm start` or `docker compose up -d` to recreate containers.

### GCP CLI
```bash
# Project shorthand
PROJECT=onix-ai-oneuptime-production
ZONE=northamerica-northeast1-a

# VM status
gcloud compute instances describe oneuptime-production --zone=$ZONE --project=$PROJECT --format="value(status)"

# Pre-upgrade disk snapshot
gcloud compute disks snapshot oneuptime-production --zone=$ZONE --project=$PROJECT \
  --snapshot-names=oneuptime-snapshot-$(date +%Y%m%d)-pre-upgrade

# List secrets
gcloud secrets list --project=$PROJECT --format="value(name)"
```

## Secrets Management

Secrets are managed in **Doppler** (project: oneuptime, config: production), which automatically syncs to **GCP Secret Manager** with a `doppler-` prefix. To change a secret, update it in Doppler — it will sync to GCP automatically. On the VM, `Onix/fetch-secrets.sh` reads from GCP Secret Manager and writes `config.env`.

## Disk Space Management

The 80 GB VM disk is tight — Docker images alone are ~59 GB. A full `npm run pull` takes ~30 minutes. Clean old images before pulling new ones during upgrades.

### Check disk usage
```bash
df -h /                        # Overall disk usage
docker system df               # Docker-specific breakdown (images, containers, volumes, build cache)
```

### Free space safely (preserves database volumes)
```bash
# Remove all unused images (safe — does NOT touch volumes)
npm run stop
docker image prune -a -f

# Re-pull just one service's image (much faster than pulling everything)
docker image rm oneuptime/app:release
npm run pull                   # or: export $(grep -v '^#' config.env | xargs) && docker compose pull app
npm start
```

### NEVER run these
```bash
# docker system prune --volumes   ← DELETES DATABASE VOLUMES (postgres, clickhouse, redis)
# docker volume prune             ← SAME RISK — destroys data
```

Database volumes (postgres, clickhouse, redis) are the only stateful data on the VM, backed by daily disk snapshots. A restore means downtime — never prune volumes.

### Upgrade strategy when disk is nearly full
1. Take a disk snapshot first (see GCP CLI section above)
2. Stop services: `npm run stop`
3. Remove all images: `docker image prune -a -f` (frees ~59 GB)
4. Pull fresh: `npm run pull` (~30 min)
5. Start: `npm start`

If only one service changed, remove just that image and re-pull it instead of pulling everything.

## Working with This Fork

- Never modify upstream source files directly; use the extract-patch-mount approach documented in `Onix/PATCHES.md`
- `docker-compose.override.yml` is automatically merged by Docker Compose — no extra flags needed
- When upgrading, follow `Onix/UPGRADES.md` and re-extract/re-apply patches if needed
