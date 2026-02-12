# OneUptime Customizations for Onix AI

This document tracks all modifications made to the upstream OneUptime repository for the Onix AI deployment at `monitor.onixai.ai`.

---

## 1. Custom Code Monitor JSON Result Fix

**Date Applied:** 2026-02-04

**Patched File:** `patches/CustomCodeMonitorCriteria.ts` (mounted into container)

### Problem
Custom JavaScript Code monitors that return JSON objects (e.g., `return { data: { status: "ok" } }`) silently fail criteria matching. The "Contains" filter and other string-based criteria checks don't work because the result is an object, not a string.

### Fix
Added JSON.stringify conversion (with pretty-print formatting) for object results before criteria comparison in the `CheckOn.ResultValue` section.

### Patch Code (added after the emptyNotEmptyResult check, ~line 73)
```typescript
// Convert object results to JSON string for comparison
// This allows Contains/NotContains filters to work with JSON objects
// returned from custom code monitors (e.g., { status: "[OFFLINE:critical]", ... })
if (
  syntheticMonitorResponse.result &&
  typeof syntheticMonitorResponse.result === "object"
) {
  syntheticMonitorResponse.result = JSON.stringify(
    syntheticMonitorResponse.result,
    null,
    2,
  );
}
```

### How to Apply This Patch

The patch must be applied to the file INSIDE the Docker container. We extract the file from the container, patch it, and mount it back via docker-compose.override.yml.

**Step 1: Ensure services are running**
```bash
cd /opt/oneuptime
npm run start
```

**Step 2: Create patches directory and extract the file**
```bash
mkdir -p /opt/oneuptime/patches
docker cp oneuptime-probe-ingest-1:/usr/src/app/node_modules/Common/Server/Utils/Monitor/Criteria/CustomCodeMonitorCriteria.ts /opt/oneuptime/patches/
```

**Step 3: Apply the patch**

Edit `/opt/oneuptime/patches/CustomCodeMonitorCriteria.ts` and add the following code block inside the `CheckOn.ResultValue` section, AFTER the `emptyNotEmptyResult` check (around line 73):

```typescript
      // Convert object results to JSON string for comparison
      // This allows Contains/NotContains filters to work with JSON objects
      // returned from custom code monitors (e.g., { status: "[OFFLINE:critical]", ... })
      if (
        syntheticMonitorResponse.result &&
        typeof syntheticMonitorResponse.result === "object"
      ) {
        syntheticMonitorResponse.result = JSON.stringify(
          syntheticMonitorResponse.result,
        );
      }
```

**Step 4: Update docker-compose.override.yml**

The override file should mount the patched file:
```yaml
services:
  ingress:
    volumes:
      - ./certs/ServerCerts:/etc/nginx/certs/ServerCerts:ro

  probe-ingest:
    volumes:
      - ./patches/CustomCodeMonitorCriteria.ts:/usr/src/app/node_modules/Common/Server/Utils/Monitor/Criteria/CustomCodeMonitorCriteria.ts:ro
```

**Step 5: Recreate the affected service with new mount**
```bash
export $(grep -v '^#' config.env | xargs) && docker compose up -d probe-ingest
```

Note: `docker restart` won't pick up the new volume mount. You must use `docker compose up -d` to recreate the container with the mount.

**Step 6: Verify the patch is applied**
```bash
docker exec oneuptime-probe-ingest-1 grep -A 5 "Convert object results" /usr/src/app/node_modules/Common/Server/Utils/Monitor/Criteria/CustomCodeMonitorCriteria.ts
```

### Impact
- Custom Code monitors returning JSON objects now work correctly with string-based criteria filters (Contains, NotContains, etc.)
- Root cause text shows formatted JSON with spacing for readability
- Backward compatible - monitors returning strings or numbers continue to work as before

### Why This Approach?
- Production uses pre-built Docker Hub images (`oneuptime/probe-ingest:${APP_TAG}`)
- Mounting the entire `Common/` directory fails due to missing `node_modules` and version mismatches
- Extracting the file FROM the container ensures version compatibility
- Single-file mount is clean and only overrides what we need

### Re-applying After Updates
When OneUptime is updated (new Docker images), the patch may need to be re-applied:
1. Check if the issue is fixed upstream
2. If not, repeat steps 2-6 above (extract fresh file, re-apply patch)

### Upstream PR
Consider submitting a PR to the upstream OneUptime repository for a permanent fix.

