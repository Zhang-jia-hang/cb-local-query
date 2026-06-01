# 兼容Python 3.x低版本的注解语法
from __future__ import annotations

# 标准库导入：IO、正则、SQLite、临时文件、线程、时间、浏览器、日期、路径、类型注解
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

# 第三方库：数据处理、Web框架
import pandas as pd
from flask import Flask, jsonify, render_template, request, send_file

# ===================== 全局路径与常量配置 =====================
# 获取当前文件所在的根目录
BASE_DIR = Path(__file__).resolve().parent
# 数据存储目录
DATA_DIR = BASE_DIR / "data"
# 自动创建目录（已存在则不报错）
DATA_DIR.mkdir(parents=True, exist_ok=True)
# SQLite数据库文件路径
DB_PATH = DATA_DIR / "app.db"
# 默认分页大小
DEFAULT_PAGE_SIZE = 20
# 最大允许分页大小
MAX_PAGE_SIZE = 200

# 系统内置表名（用于存储元数据，非用户数据表）
META_TABLE = "__table_meta"        # 数据表元信息
FOLDER_TABLE = "__folder_meta"     # 文件夹目录信息
COLUMN_META_TABLE = "__column_meta" # 列元信息（是否数值类型）
SYSTEM_TABLES = {META_TABLE, FOLDER_TABLE, COLUMN_META_TABLE}

# 正则：只保留字母、数字、下划线、中文，用于规范化表名/列名
_IDENTIFIER_SAFE_RE = re.compile(r"[^0-9A-Za-z_\u4e00-\u9fff]")

# ===================== 工具函数：名称规范化 =====================
def _normalize_identifier(raw: str, fallback: str) -> str:
    """
    规范化表名/列名：去除特殊字符、空格转下划线、处理重名、数字开头加前缀
    :param raw: 原始名称
    :param fallback: 为空时的默认名称
    :return: 安全可用的SQL标识符
    """
    text = (raw or "").strip()
    if not text:
        return fallback
    # 空格转下划线
    text = text.replace(" ", "_")
    # 非法字符替换为下划线
    text = _IDENTIFIER_SAFE_RE.sub("_", text)
    # 多个下划线合并为一个，去除首尾下划线
    text = re.sub(r"_+", "_", text).strip("_")
    if not text:
        return fallback
    # 数字开头则添加 t_ 前缀，避免SQL语法错误
    if text[0].isdigit():
        text = f"t_{text}"
    return text

def _quote_ident(name: str) -> str:
    """给SQL标识符加双引号，防止关键字冲突、支持中文表名/列名"""
    return '"' + name.replace('"', '""') + '"'

def normalize_folder_path(path: str) -> str:
    """规范化文件夹路径：统一为/分隔、去除多余斜杠、首尾无斜杠"""
    text = (path or "").strip().replace("\\", "/")
    text = re.sub(r"/+", "/", text).strip("/")
    return text

def now_str() -> str:
    """获取当前时间字符串：YYYY-MM-DD HH:MM:SS"""
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

# ===================== 数据库连接 =====================
def get_conn() -> sqlite3.Connection:
    """创建并返回SQLite连接，行数据以字典形式返回"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

# ===================== 系统表初始化 =====================
def create_system_tables() -> None:
    """创建三张系统元数据表（不存在则创建）"""
    with get_conn() as conn:
        # 表元信息
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
        # 文件夹目录
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {FOLDER_TABLE} (
                folder_path TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                is_deleted INTEGER NOT NULL DEFAULT 0,
                deleted_at TEXT
            )
            """
        )
        # 列元数据（是否数值列）
        conn.execute(
            f"""
            CREATE TABLE IF NOT EXISTS {COLUMN_META_TABLE} (
                table_name TEXT NOT NULL,
                column_name TEXT NOT NULL,
                is_numeric INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL,
                PRIMARY KEY (table_name, column_name)
            )
            """
        )
        folder_cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({FOLDER_TABLE})").fetchall()}
        if "is_deleted" not in folder_cols:
            conn.execute(f"ALTER TABLE {FOLDER_TABLE} ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0")
        if "deleted_at" not in folder_cols:
            conn.execute(f"ALTER TABLE {FOLDER_TABLE} ADD COLUMN deleted_at TEXT")
        conn.commit()

# ===================== 表同步与元数据维护 =====================
def list_physical_tables() -> list[str]:
    """查询SQLite中真实存在的用户数据表（排除系统表）"""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
    return [r["name"] for r in rows if r["name"] not in SYSTEM_TABLES]

