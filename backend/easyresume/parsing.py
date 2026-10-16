import re
import uuid
from datetime import date

from easyresume.models import now_iso
from easyresume.resume import DEGREE_LEVELS, education_issues
from easyresume.schemas import EducationRecord, Evidence, Job, Profile, SkillRecord, WorkRecord

PARSER_VERSION = "rules-2.1"
DEGREES = DEGREE_LEVELS
SKILLS = {
    "Python": ["python"],
    "Java": ["java"],
    "JavaScript": ["javascript", "js"],
    "TypeScript": ["typescript", "ts"],
    "React": ["react"],
    "Vue": ["vue"],
    "SQL": ["sql"],
    "MySQL": ["mysql"],
    "PostgreSQL": ["postgresql", "postgres"],
    "SQL Server": [r"sql\s*server"],
    "Oracle": ["oracle"],
    "Redis": ["redis"],
    "Linux": ["linux"],
    "Windows Server": [r"windows\s*server"],
    "Active Directory": [r"active\s*directory", "AD域"],
    "Docker": ["docker"],
    "Kubernetes": ["kubernetes", "k8s"],
    "Excel": ["excel"],
    "PowerShell": ["powershell"],
    "Bash": ["bash"],
    "C++": [r"c\+\+"],
    "C#": ["c#"],
    "Citrix": ["citrix"],
    "VMware": ["vmware"],
    "Hyper-V": [r"hyper-v"],
    "Nginx": ["nginx"],
    "网络运维": ["网络运维", "网络配置"],
    "交换机": ["交换机"],
    "路由器": ["路由器"],
    "防火墙": ["防火墙"],
    "TCP/IP": [r"tcp\s*/\s*ip"],
    "VPN": ["vpn"],
    "DNS": ["dns"],
    "DHCP": ["dhcp"],
    "VLAN": ["vlan"],
}


def _skill_mentions(text: str, name: str):
    for pattern in SKILLS[name]:
        for match in re.finditer(r"(?<![A-Za-z0-9_])(?:" + pattern + r")(?![A-Za-z0-9_])", text, re.I):
            # SQL Server is a concrete product, not two independent skill declarations.
            if name == "SQL" and re.match(r"\s*server", text[match.end() :], re.I):
                continue
            clause = re.split(r"[。；;\n，,]|但是|但|现已", text[: match.start()])[-1][-60:]
            after = text[match.end() : match.end() + 12]
            if re.search(
                r"不要求|无需|不需要|不涉及|不熟悉|未掌握|不会|不了解|没有.{0,6}(?:经验|使用)|尚未", clause
            ) or re.match(r"\s*(?:不会|不熟悉|未掌握)", after):
                usage = "negated"
            elif re.search(r"计划学习|准备学习|希望学习|学习中|正在学习|正在入门|自学中", clause) or re.match(
                r"\s*(?:学习中|正在学习|计划学习)", after
            ):
                usage = "learning"
            elif re.search(r"熟悉|熟练|掌握|使用|维护|部署|运维|配置|开发", clause):
                usage = "used"
            else:
                usage = "mentioned"
            yield match, usage


def skills_from(text: str) -> list[str]:
    return [
        name
        for name in SKILLS
        if any(usage in {"mentioned", "used"} for _, usage in _skill_mentions(text, name))
    ]


def snippet(text: str, pattern: str) -> str:
    m = re.search(pattern, text, re.I)
    return text[max(0, m.start() - 20) : m.end() + 65].strip()[:160] if m else ""


def degree_from(text: str) -> str:
    aliases = [
        ("博士", "博士"),
        ("硕士|研究生", "硕士"),
        ("本科|学士", "本科"),
        ("大专|专科", "大专"),
        ("中专", "中专"),
        ("高中", "高中"),
    ]
    return next((value for pattern, value in aliases if re.search(pattern, text)), "unknown")


def _benefit(text: str, word: str) -> bool | None:
    neg = rf"(?:无|不提供|不缴纳|没有|不交|不含|不购买).{{0,4}}(?:{word})"
    if re.search(neg, text):
        return False
    return True if re.search(word, text) else None


