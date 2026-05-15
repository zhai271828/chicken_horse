export const TITLE_DEFINITIONS = [
    { key: 'mvp', name: 'MVP', description: '总积分第一', weight: 15 },
    { key: 'unlucky', name: '天选倒霉蛋', description: '死亡次数最多（至少3次）', weight: 75 },
    { key: 'victim', name: '今日受害者', description: '被同一名玩家击杀最多（至少3次）', weight: 65 },
    { key: 'repeat_death', name: '反复去世', description: '10秒内连续死亡3次', weight: 95 },
    { key: 'quitter', name: '我不玩了', description: '连续三回合未通关', weight: 80 },
    { key: 'miracle', name: '人类奇迹', description: '本回合唯一通关者', weight: 85 },
    { key: 'speed_god', name: '速通之神', description: '平均通关时间最短', weight: 30 },
    { key: 'coin_thief', name: '金币大盗', description: '本回合收集金币最多', weight: 20 },
    { key: 'treasure_hunter', name: '宝藏猎人', description: '本回合吃到彩色金币最多', weight: 25 },
    { key: 'survivor', name: '生存大师', description: '本回合死亡最少的通关者', weight: 10 },
    { key: 'clutch_runner', name: '极限跑者', description: '剩余时间很少时仍能通关', weight: 35 },
    { key: 'skip_class', name: '逃课王', description: '通关时使用跳跃最少', weight: 40 },
    { key: 'phoenix', name: '不死鸟', description: '死亡后复活仍成功通关', weight: 50 },
    { key: 'polluter', name: '地图污染者', description: '本回合放置陷阱最多', weight: 45 },
    { key: 'almost_finish', name: '一步之遥', description: '终点附近死亡最多', weight: 60 },
    { key: 'trap_tester', name: '陷阱测试员', description: '被不同类型陷阱击杀最多', weight: 55 },
    { key: 'fearless', name: '真不怕死', description: '1分钟内死亡5次', weight: 100 },
    { key: 'lucky', name: '全靠运气', description: '连续两回合吃到彩色金币', weight: 90 },
    { key: 'close_call', name: '就差一点', description: '连续在终点前附近死亡', weight: 70 },
];

export const TITLE_DEFINITION_MAP = Object.fromEntries(
    TITLE_DEFINITIONS.map((title) => [title.key, title]),
);