def sync_table_metadata() -> None:
    """
    同步数据库表与元数据：
    1. 新增物理表 → 补充元数据
    2. 物理表已删除 → 删除对应元数据
    保持界面显示与真实库一致
    """
    physical = set(list_physical_tables())
    now = now_str()

    with get_conn() as conn:
        meta_rows = conn.execute(f"SELECT table_name FROM {META_TABLE}").fetchall()
        meta_names = {r["table_name"] for r in meta_rows}

        # 新增表：插入元数据
        for t in sorted(physical - meta_names):
            conn.execute(
                f"INSERT INTO {META_TABLE} (table_name, display_name, folder_path, is_deleted, deleted_at, created_at) VALUES (?, ?, '', 0, NULL, ?)",
                (t, t, now),
            )

        # 无效表：清理元数据
        stale = sorted(meta_names - physical)
        for t in stale:
            conn.execute(f"DELETE FROM {META_TABLE} WHERE table_name = ?", (t,))
            conn.execute(f"DELETE FROM {COLUMN_META_TABLE} WHERE table_name = ?", (t,))

        folder_cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({FOLDER_TABLE})").fetchall()}
        if "is_deleted" not in folder_cols:
            conn.execute(f"ALTER TABLE {FOLDER_TABLE} ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0")
        if "deleted_at" not in folder_cols:
            conn.execute(f"ALTER TABLE {FOLDER_TABLE} ADD COLUMN deleted_at TEXT")
        conn.commit()

def ensure_ready() -> None:
    """确保系统表创建完成、元数据同步完成（入口初始化）"""
    create_system_tables()
    sync_table_metadata()

# ===================== 表/文件夹基础操作 =====================
def get_table_record(table_name: str) -> dict[str, Any] | None:
    """根据表名获取表元数据记录"""
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
    """获取表列表（默认不包含已软删除）"""
    ensure_ready()
    sql = f"SELECT table_name, display_name, folder_path, is_deleted, deleted_at, created_at FROM {META_TABLE}"
    params: list[Any] = []
    if not include_deleted:
        sql += " WHERE is_deleted = 0"
    sql += " ORDER BY folder_path, display_name"

    with get_conn() as conn:
        rows = conn.execute(sql, params).fetchall()

    return [dict(r) for r in rows]

def list_folders(include_deleted: bool = False) -> list[str]:
    """获取文件夹路径列表（默认不包含已删除文件夹）"""
    ensure_ready()
    sql = f"SELECT folder_path FROM {FOLDER_TABLE}"
    if not include_deleted:
        sql += " WHERE is_deleted = 0"
    sql += " ORDER BY folder_path"
    with get_conn() as conn:
        rows = conn.execute(sql).fetchall()
    return [r["folder_path"] for r in rows]

def ensure_folder(path: str) -> None:
    """
    确保多级文件夹路径存在（自动创建父级），若目录在回收站中则一并恢复。
    例如传入 a/b/c → 自动创建 a、a/b、a/b/c
    """
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
                f"INSERT OR IGNORE INTO {FOLDER_TABLE} (folder_path, created_at, is_deleted, deleted_at) VALUES (?, ?, 0, NULL)",
                (curr, now),
            )
            conn.execute(
                f"UPDATE {FOLDER_TABLE} SET is_deleted = 0, deleted_at = NULL WHERE folder_path = ?",
                (curr,),
            )
        conn.commit()

def create_folder(path: str) -> str:
    """创建文件夹（对外接口）"""
    normalized = normalize_folder_path(path)
    if not normalized:
        raise ValueError("invalid folder path")
    ensure_folder(normalized)
    return normalized


def _folder_descendant_pattern(path: str) -> str:
    return f"{path}/%"


def _folder_path_matches_sql() -> str:
    return "(folder_path = ? OR folder_path LIKE ?)"


def rename_folder(old_path: str, new_path: str) -> str:
    """重命名文件夹，同时级联更新其子文件夹和表归属路径。"""
    old_norm = normalize_folder_path(old_path)
    new_norm = normalize_folder_path(new_path)
    if not old_norm:
        raise ValueError("invalid source folder path")
    if not new_norm:
        raise ValueError("invalid target folder path")
    if old_norm == new_norm:
        return new_norm
    if new_norm.startswith(old_norm + "/"):
        raise ValueError("target folder cannot be inside source folder")

    ensure_ready()
    with get_conn() as conn:
        existing = conn.execute(
            f"SELECT folder_path, created_at FROM {FOLDER_TABLE} WHERE {_folder_path_matches_sql()} AND is_deleted = 0 ORDER BY folder_path",
            (old_norm, _folder_descendant_pattern(old_norm)),
        ).fetchall()
        if not existing:
            raise ValueError("folder not found")

        ensure_folder("/".join(new_norm.split("/")[:-1]))

        affected = [(r["folder_path"], r["created_at"]) for r in existing]
        transformed = {old: new_norm + old[len(old_norm):] for old, _created in affected}

        conflicts = conn.execute(
            f"SELECT folder_path FROM {FOLDER_TABLE} WHERE {_folder_path_matches_sql()} AND is_deleted = 0",
            (new_norm, _folder_descendant_pattern(new_norm)),
        ).fetchall()
        conflict_paths = {r["folder_path"] for r in conflicts}
        if any(path not in transformed for path in conflict_paths):
            raise ValueError("target folder already exists")

        table_rows = conn.execute(
            f"SELECT table_name, folder_path FROM {META_TABLE} WHERE {_folder_path_matches_sql()}",
            (old_norm, _folder_descendant_pattern(old_norm)),
        ).fetchall()

        conn.executemany(
            f"DELETE FROM {FOLDER_TABLE} WHERE folder_path = ?",
            [(old,) for old, _created in reversed(affected)],
        )
        conn.executemany(
            f"INSERT OR REPLACE INTO {FOLDER_TABLE} (folder_path, created_at, is_deleted, deleted_at) VALUES (?, ?, 0, NULL)",
            [(transformed[old], created) for old, created in affected],
        )

        for row in table_rows:
            new_folder = new_norm + row["folder_path"][len(old_norm):]
            conn.execute(
                f"UPDATE {META_TABLE} SET folder_path = ? WHERE table_name = ?",
                (new_folder, row["table_name"]),
            )

        conn.commit()

    return new_norm


