"""Rules 8 and 9: secrets and the CAIQ file never enter the repository."""
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _is_ignored(path: str) -> bool:
    result = subprocess.run(
        ["git", "check-ignore", "-q", path], cwd=ROOT, capture_output=True
    )
    return result.returncode == 0


def test_env_file_is_ignored() -> None:
    assert _is_ignored(".env")


def test_env_example_is_not_ignored() -> None:
    assert not _is_ignored(".env.example")


def test_caiq_files_are_ignored() -> None:
    for path in ["data/caiq_v4.xlsx", "data/test_rfps/caiq.pdf", "CAIQv4.xlsx"]:
        assert _is_ignored(path), path


def test_env_example_lists_required_variables() -> None:
    text = (ROOT / ".env.example").read_text()
    for var in [
        "OPENROUTER_API_KEY",
        "OPENROUTER_EXTRACT_MODEL",
        "OPENROUTER_DRAFT_MODEL",
        "DATABASE_URL",
    ]:
        assert f"{var}=" in text
