// ===================== 全局状态管理：存储页面所有数据 =====================
const state = {
  tables: [],                  // 数据表列表
  recycleBin: [],              // 回收站中的已删除数据表
  folders: [],                 // 活跃文件夹列表
  recycleFolders: [],          // 回收站中的已删除文件夹
  columns: [],                 // 当前表所有字段
  numericColumns: [],          // 当前表数值类型字段
  hiddenColumnsByTable: {},    // 按表存储隐藏字段
  currentTable: "",            // 当前选中的表名
  page: 1,                     // 当前页码
  totalPages: 1,               // 总页数
  total: 0,                    // 数据总条数
  lastRows: [],                // 上一次查询的数据行
  lastColumns: [],             // 上一次查询的显示列
  querying: false,             // 是否正在查询中（防重复提交）
  moveTargetTable: "",        // 待移动的表名
  moveTargetDisplayName: "",  // 待移动表的显示名
  expandedFolders: new Set(),  // 左侧已展开的文件夹路径
  folderCreateParent: "",     // 当前新建文件夹的父目录
};

let activeActionMenu = null;
let globalNoticeTimer = null;

function closeActionMenu() {
  if (!activeActionMenu) return;
  activeActionMenu.classList.add("hidden");
  activeActionMenu = null;
}

function showGlobalNotice(message, isError = false) {
  if (!els.globalNotice) return;
  if (globalNoticeTimer) {
    clearTimeout(globalNoticeTimer);
    globalNoticeTimer = null;
  }
  els.globalNotice.textContent = message || "";
  els.globalNotice.classList.remove("hidden", "is-error");
  if (isError) els.globalNotice.classList.add("is-error");
  globalNoticeTimer = setTimeout(() => {
    els.globalNotice.classList.add("hidden");
    els.globalNotice.classList.remove("is-error");
  }, 4000);
}

