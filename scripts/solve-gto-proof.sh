#!/bin/sh
set -eu

PROJECT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
SOLVER_DIR="$PROJECT_DIR/.local/texas-solver"
INPUT_FILE="$PROJECT_DIR/gto/solver-inputs/texassolver-proof-qs8d7h.txt"
RAW_RESULT="$SOLVER_DIR/output_result.json"
SOLVER_LOG="$SOLVER_DIR/solve.log"
POLICY_FILE="$PROJECT_DIR/gto/policies/texassolver-proof-qs8d7h.json"

if [ ! -x "$SOLVER_DIR/console_solver" ]; then
  echo "TexasSolver가 없습니다. 먼저 npm run gto:setup을 실행하세요." >&2
  exit 1
fi

echo "TexasSolver로 Qs 8d 7h 검증 트리를 계산합니다…"
cd "$SOLVER_DIR"
if ! ./console_solver -i "$INPUT_FILE" > "$SOLVER_LOG" 2>&1; then
  tail -n 25 "$SOLVER_LOG"
  exit 1
fi
grep -E 'START SOLVING|Using [0-9]+ threads|Iter:|Total exploitability|time used' "$SOLVER_LOG" || true

cd "$PROJECT_DIR"
node scripts/import-texassolver.mjs "$RAW_RESULT" "$INPUT_FILE" "$POLICY_FILE" texassolver-proof-qs8d7h
echo "정책 생성 완료: $POLICY_FILE"
