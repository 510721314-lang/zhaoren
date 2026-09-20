# 微信小程序开发规范（始终生效）

## 项目结构
- pages/ 放页面，components/ 放组件，utils/ 放工具函数
- api/ 集中管理接口，request/ 封装 wx.request
- config/ 放环境配置，不要硬编码敏感信息

## 编码约定
- 使用 CommonJS（require/module.exports），不用 ESM
- 页面生命周期：onLoad → onShow → onReady → onHide → onUnload
- setData 只传必要字段，避免传大数据对象
- wx.request 必须统一封装，带拦截器处理 401/token 过期

## 禁止项
- 禁止在 app.json 中放敏感配置
- 禁止页面间通过 getCurrentPages() 随意通信
- 禁止 onPageScroll 中调用 setData
- 禁止 tabBar 页面使用 redirectTo/reLaunch 跳转
