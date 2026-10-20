from pathlib import PurePosixPath

import pytest

from umccr_docs.obsidian.bases import UnsupportedBase, evaluate, render_query
from umccr_docs.obsidian.callouts import convert_callouts
from umccr_docs.obsidian.links import rewrite_wikilinks
from umccr_docs.obsidian.properties import insert_properties
from umccr_docs.obsidian.vault import LinkError, Note, Vault


def note(path: str, output: str | None = None, **frontmatter) -> Note:
    return Note(PurePosixPath(path), PurePosixPath(output or path), frontmatter)


PROJECT_ALPHA = note(
    "Projects/alpha.md",
    type="project",
    status="active",
    priority="High",
    lead="Ada",
    members=["Grace"],
    domains=["[[area]]"],
)
PROJECT_BETA = note(
    "Projects/beta.md",
    type="project",
    status="backlog",
    priority="Medium",
    lead="Grace",
    members=[],
    domains=["[[area]]"],
)
PROJECT_GAMMA = note(
    "Projects/gamma.md",
    type="project",
    status="active",
    priority="Low",
    lead="Grace",
    members=["Ada"],
    domains=["[[other]]"],
)
INBOX_ALPHA = note("Inbox/alpha.md", type="inbox", status="promoted")
AREA = note("Projects/_domains/area.md", type="domain")
HOME = note("Home.md", "index.md", type="note")
GUIDE = note("Guides/writing.md", type="note")

NOTES = [PROJECT_ALPHA, PROJECT_BETA, PROJECT_GAMMA, INBOX_ALPHA, AREA, HOME, GUIDE]


@pytest.fixture
def vault():
    return Vault(NOTES, prefer_folders=("Projects",))


class TestResolution:
    def test_resolves_a_unique_name(self, vault):
        assert vault.resolve("beta") is PROJECT_BETA

    def test_is_case_insensitive_and_ignores_md(self, vault):
        assert vault.resolve("Beta.md") is PROJECT_BETA

    def test_prefers_the_configured_folder_for_a_duplicate_name(self, vault):
        # alpha exists in Inbox/ and Projects/; a link from anywhere, even Inbox/, means the project.
        assert vault.resolve("alpha", from_note=INBOX_ALPHA) is PROJECT_ALPHA

    def test_a_folder_qualified_link_reaches_the_other_note(self, vault):
        assert vault.resolve("Inbox/alpha") is INBOX_ALPHA

    def test_falls_back_to_the_linking_note_s_folder(self):
        plain = Vault(NOTES)
        assert plain.resolve("alpha", from_note=INBOX_ALPHA) is INBOX_ALPHA

    def test_reports_an_ambiguous_name(self):
        with pytest.raises(LinkError, match="ambiguous"):
            Vault(NOTES).resolve("alpha", from_note=GUIDE)

    def test_reports_an_unknown_name(self, vault):
        with pytest.raises(LinkError, match="does not match any note"):
            vault.resolve("missing")

    def test_links_to_the_home_note_go_to_index(self, vault):
        assert Vault.relative_url(PROJECT_ALPHA, vault.resolve("Home")) == "../index.md"

    def test_links_are_percent_encoded(self):
        target = note("Projects/Alpha Beta (draft).md")
        assert Vault.relative_url(HOME, target) == "Projects/Alpha%20Beta%20%28draft%29.md"


