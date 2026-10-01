// zz-seed-orders · 临时种子生成器(验收视觉后删除)
// 用途: 以「真人感」模拟订单填充广场/首页/附近列表, 用于真机视觉测试
// 方式: ①创建一批虚拟 user_account(成都本地感昵称+姓氏) ②按 admin_config.scene_list 每个子场景写 5 条 demand
// 落库结构对齐 demand-publish 产出(remark='标题｜描述', home-action mapDemand/fillPublisherSurname 直接渲染)
// 幂等: client_request_id = sim-{scene}-{subIdx}-{i}, 重复 simulate 不重复建; cleanup_sim 软删本函数的虚拟用户与需求
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

const RATE_MIN = 3200, RATE_MAX = 8000; // 分: 32-80 元/时
const DAY_OFFSETS = [1, 2, 3, 4, 5];
const HOURS = [9, 11, 14, 16, 18]; // 08:00-20:00 内, 避开 R1 夜间红线

// ── 虚拟真人账号(成都本地感; surname 首字用于卡片「张** · 已实名」) ──
const VIRTUAL_USERS = [
  { surname: '张', nickname: '张欣悦' }, { surname: '李', nickname: '李慕辰' },
  { surname: '王', nickname: '王思娴' }, { surname: '刘', nickname: '刘一航' },
  { surname: '陈', nickname: '陈雨桐' }, { surname: '杨', nickname: '杨嘉乐' },
  { surname: '黄', nickname: '黄诗涵' }, { surname: '赵', nickname: '赵子墨' },
  { surname: '周', nickname: '周可馨' }, { surname: '吴', nickname: '吴俊贤' },
  { surname: '徐', nickname: '徐若琳' }, { surname: '孙', nickname: '孙浩然' },
  { surname: '马', nickname: '马雨薇' }, { surname: '朱', nickname: '朱星辰' },
  { surname: '胡', nickname: '胡沁雅' }, { surname: '郭', nickname: '郭景明' },
  { surname: '何', nickname: '何晓晓' }, { surname: '高', nickname: '高睿泽' },
  { surname: '林', nickname: '林语嫣' }, { surname: '罗', nickname: '罗晨熙' },
  { surname: '郑', nickname: '郑雨晴' }, { surname: '梁', nickname: '梁博文' },
  { surname: '谢', nickname: '谢安然' }, { surname: '唐', nickname: '唐悦宁' }
];
const USERS = VIRTUAL_USERS.map((u, i) => ({ openid: `simu_${String(i + 1).padStart(3, '0')}`, surname: u.surname, nickname: u.nickname }));

// 成都市区点位(地点名称随机取)
const PLACES = [
  '春熙路', '天府广场', '锦里', '宽窄巷子', '太古里', '东郊记忆', '玉林', '桐梓林',
  '天府三街', '金融城', '世纪城', '万年场', '建设路', '双楠', '八里庄', '光华村',
  'SM广场', '大源', '华阳', '犀浦', '文殊院', '杜甫草堂'
];

