// Extracted verbatim from "Classify request" Code node in ghost-runtime-workflow.json
// Node ID: 34834cbf-6a90-45ea-b4e4-d397ce7dfd08
// Behavior must remain identical to the live workflow node.

export interface Message {
  role: string;
  content: string;
}

export interface ClassificationResult {
  request_type: 'chat' | 'technical_work' | 'lightweight_local_task';
}

export const lightweightLocalSignals: ReadonlyArray<string> = [
  'summarize',
  'summary',
  'classify',
  'classification',
  'extract',
  'extraction',
  'tag',
  'tags',
  'title',
  'rename',
  'metadata',
  'rewrite briefly',
  'shorten',
  'bullet points',
  'tl;dr',
  'keywords',
  'categorize',
  'sentiment',
];

export const technicalWorkSignals: ReadonlyArray<string> = [
  'code',
  'python',
  'javascript',
  'typescript',
  'sql',
  'bash',
  'shell',
  'script',
  'regex',
  'bug',
  'debug',
  'stack trace',
  'exception',
  'error',
  'fix',
  'refactor',
  'function',
  'class',
  'module',
  'api',
  'json',
  'yaml',
  'docker',
  'docker compose',
  'container',
  'kubernetes',
  'linux',
  'terminal',
  'cli',
  'database',
  'postgres',
  'query',
  'migration',
  'schema',
  'nginx',
  'config',
  'deploy',
  'deployment',
  'devops',
  'infrastructure',
  'repository',
  'repo',
  'git',
  'test failure',
  'failing test',
  'compile',
  'build failed',
  'implementation',
];

export const technicalIntentSignals: ReadonlyArray<string> = [
  'write a',
  'implement',
  'update the code',
  'modify the workflow',
  'patch',
  'edit the file',
  'run this command',
  'investigate',
  'why is this failing',
  'how do i fix',
];

export function classifyRequest(messages: Message[]): ClassificationResult {
  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  const text = (lastUser?.content || '').toLowerCase();

  let request_type: 'chat' | 'technical_work' | 'lightweight_local_task' = 'chat';

  if (lightweightLocalSignals.some((signal) => text.includes(signal))) {
    request_type = 'lightweight_local_task';
  }

  if (
    technicalWorkSignals.some((signal) => text.includes(signal)) ||
    technicalIntentSignals.some((signal) => text.includes(signal))
  ) {
    request_type = 'technical_work';
  }

  return { request_type };
}
