export const SCHEMA = 1;
export const RULE_VERSION = 'scu-cs-2025-planning-20261110-v1';
export const uid = () => crypto.randomUUID();
export const clone = value => structuredClone(value);
export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const isoNow = () => new Date().toISOString();
export const fmt = n => Number(n || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });
export const normalize = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
export const eventKey = r => normalize(r.linkId || `${r.name}|${r.date}`);
export const paperKey = r => normalize(r.fields?.workId || r.linkId || r.name);
export const isDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
export const nowYear = () => {
  const d = new Date();
  const y = d.getFullYear() - (d.getMonth() < 8 ? 1 : 0);
  return `${y}-${y + 1}`;
};
export const DEFAULT_POLICIES = Object.freeze({
  formula: 'direct', moralQuant: 'cap35', meetFloor: true,
  teamCoefficients: 'multiply', contestPools: 'separate',
  mutual: 'same-event', artRole: 'highest', training: 'highest',
  paperCategory: 'highest', projectCoefficients: 'multiply', projectTie: 'highest-score',
  csp: 'highest', rewards: 'nominal100', hours: 'exact'
});
export const POLICY_NOTES = [
  ['formula', '直接乘权', '原始基础/发展分直接乘手册公式，不另做百分制折算。', '第3、8—9、14、16、18页', '用户方向及原文公式'],
  ['moralQuant', '德育定量封顶35', '八项均可记录，合计封顶35。', '第5页', '用户方向；解决35与40的冲突'],
  ['meetFloor', '校运会负分归零', '前16名按6−0.5×(名次−1)，最低0；团体再减半。', '第15页', '个人规划修正，非原文明确下限'],
  ['teamCoefficients', '团体系数相乘', '非三大国家级团体，排名比例×角色/奖项比例。', '第11页', '个人规划口径，原文关系不明确'],
  ['contestPools', '赛事两组分别取最高', '三大赛事与其他赛事各取最高，再合计封顶30。', '第10—11页', '个人规划口径，跨组范围不明确'],
  ['mutual', '同一活动跨板块互斥', '按关联活动ID识别同一事实；冲突时须选择申报归属，不同时计分。', '第19页', '规划解释，可切换整项互斥'],
  ['artRole', '同场美育活动取最高身份', '同场参演、参加、出席只取最高一档；不同活动正常累计。', '第16页', '防重复的个人规划解释'],
  ['training', '培训不累计，取最高', '团校/积极分子培训/党校结业在该项内取最高。', '第8页', '个人规划解释'],
  ['paperCategory', '同篇论文只取最高类别', '同一论文同学年多标签取一档最高；不能跨学年重复使用。', '第11—12页', '同年分类为规划解释；跨年禁用为原文规则'],
  ['projectCoefficients', '大创两个系数相乘', '非本院负责人折算×本人负责人/成员折算；先取最高级别，同级取较高分。', '第12—13页', '叠乘及同级取分为规划解释'],
  ['csp', 'CSP多次取最高', '年度多次成绩只取一档最高，本项封顶10。', '第13页', '个人规划解释'],
  ['rewards', '奖励按认定分，上限10', '仅计学院已认定奖励；以五育百分制上限100的10%作通常上限，不自动赠分。', '第8、13、15—17、19页', '10%基数为规划解释，可改待核定'],
  ['hours', '服务小时不取整', '以实际小时小数计1小时1分，累计封顶15。', '第19页', '个人规划解释，可改待核定']
];
export function newState() {
  const year = nowYear();
  const y = Number(year.slice(0, 4));
  return { schemaVersion: SCHEMA, ruleVersion: RULE_VERSION, id: uid(), revision: uid(), updatedAt: isoNow(),
    settings: { year, grade: '', startDate: `${y}-09-01`, endDate: `${y + 1}-08-31`, rangeConfirmed: false,
      academicMisconduct: 'unknown', conductViolation: 'unknown', hygieneFailures: null,
      policies: { ...DEFAULT_POLICIES }, policyAcknowledged: false, maxImageMB: 40 }, records: [] };
}
export function validateState(state, ruleIds) {
  if (!state || typeof state !== 'object' || state.schemaVersion !== SCHEMA) throw new Error('资料格式版本不受支持');
  if (state.ruleVersion !== RULE_VERSION) throw new Error('规则版本不同，请先使用对应版本应用核对，避免错误重算');
  for (const key of ['id', 'revision', 'updatedAt']) if (typeof state[key] !== 'string' || !state[key] || state[key].length > 200) throw new Error('资料标识不完整');
  const s = state.settings;
  if (!s || !/^20\d{2}-20\d{2}$/.test(s.year || '') || Number(s.year.slice(5)) !== Number(s.year.slice(0, 4)) + 1) throw new Error('参评学年格式错误');
  if (!isDate(s.startDate) || !isDate(s.endDate) || s.startDate > s.endDate) throw new Error('参评起止日期错误');
  if (!['', '1', '2', '3', '4'].includes(String(s.grade ?? ''))) throw new Error('年级错误');
  if (!s.policies || Object.keys(DEFAULT_POLICIES).some(k => !(k in s.policies))) throw new Error('规划口径不完整');
  const allowed = { formula: ['direct','normalized'], moralQuant: ['cap35'], meetFloor: [true], teamCoefficients: ['multiply','override'], contestPools: ['separate','one'], mutual: ['same-event','whole-item'], artRole: ['highest'], training: ['highest'], paperCategory: ['highest'], projectCoefficients: ['multiply'], projectTie: ['highest-score'], csp: ['highest'], rewards: ['nominal100','pending'], hours: ['exact','pending'] };
  for (const [key, values] of Object.entries(allowed)) if (!values.includes(s.policies[key])) throw new Error(`不受支持的规划口径：${key}`);
  if (!['unknown','yes','no'].includes(s.academicMisconduct) || !['unknown','yes','no'].includes(s.conductViolation)) throw new Error('年度状态错误');
  if (s.hygieneFailures !== null && (!Number.isInteger(s.hygieneFailures) || s.hygieneFailures < 0 || s.hygieneFailures > 10000)) throw new Error('卫生不合格次数错误');
  if (!Array.isArray(state.records) || state.records.length > 20000) throw new Error('记录数量无效或超过20000条限制');
  const ids = new Set();
  for (const r of state.records) {
    if (!r || typeof r.id !== 'string' || !/^[a-zA-Z0-9_-]{8,80}$/.test(r.id) || ids.has(r.id)) throw new Error('记录标识重复或无效');
    ids.add(r.id);
    if (ruleIds && !ruleIds.has(r.ruleId)) throw new Error(`未知细则：${r.ruleId}`);
    if (typeof r.name !== 'string' || !r.name.trim() || r.name.length > 200 || !isDate(r.date)) throw new Error('活动名称或日期错误');
    if (!/^20\d{2}-20\d{2}$/.test(r.year || '') || Number(r.year.slice(5)) !== Number(r.year.slice(0, 4)) + 1) throw new Error('记录学年错误');
    if (!Number.isInteger(r.count) || r.count < 1 || r.count > 100000) throw new Error('参与次数须为正整数');
    if (typeof r.linkId !== 'string' || r.linkId.length > 300 || typeof r.notes !== 'string' || r.notes.length > 5000) throw new Error('备注或关联标识错误');
    if (!r.fields || typeof r.fields !== 'object' || Array.isArray(r.fields) || JSON.stringify(r.fields).length > 12000) throw new Error('计分字段无效');
    if (!Array.isArray(r.evidence) || r.evidence.length > 100) throw new Error('照片列表无效');
    for (const id of r.evidence) if (!/^[a-zA-Z0-9_-]{8,80}$/.test(id)) throw new Error('照片标识无效');
    if (!['auto','selected','excluded','pending'].includes(r.claim || 'auto')) throw new Error('申报归属无效');
  }
  return state;
}
export function revise(state) {
  state.revision = uid();
  state.updatedAt = isoNow();
  return state;
}
export async function digest(blob) {
  const bytes = blob instanceof Blob ? await blob.arrayBuffer() : blob;
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
export const IMAGE_TYPES = new Map([['image/jpeg','jpg'],['image/png','png'],['image/webp','webp'],['image/gif','gif'],['image/heic','heic'],['image/heif','heif'],['image/avif','avif'],['image/bmp','bmp']]);
export async function createEvidence(file, maxMB = 40) {
  let mime = file.type.toLowerCase();
  if (!IMAGE_TYPES.has(mime)) {
    const extension = file.name?.split('.').pop().toLowerCase();
    mime = [...IMAGE_TYPES].find(([, ext]) => ext === extension || ext === 'jpg' && extension === 'jpeg')?.[0];
  }
  if (!IMAGE_TYPES.has(mime) || !file.size || file.size > maxMB * 1024 * 1024) throw new Error(`请选择支持的图片，单张不超过${maxMB}MB`);
  const blob = new Blob([file], { type: mime });
  return { id: uid(), name: String(file.name || '相机照片').slice(0, 200), mime, ext: IMAGE_TYPES.get(mime), size: blob.size, sha256: await digest(blob), blob, createdAt: isoNow() };
}