// ── 文案库: 子场景名 → [标题, 描述, 时长h] × 5(口语化·成都本地·无敏感词) ──
const CONTENT = {
  // W1 就医陪诊
  '挂号排队': [
    ['求陪老人明天一早去挂号排队', '我父亲想挂华西的专家号，网上号约不上，需要有人一早去帮忙排队取号。老爷子腿脚不太好，排队时最好能帮忙照应一下，早上我送他到门口。', 3],
    ['帮忙去医院排队取个专家号', '妈妈要看消化内科，需要有人凌晨四点半到省医院门口排队取号，号码拿到后就能走。辛苦费好商量，可以提前联系细节。', 3],
    ['陪外婆去社区医院挂号开药', '外婆慢性病每周要开药，儿女白天都上班。想找个人陪同挂号、缴费、取药，全程大概两小时，希望细心一点。', 2],
    ['找跑腿帮挂中医专家号', '想挂市中医院一位老中医的号，听说要现场排队。谁能早上去排队帮忙拿到预约凭证，我在院内等。', 3],
    ['工作日帮老人排门诊号', '爸妈从外地来成都复查，周二人多需要在市一医院排队取号，我在旁边照看老人，只需要有人占位排队。', 3]
  ],
  '取药送药': [
    ['帮忙去医院取药送到家', '家人在华西住院部开完药，指定要去院外药房购药，我需要有人帮忙跑一趟取药送到金牛区家里，全程约一小时。', 2],
    ['代取中药并送上门', '妈妈在中医院开的代煎中药下午三点可以取了，麻烦帮忙取药送到玉林小区，到家放门口拍个照就行。', 2],
    ['帮老人取药顺便核对清单', '奶奶在社区医院开了三种药，需要有人帮忙取药并逐项核对药品名称和数量，老人自己不太放心。', 1],
    ['医院窗口取药陪护', '要做个小手术，术前在医院拿药需要陪同，帮忙在窗口排队取药、清点后送到病房。', 2],
    ['急取靶向药送到华西住院部', '家人术后需要一种靶向药，需到大药房自提再送到住院部六楼护士站，时间比较紧，希望帮手手脚麻利。', 2]
  ],
  '陪诊解压': [
    ['第一次做胃镜求陪诊', '下周约了胃镜很紧张，家里人都在外地。想找个人陪诊跑上跑下，缴费取单拿报告，检查完送我到地铁口就行。', 4],
    ['陪朋友做全面体检', '朋友第一次做入职大体检，项目多科室分散，想找人陪着指路、领号、看注意事项，缓解紧张。', 4],
    ['陪妈妈做核磁共振', '妈妈做核磁增强检查需要有人陪同转诊、签字、拿片子，老公刚好出差，想找个细心的人搭把手。', 3],
    ['异地就诊需要全程陪护', '从宜宾来成都做检查，人生地不熟。希望有人从上午陪到下午，帮忙挂号缴费找科室，中间一起吃个午饭。', 6],
    ['陪伴做眼科检查', '早上要做眼底检查还要散瞳，散瞳后看东西模糊，需要有人搀扶做检查、取药并送到公交站。', 3]
  ],
  // W2 学习陪伴
  '自习陪伴': [
    ['找个自习搭子一起复习考公', '9月要考公务员，一个人在家效率低。想在武侯区图书馆找个一起自习、互相监督的伙伴，中午还能一起吃饭。', 4],
    ['考研冲刺求结伴自习', '跨考会计专硕，数学卷不动了。想找个固定自习搭子，每天下午一起泡图书馆，互相提醒别玩手机。', 4],
    ['雅思备考求学伴', '下月刷雅思，口语太拉胯。求个一起自习、能互相抽查单词的伙伴，地址在春熙路附近书店。', 3],
    ['小朋友一起写作业做伴', '儿子四年级在家写作业坐不住，想找个大学生来图书馆陪写作业，帮他定计划，不一定要辅导功课。', 2],
    ['白天自习室求拼桌', '我准备法考客观题，在家总犯困，约个同伴一起去自习室互相盯一下，地点可以在东郊记忆附近。', 5]
  ],
  '口语陪练': [
    ['找人陪练英语口语', '下周要英文面试，自我感觉很生硬。想找英语好的伙伴每天陪练一小时，模拟问答、纠正发音，线上线下都行。', 1],
    ['日语口语日常练习', '想练日语日常会话，学了一年还开不了口。找位日语好的朋友每周聊两三次，一次一小时，主要在商圈咖啡馆。', 1],
    ['给孩子做英语口语陪练', '闺女二年级学英语不敢开口，想找个充满耐心的大学生每周陪她说英语绘本、做游戏，带着她多说。', 1],
    ['商务英语场景陪练', '月底要见外籍客户，需要实战模拟商务谈判用语的伙伴，最好有外企经验，晚上下班后练习。', 1],
    ['西班牙语入门陪练', '报了个西语班但回去没人对话，求一位级别高的伙伴陪练基础对话，说话慢一点没关系，我在城南。', 1]
  ],
  '作业督促': [
    ['找人督促小朋友做作业', '我上班族，孩子放学到晚上八点没人盯。想找个会跟孩子沟通的大哥哥大姐姐到家附近书店督促他完成作业并检查。', 3],
    ['线上自习室互相监督写论文', '毕业论文写到崩溃，自制力差。希望找个同样写论文的朋友视频连麦一起磨进度，半小时汇报一次，互相打气。', 3],
    ['伴读辅导初一作业', '侄子上初一，数学英语偏科。需要每晚有人陪他整理错题、按计划完成作业，不需要讲难题，主要是陪伴和督促。', 2],
    ['考研二战求互相监督', '在家二战，状态很飘。想找一个同样二战的朋友每日互相打卡学习时长和任务，线上即可，一起上岸。', 4],
    ['陪小学生练字打卡', '女儿练字总偷懒，朋友介绍这个平台。想找人每天下午陪她写二十分钟字帖，顺便把当天拼音作业顺一遍。', 1]
  ],
  // W8 生活协助
  '排队代办': [
    ['帮排队买网红点心', '朋友来成都点名要吃宫廷糕点那家，排队一小时起。出跑腿费，排到就行，买完放驿站我自己去取。', 2],
    ['工作日代排不动产窗口', '周一去房产中心办手续，号要早上放。想找人早上帮忙拿号，我十点半到直接办，不用全天陪着。', 3],
    ['演唱会门票代排队', '周五下午有小众乐队现场，售票窗口要提前排队。想找人帮忙排队购票，买到后拍票号给我。', 2],
    ['超市开业代排队领号', '盒马新店开业有前200名礼品，我想去凑热闹但请不了假，找人早上帮忙排队领入场券。', 2],
    ['医院抽血窗口排队', '要做空腹抽血，早上窗口排得很长。请人七点到医院帮忙占位排队，我到后换人。', 2]
  ],
  '搬家帮手': [
    ['同城搬家搭把手', '从建设路搬到双楠，两室一厅的东西，有货车有司机，就差人手搬上搬下，预计两小时，男士优先。', 3],
    ['搬家公司到场当帮手', '预约了搬家公司但只有一个人过来，想再找个人现场搭把手搬冰箱洗衣机这类重物，就在高新区内。', 2],
    ['宿舍搬寝室求助', '大学城寝室要从五楼搬到一楼，东西有点多但都是小件，找两个同学帮忙分几次搬完就行。', 2],
    ['书房整理搬运书架', '买了个新书架拆不开也抬不动，需要有人一起拼装并把旧书搬上去归位，不用特别专业。', 3],
    ['仓库换址陪搬', '自己开的小网店，仓库从万年场迁到龙潭寺，货品十几个大纸箱，帮我一起装卸码放整齐。', 3]
  ],
  '采买陪同': [
    ['陪妈妈逛超市拎东西', '妈妈每周去大超市囤一周菜，一个人提不动。想找个力气大的同学陪逛一上午帮忙拎袋子推车，管午饭。', 3],
    ['代买生日布置材料', '要给女朋友惊喜，需要有人帮我去花花市集选花、买气球彩带，拍照给我确认后统一送到家。', 2],
    ['陪逛菜市场代买年货', '春节前想让帮忙陪大娘去大菜市采购腊肉干货，她砍价你拎包，中午请吃大碗面。', 3],
    ['宜家代购小件家具', '想买伊姆斯椅和置物架，人不在成都。帮忙去宜家挑货拿货，商场有现货就付款带走，送到快递点寄给我。', 2],
    ['代取海鲜市场预订', '在青石桥订了一只帝王蟹，周末取货。帮我取货时挑选一下大小，打车直接送去楼下餐厅。', 1]
  ],
  // W10 出行陪伴
  '逛街同行': [
    ['求个逛街搭子试衣服', '想换季买衣服但一个人逛街没意思，找个审美一致的姐妹从太古里逛到春熙路，互相给建议。', 4],
    ['陪妈妈逛商场', '妈妈进城逛商场总走丢，周末想找人陪着边走边照应，帮她提购物袋看看吊牌，母上开心最重要。', 4],
    ['帮伴娘挑姐妹裙', '十月婚礼要定伴娘裙，想找个逛街达人陪我跑三家店对比款式尺码，需要说实话的那种。', 3],
    ['陪逛数码城买电脑', '要配一台台式机，什么配置都不懂。求个懂行的男生陪我逛百脑汇，帮忙分辨是不是翻新机，避坑。', 3],
    ['逛街想有人帮拿主意', '给孩子挑个生日礼物一直纠结，找人陪我在商场逛一圈，帮忙拍板，顺便一起喝杯奶茶。', 2]
  ],
  '夜跑陪跑': [
    ['求夜跑陪跑伙伴', '一个人夜跑五公里总想放弃，想找跑友配速差不多的一起，沿锦江绿道每周三五晚跑，坚持一个月。', 1],
    ['夜跑新手求带', '刚办健身卡，晚上跑步总一个劲走。找个有点经验的朋友带我入门，先跑三公里起步，配速慢没关系。', 1],
    ['环湖夜跑搭子', '兴隆湖晚上风景好，想找人一起环湖跑一圈，大概十公里，跑完顺便湖边吹吹风聊聊天。', 2],
    ['夜跑安全陪护', '女生晚上一个人跑步不太安全，想找个伙伴陪我跑小区周边线路，配速七分左右，主要图个安心。', 1],
    ['马拉松备赛陪跑', '报了下个月半马，赛前最后一次长距离训练，想找人按配速陪跑十五公里，互相带节奏。', 2]
  ],
  '活动搭子': [
    ['找搭子一起去音乐节', '周末国潮音乐节一个人去站一天太孤单，找同样喜欢摇滚的搭子拼票拼烤肠，现场一起嗨。', 6],
    ['剧本杀拼车', '约好四人本还差两人，找个戏精搭子一起拼车，硬核推理本，解读诡异的线索，周末下午场。', 4],
    ['美术馆双人票求同行', '有成都美术馆双人票一张，本周日有效，找一位爱看展的朋友同行，出来可以一起喝咖啡聊感受。', 3],
    ['相声演出缺伙伴', '周三晚笑场有相声专场，朋友临时放鸽子空出一张票，找喜欢听相声的搭子，笑点低一点最好。', 3],
    ['飞盘新手局找人组队', '周末锦城湖有飞盘新手局，想找几个搭子一起报名组队，运动完一起撸串认识新朋友。', 3]
  ],
  // W11 线上陪伴
  '树洞倾听': [
    ['深夜想找人说说话', '最近工作压力大又不想跟熟人抱怨，想找个耐心的朋友半夜聊聊天，听我把心里话说出来就好。', 1],
    ['求职焦虑求开解', '面试挂了五家，心态有点崩，想找个人线上陪我聊聊职业方向，听听过来人的建议。', 1],
    ['想找人听我讲讲今天', '独居久了话变少，今天想找个人云聊会儿，讲讲今天遇到的事，能安静听我说就行。', 1],
    ['烦心事想倾诉', '和多年的朋友闹了误会，心里堵得慌。想找个陌生人听听事情经过，帮我把情绪捋顺。', 1],
    ['放假好无聊找聊天', '假期一个人在家好无聊，找人连麦聊聊最近看的书和剧，天南地北地瞎聊，就当陪陪我。', 2]
  ],
  '游戏陪玩': [
    ['王者荣耀求陪打排位', '星耀段位上不去了，求个王者大神带带，会玩的优先，能用麦克风指挥节奏最好，友好不上头。', 2],
    ['联机游戏找队友', '想找人陪我玩双人成行和解谜类联机游戏，卡在工期没队友，一起通关一起吐槽。', 2],
    ['棋牌类陪玩切磋', '喜欢下围棋但身边没人下，想找位业余段位朋友线上对弈，顺便复盘指点我这几步臭棋。', 1],
    ['游戏搭子互带', '我打游戏有点菜但心态好，想找个不嫌弃的搭子一起玩休闲向游戏，晚上固定两小时。', 2],
    ['找人陪玩单机热游', '入手了新的开放世界游戏一个人探索太寂寞，想找个也在玩的一起连麦讨论攻略开玩笑。', 3]
  ],
  '打卡监督': [
    ['线上互相监督早起打卡', '我总赖床误事，想找个人早上七点互相微信打卡，谁没起谁发红包那种，够狠才能改。', 1],
    ['每日背单词监督', '准备雅思但单词坚持不下来，找个人每天固定时间抽查我十个单词，错一个做十个深蹲。', 1],
    ['减肥饮食打卡搭子', '正在减脂，需要每天互相拍三餐复盘，谁偷摸吃宵夜谁请奶茶，互相监督到位。', 1],
    ['备考每日进度打卡', '一个人学习太孤单，想找个也有考试目标的朋友每晚十点互相汇报进度，坚持到考试那天。', 1],
    ['练琴打卡监督', '学吉他三个月瓶颈期，想找人每晚提醒我练琴并点评录音，偷懒就发个歌词自嘲一下。', 1]
  ],
  // W3 健身陪伴
  '健身指导': [
    ['健身房新手求指导', '刚办卡三个月只会跑步机，器械区不敢去。想找个有健身经验的伙伴带我做一遍固定器械，教我哑铃姿势。', 2],
    ['求减脂训练搭子', '体脂率偏高想系统减脂，找位会制定训练计划的伙伴每周两次带我练力量加有氧，管住嘴那种。', 2],
    ['产后恢复求陪练', '产后一年腰腹力量弱，想找个女教练或靠谱姐妹带我做核心训练，安全第一，动作慢一点都能接受。', 2],
    ['肩颈酸痛求拉伸指导', '坐办公室肩颈僵硬，想找懂拉伸的朋友带我练练开肩和核心，不用去健身房，小区广场也行。', 1],
    ['学生党去健身房求带', '学校健身房办卡没怎么用过，求个学长带带我练背练腿，练完请喝冰美式。', 2]
  ],
  '跑步陪跑': [
    ['晨跑求伙伴', '每天早上七点府南河边跑步，六公里配速六分半，找个固定跑友一起，聊聊今天各自安排。', 1],
    ['新手跑步求陪练', '想减肥决定跑步，但是一个人坚持不下来，求个有耐心的伙伴带着慢跑，走跑结合也行。', 1],
    ['马拉松训练陪跑', '我报了迷你马，求个跑友陪我周末拉两次十公里，配速方面你带带我，补给我准备。', 2],
    ['滨江夜跑搭子', '晚上八点后想绕锦江跑一圈，一个人总犯懒，找个搭子互相催，跑完拉伸聊会儿天。', 1],
    ['下雨天跑步机互相监督', '下雨跑不了户外，健身房太远。找人跟我视频互相监督跑步机或原地跑的，偷懒对方有惩罚权。', 1]
  ],
  '器械陪同': [
    ['卧推保护求帮手', '力量训练冲重量时一个人不敢做卧推，求个同样健身的伙伴做保护，顺便交流下训练计划。', 2],
    ['硬拉深蹲求陪同', '健身房练三大项需要人看动作和放杠，找个练得不错的搭子互帮互助，训练完一起喝蛋白粉。', 2],
    ['单车课求搭子', '团课单车课一个人去总觉得尴尬，找个搭子一起占前排，互相卷坡度保持心率。', 1],
    ['器械区求指导摹仿', '高位下拉划船这些器械会用但不敢加片，想找经过的人指点一下动作要领，最好顺便陪我两组。', 2],
    ['力量区新手求靠', '进力量区手心冒汗，求个靠谱伙伴陪我做引体辅助器和腿举，做到位为止，一瓶水感谢。', 1]
  ],
  // W4 游玩陪伴
  '景区游览': [
    ['青城山一日游求同行', '周末想去青城山爬山，一个人爬山太闷，找个体力差不多的搭子一起，路上互相拍照，山顶吃凉面。', 6],
    ['带爸妈游都江堰', '爸妈来成都想看看都江堰，我自己对景点也不熟，求个本地会讲的伙伴当半个导游，帮忙照顾两个老人。', 5],
    ['西岭雪山滑雪求同行', '淡季想去西岭雪山滑雪，求同样新手阶段的搭子拼车拼教练，互相壮胆一起摔。', 6],
    ['大熊猫基地打卡', '来成都出差顺路想去熊猫基地看花花，求当地伙伴同游，帮我认熊猫认园子，中午一起吃饭。', 4],
    ['天台山约会漫游', '刚在一起的新邻居想约趟天台山徒步，两个人不太熟有点尴尬，想再找个性格开朗的同路人缓解气氛。', 6]
  ],
  '博物馆参观': [
    ['金沙遗址求同行讲解', '对古蜀文明感兴趣但看不懂门道，求一个懂历史文化的伙伴带着逛金沙博物馆，边看边聊。', 3],
    ['科技馆亲子游览伴侣', '周末想带儿子去科技馆，一个人带娃撒不开手，找个喜欢孩子的朋友帮忙照看参观，探索有趣展项。', 4],
    ['美术馆特展求看伴', '当代艺术双年展月底闭展，想找人一起看展聊作品，也不用多懂艺术，说出自己感受就行。', 3],
    ['自然博物馆研习搭子', '备考自然地理想积累素材，想去成博恐龙展厅和自然馆拍资料，求懂一点的同好同行。', 4],
    ['展览馆学剪纸体验', '省展览馆周末有非遗剪纸体验，想找个人一组互拍过程，做完互相点评作品。', 2]
  ],
  '商圈逛街': [
    ['周末逛街求清闲搭子', '周末天气好，想逛万象城负一层到六层慢慢逛，找个体力好的搭子一起逛吃，走到哪算哪。', 4],
    ['帮挑衣服求同行参谋', '我要见客户买两套带得出手的衣服，自己挑眼光不行，求个品味好的伙伴帮忙把关，午饭我请。', 3],
    ['小吃街觅食之旅', '想打卡建设路到玉林的小吃路线，胃只有一个但嘴很贪，找个吃货搭子一起拼着买，分享快乐。', 3],
    ['国金中心闲逛', '想逛逛IFS看看新季橱窗，顺便在楼下拍熊猫合影，找个拍照搭子互相拍出片的照片。', 2],
    ['书店咖啡厅闲适下午', '想找个人安静地一起在新山书屋看书喝咖啡，各自看各自的，渴了拼单，想聊就聊两句。', 3]
  ],
  // W7 情绪陪伴
  '陪伴散步': [
    ['晚饭后求散步陪伴', '最近心里装着事，晚饭后想找个人在锦江边走走，不用说话也行，就朝着一个方向慢慢走。', 2],
    ['考试周求散心搭子', '期末考压得喘不过气，想拉个人去公园散步吹风，边走边吐槽考试，回来说不定就好多了。', 2],
    ['陪奶奶小区散步', '奶奶独居，晚饭后想有人陪她绕着小区遛两圈说说话，她的身体还行，主要是想有个人陪着。', 1],
    ['失恋想找人走走', '刚结束一段感情心里空落落的，想找个温柔的人陪我在河边走一走，听我把旧事慢慢说。', 2],
    ['傍晚出门走走的伴', '一个人懒得挪窝，想找个同样想散步的人结伴沿绿道走一小时，随便聊聊天气和最近。', 1]
  ],
  '倾听陪伴': [
    ['回家路上想有人听我说话', '下班晚路又长，想找个人语音陪我走到地铁，说说今天办公室那些哭笑不得的事。', 1],
    ['深夜倾诉心事求倾听', '有些话没法跟身边人说，想找个陌生的伙伴听我讲完过去的事，不需要建议，听我说完就好。', 2],
    ['离职前的迷茫求听', '准备裸辞去追个不确定的梦想，家里人都不支持，想找个人听我把计划和害怕都说一说。', 1],
    ['发小异地求陪伴闲聊', '发小去外地工作后没人说心里话，想找个能聊得来的伙伴语音陪伴，讲讲近况和琐碎。', 1],
    ['考试失利想找人说', '考编差了两分，难受但又不想让爸妈担心，想找个人听我说说，陪我消化这个结果。', 1]
  ],
  '考前鼓励': [
    ['考前焦虑寻求鼓励', '两天后考研初试，背不进去心慌得厉害，想找位过来人不带压力地陪聊一会，给我点定心丸。', 1],
    ['月考倒计时求打气', '妹妹下周月考很紧张，想找个大哥哥大姐姐晚上陪她聊几分钟，夸夸她让她别怕。', 1],
    ['面试前求心理按摩', '明天大厂终面，紧张得睡不着，想找人陪我聊聊天稳定心态，顺便模拟闲聊练练表达。', 1],
    ['教资面试求陪伴', '周末教资面试有点发怵，想找个人陪我讲一遍试讲流程，给点鼓励和肯定，治治我的怯场。', 1],
    ['高考生弟弟求加油', '弟弟高三压力大想退学的念头，想找人开导开导他，让他知道再坚持一下就有希望。', 1]
  ],
  // W9 宠物陪伴
  '遛狗陪伴': [
    ['工作日帮遛柯基', '早上八点遛柯基半小时，家住桐梓林，狗狗性格好不乱跑，需要带零食给奖励。', 1],
    ['金毛早晚遛弯', '金毛精力旺，早晚各遛四十分钟，工资按次结算，需会使用牵引绳管得住力气大的狗。', 1],
    ['雪纳瑞临时代遛', '周末出差两天，需要早晚帮忙遛雪纳瑞并喂粮，晚上陪它玩十分钟玩具，它粘人但不咬。', 1],
    ['逛公园遛萨摩耶', '下午想去公园遛萨摩耶顺便晒太阳，狗狗亲人但力气有点大，需要同行帮手帮忙牵住。', 2],
    ['晚上突击班求代遛', '今晚加班到十点，家里泰迪憋一天了，求助近的邻居帮忙遛二十分钟，楼下小区内绕两圈就好。', 1]
  ],
  '喂猫照料': [
    ['出差三天的上门喂猫', '出差三天，家里的布偶猫需要早晚各喂一次，顺便铲屎换水，怕猫孤单最好陪它玩十分钟逗猫棒。', 1],
    ['国庆假期猫咪寄养', '国庆回老家，两只猫留在家里，需要每天上门喂粮、铲屎、检查状态并拍视频给我。', 1],
    ['帮老人喂流浪猫', '小区楼下有几只人喂惯的流浪猫，奶奶这几天住院想找人每天定点放粮喂水，猫很亲人。', 1],
    ['假期你家主子我来管', '猫需要每天上门照料，还要剪一下指甲（它很乖），喂完陪它玩几分钟，顺便收拾猫砂盆。', 1],
    ['布偶猫药浴后护理', '猫咪药浴后需要每日检查耳道上药，持续一周，需要细心温柔有养猫经验的朋友。', 1]
  ],
  '宠物就医陪同': [
    ['陪狗狗做绝育检查', '约了下午带金毛去宠物医院做术前检查，我一个人按住不放心，找个人帮我牵狗拿报告。', 2],
    ['猫咪治牙求陪同', '猫牙结石要全麻洗牙，我在外地担心，找个人帮忙全程陪同挂号缴费，结束后接猫回家。', 3],
    ['救救小流浪猫', '捡了只腿受伤的流浪猫想送去宠物医院，自己从没去过，求有经验的伙伴帮忙带路登记做检查。', 2],
    ['狗狗打疫苗代排队', '宠物医院打疫苗要排队一小时，我上班走不开，找人帮忙牵着柴犬排队，打完拍证明给我。', 2],
    ['宠物猫体检陪同', '猫咪要做年度体检，需要抽血B超，它看到医生就应激炸毛，想找个有经验的伙伴陪诊按住。', 2]
  ]
};

