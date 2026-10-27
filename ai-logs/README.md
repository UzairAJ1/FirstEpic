# AI session logs

AI tool used: **Claude Code** (model Claude Opus 5.5), in the VS Code extension. No other AI tools
were used.

- `raw/*.jsonl`: the session logs exactly as Claude Code stores them
  (`~/.claude/projects/<project>/`), copied unchanged. This is the tool's own history: every
  prompt, reply, tool call and tool result, with timestamps.
- `*.md`: a readable rendering of each raw log, made by `tools/export-ai-logs.ts`
  (`npm run export-ai-logs`). Tool results are trimmed and thinking blocks are left out; the
  raw file has everything.

Keys that appear in the logs (`sb_secret_…`, `eyJ…` anon/service JWTs,
`super-secret-jwt-token…`) are the fixed **local development** values printed by
`supabase start` on every machine. They are not credentials for any hosted project.
