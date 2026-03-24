const state = {
  tables: [],
  columns: [],
  currentTable: "",
  page: 1,
  totalPages: 1,
  total: 0,
};

const els = {
  excelFile: document.getElementById("excelFile"),
  importBtn: document.getElementById("importBtn"),
  importMsg: document.getElementById("importMsg"),
  tableList: document.getElementById("tableList"),
  currentTableTag: document.getElementById("currentTableTag"),
  globalKeyword: document.getElementById("globalKeyword"),
  pageSize: document.getElementById("pageSize"),
  singleField: document.getElementById("singleField"),
  singleKeyword: document.getElementById("singleKeyword"),
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

function refreshCurrentTableTag() {
  if (!els.currentTableTag) return;
  els.currentTableTag.textContent = state.currentTable
    ? `当前表：${state.currentTable}`
    : "当前表：未选择";
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
  if (contentType.includes("application/json")) {
    return res.json();
  }
  return null;
}

function renderTableList() {
  if (!els.tableList) return;
  els.tableList.innerHTML = "";

  if (!state.tables.length) {
    const p = document.createElement("p");
    p.className = "table-empty";
    p.textContent = "暂无数据表";
    els.tableList.appendChild(p);
    refreshCurrentTableTag();
    return;
  }

  state.tables.forEach((table) => {
    const row = document.createElement("div");
    row.className = "table-row";

    const nameBtn = document.createElement("button");
    nameBtn.type = "button";
    nameBtn.className = `table-item${state.currentTable === table ? " active" : ""}`;
    nameBtn.textContent = table;
    nameBtn.onclick = async () => {
      state.currentTable = table;
      renderTableList();
      await loadColumns();
      state.page = 1;
      await doQuery();
    };

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "btn btn-danger table-delete";
    deleteBtn.textContent = "删";
    deleteBtn.title = `删除数据表 ${table}`;
    deleteBtn.onclick = async (e) => {
      e.stopPropagation();
      await doDeleteTable(table);
    };

    row.appendChild(nameBtn);
    row.appendChild(deleteBtn);
    els.tableList.appendChild(row);
  });
  refreshCurrentTableTag();
}

async function loadTables() {
  const data = await fetchJson("/api/tables");
  state.tables = data.tables || [];

  if (!state.tables.length) {
    state.currentTable = "";
    state.columns = [];
    refreshFieldSelectors();
    renderTableList();
    clearTableView("暂无数据，请先导入 Excel");
    return;
  }

  if (!state.tables.includes(state.currentTable)) {
    state.currentTable = state.tables[0];
  }

  renderTableList();
  await loadColumns();
}

async function loadColumns() {
  const table = state.currentTable;
  if (!table) {
    state.columns = [];
    refreshFieldSelectors();
    return;
  }

  const data = await fetchJson(`/api/table/${encodeURIComponent(table)}/columns`);
  state.columns = data.columns || [];
  refreshFieldSelectors();
}

function refreshFieldSelectors() {
  els.singleField.innerHTML = "";
  els.singleField.appendChild(createOption("", "不使用"));
  state.columns.forEach((col) => {
    els.singleField.appendChild(createOption(col, col));
  });

  const rows = Array.from(els.filters.querySelectorAll(".filter-row"));
  rows.forEach((row) => {
    const select = row.querySelector("select");
    const selected = select.value;
    select.innerHTML = "";
    select.appendChild(createOption("", "选择字段"));
    state.columns.forEach((col) => {
      select.appendChild(createOption(col, col));
    });
    select.value = selected;
  });
}

function addFilterRow(defaultField = "", defaultValue = "") {
  const row = document.createElement("div");
  row.className = "filter-row grid grid-cols-1 md-grid-cols-3 gap-2";

  const fieldSelect = document.createElement("select");
  fieldSelect.className = "input";
  fieldSelect.appendChild(createOption("", "选择字段"));
  state.columns.forEach((col) => fieldSelect.appendChild(createOption(col, col)));
  fieldSelect.value = defaultField;

  const valueInput = document.createElement("input");
  valueInput.className = "input";
  valueInput.placeholder = "关键词";
  valueInput.value = defaultValue;

  const removeBtn = document.createElement("button");
  removeBtn.className = "btn btn-danger";
  removeBtn.type = "button";
  removeBtn.textContent = "删除";
  removeBtn.onclick = () => row.remove();

  row.appendChild(fieldSelect);
  row.appendChild(valueInput);
  row.appendChild(removeBtn);
  els.filters.appendChild(row);
}

function collectPayload() {
  const fieldFilters = {};
  const rows = Array.from(els.filters.querySelectorAll(".filter-row"));
  rows.forEach((row) => {
    const [fieldSelect, valueInput] = row.children;
    const field = fieldSelect.value;
    const value = (valueInput.value || "").trim();
    if (field && value) {
      fieldFilters[field] = value;
    }
  });

  return {
    table: state.currentTable,
    page: state.page,
    page_size: Number(els.pageSize.value || 20),
    global_keyword: (els.globalKeyword.value || "").trim(),
    single_field: els.singleField.value,
    single_keyword: (els.singleKeyword.value || "").trim(),
    field_filters: fieldFilters,
  };
}

function renderTable(columns, rows) {
  if (!columns || columns.length === 0) {
    clearTableView("暂无数据");
    return;
  }

  const thead = `<thead><tr>${columns
    .map((c) => `<th>${escapeHtml(c)}</th>`)
    .join("")}</tr></thead>`;

  const bodyRows = rows
    .map((row) => {
      const tds = columns
        .map((c) => `<td>${escapeHtml(row[c] ?? "")}</td>`)
        .join("");
      return `<tr>${tds}</tr>`;
    })
    .join("");

  const tbody = `<tbody>${bodyRows || `<tr><td colspan="${columns.length}" class="p-3">无匹配结果</td></tr>`}</tbody>`;
  els.resultTable.innerHTML = `${thead}${tbody}`;
}

function escapeHtml(val) {
  return String(val)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function doDeleteTable(table) {
  const ok = window.confirm(`确认删除数据表【${table}】吗？该操作不可恢复。`);
  if (!ok) return;

  try {
    await fetchJson(`/api/table/${encodeURIComponent(table)}`, { method: "DELETE" });
    if (state.currentTable === table) {
      state.currentTable = "";
    }
    setMessage(els.importMsg, `已删除数据表：${table}`);
    await loadTables();
    state.page = 1;
    if (state.currentTable) {
      await doQuery();
    }
  } catch (err) {
    setMessage(els.importMsg, err.message || "删除失败", true);
  }
}

async function doQuery() {
  const payload = collectPayload();
  if (!payload.table) {
    setMessage(els.queryMsg, "请先在左侧选择数据表", true);
    clearTableView("请先在左侧选择数据表");
    return;
  }

  try {
    const data = await fetchJson("/api/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    state.total = data.total;
    state.totalPages = data.total_pages;
    state.page = data.page;
    renderTable(data.columns, data.rows);
    els.pageInfo.textContent = `第 ${state.page} / ${state.totalPages} 页，共 ${state.total} 条`;
    setMessage(els.queryMsg, "查询完成");
  } catch (err) {
    setMessage(els.queryMsg, err.message || "查询失败", true);
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
    const data = await fetchJson("/api/import-excel", {
      method: "POST",
      body: form,
    });

    const lines = (data.created || []).map((x) => `${x.sheet} -> ${x.table}`);
    setMessage(els.importMsg, `导入完成，创建 ${data.count} 张表：${lines.join("；")}`);
    await loadTables();
    state.page = 1;
    if (state.currentTable) {
      await doQuery();
    }
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
    setMessage(els.queryMsg, "导出成功");
  } catch (err) {
    setMessage(els.queryMsg, err.message || "导出失败", true);
  }
}

function bindEvents() {
  els.importBtn.onclick = doImport;
  els.addFilterBtn.onclick = () => addFilterRow();
  els.searchBtn.onclick = async () => {
    state.page = 1;
    await doQuery();
  };
  els.resetBtn.onclick = async () => {
    els.globalKeyword.value = "";
    els.singleField.value = "";
    els.singleKeyword.value = "";
    els.filters.innerHTML = "";
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
}

async function init() {
  bindEvents();
  addFilterRow();
  await loadTables();
  if (state.currentTable) {
    await doQuery();
  }
}

init();
