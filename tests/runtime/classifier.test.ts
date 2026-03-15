import { describe, it, expect } from 'vitest';
import {
  classifyRequest,
  lightweightLocalSignals,
  technicalWorkSignals,
  technicalIntentSignals,
} from '../../src/runtime/classifier.js';

describe('signal group counts match live runtime truth', () => {
  it('lightweightLocalSignals has exactly 18 terms', () => {
    expect(lightweightLocalSignals.length).toBe(18);
  });

  it('technicalWorkSignals has exactly 48 terms (live workflow truth)', () => {
    expect(technicalWorkSignals.length).toBe(48);
  });

  it('technicalIntentSignals has exactly 10 terms', () => {
    expect(technicalIntentSignals.length).toBe(10);
  });
});

describe('classifyRequest — default chat', () => {
  it('returns chat for empty messages', () => {
    expect(classifyRequest([])).toEqual({ request_type: 'chat' });
  });

  it('returns chat for a generic conversational message', () => {
    const result = classifyRequest([{ role: 'user', content: 'Hello, how are you?' }]);
    expect(result).toEqual({ request_type: 'chat' });
  });

  it('uses only the last user message for classification', () => {
    const messages = [
      { role: 'user', content: 'write a function' },
      { role: 'assistant', content: 'Here is one.' },
      { role: 'user', content: 'Thank you, that looks great!' },
    ];
    // last user message has no signals — should be chat
    expect(classifyRequest(messages)).toEqual({ request_type: 'chat' });
  });

  it('ignores assistant messages entirely', () => {
    const messages = [
      { role: 'assistant', content: 'Here is some python code for you' },
      { role: 'user', content: 'Looks good!' },
    ];
    expect(classifyRequest(messages)).toEqual({ request_type: 'chat' });
  });
});

describe('classifyRequest — lightweight_local_task', () => {
  const lwSignals: [string, string][] = [
    ['summarize', 'Can you summarize this document?'],
    ['summary', 'Give me a summary of this.'],
    // NOTE: "classify" and "classification" contain "class" which is a technicalWorkSignal.
    // The live runtime therefore classifies those as technical_work, not lightweight_local_task.
    // Those entries in lightweightLocalSignals are effectively dead code due to substring overlap.
    // Tests for their actual runtime behavior are in the technical_work override section below.
    ['extract', 'Can you extract the key facts?'],
    ['extraction', 'Do an extraction of named entities.'],
    ['tag', 'Tag this article.'],
    ['tags', 'Generate tags for this.'],
    ['title', 'Suggest a title for this.'],
    ['rename', 'Help me rename this file.'],
    ['metadata', 'What is the metadata on this file?'],
    ['rewrite briefly', 'Can you rewrite briefly this paragraph?'],
    ['shorten', 'Please shorten this.'],
    ['bullet points', 'Turn this into bullet points.'],
    ['tl;dr', 'Give me a tl;dr of this article.'],
    ['keywords', 'What are the keywords here?'],
    ['categorize', 'Please categorize this.'],
    ['sentiment', 'What is the sentiment of this review?'],
  ];

  for (const [signal, message] of lwSignals) {
    it(`classifies "${signal}" as lightweight_local_task`, () => {
      const result = classifyRequest([{ role: 'user', content: message }]);
      expect(result.request_type).toBe('lightweight_local_task');
    });
  }
});

describe('classifyRequest — technical_work (technical work signals)', () => {
  const twSignals: [string, string][] = [
    ['code', 'Show me some code for this.'],
    ['python', 'Write this in python.'],
    ['javascript', 'How do I do this in javascript?'],
    ['typescript', 'Fix this typescript type.'],
    ['sql', 'Write a sql query.'],
    ['bash', 'Give me a bash script.'],
    ['docker compose', 'Update this docker compose file.'],
    ['migration', 'Write a migration for this schema change.'],
    ['implementation', 'Give me an implementation of this.'],
  ];

  for (const [signal, message] of twSignals) {
    it(`classifies "${signal}" as technical_work`, () => {
      const result = classifyRequest([{ role: 'user', content: message }]);
      expect(result.request_type).toBe('technical_work');
    });
  }
});

describe('classifyRequest — technical_work (technical intent signals)', () => {
  const tiSignals: [string, string][] = [
    ['write a', 'Can you write a function that does this?'],
    ['implement', 'Please implement this feature.'],
    ['update the code', 'Please update the code in this file.'],
    ['modify the workflow', 'Can you modify the workflow here?'],
    ['patch', 'Can you patch this?'],
    ['edit the file', 'Please edit the file to fix this.'],
    ['run this command', 'Can you run this command for me?'],
    ['investigate', 'Please investigate why this is broken.'],
    ['why is this failing', 'why is this failing in prod?'],
    ['how do i fix', 'how do i fix this error?'],
  ];

  for (const [signal, message] of tiSignals) {
    it(`classifies "${signal}" as technical_work`, () => {
      const result = classifyRequest([{ role: 'user', content: message }]);
      expect(result.request_type).toBe('technical_work');
    });
  }
});

describe('classifyRequest — substring overlap: "classify"/"classification" → technical_work', () => {
  // Live runtime quirk: "class" is in technicalWorkSignals and is a substring of
  // "classify" and "classification", so those lightweight signals are shadowed.
  it('"classify" in message → technical_work (class substring match)', () => {
    const result = classifyRequest([{ role: 'user', content: 'Please classify this text.' }]);
    expect(result.request_type).toBe('technical_work');
  });

  it('"classification" in message → technical_work (class substring match)', () => {
    const result = classifyRequest([{ role: 'user', content: 'Do a classification of these.' }]);
    expect(result.request_type).toBe('technical_work');
  });
});

describe('classifyRequest — technical_work overrides lightweight_local_task', () => {
  it('technical_work wins when both lightweight and technical signals present', () => {
    // "extract" is lightweight, "python" is technical — technical wins per runtime logic
    const result = classifyRequest([
      { role: 'user', content: 'extract the python classes from this file' },
    ]);
    expect(result.request_type).toBe('technical_work');
  });

  it('technical_work wins over lightweight via intent signal', () => {
    const result = classifyRequest([
      { role: 'user', content: 'summarize this and implement the changes' },
    ]);
    expect(result.request_type).toBe('technical_work');
  });
});

describe('classifyRequest — case insensitivity', () => {
  it('matches signals case-insensitively', () => {
    const result = classifyRequest([{ role: 'user', content: 'WRITE A function in PYTHON' }]);
    expect(result.request_type).toBe('technical_work');
  });
});
