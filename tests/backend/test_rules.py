from datetime import UTC, datetime, timedelta

import pytest
from easyresume.engine import evaluate
from easyresume.parsing import normalized_month, parse_job, parse_profile
from easyresume.schemas import Evidence, Profile, Strategy


def job(text="本科及以上，1年工作经验，固定月薪 10-15K，双休，五险一金", **changes):
    value = parse_job(text, title="Python开发", company="合成企业", city="上海")
    value.extraction_checked = True
    return value.model_copy(update=changes)


def profile(**changes):
    return Profile(education_completed="本科", experience_years=3, confirmed=True).model_copy(update=changes)


@pytest.mark.parametrize(
    "text,social,fund",
    [
        ("五险一金", True, True),
        ("提供社保", True, None),
        ("不提供五险一金", False, False),
        ("没有公积金，提供五险", True, False),
        ("福利面议", None, None),
    ],
)
def test_benefit_negation(text, social, fund):
    value = parse_job(text)
    assert value.social is social
    assert value.fund is fund


@pytest.mark.parametrize(
    "text,mode",
    [
        ("本科及以上", "required"),
        ("学历不限，本科优先", "preferred"),
        ("本科或3年相关经验", "alternative"),
        ("本科，优秀者可放宽", "complex"),
        ("学历不限", "unrestricted"),
    ],
)
def test_degree_semantics(text, mode):
    assert parse_job(text).education_mode == mode


def test_alternative_is_or_not_and():
    result = evaluate(
        job("本科或3年相关经验，双休"), profile(education_completed="大专", experience_years=4), Strategy()
    )
    assert result["group"] == "candidate"


def test_student_uses_current_degree_for_matching_graduation():
    result = evaluate(
        job("2027届本科应届，双休"),
        profile(education_completed="高中", education_current="本科", graduation_year=2027),
        Strategy(),
    )
    assert result["group"] == "candidate"


def test_non_fulltime_not_invented():
    assert evaluate(job(), profile(education_form="part_time"), Strategy())["group"] == "candidate"


def test_stretch_cannot_hide_pending_or_excluded():
    value = job("硕士及以上，Python")
    strategy = Strategy(require_double=True)
    assert evaluate(value, profile(), strategy)["group"] == "pending"
    value.rest = "single"
    assert evaluate(value, profile(), strategy)["group"] == "excluded"


def test_blacklist_overrides_everything():
    result = evaluate(
        job(), profile(), Strategy(), [{"target": "company", "value": "合成企业", "reason": "不接受"}]
    )
    assert result["group"] == "excluded"


def test_exact_company_does_not_extend_to_subsidiary():
    assert (
        evaluate(
            job(company="合成企业子公司"), profile(), Strategy(), [{"target": "company", "value": "合成企业"}]
        )["group"]
        == "candidate"
    )


def test_salary_crossing_floor_is_pending():
    value = job("本科，固定月薪 8-12K·13薪")
    result = evaluate(value, profile(), Strategy(salary_floor=10000, salary_ideal=12000))
    assert result["group"] == "pending"
    component = next(x for x in result["dimensions"] if x["key"] == "salary")
    assert (component["low"], component["high"]) == (0, 100)
    assert value.salary_months == 13


@pytest.mark.parametrize("text", ["本科，综合月薪8-12K", "本科，薪资8-12K", "本科，固定月薪8-12万元/年"])
def test_non_fixed_monthly_is_not_guaranteed(text):
    assert evaluate(job(text), profile(), Strategy(salary_floor=5000))["group"] == "pending"


def test_equal_ideal_and_floor_scores_100():
    result = evaluate(
        job(), profile(), Strategy(salary_floor=10000, salary_ideal=10000, weights={"salary": 1})
    )
    assert result["low"] == result["high"] == 100


def test_unknown_soft_information_stays_interval():
    result = evaluate(job("本科"), profile(), Strategy(require_double=True, weights={"benefits": 20}))
    assert (result["low"], result["high"]) == (0, 100)
    assert result["group"] == "pending"


def test_zero_weights_is_unscored():
    result = evaluate(job(), profile(), Strategy(weights={}))
    assert result["low"] is None and result["high"] is None


def test_stale_activity_is_unknown():
    value = job(activity="today", observed_at=(datetime.now(UTC) - timedelta(hours=25)).isoformat())
    result = evaluate(value, profile(), Strategy(weights={"activity": 1}))
    assert result["low"] == 0 and result["high"] == 100


def test_checked_page_is_not_hr_evidence():
    value = job()
    value.extraction_checked = True
    result = evaluate(value, profile(), Strategy(require_double=True, evidence_minimum={"rest": "hr"}))
    assert result["group"] == "pending"


def test_conflicting_evidence_is_not_overwritten():
    value = job()
    value.evidence.append(
        Evidence(
            field="rest",
            value="single",
            snippet="实际是单休",
            source="hr",
            observed_at=datetime.now(UTC).isoformat(),
        )
    )
    value.rest = "single"
    result = evaluate(value, profile(), Strategy(require_double=True))
    assert result["group"] == "pending"
    assert any("冲突" in r["message"] for r in result["reasons"])


def test_dispatch_negation_and_project_not_ownership():
    value = parse_job("非劳务派遣，为央企项目提供服务")
    assert value.dispatch is False
    assert value.ownership == ""
    assert value.risks


def test_date_normalization():
    assert normalized_month("2019.09") == normalized_month("2019年9月") == "2019-09"


def test_profile_does_not_add_overlapping_dates():
    value = parse_profile("本科\n甲公司 2020.01-2023.01\n乙公司 2021.01-2024.01\nPython")
    assert value.experience_years is None
    assert value.skills == ["Python"]


def test_salary_basis_is_bound_to_its_amount():
    j = parse_job("本科，综合薪资8-12K，底薪3000元。双休。")
    assert (j.salary_min, j.salary_max, j.salary_kind) == (3000, 3000, "fixed")
    j = parse_job("本科，薪资8-12K，不保证底薪5000元。")
    assert j.salary_kind == "advertised"
    j = parse_job("底薪3000元，固定月薪6000元。")
    assert j.salary_min is None and j.salary_kind == "unknown" and j.risks


def test_negated_full_time_does_not_add_qualification():
    j = parse_job("本科，不要求全日制，Python，无需工作经验")
    assert j.education_form == "unknown" and j.experience_min == 0
