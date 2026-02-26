# 🔌 MCP Server — AI Visual Workflow

## What is MCP?

**MCP (Model Context Protocol)** is an open standard created by Anthropic that lets AI assistants
(like Claude, Copilot, Cursor) connect to **your own tools and data**. Think of it like giving an
AI a set of buttons it can press — each button does something useful.

In this project, the MCP server exposes your **AI workflow architecture data** as tools that any
AI assistant can query.

---

## What Tools Does This Server Provide?

| Tool Name                  | What It Does                                                  |
|----------------------------|---------------------------------------------------------------|
| `get_component_info`       | Look up details about any architecture component (UI, LLM…)  |
| `list_workflow_steps`      | List all 14 steps in the workflow simulation, in order        |
| `search_components`        | Search components by keyword (e.g., "vector", "security")    |
| `explain_workflow_step`    | Get a detailed explanation of a specific workflow step        |
| `get_architecture_overview`| Get a high-level overview of the entire architecture          |

---

## How to Set Up

### Prerequisites
- **Node.js 18+** installed on your computer
- Dependencies already installed (`npm install` was done when you set up the project)

---

### Option 1: Use with VS Code / GitHub Copilot

The configuration is already set up! Just:

1. Open this project folder in VS Code
2. Make sure you have the **GitHub Copilot Chat** extension installed
3. The file `.vscode/mcp.json` tells Copilot about the MCP server
4. In Copilot Chat, you can now ask questions and it will use the tools automatically

> **Example prompts to try in Copilot Chat:**
> - "What components are in the AI workflow?"
> - "Explain the RAG to VDB step"
> - "Search for components related to security"

---

### Option 2: Use with Claude Desktop

1. Open Claude Desktop settings:
   - **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
   - **Mac**: `~/Library/Application Support/Claude/claude_desktop_config.json`

2. Add this to the config file (replace the path with YOUR actual path):

```json
{
  "mcpServers": {
    "ai-visual-workflow": {
      "command": "node",
      "args": ["C:\\Users\\YOUR_USERNAME\\Desktop\\AI Workflow\\AI-Visual-Workflow\\mcp-server\\index.js"]
    }
  }
}
```

3. Restart Claude Desktop — you'll see a 🔌 icon showing the tools are connected.

---

### Option 3: Test from the Command Line

Run the quick test to verify the server starts correctly:

```bash
npm run mcp:test
```

You should see a JSON response containing `"serverInfo"` — that means the server is working!

You can also start the server manually:

```bash
npm run mcp
```

This runs indefinitely, listening for MCP commands on stdin/stdout.

---

## Project Structure

```
AI-Visual-Workflow/
├── mcp-server/
│   └── index.js          ← The MCP server (this is what you added!)
├── .vscode/
│   └── mcp.json          ← VS Code / Copilot MCP configuration
├── App.tsx               ← Your existing frontend (UNCHANGED)
├── services/
│   └── geminiService.ts  ← Your existing AI service (UNCHANGED)
├── package.json          ← Added "mcp" and "mcp:test" scripts
└── MCP-README.md         ← This file
```

**Important:** The MCP server is completely separate from your frontend.
Your existing `npm run dev` command works exactly the same as before.

---

## How It Works (For Beginners)

```
┌─────────────────────────┐
│   AI Assistant           │  (Claude Desktop, Copilot, Cursor, etc.)
│   "What is the LLM?"    │
└──────────┬──────────────┘
           │  Calls tool: get_component_info("LLM")
           ▼
┌─────────────────────────┐
│   MCP Server             │  (mcp-server/index.js — running on YOUR computer)
│   Looks up LLM data     │
│   Returns formatted info │
└──────────┬──────────────┘
           │  Returns result
           ▼
┌─────────────────────────┐
│   AI Assistant           │
│   Shows you the answer   │
│   with LLM details       │
└─────────────────────────┘
```

The communication happens through **stdio** (standard input/output) — the same way
command-line programs work. No network ports, no HTTP servers, no complexity.

---

## FAQ

**Q: Does this change my existing app?**
A: No! The MCP server is a completely separate file. Your frontend (`npm run dev`) is untouched.

**Q: Do I need to keep the MCP server running?**
A: No. AI assistants (Claude Desktop, VS Code) start it automatically when needed.

**Q: Is this open source?**
A: Yes! The MCP SDK is MIT licensed by Anthropic. Your server code is part of your project.

**Q: Can I add more tools?**
A: Absolutely! Look at the existing tools in `mcp-server/index.js` and follow the same pattern.
Each tool needs a name, description, input schema, and a handler function.

---

## Adding Your Own Tools

Here's a template for adding a new tool:

```javascript
server.tool(
  "my_tool_name",                              // Name (no spaces)
  "Description of what this tool does",        // What does it do?
  {
    my_input: z.string().describe("What this input is for"),  // Input schema
  },
  async ({ my_input }) => {
    // Your logic here
    const result = `You asked about: ${my_input}`;
    
    return {
      content: [{ type: "text", text: result }],
    };
  }
);
```

---

## Tech Stack

- **[@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)** — Official MCP TypeScript SDK (MIT License)
- **[zod](https://github.com/colinhacks/zod)** — Input validation library (MIT License)
- **Node.js** — Runtime
