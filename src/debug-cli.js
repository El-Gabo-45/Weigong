#!/usr/bin/env node
// src/debug-cli.js
// ══════════════════════════════════════════════════════
//  CLI de debug para IA y red neuronal
//  Uso:
//    node src/debug-cli.js                  → menú interactivo
//    node src/debug-cli.js eval             → evaluar posición inicial
//    node src/debug-cli.js search 4         → buscar a profundidad 4
//    node src/debug-cli.js nn info          → info de la red neuronal
//    node src/debug-cli.js nn predict       → predicción de tablero inicial
//    node src/debug-cli.js memory stats     → estadísticas de memoria adaptativa
//    node src/debug-cli.js memory top 10    → top 10 movimientos aprendidos
//    node src/debug-cli.js game <file.json> → analizar partida guardada
//    node src/debug-cli.js selfplay 1       → correr 1 partida selfplay y ver resultado
//    node src/debug-cli.js perft 3          → contar movimientos legales hasta prof. 3
// ══════════════════════════════════════════════════════

import path from 'node:path';
import fs   from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Debug, dbg } from './debug.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Activar todos los módulos en CLI
Debug.enableAll();

// ── Colores ANSI ──────────────────────────────────────
const C = {
  reset:  '\x1b[0m',  bold:   '\x1b[1m',
  blue:   '\x1b[94m', green:  '\x1b[92m',
  yellow: '\x1b[93m', red:    '\x1b[91m',
  cyan:   '\x1b[96m', gray:   '\x1b[90m',
  white:  '\x1b[97m', magenta:'\x1b[95m',
};

const c  = (color, txt) => `${C[color]}${txt}${C.reset}`;
const hr = (ch = '─', n = 60) => c('gray', ch.repeat(n));

function header(title) {
  console.log('');
  console.log(hr('═'));
  console.log(c('bold', c('cyan', `  ${title}`)));
  console.log(hr('═'));
}

function row(label, value, valueColor = 'white') {
  const padded = label.padEnd(22);
  console.log(`  ${c('gray', padded)} ${c(valueColor, String(value))}`);
}

function table(headers, rows) {
  const widths = headers.map((h, i) =>
    Math.max(h.length, ...rows.map(r => String(r[i] ?? '').length))
  );
  const fmt = row => row.map((v, i) => String(v ?? '').padEnd(widths[i])).join('  ');
  console.log('  ' + c('gray', fmt(headers)));
  console.log('  ' + c('gray', widths.map(w => '─'.repeat(w)).join('  ')));
  rows.forEach(r => console.log('  ' + fmt(r)));
}

// ── Importaciones lazy (evita cargar todo si no se necesita) ──
async function loadGame()   { return import('./rules/index.js'); }
async function loadAI()     { return import('./ai/index.js'); }
async function loadNN()     { return import('./nn-bridge.js'); }

// ══════════════════════════════════════════════════════
//  COMANDOS
// ══════════════════════════════════════════════════════

// ── eval: evaluar posición inicial o desde JSON ───────
async function cmdEval(args) {
  header('Position Evaluation');
  const { createGame } = await loadGame();
  const { evaluate, computeFullHash, extractFeatures } = await loadAI();

  const state = createGame();
  const hash  = computeFullHash(state);
  const t0    = performance.now();
  const result = evaluate(state, hash);
  const ms    = (performance.now() - t0).toFixed(3);

  row('Score',          result.score,  result.score > 0 ? 'green' : result.score < 0 ? 'red' : 'gray');
  row('Time',           `${ms}ms`,     'yellow');
  row('Turn',           state.turn,    'cyan');
  row('Status',         state.status,  'white');

  if (result.metrics) {
    console.log('');
    console.log(c('gray', '  ── Metrics ──'));
    for (const [k, v] of Object.entries(result.metrics)) {
      row(k, typeof v === 'number' ? v.toFixed(4) : v, 'white');
    }
  }

  const features = extractFeatures(state, state.turn);
  row('Feature key',    features?.slice(0, 40) + '...', 'gray');
  console.log('');
}

