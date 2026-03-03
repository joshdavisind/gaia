/**
 * copilot-eval — GOR-312
 * LLM provider evaluation harness for Meridia/Pneuma copilot diagram editing.
 *
 * Usage:
 *   node eval.mjs                  # run all suites
 *   node eval.mjs --suite meridia  # Meridia cases only
 *   node eval.mjs --suite pneuma   # Pneuma cases only
 */

import { readFileSync, mkdirSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ─── CLI ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const suiteArg = args.includes('--suite') ? args[args.indexOf('--suite') + 1] : null;
const runMeridia = !suiteArg || suiteArg === 'meridia';
const runPneuma  = !suiteArg || suiteArg === 'pneuma';

// ─── Model Sources ────────────────────────────────────────────────────────────
const MERIDIA_MODEL_PATH = '/home/node/.openclaw/workspace/meridia/examples/multi-site-dr.json';
const PNEUMA_MODEL_PATH  = '/home/node/.openclaw/workspace/pneuma/examples/product-roadmap.json';

const meridiaModel = JSON.parse(readFileSync(MERIDIA_MODEL_PATH, 'utf8'));
const pneumaModel  = JSON.parse(readFileSync(PNEUMA_MODEL_PATH,  'utf8'));

// ─── System Prompts ───────────────────────────────────────────────────────────
const MERIDIA_SYSTEM_PROMPT = `You are a diagram editing assistant for Meridia (infrastructure diagrams) and Pneuma (timeline diagrams).

When given a diagram model and an instruction, respond with ONLY a JSON object matching this exact schema:
{
  "explanation": "brief description of what you changed and why",
  "diff": {
    "add_nodes": [...],        // new nodes to add (full node objects)
    "add_relationships": [...], // new relationships to add
    "update_nodes": [...],     // existing nodes to modify: [{id, changes: {field: newValue}}]
    "remove_nodes": [...],     // IDs of nodes to remove
    "remove_relationships": [] // IDs of relationships to remove
  },
  "validation_passed": true,
  "warnings": []
}

Rules:
- Only use node types from the Meridia type registry (e.g. virtual_machine, database, load_balancer, kubernetes_cluster, subnet, firewall, cache, cdn, etc.)
- New node IDs must be unique (not in the existing model)
- Relationship sources and targets must reference existing or newly added node IDs
- Keep diffs minimal — only change what was asked
- If the instruction is ambiguous, make a reasonable assumption and note it in warnings
- Respond with ONLY the JSON object — no markdown, no explanation outside the JSON`;

const PNEUMA_SYSTEM_PROMPT = `You are a diagram editing assistant for Pneuma (timeline diagrams).

When given a timeline diagram model and an instruction, respond with ONLY a JSON object matching this exact schema:
{
  "explanation": "brief description of what you changed and why",
  "diff": {
    "add_events": [...],        // new events to add (full event objects with id, label, type, layerId, startDate, [endDate], impact, [notes])
    "add_relationships": [...], // new relationships to add (with id, source, target, type)
    "add_layers": [...],        // new layers to add if needed
    "update_events": [...],     // existing events to modify: [{id, changes: {field: newValue}}]
    "remove_events": [...],     // IDs of events to remove
    "remove_relationships": [] // IDs of relationships to remove
  },
  "validation_passed": true,
  "warnings": []
}

Rules:
- Event types: milestone, span, task, deadline
- New event IDs must be unique (not in the existing model)
- Relationship sources and targets must reference existing or newly added event IDs
- layerId must reference an existing layer or a newly added layer
- Keep diffs minimal — only change what was asked
- If the instruction is ambiguous, make a reasonable assumption and note it in warnings
- Respond with ONLY the JSON object — no markdown, no explanation outside the JSON`;

// ─── Test Cases ───────────────────────────────────────────────────────────────
const MERIDIA_CASES = [
  {
    id: 'M1',
    label: 'Add Redis cache node',
    instruction: 'Add a Redis cache node connected to the primary application server (api-deploy) with a "uses" relationship',
    sourceModel: meridiaModel,
    systemPrompt: MERIDIA_SYSTEM_PROMPT,
  },
  {
    id: 'M2',
    label: 'Add CDN layer',
    instruction: 'Add a CDN layer in front of the load balancer (prod-alb) to handle static content. Connect users to the CDN and the CDN to the load balancer.',
    sourceModel: meridiaModel,
    systemPrompt: MERIDIA_SYSTEM_PROMPT,
  },
  {
    id: 'M3',
    label: 'Remove non-production nodes',
    instruction: 'Remove any monitoring or observability nodes (Prometheus and Grafana deployments) and all their connections from the diagram.',
    sourceModel: meridiaModel,
    systemPrompt: MERIDIA_SYSTEM_PROMPT,
  },
];

const PNEUMA_CASES = [
  {
    id: 'P1',
    label: 'Add Beta Launch milestone',
    instruction: 'Add a "Beta Launch" milestone on April 15, 2026 in the Engineering layer (layerId: "engineering") with impact 9 and id "eng-beta-launch-v2"',
    sourceModel: pneumaModel,
    systemPrompt: PNEUMA_SYSTEM_PROMPT,
  },
  {
    id: 'P2',
    label: 'Add depends_on relationship',
    instruction: 'Add a depends_on relationship from the engineering scaffold event (eng-scaffold) to the beta launch event (eng-beta-launch). Give it the id "rel-scaffold-to-beta".',
    sourceModel: pneumaModel,
    systemPrompt: PNEUMA_SYSTEM_PROMPT,
  },
  {
    id: 'P3',
    label: 'Add User Testing span',
    instruction: 'Add a "User Testing" span in the Discovery layer (layerId: "discovery") from April 1 to April 20, 2026 with impact 7. Use id "disco-user-testing".',
    sourceModel: pneumaModel,
    systemPrompt: PNEUMA_SYSTEM_PROMPT,
  },
];

// ─── Providers ────────────────────────────────────────────────────────────────
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const openai    = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function callAnthropic(model, systemPrompt, userPrompt) {
  const start = Date.now();
  const msg = await anthropic.messages.create({
    model,
    max_tokens: 1024,
    messages: [{ role: 'user', content: userPrompt }],
    system: systemPrompt,
  });
  const latency = Date.now() - start;
  return {
    text: msg.content[0].text,
    latency,
    inputTokens: msg.usage.input_tokens,
    outputTokens: msg.usage.output_tokens,
  };
}

async function callOpenAI(model, systemPrompt, userPrompt) {
  const start = Date.now();
  const completion = await openai.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_tokens: 1024,
    response_format: { type: 'json_object' },
  });
  const latency = Date.now() - start;
  const msg = completion.choices[0].message.content;
  return {
    text: msg,
    latency,
    inputTokens: completion.usage.prompt_tokens,
    outputTokens: completion.usage.completion_tokens,
  };
}

