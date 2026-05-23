const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fssync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const cp = require('node:child_process');

const {
  parseRolloutIncremental,
  parseClaudeIncremental,
  parseGeminiIncremental,
  parseCursorApiIncremental,
  parseOpencodeIncremental,
  parseOpenclawIncremental,
  parseKiroIncremental,
  parseHermesIncremental,
  parseCopilotIncremental,
  parseKimiIncremental,
  parseOmpIncremental,
  parsePiIncremental,
  parseGooseIncremental,
  parseCrushIncremental,
  parseCodebuddyIncremental,
  parseDroidIncremental,
  parseQwenIncremental,
  parseClineFamilyIncremental,
  parseCursorAgentIncremental,
  parseAntigravityIncremental,
} = require('../src/lib/rollout');

function buildTokenCountLine({ ts, last, total }) {
  return JSON.stringify({
    timestamp: ts,
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: last,
        total_token_usage: total,
      },
    },
  });
}

function buildEveryCodeTokenCountLine({ ts, last, total }) {
  return JSON.stringify({
    timestamp: ts,
    payload: {
      msg: {
        type: 'token_count',
        info: {
          last_token_usage: last,
          total_token_usage: total,
        },
      },
    },
  });
}

function buildClaudeUsageLine({ ts, input, output, model }) {
  return JSON.stringify({
    timestamp: ts,
    message: {
      model,
      usage: {
        input_tokens: input,
        output_tokens: output,
      },
    },
  });
}

function buildGeminiSession({ sessionId, startTime, lastUpdated, messages }) {
  return {
    sessionId,
    projectHash: 'project-hash',
    startTime,
    lastUpdated,
    messages,
  };
}

function buildOpencodeMessage({ created, completed, modelID, tokens }) {
  const createdMs = Date.parse(created);
  const completedMs = Date.parse(completed);
  return {
    id: 'msg_test',
    sessionID: 'ses_test',
    modelID,
    time: {
      created: createdMs,
      completed: completedMs,
    },
    tokens: {
      input: tokens.input,
      output: tokens.output,
      reasoning: tokens.reasoning,
      cache: {
        read: tokens.cached,
        write: tokens.cacheWrite,
      },
    },
  };
}

function writeCopilotOtelFile(filePath, spans) {
  const lines = spans.map((s) => JSON.stringify(s)).join('\n') + '\n';
  fssync.writeFileSync(filePath, lines, 'utf8');
}

function makeCopilotChatSpan({ traceId, spanId, inputTokens, outputTokens, cacheRead }) {
  return {
    type: 'span',
    traceId,
    spanId,
    name: 'chat gpt-4.1',
    startTime: [1775934256, 0],
    endTime: [1775934260, 0],
    attributes: {
      'gen_ai.operation.name': 'chat',
      'gen_ai.request.model': 'gpt-4.1',
      'gen_ai.response.model': 'gpt-4.1',
      'gen_ai.usage.input_tokens': inputTokens,
      'gen_ai.usage.output_tokens': outputTokens,
      'gen_ai.usage.cache_read.input_tokens': cacheRead,
      'gen_ai.usage.cache_write.input_tokens': 0,
      'gen_ai.usage.reasoning.output_tokens': 0,
    },
  };
}

function createHermesDb(dbPath, sessions) {
  cp.execFileSync('sqlite3', [
    dbPath,
    `
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      source TEXT,
      model TEXT,
      started_at REAL,
      ended_at REAL,
      input_tokens INTEGER,
      output_tokens INTEGER,
      cache_read_tokens INTEGER,
      cache_write_tokens INTEGER,
      reasoning_tokens INTEGER,
      message_count INTEGER
    );
    `,
  ]);
  for (const s of sessions) {
    cp.execFileSync('sqlite3', [
      dbPath,
      `INSERT INTO sessions (id, source, model, started_at, ended_at, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens, message_count)
       VALUES ('${s.id}', 'cli', '${s.model}', ${s.started_at}, ${s.ended_at == null ? 'NULL' : s.ended_at}, ${s.input_tokens}, ${s.output_tokens}, ${s.cache_read_tokens || 0}, 0, ${s.reasoning_tokens || 0}, ${s.message_count || 1});`,
    ]);
  }
}

function buildOmpAssistantLine({ id, model, input, output, timestamp, totalTokens }) {
  return JSON.stringify({
    type: 'message',
    id,
    parentId: 'parent-1',
    timestamp: new Date(timestamp).toISOString(),
    message: {
      role: 'assistant',
      provider: 'anthropic',
      model,
      usage: { input, output, cacheRead: 0, cacheWrite: 0, totalTokens },
      timestamp: Date.parse(new Date(timestamp).toISOString()),
    },
  });
}