function genDemandNo() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `DR${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

// 软删匹配条件下的 max N 条 helper: 分页取 id → 20 一组 remove/update
async function softDeleteAll(colName, whereQuery, field) {
  let total = 0;
  for (let skip = 0; skip < 1000; skip += 100) {
    const r = await db.collection(colName).where(whereQuery).field({ _id: true }).skip(skip).limit(100).get().catch(() => ({ data: [] }));
    if (!r.data || !r.data.length) break;
    const ids = r.data.map((d) => d._id);
    for (let i = 0; i < ids.length; i += 20) {
      const chunk = ids.slice(i, i + 20);
      await db.collection(colName).where({ _id: _.in(chunk) }).update({ data: { [field]: true, updated_at: Date.now() } }).catch(() => {});
      total += chunk.length;
    }
  }
  return total;
}

exports.main = async (event) => {
  const wxCtx = cloud.getWXContext();
  const openid = wxCtx.OPENID || event.mock_openid || '';
  if (!openid) return { ok: false, code: 'no_openid', msg: '未获取到登录身份' };
  const action = event.action || 'run';

  let sceneList = [];
  try {
    const r = await db.collection('admin_config').doc('global').get();
    sceneList = (r.data && Array.isArray(r.data.scene_list) ? r.data.scene_list : [])
      .filter((s) => s && s.code && Array.isArray(s.options) && s.options.length > 0);
  } catch (e) { /* 配置读不到则不生成 */ }
  if (sceneList.length === 0) return { ok: false, code: 'no_scenes', msg: 'admin_config.scene_list 为空,无法生成' };

  const simOpenids = USERS.map((u) => u.openid);

  // ── 兼容旧[种子]路径(早期视觉测试用, 已废弃) ──
  if (action === 'count') {
    const n = (await db.collection('demand').where({ creator_openid: openid, remark: db.RegExp({ regexp: '^\\[种子' }), is_deleted: false }).count());
    return { ok: true, data: { count: n.total } };
  }
  if (action === 'cleanup') {
    const r = await db.collection('demand').where({ creator_openid: openid, remark: db.RegExp({ regexp: '^\\[种子' }), is_deleted: false })
      .update({ data: { is_deleted: true, updated_at: Date.now() } });
    return { ok: true, data: { cleaned: !!(r.stats && r.stats.updated > 0) } };
  }

  // ── simulate 批次统计 ──
  if (action === 'count_sim') {
    const n = (await db.collection('demand').where({ creator_openid: _.in(simOpenids), is_deleted: false }).count());
    return { ok: true, data: { count: n.total, users: simOpenids.length } };
  }

  // ── cleanup_sim: 软删虚拟用户 + 其名下全部需求 ──
  if (action === 'cleanup_sim') {
    const [demands, users] = await Promise.all([
      softDeleteAll('demand', { creator_openid: _.in(simOpenids), is_deleted: false }, 'is_deleted'),
      softDeleteAll('user_account', { openid: _.in(simOpenids), is_deleted: false }, 'is_deleted')
    ]);
    return { ok: true, data: { cleaned_demands: demands, cleaned_users: users } };
  }

  // ── simulate: 创建虚拟账号 + 每子场景 5 条真人感需求 ──
  if (action === 'simulate') {
    const now = Date.now();

    // 0) 收集子场景候选 (scene, subIdx, sub, i)
    const subjects = [];
    for (const s of sceneList) {
      if (!Array.isArray(s.options)) continue;
      for (const sub of s.options) {
        if (!CONTENT[sub]) continue; // 无文案库的子场景跳过(数量制不对齐时安全降级)
        for (let i = 0; i < 5; i++) subjects.push({ s, sub, i });
      }
    }

    // 1) 幂等: 一次 in 查询已有 crid
    const allCrids = subjects.map((c, idx) => `sim-${c.sub}-${idx}`);
    let existingSet = new Set();
    try {
      const existRes = await db.collection('demand').where({ client_request_id: _.in(allCrids) }).field({ client_request_id: true }).get();
      existingSet = new Set((existRes.data || []).map((d) => d.client_request_id));
    } catch (e) { /* in 查询失败则逐条写入, 跳过不阻塞 */ }

    // 2) 虚拟账号幂等建(缺的补)
    let userAdded = 0;
    {
      const existU = await db.collection('user_account').where({ openid: _.in(simOpenids) }).field({ openid: true }).get().catch(() => ({ data: [] }));
      const have = new Set((existU.data || []).map((u) => u.openid));
      const missing = USERS.filter((u) => !have.has(u.openid));
      if (missing.length) {
        const createdDays = missing.map(() => Math.floor(Math.random() * 20) + 1);
        await Promise.all(missing.map((u, idx) => db.collection('user_account').add({ data: {
          openid: u.openid,
          nickname: u.nickname,
          surname: u.surname,
          status: 'normal',
          is_deleted: false,
          created_at: now - createdDays[idx] * 86400000,
          updated_at: now - createdDays[idx] * 86400000
        }}).catch(() => {})));
        userAdded = missing.length;
      }
    }

    // 3) 构造需求 docs 并并发写入
    const docs = [];
    subjects.forEach((c, idx) => {
      const crid = allCrids[idx];
      if (existingSet.has(crid)) return;
      const tpls = CONTENT[c.sub];
      const tpl = tpls[c.i % tpls.length];
      const [title, desc] = tpl;
      const duration_h = tpl[2] || 2;
      const user = USERS[idx % USERS.length];
      const dayOffset = DAY_OFFSETS[idx % DAY_OFFSETS.length];
      const hour = HOURS[idx % HOURS.length];
      const st = new Date(now + dayOffset * 86400000);
      st.setHours(hour, 15, 0, 0);
      const start_time = st.getTime();
      const rate_fen = RATE_MIN + Math.floor(Math.random() * (RATE_MAX - RATE_MIN));
      const lat = +(30.58 + Math.random() * 0.16).toFixed(6);
      const lng = +(104.03 + Math.random() * 0.12).toFixed(6);
      const place = pick(PLACES);
      const createdAt = now - Math.floor(Math.random() * 12 * 3600000) - 60000; // 1min-12h 前发布
      const viewCount = Math.floor(Math.random() * 90) + 3;
      docs.push({
        demand_no: genDemandNo(),
        client_request_id: crid,
        creator_openid: user.openid,
        scene: c.s.code,
        project_attr: 'commercial',
        start_time,
        duration_h,
        location: { name: place, latitude: lat, longitude: lng, city: '成都' },
        publish_location: { name: place, latitude: lat, longitude: lng, city: '成都' },
        content_option: c.sub,
        content_options: [c.sub],
        remark: `${title}｜${desc}`,
        rate_fen,
        total_fen: rate_fen * duration_h,
        aa_tier: '0-50',
        aa_promise_signed: true,
        disclaimer_type: 'general_disclaimer',
        disclaimer_signed: true,
        disclaimer_signed_at: now,
        pet_auth_signed: false,
        pet_auth_signed_at: 0,
        match_mode: 'broadcast',
        applicants: [],
        matched_openid: null,
        status: 'matching',
        match_candidates: [],
        invited: [],
        broadcast: true,
        view_count: viewCount,
        expire_at: now + 24 * 3600 * 1000,
        created_at: createdAt,
        updated_at: createdAt,
        is_deleted: false
      });
    });

    const created = [];
    const BATCH = 20;
    for (let i = 0; i < docs.length; i += BATCH) {
      const chunk = docs.slice(i, i + BATCH);
      const results = await Promise.all(chunk.map((doc) =>
        db.collection('demand').add({ data: doc })
          .then(() => doc.client_request_id)
          .catch((e) => {
            db.collection('platform_event').add({ data: {
              level: 'P3', type: 'seed_fail', openid,
              payload: { crid: doc.client_request_id, message: String((e && e.message) || e) },
              created_at: Date.now(), updated_at: Date.now(), is_deleted: false
            }}).catch(() => {});
            return null;
          })
      ));
      for (const r of results) if (r) created.push(r);
    }

    return { ok: true, data: { created: created.length, skipped: subjects.length - created.length, user_added: userAdded, subjects: subjects.length, users: USERS.length } };
  }

  return { ok: false, code: 'bad_action', msg: '未知 action: ' + action };
};