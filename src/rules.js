export const BOARDS = [
  { id:'D', name:'德育评价', short:'德', subtitle:'理想信念 · 责任担当', weight:.5, baseWeight:.7, developWeight:.3, color:'#4e765b', baseCap:70, developCap:30 },
  { id:'Z', name:'智育评价', short:'智', subtitle:'学术探索 · 创新成长', weight:.2, baseWeight:.7, developWeight:.3, color:'#597ca8', baseCap:70, developCap:30 },
  { id:'T', name:'体育评价', short:'体', subtitle:'日常锻炼 · 体质健康', weight:.1, baseWeight:.8, developWeight:.2, color:'#bb7b4d', baseCap:80, developCap:20 },
  { id:'M', name:'美育评价', short:'美', subtitle:'艺术体验 · 审美表达', weight:.1, baseWeight:.8, developWeight:.2, color:'#92719b', baseCap:80, developCap:20 },
  { id:'L', name:'劳育评价', short:'劳', subtitle:'劳动实践 · 志愿服务', weight:.1, baseWeight:.8, developWeight:.2, color:'#698c89', baseCap:80, developCap:20 }
];
export const GROUPS = {
  dQual:{name:'基础 · 民主评议',stage:'base',cap:35}, dQuant:{name:'基础 · 定量完成',stage:'base',cap:35},
  dHonor:{name:'发展 · 荣誉与获奖',stage:'develop',cap:10},dContrib:{name:'发展 · 集体奉献',stage:'develop',cap:10},dPractice:{name:'发展 · 德育实践',stage:'develop',cap:10},
  zBase:{name:'基础性评价',stage:'base',cap:70},zMajor:{name:'发展 · 三大赛事',stage:'develop',cap:30},zOther:{name:'发展 · 其他学科竞赛',stage:'develop',cap:30},zAcademic:{name:'发展 · 论文与大创项目',stage:'develop',cap:30},zInvention:{name:'发展 · 发明创造',stage:'develop',cap:10},zCsp:{name:'发展 · CSP',stage:'develop',cap:10},
  tBase:{name:'基础性评价',stage:'base',cap:80},tFitness:{name:'发展 · 体测等级',stage:'develop',cap:5},tSkill:{name:'发展 · 体育技能',stage:'develop',cap:5},tContest:{name:'发展 · 竞赛与代表队',stage:'develop',cap:10},
  mBase:{name:'基础 · 文化艺术活动',stage:'base',cap:80},mCourse:{name:'发展 · 美育课程',stage:'develop',cap:10},mContest:{name:'发展 · 文艺竞赛与艺术团',stage:'develop',cap:10},
  lDaily:{name:'基础 · 日常生活劳动',stage:'base',cap:60},lSecond:{name:'基础 · 第二课堂劳动',stage:'base',cap:20},lService:{name:'发展 · 服务性劳动',stage:'develop',cap:15},lProduction:{name:'发展 · 生产劳动',stage:'develop',cap:5}
};
for (const b of BOARDS) GROUPS[`${b.id.toLowerCase()}Reward`] = {name:'奖励性评价 · 须学院认定',stage:'reward',cap:10};
export async function loadRules() {
  const response = await fetch(new URL('./rules-data.json', import.meta.url));
  if (!response.ok) throw new Error('规则文件读取失败，请刷新或检查离线缓存');
  return response.json();
}
export const sourceUrl = page => new URL(`../资料/综测_原始依据.pdf#page=${Number(page)}`, import.meta.url).href;
