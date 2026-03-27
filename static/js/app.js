const state = {
  tables: [],
  recycleBin: [],
  folders: [],
  columns: [],
  hiddenColumnsByTable: {},
  currentTable: "",
  page: 1,
  totalPages: 1,
  total: 0,
  lastRows: [],
  lastColumns: [],
  querying: false,
};

const els = {
  excelFile: document.getElementById("excelFile"),
  importBtn: document.getElementById("importBtn"),
  importMsg: document.getElementById("importMsg"),
  tableList: document.getElementById("tableList"),
  recycleList: document.getElementById("recycleList"),
  tableCountBadge: document.getElementById("tableCountBadge"),
  newFolderPath: document.getElementById("newFolderPath"),
  createFolderBtn: document.getElementById("createFolderBtn"),

  currentTableTag: document.getElementById("currentTableTag"),
  currentFolderTag: document.getElementById("currentFolderTag"),
  statTotalCols: document.getElementById("statTotalCols"),
  statHiddenCols: document.getElementById("statHiddenCols"),
  statQueryableCols: document.getElementById("statQueryableCols"),

  globalKeyword: document.getElementById("globalKeyword"),
  pageSize: document.getElementById("pageSize"),

  sortRules: document.getElementById("sortRules"),
  addSortBtn: document.getElementById("addSortBtn"),

  hiddenColumns: document.getElementById("hiddenColumns"),
  hideSelectedBtn: document.getElementById("hideSelectedBtn"),
  unhideSelectedBtn: document.getElementById("unhideSelectedBtn"),
  clearHiddenBtn: document.getElementById("clearHiddenBtn"),
  hiddenMsg: document.getElementById("hiddenMsg"),

  addFilterBtn: document.getElementById("addFilterBtn"),
  filters: document.getElementById("filters"),

  searchBtn: document.getElementById("searchBtn"),
  resetBtn: document.getElementById("resetBtn"),
  exportBtn: document.getElementById("exportBtn"),

  queryMsg: document.getElementById("queryMsg"),
  resultTable: document.getElementById("resultTable"),
  prevBtn: document.getElementById("prevBtn"),
  nextBtn: document.getElementById("nextBtn"),
  pageInfo: document.getElementById("pageInfo"),
};

function setMessage(el, text, isError = false) {
  el.textContent = text || "";
  el.className = `text-sm mt-2 ${isError ? "text-red-600" : "text-slate-600"}`;
}

function setQueryBusy(busy) {
  state.querying = busy;
  els.searchBtn.disabled = busy;
  els.exportBtn.disabled = busy;
  els.prevBtn.disabled = busy;
  els.nextBtn.disabled = busy;
  els.searchBtn.textContent = busy ? "查询中..." : "查询";
}

function createOption(value, label) {
  const op = document.createElement("option");
  op.value = value;
  op.textContent = label;
  return op;
}

function clearTableView(message = "暂无数据") {
  els.resultTable.innerHTML = `<tr><td class='p-3'>${message}</td></tr>`;
  els.pageInfo.textContent = "";
}

function currentTableMeta() {
  return state.tables.find((t) => t.table_name === state.currentTable) || null;
}

function refreshHeaderTags() {
  const meta = currentTableMeta();
  els.currentTableTag.textContent = meta ? `当前表：${meta.display_name}` : "当前表：未选择";
  els.currentFolderTag.textContent = meta ? `文件夹：${meta.folder_path || "未分组"}` : "文件夹：-";
}

function getHiddenColumns() {
  const table = state.currentTable;
  if (!table) return [];
  if (!state.hiddenColumnsByTable[table]) state.hiddenColumnsByTable[table] = [];
  return state.hiddenColumnsByTable[table];
}

function setHiddenColumns(columns) {
  const table = state.currentTable;
  if (!table) return;
  const unique = [...new Set(columns.filter((c) => state.columns.includes(c)))];
  state.hiddenColumnsByTable[table] = unique;
}

function getQueryableColumns() {
  const hidden = new Set(getHiddenColumns());
  return state.columns.filter((c) => !hidden.has(c));
}

function refreshStats() {
  const total = state.columns.length;
  const hidden = getHiddenColumns().length;
  const queryable = getQueryableColumns().length;
  els.statTotalCols.textContent = `总字段：${total}`;
  els.statHiddenCols.textContent = `隐藏：${hidden}`;
  els.statQueryableCols.textContent = `可查询：${queryable}`;
}