---

## 2. CloudFlare Origin SSL Certificates

**Date Added:** 2026-02-04

**Files Added:**
- `certs/ServerCerts/monitor.onixai.ai.crt`
- `certs/ServerCerts/monitor.onixai.ai.key`

### Purpose
CloudFlare Origin certificates for secure communication between CloudFlare's edge and the OneUptime origin server. These certificates are trusted by CloudFlare and enable Full (Strict) SSL mode.

### Certificate Details
- **Issuer:** CloudFlare Origin SSL Certificate Authority
- **Subject:** CloudFlare Origin Certificate
- **Valid for:** `*.onixai.ai`, `onixai.ai`
- **Expiry:** 2041-01-31

### Security Note
The private key (`monitor.onixai.ai.key`) should be kept secure and not exposed publicly. It is only valid for CloudFlare Origin authentication and cannot be used for public SSL/TLS.

---

## 3. Docker Compose Override

**Date Added:** 2026-02-04

**File Added:** `docker-compose.override.yml`

### Purpose
1. Mounts SSL certificates into the ingress (nginx) container
2. Mounts patched CustomCodeMonitorCriteria.ts into probe-ingest container
3. Mounts patched StatusPageService.ts into app container (SSO custom domain redirect fix)
4. Disables probe-2 to save memory (~384 MB)

### Content
```yaml
services:
  ingress:
    volumes:
      - ./certs/ServerCerts:/etc/nginx/certs/ServerCerts:ro

  app:
    volumes:
      - ./patches/StatusPageService.ts:/usr/src/Common/Server/Services/StatusPageService.ts:ro

  probe-ingest:
    volumes:
      - ./patches/CustomCodeMonitorCriteria.ts:/usr/src/app/node_modules/Common/Server/Utils/Monitor/Criteria/CustomCodeMonitorCriteria.ts:ro

  probe-2:
    deploy:
      replicas: 0
```

### Usage
This file is automatically merged with `docker-compose.yml` when running `docker compose up`. No additional flags needed.

---

## 5. Status Page SSO Redirect Broken for Custom Domains

**Date Applied:** 2026-02-05

**Patched File:** `patches/StatusPageService.ts` (mounted into container)

### Problem
After completing Google SAML authentication for a private status page with a custom domain (e.g. `internal-status.onixai.ai`), the user is redirected to the main app URL (`monitor.onixai.ai/status-page/{id}`) instead of the custom domain. Visiting the custom domain afterwards shows the user as unauthenticated.

**Root causes:**

1. **Missing `https://` protocol prefix:** `getStatusPageFirstURL()` in `Common/Server/Services/StatusPageService.ts` (line 680) returns the bare domain string (e.g. `internal-status.onixai.ai`) without the `https://` prefix when a custom domain exists. When this is passed to `URL.fromString()` in the post-SSO redirect (`App/FeatureSet/Identity/API/StatusPageSSO.ts` line 324), the URL is malformed. The sibling method `getStatusPageURL()` (line 631) already handles this correctly with `` `https://${domain.fullDomain}` ``.

2. **Wrong query filter for Cloudflare SSL setups:** Both `getStatusPageURL()` (line 620) and `getStatusPageFirstURL()` (line 655) filter custom domains by `isSslProvisioned: true`. This flag is only set when OneUptime provisions a Let's Encrypt certificate via Greenlock. When using Cloudflare for SSL termination (as we do), `isSslProvisioned` is always `false`, so the query returns no domains and falls back to the main app URL. The correct filter is `isCnameVerified: true`, which confirms the domain is properly configured without requiring OneUptime-managed SSL.

### Fix
Three changes in `Common/Server/Services/StatusPageService.ts`:

**Lines 620 and 655** — change the query filter in both `getStatusPageURL()` and `getStatusPageFirstURL()`:
```typescript
// From:
isSslProvisioned: true,
// To:
isCnameVerified: true,
```

**Line 680** — add `https://` prefix in `getStatusPageFirstURL()`:
```typescript
// From:
statusPageURL = domains[0]?.fullDomain || "";
// To:
statusPageURL = domains[0]?.fullDomain
  ? `https://${domains[0].fullDomain}`
  : "";
```

Together these ensure the post-SSO redirect goes to `https://internal-status.onixai.ai?token=...`, where the frontend picks up the token and establishes a valid session on the custom domain.

