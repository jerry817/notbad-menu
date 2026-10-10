// pages/mine/mine.js —— 我的：登录态 / 统计面板 / 功能入口 / 我的菜谱预览 / 浏览历史
const store = require('../../utils/store.js')
const data = require('../../utils/data.js')
const ui = require('../../utils/ui.js')
const { APP_META } = require('../../data/meta.js')

// 主页"我的菜谱"只预览最近 3 条，其余进二级菜单查看
const MINE_PREVIEW_COUNT = 3

Page({
  data: {
    session: null,
    appVersion: APP_META.version,
    stats: { fav: 0, mine: 0, chat: 0 },
    myRecipes: [],
    historyList: [],
    loadingFav: true,
    loadingMine: true,
    loadingChat: true,
    loadingHistory: true
  },

  onShow() {
    this.refresh()
  },

  // 各区块独立请求、独立渲染，互不拖累：任一查询失败只让对应区块显示空状态。
  refresh() {
    const session = store.getSession()
    this.setData({
      session,
      loadingFav: true,
      loadingMine: true,
      loadingChat: true,
      loadingHistory: true
    })

    const favPromise = session ? data.getFavoriteIds() : Promise.resolve([])
    favPromise.then(favIds => {
      this.setData({ 'stats.fav': favIds.length, loadingFav: false })
    }).catch(err => {
      console.warn('收藏数加载失败:', err)
      this.setData({ loadingFav: false })
    })

    const minePromise = session ? data.getMyRecipes(session.openid) : Promise.resolve([])
    minePromise.then(mine => {
      this.setData({
        myRecipes: mine.slice(0, MINE_PREVIEW_COUNT),
        'stats.mine': mine.length,
        loadingMine: false
      })
    }).catch(err => {
      console.warn('我的菜谱加载失败:', err)
      this.setData({ loadingMine: false })
    })

    // 聊天记录只统计数量展示在面板上，点击数字跳转 助手页，不再在主页列列表
    const chatPromise = session ? data.getAiConversations(20) : Promise.resolve([])
    chatPromise.then(aiChats => {
      this.setData({ 'stats.chat': aiChats.length, loadingChat: false })
    }).catch(err => {
      console.warn('聊天记录数加载失败:', err)
      this.setData({ loadingChat: false })
    })

    data.getRecipesByIds(store.getHistory(), 8).then(historyRecords => {
      this.setData({ historyList: historyRecords, loadingHistory: false })
    }).catch(err => {
      console.warn('最近浏览加载失败:', err)
      this.setData({ loadingHistory: false })
    })
  },

  goLogin() {
    ui.goLoginThen(() => this.refresh())
  },

  logout() {
    ui.confirm({
      title: '退出登录',
      content: '退出后需要重新登录才能使用更多功能。',
      onConfirm: () => {
        store.clearSession()
        this.refresh()
      }
    })
  },

  goFavorites() {
    store.requireLogin(() => {
      wx.navigateTo({ url: '/pages/favorites/favorites' })
    }, '登录后才能查看收藏夹。')
  },

  goMyRecipes() {
    store.requireLogin(() => {
      wx.navigateTo({ url: '/pages/my-recipes/my-recipes' })
    }, '登录后才能查看我的菜谱。')
  },

  goChangelog() {
    wx.navigateTo({ url: '/pages/changelog/changelog' })
  },

  feedback() {
    store.requireLogin(() => {
      wx.showModal({
        title: '意见反馈',
        editable: true,
        placeholderText: '输入您的反馈...',
        confirmColor: '#e8552f',
        success: (res) => {
          if (!res.confirm || !(res.content || '').trim()) return
          data.submitFeedback(res.content.trim()).then(() => {
            ui.toast('感谢反馈！', 'success')
          }).catch(err => {
            console.error('反馈提交失败:', err)
            ui.toast('提交失败，请稍后重试')
          })
        }
      })
    }, '登录后才能提交意见反馈。')
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id })
  },

  goChatList() {
    store.requireLogin(() => {
      wx.navigateTo({ url: '/pages/chat-list/chat-list' })
    }, '登录后才能查看聊天记录。')
  },

  removeMine(e) {
    const id = e.currentTarget.dataset.id
    ui.confirmRemove({
      title: '删除菜谱',
      content: '确定删除这道自创菜谱吗？删除后不可恢复。',
      action: () => data.removeRecipe(id),
      onDone: () => this.refresh(),
      errorLabel: '删除菜谱'
    })
  },

  clearHistory() {
    ui.confirm({
      title: '清空浏览历史',
      onConfirm: () => {
        store.clearHistory()
        ui.toast('已清空')
        this.refresh()
      }
    })
  },

  resetLocalData() {
    ui.confirm({
      title: '清除本地缓存',
      content: '将清空本地缓存，登录状态不受影响，确定继续吗？',
      onConfirm: () => {
        store.clearHistory()
        ui.toast('已清除')
        this.refresh()
      }
    })
  }
})