async function callOllama(model, systemPrompt, userPrompt) {
  const OLLAMA_TIMEOUT_MS = 120_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OLLAMA_TIMEOUT_MS);
  const start = Date.now();
  try {
    const response = await fetch('http://100.98.23.98:11434/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        stream: false,
        format: 'json',
        options: { temperature: 0.1 },
      }),
    });
    const data = await response.json();
    const latency = Date.now() - start;
    clearTimeout(timer);
    return {
      text: data.message?.content || data.response || '',
      latency,
      inputTokens: data.prompt_eval_count || 0,
      outputTokens: data.eval_count || 0,
    };
  } catch (err) {
    clearTimeout(timer);
    const latency = Date.now() - start;
    const isTimeout = err.name === 'AbortError';
    return {
      text: '',
      latency,
      inputTokens: 0,
      outputTokens: 0,
      error: isTimeout ? 'TIMEOUT (120s)' : err.message,
    };
  }
}

// ─── Provider Config ──────────────────────────────────────────────────────────
const PROVIDERS = [
  {
    name: 'anthropic',
    models: ['claude-haiku-4-5-20251001', 'claude-sonnet-4-6'],
    call: callAnthropic,
    enabled: !!process.env.ANTHROPIC_API_KEY,
  },
  {
    name: 'openai',
    models: ['gpt-4o-mini', 'gpt-4o'],
    call: callOpenAI,
    enabled: !!process.env.OPENAI_API_KEY,
  },
  {
    name: 'ollama',
    models: [
      'qwen2.5:14b-instruct',
      'qwen2.5:7b-instruct',
      'llama3.1:8b-instruct-q8_0',
      'deepseek-coder-v2:latest',
      'mistral:latest',
    ],
    call: callOllama,
    enabled: true, // Always try Ollama; errors are handled gracefully
  },
];