def get_folder_summary(path: str, include_deleted: bool = False) -> dict[str, Any]:
    """获取文件夹子树摘要，用于删除提示和回收站展示。"""
    normalized = normalize_folder_path(path)
    if not normalized:
        raise ValueError("invalid folder path")

    ensure_ready()
    with get_conn() as conn:
        folder_sql = f"SELECT folder_path FROM {FOLDER_TABLE} WHERE {_folder_path_matches_sql()}"
        table_sql = f"SELECT table_name, display_name, folder_path FROM {META_TABLE} WHERE {_folder_path_matches_sql()}"
        params = (normalized, _folder_descendant_pattern(normalized))
        if not include_deleted:
            folder_sql += " AND is_deleted = 0"
            table_sql += " AND is_deleted = 0"
        folder_sql += " ORDER BY folder_path"
        table_sql += " ORDER BY folder_path, display_name"
        folder_rows = conn.execute(folder_sql, params).fetchall()
        table_rows = conn.execute(table_sql, params).fetchall()

    if not folder_rows:
        raise ValueError("folder not found")

    return {
        "folder_path": normalized,
        "folders": [r["folder_path"] for r in folder_rows],
        "tables": [dict(r) for r in table_rows],
        "folder_count": len(folder_rows),
        "table_count": len(table_rows),
    }


def list_recycle_folders() -> list[dict[str, Any]]:
    """获取回收站中的顶级已删除文件夹及其摘要。"""
    ensure_ready()
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT folder_path, deleted_at FROM {FOLDER_TABLE} WHERE is_deleted = 1 ORDER BY folder_path"
        ).fetchall()

    deleted_paths = {r["folder_path"] for r in rows}
    root_rows = []
    for row in rows:
        parts = row["folder_path"].split("/")
        has_deleted_parent = any("/".join(parts[:i]) in deleted_paths for i in range(1, len(parts)))
        if not has_deleted_parent:
            root_rows.append(row)

    items: list[dict[str, Any]] = []
    for row in root_rows:
        summary = get_folder_summary(row["folder_path"], include_deleted=True)
        items.append(
            {
                "folder_path": row["folder_path"],
                "deleted_at": row["deleted_at"],
                "folder_count": summary["folder_count"],
                "table_count": summary["table_count"],
                "folders": summary["folders"],
                "tables": summary["tables"],
            }
        )
    return items


def delete_folder(path: str) -> dict[str, Any]:
    """软删除文件夹子树：目录移出左侧列表，目录中的表进入回收站。"""
    summary = get_folder_summary(path, include_deleted=False)
    normalized = summary["folder_path"]
    now = now_str()

    with get_conn() as conn:
        params = (normalized, _folder_descendant_pattern(normalized))
        conn.execute(
            f"UPDATE {FOLDER_TABLE} SET is_deleted = 1, deleted_at = ? WHERE {_folder_path_matches_sql()} AND is_deleted = 0",
            (now, *params),
        )
        conn.execute(
            f"UPDATE {META_TABLE} SET is_deleted = 1, deleted_at = ? WHERE {_folder_path_matches_sql()} AND is_deleted = 0",
            (now, *params),
        )
        conn.commit()

    return summary


def restore_folder(path: str) -> dict[str, Any]:
    """从回收站恢复整个文件夹子树及其中已删除的数据表。"""
    summary = get_folder_summary(path, include_deleted=True)
    normalized = summary["folder_path"]
    with get_conn() as conn:
        params = (normalized, _folder_descendant_pattern(normalized))
        conn.execute(
            f"UPDATE {FOLDER_TABLE} SET is_deleted = 0, deleted_at = NULL WHERE {_folder_path_matches_sql()}",
            params,
        )
        conn.execute(
            f"UPDATE {META_TABLE} SET is_deleted = 0, deleted_at = NULL WHERE {_folder_path_matches_sql()} AND is_deleted = 1",
            params,
        )
        conn.commit()
    ensure_folder(normalized)
    return summary


