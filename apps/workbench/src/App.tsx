import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Bookmark,
  BriefcaseBusiness,
  Check,
  CheckCheck,
  ChevronDown,
  CircleHelp,
  ClipboardList,
  FileText,
  FolderArchive,
  Leaf,
  Link,
  ListFilter,
  LoaderCircle,
  LockKeyhole,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Undo2,
  Upload,
  X,
} from 'lucide-react';
import { download, post, put, request } from './api';
import type { components } from './generated/api';
type JobModel = Required<components['schemas']['Job']>;

type Page = 'jobs' | 'profile' | 'strategy' | 'records' | 'settings';
type Row = {
  id: string;
  data: any;
  version: number;
  archived: boolean;
  created_at: string;
  assessment?: any;
};
type State = {
  profiles: Row[];
  strategies: Row[];
  jobs: Row[];
  blacklist: Row[];
  drafts: Row[];
  observations: Row[];
  outcomes: Row[];
  connections: any[];
  current_strategy_id: string | null;
};
const EMPTY: State = {
  profiles: [],
  strategies: [],
  jobs: [],
  blacklist: [],
  drafts: [],
  observations: [],
  outcomes: [],
  connections: [],
  current_strategy_id: null,
};
const GROUP: Record<string, string> = {
  all: '全部岗位',
  candidate: '候选',
  pending: '待核实',
  stretch: '冲刺',
  excluded: '排除',
  saved: '已收藏',
  archived: '已归档',
};
const SOURCE: Record<string, string> = {
  page: '页面声明',
  hr: 'HR 回答',
  external: '外部资料',
  self: '用户自行核实',
};
const DEGREE = ['unknown', 'none', '高中', '中专', '大专', '本科', '硕士', '博士'];
const REST: Record<string, string> = {
  unknown: '未明确',
  double: '固定双休',
  single: '单休',
  alternating: '大小周',
  rotation: '轮休',
};
const PROGRESS: Record<string, string> = {
  discovered: '发现',
  contact: '待联系',
  communicated: '人工登记已沟通',
  resume_requested: '人工登记简历请求',
  attachment_sent: '人工登记附件已发送',
  interview: '面试',
  offer: 'Offer',
  rejected: '拒绝',
  ended: '结束',
};
const list = (value: string) =>
  value
    .split(/[,，、\n]/)
    .map((v) => v.trim())
    .filter(Boolean);
const dateLabel = (value: string) =>
  new Date(value).toLocaleString('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
const salary = (j: any) =>
  j.salary_min != null
    ? `${j.salary_min / 1000}–${(j.salary_max ?? j.salary_min) / 1000}K${j.salary_period === 'month' ? '/月' : j.salary_period === 'year' ? '/年' : j.salary_period === 'day' ? '/天' : ''}`
    : '薪资待核实';
const profileBlank = {
  name: '我的简历',
  text: '',
  education_completed: 'unknown',
  education_current: 'unknown',
  graduation_year: null,
  education_form: 'unknown',
  experience_years: null,
  skills: [],
  confirmed: false,
  parent_id: null,
};
const strategyBlank = {
  name: '我的求职策略',
  profile_id: null,
  directions: [],
  skills: [],
  cities: [],
  salary_floor: null,
  salary_ideal: null,
  salary_hard: true,
  require_double: false,
  require_social: false,
  require_fund: false,
  reject_dispatch: false,
  reject_outsourcing: false,
  strict_education: false,
  preferred_ownership: [],
  acceptable_ownership: [],
  evidence_minimum: {},
  weights: { match: 30, salary: 25, benefits: 20, ownership: 0, activity: 0 },
};

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<any>, {
            id,
            'aria-label': label,
            'aria-describedby': hint ? `${id}-hint` : undefined,
          })
        : children}
      {hint && <small id={`${id}-hint`}>{hint}</small>}
    </div>
  );
}
function NumberField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: number | null;
  onChange: (n: number | null) => void;
  hint?: string;
}) {
  return (
    <Field label={label} hint={hint}>
      <input
        type="number"
        min="0"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
      />
    </Field>
  );
}
function Choice({
  value,
  onChange,
  values,
  id,
  'aria-label': ariaLabel,
}: {
  value: string;
  onChange: (v: string) => void;
  values: Record<string, string>;
  id?: string;
  'aria-label'?: string;
}) {
  return (
    <select id={id} aria-label={ariaLabel} value={value} onChange={(e) => onChange(e.target.value)}>
      {Object.entries(values).map(([v, label]) => (
        <option value={v} key={v}>
          {label}
        </option>
      ))}
    </select>
  );
}
function ListInput({
  values,
  onChange,
  ...props
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  id?: string;
  'aria-label'?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(values.join(', '));
  const serialized = JSON.stringify(values);
  useEffect(() => {
    if (document.activeElement !== ref.current) setText(values.join(', '));
  }, [serialized]);
  return (
    <input
      {...props}
      ref={ref}
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        onChange(list(e.target.value));
      }}
      onBlur={() => setText(values.join(', '))}
    />
  );
}

function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (b: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{children}</span>
    </label>
  );
}
function Badge({ group }: { group: string }) {
  return <span className={`badge ${group}`}>{GROUP[group] ?? '待评估'}</span>;
}

