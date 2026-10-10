// pages/category/category.js —— 分类页：一级分类 tab + 中式菜肴的八大菜系入口
const data = require('../../utils/data.js')
const ui = require('../../utils/ui.js')
const swipe = require('../../utils/swipe.js')

Page({
  data: {
    categories: data.categories,
    activeKey: 'cn',
    cuisineCounts: [],   // activeKey === 'cn' 时展示
    preview: [],         // 其他分类时展示的预览卡片
    total: 0,
    loading: true
  },

  onLoad(options) {
    this.setData({ activeKey: options.key || 'cn' })
    this.refresh()
  },

  async refresh() {
    const { activeKey } = this.data
    const requestId = (this._requestId || 0) + 1
    this._requestId = requestId
    wx.setNavigationBarTitle({ title: data.getCategory(activeKey).name })
    this.setData({ loading: true })
    // 切换分类后内容高度变化，回到顶部避免停在原滚动位置、首屏空白。
    wx.pageScrollTo({ scrollTop: 0, duration: 0 })

    try {
      if (activeKey === 'cn') {
        // 菜系计数与“全部”真实总数并发拉取。“全部”数量不能用菜系计数相加：
        // cuisine 为空的菜谱（如用户发布未选菜系）不属于任何菜系分组，相加会
        // 漏掉，必须和列表页一样直接 count({ category: 'cn' })。
        const [cuisineCounts, cnTotal] = await Promise.all([
          data.getCuisineCounts(),
          data.getCategoryTotal('cn')
        ])
        if (requestId !== this._requestId) return
        // 「全部」卡片放在八大菜系最前面，点击复用 goCuisine（key 传空字符串），
        // 效果等同于不带 cuisine 参数打开列表页——和其他菜系卡片走同一条路径，
        // 不用再写一个新的跳转方法。
        const all = { key: '', name: '全部', desc: '不挑菜系，都看一遍', count: cnTotal }
        // 总数减去八大菜系之和，即菜系缺失/不属于八大菜系的菜谱，归入「其他」，
        // 排在徽菜之后；数量为 0 时不展示该卡片。
        const knownTotal = cuisineCounts.reduce((sum, c) => sum + (c.count || 0), 0)
        const otherCount = Math.max(0, cnTotal - knownTotal)
        const cards = [all, ...cuisineCounts]
        if (otherCount > 0) cards.push({ ...data.OTHER_CUISINE, count: otherCount })
        this.setData({ cuisineCounts: cards, preview: [], total: 0, loading: false })
        return
      }
      const overview = await data.getCategoryOverview(activeKey)
      if (requestId !== this._requestId) return
      this.setData({ preview: overview.preview, total: overview.total, cuisineCounts: [], loading: false })
    } catch (err) {
      console.error('分类数据加载失败:', err)
      if (requestId !== this._requestId) return
      this.setData({ cuisineCounts: [], preview: [], total: 0, loading: false })
      ui.toast('分类加载失败，请稍后重试')
    }
  },

  switchCategory(activeKey) {
    if (!activeKey || activeKey === this.data.activeKey) return
    this.setData({ activeKey })
    this.refresh()
  },

  onSelectCategory(e) {
    this.switchCategory(e.currentTarget.dataset.key)
  },

  // ---------- 内容区左右滑动切换一级分类 ----------
  onBodyTouchStart(e) {
    this._touch = swipe.start(e)
  },

  onBodyTouchEnd(e) {
    const dir = swipe.direction(this._touch, e)
    this._touch = null
    if (!dir) return
    const index = this.data.categories.findIndex(item => item.key === this.data.activeKey)
    // 手指左滑切到下一个分类，右滑切回上一个，边界处不响应。
    const next = this.data.categories[index + (dir === 'left' ? 1 : -1)]
    if (next) this.switchCategory(next.key)
  },

  goCuisine(e) {
    const cuisine = e.currentTarget.dataset.key
    wx.navigateTo({ url: `/pages/list/list?category=cn&cuisine=${cuisine}` })
  },

  goCategoryList() {
    wx.navigateTo({ url: '/pages/list/list?category=' + this.data.activeKey })
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id })
  }
})