def purge_folder(path: str) -> dict[str, Any]:
    """彻底删除回收站中的文件夹子树及其中所有已删除表。"""
    summary = get_folder_summary(path, include_deleted=True)
    normalized = summary["folder_path"]
    with get_conn() as conn:
        params = (normalized, _folder_descendant_pattern(normalized))
        folders = conn.execute(
            f"SELECT folder_path FROM {FOLDER_TABLE} WHERE {_folder_path_matches_sql()} AND is_deleted = 1 ORDER BY folder_path DESC",
            params,
        ).fetchall()
        tables = conn.execute(
            f"SELECT table_name FROM {META_TABLE} WHERE {_folder_path_matches_sql()} AND is_deleted = 1",
            params,
        ).fetchall()
        for row in tables:
            table_name = row["table_name"]
            conn.execute(f"DROP TABLE IF EXISTS {_quote_ident(table_name)}")
            conn.execute(f"DELETE FROM {META_TABLE} WHERE table_name = ?", (table_name,))
            conn.execute(f"DELETE FROM {COLUMN_META_TABLE} WHERE table_name = ?", (table_name,))
        for row in folders:
            conn.execute(f"DELETE FROM {FOLDER_TABLE} WHERE folder_path = ?", (row["folder_path"],))
        conn.commit()
    return summary


def purge_recycle_bin() -> dict[str, int]:
    """清空回收站中的所有已删除文件夹和数据表。"""
    ensure_ready()
    recycle_folders = list_recycle_folders()
    purged_folder_count = 0
    purged_table_count = 0

    for item in recycle_folders:
        summary = purge_folder(item["folder_path"])
        purged_folder_count += int(summary.get("folder_count", 0))
        purged_table_count += int(summary.get("table_count", 0))

    deleted_tables = [x for x in list_tables(include_deleted=True) if int(x.get("is_deleted", 0)) == 1]
    for item in deleted_tables:
        purge_table(item["table_name"])
        purged_table_count += 1

    return {"folder_count": purged_folder_count, "table_count": purged_table_count}
def rename_table_display(table_name: str, new_name: str) -> None:
    """修改表的显示名称（不修改物理表名）"""
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
    """移动表到指定文件夹"""
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

# ===================== 表删除/恢复/彻底删除 =====================
def soft_delete_table(table_name: str) -> None:
    """软删除：标记删除，不删除物理表"""
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
    """从回收站恢复表，同时确保所属文件夹重新可见。"""
    record = get_table_record(table_name)
    if not record:
        raise ValueError("table not found")

    with get_conn() as conn:
        conn.execute(
            f"UPDATE {META_TABLE} SET is_deleted = 0, deleted_at = NULL WHERE table_name = ?",
            (table_name,),
        )
        conn.commit()

    ensure_folder(record.get("folder_path") or "")

def purge_table(table_name: str) -> None:
    """彻底删除表：删除物理表 + 删除所有元数据"""
    record = get_table_record(table_name)
    if not record:
        raise ValueError("table not found")

    with get_conn() as conn:
        conn.execute(f"DROP TABLE IF EXISTS {_quote_ident(table_name)}")
        conn.execute(f"DELETE FROM {META_TABLE} WHERE table_name = ?", (table_name,))
        conn.execute(f"DELETE FROM {COLUMN_META_TABLE} WHERE table_name = ?", (table_name,))
        conn.commit()

# ===================== 列信息与数值列识别 =====================
def get_columns(table_name: str) -> list[str]:
    """获取表的所有列名"""
    with get_conn() as conn:
        rows = conn.execute(f"PRAGMA table_info({_quote_ident(table_name)})").fetchall()
    return [r["name"] for r in rows]

def _is_numeric_series(series: pd.Series) -> bool:
    """判断Pandas列是否为纯数值（无无效值）"""
    cleaned = series.dropna()
    if cleaned.empty:
        return False
    parsed = pd.to_numeric(cleaned, errors="coerce")
    return bool(parsed.notna().all())

def _save_column_meta(
    conn: sqlite3.Connection,
    table_name: str,
    columns: list[str],
    numeric_columns: set[str],
    created_at: str,
) -> None:
    """保存列元数据：标记哪些列是数值类型"""
    conn.execute(f"DELETE FROM {COLUMN_META_TABLE} WHERE table_name = ?", (table_name,))
    conn.executemany(
        f"INSERT INTO {COLUMN_META_TABLE} (table_name, column_name, is_numeric, created_at) VALUES (?, ?, ?, ?)",
        [(table_name, c, 1 if c in numeric_columns else 0, created_at) for c in columns],
    )

