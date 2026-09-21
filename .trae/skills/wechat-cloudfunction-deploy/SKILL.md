---
name: wechat-cloudfunction-deploy
description: 微信小程序云函数部署与排障规范。Use when deploying cloud functions via CLI, debugging cloud.callFunction failures, or fixing Cannot find module wx-server-sdk errors. Do not use for miniprogram frontend upload.
---

# 微信小程序云函数部署与排障

## 部署命令（铁律）

**必须用 `--remote-npm-install`**，禁止本地打包 node_modules 上传：

```powershell
& $cli cloud functions deploy --env <envId> --names <funcName> --remote-npm-install --project <projectPath>
```

原因：Windows CLI 打包 node_modules 时路径分隔符用 `\`，云端 Linux `require` 找不到模块。`--remote-npm-install` 让云端自己 npm install，产物是 Linux 路径。

## project.config.json 禁忌

`packOptions.ignore` 里**绝对不能包含** `node_modules`：

```json
{ "value": "node_modules", "type": "folder" }  // ❌ 会误杀云函数依赖
```

此规则本意是给小程序上传用，但 CLI 的 `cloud functions deploy` 也会读取，导致云函数的 node_modules 被剥离。

## 部署后验证

1. **download 验证依赖**：
```powershell
& $cli cloud functions download --env <envId> --name <funcName> --path <dest> --project <projectPath>
```
检查 `dest\node_modules\wx-server-sdk\index.js` 是否存在。

2. **确认云端 npm install 完成**：`--remote-npm-install` 部署后等 **90-120 秒**再调用，否则可能还在安装中。

## 排障流程（首页/列表为空时）

### 第一步：暴露真实错误

云函数里的 `.catch(() => ({ data: [] }))` 会静默吞错。排查时临时改成：

```js
.catch((e) => { console.error('QUERY FAIL:', e && e.message); return { data: [], _err: e && e.message }; })
```

前端 `success` 回调里弹窗显示完整返回：

```js
success: (res) => {
  const r = res.result || {};
  if (!r.ok) {
    wx.showModal({ title: 'cloud FAIL', content: JSON.stringify(r).slice(0, 500), showCancel: false });
  }
}
```

### 第二步：判断错误类型

| 错误 | 根因 | 修复 |
|------|------|------|
| `Cannot find module 'wx-server-sdk'` | 依赖没装上 | 用 `--remote-npm-install` 重新部署 |
| `db.collection(...).createIndex is not a function` | wx-server-sdk 4.0.2 不支持 createIndex | 去掉 createIndex，索引用 init-db 或控制台手动建 |
| 查询返回空数组但不报错 | 缺复合索引（等值+范围+orderBy） | 在云开发控制台手动建索引 |

### 第三步：诊断目录结构

如果怀疑依赖问题，在云函数 index.js 开头加：

```js
const fs = require('fs');
console.log('FILES:', fs.readdirSync(__dirname).join(','));
```

正常应看到 `node_modules` 目录。如果看到 `node_modules\wx-server-sdk\index.js` 这种带 `\` 的文件名，说明是 Windows 打包路径问题。

## wx-server-sdk 4.0.2 不支持的 API

- `db.collection().createIndex()` ❌
- 索引管理需要在云开发控制台手动操作，或用 init-db 的 createCollection

## 增量部署

只改了单个文件时用 `inc-deploy` 更快：

```powershell
& $cli cloud functions inc-deploy --env <envId> --name <funcName> --file index.js --project <projectPath>
```

## GUI vs CLI 部署差异

| 方式 | node_modules 处理 | 路径分隔符 | 可靠性 |
|------|-------------------|-----------|--------|
| GUI 右键上传 | 正确打包 | Linux `/` | 高 |
| CLI deploy（本地 node_modules） | 可能被 ignore 剥离 | Windows `\` | 低 |
| CLI deploy --remote-npm-install | 云端安装 | Linux `/` | 高 |

**结论：CLI 部署一律用 `--remote-npm-install`。**
