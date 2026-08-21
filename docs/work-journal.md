# 工作日志：日报与周报

宠物住在对话流里，是唯一全程在场的「见证者」。本文档描述日报/周报的数据采集、生成链路与奖励结算规则。对应代码：

- 数据层：`src/client/game/witness-log.ts`
- 生成链路：`src/index.ts`（`/witness` 路由）、`src/client/CarePanel.tsx`（`doWitness`）
- 埋点桥接：`src/client/ChatPet.tsx`（`bridgeChat`、`wireWitnessBus`）

所有生成均为**按钮手动触发**，无任何自动打扰。

---

## 1. 数据采集（埋点）

### 1.1 记录事件

| 事件 | 触发点 | 写入字段 |
| --- | --- | --- |
| 用户发消息 | `bridgeChat` 检测到 `[data-chat-flow-kind="user"]` 节点数增加 | `turns++`，`inChars += 文本长度` |
| 助手完成 | 流式输出结束（`[data-streaming]` 出现→消失） | `tasks++`，`outChars += 末节点文本长度` |
| 喂食 / 玩耍 / 休息 | CarePanel `doUse` / `doPlay` / `doRest` 成功后 | `feed++` / `play++` / `rest++` |
| 升级 | `level:up` 事件总线（`wireWitnessBus`，每页加载只接一次） | `levelUps++` |

### 1.2 活动窗口与凌晨标记

每次**写入类**调用都会 touch 活动窗口：

- `firstAt`：当天首次活动时间戳；`lastAt`：最近活动时间戳
- 本地时间 0:00–5:00 之间的活动置 `night = true`（夜猫子标记）
- **读取类**调用（显示摘要、缓存日志文本、结算奖励）不 touch 活动窗口——打开面板不算干活

### 1.3 存储

- localStorage key：`dshPetSpriteWitness:days`，按**本地日期**（`YYYY-MM-DD`）为 key 的记录表
- 每条记录保留：`turns / tasks / inChars / outChars / firstAt / lastAt / night / feed / play / rest / levelUps / rewarded / lastLog`
- 写入时裁剪至最新 **14 天**
- 存储损坏（JSON 解析失败）时降级为空记录重新开始，不抛错

---

## 2. 日报生成

### 2.1 数据与请求

状态 tab「生成日报」按钮 → `doWitness('day')`：

1. 读 `getWitnessDay()`，取当日字段；`spanMinutes = (lastAt - firstAt) / 60000`（无活动为 0）
2. `POST /plugins/dsh-pet-sprite/witness`，body：

```json
{
  "scope": "day",
  "petName": "...", "persona": "...", "lang": "navigator.language",
  "provider": "...", "model": "...",
  "day": { "turns": 0, "tasks": 0, "inChars": 0, "outChars": 0,
           "spanMinutes": 0, "night": false, "feed": 0, "play": 0, "rest": 0, "levelUps": 0 }
}
```

### 2.2 服务端

- 安全校验：`Sec-Fetch-Site` + `content-type: application/json`（防跨站盗刷 token），不通过返回 415
- system prompt：`personaPrompt`——用户在设置 tab 写的角色设定优先，否则默认宠物口吻
- user prompt（`witnessPrompt` day 分支）：
  - 附上当日全部数字（凌晨标记按条件附注）
  - 要求：以宠物口吻写给用户本人，**80 字以内，一到三句话**
  - 挑一两个最有特点的数字自然写入，禁止罗列清单；带见证者态度（心疼/骄傲/吐槽）
  - 当天无活动时轻轻调侃
- `maxTokens: 200`；返回 `{ "log": "..." }`

### 2.3 前端落地

- 文本存入当日记录的 `lastLog`（`saveLogText`，不 touch 活动窗口）
- 通过宠物气泡说出（`onPetSay`），同时显示在状态 tab 黄色日志框（标签「今日日报」）
- 重新生成覆盖旧文本，**不扣任何费用**（走用户自己配置的模型）

---

## 3. 周报生成

### 3.1 数据聚合

`getWitnessWeek()` 取**近 7 天滚动窗口**（含今天，空白天零填充；越界天不进统计）：

- `activeDays`：有任意活动的天数（turns/tasks/feed/play/rest/levelUps 任一 > 0）
- `turns / tasks / inChars / outChars / feed / play / rest / levelUps`：7 天求和
- `nights`：`night = true` 的天数
- `spanMinutes`：周内最早 `firstAt` 至最晚 `lastAt` 的总跨度

请求同 `/witness`，`scope: "week"`，`day` 换成周聚合字段（含 `activeDays`、`nights`）。

### 3.2 服务端（week 分支）

- 要求：**120 字以内，两到四句话**
- 引导看**趋势与对比**：哪几天最猛、有没有连着熬夜、周末歇没歇
- `maxTokens: 300`

### 3.3 周缓存

- localStorage key：`dshPetSpriteWitness:week`，结构 `{ weekStart, lastLog, rewarded }`
- `weekStart` = 当前**自然周的周一**日期 key；与存储值不匹配即视为新周，缓存与奖励状态自动重置
- 显示标签「本周周报」

---

## 4. 奖励结算规则

| 规则 | 日报 | 周报 |
| --- | --- | --- |
| 见证费 | 每天首次生成成功 +🪙20 | 每周（周一起算）首次生成成功 +🪙50 |
| 结算去重 | 当日记录 `rewarded` 标记 | 周缓存 `rewarded` 标记 |
| 重复生成 | 免费（覆盖缓存文本，不再发币） | 免费（同左） |
| 互不干扰 | 日/周奖励各自独立结算 | — |
| 失败不结算 | 模型报错/空回复时不发币、不置标记 | 同左 |
| 来源标记 | `witness_day` / `witness_week` | — |

结算时序：模型返回成功 → 缓存文本 → 气泡播报 → `claim` 判定 → 发币 + toast 提示；`claim` 返回 false 时仅提示「已更新」。

---

## 5. 面板展示逻辑

- 状态 tab 工作日志区显示两行摘要：
  - **今日**：对话 N 轮 · 完成 M 件 · 输出 X（≥1 万显示「X.X 万字」）·（凌晨仍在干活）
  - **本周**：活跃 D 天 · 对话 N 轮 · 输出 X ·（D' 天熬到凌晨）
- 「生成日报」「生成周报」并排双按钮，互斥 busy 态（任一在写时另一个禁用）
- 日志框显示最近一次生成的内容（打开面板时优先当天日报缓存，其次周报缓存），标签标注来源
- 数字每次渲染实时读取，交互后即时刷新
