---
alwaysApply: false
globs: app.json,project.config.json,project.private.config.json,sitemap.json,ext.json
---

# 小程序配置文件保护规则

修改以下任一文件前，必须先向我说明改动原因与影响，获得明确批准后才可写入：
app.json / project.config.json / project.private.config.json / sitemap.json / ext.json

硬性禁止：
- 禁止修改 project.private.config.json 的任何内容
- 禁止修改 appid、miniprogramRoot、plugin、packNpmManually / packNpmRelationList
- 禁止调整目录映射
- 禁止调高或调低基础库最低版本
- 禁止开启或关闭 Skyline 渲染引擎（renderer / rendererOptions / componentFramework）
- 禁止改动或删除已存在的 pages / subPackages / tabBar 配置；新增页面只能追加，不能重排

修改后必须输出：1. 逐条 diff 说明；2. 需要重新编译 / 重新构建 npm / 重新上传的提示；3. 必须回归的功能清单（页面路由、tabBar、分包加载、登录启动链路）。