def _infer_numeric_columns_from_table(table_name: str, columns: list[str]) -> set[str]:
    """从表数据中抽样推断哪些列是数值列"""
    numeric: set[str] = set()
    if not columns:
        return numeric

    with get_conn() as conn:
        for col in columns:
            rows = conn.execute(
                f"SELECT {_quote_ident(col)} AS v FROM {_quote_ident(table_name)} WHERE TRIM(CAST({_quote_ident(col)} AS TEXT)) <> '' LIMIT 1000"
            ).fetchall()
            if not rows:
                continue
            values = [r["v"] for r in rows]
            if all(_to_float(v) is not None for v in values):
                numeric.add(col)
    return numeric

def get_numeric_columns(table_name: str, columns: list[str] | None = None) -> set[str]:
    """
    获取表的数值列：
    1. 优先读元数据
    2. 无元数据则自动推断并保存
    """
    ensure_ready()
    cols = columns or get_columns(table_name)
    if not cols:
        return set()

    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT column_name, is_numeric FROM {COLUMN_META_TABLE} WHERE table_name = ?",
            (table_name,),
        ).fetchall()
        if rows:
            known = {r["column_name"] for r in rows if int(r["is_numeric"]) == 1}
            return {c for c in known if c in cols}

    inferred = _infer_numeric_columns_from_table(table_name, cols)
    with get_conn() as conn:
        _save_column_meta(conn, table_name, cols, inferred, now_str())
        folder_cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({FOLDER_TABLE})").fetchall()}
        if "is_deleted" not in folder_cols:
            conn.execute(f"ALTER TABLE {FOLDER_TABLE} ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0")
        if "deleted_at" not in folder_cols:
            conn.execute(f"ALTER TABLE {FOLDER_TABLE} ADD COLUMN deleted_at TEXT")
        conn.commit()
    return inferred


def make_unique_display_name(base_name: str, used_names: set[str]) -> str:
    """为导入后的显示名生成唯一后缀，避免左侧列表出现重名。"""
    text = (base_name or "").strip() or "未命名表"
    candidate = text
    index = 1
    while candidate in used_names:
        index += 1
        candidate = f"{text}_{index}"
    used_names.add(candidate)
    return candidate
# ===================== Excel 导入 =====================
def import_excel_to_sqlite(file_stream: io.BytesIO, folder_path: str = "") -> dict[str, Any]:
    """
    导入Excel文件到SQLite：
    1. 每个sheet → 一张表
    2. 自动规范化表名、列名（去重、安全字符）
    3. 自动识别数值列
    4. 写入元数据
    """
    ensure_ready()
    xls = pd.ExcelFile(file_stream, engine="openpyxl")
    created: list[dict[str, str]] = []
    used_names: set[str] = set(list_physical_tables())
    target_folder = normalize_folder_path(folder_path)
    now = now_str()

    if target_folder:
        ensure_folder(target_folder)

    with get_conn() as conn:
        used_display_names = {r["display_name"] for r in conn.execute(f"SELECT display_name FROM {META_TABLE}").fetchall()}

        for idx, sheet in enumerate(xls.sheet_names, start=1):
            fallback = f"sheet_{idx}"
            table_name = _normalize_identifier(sheet, fallback)
            original_name = table_name
            display_name = make_unique_display_name(sheet, used_display_names)
            suffix = 1
            # 处理与现有表名、同次导入工作表名的冲突，生成唯一表名。
            while table_name in used_names:
                suffix += 1
                table_name = f"{original_name}_{suffix}"

            df = pd.read_excel(xls, sheet_name=sheet)
            src_columns = list(df.columns)
            src_numeric_flags = [_is_numeric_series(df[c]) for c in src_columns]
            df = df.fillna("")

            cols: list[str] = []
            numeric_cols: set[str] = set()
            seen_cols: set[str] = set()
            # 列名规范化 + 去重
            for cidx, col in enumerate(src_columns, start=1):
                col_name = _normalize_identifier(str(col), f"col_{cidx}")
                candidate = col_name
                csuffix = 1
                while candidate in seen_cols:
                    csuffix += 1
                    candidate = f"{col_name}_{csuffix}"
                seen_cols.add(candidate)
                cols.append(candidate)
                if src_numeric_flags[cidx - 1]:
                    numeric_cols.add(candidate)

            df.columns = cols
            df.to_sql(table_name, conn, if_exists="replace", index=False)
            used_names.add(table_name)

            # 更新表元数据
            conn.execute(
                f"INSERT OR REPLACE INTO {META_TABLE} (table_name, display_name, folder_path, is_deleted, deleted_at, created_at) VALUES (?, ?, ?, 0, NULL, COALESCE((SELECT created_at FROM {META_TABLE} WHERE table_name = ?), ?))",
                (table_name, display_name, target_folder, table_name, now),
            )
            _save_column_meta(conn, table_name, cols, numeric_cols, now)
            created.append({"sheet": sheet, "table": table_name, "display_name": display_name})

        folder_cols = {r["name"] for r in conn.execute(f"PRAGMA table_info({FOLDER_TABLE})").fetchall()}
        if "is_deleted" not in folder_cols:
            conn.execute(f"ALTER TABLE {FOLDER_TABLE} ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0")
        if "deleted_at" not in folder_cols:
            conn.execute(f"ALTER TABLE {FOLDER_TABLE} ADD COLUMN deleted_at TEXT")
        conn.commit()

    return {"created": created, "count": len(created)}


