// pages/favorites/favorites.js —— 收藏夹：云端收藏列表 / 取消收藏 / 跳转详情
const store = require('../../utils/store.js')
const data = require('../../utils/data.js')
const ui = require('../../utils/ui.js')

Page({
  data: {
    isLoggedIn: false,
    list: [],
    loading: true
  },

  onShow() {
    this.refresh()
  },

  async refresh() {
    const isLoggedIn = store.isLoggedIn()
    this.setData({ isLoggedIn })
    if (!isLoggedIn) {
      this.setData({ list: [], loading: false })
      return
    }
    // getFavoriteRecipes 内部按收藏是否变化缓存结果：反复切换 tab 回到这个
    // 页面时，只要收藏没变，这里不会重新发起网络请求，loading 也几乎瞬间结束。
    this.setData({ loading: true })
    try {
      this.setData({ list: await data.getFavoriteRecipes(), loading: false })
    } catch (err) {
      console.error('收藏列表加载失败:', err)
      this.setData({ list: [], loading: false })
      ui.toast('收藏加载失败，请稍后重试')
    }
  },

  goLogin() {
    ui.goLoginThen(() => this.refresh())
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id })
  },

  async unfavorite(e) {
    const id = e.currentTarget.dataset.id
    try {
      await data.removeFavorite(id)
      ui.toast('已取消收藏')
      this.refresh()
    } catch (err) {
      console.error('取消收藏失败:', err)
      ui.toast('操作失败，请稍后重试')
    }
  }
})
