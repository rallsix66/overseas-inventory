"""
BigSeller 库存数据抓取 — P5-SY2 菲律宾单仓加固版（第二次独立验收返工）
使用 Playwright persistent context，首次手动登录后自动复用
当前仅用于只读试跑：python tools/bigseller-scraper/bigseller_scraper.py

抓取结果输出为本地 JSON，不写入旧 SQLite 或当前 Supabase。

P5-SY2 第二次返工变更：
- Fix 1: 删除所有表头/表体任意 table 回退，仅通过 VXE 容器 + data 属性绑定
- Fix 2: 无法证明表头与表体来自同一 VXE 容器时明确失败
- Fix 3: 出现任意 column_mismatch 时明确失败，不生成正式 JSON
- Fix 4: 修复 raw_row_count 统计公式（移除冗余 column_mismatch 项）
- Fix 5: 提取纯函数 _validate_header_keywords / _parse_cell_rows 供不依赖登录的测试
"""
import os
import json
import sys
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RUNTIME_DIR = os.path.join(BASE_DIR, 'runtime')
PROFILE_DIR = os.path.join(RUNTIME_DIR, 'profile')
DEBUG_DIR = os.path.join(RUNTIME_DIR, 'debug')
OUTPUT_DIR = os.path.join(RUNTIME_DIR, 'output')
INVENTORY_URL = 'https://www.bigseller.pro/web/inventory/index.htm'

os.makedirs(PROFILE_DIR, exist_ok=True)
os.makedirs(DEBUG_DIR, exist_ok=True)
os.makedirs(OUTPUT_DIR, exist_ok=True)

# === 表头校验：每列的期望关键词（至少匹配一个即通过） ===
# BigSeller 库存表格列序（2026-06-12 确认: 13 列，索引 0 为空，索引 12 为操作）
EXPECTED_HEADERS = {
    1: ['SKU', '商品', '信息'],           # SKU信息
    2: ['仓库'],                            # 仓库
    3: ['现有库存', '当前库存', '库存'],   # 现有库存（旧称：当前库存）
    4: ['订单已锁', '锁定库存', '锁定'],   # 订单已锁（旧称：锁定库存）
    5: ['整仓可用', '可用库存', '可用'],   # 整仓可用（旧称：可用库存）
    6: ['在途中', '在途库存', '在途'],     # 在途中（旧称：在途库存）
    7: ['总成本', '成本'],                 # 总成本价
    8: ['警戒库存', '预警库存', '预警'],   # 警戒库存（旧称：预警库存）
    9: ['预测日销量', '日均销量', '日销量', '销量'],  # 预测日销量（旧称：日均销量）
    10: ['可售天数', '可售', '天数'],      # 预计可售天数
    11: ['备注'],                           # 备注
}

# 需要校验的关键列（这些列缺失或错位会导致字段错乱）
CRITICAL_COLUMNS = {1, 2, 3, 5, 6}  # SKU信息、仓库、当前库存、可用库存、在途库存

# VXE 容器标记属性名（用于跨 evaluate 调用绑定同一容器）
VXE_MARKER_ATTR = 'data-bigseller-scraper'


# =========================================================================
# 纯函数 — 不依赖 Playwright，可供测试直接调用
# =========================================================================

def _validate_header_keywords(headers):
    """纯函数：校验表头关键词。成功返回 None，失败抛出 RuntimeError。
    从 _validate_headers() 中提取，供结构保护测试使用。"""
    errors = []
    for col_idx, keywords in EXPECTED_HEADERS.items():
        if col_idx >= len(headers):
            errors.append(
                f'列{col_idx}缺失：期望关键词 {keywords}，但表格仅有 {len(headers)} 列'
            )
            continue
        actual = headers[col_idx]
        if not any(kw in actual for kw in keywords):
            errors.append(
                f'列{col_idx}不匹配：实际="{actual}"，期望包含关键词 {keywords}'
            )

    if errors:
        raise RuntimeError(
            '表头校验失败 - BigSeller 表格结构可能已变更:\n'
            + '\n'.join(f'  - {e}' for e in errors)
            + '\n请检查页面并更新 EXPECTED_HEADERS。'
        )


def _parse_cell_rows(cell_rows, header_count):
    """纯函数：校验每行列数与表头一致，并转换为 dict 列表。
    任意一行列数不匹配时抛出 RuntimeError。
    从 scrape() 中提取，供结构保护测试使用。

    返回 parsed_rows (list[dict])。
    """
    mismatched = []
    for i, cells in enumerate(cell_rows):
        if len(cells) != header_count:
            mismatched.append({
                'row_index': i,
                'actual_cols': len(cells),
                'expected_cols': header_count,
                'first_cells': cells[:3] if len(cells) >= 3 else cells,
            })

    if mismatched:
        details = '\n'.join(
            f'  行{m["row_index"]}: {m["actual_cols"]} 列 (期望 {m["expected_cols"]}), '
            f'前几列: {m["first_cells"]!r}'
            for m in mismatched[:10]
        )
        if len(mismatched) > 10:
            details += f'\n  ... 及其他 {len(mismatched) - 10} 行'
        raise RuntimeError(
            f'列数不匹配：{len(mismatched)} 行与已验证表头列数 '
            f'({header_count}) 不一致。'
            f'无法保证字段正确，BigSeller 页面结构可能已变更。\n{details}'
        )

    parsed_rows = []
    for cells in cell_rows:
        row = {
            'sku_info': cells[1] if len(cells) > 1 else '',
            'warehouse': cells[2] if len(cells) > 2 else '',
            'cur_stock': cells[3] if len(cells) > 3 else '',
            'locked': cells[4] if len(cells) > 4 else '',
            'available': cells[5] if len(cells) > 5 else '',
            'transit': cells[6] if len(cells) > 6 else '',
            'total_cost': cells[7] if len(cells) > 7 else '',
            'alert_stock': cells[8] if len(cells) > 8 else '',
            'daily_sales': cells[9] if len(cells) > 9 else '',
            'est_days': cells[10] if len(cells) > 10 else '',
            'remark': cells[11] if len(cells) > 11 else '',
        }
        parsed_rows.append(row)

    return parsed_rows


# =========================================================================
# Playwright 相关函数
# =========================================================================

