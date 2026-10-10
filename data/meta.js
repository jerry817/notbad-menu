// data/meta.js —— 应用级元数据（开发者主要维护入口）
// 菜谱分类、菜系、版本号与更新日志都集中在这里，改这一个文件即可全局生效。

// ---------- 小程序基础信息 ----------
const APP_META = {
  name: '味不孬',
  slogan: '一味 · 一食 · 一心',
  version: '2.1.0',
  themeColor: '#e8552f'
}

// 版本更新日志：新版本插入到数组最前面
const CHANGELOG = [
  {
    version: '2.1.0',
    date: '2026-09-23',
    notes: [
      '中式菜系新增「其他」分组，八大菜系以外的菜谱统一收纳',
      '修复「全部」菜谱数量与列表页统计不一致的问题',
      '分类页与菜系列表页支持左右滑动切换',
      '优化操作逻辑，浏览更畅快',
      '主体功能已全部构建完成'
    ]
  },
  {
    version: '2.0.0',
    date: '2026-09-20',
    notes: [
      '中式菜肴新增「八大菜系」分类，快速找到地道家乡味',
      '菜谱库扩充至 600+ 道，跟着教程一步步做',
      '新增登录选项，用于菜谱收藏、菜谱发布、参与讨论'
    ]
  },
  {
    version: '1.5.0',
    date: '2026-09-19',
    notes: [
    '新增菜谱收藏与浏览历史', 
    '搜索支持按食材匹配', 
    '发布页支持上传封面'
    ]
  },
  {
    version: '1.0.0',
    date: '2026-09-16',
    notes: ['「味不孬」Demo，收录家常菜谱']
  }
]

// ---------- 菜谱分类（首页宫格 / 分类页一级 tab） ----------
const CATEGORIES = [
  { key: 'cn', name: '中式菜系', icon: '🥢', desc: '八大菜系 · 家常热菜', color: '#e8552f', bg: '#ffede6' },
  { key: 'kr', name: '韩式料理', icon: '🍲', desc: '锅物 · 泡菜 · 炸鸡', color: '#d94f6b', bg: '#ffe9ee' },
  { key: 'jp', name: '日式料理', icon: '🍱', desc: '和食 · 汤物 · 饭食', color: '#4f7dd9', bg: '#e8efff' },
  { key: 'west', name: '西式料理', icon: '🍝', desc: '意面 · 牛排 · 焗烤', color: '#a06bd4', bg: '#f2e9fb' },
  { key: 'other', name: '其他菜系', icon: '🌍', desc: '东南亚 · 南亚 · 环球风味', color: '#3fa796', bg: '#e3f5f1' },
  { key: 'drink', name: '人气饮品', icon: '🧋', desc: '奶茶 · 冰饮 · 糖水', color: '#2fa88c', bg: '#e2f6f0' },
  { key: 'snack', name: '小食甜点', icon: '🍰', desc: '下午茶 · 追剧必备', color: '#e8a04c', bg: '#fff3e2' }
]

// ---------- 中式菜肴：八大菜系 ----------
const CUISINES = [
  { key: 'chuan', name: '川菜', desc: '麻辣鲜香，一菜一格' },
  { key: 'lu', name: '鲁菜', desc: '咸鲜为主，注重火候' },
  { key: 'yue', name: '粤菜', desc: '清淡鲜美，选料广博' },
  { key: 'su', name: '苏菜', desc: '清鲜平和，制作精细' },
  { key: 'min', name: '闽菜', desc: '汤菜见长，酸甜清鲜' },
  { key: 'zhe', name: '浙菜', desc: '清鲜脆嫩，注重本味' },
  { key: 'xiang', name: '湘菜', desc: '香辣酸鲜，油重色浓' },
  { key: 'hui', name: '徽菜', desc: '重油重色，讲究火功' }
]

const DIFFICULTIES = ['简单', '中等', '高级']

const SORTS = [
  { key: 'hot', name: '最热' },
  { key: 'new', name: '最新' },
  { key: 'fast', name: '最快' }
]

module.exports = { APP_META, CHANGELOG, CATEGORIES, CUISINES, DIFFICULTIES, SORTS }
