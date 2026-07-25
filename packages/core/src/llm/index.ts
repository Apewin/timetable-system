/**
 * LLM 模块 - DeepSeek API 集成
 * @see https://api-docs.deepseek.com/
 */

// 导出类型
export type {
  DeepSeekConfig,
  DeepSeekChatOptions,
  LLMMessage,
  LLMResponse,
  ScheduleSuggestion,
  ConstraintExplanation,
  ConflictResolution,
  LLMchedulingRequest,
  LLMchedulingResponse,
} from './types.js';

// 导出客户端
export { DeepSeekClient } from './deepseek.js';