def _normalize_excel_column_names(src_columns: list[Any]) -> list[str]:
    """将 Excel 表头规范化为列名（与导入逻辑一致，含同表头去重后缀）。"""
    cols: list[str] = []
    seen_cols: set[str] = set()
    for cidx, col in enumerate(src_columns, start=1):
        col_name = _normalize_identifier(str(col), f"col_{cidx}")
        candidate = col_name
        csuffix = 1
        while candidate in seen_cols:
            csuffix += 1
            candidate = f"{col_name}_{csuffix}"
        seen_cols.add(candidate)
        cols.append(candidate)
    return cols


def append_excel_to_table(table_name: str, file_stream: io.BytesIO, sheet_name: str | None = None) -> dict[str, Any]:
    """
    向已有表追加 Excel 数据：
    1. 表头经规范化后须与目标表列名集合完全一致
    2. 仅追加行，不修改表结构
    """
    assert_active_table(table_name)
    existing_cols = get_columns(table_name)
    if not existing_cols:
        raise ValueError("目标表没有可用列")

    xls = pd.ExcelFile(file_stream, engine="openpyxl")
    if not xls.sheet_names:
        raise ValueError("Excel 文件中没有工作表")

    target_sheet = (sheet_name or "").strip()
    if target_sheet:
        if target_sheet not in xls.sheet_names:
            raise ValueError(f"未找到工作表: {target_sheet}")
    else:
        target_sheet = xls.sheet_names[0]

    df = pd.read_excel(xls, sheet_name=target_sheet)
    if df.empty:
        raise ValueError("追加文件没有数据行")

    src_columns = list(df.columns)
    normalized_cols = _normalize_excel_column_names(src_columns)
    existing_set = set(existing_cols)

    if set(normalized_cols) != existing_set:
        missing = sorted(existing_set - set(normalized_cols))
        extra = sorted(set(normalized_cols) - existing_set)
        parts: list[str] = []
        if missing:
            parts.append(f"缺少列: {', '.join(missing)}")
        if extra:
            parts.append(f"多余列: {', '.join(extra)}")
        detail = "；".join(parts) if parts else "列名不一致"
        raise ValueError(f"表头与目标表不一致，{detail}")

    if len(normalized_cols) != len(existing_cols):
        raise ValueError("表头列数与目标表不一致，请检查是否存在重复列名")

    src_numeric_flags = [_is_numeric_series(df[c]) for c in src_columns]
    df = df.fillna("")
    df.columns = normalized_cols
    df = df[existing_cols]

    numeric_cols = {c for c, is_num in zip(existing_cols, src_numeric_flags) if is_num}
    now = now_str()

    with get_conn() as conn:
        before_count = conn.execute(
            f"SELECT COUNT(1) AS c FROM {_quote_ident(table_name)}"
        ).fetchone()["c"]
        df.to_sql(table_name, conn, if_exists="append", index=False)
        after_count = conn.execute(
            f"SELECT COUNT(1) AS c FROM {_quote_ident(table_name)}"
        ).fetchone()["c"]

        known_numeric = get_numeric_columns(table_name, existing_cols)
        merged_numeric = known_numeric | numeric_cols
        if not merged_numeric:
            merged_numeric = _infer_numeric_columns_from_table(table_name, existing_cols)
        else:
            inferred = _infer_numeric_columns_from_table(table_name, existing_cols)
            merged_numeric |= inferred
        _save_column_meta(conn, table_name, existing_cols, merged_numeric, now)
        conn.commit()

    appended_rows = int(after_count) - int(before_count)
    return {
        "table": table_name,
        "sheet": target_sheet,
        "appended_rows": appended_rows,
        "total_rows": int(after_count),
    }


# ===================== 查询构建工具 =====================
def apply_hidden_columns(all_columns: list[str], hidden_columns: list[str]) -> list[str]:
    """过滤隐藏列，返回前端可见列"""
    hidden_set = {c for c in hidden_columns if c in all_columns}
    return [c for c in all_columns if c not in hidden_set]

def build_global_clause(columns: list[str], global_keyword: str) -> tuple[str, list[Any]]:
    """构建全局搜索条件：所有列模糊匹配关键词"""
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
    """安全转为浮点数，失败返回None"""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return float(text)
    except Exception:
        return None

