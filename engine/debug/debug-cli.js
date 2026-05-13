#!/usr/bin/env node
// src/debug-cli.js
// ══════════════════════════════════════════════════════
//  CLI de debug — IA y red neuronal
// ES: CLI de debug — IA y red neuronal
//
//  node src/debug-cli.js help
// ES: node src/debug-cli.js help
//  node src/debug-cli.js eval
// ES: node src/debug-cli.js eval
//  node src/debug-cli.js search [depth] [ms]
// ES: node src/debug-cli.js search [depth] [ms]
//  node src/debug-cli.js bench [N]            ← NEW: benchmark evaluaciones
// ES: node src/debug-cli.js bench [N]            ← NEW: benchmark evaluaciones
//  node src/debug-cli.js compare [d1] [d2]    ← NEW: comparar dos profundidades
// ES: node src/debug-cli.js compare [d1] [d2]    ← NEW: comparar dos profundidades
//  node src/debug-cli.js watch [cmd] [args]   ← NEW: re-ejecutar al Enter
// ES: node src/debug-cli.js watch [cmd] [args]   ← NEW: re-ejecutar al Enter
//  node src/debug-cli.js tt [depth]
// ES: node src/debug-cli.js tt [depth]
//  node src/debug-cli.js nn info | predict
// ES: node src/debug-cli.js nn info | predict
//  node src/debug-cli.js memory stats | top [N] | blunders [N]
// ES: node src/debug-cli.js memory stats | top [N] | blunders [N]
//  node src/debug-cli.js game <file.json>
// ES: node src/debug-cli.js game <file.json>
//  node src/debug-cli.js games
// ES: node src/debug-cli.js games
//  node src/debug-cli.js perft [depth]
// ES: node src/debug-cli.js perft [depth]
//  node src/debug-cli.js selfplay [N]
// ES: node src/debug-cli.js selfplay [N]
// ══════════════════════════════════════════════════════

import path   from 'node:path';
import fs     from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { fileURLToPath }   from 'node:url';
import { Debug, dbg }      from './debug.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
Debug.enableAll();

// ── ANSI ──────────────────────────────────────────────
const C = {
  reset:'\x1b[0m', bold:'\x1b[1m', dim:'\x1b[2m',
  blue:'\x1b[94m', green:'\x1b[92m', yellow:'\x1b[93m',
  red:'\x1b[91m',  cyan:'\x1b[96m', gray:'\x1b[90m',
  white:'\x1b[97m', magenta:'\x1b[95m', orange:'\x1b[33m',
};
const c  = (color, txt) => `${C[color] ?? ''}${txt}${C.reset}`;
const hr = (ch = '─', n = 64) => c('gray', ch.repeat(n));

function header(title) {
  console.log('');
  console.log(hr('═'));
  console.log(c('bold', c('cyan', `  ${title}`)));
  console.log(hr('═'));
}

function row(label, value, valueColor = 'white') {
  console.log(`  ${c('gray', label.padEnd(24))} ${c(valueColor, String(value))}`);
}

function sep(label = '') {
  console.log(label
    ? `\n  ${c('gray', `── ${label} ──`)}`
    : `  ${c('gray', '─'.repeat(50))}`
  );
}

function table(headers, rows, colColors = []) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => String(r[i] ?? '').length))
  );
  const fmt = (row, colors = []) =>
    row.map((v, i) => {
      const str = String(v ?? '').padEnd(widths[i]);
      return colors[i] ? c(colors[i], str) : str;
    }).join('  ');
  console.log('  ' + c('dim', fmt(headers)));
  console.log('  ' + c('gray', widths.map(w => '─'.repeat(w)).join('  ')));
  rows.forEach(r => console.log('  ' + fmt(r, colColors)));
}

function sparkline(values) {
  if (!values?.length) return '';
  const min = Math.min(...values), max = Math.max(...values), range = max - min || 1;
  const bars = ['▁','▂','▃','▄','▅','▆','▇','█'];
  return values.map(v => bars[Math.round(((v - min) / range) * 7)]).join('');
}

function scoreColor(score) {
  return score > 100 ? 'green' : score < -100 ? 'red' : score === 0 ? 'gray' : 'white';
}

