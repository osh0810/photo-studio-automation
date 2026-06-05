#!/usr/bin/env python3
"""
고객목록 CSV → D1 마이그레이션 스크립트

사용법:
  python3 scripts/migrate_sheet.py ~/Downloads/고객목록.csv
  python3 scripts/migrate_sheet.py ~/Downloads/고객목록.csv --dry-run  # SQL 생성만, wrangler 실행 X

처리 흐름:
  1. CSV 파싱
  2. scripts/output/ 에 customers_part*.sql + bookings_v2_part*.sql 생성
  3. npx wrangler d1 execute 순서대로 실행 (customers 먼저, bookings 다음)
  4. 완료 후 COUNT 검증 쿼리 실행
"""

import csv
import re
import sys
import subprocess
from datetime import datetime
from pathlib import Path

# ── 설정 ──────────────────────────────────────────────────────────────────────

DB_NAME = "studio-db"
CHUNK_SIZE = 50
OUTPUT_DIR = Path(__file__).parent / "output"
PROJECT_ROOT = Path(__file__).parent.parent

STAGE_RE = re.compile(r'\b(S[0-7][ab]?)\b')


# ── 유틸 ──────────────────────────────────────────────────────────────────────

def normalize_date(val: str):
    """'YYYY-MM-DD ...' → 'YYYY-MM-DD', 빈값/'-' → None"""
    v = val.strip()
    if not v or v == '-':
        return None
    m = re.match(r'(\d{4}-\d{2}-\d{2})', v)
    return m.group(1) if m else None


def normalize_datetime(val: str):
    """'YYYY-MM-DD HH:MM...' 형식 정규화, 빈값 → None"""
    v = val.strip()
    if not v or v == '-':
        return None
    m = re.match(r'(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})', v)
    if m:
        return f"{m.group(1)} {m.group(2)}:00"
    m = re.match(r'(\d{4}-\d{2}-\d{2})', v)
    if m:
        return f"{m.group(1)} 00:00:00"
    return None


def extract_stage(val: str) -> str:
    """'S2 원본발송' → 'S2', 파싱 실패 → 'S0'"""
    m = STAGE_RE.search(val.strip())
    return m.group(1) if m else 'S0'


def q(v) -> str:
    """Python 값 → SQL 리터럴 (None → NULL, str → 싱글쿼트 이스케이프)"""
    if v is None:
        return 'NULL'
    return "'" + str(v).replace("'", "''") + "'"


def chunks(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i:i + n]


# ── CSV 파싱 ──────────────────────────────────────────────────────────────────

def parse_csv(filepath: str):
    """
    CSV → (customers_list, bookings_list)

    customers_list: talk_id 기준 dedup (같은 톡톡ID 첫 등장 기준)
    bookings_list : 고객ID 기준, 빈 booking_id 행 제외
    """
    customers: dict[str, dict] = {}  # talk_id → row
    bookings: list[dict] = []

    with open(filepath, encoding='utf-8-sig', newline='') as f:
        reader = csv.DictReader(f)
        for row in reader:
            g = lambda k: row.get(k, '').strip()  # noqa: E731

            booking_id = g('고객ID')
            customer_name = g('고객명')
            if not booking_id or not customer_name:
                continue

            talk_id = g('톡톡ID') or None
            now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            created_at = normalize_datetime(g('등록일시')) or now_str
            updated_at = normalize_datetime(g('최종수정일시')) or now_str

            # customers — 톡톡ID 있는 행만, dedup
            if talk_id and talk_id not in customers:
                customers[talk_id] = {
                    'talk_id': talk_id,
                    'customer_name': customer_name,
                    'phone': g('연락처') or None,
                    'consultation_channel': g('상담채널') or None,
                    'memo': g('비고') or None,
                    'created_at': created_at,
                    'updated_at': updated_at,
                }

            # bookings
            shoot_date = normalize_date(g('촬영일'))
            # reservation_date NOT NULL → 촬영일 또는 등록일 날짜 부분 fallback
            reservation_date = shoot_date or created_at[:10]

            bookings.append({
                'booking_id': booking_id,
                'talk_id': talk_id,
                'customer_name': customer_name,
                'product_name': g('촬영종류') or None,
                'shoot_date': shoot_date,
                'reservation_date': reservation_date,
                'original_sent_at': normalize_date(g('원본발송일')),
                'selection_received_at': normalize_date(g('셀렉수신일')),
                'selection_cuts': g('셀렉컷') or None,
                'retouched_sent_at': normalize_date(g('보정본발송일')),
                'revision_requested_at': normalize_date(g('추가보정요청일')),
                'revision_content': g('추가보정내용') or None,
                'revision_sent_at': normalize_date(g('추가보정본발송일')),
                'frame_ordered_at': normalize_date(g('액자발주일')),
                'alert_paused_until': normalize_date(g('알림일시정지')),
                'current_stage': extract_stage(g('현재단계')),
                'review_status': g('검토상태') or None,
                'created_at': created_at,
                'updated_at': updated_at,
            })

    return list(customers.values()), bookings


# ── SQL 생성 ──────────────────────────────────────────────────────────────────

def make_customers_sql(rows: list[dict]) -> str:
    lines = []
    for r in rows:
        lines.append(
            "INSERT OR IGNORE INTO customers "
            "(talk_id, customer_name, phone, consultation_channel, memo, "
            "frame_address, frame_recipient, frame_phone, created_at, updated_at) VALUES ("
            f"{q(r['talk_id'])}, {q(r['customer_name'])}, {q(r['phone'])}, "
            f"{q(r['consultation_channel'])}, {q(r['memo'])}, "
            f"NULL, NULL, NULL, "
            f"{q(r['created_at'])}, {q(r['updated_at'])}"
            ");"
        )
    return '\n'.join(lines) + '\n'


