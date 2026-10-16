import { useState } from 'react';
import { Check, FileText, Plus, Upload } from 'lucide-react';
import { post, request } from './api';
import { AiAssist } from './AiAssist';
import { experienceSummary } from './resumeMath';

const degrees = ['unknown', 'none', '高中', '中专', '大专', '本科', '硕士', '博士'];
const degreeLabel = (value: string) =>
  value === 'unknown' ? '未明确' : value === 'none' ? '无此项' : value;
const monthNow = () =>
  new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
const fieldLabel: Record<string, string> = {
  education_records: '教育经历',
  work_records: '工作经历',
  skill_records: '技能',
};
const sourceLabel: Record<string, string> = {
  resume: '简历原文',
  manual: '手动填写',
  ai: 'AI 建议',
};

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Record<string, string>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="field">
      {label}
      <select
        aria-label={label}
        value={value || 'unknown'}
        onChange={(event) => onChange(event.target.value)}
      >
        {Object.entries(options).map(([id, title]) => (
          <option key={id} value={id}>
            {title}
          </option>
        ))}
      </select>
    </label>
  );
}
function TextField({
  label,
  value,
  onChange,
  date = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  date?: boolean;
}) {
  return (
    <label className="field">
      {label}
      <input
        value={value ?? ''}
        onChange={(event) => onChange(event.target.value)}
        placeholder={date ? 'YYYY-MM 或 YYYY' : ''}
        pattern={date ? '(19|20)[0-9]{2}(-(0[1-9]|1[0-2]))?' : undefined}
      />
    </label>
  );
}
function Evidence({ record }: { record: any }) {
  return record.snippet ? (
    <details className="record-source">
      <summary>查看原文依据 · {sourceLabel[record.source] || '来源未明确'}</summary>
      <pre className="source-text">{record.snippet}</pre>
    </details>
  ) : null;
}