def parse_job(text: str, **meta) -> Job:
    now = now_iso()
    job = Job(text=text, observed_at=now, **meta)
    job.skills = skills_from(text)
    job.education = degree_from(text)
    if job.education != "unknown":
        job.education_mode = "required"
        if re.search(r"(?:本科|硕士|博士|大专|专科).{0,4}(?:优先|为佳)", text):
            job.education_mode = "preferred"
        if re.search(r"学历不限|不限学历", text):
            job.education_mode = "preferred" if "优先" in text else "unrestricted"
        if re.search(r"(?:本科|大专|硕士).{0,18}或.{0,18}(?:经验|经历)", text):
            job.education_mode = "alternative"
        if re.search(r"优秀者.*放宽|学历.*可放宽|同等.*学历", text):
            job.education_mode = "complex"
    elif re.search(r"学历不限|不限学历", text):
        job.education = "none"
        job.education_mode = "unrestricted"
    if "非全日制" in text:
        job.education_form = "unknown"
    elif re.search(r"全日制", re.sub(r"(?:不要求|不限|无需|不限制)\s*全日制", "", text)):
        job.education_form = "full_time"
    grad = re.search(r"(20\d{2})\s*届", text)
    if grad:
        job.graduation_year = int(grad[1])
    exp = re.search(r"(\d{1,2})(?:\s*[-~—至]\s*\d{1,2})?\s*年(?:以上)?(?:相关)?(?:工作)?经验", text)
    if exp:
        job.experience_min = float(exp[1])
    if re.search(r"经验不限|无需(?:工作)?经验|不限经验", text):
        job.experience_min = 0
    amount = r"(?P<lo>\d+(?:\.\d+)?)(?:\s*[-~—–至]\s*(?P<hi>\d+(?:\.\d+)?))?\s*(?P<unit>[kK千万]|元)"
    fixed_matches = list(re.finditer(r"(?:固定月薪|固定工资|固定薪资|底薪)\s*[:：]?\s*" + amount, text))
    fixed = [
        m
        for m in fixed_matches
        if not re.search(r"(?:不保证|没有|无|非|不设)\s*$", text[max(0, m.start() - 6) : m.start()])
    ]
    salary = fixed[0] if fixed else re.search(amount, text)
    # A negated guarantee must not be reinterpreted as a fixed salary.
    if salary and not fixed and any(m.start() <= salary.start() < m.end() for m in fixed_matches):
        salary = None
    if salary:
        lo, hi, unit = float(salary["lo"]), float(salary["hi"] or salary["lo"]), salary["unit"]
        multiplier = 10000 if unit == "万" else 1000 if unit.lower() == "k" or unit == "千" else 1
        job.salary_min, job.salary_max = lo * multiplier, hi * multiplier
        following = re.split(r"[，,。；;\n]", text[salary.end() :], maxsplit=1)[0][:8]
        job.salary_period = (
            "year"
            if re.search(r"[/／]?年", following)
            else "day"
            if re.search(r"[/／]?天|[/／]日", following)
            else "hour"
            if re.search(r"小时|[/／]时", following)
            else "month"
        )
        clause = (
            re.split(r"[，,。；;\n]", text[: salary.start()])[-1]
            + text[salary.start() : salary.end()]
            + following
        )
        job.salary_kind = (
            "fixed" if fixed else "comprehensive" if re.search(r"综合|含提成|提成", clause) else "advertised"
        )
        fixed_values = {(m["lo"], m["hi"] or m["lo"], m["unit"].lower()) for m in fixed}
        if len(fixed_values) > 1:
            job.salary_min = job.salary_max = None
            job.salary_kind = "unknown"
            job.risks.append("多个固定薪资声明需核实")
    months = re.search(r"(\d{1,2})\s*薪", text)
    if months and 1 <= int(months[1]) <= 36:
        job.salary_months = int(months[1])
    if "大小周" in text:
        job.rest = "alternating"
    elif re.search(r"不双休|非双休|无双休", text):
        job.rest = "unknown"
    elif re.search(r"双休|周末双休", text):
        job.rest = "double"
    elif "单休" in text:
        job.rest = "single"
    elif re.search(r"轮休|排班休", text):
        job.rest = "rotation"
    job.social = _benefit(text, r"五险(?:一金)?|社会保险|社保")
    job.fund = _benefit(text, r"五险一金|公积金")
    if re.search(r"劳务派遣|派遣制", text):
        job.dispatch = not bool(re.search(r"非劳务派遣|不属于.{0,3}派遣|不接受.{0,3}派遣", text))
    if re.search(r"业务外包|人力外包|外包岗位", text):
        job.outsourcing = not bool(re.search(r"非外包|不属于.{0,3}外包", text))
    if re.search(r"公司直签|直接签订劳动合同|非劳务派遣", text):
        job.dispatch = False
    for pattern, label in [
        (r"培训贷", "培训贷款"),
        (r"(?:缴纳|收取|支付).{0,5}押金", "收费或押金"),
        (r"先交费|先缴费", "收费或押金"),
    ]:
        m = re.search(pattern, text)
        if m and not re.search(r"不|无|禁止", text[max(0, m.start() - 3) : m.start()]):
            job.risks.append(label)
    if re.search(r"央企项目|国企项目|服务.{0,4}央企", text):
        job.risks.append("项目性质不等于合同主体性质")
    for field, pattern in {
        "education": r"本科|大专|硕士|博士|学历|专科",
        "experience": r"经验",
        "salary": r"薪|工资|[kK]",
        "rest": r"双休|单休|轮休|大小周",
        "social": r"五险|社保",
        "fund": r"公积金|五险一金",
        "dispatch": r"派遣|直签",
        "outsourcing": r"外包",
    }.items():
        quote = snippet(text, pattern)
        if quote:
            value = getattr(job, field if field != "experience" else "experience_min", None)
            if field == "salary":
                value = f"{job.salary_min}–{job.salary_max} / {job.salary_period} / {job.salary_kind}"
            job.evidence.append(Evidence(field=field, value=value, snippet=quote, observed_at=now))
    return job


