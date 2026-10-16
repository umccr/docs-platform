import pytest

from umccr_docs.active_content import (
    BASE,
    EMBED,
    ENTITY,
    HANDLER,
    SCRIPT,
    SCRIPT_URL,
    STYLESHEET,
    decode_document,
    unsafe_html,
)


@pytest.mark.parametrize(
    ("html", "expected"),
    [
        ("<SCRIPT src=x></SCRIPT>", [SCRIPT]),
        ('<svg><script href="x.js"/></svg>', [SCRIPT]),
        ("<iframe src=x></iframe>", [EMBED]),
        ('<base href="/other-site/">', [BASE]),
        ('<img src="x" onerror="steal()">', [HANDLER]),
        ('<img/src="x"/onerror=steal()>', [HANDLER]),
        ('<a href="javascript:alert(1)">x</a>', [SCRIPT_URL]),
        ('<a href="&#106;avascript:alert(1)">x</a>', [SCRIPT_URL]),
        ('<a href=" java\tscript:alert(1)">x</a>', [SCRIPT_URL]),
        ('<a href="VBScript:x">x</a>', [SCRIPT_URL]),
        ('<form action="javascript:alert(1)"><button>x</button></form>', [SCRIPT_URL]),
        ('<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>', [SCRIPT_URL]),
        ('<svg><a><animate attributeName="href" values="x;javascript:alert(1)"/></a></svg>', [SCRIPT_URL]),
        ('<svg><set attributeName="onmouseover" to="alert(1)"/></svg>', [HANDLER]),
        ('<?xml-stylesheet type="text/xsl" href="x.xsl"?><svg/>', [STYLESHEET]),
        ('<!DOCTYPE svg [<!ENTITY x "&#60;script&#62;">]><svg>&x;</svg>', [ENTITY]),
    ],
)
def test_detects_what_can_run_code(html, expected):
    assert unsafe_html(html) == expected


@pytest.mark.parametrize(
    "html",
    [
        # A browser parses <style> and <title> inside SVG as markup, and can end a comment at `--!>`.
        "<svg><style><img src=x onerror=alert(1)></style></svg>",
        "<svg><title><img src=x onerror=alert(1)></title></svg>",
        "<!-- --!><img src=x onerror=alert(1)> -->",
        "<![CDATA[<img src=x onerror=alert(1)>]]>",
    ],
)
def test_reads_what_a_browser_may_parse_as_markup(html):
    assert unsafe_html(html) == [HANDLER]


@pytest.mark.parametrize(
    "html",
    [
        '<p><a href="https://example.org" title="javascript: the good parts">x</a></p>',
        '<p><img alt="diagram" src="diagram.png" width="300"></p>',
        '<a class="md-button" href="../guide/" target="_blank">Guide</a>',
        "<pre><code>&lt;script&gt;alert(1)&lt;/script&gt;</code></pre>",
        '<input type="checkbox" disabled checked><label for="__tabbed_1_1">Tab</label>',
    ],
)
def test_ordinary_content_passes(html):
    assert unsafe_html(html) == []


def test_reports_each_kind_once_in_order():
    html = '<img src=x onerror=a()><a href="javascript:b()">x</a><img src=y onload=c()>'
    assert unsafe_html(html) == [HANDLER, SCRIPT_URL]


@pytest.mark.parametrize(
    ("data", "text"),
    [
        (b"<svg/>", "<svg/>"),
        ("﻿<p>café</p>".encode(), "<p>café</p>"),
        # A UTF-16 document, with its byte order mark or without, and anything that is not UTF-8, is refused.
        ("<svg><script>alert(1)</script></svg>".encode("utf-16"), None),
        ("<svg><script>alert(1)</script></svg>".encode("utf-16-le"), None),
        ("<p>café</p>".encode("latin-1"), None),
    ],
)
def test_documents_are_read_as_utf8_or_not_at_all(data, text):
    assert decode_document(data) == text


def test_theme_pages_may_carry_scripts_but_nothing_else():
    page = '<script>__md_scope=new URL("..",location)</script><a href=x onclick=y()>x</a>'
    assert unsafe_html(page, scripts_allowed=True) == [HANDLER]
