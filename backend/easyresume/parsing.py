import re
from datetime import date

from easyresume.models import now_iso
from easyresume.schemas import Evidence, Job, Profile

PARSER_VERSION = "rules-1.0"
DEGREES = {"unknown": -1, "none": 0, "高中": 1, "中专": 1, "大专": 2, "本科": 3, "硕士": 4, "博士": 5}
SKILLS = {
    "Python": [r"\bpython\b"],
    "Java": [r"\bjava\b"],
    "JavaScript": [r"\bjavascript\b", r"\bjs\b"],
    "TypeScript": [r"\btypescript\b", r"\bts\b"],
    "React": [r"\breact\b"],
    "Vue": [r"\bvue\b"],
    "SQL": [r"\bsql\b", r"\bmysql\b", r"\bpostgresql\b"],
    "Linux": [r"\blinux\b"],
    "Docker": [r"\bdocker\b"],
    "Kubernetes": [r"\bkubernetes\b", r"\bk8s\b"],
    "Excel": [r"\bexcel\b"],
    "C++": [r"c\+\+"],
    "C#": [r"c#"],
    "Citrix": [r"\bcitrix\b"],
    "网络": [r"网络运维", r"网络配置", r"交换机"],
}


def skills_from(text: str) -> list[str]:
    found = []
    for name, patterns in SKILLS.items():
        for pattern in patterns:
            matches = list(re.finditer(pattern, text, re.I))
            if any(
                not re.search(
                    r"(?:不要求|无需|不需要|不涉及).{0,6}$", text[max(0, m.start() - 12) : m.start()]
                )
                for m in matches
            ):
                found.append(name)
                break
    return found


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


def parse_profile(text: str) -> Profile:
    profile = Profile(text=text, skills=skills_from(text))
    lines = text.splitlines()
    completed, current = [], []
    for line in lines:
        degree = degree_from(line)
        if degree == "unknown":
            continue
        if re.search(r"在读|预计|至今|至今.*毕业", line):
            current.append(degree)
        else:
            completed.append(degree)
    if completed:
        profile.education_completed = max(completed, key=lambda x: DEGREES[x])
    if current:
        profile.education_current = max(current, key=lambda x: DEGREES[x])
    grad = re.search(r"(?:预计.{0,5}|毕业.{0,3})(20\d{2})|((?:20)\d{2}).{0,5}(?:毕业|届)", text)
    if grad:
        profile.graduation_year = int(grad[1] or grad[2])
    if "非全日制" in text:
        profile.education_form = "part_time"
    elif "全日制" in text:
        profile.education_form = "full_time"
    exp = re.search(r"(\d+(?:\.\d+)?)\s*年(?:相关)?(?:工作|从业)经验", text)
    if exp:
        profile.experience_years = float(exp[1])
    # Date ranges are deliberately not summed: context/overlap/internships need confirmation.
    return profile


def normalized_month(value: str) -> str:
    match = re.fullmatch(r"\s*(\d{4})[.年/\-](\d{1,2})月?\s*", value)
    if not match:
        return value.strip()
    date(int(match[1]), int(match[2]), 1)
    return f"{int(match[1]):04d}-{int(match[2]):02d}"
