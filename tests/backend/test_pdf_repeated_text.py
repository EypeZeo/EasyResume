"""Synthetic PDFs cover repeated drawing separately from repeated resume entities."""

import io
import re

import pytest
from easyresume.documents import _extract
from easyresume.parsing import parse_profile
from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    ArrayObject,
    DecodedStreamObject,
    DictionaryObject,
    NameObject,
    NumberObject,
    TextStringObject,
)


def _pdf(*pages):
    writer = PdfWriter()
    # A tiny identity CMap provides Chinese text without installed fonts or real resumes.
    characters = set("".join(pages))
    mappings = "\n".join(f"<{ord(char):04x}> <{ord(char):04x}>" for char in sorted(characters))
    cmap = DecodedStreamObject()
    cmap.set_data(
        (
            "/CIDInit /ProcSet findresource begin 12 dict begin begincmap\n"
            "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n"
            "/CMapName /Synthetic def /CMapType 2 def\n"
            "1 begincodespacerange <0000> <ffff> endcodespacerange\n"
            f"{len(characters)} beginbfchar\n{mappings}\nendbfchar\n"
            "endcmap CMapName currentdict /CMap defineresource pop end end"
        ).encode()
    )
    descendant = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/CIDFontType2"),
            NameObject("/BaseFont"): NameObject("/Synthetic"),
            NameObject("/DW"): NumberObject(1000),
            NameObject("/CIDSystemInfo"): DictionaryObject(
                {
                    NameObject("/Registry"): TextStringObject("Adobe"),
                    NameObject("/Ordering"): TextStringObject("Identity"),
                    NameObject("/Supplement"): NumberObject(0),
                }
            ),
        }
    )
    font = DictionaryObject(
        {
            NameObject("/Type"): NameObject("/Font"),
            NameObject("/Subtype"): NameObject("/Type0"),
            NameObject("/BaseFont"): NameObject("/Synthetic"),
            NameObject("/Encoding"): NameObject("/Identity-H"),
            NameObject("/DescendantFonts"): ArrayObject([writer._add_object(descendant)]),
            NameObject("/ToUnicode"): writer._add_object(cmap),
        }
    )
    for source in pages:
        page = writer.add_blank_page(width=1200, height=700)
        page[NameObject("/Resources")] = DictionaryObject(
            {NameObject("/Font"): DictionaryObject({NameObject("/F1"): writer._add_object(font)})}
        )
        stream = DecodedStreamObject()
        # The source notation keeps fixture strings readable while encoding PDF glyphs.
        encoded = re.sub(r"\(([^()]*)\)", lambda match: f"<{match[1].encode('utf-16-be').hex()}>", source)
        stream.set_data(encoded.encode())
        page[NameObject("/Contents")] = writer._add_object(stream)
    output = io.BytesIO()
    writer.write(output)
    return output.getvalue()


def _draw(text, x=30, y=600):
    return f"BT /F1 10 Tf 1 0 0 1 {x} {y} Tm ({text}) Tj ET\n"


def test_pdf_same_position_overlay_is_removed_before_layout_and_evidence_extraction():
    school = "示例职业技术学院"
    company = "示例信息技术有限公司"
    source = (
        _draw("教育经历", y=650)
        + _draw("2021-10 ~ 2024-07", y=630)
        + _draw(school)
        + _draw(school)
        + _draw("计算机网络技术 大专", y=580)
        + _draw("工作经历", y=550)
        + _draw("2024-08 ~ 至今", y=530)
        + _draw(company, y=510)
        + _draw(company, y=510)
        + _draw("运维工程师 正式工作", y=490)
    )
    data = _pdf(source)
    # This reproduces the old extraction failure without using any personal data.
    original = PdfReader(io.BytesIO(data)).pages[0].extract_text(extraction_mode="layout")
    assert original.count(school) == original.count(company) == 2
    text, kind, blocks = _extract(data)
    assert kind == "pdf"
    assert text.count(school) == text.count(company) == 1
    assert sum(block["text"].count(school) for block in blocks) == 1
    profile = parse_profile(text)
    assert profile.education_records[0].school == school
    assert profile.education_records[0].start_date == "2021-10"
    assert profile.education_records[0].end_date == "2024-07"
    assert profile.work_records[0].company == company
    assert profile.work_records[0].title == "运维工程师"
    assert not profile.work_records[0].confirmed


def test_pdf_repeated_absolute_glyphs_are_removed_without_merging_adjacent_characters():
    source = "BT /F1 10 Tf "
    for index, glyph in enumerate("人人科技有限公司"):
        draw = f"1 0 0 1 {30 + index * 10} 600 Tm ({glyph}) Tj "
        source += draw + draw
    text, _, _ = _extract(_pdf(source + "ET"))
    assert text.strip() == "人人科技有限公司"