class TestWikilinks:
    def rewrite(self, vault, text, from_note=PROJECT_ALPHA):
        problems: list[str] = []
        return rewrite_wikilinks(text, from_note, vault, problems, text), problems

    @pytest.mark.parametrize(
        ("source", "expected"),
        [
            ("[[beta]]", "[beta](beta.md)"),
            ("[[beta|the beta project]]", "[the beta project](beta.md)"),
            (
                "[[Guides/writing#Outside the vault]]",
                "[Guides/writing > Outside the vault](../Guides/writing.md#outside-the-vault)",
            ),
            ("[[area]]", "[area](_domains/area.md)"),
            ("[[#Actions]]", "[Actions](#actions)"),
        ],
    )
    def test_rewrites(self, vault, source, expected):
        assert self.rewrite(vault, source) == (expected, [])

    def test_leaves_code_alone(self, vault):
        text = "Use `[[beta]]` like this:\n\n```\n[[beta]]\n```\n"
        assert self.rewrite(vault, text) == (text, [])

    def test_reports_embeds_and_block_references(self, vault):
        _, problems = self.rewrite(vault, "![[diagram.png]] and [[beta#^block-1]]")
        assert len(problems) == 2
        assert "embeds" in problems[0]
        assert "block references" in problems[1]

    def test_reports_unresolved_links_with_their_line(self, vault):
        _, problems = self.rewrite(vault, "# Title\n\nSee [[missing]].\n")
        assert problems == ["Projects/alpha.md:3: [[missing]] does not match any note"]


class TestBasesFilters:
    @pytest.mark.parametrize(
        ("expression", "matches"),
        [
            ('type == "project"', {PROJECT_ALPHA, PROJECT_BETA, PROJECT_GAMMA}),
            ('status != "active"', {PROJECT_BETA, INBOX_ALPHA, AREA, HOME, GUIDE}),
            ('members.contains("Ada")', {PROJECT_GAMMA}),
            ('domains.contains(link("area"))', {PROJECT_ALPHA, PROJECT_BETA}),
            ('file.inFolder("Projects")', {PROJECT_ALPHA, PROJECT_BETA, PROJECT_GAMMA, AREA}),
            ('file.name == "alpha"', {PROJECT_ALPHA, INBOX_ALPHA}),
        ],
    )
    def test_expressions(self, expression, matches):
        assert {candidate for candidate in NOTES if evaluate(expression, candidate)} == matches

    def test_nested_and_or_not(self):
        node = {
            "and": [
                'type == "project"',
                {"or": ['lead == "Ada"', 'members.contains("Ada")']},
                {"not": ['priority == "Low"']},
            ]
        }
        assert [candidate for candidate in NOTES if evaluate(node, candidate)] == [PROJECT_ALPHA]

    @pytest.mark.parametrize(
        "expression",
        ['this.file.name == "x"', 'file.hasTag("x")', "priority > 2", 'file.ctime == "x"'],
    )
    def test_unsupported_syntax_is_an_error(self, expression):
        with pytest.raises(UnsupportedBase):
            evaluate(expression, PROJECT_ALPHA)