// ── search: buscar mejor movimiento ──────────────────
async function cmdSearch(args) {
  const depth = parseInt(args[0]) || 4;
  const timeMs = parseInt(args[1]) || 2000;
  header(`Search  depth=${depth}  time=${timeMs}ms`);

  const { createGame, getAllLegalMoves } = await loadGame();
  const { chooseBotMove, evaluate, computeFullHash } = await loadAI();

  const state  = createGame();
  const legal  = getAllLegalMoves(state, state.turn);
  row('Legal moves', legal.length, 'green');

  const t0 = performance.now();
  const { move, score } = chooseBotMove(state, { maxDepth: depth, timeLimitMs: timeMs });
  const ms = (performance.now() - t0).toFixed(1);

  console.log('');
  console.log(c('gray', '  ── Best move ──'));

  if (move) {
    if (move.fromReserve) {
      row('Type',       'Drop from reserve', 'yellow');
      row('Reserve idx', move.reserveIndex,  'white');
      row('To',         `r${move.to.r} c${move.to.c}`, 'cyan');
    } else {
      row('From',       `r${move.from.r} c${move.from.c}`, 'white');
      row('To',         `r${move.to.r} c${move.to.c}`,   'cyan');
      row('Promotion',  move.promotion ? 'yes' : 'no',    move.promotion ? 'green' : 'gray');
    }
    row('Score',  score ?? '?', score > 0 ? 'green' : score < 0 ? 'red' : 'gray');
    row('Time',   `${ms}ms`,   'yellow');
  } else {
    console.log(c('red', '  No move found'));
  }
  console.log('');
}

// ── nn info: información del modelo ──────────────────
async function cmdNNInfo() {
  header('Neural Network Info');
  try {
    const { getModelInfo } = await loadNN();
    const info = await getModelInfo();
    for (const [k, v] of Object.entries(info)) {
      row(k, v, 'white');
    }
  } catch (e) {
    console.log(c('red', `  Error: ${e.message}`));
    console.log(c('gray', '  (Is the server running? Does model.bin exist?)'));
  }
  console.log('');
}

// ── nn predict: predicción de tablero ─────────────────
async function cmdNNPredict() {
  header('Neural Network Prediction');
  const BOARD_SIZE = 13, NN_CHANNELS = 24;
  const PIECE_CHANNEL = {
    king:0, queen:1, general:2, elephant:3, priest:4, horse:5,
    cannon:6, tower:7, carriage:8, archer:9, pawn:10, crossbow:11,
  };

  try {
    const { createGame }  = await loadGame();
    const { predictScore } = await loadNN();
    const { SIDE }        = await import('./constants.js');

    const state = createGame();
    const enc   = new Float32Array(BOARD_SIZE * BOARD_SIZE * NN_CHANNELS);
    for (let r = 0; r < 13; r++) {
      for (let c = 0; c < 13; c++) {
        const p = state.board[r][c];
        if (!p) continue;
        const ch = PIECE_CHANNEL[p.type];
        if (ch === undefined) continue;
        const offset = p.side === SIDE.WHITE ? 0 : 12;
        enc[(r * 13 + c) * NN_CHANNELS + offset + ch] = 1.0;
      }
    }

    const t0    = performance.now();
    const score = await predictScore(enc);
    const ms    = (performance.now() - t0).toFixed(2);

    row('Predicted score', score?.toFixed(6) ?? 'null', 'green');
    row('Inference time',  `${ms}ms`,                   'yellow');
    row('Input size',      `${enc.length} floats`,      'gray');
  } catch (e) {
    console.log(c('red', `  Error: ${e.message}`));
  }
  console.log('');
}

// ── memory stats ──────────────────────────────────────
async function cmdMemoryStats() {
  header('Adaptive Memory Stats');
  const memFile = path.join(__dirname, 'data', 'ai-memory.json');
  try {
    const raw = await fs.readFile(memFile, 'utf8');
    const mem = JSON.parse(raw);

    row('Games played',   mem.gamesPlayed ?? 0,  'white');
    row('Games won',      mem.gamesWon    ?? 0,  'green');
    const wr = mem.gamesPlayed > 0
      ? ((mem.gamesWon / mem.gamesPlayed) * 100).toFixed(1) + '%'
      : '0%';
    row('Win rate',       wr, parseFloat(wr) > 50 ? 'green' : 'yellow');
    row('Move memory',    (mem.moveScores    ?? []).length, 'cyan');
    row('Feature memory', (mem.featureScores ?? []).length, 'cyan');
    row('Blunders',       (mem.blunderMoves  ?? []).length, 'red');
    row('Draw positions', (mem.drawPositions ?? []).length, 'gray');

    if (mem.patternWeights) {
      console.log('');
      console.log(c('gray', '  ── Pattern weights ──'));
      for (const [k, v] of Object.entries(mem.patternWeights)) {
        const bar   = '█'.repeat(Math.round(v * 10));
        const color = v > 1.2 ? 'green' : v < 0.8 ? 'red' : 'white';
        row(k, `${v.toFixed(3)}  ${bar}`, color);
      }
    }
  } catch (e) {
    console.log(c('red', `  Cannot read memory file: ${e.message}`));
  }
  console.log('');
}

