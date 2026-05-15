# Security Policy

## Supported Versions

| Version            | Supported |
|--------------------|-----------|
| 0.0.1-pre-swarm    | Yes       |
| < 0.0.1-pre-swarm  | No        |

Pre-release versions receive security patches; only the latest pre-release is supported.

## Reporting a Vulnerability

Email: **64996768+mcp-tool-shop@users.noreply.github.com**

Include:
- Description of the vulnerability
- Steps to reproduce
- Version affected
- Potential impact

### Response timeline

| Action | Target |
|--------|--------|
| Acknowledge report | 48 hours |
| Assess severity | 7 days |
| Release fix | 30 days |

## Scope

This tool operates **locally** against a git remote configured by the operator.

- **Data touched:** the local clone of the bridge repo + `.bridge/config.yaml` (rig identifier + optional display_name) + message files (markdown with YAML frontmatter). No database. No telemetry endpoints.
- **Network egress:** only to the configured git remote (GitHub via HTTPS by default). No other network access.
- **Permissions required:** read/write access to the local bridge repo and `.bridge/` directory; git credentials for push (delegated to the operator's existing git config).
- **No telemetry by default** — rig-bridge does not collect, transmit, or persist any usage data. The only data that leaves the local machine is the commits the operator explicitly pushes.
- **Trust model:** rig-bridge trusts GitHub TLS for transport integrity and trusts the local git config for authorship. It does not sign commits itself; operators can layer GPG/SSH commit signing via existing git mechanisms.