// ===================== DOM 元素缓存：统一管理页面所有节点 =====================
const els = {
  excelFile: document.getElementById("excelFile"),
  importBtn: document.getElementById("importBtn"),
  importMsg: document.getElementById("importMsg"),
  importModal: document.getElementById("importModal"),
  importCloseBtn: document.getElementById("importCloseBtn"),
  importCancelBtn: document.getElementById("importCancelBtn"),
  importConfirmBtn: document.getElementById("importConfirmBtn"),
  importFolderSelect: document.getElementById("importFolderSelect"),
  importModalMsg: document.getElementById("importModalMsg"),
  importResultModal: document.getElementById("importResultModal"),
  importResultBody: document.getElementById("importResultBody"),
  importResultCloseBtn: document.getElementById("importResultCloseBtn"),
  importResultConfirmBtn: document.getElementById("importResultConfirmBtn"),
  recycleSummary: document.getElementById("recycleSummary"),
  recyclePurgeAllBtn: document.getElementById("recyclePurgeAllBtn"),
  globalNotice: document.getElementById("globalNotice"),
  tableList: document.getElementById("tableList"),
  recycleList: document.getElementById("recycleList"),
  tableCountBadge: document.getElementById("tableCountBadge"),
  folderCreateToggleBtn: document.getElementById("folderCreateToggleBtn"),
  folderCreateModal: document.getElementById("folderCreateModal"),
  folderCreateContext: document.getElementById("folderCreateContext"),
  folderCreateCancelBtn: document.getElementById("folderCreateCancelBtn"),
  folderCreateCloseBtn: document.getElementById("folderCreateCloseBtn"),
  folderCreateMsg: document.getElementById("folderCreateMsg"),
  newFolderPath: document.getElementById("newFolderPath"),
  createFolderBtn: document.getElementById("createFolderBtn"),
  recycleToggleBtn: document.getElementById("recycleToggleBtn"),
  recycleCloseBtn: document.getElementById("recycleCloseBtn"),
  recycleModal: document.getElementById("recycleModal"),

  moveModal: document.getElementById("moveModal"),
  moveModalTitle: document.getElementById("moveModalTitle"),
  moveModalCloseBtn: document.getElementById("moveModalCloseBtn"),
  moveFolderSelect: document.getElementById("moveFolderSelect"),
  moveNewFolderInput: document.getElementById("moveNewFolderInput"),
  moveCreateFolderBtn: document.getElementById("moveCreateFolderBtn"),
  moveConfirmBtn: document.getElementById("moveConfirmBtn"),
  moveCancelBtn: document.getElementById("moveCancelBtn"),
  moveModalMsg: document.getElementById("moveModalMsg"),

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

// ===================== 通用工具函数 =====================
/** 统一设置提示消息，支持错误样式 */
function setMessage(el, text, isError = false) {
  if (!el) return;
  el.textContent = text || "";
  el.className = `text-sm mt-2 ${isError ? "text-red-600" : "text-slate-600"}`;
}

/** 设置查询状态：禁用/启用按钮，防止重复提交 */
function setQueryBusy(busy) {
  state.querying = busy;
  els.searchBtn.disabled = busy;
  els.exportBtn.disabled = busy;
  els.prevBtn.disabled = busy;
  els.nextBtn.disabled = busy;
  els.searchBtn.textContent = busy ? "查询中..." : "查询";
}

/** 创建下拉选项 */
function createOption(value, label) {
  const op = document.createElement("option");
  op.value = value;
  op.textContent = label;
  return op;
}

/** 清空结果表格，显示空数据提示 */
function clearTableView(message = "暂无数据") {
  els.resultTable.innerHTML = `<tr><td class='p-3'>${message}</td></tr>`;
  els.pageInfo.textContent = "";
}

/** 获取当前选中表的元数据 */
function currentTableMeta() {
  return state.tables.find((t) => t.table_name === state.currentTable) || null;
}

/** 刷新顶部当前表/文件夹标签 */
function refreshHeaderTags() {
  const meta = currentTableMeta();
  els.currentTableTag.textContent = meta ? `当前表：${meta.display_name}` : "当前表：未选择";
  els.currentFolderTag.textContent = meta ? `文件夹：${meta.folder_path || "未分组"}` : "文件夹：-";
}

// 与后端保持一致的路径规范化，确保目录相关接口入参统一。
function saveExpandedFolders() {
  try {
    localStorage.setItem("expandedFolders", JSON.stringify(Array.from(state.expandedFolders)));
  } catch {}
}

function loadExpandedFolders() {
  try {
    const raw = localStorage.getItem("expandedFolders");
    const items = raw ? JSON.parse(raw) : [];
    state.expandedFolders = new Set(Array.isArray(items) ? items : []);
  } catch {
    state.expandedFolders = new Set();
  }
}

function isFolderExpanded(path) {
  return state.expandedFolders.has(normalizeFolderPathClient(path));
}

function setFolderExpanded(path, expanded) {
  const normalized = normalizeFolderPathClient(path);
  if (!normalized) return;
  if (expanded) state.expandedFolders.add(normalized);
  else state.expandedFolders.delete(normalized);
  saveExpandedFolders();
}

function openFolderCreateModal(parentPath = "") {
  state.folderCreateParent = normalizeFolderPathClient(parentPath);
  if (els.folderCreateContext) {
    els.folderCreateContext.textContent = state.folderCreateParent || "根目录";
  }
  if (els.folderCreateModal) {
    els.folderCreateModal.classList.remove("hidden");
    els.folderCreateModal.setAttribute("aria-hidden", "false");
  }
  if (els.folderCreateMsg) setMessage(els.folderCreateMsg, "");
  if (els.newFolderPath) {
    els.newFolderPath.value = "";
    els.newFolderPath.focus();
  }
}

function closeFolderCreateModal() {
  state.folderCreateParent = "";
  if (els.folderCreateModal) {
    els.folderCreateModal.classList.add("hidden");
    els.folderCreateModal.setAttribute("aria-hidden", "true");
  }
  if (els.folderCreateContext) els.folderCreateContext.textContent = "根目录";
  if (els.folderCreateMsg) setMessage(els.folderCreateMsg, "");
  if (els.newFolderPath) els.newFolderPath.value = "";
}

function buildCreateFolderPath(inputPath) {
  const normalized = normalizeFolderPathClient(inputPath);
  if (!normalized) return "";
  if (!state.folderCreateParent) return normalized;
  if (normalized.includes("/")) return normalized;
  return `${state.folderCreateParent}/${normalized}`;
}
function normalizeFolderPathClient(path) {
  return String(path || "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+|\/+$/g, "");
}

/** 获取当前表的隐藏字段 */
function getHiddenColumns() {
  const table = state.currentTable;
  if (!table) return [];
  if (!state.hiddenColumnsByTable[table]) state.hiddenColumnsByTable[table] = [];
  return state.hiddenColumnsByTable[table];
}

/** 设置当前表的隐藏字段（自动去重、校验有效性） */
function setHiddenColumns(columns) {
  const table = state.currentTable;
  if (!table) return;
  const unique = [...new Set(columns.filter((c) => state.columns.includes(c)))];
  state.hiddenColumnsByTable[table] = unique;
}

/** 获取可查询字段（排除隐藏） */
function getQueryableColumns() {
  const hidden = new Set(getHiddenColumns());
  return state.columns.filter((c) => !hidden.has(c));
}

/** 获取可查询的数值字段 */
function getQueryableNumericColumns() {
  const queryable = new Set(getQueryableColumns());
  return state.numericColumns.filter((c) => queryable.has(c));
}

/** 刷新字段统计信息 */
function refreshStats() {
  const total = state.columns.length;
  const hidden = getHiddenColumns().length;
  const queryable = getQueryableColumns().length;
  els.statTotalCols.textContent = `总字段：${total}`;
  els.statHiddenCols.textContent = `隐藏：${hidden}`;
  els.statQueryableCols.textContent = `可查询：${queryable}`;
}

/** HTML 转义，防止 XSS */
function escapeHtml(val) {
  return String(val)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** 判断字符串是否为浮点数格式 */
function isFloatString(text) {
  return /^[-+]?\d*\.\d+(e[-+]?\d+)?$/i.test(text);
}

/** 数字转百分比文本（保留2位小数） */
function toPercentText(num) {
  const scaled = num * 100;
  const rounded = Number(scaled.toFixed(2));
  return `${rounded.toFixed(2).replace(/\.?0+$/, "")}%`;
}

/** 格式化表格显示值：小数自动转百分比 */
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

/** 封装 fetch 请求，自动处理 JSON、错误信息 */
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

/** 创建文件夹（调用后端接口） */
async function renameFolder(oldPath, newPath) {
  const oldNorm = normalizeFolderPathClient(oldPath);
  const newNorm = normalizeFolderPathClient(newPath);
  if (!oldNorm || !newNorm) throw new Error("请输入有效的文件夹路径");
  await fetchJson("/api/folders/rename", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ old_path: oldNorm, new_path: newNorm }),
  });
  return newNorm;
}

