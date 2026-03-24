@echo off
setlocal

if not exist .venv (
  python -m venv .venv
)

call .venv\Scripts\activate
python -m pip install --upgrade pip
pip install -r requirements.txt

pyinstaller --noconfirm --clean --onefile --name LocalQueryTool ^
  --add-data "templates;templates" ^
  --add-data "static;static" ^
  start_tool.py

echo.
echo 打包完成，EXE 路径：dist\LocalQueryTool.exe
pause
