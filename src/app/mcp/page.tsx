import Link from "next/link";
import { DashboardSidebar } from "@/components/dashboard/sidebar";
import { CopyField } from "@/components/dashboard/copy-field";

const ENDPOINT = "https://radiri.vercel.app/api/mcp";

const CLAUDE_CODE = `claude mcp add --transport http radiri ${ENDPOINT}`;

const DESKTOP_CONFIG = `{
  "mcpServers": {
    "radiri": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "${ENDPOINT}"]
    }
  }
}`;

const CURSOR_CONFIG = DESKTOP_CONFIG;

const TOOLS = [
  {
    name: "compare_routes",
    detail: "Every source for one pair and size, ranked, with verbatim failures.",
  },
  {
    name: "liquidity_matrix",
    detail: "A sweep of stablecoin pairs at one size, with gaps and spreads.",
  },
  {
    name: "list_stablecoins",
    detail: "The live stablecoin catalog Radiri can quote.",
  },
];

export default function McpPage() {
  return (
    <div className="flex min-h-screen">
      <DashboardSidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <main className="mx-auto w-full max-w-[880px] flex-1 px-4 pt-8 pb-12 md:pt-10">
          <p className="font-mono text-[10px] tracking-[0.14em] text-muted-foreground uppercase">
            Integrations
          </p>
          <h1 className="font-display mt-2 text-3xl leading-tight">Connect Radiri to an agent</h1>
          <p className="mt-2 max-w-[62ch] text-sm text-foreground/60">
            The same engine the dashboard uses is exposed as an MCP server over JSON-RPC 2.0. Any
            MCP client that speaks HTTP can quote routes. No API key, no wallet.
          </p>

          <div className="mt-6 flex flex-col gap-2">
            <span className="font-mono text-[10px] tracking-[0.12em] text-muted-foreground uppercase">
              Endpoint
            </span>
            <CopyField value={ENDPOINT} label="endpoint" />
          </div>

          <section className="mt-8 flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Claude Code</h2>
            <p className="text-xs text-foreground/60">
              Run this once. The endpoint is added per project or user depending on where you run it.
            </p>
            <CopyField value={CLAUDE_CODE} label="Claude Code command" />
          </section>

          <section className="mt-8 flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Claude Desktop</h2>
            <p className="text-xs text-foreground/60">
              Desktop speaks stdio, so bridge the HTTP endpoint with <code className="font-mono">mcp-remote</code>.
              Add this to <code className="font-mono">claude_desktop_config.json</code>, then restart.
            </p>
            <CopyField value={DESKTOP_CONFIG} label="Claude Desktop config" />
          </section>

          <section className="mt-8 flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Cursor</h2>
            <p className="text-xs text-foreground/60">
              Same shape, in <code className="font-mono">.cursor/mcp.json</code> at the project root.
            </p>
            <CopyField value={CURSOR_CONFIG} label="Cursor config" />
          </section>

          <section className="mt-8 flex flex-col gap-2">
            <h2 className="text-sm font-semibold">ChatGPT</h2>
            <p className="text-xs text-foreground/60">
              ChatGPT connectors require an OAuth-protected remote MCP server with SSE streaming. This
              endpoint is plain JSON-RPC over POST, so it works with Claude Code, Claude Desktop and
              Cursor today. ChatGPT needs a wrapper in front of it; that is not built yet.
            </p>
          </section>

          <section className="mt-8">
            <h2 className="text-sm font-semibold">Tools</h2>
            <div className="mt-2 divide-y rounded-xl border bg-card">
              {TOOLS.map((tool) => (
                <div key={tool.name} className="flex flex-col gap-1 px-4 py-3">
                  <code className="font-mono text-[12px]">{tool.name}</code>
                  <span className="text-xs text-foreground/60">{tool.detail}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="mt-8 flex flex-col gap-2">
            <h2 className="text-sm font-semibold">Try it from a shell</h2>
            <CopyField
              value={`curl -s ${ENDPOINT} -H 'Content-Type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`}
              label="curl"
            />
          </section>

          <p className="mt-10 text-xs text-foreground/50">
            <Link href="/dashboard" className="underline underline-offset-2 hover:text-foreground">
              Back to the dashboard
            </Link>
          </p>
        </main>
      </div>
    </div>
  );
}
