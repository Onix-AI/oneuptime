# Upgrading OneUptime

How to upgrade the OneUptime deployment at `monitor.onixai.ai`.

## Architecture

- **Fork**: `github.com/Onix-AI/oneuptime` — `onix` branch
- **Upstream**: `github.com/OneUptime/oneuptime` — added as `upstream` remote locally
- **GCP VM** (`oneuptime-production`): clones from the fork via SSH deploy key, tracks the `onix` branch
- **Docker images**: `APP_TAG=release` (floating tag from Docker Hub, always latest)
- **Secrets**: Doppler → auto-syncs to GCP Secret Manager → `fetch-secrets.sh` writes `config.env`
- **Deploy key**: Read-only SSH key on the VM, registered as a deploy key on the GitHub repo

## Prerequisites

The VM authenticates to the private fork via a read-only SSH deploy key. If setting up a new VM, see "Phase 6: VM Software Setup" in [INFRASTRUCTURE.md](INFRASTRUCTURE.md) for deploy key setup steps.

## Routine Update Workflow

### 1. Local: Merge upstream into onix

```bash
cd /path/to/oneuptime
git checkout onix
git fetch upstream
git merge upstream/release -m "Merge upstream/release (<version>) into onix"
# Resolve conflicts (usually docker-compose.override.yml — keep ours)
git push origin onix
```

### 2. Check for new env vars

Compare `config.example.env` between old and new:
```bash
git diff HEAD~1..HEAD -- config.example.env
```

If new vars were added:
1. Add them to **Doppler** (production config) — they auto-sync to GCP Secret Manager
2. Add the secret names to `fetch-secrets.sh` on the VM (the SECRETS array)

### 3. Server: SSH and pull

```bash
gcloud compute ssh oneuptime-production \
  --zone=northamerica-northeast1-a \
  --project=onix-ai-oneuptime-production \
  --tunnel-through-iap
```

Then on the VM:
```bash
cd /opt/oneuptime
git pull origin onix
./fetch-secrets.sh
export $(grep -v '^#' config.env | xargs)
docker compose pull
docker compose up --remove-orphans -d
```

### 4. Re-apply patches (if still needed)

Check if each patch has been fixed upstream (see `Onix/PATCHES.md`).

If still needed:
1. Extract the fresh file from the new container image
2. Re-apply the patch edits
3. The volume mount in `docker-compose.override.yml` handles the rest

See `Onix/PATCHES.md` for per-patch instructions.

### 5. Verify

```bash
docker compose ps
curl -I https://monitor.onixai.ai
# Check patches — see PATCHES.md verification commands
```

## When to Take a Snapshot First

- Major version jumps (e.g., 9.x → 10.x)
- Database migrations present
- First upgrade after a long gap

```bash
# From local machine:
gcloud compute disks snapshot oneuptime-production \
  --zone=northamerica-northeast1-a \
  --project=onix-ai-oneuptime-production \
  --snapshot-names=oneuptime-snapshot-$(date +%Y%m%d)-pre-upgrade
```

## Rollback

**Quick** — revert to a previous commit:
```bash
cd /opt/oneuptime
git log --oneline -5                    # find the previous good commit
git checkout <commit-hash>
export $(grep -v '^#' config.env | xargs)
docker compose pull
docker compose up --remove-orphans -d
```

**Full** — restore from disk snapshot via GCP Console.