@pytest.mark.parametrize(
    "source",
    [
        "BT /F1 10 Tf 30 600 Td (人人) Tj (人人) Tj ET",
        "BT /F1 10 Tf 30 600 Td [(人人) 0 (人人)] TJ ET",
        _draw("人人") + _draw("人人", x=50),
    ],
)
def test_pdf_real_repetition_in_one_line_is_preserved(source):
    text, _, _ = _extract(_pdf(source))
    assert text.replace(" ", "").strip() == "人人人人"


def test_pdf_repeated_text_at_different_lines_pages_and_graphics_transforms_is_preserved():
    company = "人人科技有限公司"
    source = _draw(company) + _draw(company, y=570)
    source += "q 1 0 0 1 0 -60 cm " + _draw(company) + "Q"
    text, _, blocks = _extract(_pdf(source, _draw(company)))
    assert text.count(company) == 4
    assert "\n\f\n" in text
    assert {block["page"] for block in blocks} == {1, 2}


def test_pdf_entire_relative_position_text_object_overlay_is_removed():
    draw = "BT /F1 10 Tf 30 600 Td (示例学院) Tj ET\n"
    assert _extract(_pdf(draw + draw))[0].strip() == "示例学院"


def test_pdf_different_inherited_font_state_and_partial_overlaps_are_preserved():
    school = "示例学院"
    source = _draw(school)
    source += f"BT /F1 12 Tf 1 0 0 1 30 600 Tm ({school}) Tj ET\n"
    source += f"BT /F1 10 Tf 1 0 0 1 30 600 Tm ({school}) Tj (计算机专业) Tj ET\n"
    text, _, _ = _extract(_pdf(source))
    assert text.count(school) == 3
    assert text.count("计算机专业") == 1


def test_pdf_spacing_changed_by_quote_operator_is_preserved():
    source = _draw("示例学院")
    source += 'BT /F1 10 Tf 30 550 Td 10 5 (其他文字) " 1 0 0 1 30 600 Tm (示例学院) Tj ET'
    text, _, _ = _extract(_pdf(source))
    assert text.count("示例学院") == 2


def test_pdf_non_text_state_at_absolute_run_boundary_is_not_lost():
    source = "BT /F1 10 Tf 1 0 0 1 30 600 Tm (示例学院) Tj ET\n"
    # Identical TJ arrays can be deduplicated; their positioning and later text stay valid.
    repeated = "BT /F1 10 Tf 1 0 0 1 30 570 Tm [(人人) 10 (科技有限公司)] TJ ET\n"
    text, _, _ = _extract(_pdf(source + repeated + repeated + _draw("下一条经历", y=540)))
    assert text.count("人人") == text.count("科技有限公司") == 1
    assert "下一条经历" in text


def test_adjacent_complete_entities_are_collapsed_but_original_evidence_is_preserved():
    school = "示例职业技术学院"
    company = "示例城市基础设施信息技术服务有限公司"
    text = (
        f"教育经历\n2021-10 ~ 2024-07\n{school}{school}\n计算机网络技术（大专）\n"
        f"工作经历\n2024-08 ~ 至今 {company}{company}运维工程师\n"
        "职责：逐项检查检查结果；人人协作。"
    )
    profile = parse_profile(text)
    assert profile.education_records[0].school == school
    assert profile.work_records[0].company == company
    assert profile.work_records[0].title == "运维工程师"
    assert profile.work_records[0].employment_type == "unknown"
    assert profile.text == text
    assert company + company in profile.work_records[0].snippet
    assert "逐项检查检查结果；人人协作。" in profile.work_records[0].responsibilities


def test_same_entities_in_distinct_experiences_and_repeated_name_characters_are_preserved():
    text = (
        "教育经历\n2018-09 ~ 2021-07 人人学院 大专\n2021-09 ~ 2023-07 人人学院 本科\n"
        "工作经历\n2023-08 ~ 2024-07 人人科技有限公司 运维工程师\n"
        "2024-08 ~ 至今 人人科技有限公司 技术经理"
    )
    profile = parse_profile(text)
    assert [record.school for record in profile.education_records] == ["人人学院", "人人学院"]
    assert [record.company for record in profile.work_records] == ["人人科技有限公司", "人人科技有限公司"]
    assert [record.title for record in profile.work_records] == ["运维工程师", "技术经理"]


def test_complete_school_with_nested_school_suffix_is_not_shortened():
    profile = parse_profile("教育经历\n2020-09 ~ 2024-07 示例大学医学院 本科")
    assert profile.education_records[0].school == "示例大学医学院"


def test_horizontal_adjacent_entities_collapse_without_joining_different_names():
    value = parse_profile(
        "教育经历\n2020-2023 示例学院 示例学院 示例学院 大专\n"
        "工作经历\n2023-2024 示例科技有限公司\t示例科技有限公司\t示例科技有限公司 运维工程师\n"
        "2024-2025 另一科技有限公司 技术经理"
    )
    assert value.education_records[0].school == "示例学院"
    assert [record.company for record in value.work_records] == ["示例科技有限公司", "另一科技有限公司"]
