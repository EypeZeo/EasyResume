import re
from urllib.parse import urlsplit, urlunsplit


def redact(text: str) -> str:
    text = re.sub(r"(?<!\d)1[3-9]\d{9}(?!\d)", "[手机号已省略]", text)
    text = re.sub(r"(?<!\d)\d{17}[\dXx](?!\d)", "[身份证号已省略]", text)
    text = re.sub(r"[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}", "[邮箱已省略]", text)
    return re.sub(
        r"(?im)(?:HR姓名|招聘者|联系人|微信|联系电话|手机号|联系邮箱)\s*[:：].*", "[联系方式已省略]", text
    )


def safe_url(value: str) -> str:
    try:
        parsed = urlsplit(value)
        if parsed.scheme != "https" or parsed.username or parsed.password:
            return ""
        return urlunsplit((parsed.scheme, parsed.netloc, parsed.path, "", ""))
    except ValueError:
        return ""


def csv_cell(value) -> str:
    text = redact(str(value if value is not None else ""))
    return "'" + text if text.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")) else text


def public_job(data: dict) -> dict:
    # Allowlist, rather than exporting arbitrary raw text/evidence and hoping regex finds every name.
    keys = {
        "title",
        "company",
        "city",
        "district",
        "platform",
        "platform_job_id",
        "education",
        "education_mode",
        "education_form",
        "graduation_year",
        "experience_min",
        "salary_min",
        "salary_max",
        "salary_kind",
        "salary_period",
        "salary_months",
        "rest",
        "social",
        "fund",
        "dispatch",
        "outsourcing",
        "ownership",
        "contract_company",
        "service_company",
        "skills",
        "saved",
        "progress",
        "observed_at",
    }
    cleaned = {k: redact(v) if isinstance(v, str) else v for k, v in data.items() if k in keys}
    cleaned["source_url"] = safe_url(data.get("source_url", ""))
    cleaned["text"] = ""
    cleaned["evidence"] = []
    cleaned["extraction_checked"] = False
    cleaned["activity"] = "unknown"
    cleaned["privacy_omissions"] = [
        "原文与证据片段",
        "HR信息与活跃状态",
        "聊天内容",
        "简历原件与画像",
        "密钥与授权",
    ]
    return cleaned


def public_profile(data: dict) -> dict:
    """Explicit backup schema; never copy future nested evidence or personal contact fields."""
    keys = {
        "schema_version",
        "education_completed",
        "education_current",
        "graduation_year",
        "education_form",
        "experience_years",
        "skills",
        "parent_id",
        "experience_as_of",
    }
    cleaned = {k: v for k, v in data.items() if k in keys}
    cleaned.update(name="恢复的简历", text="", confirmed=False)
    nested = {
        "education_records": {
            "id",
            "school",
            "major",
            "degree",
            "education_form",
            "start_date",
            "end_date",
            "status",
            "expected_graduation_date",
        },
        "work_records": {"id", "company", "title", "employment_type", "start_date", "end_date", "current"},
        "skill_records": {"id", "name", "category", "work_record_ids", "usage"},
    }
    for kind, fields in nested.items():
        if kind in data:
            cleaned[kind] = [
                {
                    **{k: redact(v) if isinstance(v, str) else v for k, v in item.items() if k in fields},
                    "source": "manual",
                    "snippet": "",
                    "confirmed": False,
                }
                for item in data[kind]
            ]
    return cleaned
