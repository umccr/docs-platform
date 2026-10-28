import datetime
import re
from pathlib import PurePosixPath

import pytest

from umccr_docs.obsidian import tasks
from umccr_docs.obsidian.bases import UnsupportedBase, evaluate, render_query
from umccr_docs.obsidian.callouts import convert_callouts
from umccr_docs.obsidian.links import rewrite_wikilinks, wikilink_to_markdown
from umccr_docs.obsidian.properties import insert_properties, properties_block
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
        warnings: list[str] = []
        return rewrite_wikilinks(text, from_note, vault, problems, warnings, text), problems, warnings

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
        assert self.rewrite(vault, source) == (expected, [], [])

    def test_leaves_code_alone(self, vault):
        text = "Use `[[beta]]` like this:\n\n```\n[[beta]]\n```\n"
        assert self.rewrite(vault, text) == (text, [], [])

    def test_reports_embeds_and_block_references(self, vault):
        _, problems, _ = self.rewrite(vault, "![[diagram.png]] and [[beta#^block-1]]")
        assert len(problems) == 2
        assert "embeds" in problems[0]
        assert "block references" in problems[1]

    def test_keeps_a_link_to_a_missing_note_as_text_and_warns_with_its_line(self, vault):
        text = "# Title\n\nSee [[missing]] and [[missing#Heading|the label]].\n"
        assert self.rewrite(vault, text) == (
            text,
            [],
            [
                "Projects/alpha.md:3: [[missing]] does not match any note",
                "Projects/alpha.md:3: [[missing]] does not match any note",
            ],
        )

    def test_reports_an_ambiguous_link(self):
        _, problems, warnings = self.rewrite(Vault(NOTES), "[[alpha]]", from_note=GUIDE)
        assert problems == ["Guides/writing.md:1: [[alpha]] is ambiguous: it matches Projects/alpha.md, Inbox/alpha.md"]
        assert warnings == []

    def test_a_link_shown_on_another_page_resolves_from_the_note_it_is_in(self):
        # As a Tasks list shows it on the home page: from there, "alpha" would be ambiguous.
        plain = Vault(NOTES)
        assert wikilink_to_markdown("alpha", INBOX_ALPHA, plain, page=HOME) == "[alpha](Inbox/alpha.md)"
        assert wikilink_to_markdown("#Next steps", INBOX_ALPHA, plain, page=HOME) == (
            "[Next steps](Inbox/alpha.md#next-steps)"
        )


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
        table = render_query(query, HOME, vault, sort_orders or {}, problems, [])
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

    def test_shows_a_link_to_a_missing_note_as_text_and_warns(self, vault):
        query = {"filters": 'file.name == "gamma"', "views": [{"type": "table", "order": ["domains"]}]}
        problems: list[str] = []
        warnings: list[str] = []
        table = render_query(query, HOME, vault, {}, problems, warnings)
        assert "| \\[\\[other\\]\\] |" in table.splitlines()
        assert problems == []
        assert warnings == ["Home.md: frontmatter [[other]] does not match any note"]

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
        return insert_properties(body, note_with_properties, self.FIELDS, Vault(NOTES), [], [])

    def test_go_after_the_first_heading(self):
        body = "# Delta\n\nIntro.\n"
        assert self.insert(body).startswith('# Delta\n\n<dl class="umccr-properties" markdown>')

    def test_skip_comments_in_code_before_the_first_heading(self):
        body = "Setup:\n\n```bash\n# install the tools\nmake install\n```\n\n# Delta\n\nIntro.\n"
        inserted = self.insert(body)
        assert "```bash\n# install the tools\nmake install\n```" in inserted, "the sample is untouched"
        assert inserted.index("umccr-properties") > inserted.index("# Delta")

    def test_go_on_top_when_only_code_has_a_heading_line(self):
        body = "    # an indented comment\n\n~~~\n# a fenced one\n~~~\n"
        inserted = self.insert(body)
        assert inserted.startswith('<dl class="umccr-properties" markdown>')
        assert inserted.endswith(body)

    def test_name_each_property_and_text_value_for_the_theme(self):
        delta = note("Projects/delta.md", status="On hold", updated=datetime.date(2026, 9, 8), members=["Ada", "Grace"])
        block = properties_block(delta, ("status", "updated", "members"), Vault(NOTES), [], [])
        assert block.strip().splitlines() == [
            '<dl class="umccr-properties" markdown>',
            '<div data-property="status" data-value="on-hold" markdown><dt>Status</dt>'
            '<dd markdown="span">On hold</dd></div>',
            '<div data-property="updated" markdown><dt>Updated</dt>'
            '<dd markdown="span"><time datetime="2026-09-08">8 Sep 2026</time></dd></div>',
            '<div data-property="members" markdown><dt>Members</dt><dd markdown="span">Ada, Grace</dd></div>',
            "</dl>",
        ]


