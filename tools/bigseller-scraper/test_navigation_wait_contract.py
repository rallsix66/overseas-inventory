from pathlib import Path


ROOT = Path(__file__).resolve().parent
SCRAPER = (ROOT / 'bigseller_scraper.py').read_text(encoding='utf-8')
HEALTH_CHECK = (ROOT / 'sync' / 'health_check.py').read_text(encoding='utf-8')


def test_inventory_navigation_does_not_wait_for_domcontentloaded():
    assert "page.goto(INVENTORY_URL, wait_until='domcontentloaded'" not in SCRAPER
    assert "page.goto(INVENTORY_URL, wait_until='domcontentloaded'" not in HEALTH_CHECK


def test_inventory_navigation_uses_commit_before_explicit_readiness_checks():
    assert SCRAPER.count("page.goto(INVENTORY_URL, wait_until='commit'") == 3
    assert HEALTH_CHECK.count("page.goto(INVENTORY_URL, wait_until='commit'") == 1
    assert "is_login" in HEALTH_CHECK
    assert "vxe_info" in HEALTH_CHECK
