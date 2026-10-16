"""Versioned resume summaries derived only from checked, internally consistent records."""

import re
from datetime import date

from easyresume.schemas import Profile

DEGREE_LEVELS = {"unknown": -1, "none": 0, "高中": 1, "中专": 1, "大专": 2, "本科": 3, "硕士": 4, "博士": 5}


def month_index(value: str) -> int | None:
    if not re.fullmatch(r"(?:19|20)\d{2}-(?:0[1-9]|1[0-2])", value):
        return None
    year, month = map(int, value.split("-"))
    return year * 12 + month - 1


def union_months(intervals: list[tuple[int, int]]) -> int:
    """Half-open calendar-month ranges: January to February is one complete month."""
    total, until = 0, -1
    for start, end in sorted(intervals):
        total += max(0, end - max(start, until))
        until = max(until, end)
    return total


def summarize_experience(profile: Profile, record_ids: list[str] | None = None) -> dict:
    selected = set(record_ids) if record_ids is not None else None
    intervals, included, excluded = [], [], []
    uncertain = False
    as_of = month_index(profile.experience_as_of)
    for record in profile.work_records:
        if selected is not None and record.id not in selected:
            continue
        if selected is None and record.employment_type in {"internship", "part_time"}:
            excluded.append({"id": record.id, "reason": "实习或兼职单列，不计入正式工作年限"})
            continue
        start = month_index(record.start_date)
        end = as_of if record.current else month_index(record.end_date)
        problem = ""
        if not record.confirmed:
            problem = "经历尚未检查"
        elif record.employment_type == "unknown":
            problem = "工作类型尚未确认"
        elif start is None or end is None or as_of is None:
            problem = "日期需精确到月份，并确认计算截止月份"
        elif end < start or start > as_of or end > as_of:
            problem = "起止日期冲突或包含未来工作时间"
        elif record.current and record.end_date:
            problem = "在职状态与结束日期同时存在，请确认"
        if problem:
            uncertain = True
            excluded.append({"id": record.id, "reason": problem})
        else:
            intervals.append((start, end))
            included.append(record.id)
    if selected is not None:
        missing = selected - {record.id for record in profile.work_records}
        for record_id in sorted(missing):
            excluded.append({"id": record_id, "reason": "所选经历不属于当前简历版本"})
        uncertain |= bool(missing)
    known_months = union_months(intervals)
    if not profile.work_records and selected is None:
        uncertain = True
    return {
        "months": None if uncertain else known_months,
        "known_months": known_months,
        "included_ids": included,
        "excluded": excluded,
        "as_of": profile.experience_as_of,
    }


def education_issues(record, as_of: str) -> list[str]:
    issues = []
    # Year-only bounds are compared at their available precision, without fabricating a month.
    if record.start_date and record.end_date:
        precision = min(len(record.start_date), len(record.end_date))
        if record.end_date[:precision] < record.start_date[:precision]:
            issues.append("教育结束时间早于入学时间")
    if record.status == "completed" and record.end_date and as_of:
        precision = min(len(record.end_date), len(as_of))
        if record.end_date[:precision] > as_of[:precision]:
            issues.append("已毕业状态与未来结束时间冲突")
    if record.status == "current" and record.end_date:
        issues.append("在读状态与结束时间同时存在，请将预计毕业时间单独填写")
    if record.start_date and as_of:
        precision = min(len(record.start_date), len(as_of))
        if record.start_date[:precision] > as_of[:precision]:
            issues.append("入学时间尚未到达，请确认就读状态")
    if record.expected_graduation_date and record.start_date:
        precision = min(len(record.expected_graduation_date), len(record.start_date))
        if record.expected_graduation_date[:precision] < record.start_date[:precision]:
            issues.append("预计毕业时间早于入学时间")
    return issues


def normalize_profile(profile: Profile) -> Profile:
    """Legacy summaries remain untouched; v2 summaries never trust client-supplied aggregates."""
    if profile.schema_version == 1:
        return profile
    value = profile.model_copy(deep=True)
    if not value.experience_as_of:
        value.experience_as_of = date.today().strftime("%Y-%m")
    education = [
        record
        for record in value.education_records
        if record.confirmed and not education_issues(record, value.experience_as_of)
    ]
    completed = [r for r in education if r.status == "completed"]
    current = [r for r in education if r.status == "current"]
    highest = max(completed, key=lambda r: DEGREE_LEVELS[r.degree], default=None)
    ongoing = max(current, key=lambda r: DEGREE_LEVELS[r.degree], default=None)
    value.education_completed = highest.degree if highest else "unknown"
    value.education_current = ongoing.degree if ongoing else "unknown"
    value.education_form = highest.education_form if highest else "unknown"
    relevant_education = ongoing or highest
    grad = (
        relevant_education.expected_graduation_date
        if relevant_education and relevant_education.status == "current"
        else relevant_education.end_date
        if relevant_education
        else ""
    )
    value.graduation_year = int(grad[:4]) if grad else None
    experience = summarize_experience(value)
    value.experience_years = round(experience["months"] / 12, 4) if experience["months"] is not None else None
    confirmed_skills = list(
        dict.fromkeys(r.name for r in value.skill_records if r.confirmed and r.usage in {"mentioned", "used"})
    )
    value.skills = confirmed_skills[:40]
    if len(confirmed_skills) > 40:
        note = "已确认技能超过40项；匹配摘要使用前40项，其余保留在技能记录中"
        value.review_notes = list(dict.fromkeys([note, *value.review_notes]))[:100]
    return value


def qualification_state(profile: Profile, job) -> tuple[str, str]:
    """Degree, education form and cohort must be satisfied by the same education record."""
    records = profile.education_records
    if not records:
        return "pending", "教育经历尚未填写或检查"
    unknown = False
    required = DEGREE_LEVELS[job.education] if job.education_mode in {"required", "alternative"} else 0
    for record in records:
        if not record.confirmed or education_issues(record, profile.experience_as_of):
            unknown = True
            continue
        if record.status == "unknown":
            unknown = True
            continue
        if record.status == "incomplete":
            continue
        if record.degree == "unknown" and required > 0:
            unknown = True
            continue
        if DEGREE_LEVELS[record.degree] < required:
            continue
        grad = record.expected_graduation_date if record.status == "current" else record.end_date
        if record.status == "current" and not job.graduation_year:
            continue
        if job.graduation_year:
            if not grad:
                unknown = True
                continue
            if int(grad[:4]) != job.graduation_year:
                continue
        if job.education_form != "unknown":
            if record.education_form == "unknown":
                unknown = True
                continue
            if record.education_form != job.education_form:
                continue
        return "candidate", "同一教育经历满足学历、教育形式及毕业年份要求"
    if unknown:
        return "pending", "教育经历的学历、日期或教育形式尚不足以判断"
    return "stretch", "没有同一段教育经历同时满足岗位声明的学历、教育形式及毕业年份要求"
