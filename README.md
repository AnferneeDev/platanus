# Agentic Procurement

An MCP server that gives any AI agent the ability to **discover local businesses** and **negotiate with them via WhatsApp** -- autonomously.

Say "find me bakeries in Buenos Aires and ask them about bulk pricing" and the agent handles everything: Google Places search, WhatsApp messaging, reply tracking, and negotiation.

## How It Works

```
You: "Find bakeries near downtown Buenos Aires"
  → AI calls find_local_business → Google Places returns 5 bakeries with phone numbers

You: "Message Panadería Sol asking about 200 medialunas for Friday"
  → AI calls send_whatsapp_message → Real WhatsApp message lands on their phone

You: "Check if they replied"
  → AI calls check_whatsapp_replies → Returns the business's response

You: "Counter-offer at 15% less for a recurring monthly order"
  → AI calls send_whatsapp_message → Follow-up negotiation sent
```

## Architecture

```
┌──────────────┐  stdio (JSON-RPC)  ┌──────────────┐  HTTP  ┌───────────────────┐
│  AI Client   │◄──────────────────►│  MCP Server  │◄──────►│ WhatsApp Sidecar  │
│  (OpenCode,  │                    │  (4 tools)   │        │ (whatsapp-web.js) │
│  Claude, etc)│                    └──────┬───────┘        └────────┬──────────┘
└──────────────┘                           │                         │
                                      leads.json              QR at :3001/qr
                                           │
                                    Google Places API
```

The MCP server communicates with the AI client via stdio. WhatsApp runs as a separate sidecar process to keep the QR code scanning flow independent from the MCP protocol.

## MCP Tools

| Tool | Description |
|------|-------------|
| `connect_whatsapp` | Check connection status, get QR code URL for scanning |
| `find_local_business` | Search Google Places for businesses with phone numbers |
| `send_whatsapp_message` | Send a real WhatsApp message to any phone number |
| `check_whatsapp_replies` | Poll for incoming replies from contacted businesses |

## Quick Start

### 1. Install

```bash
git clone https://github.com/your-user/agentic-procurement.git
cd agentic-procurement
npm install
cp .env.example .env
# Add your Google Places API key to .env
```

### 2. Start the WhatsApp sidecar (Terminal 1)

```bash
npm run sidecar
```

Open `http://localhost:3001/qr` and scan the QR code with your phone.

### 3. Connect to your AI client (Terminal 2)

**OpenCode** -- add to your MCP config:

```json
{
  "mcpServers": {
    "agentic-procurement": {
      "command": "npx",
      "args": ["tsx", "src/index.ts"],
      "cwd": "/path/to/agentic-procurement",
      "env": {
        "GOOGLE_PLACES_API_KEY": "your-key-here"
      }
    }
  }
}
```

**Claude Desktop** -- add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "agentic-procurement": {
      "command": "npx",
      "args": ["tsx", "/path/to/agentic-procurement/src/index.ts"],
      "env": {
        "GOOGLE_PLACES_API_KEY": "your-key-here"
      }
    }
  }
}
```

### 4. Start talking

```
"Connect to WhatsApp"
"Find catering services in Buenos Aires"
"Send a message to the first one asking about pricing for 100 empanadas"
"Check if they replied"
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_PLACES_API_KEY` | Yes | Google Places API key ($200/month free credit) |
| `SIDECAR_PORT` | No | Port for WhatsApp sidecar (default: 3001) |

## Tech Stack

- **Node.js + TypeScript** -- MCP server and sidecar
- **@modelcontextprotocol/sdk** -- Stdio transport MCP implementation
- **whatsapp-web.js** -- WhatsApp Web bridge (no Meta API costs)
- **Google Places API** -- Business discovery ($200/month free tier)
- **Local JSON file** -- Lead and conversation state storage

## Why MCP Instead of Screen Control?

Tools like OpenClaw give AI agents full computer control -- they open browsers, click buttons, type text. That works, but it's slow and fragile.

This MCP server is the **surgical approach**: structured API calls that execute instantly. No screenshots, no mouse movements, no fumbling. The AI gets direct tools to search, message, and negotiate.

| | Screen Control | This MCP |
|---|---|---|
| Speed | Slow (screenshot/click loop) | Instant (direct API) |
| Reliability | Fragile (UI changes break it) | Solid (structured I/O) |
| Setup | Dedicated machine needed | `npm install` and go |

## License

MIT
