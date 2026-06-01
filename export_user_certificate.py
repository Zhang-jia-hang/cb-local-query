import os
import re
import asyncio
import aiohttp
import pymysql
from pymysql.cursors import DictCursor

# ====================== 【请手动修改此处配置】======================
# 数据库连接信息
DB_HOST = "120.27.203.130"
DB_PORT = 15000
DB_USER = "xkpt"
DB_PWD = "chamberlainQAZ!@#.."
DB_NAME = "flyme_cloud"

# 时间范围查询（格式：yyyy-MM-dd HH:mm:ss）
START_TIME = "2026-05-22 00:00:00"
END_TIME = "2026-05-22 23:59:59"

# 根保存文件夹
BASE_SAVE_DIR = "./certificate_pdf"
# 最大并发下载数，数值越小请求越平稳
MAX_CONCURRENT = 8
# 单次请求超时
REQ_TIMEOUT = aiohttp.ClientTimeout(total=15)
# =================================================================

# 过滤文件名非法字符
def clean_filename(name):
    illegal_chars = r'[\/:*?"<>|]'
    return re.sub(illegal_chars, "", name)

# 根据等级获取分类文件夹
def get_level_folder(base_dir, level):
    if level == "三级":
        sub_dir = "三级"
    elif level == "四级":
        sub_dir = "四级"
    else:
        sub_dir = "其他"
    full_dir = os.path.join(base_dir, sub_dir)
    os.makedirs(full_dir, exist_ok=True)
    return full_dir

# 异步下载单份PDF
async def async_download_pdf(session, semaphore, url, save_path, user_info):
    async with semaphore:
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            }
            async with session.get(url, headers=headers, timeout=REQ_TIMEOUT) as resp:
                if resp.status == 200:
                    content = await resp.read()
                    with open(save_path, "wb") as f:
                        f.write(content)
                    print(f"✅【{user_info}】下载完成 -> {os.path.basename(save_path)}")
                    return True
                else:
                    print(f"❌【{user_info}】状态码异常:{resp.status} 链接:{url}")
                    return False
        except Exception as e:
            print(f"❌【{user_info}】下载失败:{str(e)} 链接:{url}")
            return False

# 组装下载任务
def build_download_tasks(data_list, session, semaphore):
    tasks = []
    for row in data_list:
        user_name = row.get("userName", "")
        mobile = row.get("mobile", "")
        level = row.get("certificateLevel", "")
        pdf_url = row.get("certificateImage", "")

        if not pdf_url:
            print(f"⚠️ 用户{user_name} PDF地址为空，跳过")
            continue

        # 分类目录
        save_dir = get_level_folder(BASE_SAVE_DIR, level)
        # 文件名拼接
        raw_name = f"{user_name}{mobile}_{level}"
        safe_name = clean_filename(raw_name)
        file_path = os.path.join(save_dir, f"{safe_name}.pdf")
        user_tag = f"{user_name}-{mobile}"

        task = asyncio.create_task(
            async_download_pdf(session, semaphore, pdf_url, file_path, user_tag)
        )
        tasks.append(task)
    return tasks

# 主异步入口
async def main():
    # 初始化根目录
    os.makedirs(BASE_SAVE_DIR, exist_ok=True)

    # 1. 同步查询数据库（按时间范围筛选）
    try:
        conn = pymysql.connect(
            host=DB_HOST,
            port=DB_PORT,
            user=DB_USER,
            password=DB_PWD,
            database=DB_NAME,
            charset="utf8mb4"
        )
        cursor = conn.cursor(DictCursor)
        # 时间范围查询SQL
        sql = """
        SELECT 
            CASE certificateCode
                WHEN 'WYGLS3' THEN '三级'
                WHEN 'WYGLS4' THEN '四级'
                ELSE certificateCode
            END AS certificateLevel,
            certificateImage,
            userName,
            mobile 
        FROM `sys_usercertificate_audit` 
        WHERE createTime BETWEEN %s AND %s
        """
        # 传入起止时间参数
        cursor.execute(sql, (START_TIME, END_TIME))
        data_list = cursor.fetchall()
        cursor.close()
        conn.close()
        print(f"⏰ 查询时间范围：{START_TIME} ~ {END_TIME}")
        print(f"\n🔍 共查询到 {len(data_list)} 条证书数据，开始异步下载\n")
    except Exception as e:
        print(f"❌ 数据库查询失败：{e}")
        return

    # 2. 限制并发，创建会话
    semaphore = asyncio.Semaphore(MAX_CONCURRENT)
    async with aiohttp.ClientSession() as session:
        tasks = build_download_tasks(data_list, session, semaphore)
        # 并发执行，完成一条即刻输出文件
        await asyncio.gather(*tasks)

    print("\n🎉 所有下载任务全部结束！")

if __name__ == "__main__":
    # 兼容Windows异步事件循环
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())