// ─── Scoring ──────────────────────────────────────────────────────────────────
function scoreResponse(responseText, sourceModel, caseType) {
  const result = {
    valid_json: false,
    has_diff_structure: false,
    has_explanation: false,
    ids_valid: false,
    types_valid: false,
    diff_non_empty: false,
    parse_error: null,
    bad_refs: [],
    diff: null,
  };

  if (!responseText || responseText.trim() === '') {
    result.parse_error = 'Empty response';
    return result;
  }

  let parsed;
  try {
    // Strip markdown code fences if model wrapped it
    const cleaned = responseText
      .replace(/^```json\s*/m, '')
      .replace(/^```\s*/m, '')
      .replace(/```\s*$/m, '')
      .trim();
    parsed = JSON.parse(cleaned);
    result.valid_json = true;
  } catch (e) {
    result.parse_error = e.message;
    return result;
  }

  result.diff = parsed;
  result.has_explanation = typeof parsed.explanation === 'string' && parsed.explanation.length > 0;
  result.has_diff_structure = parsed.diff && typeof parsed.diff === 'object';

  if (result.has_diff_structure) {
    const diff = parsed.diff;
    const allChanges = [
      ...(diff.add_nodes    || diff.add_events    || []),
      ...(diff.add_relationships || []),
      ...(diff.update_nodes || diff.update_events || []),
      ...(diff.remove_nodes || diff.remove_events || []),
      ...(diff.remove_relationships || []),
    ];
    result.diff_non_empty = allChanges.length > 0;

    // Build ID sets from source model
    const existingIds = new Set([
      ...(sourceModel.nodes || sourceModel.events || []).map(n => n.id),
      ...(sourceModel.relationships || []).map(r => r.id),
    ]);
    const newIds = new Set([
      ...(diff.add_nodes   || diff.add_events || []).map(n => n.id),
    ]);

    const badRefs = [];
    for (const rel of (diff.add_relationships || [])) {
      if (rel.source && !existingIds.has(rel.source) && !newIds.has(rel.source)) badRefs.push(rel.source);
      if (rel.target && !existingIds.has(rel.target) && !newIds.has(rel.target)) badRefs.push(rel.target);
    }
    result.ids_valid = badRefs.length === 0;
    result.bad_refs  = badRefs;

    // Validate types (basic — just ensure type field exists on added nodes/events)
    const addedNodes = diff.add_nodes || diff.add_events || [];
    result.types_valid = addedNodes.length === 0
      ? true  // if nothing added, types are trivially valid
      : addedNodes.every(n => typeof n.type === 'string' && n.type.length > 0);
  }

  return result;
}

function scoreToGrade(score) {
  const points = [
    score.valid_json,
    score.has_diff_structure,
    score.has_explanation,
    score.ids_valid,
    score.types_valid,
    score.diff_non_empty,
  ].filter(Boolean).length;

  if (points === 6) return '✅ A';
  if (points >= 4) return '⚠️ B';
  if (points >= 2) return '🔶 C';
  return '❌ F';
}

function gradeChar(grade) {
  if (grade.includes('A')) return 'A';
  if (grade.includes('B')) return 'B';
  if (grade.includes('C')) return 'C';
  return 'F';
}

// ─── Main Eval ────────────────────────────────────────────────────────────────
const testCases = [
  ...(runMeridia ? MERIDIA_CASES : []),
  ...(runPneuma  ? PNEUMA_CASES  : []),
];

// Results: { modelKey: { caseId: { grade, score, latency, tokens, raw } } }
const results = {};

// Track Ollama timeout streak to bail early
let ollamaTimeouts = 0;
const OLLAMA_TIMEOUT_BAIL = 3;

console.log(`\n🔬 Copilot Model Eval — ${testCases.length} cases × providers\n`);
console.log('='.repeat(72));

for (const provider of PROVIDERS) {
  if (!provider.enabled) {
    console.log(`\n⏭  Skipping ${provider.name} (no API key)`);
    continue;
  }

  for (const model of provider.models) {
    // Bail on Ollama if too many timeouts
    if (provider.name === 'ollama' && ollamaTimeouts >= OLLAMA_TIMEOUT_BAIL) {
      console.log(`\n⚠️  Ollama: ${OLLAMA_TIMEOUT_BAIL} consecutive timeouts — skipping remaining models`);
      break;
    }

    const modelKey = model;
    results[modelKey] = results[modelKey] || {};
    console.log(`\n📦 ${provider.name.toUpperCase()} / ${model}`);

    for (const tc of testCases) {
      const userPrompt =
        JSON.stringify(tc.sourceModel, null, 2) +
        '\n\nInstruction: ' +
        tc.instruction;

      process.stdout.write(`  Case ${tc.id} (${tc.label})... `);

      let response;
      try {
        response = await provider.call(model, tc.systemPrompt, userPrompt);
      } catch (err) {
        response = { text: '', latency: 0, inputTokens: 0, outputTokens: 0, error: err.message };
      }

      const score = scoreResponse(response.text, tc.sourceModel, tc.id);
      const grade = scoreToGrade(score);

      // Track Ollama timeout streaks
      if (provider.name === 'ollama') {
        if (response.error?.startsWith('TIMEOUT')) {
          ollamaTimeouts++;
        } else {
          ollamaTimeouts = 0; // reset on success
        }
      }

      results[modelKey][tc.id] = {
        grade,
        score,
        latency: response.latency,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        raw: response.text,
        error: response.error,
        provider: provider.name,
        model,
      };

      const latencyStr = `${(response.latency / 1000).toFixed(1)}s`;
      const errorStr   = response.error ? ` [${response.error}]` : '';
      console.log(`${grade} (${latencyStr})${errorStr}`);
    }
  }
}

// ─── Report Generation ────────────────────────────────────────────────────────
const now = new Date();
const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
const timeStr = now.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';

function buildReport() {
  const modelKeys  = Object.keys(results);
  const caseIds    = testCases.map(tc => tc.id);
  const caseLabels = Object.fromEntries(testCases.map(tc => [tc.id, tc.label]));

  // ── Summary Table ──
  const headerCols = ['Model', ...caseIds, 'Avg Latency', 'Overall'];
  const sep = headerCols.map(c => '-'.repeat(c.length + 2)).join('|');

  const header = '| ' + headerCols.join(' | ') + ' |';
  const divider = '|' + headerCols.map(c => '-'.repeat(c.length + 2)).join('|') + '|';

  const rows = modelKeys.map(mk => {
    const modelResults = results[mk];
    const grades = caseIds.map(cid => {
      const r = modelResults[cid];
      return r ? r.grade : '—';
    });

    // Avg latency across cases
    const latencies = caseIds
      .map(cid => modelResults[cid]?.latency || 0)
      .filter(l => l > 0);
    const avgLatency = latencies.length
      ? (latencies.reduce((a, b) => a + b, 0) / latencies.length / 1000).toFixed(1) + 's'
      : '—';

    // Overall grade = worst grade across cases
    const gradeOrder = { A: 4, B: 3, C: 2, F: 1 };
    const gradeChars = caseIds
      .map(cid => modelResults[cid] ? gradeChar(modelResults[cid].grade) : 'F');
    const worstGrade = gradeChars.reduce((worst, g) =>
      (gradeOrder[g] || 0) < (gradeOrder[worst] || 4) ? g : worst, 'A');

    const overallGrade = worstGrade === 'A' ? '✅ A'
      : worstGrade === 'B' ? '⚠️ B'
      : worstGrade === 'C' ? '🔶 C'
      : '❌ F';

    // Shorten model name for table
    const shortModel = mk.length > 30 ? mk.slice(0, 29) + '…' : mk;
    return '| ' + [shortModel, ...grades, avgLatency, overallGrade].join(' | ') + ' |';
  });

  const summaryTable = [header, divider, ...rows].join('\n');

  // ── Per-Case Detail ──
  let detailSections = '';
  for (const tc of testCases) {
    detailSections += `\n---\n\n### Case ${tc.id} — ${tc.label}\n\n`;
    detailSections += `**Instruction:** _${tc.instruction}_\n\n`;

    for (const mk of modelKeys) {
      const r = results[mk]?.[tc.id];
      if (!r) continue;

      detailSections += `#### ${mk}\n\n`;
      detailSections += `- **Grade:** ${r.grade}\n`;
      detailSections += `- **Latency:** ${(r.latency / 1000).toFixed(2)}s\n`;
      detailSections += `- **Tokens:** ${r.inputTokens} in / ${r.outputTokens} out\n`;

      const s = r.score;
      detailSections += `- **Scores:** JSON=${s.valid_json ? '✓' : '✗'} · Struct=${s.has_diff_structure ? '✓' : '✗'} · Explain=${s.has_explanation ? '✓' : '✗'} · IDs=${s.ids_valid ? '✓' : '✗'} · Types=${s.types_valid ? '✓' : '✗'} · NonEmpty=${s.diff_non_empty ? '✓' : '✗'}\n`;

      if (r.error) {
        detailSections += `- **Error:** ${r.error}\n`;
      }
      if (s.parse_error) {
        detailSections += `- **Parse error:** ${s.parse_error}\n`;
      }
      if (s.bad_refs?.length) {
        detailSections += `- **Bad refs:** ${s.bad_refs.join(', ')}\n`;
      }

      // Show the parsed diff (truncated)
      if (s.diff) {
        const diffStr = JSON.stringify(s.diff, null, 2);
        const truncated = diffStr.length > 1500 ? diffStr.slice(0, 1497) + '...' : diffStr;
        detailSections += `\n<details>\n<summary>Parsed output</summary>\n\n\`\`\`json\n${truncated}\n\`\`\`\n\n</details>\n\n`;
      } else {
        // Show raw (truncated) if no parsed diff
        const rawPreview = (r.raw || '(no output)').slice(0, 300);
        detailSections += `\n<details>\n<summary>Raw output (unparseable)</summary>\n\n\`\`\`\n${rawPreview}\n\`\`\`\n\n</details>\n\n`;
      }
    }
  }

  // ── Recommendations ──
  const topModels = modelKeys
    .map(mk => {
      const caseResults = results[mk];
      const aCount = caseIds.filter(cid => gradeChar(caseResults[cid]?.grade || 'F') === 'A').length;
      const avgLat  = caseIds
        .map(cid => caseResults[cid]?.latency || 0)
        .reduce((a, b) => a + b, 0) / caseIds.length;
      return { model: mk, aCount, avgLat };
    })
    .sort((a, b) => b.aCount - a.aCount || a.avgLat - b.avgLat);

  const best = topModels[0];
  const recText = best
    ? `**Recommendation:** \`${best.model}\` scored highest with ${best.aCount}/${caseIds.length} A grades and average latency ${(best.avgLat / 1000).toFixed(1)}s. Recommend as default copilot model.`
    : 'No clear winner — review detailed results.';

  // ── Bad Ref Summary ──
  const badRefModels = modelKeys.filter(mk =>
    caseIds.some(cid => results[mk]?.[cid]?.score?.bad_refs?.length > 0)
  );

  const badRefText = badRefModels.length
    ? badRefModels.map(mk => {
        const refs = caseIds.flatMap(cid => results[mk]?.[cid]?.score?.bad_refs || []);
        return `- **${mk}**: bad refs — ${[...new Set(refs)].join(', ')}`;
      }).join('\n')
    : '_No models had ID reference errors._';

  // ── Full Report ──
  return `# Copilot Model Evaluation Report

Generated: ${timeStr}

## Summary Table

${summaryTable}

## Recommendations

${recText}

## ID Reference Errors

${badRefText}

## Detailed Results
${detailSections}

---

_Generated by \`gaia/tools/copilot-eval/eval.mjs\` (GOR-312)_
`;
}

const report = buildReport();

// Save report
const resultsDir = join(__dirname, 'results');
mkdirSync(resultsDir, { recursive: true });
const reportPath = join(resultsDir, `eval-${dateStr}.md`);
writeFileSync(reportPath, report, 'utf8');

console.log('\n' + '='.repeat(72));
console.log(`\n✅ Report saved to: ${reportPath}\n`);
console.log(report);