// ── Lazy imports ──────────────────────────────────────
async function loadGame()   { return import('../rules/index.js'); }
async function loadAI()     { return import('../ai/index.js'); }
async function loadNN()     { return import('../server/nn-bridge.js'); }

// ════════════════════════════════════════════════════
//  COMANDS
// ════════════════════════════════════════════════════

// ── eval ─────────────────────────────────────────────
async function cmdEval(args) {
  header('Position Evaluation');
  const { createGame } = await loadGame();
  const { evaluate, computeFullHash, extractFeatures } = await loadAI();

  const state = createGame();
  const hash  = computeFullHash(state);
  const N     = parseInt(args[0]) || 1;   // optional: run N times for avg

  const times = [];
  let result;
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    result   = evaluate(state, hash);
    times.push(performance.now() - t0);
  }
  const avg = times.reduce((a,b)=>a+b,0) / times.length;

  row('Score',       result.score, scoreColor(result.score));
  row('Time (avg)',  `${avg.toFixed(3)}ms${N > 1 ? ` × ${N}` : ''}`, 'yellow');
  if (N > 1) row('Sparkline', sparkline(times.map(t => +t.toFixed(2))), 'gray');
  row('Turn',        state.turn,   'cyan');
  row('Status',      state.status, 'white');

  if (result.metrics) {
    sep('Metrics');
    for (const [k, v] of Object.entries(result.metrics)) {
      const pct = typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : v;
      const bar = typeof v === 'number' ? '█'.repeat(Math.round(v * 20)) : '';
      row(k, `${v.toFixed(4)}  ${c('gray', bar)}`, v > 0.5 ? 'green' : v < 0.4 ? 'red' : 'white');
    }
  }

  const features = extractFeatures(state, state.turn);
  sep('Feature key');
  console.log(`  ${c('gray', features)}`);
  console.log('');
}

// ── search ───────────────────────────────────────────
async function cmdSearch(args) {
  const depth  = parseInt(args[0]) || 4;
  const timeMs = parseInt(args[1]) || 2000;
  header(`Search  depth=${depth}  time=${timeMs}ms`);

  const { createGame, getAllLegalMoves } = await loadGame();
  const { chooseBotMove, evaluate, computeFullHash } = await loadAI();

  const state = createGame();
  const legal = getAllLegalMoves(state, state.turn);
  row('Legal moves at root', legal.length, 'green');

  const t0 = performance.now();
  const { move, score } = chooseBotMove(state, { maxDepth: depth, timeLimitMs: timeMs });
  const ms = (performance.now() - t0).toFixed(1);

  sep('Best move');
  if (move) {
    if (move.fromReserve) {
      row('Type',        'Drop from reserve', 'yellow');
      row('Reserve idx', move.reserveIndex,   'white');
      row('To',          `r${move.to.r}  c${move.to.c}`, 'cyan');
    } else {
      const piece = state.board[move.from.r]?.[move.from.c];
      row('Piece', piece ? `${piece.type}${piece.promoted?'+':''}` : '?', 'white');
      row('From',  `r${move.from.r}  c${move.from.c}`, 'white');
      row('To',    `r${move.to.r}  c${move.to.c}`,     'cyan');
      row('Promotion', move.promotion ? 'yes' : 'no',   move.promotion ? 'green' : 'gray');
    }
    row('Score', score ?? '?', scoreColor(score ?? 0));
    row('Time',  `${ms}ms`,   'yellow');
  } else {
    console.log(c('red', '  No move found'));
  }
  console.log('');
}