// ── memory top N: mejores movimientos aprendidos ──────
async function cmdMemoryTop(args) {
  const n = parseInt(args[0]) || 10;
  header(`Top ${n} Learned Moves`);
  const memFile = path.join(__dirname, 'data', 'ai-memory.json');
  try {
    const raw = await fs.readFile(memFile, 'utf8');
    const mem = JSON.parse(raw);
    const moves = (mem.moveScores ?? [])
      .map(([key, val]) => ({
        key,
        avg: val.count > 0 ? val.total / val.count : 0,
        count: val.count,
        total: val.total,
      }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, n);

    if (moves.length === 0) {
      console.log(c('gray', '  No moves learned yet.'));
    } else {
      table(
        ['Move key', 'Avg score', 'Count', 'Total'],
        moves.map(m => [
          m.key,
          m.avg.toFixed(2),
          m.count,
          m.total.toFixed(0),
        ])
      );
    }
  } catch (e) {
    console.log(c('red', `  Cannot read memory file: ${e.message}`));
  }
  console.log('');
}

// ── memory blunders: movimientos penalizados ──────────
async function cmdMemoryBlunders(args) {
  const n = parseInt(args[0]) || 10;
  header(`Top ${n} Blunder Moves`);
  const memFile = path.join(__dirname, 'data', 'ai-memory.json');
  try {
    const raw  = await fs.readFile(memFile, 'utf8');
    const mem  = JSON.parse(raw);
    const list = (mem.blunderMoves ?? [])
      .sort((a, b) => b[1] - a[1])
      .slice(0, n);

    if (list.length === 0) {
      console.log(c('gray', '  No blunders recorded yet.'));
    } else {
      table(
        ['Move key', 'Penalty'],
        list.map(([k, v]) => [k, v.toFixed(1)])
      );
    }
  } catch (e) {
    console.log(c('red', `  Cannot read memory file: ${e.message}`));
  }
  console.log('');
}

// ── game: analizar partida JSON ───────────────────────
async function cmdGame(args) {
  const file = args[0];
  if (!file) {
    console.log(c('red', '  Usage: debug-cli game <file.json>'));
    return;
  }
  header(`Game Analysis: ${path.basename(file)}`);
  try {
    const raw  = await fs.readFile(file, 'utf8');
    const game = JSON.parse(raw);

    row('Final status', game.finalStatus, 'cyan');
    row('Result',       game.result ?? '?', game.result === 'win' ? 'green' : game.result === 'loss' ? 'red' : 'yellow');
    row('Total moves',  game.totalMoves ?? game.moves?.length ?? '?', 'white');
    row('Date',         game.timestamp ?? '?', 'gray');

    const moves = game.moves ?? [];
    if (moves.length > 0) {
      const evals = moves.filter(m => m.evalBefore != null && m.evalAfter != null);
      if (evals.length > 0) {
        const deltas = evals.map(m => m.evalAfter - m.evalBefore);
        const avg    = deltas.reduce((a, b) => a + b, 0) / deltas.length;
        const worst  = evals.reduce((a, b) =>
          Math.abs(b.evalAfter - b.evalBefore) > Math.abs(a.evalAfter - a.evalBefore) ? b : a
        );

        console.log('');
        console.log(c('gray', '  ── Eval analysis ──'));
        row('Avg eval delta',  avg.toFixed(2), 'white');
        row('Worst move',      worst.notation ?? worst.moveKeyStr, 'red');
        row('Worst delta',     (worst.evalAfter - worst.evalBefore).toFixed(1), 'red');

        // Mini gráfico ASCII de la evaluación
        console.log('');
        console.log(c('gray', '  ── Score chart ──'));
        const samples = evals.filter((_, i) => i % Math.ceil(evals.length / 40) === 0);
        const scores  = samples.map(m => m.evalAfter);
        const min     = Math.min(...scores), max = Math.max(...scores);
        const range   = max - min || 1;
        const bars    = scores.map(s => {
          const h = Math.round(((s - min) / range) * 8);
          const bar = ['▁','▂','▃','▄','▅','▆','▇','█'][Math.min(h, 7)];
          return s > 0 ? c('green', bar) : s < 0 ? c('red', bar) : c('gray', bar);
        });
        console.log('  ' + bars.join(''));
        console.log(c('gray', `  ${min.toFixed(0)} ← score range → ${max.toFixed(0)}`));
      }

      // Notación
      console.log('');
      console.log(c('gray', '  ── Notation ──'));
      const nota = moves.map(m => m.notation ?? '?');
      const pairs = [];
      for (let i = 0; i < nota.length; i += 2) {
        pairs.push(`${Math.floor(i/2)+1}. ${nota[i] ?? ''}  ${nota[i+1] ?? ''}`);
      }
      // Imprimir en 2 columnas
      const half = Math.ceil(pairs.length / 2);
      for (let i = 0; i < half; i++) {
        const left  = (pairs[i]     ?? '').padEnd(28);
        const right = (pairs[i + half] ?? '');
        console.log('  ' + c('white', left) + c('gray', right));
      }
    }
  } catch (e) {
    console.log(c('red', `  Error: ${e.message}`));
  }
  console.log('');
}

// ── perft: contar movimientos legales por profundidad ─
async function cmdPerft(args) {
  const depth = Math.min(parseInt(args[0]) || 2, 4); // máx 4 para no esperar siglos
  header(`Perft  depth=${depth}`);

  const { createGame, getAllLegalMoves, applyMove, executeDrop,
          afterMoveEvaluation } = await loadGame();
  const { SIDE } = await import('./constants.js');

  function perft(state, d) {
    if (d === 0) return 1;
    const moves = getAllLegalMoves(state, state.turn);
    if (d === 1) return moves.length;
    let total = 0;
    for (const m of moves) {
      // Clonar estado mínimamente
      const clone = JSON.parse(JSON.stringify({
        board: state.board,
        turn: state.turn,
        reserves: state.reserves,
        palaceTaken: state.palaceTaken,
        palaceTimers: state.palaceTimers,
        palaceCurse: state.palaceCurse,
        lastMove: state.lastMove,
        lastRepeatedMoveKey: state.lastRepeatedMoveKey,
        repeatMoveCount: state.repeatMoveCount,
        history: state.history,
        positionHistory: [],
        status: state.status,
        selected: null, legalMoves: [], message: '',
      }));
      clone.positionHistory = new Map();
      try {
        if (m.fromReserve) executeDrop(clone, m.reserveIndex, m.to);
        else applyMove(clone, { from: m.from, to: m.to, promotion: false });
        afterMoveEvaluation(clone);
        if (clone.status === 'playing') total += perft(clone, d - 1);
        else total += 1;
      } catch { total += 1; }
    }
    return total;
  }

  const state = createGame();
  for (let d = 1; d <= depth; d++) {
    const t0    = performance.now();
    const nodes = perft(state, d);
    const ms    = (performance.now() - t0).toFixed(1);
    row(`Depth ${d}`, `${nodes.toLocaleString()} nodes  (${ms}ms)`,
      ms < 100 ? 'green' : ms < 1000 ? 'yellow' : 'red');
  }
  console.log('');
}

// ── selfplay: correr N partidas y mostrar resultado ───
async function cmdSelfplay(args) {
  const n = Math.min(parseInt(args[0]) || 1, 5);
  header(`Selfplay  games=${n}`);

  const { playSelfPlayGame } = await import('./selfplay.js');
  const params = { maxDepth: 4, timeLimitMs: 500 };

  for (let i = 0; i < n; i++) {
    const t0     = performance.now();
    const result = await playSelfPlayGame(params);
    const ms     = ((performance.now() - t0) / 1000).toFixed(1);
    const last   = result.moves[result.moves.length - 1];
    const winner = result.finalStatus === 'checkmate' || result.finalStatus === 'palacemate'
      ? (last?.side === 'black' ? 'Black wins' : 'White wins')
      : 'Draw';

    const color = winner.includes('Black') ? 'cyan'
                : winner.includes('White') ? 'white' : 'yellow';

    row(`Game ${i + 1}`,
      `${result.moves.length} moves · ${result.finalStatus} · ${winner} · ${ms}s`,
      color);
  }
  console.log('');
}

// ── games: listar partidas guardadas ─────────────────
async function cmdGames(args) {
  header('Saved Games');
  const gamesDir = path.join(__dirname, '..', 'games');
  try {
    const files = await fs.readdir(gamesDir);
    const jsons = files.filter(f => f.endsWith('.json'));
    const processed = jsons.filter(f => f.includes('processed')).length;
    const pending   = jsons.length - processed;

    row('Total games',   jsons.length,  'white');
    row('Processed',     processed,     'green');
    row('Pending',       pending,        pending > 0 ? 'yellow' : 'gray');
    console.log('');

    // Últimas 5
    const recent = jsons.slice(-5).reverse();
    console.log(c('gray', '  ── Recent ──'));
    for (const f of recent) {
      try {
        const raw  = await fs.readFile(path.join(gamesDir, f), 'utf8');
        const game = JSON.parse(raw);
        const processed = f.includes('processed');
        const status = game.finalStatus ?? '?';
        const moves  = game.totalMoves  ?? game.moves?.length ?? '?';
        console.log(`  ${c('gray', processed ? '✓' : '○')} ${c('white', f.slice(0, 36))}  ${c('cyan', status)}  ${moves} moves`);
      } catch {
        console.log(`  ${c('red', '✗')} ${f}`);
      }
    }
  } catch (e) {
    console.log(c('red', `  Cannot read games dir: ${e.message}`));
  }
  console.log('');
}

// ── help ──────────────────────────────────────────────
function cmdHelp() {
  header('Debug CLI — Commands');
  const cmds = [
    ['eval',              'Evaluate the starting position'],
    ['search [depth] [ms]','Find best move (default: depth=4, 2000ms)'],
    ['nn info',           'Neural network model information'],
    ['nn predict',        'Run NN prediction on starting position'],
    ['memory stats',      'Adaptive memory statistics + pattern weights'],
    ['memory top [N]',    'Top N moves by average score (default: 10)'],
    ['memory blunders [N]','Top N penalized moves (default: 10)'],
    ['game <file.json>',  'Analyze a saved game file'],
    ['games',             'List saved games directory'],
    ['perft [depth]',     'Count legal moves per depth (max 4)'],
    ['selfplay [N]',      'Run N self-play games (max 5)'],
    ['help',              'Show this help'],
  ];
  table(['Command', 'Description'], cmds);
  console.log('');
  console.log(c('gray', '  Examples:'));
  console.log(c('cyan',  '    node src/debug-cli.js eval'));
  console.log(c('cyan',  '    node src/debug-cli.js search 6 3000'));
  console.log(c('cyan',  '    node src/debug-cli.js memory top 20'));
  console.log(c('cyan',  '    node src/debug-cli.js game games/game_123.json'));
  console.log(c('cyan',  '    node src/debug-cli.js perft 3'));
  console.log('');
}

// ══════════════════════════════════════════════════════
//  DISPATCHER
// ══════════════════════════════════════════════════════
const [,, cmd, ...rest] = process.argv;

const commands = {
  eval:     () => cmdEval(rest),
  search:   () => cmdSearch(rest),
  nn:       () => rest[0] === 'predict' ? cmdNNPredict() : cmdNNInfo(),
  memory:   () => rest[0] === 'top'      ? cmdMemoryTop(rest.slice(1))
                : rest[0] === 'blunders' ? cmdMemoryBlunders(rest.slice(1))
                :                          cmdMemoryStats(),
  game:     () => cmdGame(rest),
  games:    () => cmdGames(rest),
  perft:    () => cmdPerft(rest),
  selfplay: () => cmdSelfplay(rest),
  help:     () => cmdHelp(),
};

if (!cmd || !commands[cmd]) {
  cmdHelp();
} else {
  commands[cmd]().catch(e => {
    console.error(c('red', `\n  Fatal: ${e.message}`));
    console.error(c('gray', e.stack));
    process.exit(1);
  });
}