import type { IncomingMessage } from 'node:http';
import type { Plugin } from 'vite';
import { getKey, type KeyName } from '../keystore.ts';
import {
  llmProviderPreset,
  requireLlmProvider,
  type LlmProvider,
} from '../../shared/llm-providers.ts';
import { resolveLlmProviderConfig } from '../llm-config.ts';
import { proxyMiddleware } from '../proxy.ts';

function keyReader(name: string): string {
  return getKey(name as KeyName);
}

export function llmProviderForRequest(req?: IncomingMessage): LlmProvider {
  const requested = req?.headers['x-openchatcut-provider'];
  return requireLlmProvider(requested === undefined ? getKey('LLM_PROVIDER') : requested);
}

export function llmTarget(req?: IncomingMessage): string {
  return resolveLlmProviderConfig(llmProviderForRequest(req), keyReader).baseUrl;
}

export function llmHeaders(req?: IncomingMessage): Record<string, string> {
  const config = resolveLlmProviderConfig(llmProviderForRequest(req), keyReader);
  if (!config.apiKey) return {};
  return { 'x-api-key': config.apiKey, 'anthropic-version': '2023-06-01' };
}

export function llmErrorMessage(status: number, req?: IncomingMessage): string {
  const label = llmProviderPreset(llmProviderForRequest(req)).label;
  if (status === 401 || status === 403) {
    return `${label} 认证失败。请在“设置 → Agent 模型”中检查 API Key。`;
  }
  if (status === 402 || status === 429) {
    return `${label} 额度不足或请求过于频繁。请检查账户额度，稍后重试。`;
  }
  if (status === 404) {
    return `${label} 的接口或模型不存在。请检查 Base URL 和模型名称。`;
  }
  if (status >= 500) {
    return `${label} 服务暂时不可用（HTTP ${status}）。请稍后重试或切换模型。`;
  }
  return `${label} 请求失败（HTTP ${status}）。请检查“设置 → Agent 模型”中的连接配置。`;
}

/** One dynamic proxy implementation shared by Vite dev and Electron production. */
export function llmProxyPlugin(): Plugin {
  return {
    name: 'openchatcut-llm-proxy',
    configureServer(server) {
      server.middlewares.use('/llm', (req, res, next) => {
        try {
          llmProviderForRequest(req);
        } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: { message: 'Unsupported LLM provider' } }));
          return;
        }
        next();
      });
      server.middlewares.use('/llm', proxyMiddleware({
        target: llmTarget,
        headers: llmHeaders,
        forceJsonContentType: true,
        errorMessage: llmErrorMessage,
      }));
    },
  };
}