TODAY = datetime.date(2026, 10, 28)


def task_note(path: str, text: str, output: str | None = None) -> Note:
    return Note(PurePosixPath(path), PurePosixPath(output or path), {}, text)


TASKS_ALPHA = task_note(
    "Projects/alpha.md",
    "---\ntype: project\n---\n# Alpha\n\n## Objective\n\n- [ ] Ada: requirement, not an action\n\n"
    "## Actions & Follow-up\n\n"
    "- [ ] Ada: ship [[beta]], see [the guide](../Guides/writing.md#steps) ➕ 2026-09-01\n"
    "- [x] Grace: draft the design ➕ 2026-09-01 ✅ 2026-09-20\n"
    "- [ ] Ada/Grace: pick a date ➕ 2026-10-20 📅 2026-10-30\n"
    "    - [ ] book the room\n"
    "- [-] Grace: drop the old plan ➕ 2026-09-01 ❌ 2026-09-10\n",
)
TASKS_IDEA = task_note(
    "Inbox/idea.md",
    "# Idea\n\n- [ ] Grace: decide whether to start ➕ 2026-10-25\n- [/] Ada: compare the options\n\n"
    "## Context\n\n- [x] Ada: read [[missing]] and [[#Context]] ✅ 2026-10-26\n",
)
TASKS_HOME = task_note("Home.md", "# Home\n", "index.md")
TASKS_STATUS = task_note("Status/ada.md", "# Ada\n")
TASK_VAULT = Vault([TASKS_ALPHA, TASKS_IDEA, TASKS_HOME, TASKS_STATUS, PROJECT_BETA, GUIDE])
VAULT_TASKS = tasks.find_tasks(TASK_VAULT)


def found(instructions: str) -> list[str]:
    """The first two words of each task the instructions find, in the vault's order."""
    query = tasks.parse_query(instructions, TODAY)
    return [
        " ".join(task.description.split()[:2])
        for task in VAULT_TASKS
        if all(filter_(task) for filter_ in query.filters)
    ]


def listed(instructions: str, page: Note = TASKS_HOME) -> str:
    return tasks.render_query(tasks.parse_query(instructions, TODAY), page, TASK_VAULT, VAULT_TASKS, TODAY)