DATE_TEXT = r"(?:19|20)\d{2}(?:[年./\-]\d{1,2}月?|年)?"
DATE_RANGE = re.compile(
    rf"(?P<start>{DATE_TEXT})\s*(?:~|～|—|–|－|-|至|到)\s*(?P<end>{DATE_TEXT}|至今|现在|在职|present|current)",
    re.I,
)
SCHOOL = re.compile(r"[\u4e00-\u9fffA-Za-z·]{2,50}(?:大学|学院|学校)")
COMPANY = re.compile(r"[\u4e00-\u9fffA-Za-z·（）()]{1,70}(?:有限公司|公司|集团|银行|工作室)")
ADJACENT_ENTITIES = (
    re.compile(r"(?P<entity>[\u4e00-\u9fffA-Za-z·]{2,100}?(?:大学|学院|学校))(?:[ \t]*(?P=entity))+"),
    re.compile(
        r"(?P<entity>[\u4e00-\u9fffA-Za-z·（）()]{2,100}?(?:有限公司|公司|集团|银行|工作室))"
        r"(?:[ \t]*(?P=entity))+"
    ),
)
HEADINGS = {
    "教育经历": "education",
    "教育背景": "education",
    "学习经历": "education",
    "工作经历": "work",
    "工作经验": "work",
    "任职经历": "work",
    "实习经历": "internship",
    "项目经历": "project",
    "项目经验": "project",
    "专业技能": "skills",
    "技能特长": "skills",
    "个人技能": "skills",
    "自我评价": "other",
    "个人简介": "other",
    "求职意向": "other",
    "education": "education",
    "work experience": "work",
    "experience": "work",
    "skills": "skills",
}


def _partial_date(text: str) -> str:
    value = text.strip().removesuffix("年")
    if re.fullmatch(r"(?:19|20)\d{2}", value):
        return value
    try:
        value = normalized_month(value)
        return value if re.fullmatch(r"(?:19|20)\d{2}-(?:0[1-9]|1[0-2])", value) else ""
    except ValueError:
        return ""


