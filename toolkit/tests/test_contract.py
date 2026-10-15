from pathlib import Path

import pytest

from umccr_docs.config import load_project
from umccr_docs.contract import check_project, unsafe_markdown
from umccr_docs.errors import DocsError
from umccr_docs.slug import validate_slug

VALID_CONFIG = """
site_name: Example
site_url: https://docs.umccr.org/example/
docs_dir: docs
"""


def problems_for(make_project, config: str, files: dict[str, str] | None = None, slug: str = "example"):
    root = make_project({"mkdocs.yml": config, "docs/index.md": "# Home\n", **(files or {})})
    return check_project(load_project(root / "mkdocs.yml"), slug)


def test_a_minimal_project_passes(make_project):
    assert problems_for(make_project, VALID_CONFIG) == []


@pytest.mark.parametrize("slug", ["Example", "-x", "x-", "_x", "a.b", "a" * 50, "sites", ""])
def test_rejects_invalid_slugs(slug):
    with pytest.raises(DocsError):
        validate_slug(slug)


def test_site_url_must_match_the_slug(make_project):
    problems = problems_for(make_project, VALID_CONFIG, slug="other")
    assert any("site_url must be https://docs.umccr.org/other/" in problem for problem in problems)


@pytest.mark.parametrize(
    "extra",
    [
        "theme: {name: material}",
        "markdown_extensions: [pymdownx.snippets]",
        "hooks: [hooks.py]",
        "extra_javascript: [app.js]",
        "site_dir: public",
    ],
)
def test_platform_owned_keys_are_rejected(make_project, extra):
    problems = problems_for(make_project, VALID_CONFIG + extra + "\n")
    assert any("is set by the platform" in problem for problem in problems)


def test_only_supported_plugins_are_allowed(make_project):
    problems = problems_for(make_project, VALID_CONFIG + "plugins: [search, tags, macros]\n")
    assert problems == ["plugin 'macros' is not supported; allowed: search, tags"]


def test_directory_urls_cannot_be_turned_off(make_project):
    problems = problems_for(make_project, VALID_CONFIG + "use_directory_urls: false\n")
    assert any("use_directory_urls" in problem for problem in problems)


def test_remote_stylesheets_are_rejected(make_project):
    problems = problems_for(make_project, VALID_CONFIG + "extra_css: [https://example.com/x.css]\n")
    assert any("extra_css" in problem for problem in problems)


def test_custom_yaml_tags_are_rejected(make_project):
    root = make_project({"mkdocs.yml": VALID_CONFIG + "site_author: !ENV AUTHOR\n", "docs/index.md": "# Home\n"})
    with pytest.raises(DocsError, match="not plain YAML"):
        load_project(root / "mkdocs.yml")


def test_docs_dir_must_stay_in_the_repository(make_project):
    problems = problems_for(make_project, VALID_CONFIG.replace("docs_dir: docs", "docs_dir: ../elsewhere"))
    assert any("outside the repository" in problem for problem in problems)


def test_reports_unsafe_html_with_its_line(make_project):
    page = "# Page\n\nText\n\n<script>alert(1)</script>\n"
    problems = problems_for(make_project, VALID_CONFIG, {"docs/page.md": page})
    assert problems == ["docs/page.md:5: a <script> element is not allowed"]


@pytest.mark.parametrize(
    ("markdown", "description"),
    [
        ("<SCRIPT src=x></SCRIPT>", "a <script> element"),
        ('<img src="x" onerror="steal()">', "an HTML event handler attribute"),
        ("<iframe src=https://example.com></iframe>", "an embedded frame or object"),
        ("[click](javascript:alert(1))", "a javascript: URL"),
        ('<a href="javascript:alert(1)">x</a>', "a javascript: URL"),
    ],
)
def test_detects_unsafe_constructs(markdown, description):
    assert [finding[1] for finding in unsafe_markdown(markdown)] == [description]


def test_allows_html_inside_code():
    markdown = "Inline `<script>x</script>` is fine.\n\n```html\n<script>alert(1)</script>\n```\n"
    assert unsafe_markdown(markdown) == []


def test_ignores_files_git_ignores(make_project):
    root = make_project(
        {
            "mkdocs.yml": VALID_CONFIG,
            "docs/index.md": "# Home\n",
            "docs/scratch/notes.md": "<script>alert(1)</script>\n",
            ".gitignore": "docs/scratch/\n",
        }
    )
    assert check_project(load_project(Path(root) / "mkdocs.yml"), "example") == []