function escapeHtml(val) {
  return String(val)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isFloatString(text) {
  return /^[-+]?\d*\.\d+(e[-+]?\d+)?$/i.test(text);
}

function toPercentText(num) {
  const scaled = num * 100;
  const rounded = Number(scaled.toFixed(2));
  return `${rounded.toFixed(2).replace(/\.?0+$/, "")}%`;
}

function formatDisplayValue(val) {
  if (val === null || val === undefined || val === "") return "";
  if (typeof val === "number") {
    if (Number.isFinite(val) && !Number.isInteger(val)) return toPercentText(val);
    return val;
  }

  const text = String(val).trim();
  if (!text) return "";
  if (isFloatString(text)) {
    const num = Number(text);
    if (Number.isFinite(num)) return toPercentText(num);
  }
  return val;
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  const contentType = res.headers.get("content-type") || "";
  if (!res.ok) {
    let msg = `请求失败(${res.status})`;
    if (contentType.includes("application/json")) {
      const data = await res.json();
      msg = data.error || msg;
    }
    throw new Error(msg);
  }
  if (contentType.includes("application/json")) return res.json();
  return null;
}

async function loadTableData() {
  const [tableData, recycleData] = await Promise.all([
    fetchJson("/api/tables"),
    fetchJson("/api/recycle-bin"),
  ]);

  state.tables = tableData.tables || [];
  state.folders = tableData.folders || [];
  state.recycleBin = recycleData.tables || [];

  if (!state.tables.find((t) => t.table_name === state.currentTable)) {
    state.currentTable = state.tables[0]?.table_name || "";
  }

  renderTableManager();
}

function renderTableManager() {
  els.tableCountBadge.textContent = String(state.tables.length);

  const groupMap = new Map();
  const root = "";
  groupMap.set(root, []);

  state.folders.forEach((f) => {
    if (!groupMap.has(f)) groupMap.set(f, []);
  });
  state.tables.forEach((t) => {
    const folder = t.folder_path || "";
    if (!groupMap.has(folder)) groupMap.set(folder, []);
    groupMap.get(folder).push(t);
  });

  const folders = Array.from(groupMap.keys()).sort((a, b) => {
    if (a === "") return -1;
    if (b === "") return 1;
    return a.localeCompare(b, "zh-CN");
  });

  els.tableList.innerHTML = "";
  if (!state.tables.length && folders.length <= 1) {
    els.tableList.innerHTML = "<p class='table-empty'>暂无数据表</p>";
  } else {
    folders.forEach((folder) => {
      const tables = groupMap.get(folder) || [];

      const group = document.createElement("div");
      group.className = "folder-group";

      const title = document.createElement("div");
      title.className = "folder-title";
      title.textContent = folder || "未分组";
      group.appendChild(title);

      if (!tables.length) {
        const empty = document.createElement("div");
        empty.className = "folder-empty";
        empty.textContent = "(空文件夹)";
        group.appendChild(empty);
      } else {
        tables
          .sort((a, b) => (a.display_name || "").localeCompare(b.display_name || "", "zh-CN"))
          .forEach((t) => group.appendChild(renderTableRow(t)));
      }

      els.tableList.appendChild(group);
    });
  }

  renderRecycleBin();
  refreshHeaderTags();
}

function renderTableRow(table) {
  const row = document.createElement("div");
  row.className = "table-manage-row";

  const selectBtn = document.createElement("button");
  selectBtn.type = "button";
  selectBtn.className = `table-item${state.currentTable === table.table_name ? " active" : ""}`;
  selectBtn.textContent = table.display_name;
  selectBtn.title = `${table.display_name} [${table.table_name}]`;
  selectBtn.onclick = async () => {
    state.currentTable = table.table_name;
    state.page = 1;
    renderTableManager();
    await loadColumns();
    await doQuery();
  };

  const actions = document.createElement("div");
  actions.className = "row-actions";

  const renameBtn = document.createElement("button");
  renameBtn.type = "button";
  renameBtn.className = "btn btn-mini";
  renameBtn.textContent = "重命名";
  renameBtn.onclick = async () => {
    const name = window.prompt("请输入新表名（显示名）", table.display_name || "");
    if (name === null) return;
    if (!name.trim()) return;
    try {
      await fetchJson(`/api/table/${encodeURIComponent(table.table_name)}/rename`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: name.trim() }),
      });
      await loadTableData();
      setMessage(els.importMsg, "重命名成功");
    } catch (err) {
      setMessage(els.importMsg, err.message || "重命名失败", true);
    }
  };

  const moveBtn = document.createElement("button");
  moveBtn.type = "button";
  moveBtn.className = "btn btn-mini";
  moveBtn.textContent = "移动";
  moveBtn.onclick = async () => {
    const folder = window.prompt("输入目标文件夹路径（多级用 /，留空移动到未分组）", table.folder_path || "");
    if (folder === null) return;
    try {
      await fetchJson(`/api/table/${encodeURIComponent(table.table_name)}/move`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_path: folder }),
      });
      await loadTableData();
      setMessage(els.importMsg, "移动成功");
    } catch (err) {
      setMessage(els.importMsg, err.message || "移动失败", true);
    }
  };

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "btn btn-danger btn-mini";
  delBtn.textContent = "删除";
  delBtn.onclick = async () => {
    const ok = window.confirm(`确认删除【${table.display_name}】到回收站吗？`);
    if (!ok) return;
    try {
      await fetchJson(`/api/table/${encodeURIComponent(table.table_name)}/delete`, { method: "POST" });
      if (state.currentTable === table.table_name) {
        state.currentTable = "";
      }
      await loadTableData();
      await loadColumns();
      state.page = 1;
      if (state.currentTable) {
        await doQuery();
      } else {
        clearTableView("请先选择数据表");
      }
      setMessage(els.importMsg, "已移入回收站");
    } catch (err) {
      setMessage(els.importMsg, err.message || "删除失败", true);
    }
  };

  actions.appendChild(renameBtn);
  actions.appendChild(moveBtn);
  actions.appendChild(delBtn);

  row.appendChild(selectBtn);
  row.appendChild(actions);
  return row;
}