def build_conditions_clause(
    columns: list[str],
    numeric_columns: set[str],
    conditions: list[dict[str, Any]],
) -> tuple[str, list[Any]]:
    """
    构建高级查询条件：
    - 文本：模糊匹配
    - 数值：范围查询
    支持 AND/OR 组合
    """
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

        # 数值范围
        if ctype == "range":
            if field not in numeric_columns:
                raise ValueError(f"范围查询字段必须为数值类型: {field}")
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
        # 文本模糊
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
            # 第一个条件前不拼接 AND/OR 连接符。
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
    """规范化排序规则，过滤无效列，提供默认排序"""
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
    """构建ORDER BY子句"""
    normalized = normalize_sort_rules(columns, sort_rules, fallback_field, fallback_order)
    if not normalized:
        return ""
    parts = [f"{_quote_ident(field)} {order}" for field, order in normalized]
    return " ORDER BY " + ", ".join(parts)


def build_where_clause(
    query_columns: list[str],
    numeric_columns: set[str],
    global_keyword: str,
    conditions: list[dict[str, Any]],
) -> tuple[str, list[Any]]:
    """
    整合WHERE条件：
    全局搜索 + 高级条件 → 用AND连接
    """
    global_expr, global_params = build_global_clause(query_columns, global_keyword)
    cond_expr, cond_params = build_conditions_clause(query_columns, numeric_columns, conditions)

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
    """断言表存在且未被软删除"""
    record = get_table_record(table_name)
    if not record:
        raise ValueError("table not found")
    if int(record.get("is_deleted", 0)) == 1:
        raise ValueError("table is in recycle bin")
    return record

# ===================== 数据查询与分页 =====================
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
    """
    数据表分页查询：
    支持搜索、筛选、排序、隐藏列、分页
    返回列名、数据、总数、页码信息
    """
    assert_active_table(table)

    all_columns = get_columns(table)
    query_columns = apply_hidden_columns(all_columns, hidden_columns)
    if not query_columns:
        raise ValueError("all columns are hidden")
    numeric_columns = get_numeric_columns(table, all_columns)

    where_clause, params = build_where_clause(query_columns, numeric_columns, global_keyword, conditions)
    order_clause = build_order_clause(query_columns, sort_rules, sort_field, sort_order)
    select_clause = ", ".join(_quote_ident(c) for c in query_columns)

    # 安全分页参数
    safe_page = max(1, page)
    safe_size = min(MAX_PAGE_SIZE, max(1, page_size))
    # 使用 LIMIT/OFFSET 分页，保证翻页行为稳定。
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

# ===================== 导出数据 =====================
def fetch_all_rows_for_export(
    table: str,
    global_keyword: str,
    conditions: list[dict[str, Any]],
    sort_rules: list[dict[str, Any]],
    sort_field: str,
    sort_order: str,
    hidden_columns: list[str],
) -> tuple[list[str], list[dict[str, Any]]]:
    """查询全部数据（不分页）用于导出"""
    assert_active_table(table)

    all_columns = get_columns(table)
    query_columns = apply_hidden_columns(all_columns, hidden_columns)
    if not query_columns:
        raise ValueError("all columns are hidden")
    numeric_columns = get_numeric_columns(table, all_columns)

    where_clause, params = build_where_clause(query_columns, numeric_columns, global_keyword, conditions)
    order_clause = build_order_clause(query_columns, sort_rules, sort_field, sort_order)
    select_clause = ", ".join(_quote_ident(c) for c in query_columns)

    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT {select_clause} FROM {_quote_ident(table)}{where_clause}{order_clause}",
            params,
        ).fetchall()

    return query_columns, [dict(r) for r in rows]


def export_query_to_excel(table: str, payload: dict[str, Any]) -> tuple[str, bytes]:
    """
    按查询条件导出Excel：
    支持隐藏列、筛选条件、排序
    返回文件名 + 文件字节流
    """
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

    # 按界面可见列导出
    visible_columns = payload.get("visible_columns") or []
    # 若前端传入可见列，则按当前界面可见列导出。
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