async function deleteFolder(path) {
  const normalized = normalizeFolderPathClient(path);
  if (!normalized) throw new Error("无效的文件夹路径");
  const data = await fetchJson("/api/folders", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder_path: normalized }),
  });
  return data.summary || { folder_count: 0, table_count: 0, folders: [], tables: [] };
}

async function restoreRecycleFolder(path) {
  const normalized = normalizeFolderPathClient(path);
  if (!normalized) throw new Error("无效的文件夹路径");
  return fetchJson("/api/folders/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder_path: normalized }),
  });
}

async function purgeRecycleFolder(path) {
  const normalized = normalizeFolderPathClient(path);
  if (!normalized) throw new Error("无效的文件夹路径");
  return fetchJson("/api/folders/purge", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder_path: normalized }),
  });
}
async function createFolder(path) {
  const normalized = normalizeFolderPathClient(path);
  if (!normalized) throw new Error("请输入有效的文件夹路径");

  await fetchJson("/api/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folder_path: normalized }),
  });

  return normalized;
}

// ===================== 数据加载 =====================
/** 加载数据表 + 回收站 + 文件夹数据 */
async function loadTableData() {
  const [tableData, recycleData] = await Promise.all([fetchJson("/api/tables"), fetchJson("/api/recycle-bin")]);

  state.tables = tableData.tables || [];
  state.folders = tableData.folders || [];
  state.recycleBin = recycleData.tables || [];
  state.recycleFolders = recycleData.folders || [];

  if (!state.tables.find((t) => t.table_name === state.currentTable)) {
    state.currentTable = state.tables[0]?.table_name || "";
  }

  renderTableManager();
}

// ===================== 左侧表格/文件夹/回收站渲染 =====================
/** 渲染左侧表格管理面板（分组展示） */
function folderIcon(hasContent = true) {
  if (!hasContent) {
    return `<span class="item-icon folder-icon-empty" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M4 8.2a2.2 2.2 0 0 1 2.2-2.2h4.9l1.4 1.7H18a2 2 0 0 1 2 2v6.1a2.2 2.2 0 0 1-2.2 2.2H6.2A2.2 2.2 0 0 1 4 15.8V8.2Z" stroke="currentColor" stroke-width="1.8"/></svg></span>`;
  }
  return `<span class="item-icon folder-icon-filled" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M3.5 7.5h6l1.7 2h9.3v7.8a2.2 2.2 0 0 1-2.2 2.2H5.7a2.2 2.2 0 0 1-2.2-2.2V9.7a2.2 2.2 0 0 1 2.2-2.2Z" stroke="currentColor" stroke-width="1.8"/></svg></span>`;
}

function tableIcon() {
  return `<span class="item-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><ellipse cx="12" cy="6" rx="7" ry="3.2" stroke="currentColor" stroke-width="1.8"/><path d="M5 6v4.8C5 12.57 8.13 14 12 14s7-1.43 7-3.2V6" stroke="currentColor" stroke-width="1.8"/><path d="M5 10.8v4.6C5 17.17 8.13 18.6 12 18.6s7-1.43 7-3.2v-4.6" stroke="currentColor" stroke-width="1.8"/></svg></span>`;
}