class TestTaskLines:
    def test_reads_each_checkbox_with_the_heading_it_is_under(self):
        assert [(task.status, task.description, task.heading) for task in tasks.note_tasks(TASKS_ALPHA)] == [
            (" ", "Ada: requirement, not an action", "Objective"),
            (" ", "Ada: ship [[beta]], see [the guide](../Guides/writing.md#steps)", "Actions & Follow-up"),
            ("x", "Grace: draft the design", "Actions & Follow-up"),
            (" ", "Ada/Grace: pick a date", "Actions & Follow-up"),
            (" ", "book the room", "Actions & Follow-up"),
            ("-", "Grace: drop the old plan", "Actions & Follow-up"),
        ]

    def test_reads_fields_from_the_end_past_tags_as_the_plugin_does(self):
        text = "- [ ] Ship it #ops ⏫ 🔁 every week ➕ 2026-10-01 📅 2026-02-30 #later ^abc-1\n"
        (task,) = tasks.note_tasks(task_note("x.md", text))
        assert task.description == "Ship it #ops #later"
        assert task.fields == {
            "priority": "⏫",
            "recurrence rule": "every week",
            "created date": "2026-10-01",
            "due date": "2026-02-30",
        }
        assert task.date("created date") == datetime.date(2026, 10, 1)
        assert task.date("due date") is None, "not a real date"

    def test_an_emoji_may_carry_a_variation_selector(self):
        # Some keyboards type the due date's emoji as U+1F4C5 U+FE0F.
        (task,) = tasks.note_tasks(task_note("x.md", "- [ ] Ship it \U0001f4c5\ufe0f 2026-10-30\n"))
        assert (task.description, task.fields) == ("Ship it", {"due date": "2026-10-30"})

    def test_skips_code_comments_and_what_only_looks_like_a_checkbox(self):
        text = (
            "```md\n- [ ] in a code sample\n```\n\n%% - [ ] in a comment %%\n\n"
            "- [link](x.md) is a link\n- [x]glued is not a task\n\n> - [ ] in a callout\n"
        )
        assert [task.description for task in tasks.note_tasks(task_note("x.md", text))] == ["in a callout"]

    def test_an_underlined_line_is_a_heading_and_a_rule_is_not(self):
        text = "Setup\n-----\n\n- [ ] one\n\nPara\n\n---\n\n- [ ] two\n"
        assert [task.heading for task in tasks.note_tasks(task_note("x.md", text))] == ["Setup", "Setup"]

    def test_done_means_done_or_cancelled(self):
        text = "- [ ] a\n- [/] b\n- [?] c\n- [x] d\n- [X] e\n- [-] f\n"
        assert [task.done for task in tasks.note_tasks(task_note("x.md", text))] == [
            False,
            False,
            False,
            True,
            True,
            True,
        ]


