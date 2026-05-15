# 服务器权威改造清单

日期：2026-05-15

## 结论先说

- 对当前项目这类“实时平台跳跃 + 动态陷阱 + 公网联机”玩法，长期最优路线是：`服务器权威模拟 + 本地预测 + 远端插值`
- 但不要把它理解成“把现在的前端逻辑直接复制到 Worker 就行”
- 正确做法是先抽出一层**共享纯模拟核心**，再让客户端和 Worker 都基于这层核心工作

## 目标架构

### 最终形态

- Worker / 房间服务器：
  - 权威推进游戏 tick
  - 接收玩家输入
  - 计算玩家移动、碰撞、陷阱、金币、终点、死亡、复活、计分
  - 广播权威快照
- 本地客户端：
  - 本地玩家做输入采集与视觉预测
  - 远端玩家做插值显示
  - 不再负责拍板游戏结果
- 单机 / 本地模式：
  - 仍然可以保留
  - 只是不再直接依赖 UI 状态机里的联机逻辑
  - 而是调用同一份共享模拟核心，在本地进程里运行

### 必须遵守的原则

- 模拟层不能依赖 `p5`
- 模拟层不能依赖 `Date.now()` / `performance.now()` 来决定结果
- 模拟层尽量不使用 `Math.random()`；必须随机时要使用可复现 seed RNG
- 所有会影响胜负的逻辑都要按固定 tick 推进
- 客户端渲染层只能读状态，不能偷偷改权威结果

## 当前项目的问题

### 当前权威位置

- 跑酷真实模拟目前在 [RunState.js](/E:/code/chicken_horse/src/states/RunState.js:1)
- 联机房间与转发在 [GameRoom.js](/E:/code/chicken_horse/workers/src/GameRoom.js:1)
- 这意味着当前是“前端主机权威”，不是“服务器权威”

### 当前阻碍服务器权威的关键点

- `RunState` 把状态推进、渲染前准备、陷阱交互、计分混在一起
- `Player` 与障碍物逻辑大量直接依赖前端对象
- 多处使用 `Math.random()`：
  - 地图/金币生成
  - 箭矢、炮弹、尖刺球、传送器、蘑菇传送器等
- 多处使用 `Date.now()`：
  - 无敌时间
  - 死亡统计窗口
  - 网络显示逻辑
- 障碍物类共 23 个，都需要区分“模拟逻辑”和“渲染逻辑”

## 改造分期

### Phase 0：定边界

- [ ] 明确“哪些状态由服务器拍板”
- [ ] 明确“哪些状态允许客户端只做视觉预测”
- [ ] 冻结当前联机协议，避免一边大改一边继续加功能

建议的服务器权威范围：

- 玩家位置、速度、朝向、跳跃次数、落地状态
- 死亡、复活、终点、金币拾取
- 陷阱状态、移动平台位置、投射物
- 回合时间、排名、结算

建议保留客户端视觉层处理：

- 动画帧播放
- 特效
- 音效
- UI 过渡

### Phase 1：抽共享模拟核心

目标：把“决定结果的玩法逻辑”从前端状态机里拆出来。

建议新增目录：

- [ ] `src/sim/`
- [ ] `src/sim/core/`
- [ ] `src/sim/entities/`
- [ ] `src/sim/obstacles/`

首批需要抽出的核心模块：

- [ ] 从 [RunState.js](/E:/code/chicken_horse/src/states/RunState.js:1) 抽出 `runStep(state, inputs, dt)`
- [ ] 从 [Player.js](/E:/code/chicken_horse/src/entities/Player.js:1) 抽出不依赖 `p5` 的玩家运动/碰撞状态
- [ ] 从 [PhysicsSystem.js](/E:/code/chicken_horse/src/systems/PhysicsSystem.js:1) 抽出纯函数碰撞
- [ ] 从 [RespawnManager.js](/E:/code/chicken_horse/src/systems/RespawnManager.js:1) 抽出纯 tick 驱动复活逻辑
- [ ] 从 [TimeManager.js](/E:/code/chicken_horse/src/systems/TimeManager.js:1) 抽出服务器倒计时与终局判断
- [ ] 从 [ScoreManager.js](/E:/code/chicken_horse/src/systems/ScoreManager.js:1) 保留计分，但把所有“依赖当前真实时间”的统计改成 tick/事件驱动