function renderRecycleBin() {
  els.recycleList.innerHTML = "";
  if (!state.recycleBin.length) {
    els.recycleList.innerHTML = "<p class='table-empty'>回收站为空</p>";
    return;
  }

  state.recycleBin.forEach((t) => {
    const row = document.createElement("div");
    row.className = "recycle-row";

    const txt = document.createElement("div");
    txt.className = "recycle-name";
    txt.textContent = `${t.display_name} (${t.folder_path || "未分组"})`;

    const acts = document.createElement("div");
    acts.className = "row-actions";

    const restore = document.createElement("button");
    restore.className = "btn btn-mini";
    restore.textContent = "恢复";
    restore.onclick = async () => {
      try {
        await fetchJson(`/api/table/${encodeURIComponent(t.table_name)}/restore`, { method: "POST" });
        await loadTableData();
        setMessage(els.importMsg, "恢复成功");
      } catch (err) {
        setMessage(els.importMsg, err.message || "恢复失败", true);
      }
    };

    const purge = document.createElement("button");
    purge.className = "btn btn-danger btn-mini";
    purge.textContent = "彻底删除";
    purge.onclick = async () => {
      const ok = window.confirm(`确认彻底删除【${t.display_name}】吗？该操作不可恢复。`);
      if (!ok) return;
      try {
        await fetchJson(`/api/table/${encodeURIComponent(t.table_name)}/purge`, { method: "DELETE" });
        await loadTableData();
        setMessage(els.importMsg, "已彻底删除");
      } catch (err) {
        setMessage(els.importMsg, err.message || "彻底删除失败", true);
      }
    };

    acts.appendChild(restore);
    acts.appendChild(purge);

    row.appendChild(txt);
    row.appendChild(acts);
    els.recycleList.appendChild(row);
  });
}

async function loadColumns() {
  if (!state.currentTable) {
    state.columns = [];
    refreshFieldSelectors();
    refreshHiddenColumnsPanel();
    refreshHeaderTags();
    return;
  }

  try {
    const data = await fetchJson(`/api/table/${encodeURIComponent(state.currentTable)}/columns`);
    state.columns = data.columns || [];
  } catch {
    state.columns = [];
  }

  const stillValidHidden = getHiddenColumns().filter((c) => state.columns.includes(c));
  setHiddenColumns(stillValidHidden);

  refreshHeaderTags();
  refreshHiddenColumnsPanel();
  refreshFieldSelectors();
}

function refreshHiddenColumnsPanel() {
  els.hiddenColumns.innerHTML = "";
  if (!state.columns.length) {
    setMessage(els.hiddenMsg, "当前无可配置字段");
    refreshStats();
    return;
  }

  const hidden = new Set(getHiddenColumns());
  state.columns.forEach((col) => {
    const label = hidden.has(col) ? `${col} (已隐藏)` : col;
    const op = createOption(col, label);
    op.selected = hidden.has(col);
    els.hiddenColumns.appendChild(op);
  });

  setMessage(els.hiddenMsg, `已隐藏 ${hidden.size} / ${state.columns.length} 个字段`);
  refreshStats();
}

