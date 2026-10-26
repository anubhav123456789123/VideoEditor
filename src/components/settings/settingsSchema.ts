// Set the information architecture of the panel (first-level classification → second-level capability group → third-level provider page → fields) and pure display logic.
// Three columns: Left tree = Category → Capability; Middle column = Vendor list under this capability; Right column = Configuration page of the selected vendor.
// Agent LLM saves independent API URLs, API Keys and models for each vendor; the capability to generate classes can be additionally provided
// Default provider route. Layout/interaction is in SettingsDialog.tsx, vendor icons are in vendorIcons.tsx.
// Security invariant: the secret field only has a Boolean status, and the value will never be backfilled; the model/routing field is a non-secret configuration,
// The current value is echoed through the models channel of GET /api/keys (server-side NON_SECRET_NAMES whitelist).
import { t } from '../../i18n/locale';
import type { ClaudeCodeAgentStatus } from '../../../shared/claude-code-agent';
import {
  directory,
  secret,
  text,
  type KeyStatusResponse,
  type SelectOption,
  type SettingsCategory,
  type SettingsField,
  type SettingsGroup,
  type SettingsVendorPage,
} from './settingsFields';
import { LOCAL_ASR_SETTINGS_ROUTE, ROUTE_NEEDS, TRANSCRIPTION_SETTINGS_GROUP, localAsrPage } from './settingsMediaProviders';
import { AGENT_VENDOR_PAGES, PROXY_PAGE } from './settingsAgentProviders';

export type {
  FieldKind,
  KeyState,
  KeyStatusResponse,
  SelectOption,
  SettingsCategory,
  SettingsField,
  SettingsGroup,
  SettingsVendorPage,
} from './settingsFields';

