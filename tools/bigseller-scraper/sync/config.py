"""P5-SY3A 常量配置 — 不含任何供应商实例或密钥。

支持通过环境变量动态覆盖：
  BS_TARGET_WAREHOUSE_NAME, BS_OLD_WAREHOUSE_NAME,
  BS_WAREHOUSE_COUNTRY, BS_NEW_VARIANT_COUNTRY
"""

import os

# 目标仓库（环境变量优先）
TARGET_WAREHOUSE_NAME = os.environ.get('BS_TARGET_WAREHOUSE_NAME', '印尼-DEE仓库')
OLD_WAREHOUSE_NAME = os.environ.get('BS_OLD_WAREHOUSE_NAME', '印尼仓')
WAREHOUSE_COUNTRY = os.environ.get('BS_WAREHOUSE_COUNTRY', 'ID')
WAREHOUSE_TYPE = 'overseas'

# 新 SKU 默认值
NEW_VARIANT_COUNTRY = os.environ.get('BS_NEW_VARIANT_COUNTRY', WAREHOUSE_COUNTRY)
NEW_VARIANT_PRODUCT_ID = None
NEW_VARIANT_MATCH_STATUS = 'unmatched'

# 报告输出目录（相对于 bigseller-scraper 根目录）
REPORT_OUTPUT_DIR = os.environ.get('BS_REPORT_OUTPUT_DIR', 'runtime')
