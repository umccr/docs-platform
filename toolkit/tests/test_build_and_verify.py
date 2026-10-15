import shutil

import pytest
from conftest import EXAMPLES

from umccr_docs.build import build, effective_config
from umccr_docs.config import load_project
from umccr_docs.verify import verify_site


@pytest.fixture
def built(tmp_path):
    """Build an example into a temporary site directory with the pinned engine."""

    def run(example: str, slug: str):
        project = load_project(EXAMPLES / example / "mkdocs.yml")
        site = build(project, slug, tmp_path / example)
        shutil.rmtree(EXAMPLES / example / ".umccr-docs", ignore_errors=True)
        return site

    return run


def test_basic_example_builds_strictly_and_passes_verification(built):
    site = built("basic-site", "example-basic")
    assert verify_site(site) == []
    home = (site / "index.html").read_text()
    assert "assets/umccr/umccr.js" in home, "the platform script is on every page"
    assert "Example: synthetic content" in home, "the classification banner renders"
    assert "umccr-provenance" in home, "the footer shows where the page came from"


def test_obsidian_example_builds_strictly(built):
    site = built("obsidian-vault", "example-vault")
    assert verify_site(site) == []
    assert (site / "Projects" / "alpha" / "index.html").is_file()
    assert "Generated from note properties" in (site / "index.html").read_text()


def test_the_platform_config_is_not_overridable():
    project = load_project(EXAMPLES / "basic-site" / "mkdocs.yml")
    config = effective_config(project, "example-basic")
    assert config["theme"]["name"] == "material"
    assert config["theme"]["font"] is False
    assert config["extra_javascript"] == ["assets/umccr/umccr.js"]
    assert config["extra"]["homepage"] == "/platform/"
    assert "platform" not in config["extra"]
    assert config["use_directory_urls"] is True
    assert not any("snippets" in str(extension) for extension in config["markdown_extensions"])


@pytest.mark.parametrize(
    ("relative", "content", "expected"),
    [
        ("assets/app.js.map", "{}", "this kind of file must not be published"),
        (".env", "X=1", "hidden files are not published"),
        # Fake credentials are assembled at run time, so no secret-shaped literal sits in the repository.
        ("leak.html", "key AKIA" + "ABCDEFGHIJKLMNOP here", "an AWS access key ID"),
        ("key.txt", "-----BEGIN RSA " + "PRIVATE KEY-----", "a private key"),
        # A configuration value that breaks out of the theme's attribute, which no source check sees as markup.
        ("guide/index.html", '<a aria-label="Docs" onmouseover="alert(1)">', "an HTML event handler attribute"),
        ("guide/index.html", '<a href="javascript:alert(1)//">Repository</a>', "a javascript: URL"),
        ("img/diagram.svg", "<svg><script>alert(1)</script></svg>", "a <script> element is not allowed"),
    ],
)
def test_verify_rejects_unpublishable_files(tmp_path, relative, content, expected):
    site = tmp_path / "site"
    for name in ("index.html", "404.html"):
        (site / name).parent.mkdir(parents=True, exist_ok=True)
        (site / name).write_text("ok")
    (site / relative).parent.mkdir(parents=True, exist_ok=True)
    (site / relative).write_text(content)
    assert any(expected in problem for problem in verify_site(site))


def test_verify_requires_index_and_404(tmp_path):
    (tmp_path / "site").mkdir()
    assert verify_site(tmp_path / "site") == [
        "index.html is missing from the site root",
        "404.html is missing from the site root",
    ]
