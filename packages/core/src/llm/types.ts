/**
 * LLM 集成类型定义
 * @see https://api-docs.deepseek.com/
 */

// DeepSeek API 配置
export interface DeepSeekConfig {
  apiKey: string;
  baseUrl?: string;  // 默认 https://api.deepseek.com
  model?: string;    // 默认 deepseek-v4-flash (可选 deepseek-v4-pro)
  temperature?: number;
  maxTokens?: number;
}

// DeepSeek 聊天选项
export interface DeepSeekChatOptions {
  enableThinking?: boolean;  // 启用思考模式（仅 deepseek-v4-pro 支持）
  reasoningEffort?: 'low' | 'medium' | 'high';  // 推理努力程度
}

// LLM 消息
export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

// LLM 响应
export interface LLMResponse {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

// 排课建议
export interface ScheduleSuggestion {
  taskId: string;
  slotId: string;
  roomId: string;
  reason: string;
  confidence: number;  // 0-1
}

// 约束解释
export interface ConstraintExplanation {
  constraintId: string;
  description: string;
  impact: string;
  suggestion: string;
}

// 冲突解决建议
export interface ConflictResolution {
  conflictType: string;
  affectedTasks: string[];
  resolution: string;
  alternatives: string[];
}

// LLM 排课请求
export interface LLMchedulingRequest {
  tasks: any[];
  constraints: any[];
  slots: any[];
  rooms: any[];
  preferences?: string;  // 用户的自然语言偏好
}

// LLM 排课响应
export interface LLMchedulingResponse {
  assignments: Array<{
    taskId: string;
    slotId: string;
    roomId: string;
  }>;
  explanation: string;
  warnings: string[];
}
