// Export the Claude Code session logs for this project into ai-logs/.
//
//   npm run export-ai-logs                 (default: this project's Claude Code history)
//   node tools/export-ai-logs.ts <dir>     (a different history folder)
//
// 1. Copies every raw session .jsonl unchanged into ai-logs/raw/: the tool's
//    own history, which is what the challenge asks for.
// 2. Renders each one as a readable Markdown transcript in ai-logs/: user
//    messages, assistant replies, and each tool call with a trimmed result.

import { copyFileSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";

const projectSlug = process.cwd().replace(/[:\\/]/g, "-");
const source = process.argv[2] ?? join(homedir(), ".claude", "projects", projectSlug);
const outDir = join(process.cwd(), "ai-logs");
const rawDir = join(outDir, "raw");
mkdirSync(rawDir, { recursive: true });

const MAX_RESULT = 600;
const MAX_INPUT = 400;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}… [${s.length - n} more chars]` : s);
const fence = (s: string) => "```\n" + s.replace(/```/g, "ˋˋˋ") + "\n```";

function toolInputSummary(name: string, input: Record<string, unknown>): string {
  const pick = input.command ?? input.file_path ?? input.pattern ?? input.url ?? input.query ?? input.prompt;
  const desc = typeof input.description === "string" ? ` — ${input.description}` : "";
  return `**${name}**${desc}\n\n` + fence(clip(typeof pick === "string" ? pick : JSON.stringify(input), MAX_INPUT));
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((c) => (c?.type === "text" ? c.text : `[${c?.type ?? "content"}]`)).join("\n");
  }
  return JSON.stringify(content);
}

function render(file: string): string {
  const out: string[] = [`# Claude Code session ${basename(file, ".jsonl")}`, ""];
  out.push(
    "Rendered from the raw log in `raw/` by `tools/export-ai-logs.ts`. Tool results are trimmed;",
    "the raw `.jsonl` has everything. Model thinking blocks are not rendered here.",
    "",
  );
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    let entry: any;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type !== "user" && entry.type !== "assistant") continue;
    const when = entry.timestamp ? ` · ${entry.timestamp}` : "";
    const content = entry.message?.content;
    const blocks = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];

    for (const b of blocks) {
      if (entry.type === "user" && b.type === "text" && b.text?.trim()) {
        out.push(`---`, ``, `## 🧑 User${when}`, ``, b.text.trim(), ``);
      } else if (entry.type === "user" && b.type === "tool_result") {
        out.push(`<details><summary>result${b.is_error ? " (error)" : ""}</summary>`, ``, fence(clip(resultText(b.content), MAX_RESULT)), ``, `</details>`, ``);
      } else if (entry.type === "assistant" && b.type === "text" && b.text?.trim()) {
        out.push(`## 🤖 Claude${when}`, ``, b.text.trim(), ``);
      } else if (entry.type === "assistant" && b.type === "tool_use") {
        out.push(`> 🔧 ${toolInputSummary(b.name, b.input ?? {}).replace(/\n/g, "\n> ")}`, ``);
      }
    }
  }
  return out.join("\n");
}

const files = readdirSync(source).filter((f) => f.endsWith(".jsonl"));
if (files.length === 0) throw new Error(`No .jsonl session logs in ${source}`);

for (const f of files) {
  const src = join(source, f);
  copyFileSync(src, join(rawDir, f));
  writeFileSync(join(outDir, f.replace(/\.jsonl$/, ".md")), render(src));
  console.log(`exported ${f} (${(statSync(src).size / 1e6).toFixed(1)} MB)`);
}
console.log(`-> ${outDir}`);
