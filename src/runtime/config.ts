// Extracted verbatim from "Runtime Policy Config" Code node in ghost-runtime-workflow.json
// Node ID: 45631b44-3cf9-44c2-8bfa-8211c17f86e9
// Behavior must remain identical to the live workflow node.

export interface ProviderRoute {
  provider: string;
  model: string;
}

export interface ProviderPolicies {
  chat: ProviderRoute[];
  technical_work: ProviderRoute[];
  lightweight_local_task: ProviderRoute[];
}

export interface OllamaModels {
  small_local_instruction_model: string;
  chat_model: string;
  strong_chat_model: string;
  coding_model: string;
  strong_coding_model: string;
}

export interface OpenAIConfig {
  endpoint: string;
  chat_model_alias: string;
  max_output_tokens: number;
}

export interface CodexConfig {
  model_alias: string;
  worker_mode: string;
}

export function getProviderPolicies(): ProviderPolicies {
  return {
    chat: [
      { provider: 'openai_api', model: 'gpt-4.1-mini' },
      { provider: 'ollama', model: 'qwen3:8b' },
      { provider: 'ollama', model: 'qwen3:14b' },
    ],
    technical_work: [
      { provider: 'codex_oauth_worker', model: 'gpt-5.4' },
      { provider: 'ollama', model: 'qwen2.5-coder:14b' },
      { provider: 'ollama', model: 'qwen3-coder:30b-a3b-q4_K_M' },
    ],
    lightweight_local_task: [
      { provider: 'ollama', model: 'qwen2.5:3b-instruct' },
      { provider: 'ollama', model: 'qwen3:8b' },
    ],
  };
}

export function getOllamaModels(): OllamaModels {
  return {
    small_local_instruction_model: 'qwen2.5:3b-instruct',
    chat_model: 'qwen3:8b',
    strong_chat_model: 'qwen3:14b',
    coding_model: 'qwen2.5-coder:14b',
    strong_coding_model: 'qwen3-coder:30b-a3b-q4_K_M',
  };
}

export function getOpenAIConfig(): OpenAIConfig {
  return {
    endpoint: 'https://api.openai.com/v1/responses',
    chat_model_alias: 'gpt-4.1-mini',
    max_output_tokens: 500,
  };
}

export function getCodexConfig(): CodexConfig {
  return {
    model_alias: 'gpt-5.4',
    worker_mode: 'oauth_cli_wrapper',
  };
}