function Modal({
  title,
  children,
  onClose,
  wide = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const old = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => old?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={wide ? 'modal wide' : 'modal'}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="modal-head">
        <h2>{title}</h2>
        <button className="icon-button" aria-label="关闭对话框" onClick={onClose}>
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function JobFields({ job, setJob }: { job: JobModel; setJob: (j: any) => void }) {
  const set = (key: string, value: any) => setJob({ ...job, [key]: value });
  const tri = { unknown: '未知', true: '是（当前记录的声明）', false: '否（当前记录的声明）' };
  return (
    <div className="form-grid">
      <Field label="职位名称">
        <input required value={job.title} onChange={(e) => set('title', e.target.value)} />
      </Field>
      <Field label="公司主体">
        <input required value={job.company} onChange={(e) => set('company', e.target.value)} />
      </Field>
      <Field label="工作城市">
        <input
          value={job.city}
          placeholder="如：上海"
          onChange={(e) => set('city', e.target.value)}
        />
      </Field>
      <Field label="区县">
        <input value={job.district} onChange={(e) => set('district', e.target.value)} />
      </Field>
      <Field label="学历要求">
        <Choice
          value={job.education}
          onChange={(v) => set('education', v)}
          values={Object.fromEntries(
            DEGREE.map((d) => [d, d === 'unknown' ? '未知' : d === 'none' ? '不限学历' : d]),
          )}
        />
      </Field>
      <Field label="学历要求性质">
        <Choice
          value={job.education_mode}
          onChange={(v) => set('education_mode', v)}
          values={{
            unknown: '未明确',
            required: '必需',
            preferred: '优先（不作为硬门槛）',
            unrestricted: '不限',
            alternative: '学历或经验可替代',
            complex: '复杂条件，需核实',
          }}
        />
      </Field>
      <NumberField
        label="最低相关经验（年）"
        value={job.experience_min}
        onChange={(v) => set('experience_min', v)}
      />
      <NumberField
        label="应届毕业年份"
        value={job.graduation_year}
        onChange={(v) => set('graduation_year', v)}
      />
      <NumberField
        label="薪资下限（元）"
        value={job.salary_min}
        onChange={(v) => set('salary_min', v)}
      />
      <NumberField
        label="薪资上限（元）"
        value={job.salary_max}
        onChange={(v) => set('salary_max', v)}
      />
      <Field label="薪资口径" hint="招聘展示的范围，不自动当作固定底薪">
        <Choice
          value={job.salary_kind}
          onChange={(v) => set('salary_kind', v)}
          values={{
            unknown: '未知',
            advertised: '招聘展示，底薪待核实',
            fixed: '原文明示固定底薪',
            comprehensive: '综合收入 / 含提成',
          }}
        />
      </Field>
      <Field label="薪资周期">
        <Choice
          value={job.salary_period}
          onChange={(v) => set('salary_period', v)}
          values={{ unknown: '未知', month: '每月', year: '每年', day: '每天', hour: '每小时' }}
        />
      </Field>
      <NumberField
        label="薪资月数（额外单列）"
        value={job.salary_months}
        onChange={(v) => set('salary_months', v)}
      />
      <Field label="休息制度">
        <Choice value={job.rest} onChange={(v) => set('rest', v)} values={REST} />
      </Field>
      {(
        [
          ['social', '五险'],
          ['fund', '公积金'],
          ['dispatch', '劳务派遣'],
          ['outsourcing', '业务外包'],
        ] as const
      ).map(([key, label]) => (
        <Field label={label} key={key}>
          <Choice
            value={job[key] === null ? 'unknown' : String(job[key])}
            onChange={(v) => set(key, v === 'unknown' ? null : v === 'true')}
            values={tri}
          />
        </Field>
      ))}
      <Field label="企业性质" hint="项目客户性质不能替代签约主体">
        <input
          value={job.ownership}
          placeholder="未明确可留空"
          onChange={(e) => set('ownership', e.target.value)}
        />
      </Field>
      <Field label="合同签约主体">
        <input
          value={job.contract_company}
          onChange={(e) => set('contract_company', e.target.value)}
        />
      </Field>
      <Field label="实际服务企业">
        <input
          value={job.service_company}
          onChange={(e) => set('service_company', e.target.value)}
        />
      </Field>
      <Field label="相关技能（逗号分隔）">
        <ListInput values={job.skills} onChange={(v) => set('skills', v)} />
      </Field>
      <Field label="来源链接">
        <input
          type="url"
          value={job.source_url}
          onChange={(e) => set('source_url', e.target.value)}
          placeholder="https://…"
        />
      </Field>
    </div>
  );
}

export default function App() {
  const [state, setState] = useState<State>(EMPTY);
  const [page, setPage] = useState<Page>('jobs');
  const [group, setGroup] = useState('all');
  const [search, setSearch] = useState('');
  const [strategyId, setStrategyId] = useState<string | null>(null);
  const [status, setStatus] = useState('正在连接本地工作台…');
  const [error, setError] = useState('');
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState('');
  const [importJob, setImportJob] = useState<any>(null);
  const [profile, setProfile] = useState<any>({ ...profileBlank });
  const [strategy, setStrategy] = useState<any>({ ...strategyBlank });
  const [selected, setSelected] = useState<Row | null>(null);
  const [editingJob, setEditingJob] = useState<any>(null);
  const [draft, setDraft] = useState<Row | null>(null);
  const [pair, setPair] = useState<any>(null);
  const [backupPreview, setBackupPreview] = useState<any>(null);
  const [previewBackup, setPreviewBackup] = useState<any>(null);
  const [relaxPreview, setRelaxPreview] = useState<any>(null);
  const [statistics, setStatistics] = useState<any>(null);
  const [reviewObservation, setReviewObservation] = useState<string | null>(null);
  const [evidence, setEvidence] = useState({
    field: 'rest',
    value: 'double',
    snippet: '',
    source: 'hr',
    note: '',
  });
  const scratchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const profileTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftQueue = useRef<Promise<unknown>>(Promise.resolve());
  const draftVersions = useRef<Record<string, number>>({});
  const currentStrategy = state.strategies.find((s) => s.id === state.current_strategy_id);

  async function refresh(id = strategyId) {
    const data = await request<State>(`/state${id ? `?strategy_id=${id}` : ''}`);
    setState(data);
    setStatistics(await request('/statistics'));
    setOnline(true);
    if (data.current_strategy_id && !id) setStrategyId(data.current_strategy_id);
    return data;
  }
  useEffect(() => {
    void refresh()
      .then(() => setStatus('所有内容保存在这台电脑'))
      .catch((e: Error) => {
        setOnline(false);
        setError(e.message);
      });
  }, []);
  async function run(task: () => Promise<void>, success?: string) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await task();
      if (success) setStatus(success);
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败，请重试');
    } finally {
      setBusy(false);
    }
  }
  function navigate(p: Page) {
    setPage(p);
    if (p === 'strategy')
      setStrategy(
        currentStrategy
          ? structuredClone(currentStrategy.data)
          : {
              ...strategyBlank,
              profile_id: state.profiles.find((p) => p.data.confirmed)?.id ?? null,
            },
      );
    if (p === 'profile' && state.profiles.length && !profile.text)
      setProfile({ ...state.profiles[0].data, parent_id: state.profiles[0].id });
  }
  function autosaveInput(kind: string, text: string) {
    const timer = kind === 'profile' ? profileTimer : scratchTimer;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void post('/scratch', {
        kind,
        text,
        profile_id: kind === 'profile' ? profile.parent_id : null,
      }).catch((e: Error) => setError(`输入草稿未保存：${e.message}。请保留当前页面内容后重试。`));
    }, 800);
  }
  function saveDraft(record: Row) {
    const pending = draftQueue.current.then(async () => {
      const saved = await put<Row>(`/drafts/${record.id}`, {
        text: record.data.content,
        expected_version: draftVersions.current[record.id] ?? record.version,
      });
      draftVersions.current[record.id] = saved.version;
      setDraft((current) =>
        current?.id === record.id ? { ...current, version: saved.version } : current,
      );
    });
    draftQueue.current = pending.catch(() => {});
    return pending;
  }
  function closeDraft() {
    if (!draft) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    void run(async () => {
      await saveDraft(draft);
      setDraft(null);
      await refresh();
    }, '草稿已保存，尚未发送');
  }
  async function saveJob(record: Row, updates: any) {
    if (reviewObservation && selected?.id === record.id) {
      await post(`/observations/${reviewObservation}/accept`, {
        job: updates,
        expected_version: record.version,
      });
      setReviewObservation(null);
    } else await put(`/jobs/${record.id}`, { job: updates, expected_version: record.version });
    const data = await refresh();
    const updated = data.jobs.find((j) => j.id === record.id);
    if (selected?.id === record.id) setSelected(updated ?? null);
  }
  async function makeDraft(record: Row, kind: 'greeting' | 'questions') {
    if (!currentStrategy) throw new Error('请先创建策略并绑定已确认简历');
    const result = await post<Row>('/drafts', {
      job_id: record.id,
      strategy_id: currentStrategy.id,
      kind,
    });
    draftVersions.current[result.id] = result.version;
    setDraft(result);
    await refresh();
  }
  async function seedExample() {
    const p = await post<Row>('/profiles', {
      ...profileBlank,
      name: '示例画像（非真实简历）',
      education_completed: '本科',
      experience_years: 2,
      skills: ['Python', 'SQL'],
      confirmed: true,
    });
    const s = await post<Row>('/strategies', {
      ...strategyBlank,
      name: '示例策略',
      profile_id: p.id,
      directions: ['开发', '数据'],
      skills: ['Python', 'SQL'],
      cities: ['上海'],
      require_double: true,
    });
    for (const [title, text] of [
      [
        'Python 开发工程师',
        '本科及以上，1年工作经验。Python、SQL。固定月薪 10-15K·13薪，周末双休，五险一金。公司直签，非劳务派遣。',
      ],
      ['数据分析师', '本科优先，经验不限。Python、SQL。薪资 8-12K，五险一金，休息制度面议。'],
      ['高级开发工程师', '硕士及以上，3年工作经验。Python、Docker。固定月薪 18-25K，双休。'],
    ]) {
      const parsed = await post('/jobs/parse', { text });
      await post('/jobs', {
        job: {
          ...parsed.job,
          title: `[示例] ${title}`,
          company: '示例企业（合成数据）',
          city: '上海',
          extraction_checked: true,
        },
      });
    }
    setStrategyId(s.id);
    await refresh(s.id);
    setStatus('已导入明确标注的合成示例，可随时修改。示例不计真实平台验证。');
  }
  const counts = Object.fromEntries(
    ['candidate', 'pending', 'stretch', 'excluded'].map((g) => [
      g,
      state.jobs.filter((j) => j.assessment?.group === g && j.data.progress !== 'ended').length,
    ]),
  );
  const visible = state.jobs.filter((j) => {
    const archived = j.data.progress === 'ended';
    if (group === 'archived' ? !archived : archived) return false;
    if (group === 'saved' && !j.data.saved) return false;
    if (!['all', 'saved', 'archived'].includes(group) && j.assessment?.group !== group)
      return false;
    return `${j.data.title} ${j.data.company} ${j.data.city}`
      .toLowerCase()
      .includes(search.toLowerCase());
  });
  const blocking = Object.entries(
    state.jobs
      .flatMap((j) =>
        (j.assessment?.reasons ?? [])
          .filter((r: any) => r.kind === 'pending')
          .map((r: any) => r.field),
      )
      .reduce<Record<string, number>>((a, f: string) => ({ ...a, [f]: (a[f] ?? 0) + 1 }), {}),
  ).sort((a, b) => b[1] - a[1]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        跳到主要内容
      </a>
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate('jobs')} aria-label="EasyResume 首页">
          <span className="brand-symbol">
            <Leaf size={24} />
          </span>
          <span>
            Easy<span className="brand-light">Resume</span>
            <small>你的本地求职工作台</small>
          </span>
        </button>
        <div className="workspace-label">
          个人工作空间 <span>LOCAL</span>
        </div>
        <nav aria-label="主导航">
          {(
            [
              ['jobs', BriefcaseBusiness, '岗位工作台'],
              ['profile', FileText, '我的简历'],
              ['strategy', SlidersHorizontal, '筛选策略'],
              ['records', ClipboardList, '沟通与记录'],
              ['settings', Settings2, '设置与连接'],
            ] as const
          ).map(([key, Icon, label]) => (
            <button
              className={`nav-item ${page === key ? 'active' : ''}`}
              key={key}
              aria-label={label}
              onClick={() => navigate(key)}
              aria-current={page === key ? 'page' : undefined}
            >
              <Icon size={19} />
              <span>{label}</span>
              {key === 'jobs' && <span className="nav-count">{state.jobs.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="tiny-label">少一点盲投，多一点确定</span>
          <p>
            先看清条件，
            <br />
            再迈出下一步。
          </p>
          <div className="note-line" />
          <span>每个判断，都有依据。</span>
        </div>
        <div className="local-status">
          <span className={`status-dot ${online ? '' : 'offline'}`} />
          <div>
            {online ? '本地服务已连接' : '本地服务待连接'}
            <small>数据留在你的电脑</small>
          </div>
          <LockKeyhole size={15} />
        </div>
      </aside>

      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            工作空间 <span>/</span>{' '}
            {
              {
                jobs: '岗位工作台',
                profile: '我的简历',
                strategy: '筛选策略',
                records: '沟通与记录',
                settings: '设置与连接',
              }[page]
            }
          </div>
          <div className="topbar-right">
            <span className="private-label">
              <ShieldCheck size={14} /> 本地优先 · 无需账号
            </span>
            <button
              className="avatar"
              aria-label="查看本地设置"
              onClick={() => navigate('settings')}
            >
              我
            </button>
          </div>
        </header>
        <main id="main" tabIndex={-1}>
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button onClick={() => setError('')} aria-label="关闭错误提示">
                <X size={17} />
              </button>
            </div>
          )}
          <div className="feedback-line" role="status" aria-live="polite">
            {busy ? (
              <>
                <LoaderCircle className="spin" size={13} /> 正在处理，请稍候…
              </>
            ) : (
              <>
                <span className={`status-dot ${online ? '' : 'offline'}`} /> {status}
              </>
            )}
          </div>

          {page === 'jobs' && (
            <>
              <section className="page-heading">
                <div>
                  <div className="eyebrow">YOUR NEXT CHAPTER</div>
                  <h1>
                    把时间留给<span>好机会。</span>
                  </h1>
                  <p>从简历出发，找到更合适的岗位。每个判断，都能看见理由。</p>
                </div>
                <div className="heading-actions">
                  <button
                    className="button secondary"
                    onClick={() =>
                      void run(async () =>
                        download(
                          await request<Blob>(
                            `/export.csv${currentStrategy ? `?strategy_id=${currentStrategy.id}` : ''}`,
                          ),
                          'EasyResume-岗位.csv',
                        ),
                      )
                    }
                  >
                    <ArrowDownToLine size={16} />
                    导出
                  </button>
                  <button
                    className="button primary"
                    onClick={() => {
                      setImportJob(null);
                      setImportOpen(true);
                    }}
                  >
                    <Plus size={17} />
                    导入职位
                  </button>
                </div>
              </section>
              <div className="summary-grid">
                {(
                  [
                    ['candidate', '值得进一步了解', '通过已设置的初筛条件', CheckCheck],
                    ['pending', '先问清，再决定', '缺失信息与冲突单独处理', CircleHelp],
                    ['stretch', '为可能性留个位置', '资格有差距，机会仍可探索', ArrowUpRight],
                  ] as const
                ).map(([g, title, subtitle, Icon]) => (
                  <button className={`summary-card ${g}`} key={g} onClick={() => setGroup(g)}>
                    <div>
                      <span className="summary-title">{title}</span>
                      <strong>
                        {counts[g] ?? 0}
                        <small>个岗位</small>
                      </strong>
                      <span className="summary-subtitle">{subtitle}</span>
                    </div>
                    <span className="summary-icon">
                      <Icon size={22} />
                    </span>
                  </button>
                ))}
              </div>
              {(!state.profiles.some((p) => p.data.confirmed) || !state.strategies.length) && (
                <section className="onboarding">
                  <div className="onboarding-copy">
                    <span className="small-kicker">从这里开始</span>
                    <h2>三步，建立你的求职坐标。</h2>
                    <p>不必先调权重，也不用连接 AI。</p>
                  </div>
                  <div className="onboarding-steps">
                    {[
                      [
                        1,
                        '确认简历',
                        '学历、经历与技能',
                        'profile',
                        state.profiles.some((p) => p.data.confirmed),
                      ],
                      [2, '设置底线', '城市与不可接受条件', 'strategy', !!state.strategies.length],
                      [3, '导入岗位', '粘贴原文，核对预填', 'import', !!state.jobs.length],
                    ].map(([n, title, subtitle, target, done]) => (
                      <button
                        key={String(n)}
                        onClick={() =>
                          target === 'import' ? setImportOpen(true) : navigate(target as Page)
                        }
                      >
                        <span className={`step-number ${done ? 'done' : ''}`}>
                          {done ? <Check size={15} /> : n}
                        </span>
                        <span>
                          <b>{title}</b>
                          <small>{subtitle}</small>
                        </span>
                        <ArrowRight size={14} />
                      </button>
                    ))}
                  </div>
                </section>
              )}
              <section className="jobs-section">
                <div className="section-top">
                  <div>
                    <h2>
                      你的岗位清单 <span>{state.jobs.length}</span>
                    </h2>
                    <p>优先展示已知条件更匹配的岗位</p>
                  </div>
                  <button className="text-button" onClick={() => navigate('strategy')}>
                    <SlidersHorizontal size={15} />
                    {currentStrategy?.data.name ?? '设置筛选策略'}
                    <ChevronDown size={14} />
                  </button>
                </div>
                <div className="list-toolbar">
                  <div className="tabs" role="tablist" aria-label="岗位分组">
                    {[
                      'all',
                      'candidate',
                      'pending',
                      'stretch',
                      'excluded',
                      'saved',
                      'archived',
                    ].map((g) => (
                      <button
                        role="tab"
                        aria-selected={group === g}
                        key={g}
                        className={group === g ? 'selected' : ''}
                        onClick={() => setGroup(g)}
                      >
                        {GROUP[g]}
                        {['candidate', 'pending', 'stretch'].includes(g) && (
                          <small>{counts[g]}</small>
                        )}
                      </button>
                    ))}
                  </div>
                  <label className="search-box">
                    <Search size={16} />
                    <input
                      aria-label="搜索职位、公司或城市"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="搜索职位、公司…"
                    />
                  </label>
                </div>
                {state.jobs.length > 0 && counts.candidate === 0 && currentStrategy && (
                  <div className="blockers">
                    <CircleHelp size={19} />
                    <div>
                      <strong>暂时没有全部满足条件的岗位，这不等于没有机会。</strong>
                      <p>
                        先处理待核实项，再决定是否调整要求。
                        {blocking.length > 0 &&
                          ` 当前有 ${blocking[0][1]} 项记录因「${({ profile: '简历未确认', education: '学历条件', salary: '薪资口径', rest: '休息制度', extraction: '提取未核对', city: '工作地点', fund: '公积金', social: '五险' } as any)[blocking[0][0]] ?? blocking[0][0]}」需要检查。`}
                      </p>
                      <button
                        className="text-button"
                        onClick={() =>
                          void run(async () => {
                            const result = await post('/strategies/preview', {
                              ...currentStrategy.data,
                              require_double: false,
                              require_social: false,
                              require_fund: false,
                              salary_hard: false,
                            });
                            setRelaxPreview(result);
                          })
                        }
                      >
                        预览放宽待遇条件的影响 <ArrowRight size={13} />
                      </button>
                    </div>
                  </div>
                )}
                {visible.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-illustration">
                      <FileText size={40} />
                      <span>
                        <Search size={19} />
                      </span>
                    </div>
                    <h3>
                      {state.jobs.length ? '这个分组暂时没有岗位' : '下一份好机会，从一条职位开始'}
                    </h3>
                    <p>
                      {state.jobs.length
                        ? '可以切换分组，或检查当前搜索和筛选条件。'
                        : '粘贴职位描述，让系统整理条件。你决定哪些值得继续。'}
                    </p>
                    <div className="empty-actions">
                      <button className="button primary" onClick={() => setImportOpen(true)}>
                        <Plus size={16} />
                        导入第一条职位
                      </button>
                      {!state.jobs.length && (
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => void run(seedExample)}
                        >
                          用合成示例体验 <ArrowRight size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="job-grid">
                    {visible.map((row) => (
                      <article className="job-card" key={row.id}>
                        <div className="card-top">
                          <Badge group={row.assessment?.group ?? 'unscored'} />
                          <button
                            className={`icon-button bookmark ${row.data.saved ? 'bookmarked' : ''}`}
                            aria-label={
                              row.data.saved
                                ? `取消收藏 ${row.data.title}`
                                : `收藏 ${row.data.title}`
                            }
                            onClick={() =>
                              void run(
                                () => saveJob(row, { ...row.data, saved: !row.data.saved }),
                                row.data.saved ? '已取消收藏' : '已收藏岗位',
                              )
                            }
                          >
                            <Bookmark size={18} fill={row.data.saved ? 'currentColor' : 'none'} />
                          </button>
                        </div>
                        <button
                          className="job-title"
                          onClick={() => {
                            setSelected(row);
                            setEditingJob(null);
                          }}
                        >
                          {row.data.title}
                        </button>
                        <div className="company-line">
                          <span className="company-monogram">
                            {row.data.company?.slice(0, 1) || '?'}
                          </span>
                          {row.data.company || '公司待核对'}
                          <span className="platform-tag">
                            {row.data.platform === 'boss'
                              ? 'BOSS'
                              : row.data.platform === 'manual'
                                ? '手动导入'
                                : row.data.platform}
                          </span>
                        </div>
                        <div className="salary-line">
                          <strong>{salary(row.data)}</strong>
                          {row.data.salary_months && <span>· {row.data.salary_months}薪</span>}
                          <small>
                            {row.data.salary_kind === 'fixed'
                              ? '原文明示固定底薪'
                              : '底薪口径待核实'}
                          </small>
                        </div>
                        <div className="tag-row">
                          <span>{row.data.city || '地点待核实'}</span>
                          <span>
                            {row.data.education === 'unknown'
                              ? '学历待核实'
                              : row.data.education === 'none'
                                ? '学历不限'
                                : row.data.education}
                          </span>
                          <span className={row.data.rest === 'double' ? 'good' : ''}>
                            {REST[row.data.rest]}
                          </span>
                        </div>
                        <div className="card-reason">
                          {row.assessment?.matches?.length ? (
                            <>
                              <Check size={14} />
                              <span>{row.assessment.matches[0]}</span>
                            </>
                          ) : (
                            <>
                              <CircleHelp size={14} />
                              <span>
                                {row.assessment?.reasons?.[0]?.message ?? '创建策略后查看匹配理由'}
                              </span>
                            </>
                          )}
                        </div>
                        {row.assessment?.reasons?.length > 0 && (
                          <p className="card-unknown">{row.assessment.reasons[0].message}</p>
                        )}
                        <div className="card-bottom">
                          <span className="score-text">
                            {row.assessment?.low != null ? (
                              <>
                                匹配范围{' '}
                                <b>
                                  {Math.round(row.assessment.low)}–{Math.round(row.assessment.high)}
                                </b>
                                <small>非录用概率</small>
                              </>
                            ) : (
                              '尚未评分'
                            )}
                          </span>
                          <button
                            className="text-button"
                            onClick={() => {
                              setSelected(row);
                              setEditingJob(null);
                            }}
                          >
                            查看依据 <ArrowUpRight size={15} />
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
              <div className="workspace-footer">
                <LockKeyhole size={13} />
                你的简历、岗位和策略保存在本机
                <span>平台发送尚未开放 · 当前以核实与人工操作为主</span>
              </div>
            </>
          )}

          {page === 'profile' && (
            <>
              <section className="page-heading">
                <div>
                  <div className="eyebrow">YOUR EXPERIENCE, CLEARLY</div>
                  <h1>
                    从真实的经历<span>出发。</span>
                  </h1>
                  <p>解析只是预填。你核对后的学历、技能与经历，才参与筛选。</p>
                </div>
              </section>
              <div className="editor-layout">
                <section className="panel">
                  <div className="panel-heading">
                    <h2>01 / 导入简历原文</h2>
                    <span className="muted">仅在本机解析</span>
                  </div>
                  <label className="upload-zone">
                    <Upload size={25} />
                    <strong>选择 DOCX、文本 PDF 或 TXT</strong>
                    <span>最大 20MB · 扫描件可改用手动填写</span>
                    <input
                      aria-label="上传简历"
                      type="file"
                      accept=".docx,.pdf,.txt"
                      disabled={busy}
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f)
                          void run(async () => {
                            const form = new FormData();
                            form.append('file', f);
                            const result = await request('/profiles/upload', {
                              method: 'POST',
                              body: form,
                            });
                            setProfile({ ...result.profile, name: f.name.replace(/\.[^.]+$/, '') });
                          }, '已提取原文，请核对关键字段');
                      }}
                    />
                  </label>
                  <Field label="简历原文或手动输入">
                    <textarea
                      rows={16}
                      value={profile.text}
                      onChange={(e) => {
                        setProfile({ ...profile, text: e.target.value });
                        autosaveInput('profile', e.target.value);
                      }}
                      placeholder="粘贴简历内容，例如教育经历、工作经历与技能…"
                    />
                  </Field>
                  <button
                    className="button secondary"
                    disabled={busy || !profile.text.trim()}
                    onClick={() =>
                      void run(async () => {
                        const result = await post('/profiles/parse', { text: profile.text });
                        setProfile({
                          ...result.profile,
                          name: profile.name,
                          parent_id: profile.parent_id,
                        });
                      }, '规则预填完成，请检查学历和经历')
                    }
                  >
                    <Sparkles size={15} />
                    规则预填
                  </button>
                  <p className="helper">
                    工作日期不会盲目累加。重叠经历、实习与相关年限需要人工确认。
                  </p>
                </section>
                <section className="panel">
                  <div className="panel-heading">
                    <h2>02 / 集中核对关键事实</h2>
                    <span className="badge pending">需要你确认</span>
                  </div>
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void run(async () => {
                        const saved = await post<Row>('/profiles', { ...profile, confirmed: true });
                        setProfile({ ...saved.data, parent_id: saved.id });
                        await refresh();
                      }, '画像已确认。请在策略中绑定这个版本。');
                    }}
                  >
                    <div className="form-grid">
                      <Field label="简历名称">
                        <input
                          required
                          value={profile.name}
                          onChange={(e) => setProfile({ ...profile, name: e.target.value })}
                        />
                      </Field>
                      <Field label="已完成学历">
                        <Choice
                          value={profile.education_completed}
                          onChange={(v) => setProfile({ ...profile, education_completed: v })}
                          values={Object.fromEntries(
                            DEGREE.map((d) => [
                              d,
                              d === 'unknown' ? '未知 / 暂不确定' : d === 'none' ? '无此项' : d,
                            ]),
                          )}
                        />
                      </Field>
                      <Field label="在读学历">
                        <Choice
                          value={profile.education_current}
                          onChange={(v) => setProfile({ ...profile, education_current: v })}
                          values={Object.fromEntries(
                            DEGREE.map((d) => [d, d === 'unknown' ? '没有 / 未明确' : d]),
                          )}
                        />
                      </Field>
                      <Field label="教育形式">
                        <Choice
                          value={profile.education_form}
                          onChange={(v) => setProfile({ ...profile, education_form: v })}
                          values={{ unknown: '未明确', full_time: '全日制', part_time: '非全日制' }}
                        />
                      </Field>
                      <NumberField
                        label="毕业 / 预计毕业年份"
                        value={profile.graduation_year}
                        onChange={(v) => setProfile({ ...profile, graduation_year: v })}
                      />
                      <NumberField
                        label="确认的相关工作年限"
                        value={profile.experience_years}
                        onChange={(v) => setProfile({ ...profile, experience_years: v })}
                      />
                    </div>
                    <Field label="确认的技能（逗号分隔）">
                      <ListInput
                        values={profile.skills}
                        onChange={(v) => setProfile({ ...profile, skills: v })}
                      />
                    </Field>
                    <div className="info-note">
                      <ShieldCheck size={17} />
                      <span>
                        保存表示你已核对提取。系统不会为你编造经历，也不会上传简历到云端。
                      </span>
                    </div>
                    <button className="button primary" disabled={busy}>
                      <CheckCheck size={16} />
                      确认并保存画像版本
                    </button>
                  </form>
                </section>
              </div>
              <section className="panel mt">
                <div className="panel-heading">
                  <h2>已保存的画像</h2>
                  <span>{state.profiles.length} 个版本</span>
                </div>
                {state.profiles.length === 0 && (
                  <p className="muted">还没有保存画像。可以先手动填写右侧表单。</p>
                )}
                {state.profiles.map((p) => (
                  <div className="record-row" key={p.id}>
                    <FileText size={18} />
                    <div>
                      <strong>{p.data.name}</strong>
                      <small>
                        {p.data.education_completed} · {p.data.skills.join(' / ') || '技能未填写'} ·{' '}
                        {dateLabel(p.created_at)}
                      </small>
                    </div>
                    <span className={`badge ${p.data.confirmed ? 'candidate' : 'pending'}`}>
                      {p.data.confirmed ? '已确认提取' : '需重新确认'}
                    </span>
                    <button
                      className="text-button"
                      onClick={() => setProfile({ ...p.data, parent_id: p.id })}
                    >
                      载入编辑
                    </button>
                    <button
                      className="text-button danger"
                      onClick={() => {
                        if (confirm('删除此画像及后续版本、提取原文和衍生草稿？外部备份不受影响。'))
                          void run(async () => {
                            await request(`/profiles/${p.id}`, { method: 'DELETE' });
                            setProfile({ ...profileBlank });
                            await refresh();
                          }, '画像及本地衍生内容已删除');
                      }}
                    >
                      删除
                    </button>
                  </div>
                ))}
              </section>
            </>
          )}

          {page === 'strategy' && (
            <>
              <section className="page-heading">
                <div>
                  <div className="eyebrow">DECIDE WHAT MATTERS</div>
                  <h1>
                    底线清楚，<span>选择从容。</span>
                  </h1>
                  <p>先定义你在意的条件，复杂权重可以以后再调。</p>
                </div>
              </section>
              <form
                className="panel strategy-panel"
                onSubmit={(e: FormEvent) => {
                  e.preventDefault();
                  void run(async () => {
                    let saved: Row;
                    if (currentStrategy)
                      saved = await put(`/strategies/${currentStrategy.id}`, {
                        strategy,
                        expected_version: currentStrategy.version,
                      });
                    else saved = await post('/strategies', strategy);
                    setStrategyId(saved.id);
                    await refresh(saved.id);
                  }, '策略已保存，岗位已重新评估');
                }}
              >
                <div className="form-grid">
                  <Field label="策略名称">
                    <input
                      required
                      value={strategy.name}
                      onChange={(e) => setStrategy({ ...strategy, name: e.target.value })}
                    />
                  </Field>
                  <Field label="绑定简历画像">
                    <select
                      value={strategy.profile_id ?? ''}
                      onChange={(e) =>
                        setStrategy({ ...strategy, profile_id: e.target.value || null })
                      }
                    >
                      <option value="">先选择已确认画像</option>
                      {state.profiles.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.data.name} · {p.data.education_completed}
                          {!p.data.confirmed ? '（需确认）' : ''}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="岗位方向（逗号分隔）">
                    <ListInput
                      values={strategy.directions}
                      onChange={(v) => setStrategy({ ...strategy, directions: v })}
                      placeholder="如：数据分析，后端开发"
                    />
                  </Field>
                  <Field label="可接受城市（逗号分隔）">
                    <ListInput
                      values={strategy.cities}
                      onChange={(v) => setStrategy({ ...strategy, cities: v })}
                      placeholder="留空表示暂不限城市"
                    />
                  </Field>
                  <NumberField
                    label="最低固定月薪（元）"
                    value={strategy.salary_floor}
                    onChange={(v) => setStrategy({ ...strategy, salary_floor: v })}
                    hint="综合收入不能替代固定底薪"
                  />
                  <NumberField
                    label="理想固定月薪（元）"
                    value={strategy.salary_ideal}
                    onChange={(v) => setStrategy({ ...strategy, salary_ideal: v })}
                  />
                  <Field label="希望匹配的确认技能">
                    <ListInput
                      values={strategy.skills}
                      onChange={(v) => setStrategy({ ...strategy, skills: v })}
                    />
                  </Field>
                  <Field label="学历不足的处理">
                    <Choice
                      value={strategy.strict_education ? 'strict' : 'stretch'}
                      onChange={(v) =>
                        setStrategy({ ...strategy, strict_education: v === 'strict' })
                      }
                      values={{ stretch: '保留为冲刺岗位（默认）', strict: '严格排除' }}
                    />
                  </Field>
                </div>
                <div className="section-divider" />
                <h3>不可接受条件</h3>
                <div className="toggle-grid">
                  {(
                    [
                      ['require_double', '必须固定双休'],
                      ['require_social', '必须有五险'],
                      ['require_fund', '必须有公积金'],
                      ['reject_dispatch', '不接受劳务派遣'],
                      ['reject_outsourcing', '不接受业务外包'],
                      ['salary_hard', '薪资底线为硬要求'],
                    ] as const
                  ).map(([key, label]) => (
                    <Toggle
                      key={key}
                      checked={strategy[key]}
                      onChange={(v) => setStrategy({ ...strategy, [key]: v })}
                    >
                      {label}
                    </Toggle>
                  ))}
                </div>
                <p className="helper">
                  明确不满足的排除；必要条件未知的待核实。不会把“未提及”判断为“没有”。
                </p>
                <details className="advanced">
                  <summary>
                    <Settings2 size={16} />
                    高级设置：权重、企业偏好和证据门槛
                  </summary>
                  <div className="form-grid">
                    {Object.entries({
                      match: '方向技能',
                      salary: '固定薪资',
                      benefits: '制度福利',
                      ownership: '企业偏好',
                      activity: 'HR活跃（实验）',
                    }).map(([key, label]) => (
                      <NumberField
                        key={key}
                        label={`${label}权重`}
                        value={strategy.weights[key]}
                        onChange={(v) =>
                          setStrategy({
                            ...strategy,
                            weights: { ...strategy.weights, [key]: v ?? 0 },
                          })
                        }
                      />
                    ))}
                    <Field label="首选企业性质">
                      <ListInput
                        values={strategy.preferred_ownership}
                        onChange={(v) => setStrategy({ ...strategy, preferred_ownership: v })}
                      />
                    </Field>
                    <Field label="可接受企业性质">
                      <ListInput
                        values={strategy.acceptable_ownership}
                        onChange={(v) => setStrategy({ ...strategy, acceptable_ownership: v })}
                      />
                    </Field>
                    {['rest', 'social', 'fund', 'dispatch', 'outsourcing', 'salary'].map(
                      (field) => (
                        <Field
                          label={`${({ rest: '双休', social: '五险', fund: '公积金', dispatch: '派遣', outsourcing: '外包', salary: '固定薪资' } as any)[field]}依据要求`}
                          key={field}
                        >
                          <Choice
                            value={strategy.evidence_minimum[field] ?? 'page'}
                            onChange={(v) =>
                              setStrategy({
                                ...strategy,
                                evidence_minimum: { ...strategy.evidence_minimum, [field]: v },
                              })
                            }
                            values={{
                              page: '页面明确声明可初筛',
                              hr: '需要HR回答',
                              external: '需要外部资料',
                              self: '需要自行核实',
                            }}
                          />
                        </Field>
                      ),
                    )}
                  </div>
                  <p className="helper">
                    全零表示未评分。未知软条件保留范围；分数不是录用概率。跨策略分数不可直接比较。
                  </p>
                </details>
                <div className="form-actions">
                  <button className="button primary" disabled={busy}>
                    <Check size={16} />
                    保存并重新评估
                  </button>
                  {currentStrategy && (
                    <button
                      type="button"
                      className="button secondary"
                      onClick={() =>
                        void run(async () => {
                          const saved = await post<Row>('/strategies', {
                            ...strategy,
                            name: `${strategy.name} · 副本`,
                          });
                          setStrategyId(saved.id);
                          await refresh(saved.id);
                        }, '已创建独立策略副本')
                      }
                    >
                      另存为新策略
                    </button>
                  )}
                </div>
              </form>
              {state.strategies.length > 0 && (
                <section className="panel mt">
                  <h3>切换策略</h3>
                  {state.strategies.map((s) => (
                    <button
                      className={`strategy-chip ${currentStrategy?.id === s.id ? 'active' : ''}`}
                      key={s.id}
                      onClick={() =>
                        void run(async () => {
                          setStrategyId(s.id);
                          await refresh(s.id);
                          setStrategy(structuredClone(s.data));
                        })
                      }
                    >
                      {s.data.name} <small>v{s.version}</small>
                    </button>
                  ))}
                </section>
              )}
            </>
          )}

          {page === 'records' && (
            <>
              <section className="page-heading">
                <div>
                  <div className="eyebrow">EVERY STEP COUNTS</div>
                  <h1>
                    把每一步，<span>记清楚。</span>
                  </h1>
                  <p>草稿、人工登记和平台反馈各自标注，点击不等于发送成功。</p>
                </div>
              </section>
              <div className="info-note">
                <LockKeyhole size={18} />
                <span>
                  平台自动发送尚未通过真实验证。这里只保存草稿及人工维护的求职进度，不虚构回复率。
                </span>
              </div>
              <section className="panel mt">
                <h2>沟通草稿</h2>
                {!state.drafts.length && (
                  <div className="simple-empty">
                    <FileText size={28} />
                    <p>在岗位详情生成招呼或核实问题，草稿会保存在这里。</p>
                  </div>
                )}
                {state.drafts.map((d) => {
                  const j = state.jobs.find((j) => j.id === d.data.job_id);
                  const s = state.strategies.find((s) => s.id === d.data.strategy_id);
                  const stale =
                    !j ||
                    j.version !== d.data.job_version ||
                    s?.version !== d.data.strategy_version;
                  return (
                    <div className="record-row" key={d.id}>
                      <FileText size={18} />
                      <div>
                        <strong>{j?.data.title ?? '已删除岗位'}</strong>
                        <small>
                          {d.data.kind === 'questions' ? '核实问题' : '个性化招呼'} ·{' '}
                          {dateLabel(d.created_at)} {stale ? '· 来源已变化，请重新生成' : ''}
                        </small>
                        <p>{d.data.content.slice(0, 90)}…</p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => {
                          draftVersions.current[d.id] = d.version;
                          setDraft(d);
                        }}
                      >
                        查看 / 编辑
                      </button>
                    </div>
                  );
                })}
              </section>
              <section className="panel mt">
                <h2>求职进度（人工登记）</h2>
                <p className="helper">
                  进度和统计分别登记。首次联系绑定当前策略版本；后续结果归因不随策略修改。
                </p>
                {!state.jobs.length && <p className="muted">导入岗位后可维护进度。</p>}
                {state.jobs.map((j) => (
                  <div className="record-row" key={j.id}>
                    <BriefcaseBusiness size={18} />
                    <div>
                      <strong>{j.data.title}</strong>
                      <small>{j.data.company}</small>
                    </div>
                    <select
                      aria-label={`${j.data.title} 求职进度`}
                      value={j.data.progress}
                      onChange={(e) =>
                        void run(
                          () => saveJob(j, { ...j.data, progress: e.target.value }),
                          '已记录人工维护的进度；不作为平台自动成功反馈',
                        )
                      }
                    >
                      {Object.entries(PROGRESS).map(([key, label]) => (
                        <option key={key} value={key}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={`${j.data.title} 登记沟通结果`}
                      value=""
                      disabled={busy || !currentStrategy}
                      onChange={(e) => {
                        const kind = e.target.value;
                        if (kind)
                          void run(async () => {
                            await post('/outcomes', {
                              job_id: j.id,
                              strategy_id: currentStrategy?.id,
                              kind,
                            });
                            await refresh();
                          }, '已登记人工报告的结果');
                      }}
                    >
                      <option value="">登记沟通结果…</option>
                      <option value="contact">已在平台首次联系</option>
                      {state.outcomes.some(
                        (o) => o.data.job_id === j.id && o.data.kind === 'contact',
                      ) && (
                        <>
                          <option value="positive">积极回复</option>
                          <option value="negative">拒绝回复</option>
                          <option value="interview">符合条件的面试</option>
                          <option value="offer">Offer</option>
                          <option value="no_reply">观察后确认无回复</option>
                          <option value="unobserved">尚未观察</option>
                        </>
                      )}
                    </select>
                  </div>
                ))}
              </section>
              <section className="panel mt">
                <h2>按首次联系策略统计</h2>
                <p className="helper">{statistics?.note}</p>
                {!statistics?.cohorts?.length && <p>还没有人工登记的首次联系记录。</p>}
                {statistics?.cohorts?.map((c: any) => (
                  <div className="record-row" key={`${c.strategy_id}@${c.strategy_version}`}>
                    <div>
                      <strong>
                        {state.strategies.find((s) => s.id === c.strategy_id)?.data.name ??
                          '历史策略'}{' '}
                        · v{c.strategy_version}
                      </strong>
                      <p>
                        首次联系 {c.contacts} · 积极回复 {c.positive} · 拒绝 {c.negative} · 面试{' '}
                        {c.interview} · 未登记结果 {c.unrecorded}
                      </p>
                      <small>
                        14天观察窗口：已满 {c.window_contacts}，窗口内积极结果 {c.window_positive} /{' '}
                        {c.window_contacts}；尚未满 {c.awaiting_window}
                        。仅展示记录，不宣布策略优胜。
                      </small>
                    </div>
                  </div>
                ))}
              </section>
            </>
          )}

          {page === 'settings' && (
            <>
              <section className="page-heading">
                <div>
                  <div className="eyebrow">LOCAL BY DESIGN</div>
                  <h1>
                    工具为你服务，<span>数据由你掌握。</span>
                  </h1>
                  <p>连接范围、数据去向和验证状态，都在这里。</p>
                </div>
              </section>
              <div className="settings-grid">
                <section className="panel">
                  <div className="panel-heading">
                    <h2>
                      <Link size={18} />
                      浏览器只读连接
                    </h2>
                    <span className="badge pending">实验</span>
                  </div>
                  <p>
                    安装生成的 WXT
                    扩展，在此生成一次性配对码。仅允许采集当前页面，不授予审批或发送权限。
                  </p>
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => void run(async () => setPair(await post('/pairing')))}
                  >
                    <Plus size={15} />
                    生成只读配对码
                  </button>
                  {pair && (
                    <div className="pair-box">
                      <Field label="本地工作台地址">
                        <input readOnly value={location.origin} />
                      </Field>
                      <Field label="一次性配对码（5分钟有效）">
                        <input readOnly value={pair.code} onFocus={(e) => e.target.select()} />
                      </Field>
                      <small>配对码不要发给他人。当前账号识别未验证。</small>
                    </div>
                  )}
                  {state.connections.map((c) => (
                    <div className="record-row" key={c.id}>
                      <div>
                        <strong>{c.label}</strong>
                        <small>只读权限 · {dateLabel(c.created_at)}</small>
                      </div>
                      <button
                        className="text-button danger"
                        onClick={() =>
                          void run(async () => {
                            await request(`/connections/${c.id}`, { method: 'DELETE' });
                            await refresh();
                          }, '只读连接已撤销')
                        }
                      >
                        撤销
                      </button>
                    </div>
                  ))}
                </section>
                <section className="panel">
                  <h2>数据备份与恢复</h2>
                  <p>
                    默认省略原文与证据片段、HR个人信息、聊天、姓名、简历原件和密钥。恢复后需要重新确认，缺失是隐私取舍。
                  </p>
                  <button
                    className="button secondary"
                    onClick={() =>
                      void run(async () =>
                        download(await request('/backup'), 'easyresume-backup.json'),
                      )
                    }
                  >
                    <ArrowDownToLine size={16} />
                    下载脱敏备份
                  </button>
                  <label className="button secondary file-button">
                    <Upload size={16} />
                    预览备份恢复
                    <input
                      type="file"
                      accept=".json"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f)
                          void run(async () => {
                            if (f.size > 10 * 1024 * 1024) throw new Error('备份超过10MB');
                            const data = JSON.parse(await f.text());
                            setPreviewBackup(data);
                            setBackupPreview(await post('/restore/preview', data));
                          });
                      }}
                    />
                  </label>
                </section>
                <section className="panel">
                  <h2>职位 / 公司黑名单</h2>
                  <p className="helper">公司按完整主体名称精确匹配；不会自动扩展到整个集团。</p>
                  {!state.blacklist.length && (
                    <p className="muted">暂无黑名单。在岗位详情中添加。</p>
                  )}
                  {state.blacklist.map((b) => (
                    <div className="record-row" key={b.id}>
                      <div>
                        <strong>{b.data.target === 'company' ? b.data.value : '指定职位'}</strong>
                        <small>{b.data.reason}</small>
                      </div>
                      <button
                        className="text-button"
                        onClick={() =>
                          void run(async () => {
                            await request(`/blacklist/${b.id}`, { method: 'DELETE' });
                            await refresh();
                          }, '已从黑名单恢复')
                        }
                      >
                        恢复
                      </button>
                    </div>
                  ))}
                </section>
                <section className="panel">
                  <h2>功能与真实验证</h2>
                  <ul className="feature-list">
                    <li>
                      <Check size={15} />
                      本地规则、模板与SQLite
                    </li>
                    <li>
                      <CircleHelp size={15} />
                      BOSS读取：实验选择器，待真实采样
                    </li>
                    <li>
                      <LockKeyhole size={15} />
                      平台发送：未开放
                    </li>
                    <li>
                      <LockKeyhole size={15} />
                      云端AI、OCR、工商、地图：后置关闭
                    </li>
                  </ul>
                  <p className="helper">
                    真实60岗位观察、21天复测、用户省时试验与干净Windows验收，均需实际记录证据。
                  </p>
                </section>
              </div>
              <section className="panel mt">
                <h2>第0批观察记录</h2>
                <p>
                  {state.observations.length}{' '}
                  条只读观察。重复观察不代表不同职位。该计数不是准确率或稳定性证明。
                </p>
                <button
                  className="button secondary"
                  onClick={() =>
                    download(
                      {
                        format: 'easyresume-observations',
                        status: 'unverified',
                        sending_verified: false,
                        observations: state.observations.map((o) => ({
                          ...o.data,
                          installation_id: undefined,
                          proposed_job: undefined,
                        })),
                      },
                      'easyresume-observations.json',
                    )
                  }
                >
                  <ArrowDownToLine size={15} />
                  导出采样记录
                </button>
                {state.observations
                  .filter((o) => o.data.proposed_job && o.data.job_id)
                  .map((o) => (
                    <div className="record-row" key={o.id}>
                      <div>
                        <strong>页面出现新版本，等待核对</strong>
                        <small>{o.data.proposed_job.title} · 旧结论继续保留</small>
                      </div>
                      <button
                        className="button secondary"
                        onClick={() => {
                          const job = state.jobs.find((j) => j.id === o.data.job_id);
                          if (!job) return;
                          setSelected(job);
                          setEditingJob(o.data.proposed_job);
                          setReviewObservation(o.id);
                        }}
                      >
                        核对变更
                      </button>
                    </div>
                  ))}
              </section>
            </>
          )}
        </main>
      </div>

      {importOpen && (
        <Modal
          title={importJob ? '核对职位关键字段' : '导入一条职位'}
          onClose={() => setImportOpen(false)}
          wide={!!importJob}
        >
          {!importJob ? (
            <div className="modal-body">
              <p className="muted">
                粘贴职位原文，系统会预填格式明确的要求。无需 AI，也不会自动访问链接。
              </p>
              <Field label="职位描述原文">
                <textarea
                  rows={12}
                  autoFocus
                  value={importText}
                  onChange={(e) => {
                    setImportText(e.target.value);
                    autosaveInput('job', e.target.value);
                  }}
                  placeholder="粘贴学历、经验、薪资、福利和职责描述…"
                />
              </Field>
              <div className="form-actions">
                <button
                  className="button primary"
                  disabled={busy || !importText.trim()}
                  onClick={() =>
                    void run(async () => {
                      const result = await post('/jobs/parse', { text: importText });
                      setImportJob(result.job);
                    }, '预填完成，请核对原文和字段')
                  }
                >
                  <Sparkles size={16} />
                  预填并核对
                </button>
                <button
                  className="button secondary"
                  onClick={() =>
                    void run(async () => {
                      const data = await request('/scratch/job');
                      setImportText(data.text ?? '');
                    }, '已载入本地保存的输入')
                  }
                >
                  恢复未完成输入
                </button>
              </div>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  const result = await post('/jobs', {
                    job: { ...importJob, extraction_checked: true },
                  });
                  setImportOpen(false);
                  setImportJob(null);
                  setImportText('');
                  await post('/scratch', { kind: 'job', text: '' });
                  await refresh();
                  setStatus(
                    result.duplicate
                      ? '这是已存在的职位，未重复创建。请在原记录查看。'
                      : '职位已保存。核对提取不等于待遇已核实。',
                  );
                });
              }}
            >
              <div className="split-editor modal-body">
                <div>
                  <h3>职位原文</h3>
                  <pre className="source-text">{importJob.text}</pre>
                  <div className="info-note">
                    <CircleHelp size={16} />
                    <span>右侧确认的是提取准确性，依据仍为页面声明。</span>
                  </div>
                </div>
                <div>
                  <JobFields job={importJob} setJob={setImportJob} />
                </div>
              </div>
              <div className="modal-footer">
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => setImportJob(null)}
                >
                  返回原文
                </button>
                <button className="button primary" disabled={busy}>
                  <CheckCheck size={16} />
                  已核对提取，保存岗位
                </button>
              </div>
            </form>
          )}
        </Modal>
      )}

      {selected && (
        <Modal
          title={editingJob ? '修改职位提取结果' : '岗位依据与下一步'}
          onClose={() => {
            setSelected(null);
            setEditingJob(null);
            setReviewObservation(null);
          }}
          wide
        >
          <div className="modal-body">
            {editingJob ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void run(async () => {
                    await saveJob(selected, { ...editingJob, extraction_checked: true });
                    setEditingJob(null);
                  }, '提取结果已修正，证据类别未升级');
                }}
              >
                <JobFields job={editingJob} setJob={setEditingJob} />
                <div className="form-actions">
                  <button className="button primary" disabled={busy}>
                    保存修正
                  </button>
                  <button
                    type="button"
                    className="button secondary"
                    onClick={() => {
                      setEditingJob(null);
                      setReviewObservation(null);
                    }}
                  >
                    取消编辑
                  </button>
                </div>
              </form>
            ) : (
              <>
                <div className="detail-title">
                  <Badge group={selected.assessment?.group ?? 'all'} />
                  <h2>{selected.data.title}</h2>
                  <p>
                    {selected.data.company} · {selected.data.city || '地点待核实'}
                  </p>
                  <strong>{salary(selected.data)}</strong>
                </div>
                <div className="detail-actions">
                  <button
                    className="button secondary"
                    onClick={() => setEditingJob(structuredClone(selected.data))}
                  >
                    <ListFilter size={15} />
                    核对 / 修改提取
                  </button>
                  <button
                    className="button secondary"
                    onClick={() =>
                      void run(async () => {
                        await post(`/undo/${selected.id}`);
                        const next = await refresh();
                        setSelected(next.jobs.find((j) => j.id === selected.id) ?? null);
                      }, '已撤销最近一次本地修改')
                    }
                  >
                    <Undo2 size={15} />
                    撤销本地修改
                  </button>
                  {selected.data.source_url && (
                    <a
                      className="button secondary"
                      href={
                        selected.data.source_url.startsWith('https://')
                          ? selected.data.source_url
                          : '#'
                      }
                      target="_blank"
                      rel="noreferrer"
                    >
                      打开平台核对
                      <ArrowUpRight size={14} />
                    </a>
                  )}
                </div>
                <div className="split-editor">
                  <section>
                    <h3>为什么这样分组</h3>
                    {selected.assessment?.matches?.map((m: string) => (
                      <p className="reason-line positive" key={m}>
                        <Check size={15} />
                        {m}
                      </p>
                    ))}
                    {selected.assessment?.reasons?.map((r: any, i: number) => (
                      <p className="reason-line" key={i}>
                        <CircleHelp size={15} />
                        {r.message}
                      </p>
                    ))}
                    {!selected.assessment && <p>请先保存筛选策略。</p>}
                    <h3 className="mt">建议先问清</h3>
                    {selected.assessment?.questions?.map((q: string) => (
                      <p className="question" key={q}>
                        {q}
                      </p>
                    ))}
                    <div className="form-actions">
                      <button
                        className="button primary"
                        disabled={busy || selected.assessment?.group === 'excluded'}
                        onClick={() => void run(() => makeDraft(selected, 'questions'))}
                      >
                        生成核实草稿
                      </button>
                      <button
                        className="button secondary"
                        disabled={busy || selected.assessment?.group === 'excluded'}
                        onClick={() => void run(() => makeDraft(selected, 'greeting'))}
                      >
                        生成招呼草稿
                      </button>
                    </div>
                    <p className="helper">
                      草稿不发送。你可以在平台人工操作；立即沟通可能触发平台预设招呼。
                    </p>
                    <details className="advanced">
                      <summary>查看匹配范围与计算明细</summary>
                      <p>
                        范围 {selected.assessment?.low ?? '—'}–{selected.assessment?.high ?? '—'}
                        ，不是录用概率。
                      </p>
                      {selected.assessment?.dimensions?.map((d: any) => (
                        <div className="dimension" key={d.key}>
                          <span>
                            {d.label}（权重{d.weight}）
                          </span>
                          <b>
                            {Math.round(d.low)}–{Math.round(d.high)}
                          </b>
                          <small>{d.detail}</small>
                        </div>
                      ))}
                      <small>
                        算法 {selected.assessment?.algorithm_version} · 策略版本{' '}
                        {selected.assessment?.snapshot?.strategy_version}
                      </small>
                    </details>
                  </section>
                  <section>
                    <h3>字段依据</h3>
                    {selected.data.evidence.length === 0 && (
                      <p className="muted">暂无片段。备份恢复后的片段缺失属于隐私省略。</p>
                    )}
                    {selected.data.evidence.map((e: any, i: number) => (
                      <blockquote className="evidence" key={i}>
                        <div>
                          <span>
                            {SOURCE[e.source]} · {e.field}
                          </span>
                          <small>{dateLabel(e.observed_at)}</small>
                        </div>
                        <p>{e.snippet || '未保存原文片段'}</p>
                        <small>
                          {e.active === false ? '已撤回 · ' + e.note : '核对提取不代表事实已被证明'}
                        </small>
                        {e.active !== false && (
                          <button
                            className="text-button"
                            onClick={() => {
                              const reason =
                                prompt('为什么撤回这条依据？只影响此岗位，原记录保留。');
                              if (reason?.trim())
                                void run(async () => {
                                  await post(`/jobs/${selected.id}/evidence/${i}/retract`, {
                                    text: reason,
                                  });
                                  const next = await refresh();
                                  setSelected(next.jobs.find((j) => j.id === selected.id) ?? null);
                                }, '已明确撤回依据并重算');
                            }}
                          >
                            撤回此依据
                          </button>
                        )}
                      </blockquote>
                    ))}
                    <details className="advanced">
                      <summary>补充 HR 回答或其他依据</summary>
                      <div className="form-grid">
                        <Field label="字段">
                          <Choice
                            value={evidence.field}
                            onChange={(v) =>
                              setEvidence({
                                ...evidence,
                                field: v,
                                value: v === 'rest' ? 'double' : 'true',
                              })
                            }
                            values={{
                              rest: '休息制度',
                              social: '五险',
                              fund: '公积金',
                              dispatch: '劳务派遣',
                              outsourcing: '外包',
                            }}
                          />
                        </Field>
                        <Field label="回答中的值">
                          <Choice
                            value={evidence.value}
                            onChange={(v) => setEvidence({ ...evidence, value: v })}
                            values={evidence.field === 'rest' ? REST : { true: '是', false: '否' }}
                          />
                        </Field>
                        <Field label="依据来源">
                          <Choice
                            value={evidence.source}
                            onChange={(v) => setEvidence({ ...evidence, source: v })}
                            values={SOURCE}
                          />
                        </Field>
                      </div>
                      <Field label="相关原文片段">
                        <textarea
                          rows={3}
                          value={evidence.snippet}
                          onChange={(e) => setEvidence({ ...evidence, snippet: e.target.value })}
                          placeholder="只录入必要片段，请勿粘贴完整聊天或联系方式"
                        />
                      </Field>
                      <button
                        className="button secondary"
                        disabled={busy || !evidence.snippet.trim()}
                        onClick={() =>
                          void run(async () => {
                            await post(`/jobs/${selected.id}/evidence`, {
                              expected_version: selected.version,
                              evidence: {
                                ...evidence,
                                value:
                                  evidence.field === 'rest'
                                    ? evidence.value
                                    : evidence.value === 'true',
                                observed_at: new Date().toISOString(),
                                extraction_checked: true,
                              },
                            });
                            const data = await refresh();
                            setSelected(data.jobs.find((j) => j.id === selected.id) ?? null);
                          }, '已补充依据。冲突不会被静默覆盖。')
                        }
                      >
                        保存并重新评估
                      </button>
                    </details>
                    <details className="advanced">
                      <summary>查看职位原文</summary>
                      <pre className="source-text">
                        {selected.data.text || '隐私备份未包含原文'}
                      </pre>
                    </details>
                  </section>
                </div>
                <div className="detail-bottom">
                  <button
                    className="text-button"
                    onClick={() =>
                      void run(
                        () =>
                          saveJob(selected, {
                            ...selected.data,
                            progress: selected.data.progress === 'ended' ? 'discovered' : 'ended',
                          }),
                        '已更新归档状态',
                      )
                    }
                  >
                    <FolderArchive size={15} />
                    {selected.data.progress === 'ended' ? '恢复岗位' : '归档岗位'}
                  </button>
                  <button
                    className="text-button danger"
                    onClick={() =>
                      void run(async () => {
                        await post('/blacklist', {
                          target: 'job',
                          value: selected.id,
                          reason: '用户明确排除此职位',
                        });
                        setSelected(null);
                        await refresh();
                      }, '已排除此职位，可在设置中恢复')
                    }
                  >
                    排除此职位
                  </button>
                  <button
                    className="text-button danger"
                    onClick={() => {
                      if (
                        confirm(
                          `将完整主体「${selected.data.company}」加入黑名单？只按精确名称，不扩展集团。`,
                        )
                      )
                        void run(async () => {
                          await post('/blacklist', {
                            target: 'company',
                            value: selected.data.company,
                            reason: '用户明确排除此公司',
                          });
                          setSelected(null);
                          await refresh();
                        }, '公司已加入黑名单，可恢复');
                    }}
                  >
                    拉黑此公司
                  </button>
                </div>
              </>
            )}
          </div>
        </Modal>
      )}

      {draft && (
        <Modal title="沟通草稿 · 尚未发送" onClose={closeDraft}>
          <div className="modal-body">
            <p className="info-note">平台自动发送未开放。请核对对象与正文，再自行到平台操作。</p>
            {draft.data.facts.map((f: string) => (
              <p className="helper" key={f}>
                <Check size={13} />
                {f}
              </p>
            ))}
            <Field label="草稿正文（自动保存到本地）">
              <textarea
                rows={10}
                value={draft.data.content}
                onChange={(e) => {
                  const updated = { ...draft, data: { ...draft.data, content: e.target.value } };
                  setDraft(updated);
                  if (draftTimer.current) clearTimeout(draftTimer.current);
                  draftTimer.current = setTimeout(() => {
                    void saveDraft(updated).catch((e: Error) => setError(e.message));
                  }, 700);
                }}
              />
            </Field>
            <div className="form-actions">
              <button
                className="button primary"
                onClick={() =>
                  void run(async () => {
                    if (draftTimer.current) clearTimeout(draftTimer.current);
                    await saveDraft(draft);
                    await navigator.clipboard.writeText(draft.data.content);
                    await refresh();
                  }, '草稿已保存并复制，尚未发送')
                }
              >
                保存并复制正文
              </button>
              <button className="button secondary" onClick={closeDraft} disabled={busy}>
                继续核对岗位
              </button>
            </div>
          </div>
        </Modal>
      )}

      {backupPreview && (
        <Modal title="恢复前检查" onClose={() => setBackupPreview(null)}>
          <div className="modal-body">
            <p>{backupPreview.warning}</p>
            <pre className="source-text">{JSON.stringify(backupPreview.counts, null, 2)}</pre>
            <p>已省略：{backupPreview.omissions.join('、')}</p>
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await post('/restore', {
                    backup: previewBackup,
                    preview_digest: backupPreview.digest,
                  });
                  setBackupPreview(null);
                  setPair(null);
                  await refresh();
                  setStatus(result.note);
                })
              }
            >
              确认合并脱敏历史
            </button>
          </div>
        </Modal>
      )}
      {relaxPreview && (
        <Modal title="临时放宽预览 · 不修改原策略" onClose={() => setRelaxPreview(null)}>
          <div className="modal-body">
            <p>仅临时取消福利与固定薪资的硬限制，用于理解影响。原策略与事实依据均未改变。</p>
            {relaxPreview.results.map((r: any) => (
              <div className="record-row" key={r.id}>
                <div>
                  <strong>{r.title}</strong>
                  <small>
                    {r.assessment.reasons.map((a: any) => a.message).join('；') || '通过临时条件'}
                  </small>
                </div>
                <Badge group={r.assessment.group} />
              </div>
            ))}
            <button className="button secondary" onClick={() => setRelaxPreview(null)}>
              返回原策略
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
