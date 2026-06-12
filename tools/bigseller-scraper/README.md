# BigSeller 库存抓取器

此目录从旧项目复制，用于确认 BigSeller 页面抓取是否仍然可用，并梳理首个海外仓的数据字段。

## 当前状态

- P5-SY1 ✅ 只读试跑通过（5仓182条，首仓确认为菲律宾）
- P5-SY2 ✅ 菲律宾单仓加固完成（第二次独立验收返工通过：VXE 容器 data 属性绑定 + 列数 fail-fast + 纯函数提取 + 10 项结构保护测试 + 统计公式修正）

## 当前边界

- 使用 Playwright 打开真实 BigSeller 库存页面。
- 首次运行需要在弹出的 Chrome 窗口中手动登录。
- 只读取页面并输出本地 JSON。
- 不写入旧项目 SQLite。
- 不写入当前 Supabase。
- 不属于 Next.js `src/` 运行时。

## 运行

在项目根目录执行：

```powershell
python -m pip install -r tools/bigseller-scraper/requirements.txt
python -m playwright install chromium
python tools/bigseller-scraper/bigseller_scraper.py
```

脚本会优先使用本机 Chrome。首次运行时请在弹出的浏览器中手动登录 BigSeller。

## 当前抓取范围

**菲律宾-新创启辰自建仓 (PH)** 单仓。仓库选择通过 autoid + 名称双重识别，并自动反选持久化 Profile 中可能残留的其他仓库。

## 输出格式

成功抓取后，JSON 保存在：

```text
tools/bigseller-scraper/runtime/output/bigseller-inventory-*.json
```

JSON 结构：

```json
{
  "captured_at": "2026-06-12T10:31:10+08:00",
  "warehouse": "菲律宾-新创启辰自建仓",
  "row_count": 91,
  "rows": [
    {
      "sku": "WM0100-#07",
      "product_name": "按压唇冻 #07",
      "warehouse": "菲律宾-新创启辰自建仓",
      "current_quantity": 3793,
      "locked_quantity": 12,
      "available_quantity": 3781,
      "transit_quantity": 0,
      "daily_sales": 8.89,
      "estimated_days": 425.0,
      "raw": { ... }
    }
  ],
  "metadata": {
    "warehouse": "菲律宾-新创启辰自建仓",
    "raw_row_count": 98,
    "other_warehouse_count": 0,
    "combo_excluded_count": 1,
    "invalid_sku_count": 6,
    "invalid_sku_rows_saved": 6,
    "dedup_count": 0,
    "final_count": 91,
    "zero_available_count": 13,
    "pages": 2,
    "header_count": 13
  }
}
```

`metadata` 中每一项统计数据均可追溯：`raw - other_wh - combo - invalid - dup = final`。列数不匹配在 fail-fast 机制下始终为 0（出现即抛 RuntimeError，不生成正式 JSON），不再纳入统计公式。

无效 SKU 完整记录同步保存到：
- `tools/bigseller-scraper/runtime/debug/invalid_sku_rows.json`
- `tools/bigseller-scraper/runtime/output/invalid-sku-rows-*.json`

## 安全特性（P5-SY2 + 独立验收返工）

1. **表头校验**：每次运行自动读取表格表头，与 `EXPECTED_HEADERS` 关键词匹配。关键字段缺失或顺序异常时抛出 RuntimeError 并终止，禁止静默错列。
2. **表头表体 VXE 容器绑定**：`_validate_headers()` 在 `.vxe-table` 容器内同时定位 `table.vxe-table--header` 和 `table.vxe-table--body`，在容器 DOM 上设置 `data-bigseller-scraper="target"` 标记属性。`_extract_page_rows()` 仅通过此标记属性定位同一容器，无回退。无法绑定同一容器时抛出 RuntimeError，不生成正式 JSON。
3. **严格列数校验（fail-fast）**：每行 `tds.length` 必须与已验证表头列数完全一致（当前 13 列），禁止 `tds.length < 7` 式静默允许后半字段缺失。任意一行列数不匹配立即抛出 RuntimeError，不生成正式 JSON。
4. **零库存保留**：不再过滤 `available=0 && transit=0` 的单 SKU 行，确保缺货数据完整。
5. **遮罩收窄**：仅处理已知的 `.language_switch_guide_mask` 语言引导遮罩，不通用删除所有 Ant Design 模态遮罩。
6. **仓库名称优先**：打开下拉后枚举所有 label 的 autoid + text，严格按精确文字匹配目标仓库名。名称匹配失败时回退 `warehouse_option_6` 并验证文字一致，不一致则抛出 RuntimeError。
7. **无效 SKU 可追溯**：6 条无效 SKU 完整记录（sku_info / warehouse / cur_stock / locked / available / transit）保存到 `runtime/debug/invalid_sku_rows.json` 和 `runtime/output/invalid-sku-rows-*.json`。
8. **统计可解释**：输出元数据完整追踪每一条数据的增减原因（raw → other_wh → combo → invalid → dup → final）。列数不匹配在 fail-fast 机制下不进入统计（出现即抛 RuntimeError，不生成 JSON）。

## 本地运行文件

登录缓存、调试截图、页面 HTML 和抓取结果均保存在：

```text
tools/bigseller-scraper/runtime/
```

该目录已被 Git 忽略，禁止提交，因为登录缓存可能包含敏感会话信息。

## 已知风险

- 仓库选择依赖 BigSeller 页面中下拉 label 的文字和 `autoid`。P5-SY2 返工已实现名称优先定位 + autoid 回退前文字验证，不一致时明确失败。
- BigSeller 表头文字可能更新（已从旧版"当前库存"变更为"现有库存"等），`EXPECTED_HEADERS` 当前同时兼容新旧两套关键词。
- VXE 表结构中 `.vxe-cell--title` 可能在每列出现多次（导致计数翻倍），`_validate_headers()` 已改用 VXE 容器内 `table.vxe-table--header thead th` 取表头，并通过 `data-bigseller-scraper` 标记属性绑定同一容器。
- 持久化 Profile 可能残留多仓库选择状态，已添加反选逻辑清除非目标仓库。
- 在字段、仓库名称和数量全部核对前，禁止接入 Supabase 写入。
