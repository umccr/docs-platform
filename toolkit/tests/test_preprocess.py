import pytest
from conftest import EXAMPLES, OBSIDIAN_CONFIG

from umccr_docs.config import load_project
from umccr_docs.errors import DocsError
from umccr_docs.preprocess import preprocess


def test_example_vault(tmp_path):
    project = load_project(EXAMPLES / "obsidian-vault" / "mkdocs.yml")
    assert preprocess(project, tmp_path / "out") == []
    out = tmp_path / "out"

    # The home note becomes the index, and links to it follow.
    assert (out / "index.md").is_file()
    assert not (out / "Home.md").exists()
    assert "[Back home](index.md)" in (out / "Priorities.md").read_text()

    # Dot-directories such as .obsidian are never published.
    assert not (out / ".obsidian").exists()

    home = (out / "index.md").read_text()
    assert "```base" not in home
    assert "| [alpha](Projects/alpha.md) | [platform-area](Projects/_domains/platform-area.md) | Ada | High |" in home
    assert home.index("[alpha]") < home.index("[gamma]"), "priority DESC lists High before Low"
    assert "An Obsidian comment" not in home
    assert '!!! tip "How this page works"' in home

    inbox = (out / "Inbox" / "alpha.md").read_text()
    assert "[alpha](../Projects/alpha.md)" in inbox, "prefer_folders sends a duplicate name to Projects/"
    assert "[Inbox/alpha](alpha.md)" in inbox

    writing = (out / "Guides" / "writing.md").read_text()
    assert "(https://github.com/umccr/docs-platform/blob/main/examples/obsidian-vault/README.md)" in writing

    alpha = (out / "Projects" / "alpha.md").read_text()
    assert "| Lead | Ada |" in alpha
    assert "`[[not-a-link]]`" in alpha


def vault_problems(make_project, notes: dict[str, str], config: str = OBSIDIAN_CONFIG) -> list[str]:
    root = make_project({"mkdocs.yml": config, **{f"vault/{path}": text for path, text in notes.items()}})
    return preprocess(load_project(root / "mkdocs.yml"), root / "out", strict=False)


def test_strict_mode_fails_on_problems(make_project):
    root = make_project({"mkdocs.yml": OBSIDIAN_CONFIG, "vault/index.md": "# Home\n\n[[missing]]\n"})
    with pytest.raises(DocsError, match="1 problem"):
        preprocess(load_project(root / "mkdocs.yml"), root / "out")


def test_an_ambiguous_name_outside_the_preferred_folders_is_a_problem(make_project):
    problems = vault_problems(
        make_project,
        {
            "index.md": "# Home\n\n[[duplicate]]\n",
            "Inbox/duplicate.md": "# One\n",
            "Decisions/duplicate.md": "# Two\n",
        },
    )
    assert problems == ["index.md:3: [[duplicate]] is ambiguous: it matches Decisions/duplicate.md, Inbox/duplicate.md"]


def test_unsupported_bases_syntax_is_a_problem(make_project):
    base = '```base\nfilters:\n  and:\n    - file.hasTag("x")\n```\n'
    problems = vault_problems(make_project, {"index.md": f"# Home\n\n{base}"})
    assert problems == ["index.md:3: Bases block: filter expression 'file.hasTag(\"x\")' is not supported"]


def test_links_leaving_the_repository_are_problems(make_project):
    problems = vault_problems(make_project, {"index.md": "# Home\n\n[x](../../../elsewhere.md)\n"})
    assert problems == ["index.md: link ../../../elsewhere.md leaves the repository"]


def test_images_outside_docs_dir_are_problems(make_project):
    root_files = {"diagram.png": "not really a png"}
    problems = vault_problems(make_project, {"index.md": "# Home\n\n![diagram](../diagram.png)\n", **{}})
    assert problems == ["index.md: image ../diagram.png is outside docs_dir; move it inside so it is published"]
    assert root_files  # the image itself does not need to exist for the check


def test_markdown_sites_only_get_link_rewriting(make_project):
    config = """
    site_name: Plain
    site_url: https://docs.umccr.org/plain/
    repo_url: https://github.com/umccr/plain
    docs_dir: docs
    """
    root = make_project(
        {
            "mkdocs.yml": config,
            "README.md": "# Readme\n",
            "docs/index.md": "# Home\n\n[[not converted]] [r](../README.md)\n",
        }
    )
    out = root / "out"
    assert preprocess(load_project(root / "mkdocs.yml"), out) == []
    text = (out / "index.md").read_text()
    assert "[[not converted]]" in text
    assert "(https://github.com/umccr/plain/blob/main/README.md)" in text