def _resume_blocks(text: str):
    """Section and date boundaries stay together; repeated text is not globally removed."""
    section, lines = "unknown", []
    for raw in text.replace(" | ", "\n").splitlines():
        line = raw.strip()
        if not line:
            continue
        heading = HEADINGS.get(re.sub(r"[\s:：]+$", "", line).lower())
        if heading:
            if lines:
                yield section, "\n".join(lines)
            section, lines = heading, []
            continue
        if DATE_RANGE.search(line) and any(DATE_RANGE.search(previous) for previous in lines):
            # A school/company name immediately before the next date belongs to the next record.
            carry = []
            if (
                lines
                and not DATE_RANGE.search(lines[-1])
                and (SCHOOL.fullmatch(lines[-1]) or COMPANY.fullmatch(lines[-1]))
            ):
                carry = [lines.pop()]
            yield section, "\n".join(lines)
            lines = carry
        lines.append(line)
    if lines:
        yield section, "\n".join(lines)


def _skill_category(name: str) -> str:
    if name in {"SQL", "MySQL", "PostgreSQL", "SQL Server", "Oracle", "Redis"}:
        return "数据库"
    if name in {"Citrix", "VMware", "Hyper-V", "Docker", "Kubernetes"}:
        return "虚拟化与容器"
    if name in {"Linux", "Windows Server", "Active Directory", "PowerShell", "Bash"}:
        return "系统与运维"
    if name in {"网络运维", "交换机", "路由器", "防火墙", "TCP/IP", "VPN", "DNS", "DHCP", "VLAN"}:
        return "网络"
    return "办公" if name == "Excel" else "开发与工具"