export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  {
    key: 'agent', title: 'Agent 模型', icon: 'sparkles',
    groups: [
      { key: 'llm', title: 'Claude',
        hint: '对话与工具调用的核心，未配置无法对话。',
        vendors: AGENT_VENDOR_PAGES },
    ],
  },
  {
    key: 'proxy', title: '网络代理', icon: 'plug',
    groups: [
      { key: 'proxy', title: '网络代理', hint: '统一配置服务端访问海外 API 使用的代理地址。', vendors: [PROXY_PAGE] },
    ],
  },
  {
    key: 'assets', title: '素材 · 转写', icon: 'folder',
    groups: [
      { key: 'stock', title: '在线图库', hint: 'search_stock_media · 搜索可商用图片 / 视频素材。',
        vendors: [
          { key: 'stock/pexels', vendor: 'pexels', title: 'Pexels', fields: [secret('PEXELS_API_KEY', 'API Key')] },
          { key: 'stock/pixabay', vendor: 'pixabay', title: 'Pixabay', fields: [secret('PIXABAY_API_KEY', 'API Key')] },
          { key: 'stock/unsplash', vendor: 'unsplash', title: 'Unsplash', fields: [secret('UNSPLASH_ACCESS_KEY', 'Access Key')] },
          { key: 'stock/freesound', vendor: 'freesound', title: 'Freesound', fields: [secret('FREESOUND_API_KEY', 'API Key')] },
        ] },
      TRANSCRIPTION_SETTINGS_GROUP,
    ],
  },
  {
    key: 'cloud', title: '存储', icon: 'cloud',
    groups: [
      { key: 'storage', title: '默认工程位置', hint: '新工程和生成素材的默认保存位置，以及可选的 R2 云备份。',
        vendors: [
          { key: 'storage/projects', vendor: 'localdisk', title: '默认工程位置',
            note: '新建工程、历史版本和应用生成的素材保存在这里。桌面端从外部拖入的文件和文件夹保留在原位置，'
              + '工程只建立引用；浏览器运行时会上传托管副本。修改后重启应用生效。',
            fields: [
              directory('OPENCHATCUT_DATA_DIR', '默认工程位置', '应用默认数据目录',
                '桌面端点击“选择目录”；也可手动输入绝对路径（可用 ~/ 开头）。清除后回到默认目录。'),
            ] },
          { key: 'storage/r2', vendor: 'r2', title: 'Cloudflare R2',
            note: '未配置时素材只存本机。配置后：每次上传同步写入 R2（桶保持私有，'
              + '读取经本地服务回源，src 路径不变）；本机缺文件时自动从云端取回。改动即时生效。'
              + 'R2 控制台建桶 → R2 API Token（Object Read & Write）即可拿到下面四个值。',
            fields: [
              { name: 'R2_ENABLED', label: '云同步', kind: 'toggle',
                note: '停用后新上传只存本地（密钥保留、已上云文件不受影响）；重新启用即恢复写穿。' },
              secret('R2_ACCOUNT_ID', 'Account ID'),
              secret('R2_ACCESS_KEY_ID', 'Access Key ID'),
              secret('R2_SECRET_ACCESS_KEY', 'Secret Access Key'),
              secret('R2_BUCKET', 'Bucket 名'),
            ] },
        ] },
    ],
  },
  {
    key: 'tools', title: '增强工具', icon: 'sliders',
    groups: [
      { key: 'sandbox', title: '沙箱执行', hint: 'run_code · 云端沙箱运行 ffmpeg / node / python。',
        vendors: [
          { key: 'sandbox/e2b', vendor: 'e2b', title: 'E2B',
            note: '云端隔离 Linux 沙箱，不触碰本机文件。Agent 用它跑 run_code：ffprobe 探测素材时长 / '
              + '尺寸编码、ffmpeg 转码 / 抽帧 / 加工音视频、执行 node / python 技能脚本，结果回传后'
              + '由本地工具应用到时间线。未配置只影响这些工具，剪辑与预览不受影响。',
            fields: [
              secret('E2B_API_KEY', 'API Key'),
              text('E2B_TEMPLATE', '模板 ID（可选）', undefined,
                '默认模板不带 ffmpeg；转码 / 抽帧类任务需自建含 ffmpeg 的模板并填其 ID。'),
            ] },
        ] },
      { key: 'web', title: '网页抓取', hint: 'web_browser · 抓取网页内容供 Agent 参考。',
        vendors: [
          { key: 'web/firecrawl', vendor: 'firecrawl', title: 'Firecrawl',
            fields: [secret('FIRECRAWL_API_KEY', 'API Key')] },
        ] },
      { key: 'publish', title: '发布到社交平台', hint: 'publish_to_social · 把导出的成片发布到 TikTok、Instagram、YouTube 等平台。',
        vendors: [
          { key: 'publish/upload-post', vendor: 'uploadpost', title: 'Upload-Post',
            note: '一个 Key 发布到 TikTok、Instagram、YouTube、LinkedIn、Facebook、X、Threads、Pinterest、Bluesky。'
              + '先在 Upload-Post 创建一个 Profile 并连接各平台账号，再把 Profile 名称填在下面。'
              + 'Agent 发布前总会先预览平台、标题与视频，等你确认后才上传；YouTube 默认私密。',
            fields: [
              secret('UPLOAD_POST_API_KEY', 'API Key'),
              text('UPLOAD_POST_PROFILE', 'Profile', undefined, '在 Upload-Post 控制台创建、已连接社交账号的 Profile 名称。'),
            ] },
        ] },
    ],
  },
  {
    key: 'interface', title: '界面', icon: 'layoutPanel',
    groups: [
      { key: 'display', title: '显示', hint: '界面缩放与显示相关设置。',
        vendors: [
          { key: 'display/scale', vendor: 'localasr', title: '界面缩放',
            note: '调整整个编辑器的缩放比例（80%–150%）。桌面版保存后立即生效，也可用 Ctrl/Cmd + +/- 快速调整、Ctrl/Cmd + 0 复位。浏览器版请使用浏览器自带缩放。',
            fields: [
              { name: 'UI_SCALE', label: '界面缩放', kind: 'select', defaultLabel: '100%',
                options: [
                  { value: '0.8', label: '80%' },
                  { value: '0.9', label: '90%' },
                  { value: '1', label: '100%' },
                  { value: '1.1', label: '110%' },
                  { value: '1.25', label: '125%' },
                  { value: '1.5', label: '150%' },
                ] },
            ] },
        ] },
    ],
  },
  {
    key: 'local', title: '本地模型', icon: 'database',
    groups: [
      { key: 'local', title: '本地模型', hint: '本地转写、节拍与音乐分析、画面语义搜索。模型按需安装，数据不出本机。',
        vendors: [
          { key: LOCAL_ASR_SETTINGS_ROUTE, vendor: 'localasr', title: '本地转写', icon: 'mic', kind: 'local-models', fields: localAsrPage.fields },
          { key: 'local/music/packs', vendor: 'localasr', title: '节拍与音乐分析', icon: 'music', kind: 'local-models', fields: [] },
          { key: 'local/semantic/setup', vendor: 'localasr', title: '画面语义搜索', icon: 'search', kind: 'local-models', fields: [] },
        ] },
    ],
  },
];

/** Temporary changes: field name in map = temporary storage; '' = clear explicitly (model fields will return to default).*/
export type StagedValues = Record<string, string>;

export function omitKey(obj: StagedValues, name: string): StagedValues {
  return Object.fromEntries(Object.entries(obj).filter(([k]) => k !== name));
}