function refreshConditionFieldOptions(row) {
  const queryableColumns = getQueryableColumns();
  const fieldSelect = row.querySelector(".cond-field");
  const selected = fieldSelect.value;
  fieldSelect.innerHTML = "";
  fieldSelect.appendChild(createOption("", "选择字段"));
  queryableColumns.forEach((col) => fieldSelect.appendChild(createOption(col, col)));
  fieldSelect.value = queryableColumns.includes(selected) ? selected : "";
}

function refreshSortFieldOptions(row) {
  const queryableColumns = getQueryableColumns();
  const fieldSelect = row.querySelector(".sort-field");
  const selected = fieldSelect.value;
  fieldSelect.innerHTML = "";
  fieldSelect.appendChild(createOption("", "选择字段"));
  queryableColumns.forEach((col) => fieldSelect.appendChild(createOption(col, col)));
  fieldSelect.value = queryableColumns.includes(selected) ? selected : "";
}

function refreshFieldSelectors() {
  Array.from(els.filters.querySelectorAll(".condition-row")).forEach((row) => {
    refreshConditionFieldOptions(row);
  });
  Array.from(els.sortRules.querySelectorAll(".sort-row")).forEach((row) => {
    refreshSortFieldOptions(row);
  });
  refreshStats();
}

function updateConditionInputMode(row) {
  const type = row.querySelector(".cond-type").value;
  const likeWrap = row.querySelector(".cond-like-wrap");
  const rangeWrap = row.querySelector(".cond-range-wrap");
  if (type === "range") {
    likeWrap.style.display = "none";
    rangeWrap.style.display = "block";
  } else {
    likeWrap.style.display = "block";
    rangeWrap.style.display = "none";
  }
}

function updateConditionLogicState() {
  const rows = Array.from(els.filters.querySelectorAll(".condition-row"));
  rows.forEach((row, idx) => {
    const logicWrap = row.querySelector(".cond-logic-wrap");
    const logic = row.querySelector(".cond-logic");
    if (idx === 0) {
      logicWrap.style.visibility = "hidden";
      logic.disabled = true;
      logic.value = "AND";
    } else {
      logicWrap.style.visibility = "visible";
      logic.disabled = false;
    }
  });
}

function addConditionRow(defaultData = null) {
  const data = defaultData || { logic: "AND", field: "", type: "like", value: "", min: "", max: "" };
  const row = document.createElement("div");
  row.className = "condition-row";
  row.innerHTML = `
    <div class="cond-logic-wrap">
      <label class="label">连接</label>
      <select class="input cond-logic">
        <option value="AND">AND</option>
        <option value="OR">OR</option>
      </select>
    </div>
    <div>
      <label class="label">字段</label>
      <select class="input cond-field"></select>
    </div>
    <div>
      <label class="label">类型</label>
      <select class="input cond-type">
        <option value="like">模糊</option>
        <option value="range">范围</option>
      </select>
    </div>
    <div class="cond-like-wrap">
      <label class="label">关键词</label>
      <input class="input cond-value" placeholder="输入关键词" />
    </div>
    <div class="cond-range-wrap">
      <label class="label">范围（最小/最大）</label>
      <div class="cond-range-grid">
        <input class="input cond-min" placeholder="最小值" />
        <input class="input cond-max" placeholder="最大值" />
      </div>
    </div>
    <div class="cond-action-wrap">
      <button type="button" class="btn btn-danger cond-remove">删除</button>
    </div>
  `;

  refreshConditionFieldOptions(row);
  row.querySelector(".cond-logic").value = data.logic || "AND";
  row.querySelector(".cond-field").value = data.field || "";
  row.querySelector(".cond-type").value = data.type || "like";
  row.querySelector(".cond-value").value = data.value || "";
  row.querySelector(".cond-min").value = data.min || "";
  row.querySelector(".cond-max").value = data.max || "";

  row.querySelector(".cond-type").onchange = () => updateConditionInputMode(row);
  row.querySelector(".cond-remove").onclick = () => {
    row.remove();
    updateConditionLogicState();
  };

  updateConditionInputMode(row);
  els.filters.appendChild(row);
  updateConditionLogicState();
}

