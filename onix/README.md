# Onix Infrastructure

This directory contains infrastructure documentation, configuration exports, and custom code for the Onix AI OneUptime deployment.

## Directory Structure

```
onix/
├── INFRASTRUCTURE.md              Comprehensive infrastructure documentation
├── PATCHES.md                     OneUptime code patches applied to production
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
├── cloudflare/                    Cloudflare DNS records for onixai.ai
│
└── doppler/                       Doppler secret management config
```

## Key Resources

| Resource | Details |
|----------|---------|
| GCP Project | `onix-ai-oneuptime-production` (#191947873405) |
| VM | `oneuptime-production` (e2-standard-4, Spot, northamerica-northeast1-a) |
| Static IP | `34.19.198.23` |
| Domain | `monitor.onixai.ai` (Cloudflare proxied) |
| Secrets | Doppler → GCP Secret Manager (22 secrets, `doppler-` prefix) |

## Updating Config Exports

Re-export GCP configs to keep them current:

```bash
# Compute
gcloud compute instances describe oneuptime-production --zone=northamerica-northeast1-a --format=yaml > onix/gcp/compute/instance.yaml
gcloud compute disks describe oneuptime-production --zone=northamerica-northeast1-a --format=yaml > onix/gcp/compute/disk.yaml
gcloud compute resource-policies describe daily-last-10-days --region=northamerica-northeast1 --format=yaml > onix/gcp/compute/snapshot-schedule.yaml

# Networking
gcloud compute networks describe oneuptime-vpc --format=yaml > onix/gcp/networking/vpc.yaml
gcloud compute networks subnets describe oneuptime-subnet --region=northamerica-northeast1 --format=yaml > onix/gcp/networking/subnet.yaml
gcloud compute firewall-rules list --format=yaml > onix/gcp/networking/firewall-rules.yaml
gcloud compute addresses describe oneuptime-ip --region=northamerica-northeast1 --format=yaml > onix/gcp/networking/static-ip.yaml

# IAM
gcloud projects get-iam-policy onix-ai-oneuptime-production --format=yaml > onix/gcp/iam/policy.yaml
gcloud iam service-accounts list --format=yaml > onix/gcp/iam/service-accounts.yaml
gcloud iam roles describe vmAutoRestart --project=onix-ai-oneuptime-production --format=yaml > onix/gcp/iam/custom-roles.yaml

# Cloud Run & Scheduler
gcloud run services describe vm-auto-restart --region=northamerica-northeast1 --format=export > onix/gcp/cloud-run/vm-auto-restart.yaml
gcloud scheduler jobs describe vm-auto-restart-check --location=northamerica-northeast1 --format=yaml > onix/gcp/cloud-scheduler/vm-auto-restart-check.yaml
```

## See Also

- [INFRASTRUCTURE.md](INFRASTRUCTURE.md) — Full documentation with recreation steps
- [PATCHES.md](PATCHES.md) — Code patches applied to production containers
