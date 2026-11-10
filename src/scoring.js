import { eventKey, paperKey, normalize } from './model.js';
import { BOARDS, GROUPS } from './rules.js';

const total = values => values.reduce((s, x) => s + x, 0);
const clamp = (n, cap = Infinity) => Math.min(cap ?? Infinity, Math.max(0, n));
const finite = value => value !== '' && value !== undefined && value !== null && Number.isFinite(Number(value));
const later = (a,b) => `${b.record.date}|${b.record.updatedAt || ''}|${b.record.id}`.localeCompare(`${a.record.date}|${a.record.updatedAt || ''}|${a.record.id}`);
const levelOrder = {national:4, province:3, school:2, college:1};

function evaluate(record, rule, state) {
  const f = record.fields || {};
  const out = { record, rule, value:0, contribution:0, active:true, pending:[], notes:[], units:record.count, priority:0 };
  const note = s => out.notes.push(s);
  const pending = s => { out.pending.push(s); out.active=false; };
  const choice = (key,label,options=['yes','no']) => {
    if (!options.includes(f[key])) { pending(`请确认${label}`); return null; }
    return f[key];
  };
  const number = (key,label,min=0,max=100000) => {
    if (!finite(f[key]) || Number(f[key]) < min || Number(f[key]) > max) { pending(`${label}缺失或超范围`); return null; }
    if(key==='rank'&&!Number.isInteger(Number(f[key]))){pending(`${label}须为整数`);return null;}
    return Number(f[key]);
  };
  const recognized = (max=10,min=0) => {
    if (choice('recognized','学院认定状态') !== 'yes') { pending('尚未获得学院认定分，不自动加分'); return 0; }
    if (!String(f.recognitionNote || '').trim()) { pending('请填写认定依据/通知说明'); return 0; }
    return number('recognizedScore','学院认定分',min,max) || 0;
  };
  if (record.claim === 'excluded') { out.active=false; note('已手动选择不申报'); return out; }
  if (record.claim === 'pending') { pending('用户标记待核定'); return out; }
  const settings = state.settings;
  if (settings.rangeConfirmed && (record.date < settings.startDate || record.date > settings.endDate)) {
    out.active=false; note('日期不在本学年设置的参评区间内'); return out;
  }
  if (rule.cutoff) {
    const cutoff = `${Number(record.year.slice(5))}-08-31`;
    if (record.date > cutoff) { out.active=false; note(`超过原文统计截止日${cutoff}`); return out; }
  }
  if (rule.kind === 'unknown') { pending('手册未列此类具体分值，保留材料待认定'); return out; }
  switch (rule.kind) {
    case 'threshold': out.value = record.count; break;
    case 'perCount': out.value = rule.points * record.count; break;
    case 'binary': {
      const status=choice('done','完成/达标状态');
      if (rule.id==='Z-B05' && status==='no') note('不符合学术诚信，智育整体按0分处理');
      out.value=status==='yes'?rule.points:0;
      break;
    }
    case 'qualitative': {
      const a=number('counselor','辅导员评分',0,rule.cap),b=number('classScore','班级评分',0,rule.cap),c=number('selfScore','自评分',0,rule.cap);
      out.value=(a||0)*.3+(b||0)*.5+(c||0)*.2;
      break;
    }
    case 'policyCourses': {
      if (!['1','2','3','4'].includes(String(settings.grade))) { pending('请先在设置中选择年级'); break; }
      const policy=choice('policyPass','形势与政策合格并获学分');
      if (String(settings.grade)==='1') {
        const theory=choice('theoryPass','军事理论合格并获学分');
        const skills=choice('skillsStatus','军事技能状态',['pass','exempt','fail']);
        out.value=policy==='yes'&&theory==='yes'&&['pass','exempt'].includes(skills)?5:0;
      } else out.value=policy==='yes'?5:0;
      break;
    }
    case 'honorRole': {
      const role=choice('role','集体荣誉中的身份',['member','committee','leader']);
      out.value=(rule.id==='D-H08'?{member:3,committee:4,leader:6}:{member:1,committee:1,leader:2})[role]||0;
      out.value*=record.count;
      break;
    }
    case 'position': {
      if (['D-C02','D-C03','D-C04'].includes(rule.id)) {
        const role=choice('position','正/副职',['chief','deputy']);
        out.value=role==='chief'?rule.points:rule.id==='D-C02'?4:2;
      } else out.value=rule.points;
      break;
    }
    case 'assessment': {
      const status=choice('assessment','任职考核',['excellent','pass','fail']);
      if (['D-C10','D-C11'].includes(rule.id) && choice('fullYear','任职满一年')!=='yes') { note('任职未满一年，不满足原文条件'); out.value=0; break; }
      out.value=status==='excellent'?rule.excellent:status==='pass'?rule.passScore:0;
      break;
    }
    case 'recognized': out.value=recognized(rule.cap,rule.minimum||0); break;
    case 'moralPractice': {
      out.value=record.count;
      if (finite(f.extraScore) && Number(f.extraScore)>0) {
        if (choice('extraRecognized','额外获奖加分已核定')==='yes' && String(f.recognitionNote||'').trim()) out.value+=Number(f.extraScore);
        else pending('支教/实践额外获奖分值缺乏认定依据');
      }
      break;
    }
    case 'training': {
      const kind=choice('training','培训类别',['league','activist','party']);
      out.value=choice('done','已结业')==='yes'?(kind==='party'?2:1):0;
      break;
    }
    case 'enlist': {
      const kind=choice('enlistType','入伍/国际组织实习',['enlist','international']);
      if(kind==='international') out.value=(number('months','国际组织实习月数',0,120)||0)>=3?5:0;
      else out.value=kind==='enlist'?5:0;
      break;
    }
    case 'attendance': out.value=choice('noAbsence','当学年无无故旷课')==='yes'?20:0; break;
    case 'majorContest': {
      const rank=number('rank','团队成员排名',1,10000);
      if (choice('recognizedContest','赛事及奖项受认可')!=='yes') { note('赛事未确认受认可'); break; }
      if (!String(f.edition||'').trim()) pending('请填写同届同项竞赛标识');
      const a=rule.award;
      if (rule.tier==='national') out.value=[[30,15,10],[25,12,8],[20,10,6]][a][rank<=5?0:rank<=10?1:2];
      else {
        if(rank>10) {pending('省级第11名起未列分值');break;}
        out.value=[[20,10],[18,9],[16,8]][a][rank<=5?0:1];
        if (choice('outsideLead','项目负责人是否非本学院')==='yes') out.value*=.5;
      }
      out.priority=levelOrder[rule.tier]*100+3-a;
      break;
    }
    case 'otherContest': {
      const tier=choice('tier','竞赛级别',rule.contestType==='school'?['national','province']:['national','province','school','college']);
      if (choice('recognizedContest','赛事及奖项受认可')!=='yes') { note('赛事未确认受认可'); break; }
      if (!String(f.edition||'').trim()) pending('请填写同届同项竞赛标识');
      const a=rule.award;
      out.value=rule.contestType==='school'?({national:[25,20,15],province:[8,6,4]}[tier]?.[a]||0):({national:[15,12,9],province:[4,3,2],school:[3,2,1],college:[3,2,1]}[tier]?.[a]||0);
      if(choice('team','个人/团体',['individual','team'])==='team') {
        const rank=number('rank','团队成员排名',1,10000);
        const rankCoefficient=rank<=5?1:rank<=10?.5:.3;
        const role=choice('role','本人角色',['leader','member']);
        const roleCoefficient=tier==='national'?(a===0||role==='leader'?1:.8):1;
        out.value*=state.settings.policies.teamCoefficients==='override'&&tier==='national'?roleCoefficient:rankCoefficient*roleCoefficient;
        note(`团体折算：排名${rankCoefficient} × 角色${roleCoefficient}（规划口径）`);
      }
      out.priority=(levelOrder[tier]||0)*100+3-a;
      break;
    }
    case 'paper': {
      if (!String(f.workId||'').trim()) pending('请填写论文稳定标识（DOI或完整题名）');
      for (const [key,label] of [['professional','论文与专业相关'],['firstAuthor','本人为第一作者'],['schoolFirst','四川大学为第一单位'],['collegeTeacher','本院教师指导'],['accepted','已录用']]) {
        if (choice(key,label)!=='yes') { note(`${label}条件不满足或未确认`); return out; }
      }
      if (choice('warned','是否预警期刊')==='yes') {note('预警期刊不计分');break;}
      if (choice('usedBefore','是否已在其他学年认定')==='yes') {note('同一论文不得跨学年重复');break;}
      const type=choice('paperType','论文类型',['regular','supplement','demo','workshop']);
      const co=number('coFirst','共同第一作者人数',1,1000);
      if (!Number.isInteger(co)) pending('共同第一人数须为整数');
      if((type==='workshop'||rule.id==='Z-A06')&&choice('eiReport','有EI检索报告')!=='yes'){note('需EI检索报告');break;}
      out.value=(type==='workshop'?6:rule.points)*(type==='supplement'||type==='demo'?.5:1)/(co||1);
      break;
    }
    case 'project': {
      if(!String(f.workId||'').trim()) pending('请填写项目编号/稳定标识');
      const status=choice('assessment','正常结题状态',['excellent','pass','unfinished','terminated']);
      if(['unfinished','terminated'].includes(status)){note('尚未正常结题或中止，不计分');break;}
      if(choice('scuProject','四川大学立项')!=='yes'){note('立项单位条件未满足');break;}
      const role=choice('role','本人角色',['leader','member']);
      const outside=choice('outsideLead','项目负责人是否非本学院');
      out.value=(status==='excellent'?rule.excellent:rule.passScore)*(role==='leader'?1:.5)*(outside==='yes'?.5:1);
      out.priority=rule.level;
      break;
    }
    case 'patent': {
      const rank=number('rank','专利署名排名',1,10000);
      if(!String(f.workId||'').trim()) pending('请填写授权专利号');
      for(const [k,l] of [['authorized','已取得发明专利授权'],['professional','内容与专业相关'],['scuOwner','材料符合“授权人必须为四川大学”']]) if(choice(k,l)!=='yes'){note(`${l}条件未满足`);return out;}
      out.value=rank===1?10:rank<=3?1:0;
      break;
    }
    case 'csp': {
      const score=number('score','CSP成绩',0,500);
      out.value=score>=400?10:score>=300?5:0;
      break;
    }
    case 'fitnessBasic': {
      const status=choice('fitness','体测结果',['pass','good','excellent','exempt','fail']);
      out.value=status&&status!=='fail'?40:0;
      break;
    }
    case 'fitnessGrade': {
      const status=choice('fitness','体测结果',['pass','good','excellent','exempt','fail']);
      if(status==='exempt') pending('免测仅明确基础按合格，发展等级待认定');
      out.value=status==='excellent'?5:status==='good'?3:0;
      break;
    }
    case 'sportSkill': out.value=(number('score','体育课/通识课成绩',0,100)||0)>=85?5:0; break;
    case 'sportContest': case 'artContest': {
      if(!String(f.edition||'').trim())pending('请填写同届比赛标识');
      const award=choice('award','获奖档次',['first','second','third','lower','none']);
      const team=choice('team','个人/团体',['individual','team'])==='team';
      const ix=['first','second','third','lower','none'].indexOf(award);
      const tables=team?{national:[5,5,5,3,0],province:[4,4,4,2,0],school:[3,2,1,0,0],college:[2,1,.5,0,0]}:{national:[10,10,10,8,0],province:[9,9,9,7,0],school:[6,4,2,1,0],college:[4,2,1,0,0]};
      out.value=tables[rule.tier][ix]||0;
      out.priority=levelOrder[rule.tier]*100+5-ix;
      break;
    }
    case 'schoolMeet': {
      const rank=number('rank','校运会名次',1,10000);
      const team=choice('team','个人/团体',['individual','team'])==='team';
      if(choice('officialMeet','校级运动会且非趣味运动会')!=='yes'){note('不属于该项适用赛事');break;}
      if(!String(f.edition||'').trim())pending('请填写同届比赛标识');
      out.value=rank<=16?Math.max(0,6-(rank-1)*.5)*(team?.5:1):0;
      out.priority=200+20-rank;
      break;
    }
    case 'artActivity': out.value=rule.points*record.count; break;
    case 'artCourse': {
      if(choice('passed','课程合格')!=='yes'){note('课程不合格');break;}
      if(choice('recognizedCourse','属于学校认定美育课程')!=='yes'){note('美育课程认可状态未确认');break;}
      out.value=number('credits','已完成学分',0,100)||0;
      break;
    }
    case 'dorm': {
      if(choice('recognized50','已由学院核定为50分制检查得分/年度分')!=='yes'){pending('缺少宿舍检查方案，须确认50分制得分，不自行折算');break;}
      out.value=number('score','宿舍卫生50分制得分',0,50)||0;
      break;
    }
    case 'service': {
      if(state.settings.policies.hours==='pending') {pending('服务小时精度口径待核定');break;}
      out.value=number('hours','实际累计服务小时',0,100000)||0;
      break;
    }
    case 'reward': {
      if (state.settings.policies.rewards==='pending') {pending('奖励10%基数待核定');break;}
      out.value=recognized(10);
      break;
    }
    default: pending('未实现的规则类型，已阻止错误计分');
  }
  if(!Number.isFinite(out.value)){out.value=0;pending('无法计算的数值');}
  out.value=Math.max(0,out.value);
  return out;
}

