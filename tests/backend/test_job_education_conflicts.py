import pytest
from easyresume.engine import evaluate
from easyresume.parsing import parse_job
from easyresume.schemas import Profile, Strategy


@pytest.mark.parametrize(
    "summary,body,degree",
    [
        ("大专", "本科及以上学历", "本科"),
        ("本科", "大专及以上学历", "本科"),
        ("学历不限", "本科及以上学历", "本科"),
        ("大专", "本科或硕士学历", "本科"),
        ("本科", "硕士或博士学历", "硕士"),
    ],
)
def test_higher_explicit_requirement_preserves_both_sources(summary, body, degree):
    job = parse_job(f"测试工程师\n8000-11000元\n郑州 · 经验不限 · {summary}\n任职要求\n1. {body}")
    assert job.education == degree
    assert job.education_mode == "required"
    assert any("学历要求不一致" in risk for risk in job.risks)
    evidence = [e for e in job.evidence if e.field == "education"]
    assert any(summary in e.snippet for e in evidence)
    assert any(body in e.snippet for e in evidence)


def test_student_alternative_is_not_a_required_master_or_completed_bachelor():
    job = parse_job("大专\n任职要求\n计算机、大数据、软件工程等相关专业在读本科或研究生。")
    assert job.education == "本科"
    assert job.education_mode == "complex"
    assert any("在读" in risk for risk in job.risks)
    job.extraction_checked = True
    result = evaluate(job, Profile(education_completed="本科", confirmed=True), Strategy())
    assert result["group"] == "pending"


@pytest.mark.parametrize(
    "text,degree,mode",
    [
        ("大专\n任职要求：本科优先", "大专", "required"),
        ("本科及以上学历，硕士优先", "本科", "required"),
        ("本科及以上学历（硕士优先）", "本科", "required"),
        ("大专及以上学历（本科优先）", "大专", "required"),
        ("学历不限，本科优先", "本科", "preferred"),
        ("大专\n任职要求：本科或3年相关经验", "本科", "alternative"),
        ("本科及以上学历，优秀者可放宽", "本科", "complex"),
        ("大专\n负责本科教学系统的维护", "大专", "required"),
        ("负责本科教学系统的维护", "unknown", "unknown"),
        ("大专\n硕士课程平台运维", "大专", "required"),
        ("学历不限，不要求本科", "none", "unrestricted"),
    ],
)
def test_preference_alternative_and_incidental_mentions_keep_semantics(text, degree, mode):
    job = parse_job(text)
    assert (job.education, job.education_mode) == (degree, mode)


def test_higher_requirement_and_conflict_remain_visible_in_assessment():
    job = parse_job("大专\n任职要求：本科及以上学历", title="测试", company="合成公司")
    job.extraction_checked = True
    result = evaluate(job, Profile(education_completed="大专", confirmed=True), Strategy())
    assert result["group"] == "pending"
    assert any(r["field"] == "education" and r["kind"] == "stretch" for r in result["reasons"])
    assert any("学历要求不一致" in r["message"] for r in result["reasons"])


def test_summary_does_not_erase_same_degree_experience_alternative():
    job = parse_job("本科\n任职要求：本科或3年相关经验", title="测试", company="合成公司")
    assert job.education_mode == "alternative"
    job.extraction_checked = True
    result = evaluate(
        job, Profile(education_completed="大专", experience_years=4, confirmed=True), Strategy()
    )
    assert result["group"] == "candidate"


def test_parenthesized_current_status_is_not_assumed_completed():
    job = parse_job("大专\n任职要求：本科（在读）")
    assert (job.education, job.education_mode) == ("本科", "complex")
