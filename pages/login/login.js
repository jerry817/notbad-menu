// pages/login/login.js —— 登录页
// 身份凭证（openid）由云函数 login 在服务端通过 cloud.getWXContext() 解析，
// 客户端只负责收集用户想展示的昵称与头像，两者互不干扰、也无法互相伪造。
const store = require('../../utils/store.js')
const data = require('../../utils/data.js')
const ui = require('../../utils/ui.js')

// 旧版本地收藏使用的存储 key，仅用于登录时一次性上云迁移。
const LEGACY_FAV_KEY = 'jiawei_favorites'

Page({
  data: {
    nickname: '',
    avatarUrl: '',
    loading: false
  },

  onChooseAvatar(e) {
    this.setData({ avatarUrl: e.detail.avatarUrl })
  },

  onNicknameInput(e) {
    this.setData({ nickname: e.detail.value })
  },

  async login() {
    if (this.data.loading) return
    this.setData({ loading: true })

    try {
      let openid = 'demo_' + Date.now() // 云开发未开通时的兜底演示身份
      let cloudReady = false
      if (wx.cloud) {
        const res = await wx.cloud.callFunction({ name: 'login' })
        if (res.result && res.result.success) {
          openid = res.result.openid
          cloudReady = true
        }
      }
      store.setSession({
        openid,
        nickname: this.data.nickname.trim() || '匿名美食家',
        avatarUrl: this.data.avatarUrl || ''
      })
      if (cloudReady) await this.migrateLegacyFavorites()
      ui.toast('嗨嗨嗨,来了噢', 'success')

      const eventChannel = this.getOpenerEventChannel()
      if (eventChannel && eventChannel.emit) {
        eventChannel.emit('loginSuccess')
      }
      setTimeout(() => wx.navigateBack(), 800)
    } catch (err) {
      console.error('login failed:', err)
      ui.toast('登录失败，请重试')
    } finally {
      this.setData({ loading: false })
    }
  },

  // 旧版本地收藏迁移到云端 favorites 集合：login 云函数已在返回前建好集合，
  // 迁移完成后删除本地副本；任何失败都静默处理，不影响登录主流程。
  async migrateLegacyFavorites() {
    let localFavs = null
    try {
      localFavs = wx.getStorageSync(LEGACY_FAV_KEY)
    } catch (e) {
      return
    }
    if (!Array.isArray(localFavs) || !localFavs.length) return
    try {
      await data.migrateLocalFavorites(localFavs)
      wx.removeStorageSync(LEGACY_FAV_KEY)
    } catch (err) {
      console.warn('本地收藏迁移失败，下次登录会重试:', err)
    }
  }
})
