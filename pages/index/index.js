// pages/index/index.js —— 首页：banner / 分类入口 / 今日推荐 / 热门菜谱
const data = require('../../utils/data.js')
const ui = require('../../utils/ui.js')

// 仅缓存首页轻量摘要，应用冷启动时先显示上次内容，再静默刷新云端数据。
const HOME_CACHE_KEY = 'home_snapshot_v1'
const HOME_CACHE_TTL = 10 * 60 * 1000

Page({
  data: {
    banners: [],
    categories: data.categories,
    totalCount: 0,
    today: null,          // 今日推荐
    hotList: []           // 热门榜
  },

  onLoad() {
    const snapshot = wx.getStorageSync(HOME_CACHE_KEY)
    if (!snapshot || Date.now() - snapshot.updatedAt > HOME_CACHE_TTL) return
    this.setData({
      banners: snapshot.banners || [],
      today: snapshot.today || null,
      hotList: snapshot.hotList || [],
      totalCount: snapshot.totalCount || 0
    })
  },

  async onShow() {
    try {
      const [banners, today, hotList, totalCount] = await Promise.all([
        data.getBanners().catch(err => {
          console.warn('轮播图集合暂未就绪:', err)
          return []
        }),
        data.getDailyFeatured(),
        data.getHotRecipes(6),
        data.getTotalCount()
      ])
      this.setData({ banners, today, hotList, totalCount })
      wx.setStorageSync(HOME_CACHE_KEY, {
        banners,
        today,
        hotList,
        totalCount,
        updatedAt: Date.now()
      })
    } catch (err) {
      console.error('首页云数据加载失败:', err)
      // 已有本地快照时保留内容，避免网络短暂波动造成首页闪空。
      if (!this.data.banners.length && !this.data.today && !this.data.hotList.length) {
        ui.toast('云端数据加载失败，请稍后重试')
      }
    }
  },

  goSearch() {
    wx.navigateTo({ url: '/pages/search/search' })
  },

  goList(e) {
    const key = e.currentTarget.dataset.key || e.detail.key
    wx.navigateTo({ url: '/pages/list/list?category=' + key })
  },

  goAI() {
    wx.navigateTo({ url: '/pages/ai/ai' })
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/detail/detail?id=' + id })
  },

  goPublish() {
    wx.switchTab({ url: '/pages/publish/publish' })
  }
})
