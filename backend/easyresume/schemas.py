from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Degree = Literal["unknown", "none", "高中", "中专", "大专", "本科", "硕士", "博士"]
Source = Literal["page", "hr", "external", "self"]


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Evidence(StrictModel):
    field: str = Field(max_length=50)
    value: str | float | bool | None = None
    snippet: str = Field(default="", max_length=500)
    source: Source = "page"
    observed_at: str
    extraction_checked: bool = False
    note: str = Field(default="", max_length=300)
    active: bool = True


class Profile(StrictModel):
    name: str = Field(default="我的简历", min_length=1, max_length=80)
    text: str = Field(default="", max_length=100000)
    education_completed: Degree = "unknown"
    education_current: Degree = "unknown"
    graduation_year: int | None = Field(default=None, ge=1950, le=2100)
    education_form: Literal["unknown", "full_time", "part_time"] = "unknown"
    experience_years: float | None = Field(default=None, ge=0, le=70)
    skills: list[str] = Field(default_factory=list, max_length=40)
    confirmed: bool = False
    parent_id: str | None = None


class Job(StrictModel):
    title: str = Field(default="", max_length=160)
    company: str = Field(default="", max_length=160)
    city: str = Field(default="", max_length=60)
    district: str = Field(default="", max_length=60)
    platform: Literal["manual", "boss", "51job", "zhaopin"] = "manual"
    source_url: str = Field(default="", max_length=1500)
    platform_job_id: str = Field(default="", max_length=100)
    text: str = Field(default="", max_length=100000)
    education: Degree = "unknown"
    education_mode: Literal["required", "preferred", "unrestricted", "alternative", "complex", "unknown"] = (
        "unknown"
    )
    education_form: Literal["unknown", "full_time", "part_time"] = "unknown"
    graduation_year: int | None = Field(default=None, ge=1950, le=2100)
    experience_min: float | None = Field(default=None, ge=0, le=70)
    salary_min: float | None = Field(default=None, ge=0, le=10000000)
    salary_max: float | None = Field(default=None, ge=0, le=10000000)
    salary_months: int | None = Field(default=None, ge=1, le=36)
    salary_kind: Literal["unknown", "advertised", "fixed", "comprehensive"] = "unknown"
    salary_period: Literal["month", "year", "day", "hour", "unknown"] = "unknown"
    rest: Literal["unknown", "double", "single", "alternating", "rotation"] = "unknown"
    social: bool | None = None
    fund: bool | None = None
    dispatch: bool | None = None
    outsourcing: bool | None = None
    ownership: str = Field(default="", max_length=60)
    contract_company: str = Field(default="", max_length=160)
    service_company: str = Field(default="", max_length=160)
    activity: Literal["unknown", "today", "3days", "week", "other"] = "unknown"
    skills: list[str] = Field(default_factory=list, max_length=40)
    risks: list[str] = Field(default_factory=list, max_length=20)
    dismissed_risks: list[str] = Field(default_factory=list, max_length=20)
    evidence: list[Evidence] = Field(default_factory=list, max_length=100)
    extraction_checked: bool = False
    observed_at: str
    saved: bool = False
    progress: Literal[
        "discovered",
        "contact",
        "communicated",
        "resume_requested",
        "attachment_sent",
        "interview",
        "offer",
        "rejected",
        "ended",
    ] = "discovered"

    @model_validator(mode="after")
    def salary_order(self):
        if self.salary_min is not None and self.salary_max is not None and self.salary_min > self.salary_max:
            raise ValueError("薪资下限不能大于上限")
        return self


class Strategy(StrictModel):
    name: str = Field(default="我的求职策略", min_length=1, max_length=80)
    profile_id: str | None = None
    directions: list[str] = Field(default_factory=list, max_length=20)
    skills: list[str] = Field(default_factory=list, max_length=40)
    cities: list[str] = Field(default_factory=list, max_length=20)
    salary_floor: float | None = Field(default=None, ge=0, le=10000000)
    salary_ideal: float | None = Field(default=None, ge=0, le=10000000)
    salary_hard: bool = True
    require_double: bool = False
    require_social: bool = False
    require_fund: bool = False
    reject_dispatch: bool = False
    reject_outsourcing: bool = False
    strict_education: bool = False
    preferred_ownership: list[str] = Field(default_factory=list, max_length=20)
    acceptable_ownership: list[str] = Field(default_factory=list, max_length=20)
    evidence_minimum: dict[str, Source] = Field(default_factory=dict)
    weights: dict[str, float] = Field(
        default_factory=lambda: {"match": 30, "salary": 25, "benefits": 20, "ownership": 0, "activity": 0}
    )

    @model_validator(mode="after")
    def valid_weights(self):
        if set(self.weights) - {"match", "salary", "benefits", "ownership", "activity"}:
            raise ValueError("未知评分维度")
        if any(v < 0 or v > 1000 for v in self.weights.values()):
            raise ValueError("权重必须在0到1000之间")
        if (
            self.salary_floor is not None
            and self.salary_ideal is not None
            and self.salary_ideal < self.salary_floor
        ):
            raise ValueError("理想月薪不能小于底线")
        if set(self.evidence_minimum) - {
            "rest",
            "social",
            "fund",
            "dispatch",
            "outsourcing",
            "salary",
            "ownership",
        }:
            raise ValueError("未知依据门槛字段")
        return self


class TextInput(StrictModel):
    text: str = Field(min_length=1, max_length=100000)


class JobInput(StrictModel):
    job: Job
    expected_version: int | None = None


class StrategyInput(StrictModel):
    strategy: Strategy
    expected_version: int | None = None


class EvidenceInput(StrictModel):
    evidence: Evidence
    expected_version: int


class BlacklistInput(StrictModel):
    target: Literal["job", "company"]
    value: str = Field(min_length=1, max_length=200)
    reason: str = Field(default="用户排除", max_length=200)


class DraftInput(StrictModel):
    job_id: str
    strategy_id: str
    kind: Literal["greeting", "questions"] = "greeting"


class PairInput(StrictModel):
    code: str = Field(min_length=20, max_length=100)
    label: str = Field(default="Chrome / Edge 只读扩展", max_length=80)
    protocol: int = 1


class ObservationInput(StrictModel):
    protocol: int = 1
    url: str = Field(max_length=1500)
    title: str = Field(max_length=160)
    company: str = Field(default="", max_length=160)
    text: str = Field(max_length=20000)
    platform_job_id: str = Field(default="", max_length=100)
    city: str = Field(default="", max_length=60)
    page_kind: Literal["list", "detail", "unknown"] = "unknown"
    employment_type: Literal["full_time", "internship", "part_time", "unknown"] = "unknown"
    recruitment_type: Literal["campus", "social", "unknown"] = "unknown"
    blocked: bool = False


class OutcomeInput(StrictModel):
    job_id: str
    strategy_id: str | None = None
    kind: Literal["contact", "positive", "negative", "interview", "offer", "no_reply", "unobserved"]


class DraftEditInput(TextInput):
    expected_version: int
