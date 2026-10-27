import subprocess
import textwrap
from pathlib import Path

import pytest

EXAMPLES = Path(__file__).resolve().parents[1] / "examples"


def write(root: Path, files: dict[str, str]) -> None:
    for relative, content in files.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(textwrap.dedent(content).lstrip("\n"), encoding="utf-8")


@pytest.fixture
def make_project(tmp_path: Path):
    """A throwaway git repository holding a project: `make_project({"mkdocs.yml": ..., "docs/index.md": ...})`."""

    def create(files: dict[str, str]) -> Path:
        subprocess.run(["git", "init", "-q", str(tmp_path)], check=True)
        write(tmp_path, files)
        return tmp_path

    return create


OBSIDIAN_CONFIG = """
site_name: Test vault
site_url: https://docs.umccr.org/test-vault/
repo_url: https://github.com/umccr/test-vault
docs_dir: vault
extra:
  platform:
    source_format: obsidian
    properties: [status, domains]
    obsidian:
      prefer_folders: [Projects]
      sort_orders:
        priority: [Low, Medium, High]
"""
