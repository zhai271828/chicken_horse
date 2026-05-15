# 共享模拟层基线更新

日期：2026-05-15

## 本次目标

- 回退不稳定的客机预测/纠正逻辑，恢复可玩的主机权威联机基线
- 为后续服务器权威重构建立第一批 `src/sim/` 共享纯模块

## 已完成

- 从 [NetworkRunState.js](/E:/code/chicken_horse/src/states/NetworkRunState.js:1) 中移除：
  - 客机本地预测
  - 输入序号回滚
  - 本地视觉回拉偏移
  - 逐帧远端输入队列消费
- 恢复为更稳定的主机权威联机行为：
  - 客机只发送输入
  - 主机推进跑酷逻辑
  - 客机使用主机快照与远端插值显示
- 新增共享纯辅助模块：
  - [fixedStep.js](/E:/code/chicken_horse/src/sim/core/fixedStep.js:1)

## 新增模块说明

- `src/sim/core/fixedStep.js`
  - 不依赖 `p5`
  - 只负责固定步长累计与消费
  - 之后客户端本地单机、Worker 权威 tick 都可以复用

## 测试与验证

- `npm run lint`
- `npm test`
- `npm run build`

结果：

- 7 个测试文件全部通过
- 46 个测试全部通过
- 前端构建通过

## 线上前端部署

- 正式页已重新部署：
  - `https://chicken-horse-web.pages.dev`
- 本次预览地址：
  - `https://f898c141.chicken-horse-web.pages.dev`

## 下一步建议

- 继续扩展 `src/sim/`，把玩家状态、碰撞、时间推进从前端状态机中拆出来
- 保持当前联机基线稳定，不再给现有主机权威模式硬补预测层
- 等共享模拟层足够完整后，再推进 Worker 服务器权威
