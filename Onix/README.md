# Onix Infrastructure

This directory contains infrastructure documentation, configuration exports, and custom code for the Onix AI OneUptime deployment.

## Directory Structure

```
Onix/
├── INFRASTRUCTURE.md              Comprehensive infrastructure documentation
├── PATCHES.md                     OneUptime code patches applied to production
├── UPGRADES.md                    How to upgrade the production deployment
│
├── gcp/                           Google Cloud Platform (project: onix-ai-oneuptime-production)
│   ├── compute/                   VM, disk, and snapshot schedule configs
│   ├── networking/                VPC, subnet, firewall rules, static IP
│   ├── iam/                       IAM policy, service accounts, custom roles
│   ├── secret-manager/            Secret names and descriptions (no values)
│   ├── cloud-functions/           Cloud Function source code
│   ├── cloud-run/                 Cloud Run service config (managed by Cloud Functions)
│   └── cloud-scheduler/           Scheduler job config
│
├── patches/                       Patched TypeScript files mounted into containers
│
├── cloudflare/                    Cloudflare DNS records for onixai.ai
│
├── doppler/                       Doppler secret management config
│
└── oneuptime/                     OneUptime application config (monitors, status pages, teams)
```

## Key Resources

| Resource | Details |
|----------|---------|
| Repo (fork) | `github.com/Onix-AI/oneuptime` — `onix` branch |
| Repo (upstream) | `github.com/OneUptime/oneuptime` — `upstream` remote |
| GCP Project | `onix-ai-oneuptime-production` (#191947873405) |
| VM | `oneuptime-production` (e2-standard-4, Spot, northamerica-northeast1-a) |
| Static IP | `34.19.198.23` |
| Domain | `monitor.onixai.ai` (Cloudflare proxied) |
| Secrets | Doppler → GCP Secret Manager (24 secrets, `doppler-` prefix) |

## Deploying Updates

The GCP VM at `monitor.onixai.ai` tracks the `onix` branch from our fork. To deploy:

1. Merge upstream changes into `onix` locally and push
2. SSH into the VM:
   ```bash
   gcloud compute ssh oneuptime-production \
     --zone=northamerica-northeast1-a \
     --project=onix-ai-oneuptime-production \
     --tunnel-through-iap
   ```
3. On the VM: `git pull origin onix`, pull new Docker images, and restart

See [UPGRADES.md](UPGRADES.md) for the full step-by-step procedure.

## Updating Config Exports

Re-export GCP configs to keep them current:

```bash
PROJECT=onix-ai-oneuptime-production

# Compute
gcloud compute instances describe oneuptime-production --zone=northamerica-northeast1-a --project=$PROJECT --format=yaml > Onix/gcp/compute/instance.yaml
gcloud compute disks describe oneuptime-production --zone=northamerica-northeast1-a --project=$PROJECT --format=yaml > Onix/gcp/compute/disk.yaml
gcloud compute resource-policies describe daily-last-10-days --region=northamerica-northeast1 --project=$PROJECT --format=yaml > Onix/gcp/compute/snapshot-schedule.yaml

# Networking
gcloud compute networks describe oneuptime-vpc --project=$PROJECT --format=yaml > Onix/gcp/networking/vpc.yaml
gcloud compute networks subnets describe oneuptime-subnet --region=northamerica-northeast1 --project=$PROJECT --format=yaml > Onix/gcp/networking/subnet.yaml
gcloud compute firewall-rules list --project=$PROJECT --format=yaml > Onix/gcp/networking/firewall-rules.yaml
gcloud compute addresses describe oneuptime-ip --region=northamerica-northeast1 --project=$PROJECT --format=yaml > Onix/gcp/networking/static-ip.yaml

# IAM
gcloud projects get-iam-policy $PROJECT --format=yaml > Onix/gcp/iam/policy.yaml
gcloud iam service-accounts list --project=$PROJECT --format=yaml > Onix/gcp/iam/service-accounts.yaml
gcloud iam roles describe vmAutoRestart --project=$PROJECT --format=yaml > Onix/gcp/iam/custom-roles.yaml

# Secret Manager (names only — update secrets.yaml manually)
gcloud secrets list --project=$PROJECT --format="value(name)" | sort

# Cloud Run & Scheduler
gcloud run services describe vm-auto-restart --region=northamerica-northeast1 --project=$PROJECT --format=export > Onix/gcp/cloud-run/vm-auto-restart.yaml
gcloud scheduler jobs describe vm-auto-restart-check --location=northamerica-northeast1 --project=$PROJECT --format=yaml > Onix/gcp/cloud-scheduler/vm-auto-restart-check.yaml
```

## See Also

- [INFRASTRUCTURE.md](INFRASTRUCTURE.md) — Full documentation with recreation steps
- [PATCHES.md](PATCHES.md) — Code patches applied to production containers
- [UPGRADES.md](UPGRADES.md) — How to upgrade the production deployment