# ===================== Flask Web 应用 =====================
def create_app() -> Flask:
    """创建Flask应用，注册所有API路由"""
    app = Flask(__name__)
    ensure_ready()

    # 首页
    @app.get("/")
    def index() -> str:
        return render_template("index.html")

    # 获取表列表 + 文件夹列表
    @app.get("/api/tables")
    def api_tables():
        return jsonify({"tables": list_tables(include_deleted=False), "folders": list_folders()})

    # 回收站：已删除表 + 已删除文件夹
    @app.get("/api/recycle-bin")
    def api_recycle_bin():
        items = [x for x in list_tables(include_deleted=True) if int(x["is_deleted"]) == 1]
        folders = list_recycle_folders()
        return jsonify({"tables": items, "folders": folders})

    # 创建文件夹
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

    @app.patch("/api/folders/rename")
    def api_rename_folder():
        payload = request.get_json(silent=True) or {}
        old_path = payload.get("old_path") or ""
        new_path = payload.get("new_path") or ""
        try:
            folder = rename_folder(old_path, new_path)
            return jsonify({"folder": folder})
        except ValueError as ex:
            return jsonify({"error": str(ex)}), 400
        except Exception as ex:
            return jsonify({"error": f"文件夹重命名失败: {ex}"}), 500

    @app.delete("/api/folders")
    def api_delete_folder():
        payload = request.get_json(silent=True) or {}
        folder_path = payload.get("folder_path") or ""
        try:
            summary = delete_folder(folder_path)
            return jsonify({"deleted": folder_path, "summary": summary})
        except ValueError as ex:
            return jsonify({"error": str(ex)}), 400
        except Exception as ex:
            return jsonify({"error": f"文件夹删除失败: {ex}"}), 500

    @app.post("/api/folders/restore")
    def api_restore_folder():
        payload = request.get_json(silent=True) or {}
        folder_path = payload.get("folder_path") or ""
        try:
            summary = restore_folder(folder_path)
            return jsonify({"restored": folder_path, "summary": summary})
        except ValueError as ex:
            return jsonify({"error": str(ex)}), 400
        except Exception as ex:
            return jsonify({"error": f"文件夹恢复失败: {ex}"}), 500

    @app.delete("/api/folders/purge")
    def api_purge_folder():
        payload = request.get_json(silent=True) or {}
        folder_path = payload.get("folder_path") or ""
        try:
            summary = purge_folder(folder_path)
            return jsonify({"purged": folder_path, "summary": summary})
        except ValueError as ex:
            return jsonify({"error": str(ex)}), 400
        except Exception as ex:
            return jsonify({"error": f"文件夹彻底删除失败: {ex}"}), 500

    # 获取表的列 + 数值列
    @app.get("/api/table/<table>/columns")
    def api_columns(table: str):
        try:
            assert_active_table(table)
            cols = get_columns(table)
            numeric_cols = sorted(get_numeric_columns(table, cols))
            return jsonify({"columns": cols, "numeric_columns": numeric_cols})
        except ValueError as ex:
            return jsonify({"error": str(ex)}), 404

    # 重命名表显示名
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

    # 移动表到文件夹
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

    # 软删除表
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

    # 恢复表
    @app.post("/api/table/<table>/restore")
    def api_restore_table(table: str):
        try:
            restore_table(table)
            return jsonify({"restored": table})
        except ValueError as ex:
            return jsonify({"error": str(ex)}), 404
        except Exception as ex:
            return jsonify({"error": f"恢复失败: {ex}"}), 500

    # 彻底删除表
    @app.delete("/api/table/<table>/purge")
    def api_purge_table(table: str):
        try:
            purge_table(table)
            return jsonify({"purged": table})
        except ValueError as ex:
            return jsonify({"error": str(ex)}), 404
        except Exception as ex:
            return jsonify({"error": f"彻底删除失败: {ex}"}), 500


    @app.delete("/api/recycle-bin/purge-all")
    def api_purge_recycle_bin():
        try:
            summary = purge_recycle_bin()
            return jsonify(summary)
        except Exception as ex:
            return jsonify({"error": f"清空回收站失败: {ex}"}), 500
    # 向已有表追加 Excel 数据
    @app.post("/api/table/<table>/append-excel")
    def api_append_excel(table: str):
        if "file" not in request.files:
            return jsonify({"error": "missing file"}), 400
        file = request.files["file"]
        if not file.filename:
            return jsonify({"error": "invalid file"}), 400

        sheet_name = request.form.get("sheet_name", "").strip() or None
        content = io.BytesIO(file.read())
        try:
            summary = append_excel_to_table(table, content, sheet_name=sheet_name)
            return jsonify(summary)
        except ValueError as ex:
            return jsonify({"error": str(ex)}), 400
        except Exception as ex:
            return jsonify({"error": f"追加失败: {ex}"}), 500

    # 上传并导入Excel
    @app.post("/api/import-excel")
    def api_import_excel():
        if "file" not in request.files:
            return jsonify({"error": "missing file"}), 400
        file = request.files["file"]
        if not file.filename:
            return jsonify({"error": "invalid file"}), 400

        folder_path = request.form.get("folder_path", "")
        content = io.BytesIO(file.read())
        try:
            summary = import_excel_to_sqlite(content, folder_path=folder_path)
            return jsonify(summary)
        except Exception as ex:
            return jsonify({"error": f"导入失败: {ex}"}), 500
    # 数据查询（分页、搜索、筛选、排序）
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

    # 导出查询结果为Excel
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

# ===================== 启动应用 =====================
def run_app() -> None:
    """启动Flask服务，自动打开浏览器"""
    app = create_app()
    host = "127.0.0.1"
    port = 5000
    url = f"http://{host}:{port}"

    def open_browser_later() -> None:
        # 延迟打开浏览器，确保服务已启动
        time.sleep(1.2)
        webbrowser.open(url)

    threading.Thread(target=open_browser_later, daemon=True).start()
    app.run(host=host, port=port, debug=False, use_reloader=False)

# 主入口
if __name__ == "__main__":
    run_app()
