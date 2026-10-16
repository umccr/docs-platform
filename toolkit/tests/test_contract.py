from pathlib import Path

import pytest
from conftest import OBSIDIAN_CONFIG

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


@pytest.mark.parametrize(
    ("markdown", "description"),
    [
        # Markdown's attribute lists add attributes no source scan sees as HTML.
        ('![diagram](diagram.png){ onerror="alert(1)" }', "an HTML event handler attribute"),
        ('# Heading { onclick="alert(1)" }', "an HTML event handler attribute"),
        # Entities, reference definitions and forms reach the page as script URLs too.
        ("[x](javascript&#58;alert(1))", "a javascript: URL"),
        ('<a href="&#106;avascript:alert(1)">x</a>', "a javascript: URL"),
        ("[link][ref]\n\n[ref]: javascript:alert(1)", "a javascript: URL"),
        ('<form action="javascript:alert(1)"><button>x</button></form>', "a javascript: URL"),
        # Front matter the theme prints, after YAML has decoded its escapes.
        ('---\ntitle: "\\x3cscript>alert(1)\\x3c/script>"\n---\n# Page', "a <script> element"),
    ],
)
def test_checks_pages_as_rendered(make_project, markdown, description):
    problems = problems_for(make_project, VALID_CONFIG, {"docs/page.md": markdown + "\n"})
    assert problems == [f"docs/page.md: the rendered page has {description}, which is not allowed"]


def test_checks_obsidian_properties_as_rendered(make_project):
    config = OBSIDIAN_CONFIG.replace("https://docs.umccr.org/test-vault/", "https://docs.umccr.org/example/")
    note = '---\nstatus: "<a href=\\"\\x6Aavascript:alert(1)\\">open</a>"\n---\n# Note\n'
    problems = problems_for(make_project, config, {"vault/index.md": "# Home\n", "vault/Note.md": note})
    assert problems == ["vault/Note.md: the rendered page has a javascript: URL, which is not allowed"]


def test_reports_a_finding_once_with_its_line_when_the_source_shows_it(make_project):
    problems = problems_for(make_project, VALID_CONFIG, {"docs/page.md": '<img src="x" onerror="steal()">\n'})
    assert problems == ["docs/page.md:1: an HTML event handler attribute is not allowed"]


def test_attribute_lists_and_raw_html_without_code_pass(make_project):
    page = (
        '[Guide](guide.md){ .md-button target=_blank }\n\n<div markdown>\n**Bold** ![x](x.png){ width="300" }\n</div>\n'
    )
    assert problems_for(make_project, VALID_CONFIG, {"docs/page.md": page, "docs/guide.md": "# Guide\n"}) == []


@pytest.mark.parametrize(
    ("relative", "content", "description"),
    [
        ("docs/report.html", "<p>Report</p><script>alert(1)</script>", "a <script> element"),
        ("docs/img/diagram.svg", '<svg xmlns="http://www.w3.org/2000/svg" onload="x()"/>', "an HTML event handler"),
        ("docs/data.xml", '<?xml-stylesheet type="text/xsl" href="x.xsl"?><data/>', "an XML stylesheet"),
    ],
)
def test_checks_documents_the_site_ships_as_they_are(make_project, relative, content, description):
    problems = problems_for(make_project, VALID_CONFIG, {relative: content + "\n"})
    assert any(problem.startswith(f"{relative}: {description}") for problem in problems), problems


def test_a_plain_svg_passes(make_project):
    svg = '<svg xmlns="http://www.w3.org/2000/svg"><a href="../guide/"><rect width="10" height="10"/></a></svg>\n'
    assert problems_for(make_project, VALID_CONFIG, {"docs/img/diagram.svg": svg}) == []


@pytest.mark.parametrize("relative", ["docs/assets/umccr/umccr.js", "docs/assets/javascripts/bundle.d7400e89.min.js"])
def test_files_cannot_replace_the_theme_scripts(make_project, relative):
    problems = problems_for(make_project, VALID_CONFIG, {relative: "alert(1)\n"})
    assert problems == [f"{relative}: assets/javascripts/ and assets/umccr/ hold the platform theme's scripts"]


@pytest.mark.parametrize("key", ["polyfills", "analytics", "consent"])
def test_extra_keys_that_add_scripts_are_rejected(make_project, key):
    problems = problems_for(make_project, VALID_CONFIG + f"extra:\n  {key}: [x.js]\n")
    assert problems == [f"'extra.{key}' is set by the platform and may not appear in mkdocs.yml"]


@pytest.mark.parametrize(
    ("extra", "where"),
    [
        ("site_description: '<script>alert(1)</script>'", "site_description"),
        ("extra:\n  classification: '<img src=x onerror=alert(1)>'", "extra.classification"),
        ("nav:\n  - '<img src=x onerror=alert(1)>': index.md", "nav[0].<img src=x onerror=alert(1)>"),
    ],
)
def test_configuration_values_cannot_carry_markup_that_runs(make_project, extra, where):
    problems = problems_for(make_project, VALID_CONFIG + extra + "\n")
    assert len(problems) == 1 and problems[0].startswith(f"mkdocs.yml: {where}: "), problems


def test_a_copyright_link_passes(make_project):
    config = VALID_CONFIG + "copyright: '&copy; 2026 <a href=\"https://umccr.org\">UMCCR</a>'\n"
    assert problems_for(make_project, config) == []


@pytest.mark.parametrize(
    "page",
    [
        # Code samples the engine renders as code, which the source scan must not take for markup.
        "    <script>example</script>\n",
        "An example:\n\n    <script>example</script>\n",
        '!!! example\n\n    ```html\n    <img src="x" onerror="handle()">\n    ```\n',
        "1. Add the tag:\n\n    ```html\n    <script src=app.js></script>\n    ```\n",
        "- A list item\n\n        <iframe src=x></iframe>\n",
    ],
)
def test_code_samples_in_any_container_pass(make_project, page):
    assert problems_for(make_project, VALID_CONFIG, {"docs/page.md": "# Page\n\n" + page}) == []


def test_markup_inside_a_container_is_still_reported_with_its_line(make_project):
    page = "# Page\n\n- A list item\n\n    <script>alert(1)</script>\n"
    problems = problems_for(make_project, VALID_CONFIG, {"docs/page.md": page})
    assert problems == ["docs/page.md:5: a <script> element is not allowed"]


def test_documents_must_be_utf8(make_project):
    root = make_project({"mkdocs.yml": VALID_CONFIG, "docs/index.md": "# Home\n"})
    (root / "docs" / "diagram.svg").write_bytes("<svg><script>alert(1)</script></svg>".encode("utf-16"))
    problems = check_project(load_project(root / "mkdocs.yml"), "example")
    assert problems == [
        "docs/diagram.svg: must be UTF-8 text without NUL characters: it is served, and checked, as UTF-8"
    ]


@pytest.mark.parametrize("relative", ["docs/data.rdf", "docs/feed.xsl", "docs/legacy.htm"])
def test_files_served_as_documents_are_checked_whatever_their_extension(make_project, relative):
    problems = problems_for(make_project, VALID_CONFIG, {relative: "<p>x</p><script>alert(1)</script>\n"})
    assert problems == [f"{relative}: a <script> element is not allowed"]
