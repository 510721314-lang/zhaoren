# scripts/smoke_test.py · admin-web 前端 17 页烟雾测试
# 逐页点击 → 抓 Console error → 检查表格是否渲染数据
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from playwright.sync_api import sync_playwright

KEY = "AWK-3a3467ea8c96f731449f0559a5634891c2df3a4df352f510b1e1720900ae7cf0"
BASE = "http://localhost:5173"

# 蓝图 8 菜单 17 页（不含 Login + Layout）
PAGES = [
    ("#/dashboard", "工作台"),
    ("#/orders", "订单列表"),
    ("#/dispute", "纠纷处理"),
    ("#/safety-log", "安全报备"),
    ("#/insurance", "保险记录"),
    ("#/users", "发单用户"),
    ("#/partners", "耍伴管理"),
    ("#/review", "耍伴审核"),
    ("#/finance", "财务与资产"),
    ("#/demand", "需求广场"),
    ("#/blog", "博客管理"),
    ("#/comment", "评论管理"),
    ("#/report", "举报处理"),
    ("#/conversation", "会话监管"),
    ("#/config", "运营配置"),
    ("#/notice", "通知群发"),
    ("#/export", "导出任务"),
]

results = []
errors_global = []

def run(page, url, label):
    page_errors = []
    req_failures = []

    # 捕获 console error
    def on_console(msg):
        if msg.type == "error":
            page_errors.append(f"  CONSOLE ERR: {msg.text[:200]}")
            print(f"  ❌ CONSOLE: {msg.text[:150]}")
    page.on("console", on_console)

    # 捕获网络失败
    def on_req_failed(req):
        req_failures.append(f"  REQ FAIL: {req.method} {req.url[:100]}")
        print(f"  ❌ REQ FAIL: {req.method} {req.url[:80]}")
    page.on("requestfailed", on_req_failed)

    try:
        page.goto(f"{BASE}/{url}", wait_until="networkidle", timeout=15000)
        page.wait_for_timeout(800)

        # 看有没有 el-empty / 表格数据
        empty = page.locator(".el-empty").count()
        rows = page.locator(".el-table__row").count()
        has_router = page.locator(".el-main").count()

        status = "OK" if has_router > 0 else "FAIL"
        if page_errors:
            status = "WARN"
        if empty > 0 and rows == 0:
            status = "WARN_EMPTY"

        print(f"  ✅ {label}: {status} | rows={rows} empty={empty} errors={len(page_errors)}")

        results.append({
            "url": url, "label": label, "status": status,
            "rows": rows, "empty": empty, "console_errors": page_errors,
            "req_failures": req_failures
        })
        return True
    except Exception as e:
        print(f"  ❌ {label}: EXCEPTION - {str(e)[:100]}")
        results.append({"url": url, "label": label, "status": "EXCEPTION", "error": str(e)[:150]})
        return False

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context()
    page = ctx.new_page()

    # ── Step 1: 登录 ──
    print("=" * 50)
    print("STEP 1: Login")
    print("=" * 50)
    page.goto(f"{BASE}/#/login", wait_until="networkidle", timeout=10000)
    page.wait_for_timeout(500)
    page.locator("input").fill(KEY)
    page.locator("button:has-text('进入管理后台')").click()
    page.wait_for_timeout(1500)
    current = page.url
    print(f"  After login URL: {current}")

    # ── Step 2: 逐页点击 ──
    print("\n" + "=" * 50)
    print("STEP 2: 17 页烟雾测试")
    print("=" * 50)
    for url, label in PAGES:
        run(page, url, label)

    # ── Step 3: 汇总 ──
    print("\n" + "=" * 50)
    print("STEP 3: 汇总")
    print("=" * 50)
    ok = [r for r in results if r["status"] == "OK"]
    warn = [r for r in results if r["status"] in ("WARN", "WARN_EMPTY")]
    fail = [r for r in results if r["status"] in ("FAIL", "EXCEPTION")]

    print(f"\n✅ OK:    {len(ok)} 页")
    print(f"⚠️  WARN: {len(warn)} 页")
    print(f"❌ FAIL:  {len(fail)} 页")

    if warn:
        print("\n⚠️ 需关注:")
        for r in warn:
            print(f"  [{r['status']}] {r['label']} ({r['url']}) rows={r.get('rows',0)}")
            for e in r.get("console_errors", []):
                print(f"    {e[:120]}")
            for f in r.get("req_failures", []):
                print(f"    {f[:120]}")

    if fail:
        print("\n❌ 需修复:")
        for r in fail:
            print(f"  [{r['status']}] {r['label']} ({r['url']}) - {r.get('error','')[:100]}")

    browser.close()
    sys.exit(0 if not fail else 1)