class TestTaskFilters:
    @pytest.mark.parametrize(
        ("instructions", "expected"),
        [
            (
                "not done",
                ["Ada: requirement,", "Ada: ship", "Ada/Grace: pick", "book the", "Grace: decide", "Ada: compare"],
            ),
            ("done", ["Grace: draft", "Grace: drop", "Ada: read"]),
            (
                "heading includes actions & FOLLOW-UP",
                ["Ada: ship", "Grace: draft", "Ada/Grace: pick", "book the", "Grace: drop"],
            ),
            ("path includes Inbox/", ["Grace: decide", "Ada: compare", "Ada: read"]),
            ("folder does not include Projects/", ["Grace: decide", "Ada: compare", "Ada: read"]),
            ("filename includes IDEA.md", ["Grace: decide", "Ada: compare", "Ada: read"]),
            ("description includes grace", ["Grace: draft", "Ada/Grace: pick", "Grace: drop", "Grace: decide"]),
            (
                r"description regex matches /^[^:]*\bAda\b[^:]*:/",
                ["Ada: requirement,", "Ada: ship", "Ada/Grace: pick", "Ada: compare", "Ada: read"],
            ),
            (r"description regex does not match /^[^:]{1,40}:\s/", ["book the"]),
            ("description regex matches /^ada:/i", ["Ada: requirement,", "Ada: ship", "Ada: compare", "Ada: read"]),
            ("created before 14 days ago", ["Ada: ship", "Grace: draft", "Grace: drop"]),
            ("created on or after 2026-10-20", ["Ada/Grace: pick", "Grace: decide"]),
            ("due before in 1 week", ["Ada/Grace: pick"]),
            ("done on or after 3 days ago", ["Ada: read"]),
            ("has due date", ["Ada/Grace: pick"]),
            ("no created date", ["Ada: requirement,", "book the", "Ada: compare", "Ada: read"]),
            # A task without a start date can start any time: every `starts` filter lets it through.
            (
                "starts after tomorrow",
                [
                    "Ada: requirement,",
                    "Ada: ship",
                    "Grace: draft",
                    "Ada/Grace: pick",
                    "book the",
                    "Grace: drop",
                    "Grace: decide",
                    "Ada: compare",
                    "Ada: read",
                ],
            ),
        ],
    )
    def test_one_filter(self, instructions, expected):
        assert found(instructions) == expected

    @pytest.mark.parametrize(
        ("instructions", "expected"),
        [
            (
                "(heading includes Actions & Follow-up) OR (path includes Inbox/)\nnot done",
                ["Ada: ship", "Ada/Grace: pick", "book the", "Grace: decide", "Ada: compare"],
            ),
            (
                "(not done) AND NOT (path includes Inbox/)",
                ["Ada: requirement,", "Ada: ship", "Ada/Grace: pick", "book the"],
            ),
            (
                "NOT (done)",
                ["Ada: requirement,", "Ada: ship", "Ada/Grace: pick", "book the", "Grace: decide", "Ada: compare"],
            ),
            (
                "(path includes Inbox/) XOR (description includes Grace)",
                ["Grace: draft", "Ada/Grace: pick", "Grace: drop", "Ada: compare", "Ada: read"],
            ),
            (
                "((description includes Ada) OR (description includes Grace)) AND (not done)",
                ["Ada: requirement,", "Ada: ship", "Ada/Grace: pick", "Grace: decide", "Ada: compare"],
            ),
        ],
    )
    def test_filters_combine(self, instructions, expected):
        assert found(instructions) == expected

    @pytest.mark.parametrize(
        ("instructions", "error"),
        [
            ("explain", "'explain' is not supported"),
            ("show tree", "'show tree' is not supported"),
            ("group by tags", "group by folder, filename, path, heading"),
            ("sort by random", "'sort by random' is not supported"),
            ("due this week", "date 'this week' is not supported"),
            ("happens before today", "'happens before today' is not supported"),
            ("path includes {{query.file.folder}}", "placeholders are not supported"),
            ("(done) OR (due today) AND (not done)", "mixes AND and OR"),
            ("(done) OR due today", "put each filter in parentheses"),
            ("(done", "a parenthesis is not closed"),
            ("description regex matches /x/g", "the g flag is not supported"),
            ("description regex matches /(?<name>x)/", "/(?<name>x)/:"),
        ],
    )
    def test_anything_else_is_unsupported(self, instructions, error):
        with pytest.raises(tasks.UnsupportedQuery, match=re.escape(error)):
            tasks.parse_query(instructions, TODAY)


