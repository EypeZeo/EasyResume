from datetime import UTC, datetime, timedelta

from easyresume.parsing import DEGREES
from easyresume.resume import normalize_profile, qualification_state, summarize_experience
from easyresume.schemas import Job, Profile, Strategy

ALGORITHM_VERSION = "deterministic-2.0"
PRIORITY = {"excluded": 0, "pending": 1, "stretch": 2, "candidate": 3}
LABELS = {"excluded": "排除", "pending": "待核实", "stretch": "冲刺", "candidate": "候选"}
FIELD_LABELS = {
    "rest": "双休",
    "social": "五险",
    "fund": "公积金",
    "dispatch": "派遣关系",
    "outsourcing": "外包关系",
    "salary": "固定月薪",
    "ownership": "企业性质",
}
QUESTION = {
    "rest": "请问是固定周末双休、大小周，还是轮休？",
    "social": "请问五险从什么时候开始缴纳，按什么基数缴纳？",
    "fund": "请问是否缴纳住房公积金，缴纳时间和比例是多少？",
    "dispatch": "请问劳动合同与哪家公司签订，是否属于劳务派遣？",
    "outsourcing": "请问这个岗位是否属于外包项目，合同主体是哪家公司？",
    "salary": "请问固定底薪范围是多少，是否包含提成、绩效或加班费？",
    "education": "请问学历或相关经验要求是否可以适当放宽？",
    "experience": "请问相关经验要求是否接受项目经历或相近岗位经验？",
    "city": "请问实际工作地点在哪个城市和区县？",
}


