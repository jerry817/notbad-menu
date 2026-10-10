// pages/list/list.js —— 菜谱列表页：按分类/菜系浏览 + 难度筛选 + 排序（分页加载）
const data = require('../../utils/data.js')
const ui = require('../../utils/ui.js')
const swipe = require('../../utils/swipe.js')
const meta = require('../../data/meta.js')

// 「全部」+ data/meta.js 里维护的难度档位；排序选项直接复用 meta.js，
// 与发布页、数据层保持同一份定义，避免三处各自硬编码一份容易失步的副本。
const DIFFICULTIES = ['全部', ...meta.DIFFICULTIES]
const SORTS = meta.SORTS

Page({
  data: {
    category: null,
    cuisine: '',
    cuisines: [],           // 仅中式菜肴展示，用于在列表页内切换菜系
    difficulties: DIFFICULTIES,
    diffIndex: 0,
    sorts: SORTS,
    sortIndex: 0,
    list: [],
    total: 0,
    loading: true,      // 首屏/切换筛选条件时的整屏加载态
    loadingMore: false, // 触底加载下一页时，列表底部的小号加载态
    hasMore: true
  },

  async onLoad(options) {
    const category = data.getCategory(options.category || 'cn')
    const cuisine = options.cuisine || ''
    this.setData({
      category,
      cuisine,
      // 菜系横滑条：全部 + 八大菜系 + 其他（其他为虚拟分组，见 data.OTHER_CUISINE）
      cuisines: category.key === 'cn' ? data.cuisines.concat([data.OTHER_CUISINE]) : []
    })
    wx.setNavigationBarTitle({ title: this.cuisineTitle(cuisine, category.name) })
    await this.refresh()
  },

  // 菜系分组的导航栏标题；「其他」是虚拟分组，meta 中不存在，需单独解析。
  cuisineTitle(cuisine, fallbackName) {
    if (cuisine === data.OTHER_CUISINE.key) return data.OTHER_CUISINE.name
    return cuisine ? data.getCuisine(cuisine).name : fallbackName
  },

  // 筛选条件（菜系/难度/排序）变化时调用：回到第一页重新加载。
  async refresh() {
    const { category, cuisine, diffIndex, sortIndex } = this.data
    const requestId = (this._requestId || 0) + 1
    this._requestId = requestId
    this.setData({ loading: true })
    // 切换筛选条件后回到顶部，避免在长列表底部切菜系时停在原位置、首屏空白。
    wx.pageScrollTo({ scrollTop: 0, duration: 0 })
    try {
      const { list, total, hasMore } = await data.getRecipesPage(category.key, cuisine, {
        difficulty: DIFFICULTIES[diffIndex],
        sort: SORTS[sortIndex].key,
        skip: 0,
        withTotal: true
      })
      if (requestId !== this._requestId) return // 期间又触发了更新的请求，丢弃这次过时的结果
      this.setData({ list, total, hasMore, loading: false })
    } catch (err) {
      console.error('菜谱列表加载失败:', err)
      if (requestId !== this._requestId) return
      this.setData({ list: [], total: 0, hasMore: false, loading: false })
      ui.toast('菜谱加载失败，请稍后重试')
    }
  },

  // 滚动到底部时调用：加载下一页并追加到现有列表后面。
  async loadMore() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) return
    const { category, cuisine, diffIndex, sortIndex, list } = this.data
    const requestId = this._requestId
    this.setData({ loadingMore: true })
    try {
      const page = await data.getRecipesPage(category.key, cuisine, {
        difficulty: DIFFICULTIES[diffIndex],
        sort: SORTS[sortIndex].key,
        skip: list.length
      })
      if (requestId !== this._requestId) return // 加载期间筛选条件变了，这页数据已经不对，丢弃
      this.setData({ list: [...list, ...page.list], hasMore: page.hasMore, loadingMore: false })
    } catch (err) {
      console.error('加载更多菜谱失败:', err)
      if (requestId !== this._requestId) return
      this.setData({ loadingMore: false })
      ui.toast('加载更多失败，请稍后重试')
    }
  },

  onReachBottom() {
    this.loadMore()
  },

  onSelectCuisine(e) {
    this.selectCuisine(e.currentTarget.dataset.key)
  },

  selectCuisine(cuisine) {
    if (cuisine === this.data.cuisine) return
    wx.setNavigationBarTitle({ title: this.cuisineTitle(cuisine, this.data.category.name) })
    this.setData({ cuisine })
    this.refresh()
  },

  // ---------- 内容区左右滑动切换菜系 ----------
  onTouchStart(e) {
    this._touch = swipe.start(e)
  },

  onTouchEnd(e) {
    const { cuisines, cuisine } = this.data
    const dir = swipe.direction(this._touch, e)
    this._touch = null
    if (!dir || !cuisines.length) return

    // 顺序与顶部 tab 一致：0 = 全部，之后依次是八大菜系，最后是其他。
    const index = cuisine ? cuisines.findIndex(item => item.key === cuisine) + 1 : 0
    const nextIndex = index + (dir === 'left' ? 1 : -1)
    if (nextIndex < 0 || nextIndex > cuisines.length) return
    this.selectCuisine(nextIndex === 0 ? '' : cuisines[nextIndex - 1].key)
  },

  onDiff(e) {
    this.setData({ diffIndex: Number(e.currentTarget.dataset.index) })
    this.refresh()
  },

  onSort(e) {
    this.setData({ sortIndex: Number(e.currentTarget.dataset.index) })
    this.refresh()
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id })
  }
})