export default function ResumeEditor({
  profile,
  onChange,
  onSave,
  busy,
  ready,
  message,
  onRetry,
  currentStrategy,
  onSettings,
}: {
  profile: any;
  onChange: (profile: any) => void;
  onSave: (profile: any, bind: boolean) => Promise<void>;
  busy: boolean;
  ready: boolean;
  message: string;
  onRetry: () => void;
  currentStrategy?: { data: any };
  onSettings: () => void;
}) {
  const [pending, setPending] = useState<any>(null);
  const [replace, setReplace] = useState<Record<string, boolean>>({});
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [bind, setBind] = useState(false);
  const [sourceOpen, setSourceOpen] = useState(false);
  const [undo, setUndo] = useState<any>(null);
  const structured = profile.schema_version === 2;
  const education = profile.education_records ?? [];
  const work = profile.work_records ?? [];
  const skills = profile.skill_records ?? [];
  const asOf = profile.experience_as_of || monthNow();
  const summary = experienceSummary(work, asOf);
  function change(patch: any) {
    if (Object.hasOwn(patch, 'text') && patch.text !== profile.text) setPending(null);
    setUndo(profile);
    onChange({ ...profile, ...patch });
    setNotice('');
  }
  function setRecord(field: string, index: number, patch: any) {
    change({
      [field]: (profile[field] ?? []).map((record: any, i: number) =>
        i === index
          ? {
              ...record,
              ...patch,
              ...(Object.keys(patch).some((key) => key !== 'confirmed')
                ? { source: 'manual' }
                : {}),
            }
          : record,
      ),
    });
  }
  function addRecord(field: string, defaults: any) {
    if (
      !structured &&
      !window.confirm(
        '将改为按逐条经历计算学历和年限。请补全已有摘要对应的经历；原简历版本会保留。',
      )
    )
      return;
    change({
      schema_version: 2,
      experience_as_of: asOf,
      [field]: [
        ...(profile[field] ?? []),
        {
          id: crypto.randomUUID(),
          source: 'manual',
          snippet: '',
          parser_version: 'manual',
          confirmed: false,
          ...defaults,
        },
      ],
    });
  }
  function offer(result: any) {
    setPending(result);
    setReplace(
      Object.fromEntries(Object.keys(fieldLabel).map((field) => [field, !profile[field]?.length])),
    );
    setNotice('识别完成。已有内容会保留，选择需要采用的部分。');
  }
  async function parse() {
    setProcessing(true);
    setError('');
    try {
      const result = await post('/profiles/parse', { text: profile.text });
      offer({
        ...result.profile,
        review_notes: [...(result.profile.review_notes ?? []), ...(result.warnings ?? [])],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : '识别失败');
    } finally {
      setProcessing(false);
    }
  }
  const disabled = busy || processing || !ready;
  return (
    <div className="resume-flow">
      <section className="panel resume-import">
        <div className="panel-heading">
          <h2>1. 导入简历</h2>
          <span className="muted">DOCX、文本 PDF 或 TXT · 最大 20MB</span>
        </div>
        <div className="action-row">
          <label className="button secondary file-button">
            <Upload size={16} />
            选择简历文件
            <input
              aria-label="上传简历"
              type="file"
              accept=".docx,.pdf,.txt"
              disabled={disabled}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                setProcessing(true);
                setError('');
                const body = new FormData();
                body.append('file', file);
                void request('/profiles/upload', { method: 'POST', body })
                  .then((result: any) =>
                    offer({
                      ...result.profile,
                      name: file.name.replace(/\.[^.]+$/, ''),
                      review_notes: [
                        ...(result.profile.review_notes ?? []),
                        ...(result.warnings ?? []),
                      ],
                    }),
                  )
                  .catch((e: Error) => setError(e.message))
                  .finally(() => setProcessing(false));
              }}
            />
          </label>
          <button type="button" className="text-button" onClick={() => setSourceOpen(!sourceOpen)}>
            {sourceOpen ? '收起原文' : profile.text ? '查看或编辑原文' : '粘贴简历原文'}
          </button>
        </div>
        {sourceOpen && (
          <label className="field">
            简历原文
            <textarea
              rows={10}
              disabled={disabled}
              value={profile.text}
              placeholder="粘贴教育经历、工作经历和技能，或直接填写下方记录。"
              onChange={(event) => change({ text: event.target.value })}
            />
          </label>
        )}
        {profile.text && (
          <div className="action-row">
            <button
              type="button"
              className="button secondary"
              disabled={disabled || !profile.text.trim()}
              onClick={() => void parse()}
            >
              {processing ? '正在识别…' : '重新识别'}
            </button>
            <AiAssist text={profile.text} onSuggestion={offer} onSettings={onSettings} />
          </div>
        )}
        {error && (
          <p role="alert" className="error-inline">
            {error}
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {pending && (
          <section className="suggestion-panel" aria-label="识别建议">
            <h3>检查识别建议</h3>
            <p>仅替换勾选的部分；已有人工修改不会自动覆盖。新建议需再次核对。</p>
            {Object.entries(fieldLabel).map(([field, label]) => (
              <div className="suggestion-section" key={field}>
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={replace[field] || false}
                    onChange={(event) => setReplace({ ...replace, [field]: event.target.checked })}
                  />
                  采用{label}建议（当前 {(profile[field] ?? []).length} 条 → 建议{' '}
                  {(pending[field] ?? []).length} 条）
                </label>
                <ul>
                  {(pending[field] ?? []).map((record: any, index: number) => (
                    <li key={index}>
                      {field === 'education_records'
                        ? `${record.school || '学校未识别'} · ${degreeLabel(record.degree)} · ${record.start_date || '?'} 至 ${record.end_date || record.expected_graduation_date || '?'}`
                        : field === 'work_records'
                          ? `${record.company || '公司未识别'} · ${record.title || '职位未识别'} · ${record.start_date || '?'} 至 ${record.current ? '至今' : record.end_date || '?'}`
                          : `${record.name} · ${{ mentioned: '原文提及', used: '原文明确使用', learning: '学习中', negated: '未掌握 / 否定' }[record.usage as string] || '待检查'}`}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {!!pending.review_notes?.length && (
              <ul className="review-notes">
                {pending.review_notes.map((note: string, i: number) => (
                  <li key={i}>{note}</li>
                ))}
              </ul>
            )}
            <div className="action-row">
              <button
                type="button"
                className="button primary"
                onClick={() => {
                  if (
                    !structured &&
                    Object.values(replace).some(Boolean) &&
                    !window.confirm(
                      '采用后将按逐条经历计算学历和年限。请检查原摘要是否已包含在建议中；原简历版本会保留。',
                    )
                  )
                    return;
                  const fields: any = {};
                  for (const field of Object.keys(fieldLabel))
                    if (replace[field])
                      fields[field] = (pending[field] ?? []).map((record: any) => ({
                        ...record,
                        confirmed: false,
                      }));
                  change({
                    ...fields,
                    ...(Object.keys(fields).length ? { schema_version: 2 } : {}),
                    experience_as_of: asOf,
                    ...(pending.text ? { text: pending.text } : {}),
                    ...(!profile.text && pending.name ? { name: pending.name } : {}),
                    review_notes: pending.review_notes ?? [],
                  });
                  setPending(null);
                  setNotice('已采用所选建议，请检查各条记录。');
                }}
              >
                采用所选建议
              </button>
              <button type="button" className="button secondary" onClick={() => setPending(null)}>
                保留当前内容
              </button>
            </div>
          </section>
        )}
      </section>
      <form
        className="panel resume-review"
        onSubmit={(event) => {
          event.preventDefault();
          setError('');
          void onSave({ ...profile, experience_as_of: asOf }, bind)
            .then(() => setNotice('简历已保存'))
            .catch((e: Error) => setError(e.message));
        }}
      >
        <div className="panel-heading">
          <h2>2. 检查经历</h2>
          <span role="status" className="muted">
            {message}
          </span>
        </div>
        {undo && (
          <button
            type="button"
            className="text-button"
            disabled={busy || !ready}
            onClick={() => {
              onChange(undo);
              setUndo(null);
            }}
          >
            撤销上一步编辑
          </button>
        )}
        {message.includes('未保存') && (
          <button type="button" className="text-button" onClick={onRetry}>
            重试保存草稿
          </button>
        )}
        <fieldset disabled={!ready || busy} className="resume-fieldset">
          <TextField label="简历名称" value={profile.name} onChange={(name) => change({ name })} />
          {!!profile.review_notes?.length && (
            <details className="record-source">
              <summary>识别时的检查提示</summary>
              <ul>
                {profile.review_notes.map((note: string, index: number) => (
                  <li key={index}>{note}</li>
                ))}
              </ul>
            </details>
          )}
          {!structured && (
            <section className="legacy-profile">
              <h3>已有简历摘要</h3>
              <p className="helper">保留此前确认的内容。可继续编辑，或重新识别后检查逐条经历。</p>
              <div className="form-grid">
                <SelectField
                  label="已完成学历"
                  value={profile.education_completed}
                  options={Object.fromEntries(degrees.map((d) => [d, degreeLabel(d)]))}
                  onChange={(education_completed) => change({ education_completed })}
                />
                <SelectField
                  label="在读学历"
                  value={profile.education_current}
                  options={Object.fromEntries(degrees.map((d) => [d, degreeLabel(d)]))}
                  onChange={(education_current) => change({ education_current })}
                />
                <SelectField
                  label="教育形式"
                  value={profile.education_form}
                  options={{ unknown: '未明确', full_time: '全日制', part_time: '非全日制' }}
                  onChange={(education_form) => change({ education_form })}
                />
                <label className="field">
                  毕业 / 预计毕业年份
                  <input
                    type="number"
                    min="1900"
                    max="2099"
                    value={profile.graduation_year ?? ''}
                    onChange={(e) =>
                      change({ graduation_year: e.target.value ? Number(e.target.value) : null })
                    }
                  />
                </label>
                <label className="field">
                  相关工作年限
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    value={profile.experience_years ?? ''}
                    onChange={(e) =>
                      change({ experience_years: e.target.value ? Number(e.target.value) : null })
                    }
                  />
                </label>
                <label className="field">
                  技能（逗号分隔）
                  <input
                    value={(profile.skills ?? []).join(', ')}
                    onChange={(e) =>
                      change({ skills: e.target.value.split(/[,，]/).map((s) => s.trim()) })
                    }
                  />
                </label>
              </div>
            </section>
          )}
          <section className="resume-section">
            <div className="panel-heading">
              <h3>教育经历</h3>
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  addRecord('education_records', {
                    school: '',
                    major: '',
                    degree: 'unknown',
                    education_form: 'unknown',
                    start_date: '',
                    end_date: '',
                    status: 'unknown',
                    expected_graduation_date: '',
                  })
                }
              >
                <Plus size={15} />
                添加教育经历
              </button>
            </div>
            {!education.length && <p className="muted">还没有教育记录，可以手动添加。</p>}
            {education.map((record: any, index: number) => (
              <article className="experience-card" key={record.id}>
                <div className="panel-heading">
                  <h4>{record.school || `教育经历 ${index + 1}`}</h4>
                  <button
                    type="button"
                    className="text-button danger"
                    onClick={() =>
                      change({
                        education_records: education.filter((_: any, i: number) => i !== index),
                      })
                    }
                  >
                    删除此教育经历
                  </button>
                </div>
                <div className="form-grid">
                  <TextField
                    label="学校"
                    value={record.school}
                    onChange={(school) => setRecord('education_records', index, { school })}
                  />
                  <TextField
                    label="专业"
                    value={record.major}
                    onChange={(major) => setRecord('education_records', index, { major })}
                  />
                  <SelectField
                    label="学历"
                    value={record.degree}
                    options={Object.fromEntries(degrees.map((d) => [d, degreeLabel(d)]))}
                    onChange={(degree) => setRecord('education_records', index, { degree })}
                  />
                  <SelectField
                    label="教育形式"
                    value={record.education_form}
                    options={{ unknown: '未明确', full_time: '全日制', part_time: '非全日制' }}
                    onChange={(education_form) =>
                      setRecord('education_records', index, { education_form })
                    }
                  />
                  <TextField
                    label="入学时间"
                    date
                    value={record.start_date}
                    onChange={(start_date) => setRecord('education_records', index, { start_date })}
                  />
                  <TextField
                    label="结束时间"
                    date
                    value={record.end_date}
                    onChange={(end_date) => setRecord('education_records', index, { end_date })}
                  />
                  <SelectField
                    label="就读状态"
                    value={record.status}
                    options={{
                      unknown: '待确认',
                      completed: '已毕业',
                      current: '在读',
                      incomplete: '未完成',
                    }}
                    onChange={(status) => setRecord('education_records', index, { status })}
                  />
                  <TextField
                    label="预计毕业时间"
                    date
                    value={record.expected_graduation_date}
                    onChange={(expected_graduation_date) =>
                      setRecord('education_records', index, { expected_graduation_date })
                    }
                  />
                </div>
                <Evidence record={record} />
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={record.confirmed}
                    onChange={(e) =>
                      setRecord('education_records', index, { confirmed: e.target.checked })
                    }
                  />
                  已核对这段教育经历
                </label>
              </article>
            ))}
          </section>
          <section className="resume-section">
            <div className="panel-heading">
              <h3>工作经历</h3>
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  addRecord('work_records', {
                    company: '',
                    title: '',
                    employment_type: 'unknown',
                    start_date: '',
                    end_date: '',
                    current: false,
                    responsibilities: '',
                  })
                }
              >
                <Plus size={15} />
                添加工作经历
              </button>
            </div>
            <div className="experience-total">
              {summary.months == null
                ? `正式工作年限待确认（已核对 ${Math.floor(summary.known_months / 12)} 年 ${summary.known_months % 12} 个月）`
                : `正式工作约 ${Math.floor(summary.months / 12)} 年 ${summary.months % 12} 个月`}
              {summary.omitted > 0 && <span> · {summary.omitted} 条尚未计入</span>}
              <small>重叠月份只计一次。实习、兼职单列；相关经验在筛选策略中选择。</small>
            </div>
            <label className="field month-field">
              在职经历计算截止月份
              <input
                type="month"
                value={asOf}
                onChange={(e) => change({ experience_as_of: e.target.value })}
              />
            </label>
            {work.map((record: any, index: number) => (
              <article className="experience-card" key={record.id}>
                <div className="panel-heading">
                  <h4>{record.company || `工作经历 ${index + 1}`}</h4>
                  <button
                    type="button"
                    className="text-button danger"
                    onClick={() =>
                      change({
                        work_records: work.filter((_: any, i: number) => i !== index),
                        skill_records: skills.map((skill: any) => ({
                          ...skill,
                          work_record_ids: (skill.work_record_ids ?? []).filter(
                            (id: string) => id !== record.id,
                          ),
                        })),
                      })
                    }
                  >
                    删除此工作经历
                  </button>
                </div>
                <div className="form-grid">
                  <TextField
                    label="公司"
                    value={record.company}
                    onChange={(company) => setRecord('work_records', index, { company })}
                  />
                  <TextField
                    label="职位"
                    value={record.title}
                    onChange={(title) => setRecord('work_records', index, { title })}
                  />
                  <SelectField
                    label="工作类型"
                    value={record.employment_type}
                    options={{
                      unknown: '待确认',
                      full_time: '正式工作',
                      internship: '实习',
                      part_time: '兼职',
                    }}
                    onChange={(employment_type) =>
                      setRecord('work_records', index, { employment_type })
                    }
                  />
                  <TextField
                    label="入职时间"
                    date
                    value={record.start_date}
                    onChange={(start_date) => setRecord('work_records', index, { start_date })}
                  />
                  <TextField
                    label="结束时间"
                    date
                    value={record.end_date}
                    onChange={(end_date) => setRecord('work_records', index, { end_date })}
                  />
                  <label className="check-line">
                    <input
                      type="checkbox"
                      checked={record.current}
                      onChange={(e) =>
                        setRecord('work_records', index, { current: e.target.checked })
                      }
                    />
                    仍在职
                  </label>
                </div>
                {summary.excluded.find((item) => item.id === record.id) && (
                  <p className="helper">
                    尚未计入：{summary.excluded.find((item) => item.id === record.id)?.reason}
                  </p>
                )}
                <label className="field">
                  主要职责
                  <textarea
                    rows={3}
                    value={record.responsibilities || ''}
                    onChange={(e) =>
                      setRecord('work_records', index, { responsibilities: e.target.value })
                    }
                  />
                </label>
                <Evidence record={record} />
                <label className="check-line">
                  <input
                    type="checkbox"
                    checked={record.confirmed}
                    onChange={(e) =>
                      setRecord('work_records', index, { confirmed: e.target.checked })
                    }
                  />
                  已核对这段工作经历
                </label>
              </article>
            ))}
          </section>
          <section className="resume-section">
            <div className="panel-heading">
              <h3>技能</h3>
              <button
                type="button"
                className="text-button"
                onClick={() =>
                  addRecord('skill_records', {
                    name: '',
                    category: '其他',
                    work_record_ids: [],
                    usage: 'mentioned',
                  })
                }
              >
                <Plus size={15} />
                添加技能
              </button>
            </div>
            {!skills.length && (
              <p className="muted">填写具体工具或能力，例如 Linux、Citrix、网络故障排查。</p>
            )}
            {skills.map((record: any, index: number) => (
              <article className="experience-card skill-card" key={record.id}>
                <div className="form-grid">
                  <TextField
                    label="技能名称"
                    value={record.name}
                    onChange={(name) => setRecord('skill_records', index, { name })}
                  />
                  <TextField
                    label="技能分类"
                    value={record.category}
                    onChange={(category) => setRecord('skill_records', index, { category })}
                  />
                  <SelectField
                    label="使用状态"
                    value={record.usage}
                    options={{
                      mentioned: '原文提及，待说明',
                      used: '有使用经历',
                      learning: '学习中',
                      negated: '未掌握 / 不适用',
                    }}
                    onChange={(usage) => setRecord('skill_records', index, { usage })}
                  />
                </div>
                {!!work.length && (
                  <details>
                    <summary>关联工作经历</summary>
                    {work.map((job: any) => (
                      <label className="check-line" key={job.id}>
                        <input
                          type="checkbox"
                          checked={(record.work_record_ids ?? []).includes(job.id)}
                          onChange={(e) =>
                            setRecord('skill_records', index, {
                              work_record_ids: e.target.checked
                                ? [...(record.work_record_ids ?? []), job.id]
                                : (record.work_record_ids ?? []).filter(
                                    (id: string) => id !== job.id,
                                  ),
                            })
                          }
                        />
                        {job.company || '未填写公司'} · {job.title || '未填写职位'}
                      </label>
                    ))}
                  </details>
                )}
                <Evidence record={record} />
                <div className="action-row">
                  <label className="check-line">
                    <input
                      type="checkbox"
                      checked={record.confirmed}
                      onChange={(e) =>
                        setRecord('skill_records', index, { confirmed: e.target.checked })
                      }
                    />
                    已核对此技能
                  </label>
                  <button
                    type="button"
                    className="text-button danger"
                    onClick={() =>
                      change({ skill_records: skills.filter((_: any, i: number) => i !== index) })
                    }
                  >
                    删除此技能
                  </button>
                </div>
              </article>
            ))}
          </section>
          <div className="resume-save">
            <h3>3. 保存简历版本</h3>
            {currentStrategy && (
              <label className="check-line">
                <input type="checkbox" checked={bind} onChange={(e) => setBind(e.target.checked)} />
                同时用于当前筛选策略「{currentStrategy.data.name}」
              </label>
            )}
            <p className="helper">未核对的经历保留为待检查，不参与资格判断。</p>
            <button className="button primary" disabled={disabled}>
              <Check size={16} />
              保存简历版本
            </button>
          </div>
        </fieldset>
      </form>
    </div>
  );
}
