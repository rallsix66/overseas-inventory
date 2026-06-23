#!/usr/bin/env python3
"""BigSeller Session Health Check — P5-SY9B

使用与 web_bridge.py 相同的 profile 和 headless 模式，只读检查 BigSeller 库存页是否可访问。
不抓取库存、不生成同步计划、不写 Supabase、不写 sync_run / sync_log。

用法:
  python -m tools.bigseller-scraper.sync.health_check

输出: JSON 到 stdout
退出码: 0=healthy, 1=unhealthy, 2=internal error
"""

import json
import os
import sys
import time
import traceback
from datetime import datetime, timezone


BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUNTIME_DIR = os.path.join(BASE_DIR, 'runtime')
PROFILE_DIR = os.path.join(RUNTIME_DIR, 'profile')
DEBUG_DIR = os.path.join(RUNTIME_DIR, 'debug')
INVENTORY_URL = 'https://www.bigseller.pro/web/inventory/index.htm'

# ⚠️ 不要在此处创建 profile 目录 — 必须先检查 profile 是否存在再决定是否创建。
# profile 缺失时应返回 profile_unavailable，而不是静默创建空目录后继续。

# Max time for the full health check
HEALTH_CHECK_TIMEOUT_S = 45


def main():
    result = {
        'status': 'unknown_error',
        'message': '',
        'checked_at': datetime.now(timezone.utc).isoformat(),
        'details': {},
    }

    try:
        from playwright.sync_api import sync_playwright

        # ── Check profile exists FIRST (before creating anything) ─
        profile_dir_exists = os.path.isdir(PROFILE_DIR)
        cookie_candidates = [
            os.path.join(PROFILE_DIR, 'Default', 'Cookies'),
            os.path.join(PROFILE_DIR, 'Default', 'Network', 'Cookies'),
        ]
        cookie_file_found = None
        if profile_dir_exists:
            for c in cookie_candidates:
                if os.path.exists(c) and os.path.getsize(c) > 0:
                    cookie_file_found = c
                    break

        result['details']['profile_dir'] = PROFILE_DIR
        result['details']['profile_dir_exists'] = profile_dir_exists
        result['details']['profile_has_cookies'] = cookie_file_found is not None

        if not profile_dir_exists or cookie_file_found is None:
            if not profile_dir_exists:
                result['status'] = 'profile_unavailable'
                result['message'] = (
                    'Profile 不可用：BigSeller 登录会话 profile 目录不存在。'
                    '请先点击「重新建立登录会话」按钮完成首次登录，系统将自动创建 profile。'
                )
            else:
                result['status'] = 'profile_unavailable'
                result['message'] = (
                    'Profile 不可用：BigSeller 登录会话 cookie 文件缺失或为空。'
                    '请点击「重新建立登录会话」按钮重新登录以刷新会话。'
                )
            _write_result(result)
            return

        # Only create directories once we know the profile is usable
        os.makedirs(DEBUG_DIR, exist_ok=True)

        # ── Chrome path ──────────────────────────────────────────
        chrome_path = None
        for pth in [
            r'C:\Program Files\Google\Chrome\Application\chrome.exe',
            r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe',
        ]:
            if os.path.exists(pth):
                chrome_path = pth
                break

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
            # headless 必需
            '--disable-gpu',
            '--disable-dev-shm-usage',
            '--disable-software-rasterizer',
            '--window-size=1920,1080',
            '--start-maximized',
        ]

        with sync_playwright() as p:
            context = p.chromium.launch_persistent_context(
                user_data_dir=PROFILE_DIR,
                headless=True,
                executable_path=chrome_path,
                args=launch_args,
                ignore_https_errors=True,
                viewport={'width': 1400, 'height': 900},
                user_agent=user_agent,
            )

            # 注入反检测脚本（与 bigseller_scraper.py 一致）
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
            start_time = time.time()

            try:
                # ── Navigate to inventory page ───────────────────
                page.goto(INVENTORY_URL, wait_until='domcontentloaded', timeout=30000)
                page.wait_for_timeout(4000)

                page_url = page.url.lower()
                result['details']['url'] = page_url

                # ── Check 1: Login page? ─────────────────────────
                is_login = (
                    'login' in page_url
                    or 'signin' in page_url
                    or page.evaluate("""() => {
                        return !!(
                            document.querySelector('input[type="password"]')
                            && !document.querySelector('table.vxe-table--body')
                        );
                    }""")
                )
                if is_login:
                    result['status'] = 'need_login'
                    result['message'] = (
                        '需要登录：BigSeller 登录会话已过期或不存在。'
                        '请点击「重新建立登录会话」按钮，系统将打开浏览器供您完成登录。'
                    )
                    _write_result(result)
                    context.close()
                    return

                # ── Check 2: CAPTCHA visible? ─────────────────────
                has_captcha = page.evaluate("""() => {
                    const el = document.querySelector('.tencent-captcha-dy__warp')
                        || document.querySelector('#tCaptchaDyMainWrap')
                        || document.querySelector('[id^="tcaptcha"]');
                    if (!el) return false;
                    const rect = el.getBoundingClientRect();
                    return rect.width > 0 && rect.height > 0;
                }""")
                if has_captcha:
                    result['status'] = 'need_verification'
                    result['message'] = (
                        '需要验证码：BigSeller 页面出现了安全验证（腾讯滑块拼图）。'
                        '请点击「重新建立登录会话」按钮，系统将打开浏览器供您手动完成验证。'
                    )
                    result['details']['captcha_detected'] = True
                    _write_result(result)
                    context.close()
                    return

                # ── Check 3: VXE table present? ──────────────────
                vxe_info = page.evaluate("""() => {
                    const containers = document.querySelectorAll('.vxe-table');
                    let best = null;
                    for (const c of containers) {
                        const headerTable = c.querySelector('table.vxe-table--header');
                        const bodyTable = c.querySelector('table.vxe-table--body');
                        if (headerTable && bodyTable) {
                            const ths = headerTable.querySelectorAll('thead th');
                            const trs = bodyTable.querySelectorAll('tbody tr');
                            if (ths.length > 0 && trs.length > 0) {
                                best = {
                                    headerCount: ths.length,
                                    rowCount: trs.length,
                                    xid: c.getAttribute('xid') || '',
                                };
                                break;
                            }
                            if (ths.length > 0 && !best) {
                                best = {
                                    headerCount: ths.length,
                                    rowCount: 0,
                                    xid: c.getAttribute('xid') || '',
                                    empty: true,
                                };
                            }
                        }
                    }
                    return best;
                }""")

                if not vxe_info:
                    result['status'] = 'table_not_loaded'
                    result['message'] = (
                        '表格未加载：无法在 BigSeller 库存页找到 VXE 数据表格。'
                        '可能原因：页面加载超时、网络问题或 BigSeller 页面结构变更。'
                        '请稍后重试，如持续出现请检查 BigSeller 网站状态。'
                    )
                    # Save debug screenshot
                    try:
                        page.screenshot(path=os.path.join(
                            DEBUG_DIR, 'health_check_table_missing.png'))
                    except Exception:
                        pass
                    _write_result(result)
                    context.close()
                    return

                result['details']['vxe_header_count'] = vxe_info['headerCount']
                result['details']['vxe_row_count'] = vxe_info['rowCount']

                # ── Check 4: Warehouse filter present? ────────────
                wh_filter_info = page.evaluate("""() => {
                    const inpBox = document.querySelector('.inp_box');
                    const autoidSpans = document.querySelectorAll('span[autoid]');
                    const whAutoids = [];
                    for (const s of autoidSpans) {
                        const autoid = s.getAttribute('autoid');
                        if (autoid && autoid.startsWith('warehouse_option_')) {
                            whAutoids.push(autoid);
                        }
                    }
                    return {
                        inp_box_found: !!inpBox,
                        warehouse_options_count: whAutoids.length,
                    };
                }""")

                result['details']['warehouse_filter'] = wh_filter_info

                if not wh_filter_info['inp_box_found']:
                    result['status'] = 'page_structure_changed'
                    result['message'] = (
                        '页面结构异常：BigSeller 库存页缺少仓库筛选入口（.inp_box）。'
                        '表格已加载但页面结构可能与预期不符，同步数据可能不完整。'
                        '请检查 BigSeller 页面是否正常。'
                    )
                    _write_result(result)
                    context.close()
                    return

                # ── All checks passed ─────────────────────────────
                elapsed = time.time() - start_time
                result['status'] = 'healthy'
                result['message'] = (
                    '已登录可用：BigSeller 登录会话正常，'
                    f'表格已加载（{vxe_info["headerCount"]} 列 / {vxe_info["rowCount"]} 行），'
                    f'仓库筛选可用（{wh_filter_info["warehouse_options_count"]} 个仓库选项）。'
                    f'（检查耗时 {elapsed:.1f}s）'
                )
                result['details']['check_duration_s'] = round(elapsed, 1)
                _write_result(result)
                context.close()

            except Exception as e:
                elapsed = time.time() - start_time
                error_msg = f'{type(e).__name__}: {e}'
                if 'Timeout' in error_msg or 'timeout' in error_msg.lower():
                    result['status'] = 'table_not_loaded'
                    result['message'] = (
                        '表格未加载：BigSeller 库存页加载超时。'
                        '可能原因：网络连接问题或 BigSeller 服务响应缓慢。'
                        '请检查网络连接后重试。'
                    )
                else:
                    result['status'] = 'unknown_error'
                    result['message'] = (
                        f'未知错误：会话健康检查失败（{error_msg}）。'
                        '请稍后重试，如持续出现请联系技术支持。'
                    )
                result['details']['error'] = error_msg
                result['details']['check_duration_s'] = round(elapsed, 1)
                try:
                    page.screenshot(path=os.path.join(
                        DEBUG_DIR, 'health_check_error.png'))
                except Exception:
                    pass
                _write_result(result)
                context.close()
    except Exception as e:
        result['status'] = 'unknown_error'
        result['message'] = (
            f'未知错误：无法启动浏览器进行健康检查（{type(e).__name__}: {e}）。'
            '请确认服务器已安装 Chrome 浏览器和 Playwright。'
        )
        result['details']['error'] = f'{type(e).__name__}: {e}'
        traceback.print_exc(file=sys.stderr)
        _write_result(result)


def _write_result(result):
    try:
        print(json.dumps(result, ensure_ascii=True))
    except UnicodeEncodeError:
        safe = {
            'status': 'unknown_error',
            'message': '内部错误：无法编码输出',
            'checked_at': result.get('checked_at', ''),
            'details': {},
        }
        print(json.dumps(safe, ensure_ascii=True))


if __name__ == '__main__':
    main()