class TestTaskLists:
    def test_groups_by_folder_then_note_with_links_back_to_each_task(self):
        markdown = listed(
            "not done\n(heading includes Actions & Follow-up) OR (path includes Inbox/)\n"
            "group by folder\ngroup by filename\nshort mode"
        )
        link = "{ .umccr-task-link }"
        assert markdown.split("\n\n") == [
            '<div class="umccr-tasks-group" role="heading" aria-level="4">Inbox/</div>',
            '<div class="umccr-tasks-group" role="heading" aria-level="5" markdown="span">[idea](Inbox/idea.md)</div>',
            # In progress before to do: the plugin's default order.
            f'- [ ] Ada: compare the options\xa0[🔗](Inbox/idea.md#idea "idea > Idea"){link}\n'
            "- [ ] Grace: decide whether to start\xa0"
            '<span class="umccr-task-field" title="Created date: 2026-10-25">➕</span>\xa0'
            f'[🔗](Inbox/idea.md#idea "idea > Idea"){link}',
            '<div class="umccr-tasks-group" role="heading" aria-level="4">Projects/</div>',
            '<div class="umccr-tasks-group" role="heading" aria-level="5" markdown="span">'
            "[alpha](Projects/alpha.md)</div>",
            # A due date makes a task more urgent, so it comes first.
            "- [ ] Ada/Grace: pick a date\xa0"
            '<span class="umccr-task-field" title="Created date: 2026-10-20">➕</span>\xa0'
            '<span class="umccr-task-field" title="Due date: 2026-10-30">📅</span>\xa0'
            f'[🔗](Projects/alpha.md#actions--follow-up "alpha > Actions & Follow-up"){link}\n'
            # Links reach what they reach in the task's own note: its wikilinks and relative links are rewritten.
            "- [ ] Ada: ship [beta](Projects/beta.md), see [the guide](Guides/writing.md#steps)\xa0"
            '<span class="umccr-task-field" title="Created date: 2026-09-01">➕</span>\xa0'
            f'[🔗](Projects/alpha.md#actions--follow-up "alpha > Actions & Follow-up"){link}\n'
            f'- [ ] book the room\xa0[🔗](Projects/alpha.md#actions--follow-up "alpha > Actions & Follow-up"){link}',
            '<p class="umccr-base-note">5 tasks. Generated from the notes\' tasks when the site was built.</p>',
        ]

    def test_full_mode_shows_values_and_where_each_task_is(self):
        markdown = listed("path includes Projects/\nnot done\nsort by created reverse\nhide task count", TASKS_STATUS)
        items = [line for line in markdown.splitlines() if line.startswith("- [")]
        # Reversed, tasks without a created date come first, as in the plugin.
        assert [item.split("\xa0")[0] for item in items] == [
            "- [ ] Ada: requirement, not an action",
            "- [ ] book the room",
            "- [ ] Ada/Grace: pick a date",
            "- [ ] Ada: ship [beta](../Projects/beta.md), see [the guide](../Guides/writing.md#steps)",
        ]
        assert items[2].endswith(
            '<span class="umccr-task-field" title="Due date: 2026-10-30">📅 2026-10-30</span>\xa0'
            "([alpha > Actions & Follow-up](../Projects/alpha.md#actions--follow-up){ .umccr-task-link })"
        )
        assert markdown.endswith(
            '<p class="umccr-base-note">Generated from the notes\' tasks when the site was built.</p>'
        )

    def test_a_link_that_does_not_resolve_stays_text(self):
        markdown = listed("path includes Inbox/\ndone\nhide backlink\nhide done date")
        # [[missing]] is reported where the task is; here it is text that the page's own wikilinks pass leaves alone.
        assert "- [x] Ada: read \\[\\[missing\\]\\] and [Context](Inbox/idea.md#context)\n" in markdown + "\n"

    def test_limits_and_group_headings(self):
        markdown = listed("not done\ngroup by heading\nlimit groups 1\nhide backlink")
        assert [line for line in markdown.splitlines() if line.startswith(("<div", "- ["))] == [
            '<div class="umccr-tasks-group" role="heading" aria-level="4">Actions &amp; Follow-up</div>',
            "- [ ] Ada/Grace: pick a date\xa0"
            '<span class="umccr-task-field" title="Created date: 2026-10-20">➕ 2026-10-20</span>\xa0'
            '<span class="umccr-task-field" title="Due date: 2026-10-30">📅 2026-10-30</span>',
            '<div class="umccr-tasks-group" role="heading" aria-level="4">Idea</div>',
            "- [ ] Ada: compare the options",
            '<div class="umccr-tasks-group" role="heading" aria-level="4">Objective</div>',
            "- [ ] Ada: requirement, not an action",
        ]
        assert "3 tasks." in markdown
        assert listed("not done\nlimit 2").count("\n- [") == 1

    def test_nothing_found(self):
        assert listed("description includes nothing like this").startswith("*No matching tasks.*\n\n")

    def test_a_block_is_replaced_and_an_unsupported_one_is_a_problem_with_its_line(self):
        body = "# Home\n\nIntro.\n```tasks\nnot done\n```\n\n```tasks\nexplain\n```\n"
        problems: list[str] = []
        rendered = tasks.render_tasks(body, TASKS_HOME, TASK_VAULT, VAULT_TASKS, problems, body, TODAY)
        assert rendered.startswith("# Home\n\nIntro.\n\n- [ ] "), "a blank line, as a list cannot interrupt a paragraph"
        assert rendered.endswith("\n```tasks\nexplain\n```\n"), "the block it cannot run stays as it is"
        assert problems == ["Home.md:8: Tasks block: 'explain' is not supported"]
