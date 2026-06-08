# AI Werewolf

AI Werewolf 是一个 React + Vite + Capacitor 的狼人杀观战桌。项目当前只保留网页端、移动端、游戏引擎、DeepSeek 通信代理和规则兜底逻辑；
AI 玩家按时间线串行行动：公开发言、投票、夜间技能、警长流程、胜负结算和主持人复盘都会写入同一套房间文件。每个角色只能读取自己权限内的文件，公开信息和私有信息分离。

## 功能范围

- 支持 6、9、12 人局预设。
- 支持狼人、预言家、女巫、守卫、猎人、平民、警长流程。
- 用户可玩模型固定为 `DeepSeek`。
- 规则兜底只用于测试、异常兜底和离线开发。
- 桌面端为三栏观战台，移动端为座位横栏、主时间线和底部操作栏。
- 支持 Capacitor Android 工程。

## 目录结构

```text
ai-werewolf/
  src/
    App.jsx                         # 应用状态、页面流转、自动推进和历史保存
    components/GameScreens.jsx      # 选择、准备、对局、历史、弹窗等 UI 组件
    agents/                         # 提示词、角色口吻、结构化校验
    comms/                          # 模型上下文投影
    game/
      constants.js                  # 角色、阵营、规则、性格、速度、价格等常量
      utils.js                      # 通用工具、目标合法化、玩家/角色查询、JSON 解析
      files.js                      # 可见文件生成、公共文件压缩、文件刷新
      decisions.js                  # DeepSeek/规则兜底决策、fallback 记录
      engine.js                     # 时间线推进、夜晚/白天结算、警长/胜负逻辑
      rooms/                        # 6/9/12 人局配置
      history.js                    # 本地历史对局持久化
      platform.js                   # Web/Capacitor 平台辅助
    services/
      modelProvider.js              # provider 标准化和分发
      deepseek.js                   # DeepSeek 调用
  server/deepseek-server.mjs        # Web 端 DeepSeek 本地代理
  android/                          # Capacitor Android 工程
  docs/                             # 运行时架构文档
```

## 本地运行

```bash
npm install
npm run deepseek
npm run dev
```

默认端口：

- 前端：`http://localhost:5173/`
- DeepSeek 代理：`http://localhost:8787/`

构建：

```bash
npm run build
```

Android 同步与构建：

```bash
npm run android:sync
npm run android:build
```

## 验证命令

```bash
npm run lint
npm run test:rules
npm run build
```

## 敏感文件与外部文件

- `key.txt`：DeepSeek key，已忽略。
- `VITE_DEEPSEEK_API_KEY`：移动端可选构建环境变量；不要写入源码。
- `dist/`、Android build 目录、日志和测试结果都不纳入源码。



## 开发原则

- 角色行动必须读取自己权限内的可见文件，不得使用上帝视角。
- 公开任务可以跳身份、诈身份和强势站边，但不能泄露私有文件、狼队夜聊、刀口、救人或毒人对象。
- 预言家查验结果只区分 `wolf` 和 `not_wolf`；`not_wolf` 不能被说成查杀。
- 死亡、放逐、全票、多数票和遗言都不能直接证明隐藏身份。
- 夜间技能必须先写入当夜可见状态，再请求模型决策。
- AI 调用保持串行，避免文件上下文乱序。
