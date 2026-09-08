# FELT CLUB Hold'em

서버 권위형 WebSocket 기반의 2~10인 No-Limit Texas Hold'em 게임입니다.

## 로컬 실행

```bash
npm ci
npm start
```

기본 주소는 `http://127.0.0.1:5050`입니다. 같은 방 코드를 입력한 사용자가 같은 테이블에 참가합니다.

## Render 배포

이 저장소에는 `render.yaml`이 포함되어 있습니다. Render에서 Blueprint 또는 Web Service로 저장소를 연결하면 다음 설정이 적용됩니다.

- Build: `npm ci`
- Start: `npm start`
- Health check: `/api/info`
- WebSocket: HTTP 서버와 같은 포트 사용

현재 방 상태는 메모리에 저장됩니다. 단일 인스턴스 배포에 적합하며, 다중 인스턴스 확장 시 Redis 같은 공유 상태 저장소가 필요합니다.
