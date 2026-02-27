# Onix AI OneUptime Infrastructure

Comprehensive infrastructure documentation for the self-hosted OneUptime deployment at `monitor.onixai.ai`. This document contains everything needed to recreate the entire setup from scratch.

**Last updated:** 2026-02-12
**Audited from:** Live GCP project + Cloudflare + Doppler

---

## Table of Contents

- [GCP Project Overview](#gcp-project-overview)
- [Networking](#networking)
- [Compute Engine](#compute-engine)
- [Disk and Backups](#disk-and-backups)
- [IAM and Service Accounts](#iam-and-service-accounts)
- [Secret Management](#secret-management)
- [VM Auto-Restart System](#vm-auto-restart-system)
- [Cloudflare](#cloudflare)
- [On-VM Application Setup](#on-vm-application-setup)
- [Enabled GCP APIs](#enabled-gcp-apis)
- [Storage and Artifact Registry](#storage-and-artifact-registry)
- [Project-Level Metadata](#project-level-metadata)
- [What is NOT Configured](#what-is-not-configured)
- [IAM Cleanup Notes](#iam-cleanup-notes)
- [Recreating from Scratch](#recreating-from-scratch)

---

## GCP Project Overview

| Property             | Value                                     |
|----------------------|-------------------------------------------|
| Project name         | `onix-ai-oneuptime-production`            |
| Project number       | `191947873405`                            |
| Primary region       | `northamerica-northeast1` (Montreal)      |
| Primary zone         | `northamerica-northeast1-a`               |
| Billing account      | `01853D-1EE631-A58F73`                    |
| Owner                | `zachary@onixai.ai`                       |

```bash
gcloud projects create onix-ai-oneuptime-production \
  --name="onix-ai-oneuptime-production"

gcloud billing projects link onix-ai-oneuptime-production \
  --billing-account=01853D-1EE631-A58F73

gcloud config set project onix-ai-oneuptime-production
gcloud config set compute/region northamerica-northeast1
gcloud config set compute/zone northamerica-northeast1-a
```

---

## Networking

### VPC: `oneuptime-vpc`

| Property              | Value                        |
|-----------------------|------------------------------|
| Name                  | `oneuptime-vpc`              |
| Subnet creation mode  | Custom (no auto-create)      |
| Routing mode          | Regional                     |
| Firewall policy order | AFTER_CLASSIC_FIREWALL       |

```bash
gcloud compute networks create oneuptime-vpc \
  --subnet-mode=custom \
  --bgp-routing-mode=regional
```

### Subnet: `oneuptime-subnet`

| Property                | Value                         |
|-------------------------|-------------------------------|
| Name                    | `oneuptime-subnet`            |
| CIDR range              | `10.10.0.0/24`                |
| Region                  | `northamerica-northeast1`     |
| Private Google Access   | Enabled                       |
| Stack type              | IPv4 only                     |
| Gateway                 | `10.10.0.1`                   |

```bash
gcloud compute networks subnets create oneuptime-subnet \
  --network=oneuptime-vpc \
  --region=northamerica-northeast1 \
  --range=10.10.0.0/24 \
  --enable-private-ip-google-access
```

### Static IP: `oneuptime-ip`

| Property     | Value                         |
|--------------|-------------------------------|
| Name         | `oneuptime-ip`                |
| Address      | `34.19.198.23`                |
| Type         | EXTERNAL                      |
| Network tier | PREMIUM                       |
| Region       | `northamerica-northeast1`     |

```bash
gcloud compute addresses create oneuptime-ip \
  --region=northamerica-northeast1 \
  --network-tier=PREMIUM
```

> Note: The specific IP address (`34.19.198.23`) is assigned by GCP. After creation, retrieve it with `gcloud compute addresses describe oneuptime-ip --region=northamerica-northeast1` and update DNS records accordingly.

### Firewall Rules

There are 5 firewall rules on the `oneuptime-vpc` network:

| Rule                        | Priority | Direction | Action | Protocol/Ports | Source Ranges                   | Target Tags      |
|-----------------------------|----------|-----------|--------|----------------|---------------------------------|------------------|
| `allow-cloudflare`          | 1000     | INGRESS   | ALLOW  | tcp:443        | Cloudflare IP ranges (see below)| `oneuptime-vm`   |
| `allow-ssh-iap`             | 1000     | INGRESS   | ALLOW  | tcp:22         | `35.235.240.0/20`               | `oneuptime-vm`   |
| `oneuptime-vpc-allow-http`  | 1000     | INGRESS   | ALLOW  | tcp:80         | `0.0.0.0/0`                     | `http-server`    |
| `oneuptime-vpc-allow-https` | 1000     | INGRESS   | ALLOW  | tcp:443        | `0.0.0.0/0`                     | `https-server`   |
| `deny-all-ingress`          | 65534    | INGRESS   | DENY   | all            | `0.0.0.0/0`                     | `oneuptime-vm`   |

**Cloudflare IP ranges** used in `allow-cloudflare`:
```
173.245.48.0/20
103.21.244.0/22
103.22.200.0/22
103.31.4.0/22
141.101.64.0/18
108.162.192.0/18
190.93.240.0/20
188.114.96.0/20
197.234.240.0/22
198.41.128.0/17
162.158.0.0/15
104.16.0.0/13
104.24.0.0/14
172.64.0.0/13
131.0.72.0/22
```

```bash
# 1. Allow Cloudflare HTTPS traffic
gcloud compute firewall-rules create allow-cloudflare \
  --network=oneuptime-vpc \
  --direction=INGRESS \
  --priority=1000 \
  --action=ALLOW \
  --rules=tcp:443 \
  --source-ranges="173.245.48.0/20,103.21.244.0/22,103.22.200.0/22,103.31.4.0/22,141.101.64.0/18,108.162.192.0/18,190.93.240.0/20,188.114.96.0/20,197.234.240.0/22,198.41.128.0/17,162.158.0.0/15,104.16.0.0/13,104.24.0.0/14,172.64.0.0/13,131.0.72.0/22" \
  --target-tags=oneuptime-vm

# 2. Allow SSH via IAP tunnel only
gcloud compute firewall-rules create allow-ssh-iap \
  --network=oneuptime-vpc \
  --direction=INGRESS \
  --priority=1000 \
  --action=ALLOW \
  --rules=tcp:22 \
  --source-ranges="35.235.240.0/20" \
  --target-tags=oneuptime-vm

# 3. Default HTTP allow (for http-server tagged instances)
gcloud compute firewall-rules create oneuptime-vpc-allow-http \
  --network=oneuptime-vpc \
  --direction=INGRESS \
  --priority=1000 \
  --action=ALLOW \
  --rules=tcp:80 \
  --source-ranges="0.0.0.0/0" \
  --target-tags=http-server

# 4. Default HTTPS allow (for https-server tagged instances)
gcloud compute firewall-rules create oneuptime-vpc-allow-https \
  --network=oneuptime-vpc \
  --direction=INGRESS \
  --priority=1000 \
  --action=ALLOW \
  --rules=tcp:443 \
  --source-ranges="0.0.0.0/0" \
  --target-tags=https-server

# 5. Deny-all catch-all (lowest priority)
gcloud compute firewall-rules create deny-all-ingress \
  --network=oneuptime-vpc \
  --direction=INGRESS \
  --priority=65534 \
  --action=DENY \
  --rules=all \
  --source-ranges="0.0.0.0/0" \
  --target-tags=oneuptime-vm
```

### Routes

Default routes are auto-created with the VPC:

| Route                        | Destination     | Next Hop                | Priority |
|------------------------------|-----------------|-------------------------|----------|
| Default internet gateway     | `0.0.0.0/0`    | default-internet-gateway| 1000     |
| Subnet route                 | `10.10.0.0/24`  | oneuptime-vpc network   | 0        |

---

## Compute Engine

### VM: `oneuptime-production`

| Property                     | Value                                                          |
|------------------------------|----------------------------------------------------------------|
| Name                         | `oneuptime-production`                                         |
| Zone                         | `northamerica-northeast1-a`                                    |
| Machine type                 | `e2-standard-4` (4 vCPU, 16 GB RAM)                           |
| CPU platform                 | AMD Rome                                                       |
| Provisioning model           | Spot (preemptible)                                             |
| On host maintenance          | TERMINATE                                                      |
| Automatic restart            | `false` (GCP-level; custom auto-restart handles preemption)    |
| Instance termination action  | STOP                                                           |
| OS                           | Ubuntu Minimal 22.04 LTS                                       |
| Boot disk                    | `oneuptime-production`, 80 GB `pd-ssd`, autoDelete=false       |
| Static external IP           | `34.19.198.23` (oneuptime-ip, PREMIUM tier)                    |
| Internal IP                  | `10.10.0.2`                                                    |
| Network                      | `oneuptime-vpc`                                                |
| Subnet                       | `oneuptime-subnet`                                             |
| Network tags                 | `http-server`, `https-server`, `oneuptime-vm`                  |
| Labels                       | `application=oneuptime`, `environment=production`, `goog-ops-agent-policy=v2-x86-template-1-4-0` |
| Shielded VM: Secure Boot     | Enabled                                                        |
| Shielded VM: vTPM            | Enabled                                                        |
| Shielded VM: Integrity Mon.  | Enabled                                                        |
| IP forwarding                | Disabled                                                       |
| Confidential VM              | Disabled                                                       |
| Display device               | Disabled                                                       |
| Reservation affinity         | Consume any reservation (automatic)                            |
| Service account              | `oneuptime-vm@onix-ai-oneuptime-production.iam.gserviceaccount.com` |
| Deletion protection          | Disabled                                                       |

**Service account scopes:**
- `cloud-platform`
- `devstorage.read_only`
- `logging.write`
- `monitoring.write`
- `service.management.readonly`
- `servicecontrol`
- `trace.append`

**Metadata keys:**

| Key              | Value                                                        |
|------------------|--------------------------------------------------------------|
| `enable-osconfig`| `true`                                                       |
| `auto-restart`   | `true`                                                       |
| `startup-script` | See below                                                    |
| `ssh-keys`       | Ephemeral Google-managed keys (auto-injected by `gcloud compute ssh` / Console SSH, rotate on each session) |

**Startup script:**
```bash
#!/bin/bash
set -e
cd /opt/oneuptime
./fetch-secrets.sh
npm start
```

```bash
gcloud compute instances create oneuptime-production \
  --zone=northamerica-northeast1-a \
  --machine-type=e2-standard-4 \
  --provisioning-model=SPOT \
  --instance-termination-action=STOP \
  --no-restart-on-failure \
  --maintenance-policy=TERMINATE \
  --network-interface=network=oneuptime-vpc,subnet=oneuptime-subnet,address=oneuptime-ip \
  --tags=http-server,https-server,oneuptime-vm \
  --labels=application=oneuptime,environment=production \
  --image-family=ubuntu-minimal-2204-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=80GB \
  --boot-disk-type=pd-ssd \
  --boot-disk-device-name=oneuptime-production \
  --no-boot-disk-auto-delete \
  --shielded-secure-boot \
  --shielded-vtpm \
  --shielded-integrity-monitoring \
  --service-account=oneuptime-vm@onix-ai-oneuptime-production.iam.gserviceaccount.com \
  --scopes=cloud-platform,devstorage.read_only,logging.write,monitoring.write,service.management.readonly,servicecontrol,trace.append \
  --metadata=enable-osconfig=true,auto-restart=true \
  --metadata-from-file=startup-script=startup-script.sh
```

> Note: If recreating from a snapshot instead of a fresh image, use `--source-snapshot=oneuptime-snapshot-20260205-pre-patches` instead of `--image-family`/`--image-project`/`--boot-disk-size`/`--boot-disk-type`.

---

## Disk and Backups

### Boot Disk: `oneuptime-production`

| Property            | Value                                              |
|---------------------|----------------------------------------------------|
| Name                | `oneuptime-production`                             |
| Size                | 80 GB                                              |
| Type                | `pd-ssd`                                           |
| Zone                | `northamerica-northeast1-a`                        |
| OS                  | Ubuntu Minimal 22.04 LTS                           |
| Interface type      | SCSI                                               |
| Encryption          | Google-managed                                     |
| autoDelete          | `false`                                            |
| Source snapshot      | `oneuptime-snapshot-20260205-pre-patches`          |
| Snapshot schedule   | `daily-last-10-days`                               |

### Snapshot Schedule: `daily-last-10-days`

| Property          | Value                                       |
|-------------------|---------------------------------------------|
| Name              | `daily-last-10-days`                        |
| Frequency         | Daily (every 1 day)                         |
| Start time        | 07:00 UTC (02:00-03:00 EST)                |
| Retention         | 10 days                                     |
| On source delete  | KEEP_AUTO_SNAPSHOTS                         |
| Storage location  | `northamerica-northeast1`                   |
| Guest flush       | Disabled                                    |

```bash
# Create the snapshot schedule
gcloud compute resource-policies create snapshot-schedule daily-last-10-days \
  --region=northamerica-northeast1 \
  --description="Daily (2-3am EST) snapshots for the last 10 days" \
  --max-retention-days=10 \
  --on-source-disk-delete=keep-auto-snapshots \
  --daily-schedule \
  --start-time=07:00 \
  --storage-location=northamerica-northeast1

# Attach it to the disk
gcloud compute disks add-resource-policies oneuptime-production \
  --zone=northamerica-northeast1-a \
  --resource-policies=daily-last-10-days
```

### Manual Snapshots

| Snapshot Name                                 | Notes                      |
|-----------------------------------------------|----------------------------|
| `oneuptime-snapshot-20260204`                 | Manual backup              |
| `oneuptime-snapshot-20260205-pre-patches`     | Pre-patch baseline; disk restored from this |
| `oneuptime-snapshot-20260206`                 | Manual backup              |

```bash
# Create a manual snapshot
gcloud compute disks snapshot oneuptime-production \
  --zone=northamerica-northeast1-a \
  --snapshot-names=oneuptime-snapshot-YYYYMMDD \
  --storage-location=northamerica-northeast1
```

---

## IAM and Service Accounts

### Project Owner

| User                 | Role            |
|----------------------|-----------------|
| `zachary@onixai.ai`  | `roles/owner`   |

### Service Accounts

#### 1. Compute Engine Default SA

| Property | Value |
|----------|-------|
| Email    | `191947873405-compute@developer.gserviceaccount.com` |
| Purpose  | Compute Engine default (auto-created) |

**Roles:**
- `roles/artifactregistry.reader`
- `roles/artifactregistry.writer`
- `roles/cloudbuild.builds.builder`
- `roles/logging.logWriter`
- `roles/storage.objectAdmin`

#### 2. App Engine Default SA

| Property | Value |
|----------|-------|
| Email    | `onix-ai-oneuptime-production@appspot.gserviceaccount.com` |
| Purpose  | Auto-created by GCP. Unused. |

#### 3. OneUptime VM SA

| Property | Value |
|----------|-------|
| Email    | `oneuptime-vm@onix-ai-oneuptime-production.iam.gserviceaccount.com` |
| Display  | OneUptime VM Service Account |
| Purpose  | Attached to the VM instance for logging, monitoring, and secret access |

**Roles:**
- `roles/logging.logWriter`
- `roles/monitoring.metricWriter`
- `roles/secretmanager.secretAccessor`

```bash
gcloud iam service-accounts create oneuptime-vm \
  --display-name="OneUptime VM Service Account"

gcloud projects add-iam-policy-binding onix-ai-oneuptime-production \
  --member="serviceAccount:oneuptime-vm@onix-ai-oneuptime-production.iam.gserviceaccount.com" \
  --role="roles/logging.logWriter"

gcloud projects add-iam-policy-binding onix-ai-oneuptime-production \
  --member="serviceAccount:oneuptime-vm@onix-ai-oneuptime-production.iam.gserviceaccount.com" \
  --role="roles/monitoring.metricWriter"

gcloud projects add-iam-policy-binding onix-ai-oneuptime-production \
  --member="serviceAccount:oneuptime-vm@onix-ai-oneuptime-production.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

#### 4. Doppler Secret Manager SA

| Property   | Value |
|------------|-------|
| Email      | `doppler-secret-manager@onix-ai-oneuptime-production.iam.gserviceaccount.com` |
| Display    | Doppler Secret Manager |
| Purpose    | Used by Doppler to sync secrets to GCP Secret Manager |

**Roles:**
- `roles/secretmanager.admin` (conditional: only secrets with `doppler-` prefix)

**IAM Condition:**
```
Title: doppler-secrets-only
Expression: resource.name.extract("secrets/{rest}").startsWith("doppler-")
Description: Only allow managing secrets with doppler- prefix
```

```bash
gcloud iam service-accounts create doppler-secret-manager \
  --display-name="Doppler Secret Manager"

gcloud projects add-iam-policy-binding onix-ai-oneuptime-production \
  --member="serviceAccount:doppler-secret-manager@onix-ai-oneuptime-production.iam.gserviceaccount.com" \
  --role="roles/secretmanager.admin" \
  --condition='title=doppler-secrets-only,description=Only allow managing secrets with doppler- prefix,expression=resource.name.extract("secrets/{rest}").startsWith("doppler-")'
```

#### 5. VM Auto-Restart Function SA

| Property | Value |
|----------|-------|
| Email    | `vm-auto-restart@onix-ai-oneuptime-production.iam.gserviceaccount.com` |
| Display  | VM Auto-Restart Function |
| Purpose  | Used by the Cloud Function and Cloud Scheduler to auto-restart preempted VMs |

**Roles:**
- Custom role `vmAutoRestart`

```bash
gcloud iam service-accounts create vm-auto-restart \
  --display-name="VM Auto-Restart Function"

gcloud projects add-iam-policy-binding onix-ai-oneuptime-production \
  --member="serviceAccount:vm-auto-restart@onix-ai-oneuptime-production.iam.gserviceaccount.com" \
  --role="projects/onix-ai-oneuptime-production/roles/vmAutoRestart"
```

### Custom Role: `vmAutoRestart`

| Property     | Value                        |
|--------------|------------------------------|
| Title        | VM Auto-Restart              |
| ID           | `vmAutoRestart`              |
| Stage        | ALPHA                        |

**Permissions:**
- `compute.instances.get`
- `compute.instances.start`
- `compute.zoneOperations.list`

```bash
gcloud iam roles create vmAutoRestart \
  --project=onix-ai-oneuptime-production \
  --title="VM Auto-Restart" \
  --permissions=compute.instances.get,compute.instances.start,compute.zoneOperations.list \
  --stage=ALPHA
```

---

## Secret Management

### Overview

Secrets flow through a three-stage pipeline:

```
Doppler (source of truth)
  --> GCP Secret Manager (auto-synced, "doppler-" prefix)
    --> VM config.env (loaded at startup by fetch-secrets.sh)
```

### Doppler Configuration

| Property    | Value                |
|-------------|----------------------|
| Project     | `oneuptime`          |
| Config      | `production`         |
| Root config | Yes (locked)         |
| Environment | `production`         |

Doppler is configured with a GCP Secret Manager integration that auto-syncs all secrets to GCP. Each Doppler secret is created in GCP Secret Manager with the `doppler-` prefix (e.g., Doppler `DATABASE_PASSWORD` becomes GCP `doppler-DATABASE_PASSWORD`).

The integration uses the `doppler-secret-manager` service account with a conditional IAM binding that restricts it to only manage secrets with the `doppler-` prefix.

### GCP Secret Manager Secrets (27 total)

All secrets are prefixed with `doppler-` in GCP Secret Manager. The names below show the logical name (without the prefix):

| Secret Name                        | Description                                          |
|------------------------------------|------------------------------------------------------|
| `CAPTCHA_ENABLED`                  | Whether hCaptcha is enabled for the OneUptime UI     |
| `CAPTCHA_SECRET_KEY`               | hCaptcha secret key for server-side verification     |
| `CAPTCHA_SITE_KEY`                 | hCaptcha site key for client-side widget             |
| `CLICKHOUSE_PASSWORD`              | Password for the ClickHouse analytics database       |
| `DATABASE_PASSWORD`                | Password for the PostgreSQL database                 |
| `DOPPLER_CONFIG`                   | Doppler config name                                  |
| `DOPPLER_ENVIRONMENT`              | Doppler environment name                             |
| `DOPPLER_PROJECT`                  | Doppler project name                                 |
| `ENCRYPTION_SECRET`                | AES encryption key for sensitive data at rest        |
| `ENVIRONMENT`                      | Deployment environment identifier                    |
| `GLOBAL_PROBE_1_KEY`               | API key for probe instance 1                         |
| `GLOBAL_PROBE_2_KEY`               | API key for probe instance 2                         |
| `HOST`                             | Public hostname (`monitor.onixai.ai`)                |
| `HTTP_PROTOCOL`                    | Protocol for public URLs (`https`)                   |
| `LETS_ENCRYPT_NOTIFICATION_EMAIL`  | Email for Let's Encrypt certificate notifications    |
| `LOG_LEVEL`                        | Application log level                                |
| `ONEUPTIME_HTTP_PORT`              | Internal HTTP port the application listens on        |
| `ONEUPTIME_SECRET`                 | Internal API secret for service-to-service auth      |
| `PROVISION_SSL`                    | Whether to provision SSL via Let's Encrypt           |
| `PUSH_NOTIFICATION_RELAY_URL`      | URL for push notification relay service              |
| `REDIS_PASSWORD`                   | Password for the Redis cache                         |
| `REGISTER_PROBE_KEY`               | Shared secret for probe registration with probe-ingest |
| `SLACK_APP_CLIENT_ID`              | Slack app OAuth client ID                            |
| `SLACK_APP_CLIENT_SECRET`          | Slack app OAuth client secret                        |
| `SLACK_APP_SIGNING_SECRET`         | Slack app request signing secret                     |
| `STATUS_PAGE_CNAME_RECORD`         | CNAME target for custom domain status pages          |
| `STATUS_PAGE_HTTPS_PORT`           | HTTPS port for status page access                    |

### Startup Secret Loading

At VM boot, the startup script runs `/opt/oneuptime/fetch-secrets.sh`, which:

1. Reads each secret from GCP Secret Manager (using the VM service account's `secretmanager.secretAccessor` role)
2. Strips the `doppler-` prefix
3. Writes key=value pairs to `/opt/oneuptime/config.env`
4. The application then reads `config.env` via `npm start`

---

## VM Auto-Restart System

Since the VM uses Spot (preemptible) provisioning, GCP can preempt (stop) it at any time. The auto-restart system automatically detects preemption and restarts the VM.

### Architecture

```
Cloud Scheduler (every 5 min)
  --> Cloud Function (vm-auto-restart)
    --> Checks: VM stopped? + auto-restart=true? + last op was preemption?
      --> If all yes: starts the VM
```

### Cloud Function: `vm-auto-restart`

| Property         | Value                                                |
|------------------|------------------------------------------------------|
| Name             | `vm-auto-restart`                                    |
| Generation       | Gen2 (runs on Cloud Run)                             |
| Runtime          | Python 3.12                                          |
| Memory           | 128 Mi                                               |
| Timeout          | 60 seconds                                           |
| Region           | `northamerica-northeast1`                            |
| Entry point      | `auto_restart_vm`                                    |
| Trigger          | HTTP (not publicly accessible)                       |
| Service account  | `vm-auto-restart@onix-ai-oneuptime-production.iam.gserviceaccount.com` |
| URL              | `https://vm-auto-restart-ainaujgaya-nn.a.run.app`   |
| Source code      | `Onix/gcp/cloud-functions/vm-auto-restart/`          |

**Deploy command:**
```bash
gcloud functions deploy vm-auto-restart \
  --gen2 \
  --region=northamerica-northeast1 \
  --runtime=python312 \
  --source=Onix/gcp/cloud-functions/vm-auto-restart \
  --entry-point=auto_restart_vm \
  --trigger-http \
  --no-allow-unauthenticated \
  --service-account=vm-auto-restart@onix-ai-oneuptime-production.iam.gserviceaccount.com \
  --memory=128Mi \
  --timeout=60s
```

**Logic:**
1. Get VM status. If not TERMINATED/STOPPED/SUSPENDED, do nothing.
2. Check `auto-restart` metadata flag. If not `true`, do nothing.
3. Check zone operations for the instance. If the most recent stop-like operation was `compute.instances.preempted`, restart. If it was a manual `stop` or `suspend`, do nothing.
4. Call `instances.start` to restart the VM.

### Cloud Scheduler: `vm-auto-restart-check`

| Property            | Value                                                              |
|---------------------|--------------------------------------------------------------------|
| Name                | `vm-auto-restart-check`                                            |
| Schedule            | `*/5 * * * *` (every 5 minutes)                                    |
| Timezone            | `Etc/UTC`                                                          |
| HTTP method         | POST                                                               |
| Target URI          | `https://vm-auto-restart-ainaujgaya-nn.a.run.app/`                 |
| Auth                | OIDC token                                                         |
| OIDC audience       | `https://vm-auto-restart-ainaujgaya-nn.a.run.app`                  |
| OIDC service account| `vm-auto-restart@onix-ai-oneuptime-production.iam.gserviceaccount.com` |
| Attempt deadline    | 180 seconds                                                        |

```bash
gcloud scheduler jobs create http vm-auto-restart-check \
  --location=northamerica-northeast1 \
  --schedule="*/5 * * * *" \
  --time-zone="Etc/UTC" \
  --uri="https://vm-auto-restart-ainaujgaya-nn.a.run.app/" \
  --http-method=POST \
  --oidc-service-account-email=vm-auto-restart@onix-ai-oneuptime-production.iam.gserviceaccount.com \
  --oidc-token-audience="https://vm-auto-restart-ainaujgaya-nn.a.run.app" \
  --attempt-deadline=180s
```

### Safeguards

The function will **only** restart the VM if:
- The VM is stopped/terminated/suspended
- The `auto-restart` metadata flag is set to `true`
- The most recent zone operation for the instance was a preemption (not a manual stop)

This means manually stopping the VM will NOT trigger an auto-restart.

### Operational Commands

```bash
# Intentionally stop the VM (disable auto-restart first)
gcloud compute instances add-metadata oneuptime-production \
  --zone=northamerica-northeast1-a \
  --metadata=auto-restart=false
gcloud compute instances stop oneuptime-production \
  --zone=northamerica-northeast1-a

# Re-enable auto-restart after intentional maintenance
gcloud compute instances add-metadata oneuptime-production \
  --zone=northamerica-northeast1-a \
  --metadata=auto-restart=true
```

---

## Cloudflare

### Domain Configuration

| Property           | Value                     |
|--------------------|---------------------------|
| Domain             | `onixai.ai`              |
| SSL mode           | Full (Strict)             |

### Origin Certificates

| Property     | Value                                                     |
|--------------|-----------------------------------------------------------|
| Type         | Cloudflare Origin Certificate                             |
| Subjects     | `*.onixai.ai`, `onixai.ai`                               |
| Expiry       | 2041-01-31                                                |
| VM location  | `/opt/oneuptime/certs/ServerCerts/`                       |
| Files        | `monitor.onixai.ai.crt`, `monitor.onixai.ai.key`         |

These certificates are mounted into the nginx ingress container via `docker-compose.override.yml`:
```yaml
services:
  ingress:
    volumes:
      - ./certs/ServerCerts:/etc/nginx/certs/ServerCerts:ro
```

### DNS Records

| Type  | Name                        | Value                                        | Proxied |
|-------|-----------------------------|----------------------------------------------|---------|
| A     | `monitor.onixai.ai`        | `34.19.198.23`                               | Yes     |
| CNAME | `internal-status.onixai.ai` | `monitor.onixai.ai`                          | Yes     |
| CNAME | `status.onixai.ai`          | `monitor.onixai.ai`                          | Yes     |
| TXT   | `onixai.ai`                 | `oneuptime-verification-KNTaSrEdAWWEzXDetlBs`| N/A     |

---

## On-VM Application Setup

### Directory Structure

```
/opt/oneuptime/                          # Cloned from github.com/Onix-AI/oneuptime (onix branch)
  config.env                             # Generated at startup by fetch-secrets.sh (not committed)
  fetch-secrets.sh                       # Reads GCP Secret Manager, writes config.env
  docker-compose.yml                     # OneUptime compose file (from onix branch)
  docker-compose.override.yml            # Onix customizations (SSL certs, patches, disabled services)
  Onix/patches/
    CustomCodeMonitorCriteria.ts         # Patched: JSON stringify fix for custom code monitors
    StatusPageService.ts                 # Patched: SSO redirect fix for custom domains
  certs/
    ServerCerts/
      monitor.onixai.ai.crt             # Cloudflare origin certificate
      monitor.onixai.ai.key             # Cloudflare origin private key
```

The repo is cloned via SSH using a read-only deploy key (`~/.ssh/deploy_key`). The git remote is `git@github.com:Onix-AI/oneuptime.git`.

### docker-compose.override.yml

```yaml
services:
  ingress:
    volumes:
      - ./certs/ServerCerts:/etc/nginx/certs/ServerCerts:ro

  app:
    volumes:
      - ./Onix/patches/StatusPageService.ts:/usr/src/Common/Server/Services/StatusPageService.ts:ro

  probe-ingest:
    volumes:
      - ./Onix/patches/CustomCodeMonitorCriteria.ts:/usr/src/app/node_modules/Common/Server/Utils/Monitor/Criteria/CustomCodeMonitorCriteria.ts:ro

  probe-2:
    deploy:
      replicas: 0
```

### Applied Patches

See `Onix/PATCHES.md` for full details on each patch.

| Patch | File | Purpose |
|-------|------|---------|
| Custom Code Monitor JSON Fix | `Onix/patches/CustomCodeMonitorCriteria.ts` | Converts object results to JSON string for criteria matching |
| SSO Custom Domain Redirect | `Onix/patches/StatusPageService.ts` | Fixes post-SSO redirect to custom domains using Cloudflare SSL |
| Probe-2 Disabled | `docker-compose.override.yml` | Saves ~384 MB; single probe sufficient on same server |

### Startup Sequence

1. VM boots (or restarts after preemption)
2. Startup script runs: `cd /opt/oneuptime && ./fetch-secrets.sh && npm start`
3. `fetch-secrets.sh` reads all `doppler-*` secrets from GCP Secret Manager, strips prefix, writes to `config.env`
4. `npm start` runs `docker compose up -d` which reads `docker-compose.yml` + `docker-compose.override.yml`
5. Docker containers start (PostgreSQL, Redis, ClickHouse, app, ingress, probe-ingest, etc.)

### Updating

To update the deployment, see [UPGRADES.md](UPGRADES.md).

---

## Enabled GCP APIs

36 APIs are enabled on this project:

| API | Service Name |
|-----|--------------|
| Analytics Hub | `analyticshub.googleapis.com` |
| Artifact Registry | `artifactregistry.googleapis.com` |
| BigQuery | `bigquery.googleapis.com` |
| BigQuery Connection | `bigqueryconnection.googleapis.com` |
| BigQuery Data Policy | `bigquerydatapolicy.googleapis.com` |
| BigQuery Data Transfer | `bigquerydatatransfer.googleapis.com` |
| BigQuery Migration | `bigquerymigration.googleapis.com` |
| BigQuery Reservation | `bigqueryreservation.googleapis.com` |
| BigQuery Storage | `bigquerystorage.googleapis.com` |
| Cloud APIs | `cloudapis.googleapis.com` |
| Cloud Build | `cloudbuild.googleapis.com` |
| Cloud Functions | `cloudfunctions.googleapis.com` |
| Cloud Scheduler | `cloudscheduler.googleapis.com` |
| Cloud Trace | `cloudtrace.googleapis.com` |
| Compute Engine | `compute.googleapis.com` |
| Container Registry | `containerregistry.googleapis.com` |
| Dataform | `dataform.googleapis.com` |
| Dataplex | `dataplex.googleapis.com` |
| Datastore | `datastore.googleapis.com` |
| IAM | `iam.googleapis.com` |
| IAM Credentials | `iamcredentials.googleapis.com` |
| Identity-Aware Proxy | `iap.googleapis.com` |
| Cloud Logging | `logging.googleapis.com` |
| Cloud Monitoring | `monitoring.googleapis.com` |
| OS Config | `osconfig.googleapis.com` |
| OS Login | `oslogin.googleapis.com` |
| Pub/Sub | `pubsub.googleapis.com` |
| Cloud Run | `run.googleapis.com` |
| Secret Manager | `secretmanager.googleapis.com` |
| Service Management | `servicemanagement.googleapis.com` |
| Service Usage | `serviceusage.googleapis.com` |
| Cloud Source Repositories | `source.googleapis.com` |
| SQL Component | `sql-component.googleapis.com` |
| Cloud Storage API | `storage-api.googleapis.com` |
| Cloud Storage Component | `storage-component.googleapis.com` |
| Cloud Storage | `storage.googleapis.com` |

**Enable the essential APIs in bulk:**
```bash
gcloud services enable \
  compute.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  iap.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com \
  osconfig.googleapis.com \
  oslogin.googleapis.com \
  secretmanager.googleapis.com \
  cloudfunctions.googleapis.com \
  cloudscheduler.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  storage.googleapis.com \
  pubsub.googleapis.com \
  cloudtrace.googleapis.com
```

> Note: Many APIs (BigQuery, Dataform, Dataplex, etc.) are auto-enabled by GCP and are not actively used by this deployment.

---

## Storage and Artifact Registry

### Cloud Storage Buckets

Both buckets are auto-created and managed by Cloud Functions:

| Bucket | Purpose |
|--------|---------|
| `gs://gcf-v2-sources-191947873405-northamerica-northeast1/` | Cloud Functions source code |
| `gs://gcf-v2-uploads-191947873405.northamerica-northeast1.cloudfunctions.appspot.com/` | Cloud Functions upload staging |

### Artifact Registry

| Property     | Value                         |
|--------------|-------------------------------|
| Repository   | `gcf-artifacts`               |
| Format       | Docker                        |
| Region       | `northamerica-northeast1`     |
| Size         | ~46 MB                        |
| Managed by   | Cloud Functions (auto-created)|

This repository stores the Docker image for the `vm-auto-restart` Cloud Function. It is managed automatically.

---

## Project-Level Metadata

| Setting               | Value          |
|-----------------------|----------------|
| Default network tier  | PREMIUM        |
| Cloud Armor tier      | CA_STANDARD    |
| VM DNS setting        | ZONAL_ONLY     |
| OS Config             | PER-VM         |

A project-level SSH key is configured for `zachary@Zacharys-MBP`.

---

## What is NOT Configured

The following GCP services and resources are explicitly **not** in use:

- **No Cloud DNS** -- DNS is managed entirely via Cloudflare
- **No load balancers**, target pools, backend services, or health checks
- **No Cloud NAT** or Cloud Router
- **No VPN tunnels**
- **No Pub/Sub topics or subscriptions** (API enabled but unused)
- **No Cloud Workflows** (API not enabled)
- **No monitoring alert policies**
- **No billing budgets** (API not enabled)
- **No Cloud Build triggers**
- **No custom compute images or machine images**
- **No instance groups**

---

## IAM Cleanup Notes

A deleted service account `backup-scheduler@onix-ai-oneuptime-production.iam.gserviceaccount.com` still has a binding to `roles/compute.admin`. This binding is non-functional (the SA no longer exists) but clutters the IAM policy.

**To clean it up:**
```bash
gcloud projects remove-iam-policy-binding onix-ai-oneuptime-production \
  --member="deleted:serviceAccount:backup-scheduler@onix-ai-oneuptime-production.iam.gserviceaccount.com?uid=117214299891021227382" \
  --role="roles/compute.admin"
```

---

## Recreating from Scratch

The following is the exact order of operations to recreate this entire infrastructure from zero. Each step depends on the previous steps completing first.

### Phase 1: Project and APIs

```bash
# 1. Create the project and link billing
gcloud projects create onix-ai-oneuptime-production \
  --name="onix-ai-oneuptime-production"
gcloud billing projects link onix-ai-oneuptime-production \
  --billing-account=01853D-1EE631-A58F73
gcloud config set project onix-ai-oneuptime-production

# 2. Enable required APIs
gcloud services enable \
  compute.googleapis.com \
  iam.googleapis.com \
  iamcredentials.googleapis.com \
  iap.googleapis.com \
  logging.googleapis.com \
  monitoring.googleapis.com \
  osconfig.googleapis.com \
  oslogin.googleapis.com \
  secretmanager.googleapis.com \
  cloudfunctions.googleapis.com \
  cloudscheduler.googleapis.com \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  storage.googleapis.com \
  pubsub.googleapis.com \
  cloudtrace.googleapis.com
```

### Phase 2: IAM -- Service Accounts and Roles

```bash
# 3. Create custom role
gcloud iam roles create vmAutoRestart \
  --project=onix-ai-oneuptime-production \
  --title="VM Auto-Restart" \
  --permissions=compute.instances.get,compute.instances.start,compute.zoneOperations.list \
  --stage=ALPHA

# 4. Create service accounts
gcloud iam service-accounts create oneuptime-vm \
  --display-name="OneUptime VM Service Account"

gcloud iam service-accounts create doppler-secret-manager \
  --display-name="Doppler Secret Manager"

gcloud iam service-accounts create vm-auto-restart \
  --display-name="VM Auto-Restart Function"

# 5. Bind roles to service accounts
gcloud projects add-iam-policy-binding onix-ai-oneuptime-production \
  --member="serviceAccount:oneuptime-vm@onix-ai-oneuptime-production.iam.gserviceaccount.com" \
  --role="roles/logging.logWriter"

gcloud projects add-iam-policy-binding onix-ai-oneuptime-production \
  --member="serviceAccount:oneuptime-vm@onix-ai-oneuptime-production.iam.gserviceaccount.com" \
  --role="roles/monitoring.metricWriter"

gcloud projects add-iam-policy-binding onix-ai-oneuptime-production \
  --member="serviceAccount:oneuptime-vm@onix-ai-oneuptime-production.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

gcloud projects add-iam-policy-binding onix-ai-oneuptime-production \
  --member="serviceAccount:doppler-secret-manager@onix-ai-oneuptime-production.iam.gserviceaccount.com" \
  --role="roles/secretmanager.admin" \
  --condition='title=doppler-secrets-only,description=Only allow managing secrets with doppler- prefix,expression=resource.name.extract("secrets/{rest}").startsWith("doppler-")'

gcloud projects add-iam-policy-binding onix-ai-oneuptime-production \
  --member="serviceAccount:vm-auto-restart@onix-ai-oneuptime-production.iam.gserviceaccount.com" \
  --role="projects/onix-ai-oneuptime-production/roles/vmAutoRestart"
```

### Phase 3: Networking

```bash
# 6. Create VPC and subnet
gcloud compute networks create oneuptime-vpc \
  --subnet-mode=custom \
  --bgp-routing-mode=regional

gcloud compute networks subnets create oneuptime-subnet \
  --network=oneuptime-vpc \
  --region=northamerica-northeast1 \
  --range=10.10.0.0/24 \
  --enable-private-ip-google-access

# 7. Reserve static IP
gcloud compute addresses create oneuptime-ip \
  --region=northamerica-northeast1 \
  --network-tier=PREMIUM

# 8. Create firewall rules
gcloud compute firewall-rules create allow-cloudflare \
  --network=oneuptime-vpc \
  --direction=INGRESS \
  --priority=1000 \
  --action=ALLOW \
  --rules=tcp:443 \
  --source-ranges="173.245.48.0/20,103.21.244.0/22,103.22.200.0/22,103.31.4.0/22,141.101.64.0/18,108.162.192.0/18,190.93.240.0/20,188.114.96.0/20,197.234.240.0/22,198.41.128.0/17,162.158.0.0/15,104.16.0.0/13,104.24.0.0/14,172.64.0.0/13,131.0.72.0/22" \
  --target-tags=oneuptime-vm

gcloud compute firewall-rules create allow-ssh-iap \
  --network=oneuptime-vpc \
  --direction=INGRESS \
  --priority=1000 \
  --action=ALLOW \
  --rules=tcp:22 \
  --source-ranges="35.235.240.0/20" \
  --target-tags=oneuptime-vm

gcloud compute firewall-rules create oneuptime-vpc-allow-http \
  --network=oneuptime-vpc \
  --direction=INGRESS \
  --priority=1000 \
  --action=ALLOW \
  --rules=tcp:80 \
  --source-ranges="0.0.0.0/0" \
  --target-tags=http-server

gcloud compute firewall-rules create oneuptime-vpc-allow-https \
  --network=oneuptime-vpc \
  --direction=INGRESS \
  --priority=1000 \
  --action=ALLOW \
  --rules=tcp:443 \
  --source-ranges="0.0.0.0/0" \
  --target-tags=https-server

gcloud compute firewall-rules create deny-all-ingress \
  --network=oneuptime-vpc \
  --direction=INGRESS \
  --priority=65534 \
  --action=DENY \
  --rules=all \
  --source-ranges="0.0.0.0/0" \
  --target-tags=oneuptime-vm
```

### Phase 4: Secrets

```bash
# 9. Set up Doppler
#    - Create project "oneuptime" in Doppler dashboard
#    - Create "production" config
#    - Add all 27 secrets (see Secret Management section)
#    - Create a key for the doppler-secret-manager SA:
gcloud iam service-accounts keys create doppler-sa-key.json \
  --iam-account=doppler-secret-manager@onix-ai-oneuptime-production.iam.gserviceaccount.com
#    - Upload this key to Doppler's GCP Secret Manager integration
#    - Enable the auto-sync integration (project: oneuptime, config: production)
#    - Verify secrets appear in GCP Secret Manager with "doppler-" prefix
#    - Delete the key file locally after uploading to Doppler
```

### Phase 5: Compute Engine

```bash
# 10. Create the startup script file locally
cat > /tmp/startup-script.sh << 'SCRIPT'
#!/bin/bash
set -e
cd /opt/oneuptime
./fetch-secrets.sh
npm start
SCRIPT

# 11. Get the assigned static IP
STATIC_IP=$(gcloud compute addresses describe oneuptime-ip \
  --region=northamerica-northeast1 --format='value(address)')

# 12. Create the VM
gcloud compute instances create oneuptime-production \
  --zone=northamerica-northeast1-a \
  --machine-type=e2-standard-4 \
  --provisioning-model=SPOT \
  --instance-termination-action=STOP \
  --no-restart-on-failure \
  --maintenance-policy=TERMINATE \
  --network-interface=network=oneuptime-vpc,subnet=oneuptime-subnet,address=$STATIC_IP \
  --tags=http-server,https-server,oneuptime-vm \
  --labels=application=oneuptime,environment=production \
  --image-family=ubuntu-minimal-2204-lts \
  --image-project=ubuntu-os-cloud \
  --boot-disk-size=80GB \
  --boot-disk-type=pd-ssd \
  --boot-disk-device-name=oneuptime-production \
  --no-boot-disk-auto-delete \
  --shielded-secure-boot \
  --shielded-vtpm \
  --shielded-integrity-monitoring \
  --service-account=oneuptime-vm@onix-ai-oneuptime-production.iam.gserviceaccount.com \
  --scopes=cloud-platform,devstorage.read_only,logging.write,monitoring.write,service.management.readonly,servicecontrol,trace.append \
  --metadata=enable-osconfig=true,auto-restart=true \
  --metadata-from-file=startup-script=/tmp/startup-script.sh

# 13. Create snapshot schedule and attach to disk
gcloud compute resource-policies create snapshot-schedule daily-last-10-days \
  --region=northamerica-northeast1 \
  --description="Daily (2-3am EST) snapshots for the last 10 days" \
  --max-retention-days=10 \
  --on-source-disk-delete=keep-auto-snapshots \
  --daily-schedule \
  --start-time=07:00 \
  --storage-location=northamerica-northeast1

gcloud compute disks add-resource-policies oneuptime-production \
  --zone=northamerica-northeast1-a \
  --resource-policies=daily-last-10-days
```

### Phase 6: VM Software Setup

```bash
# 14. SSH into the VM
gcloud compute ssh oneuptime-production \
  --zone=northamerica-northeast1-a \
  --project=onix-ai-oneuptime-production \
  --tunnel-through-iap

# 15. On the VM: install Docker, Docker Compose, Node.js
#     (Follow OneUptime self-hosted installation guide)

# 16. On the VM: set up deploy key for the fork
ssh-keygen -t ed25519 -C "oneuptime-production-deploy-key" -f ~/.ssh/deploy_key -N ""
cat ~/.ssh/deploy_key.pub
#     Copy the public key → add to github.com/Onix-AI/oneuptime Settings → Deploy keys (read-only)

# 17. On the VM: clone from our fork
cd /opt
GIT_SSH_COMMAND="ssh -i ~/.ssh/deploy_key" git clone git@github.com:Onix-AI/oneuptime.git
cd oneuptime
git config core.sshCommand "ssh -i ~/.ssh/deploy_key"
git checkout onix

# 18. On the VM: create fetch-secrets.sh
#     This script reads from GCP Secret Manager and writes config.env

# 19. On the VM: deploy Cloudflare origin certificates
#     mkdir -p /opt/oneuptime/certs/ServerCerts/
#     Copy monitor.onixai.ai.crt and monitor.onixai.ai.key into that directory

# 20. On the VM: apply patches
#     (See Onix/PATCHES.md for detailed patch application instructions)

# 21. On the VM: start OneUptime
#     cd /opt/oneuptime && ./fetch-secrets.sh && npm start
```

### Phase 7: VM Auto-Restart

```bash
# 21. Deploy the Cloud Function
gcloud functions deploy vm-auto-restart \
  --gen2 \
  --region=northamerica-northeast1 \
  --runtime=python312 \
  --source=Onix/gcp/cloud-functions/vm-auto-restart \
  --entry-point=auto_restart_vm \
  --trigger-http \
  --no-allow-unauthenticated \
  --service-account=vm-auto-restart@onix-ai-oneuptime-production.iam.gserviceaccount.com \
  --memory=128Mi \
  --timeout=60s

# 22. Get the function URL
FUNCTION_URL=$(gcloud functions describe vm-auto-restart \
  --region=northamerica-northeast1 --gen2 \
  --format='value(serviceConfig.uri)')

# 23. Create the Cloud Scheduler job
gcloud scheduler jobs create http vm-auto-restart-check \
  --location=northamerica-northeast1 \
  --schedule="*/5 * * * *" \
  --time-zone="Etc/UTC" \
  --uri="$FUNCTION_URL/" \
  --http-method=POST \
  --oidc-service-account-email=vm-auto-restart@onix-ai-oneuptime-production.iam.gserviceaccount.com \
  --oidc-token-audience="$FUNCTION_URL" \
  --attempt-deadline=180s
```

### Phase 8: Cloudflare DNS

```
In the Cloudflare dashboard for onixai.ai:

1. Set SSL/TLS mode to Full (Strict)
2. Generate an Origin Certificate (wildcard *.onixai.ai, RSA, 15 years)
3. Create DNS records:
   - A record: monitor.onixai.ai -> <STATIC_IP> (proxied)
   - CNAME record: internal-status.onixai.ai -> monitor.onixai.ai (proxied)
   - CNAME record: status.onixai.ai -> monitor.onixai.ai (proxied)
   - TXT record: onixai.ai -> oneuptime-verification-KNTaSrEdAWWEzXDetlBs
```

### Phase 9: Verification

```bash
# Verify the VM is running
gcloud compute instances describe oneuptime-production \
  --zone=northamerica-northeast1-a --format='value(status)'

# Verify secrets are synced
gcloud secrets list --filter="name:doppler-" --format="table(name)"

# Verify auto-restart function works
gcloud scheduler jobs run vm-auto-restart-check \
  --location=northamerica-northeast1

# Verify the application is accessible
curl -I https://monitor.onixai.ai

# Verify snapshot schedule is active
gcloud compute resource-policies describe daily-last-10-days \
  --region=northamerica-northeast1
```