def _validate_headers(page):
    """通过 VXE 容器绑定表头和表体，校验表头关键词。
    无任何回退 — 找不到 VXE 容器时明确失败。

    在 VXE 容器上设置 data-bigseller-scraper 标记属性，
    后续行提取通过该标记定位同一容器。

    返回 (header_count, xid)。"""
    result = page.evaluate("""
        () => {
            const containers = document.querySelectorAll('.vxe-table');
            let bestContainer = null;
            let bestHeaderCount = 0;

            for (const c of containers) {
                // BigSeller VXE 结构：header/body 是 <table> 元素本身（不是包裹 div）
                const headerTable = c.querySelector('table.vxe-table--header');
                const bodyTable = c.querySelector('table.vxe-table--body');
                if (!headerTable || !bodyTable) continue;
                const ths = headerTable.querySelectorAll('thead th');
                const trs = bodyTable.querySelectorAll('tbody tr');
                if (ths.length > 0 && trs.length > 0 && ths.length >= bestHeaderCount) {
                    bestHeaderCount = ths.length;
                    bestContainer = c;
                }
            }

            if (!bestContainer) {
                return {error: 'VXE_CONTAINER_NOT_FOUND',
                    detail: '未找到同时包含 table.vxe-table--header 和 table.vxe-table--body 的 VXE 容器'};
            }

            // 标记容器 — 后续行提取通过此标记绑定同一容器
            bestContainer.setAttribute('data-bigseller-scraper', 'target');

            const headerTable = bestContainer.querySelector('table.vxe-table--header');
            const ths = headerTable.querySelectorAll('thead th');
            const titles = Array.from(ths).map(th => th.textContent.trim());
            const xid = bestContainer.getAttribute('xid') || '';

            return {headers: titles, xid: xid, headerCount: titles.length};
        }
    """)

    if 'error' in result:
        raise RuntimeError(
            f'VXE 容器绑定失败：{result["detail"]}。'
            '无法证明表头与表体来自同一数据表。'
            'BigSeller 页面结构可能已变更，请检查页面。'
        )

    headers = result['headers']
    xid = result.get('xid', '')
    header_count = result.get('headerCount', len(headers))

    print(f'VXE 容器绑定成功: 检测到 {len(headers)} 列表头')
    for i, h in enumerate(headers):
        print(f'  列{i}: {h!r}  (repr)')
    with open(os.path.join(DEBUG_DIR, 'actual_headers.json'), 'w', encoding='utf-8') as f:
        json.dump(headers, f, ensure_ascii=False, indent=2)
        print(f'原始表头已保存: {DEBUG_DIR}/actual_headers.json')

    # 调用纯函数校验关键词
    _validate_header_keywords(headers)

    print(f'表头校验通过 ({header_count} 列)')
    if xid:
        print(f'  已绑定 VXE 容器 xid="{xid}"')

    return header_count, xid


def _extract_page_rows(page, header_count):
    """从当前页提取表体行。仅通过 data-bigseller-scraper 标记定位容器。
    无任何回退。任意一行列数不匹配时抛出 RuntimeError。"""
    result = page.evaluate("""
        (args) => {
            const expectedCols = args.headerCount;

            // 仅通过标记属性定位 — 无回退
            const container = document.querySelector('.vxe-table[data-bigseller-scraper="target"]');
            if (!container) {
                return {error: 'CONTAINER_NOT_FOUND',
                    detail: '未找到 data-bigseller-scraper="target" 标记的 VXE 容器'};
            }

            const bodyTable = container.querySelector('table.vxe-table--body');
            if (!bodyTable) {
                return {error: 'BODY_TABLE_NOT_FOUND',
                    detail: 'VXE 容器内未找到 table.vxe-table--body'};
            }

            const trs = bodyTable.querySelectorAll('tbody tr');
            if (trs.length === 0) {
                return {error: 'NO_ROWS', detail: '表体内无数据行'};
            }

            const result = [];
            const mismatched = [];

            for (let i = 0; i < trs.length; i++) {
                const tds = trs[i].querySelectorAll('td');
                if (tds.length !== expectedCols) {
                    mismatched.push({
                        row_index: i,
                        actual_cols: tds.length,
                        expected_cols: expectedCols,
                        preview: Array.from(tds).slice(0, 3).map(td => td.textContent.trim()),
                    });
                    continue;
                }
                const texts = Array.from(tds).map(td => td.textContent.trim());
                // 跳过全空行和操作按钮行
                if (!texts.some(t => t && !['添加','删除'].includes(t))) continue;
                result.push(texts);
            }

            // 列数不匹配 — 不静默跳过，向上抛出
            if (mismatched.length > 0) {
                return {error: 'COLUMN_MISMATCH', mismatched: mismatched,
                    detail: `${mismatched.length} 行列数与表头 ${expectedCols} 列不一致`};
            }

            return {rows: result};
        }
    """, {'headerCount': header_count})

    if 'error' in result:
        error_type = result['error']
        if error_type == 'COLUMN_MISMATCH':
            mismatched = result.get('mismatched', [])
            details = '\n'.join(
                f'  行{m["row_index"]}: {m["actual_cols"]} 列 (期望 {m["expected_cols"]}), '
                f'预览: {m["preview"]!r}'
                for m in mismatched[:10]
            )
            if len(mismatched) > 10:
                details += f'\n  ... 及其他 {len(mismatched) - 10} 行'
            raise RuntimeError(
                f'列数不匹配：{len(mismatched)} 行与已验证表头 ({header_count}) 列不一致。'
                f'无法保证字段正确 — 不生成正式 JSON。'
                f'BigSeller 页面结构可能已变更。\n{details}'
            )
        elif error_type == 'CONTAINER_NOT_FOUND':
            raise RuntimeError(
                f'表体绑定失败：{result["detail"]}。'
                '无法证明表体与已验证表头来自同一 VXE 容器。'
                'BigSeller 页面结构可能已变更（如 Ajax 翻页替换了 DOM）。'
            )
        elif error_type == 'BODY_TABLE_NOT_FOUND':
            raise RuntimeError(
                f'表体绑定失败：{result["detail"]}。'
                'VXE 容器结构可能已变更。'
            )
        elif error_type == 'NO_ROWS':
            return []  # 空表体不是错误，可能是最后一页
        else:
            raise RuntimeError(f'行提取失败：{result.get("detail", str(result))}')

    return result.get('rows', [])