function chevronIcon(expanded) {
  return `<span class="folder-chevron${expanded ? " expanded" : ""}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M9 6l6 6-6 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
}

function createFolderNode(name = "", path = "") {
  return { name, path, children: new Map(), tables: [] };
}

function getFolderImpactSummary(path) {
  const normalized = normalizeFolderPathClient(path);
  const folders = state.folders
    .filter((f) => f === normalized || f.startsWith(`${normalized}/`))
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
  const tables = state.tables
    .filter((t) => {
      const folderPath = normalizeFolderPathClient(t.folder_path || "");
      return folderPath === normalized || folderPath.startsWith(`${normalized}/`);
    })
    .sort((a, b) => (a.display_name || "").localeCompare(b.display_name || "", "zh-CN"));
  return { folders, tables };
}

function buildFolderDeleteMessage(path) {
  const summary = getFolderImpactSummary(path);
  const folderNames = summary.folders.slice(0, 8).join("、") || "无";
  const tableNames = summary.tables.slice(0, 8).map((t) => t.display_name || t.table_name).join("、") || "无";
  const folderMore = summary.folders.length > 8 ? ` 等 ${summary.folders.length} 个文件夹` : "";
  const tableMore = summary.tables.length > 8 ? ` 等 ${summary.tables.length} 张表` : "";
  return `确认删除文件夹【${path}】吗？\n\n子文件夹：${summary.folders.length} 个\n涉及数据表：${summary.tables.length} 张\n\n文件夹：${folderNames}${folderMore}\n数据表：${tableNames}${tableMore}\n\n删除后会从左侧移除，数据表会进入回收站。`;
}
function buildFolderTree() {
  const root = createFolderNode("", "");

  function ensurePath(fullPath) {
    const normalized = normalizeFolderPathClient(fullPath);
    if (!normalized) return root;
    const parts = normalized.split("/");
    let curr = root;
    let currPath = "";
    parts.forEach((part) => {
      currPath = currPath ? `${currPath}/${part}` : part;
      if (!curr.children.has(part)) {
        curr.children.set(part, createFolderNode(part, currPath));
      }
      curr = curr.children.get(part);
    });
    return curr;
  }

  state.folders.forEach((f) => ensurePath(f));
  state.tables.forEach((t) => {
    const node = ensurePath(t.folder_path || "");
    node.tables.push(t);
  });

  return root;
}

function makeFolderRow(node, depth) {
  const row = document.createElement("div");
  row.className = "folder-row";
  row.style.paddingLeft = `${Math.max(0, depth - 1) * 14}px`;

  const titleBtn = document.createElement("button");
  titleBtn.type = "button";
  titleBtn.className = "folder-row-main";
  const expanded = isFolderExpanded(node.path);
  const hasContent = node.tables.length > 0 || node.children.size > 0;
  titleBtn.innerHTML = `${chevronIcon(expanded)}${folderIcon(hasContent)}<span class="table-label">${escapeHtml(node.name)}</span>`;
  titleBtn.onclick = () => {
    setFolderExpanded(node.path, !isFolderExpanded(node.path));
    renderTableManager();
  };

  const actions = document.createElement("div");
  actions.className = "row-actions compact-actions";

  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "btn btn-mini action-more-btn";
  moreBtn.textContent = "···";
  moreBtn.title = "文件夹操作";

  const menu = document.createElement("div");
  menu.className = "action-menu hidden";

  const createBtn = document.createElement("button");
  createBtn.type = "button";
  createBtn.className = "action-menu-item";
  createBtn.textContent = "在此新建";
  createBtn.onclick = () => {
    closeActionMenu();
    setFolderExpanded(node.path, true);
    openFolderCreateModal(node.path);
  };

  const renameBtn = document.createElement("button");
  renameBtn.type = "button";
  renameBtn.className = "action-menu-item";
  renameBtn.textContent = "重命名";
  renameBtn.onclick = async () => {
    const name = window.prompt("请输入新的文件夹路径", node.path);
    if (name === null || !name.trim()) return;
    try {
      await renameFolder(node.path, name);
      closeActionMenu();
      await loadTableData();
      setMessage(els.importMsg, "文件夹重命名成功");
    } catch (err) {
      setMessage(els.importMsg, err.message || "文件夹重命名失败", true);
    }
  };

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "action-menu-item danger";
  deleteBtn.textContent = "删除文件夹";
  deleteBtn.onclick = async () => {
    const ok = window.confirm(buildFolderDeleteMessage(node.path));
    if (!ok) return;
    try {
      const summary = await deleteFolder(node.path);
      closeActionMenu();
      await loadTableData();
      setMessage(els.importMsg, `文件夹删除成功：${summary.table_count} 张表已移入回收站`);
    } catch (err) {
      setMessage(els.importMsg, err.message || "文件夹删除失败", true);
    }
  };

  menu.appendChild(createBtn);
  menu.appendChild(renameBtn);
  menu.appendChild(deleteBtn);

  moreBtn.onclick = (e) => {
    e.stopPropagation();
    if (activeActionMenu && activeActionMenu !== menu) activeActionMenu.classList.add("hidden");
    menu.classList.toggle("hidden");
    activeActionMenu = menu.classList.contains("hidden") ? null : menu;
  };

  actions.appendChild(moreBtn);
  actions.appendChild(menu);
  row.appendChild(titleBtn);
  row.appendChild(actions);
  return row;
}

function renderFolderTreeNode(node, depth = 0) {
  const frag = document.createDocumentFragment();
  frag.appendChild(makeFolderRow(node, depth));

  if (!isFolderExpanded(node.path)) return frag;

  node.tables
    .sort((a, b) => (a.display_name || "").localeCompare(b.display_name || "", "zh-CN"))
    .forEach((t) => frag.appendChild(renderTableRow(t, depth + 1)));

  Array.from(node.children.values())
    .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
    .forEach((child) => frag.appendChild(renderFolderTreeNode(child, depth + 1)));

  return frag;
}

/** 渲染左侧表格管理面板（多级文件夹树） */
function renderTableManager() {
  els.tableCountBadge.textContent = String(state.tables.length);
  const root = buildFolderTree();

  if (!state.expandedFolders.size) {
    state.folders.forEach((f) => state.expandedFolders.add(normalizeFolderPathClient(f)));
    saveExpandedFolders();
  }

  els.tableList.innerHTML = "";
  const hasFolders = root.children.size > 0;
  const hasRootTables = root.tables.length > 0;

  if (!hasFolders && !hasRootTables) {
    els.tableList.innerHTML = "<p class='table-empty'>暂无数据表</p>";
  } else {
    if (hasRootTables) {
      const rootTitle = document.createElement("div");
      rootTitle.className = "folder-title tree-title root-tree-title";
      rootTitle.innerHTML = `${folderIcon(root.tables.length > 0)}<span>未分组</span>`;
      els.tableList.appendChild(rootTitle);
      root.tables
        .sort((a, b) => (a.display_name || "").localeCompare(b.display_name || "", "zh-CN"))
        .forEach((t) => els.tableList.appendChild(renderTableRow(t, 1)));
    }

    Array.from(root.children.values())
      .sort((a, b) => a.name.localeCompare(b.name, "zh-CN"))
      .forEach((child) => els.tableList.appendChild(renderFolderTreeNode(child, 1)));
  }

  renderRecycleBin();
  refreshHeaderTags();
}

/** 打开移动表弹窗 */
function openMoveModal(table) {
  state.moveTargetTable = table.table_name;
  state.moveTargetDisplayName = table.display_name || table.table_name;

  els.moveModalTitle.textContent = `移动数据表：${state.moveTargetDisplayName}`;
  setMessage(els.moveModalMsg, "");
  els.moveNewFolderInput.value = "";

  const selectedFolder = normalizeFolderPathClient(table.folder_path || "");
  renderMoveFolderOptions(selectedFolder);

  els.moveModal.classList.remove("hidden");
  els.moveModal.setAttribute("aria-hidden", "false");
}

/** 关闭移动表弹窗 */
function renderImportFolderOptions(selectedFolder = "") {
  const selected = normalizeFolderPathClient(selectedFolder);
  const folders = [...new Set(state.folders.map((f) => normalizeFolderPathClient(f)).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "zh-CN")
  );

  els.importFolderSelect.innerHTML = "";
  els.importFolderSelect.appendChild(createOption("", "根目录（未分组）"));
  folders.forEach((f) => els.importFolderSelect.appendChild(createOption(f, f)));
  els.importFolderSelect.value = selected;
}

function openImportModal() {
  renderImportFolderOptions("");
  if (els.importModalMsg) setMessage(els.importModalMsg, "");
  if (els.importModal) {
    els.importModal.classList.remove("hidden");
    els.importModal.setAttribute("aria-hidden", "false");
  }
  if (els.excelFile) {
    els.excelFile.value = "";
    els.excelFile.focus();
  }
}

function closeImportModal() {
  if (els.importModal) {
    els.importModal.classList.add("hidden");
    els.importModal.setAttribute("aria-hidden", "true");
  }
  if (els.importModalMsg) setMessage(els.importModalMsg, "");
}

function showImportResultModal(title, message, isError = false) {
  if (!els.importResultModal || !els.importResultBody) {
    window.alert(message || title || "导入完成");
    return;
  }
  const titleEl = document.getElementById("importResultModalTitle");
  if (titleEl) titleEl.textContent = title || (isError ? "导入失败" : "导入成功");
  els.importResultBody.textContent = message || "";
  els.importResultBody.className = `import-result-body${isError ? " text-red-600 border-red-200 bg-red-50" : ""}`;
  els.importResultModal.classList.remove("hidden");
  els.importResultModal.setAttribute("aria-hidden", "false");
}

function closeImportResultModal() {
  if (!els.importResultModal) return;
  els.importResultModal.classList.add("hidden");
  els.importResultModal.setAttribute("aria-hidden", "true");
}
function closeMoveModal() {
  els.moveModal.classList.add("hidden");
  els.moveModal.setAttribute("aria-hidden", "true");
  state.moveTargetTable = "";
  state.moveTargetDisplayName = "";
  els.moveNewFolderInput.value = "";
  setMessage(els.moveModalMsg, "");
}

/** 渲染移动弹窗的文件夹下拉选项 */
function renderMoveFolderOptions(selectedFolder = "") {
  const selected = normalizeFolderPathClient(selectedFolder);
  const folders = [...new Set(state.folders.map((f) => normalizeFolderPathClient(f)).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "zh-CN")
  );

  els.moveFolderSelect.innerHTML = "";
  els.moveFolderSelect.appendChild(createOption("", "未分组（根目录）"));
  folders.forEach((f) => {
    els.moveFolderSelect.appendChild(createOption(f, f));
  });
  els.moveFolderSelect.value = selected;
}

// 移动弹窗支持两种流程：选择已有文件夹，或新建后立即移动。
async function submitMove() {
  if (!state.moveTargetTable) {
    setMessage(els.moveModalMsg, "未找到要移动的数据表", true);
    return;
  }

  let targetFolder = normalizeFolderPathClient(els.moveNewFolderInput.value || "");

  try {
    // 新建文件夹
    if (targetFolder) {
      targetFolder = await createFolder(targetFolder);
      await loadTableData();
      renderMoveFolderOptions(targetFolder);
      els.moveFolderSelect.value = targetFolder;
    } else {
      // 选择已有文件夹
      targetFolder = normalizeFolderPathClient(els.moveFolderSelect.value || "");
    }

    // 调用移动接口
    await fetchJson(`/api/table/${encodeURIComponent(state.moveTargetTable)}/move`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ folder_path: targetFolder }),
    });

    await loadTableData();
    setMessage(els.importMsg, `移动成功：${state.moveTargetDisplayName} -> ${targetFolder || "未分组"}`);
    closeMoveModal();
  } catch (err) {
    setMessage(els.moveModalMsg, err.message || "移动失败", true);
  }
}

/** 渲染单张数据表行（选择 + 更多操作菜单） */
function renderTableRow(table, depth = 0) {
  const row = document.createElement("div");
  row.className = "table-manage-row";

  const selectBtn = document.createElement("button");
  selectBtn.type = "button";
  selectBtn.className = `table-item${state.currentTable === table.table_name ? " active" : ""}`;
  selectBtn.innerHTML = `${tableIcon()}<span class="table-label">${escapeHtml(table.display_name)}</span>`;
  selectBtn.style.paddingLeft = `${Math.max(0, depth - 1) * 14 + 8}px`;
  selectBtn.title = `${table.display_name} [${table.table_name}]`;
  selectBtn.onclick = async () => {
    state.currentTable = table.table_name;
    state.page = 1;
    renderTableManager();
    await loadColumns();
    await doQuery();
  };

  const actions = document.createElement("div");
  actions.className = "row-actions compact-actions";

  const moreBtn = document.createElement("button");
  moreBtn.type = "button";
  moreBtn.className = "btn btn-mini action-more-btn";
  moreBtn.textContent = "···";
  moreBtn.title = "更多操作";

  const menu = document.createElement("div");
  menu.className = "action-menu hidden";

  const renameBtn = document.createElement("button");
  renameBtn.type = "button";
  renameBtn.className = "action-menu-item";
  renameBtn.textContent = "重命名";
  renameBtn.onclick = async () => {
    const name = window.prompt("请输入新表名（显示名）", table.display_name || "");
    if (name === null || !name.trim()) return;
    try {
      await fetchJson(`/api/table/${encodeURIComponent(table.table_name)}/rename`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ display_name: name.trim() }),
      });
      closeActionMenu();
      await loadTableData();
      setMessage(els.importMsg, "重命名成功");
    } catch (err) {
      setMessage(els.importMsg, err.message || "重命名失败", true);
    }
  };

  const moveBtn = document.createElement("button");
  moveBtn.type = "button";
  moveBtn.className = "action-menu-item";
  moveBtn.textContent = "移动";
  moveBtn.onclick = () => {
    closeActionMenu();
    openMoveModal(table);
  };

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "action-menu-item danger";
  delBtn.textContent = "删除";
  delBtn.onclick = async () => {
    const ok = window.confirm(`确认删除【${table.display_name}】到回收站吗？`);
    if (!ok) return;
    try {
      await fetchJson(`/api/table/${encodeURIComponent(table.table_name)}/delete`, { method: "POST" });
      if (state.currentTable === table.table_name) state.currentTable = "";
      closeActionMenu();
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

  menu.appendChild(renameBtn);
  menu.appendChild(moveBtn);
  menu.appendChild(delBtn);

  moreBtn.onclick = (e) => {
    e.stopPropagation();
    if (activeActionMenu && activeActionMenu !== menu) activeActionMenu.classList.add("hidden");
    menu.classList.toggle("hidden");
    activeActionMenu = menu.classList.contains("hidden") ? null : menu;
  };

  actions.appendChild(moreBtn);
  actions.appendChild(menu);

  row.appendChild(selectBtn);
  row.appendChild(actions);
  return row;
}

/** 渲染回收站列表 */
function renderRecycleBin() {
  els.recycleList.innerHTML = "";
  const recycleFolderCount = state.recycleFolders.length;
  const recycleTableCount = state.recycleBin.length;
  const totalDeleted = recycleFolderCount + recycleTableCount;
  if (els.recycleSummary) {
    els.recycleSummary.textContent = `共 ${totalDeleted} 个已删除文件`;
  }
  if (els.recyclePurgeAllBtn) {
    els.recyclePurgeAllBtn.disabled = totalDeleted === 0;
  }

  if (!totalDeleted) {
    els.recycleList.innerHTML = "<p class='table-empty'>回收站为空</p>";
    return;
  }

  state.recycleFolders.forEach((item) => {
    const row = document.createElement("div");
    row.className = "recycle-row";

    const txt = document.createElement("div");
    txt.className = "recycle-name";
    txt.innerHTML = `${folderIcon(true)}<span>${escapeHtml(item.folder_path)}（文件夹，含 ${item.table_count} 张表）</span>`;

    const acts = document.createElement("div");
    acts.className = "row-actions";

    const restore = document.createElement("button");
    restore.className = "btn btn-mini";
    restore.textContent = "恢复";
    restore.onclick = async () => {
      try {
        await restoreRecycleFolder(item.folder_path);
        await loadTableData();
        setMessage(els.importMsg, "文件夹恢复成功");
      } catch (err) {
        setMessage(els.importMsg, err.message || "文件夹恢复失败", true);
      }
    };

    const purge = document.createElement("button");
    purge.className = "btn btn-danger btn-mini";
    purge.textContent = "彻底删除";
    purge.onclick = async () => {
      const ok = window.confirm(`确认彻底删除文件夹【${item.folder_path}】吗？该操作不可恢复。`);
      if (!ok) return;
      try {
        await purgeRecycleFolder(item.folder_path);
        await loadTableData();
        setMessage(els.importMsg, "文件夹已彻底删除");
      } catch (err) {
        setMessage(els.importMsg, err.message || "文件夹彻底删除失败", true);
      }
    };

    acts.appendChild(restore);
    acts.appendChild(purge);
    row.appendChild(txt);
    row.appendChild(acts);
    els.recycleList.appendChild(row);
  });

  state.recycleBin.forEach((t) => {
    const row = document.createElement("div");
    row.className = "recycle-row";

    const txt = document.createElement("div");
    txt.className = "recycle-name";
    txt.innerHTML = `${tableIcon()}<span>${escapeHtml(t.display_name)} (${escapeHtml(t.folder_path || "未分组")})</span>`;

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

// ===================== 字段/列管理 =====================
/** 加载当前表的字段 + 数值字段 */
async function loadColumns() {
  if (!state.currentTable) {
    state.columns = [];
    state.numericColumns = [];
    refreshFieldSelectors();
    refreshHiddenColumnsPanel();
    refreshHeaderTags();
    return;
  }

  try {
    const data = await fetchJson(`/api/table/${encodeURIComponent(state.currentTable)}/columns`);
    state.columns = data.columns || [];
    state.numericColumns = data.numeric_columns || [];
  } catch {
    state.columns = [];
    state.numericColumns = [];
  }

  // 清理无效的隐藏字段
  const stillValidHidden = getHiddenColumns().filter((c) => state.columns.includes(c));
  setHiddenColumns(stillValidHidden);

  refreshHeaderTags();
  refreshHiddenColumnsPanel();
  refreshFieldSelectors();
}

/** 刷新隐藏字段面板 */
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

/** 刷新筛选条件的字段下拉选项 */
function refreshConditionFieldOptions(row) {
  const condType = row.querySelector(".cond-type")?.value || "like";
  const queryableColumns = condType === "range" ? getQueryableNumericColumns() : getQueryableColumns();
  const fieldSelect = row.querySelector(".cond-field");
  const selected = fieldSelect.value;
  fieldSelect.innerHTML = "";
  fieldSelect.appendChild(createOption("", queryableColumns.length ? "选择字段" : "无可用字段"));
  queryableColumns.forEach((col) => fieldSelect.appendChild(createOption(col, col)));
  fieldSelect.value = queryableColumns.includes(selected) ? selected : "";
}

/** 刷新排序规则的字段下拉选项 */
function refreshSortFieldOptions(row) {
  const queryableColumns = getQueryableColumns();
  const fieldSelect = row.querySelector(".sort-field");
  const selected = fieldSelect.value;
  fieldSelect.innerHTML = "";
  fieldSelect.appendChild(createOption("", "选择字段"));
  queryableColumns.forEach((col) => fieldSelect.appendChild(createOption(col, col)));
  fieldSelect.value = queryableColumns.includes(selected) ? selected : "";
}

/** 统一刷新所有筛选/排序的字段选择器 */
function refreshFieldSelectors() {
  Array.from(els.filters.querySelectorAll(".condition-row")).forEach((row) => {
    refreshConditionFieldOptions(row);
  });
  Array.from(els.sortRules.querySelectorAll(".sort-row")).forEach((row) => {
    refreshSortFieldOptions(row);
  });
  refreshStats();
}

/** 切换筛选条件输入模式：模糊 / 数值范围 */
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

/** 更新筛选条件逻辑：第一条无 AND/OR */
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

/** 添加一条筛选条件行 */
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

  row.querySelector(".cond-type").onchange = () => {
    updateConditionInputMode(row);
    refreshConditionFieldOptions(row);
  };
  row.querySelector(".cond-remove").onclick = () => {
    row.remove();
    updateConditionLogicState();
  };

  updateConditionInputMode(row);
  els.filters.appendChild(row);
  updateConditionLogicState();
}

/** 添加一条排序规则行 */
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

// ===================== 查询参数收集 =====================
/** 收集所有筛选条件 */
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

/** 收集所有排序规则 */
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

// 请求体结构与后端 /api/query 协议保持一致。
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

// ===================== 表格渲染与查询 =====================
/** 渲染结果表格 */
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

// 查询结果负责统一更新表格、总数与分页状态。
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

/** Excel 导入 */
async function doImport() {
  const file = els.excelFile?.files?.[0];
  if (!file) {
    setMessage(els.importModalMsg, "请选择 Excel 文件", true);
    return;
  }

  const folderPath = normalizeFolderPathClient(els.importFolderSelect?.value || "");
  const form = new FormData();
  form.append("file", file);
  form.append("folder_path", folderPath);

  try {
    const data = await fetchJson("/api/import-excel", { method: "POST", body: form });
    const lines = (data.created || []).map((x) => `${x.sheet} -> ${x.display_name || x.table}`);
    const suffix = folderPath ? `目标文件夹：${folderPath}` : "目标文件夹：根目录";
    const message = [`成功创建 ${data.count} 张表`, suffix, lines.join("；")].filter(Boolean).join("\n\n");
    setMessage(els.importMsg, "");
    showGlobalNotice(`导入完成：${data.count} 张表`);
    closeImportModal();
    showImportResultModal("导入成功", message, false);
    await loadTableData();
    await loadColumns();
    state.page = 1;
    if (state.currentTable) await doQuery();
  } catch (err) {
    const message = err.message || "导入失败";
    setMessage(els.importMsg, "");
    showGlobalNotice(message, true);
    closeImportModal();
    showImportResultModal("导入失败", message, true);
  }
}

// 导出复用当前筛选/排序状态，并按当前可见列导出。
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

// ===================== 事件绑定 =====================
/** 绑定回车触发查询 */
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

/** 绑定所有页面交互事件 */
function bindEvents() {
  els.importBtn.onclick = openImportModal;
  if (els.importCloseBtn) els.importCloseBtn.onclick = () => closeImportModal();
  if (els.importCancelBtn) els.importCancelBtn.onclick = () => closeImportModal();
  if (els.importConfirmBtn) els.importConfirmBtn.onclick = doImport;
  if (els.importModal) {
    els.importModal.addEventListener("click", (e) => {
      if (!(e.target instanceof HTMLElement)) return;
      if (e.target.dataset.importClose === "1") closeImportModal();
    });
  }
  if (els.importResultCloseBtn) els.importResultCloseBtn.onclick = () => closeImportResultModal();
  if (els.importResultConfirmBtn) els.importResultConfirmBtn.onclick = () => closeImportResultModal();
  if (els.importResultModal) {
    els.importResultModal.addEventListener("click", (e) => {
      if (!(e.target instanceof HTMLElement)) return;
      if (e.target.dataset.importResultClose === "1") closeImportResultModal();
    });
  }

  if (els.recycleToggleBtn && els.recycleModal) {
    els.recycleToggleBtn.onclick = () => {
      els.recycleModal.classList.remove("hidden");
      els.recycleModal.setAttribute("aria-hidden", "false");
    };
  }
  if (els.recycleCloseBtn && els.recycleModal) {
    els.recycleCloseBtn.onclick = () => {
      els.recycleModal.classList.add("hidden");
      els.recycleModal.setAttribute("aria-hidden", "true");
    };
  }
  if (els.recycleModal) {
    els.recycleModal.addEventListener("click", (e) => {
      if (!(e.target instanceof HTMLElement)) return;
      if (e.target.dataset.recycleClose === "1") {
        els.recycleModal.classList.add("hidden");
        els.recycleModal.setAttribute("aria-hidden", "true");
      }
    });
  }
  if (els.recyclePurgeAllBtn) {
    els.recyclePurgeAllBtn.onclick = async () => {
      const totalDeleted = state.recycleBin.length + state.recycleFolders.length;
      if (!totalDeleted) return;
      const ok = window.confirm(`确认清空回收站吗？共 ${totalDeleted} 个已删除文件将被彻底删除，且不可恢复。`);
      if (!ok) return;
      try {
        const data = await fetchJson("/api/recycle-bin/purge-all", { method: "DELETE" });
        await loadTableData();
        setMessage(els.importMsg, `回收站已清空：删除 ${data.table_count || 0} 张表，${data.folder_count || 0} 个文件夹`);
      } catch (err) {
        setMessage(els.importMsg, err.message || "清空回收站失败", true);
      }
    };
  }

  // 新建文件夹弹窗
  if (els.folderCreateToggleBtn) {
    els.folderCreateToggleBtn.onclick = () => openFolderCreateModal("");
  }
  if (els.folderCreateCancelBtn) {
    els.folderCreateCancelBtn.onclick = () => closeFolderCreateModal();
  }
  if (els.folderCreateCloseBtn) {
    els.folderCreateCloseBtn.onclick = () => closeFolderCreateModal();
  }
  if (els.folderCreateModal) {
    els.folderCreateModal.addEventListener("click", (e) => {
      if (!(e.target instanceof HTMLElement)) return;
      if (e.target.dataset.folderCreateClose === "1") {
        closeFolderCreateModal();
      }
    });
  }

  els.createFolderBtn.onclick = async () => {
    try {
      const created = await createFolder(buildCreateFolderPath(els.newFolderPath.value || ""));
      if (state.folderCreateParent) setFolderExpanded(state.folderCreateParent, true);
      setFolderExpanded(created, true);
      closeFolderCreateModal();
      await loadTableData();
      setMessage(els.importMsg, `文件夹创建成功：${created}`);
    } catch (err) {
      setMessage(els.folderCreateMsg, err.message || "创建文件夹失败", true);
    }
  };

  els.newFolderPath.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    els.createFolderBtn.click();
  });

  // 移动弹窗关闭
  els.moveModalCloseBtn.onclick = closeMoveModal;
  els.moveCancelBtn.onclick = closeMoveModal;
  els.moveModal.addEventListener("click", (e) => {
    if (!(e.target instanceof HTMLElement)) return;
    if (e.target.dataset.modalClose === "1") closeMoveModal();
  });

  // 移动弹窗内新建文件夹
  els.moveCreateFolderBtn.onclick = async () => {
    try {
      const created = await createFolder(els.moveNewFolderInput.value || "");
      await loadTableData();
      renderMoveFolderOptions(created);
      els.moveFolderSelect.value = created;
      setMessage(els.moveModalMsg, `文件夹创建成功：${created}`);
    } catch (err) {
      setMessage(els.moveModalMsg, err.message || "创建文件夹失败", true);
    }
  };

  // 移动弹窗回车创建文件夹
  els.moveNewFolderInput.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    els.moveCreateFolderBtn.click();
  });

  // 确认移动
  els.moveConfirmBtn.onclick = submitMove;
  els.moveFolderSelect.onchange = () => {
    if (els.moveNewFolderInput.value.trim()) return;
    setMessage(els.moveModalMsg, "");
  };

  // ESC 关闭弹窗/菜单
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !els.moveModal.classList.contains("hidden")) {
      closeMoveModal();
    }
    if (e.key === "Escape" && els.recycleModal && !els.recycleModal.classList.contains("hidden")) {
      els.recycleModal.classList.add("hidden");
      els.recycleModal.setAttribute("aria-hidden", "true");
    }
    if (e.key === "Escape" && els.importModal && !els.importModal.classList.contains("hidden")) {
      closeImportModal();
    }
    if (e.key === "Escape" && els.importResultModal && !els.importResultModal.classList.contains("hidden")) {
      closeImportResultModal();
    }
    if (e.key === "Escape") closeActionMenu();
    if (e.key === "Escape" && els.folderCreateModal && !els.folderCreateModal.classList.contains("hidden")) {
      closeFolderCreateModal();
    }
  });

  document.addEventListener("click", (e) => {
    if (!(e.target instanceof HTMLElement)) return;
    if (!e.target.closest(".compact-actions")) closeActionMenu();
  });

  // 添加筛选/排序
  els.addFilterBtn.onclick = () => addConditionRow();
  els.addSortBtn.onclick = () => addSortRow();

  // 隐藏选中字段
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

  // 取消隐藏选中字段
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

  // 清空所有隐藏
  els.clearHiddenBtn.onclick = async () => {
    setHiddenColumns([]);
    refreshHiddenColumnsPanel();
    refreshFieldSelectors();
    state.page = 1;
    await doQuery();
  };

  // 查询/重置/导出
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

  // 分页
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

// ===================== 初始化 =====================
async function init() {
  loadExpandedFolders();
  bindEvents();
  addConditionRow();
  addSortRow();
  await loadTableData();
  await loadColumns();
  if (state.currentTable) await doQuery();
}

// 启动页面
init();







































