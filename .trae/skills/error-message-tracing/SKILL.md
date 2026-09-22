# 报错文案溯源排查法（zhaoren 项目专用）

## 触发场景

- 用户反馈"点击某按钮弹错误提示"（如 `请先完成实名认证` / `请先登录` / `bad_key`）
- 同一报错连续 2 轮以上没修好、补丁打了又打
- 报错可能来自前端 `showModal/showToast` 或云函数返回的 `msg`
- 用户抱怨"问题依旧""原地踏步"、消耗大量时间/积分

## 核心原则

**报错文案先 grep 定位 → 用生产数据验证触发条件 → 最后才改代码。**

严禁在未定位出处前凭猜测改代码、改缓存、加绕过。

---

## 标准 5 步流程

### 第 1 步：grep 精确文案，枚举全部出处

小程序前端 + 云函数都要搜（云函数返回的 msg 会被前端 toast 弹出，文案不在前端）：

```
# 搜前端
Grep "请先完成实名认证" path=miniprogram
# 搜云函数
Grep "请先完成实名认证" path=cloudfunctions
# 同义词/变体一起搜
Grep "请先|请完成|需先|完成实名"
```

列一张表：**位置 | 触发场景 | 弹窗形态（showModal 白色 / showToast 深色）**。

### 第 2 步：用弹窗形态反推真凶

| 形态 | 特征 | 通常来源 |
|------|------|----------|
| 白色 showModal | 有标题/正文/两个按钮 | 前端代码显式 `wx.showModal` |
| 居中深色 toast | 一行字、几秒消失 | 前端 `showToast`，文案常是**云函数返回的 `r.msg`** |

用户截图能直接区分 → 不用改代码就能排除一半候选。

### 第 3 步：用生产数据验证守卫是否真能触发

调用生产接口查真实字段，**不要假设**：

```
POST /api { action: "user_list", page:1, size:50 }   # 查 is_realname_done 真实值
GET  /debug                                          # 查 env / admin_openids_count
```

- 若守卫条件在数据上**已不成立**（如账号全是 `done=true`）→ 该出处排除，别再改它
- 全量 dump 可疑配置（`config_get` 写临时文件再 Read）排除"文案存在 admin_config 里"

### 第 4 步：定位为何"本该生效的修复"没生效（缓存/鉴权链）

重点排查本项目两类高频暗坑：

1. **鉴权链断裂**：`admin-action` 对所有 action 有全局管理员白名单鉴权。小程序普通用户调 `config_get` → **必然失败**，依赖它写入 Storage/env 的后续逻辑全是**死代码**。
2. **跨进程缓存不可见**：`openid.js` 的 env 缓存是各云函数独立内存，init-db 的 `invalidateEnvCache()` 清不到 user-login 进程。

检查方法：顺着调用链读代码，确认"数据真的能走到你写的那行"，而不是"逻辑上应该走到"。

### 第 5 步：一次性改完，再验证

- 改**唯一可信数据源**（如服务端返回、持久化的 `userInfo.is_realname_done`），不要新增二次缓存标记
- 让守卫在读到权威值时**自愈**清残留标记
- 改完删除调试临时文件
- 给用户一条可自证的 Console 命令兜底（打印 Storage / globalData 真实值）

---

## 本项目已踩过的实证案例

### 案例：实名认证弹窗（2026-09-22）

**误判路径（4 轮空转）**：
1. 猜是 user-login env 缓存 → 改 user-login + 部署
2. 猜是前端 Storage 残留 → 加"env=dev 就放行"
3. 猜是 init-db 缓存没失效 → 加 invalidateEnvCache
4. 又改 user-login login case 直读 DB

全部打偏，因为**没先 grep 文案出处**。

**正确溯源（1 轮定位）**：
1. grep 出 3 处出处（bootstrap.js / demand-publish:259 / partner-apply:116）
2. `user_list` 实测 → 生产 4 账号 `is_realname_done` 全 true → 排除云函数两处
3. dump config → 无此文案 → 排除配置
4. 只剩前端 bootstrap.js
5. 读鉴权链 → 发现普通用户调 admin-action 必被拒 → `admin_config_env` 从没写进去 → 之前的"dev 放行"是死代码
6. 改为直读 `userInfo.is_realname_done`，done 时自愈清残留 → 解决

---

## 反模式（禁止）

- ❌ 没定位出处就开始改代码/部署
- ❌ 用新增缓存标记/绕过开关解决问题（制造新的不同步源）
- ❌ 改完就让用户"清缓存试试"，自己不查生产数据
- ❌ 口头宣称"已修复"却没有可复核的证据（接口返回/数据字段）

## CloudBase 高频代码坑：get().data 是数组，必须取 [0]

```js
// ❌ 错误: get() 返回 { data: [doc] }, 直接返回 r.data 拿到的是数组
async function getUser(openid) {
  const r = await col('user_account').where({ openid }).limit(1).get();
  return r.data || null;
}
// 数组永远 truthy(过判空), 但 user.is_realname_done / user.status 全 undefined → 守卫误判
```

```js
// ✅ 正确
return (r.data && r.data[0]) || null;
```

注意：`doc(id).get()` 返回的 `r.data` 是**单个对象**，不要取 `[0]`；只有 `.where().get()` 的 `r.data` 是数组。
排查守卫误判类问题时，优先 grep `return (r.data) || null` / `return r.data || null` 核对。
本项目曾中招函数：demand-publish / order-create / partner-apply 的 getUser、order-action 的 getConfirmation、safety-report 的 getActiveSos。

### 反向变体（2026-09-22 回归事故）：doc() + 数组解包

把 `where({_id:'global'}).limit(1).get()` 批量改成 `doc('global').get()` 时，**必须同步修改结果解包**：
where 版 `if (r.data && r.data.length) return r.data[0];` → doc 版必须改成 `if (r.data) return r.data;`
否则 `.length` 恒 undefined → **静默走 fallback 配置**（scene_list 丢失→"服务内容不在可选项内"），
或 `return r.data[0]` 返回 undefined → 调用方 TypeError。

**教训：批量替换查询写法属于"语义耦合改动"，必须 grep 复查每一处调用点的结果解包，不能只替换查询表达式。**
排查命令：`Grep "doc\\('global'\\)\\.get\\(\\)" -A 3` 逐处核对下一行是否残留 `.length` / `[0]`。
本次回归涉及 9 处/8 函数：demand-publish、order-create、order-action、order-timer、payment-mock、demand-match、partner-action、evaluation-submit（getConfig）+ safety-report（getAdminOpenids）。

## 效率自检触发

连续 2 轮"改了仍报同一错"→ 立即停止改代码，回到第 1 步重新 grep 溯源。
