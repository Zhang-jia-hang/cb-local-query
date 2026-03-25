# 本地 Excel 可视化查询工具（Flask + SQLite + Tailwind）

## 功能
- 导入 Excel（`.xlsx/.xls`），支持中文工作表名与中文表头。
- 自动建 SQLite 表：一个工作表对应一张数据表。
- 可视化查询：
  - 全局模糊查询（所有字段）
  - 单字段模糊查询
  - 多字段组合查询（AND）
- 多表切换、结果分页。
- 按当前筛选条件导出 Excel。
- 响应式界面（PC / 移动端）。
- 启动后自动打开浏览器。
- 纯本地离线运行。

## 技术栈
- Python Flask
- SQLite
- Tailwind 风格本地 CSS（离线）
- pandas
- openpyxl
- PyInstaller

## 项目结构
- `app.py`：核心后端、Excel 导入、查询与导出 API。
- `start_tool.py`：EXE 启动入口。
- `templates/index.html`：页面结构。
- `static/js/app.js`：前端交互逻辑。
- `static/css/tailwind.min.css`：离线样式文件。
- `build_exe.bat`：一键打包 EXE。
- `run_dev.bat`：本地开发运行。

## 开发运行
1. 执行：`run_dev.bat`
2. 浏览器自动打开 `http://127.0.0.1:5000`

## 打包 EXE（一键）
1. 执行：`build_exe.bat`
2. 生成文件：`dist\LocalQueryTool.exe`
3. 双击 EXE 后会自动启动本地服务并打开浏览器。

## 手动打包 EXE（命令行）
### 1) 准备 Python
建议使用 Python 3.12。可先检查：
```powershell
py -3.12 --version
```

### 2) 创建独立虚拟环境并安装依赖
在项目根目录执行：
```powershell
py -3.12 -m venv .venv312
.\.venv312\Scripts\python.exe -m pip install --upgrade pip
.\.venv312\Scripts\pip.exe install --only-binary=:all: -r requirements.txt
```

### 3) 执行 PyInstaller 打包
```powershell
.\.venv312\Scripts\pyinstaller.exe --noconfirm --clean --onefile --name LocalQueryTool --add-data "templates;templates" --add-data "static;static" start_tool.py
```

### 4) 查看产物
- EXE 路径：`dist\LocalQueryTool.exe`

## 使用说明
1. 在“导入 Excel”区域选择 Excel 文件并导入。
2. 选择数据表，输入查询条件后点击“查询”。
3. 使用分页按钮查看结果。
4. 点击“导出当前结果 Excel”导出筛选后的全部匹配数据。

## 注意
- 表名、字段名会做安全规范化（去除非法字符并避免重复）。
- 导入同名工作表时会自动追加后缀避免冲突。
- 数据库存放在 `data/app.db`。
- 如果旧虚拟环境异常，可删除后重建，或直接新建如 `.venv312` 这样的独立环境。