// ── bench ────────────────────────────────────────────
async function cmdBench(args) {
  const N = Math.min(parseInt(args[0]) || 100, 2000);
  header(`Evaluation Benchmark  N=${N} positions`);

  const { createGame, applyMove, getAllLegalMoves } = await loadGame();
  const { evaluate, computeFullHash } = await loadAI();

  // Build N positions by playing random moves from start
  // ES: Build N positions by playing random moves from start
  const positions = [];
  const base = createGame();
  positions.push({ state: base, hash: computeFullHash(base) });

  let cur = base;
  for (let i = 0; i < N - 1 && cur.status === 'playing'; i++) {
    const moves = getAllLegalMoves(cur, cur.turn);
    if (!moves.length) break;
    const m = moves[Math.floor(Math.random() * moves.length)];
    // Shallow clone for bench
    // ES: Shallow clone for bench
    const next = JSON.parse(JSON.stringify({ board: cur.board, turn: cur.turn,
      reserves: cur.reserves, palaceTaken: cur.palaceTaken, palaceTimers: cur.palaceTimers,
      palaceCurse: cur.palaceCurse, lastMove: cur.lastMove, status: cur.status,
      history: [], positionHistory: [], selected: null, legalMoves: [], message: '' }));
    next.positionHistory = new Map();
    try {
      applyMove(next, m.fromReserve ? m : { from: m.from, to: m.to, promotion: false });
      positions.push({ state: next, hash: computeFullHash(next) });
      cur = next;
    } catch { break; }
  }

  const times = [];
  const scores = [];
  for (const { state, hash } of positions) {
    const t0  = performance.now();
    const res = evaluate(state, hash);
    times.push(performance.now() - t0);
    scores.push(res.score);
  }

  const total = times.reduce((a,b)=>a+b,0);
  const avg   = total / times.length;
  const minT  = Math.min(...times), maxT = Math.max(...times);
  const opsec = (1000 / avg).toFixed(0);

  row('Positions evaluated', times.length,          'white');
  row('Total time',          `${total.toFixed(1)}ms`, 'yellow');
  row('Avg per eval',        `${avg.toFixed(3)}ms`,   avg < 1 ? 'green' : avg < 5 ? 'yellow' : 'red');
  row('Min / Max',           `${minT.toFixed(3)}ms / ${maxT.toFixed(3)}ms`, 'white');
  row('Evals/sec',           opsec, parseInt(opsec) > 1000 ? 'green' : 'yellow');

  sep('Score distribution');
  const buckets = Array(10).fill(0);
  const sMin = Math.min(...scores), sMax = Math.max(...scores), sRange = sMax - sMin || 1;
  for (const s of scores) buckets[Math.min(9, Math.floor(((s - sMin) / sRange) * 10))]++;
  const bMax = Math.max(...buckets);
  for (let i = 0; i < 10; i++) {
    const lo = (sMin + (sRange / 10) * i).toFixed(0);
    const bar = '█'.repeat(Math.round((buckets[i] / bMax) * 24));
    console.log(`  ${lo.padStart(7)}  ${c('cyan', bar)} ${c('gray', String(buckets[i]))}`);
  }

  sep('Timing sparkline (all evals)');
  const sample = times.filter((_, i) => i % Math.ceil(times.length / 60) === 0);
  console.log(`  ${c('yellow', sparkline(sample))}`);
  console.log('');
}

// ── compare ──────────────────────────────────────────
async function cmdCompare(args) {
  const d1 = parseInt(args[0]) || 3;
  const d2 = parseInt(args[1]) || 5;
  const ms = parseInt(args[2]) || 3000;
  header(`Compare  depth ${d1} vs depth ${d2}  (${ms}ms each)`);

  const { createGame } = await loadGame();
  const { chooseBotMove, computeFullHash } = await loadAI();

  const results = [];
  for (const depth of [d1, d2]) {
    const state = createGame();
    const t0    = performance.now();
    const { move, score } = chooseBotMove(state, { maxDepth: depth, timeLimitMs: ms });
    const elapsed = performance.now() - t0;
    results.push({ depth, move, score, elapsed });
  }

  table(
    ['Depth', 'Score', 'Time(ms)', 'Move'],
    results.map(r => [
      r.depth,
      r.score?.toFixed(0) ?? '?',
      r.elapsed.toFixed(0),
      r.move
        ? (r.move.fromReserve
            ? `drop→r${r.move.to.r}c${r.move.to.c}`
            : `r${r.move.from.r}c${r.move.from.c}→r${r.move.to.r}c${r.move.to.c}`)
        : 'none',
    ]),
    ['cyan', scoreColor(results[0]?.score ?? 0), 'yellow', 'white']
  );

  const scoreDiff = (results[1]?.score ?? 0) - (results[0]?.score ?? 0);
  const timeDiff  = (results[1]?.elapsed ?? 0) - (results[0]?.elapsed ?? 0);
  sep('Delta');
  row(`Score d${d2} − d${d1}`, scoreDiff.toFixed(0), scoreDiff > 0 ? 'green' : scoreDiff < 0 ? 'red' : 'gray');
  row(`Time overhead`,         `+${timeDiff.toFixed(0)}ms`, timeDiff < 500 ? 'green' : 'yellow');
  console.log('');
}