class TestBasesTables:
    def render(self, vault, query, sort_orders=None):
        problems: list[str] = []
        table = render_query(query, HOME, vault, sort_orders or {}, problems)
        return table, problems

    def test_renders_sorted_rows_with_links(self, vault):
        query = {
            "filters": {"and": ['type == "project"', 'domains.contains(link("area"))']},
            "views": [
                {
                    "type": "table",
                    "order": ["file.name", "priority", "domains"],
                    "sort": [{"property": "priority", "direction": "DESC"}],
                }
            ],
        }
        table, problems = self.render(vault, query, {"priority": ("Low", "Medium", "High")})
        assert problems == []
        assert [line for line in table.splitlines() if line.startswith("| ")] == [
            "| Name | priority | domains |",
            "| --- | --- | --- |",
            "| [alpha](Projects/alpha.md) | High | [area](Projects/_domains/area.md) |",
            "| [beta](Projects/beta.md) | Medium | [area](Projects/_domains/area.md) |",
        ]

    def test_reports_a_link_to_a_missing_note(self, vault):
        query = {"filters": 'file.name == "gamma"', "views": [{"type": "table", "order": ["domains"]}]}
        _, problems = self.render(vault, query)
        assert problems == ["Home.md: frontmatter [[other]] does not match any note"]

    def test_without_a_sort_order_text_sorts_alphabetically(self, vault):
        query = {
            "filters": 'type == "project"',
            "views": [
                {
                    "type": "table",
                    "order": ["file.name"],
                    "sort": [{"property": "priority", "direction": "ASC"}],
                }
            ],
        }
        table, _ = self.render(vault, query)
        assert [line.split("]")[0] for line in table.splitlines() if line.startswith("| [")] == [
            "| [alpha",
            "| [gamma",
            "| [beta",
        ]  # High, Low, Medium

    def test_limit_and_empty_results(self, vault):
        limited, _ = self.render(vault, {"filters": 'type == "project"', "views": [{"type": "table", "limit": 1}]})
        assert sum(line.startswith("| [") for line in limited.splitlines()) == 1

        empty, _ = self.render(vault, {"filters": 'type == "decision"', "views": [{"type": "table"}]})
        assert "*No matching notes.*" in empty

    def test_display_names_head_the_columns(self, vault):
        table, _ = self.render(
            vault,
            {
                "filters": 'type == "project"',
                "properties": {"lead": {"displayName": "Lead"}},
                "views": [{"type": "table", "order": ["file.name", "lead"]}],
            },
        )
        assert table.splitlines()[0] == "| Name | Lead |"

    @pytest.mark.parametrize(
        "query",
        [
            {"views": [{"type": "cards"}]},
            {"views": [{"type": "table", "groupBy": "status"}]},
            {"formulas": {"x": "1"}, "views": [{"type": "table"}]},
        ],
    )
    def test_unsupported_views_are_errors(self, vault, query):
        with pytest.raises(UnsupportedBase):
            self.render(vault, query)


class TestCallouts:
    def test_converts_a_titled_callout(self):
        assert convert_callouts("> [!tip] Useful\n> Body line\n") == '!!! tip "Useful"\n\n    Body line\n\n'

    def test_maps_aliases_and_folding(self):
        assert convert_callouts("> [!caution]-\n> Hidden\n").startswith("??? warning\n")
        assert convert_callouts("> [!faq]+ Open\n> Text\n").startswith('???+ question "Open"')

    def test_leaves_plain_quotes_and_code_alone(self):
        text = "> A quote\n\n```\n> [!note] not a callout\n```\n"
        assert convert_callouts(text) == text


class TestHeadingAnchors:
    @pytest.mark.parametrize(
        ("heading", "anchor"),
        [
            ("Pages & views", "pages--views"),  # GitHub's rule: the ampersand goes, both spaces stay
            ("Common conventions", "common-conventions"),
            ("`type`", "type"),
            ("A.B c", "ab-c"),
        ],
    )
    def test_match_github(self, heading, anchor):
        from umccr_docs.markdown import heading_anchor

        assert heading_anchor(heading) == anchor


class TestProperties:
    FIELDS = ("status", "lead")

    def insert(self, body: str) -> str:
        note_with_properties = note("Projects/delta.md", status="active", lead="Ada")
        return insert_properties(body, note_with_properties, self.FIELDS, Vault(NOTES), [])

    def test_go_after_the_first_heading(self):
        body = "# Delta\n\nIntro.\n"
        assert self.insert(body).startswith('# Delta\n\n<div class="umccr-properties" markdown>')

    def test_skip_comments_in_code_before_the_first_heading(self):
        body = "Setup:\n\n```bash\n# install the tools\nmake install\n```\n\n# Delta\n\nIntro.\n"
        inserted = self.insert(body)
        assert "```bash\n# install the tools\nmake install\n```" in inserted, "the sample is untouched"
        assert inserted.index("umccr-properties") > inserted.index("# Delta")

    def test_go_on_top_when_only_code_has_a_heading_line(self):
        body = "    # an indented comment\n\n~~~\n# a fenced one\n~~~\n"
        inserted = self.insert(body)
        assert inserted.startswith('<div class="umccr-properties" markdown>')
        assert inserted.endswith(body)
