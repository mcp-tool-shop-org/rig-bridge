import type { SiteConfig } from '@mcptoolshop/site-theme';

export const config: SiteConfig = {
  title: '@mcptoolshop/rig-bridge',
  description: 'Cross-rig sync tool for paired dev machines — git-native typed-envelope cross-agent handoffs.',
  logoBadge: 'RB',
  brandName: 'rig-bridge',
  repoUrl: 'https://github.com/mcp-tool-shop-org/rig-bridge',
  npmUrl: 'https://www.npmjs.com/package/@mcptoolshop/rig-bridge',
  footerText: 'MIT Licensed — built by <a href="https://mcp-tool-shop.github.io/" style="color:var(--color-muted);text-decoration:underline">MCP Tool Shop</a>',

  hero: {
    badge: 'v1.0.0 transport surface complete',
    headline: 'Two rigs.',
    headlineAccent: 'One git-native bridge.',
    description:
      "rig-bridge lets paired dev machines exchange typed YAML+markdown envelopes through a shared git repo. " +
      "Eight CLI commands, schema-validated frontmatter, §4.1 body_hash drift detection, and a refuse-non-fast-forward sync that never silently merges.",
    primaryCta: { href: 'https://github.com/mcp-tool-shop-org/rig-bridge#installation', label: 'Get started' },
    secondaryCta: { href: 'handbook/', label: 'Read the Handbook' },
    previews: [
      { label: 'Install', code: 'npm install -g @mcptoolshop/rig-bridge' },
      { label: 'Init', code: 'rig-bridge init --rig-id mac-m5max' },
      { label: 'Send', code: 'rig-bridge send HANDOFF --thread alpha --to windows-5080' },
    ],
  },

  sections: [
    {
      kind: 'features',
      id: 'features',
      title: 'Features',
      subtitle: 'What v1.0.0 ships.',
      features: [
        {
          title: 'Typed envelopes',
          desc:
            "YAML frontmatter validated against a JSON Schema 2020-12 contract. Ten message types " +
            "(REQUEST / HANDOFF / RESPONSE / ACK / RESOLUTION / STATE / RESULT / RECOVERY / VERIFY / DECISIONS), " +
            "five lifecycle markers (▶ ⏸ 🎯 ✅ ❌), kebab-case rig ids.",
        },
        {
          title: 'Drift detection',
          desc:
            "Every envelope carries a SHA-256 body_hash computed over §4.1-normalized body " +
            "(CRLF→LF, trim trailing whitespace, one terminal newline, BOM strip). Cross-rig drift is provable, not hopeful.",
        },
        {
          title: 'Surfacing sync',
          desc:
            "rig-bridge sync auto-resolves only the fast-forward case. Non-FF and any modified existing file refuses + surfaces the divergence at the sync boundary " +
            "(Fossil-style named divergence; Horvitz 1999 mixed-initiative principles).",
        },
        {
          title: 'Human-attested relay',
          desc:
            "rig-bridge relay records DECISIONS / RESPONSE / ACK from a human-in-the-loop. Requires a -relay rig-id suffix " +
            "AND a configured git signing key (Sigstore gitsign / GPG / SSH-sign). Envelope frontmatter carries attested_by + attested_at + nonce + in_reply_to.",
        },
        {
          title: 'Append-only by design',
          desc:
            "Envelopes are immutable files in per-thread directories. Stable IDs, dedupe by filename, no content-merge. " +
            "Kafka / NATS-JetStream effectively-once semantics applied to a git transport.",
        },
        {
          title: '329 tests, 8 commands',
          desc:
            "init / new / send / close / status / thread / sync / relay. Cross-rig E2E proven (Mac↔Windows, CRLF↔LF, 3-rig topology). " +
            "Subprocess CLI tests on the built dist. v1.0.0 is product-ready.",
        },
      ],
    },
    {
      kind: 'code-cards',
      id: 'usage',
      title: 'Quick start',
      cards: [
        {
          title: 'Install',
          code: 'npm install -g @mcptoolshop/rig-bridge\nrig-bridge --version',
        },
        {
          title: 'Initialize a bridge clone',
          code: 'cd <your-shared-bridge-repo>\nrig-bridge init --rig-id mac-m5max',
        },
        {
          title: 'Open a thread + send the first envelope',
          code: 'rig-bridge new bridge-onboarding-01\nrig-bridge send HANDOFF \\\n  --thread bridge-onboarding-01 \\\n  --to windows-5080 \\\n  --tldr "first contact"',
        },
        {
          title: 'Glance at what is open',
          code: 'rig-bridge status\n# → text table by default; pass --json for a stable schema_version: "1.0" object\nrig-bridge status --json | jq \'.threads[] | select(.dirty == true)\'',
        },
        {
          title: 'Pull new envelopes from the peer rig',
          code: '# Fast-forward only by default — refuses non-FF without --auto.\nrig-bridge sync\nrig-bridge sync --auto    # apply the fast-forward pull',
        },
      ],
    },
  ],
};
