/**
 * DeepSeek API 客户端
 * @see https://api-docs.deepseek.com/
 */
import type { DeepSeekConfig, LLMMessage, LLMResponse } from './types.js';

const DEFAULT_BASE_URL = 'https://api.deepseek.com';
// DeepSeek 最新模型 (2026.07 更新)
// - deepseek-v4-flash: 快速模型（替代原 deepseek-chat）
// - deepseek-v4-pro: 专业模型（支持思考模式）
// 注意: deepseek-chat 和 deepseek-reasoner 已于 2026/07/24 弃用
const DEFAULT_MODEL = 'deepseek-v4-flash';

export class DeepSeekClient {
  private config: Required<DeepSeekConfig>;

  constructor(config: DeepSeekConfig) {
    this.config = {
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || DEFAULT_BASE_URL,
      model: config.model || DEFAULT_MODEL,
      temperature: config.temperature ?? 0.7,
      maxTokens: config.maxTokens ?? 4096,
    };
  }

  /**
   * 发送聊天请求
   * @param messages 消息数组
   * @param options 可选参数
   * @param options.enableThinking 启用思考模式（仅 deepseek-v4-pro 支持）
   * @param options.reasoningEffort 推理努力程度: "low" | "medium" | "high"
   */
  async chat(
    messages: LLMMessage[],
    options?: {
      enableThinking?: boolean;
      reasoningEffort?: 'low' | 'medium' | 'high';
    }
  ): Promise<LLMResponse> {
    const url = `${this.config.baseUrl}/chat/completions`;

    // 构建请求体
    const body: Record<string, any> = {
      model: this.config.model,
      messages,
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens,
      stream: false,
    };

    // 启用思考模式（需要 deepseek-v4-pro 模型）
    if (options?.enableThinking) {
      body.thinking = { type: 'enabled' };
      if (options.reasoningEffort) {
        body.reasoning_effort = options.reasoningEffort;
      }
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`DeepSeek API 错误: ${response.status} - ${error}`);
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
      };
    };

    return {
      content: data.choices?.[0]?.message?.content || '',
      usage: data.usage ? {
        promptTokens: data.usage.prompt_tokens,
        completionTokens: data.usage.completion_tokens,
        totalTokens: data.usage.total_tokens,
      } : undefined,
    };
  }

  /**
   * 单条消息请求
   */
  async ask(systemPrompt: string, userMessage: string): Promise<string> {
    const response = await this.chat([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ]);
    return response.content;
  }
}