// ── watch ────────────────────────────────────────────
async function cmdWatch(args) {
  const [subcmd, ...subargs] = args;
  if (!subcmd) {
    console.log(c('red', '  Usage: watch <command> [args]'));
    console.log(c('gray', '  Example: watch eval   or   watch search 5'));
    return;
  }

  const run = async () => {
    console.clear();
    console.log(c('dim', `  [watch] ${subcmd} ${subargs.join(' ')}   (press Enter to refresh, Ctrl+C to exit)`));
    const fn = commandMap[subcmd];
    if (fn) await fn(subargs).catch(e => console.error(c('red', `  Error: ${e.message}`)));
    else console.log(c('red', `  Unknown command: ${subcmd}`));
  };

  await run();

  const rl = createInterface({ input: process.stdin });
  process.stdin.setRawMode?.(false);
  console.log(c('dim', '  [watch mode — press Enter to refresh]'));

  rl.on('line', async () => { await run(); });
  rl.on('close', () => process.exit(0));
}

// ── tt ───────────────────────────────────────────────
async function cmdTT(args) {
  const depth = parseInt(args[0]) || 5;
  header(`Transposition Table  depth=${depth}`);

  const { createGame }   = await loadGame();
  const { chooseBotMove }= await loadAI();
  const { TranspositionTable } = await import('../ai/hashing.js');

  const state = createGame();
  const tt    = new TranspositionTable(500_000);

  let hits = 0, misses = 0;
  const depthDist = {};         // hits per stored depth
  const origGet = tt.get.bind(tt);
  tt.get = (k) => {
    const r = origGet(k);
    if (r) { hits++; depthDist[r.depth] = (depthDist[r.depth] ?? 0) + 1; }
    else misses++;
    return r;
  };

  const t0 = performance.now();
  chooseBotMove(state, { maxDepth: depth, timeLimitMs: 10_000 });
  const ms = (performance.now() - t0).toFixed(0);

  const total   = hits + misses;
  const hitRate = total > 0 ? ((hits / total) * 100).toFixed(1) : '0';

  row('Depth searched',  depth,                        'white');
  row('Time',            `${ms}ms`,                    'yellow');
  row('TT entries',      tt.map.size.toLocaleString(), 'cyan');
  row('TT hits',         hits.toLocaleString(),        'green');
  row('TT misses',       misses.toLocaleString(),      'red');
  row('Hit rate',        `${hitRate}%`, parseFloat(hitRate) > 40 ? 'green' : 'yellow');

  sep('Hit distribution by depth');
  const depths = Object.keys(depthDist).map(Number).sort((a,b)=>a-b);
  if (depths.length) {
    const maxHits = Math.max(...Object.values(depthDist));
    for (const d of depths) {
      const n   = depthDist[d];
      const bar = '█'.repeat(Math.max(1, Math.round((n / maxHits) * 24)));
      row(`depth ${d}`, `${bar}  ${n.toLocaleString()} hits`, 'cyan');
    }
  }
  console.log('');
}

// ── nn info ──────────────────────────────────────────
async function cmdNNInfo() {
  header('Neural Network Info');
  try {
    const { getModelInfo } = await loadNN();
    const info = await getModelInfo();
    for (const [k, v] of Object.entries(info)) {
      const display = v instanceof Date ? v.toLocaleString() : v;
      row(k, display, 'white');
    }
    if (info.sizeBytes) {
      row('Size (KB)', (info.sizeBytes / 1024).toFixed(1), 'cyan');
    }
  } catch (e) {
    console.log(c('red', `  Error: ${e.message}`));
    console.log(c('gray', '  Is the model compiled? Run: make nn_train nn_gpu'));
  }
  console.log('');
}

