import { describe, it, expect } from 'vitest';
import { selectRoute } from '../../src/runtime/router.js';
import { getProviderPolicies, getCodexConfig } from '../../src/runtime/config.js';

const config = {
  provider_policies: getProviderPolicies(),
  codex: getCodexConfig(),
};

describe('selectRoute — basic chain selection', () => {
  it('chat requestType selects openai_api gpt-4.1-mini as first entry', () => {
    const result = selectRoute('chat', config);
    expect(result.task_class).toBe('chat');
    expect(result.provider).toBe('openai_api');
    expect(result.selected_model).toBe('gpt-4.1-mini');
    expect(result.route_chain).toHaveLength(3);
    expect(result.fallback_chain).toHaveLength(2);
  });

  it('technical_work selects codex_oauth_worker as first entry', () => {
    const result = selectRoute('technical_work', config);
    expect(result.task_class).toBe('technical_work');
    expect(result.provider).toBe('codex_oauth_worker');
    expect(result.selected_model).toBe('gpt-5.4');
    expect(result.route_chain).toHaveLength(3);
    expect(result.fallback_chain).toHaveLength(2);
  });

  it('lightweight_local_task selects small ollama model first', () => {
    const result = selectRoute('lightweight_local_task', config);
    expect(result.task_class).toBe('lightweight_local_task');
    expect(result.provider).toBe('ollama');
    expect(result.selected_model).toBe('qwen2.5:3b-instruct');
    expect(result.route_chain).toHaveLength(2);
    expect(result.fallback_chain).toHaveLength(1);
  });

  it('unknown requestType falls back to chat chain', () => {
    const result = selectRoute('unknown_type', config);
    expect(result.task_class).toBe('unknown_type');
    expect(result.provider).toBe('openai_api');
    expect(result.route_chain).toHaveLength(3);
  });

  it('empty requestType falls back to chat chain', () => {
    const result = selectRoute('', config);
    expect(result.task_class).toBe('chat');
    expect(result.provider).toBe('openai_api');
  });

  it('returns { provider: ollama, model: qwen3:14b } as absolute fallback when chain is empty', () => {
    const result = selectRoute('chat', { provider_policies: {} });
    expect(result.provider).toBe('ollama');
    expect(result.selected_model).toBe('qwen3:14b');
    expect(result.route_chain).toHaveLength(0);
    expect(result.fallback_chain).toHaveLength(0);
  });
});

describe('selectRoute — force_task_class override', () => {
  it('force_task_class overrides requestType', () => {
    const result = selectRoute('chat', config, { force_task_class: 'technical_work' });
    expect(result.task_class).toBe('technical_work');
    expect(result.provider).toBe('codex_oauth_worker');
  });
});

describe('selectRoute — force_provider', () => {
  it('force_provider picks matching route from chain', () => {
    const result = selectRoute('chat', config, { force_provider: 'ollama' });
    expect(result.provider).toBe('ollama');
    // first ollama in chat chain is qwen3:8b
    expect(result.selected_model).toBe('qwen3:8b');
  });

  it('force_provider=codex_oauth_worker not in chat chain uses default codex model', () => {
    const result = selectRoute('chat', config, { force_provider: 'codex_oauth_worker' });
    expect(result.provider).toBe('codex_oauth_worker');
    expect(result.selected_model).toBe('gpt-5.4');
  });

  it('force_provider unknown provider uses force_model or current model', () => {
    const result = selectRoute('chat', config, { force_provider: 'anthropic', force_model: 'claude-3' });
    expect(result.provider).toBe('anthropic');
    expect(result.selected_model).toBe('claude-3');
  });

  it('force_provider unknown without force_model uses currently selected model', () => {
    const result = selectRoute('chat', config, { force_provider: 'anthropic' });
    expect(result.provider).toBe('anthropic');
    // selected.model at the time of unknown force_provider = first in chat chain = gpt-4.1-mini
    expect(result.selected_model).toBe('gpt-4.1-mini');
  });
});

describe('selectRoute — force_model', () => {
  it('force_model overrides the model while keeping the selected provider', () => {
    const result = selectRoute('technical_work', config, { force_model: 'gpt-4o' });
    expect(result.provider).toBe('codex_oauth_worker');
    expect(result.selected_model).toBe('gpt-4o');
  });

  it('force_model applied after force_provider', () => {
    const result = selectRoute('chat', config, { force_provider: 'ollama', force_model: 'qwen3:14b' });
    expect(result.provider).toBe('ollama');
    expect(result.selected_model).toBe('qwen3:14b');
  });
});

describe('selectRoute — fallback_chain', () => {
  it('fallback_chain is route_chain without the first entry', () => {
    const result = selectRoute('technical_work', config);
    expect(result.fallback_chain[0]).toEqual({ provider: 'ollama', model: 'qwen2.5-coder:14b' });
    expect(result.fallback_chain[1]).toEqual({ provider: 'ollama', model: 'qwen3-coder:30b-a3b-q4_K_M' });
  });
});

describe('selectRoute — config without codex model_alias', () => {
  it('defaults to gpt-5.4 when codex model_alias is not set', () => {
    const result = selectRoute('chat', { provider_policies: getProviderPolicies() }, {
      force_provider: 'codex_oauth_worker',
    });
    expect(result.selected_model).toBe('gpt-5.4');
  });
});
