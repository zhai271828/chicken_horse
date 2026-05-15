# 不可思议的鸡马联机版

一个基于 `p5.js + Vite` 的平台跑酷/陷阱对抗游戏，支持本地流程和在线联机流程。  
玩家先进入商店和放置阶段，再进入跑酷回合，争夺分数、金币和彩色金币；达到换图分数后会进入下一张地图。

## 当前状态

- 已支持两人正常联机
- 联机房间号为纯数字
- 联机角色预览使用真实角色贴图
- 联机商店、放置、跑酷、结算、换图流程已尽量对齐单机
- 联机暂停为真实全局暂停，不再是假菜单
- `Tab` 可呼出联机战绩面板，`Esc` 打开暂停层
- 彩色金币在联机中已同步计数、特效和拾取播报
- 客机陷阱已支持真实渲染和动态表现同步

## 运行方式

### 1. 安装前端依赖

```bash
npm install
```

### 2. 启动前端

```bash
npm run dev
```

默认地址一般是 `http://127.0.0.1:5173`。

### 3. 启动联机 Worker

```bash
cd workers
npm install
npx wrangler dev --port 8787
```

默认联机地址是 `ws://127.0.0.1:8787`。  
如果你把 Worker 启在别的端口，比如 `8788`，需要通过环境变量覆盖：

```bash
VITE_WORKER_URL=ws://127.0.0.1:8788 npm run dev
```

## 联机原理

### 主机和客机是不是同一套代码

是，同一个前端项目、同一个资源包、同一个状态机。  
区别只在 `NetworkRunState` 里的运行模式：

- 主机：运行完整游戏逻辑，真正推进时间、物理、陷阱、金币、结算
- 客机：发送输入、接收主机快照、用相同资源和渲染代码做本地显示

### 为什么客机画面能和主机一致

- 地图资源、角色贴图、硬币贴图、陷阱贴图都来自同一个 `src/public/assets/`
- 客机现在复用了和单机一致的角色绘制与硬币绘制逻辑
- 主机会把玩家状态、陷阱状态、金币状态、回合信息同步给客机

### 为什么以前客机会觉得时间变慢

旧实现里，客机 HUD 直接显示“最近一次收到的 `timeLeft`”。  
如果快照到得晚，时间就会像卡住一样几秒才跳一次。

现在的处理：

- 主机会持续广播回合时间
- 客机会根据最近快照和本地经过的时间继续平滑递减显示
- 同时降低了快照广播压力，减少消息积压造成的慢感

## 主要操作

### 跑酷阶段

- `A / D`：左右移动
- `W / Space`：跳跃
- `Esc`：暂停
- `Tab`：按住显示战绩面板
- `Enter`：在联机结算/换图提示时继续

### 放置阶段

- 鼠标左键：放置陷阱
- 鼠标右键：撤销或取消
- `R`：旋转可旋转陷阱
- `Enter`：完成当前放置阶段

### 商店阶段

- 鼠标点击购买
- `Enter`：准备进入下一阶段

## 音频系统

### 背景音乐

- `src/public/assets/audio/music-bg.mp3`

### 合成音效

音效由 `src/systems/AudioManager.js` 通过 Web Audio 实时合成：

- `coin`：吃到普通金币/彩色金币时的拾取声
- `jump`：跳跃声
- `bounce`：弹跳声
- `finish`：到达终点的结算声
- `death`：死亡声

### 死亡音效规则

- 单机：本机播放死亡声
- 联机：只有死亡玩家自己的客户端会听到死亡声

### 音量控制

- 单机暂停菜单提供 `SFX` / `Music` 两条滑杆
- 联机暂停层也提供同样的两条滑杆
- 可拖动到 `0%` 静音，不再只有简单开关

## 项目结构

下面是当前项目里真正和开发有关的目录与关键文件，省略了 `node_modules/`、`dist/`、`.wrangler/` 这类生成内容。

