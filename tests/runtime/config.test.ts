import { describe, it, expect } from 'vitest';
import {
  getProviderPolicies,
  getOllamaModels,
  getOpenAIConfig,
  getCodexConfig,
} from '../../src/runtime/config.js';

describe('getProviderPolicies — chain structure', () => {
  it('returns all three policy chains', () => {
    const policies = getProviderPolicies();
    expect(policies).toHaveProperty('chat');
    expect(policies).toHaveProperty('technical_work');
    expect(policies).toHaveProperty('lightweight_local_task');
  });

  it('chat chain has 3 entries with openai_api first', () => {
    const { chat } = getProviderPolicies();
    expect(chat).toHaveLength(3);
    expect(chat[0]).toEqual({ provider: 'openai_api', model: 'gpt-4.1-mini' });
    expect(chat[1]).toEqual({ provider: 'ollama', model: 'qwen3:8b' });
    expect(chat[2]).toEqual({ provider: 'ollama', model: 'qwen3:14b' });
  });

  it('technical_work chain has 3 entries with codex_oauth_worker first', () => {
    const { technical_work } = getProviderPolicies();
    expect(technical_work).toHaveLength(3);
    expect(technical_work[0]).toEqual({ provider: 'codex_oauth_worker', model: 'gpt-5.4' });
    expect(technical_work[1]).toEqual({ provider: 'ollama', model: 'qwen2.5-coder:14b' });
    expect(technical_work[2]).toEqual({ provider: 'ollama', model: 'qwen3-coder:30b-a3b-q4_K_M' });
  });

  it('lightweight_local_task chain has 2 entries with small ollama model first', () => {
    const { lightweight_local_task } = getProviderPolicies();
    expect(lightweight_local_task).toHaveLength(2);
    expect(lightweight_local_task[0]).toEqual({ provider: 'ollama', model: 'qwen2.5:3b-instruct' });
    expect(lightweight_local_task[1]).toEqual({ provider: 'ollama', model: 'qwen3:8b' });
  });

  it('returns a new object on each call (no shared mutation risk)', () => {
    const a = getProviderPolicies();
    const b = getProviderPolicies();
    expect(a).not.toBe(b);
    expect(a.chat).not.toBe(b.chat);
  });
});

describe('getOllamaModels — all model aliases present', () => {
  it('returns all five ollama model fields', () => {
    const models = getOllamaModels();
    expect(models.small_local_instruction_model).toBe('qwen2.5:3b-instruct');
    expect(models.chat_model).toBe('qwen3:8b');
    expect(models.strong_chat_model).toBe('qwen3:14b');
    expect(models.coding_model).toBe('qwen2.5-coder:14b');
    expect(models.strong_coding_model).toBe('qwen3-coder:30b-a3b-q4_K_M');
  });
});

describe('getOpenAIConfig', () => {
  it('returns correct endpoint, model alias, and token limit', () => {
    const cfg = getOpenAIConfig();
    expect(cfg.endpoint).toBe('https://api.openai.com/v1/responses');
    expect(cfg.chat_model_alias).toBe('gpt-4.1-mini');
    expect(cfg.max_output_tokens).toBe(500);
  });
});

describe('getCodexConfig', () => {
  it('returns correct model alias and worker mode', () => {
    const cfg = getCodexConfig();
    expect(cfg.model_alias).toBe('gpt-5.4');
    expect(cfg.worker_mode).toBe('oauth_cli_wrapper');
  });
});
