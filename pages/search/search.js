// pages/search/search.js —— 搜索：热门词 / 历史 / 实时结果
const data = require('../../utils/data.js')
const ui = require('../../utils/ui.js')

const HIST_KEY = 'jiawei_search_history'

Page({
  data: {
    keyword: '',
    hotWords: [],
    history: [],
    results: [],
    searching: false,
    loading: false
  },

  async onLoad() {
    let history = []
    try {
      history = wx.getStorageSync(HIST_KEY) || []
    } catch (e) { /* ignore */ }
    this.setData({ history })
    try {
      this.setData({ hotWords: await data.getHotKeywords() })
    } catch (err) {
      console.error('热门搜索词加载失败:', err)
    }
  },

  onInput(e) {
    const keyword = e.detail.value
    this.setData({ keyword })
    clearTimeout(this._searchTimer)
    if (!keyword.trim()) {
      this.setData({ results: [], searching: false, loading: false })
      return
    }
    // 防抖：停止敲字 300ms 后才真正发起搜索，避免每敲一个字都查一次云数据库。
    this._searchTimer = setTimeout(() => this.doSearch(keyword), 300)
  },

  onClear() {
    clearTimeout(this._searchTimer)
    this.setData({ keyword: '', results: [], searching: false, loading: false })
  },

  onPick(e) {
    const keyword = e.currentTarget.dataset.word
    this.setData({ keyword })
    this.doSearch(keyword, true)
  },

  async doSearch(keyword, save = false) {
    clearTimeout(this._searchTimer)
    const kw = (keyword || '').trim()
    if (!kw) {
      this.setData({ results: [], searching: false, loading: false })
      return
    }
    this.setData({ loading: true })
    try {
      const results = await data.searchRecipes(kw)
      if (kw !== (this.data.keyword || '').trim()) return // 期间关键词又变了，丢弃这次过时的结果
      this.setData({ results, searching: true, loading: false })
      if (save) this.saveHistory(kw)
    } catch (err) {
      console.error('菜谱搜索失败:', err)
      this.setData({ results: [], searching: false, loading: false })
      ui.toast('搜索失败，请稍后重试')
    }
  },

  onConfirm() {
    this.doSearch(this.data.keyword, true)
  },

  saveHistory(kw) {
    let history = this.data.history.filter(h => h !== kw)
    history.unshift(kw)
    if (history.length > 10) history = history.slice(0, 10)
    this.setData({ history })
    try { wx.setStorageSync(HIST_KEY, history) } catch (e) { /* ignore */ }
  },

  clearHistory() {
    this.setData({ history: [] })
    try { wx.removeStorageSync(HIST_KEY) } catch (e) { /* ignore */ }
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id })
  }
})