function buildCodebuddyAssistantLine({ uuid, timestamp, model, prompt_tokens, completion_tokens }) {
  return JSON.stringify({
    type: 'message',
    role: 'assistant',
    uuid,
    timestamp,
    sessionId: 'sess-test',
    providerData: {
      model,
      rawUsage: {
        prompt_tokens,
        completion_tokens,
        total_tokens: prompt_tokens + completion_tokens,
        prompt_tokens_details: { cached_tokens: 0, reasoning_tokens: 0 },
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      usage: {
        requests: 1,
        inputTokens: prompt_tokens,
        outputTokens: completion_tokens,
        totalTokens: prompt_tokens + completion_tokens,
      },
    },
    message: {
      usage: {
        input_tokens: prompt_tokens,
        output_tokens: completion_tokens,
        total_tokens: prompt_tokens + completion_tokens,
      },
    },
  });
}

function assertStartUpdateEnd(events, provider) {
  assert.ok(events.length >= 2, `expected >=2 events for ${provider}`);
  assert.equal(events[0].kind, 'start');
  assert.equal(events[0].provider, provider);
  assert.equal(events.at(-1).kind, 'end');
  assert.equal(events.at(-1).provider, provider);
}

test('SessionEvent extraction: Claude Code', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sess-claude-'));
  try {
    const projectRoot = path.join(tmp, 'repo');
    const encodedProjectRoot = `-${projectRoot.split(path.sep).filter(Boolean).join('-')}`;
    const claudePath = path.join(tmp, '.claude', 'projects', encodedProjectRoot, 'agent-claude.jsonl');
    const queuePath = path.join(tmp, 'queue.jsonl');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(path.dirname(claudePath), { recursive: true });
    await fs.writeFile(
      claudePath,
      [
        buildClaudeUsageLine({ ts: '2026-05-09T00:00:00.000Z', input: 10, output: 2, model: 'claude-sonnet' }),
      ].join('\n') + '\n',
      'utf8',
    );

    const cursors = { version: 1, files: {}, updatedAt: null };
    const events = [];
    await parseClaudeIncremental({
      projectFiles: [{ path: claudePath, source: 'claude' }],
      cursors,
      queuePath,
      onSessionEvent: (e) => events.push(e),
    });

    assertStartUpdateEnd(events, 'claude');
    assert.equal(events[0].session_id, claudePath);
    assert.equal(events[0].cwd, projectRoot);
    assert.equal(events[1].kind, 'update');
    assert.equal(events[1].cwd, projectRoot);
    assert.equal(events[1].input_tokens, 10);
    assert.equal(events[1].cached_input_tokens, 0);
    assert.equal(events[1].cache_creation_input_tokens, 0);
    assert.equal(events[1].output_tokens, 2);
    assert.equal(events[1].reasoning_output_tokens, 0);
    assert.equal(events[1].conversation_count, 0);

    const events2 = [];
    await parseClaudeIncremental({
      projectFiles: [{ path: claudePath, source: 'claude' }],
      cursors,
      queuePath,
      onSessionEvent: (e) => events2.push(e),
    });
    assert.deepEqual(events2, []);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('SessionEvent extraction: Claude Code captures cache split, web search count, tools, and activity labels', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sess-claude-enriched-'));
  try {
    const projectRoot = path.join(tmp, 'repo');
    const encodedProjectRoot = `-${projectRoot.split(path.sep).filter(Boolean).join('-')}`;
    const claudePath = path.join(tmp, '.claude', 'projects', encodedProjectRoot, 'agent-claude.jsonl');
    const queuePath = path.join(tmp, 'queue.jsonl');
    await fs.mkdir(projectRoot, { recursive: true });
    await fs.mkdir(path.dirname(claudePath), { recursive: true });
    await fs.writeFile(
      claudePath,
      [
        JSON.stringify({
          timestamp: '2026-05-09T00:00:00.000Z',
          type: 'assistant',
          message: {
            id: 'msg_1',
            model: 'claude-sonnet-4-6',
            usage: {
              input_tokens: 10,
              output_tokens: 2,
              cache_read_input_tokens: 7,
              cache_creation_input_tokens: 30,
              cache_creation: {
                ephemeral_5m_input_tokens: 11,
                ephemeral_1h_input_tokens: 19,
              },
              server_tool_use: {
                web_search_requests: 2,
              },
            },
            content: [
              { type: 'tool_use', name: 'Bash' },
              { type: 'tool_use', name: 'Edit' },
              { type: 'tool_use', name: 'WebSearch' },
            ],
          },
          requestId: 'req_1',
        }),
      ].join('\n') + '\n',
      'utf8',
    );

    const cursors = { version: 1, files: {}, updatedAt: null };
    const events = [];
    await parseClaudeIncremental({
      projectFiles: [{ path: claudePath, source: 'claude' }],
      cursors,
      queuePath,
      onSessionEvent: (event) => events.push(event),
    });

    const update = events.find((event) => event.kind === 'update');
    assert.equal(update.cache_creation_input_tokens, 30);
    assert.equal(update.cache_creation_5m_input_tokens, 11);
    assert.equal(update.cache_creation_1h_input_tokens, 19);
    assert.equal(update.web_search_requests, 2);
    assert.equal(update.tool_call_count, 3);
    assert.deepEqual(JSON.parse(update.tools_json), { Bash: 1, Edit: 1, WebSearch: 1 });
    assert.deepEqual(JSON.parse(update.activity_json), { editing: 1, research: 1, shell: 1 });
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('SessionEvent extraction: Codex captures tools and keeps cached input separate', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sess-codex-enriched-'));
  try {
    const rolloutPath = path.join(tmp, 'rollout.jsonl');
    const queuePath = path.join(tmp, 'queue.jsonl');
    await fs.writeFile(
      rolloutPath,
      [
        JSON.stringify({ timestamp: '2026-05-09T00:00:00.000Z', type: 'session_meta', payload: { cwd: tmp, model: 'gpt-5.4', git: { branch: 'main' } } }),
        JSON.stringify({ timestamp: '2026-05-09T00:00:01.000Z', type: 'response_item', payload: { type: 'function_call', name: 'exec_command' } }),
        JSON.stringify({ timestamp: '2026-05-09T00:00:02.000Z', type: 'event_msg', payload: { type: 'patch_apply_end' } }),
        JSON.stringify({
          timestamp: '2026-05-09T00:00:03.000Z',
          type: 'event_msg',
          payload: {
            type: 'token_count',
            info: {
              last_token_usage: {
                input_tokens: 100,
                cached_input_tokens: 80,
                output_tokens: 10,
                reasoning_output_tokens: 5,
                total_tokens: 115,
              },
              total_token_usage: {
                input_tokens: 100,
                cached_input_tokens: 80,
                output_tokens: 10,
                reasoning_output_tokens: 5,
                total_tokens: 115,
              },
            },
          },
        }),
      ].join('\n') + '\n',
      'utf8',
    );

    const cursors = { version: 1, files: {}, updatedAt: null };
    const events = [];
    await parseRolloutIncremental({
      rolloutFiles: [{ path: rolloutPath, source: 'codex' }],
      cursors,
      queuePath,
      onSessionEvent: (event) => events.push(event),
    });

    const update = events.find((event) => event.kind === 'update');
    assert.equal(update.input_tokens, 20);
    assert.equal(update.cached_input_tokens, 80);
    assert.equal(update.output_tokens, 10);
    assert.equal(update.reasoning_output_tokens, 5);
    assert.equal(update.web_search_requests, 0);
    assert.equal(update.tool_call_count, 2);
    assert.deepEqual(JSON.parse(update.tools_json), { Edit: 1, exec_command: 1 });
    assert.deepEqual(JSON.parse(update.activity_json), { editing: 1, shell: 1 });
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('SessionEvent extraction: Codex captures tools across incremental parses', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sess-codex-pending-tool-'));
  try {
    const rolloutPath = path.join(tmp, 'rollout.jsonl');
    const queuePath = path.join(tmp, 'queue.jsonl');
    const cursors = { version: 1, files: {}, updatedAt: null };
    const usage = {
      input_tokens: 100,
      cached_input_tokens: 80,
      output_tokens: 10,
      reasoning_output_tokens: 5,
      total_tokens: 115,
    };

    await fs.writeFile(
      rolloutPath,
      [
        JSON.stringify({ timestamp: '2026-05-09T00:00:00.000Z', type: 'session_meta', payload: { cwd: tmp, model: 'gpt-5.4', git: { branch: 'main' } } }),
        JSON.stringify({ timestamp: '2026-05-09T00:00:01.000Z', type: 'response_item', payload: { type: 'function_call', name: 'exec_command' } }),
      ].join('\n') + '\n',
      'utf8',
    );

    const firstEvents = [];
    await parseRolloutIncremental({
      rolloutFiles: [{ path: rolloutPath, source: 'codex' }],
      cursors,
      queuePath,
      onSessionEvent: (event) => firstEvents.push(event),
    });
    assert.deepEqual(firstEvents, []);

    await fs.appendFile(
      rolloutPath,
      buildTokenCountLine({ ts: '2026-05-09T00:00:02.000Z', last: usage, total: usage }) + '\n',
      'utf8',
    );

    const secondEvents = [];
    await parseRolloutIncremental({
      rolloutFiles: [{ path: rolloutPath, source: 'codex' }],
      cursors,
      queuePath,
      onSessionEvent: (event) => secondEvents.push(event),
    });

    const update = secondEvents.find((event) => event.kind === 'update');
    assert.equal(update.session_id, rolloutPath);
    assert.equal(update.input_tokens, 20);
    assert.equal(update.cached_input_tokens, 80);
    assert.equal(update.tool_call_count, 1);
    assert.deepEqual(JSON.parse(update.tools_json), { exec_command: 1 });
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('SessionEvent extraction: Codex rollout JSONL', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sess-codex-'));
  try {
    const rolloutPath = path.join(tmp, 'rollout.jsonl');
    const queuePath = path.join(tmp, 'queue.jsonl');
    const cursors = { version: 1, files: {}, updatedAt: null };
    const usage = { input_tokens: 2, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0, total_tokens: 3 };

    await fs.writeFile(rolloutPath, buildTokenCountLine({ ts: '2026-05-09T00:00:00.000Z', last: usage, total: usage }) + '\n', 'utf8');

    const events = [];
    await parseRolloutIncremental({
      rolloutFiles: [{ path: rolloutPath, source: 'codex' }],
      cursors,
      queuePath,
      onSessionEvent: (e) => events.push(e),
    });

    assertStartUpdateEnd(events, 'codex');
    assert.equal(events[0].session_id, rolloutPath);

    const eventsAgain = [];
    await parseRolloutIncremental({
      rolloutFiles: [{ path: rolloutPath, source: 'codex' }],
      cursors,
      queuePath,
      onSessionEvent: (e) => eventsAgain.push(e),
    });
    assert.deepEqual(eventsAgain, []);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('SessionEvent extraction: Every Code rollout JSONL', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sess-every-'));
  try {
    const rolloutPath = path.join(tmp, 'rollout.jsonl');
    const queuePath = path.join(tmp, 'queue.jsonl');
    const cursors = { version: 1, files: {}, updatedAt: null };
    const usage = { input_tokens: 2, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0, total_tokens: 3 };

    await fs.writeFile(rolloutPath, buildEveryCodeTokenCountLine({ ts: '2026-05-09T00:00:00.000Z', last: usage, total: usage }) + '\n', 'utf8');

    const events = [];
    await parseRolloutIncremental({
      rolloutFiles: [{ path: rolloutPath, source: 'every-code' }],
      cursors,
      queuePath,
      onSessionEvent: (e) => events.push(e),
    });

    assertStartUpdateEnd(events, 'every-code');
    assert.equal(events[0].session_id, rolloutPath);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('SessionEvent extraction: Gemini session JSON', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sess-gemini-'));
  try {
    const sessionPath = path.join(tmp, 'session.json');
    const queuePath = path.join(tmp, 'queue.jsonl');
    const cursors = { version: 1, files: {}, updatedAt: null };

    const session = buildGeminiSession({
      sessionId: 'gemini-sess',
      startTime: '2026-05-09T00:00:00.000Z',
      lastUpdated: '2026-05-09T00:01:00.000Z',
      messages: [
        { timestamp: '2026-05-09T00:00:10.000Z', model: 'gemini-2.5', usage: { input_tokens: 10, output_tokens: 2, total_tokens: 12 } },
      ],
    });

    await fs.writeFile(sessionPath, JSON.stringify(session), 'utf8');

    const events = [];
    await parseGeminiIncremental({
      sessionFiles: [sessionPath],
      cursors,
      queuePath,
      onSessionEvent: (e) => events.push(e),
    });

    assertStartUpdateEnd(events, 'gemini');
    assert.equal(events[0].session_id, 'gemini-sess');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('SessionEvent extraction: Gemini cwd uses only adjacent project root proof', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sess-gemini-cwd-'));
  try {
    const repo = path.join(tmp, 'repo');
    const proofDir = path.join(tmp, 'gemini', 'tmp', 'hash-proof');
    const proofChatsDir = path.join(proofDir, 'chats');
    const providerOnlyChatsDir = path.join(tmp, 'gemini', 'tmp', 'hash-provider', 'chats');
    await fs.mkdir(repo, { recursive: true });
    await fs.mkdir(proofChatsDir, { recursive: true });
    await fs.mkdir(providerOnlyChatsDir, { recursive: true });
    await fs.writeFile(path.join(proofDir, '.project_root'), repo, 'utf8');

    const proofSessionPath = path.join(proofChatsDir, 'session-proof.json');
    const providerOnlySessionPath = path.join(providerOnlyChatsDir, 'session-provider.json');
    await fs.writeFile(
      proofSessionPath,
      JSON.stringify(buildGeminiSession({
        sessionId: 'gemini-proof',
        startTime: '2026-05-09T00:00:00.000Z',
        lastUpdated: '2026-05-09T00:01:00.000Z',
        messages: [
          { timestamp: '2026-05-09T00:00:10.000Z', model: 'gemini-2.5', tokens: { input: 10, output: 2, total: 12 } },
        ],
      })),
      'utf8',
    );
    await fs.writeFile(
      providerOnlySessionPath,
      JSON.stringify(buildGeminiSession({
        sessionId: 'gemini-provider',
        startTime: '2026-05-09T00:02:00.000Z',
        lastUpdated: '2026-05-09T00:03:00.000Z',
        messages: [
          { timestamp: '2026-05-09T00:02:10.000Z', model: 'gemini-2.5', tokens: { input: 3, output: 4, total: 7 } },
        ],
      })),
      'utf8',
    );

    const events = [];
    await parseGeminiIncremental({
      sessionFiles: [proofSessionPath, providerOnlySessionPath],
      cursors: { version: 1, files: {}, updatedAt: null },
      queuePath: path.join(tmp, 'queue.jsonl'),
      onSessionEvent: (e) => events.push(e),
    });

    const proofEvents = events.filter((event) => event.session_id === 'gemini-proof');
    const providerOnlyEvents = events.filter((event) => event.session_id === 'gemini-provider');
    assertStartUpdateEnd(proofEvents, 'gemini');
    assertStartUpdateEnd(providerOnlyEvents, 'gemini');
    assert.ok(proofEvents.every((event) => event.cwd === repo));
    assert.ok(providerOnlyEvents.every((event) => event.cwd === null));
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('SessionEvent extraction: Cursor records', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sess-cursor-'));
  try {
    const queuePath = path.join(tmp, 'queue.jsonl');
    const cursors = { version: 1, files: {}, updatedAt: null };
    const events = [];

    await parseCursorApiIncremental({
      records: [
        {
          date: '2026-04-01T10:00:00.000Z',
          model: 'auto',
          kind: 'Included',
          inputTokens: 40,
          cacheReadTokens: 4,
          cacheWriteTokens: 0,
          outputTokens: 6,
          totalTokens: 50,
        },
      ],
      cursors,
      queuePath,
      source: 'cursor',
      onSessionEvent: (e) => events.push(e),
    });

    assertStartUpdateEnd(events, 'cursor');
    assert.equal(events[0].session_id, 'cursor|2026-04-01T10:00:00.000Z');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('SessionEvent extraction: OpenCode message JSON', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sess-opencode-'));
  try {
    const messageDir = path.join(tmp, 'message', 'ses_test');
    await fs.mkdir(messageDir, { recursive: true });
    const messagePath = path.join(messageDir, 'msg_test.json');
    const queuePath = path.join(tmp, 'queue.jsonl');
    const cursors = { version: 1, files: {}, updatedAt: null };

    const message = buildOpencodeMessage({
      modelID: 'gpt-4o',
      created: '2026-05-09T00:00:00.000Z',
      completed: '2026-05-09T00:00:10.000Z',
      tokens: { input: 10, output: 2, reasoning: 0, cached: 0, cacheWrite: 0 },
    });

    await fs.writeFile(messagePath, JSON.stringify(message), 'utf8');

    const events = [];
    await parseOpencodeIncremental({
      messageFiles: [messagePath],
      cursors,
      queuePath,
      onSessionEvent: (e) => events.push(e),
    });

    assertStartUpdateEnd(events, 'opencode');
    assert.equal(events[0].session_id, 'ses_test');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('SessionEvent extraction: OpenCode preserves cwd from message path', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sess-opencode-cwd-'));
  try {
    const repo = path.join(tmp, 'repo');
    await fs.mkdir(repo, { recursive: true });
    const messageDir = path.join(tmp, 'message', 'ses_cwd');
    await fs.mkdir(messageDir, { recursive: true });
    const messagePath = path.join(messageDir, 'msg_cwd.json');
    const queuePath = path.join(tmp, 'queue.jsonl');
    const cursors = { version: 1, files: {}, updatedAt: null };

    const message = buildOpencodeMessage({
      modelID: 'gpt-4o',
      created: '2026-05-09T00:00:00.000Z',
      completed: '2026-05-09T00:00:10.000Z',
      tokens: { input: 10, output: 2, reasoning: 0, cached: 0, cacheWrite: 0 },
    });
    message.path = { cwd: repo };
    await fs.writeFile(messagePath, JSON.stringify(message), 'utf8');

    const events = [];
    await parseOpencodeIncremental({
      messageFiles: [messagePath],
      cursors,
      queuePath,
      onSessionEvent: (e) => events.push(e),
    });

    assertStartUpdateEnd(events, 'opencode');
    assert.equal(events[0].cwd, repo);
    assert.equal(events[1].cwd, repo);
    assert.equal(events[2].cwd, repo);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('SessionEvent extraction: OpenClaw session JSONL', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sess-openclaw-'));
  try {
    const sessionPath = path.join(tmp, 'openclaw.jsonl');
    const queuePath = path.join(tmp, 'queue.jsonl');
    const cursors = { version: 1, files: {}, updatedAt: null };

    const line = JSON.stringify({
      timestamp: '2026-05-09T00:00:00.000Z',
      type: 'message',
      message: { model: 'claude-3', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2 } },
    });
    await fs.writeFile(sessionPath, line + '\n', 'utf8');

    const events = [];
    await parseOpenclawIncremental({
      sessionFiles: [sessionPath],
      cursors,
      queuePath,
      onSessionEvent: (e) => events.push(e),
    });

    assertStartUpdateEnd(events, 'openclaw');
    assert.equal(events[0].session_id, sessionPath);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('SessionEvent extraction: Kiro JSONL fallback', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sess-kiro-'));
  try {
    const jsonlPath = path.join(tmp, 'tokens_generated.jsonl');
    const queuePath = path.join(tmp, 'queue.jsonl');
    const cursors = { version: 1, files: {}, updatedAt: null };

    await fs.writeFile(
      jsonlPath,
      [
        JSON.stringify({ model: 'agent', provider: 'kiro', promptTokens: 10, generatedTokens: 5, timestamp: '2026-05-09T00:00:00.000Z' }),
      ].join('\n') + '\n',
      'utf8',
    );

    const events = [];
    await parseKiroIncremental({ jsonlPath, dbPath: path.join(tmp, 'missing.db'), cursors, queuePath, onSessionEvent: (e) => events.push(e) });

    assertStartUpdateEnd(events, 'kiro');
    assert.equal(events[0].session_id, jsonlPath);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('SessionEvent extraction: Hermes sessions SQLite', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sess-hermes-'));
  try {
    const dbPath = path.join(tmp, 'state.db');
    const queuePath = path.join(tmp, 'queue.jsonl');
    const cursors = { version: 1, files: {}, updatedAt: null };

    const epoch = 1775993779.0;
    createHermesDb(dbPath, [
      { id: 'sess_001', model: 'gpt-5.4-mini', started_at: epoch, ended_at: epoch + 120, input_tokens: 10, output_tokens: 5, cache_read_tokens: 0, message_count: 1 },
    ]);

    const events = [];
    await parseHermesIncremental({ dbPath, cursors, queuePath, onSessionEvent: (e) => events.push(e) });

    assertStartUpdateEnd(events, 'hermes');
    assert.equal(events[0].session_id, 'sess_001');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('SessionEvent extraction: Copilot OTEL spans', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sess-copilot-'));
  try {
    const otelPath = path.join(tmp, 'copilot-otel.jsonl');
    const queuePath = path.join(tmp, 'queue.jsonl');
    const cursors = { version: 1 };

    writeCopilotOtelFile(otelPath, [
      makeCopilotChatSpan({ traceId: 't1', spanId: 's1', inputTokens: 10, outputTokens: 2, cacheRead: 1 }),
    ]);

    const events = [];
    await parseCopilotIncremental({ otelPaths: [otelPath], cursors, queuePath, onSessionEvent: (e) => events.push(e) });

    assertStartUpdateEnd(events, 'copilot');
    assert.equal(events[0].session_id, otelPath);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('SessionEvent extraction: Kimi wire.jsonl StatusUpdate', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sess-kimi-'));
  try {
    const sessionDir = path.join(tmp, 'sessions', 'ws1', 'sess1');
    await fs.mkdir(sessionDir, { recursive: true });
    const wireFile = path.join(sessionDir, 'wire.jsonl');

    const lines = [
      JSON.stringify({ type: 'metadata', protocol_version: '1.5' }),
      JSON.stringify({
        timestamp: 1775833108.22,
        message: {
          type: 'StatusUpdate',
          payload: { message_id: 'chatcmpl-TEST1', token_usage: { input_other: 10, output: 2, input_cache_read: 0, input_cache_creation: 0 } },
        },
      }),
    ].join('\n');

    await fs.writeFile(wireFile, lines);

    const queuePath = path.join(tmp, 'queue.jsonl');
    const cursors = { version: 1 };

    const events = [];
    await parseKimiIncremental({ wireFiles: [wireFile], cursors, queuePath, onSessionEvent: (e) => events.push(e) });

    assertStartUpdateEnd(events, 'kimi');
    assert.equal(events[0].session_id, 'sess1');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('SessionEvent extraction: omp session JSONL', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sess-omp-'));
  try {
    const agentDir = path.join(tmp, 'agent');
    await fs.mkdir(agentDir, { recursive: true });
    const sessionPath = path.join(agentDir, 'session.jsonl');
    const queuePath = path.join(tmp, 'queue.jsonl');
    const cursors = { version: 1 };

    const ts = '2026-05-09T00:00:00.000Z';
    await fs.writeFile(
      sessionPath,
      buildOmpAssistantLine({ id: 'msg-1', model: 'claude-sonnet', input: 10, output: 2, timestamp: ts, totalTokens: 12 }) + '\n',
      'utf8',
    );

    const events = [];
    await parseOmpIncremental({ sessionFiles: [sessionPath], cursors, queuePath, onSessionEvent: (e) => events.push(e) });

    assertStartUpdateEnd(events, 'omp');
    assert.equal(events[0].session_id, sessionPath);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('SessionEvent extraction: OMP preserves header cwd', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sess-omp-cwd-'));
  try {
    const repo = path.join(tmp, 'repo');
    await fs.mkdir(repo, { recursive: true });
    const sessionPath = path.join(tmp, 'session.jsonl');
    const queuePath = path.join(tmp, 'queue.jsonl');
    const cursors = { version: 1 };
    const ts = '2026-05-09T00:00:00.000Z';
    await fs.writeFile(
      sessionPath,
      [
        JSON.stringify({ type: 'session', id: 'omp-session', cwd: repo, timestamp: ts }),
        buildOmpAssistantLine({ id: 'msg-1', model: 'claude-sonnet', input: 10, output: 2, timestamp: ts, totalTokens: 12 }),
      ].join('\n') + '\n',
      'utf8',
    );

    const events = [];
    await parseOmpIncremental({ sessionFiles: [sessionPath], cursors, queuePath, onSessionEvent: (e) => events.push(e) });

    assertStartUpdateEnd(events, 'omp');
    assert.equal(events[0].cwd, repo);
    assert.equal(events[1].cwd, repo);
    assert.equal(events[2].cwd, repo);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('SessionEvent extraction: Pi emits session events and preserves header cwd', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sess-pi-cwd-'));
  try {
    const repo = path.join(tmp, 'repo');
    await fs.mkdir(repo, { recursive: true });
    const sessionPath = path.join(tmp, 'session.jsonl');
    const queuePath = path.join(tmp, 'queue.jsonl');
    const cursors = { version: 1 };
    const ts = '2026-05-09T00:00:00.000Z';
    await fs.writeFile(
      sessionPath,
      [
        JSON.stringify({ type: 'session', id: 'pi-session', cwd: repo, timestamp: ts }),
        buildOmpAssistantLine({ id: 'msg-1', model: 'mimo-v2.5-pro', input: 10, output: 2, timestamp: ts, totalTokens: 12 }),
      ].join('\n') + '\n',
      'utf8',
    );

    const events = [];
    await parsePiIncremental({ sessionFiles: [sessionPath], cursors, queuePath, onSessionEvent: (e) => events.push(e) });

    assertStartUpdateEnd(events, 'pi');
    assert.equal(events[0].cwd, repo);
    assert.equal(events[1].cwd, repo);
    assert.equal(events[2].cwd, repo);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('SessionEvent extraction: Goose sessions SQLite preserves clean working_dir cwd', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sess-goose-'));
  try {
    const repo = path.join(tmp, 'repo');
    await fs.mkdir(repo, { recursive: true });
    const dbPath = path.join(tmp, 'sessions.db');
    const queuePath = path.join(tmp, 'queue.jsonl');
    const cursors = { version: 1 };
    cp.execFileSync('sqlite3', [
      dbPath,
      `
      CREATE TABLE sessions (
        id TEXT PRIMARY KEY,
        working_dir TEXT,
        created_at TEXT,
        updated_at TEXT,
        model_config_json TEXT,
        accumulated_input_tokens INTEGER,
        accumulated_output_tokens INTEGER,
        accumulated_total_tokens INTEGER
      );
      INSERT INTO sessions (
        id, working_dir, created_at, updated_at, model_config_json,
        accumulated_input_tokens, accumulated_output_tokens, accumulated_total_tokens
      ) VALUES (
        'goose-session', '${repo.replace(/'/g, "''")}', '2026-05-09T00:00:00.000Z',
        '2026-05-09T00:05:00.000Z', '{"model_name":"claude-sonnet"}', 10, 2, 12
      );
      `,
    ]);

    const events = [];
    await parseGooseIncremental({ dbPath, cursors, queuePath, onSessionEvent: (e) => events.push(e) });

    assertStartUpdateEnd(events, 'goose');
    assert.equal(events[0].session_id, 'goose-session');
    assert.equal(events[0].cwd, repo);
    assert.equal(events[1].cwd, repo);
    assert.equal(events[2].cwd, repo);
    assert.equal(events[1].input_tokens, 10);
    assert.equal(events[1].output_tokens, 2);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('SessionEvent extraction: Crush registry sessions preserve project root cwd', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sess-crush-'));
  try {
    const repo = path.join(tmp, 'repo');
    const crushDir = path.join(repo, '.crush');
    await fs.mkdir(crushDir, { recursive: true });
    const dbPath = path.join(crushDir, 'crush.db');
    const queuePath = path.join(tmp, 'queue.jsonl');
    const projectsPath = path.join(tmp, 'projects.json');
    const cursors = { version: 1 };
    cp.execFileSync('sqlite3', [
      dbPath,
      `
      CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY,
        model_id TEXT,
        created_at TEXT,
        input_tokens INTEGER,
        output_tokens INTEGER
      );
      INSERT INTO sessions (
        session_id, model_id, created_at, input_tokens, output_tokens
      ) VALUES (
        'crush-session', 'gpt-5.5', '2026-05-09T00:00:00.000Z', 10, 2
      );
      `,
    ]);
    await fs.writeFile(projectsPath, JSON.stringify([{ cwd: repo }]), 'utf8');

    const events = [];
    await parseCrushIncremental({ projectsPath, cursors, queuePath, onSessionEvent: (e) => events.push(e) });

    assertStartUpdateEnd(events, 'crush');
    assert.equal(events[0].session_id, 'crush-session');
    assert.equal(events[0].cwd, repo);
    assert.equal(events[1].cwd, repo);
    assert.equal(events[2].cwd, repo);
    assert.equal(events[1].input_tokens, 10);
    assert.equal(events[1].output_tokens, 2);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('SessionEvent extraction: Codebuddy session JSONL', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sess-codebuddy-'));
  try {
    const projectDir = path.join(tmp, 'projects', 'encoded-cwd');
    await fs.mkdir(projectDir, { recursive: true });
    const sessionFile = path.join(projectDir, 'abc.jsonl');
    const queuePath = path.join(tmp, 'queue.jsonl');
    const cursors = { version: 1 };

    await fs.writeFile(
      sessionFile,
      [
        JSON.stringify({ type: 'topic', topic: 'Hello' }),
        buildCodebuddyAssistantLine({ uuid: 'msg-1', timestamp: 1777427166667, model: 'hy3-preview-agent', prompt_tokens: 10, completion_tokens: 2 }),
      ].join('\n'),
      'utf8',
    );

    const events = [];
    await parseCodebuddyIncremental({ projectFiles: [sessionFile], cursors, queuePath, onSessionEvent: (e) => events.push(e) });

    assertStartUpdateEnd(events, 'codebuddy');
    assert.equal(events[0].session_id, 'sess-test');
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('SessionEvent extraction: Droid session JSONL', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sess-droid-'));
  try {
    const repo = path.join(tmp, 'repo');
    const sessionFile = path.join(tmp, '.factory', 'sessions', 'project-a', 'session.jsonl');
    const queuePath = path.join(tmp, 'queue.jsonl');
    const cursors = { version: 1 };
    await fs.mkdir(repo, { recursive: true });
    await fs.mkdir(path.dirname(sessionFile), { recursive: true });
    await fs.writeFile(
      sessionFile,
      [
        JSON.stringify({ type: 'session_start', session_id: 'droid-1', cwd: repo, model: 'factory-model', timestamp: '2026-05-09T00:00:00.000Z' }),
        JSON.stringify({ type: 'assistant', id: 'a1', timestamp: '2026-05-09T00:01:00.000Z', usage: { input_tokens: 10, output_tokens: 2 }, tool: 'Edit' }),
      ].join('\n') + '\n',
      'utf8',
    );

    const events = [];
    await parseDroidIncremental({ sessionFiles: [sessionFile], cursors, queuePath, onSessionEvent: (e) => events.push(e) });

    assertStartUpdateEnd(events, 'droid');
    assert.equal(events[0].session_id, 'droid-1');
    assert.equal(events[0].cwd, repo);
    assert.equal(events[1].cwd, repo);
    assert.equal(events[1].input_tokens, 10);
    assert.equal(events[1].output_tokens, 2);
    assert.match(events[1].activity_json, /estimated/);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('SessionEvent extraction: Qwen chat JSONL', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sess-qwen-'));
  try {
    const repo = path.join(tmp, 'repo');
    const chatFile = path.join(tmp, '.qwen', 'projects', 'hash', 'chats', 'chat.jsonl');
    const queuePath = path.join(tmp, 'queue.jsonl');
    const cursors = { version: 1 };
    await fs.mkdir(repo, { recursive: true });
    await fs.mkdir(path.dirname(chatFile), { recursive: true });
    await fs.writeFile(
      chatFile,
      [
        JSON.stringify({ sessionId: 'qwen-1', cwd: repo, timestamp: '2026-05-09T00:00:00.000Z', model: 'qwen-coder', usage: { input_tokens: 10, output_tokens: 2 }, tools: [{ name: 'Read' }] }),
        JSON.stringify({ sessionId: 'qwen-2', cwd: 'relative-only', timestamp: '2026-05-09T00:30:00.000Z', model: 'qwen-coder', usage: { input_tokens: 3, output_tokens: 1 } }),
      ].join('\n') + '\n',
      'utf8',
    );

    const events = [];
    await parseQwenIncremental({ chatFiles: [chatFile], cursors, queuePath, onSessionEvent: (e) => events.push(e) });

    const qwen1 = events.filter((event) => event.session_id === 'qwen-1');
    const qwen2 = events.filter((event) => event.session_id === 'qwen-2');
    assertStartUpdateEnd(qwen1, 'qwen');
    assertStartUpdateEnd(qwen2, 'qwen');
    assert.equal(qwen1[0].cwd, repo);
    assert.equal(qwen1[1].cwd, repo);
    assert.equal(qwen2[0].cwd, null);
    assert.equal(qwen2[1].cwd, null);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('SessionEvent extraction: Cline-family task directory', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sess-cline-family-'));
  try {
    const repo = path.join(tmp, 'repo');
    const taskDir = path.join(tmp, 'globalStorage', 'rooveterinaryinc.roo-cline', 'tasks', 'task-a');
    const queuePath = path.join(tmp, 'queue.jsonl');
    const cursors = { version: 1 };
    await fs.mkdir(repo, { recursive: true });
    await fs.mkdir(taskDir, { recursive: true });
    await fs.writeFile(
      path.join(taskDir, 'api_conversation_history.json'),
      JSON.stringify([{ content: `Current Workspace Directory (${repo})` }]),
      'utf8',
    );
    await fs.writeFile(
      path.join(taskDir, 'ui_messages.json'),
      JSON.stringify([
        {
          ts: '2026-05-09T00:00:00.000Z',
          model: 'claude-sonnet-4',
          tokensIn: 10,
          tokensOut: 2,
          tool: 'read_file',
        },
      ]),
      'utf8',
    );

    const events = [];
    await parseClineFamilyIncremental({
      taskDirs: [{ provider: 'roo', taskDir }],
      cursors,
      queuePath,
      onSessionEvent: (e) => events.push(e),
    });

    assertStartUpdateEnd(events, 'roo');
    assert.equal(events[0].session_id, `roo:${taskDir}`);
    assert.equal(events[0].cwd, repo);
    assert.equal(events[1].cwd, repo);
    assert.equal(events[1].input_tokens, 10);
    assert.equal(events[1].output_tokens, 2);
    assert.match(events[1].tools_json, /read_file/);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('SessionEvent extraction: Cursor Agent transcript JSONL', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sess-cursor-agent-'));
  try {
    const repo = path.join(tmp, 'repo');
    const transcript = path.join(tmp, '.cursor', 'projects', 'hash', 'agent-transcripts', 'agent.jsonl');
    const queuePath = path.join(tmp, 'queue.jsonl');
    const cursors = { version: 1 };
    await fs.mkdir(repo, { recursive: true });
    await fs.mkdir(path.dirname(transcript), { recursive: true });
    await fs.writeFile(
      transcript,
      [
        JSON.stringify({ sessionId: 'cursor-agent-1', cwd: repo, timestamp: '2026-05-09T00:00:00.000Z', model: 'cursor-agent', usage: { input_tokens: 10, output_tokens: 2 }, tool: 'edit' }),
        JSON.stringify({ sessionId: 'cursor-agent-2', cwd: 'project-hash', timestamp: '2026-05-09T00:30:00.000Z', model: 'cursor-agent', text: 'hello from transcript text' }),
      ].join('\n') + '\n',
      'utf8',
    );

    const events = [];
    await parseCursorAgentIncremental({ transcriptFiles: [transcript], cursors, queuePath, onSessionEvent: (e) => events.push(e) });

    const proven = events.filter((event) => event.session_id === 'cursor-agent-1');
    const providerOnly = events.filter((event) => event.session_id === 'cursor-agent-2');
    assertStartUpdateEnd(proven, 'cursor-agent');
    assertStartUpdateEnd(providerOnly, 'cursor-agent');
    assert.equal(proven[0].cwd, repo);
    assert.equal(proven[1].cwd, repo);
    assert.equal(providerOnly[0].cwd, null);
    assert.equal(providerOnly[1].cwd, null);
    assert.equal(proven[1].input_tokens, 10);
    assert.equal(proven[1].output_tokens, 2);
    assert.deepEqual(JSON.parse(providerOnly[1].activity_json), { estimated_tokens: 1 });
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});

test('SessionEvent extraction: Antigravity JSON cache', async () => {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'vd-sess-antigravity-'));
  try {
    const cachePath = path.join(tmp, '.cache', 'codeburn', 'antigravity-results.json');
    const queuePath = path.join(tmp, 'queue.jsonl');
    const cursors = { version: 1 };
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(
      cachePath,
      JSON.stringify([{ id: 'ag-1', timestamp: '2026-05-09T00:00:00.000Z', model: 'gemini-2.5-pro', inputTokens: 10, outputTokens: 2, reasoning_output_tokens: 3 }]),
      'utf8',
    );

    const events = [];
    await parseAntigravityIncremental({ cachePath, pbFiles: [], cursors, queuePath, onSessionEvent: (e) => events.push(e) });

    assertStartUpdateEnd(events, 'antigravity');
    assert.equal(events[0].session_id, 'ag-1');
    assert.equal(events[0].cwd, null);
    assert.equal(events[1].cwd, null);
    assert.equal(events[1].input_tokens, 10);
    assert.equal(events[1].output_tokens, 2);
    assert.equal(events[1].reasoning_output_tokens, 3);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
});