/** '' is explicitly cleared and sent as is; non-null values ​​are sent after trimming; pure blank input is regarded as unchanged (to prevent misclearing).*/
export function buildPatch(values: StagedValues): Record<string, string> {
  const patch: Record<string, string> = {};
  for (const [name, raw] of Object.entries(values)) {
    if (raw === '') patch[name] = '';
    else if (raw.trim() !== '') patch[name] = raw.trim();
  }
  return patch;
}

export function savedMessage(): string {
  return t('已保存 · 工具即时生效，Agent 下一条消息即可感知');
}

/** Whether the field goes through the non-confidential models value channel (current value echo; temporary baseline = current value on the server; clear = return to default).*/
export function isModelField(field: SettingsField): boolean {
  return field.kind === 'select' || field.kind === 'toggle' || field.defaultLabel !== undefined;
}

/** Current model/routing value on the server ('' = not set = use default).*/
export function modelValue(status: KeyStatusResponse | null, name: string): string {
  return status?.models?.[name] ?? '';
}

/** provider page "Configured": Every secret field on the page is configured; */
export function vendorConfigured(
  status: KeyStatusResponse | null,
  page: SettingsVendorPage,
  claudeCodeStatus?: ClaudeCodeAgentStatus | null,
): boolean {
  if (page.connection === 'claude-code') {
    return Boolean(claudeCodeStatus?.installed && claudeCodeStatus.account?.loggedIn);
  }
  if (!status) return false;
  const secrets = page.fields.filter((f) => f.kind === 'secret');
  if (secrets.length === 0) return page.fields.some((f) => Boolean(status.keys[f.name]?.configured));
  return secrets.every((f) => Boolean(status.keys[f.name]?.configured));
}
/** Determination of configured capability group: LLM and proxy are page-backed; others use server capability flags. */
export function groupConfigured(
  status: KeyStatusResponse | null,
  group: SettingsGroup,
  claudeCodeStatus?: ClaudeCodeAgentStatus | null,
): boolean {
  if (group.key === 'llm' || group.key === 'proxy') {
    return group.vendors.some((page) =>
      vendorConfigured(status, page, claudeCodeStatus));
  }
  return status ? Boolean(status.caps[group.key]) : false;
}

/** Classification logo: Number of configured capabilities/Total number of capabilities (capability level count).*/
export function categoryGroupStats(
  status: KeyStatusResponse | null,
  category: SettingsCategory,
  claudeCodeStatus?: ClaudeCodeAgentStatus | null,
): { done: number; total: number } {
  return {
    done: category.groups
      .filter((group) =>
        groupConfigured(status, group, claudeCodeStatus)).length,
    total: category.groups.length,
  };
}

/** Select key → ability group in the left tree (the group key is globally unique); if not found, fall back to the first group.*/
export function findGroup(key: string): SettingsGroup {
  return SETTINGS_CATEGORIES.flatMap((c) => c.groups).find((g) => g.key === key)
    ?? SETTINGS_CATEGORIES[0].groups[0];
}

/** Complete options for select rendering: insert "default (xxx)" before model select; routing select comes with "ask every time".*/
export function selectOptions(field: SettingsField): readonly SelectOption[] {
  const base = field.options ?? [];
  if (field.defaultLabel === undefined) return base;
  return [{ value: '', label: t('默认（{name}）', { name: t(field.defaultLabel) }) }, ...base];
}

// Routing requirements live beside the provider groups so settings and capability
// expansion share one focused provider-data surface.

/** Routing drop-down option copy: Add the "(not configured)" suffix when the provider has not configured it, and it is still optional (there is a fallback inquiry guardrail on the Agent side).
 * Non-routing select (model drop-down) returns unchanged.*/
export function selectOptionLabel(
  status: KeyStatusResponse | null, field: SettingsField, opt: SelectOption,
): string {
  if (!field.name.startsWith('PREFERRED_') || opt.value === '') return t(opt.label);
  const needs = ROUTE_NEEDS[opt.value];
  const has = (n: string): boolean => Boolean(status?.keys[n]?.configured);
  const ok = Boolean(needs?.some((group) => group.every(has)));
  return ok ? t(opt.label) : t('{name}（未配置）', { name: t(opt.label) });
}

/** Input box placeholder: secret / Ordinary text never backfills, only describes the status; model text describes the default value.*/
export function fieldPlaceholder(field: SettingsField, configured: boolean, stagedClear: boolean): string {
  if (isModelField(field)) {
    if (stagedClear) return t('恢复默认 · 保存后生效');
    return field.defaultLabel ? t('默认 {name}', { name: t(field.defaultLabel) }) : t('默认');
  }
  if (stagedClear) return t('将清除 · 保存后生效');
  if (configured) return field.placeholder ? t('已自定义 · 留空保持不变') : t('已配置 · 留空保持不变');
  return field.placeholder ? t(field.placeholder) : t('未配置 · 粘贴以启用');
}
