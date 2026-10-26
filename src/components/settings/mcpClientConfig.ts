// Claude Code command that registers OpenChatCut's MCP endpoint, for users who
// prefer the CLI over the one-click config writer.
export function claudeMcpAddCommand(endpoint: string, token: string): string {
  return `claude mcp add --transport http openchatcut ${endpoint} --header "Authorization: Bearer ${token}"`;
}