def parse_profile(text: str) -> Profile:
    profile = Profile(text=text, schema_version=2, experience_as_of=date.today().strftime("%Y-%m"))
    for section, block in _resume_blocks(text):
        dates = DATE_RANGE.search(block)
        start = _partial_date(dates["start"]) if dates else ""
        end = _partial_date(dates["end"]) if dates else ""
        ongoing = bool(dates and not end and re.search(r"至今|现在|在职|present|current", dates["end"], re.I))
        # Adjacent copies can also be present in a PDF's actual text. Normalize
        # complete entities only in the parsing view; evidence stays untouched.
        entity_text = block
        for pattern in ADJACENT_ENTITIES:
            entity_text = pattern.sub(r"\g<entity>", entity_text)
        school = SCHOOL.search(entity_text)
        company = COMPANY.search(entity_text)
        explicit_degree = re.search(r"(?:学历|学位)\s*[:：]?\s*(?:本科|大专|专科|硕士|博士|高中|中专)", block)
        education = section == "education" or (section == "unknown" and (school or explicit_degree))
        fact = {
            "id": uuid.uuid4().hex,
            "source": "resume",
            "snippet": block[:2000],
            "parser_version": PARSER_VERSION,
        }
        if education:
            degree = degree_from(block)
            if not school and degree == "unknown":
                continue
            future_end = bool(
                end
                and end > profile.experience_as_of[: len(end)]
                and (not start or start <= profile.experience_as_of[: len(start)])
            )
            current = ongoing or future_end or bool(re.search(r"在读|预计.{0,8}毕业", block))
            status = (
                "current"
                if current
                else "incomplete"
                if re.search(r"肄业|退学", block)
                else "completed"
                if end or re.search(r"已毕业|已取得.{0,6}(?:学历|学位)", block)
                else "unknown"
            )
            expected = re.search(rf"(?:预计毕业(?:时间)?\s*[:：]?\s*|预计\s*)({DATE_TEXT})", block)
            if not expected:
                expected = re.search(rf"({DATE_TEXT})\s*(?:预计毕业|毕业|届)", block)
            if not end and not current and expected and "预计" not in expected[0]:
                end = _partial_date(expected[1])
                status = "completed"
            major = ""
            for line in block.splitlines():
                cleaned = DATE_RANGE.sub("", line).strip(" |，,：:")
                if SCHOOL.search(cleaned) or re.fullmatch(
                    r"(?:本科|大专|专科|硕士|博士|全日制|非全日制|在读)", cleaned
                ):
                    continue
                if (
                    re.search(r"专业|计算机|软件|网络|工程|管理|经济|文学|设计|会计|医学|法律", cleaned)
                    and len(cleaned) < 160
                ):
                    major = re.sub(
                        r"(?:专业[:：]?|[（(](?:本科|大专|专科|硕士|博士)[）)])", "", cleaned
                    ).strip()
                    major = re.sub(r"非全日制|全日制|本科|大专|专科|硕士|博士|在读", "", major).strip(
                        " /，,：:（）()"
                    )
                    break
            record = EducationRecord(
                **fact,
                school=school[0] if school else "",
                major=major,
                degree=degree,
                education_form="part_time"
                if re.search(r"非全日制|函授|自考|成人教育|业余", block)
                else "full_time"
                if "全日制" in block
                else "unknown",
                start_date=start,
                end_date="" if current else end,
                status=status,
                expected_graduation_date=_partial_date(expected[1]) if expected else end if current else "",
            )
            profile.education_records.append(record)
            profile.review_notes.extend(education_issues(record, profile.experience_as_of))
            if end and not current:
                profile.review_notes.append(f"请核对 {record.school or '教育经历'} 的结束时间及毕业状态")
        elif section in {"work", "internship"} or (section == "unknown" and company and dates):
            title_text = COMPANY.sub(" ", DATE_RANGE.sub(" ", entity_text))
            title_match = re.search(
                r"[\u4e00-\u9fffA-Za-z /]{0,30}(?:工程师|技术员|专员|经理|顾问|助理|开发|运维|实习生)",
                title_text,
            )
            employment = (
                "internship"
                if section == "internship" or "实习" in block
                else "part_time"
                if "兼职" in block
                else "full_time"
                if re.search(r"全职|正式员工|正式工作", block)
                else "unknown"
            )
            title = title_match[0].strip() if title_match else ""
            profile.work_records.append(
                WorkRecord(
                    **fact,
                    company=company[0] if company else "",
                    title=title,
                    start_date=start,
                    end_date=end,
                    current=ongoing,
                    employment_type=employment,
                    responsibilities=block[:5000],
                )
            )
            if employment == "unknown":
                profile.review_notes.append("请确认工作类型，未确认的经历不会计入工作年限")
        if len(profile.education_records) >= 30 or len(profile.work_records) >= 100:
            profile.review_notes.append("经历数量达到上限，请检查并手动整理剩余内容")
            break
    for name in SKILLS:
        mentions = list(_skill_mentions(text, name))
        if not mentions:
            continue
        priority = {"used": 0, "mentioned": 1, "learning": 2, "negated": 3}
        match, usage = min(mentions, key=lambda item: priority[item[1]])
        profile.skill_records.append(
            SkillRecord(
                id=uuid.uuid4().hex,
                name=name,
                category=_skill_category(name),
                usage=usage,
                source="resume",
                snippet=text[max(0, match.start() - 35) : match.end() + 65][:2000],
                parser_version=PARSER_VERSION,
                work_record_ids=[r.id for r in profile.work_records if name in skills_from(r.snippet)],
            )
        )
    # These are suggestions for display only; qualification and save normalize confirmed records.
    profile.skills = skills_from(text)[:40]
    completed = [r for r in profile.education_records if r.status == "completed"]
    current = [r for r in profile.education_records if r.status == "current"]
    highest = max(completed, key=lambda r: DEGREES[r.degree], default=None)
    ongoing = max(current, key=lambda r: DEGREES[r.degree], default=None)
    profile.education_completed = highest.degree if highest else "unknown"
    profile.education_current = ongoing.degree if ongoing else "unknown"
    selected = ongoing or highest
    grad = (
        (selected.expected_graduation_date if selected.status == "current" else selected.end_date)
        if selected
        else ""
    )
    profile.graduation_year = int(grad[:4]) if grad else None
    profile.education_form = highest.education_form if highest else "unknown"
    profile.review_notes = list(dict.fromkeys(profile.review_notes))
    return profile


def normalized_month(value: str) -> str:
    match = re.fullmatch(r"\s*(\d{4})[.年/\-](\d{1,2})月?\s*", value)
    if not match:
        return value.strip()
    date(int(match[1]), int(match[2]), 1)
    return f"{int(match[1]):04d}-{int(match[2]):02d}"