```text
chicken_horse/
├─ src/                          前端游戏源码
│  ├─ config/                    常量、枚举、角色动画配置、游戏参数
│  │  └─ titles/                 称号定义与说明配置
│  ├─ entities/                  实体对象
│  │  ├─ Player.js               玩家实体
│  │  ├─ Coin.js                 金币实体
│  │  └─ obstacles/              各种陷阱/机关实现
│  ├─ maps/                      Tiled 地图加载与解析
│  ├─ models/                    分数、统计等数据模型
│  ├─ network/                   网络消息与联机工具
│  │  ├─ NetworkManager.js       WebSocket 客户端封装
│  │  ├─ MessageTypes.js         网络消息类型
│  │  └─ NetworkObstacleFactory.js 联机陷阱还原工厂
│  ├─ public/                    游戏资源
│  │  └─ assets/
│  │     ├─ audio/               背景音乐
│  │     ├─ fonts/               字体
│  │     ├─ images/              背景图、UI 图
│  │     ├─ maps/                地图、块地图、预制块
│  │     ├─ obstacles/           陷阱贴图、金币贴图、终点旗帜
│  │     ├─ powerups/            道具图
│  │     ├─ snow/                粒子图
│  │     └─ sprites/             鸡/兔/鸭/北极熊贴图
│  ├─ states/                    游戏状态机
│  │  ├─ BootState.js            启动/初始化
│  │  ├─ MenuState.js            主菜单
│  │  ├─ CharSelectState.js      单机角色选择
│  │  ├─ WalkMapState.js         二选一地图投票/选择
│  │  ├─ BuildState.js           单机放置阶段
│  │  ├─ RunState.js             单机跑酷阶段
│  │  ├─ ResultsState.js         单机结算
│  │  ├─ ShopState.js            单机商店
│  │  ├─ LobbyState.js           联机房间/准备界面
│  │  ├─ NetworkShopState.js     联机商店
│  │  ├─ NetworkBuildState.js    联机放置
│  │  ├─ NetworkRunState.js      联机跑酷
│  │  └─ NetworkResultsState.js  联机结算/换图结果
│  ├─ systems/                   核心系统
│  │  ├─ AudioManager.js         音频系统
│  │  ├─ MapManager.js           地图切换/随机地图生成
│  │  ├─ ScoreManager.js         分数、金币、称号统计
│  │  ├─ TimeManager.js          回合倒计时与排名
│  │  ├─ RespawnManager.js       死亡与复活
│  │  ├─ PauseManager.js         单机暂停菜单
│  │  └─ PhysicsSystem.js        物理与碰撞
│  ├─ ui/                        HUD、面板等 UI 组件
│  ├─ utils/                     通用绘制与工具函数
│  ├─ main.js                    前端入口
│  └─ sketch.js                  p5 根状态机和共享上下文
├─ workers/                      Cloudflare Worker 联机后端
│  ├─ src/
│  │  ├─ index.js                Worker 入口
│  │  └─ GameRoom.js             Durable Object 房间逻辑
│  ├─ wrangler.toml              Worker 配置
│  └─ package.json               Worker 依赖与脚本
├─ tests/                        Vitest 单元测试
│  ├─ AabbIntersects.test.js     碰撞工具测试
│  ├─ PlayerScore.test.js        玩家分数模型测试
│  ├─ RespawnManager.test.js     复活系统测试
│  ├─ ScoreManager.test.js       计分系统测试
│  └─ TimeManager.test.js        时间与排名测试
├─ docs/                         展示材料、评估与演示资源
├─ 游戏设计.md                    中文设计文档
├─ 联机实践.md                    联机过程记录
├─ 游戏分析文档.md                项目分析文档
├─ 项目联机分析报告.html          HTML 联机分析报告
├─ server.js                     额外本地服务脚本
├─ vite.config.js                Vite 配置
├─ eslint.config.js              ESLint 配置
└─ package.json                  前端依赖与脚本
```

## 重要模块说明

### `NetworkRunState.js`

联机最关键的前端状态，负责：

- 主机模式下推进完整游戏逻辑
- 客机模式下接收快照并渲染
- 联机暂停、Tab 战绩面板、彩色金币播报
- 主机/客机角色、陷阱、金币状态同步

### `GameRoom.js`

联机后端房间核心，负责：

- 房间创建/加入
- 主机身份与玩家列表管理
- 联机商店、放置、结算阶段同步
- Durable Object 内的房间状态持久化

### `MapManager.js`

负责：

- 加载基础地图
- 生成联机随机地图
- 切换森林/雪原主题与背景图
- 把地图和资源状态写回共享 `ctx`

## 开发脚本

```bash
npm run dev
npm run lint
npm run test
npm run build
```

Worker 侧：

```bash
cd workers
npx wrangler dev --port 8787
npx wrangler deploy --dry-run
```

## 说明

- 联机采用“主机权威”模式：主机决定时间、物理、金币、结算和换图
- 客机不会自己决定结果，只负责发送输入和做本地显示
- 如果后续继续扩展到 3-4 人联机，优先关注 `NetworkRunState.js` 与 `workers/src/GameRoom.js`
