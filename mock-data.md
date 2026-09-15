# Mock数据结构与枚举（mock-data）
> 对齐PRD第16章数据模型。TRAE据此生成 /mock/*.js 与 /config/enums.js。
> 存储层提示：微信云开发集合名与下述一致，字段名一致，后续可直接换真接口。

## 1. 全局枚举（config/enums.js）

### SCENES 一期场景白名单（PRD 3.3.1，硬编码校验R9）
export const SCENES = [
  { code:'medical_escort',  name:'就医陪诊', icon:'🏥', color:'#E8F1FF', gb:true,  cert:'陪诊认证',免责声明:true },
  { code:'study_companion', name:'学习陪伴', icon:'📚', color:'#EDE8FF', gb:false, cert:'学习认证' },
  { code:'life_assist',     name:'生活协助', icon:'🧾', color:'#FFF3E0', gb:false, cert:'生活协助认证' },
  { code:'travel_companion',name:'出行陪伴', icon:'🚄', color:'#E0F5F4', gb:false, cert:'出行认证' }, // PRD16.5缺失编码，本字段为补充
  { code:'online_companion',name:'线上陪伴', icon:'💬', color:'#FFE9EC', gb:false, cert:'线上认证' }, // 合并online_voice/video
]

### ORDER_STATUS 13态（PRD 3.5.2 SSOT，拍板项4）
S0待支付(30分钟超时) / S1待确认(15分钟) / S2已支付待履约 / S2.5改期处理中 /
S3履约中 / S3.5履约中断(24h超时转S4) / S4部分完成(7天裁定期) / S5已完成 /
S6已取消 / S7已退款(T+1) / S8已评价(售后15天) / S9评价超时(默认4星) / S10已关闭 / S10.5争议处理中(30天升级)
每态配置：{code,name,colorTag,timeoutText,nextActions[]}

### MATCH_MODE（PRD 2.2）：direct定向邀约 / broadcast广场广播 / smart智能派单(需L3或会员)
### PROJECT_ATTR（PRD 1.5）：commercial商业 / public_welfare公益
### AA_ESTIMATE（PRD 3.5.1-V15）：'0-50' / '50-200' / '200+' / 'custom'
### CREDIT_LEVEL（PRD 3.1.2拍板）：
L1新手600-799(日上限10) / L2标准800-899(15) / L3优质900-949(20) / L4金牌950-1000(25)
初始800/满分1000/及格600/冻结400；双字段 user_credit_score + partner_credit_score 独立
### FUND_STATUS（PRD 3.5.1）：splitting分账中 / withdrawable可提现 / processing提现处理中 / arrived已到账
### TM_TEMPLATES（PRD 16.5）：TM1时间/TM2地点/TM3内容/TM4费用/TM5特殊需求/TM6到达提醒/TM7取消申请/TM8改期申请
每模板：{id,name,icon,headColor,question,options[],hasOther:true(otherLimit:200字)}
### CONFIRM_ITEMS：time/location/content/fee 四确认项

## 2. 集合结构（collections）

### users（PRD16.2 user_account）
{ _id, openid, nickname, avatar, phone:'138****8888', real_name:'张*明',
  id_card_masked:'3201**********1234', face_verified:true, age:26,
  user_credit_score:820, partner_credit_score:800, is_partner:true,
  partner_level:'L2', emergency_contacts:[{name:'王**',phone:'139****0000',verified:true,relation:'父母'}],
  user_type:'personal', status:'active', new_user:true, first_order_used:false,
  fast_withdraw_used:3,  // 极速提现已用次数(PRD1.8.1前10单)
  created_at:'2026-09-01' }
示例数据：2条（1个双身份耍伴+1个纯用户18-22岁:emergency_contacts须2条,单笔上限200）

### demands（PRD16.2 demand + 3.3.1扩展）
{ _id, order_no:'D20260916001', user_id, scene_code:'medical_escort',
  project_attr:'commercial', title:'陪父亲华西医院复诊取号',       // ≤20字
  description:'老人腿脚不便，需协助挂号排队、取药、记录医嘱…',      // ≤500字
  service_date:'2026-09-16', service_time:'08:30-12:00', duration_hours:3,
  location:{name:'华西医院门诊大楼',address:'武侯区国学巷37号',lat:30.65,lng:104.05},
  headcount:1, budget:80,               // 元/小时 10-500
  gender_pref:'不限', aa_estimate:'50-200',
  match_mode:'broadcast', status:'matching',   // matching/matched/cancelled/expired
  published_at:'2026-09-14T10:00:00', draft:false }
示例数据：6条（覆盖5场景+1公益单:project_attr='public_welfare',budget:null）

### orders（PRD16.2 order_main）
{ _id, order_no:'20260916001', demand_id, user_id, partner_id,
  scene_code:'medical_escort', amount:240, unit_price:80, duration:3,
  status:'S3', project_attr:'commercial', aa_estimate:'50-200',
  insurance:{policy_no:'PI20260916001',coverage:500000,status:'insured'},
  confirm_progress:{time:true,location:true,content:true,fee:false},  // 四确认
  paid_at, started_at, ended_at, evaluated:false,
  modify_count:0,   // 改期已用次数(上限2)
  timeline:[{status:'S0',at:'...'},...] }
示例数据：5条，覆盖 S1/S2/S3/S5/S10.5 各一

### messages（PRD16.2 + 3.4.4）
{ _id, conversation_id:'order_xxx', from_user_id, to_user_id,
  msg_type:'template'|'text'|'system',   // 四确认前仅template/system
  tm_id:'TM1', tm_options:{picked:'方便'},   // 模板卡数据
  content:'', status:'sent'|'recalled', is_read:false, created_at }

### conversations
{ _id, order_id, user_id, partner_id, scene_code, last_msg, last_msg_at,
  unread_count, order_status:'S3', pinned:false }

### safety_reports（PRD16.2 + 3.6）
{ _id, order_id, checkin_time, gps:{lat,lng,precision:'block'},  // 街区级
  status:'normal'|'missed'|'sos', sos_type:null|'one_key'|'silent' }

### evaluations（PRD 3.5.7）
{ _id, order_id, from_user_id, to_user_id, stars:5,
  tags:['准时到达','服务专业'], content:'', is_default:false,  // 默认4星标记
  created_at, modify_used:false }   // 24h内可改1次

### credit_logs（PRD16.2）
{ _id, user_id, role:'user'|'partner', action, score_change, current_score, reason, created_at }
### withdraws
{ _id, partner_id, amount, fee:0, status:'processing'|'arrived',
  type:'fast'|'standard',   // 极速/标准
  applied_at, expected_at }  // fast:T+0到子商户号 / standard:T+1
### drafts
{ _id, user_id, demand_data:{...}, saved_at, expires_at }  // 30天有效期(PRD拍板项1)

## 3. 可运营参数（config/index.js，全部集中此处禁止散落）
{ TIME_REDLINE:{close:'23:00',open:'06:00'},          // R1
  BUDGET_RANGE:[10,500], TITLE_MAX:20, DESC_MAX:500, HEADCOUNT:[1,3], DATE_RANGE_DAYS:30,
  DURATION_OPTIONS:[1,2,3,4,6,8],
  AA_OPTIONS:['0-50','50-200','200+','custom'],
  DRAFT:{expireDays:30,maxCount:20,autoSaveSec:30},    // 拍板项1
  ORDER:{payTimeoutMin:30,confirmTimeoutMin:15,evalWindowH:48,evalDefaultStars:4,evalModifyH:24,afterSaleDays:15},
  MODIFY:{maxTimes:2,freeFirst:true,secondFeeRate:0.05,minLeadHours:4,maxSpanH:72},
  CANCEL_REFUND:[{lead:'>24h',rate:1},{lead:'4-24h',rate:0.8},{lead:'<4h',rate:0.5}],
  NO_SHOW:{scoreDeduct:20,maxTimes:3,suspendDays:7},   // 拍板项2
  SAFETY:{checkinMin:30,gpsPrecision:'block',sosCountdownSec:10,oneKeyPressSec:3,s35TimeoutH:24},
  YOUTH:{ageRange:[18,22],maxOrderAmount:200,contacts:2,sosPopupMin:60},
  ELDERLY:{age:60,checkinMin:20},
  WITHDRAW:{minAmount:10,fastPerDayMax:2000,fastPerOrderMax:200,fastOrders:10,arriveDays:1},
  CREDIT:{init:800,max:1000,pass:600,freeze:400},
  INSURANCE:{accidentCoverage:500000,propertyCoverage:50000},
  YOUNG_REVIEW_MIN:850 }   // 18-22岁优先匹配850+(PRD1.7.1 YP4)