def _aware(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed


def evidence_state(job: Job, field: str, strategy: Strategy) -> tuple[bool, bool]:
    evidence = [e for e in job.evidence if e.field == field and e.active]
    # HR/external/self aren't a universal truth ordering; an explicitly requested category is required.
    required = strategy.evidence_minimum.get(field, "page")
    acceptable = required == "page" or any(e.source == required for e in evidence)
    distinct = {str(e.value).lower() for e in evidence if e.value is not None}
    current = getattr(job, field, None)
    if current is not None and current != "unknown":
        distinct.add(str(current).lower())
    return acceptable, len(distinct) > 1


def evaluate(
    job: Job, profile: Profile | None, strategy: Strategy, blacklist: list[dict] | None = None
) -> dict:
    reasons: list[dict] = []

    def reason(kind: str, field: str, message: str):
        reasons.append({"kind": kind, "field": field, "message": message})

    for item in blacklist or []:
        target = item.get("target")
        value = item.get("value", "").strip().casefold()
        if target == "company" and value and job.company.strip().casefold() == value:
            reason("excluded", "blacklist", f"公司黑名单：{item.get('reason', '用户排除')}")
        if target == "job" and value and value == item.get("job_id", "").casefold():
            reason("excluded", "blacklist", "职位黑名单")
    if not job.extraction_checked:
        reason("pending", "extraction", "请先核对职位关键字段的提取结果")
    if not profile or not profile.confirmed:
        reason("pending", "profile", "请确认简历并绑定当前策略")
    if not job.title or not job.company:
        reason("pending", "metadata", "职位名称或公司主体尚未填写")
    if strategy.cities:
        if not job.city:
            reason("pending", "city", "实际工作城市待核实")
        elif not any(c.removesuffix("市") == job.city.removesuffix("市") for c in strategy.cities):
            reason("excluded", "city", f"工作城市 {job.city} 不在可接受范围")

    if profile and profile.confirmed and profile.schema_version == 2:
        profile = normalize_profile(profile)
        experience = None
        if strategy.relevant_work_ids is not None:
            months = summarize_experience(profile, strategy.relevant_work_ids)["months"]
            experience = months / 12 if months is not None else None
        exp_ok = (
            experience is not None and job.experience_min is not None and experience >= job.experience_min
        )
        education_needed = (
            job.education_mode in {"required", "alternative"}
            or job.graduation_year
            or job.education_form != "unknown"
        )
        education_kind, education_message = (
            qualification_state(profile, job) if education_needed else ("candidate", "")
        )
        if job.education_mode == "complex":
            reason("pending", "education", "包含放宽或复杂学历条件，请核实具体适用范围")
        elif job.education_mode == "unknown":
            reason("pending", "education", "岗位学历要求未明确")
        elif job.education_mode == "alternative":
            if education_kind != "candidate" and not exp_ok:
                if education_kind == "pending" or experience is None or job.experience_min is None:
                    reason("pending", "education", "学历或所选相关经验尚不足以判断替代条件")
                else:
                    reason(
                        "excluded" if strategy.strict_education else "stretch",
                        "education",
                        "学历与所选相关经验均未达到声明要求",
                    )
        elif education_kind != "candidate":
            reason(
                "excluded" if education_kind == "stretch" and strategy.strict_education else education_kind,
                "education",
                education_message,
            )
        if job.education_mode != "alternative" and job.experience_min:
            if experience is None:
                reason("pending", "experience", "请在当前策略选择相关经历，并核对工作类型及起止月份")
            elif experience < job.experience_min:
                reason("stretch", "experience", "所选相关经验低于岗位声明要求")
    elif profile and profile.confirmed:
        available = DEGREES[profile.education_completed]
        if job.graduation_year and profile.graduation_year == job.graduation_year:
            available = max(available, DEGREES[profile.education_current])
        if job.graduation_year:
            if profile.graduation_year is None:
                reason("pending", "education", "需要确认毕业年份是否匹配应届要求")
            elif profile.graduation_year != job.graduation_year:
                reason("stretch", "education", f"岗位要求 {job.graduation_year} 届，简历年份不同")
        required = DEGREES[job.education]
        exp_ok = (
            profile.experience_years is not None
            and job.experience_min is not None
            and profile.experience_years >= job.experience_min
        )
        degree_ok = available >= required and required >= 0
        if job.education_mode == "complex":
            reason("pending", "education", "包含放宽或复杂学历条件，请核实具体适用范围")
        elif job.education_mode == "alternative":
            if not degree_ok and not exp_ok:
                if available < 0 or profile.experience_years is None or job.experience_min is None:
                    reason("pending", "education", "学历或经验替代条件尚不足以判断")
                else:
                    reason(
                        "excluded" if strategy.strict_education else "stretch",
                        "education",
                        "学历与可替代经验均未达到声明要求",
                    )
        elif job.education_mode == "required":
            if available < 0:
                reason("pending", "education", "简历学历尚未确认")
            elif required > available:
                reason(
                    "excluded" if strategy.strict_education else "stretch",
                    "education",
                    f"岗位声明要求 {job.education}，已确认学历未达到",
                )
        elif job.education_mode == "unknown":
            reason("pending", "education", "岗位学历要求未明确")
        if job.education_form == "full_time":
            if profile.education_form == "unknown":
                reason("pending", "education", "全日制要求需要确认教育形式")
            elif profile.education_form != "full_time":
                reason(
                    "excluded" if strategy.strict_education else "stretch",
                    "education",
                    "教育形式与全日制要求不同",
                )
        if job.education_mode != "alternative" and job.experience_min:
            if profile.experience_years is None:
                reason("pending", "experience", "相关工作年限待确认")
            elif profile.experience_years < job.experience_min:
                reason("stretch", "experience", "相关经验低于岗位声明要求")

    for field, enabled, desired in [
        ("rest", strategy.require_double, "double"),
        ("social", strategy.require_social, True),
        ("fund", strategy.require_fund, True),
        ("dispatch", strategy.reject_dispatch, False),
        ("outsourcing", strategy.reject_outsourcing, False),
    ]:
        if not enabled:
            continue
        value = getattr(job, field)
        acceptable, conflict = evidence_state(job, field, strategy)
        label = FIELD_LABELS[field]
        if conflict:
            reason("pending", field, f"{label}存在不同来源的冲突表述")
        elif not acceptable:
            reason("pending", field, f"{label}尚未达到策略要求的依据类型")
        elif value is None or value == "unknown":
            reason("pending", field, f"{label}未明确")
        elif value != desired:
            reason("excluded", field, f"{label}明确不符合要求")
    salary_known = (
        job.salary_kind == "fixed"
        and job.salary_period == "month"
        and job.salary_min is not None
        and job.salary_max is not None
    )
    if strategy.salary_floor is not None and strategy.salary_hard:
        acceptable, conflict = evidence_state(job, "salary", strategy)
        if not salary_known or not acceptable or conflict:
            reason("pending", "salary", "固定月薪口径或依据待核实；展示薪资不等于保证底薪")
        elif job.salary_max < strategy.salary_floor:
            reason("excluded", "salary", "固定月薪上限低于底线")
        elif job.salary_min < strategy.salary_floor:
            reason("pending", "salary", "薪资区间跨过底线，个人报价待核实")
    for risk in job.risks:
        if risk not in job.dismissed_risks:
            reason("pending", "risk", f"需要复核：{risk}")
    group = min((r["kind"] for r in reasons), key=lambda x: PRIORITY[x], default="candidate")

    dimensions = []

    def dimension(key: str, label: str, low: float, high: float, detail: str):
        weight = strategy.weights.get(key, 0)
        if weight > 0:
            dimensions.append(
                {"key": key, "label": label, "low": low, "high": high, "weight": weight, "detail": detail}
            )

    direction = None
    if strategy.directions:
        direction = 100.0 if any(d.casefold() in job.title.casefold() for d in strategy.directions) else 0.0
    skill_score = None
    if strategy.skills:
        normalized = {s.casefold() for s in job.skills}
        skill_score = 100 * sum(s.casefold() in normalized for s in strategy.skills) / len(strategy.skills)
    match_parts = [x for x in [direction, skill_score] if x is not None]
    match = sum(match_parts) / len(match_parts) if match_parts else None
    dimension(
        "match",
        "方向与技能",
        match or 0,
        match if match is not None else 100,
        "方向与技能按启用部分平均；技能为声明匹配，不推断能力",
    )

    def salary_score(value: float) -> float:
        floor = strategy.salary_floor
        ideal = strategy.salary_ideal if strategy.salary_ideal is not None else floor
        if floor is None or ideal is None:
            return 0
        if value >= ideal:
            return 100
        return 60 if value >= floor else 0

    if strategy.salary_floor is not None:
        dimension(
            "salary",
            "固定月薪",
            salary_score(job.salary_min) if salary_known else 0,
            salary_score(job.salary_max) if salary_known else 100,
            "仅固定月薪参与；综合收入和额外薪资月数不冒充底薪",
        )
    benefit_parts = []
    for field, enabled, desired in [
        ("rest", strategy.require_double, "double"),
        ("social", strategy.require_social, True),
        ("fund", strategy.require_fund, True),
    ]:
        if enabled:
            value = getattr(job, field)
            acceptable, conflict = evidence_state(job, field, strategy)
            benefit_parts.append(
                (0, 100)
                if value is None or value == "unknown" or conflict or not acceptable
                else ((100, 100) if value == desired else (0, 0))
            )
    if benefit_parts:
        dimension(
            "benefits",
            "制度与福利",
            sum(x[0] for x in benefit_parts) / len(benefit_parts),
            sum(x[1] for x in benefit_parts) / len(benefit_parts),
            "按已启用福利子条件计算；页面声明与真实待遇分开",
        )
    if strategy.preferred_ownership or strategy.acceptable_ownership:
        if not job.ownership:
            dimension("ownership", "企业偏好", 0, 100, "企业性质未知")
        else:
            score = (
                100
                if job.ownership in strategy.preferred_ownership
                else 50
                if job.ownership in strategy.acceptable_ownership
                else 0
            )
            dimension("ownership", "企业偏好", score, score, "基于记录的企业性质，不以项目客户替代合同主体")
    stale = True
    try:
        age = datetime.now(UTC) - _aware(job.observed_at)
        stale = age < timedelta(0) or age > timedelta(hours=24)
    except ValueError:
        pass
    activity = {"today": 100, "3days": 75, "week": 40, "other": 10}.get(job.activity)
    dimension(
        "activity",
        "HR 活跃度",
        activity if activity is not None and not stale else 0,
        activity if activity is not None and not stale else 100,
        "超过24小时仅保留历史观察，不作为当前活跃标签",
    )
    total = sum(d["weight"] for d in dimensions)
    low = round(sum(d["low"] * d["weight"] for d in dimensions) / total, 2) if total else None
    high = round(sum(d["high"] * d["weight"] for d in dimensions) / total, 2) if total else None
    questions = []
    for item in reasons:
        question = QUESTION.get(item["field"])
        if item["kind"] in {"pending", "stretch"} and question and question not in questions:
            questions.append(question)
    matches = []
    if direction == 100:
        matches.append("岗位方向符合当前策略")
    if strategy.skills:
        common = [s for s in strategy.skills if s.casefold() in {j.casefold() for j in job.skills}]
        if common:
            matches.append("相关技能：" + "、".join(common[:4]))
    if group == "candidate":
        matches.append("已配置的资格和硬条件均通过初筛")
    return {
        "group": group,
        "label": LABELS[group],
        "reasons": reasons,
        "matches": matches[:3],
        "questions": questions[:2],
        "low": low,
        "high": high,
        "dimensions": dimensions,
        "algorithm_version": ALGORITHM_VERSION,
        "evaluated_at": datetime.now(UTC).isoformat(),
        "score_note": "按当前条件计算的匹配范围，不是录用概率",
    }
