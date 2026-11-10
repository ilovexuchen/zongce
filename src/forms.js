export const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const yesNo=[['yes','是 / 已完成'],['no','否 / 未完成']];
const field=(key,label,type='select',options=yesNo,extra={})=>({key,label,type,options,...extra});
const num=(key,label,min,max,extra={})=>field(key,label,'number',null,{min,max,step:'any',...extra});
const text=(key,label,hint='')=>field(key,label,'text',null,{hint,maxLength:300});
const recognition=(max=10,min=0)=>[field('recognized','已有学院认定'),num('recognizedScore','学院认定分',min,max),text('recognitionNote','认定依据 / 通知说明','请填学院通知、审核结果等依据；不把个人推测写成学院已认定。')];
const team=()=>[field('team','参赛形式','select',[['individual','个人'],['team','团体']])];
const edition=()=>text('edition','同届比赛标识','填写“赛事完整名称 + 年份/届次”；同届同项保持一致。体育/美育默认同届比赛只保留最高奖项。');
export function getFields(rule,state){
  switch(rule.kind){
    case 'qualitative':return [num('counselor','辅导员评分（30%）',0,rule.cap),num('classScore','班级评分（50%）',0,rule.cap),num('selfScore','自评分（20%）',0,rule.cap)];
    case 'binary':return [field('done',rule.id==='Z-B05'?'当学年符合学术诚信要求':'已达到本条完成条件')];
    case 'policyCourses':return [field('policyPass','形势与政策合格并获学分'),...(String(state.settings.grade)==='1'?[field('theoryPass','军事理论合格并获学分'),field('skillsStatus','军事技能','select',[['pass','合格并获学分'],['exempt','当年军训免训'],['fail','不合格']])]:[])];
    case 'honorRole':return [field('role','集体荣誉中的身份','select',[['member','普通成员'],['committee','对应班委 / 团支委'],['leader','对应班长 / 寝室长 / 团支书 / 负责人']])];
    case 'position':return ['D-C02','D-C03','D-C04'].includes(rule.id)?[field('position','任职级别','select',[['chief','正职 / 会长'],['deputy','副职 / 副会长']])]:[];
    case 'assessment':return [field('assessment','任职考核','select',[['excellent','优秀'],['pass','合格'],['fail','未通过']]),...(['D-C10','D-C11'].includes(rule.id)?[field('fullYear','任职已满一年')]:[])];
    case 'recognized':return recognition(rule.cap,rule.minimum||0);
    case 'moralPractice':return [num('extraScore','额外获奖加分（没有则填0）',0,2,{required:false}),field('extraRecognized','额外分已经学院核定','select',yesNo,{required:false}),text('recognitionNote','额外获奖分的认定依据（无则留空）')].map(x=>({...x,required:false}));
    case 'training':return [field('training','培训类别','select',[['league','团校'],['activist','积极分子培训'],['party','党校']]),field('done','已结业')];
    case 'enlist':return [field('enlistType','项目类型','select',[['enlist','应征入伍'],['international','国际组织实习']]),num('months','国际组织实习月数（入伍可留空）',0,120,{required:false})];
    case 'attendance':return [field('noAbsence','当学年无无故旷课')];
    case 'majorContest':return [edition(),field('recognizedContest','赛事及奖项受认可'),num('rank','本人在团队中的成员排名',1,10000,{step:1}),...(rule.tier==='province'?[field('outsideLead','项目负责人非本学院')]:[])];
    case 'otherContest':return [edition(),field('recognizedContest','赛事及奖项受认可'),field('tier','竞赛级别','select',rule.contestType==='school'?[['national','国家级'],['province','省部级']]:[['national','国家级'],['province','省部级'],['school','校级'],['college','院级']]),...team(),num('rank','团队成员排名（个人赛可留空）',1,10000,{step:1,required:false}),field('role','团队角色（个人赛可留空）','select',[['leader','负责人'],['member','组员']],{required:false})];
    case 'paper':return [text('workId','论文稳定标识（DOI或完整题名）','同一篇在任何类别与学年必须填同一标识，以防重复认定。'),field('professional','与专业相关'),field('firstAuthor','本人为第一作者'),field('schoolFirst','四川大学为第一单位'),field('collegeTeacher','本院教师指导完成'),field('accepted','已录用'),field('warned','是否处于期刊预警状态'),field('usedBefore','是否已在其他学年认定'),num('coFirst','共同第一作者人数（独作填1）',1,1000,{step:1}),field('paperType','论文类型','select',[['regular','期刊正刊/特刊 或 Regular paper'],['supplement','增刊（0.5倍）'],['demo','Demo（0.5倍）'],['workshop','Workshop（按EI）']]),field('eiReport','已有EI检索报告（EI/Workshop必填）','select',yesNo,{required:false})];
    case 'project':return [text('workId','大创项目编号 / 稳定标识'),field('assessment','正常结题状态','select',[['excellent','已正常结题 · 优秀'],['pass','已正常结题 · 合格'],['unfinished','尚未完成结题'],['terminated','中止 / 终止']]),field('scuProject','立项单位为四川大学'),field('role','本人角色','select',[['leader','负责人'],['member','其余参与人员']]),field('outsideLead','项目负责人非本学院')];
    case 'patent':return [text('workId','授权发明专利号'),num('rank','专利署名排名',1,10000,{step:1}),field('authorized','已获得发明专利授权'),field('professional','内容与专业有关'),field('scuOwner','材料符合“授权人必须为四川大学”','select',yesNo,{hint:'保留手册原词；请以学院材料审核为准，不自行解释申请人/权利人。'})];
    case 'csp':return [num('score','CSP成绩',0,500,{step:1})];
    case 'fitnessBasic':case 'fitnessGrade':return [field('fitness','当学年体测结果','select',[['pass','合格'],['good','良好'],['excellent','优秀'],['exempt','当年免测'],['fail','不合格']])];
    case 'sportSkill':return [num('score','当学年大学体育/体育通识课成绩',0,100)];
    case 'sportContest':case 'artContest':return [edition(),...team(),field('award','获奖档次','select',[['first','一等奖'],['second','二等奖'],['third','三等奖'],['lower','三等以下奖项（确有奖项）'],['none','仅参赛未获奖']])];
    case 'schoolMeet':return [edition(),field('officialMeet','校级运动会且非趣味运动会'),num('rank','名次',1,10000,{step:1}),...team()];
    case 'artCourse':return [num('credits','已完成美育课程学分',0,100,{hint:'按已认可且合格课程累计，达到2学分计10。学分合并为规划解释。'}),field('passed','该课程成绩合格'),field('recognizedCourse','学校认可为美育选修课程')];
    case 'dorm':return [field('recognized50','已核定为50分制得分','select',yesNo,{hint:'没有宿舍检查补充方案时，仅输入学院已确认的50分制成绩。请勿自行把百分制折半。'}),num('score','单次检查分 / 已核定年度均分（50分制）',0,50,{hint:'次数填写检查数量。年度均分录入时，次数填实际检查总次数；须不少于8次。'})];
    case 'service':return [num('hours','本记录实际累计服务小时',0,100000,{hint:'此处是本条记录的累计总时长，不再乘“参与次数”；规划按实际小数小时计分。'})];
    case 'reward':return recognition();
    default:return [];
  }
}
export function renderField(def,value=''){
  const required=def.required!==false,attrs=`name="f_${esc(def.key)}" ${required?'required':''}`;
  let input;
  if(def.type==='select')input=`<select ${attrs}><option value="">请选择${required?'':'（可留空）'}</option>${def.options.map(([v,label])=>`<option value="${esc(v)}" ${String(value)===String(v)?'selected':''}>${esc(label)}</option>`).join('')}</select>`;
  else input=`<input ${attrs} type="${def.type}" value="${esc(value)}" ${def.type==='number'?`min="${def.min}" max="${def.max}" step="${def.step||'any'}" inputmode="decimal"`:`maxlength="${def.maxLength||300}"`}>`;
  return `<label class="field"><span>${esc(def.label)}${required?'<i class="required">*</i>':''}</span>${input}${def.hint?`<small>${esc(def.hint)}</small>`:''}</label>`;
}
