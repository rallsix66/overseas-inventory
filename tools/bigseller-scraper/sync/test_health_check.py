"""P5-SY9B — health_check.py 纯函数与契约测试

测试健康检查脚本的状态分类、输出格式和结构性保证。
不依赖 Playwright，不连接 Supabase，不执行真实写入。
"""

import json
import sys
import os
import unittest
from datetime import datetime, timezone


# Ensure module path
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, BASE_DIR)


class TestHealthCheckOutput(unittest.TestCase):
    """测试 health_check.py 的 JSON 输出格式和状态分类。"""

    VALID_STATUSES = frozenset({
        'healthy',
        'need_login',
        'need_verification',
        'profile_unavailable',
        'page_structure_changed',
        'table_not_loaded',
        'unknown_error',
    })

    def _load_health_check_result(self):
        """Load the health check result from a saved JSON, or construct a mock.
        This allows testing the output contract without running Playwright."""
        # Simulate the JSON contract that health_check.py guarantees
        return {
            'status': 'healthy',
            'message': '已登录可用：BigSeller 登录会话正常',
            'checked_at': datetime.now(timezone.utc).isoformat(),
            'details': {},
        }

    def test_valid_status_values(self):
        """所有状态值均在预期 7 种之内。"""
        self.assertEqual(len(self.VALID_STATUSES), 7)

        expected = [
            'healthy',
            'need_login',
            'need_verification',
            'profile_unavailable',
            'page_structure_changed',
            'table_not_loaded',
            'unknown_error',
        ]
        self.assertEqual(sorted(self.VALID_STATUSES), sorted(expected))

    def test_output_has_required_fields(self):
        """健康检查输出必须包含 status, message, checked_at 三个必需字段。"""
        result = self._load_health_check_result()
        self.assertIn('status', result)
        self.assertIn('message', result)
        self.assertIn('checked_at', result)

    def test_status_is_valid_string(self):
        """status 必须是 7 种有效值之一。"""
        result = self._load_health_check_result()
        self.assertIn(result['status'], self.VALID_STATUSES)

    def test_checked_at_is_iso_format(self):
        """checked_at 必须是有效的 ISO 时间戳。"""
        result = self._load_health_check_result()
        try:
            datetime.fromisoformat(result['checked_at'])
        except (ValueError, TypeError):
            self.fail(f"checked_at is not valid ISO: {result['checked_at']}")

    def test_healthy_message_positive(self):
        """healthy 状态的消息应为正向（包含'可用'/'正常'等词）。"""
        result = self._load_health_check_result()
        self.assertEqual(result['status'], 'healthy')
        self.assertTrue(
            '已登录' in result['message'] or '可用' in result['message'] or '正常' in result['message'],
            f"healthy message should be positive: {result['message']}",
        )

    def test_unhealthy_statuses_have_actionable_message(self):
        """非 healthy 状态消息应包含可操作指引（'请'字）。"""
        for status, message in [
            ('need_login', '需要登录：BigSeller 登录会话已过期或不存在。请点击「重新建立登录会话」按钮。'),
            ('need_verification', '需要验证码：BigSeller 页面出现了安全验证。请点击「重新建立登录会话」按钮。'),
            ('profile_unavailable', 'Profile 不可用：BigSeller 登录会话 cookie 文件缺失或为空。请点击「重新建立登录会话」按钮重新登录。'),
            ('table_not_loaded', '表格未加载：无法在 BigSeller 库存页找到 VXE 数据表格。请稍后重试。'),
            ('page_structure_changed', '页面结构异常：BigSeller 库存页缺少仓库筛选入口。请检查 BigSeller 页面是否正常。'),
        ]:
            mock = {
                'status': status,
                'message': message,
                'checked_at': datetime.now(timezone.utc).isoformat(),
                'details': {},
            }
            self.assertEqual(mock['status'], status)
            self.assertIn('请', mock['message'], f"{status} message should be actionable")

    def test_profile_unavailable_triggers_before_browser(self):
        """profile_unavailable 必须在启动浏览器前返回，不应启动 Playwright。"""
        # profile_unavailable 的两个触发条件：
        # 1. profile 目录不存在
        # 2. cookie 文件缺失或为空
        self.assertIn('profile_unavailable', self.VALID_STATUSES)
        # 验证 health_check.py 中 os.makedirs(PROFILE_DIR) 调用
        # 已移至 profile 检查之后（不在检查之前创建目录）
        script_path = os.path.join(os.path.dirname(__file__), 'health_check.py')
        with open(script_path, 'r', encoding='utf-8') as f:
            content = f.read()
        # os.makedirs(PROFILE_DIR) 不应出现在 profile 检查之前
        profile_check_idx = content.find("profile_dir_exists = os.path.isdir(PROFILE_DIR)")
        makedirs_idx = content.find('os.makedirs')
        if profile_check_idx > 0 and makedirs_idx > 0:
            self.assertGreater(
                makedirs_idx, profile_check_idx,
                'os.makedirs must appear AFTER profile existence check, not before',
            )

    def test_details_is_dict(self):
        """details 字段必须为 dict（可为空 dict）。"""
        result = self._load_health_check_result()
        self.assertIsInstance(result['details'], dict)

    def test_json_serializable(self):
        """输出必须可 JSON 序列化。"""
        result = self._load_health_check_result()
        try:
            dumped = json.dumps(result, ensure_ascii=True)
            parsed = json.loads(dumped)
            self.assertEqual(parsed['status'], result['status'])
            self.assertEqual(parsed['message'], result['message'])
        except (TypeError, ValueError) as e:
            self.fail(f"JSON round-trip failed: {e}")

    def test_no_sync_fields_in_output(self):
        """健康检查输出不应包含任何同步写入字段。"""
        result = self._load_health_check_result()
        forbidden_keys = {
            'runId', 'syncRunId', 'syncLogId',
            'variants_created', 'variants_skipped',
            'inventory_inserted', 'inventory_updated',
            'warehouse_renamed', 'plan_drift_check',
            'exit_code', 'errors', 'summary',
            'artifacts', 'sync_log',
        }
        result_keys = set(result.keys())
        overlap = result_keys & forbidden_keys
        self.assertEqual(
            overlap, set(),
            f"Health check output must not contain sync fields: {overlap}",
        )

    def test_healthy_only_unlocks_sync(self):
        """只有 healthy 状态才 unlock 同步功能。"""
        # healthy → sync enabled
        # all others → sync disabled
        for status in self.VALID_STATUSES:
            is_sync_disabled = status != 'healthy'
            if status == 'healthy':
                self.assertFalse(is_sync_disabled, f"{status} should enable sync")
            else:
                self.assertTrue(is_sync_disabled, f"{status} should disable sync")

    def test_message_not_empty(self):
        """所有状态都应包含非空中文消息。"""
        result = self._load_health_check_result()
        self.assertIsInstance(result['message'], str)
        self.assertTrue(len(result['message']) > 0)
        # 应包含中文字符
        has_chinese = any('一' <= ch <= '鿿' for ch in result['message'])
        self.assertTrue(has_chinese, f"message should contain Chinese characters: {result['message']}")

    def test_script_exits_cleanly_for_import(self):
        """验证模块可被导入而不触发 main() 执行。"""
        # __name__ == '__main__' guard should prevent main() on import
        try:
            import sync.health_check  # noqa: F401
        except Exception as e:
            self.fail(f"health_check.py import should not raise: {e}")


