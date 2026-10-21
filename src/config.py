"""Load config/vendor.yaml."""
from functools import cache
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent.parent
VENDOR_CONFIG = ROOT / "config" / "vendor.yaml"


@cache
def vendor_config() -> dict[str, Any]:
    return yaml.safe_load(VENDOR_CONFIG.read_text(encoding="utf-8"))
