import datetime
import json
from pathlib import Path, PurePosixPath

import pytest
from conftest import EXAMPLES, OBSIDIAN_CONFIG

from umccr_docs.config import load_project
from umccr_docs.errors import DocsError
from umccr_docs.export_kb import absolute_links, doc_id, export_kb, page_path, page_title

TODAY = datetime.date(2026, 10, 9)

# The shared Obsidian config, with Home.md as the site's home page (published as index.md).
_SOURCE_FORMAT = "    source_format: obsidian\n"
VAULT_CONFIG = OBSIDIAN_CONFIG.replace(_SOURCE_FORMAT, _SOURCE_FORMAT + "    home: Home.md\n")


def metadata_for(out: Path, relative: str) -> dict:
    """The metadata attributes as plain strings, checking they use the typed form knowledge bases read."""
    attributes = json.loads((out / f"{relative}.metadata.json").read_text())["metadataAttributes"]
    assert all(attribute["value"]["type"] == "STRING" for attribute in attributes.values())
    return {name: attribute["value"]["stringValue"] for name, attribute in attributes.items()}


@pytest.mark.parametrize(
    ("relative", "expected"),
    [
        ("index.md", ""),
        ("guide.md", "guide/"),
        ("Projects/index.md", "Projects/"),
        ("Projects/README.md", "Projects/"),
        ("Projects/Alpha Beta.md", "Projects/Alpha Beta/"),
    ],
)
def test_page_paths_follow_mkdocs_directory_urls(relative, expected):
    assert page_path(PurePosixPath(relative)) == expected


def test_page_paths_without_directory_urls():
    assert page_path(PurePosixPath("guide.md"), directory_urls=False) == "guide.html"


def test_doc_ids_are_the_slug_and_the_path_without_extension():
    assert doc_id("platform", PurePosixPath("onboarding.md")) == "platform:onboarding"
    assert doc_id("vault", PurePosixPath("Projects/Alpha.md")) == "vault:Projects/Alpha"


def test_titles_come_from_front_matter_then_the_first_heading_then_the_name():
    assert page_title("---\ntitle: 'From front matter'\n---\n", "# Heading\n", PurePosixPath("a.md")) == (
        "From front matter"
    )
    assert page_title("", "Intro\n\n# The heading\n", PurePosixPath("a.md")) == "The heading"
    assert page_title("", "No heading\n", PurePosixPath("Projects/Alpha.md")) == "Alpha"
    assert page_title("", "No heading\n", PurePosixPath("Projects/index.md")) == "Projects"


def test_links_between_pages_become_absolute_docs_urls():
    site = "https://docs.umccr.org/vault/"
    body = (
        "See [Alpha](../Projects/Alpha%20Beta.md#scope), ![chart](img/chart.png), "
        "[outside](https://example.org/x), [here](#local) and `[code](not-a-link.md)`."
    )
    rewritten = absolute_links(body, PurePosixPath("Areas/Overview.md"), site)
    assert "[Alpha](https://docs.umccr.org/vault/Projects/Alpha%20Beta/#scope)" in rewritten
    assert "![chart](https://docs.umccr.org/vault/Areas/img/chart.png)" in rewritten
    assert "[outside](https://example.org/x)" in rewritten
    assert "[here](#local)" in rewritten
    assert "`[code](not-a-link.md)`" in rewritten, "inline code is never rewritten"