function drop(row,reason) { row.active=false; row.contribution=0; row.notes.push(reason); }
function keepBest(rows,key,compare,reason) {
  const groups=new Map();
  for(const row of rows.filter(x=>x.active)) {
    const k=key(row);
    if(!groups.has(k))groups.set(k,[]);
    groups.get(k).push(row);
  }
  for(const list of groups.values()) {
    list.sort(compare);
    for(const row of list.slice(1))drop(row,reason);
  }
}
const highest=(a,b)=>b.value-a.value||later(a,b);

export function score(state,rules) {
  const ruleMap=new Map(rules.map(r=>[r.id,r]));
  const rows=state.records.filter(r=>r.year===state.settings.year&&ruleMap.has(r.ruleId)).map(r=>evaluate(r,ruleMap.get(r.ruleId),state));
  const notes=[];
  const active=predicate=>rows.filter(x=>x.active&&predicate(x));
  const policy=state.settings.policies;
  // 同一细则、同一事实保留最后一次输入；批量次数是该事实记录的汇总次数。
  keepBest(rows,x=>`${x.rule.id}:${eventKey(x.record)}`,later,'同一细则、同一活动重复记录，保留最近一次');
  // 同一届同项竞赛先按最高奖项去重，再按所处竞赛池取最高分。
  for(const board of ['Z','T','M']) {
    const candidates=rows.filter(x=>x.rule.board===board&&['majorContest','otherContest','sportContest','artContest','schoolMeet'].includes(x.rule.kind));
    keepBest(candidates,x=>normalize(x.record.fields.edition||x.record.linkId||x.record.name),(a,b)=>b.priority-a.priority||highest(a,b),'同一届同项/同届比赛保留最高奖项');
  }
  keepBest(rows.filter(x=>x.rule.kind==='artActivity'),x=>eventKey(x.record),highest,'同场美育活动按最高身份取一档（规划口径）');
  keepBest(rows.filter(x=>x.rule.kind==='paper'),x=>paperKey(x.record),highest,'同篇论文同年只取一个最高类别（规划口径）');
  for(const row of active(x=>x.rule.kind==='paper')) {
    const earlier=state.records.find(r=>ruleMap.get(r.ruleId)?.kind==='paper'&&r.year<row.record.year&&paperKey(r)===paperKey(row.record)&&r.claim!=='excluded');
    if(earlier)drop(row,`同篇论文已记录于${earlier.year}，禁止跨学年重复；如旧记录未申报请标为“不申报”`);
  }
  keepBest(rows.filter(x=>x.rule.kind==='project'),x=>normalize(x.record.fields.workId),highest,'同一大创项目不重复计分');
  const projects=active(x=>x.rule.kind==='project'&&x.value>0).sort((a,b)=>b.rule.level-a.rule.level||highest(a,b));
  for(const row of projects.slice(1))drop(row,'同年度大创仅认定最高级别项目一次；同级取较高规划分');
  keepBest(rows.filter(x=>x.rule.kind==='patent'),x=>normalize(x.record.fields.workId),highest,'同一授权专利不重复计分');

  // 原文明示的跨板块互斥。未选归属时两边均待核定，避免无意双计。
  const pairs=[
    [x=>x.rule.group==='dPractice',x=>x.rule.id==='L-D01','德育实践与服务性劳动'],
    [x=>['Z-B02','Z-B03','Z-B04'].includes(x.rule.id),x=>x.rule.id==='L-D02','智育学术活动与生产劳动']
  ];
  for(const [left,right,label] of pairs) {
    const a=active(left),b=active(right);
    const keys=policy.mutual==='whole-item'?['whole']: [...new Set(a.map(x=>eventKey(x.record)).filter(k=>b.some(x=>eventKey(x.record)===k)))];
    if(!a.length||!b.length)continue;
    for(const key of keys){
      const aa=a.filter(x=>x.active&&(key==='whole'||eventKey(x.record)===key));
      const bb=b.filter(x=>x.active&&(key==='whole'||eventKey(x.record)===key));
      if(!aa.length||!bb.length)continue;
      const selectedA=aa.some(x=>x.record.claim==='selected'),selectedB=bb.some(x=>x.record.claim==='selected');
      if(selectedA!==selectedB){for(const row of selectedA?bb:aa)drop(row,`${label}互斥，已选择另一申报归属`);}
      else for(const row of [...aa,...bb]) {drop(row,`${label}互斥`);row.pending.push('请编辑记录，选择一侧“优先申报”，或另一侧“不申报”');}
    }
  }
  // 赛事池内最高分；三大与其他池是否分开可在规划口径设置中查看/修改。
  const contests=rows.filter(x=>['zMajor','zOther'].includes(x.rule.group));
  keepBest(contests,x=>policy.contestPools==='separate'?x.rule.group:'all',highest,'该竞赛池只取单项最高分');

  const resultRules={};
  for(const rule of rules) {
    const list=rows.filter(x=>x.rule.id===rule.id);
    let eligible=list.filter(x=>x.active),raw=0;
    if(rule.aggregate==='latest'&&eligible.length>1) {
      eligible.sort(later);
      for(const row of eligible.slice(1))drop(row,'年度状态/评议以最近一次完整输入为准');
      eligible=eligible.slice(0,1);
    }
    if(rule.aggregate==='max'&&eligible.length>1){eligible.sort(highest);for(const row of eligible.slice(1))drop(row,'该项不可累计，取最高有效记录');eligible=eligible.slice(0,1);}
    if(rule.kind==='threshold'){
      raw=total(eligible.map(x=>x.value))>=rule.threshold?rule.points:0;
      if(eligible.length)eligible[0].contribution=raw;
    } else if(rule.kind==='dorm') {
      const checks=total(eligible.map(x=>x.record.count));
      if(checks>=8){raw=total(eligible.map(x=>x.value*x.record.count))/checks;for(const row of eligible)row.contribution=raw*row.record.count/checks;}
      else if(eligible.length){for(const row of eligible){row.pending.push(`卫生检查仅${checks}次，未达8次；不足8次原文未规定计分`);row.active=false;}eligible=[];}
    } else if(rule.kind==='artCourse'){
      // 多门已认可且合格的美育课程按学分累计；原文2学分作为完成阈值，规划解释明示。
      raw=total(eligible.map(x=>x.value))>=2?10:0;
      if(eligible.length)eligible[0].contribution=raw;
    } else {raw=total(eligible.map(x=>x.value));for(const row of eligible)row.contribution=row.value;}
    let value=clamp(raw,rule.cap);
    if(value<raw){const factor=value/raw;for(const row of eligible)row.contribution*=factor;}
    resultRules[rule.id]={id:rule.id,raw,value,cap:rule.cap,records:list,pending:list.filter(x=>x.pending.length).length,excluded:list.filter(x=>!x.active&&!x.pending.length).length};
  }
  if(state.settings.conductViolation==='yes'){
    resultRules['D-B02'].value=0;
    for(const row of resultRules['D-B02'].records){row.contribution=0;row.notes.push('年度违法违规：行为规范子项计0');}
  }
  const groups={};
  for(const [id,definition] of Object.entries(GROUPS)) {
    const ids=rules.filter(r=>r.group===id).map(r=>r.id);
    const raw=total(ids.map(k=>resultRules[k].value));
    const value=clamp(raw,definition.cap);
    groups[id]={...definition,id,raw,value,ids};
    if(value<raw)for(const k of ids){resultRules[k].value*=value/raw;for(const row of resultRules[k].records)row.contribution*=value/raw;}
  }
  // 三大+其他学科竞赛共同受竞赛30封顶，且与成果等合计受智育发展30封顶。
  const contestTotal=groups.zMajor.value+groups.zOther.value;
  if(contestTotal>30){for(const id of ['zMajor','zOther'])scaleGroup(groups[id],30/contestTotal,resultRules);}
  const boards={};
  for(const board of BOARDS){
    const ids=Object.keys(groups).filter(id=>rules.some(r=>r.group===id&&r.board===board.id));
    const base=clamp(total(ids.filter(id=>groups[id].stage==='base').map(id=>groups[id].value)),board.baseCap);
    const developRaw=total(ids.filter(id=>groups[id].stage==='develop').map(id=>groups[id].value));
    const develop=clamp(developRaw,board.developCap);
    if(developRaw>develop)for(const id of ids.filter(id=>groups[id].stage==='develop'))scaleGroup(groups[id],develop/developRaw,resultRules);
    const reward=clamp(total(ids.filter(id=>groups[id].stage==='reward').map(id=>groups[id].value)),10);
    let value=policy.formula==='normalized'?base+develop+reward:base*board.baseWeight+develop*board.developWeight+reward;
    const veto=board.id==='Z'&&(state.settings.academicMisconduct==='yes'||rows.some(x=>x.rule.id==='Z-B05'&&x.record.fields.done==='no'&&x.record.claim!=='excluded'))?'学术不端：智育整体计0':board.id==='L'&&Number(state.settings.hygieneFailures)>=2?'个人卫生安全不合格≥2次：劳育整体计0':'';
    if(veto){value=0;notes.push(veto);}
    value=clamp(value,100);
    boards[board.id]={...board,base,develop,reward,value,contribution:value*board.weight,pending:rows.filter(x=>x.rule.board===board.id&&x.pending.length).length,veto,groups:ids};
  }
  if(!state.settings.rangeConfirmed)notes.push('参评日期范围尚未确认，当前按记录所属学年归集；请在设置核对起止日');
  if(!state.settings.policyAcknowledged)notes.push('含个人规划口径，请在“规则与口径”中核对；最终以学院认定为准');
  return {value:total(Object.values(boards).map(b=>b.contribution)),boards,groups,rules:resultRules,rows,pending:rows.filter(x=>x.pending.length).length,notes,recordCount:rows.length};
}
function scaleGroup(group,factor,rules){group.value*=factor;for(const id of group.ids){rules[id].value*=factor;for(const row of rules[id].records)row.contribution*=factor;}}
