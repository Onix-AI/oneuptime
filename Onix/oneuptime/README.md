# OneUptime Application Config

Human-readable reference of the OneUptime application-level configuration. This supplements the database backup (GCP daily disk snapshots, `daily-last-10-days`) — you can see what's configured at a glance without restoring a snapshot.

## What's Here

| File / Directory | Count | Description |
|------------------|-------|-------------|
| `monitors/` | 28 | One file per monitor — full config including criteria, filters, incident templates, and custom code |
| `monitors/_reference.yaml` | — | UUID-to-name lookup table for statuses, severities, and project |
| `monitor-statuses.yaml` | 3 | Status definitions (Operational, Degraded, Offline) |
| `status-pages.yaml` | 2 | Internal (SSO-protected) and Public status pages |
| `teams.yaml` | 4 | Teams (Owners, Admin, Members, SSO Users) |
| `incident-states.yaml` | 3 | Incident lifecycle (Identified → Acknowledged → Resolved) |

## What's NOT Here

These exist in the database (covered by disk snapshots) but aren't exported via MCP:

- **Labels** — monitor/incident categorization tags
- **Incident severity levels** — Critical, Major, Minor, Warning definitions
- **SSO/SCIM config** — Google Workspace SSO provider settings
- **SMTP/notification config** — email delivery settings
- **Custom fields** — user-defined metadata fields
- **Workflows** — automated actions and integrations
- **Dashboards** — custom dashboard layouts
- **On-call schedules** — rotation and escalation policies
- **Monitor groups** — logical grouping of monitors
- **Status page resources/groups/domains** — which monitors appear on which status pages, resource grouping, and custom domain mappings
- **API keys** — integration tokens
- **User notification preferences** — per-user notification settings
- **Monitor secrets** — encrypted values like `SupabaseAnonKey` (referenced in monitor configs as `{{monitorSecrets.*}}`)

## Re-Export Instructions

To refresh these files, use the OneUptime MCP tools:

```
# From Claude Code with the OneUptime MCP server configured:

1. List monitors (paginated, limit=100, sort by name ASC) → monitors/*.yaml
2. List monitor statuses (sort by priority ASC) → monitor-statuses.yaml
3. List status pages (sort by name ASC) → status-pages.yaml
4. List teams (sort by name ASC) → teams.yaml
5. List incident states (sort by order ASC) → incident-states.yaml
```

The MCP API returns max 5 results per page regardless of limit. Use `skip` parameter to paginate (skip=0, 5, 10, ...).