// ── nn predict ───────────────────────────────────────
async function cmdNNPredict() {
  header('Neural Network Prediction');
  const BOARD_SIZE = 13, NN_CHANNELS = 24;
  const PIECE_CHANNEL = {
    king:0, queen:1, general:2, elephant:3, priest:4, horse:5,
    cannon:6, tower:7, carriage:8, archer:9, pawn:10, crossbow:11,
  };
  try {
    const { createGame }   = await loadGame();
    const { predictScore } = await loadNN();
    const { SIDE }         = await import('../constants.js');

    const state = createGame();
    const enc   = new Float32Array(BOARD_SIZE * BOARD_SIZE * NN_CHANNELS);
    for (let r = 0; r < 13; r++) for (let c = 0; c < 13; c++) {
      const p = state.board[r][c]; if (!p) continue;
      const ch = PIECE_CHANNEL[p.type]; if (ch === undefined) continue;
      enc[(r * 13 + c) * NN_CHANNELS + (p.side === SIDE.WHITE ? 0 : 12) + ch] = 1.0;
    }

    // Run 3 times for consistency check
    // ES: Run 3 times for consistency check
    const runs = [];
    for (let i = 0; i < 3; i++) {
      const t0    = performance.now();
      const score = await predictScore(enc);
      runs.push({ score, ms: performance.now() - t0 });
    }

    row('Predicted score', runs[0].score?.toFixed(6) ?? 'null', 'green');
    row('Inference (avg)', `${(runs.reduce((a,b)=>a+b.ms,0)/3).toFixed(2)}ms`, 'yellow');
    row('Consistency',     new Set(runs.map(r=>r.score?.toFixed(4))).size === 1 ? '✓ stable' : '⚠ unstable',
        new Set(runs.map(r=>r.score?.toFixed(4))).size === 1 ? 'green' : 'red');
    row('Input floats',    enc.length.toLocaleString(), 'gray');
    row('Non-zero floats', Array.from(enc).filter(v=>v>0).length.toLocaleString(), 'gray');
  } catch (e) {
    console.log(c('red', `  Error: ${e.message}`));
  }
  console.log('');
}

// ── memory stats ─────────────────────────────────────
async function cmdMemoryStats() {
  header('Adaptive Memory Stats');
  const memFile = path.join(__dirname, '..', 'data', 'ai-memory.json');
  try {
    const raw = await fs.readFile(memFile, 'utf8');
    const mem = JSON.parse(raw);

    const wr = mem.gamesPlayed > 0
      ? ((mem.gamesWon / mem.gamesPlayed) * 100).toFixed(1) + '%' : '0%';

    row('Games played',   mem.gamesPlayed ?? 0, 'white');
    row('Games won',      mem.gamesWon    ?? 0, 'green');
    row('Win rate',       wr, parseFloat(wr) > 50 ? 'green' : parseFloat(wr) > 35 ? 'yellow' : 'red');
    row('Move memory',    (mem.moveScores    ?? []).length.toLocaleString(), 'cyan');
    row('Feature memory', (mem.featureScores ?? []).length.toLocaleString(), 'cyan');
    row('Blunders',       (mem.blunderMoves  ?? []).length.toLocaleString(), 'red');
    row('Draw positions', (mem.drawPositions ?? []).length.toLocaleString(), 'gray');

    if (mem.patternWeights) {
      sep('Pattern weights');
      const entries = Object.entries(mem.patternWeights).sort((a,b)=>b[1]-a[1]);
      for (const [k, v] of entries) {
        const bar   = '█'.repeat(Math.max(1, Math.round(v * 10)));
        const color = v > 1.3 ? 'green' : v < 0.7 ? 'red' : 'white';
        row(k, `${v.toFixed(3)}  ${c('gray', bar)}`, color);
      }
    }
  } catch (e) {
    console.log(c('red', `  Cannot read memory: ${e.message}`));
  }
  console.log('');
}

