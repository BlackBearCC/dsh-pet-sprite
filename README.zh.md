# dsh-pet-sprite

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）Web UI 的**可玩**像素桌宠插件。

不是挂件看板——它活在你的聊天区里，**把消息气泡当平台跳跃**，你随时可以亲自接管操作。同时携带一套由 agent **真实 token 用量**驱动的完整养成系统。

## 功能

- **平台跳跃游乐场** —— 桌宠把聊天消息气泡当作平台：自己闲逛、攀爬气泡侧沿、在消息之间蹦跳。
- **玩家操控** —— 点击聊天区空白处接管：`A/D` 移动、`空格` 跳跃（空中再按一次=技能跳）、`W` 攀爬、`S` 落下穿板。10 秒不操作自动还给 AI。
- **点击连击** —— 点击桌宠累计连击数（持久化），附带金色粒子爆发。
- **Agent 状态联动** —— 模型流式输出时，桌宠坐下敲自己的小电脑；空闲时眨眼、散步、打盹。
- **养成系统**（PetClaw 引擎移植）：心情/电量/健康三属性 + 衰减与联动、Lv.1-100 等级称号、金币、背包、等级解锁 + 每日限购的商店。
- **Token 经济闭环** —— 你的输入 token 消耗桌宠电量，每次回复完成把输出 token 折算成经验，每日首次打开领登录金币，升级减缓属性衰减。

右键桌宠打开照顾面板（状态/互动/背包/商店），面板跟随角色位置弹出。

## 安装

```sh
dsh plugin --profile web add github:<your-account>/dsh-pet-sprite
```

重启 DSH（`dsh web`），打开任意会话——桌宠会出现在聊天流底部。

> `lib/` 构建产物已提交，git 安装无需授权构建脚本。如需从源码重新构建：`pnpm install && pnpm build`。

## 工作原理

- 通过 `dsh.client` 浏览器插件 manifest 注册进 DSH Web UI 的 `shell.overlay` slot。
- 平台从 `[data-chat-flow-key]` 消息节点自动发现，场地是会话滚动可视区，滚动和新消息实时自适应。
- 游戏状态（属性/等级/金币/背包）持久化在 `localStorage`——无服务端、无埋点、零网络请求。

## 兼容性

- DSH developer preview（基于 `0.1.0-rc.7` 测试）。DSH 迭代很快、存在破坏性变更；如需稳定请锁定 commit（`github:<you>/dsh-pet-sprite#<sha>`）。

## 许可

MIT
