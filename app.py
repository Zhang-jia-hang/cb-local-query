from __future__ import annotations

import io
import re
import sqlite3
import tempfile
import threading
import time
import webbrowser
from datetime import datetime
from pathlib import Path
from typing import Any

import pandas as pd
from flask import Flask, jsonify, render_template, request, send_file

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DATA_DIR.mkdir(parents=True, exist_ok=True)
DB_PATH = DATA_DIR / "app.db"
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 200

META_TABLE = "__table_meta"
FOLDER_TABLE = "__folder_meta"
SYSTEM_TABLES = {META_TABLE, FOLDER_TABLE}

_IDENTIFIER_SAFE_RE = re.compile(r"[^0-9A-Za-z_\u4e00-\u9fff]")


def _normalize_identifier(raw: str, fallback: str) -> str:
    text = (raw or "").strip()
    if not text:
        return fallback
    text = text.replace(" ", "_")
    text = _IDENTIFIER_SAFE_RE.sub("_", text)
    text = re.sub(r"_+", "_", text).strip("_")
    if not text:
        return fallback
    if text[0].isdigit():
        text = f"t_{text}"
    return text


def _quote_ident(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def normalize_folder_path(path: str) -> str:
    text = (path or "").strip().replace("\\", "/")
    text = re.sub(r"/+", "/", text).strip("/")
    return text


def now_str() -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def create_system_tables() -> None:
    with get_conn() as conn:
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {META_TABLE} (
                table_name TEXT PRIMARY KEY,
                display_name TEXT NOT NULL,
                folder_path TEXT NOT NULL DEFAULT '',
                is_deleted INTEGER NOT NULL DEFAULT 0,
                deleted_at TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {FOLDER_TABLE} (
                folder_path TEXT PRIMARY KEY,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.commit()


def list_physical_tables() -> list[str]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
    return [r["name"] for r in rows if r["name"] not in SYSTEM_TABLES]


def sync_table_metadata() -> None:
    physical = set(list_physical_tables())
    now = now_str()

    with get_conn() as conn:
        meta_rows = conn.execute(f"SELECT table_name FROM {META_TABLE}").fetchall()
        meta_names = {r["table_name"] for r in meta_rows}

        for t in sorted(physical - meta_names):
            conn.execute(
                f"INSERT INTO {META_TABLE} (table_name, display_name, folder_path, is_deleted, deleted_at, created_at) VALUES (?, ?, '', 0, NULL, ?)",
                (t, t, now),
            )

        stale = sorted(meta_names - physical)
        for t in stale:
            conn.execute(f"DELETE FROM {META_TABLE} WHERE table_name = ?", (t,))

        conn.commit()


def ensure_ready() -> None:
    create_system_tables()
    sync_table_metadata()


def get_table_record(table_name: str) -> dict[str, Any] | None:
    ensure_ready()
    with get_conn() as conn:
        row = conn.execute(
            f"SELECT table_name, display_name, folder_path, is_deleted, deleted_at, created_at FROM {META_TABLE} WHERE table_name = ?",
            (table_name,),
        ).fetchone()
    if not row:
        return None
    return dict(row)


def list_tables(include_deleted: bool = False) -> list[dict[str, Any]]:
    ensure_ready()
    sql = f"SELECT table_name, display_name, folder_path, is_deleted, deleted_at, created_at FROM {META_TABLE}"
    params: list[Any] = []
    if not include_deleted:
        sql += " WHERE is_deleted = 0"
    sql += " ORDER BY folder_path, display_name"

    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()

    return [dict(r) for r in rows]


def list_folders() -> list[str]:
    ensure_ready()
    with get_conn() as conn:
        rows = conn.execute(f"SELECT folder_path FROM {FOLDER_TABLE} ORDER BY folder_path").fetchall()
    return [r["folder_path"] for r in rows]


def ensure_folder(path: str) -> None:
    normalized = normalize_folder_path(path)
    if not normalized:
        return

    parts = normalized.split("/")
    now = now_str()
    curr = ""
    with get_conn() as conn:
        for p in parts:
            curr = p if not curr else f"{curr}/{p}"
            conn.execute(
                f"INSERT OR IGNORE INTO {FOLDER_TABLE} (folder_path, created_at) VALUES (?, ?)",
                (curr, now),
            )
        conn.commit()


def create_folder(path: str) -> str:
    normalized = normalize_folder_path(path)
    if not normalized:
        raise ValueError("invalid folder path")
    ensure_folder(normalized)
    return normalized


def rename_table_display(table_name: str, new_name: str) -> None:
    record = get_table_record(table_name)
    if not record:
        raise ValueError("table not found")

    display = (new_name or "").strip()
    if not display:
        raise ValueError("invalid display name")

    with get_conn() as conn:
        conn.execute(f"UPDATE {META_TABLE} SET display_name = ? WHERE table_name = ?", (display, table_name))
        conn.commit()


def move_table_to_folder(table_name: str, folder_path: str) -> str:
    record = get_table_record(table_name)
    if not record:
        raise ValueError("table not found")

    normalized = normalize_folder_path(folder_path)
    if normalized:
        ensure_folder(normalized)

    with get_conn() as conn:
        conn.execute(f"UPDATE {META_TABLE} SET folder_path = ? WHERE table_name = ?", (normalized, table_name))
        conn.commit()

    return normalized


def soft_delete_table(table_name: str) -> None:
    record = get_table_record(table_name)
    if not record:
        raise ValueError("table not found")
    if record["is_deleted"] == 1:
        return

    with get_conn() as conn:
        conn.execute(
            f"UPDATE {META_TABLE} SET is_deleted = 1, deleted_at = ? WHERE table_name = ?",
            (now_str(), table_name),
        )
        conn.commit()


def restore_table(table_name: str) -> None:
    record = get_table_record(table_name)
    if not record:
        raise ValueError("table not found")

    with get_conn() as conn:
        conn.execute(
            f"UPDATE {META_TABLE} SET is_deleted = 0, deleted_at = NULL WHERE table_name = ?",
            (table_name,),
        )
        conn.commit()


def purge_table(table_name: str) -> None:
    record = get_table_record(table_name)
    if not record:
        raise ValueError("table not found")

    with get_conn() as conn:
        conn.execute(f"DROP TABLE IF EXISTS {_quote_ident(table_name)}")
        conn.execute(f"DELETE FROM {META_TABLE} WHERE table_name = ?", (table_name,))
        conn.commit()


def get_columns(table_name: str) -> list[str]:
    with get_conn() as conn:
        rows = conn.execute(f"PRAGMA table_info({_quote_ident(table_name)})").fetchall()
    return [r["name"] for r in rows]


def import_excel_to_sqlite(file_stream: io.BytesIO) -> dict[str, Any]:
    ensure_ready()
    xls = pd.ExcelFile(file_stream, engine="openpyxl")
    created: list[dict[str, str]] = []
    used_names: set[str] = set(list_physical_tables())
    now = now_str()

    with get_conn() as conn:
        for idx, sheet in enumerate(xls.sheet_names, start=1):
            fallback = f"sheet_{idx}"
            table_name = _normalize_identifier(sheet, fallback)
            original_name = table_name
            suffix = 1
            while table_name in used_names:
                suffix += 1
                table_name = f"{original_name}_{suffix}"

            df = pd.read_excel(xls, sheet_name=sheet, dtype=str)
            df = df.fillna("")

            cols: list[str] = []
            seen_cols: set[str] = set()
            for cidx, col in enumerate(df.columns, start=1):
                col_name = _normalize_identifier(str(col), f"col_{cidx}")
                candidate = col_name
                csuffix = 1
                while candidate in seen_cols:
                    csuffix += 1
                    candidate = f"{col_name}_{csuffix}"
                seen_cols.add(candidate)
                cols.append(candidate)

            df.columns = cols
            df.to_sql(table_name, conn, if_exists="replace", index=False)
            used_names.add(table_name)

            conn.execute(
                f"INSERT OR REPLACE INTO {META_TABLE} (table_name, display_name, folder_path, is_deleted, deleted_at, created_at) VALUES (?, ?, COALESCE((SELECT folder_path FROM {META_TABLE} WHERE table_name = ?), ''), 0, NULL, COALESCE((SELECT created_at FROM {META_TABLE} WHERE table_name = ?), ?))",
                (table_name, sheet, table_name, table_name, now),
            )
            created.append({"sheet": sheet, "table": table_name})

        conn.commit()

    return {"created": created, "count": len(created)}


def apply_hidden_columns(all_columns: list[str], hidden_columns: list[str]) -> list[str]:
    hidden_set = {c for c in hidden_columns if c in all_columns}
    return [c for c in all_columns if c not in hidden_set]


def build_global_clause(columns: list[str], global_keyword: str) -> tuple[str, list[Any]]:
    if not global_keyword:
        return "", []

    like = f"%{global_keyword}%"
    parts: list[str] = []
    params: list[Any] = []
    for col in columns:
        parts.append(f"CAST({_quote_ident(col)} AS TEXT) LIKE ?")
        params.append(like)
    if not parts:
        return "", []
    return "(" + " OR ".join(parts) + ")", params


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except Exception:
        return None


def build_conditions_clause(columns: list[str], conditions: list[dict[str, Any]]) -> tuple[str, list[Any]]:
    if not conditions:
        return "", []

    expr_parts: list[str] = []
    params: list[Any] = []

    for cond in conditions:
        if not isinstance(cond, dict):
            continue

        field = str(cond.get("field") or "").strip()
        if field not in columns:
            continue

        ctype = str(cond.get("type") or "like").strip().lower()
        expr = ""
        expr_params: list[Any] = []

        if ctype == "range":
            min_v = _to_float(cond.get("min"))
            max_v = _to_float(cond.get("max"))
            qfield = f"CAST({_quote_ident(field)} AS REAL)"
            if min_v is not None and max_v is not None:
                expr = f"({qfield} >= ? AND {qfield} <= ?)"
                expr_params.extend([min_v, max_v])
            elif min_v is not None:
                expr = f"{qfield} >= ?"
                expr_params.append(min_v)
            elif max_v is not None:
                expr = f"{qfield} <= ?"
                expr_params.append(max_v)
        else:
            value = str(cond.get("value") or "").strip()
            if value:
                expr = f"CAST({_quote_ident(field)} AS TEXT) LIKE ?"
                expr_params.append(f"%{value}%")

        if not expr:
            continue

        logic = str(cond.get("logic") or "AND").upper()
        if logic not in {"AND", "OR"}:
            logic = "AND"

        if not expr_parts:
            expr_parts.append(f"({expr})")
        else:
            expr_parts.append(f" {logic} ({expr})")
        params.extend(expr_params)

    if not expr_parts:
        return "", []
    return "".join(expr_parts), params


def normalize_sort_rules(
    columns: list[str],
    sort_rules: list[dict[str, Any]],
    fallback_field: str,
    fallback_order: str,
) -> list[tuple[str, str]]:
    rules: list[tuple[str, str]] = []

    for item in sort_rules:
        if not isinstance(item, dict):
            continue
        field = str(item.get("field") or "").strip()
        if field not in columns:
            continue
        order = "DESC" if str(item.get("order") or "asc").lower() == "desc" else "ASC"
        rules.append((field, order))

    if rules:
        return rules

    if fallback_field in columns:
        order = "DESC" if (fallback_order or "").lower() == "desc" else "ASC"
        return [(fallback_field, order)]

    return []


def build_order_clause(
    columns: list[str],
    sort_rules: list[dict[str, Any]],
    fallback_field: str,
    fallback_order: str,
) -> str:
    normalized = normalize_sort_rules(columns, sort_rules, fallback_field, fallback_order)
    if not normalized:
        return ""
    parts = [f"{_quote_ident(field)} {order}" for field, order in normalized]
    return " ORDER BY " + ", ".join(parts)


def build_where_clause(
    query_columns: list[str],
    global_keyword: str,
    conditions: list[dict[str, Any]],
) -> tuple[str, list[Any]]:
    global_expr, global_params = build_global_clause(query_columns, global_keyword)
    cond_expr, cond_params = build_conditions_clause(query_columns, conditions)

    parts: list[str] = []
    params: list[Any] = []
    if global_expr:
        parts.append(global_expr)
        params.extend(global_params)
    if cond_expr:
        parts.append("(" + cond_expr + ")")
        params.extend(cond_params)

    if not parts:
        return "", []
    return " WHERE " + " AND ".join(parts), params


def assert_active_table(table_name: str) -> dict[str, Any]:
    record = get_table_record(table_name)
    if not record:
        raise ValueError("table not found")
    if int(record.get("is_deleted", 0)) == 1:
        raise ValueError("table is in recycle bin")
    return record


def query_table(
    table: str,
    page: int,
    page_size: int,
    global_keyword: str,
    conditions: list[dict[str, Any]],
    sort_rules: list[dict[str, Any]],
    sort_field: str,
    sort_order: str,
    hidden_columns: list[str],
) -> dict[str, Any]:
    assert_active_table(table)

    all_columns = get_columns(table)
    query_columns = apply_hidden_columns(all_columns, hidden_columns)
    if not query_columns:
        raise ValueError("all columns are hidden")

    where_clause, params = build_where_clause(query_columns, global_keyword, conditions)
    order_clause = build_order_clause(query_columns, sort_rules, sort_field, sort_order)
    select_clause = ", ".join(_quote_ident(c) for c in query_columns)

    safe_page = max(1, page)
    safe_size = min(MAX_PAGE_SIZE, max(1, page_size))
    offset = (safe_page - 1) * safe_size

    with get_conn() as conn:
        total = conn.execute(
            f"SELECT COUNT(1) AS c FROM {_quote_ident(table)}{where_clause}", params
        ).fetchone()["c"]
        rows = conn.execute(
            f"SELECT {select_clause} FROM {_quote_ident(table)}{where_clause}{order_clause} LIMIT ? OFFSET ?",
            [*params, safe_size, offset],
        ).fetchall()

    data = [dict(r) for r in rows]
    total_pages = max(1, (total + safe_size - 1) // safe_size)
    return {
        "columns": query_columns,
        "rows": data,
        "total": total,
        "page": safe_page,
        "page_size": safe_size,
        "total_pages": total_pages,
    }


def fetch_all_rows_for_export(
    table: str,
    global_keyword: str,
    conditions: list[dict[str, Any]],
    sort_rules: list[dict[str, Any]],
    sort_field: str,
    sort_order: str,
    hidden_columns: list[str],
) -> tuple[list[str], list[dict[str, Any]]]:
    assert_active_table(table)

    all_columns = get_columns(table)
    query_columns = apply_hidden_columns(all_columns, hidden_columns)
    if not query_columns:
        raise ValueError("all columns are hidden")

    where_clause, params = build_where_clause(query_columns, global_keyword, conditions)
    order_clause = build_order_clause(query_columns, sort_rules, sort_field, sort_order)
    select_clause = ", ".join(_quote_ident(c) for c in query_columns)

    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT {select_clause} FROM {_quote_ident(table)}{where_clause}{order_clause}",
            params,
        ).fetchall()

    return query_columns, [dict(r) for r in rows]


def export_query_to_excel(table: str, payload: dict[str, Any]) -> tuple[str, bytes]:
    hidden_columns = payload.get("hidden_columns") or []
    if not isinstance(hidden_columns, list):
        hidden_columns = []

    conditions = payload.get("conditions") or []
    if not isinstance(conditions, list):
        conditions = []

    sort_rules = payload.get("sort_rules") or []
    if not isinstance(sort_rules, list):
        sort_rules = []

    columns, rows = fetch_all_rows_for_export(
        table=table,
        global_keyword=payload.get("global_keyword", "").strip(),
        conditions=conditions,
        sort_rules=sort_rules,
        sort_field=payload.get("sort_field", "").strip(),
        sort_order=payload.get("sort_order", "asc").strip(),
        hidden_columns=hidden_columns,
    )

    visible_columns = payload.get("visible_columns") or []
    if isinstance(visible_columns, list) and visible_columns:
        export_columns = [c for c in columns if c in visible_columns]
        if not export_columns:
            export_columns = columns
    else:
        export_columns = columns

    df = pd.DataFrame(rows, columns=export_columns)
    bio = io.BytesIO()
    with pd.ExcelWriter(bio, engine="openpyxl") as writer:
        df.to_excel(writer, index=False, sheet_name=table[:31] or "result")
    return f"{table}_query_result.xlsx", bio.getvalue()


def create_app() -> Flask:
    app = Flask(__name__)
    ensure_ready()

    @app.get("/")
    def index() -> str:
        return render_template("index.html")

    @app.get("/api/tables")
    def api_tables():
        return jsonify({"tables": list_tables(include_deleted=False), "folders": list_folders()})

    @app.get("/api/recycle-bin")
    def api_recycle_bin():
        items = [x for x in list_tables(include_deleted=True) if int(x["is_deleted"]) == 1]
        return jsonify({"tables": items})

    @app.post("/api/folders")
    def api_create_folder():
        payload = request.get_json(silent=True) or {}
        folder_path = payload.get("folder_path") or ""
        try:
            folder = create_folder(folder_path)
            return jsonify({"folder": folder})
        except ValueError as ex:
            return jsonify({"error": str(ex)}), 400
        except Exception as ex:
            return jsonify({"error": f"创建文件夹失败: {ex}"}), 500

    @app.get("/api/table/<table>/columns")
    def api_columns(table: str):
        try:
            assert_active_table(table)
            return jsonify({"columns": get_columns(table)})
        except ValueError as ex:
            return jsonify({"error": str(ex)}), 404

    @app.patch("/api/table/<table>/rename")
    def api_rename_table(table: str):
        payload = request.get_json(silent=True) or {}
        new_name = payload.get("display_name") or ""
        try:
            rename_table_display(table, new_name)
            return jsonify({"ok": True})
        except ValueError as ex:
            return jsonify({"error": str(ex)}), 400
        except Exception as ex:
            return jsonify({"error": f"重命名失败: {ex}"}), 500

    @app.patch("/api/table/<table>/move")
    def api_move_table(table: str):
        payload = request.get_json(silent=True) or {}
        folder_path = payload.get("folder_path") or ""
        try:
            folder = move_table_to_folder(table, folder_path)
            return jsonify({"folder": folder})
        except ValueError as ex:
            return jsonify({"error": str(ex)}), 400
        except Exception as ex:
            return jsonify({"error": f"移动失败: {ex}"}), 500

    @app.post("/api/table/<table>/delete")
    @app.delete("/api/table/<table>")
    def api_delete_table(table: str):
        try:
            soft_delete_table(table)
            return jsonify({"deleted": table})
        except ValueError as ex:
            return jsonify({"error": str(ex)}), 404
        except Exception as ex:
            return jsonify({"error": f"删除失败: {ex}"}), 500

    @app.post("/api/table/<table>/restore")
    def api_restore_table(table: str):
        try:
            restore_table(table)
            return jsonify({"restored": table})
        except ValueError as ex:
            return jsonify({"error": str(ex)}), 404
        except Exception as ex:
            return jsonify({"error": f"恢复失败: {ex}"}), 500

    @app.delete("/api/table/<table>/purge")
    def api_purge_table(table: str):
        try:
            purge_table(table)
            return jsonify({"purged": table})
        except ValueError as ex:
            return jsonify({"error": str(ex)}), 404
        except Exception as ex:
            return jsonify({"error": f"彻底删除失败: {ex}"}), 500

    @app.post("/api/import-excel")
    def api_import_excel():
        if "file" not in request.files:
            return jsonify({"error": "missing file"}), 400
        file = request.files["file"]
        if not file.filename:
            return jsonify({"error": "invalid file"}), 400

        content = io.BytesIO(file.read())
        try:
            summary = import_excel_to_sqlite(content)
            return jsonify(summary)
        except Exception as ex:
            return jsonify({"error": f"导入失败: {ex}"}), 500

    @app.post("/api/query")
    def api_query():
        payload = request.get_json(silent=True) or {}
        table = (payload.get("table") or "").strip()
        if not table:
            return jsonify({"error": "missing table"}), 400

        hidden_columns = payload.get("hidden_columns") or []
        if not isinstance(hidden_columns, list):
            hidden_columns = []

        conditions = payload.get("conditions") or []
        if not isinstance(conditions, list):
            conditions = []

        sort_rules = payload.get("sort_rules") or []
        if not isinstance(sort_rules, list):
            sort_rules = []

        try:
            result = query_table(
                table=table,
                page=int(payload.get("page", 1)),
                page_size=int(payload.get("page_size", DEFAULT_PAGE_SIZE)),
                global_keyword=(payload.get("global_keyword") or "").strip(),
                conditions=conditions,
                sort_rules=sort_rules,
                sort_field=(payload.get("sort_field") or "").strip(),
                sort_order=(payload.get("sort_order") or "asc").strip(),
                hidden_columns=hidden_columns,
            )
            return jsonify(result)
        except ValueError as ex:
            return jsonify({"error": str(ex)}), 400
        except Exception as ex:
            return jsonify({"error": f"查询失败: {ex}"}), 500

    @app.post("/api/export")
    def api_export():
        payload = request.get_json(silent=True) or {}
        table = (payload.get("table") or "").strip()
        if not table:
            return jsonify({"error": "missing table"}), 400

        try:
            filename, content = export_query_to_excel(table, payload)
            with tempfile.NamedTemporaryFile(delete=False, suffix=".xlsx") as tmp:
                tmp.write(content)
                temp_path = tmp.name
            return send_file(
                temp_path,
                as_attachment=True,
                download_name=filename,
                mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            )
        except Exception as ex:
            return jsonify({"error": f"导出失败: {ex}"}), 500

    return app


def run_app() -> None:
    app = create_app()
    host = "127.0.0.1"
    port = 5000
    url = f"http://{host}:{port}"

    def open_browser_later() -> None:
        time.sleep(1.2)
        webbrowser.open(url)

    threading.Thread(target=open_browser_later, daemon=True).start()
    app.run(host=host, port=port, debug=False, use_reloader=False)


if __name__ == "__main__":
    run_app()
