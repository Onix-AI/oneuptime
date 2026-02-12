import functions_framework
import google.auth
import google.auth.transport.requests
import requests

PROJECT = "onix-ai-oneuptime-production"
ZONE = "northamerica-northeast1-a"
INSTANCE = "oneuptime-production"
BASE_URL = f"https://compute.googleapis.com/compute/v1/projects/{PROJECT}/zones/{ZONE}"


def _get_headers():
    credentials, _ = google.auth.default(
        scopes=["https://www.googleapis.com/auth/compute"]
    )
    credentials.refresh(google.auth.transport.requests.Request())
    return {"Authorization": f"Bearer {credentials.token}"}


@functions_framework.http
def auto_restart_vm(request):
    headers = _get_headers()

    # 1. Get VM status
    resp = requests.get(f"{BASE_URL}/instances/{INSTANCE}", headers=headers)
    resp.raise_for_status()
    instance = resp.json()

    status = instance["status"]
    if status not in ("TERMINATED", "STOPPED", "SUSPENDED"):
        return f"VM is {status}, no action needed", 200

    # 2. Check auto-restart metadata flag
    auto_restart = False
    for item in instance.get("metadata", {}).get("items", []):
        if item["key"] == "auto-restart" and item["value"] == "true":
            auto_restart = True
            break
    if not auto_restart:
        return "auto-restart metadata is not 'true', skipping", 200

    # 3. Check if the last stop was a preemption
    # Operations store targetLink with www.googleapis.com, not compute.googleapis.com
    target = f"https://www.googleapis.com/compute/v1/projects/{PROJECT}/zones/{ZONE}/instances/{INSTANCE}"
    ops_resp = requests.get(
        f"{BASE_URL}/operations",
        headers=headers,
        params={
            "filter": f'targetLink="{target}"',
            "maxResults": 10,
        },
    )
    ops_resp.raise_for_status()

    was_preempted = False
    for op in ops_resp.json().get("items", []):
        op_type = op.get("operationType", "")
        if op_type == "compute.instances.preempted":
            was_preempted = True
            break
        if op_type in ("stop", "suspend"):
            # Manual stop/suspend happened more recently than any preemption
            break
    if not was_preempted:
        return "VM was not preempted (likely manual stop), skipping", 200

    # 4. Restart
    start_resp = requests.post(
        f"{BASE_URL}/instances/{INSTANCE}/start", headers=headers
    )
    start_resp.raise_for_status()
    return f"VM was preempted, restarting {INSTANCE}", 200
