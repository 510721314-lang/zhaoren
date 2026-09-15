# 设计规范 Tokens（design-tokens）
> 本文件为全局唯一视觉数据源（SSOT）。TRAE 生成代码时禁止硬编码任何色值/字号，
> 一律引用 tokens.wxss 中的 CSS 变量。rpx基准：750rpx=375px，2rpx=1px。

## 1. 色彩系统

### 1.1 品牌色
| 变量名 | 值 | 用途 |
|---|---|---|
| --brand-primary | #07C160 | 主操作按钮/选中态/发布钮 |
| --brand-primary-press | #06AD56 | 按钮按压态 |
| --brand-primary-light | #F0FBF4 | 选中背景/模板快捷键底色 |
| --brand-accent | #ff6b35 | 强调橙：激励banner/标注 |
| --brand-accent-light | #FFF3E0 | 橙色浅底 |

### 1.2 功能色
| 变量名 | 值 | 用途 |
|---|---|---|
| --func-danger | #fa5151 | 价格/错误/紧急求助/必填星号 |
| --func-danger-light | #FFE9EC | 危险浅底 |
| --func-warning | #ff8f3c | 进行中/等待确认/AA提示 |
| --func-warning-light | #FFF7E8 | 提醒条底色 |
| --func-success | #0a8f4d | 成功/公益标签/已确认 |
| --func-success-light | #E8F7EE | 公益浅底/卖点条底 |
| --func-info | #2f6fed | 信息/就医场景/链接 |
| --func-info-light | #E8F1FF | 就医场景底色 |
| --func-purple | #6b4fe8 | 学习陪伴场景 |
| --func-purple-light | #EDE8FF | 学习场景底色 |

### 1.3 文字色
| 变量名 | 值 | 用途 |
|---|---|---|
| --text-1 | #222222 | 主标题/金额强调 |
| --text-2 | #444444 | 正文 |
| --text-3 | #666666 | 次要说明 |
| --text-4 | #8a9099 | 辅助信息/meta |
| --text-5 | #9aa0a6 | 弱提示/禁用文案 |
| --text-disabled | #c0c5cc | 禁用/字数统计 |

### 1.4 背景与边框
| 变量名 | 值 | 用途 |
|---|---|---|
| --bg-page | #F6F7F9 | 页面底 |
| --bg-card | #FFFFFF | 卡片 |
| --bg-input | #FAFAFB | 输入框 |
| --bg-segment | #F1F2F5 | 分段控件/搜索框 |
| --bg-mask | rgba(0,0,0,0.45) | 弹窗遮罩 |
| --bg-night | rgba(15,20,30,0.82) | R1夜间遮罩 |
| --border-1 | #e5e7eb | 输入框/卡片描边 |
| --border-2 | #f0f0f0 | 分割线 |
| --border-divider | #f5f5f5 | 列表分隔 |

### 1.5 场景图标底色（一期5场景）
| 场景编码 | 底色 | 图标 |
|---|---|---|
| medical_escort | #E8F1FF | 🏥 |
| study_companion | #EDE8FF | 📚 |
| life_assist | #FFF3E0 | 🧾 |
| travel_companion | #E0F5F4 | 🚄 |
| online_companion | #FFE9EC | 💬 |

## 2. 字体系统
| 变量名 | 值 | 用途 |
|---|---|---|
| --font-xs | 20rpx | 角标/字数统计/极弱提示 |
| --font-sm | 22rpx | 标签/meta/说明 |
| --font-base | 24rpx | 正文辅助/列表副文案 |
| --font-md | 26rpx | 正文/按钮 |
| --font-lg | 28rpx | 卡片标题 |
| --font-xl | 30rpx | 导航标题/区块标题 |
| --font-xxl | 34rpx | 大标题/金额大字 |

字重：400常规 / 600半粗(标题按钮) / 700粗(页面主标题)
行高：统一1.5；标题1.4

## 3. 间距系统
--sp-xs:8rpx / --sp-sm:16rpx / --sp-md:20rpx / --sp-lg:28rpx / --sp-xl:40rpx
卡片内边距：24rpx 28rpx；卡片间距：20rpx；页面左右边距：20rpx