### How to Apply This Patch

**Step 1: Ensure services are running**
```bash
cd /opt/oneuptime
npm run start
```

**Step 2: Extract the file from the container**
```bash
docker cp oneuptime-app-1:/usr/src/Common/Server/Services/StatusPageService.ts /opt/oneuptime/patches/StatusPageService.ts
```

**Step 3: Apply the patch**

Edit `/opt/oneuptime/patches/StatusPageService.ts` and make three changes:

**Change 1 & 2:** In both `getStatusPageURL()` (~line 620) and `getStatusPageFirstURL()` (~line 655), change the query filter:
```typescript
// From:
          isSslProvisioned: true,
// To:
          isCnameVerified: true,
```

**Change 3:** In `getStatusPageFirstURL()` (~line 680), change:
```typescript
      statusPageURL = domains[0]?.fullDomain || "";
```
To:
```typescript
      statusPageURL = domains[0]?.fullDomain
        ? `https://${domains[0].fullDomain}`
        : "";
```

**Step 4: Update docker-compose.override.yml**

Add the volume mount under the `app` service:
```yaml
  app:
    volumes:
      - ./patches/StatusPageService.ts:/usr/src/Common/Server/Services/StatusPageService.ts:ro
```

**Step 5: Recreate the app service with the new mount**
```bash
export $(grep -v '^#' config.env | xargs) && docker compose up -d app
```

**Step 6: Verify the patch is applied**
```bash
docker exec oneuptime-app-1 grep -A 3 "fullDomain" /usr/src/Common/Server/Services/StatusPageService.ts | grep "https://"
```

### Impact
- Post-SSO redirect now correctly sends users to the custom domain URL with the auth token
- The frontend `MasterPage.tsx` picks up the `?token=` query parameter and establishes a session cookie on the custom domain
- No impact on status pages without custom domains (falls through to the existing `if (domains.length === 0)` branch)

### Re-applying After Updates
When OneUptime is updated (new Docker images), the patch may need to be re-applied:
1. Check if the issue is fixed upstream
2. If not, repeat steps 2-6 above (extract fresh file, re-apply patch)

### Upstream PR
Consider submitting a PR to the upstream OneUptime repository for a permanent fix.

---

## Files Changed from Upstream

| File | Type | Description |
|------|------|-------------|
| `patches/CustomCodeMonitorCriteria.ts` | Added | Patched version extracted from container with JSON stringify fix |
| `patches/StatusPageService.ts` | Added | Patched version extracted from container with custom domain SSO redirect fix |
| `docker-compose.override.yml` | Added | SSL cert mount + patched file mounts |
| `certs/ServerCerts/monitor.onixai.ai.crt` | Added | CloudFlare Origin certificate |
| `certs/ServerCerts/monitor.onixai.ai.key` | Added | CloudFlare Origin private key |
| `PATCHES.md` | Added | This documentation file |

---

## Verifying Patches Are Applied

```bash
# Check the code patch is in the running container
docker exec oneuptime-probe-ingest-1 grep -A 5 "Convert object results" \
  /usr/src/app/node_modules/Common/Server/Utils/Monitor/Criteria/CustomCodeMonitorCriteria.ts

# Check the SSO redirect patch is in the running container
docker exec oneuptime-app-1 grep -A 3 "fullDomain" \
  /usr/src/Common/Server/Services/StatusPageService.ts | grep "https://"

# Check certificates are mounted
docker exec oneuptime-ingress-1 ls -la /etc/nginx/certs/ServerCerts/
```

---

## 4. Disabled Services

**Date Added:** 2026-02-04
**Updated:** 2026-02-05

### Services Disabled
| Service | Memory Saved | Reason |
|---------|--------------|--------|
| probe-2 | ~384 MB | Single probe sufficient; both probes on same server provide no geographic benefit |

### Note on docs service
The `docs` service cannot be disabled because nginx depends on it as an upstream. Disabling it causes nginx to fail with "host not found in upstream" errors.

### Total Memory Saved
~384 MB

### How It Works
Services are disabled by setting `deploy.replicas: 0` in `docker-compose.override.yml`. This prevents the containers from starting while keeping the configuration intact.

### Re-enabling
To re-enable a service, remove its entry from `docker-compose.override.yml` and run:
```bash
cd /opt/oneuptime
export $(grep -v '^#' config.env | xargs) && docker compose up -d
```
