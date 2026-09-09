# TexasSolver GTO 정책 파이프라인

이 프로젝트의 COM은 `gto/policies/*.json` 중 현재 보드·SPR·인원·액션 기록이 정확히 맞는 정책을 찾으면 TexasSolver가 계산한 혼합 확률대로 행동합니다. 정확한 정책이 없는 상황은 단순 랜덤 로직 대신 포지션별 RFI, 림퍼 대응, 오픈 레이즈 방어, 3벳·4벳, 올인과 유효 스택별 프리플랍 레인지에 Monte Carlo equity, 팟 오즈, SPR, 베팅 압력, 이전 스트리트 공격권, 페어 등급, 드로와 블로커를 결합하는 `equity-gto-v4` 혼합 전략 엔진으로 처리합니다.

현재 포함된 `texassolver-proof-qs8d7h.json`은 공식 콘솔 샘플을 직접 계산해 가져온 end-to-end 검증 정책입니다. 범위는 헤즈업, `Qs 8d 7h`, pot 4, effective stack 10, IP `T9s`, OOP `JTs,43s`이며 solver 정확도 목표는 0.5%입니다. 즉 전체 홀덤을 커버하는 데이터베이스가 아니라 실제 solver 확률이 게임까지 전달되는 첫 검증 스팟입니다. `equity-gto-v4`는 이 빈 범위를 합리적으로 처리하지만 TexasSolver의 정확한 해와 동일하다고 주장하지 않습니다.

## 다시 계산하기 (macOS)

```bash
npm run gto:setup
npm run gto:proof
npm run test:gto
```

`gto:setup`은 공식 TexasSolver v0.2.0 macOS 릴리스를 `.local/texas-solver`에 설치합니다. Apple Silicon에서는 Rosetta 2가 필요할 수 있습니다. `.local/`과 solver 원본 출력 `gto/raw/`은 Git에서 제외됩니다. 서버에는 변환된 정책 JSON만 필요합니다.

## 새 스팟 추가하기

1. `gto/solver-inputs/`에 보드, pot, effective stack, IP/OOP range, bet size를 담은 TexasSolver 명령 파일을 만듭니다.
2. `console_solver -i <명령 파일>`로 `output_result.json`을 계산합니다.
3. 아래처럼 정책 파일로 변환합니다.

```bash
npm run gto:import -- output_result.json gto/solver-inputs/my-spot.txt gto/policies/my-spot.json my-spot
```

서버를 재시작하면 새 정책을 자동으로 읽습니다. 정책 매칭은 현재 헤즈업 포스트플롭만 지원하며 보드는 정확히 일치해야 하고 SPR 오차는 5% 이내여야 합니다.

TexasSolver 콘솔 입력은 `#` 주석을 명령으로 해석하므로 입력 파일에는 실행 명령만 넣어야 합니다.

## 배포와 라이선스

TexasSolver는 근사 내시 균형을 계산하는 solver이므로 여기서 말하는 “실제 GTO 확률”은 지정한 게임 트리와 정확도에서 계산된 solver 전략입니다. 외부 웹 서비스로 상업 배포하기 전에는 TexasSolver의 현재 라이선스 조건을 별도로 확인해야 합니다.