### Phase 2：先做最小服务器权威版本

目标：先做“能玩、稳定”的权威版，不一次迁移所有 23 个陷阱。

第一阶段建议只保留这些障碍物：

- [ ] `PLATFORM`
- [ ] `MOVING_PLATFORM`
- [ ] `SPIKE`
- [ ] `SAW`
- [ ] `FLAME`
- [ ] `BOUNCE_PAD`

第一阶段暂时禁用或后迁移：

- [ ] `TELEPORTER`
- [ ] `BOMB`
- [ ] `SHADOW`
- [ ] `BLACK_HOLE`
- [ ] `MUSHROOM_TELEPORTER`
- [ ] `LASER`
- [ ] `ARROW`
- [ ] 其他带明显随机或复杂局部状态的陷阱

原因：

- 这些复杂陷阱迁移成本高
- 先把“玩家运动 + 基础陷阱 + 权威回合闭环”跑通，收益最大

### Phase 3：Worker 成为真正权威模拟器

目标：不再让主机前端拍板跑酷结果。

需要改的主要文件：

- [ ] [GameRoom.js](/E:/code/chicken_horse/workers/src/GameRoom.js:1)
  - 加固定 tick
  - 保存完整权威世界状态
  - 消费每个玩家输入队列
  - 输出快照
- [ ] [index.js](/E:/code/chicken_horse/workers/src/index.js:1)
  - 保持路由入口，但补健康/调试信息
- [ ] 协议层 [MessageTypes.js](/E:/code/chicken_horse/src/network/MessageTypes.js:1)
  - 明确输入、快照、事件消息结构

Worker 内新增建议：

- [ ] `workers/src/sim/` 或复用 `src/sim/`
- [ ] `workers/src/serializer/`
- [ ] `workers/src/tick/`

### Phase 4：客户端改成“显示 + 预测 + 纠正”

主要改动：

- [ ] [NetworkRunState.js](/E:/code/chicken_horse/src/states/NetworkRunState.js:1) 重写成“只管联网渲染与预测”
- [ ] 本地玩家：输入预测 + 权威纠正
- [ ] 远端玩家：插值
- [ ] 客户端不再直接决定金币、死亡、终点

### Phase 5：补齐随机与可重复性

必须处理：

- [ ] 把模拟相关的 `Math.random()` 改成 seed RNG
- [ ] 把模拟相关的 `Date.now()` 改成 tick 时间
- [ ] 把障碍物状态推进统一到固定步长

当前明显需要处理的随机点包括：

- [ ] [Coin.js](/E:/code/chicken_horse/src/entities/Coin.js:1)
- [ ] [Cannon.js](/E:/code/chicken_horse/src/entities/obstacles/Cannon.js:1)
- [ ] [Arrow.js](/E:/code/chicken_horse/src/entities/obstacles/Arrow.js:1)
- [ ] [SpikedBall.js](/E:/code/chicken_horse/src/entities/obstacles/SpikedBall.js:1)
- [ ] [Teleporter.js](/E:/code/chicken_horse/src/entities/obstacles/Teleporter.js:1)
- [ ] [MushroomTeleporter.js](/E:/code/chicken_horse/src/entities/obstacles/MushroomTeleporter.js:1)
- [ ] [MapManager.js](/E:/code/chicken_horse/src/systems/MapManager.js:1)
- [ ] [TiledMapLoader.js](/E:/code/chicken_horse/src/maps/TiledMapLoader.js:1)

### Phase 6：逐个迁移剩余陷阱

当前障碍物文件共 23 个，建议按复杂度逐步迁：