## 4. 圆角
--r-sm:16rpx(输入框/小标签) / --r-md:24rpx(按钮/输入) / --r-lg:28rpx(卡片) / --r-xl:32rpx(弹窗顶部) / 50%(头像/圆钮)

## 5. 阴影
--shadow-card: 0 2rpx 12rpx rgba(0,0,0,0.04)
--shadow-float: 0 12rpx 28rpx rgba(0,0,0,0.15)
--shadow-pub: 0 12rpx 28rpx rgba(7,193,96,0.4)  // 发布钮专用

## 6. 组件样式规范

### 6.1 按钮
| 类型 | 样式 |
|---|---|
| primary | 底--brand-primary/白字/--font-md 600/高76rpx/圆角--r-md；按压--brand-primary-press |
| ghost | 白底/1rpx solid #d9dce1/字--text-3 |
| danger-btn | 底--func-danger/白字（紧急类操作） |
| disabled | 底#DCE3DA/白字/禁点 |
| mini | 高56rpx/圆角28rpx/左右pad 32rpx（卡片内"抢单/帮TA"用） |

### 6.2 卡片
白底/圆角--r-lg/内边距24rpx 28rpx/--shadow-card/卡片间距20rpx

### 6.3 标签 tag
| 类型 | 样式 |
|---|---|
| scene-tag | 场景色底+场景色字/20rpx字/pad 4rpx 12rpx/圆角10rpx |
| tag-gongyi | --func-success-light底/--func-success字/600字重（公益免费） |
| tag-aa | --brand-accent-light底/#B26A00字（AA自理） |
| status-tag | 13态：S1紫/S2蓝/S3橙/S5绿/S6灰/S10.5红（底色同功能色light系） |

### 6.4 输入控件
- 输入框：高68rpx/--bg-input底/--border-1描边/圆角--r-sm/pad 0 20rpx
- textarea：高100rpx/内边距14rpx 20rpx/右下角字数统计（--font-xs --text-disabled）
- 必填星号：--func-danger，位于label前
- label：--font-base 600 --text-2

### 6.5 分段控件 segment
--bg-segment底/圆角18rpx/内pad 6rpx/选中项白底+--brand-primary字700+微阴影

### 6.6 筛选chips
高60rpx/圆角30rpx/--bg-segment底--text-3字；选中--brand-primary底白字600；横向滚动

### 6.7 底部弹窗 bottom-sheet
白底/顶部圆角--r-xl/上pad 32rpx 下pad 52rpx/顶部居中拖拽条(80rpx×8rpx #E0E0E0)/遮罩--bg-mask

### 6.8 四确认进度条
4段flex/每段高8rpx圆角4rpx/完成--brand-primary/当前--func-warning/未完成#e5e7eb；段间距8rpx；下方步骤文字--font-xs

### 6.9 模板消息卡（IM）
白底圆角20rpx/头部色带28rpx高（时间地点内容=--brand-primary，费用=--func-warning）白字20rpx/主体pad 16rpx 20rpx --font-sm/选项行border-top分隔，等分3列，选项态：已选--brand-primary 700/已失效--text-5/待选--func-info

### 6.10 TabBar
高160rpx含安全区/白底border-top --border-2/5位：首页🧭广场💬消息(+)发布👤我的/选中--brand-primary/未选--text-5/中央发布钮：104rpx圆钮上浮52rpx/--brand-primary底白字＋号/--shadow-pub/下方"发布"20rpx绿字

### 6.11 提示条
| 类型 | 样式 |
|---|---|
| 卖点条 | --func-success-light底/--func-success字/60rpx高/居中/图标+文案 |
| 提醒条 | --func-warning-light底/#B26A00字/居中 |
| 夜间遮罩 | --bg-night全屏/中央白卡560rpx宽圆角32rpx/🌙图标/标题+说明+预约按钮 |

### 6.12 空状态 empty-state
居中图标(96rpx)+主文案--text-3+副文案--text-5+可选操作按钮

## 7. 图标规范
一期使用 emoji + 纯CSS形状（TRAE不引入图标库，减小包体）。
后续替换为iconfont时仅需改image路径，样式不变。
