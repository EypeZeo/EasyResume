from easyresume.parsing import parse_profile


def test_resume_major_title_and_explicit_graduation():
    profile = parse_profile(
        "教育经历\n示例学院\n计算机科学 本科 全日制\n2024年毕业\n工作经历\n2024.07-2025.07 示例科技有限公司 运维工程师 正式工作"
    )
    assert profile.education_records[0].major == "计算机科学"
    assert profile.education_records[0].end_date == "2024"
    assert profile.graduation_year == 2024
    assert profile.work_records[0].title == "运维工程师"


def test_future_education_end_is_suggestion_of_current_study():
    from datetime import date

    year = date.today().year
    profile = parse_profile(f"教育经历\n{year - 1}.09-{year + 2}.06 示例学院 本科")
    record = profile.education_records[0]
    assert record.status == "current"
    assert record.expected_graduation_date == f"{year + 2}-06"
    assert record.end_date == "" and not record.confirmed