- [ ] 简单静态类
- [ ] 周期性陷阱类
- [ ] 移动平台类
- [ ] 投射物类
- [ ] 传送/黑洞/影子等复杂交互类

## 文件级工作量评估

### 必改核心文件

- [ ] [src/states/RunState.js](/E:/code/chicken_horse/src/states/RunState.js:1)
- [ ] [src/states/NetworkRunState.js](/E:/code/chicken_horse/src/states/NetworkRunState.js:1)
- [ ] [src/entities/Player.js](/E:/code/chicken_horse/src/entities/Player.js:1)
- [ ] [src/systems/PhysicsSystem.js](/E:/code/chicken_horse/src/systems/PhysicsSystem.js:1)
- [ ] [src/systems/RespawnManager.js](/E:/code/chicken_horse/src/systems/RespawnManager.js:1)
- [ ] [src/systems/TimeManager.js](/E:/code/chicken_horse/src/systems/TimeManager.js:1)
- [ ] [src/systems/ScoreManager.js](/E:/code/chicken_horse/src/systems/ScoreManager.js:1)
- [ ] [src/systems/MapManager.js](/E:/code/chicken_horse/src/systems/MapManager.js:1)
- [ ] [src/maps/TiledMapLoader.js](/E:/code/chicken_horse/src/maps/TiledMapLoader.js:1)
- [ ] [src/network/NetworkManager.js](/E:/code/chicken_horse/src/network/NetworkManager.js:1)
- [ ] [src/network/MessageTypes.js](/E:/code/chicken_horse/src/network/MessageTypes.js:1)
- [ ] [workers/src/GameRoom.js](/E:/code/chicken_horse/workers/src/GameRoom.js:1)
- [ ] [workers/src/index.js](/E:/code/chicken_horse/workers/src/index.js:1)

### 大概率要明显改动的障碍物

- [ ] [src/entities/obstacles](/E:/code/chicken_horse/src/entities/obstacles)

## 真实工作量判断

- 如果只做“最小权威跑酷闭环”：中到大
- 如果要把现有全部陷阱完整迁过去：大
- 文件级改动量预估：
  - 第一阶段：`15 - 20` 个文件
  - 完整迁移：`35 - 50` 个文件

## 关于新项目应该怎么做

### 下一个项目是否应该一开始就做服务器权威

不一定，但**应该一开始就按“未来可服务器权威”去设计**。

推荐原则：

- 单机也用固定 tick 模拟
- 模拟层与渲染层分离
- 不让 UI 状态机直接决定玩法结果
- 随机与时间统一抽象
- 网络层从一开始就只发送“输入 / 事件 / 快照”，不要把玩法写死在界面层

### 哪些项目一开始就适合服务器权威

- 公网实时 PvP
- 物理碰撞很重要
- 竞技性强
- 有掉线重连、观战、防作弊需求

### 哪些项目不一定要一开始做服务器权威

- 纯本地多人
- 小规模好友房
- 回合制/低频同步游戏
- 原型验证阶段

## 本地模式还可不可以玩

可以，而且应该保留。

正确做法不是“有了服务器权威就不能单机”，而是：

- 单机模式：
  - 本地进程直接跑共享模拟核心
- 联机模式：
  - Worker 跑同一份共享模拟核心

也就是说：

- 共享的是“模拟核心”
- 区别只是“谁在驱动 tick，谁是权威”

## 下一步建议

### 推荐下一步

- [ ] 先回退当前不稳定的联机预测改动到稳定基线
- [ ] 新建 `src/sim/`，开始抽共享纯模拟核心
- [ ] 第一阶段只做最小服务器权威跑酷版本

### 第一阶段完成标准

- [ ] 两名玩家都由 Worker 权威驱动
- [ ] 客户端只负责输入、渲染、UI
- [ ] 玩家移动、跳跃、掉落、死亡、复活、金币、终点结果由 Worker 决定
- [ ] 至少 4~6 个基础陷阱可正常联机
