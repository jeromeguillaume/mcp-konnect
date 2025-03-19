
## Usage

Create an MCP definition in `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "kong": {
      "command": "node",
      "args": [
        "/path/to/mcp-konnect/mcp-konnect-api.js"
      ],
      "env": {
        "KONG_API_KEY": "kpat_...",
      }
    }
  }
}
```

Restart Claude Desktop
