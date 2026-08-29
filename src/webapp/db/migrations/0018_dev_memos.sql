-- 개발 메모 테이블 (비서 채팅창에서 개발 요청사항 기록)
CREATE TABLE IF NOT EXISTS dev_memos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT    NOT NULL,
  body        TEXT    NOT NULL,
  priority    TEXT    NOT NULL DEFAULT 'normal', -- urgent / normal / low
  status      TEXT    NOT NULL DEFAULT 'todo',   -- todo / in-progress / done
  raw_input   TEXT,                              -- 작가님 원본 입력 보존
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);
