#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [rawPath, inputPath, outputPath, requestedId] = process.argv.slice(2);
if (!rawPath || !inputPath || !outputPath) {
  console.error('사용법: node scripts/import-texassolver.mjs <output_result.json> <solver-input.txt> <policy.json> [policy-id]');
  process.exit(1);
}

function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function commandValue(lines, command) {
  const line = lines.find(item => item.startsWith(`${command} `));
  return line ? line.slice(command.length + 1).trim() : '';
}

const rawText = fs.readFileSync(path.resolve(rawPath), 'utf8');
const inputText = fs.readFileSync(path.resolve(inputPath), 'utf8');
const tree = JSON.parse(rawText);
const lines = inputText.split(/\r?\n/).map(line => line.trim()).filter(line => line && !line.startsWith('#'));
const board = commandValue(lines, 'set_board').split(',').filter(Boolean);
const street = board.length === 3 ? 'flop' : board.length === 4 ? 'turn' : board.length === 5 ? 'river' : 'unknown';
if (street === 'unknown') throw new Error('set_board에는 플롭 이상의 카드가 필요합니다.');
if (tree.node_type !== 'action_node') throw new Error('TexasSolver 루트가 action_node가 아닙니다.');

const id = requestedId || path.basename(outputPath, path.extname(outputPath));
const policy = {
  schemaVersion: 1,
  id,
  source: {
    engine: 'TexasSolver',
    inputSha256: hash(inputText),
    resultSha256: hash(rawText)
  },
  spot: {
    street,
    board,
    pot: Number(commandValue(lines, 'set_pot')),
    effectiveStack: Number(commandValue(lines, 'set_effective_stack')),
    rangeIp: commandValue(lines, 'set_range_ip'),
    rangeOop: commandValue(lines, 'set_range_oop'),
    accuracy: Number(commandValue(lines, 'set_accuracy')),
    maxIterations: Number(commandValue(lines, 'set_max_iteration')),
    unit: 'solver-chip',
    playerMap: { 0: 'ip', 1: 'oop' }
  },
  tree
};

if (!(policy.spot.pot > 0) || !(policy.spot.effectiveStack > 0)) throw new Error('pot/effective stack 메타데이터가 올바르지 않습니다.');
fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
fs.writeFileSync(path.resolve(outputPath), `${JSON.stringify(policy)}\n`);
console.log(`IMPORTED ${policy.id} · ${policy.spot.street} ${policy.spot.board.join(' ')} · ${rawText.length.toLocaleString()} bytes`);