def make_bookings_sql(rows: list[dict]) -> str:
    lines = []
    for r in rows:
        lines.append(
            "INSERT OR IGNORE INTO bookings "
            "(booking_id, talk_id, customer_name, product_name, "
            "shoot_date, reservation_date, "
            "original_sent_at, selection_received_at, selection_cuts, "
            "retouched_sent_at, revision_requested_at, revision_content, revision_sent_at, "
            "frame_ordered_at, alert_paused_until, current_stage, review_status, "
            "created_at, updated_at) VALUES ("
            f"{q(r['booking_id'])}, {q(r['talk_id'])}, {q(r['customer_name'])}, "
            f"{q(r['product_name'])}, "
            f"{q(r['shoot_date'])}, {q(r['reservation_date'])}, "
            f"{q(r['original_sent_at'])}, {q(r['selection_received_at'])}, "
            f"{q(r['selection_cuts'])}, "
            f"{q(r['retouched_sent_at'])}, {q(r['revision_requested_at'])}, "
            f"{q(r['revision_content'])}, {q(r['revision_sent_at'])}, "
            f"{q(r['frame_ordered_at'])}, {q(r['alert_paused_until'])}, "
            f"{q(r['current_stage'])}, {q(r['review_status'])}, "
            f"{q(r['created_at'])}, {q(r['updated_at'])}"
            ");"
        )
    return '\n'.join(lines) + '\n'


# ── wrangler 실행 ──────────────────────────────────────────────────────────────

def run_wrangler(sql_file: Path) -> bool:
    """wrangler d1 execute 실행. 성공 True, 실패 False."""
    result = subprocess.run(
        ["npx", "wrangler", "d1", "execute", DB_NAME,
         "--file", str(sql_file.resolve()), "--remote"],
        capture_output=True,
        text=True,
        cwd=str(PROJECT_ROOT),
    )
    output = (result.stdout + result.stderr).strip()

    # "Rows written: N" 또는 숫자 추출
    m = re.search(r'(\d+)\s*rows?\s*written', output, re.IGNORECASE)
    rows_info = m.group(0) if m else "(rows written 정보 없음)"
    print(f"    {rows_info}")

    if result.returncode != 0:
        print(f"    ❌ 오류:\n{output}")
        return False

    return True


# ── 메인 ──────────────────────────────────────────────────────────────────────

def main():
    if len(sys.argv) < 2 or sys.argv[1] in ('-h', '--help'):
        print(__doc__)
        sys.exit(0)

    csv_path = sys.argv[1]
    dry_run = '--dry-run' in sys.argv

    if not Path(csv_path).exists():
        print(f"❌ 파일을 찾을 수 없습니다: {csv_path}")
        sys.exit(1)

    # 1. CSV 파싱
    print(f"CSV 파싱 중: {csv_path}")
    customers, bookings = parse_csv(csv_path)

    # 2. 확인 프롬프트
    print(f"\ncustomers {len(customers)}개, bookings {len(bookings)}개 처리합니다. 진행할까요? (y/n)", end=' ')
    answer = input().strip().lower()
    if answer != 'y':
        print("취소됨")
        sys.exit(0)

    # 3. output 폴더 생성
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    # 4. SQL 파일 생성
    print("\nSQL 파일 생성 중...")

    customer_files: list[Path] = []
    for i, chunk in enumerate(chunks(customers, CHUNK_SIZE), 1):
        path = OUTPUT_DIR / f"customers_part{i:02d}.sql"
        path.write_text(make_customers_sql(chunk), encoding='utf-8')
        customer_files.append(path)
        print(f"  생성: {path.name} ({len(chunk)}건)")

    booking_files: list[Path] = []
    for i, chunk in enumerate(chunks(bookings, CHUNK_SIZE), 1):
        path = OUTPUT_DIR / f"bookings_v2_part{i:02d}.sql"
        path.write_text(make_bookings_sql(chunk), encoding='utf-8')
        booking_files.append(path)
        print(f"  생성: {path.name} ({len(chunk)}건)")

    if dry_run:
        print(f"\n[dry-run] SQL 파일 {len(customer_files) + len(booking_files)}개 생성 완료. wrangler 실행은 건너뜁니다.")
        print(f"파일 위치: {OUTPUT_DIR}/")
        sys.exit(0)

    # 5. wrangler 실행 (customers → bookings 순서)
    all_files = customer_files + booking_files
    print(f"\nwrangler d1 execute 실행 중 ({len(all_files)}개 파일)...")

    for sql_file in all_files:
        print(f"\n  ▶ {sql_file.name}")
        ok = run_wrangler(sql_file)
        if not ok:
            print("\n중단됨. 나머지 파일은 실행되지 않았습니다.")
            sys.exit(1)
        print(f"    ✅ 완료")

    # 6. 검증 쿼리
    print("\n검증 쿼리 실행 중...")
    verify_sql = OUTPUT_DIR / "_verify.sql"
    verify_sql.write_text(
        "SELECT 'customers' AS tbl, COUNT(*) AS cnt FROM customers\n"
        "UNION ALL\n"
        "SELECT 'bookings', COUNT(*) FROM bookings;\n",
        encoding='utf-8',
    )
    result = subprocess.run(
        ["npx", "wrangler", "d1", "execute", DB_NAME,
         "--file", str(verify_sql.resolve()), "--remote", "--json"],
        capture_output=True,
        text=True,
        cwd=str(PROJECT_ROOT),
    )
    output = (result.stdout + result.stderr).strip()
    print(output)

    print("\n마이그레이션 완료.")


if __name__ == '__main__':
    main()
