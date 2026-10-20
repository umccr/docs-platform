"""The package version, which a release keeps equal to its tag (docs/operating/releasing.md)."""

import tomllib
from pathlib import Path

import umccr_docs


def test_package_version_matches_pyproject():
    pyproject = tomllib.loads((Path(__file__).parents[1] / "pyproject.toml").read_text(encoding="utf-8"))
    assert umccr_docs.__version__ == pyproject["project"]["version"]