def scrape():
    """抓取库存页面表格数据，返回 (rows, metadata, invalid_sku_rows)"""
    from playwright.sync_api import sync_playwright

    with sync_playwright() as p:
        chrome_path = None
        for pth in [
            r'C:\Program Files\Google\Chrome\Application\chrome.exe',
            r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
        ]:
            if os.path.exists(pth):
                chrome_path = pth
                break

        headless = os.environ.get('BS_HEADLESS', '0') == '1'

        user_agent = (
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) '
            'AppleWebKit/537.36 (KHTML, like Gecko) '
            'Chrome/138.0.0.0 Safari/537.36'
        )

        launch_args = [
            '--disable-blink-features=AutomationControlled',
            '--no-sandbox',
            '--ignore-certificate-errors',
            '--ignore-ssl-errors',
            '--disable-features=TranslateUI,OptimizationHints,MediaRouter',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-sync',
            '--no-default-browser-check',
            '--no-first-run',
            '--disable-default-apps',
            '--disable-breakpad',
            '--disable-component-update',
            '--disable-domain-reliability',
            '--disable-features=AudioServiceOutOfProcess,IsolateOrigins,site-per-process',
        ]

        if headless:
            launch_args.extend([
                '--disable-gpu',
                '--disable-dev-shm-usage',
                '--disable-software-rasterizer',
                '--window-size=1920,1080',
                '--start-maximized',
            ])

        context = p.chromium.launch_persistent_context(
            user_data_dir=PROFILE_DIR,
            headless=headless,
            executable_path=chrome_path,
            args=launch_args,
            ignore_https_errors=True,
            viewport={'width': 1400, 'height': 900},
            user_agent=user_agent,
        )

        # 注入反检测脚本
        context.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => false });
            window.chrome = {
                runtime: { },
                loadTimes: function() {},
                csi: function() {},
                app: {}
            };
            const origQuery = navigator.permissions.query.bind(navigator.permissions);
            navigator.permissions.query = (params) => {
                if (params.name === 'notifications') {
                    return Promise.resolve({ state: Notification.permission, onchange: null });
                }
                return origQuery(params);
            };
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            Object.defineProperty(navigator, 'languages', { get: () => ['zh-CN', 'zh', 'en-US', 'en'] });
            Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
            Object.defineProperty(navigator, 'deviceMemory', { get: () => 8 });
        """)

        page = context.new_page()

        try:
            page.goto(INVENTORY_URL, wait_until='domcontentloaded', timeout=60000)
            page.wait_for_timeout(4000)

            # 调试：保存初始页面截图和 URL
            print(f'当前 URL: {page.url}')
            page.screenshot(path=os.path.join(DEBUG_DIR, 'bigseller_initial.png'))
            print(f'初始截图已保存: {DEBUG_DIR}/bigseller_initial.png')

            # 仅建立会话模式：在确认登录状态后立即持久化 cookie 并退出
            # 放在 captcha/login 检测之前，避免误入 captcha/login 等待循环
            if os.environ.get('BS_SESSION_ONLY', '0') == '1':
                _session_only_flow(page, context)
                return [], {'session_only': True, 'warehouse': os.environ.get('BS_TARGET_WAREHOUSE_NAME', '')}, [], []

            # 检测腾讯验证码（滑块拼图），等待手动完成
            # 仅当 CAPTCHA 元素实际可见（占屏幕空间）才认为需要验证
            has_captcha = page.evaluate("""() => {
                const el = document.querySelector('.tencent-captcha-dy__warp')
                    || document.querySelector('#tCaptchaDyMainWrap')
                    || document.querySelector('[id^="tcaptcha"]');
                if (!el) return false;
                const rect = el.getBoundingClientRect();
                return rect.width > 0 && rect.height > 0;
            }""")
            if has_captcha:
                if headless:
                    # Headless 模式：尝试关闭验证码弹窗，表格数据已在 DOM 中
                    print('检测到验证码弹窗，尝试关闭...')
                    try:
                        close_btn = page.query_selector(
                            '.tencent-captcha-dy__header-close, '
                            '#tCaptchaDyMainWrap [class*="close"], '
                            '[id^="tcaptcha"] [class*="close"]'
                        )
                        if close_btn:
                            close_btn.click()
                            page.wait_for_timeout(2000)
                    except Exception:
                        pass
                    page.keyboard.press('Escape')
                    page.wait_for_timeout(2000)
                    still_captcha = page.evaluate("""() => {
                        const el = document.querySelector('.tencent-captcha-dy__warp')
                            || document.querySelector('#tCaptchaDyMainWrap')
                            || document.querySelector('[id^="tcaptcha"]');
                        if (!el) return false;
                        const rect = el.getBoundingClientRect();
                        return rect.width > 0 && rect.height > 0;
                    }""")
                    if still_captcha:
                        print('验证码弹窗无法自动关闭，但表格数据已加载，继续抓取...')
                    else:
                        print('验证码弹窗已关闭')
                    page.wait_for_timeout(2000)
                else:
                    # Headed 模式：等待用户手动完成验证码
                    print('=' * 50)
                    print('检测到安全验证（腾讯滑块拼图），请在浏览器中手动完成验证')
                    print('脚本将自动检测验证完成，最长等待 5 分钟...')
                    print('=' * 50)
                    for i in range(300):
                        page.wait_for_timeout(1000)
                        try:
                            still_captcha = page.evaluate("""() => {
                                const el = document.querySelector('.tencent-captcha-dy__warp')
                                    || document.querySelector('#tCaptchaDyMainWrap')
                                    || document.querySelector('[id^="tcaptcha"]');
                                if (!el) return false;
                                const rect = el.getBoundingClientRect();
                                return rect.width > 0 && rect.height > 0;
                            }""")
                        except Exception:
                            print('验证通过（页面已刷新），继续...')
                            still_captcha = False
                        if not still_captcha:
                            break
                        if i % 10 == 0 and i > 0:
                            print(f'  等待中... ({i}秒)')
                    else:
                        print('验证超时！请手动刷新页面后重试。')
                        context.close()
                        return [], {}, [], []
                    page.wait_for_timeout(3000)

            # 如果跳转到了登录页，等待手动登录（最多等3分钟）
            is_login_page = (
                'login' in page.url.lower()
                or 'signin' in page.url.lower()
                or page.evaluate("""() => {
                    return !!(
                        document.querySelector('input[type="password"]')
                        && (document.querySelector('input[type="text"]') || document.querySelector('input[type="email"]'))
                        && !document.querySelector('table.vxe-table--body')
                    );
                }""")
            )
            if is_login_page:
                if headless:
                    print('错误：headless 模式下需要登录，请在库存同步页面点击「重新建立登录会话」按钮，系统会自动打开浏览器供您登录')
                    page.screenshot(path=os.path.join(DEBUG_DIR, 'bigseller_login.png'))
                    context.close()
                    return [], {}, [], []
                print('=' * 50)
                print('检测到登录页，请在浏览器中手动登录（邮箱密码+验证码）')
                print('脚本将自动检测登录完成，最长等待 3 分钟...')
                print('=' * 50)
                for i in range(180):
                    page.wait_for_timeout(1000)
                    current_url = page.url.lower()
                    still_login = (
                        'login' in current_url
                        or 'signin' in current_url
                    )
                    if not still_login:
                        try:
                            still_login = page.evaluate("""() => {
                                return !!(
                                    document.querySelector('input[type="password"]')
                                    && !document.querySelector('table.vxe-table--body')
                                );
                            }""")
                        except Exception:
                            still_login = False
                    if not still_login:
                        print('检测到登录成功，继续...')
                        break
                    if i % 10 == 0 and i > 0:
                        print(f'  等待中... ({i}秒)')
                else:
                    print('超时！请检查登录状态。')
                # 确保在库存页
                if 'inventory' not in page.url.lower():
                    page.goto(INVENTORY_URL, wait_until='domcontentloaded', timeout=60000)
                page.wait_for_timeout(6000)

            # 等表格出现
            try:
                page.wait_for_selector('table tbody tr', timeout=30000)
            except Exception:
                page.screenshot(path=os.path.join(DEBUG_DIR, 'bigseller_debug.png'))
                # 保存页面 HTML 和文本用于调试
                try:
                    with open(os.path.join(DEBUG_DIR, 'bigseller_page_timeout.html'), 'w', encoding='utf-8') as f:
                        f.write(page.content())
                except Exception:
                    pass
                # 检查页面 body 文本
                body_text = page.evaluate("() => document.body ? document.body.innerText.substring(0, 500) : 'NO BODY'")
                print(f'页面 body 前 500 字符: {body_text}')
                context.close()
                return [], {}, [], []

            page.wait_for_timeout(2000)

            # === 关闭已知语言引导遮罩（仅处理已知遮罩，不通用删除所有模态层） ===
            dismiss_selectors = [
                '.language_switch_guide_mask',
            ]
            for sel in dismiss_selectors:
                try:
                    page.evaluate(f"""
                        const els = document.querySelectorAll('{sel}');
                        els.forEach(el => el.remove());
                    """)
                except Exception:
                    pass
            close_btns = [
                '.language_switch_guide_mask + div .ant-btn',
            ]
            for btn_sel in close_btns:
                try:
                    btn = page.query_selector(btn_sel)
                    if btn:
                        btn.click(timeout=3000)
                        page.wait_for_timeout(500)
                except Exception:
                    pass
            page.wait_for_timeout(500)

            # ==================================================================
            # 仓库名称优先 — 先按精确文字定位，autoid 仅作验证后回退
            # ==================================================================
            TARGET_WAREHOUSE_NAME = os.environ.get('BS_TARGET_WAREHOUSE_NAME', '印尼-DEE仓库')

            # 1. 点击仓库多选组件 .inp_box 打开下拉
            inp_box = page.query_selector('.inp_box')
            if not inp_box:
                print('ERROR: 未找到仓库选择器 (.inp_box)')
                context.close()
                return [], {}, []
            inp_box.click()
            page.wait_for_timeout(1500)

            # 2. 枚举下拉中所有仓库 label
            warehouse_options = page.evaluate("""() => {
                const labels = document.querySelectorAll('label.ant-checkbox-wrapper');
                const results = [];
                for (const label of labels) {
                    const span = label.querySelector('span[autoid]');
                    const text = label.textContent.trim();
                    if (span) {
                        results.push({
                            autoid: span.getAttribute('autoid'),
                            text: text
                        });
                    }
                }
                return results;
            }""")

            print(f'下拉中检测到 {len(warehouse_options)} 个仓库选项:')
            for opt in warehouse_options:
                print(f'  autoid={opt["autoid"]}  text="{opt["text"]}"')

            # 3. 优先按精确仓库名称定位
            found_autoid = None
            for opt in warehouse_options:
                if opt['text'] == TARGET_WAREHOUSE_NAME:
                    found_autoid = opt['autoid']
                    break

            if found_autoid:
                print(f'\n按名称定位到目标仓库: autoid="{found_autoid}" text="{TARGET_WAREHOUSE_NAME}"')
                target_autoids = [found_autoid]
            else:
                # 回退：按仓库名关键词子串匹配（VN 仓 autoid 未知，不硬编码）
                print(f'\nWARNING: 未找到名称精确匹配 "{TARGET_WAREHOUSE_NAME}" 的仓库')
                FALLBACK_KEYWORD = 'DEE'
                fallback_match = None
                for opt in warehouse_options:
                    if FALLBACK_KEYWORD in opt['text']:
                        fallback_match = opt
                        break

                if fallback_match is None:
                    raise RuntimeError(
                        f'仓库定位失败：未找到名称包含 "{FALLBACK_KEYWORD}" 的仓库选项。'
                        f'页面仓库选项: {[(o["autoid"], o["text"]) for o in warehouse_options]}'
                    )

                print(f'按关键词 "{FALLBACK_KEYWORD}" 匹配到: autoid="{fallback_match["autoid"]}" text="{fallback_match["text"]}"')
                print(f'（目标名 "{TARGET_WAREHOUSE_NAME}" 与页面显示 "{fallback_match["text"]}" 不一致，已更新为页面名称）')
                TARGET_WAREHOUSE_NAME = fallback_match['text']
                target_autoids = [fallback_match['autoid']]

            # 4. 取消所有非目标仓库
            try:
                all_checked = page.evaluate("""() => {
                    const labels = document.querySelectorAll('label.ant-checkbox-wrapper');
                    const checkedIds = [];
                    for (const label of labels) {
                        const cb = label.querySelector('input[type="checkbox"]');
                        if (cb && cb.checked) {
                            const span = label.querySelector('span[autoid]');
                            if (span) checkedIds.push(span.getAttribute('autoid'));
                        }
                    }
                    return checkedIds;
                }""")
                deselected = 0
                for autoid in all_checked:
                    if autoid not in target_autoids:
                        try:
                            el = page.query_selector(f'[autoid="{autoid}"]')
                            if el:
                                label_el = page.evaluate_handle(
                                    """(el) => el.closest('label.ant-checkbox-wrapper')""", el
                                )
                                if label_el:
                                    label_el.as_element().click()
                                    page.wait_for_timeout(200)
                                    deselected += 1
                        except Exception:
                            pass
                if deselected:
                    print(f'已取消 {deselected} 个非目标仓库')
            except Exception as e:
                print(f'取消已选仓库时出错（非致命）: {e}')

            # 5. 点击目标仓库的 checkbox label
            checked = 0
            for autoid in target_autoids:
                try:
                    el = page.query_selector(f'[autoid="{autoid}"]')
                    if not el:
                        print(f'  WARNING: 未找到 {autoid}')
                        continue
                    label_el = page.evaluate_handle(
                        """(el) => el.closest('label.ant-checkbox-wrapper')""", el
                    )
                    if not label_el:
                        print(f'  WARNING: {autoid} 无父级 label')
                        continue
                    is_checked = page.evaluate("""(label) => {
                        const cb = label.querySelector('input[type="checkbox"]');
                        return cb ? cb.checked : false;
                    }""", label_el)
                    if not is_checked:
                        label_el.as_element().click()
                        page.wait_for_timeout(300)
                        checked += 1
                except Exception as e:
                    print(f'  点击 {autoid} 失败: {e}')
            print(f'选中 {checked} 个目标仓库')

            page.screenshot(path=os.path.join(DEBUG_DIR, 'bigseller_wh_dropdown.png'))

            # 6. 点击"确 定"按钮
            confirm_btn = page.query_selector('.option_action .ant-btn-blue')
            if confirm_btn:
                confirm_btn.click()
                page.wait_for_timeout(3000)
                print('已确认仓库选择')
            else:
                page.keyboard.press('Escape')
                page.wait_for_timeout(500)
                print('WARNING: 未找到确认按钮')

            # === 筛选单个SKU（排除组合SKU） ===
            try:
                single_sku_btn = page.query_selector('[autoid="single_sku"]')
                if single_sku_btn:
                    single_sku_btn.click()
                    page.wait_for_timeout(2000)
                    print('已筛选: 单个SKU')
            except Exception as e:
                print(f'WARNING: 点击单个SKU失败: {e}')

            # ==================================================================
            # 表头校验 — VXE 容器绑定，无回退（同时在容器上设置标记属性）
            # ==================================================================
            header_count, xid = _validate_headers(page)

            # ==================================================================
            # 翻页抓取 — 仅通过标记属性定位，无回退；列数不匹配则失败
            # ==================================================================
            all_cell_rows = []  # 原始 cell 数组（已通过列数校验）
            page_num = 1
            while True:
                page.wait_for_timeout(2000)

                try:
                    page_rows = _extract_page_rows(page, header_count)
                except RuntimeError:
                    # 列数不匹配或容器未找到 — 重新抛出，不生成 JSON
                    raise

                print(f'  第 {page_num} 页: {len(page_rows)} 行')
                all_cell_rows.extend(page_rows)

                # 下一页
                has_next = page.evaluate("""
                    () => {
                        const nextBtn = document.querySelector('.ant-pagination-next');
                        return nextBtn && !nextBtn.classList.contains('ant-pagination-disabled');
                    }
                """)

                if not has_next:
                    break

                page.evaluate("""() => {
                    const nextBtn = document.querySelector('.ant-pagination-next');
                    if (nextBtn) nextBtn.click();
                }""")
                page_num += 1

            raw_row_count = len(all_cell_rows)
            print(f'\n===== 共 {page_num} 页, {raw_row_count} 行原始数据（全部通过 {header_count} 列校验） =====')

            if not all_cell_rows:
                print('ERROR: 未提取到任何数据')
                context.close()
                return [], {}, []

            # 调用纯函数解析（列数校验已在 _extract_page_rows 中完成）
            parsed_rows = _parse_cell_rows(all_cell_rows, header_count)

            # === 仓库名称过滤：仅保留目标仓库 ===
            other_warehouse_count = 0
            filtered_rows = []
            for r in parsed_rows:
                wh = r.get('warehouse', '')
                if wh == TARGET_WAREHOUSE_NAME:
                    filtered_rows.append(r)
                else:
                    other_warehouse_count += 1
            if other_warehouse_count:
                print(f'仓库过滤: 排除 {other_warehouse_count} 条非 "{TARGET_WAREHOUSE_NAME}" 行')
            parsed_rows = filtered_rows

            # ==================================================================
            # 去重与统计 — 无效 SKU 完整记录保存到 debug JSON
            # ==================================================================
            dedup_map = {}
            combo_excluded_count = 0
            combo_sku_rows = []
            invalid_sku_count = 0
            invalid_sku_rows = []

            for r in parsed_rows:
                sku_info = r.get('sku_info', '')
                if _is_combo(sku_info):
                    combo_excluded_count += 1
                    combo_sku_rows.append({
                        'sku_info': sku_info,
                        'warehouse': r.get('warehouse', ''),
                        'cur_stock': r.get('cur_stock', ''),
                        'locked': r.get('locked', ''),
                        'available': r.get('available', ''),
                        'transit': r.get('transit', ''),
                        'daily_sales': r.get('daily_sales', ''),
                        'est_days': r.get('est_days', ''),
                        'remark': r.get('remark', ''),
                    })
                    continue
                sku = _extract_sku(sku_info)
                wh = r.get('warehouse', '')
                if not sku:
                    invalid_sku_count += 1
                    invalid_sku_rows.append({
                        'sku_info': sku_info,
                        'warehouse': wh,
                        'cur_stock': r.get('cur_stock', ''),
                        'locked': r.get('locked', ''),
                        'available': r.get('available', ''),
                        'transit': r.get('transit', ''),
                        'daily_sales': r.get('daily_sales', ''),
                        'est_days': r.get('est_days', ''),
                        'remark': r.get('remark', ''),
                    })
                    continue
                key = (sku, wh)
                if key not in dedup_map or _row_score(r) > _row_score(dedup_map[key]):
                    dedup_map[key] = r
            unique_rows = list(dedup_map.values())
            dedup_count = len(parsed_rows) - combo_excluded_count - invalid_sku_count - len(unique_rows)
            final_count = len(unique_rows)

            # 输出统计（Fix 4: column_mismatch 始终为 0，因为出现则不生成 JSON）
            print(f'\n===== 数据统计 =====')
            print(f'  原始行数 (全部通过列数校验): {raw_row_count}')
            print(f'  非目标仓库:                    {other_warehouse_count}')
            print(f'  组合SKU排除:                   {combo_excluded_count}')
            print(f'  无效SKU(无码):                 {invalid_sku_count}')
            print(f'  重复行去除:                    {dedup_count}')
            print(f'  最终行数:                      {final_count}')
            check_val = raw_row_count - other_warehouse_count - combo_excluded_count - invalid_sku_count - dedup_count
            print(f'  校验: {raw_row_count} raw - {other_warehouse_count} other_wh - {combo_excluded_count} combo - {invalid_sku_count} invalid - {dedup_count} dup = {check_val}'
                  + (' == final' if check_val == final_count else f' != {final_count} MISMATCH!'))

            # 保存无效 SKU 完整记录
            if invalid_sku_rows:
                invalid_path = os.path.join(DEBUG_DIR, 'invalid_sku_rows.json')
                with open(invalid_path, 'w', encoding='utf-8') as f:
                    json.dump({
                        'count': len(invalid_sku_rows),
                        'description': 'SKU 码无法提取的行，完整保留原始字段供追溯',
                        'rows': invalid_sku_rows,
                    }, f, ensure_ascii=False, indent=2)
                print(f'\n无效 SKU 完整记录已保存: {invalid_path}')
                print(f'  共 {len(invalid_sku_rows)} 条，包含 sku_info/warehouse/cur_stock/locked/available/transit')

            # 保存组合 SKU 完整记录
            if combo_sku_rows:
                combo_path = os.path.join(DEBUG_DIR, 'combo_sku_rows.json')
                with open(combo_path, 'w', encoding='utf-8') as f:
                    json.dump({
                        'count': len(combo_sku_rows),
                        'description': '被 _is_combo() 检测排除的组合 SKU 行，完整保留原始字段供追溯',
                        'rows': combo_sku_rows,
                    }, f, ensure_ascii=False, indent=2)
                print(f'\n组合 SKU 完整记录已保存: {combo_path}')
                print(f'  共 {len(combo_sku_rows)} 条，包含 sku_info/warehouse/cur_stock/locked/available/transit')

            # 样本输出
            zero_stock_rows = [r for r in unique_rows if int_or_zero(r.get('available', '0')) == 0]
            print(f'\n  零可用库存行: {len(zero_stock_rows)} 条')
            if zero_stock_rows:
                print(f'  零库存样本 (前3):')
                for r in zero_stock_rows[:3]:
                    print(f'    仓库={r["warehouse"]} | 可用={r["available"]} | 在途={r["transit"]} | SKU={_extract_sku(r.get("sku_info",""))}')

            for r in unique_rows[:3]:
                print(f'  样本: 仓库={r["warehouse"]} | 可用={r["available"]} | 在途={r["transit"]} | 日销={r["daily_sales"]} | 可售天={r["est_days"]}')

            # ==================================================================
            # 复核清单：需要人工二次确认的产品
            # ==================================================================
            review_items = []
            if combo_sku_rows:
                review_items.append(('COMBO_SKU', combo_sku_rows))
            if invalid_sku_rows:
                review_items.append(('INVALID_SKU', invalid_sku_rows))

            if review_items:
                print()
                print('=' * 60)
                print('*** 需要复核的产品 — 请人工确认后决定是否纳入 ***')
                print('=' * 60)
                for category, rows in review_items:
                    if category == 'COMBO_SKU':
                        label = '组合SKU检测 ( _is_combo() 命中 )'
                    else:
                        label = '无效SKU ( 无法提取SKU码 )'
                    print(f'\n[{label}] 共 {len(rows)} 条:')
                    print('-' * 50)
                    for i, r in enumerate(rows, 1):
                        si = r.get('sku_info', '')
                        wh = r.get('warehouse', '')
                        avail = r.get('available', '0')
                        transit = r.get('transit', '0')
                        sales = r.get('daily_sales', '-')
                        print(f'  {i}. SKU信息: {si}')
                        print(f'     仓库={wh} | 可用={avail} | 在途={transit} | 日销={sales}')
                print()
                print(f'处理方式:')
                print(f'  - 以上产品已被排除，未加入正式 rows')
                print(f'  - 完整记录已保存到 {DEBUG_DIR}/combo_sku_rows.json 和 invalid_sku_rows.json')
                print(f'  - 如需纳入，请修改 _is_combo() 或 _extract_sku() 后重新抓取')
                print('=' * 60)
                print()

            # 调试输出
            html_path = os.path.join(DEBUG_DIR, 'bigseller_page.html')
            try:
                with open(html_path, 'w', encoding='utf-8') as f:
                    f.write(page.content())
                    print(f'页面 HTML 已保存: {html_path}')
            except Exception:
                pass

            page.screenshot(path=os.path.join(DEBUG_DIR, 'bigseller_debug.png'))
            with open(os.path.join(DEBUG_DIR, 'bigseller_headers.json'), 'w', encoding='utf-8') as f:
                json.dump({
                    'raw_row_count': raw_row_count,
                    'other_warehouse_count': other_warehouse_count,
                    'combo_excluded_count': combo_excluded_count,
                    'combo_sku_rows_saved': len(combo_sku_rows),
                    'invalid_sku_count': invalid_sku_count,
                    'dedup_count': dedup_count,
                    'final_count': final_count,
                    'invalid_sku_rows_saved': len(invalid_sku_rows),
                    'header_count': header_count,
                }, f, ensure_ascii=False, indent=2)

            print(f'抓取完成: {final_count} 行数据')

            metadata = {
                'warehouse': TARGET_WAREHOUSE_NAME,
                'raw_row_count': raw_row_count,
                'other_warehouse_count': other_warehouse_count,
                'combo_excluded_count': combo_excluded_count,
                'combo_sku_rows_saved': len(combo_sku_rows),
                'invalid_sku_count': invalid_sku_count,
                'invalid_sku_rows_saved': len(invalid_sku_rows),
                'dedup_count': dedup_count,
                'final_count': final_count,
                'zero_available_count': len(zero_stock_rows),
                'pages': page_num,
                'header_count': header_count,
            }

            _persist_session_cookies(context)
            context.close()
            return unique_rows, metadata, invalid_sku_rows, combo_sku_rows

        except Exception as e:
            try:
                page.screenshot(path=os.path.join(DEBUG_DIR, 'bigseller_error.png'))
            except Exception:
                pass
            print(f'抓取出错: {e}')
            try:
                _persist_session_cookies(context)
            except Exception:
                pass
            try:
                context.close()
            except Exception:
                pass
            raise


def _session_only_flow(page, context):
    """BS_SESSION_ONLY 模式：检测页面状态，完成登录/验证码后持久化 cookie 并退出。

    三种情况：
    1. 已在库存页（有表格）→ 立即持久化并关闭
    2. 登录页 → 等待用户手动登录，然后持久化并关闭
    3. 验证码 → 等待用户手动完成，然后持久化并关闭
    """
    # 情况 1：已在库存页（已有有效登录会话）
    on_inventory = 'inventory' in page.url.lower()
    if on_inventory:
        try:
            page.wait_for_selector('table tbody tr', timeout=10000)
            print('[session-only] 已确认登录成功（库存页），正在持久化会话...')
            _persist_session_cookies(context)
            context.close()
            print('[session-only] 会话持久化完成，浏览器已关闭。')
            return
        except Exception:
            pass  # 表格未出现，继续检查登录页/验证码

    # 情况 2：检查是否需要登录
    is_login = (
        'login' in page.url.lower()
        or 'signin' in page.url.lower()
        or page.evaluate("""() => {
            return !!(
                document.querySelector('input[type="password"]')
                && (document.querySelector('input[type="text"]') || document.querySelector('input[type="email"]'))
                && !document.querySelector('table.vxe-table--body')
            );
        }""")
    )
    if is_login:
        print('=' * 50)
        print('[session-only] 检测到登录页，请在浏览器中手动登录（邮箱密码+验证码）')
        print('登录成功后浏览器将自动关闭并持久化会话，最长等待 3 分钟...')
        print('=' * 50)
        for i in range(180):
            page.wait_for_timeout(1000)
            current_url = page.url.lower()
            still_login = (
                'login' in current_url
                or 'signin' in current_url
            )
            if not still_login:
                try:
                    still_login = page.evaluate("""() => {
                        return !!(
                            document.querySelector('input[type="password"]')
                            && !document.querySelector('table.vxe-table--body')
                        );
                    }""")
                except Exception:
                    still_login = False
            if not still_login:
                print('[session-only] 检测到登录成功，正在持久化会话...')
                break
            if i % 10 == 0 and i > 0:
                print(f'  等待中... ({i}秒)')
        else:
            print('[session-only] 登录超时，会话未持久化。')
            context.close()
            return
        # 确保在库存页
        if 'inventory' not in page.url.lower():
            page.goto(INVENTORY_URL, wait_until='domcontentloaded', timeout=60000)
        page.wait_for_timeout(4000)
        _persist_session_cookies(context)
        context.close()
        print('[session-only] 会话持久化完成，浏览器已关闭。')
        return

    # 情况 3：检查验证码
    has_captcha = page.evaluate("""() => {
        const el = document.querySelector('.tencent-captcha-dy__warp')
            || document.querySelector('#tCaptchaDyMainWrap')
            || document.querySelector('[id^="tcaptcha"]');
        if (!el) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }""")
    if has_captcha:
        print('=' * 50)
        print('[session-only] 检测到安全验证（腾讯滑块拼图），请在浏览器中手动完成验证')
        print('验证通过后浏览器将自动关闭并持久化会话，最长等待 5 分钟...')
        print('=' * 50)
        for i in range(300):
            page.wait_for_timeout(1000)
            try:
                still_captcha = page.evaluate("""() => {
                    const el = document.querySelector('.tencent-captcha-dy__warp')
                        || document.querySelector('#tCaptchaDyMainWrap')
                        || document.querySelector('[id^="tcaptcha"]');
                    if (!el) return false;
                    const rect = el.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                }""")
            except Exception:
                print('[session-only] 验证通过（页面已刷新），正在持久化会话...')
                still_captcha = False
            if not still_captcha:
                break
            if i % 10 == 0 and i > 0:
                print(f'  等待中... ({i}秒)')
        else:
            print('[session-only] 验证超时，会话未持久化。')
            context.close()
            return
        page.wait_for_timeout(3000)
        _persist_session_cookies(context)
        context.close()
        print('[session-only] 会话持久化完成，浏览器已关闭。')
        return

    # 无法识别的页面状态
    page.screenshot(path=os.path.join(DEBUG_DIR, 'bigseller_debug.png'))
    print(f'[session-only] 无法识别的页面状态，URL: {page.url}，截图已保存到 debug 目录')
    context.close()


def _persist_session_cookies(context):
    """通过 Playwright API 将 BigSeller session cookie 转为持久化。

    Chromium 在退出时会删除所有 is_persistent=0 的 session cookie。
    此函数必须在 context.close() 之前调用，通过 Playwright cookie API
    读取当前会话中的所有 BigSeller cookie，将 expires 改为未来时间后
    重新写入，从而在浏览器关闭后保留登录状态。
    """
    import time

    try:
        cookies = context.cookies()
    except Exception:
        print('[session-persist] 无法获取 cookies，跳过持久化')
        return

    future = int(time.time()) + 90 * 24 * 3600  # +90 天
    modified = 0

    for c in cookies:
        domain = c.get('domain', '')
        if 'bigseller' in domain and c.get('expires', 0) <= 0:
            c['expires'] = future
            modified += 1

    if modified > 0:
        try:
            context.add_cookies(cookies)
            print(f'[session-persist] 已将 {modified} 个 BigSeller session cookie 转为持久化（过期=+90天）')
        except Exception as e:
            print(f'[session-persist] add_cookies 失败: {e}')
    else:
        print('[session-persist] 无需转换（所有 BigSeller cookie 已是持久化状态）')


def save_json(rows, metadata=None, invalid_sku_rows=None, combo_sku_rows=None):
    """将只读试跑结果保存为本地 JSON，供后续字段映射审查。"""
    if not rows:
        return None

    normalized_rows = []
    for row in rows:
        sku_info = row.get('sku_info', '')
        normalized_rows.append({
            'sku': _extract_sku(sku_info),
            'product_name': _extract_product_name(sku_info),
            'warehouse': row.get('warehouse', ''),
            'current_quantity': int_or_zero(row.get('cur_stock', '0')),
            'locked_quantity': int_or_zero(row.get('locked', '0')),
            'available_quantity': int_or_zero(row.get('available', '0')),
            'transit_quantity': int_or_zero(row.get('transit', '0')),
            'daily_sales': float_or_none(row.get('daily_sales', '')),
            'estimated_days': float_or_none(row.get('est_days', '')),
            'raw': row,
        })

    filename = f'bigseller-inventory-{datetime.now().strftime("%Y%m%d-%H%M%S")}.json'
    output_path = os.path.join(OUTPUT_DIR, filename)

    output_warehouse = (
        (metadata or {}).get('warehouse')
        or (rows[0].get('warehouse') if rows else '')
    )
    output = {
        'captured_at': datetime.now().astimezone().isoformat(timespec='seconds'),
        'warehouse': output_warehouse,
        'row_count': len(normalized_rows),
        'rows': normalized_rows,
    }
    if metadata:
        output['metadata'] = metadata

    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f'只读试跑结果已保存: {output_path}')

    if invalid_sku_rows:
        invalid_out_path = os.path.join(OUTPUT_DIR,
            f'invalid-sku-rows-{datetime.now().strftime("%Y%m%d-%H%M%S")}.json')
        with open(invalid_out_path, 'w', encoding='utf-8') as f:
            json.dump({
                'captured_at': datetime.now().astimezone().isoformat(timespec='seconds'),
                'count': len(invalid_sku_rows),
                'description': 'SKU 码无法提取的行，完整保留原始字段供追溯。不加入正式 rows。',
                'rows': invalid_sku_rows,
            }, f, ensure_ascii=False, indent=2)
        print(f'无效 SKU 记录已保存: {invalid_out_path}')

    if combo_sku_rows:
        combo_out_path = os.path.join(OUTPUT_DIR,
            f'combo-sku-rows-{datetime.now().strftime("%Y%m%d-%H%M%S")}.json')
        with open(combo_out_path, 'w', encoding='utf-8') as f:
            json.dump({
                'captured_at': datetime.now().astimezone().isoformat(timespec='seconds'),
                'count': len(combo_sku_rows),
                'description': '被 _is_combo() 检测排除的组合 SKU 行，完整保留原始字段供追溯。不加入正式 rows。',
                'rows': combo_sku_rows,
            }, f, ensure_ascii=False, indent=2)
        print(f'组合 SKU 记录已保存: {combo_out_path}')

    return output_path


# =========================================================================
# 纯函数 — SKU 处理
# =========================================================================

def _is_combo(sku_info):
    """检测是否为组合SKU。"""
    import re
    if not sku_info:
        return False
    if re.search(r'\d+\s*[瓶个只盒]\s*[\+＋]', sku_info):
        return True
    # 第二个模式：两个 SKU 码用 + 拼接，如 "WM1234+WM5678"
    # 注意：+ 后不允许空格，避免误判 "SPF90+ 6974674958025" 这类产品规格中的 + 号
    if re.search(r'[A-Z0-9]{5,}\*?\d*\s*[\+＋][A-Z0-9]{5,}', sku_info):
        return True
    return False


def _extract_sku(sku_info):
    """从 BigSeller SKU 信息提取 SKU 码。"""
    import re
    if not sku_info:
        return ''
    text = re.sub(r'\s*(送货|在途|已完成|处理中|待处理|复制)\s*$', '', sku_info)
    text = re.sub(r'(\*)\d+', '', text)
    m = re.search(r'\b(ICEWM\d+)\b', text, re.IGNORECASE)
    if m:
        return m.group(1)
    m = re.search(r'\b(CHIC-WM\d+-[A-Z]\d+)\b', text, re.IGNORECASE)
    if m:
        return m.group(1)
    m = re.search(r'\b([A-Z]{3,}[A-Z0-9]*-\d+(?:-[A-Z]\d+)?)\b', text)
    if m:
        return m.group(1)
    m = re.search(r'\b(WM\d+(?:-[A-Z#]?\d+)?)\b', text)
    if m:
        return m.group(1)
    m = re.search(r'\b(\d{12,13})\b', text)
    if m:
        return m.group(1)
    m = re.search(r'\b(\d{6,11})\b', text)
    if m:
        return m.group(1)
    parts = text.split()
    brands = {'CHICPEAK', 'CHIC', 'ICE', 'ICELERSKIN', 'LERSKIN', 'PEAK'}
    for p in parts:
        p_clean = p.strip('*')
        if re.match(r'^[A-Za-z0-9][A-Za-z0-9\-]+$', p_clean) and len(p_clean) >= 5 and p_clean.upper() not in brands:
            return p_clean
    return ''


def _extract_product_name(sku_info):
    """从 BigSeller SKU信息列提取产品名。"""
    import re
    if not sku_info:
        return ''
    text = sku_info.strip()
    text = re.sub(r'\s*(送货|在途|已完成|处理中|待处理|复制)\s*$', '', text)
    text = re.sub(r'^(CHIC\.?\s*PEAK|ICE\s*LERSKIN|ICELERSKIN|CHICPEAK)\s*', '', text, flags=re.IGNORECASE)
    text = re.sub(r'^(新品|旧版|新版|采购单\s*\*\s*\d+)\s*', '', text)
    text = re.sub(r'\s*\*\d+\s*$', '', text)
    sku = _extract_sku(text)
    if sku:
        text = re.sub(r'\s*' + re.escape(sku) + r'\s*$', '', text)
        text = re.sub(r'^\s*' + re.escape(sku) + r'\s*', '', text)
    text = re.sub(r'\s+(ICEWM|CHIC-WM|WM)\s*$', '', text)
    text = re.sub(r'\s+\d{6,}\s*$', '', text)
    text = re.sub(r'\s*[\*\+]\s*\d*\s*$', '', text)
    text = re.sub(r'\s+', ' ', text).strip()
    return text or sku_info


def int_or_zero(val):
    try:
        return int(float(val.replace(',', '')))
    except (ValueError, AttributeError):
        return 0


def float_or_none(val):
    try:
        v = val.replace(',', '').replace('MYR', '').replace('***', '').strip()
        if v == '-' or v == '':
            return None
        return float(v)
    except (ValueError, AttributeError):
        return None


def _row_score(row):
    """计算行数据完整度分数，用于去重时保留最优行"""
    score = 0
    for key in ['daily_sales', 'est_days']:
        val = row.get(key, '')
        if val and val != '-' and val != '':
            try:
                float(val.replace(',', ''))
                score += 1
            except (ValueError, AttributeError):
                pass
    for key in ['available', 'transit', 'cur_stock']:
        val = row.get(key, '0')
        try:
            if int(float(val.replace(',', ''))) > 0:
                score += 1
        except (ValueError, AttributeError):
            pass
    return score


if __name__ == '__main__':
    try:
        rows, metadata, invalid_sku_rows, combo_sku_rows = scrape()
        if metadata and metadata.get('session_only'):
            print('[session-only] 登录会话建立完成，浏览器已关闭。')
            sys.exit(0)
        if rows:
            save_json(rows, metadata, invalid_sku_rows, combo_sku_rows)
        else:
            print(f'未抓取到数据。检查 {DEBUG_DIR}')
            sys.exit(1)
    except RuntimeError as e:
        print(f'\n致命错误: {e}')
        print('未生成正式 JSON。请检查 BigSeller 页面结构是否变更。')
        sys.exit(1)