def test_exports_every_page_with_metadata(make_project, tmp_path):
    root = make_project(
        {
            "mkdocs.yml": VAULT_CONFIG,
            "vault/Home.md": "---\nstatus: Active\n---\n# Home\n\nStart at [[Alpha]].\n",
            "vault/Projects/Alpha.md": "# Alpha\n\nThe alpha project. Back to [[Home]].\n",
            "vault/Projects/empty.md": "\n",
            "vault/Projects/diagram.png": "not really a png",
        }
    )
    out = tmp_path / "kb"
    written = export_kb(
        load_project(root / "mkdocs.yml"), "test-vault", out, commit="abc123", today=TODAY, log=lambda _: None
    )

    assert written == 2
    files = sorted(path.relative_to(out).as_posix() for path in out.rglob("*") if path.is_file())
    assert files == [
        "Projects/Alpha.md",
        "Projects/Alpha.md.metadata.json",
        "index.md",
        "index.md.metadata.json",
    ], "the home note becomes index.md; empty pages and attachments are not exported"

    home = (out / "index.md").read_text()
    assert not home.startswith("---"), "front matter is removed"
    assert "[[" not in home, "wikilinks are resolved"
    assert "https://docs.umccr.org/test-vault/Projects/Alpha/" in home

    assert metadata_for(out, "Projects/Alpha.md") == {
        "doc_id": "test-vault:Projects/Alpha",
        "site": "test-vault",
        "title": "Alpha",
        "url": "https://docs.umccr.org/test-vault/Projects/Alpha/",
        "commit": "abc123",
        "updated": "2026-10-09",
    }
    assert metadata_for(out, "index.md")["url"] == "https://docs.umccr.org/test-vault/"


def test_links_to_notes_with_spaces_become_absolute_docs_urls(make_project, tmp_path):
    root = make_project(
        {
            "mkdocs.yml": VAULT_CONFIG,
            "vault/Home.md": "# Home\n\nSee [[Alpha Beta]].\n",
            "vault/Projects/Alpha Beta.md": "# Alpha Beta\n",
        }
    )
    out = tmp_path / "kb"
    export_kb(load_project(root / "mkdocs.yml"), "test-vault", out, today=TODAY, log=lambda _: None)
    assert "[Alpha Beta](https://docs.umccr.org/test-vault/Projects/Alpha%20Beta/)" in (out / "index.md").read_text()


def test_exports_only_the_pages_the_site_publishes(make_project, tmp_path):
    config = VAULT_CONFIG + "exclude_docs: |\n  Private/\ndraft_docs: |\n  *-draft.md\n"
    root = make_project(
        {
            "mkdocs.yml": config,
            "vault/Home.md": "# Home\n",
            "vault/Private/salaries.md": "# Salaries\n",
            "vault/Projects/plan-draft.md": "# Plan\n",
            "vault/Projects/README.md": "# Projects readme\n",
            "vault/Projects/index.md": "# Projects\n",
            "vault/templates/note.md": "# Template\n",
        }
    )
    out = tmp_path / "kb"
    written = export_kb(load_project(root / "mkdocs.yml"), "test-vault", out, today=TODAY, log=lambda _: None)
    assert sorted(path.relative_to(out).as_posix() for path in out.rglob("*.md")) == ["Projects/index.md", "index.md"]
    assert written == 2, "excluded, draft and template pages, and a README beside an index, are not published"


def test_rejects_exclusion_patterns_mkdocs_would_reject(make_project, tmp_path):
    root = make_project({"mkdocs.yml": VAULT_CONFIG + "exclude_docs: [Private/]\n", "vault/Home.md": "# Home\n"})
    with pytest.raises(DocsError, match="exclude_docs must be a multi-line string"):
        export_kb(load_project(root / "mkdocs.yml"), "test-vault", tmp_path / "kb", today=TODAY, log=lambda _: None)


def test_replaces_a_previous_export(make_project, tmp_path):
    root = make_project({"mkdocs.yml": OBSIDIAN_CONFIG, "vault/Home.md": "# Home\n"})
    out = tmp_path / "kb"
    (out / "stale").mkdir(parents=True)
    (out / "stale" / "old.md").write_text("old")
    export_kb(load_project(root / "mkdocs.yml"), "test-vault", out, today=TODAY, log=lambda _: None)
    assert not (out / "stale").exists()


def test_exports_the_basic_example(tmp_path):
    out = tmp_path / "kb"
    written = export_kb(
        load_project(EXAMPLES / "basic-site" / "mkdocs.yml"), "basic-site", out, today=TODAY, log=lambda _: None
    )
    assert written >= 1
    for document in out.rglob("*.md"):
        meta = metadata_for(out, document.relative_to(out).as_posix())
        assert meta["doc_id"].startswith("basic-site:")
        assert meta["url"].startswith("https://docs.umccr.org/basic-site/")