function addSortRow(defaultData = null) {
  const data = defaultData || { field: "", order: "asc" };
  const row = document.createElement("div");
  row.className = "sort-row";
  row.innerHTML = `
    <div>
      <label class="label">排序字段</label>
      <select class="input sort-field"></select>
    </div>
    <div>
      <label class="label">方向</label>
      <select class="input sort-order">
        <option value="asc">升序</option>
        <option value="desc">降序</option>
      </select>
    </div>
    <div class="sort-action-wrap">
      <button type="button" class="btn btn-danger sort-remove">删除</button>
    </div>
  `;

  refreshSortFieldOptions(row);
  row.querySelector(".sort-field").value = data.field || "";
  row.querySelector(".sort-order").value = data.order || "asc";
  row.querySelector(".sort-remove").onclick = () => row.remove();
  els.sortRules.appendChild(row);
}

function collectConditions() {
  const rows = Array.from(els.filters.querySelectorAll(".condition-row"));
  const conditions = [];

  rows.forEach((row, idx) => {
    const logic = (row.querySelector(".cond-logic").value || "AND").toUpperCase();
    const field = (row.querySelector(".cond-field").value || "").trim();
    const type = (row.querySelector(".cond-type").value || "like").trim();
    const value = (row.querySelector(".cond-value").value || "").trim();
    const min = (row.querySelector(".cond-min").value || "").trim();
    const max = (row.querySelector(".cond-max").value || "").trim();

    if (!field) return;

    if (type === "range") {
      if (!min && !max) return;
      conditions.push({ logic: idx === 0 ? "AND" : logic, field, type: "range", min, max });
    } else {
      if (!value) return;
      conditions.push({ logic: idx === 0 ? "AND" : logic, field, type: "like", value });
    }
  });

  return conditions;
}

function collectSortRules() {
  const rows = Array.from(els.sortRules.querySelectorAll(".sort-row"));
  const rules = [];
  rows.forEach((row) => {
    const field = (row.querySelector(".sort-field").value || "").trim();
    const order = (row.querySelector(".sort-order").value || "asc").toLowerCase();
    if (!field) return;
    rules.push({ field, order: order === "desc" ? "desc" : "asc" });
  });
  return rules;
}

function collectPayload() {
  return {
    table: state.currentTable,
    page: state.page,
    page_size: Number(els.pageSize.value || 20),
    global_keyword: (els.globalKeyword.value || "").trim(),
    conditions: collectConditions(),
    sort_rules: collectSortRules(),
    hidden_columns: getHiddenColumns(),
  };
}

function renderTable(columns, rows) {
  if (!columns || columns.length === 0) {
    clearTableView("暂无可见字段");
    return;
  }

  const thead = `<thead><tr>${columns.map((c) => `<th>${escapeHtml(c)}</th>`).join("")}</tr></thead>`;
  const bodyRows = rows
    .map((row) => {
      const tds = columns.map((c) => `<td>${escapeHtml(formatDisplayValue(row[c]))}</td>`).join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");

  const tbody = `<tbody>${bodyRows || `<tr><td colspan="${columns.length}" class="p-3">无匹配结果</td></tr>`}</tbody>`;
  els.resultTable.innerHTML = `${thead}${tbody}`;
}

async function doQuery() {
  const payload = collectPayload();
  if (!payload.table) {
    setMessage(els.queryMsg, "请先在左侧选择数据表", true);
    clearTableView("请先在左侧选择数据表");
    return;
  }

  if (!getQueryableColumns().length) {
    setMessage(els.queryMsg, "当前表字段已全部隐藏，请先恢复至少一个字段", true);
    clearTableView("当前表字段已全部隐藏");
    return;
  }

  setQueryBusy(true);
  try {
    const data = await fetchJson("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    state.total = data.total;
    state.totalPages = data.total_pages;
    state.page = data.page;
    state.lastColumns = data.columns || [];
    state.lastRows = data.rows || [];

    renderTable(state.lastColumns, state.lastRows);
    els.pageInfo.textContent = `第 ${state.page} / ${state.totalPages} 页，共 ${state.total} 条`;
    setMessage(els.queryMsg, "查询完成");
  } catch (err) {
    setMessage(els.queryMsg, err.message || "查询失败", true);
  } finally {
    setQueryBusy(false);
  }
}

async function doImport() {
  const file = els.excelFile.files?.[0];
  if (!file) {
    setMessage(els.importMsg, "请选择 Excel 文件", true);
    return;
  }

  const form = new FormData();
  form.append("file", file);
  try {
    const data = await fetchJson("/api/import-excel", { method: "POST", body: form });
    const lines = (data.created || []).map((x) => `${x.sheet} -> ${x.table}`);
    setMessage(els.importMsg, `导入完成，创建 ${data.count} 张表：${lines.join("；")}`);
    await loadTableData();
    await loadColumns();
    state.page = 1;
    if (state.currentTable) await doQuery();
  } catch (err) {
    setMessage(els.importMsg, err.message || "导入失败", true);
  }
}

async function doExport() {
  const payload = collectPayload();
  if (!payload.table) {
    setMessage(els.queryMsg, "请先在左侧选择数据表", true);
    return;
  }

  payload.visible_columns = [...state.lastColumns];

  try {
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      let msg = `导出失败(${res.status})`;
      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        const data = await res.json();
        msg = data.error || msg;
      }
      throw new Error(msg);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const cd = res.headers.get("content-disposition") || "";
    const match = cd.match(/filename="?([^";]+)"?/i);
    a.href = url;
    a.download = match?.[1] || "query_result.xlsx";
    a.click();
    URL.revokeObjectURL(url);
    setMessage(els.queryMsg, `导出成功（${payload.visible_columns.length} 个字段）`);
  } catch (err) {
    setMessage(els.queryMsg, err.message || "导出失败", true);
  }
}

function bindEnterToQuery() {
  [els.globalKeyword].forEach((el) => {
    el.addEventListener("keydown", async (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      state.page = 1;
      await doQuery();
    });
  });

  els.filters.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    if (!(e.target instanceof HTMLInputElement)) return;
    e.preventDefault();
    state.page = 1;
    await doQuery();
  });
}