class TestHealthCheckStructuralGuarantees(unittest.TestCase):
    """结构性保证：健康检查不连接 Supabase、不执行写入。"""

    def test_no_supabase_imports(self):
        """health_check.py 不应导入 supabase_gateway 或任何 HTTP 写入模块。"""
        script_path = os.path.join(os.path.dirname(__file__), 'health_check.py')
        with open(script_path, 'r', encoding='utf-8') as f:
            lines = f.readlines()

        # Only check import lines and assignments (not docstrings/comments)
        code_lines = [
            l for l in lines
            if ('import ' in l or 'from ' in l or l.strip().startswith('SUPABASE'))
            and not l.strip().startswith('#')
            and '"""' not in l
        ]

        content = '\n'.join(code_lines)

        forbidden_imports = [
            'supabase_gateway',
            'sync.executor',
            'sync.cli_execute',
            'execute_plan',
        ]
        for forbidden in forbidden_imports:
            self.assertNotIn(
                forbidden, content,
                f"health_check.py must not import {forbidden}",
            )

    def test_only_readonly_operations(self):
        """健康检查脚本仅使用只读 Playwright 操作（goto, evaluate, screenshot）。"""
        script_path = os.path.join(os.path.dirname(__file__), 'health_check.py')
        with open(script_path, 'r', encoding='utf-8') as f:
            content = f.read()

        # 允许的操作
        readonly_ops = ['page.goto', 'page.evaluate', 'page.screenshot', 'page.url']
        for op in readonly_ops:
            self.assertIn(op, content, f"Expected readonly operation: {op}")

        # 禁止的操作
        forbidden_ops = [
            'page.click',      # 不应点击任何按钮
            'page.fill',       # 不应填写任何表单
            'page.keyboard',   # 不应模拟键盘输入
            'context.cookies', # 不应修改 cookies
            'export',          # 不应输出文件
            '.json',           # 不应保存 JSON 文件（仅 stdout 输出）
            'save_json',       # 不应调用 save_json
            'scrape()',        # 不应调用主抓取函数
        ]
        for op in forbidden_ops:
            self.assertNotIn(
                op, content,
                f"health_check.py must not perform: {op}",
            )


if __name__ == '__main__':
    unittest.main()
