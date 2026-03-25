from __future__ import annotations

import io
import re
import sqlite3
import tempfile
import threading
import time
import webbrowser
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


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def list_tables() -> list[str]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
    return [r["name"] for r in rows]


def get_columns(table: str) -> list[str]:
    with get_conn() as conn:
        rows = conn.execute(f"PRAGMA table_info({_quote_ident(table)})").fetchall()
    return [r["name"] for r in rows]


def delete_table(table: str) -> None:
    tables = list_tables()
    if table not in tables:
        raise ValueError("table not found")
    with get_conn() as conn:
        conn.execute(f"DROP TABLE {_quote_ident(table)}")
        conn.commit()


def import_excel_to_sqlite(file_stream: io.BytesIO) -> dict[str, Any]:
    xls = pd.ExcelFile(file_stream, engine="openpyxl")
    created: list[dict[str, str]] = []
    used_names: set[str] = set(list_tables())

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
            created.append({"sheet": sheet, "table": table_name})

    return {"created": created, "count": len(created)}


def build_where_clause(
    columns: list[str],
    global_keyword: str,
    single_field: str,
    single_keyword: str,
    field_filters: dict[str, str],
) -> tuple[str, list[str]]:
    where_parts: list[str] = []
    params: list[str] = []

    if global_keyword:
        like = f"%{global_keyword}%"
        sub_parts = []
        for col in columns:
            sub_parts.append(f"CAST({_quote_ident(col)} AS TEXT) LIKE ?")
            params.append(like)
        if sub_parts:
            where_parts.append("(" + " OR ".join(sub_parts) + ")")

    if single_field and single_keyword and single_field in columns:
        where_parts.append(f"CAST({_quote_ident(single_field)} AS TEXT) LIKE ?")
        params.append(f"%{single_keyword}%")

    for key, value in field_filters.items():
        if value and key in columns:
            where_parts.append(f"CAST({_quote_ident(key)} AS TEXT) LIKE ?")
            params.append(f"%{value}%")

    if not where_parts:
        return "", params
    return " WHERE " + " AND ".join(where_parts), params


def build_order_clause(columns: list[str], sort_field: str, sort_order: str) -> str:
    if sort_field not in columns:
        return ""
    direction = "DESC" if (sort_order or "").lower() == "desc" else "ASC"
    return f" ORDER BY {_quote_ident(sort_field)} {direction}"


def apply_hidden_columns(all_columns: list[str], hidden_columns: list[str]) -> list[str]:
    hidden_set = {c for c in hidden_columns if c in all_columns}
    return [c for c in all_columns if c not in hidden_set]


def query_table(
    table: str,
    page: int,
    page_size: int,
    global_keyword: str,
    single_field: str,
    single_keyword: str,
    field_filters: dict[str, str],
    sort_field: str,
    sort_order: str,
    hidden_columns: list[str],
) -> dict[str, Any]:
    tables = list_tables()
    if table not in tables:
        raise ValueError("table not found")

    all_columns = get_columns(table)
    query_columns = apply_hidden_columns(all_columns, hidden_columns)
    if not query_columns:
        raise ValueError("all columns are hidden")

    where_clause, params = build_where_clause(
        query_columns, global_keyword, single_field, single_keyword, field_filters
    )
    order_clause = build_order_clause(query_columns, sort_field, sort_order)
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
    single_field: str,
    single_keyword: str,
    field_filters: dict[str, str],
    sort_field: str,
    sort_order: str,
    hidden_columns: list[str],
) -> tuple[list[str], list[dict[str, Any]]]:
    tables = list_tables()
    if table not in tables:
        raise ValueError("table not found")

    all_columns = get_columns(table)
    query_columns = apply_hidden_columns(all_columns, hidden_columns)
    if not query_columns:
        raise ValueError("all columns are hidden")

    where_clause, params = build_where_clause(
        query_columns, global_keyword, single_field, single_keyword, field_filters
    )
    order_clause = build_order_clause(query_columns, sort_field, sort_order)
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

    columns, rows = fetch_all_rows_for_export(
        table=table,
        global_keyword=payload.get("global_keyword", "").strip(),
        single_field=payload.get("single_field", "").strip(),
        single_keyword=payload.get("single_keyword", "").strip(),
        field_filters=payload.get("field_filters") or {},
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

    @app.get("/")
    def index() -> str:
        return render_template("index.html")

    @app.get("/api/tables")
    def api_tables():
        return jsonify({"tables": list_tables()})

    @app.get("/api/table/<table>/columns")
    def api_columns(table: str):
        tables = list_tables()
        if table not in tables:
            return jsonify({"error": "table not found"}), 404
        return jsonify({"columns": get_columns(table)})

    @app.delete("/api/table/<table>")
    def api_delete_table(table: str):
        try:
            delete_table(table)
            return jsonify({"deleted": table})
        except ValueError as ex:
            return jsonify({"error": str(ex)}), 404
        except Exception as ex:
            return jsonify({"error": f"删除失败: {ex}"}), 500

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

        try:
            result = query_table(
                table=table,
                page=int(payload.get("page", 1)),
                page_size=int(payload.get("page_size", DEFAULT_PAGE_SIZE)),
                global_keyword=(payload.get("global_keyword") or "").strip(),
                single_field=(payload.get("single_field") or "").strip(),
                single_keyword=(payload.get("single_keyword") or "").strip(),
                field_filters=payload.get("field_filters") or {},
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