// ── memory top ───────────────────────────────────────
async function cmdMemoryTop(args) {
  const n = parseInt(args[0]) || 10;
  header(`Top ${n} Learned Moves`);
  const memFile = path.join(__dirname, '..', 'data', 'ai-memory.json');
  try {
    const raw = await fs.readFile(memFile, 'utf8');
    const mem = JSON.parse(raw);
    const moves = (mem.moveScores ?? [])
      .map(([key, val]) => ({
        key,
        avg:   val.count > 0 ? val.total / val.count : 0,
        count: val.count,
        total: val.total,
      }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, n);

    if (!moves.length) { console.log(c('gray', '  No moves learned yet.')); }
    else {
      table(
        ['Move key', 'Avg score', 'Count', 'Total'],
        moves.map(m => [m.key, m.avg.toFixed(2), m.count, m.total.toFixed(0)]),
        ['white', m => m[1] > 0 ? 'green' : 'red', 'gray', 'gray']
      );
    }
  } catch (e) { console.log(c('red', `  Error: ${e.message}`)); }
  console.log('');
}

// ── memory blunders ──────────────────────────────────
async function cmdMemoryBlunders(args) {
  const n = parseInt(args[0]) || 10;
  header(`Top ${n} Blunder Moves`);
  const memFile = path.join(__dirname, '..', 'data', 'ai-memory.json');
  try {
    const raw  = await fs.readFile(memFile, 'utf8');
    const mem  = JSON.parse(raw);
    const list = (mem.blunderMoves ?? []).sort((a, b) => b[1] - a[1]).slice(0, n);
    if (!list.length) { console.log(c('gray', '  No blunders recorded yet.')); }
    else table(['Move key', 'Penalty'], list.map(([k, v]) => [k, v.toFixed(1)]));
  } catch (e) { console.log(c('red', `  Error: ${e.message}`)); }
  console.log('');
}

// ── game analysis ────────────────────────────────────
async function cmdGame(args) {
  const file = args[0];
  if (!file) { console.log(c('red', '  Usage: game <file.json>')); return; }
  header(`Game Analysis: ${path.basename(file)}`);
  try {
    const raw  = await fs.readFile(path.resolve(file), 'utf8');
    const game = JSON.parse(raw);

    row('Final status', game.finalStatus ?? '?', 'cyan');
    row('Result',       game.result      ?? '?', game.result === 'win' ? 'green' : game.result === 'loss' ? 'red' : 'yellow');
    row('Total moves',  game.totalMoves  ?? game.moves?.length ?? '?', 'white');
    row('Date',         game.timestamp   ?? '?', 'gray');

    const moves = game.moves ?? [];
    if (!moves.length) return;

    const evals = moves.filter(m => m.evalBefore != null && m.evalAfter != null);
    if (evals.length) {
      const deltas    = evals.map(m => m.evalAfter - m.evalBefore);
      const avg       = deltas.reduce((a,b)=>a+b,0) / deltas.length;
      const absDeltas = deltas.map(Math.abs);
      const worst     = evals[absDeltas.indexOf(Math.max(...absDeltas))];

      sep('Eval analysis');
      row('Avg eval delta',  avg.toFixed(2), scoreColor(avg));
      row('Worst move',      worst.notation ?? worst.moveKeyStr ?? '?', 'red');
      row('Worst delta',     (worst.evalAfter - worst.evalBefore).toFixed(1), 'red');
      row('Sharpest +delta', Math.max(...deltas).toFixed(1), 'green');
      row('Sharpest −delta', Math.min(...deltas).toFixed(1), 'red');

      sep('Score chart');
      const scores  = evals.map(m => m.evalAfter);
      const sample  = scores.filter((_, i) => i % Math.ceil(scores.length / 56) === 0);
      const min     = Math.min(...sample), max = Math.max(...sample);
      const bars    = sample.map(s => {
        const h   = Math.round(((s - min) / (max - min || 1)) * 7);
        const bar = ['▁','▂','▃','▄','▅','▆','▇','█'][h];
        return s > 0 ? c('green', bar) : s < 0 ? c('red', bar) : c('gray', bar);
      });
      console.log(`  ${bars.join('')}`);
      console.log(c('gray', `  ${min.toFixed(0).padStart(6)} ← score range → ${max.toFixed(0)}`));
    }

    sep('Notation');
    const nota  = moves.map(m => m.notation ?? '?');
    const pairs = [];
    for (let i = 0; i < nota.length; i += 2)
      pairs.push(`${(Math.floor(i/2)+1).toString().padStart(3)}. ${(nota[i]??'').padEnd(14)} ${nota[i+1]??''}`);
    const half = Math.ceil(pairs.length / 2);
    for (let i = 0; i < half; i++) {
      const left  = (pairs[i]         ?? '').padEnd(34);
      const right = (pairs[i + half]  ?? '');
      console.log(`  ${c('white', left)}${c('gray', right)}`);
    }
  } catch (e) { console.log(c('red', `  Error: ${e.message}`)); }
  console.log('');
}

// ── perft ────────────────────────────────────────────
async function cmdPerft(args) {
  const depth = Math.min(parseInt(args[0]) || 2, 4);
  header(`Perft  depth=${depth}`);

  const { createGame, getAllLegalMoves, applyMove, executeDrop, afterMoveEvaluation } = await loadGame();

  function perft(state, d) {
    if (d === 0) return 1;
    const moves = getAllLegalMoves(state, state.turn);
    if (d === 1) return moves.length;
    let total = 0;
    for (const m of moves) {
      const clone = JSON.parse(JSON.stringify({
        board: state.board, turn: state.turn, reserves: state.reserves,
        palaceTaken: state.palaceTaken, palaceTimers: state.palaceTimers,
        palaceCurse: state.palaceCurse, lastMove: state.lastMove,
        lastRepeatedMoveKey: state.lastRepeatedMoveKey, repeatMoveCount: state.repeatMoveCount,
        history: [], positionHistory: [], status: state.status,
        selected: null, legalMoves: [], message: '',
      }));
      clone.positionHistory = new Map();
      try {
        if (m.fromReserve) executeDrop(clone, m.reserveIndex, m.to);
        else applyMove(clone, { from: m.from, to: m.to, promotion: false });
        afterMoveEvaluation(clone);
        total += clone.status === 'playing' ? perft(clone, d - 1) : 1;
      } catch { total++; }
    }
    return total;
  }

  const state = createGame();
  for (let d = 1; d <= depth; d++) {
    const t0    = performance.now();
    const nodes = perft(state, d);
    const ms    = (performance.now() - t0).toFixed(1);
    const nps   = ms > 0 ? ((nodes / parseFloat(ms)) * 1000).toFixed(0) : '∞';
    row(`Depth ${d}`,
      `${nodes.toLocaleString()} nodes  (${ms}ms)  ${nps} nps`,
      parseFloat(ms) < 200 ? 'green' : parseFloat(ms) < 1500 ? 'yellow' : 'red');
  }
  console.log('');
}

// ── selfplay ─────────────────────────────────────────
async function cmdSelfplay(args) {
  const n = Math.min(parseInt(args[0]) || 1, 5);
  header(`Selfplay  games=${n}`);

  const { playSelfPlayGame } = await import('../server/selfplay.js');
  const params = { maxDepth: 4, timeLimitMs: 500 };

  let wins = 0, losses = 0, draws = 0;
  const gameTimes = [];

  for (let i = 0; i < n; i++) {
    const t0     = performance.now();
    const result = await playSelfPlayGame(params);
    const elapsed = (performance.now() - t0) / 1000;
    gameTimes.push(elapsed);

    const last   = result.moves[result.moves.length - 1];
    const isDecisive = result.finalStatus === 'checkmate' || result.finalStatus === 'palacemate';
    let winner = 'Draw';
    if (isDecisive) {
      winner = last?.side === 'black' ? 'Black wins' : 'White wins';
      last?.side === 'black' ? wins++ : losses++;
    } else { draws++; }

    const color = winner.includes('Black') ? 'cyan' : winner.includes('White') ? 'white' : 'yellow';
    row(`Game ${i + 1}`,
      `${result.moves.length} moves · ${result.finalStatus} · ${winner} · ${elapsed.toFixed(1)}s`,
      color);
  }

  if (n > 1) {
    sep('Summary');
    row('Black wins', wins,   'cyan');
    row('White wins', losses, 'white');
    row('Draws',      draws,  'yellow');
    row('Avg time',   `${(gameTimes.reduce((a,b)=>a+b,0)/n).toFixed(1)}s`, 'gray');
    row('Sparkline',  sparkline(gameTimes.map(t=>+t.toFixed(1))), 'gray');
  }
  console.log('');
}

// ── games ────────────────────────────────────────────
async function cmdGames(args) {
  header('Saved Games');
  const gamesDir = path.join(__dirname, '..', '..', 'games');
  try {
    const files     = await fs.readdir(gamesDir);
    const jsons     = files.filter(f => f.endsWith('.json'));
    const processed = jsons.filter(f => f.includes('processed')).length;
    const pending   = jsons.length - processed;

    row('Total',     jsons.length, 'white');
    row('Processed', processed,    'green');
    row('Pending',   pending,      pending > 0 ? 'yellow' : 'gray');

    sep('Recent (last 8)');
    const recent = jsons.slice(-8).reverse();
    for (const f of recent) {
      try {
        const raw  = await fs.readFile(path.join(gamesDir, f), 'utf8');
        const game = JSON.parse(raw);
        const done = f.includes('processed');
        const status = game.finalStatus ?? '?';
        const moves  = game.totalMoves  ?? game.moves?.length ?? '?';
        const res    = game.result ?? '?';
        const rc     = res === 'win' ? 'green' : res === 'loss' ? 'red' : 'yellow';
        console.log(`  ${c('gray', done ? '✓' : '○')} ${c('white', f.slice(0,34).padEnd(35))} ${c('cyan', status.padEnd(14))} ${c(rc, res.padEnd(6))} ${moves} moves`);
      } catch { console.log(`  ${c('red','✗')} ${f}`); }
    }
  } catch (e) { console.log(c('red', `  Cannot read games dir: ${e.message}`)); }
  console.log('');
}

// ── help ─────────────────────────────────────────────
function cmdHelp() {
  header('Debug CLI — Commands');
  table(['Command', 'Description'], [
    ['eval [N]',              'Evaluate start position (N times for avg)'],
    ['bench [N]',             'Benchmark evaluate() on N random positions'],
    ['search [depth] [ms]',   'Find best move at given depth/time'],
    ['compare [d1] [d2] [ms]','Compare two search depths side by side'],
    ['watch <cmd> [args]',    'Re-run command on every Enter keypress'],
    ['tt [depth]',            'TT hit rate + depth distribution'],
    ['nn info',               'Neural network model info'],
    ['nn predict',            'Run NN on start position (3× consistency)'],
    ['memory stats',          'Adaptive memory stats + pattern weights'],
    ['memory top [N]',        'Top N moves by average learned score'],
    ['memory blunders [N]',   'Top N penalized blunder moves'],
    ['game <file.json>',      'Analyze saved game: chart, notation, stats'],
    ['games',                 'List games directory (last 8 shown)'],
    ['perft [depth]',         'Count legal nodes per depth + nps'],
    ['selfplay [N]',          'Run N self-play games (summary if N>1)'],
    ['help',                  'Show this help'],
  ]);
  console.log('');
  console.log(c('gray', '  Examples:'));
  const examples = [
    'node src/debug-cli.js eval 50',
    'node src/debug-cli.js bench 200',
    'node src/debug-cli.js compare 4 7 4000',
    'node src/debug-cli.js watch memory stats',
    'node src/debug-cli.js search 6 3000',
    'node src/debug-cli.js tt 6',
    'node src/debug-cli.js game games/game_xyz.processed.json',
    'node src/debug-cli.js selfplay 5',
  ];
  for (const ex of examples) console.log(`  ${c('cyan', ex)}`);
  console.log('');
}

// ── Dispatcher ───────────────────────────────────────
const commandMap = {
  eval:     (a) => cmdEval(a),
  bench:    (a) => cmdBench(a),
  search:   (a) => cmdSearch(a),
  compare:  (a) => cmdCompare(a),
  watch:    (a) => cmdWatch(a),
  tt:       (a) => cmdTT(a),
  nn:       (a) => a[0] === 'predict' ? cmdNNPredict() : cmdNNInfo(),
  memory:   (a) => a[0] === 'top'      ? cmdMemoryTop(a.slice(1))
                 : a[0] === 'blunders' ? cmdMemoryBlunders(a.slice(1))
                 :                       cmdMemoryStats(),
  game:     (a) => cmdGame(a),
  games:    (a) => cmdGames(a),
  perft:    (a) => cmdPerft(a),
  selfplay: (a) => cmdSelfplay(a),
  help:     ()  => cmdHelp(),
};

const [,, cmd, ...rest] = process.argv;

if (!cmd || !commandMap[cmd]) {
  cmdHelp();
} else {
  commandMap[cmd](rest).catch(e => {
    console.error(c('red', `\n  Fatal: ${e.message}`));
    console.error(c('gray', e.stack ?? ''));
    process.exit(1);
  });
}