function bindEvents() {
  els.importBtn.onclick = doImport;

  els.createFolderBtn.onclick = async () => {
    const path = (els.newFolderPath.value || "").trim();
    if (!path) {
      setMessage(els.importMsg, "请输入文件夹路径", true);
      return;
    }
    try {
      await fetchJson("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_path: path }),
      });
      els.newFolderPath.value = "";
      await loadTableData();
      setMessage(els.importMsg, "文件夹创建成功");
    } catch (err) {
      setMessage(els.importMsg, err.message || "创建文件夹失败", true);
    }
  };

  els.addFilterBtn.onclick = () => addConditionRow();
  els.addSortBtn.onclick = () => addSortRow();

  els.hideSelectedBtn.onclick = async () => {
    const selected = Array.from(els.hiddenColumns.selectedOptions).map((x) => x.value);
    if (!selected.length) {
      setMessage(els.hiddenMsg, "请先选中要隐藏的字段", true);
      return;
    }
    setHiddenColumns([...getHiddenColumns(), ...selected]);
    refreshHiddenColumnsPanel();
    refreshFieldSelectors();
    state.page = 1;
    await doQuery();
  };

  els.unhideSelectedBtn.onclick = async () => {
    const selected = new Set(Array.from(els.hiddenColumns.selectedOptions).map((x) => x.value));
    if (!selected.size) {
      setMessage(els.hiddenMsg, "请先选中要取消隐藏的字段", true);
      return;
    }
    setHiddenColumns(getHiddenColumns().filter((c) => !selected.has(c)));
    refreshHiddenColumnsPanel();
    refreshFieldSelectors();
    state.page = 1;
    await doQuery();
  };

  els.clearHiddenBtn.onclick = async () => {
    setHiddenColumns([]);
    refreshHiddenColumnsPanel();
    refreshFieldSelectors();
    state.page = 1;
    await doQuery();
  };

  els.searchBtn.onclick = async () => {
    state.page = 1;
    await doQuery();
  };

  els.resetBtn.onclick = async () => {
    els.globalKeyword.value = "";
    els.filters.innerHTML = "";
    els.sortRules.innerHTML = "";
    addConditionRow();
    addSortRow();
    state.page = 1;
    await doQuery();
  };

  els.exportBtn.onclick = doExport;

  els.prevBtn.onclick = async () => {
    if (state.page <= 1) return;
    state.page -= 1;
    await doQuery();
  };

  els.nextBtn.onclick = async () => {
    if (state.page >= state.totalPages) return;
    state.page += 1;
    await doQuery();
  };

  els.pageSize.onchange = async () => {
    state.page = 1;
    await doQuery();
  };

  bindEnterToQuery();
}

async function init() {
  bindEvents();
  addConditionRow();
  addSortRow();
  await loadTableData();
  await loadColumns();
  if (state.currentTable) await doQuery();
}

init();
