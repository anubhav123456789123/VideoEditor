import { LLM_PROVIDER_PRESETS, llmProviderConfigNames } from '../../../shared/llm-providers';
import { secret, text, type SettingsVendorPage } from './settingsFields';

const CLAUDE = LLM_PROVIDER_PRESETS[0];
const CLAUDE_NAMES = llmProviderConfigNames(CLAUDE.id);

const CLAUDE_API_PAGE: SettingsVendorPage = {
  key: 'llm/anthropic',
  vendor: 'anthropic',
  title: 'Claude',
  note: '粘贴 Anthropic API Key 即可与 Claude 对话并让它直接编辑时间线。也可以在「Claude Code」页使用 Claude 订阅登录。',
  noteAction: { label: '外部 Agent 接入 (MCP)', action: 'open-mcp-guide' },
  fields: [
    secret(CLAUDE_NAMES.apiKey, 'API Key'),
    {
      name: CLAUDE_NAMES.model,
      label: '模型',
      kind: 'text',
      defaultLabel: CLAUDE.defaultModel,
      discoverableModel: true,
      note: '测试连接后可直接选择接口返回的模型，也可以手动填写模型 ID。',
      options: [{ value: CLAUDE.defaultModel, label: CLAUDE.defaultModel }],
    },
    {
      name: CLAUDE_NAMES.baseUrl,
      label: 'API URL',
      kind: 'text',
      defaultLabel: CLAUDE.baseUrl,
      note: '填写完整 API 前缀；可使用官方地址、自建网关或兼容中转。',
    },
  ],
};

const CLAUDE_CODE_PAGE: SettingsVendorPage = {
  key: 'llm/claude-code',
  vendor: 'anthropic',
  title: 'Claude Code',
  connection: 'claude-code',
  note: '使用 Claude 订阅登录，由官方 Claude Code CLI 管理凭据、续期与退出，OpenChatCut 不会读取或显示 OAuth 凭据。'
    + '在终端运行 claude auth login（或 claude setup-token 获取长期令牌）完成登录后，点击“重新检测”。',
  fields: [
    {
      name: 'CLAUDE_CODE_MODEL', label: 'Claude Code 模型', kind: 'text',
      defaultLabel: 'Claude Code 默认模型', discoverableModel: true,
      note: '登录后可从可用模型中选择，也可以手动填写别名（如 sonnet / opus / haiku）。',
    },
  ],
};

export const PROXY_PAGE: SettingsVendorPage = {
  key: 'agent/proxy', vendor: 'proxy', title: '网络代理', kind: 'settings',
  note: '访问 Claude API 失败时，可在此填写本地代理地址（如 http://127.0.0.1:7890）。留空则使用系统环境变量（HTTPS_PROXY / HTTP_PROXY）。',
  fields: [text('PROXY_URL', '代理地址', '例如 http://127.0.0.1:7890')],
};

export const AGENT_VENDOR_PAGES: readonly SettingsVendorPage[] = [CLAUDE_API_PAGE, CLAUDE_CODE_PAGE];
