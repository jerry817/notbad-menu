// pages/detail/detail.js —— 菜谱详情：食材 / 图文步骤 / 贴士 / 收藏 / 评论
const data = require('../../utils/data.js')
const store = require('../../utils/store.js')
const ui = require('../../utils/ui.js')

Page({
  data: {
    recipe: null,
    category: null,
    cuisine: null,
    isFav: false,
    isLoggedIn: false,
    comments: [],
    commentsLoading: true,
    commentInput: '',
    doneSteps: [],      // 已完成步骤（做菜打卡）
    douyinVideos: [],   // 该菜的抖音做法视频
    loading: true       // 菜谱详情（首屏关键内容）加载中
  },

  onLoad(options) {
    this.setData({ loading: true, commentsLoading: true })

    // 评论展示在页面最下方，不属于首屏关键内容，且它的查询往往比菜谱本身慢
    // （带 orderBy，条数也可能更多）；单独请求、不等它，可以让菜谱详情更快出现，
    // 评论到了再补丁式渲染，本身也带一个局部加载态。
    data.getComments(options.id).then(comments => {
      this.setData({ comments: this.decorateComments(comments), commentsLoading: false })
    }).catch(err => {
      console.error('评论加载失败:', err)
      this.setData({ commentsLoading: false })
    })

    this.loadRecipe(options.id)
  },

  async loadRecipe(id) {
    let recipe
    try {
      recipe = await data.getRecipeById(id)
    } catch (err) {
      console.error('菜谱详情加载失败:', err)
      ui.toast('菜谱加载失败，请稍后重试')
      setTimeout(() => wx.navigateBack(), 800)
      return
    }
    if (!recipe) {
      ui.toast('菜谱不存在')
      setTimeout(() => wx.navigateBack(), 800)
      return
    }

    store.pushHistory(recipe.id)
    this.setData({
      recipe: this.withDisplayableImagesOnly(recipe),
      category: data.getCategory(recipe.category),
      cuisine: recipe.cuisine ? data.getCuisine(recipe.cuisine) : null,
      isFav: false,
      doneSteps: this.restoreDone(recipe.id),
      // 官方菜谱可能预置了多条 douyinVideos；发布页只收集单条链接（douyinUrl），
      // 两者用同一份 UI 展示，因此这里统一成同一个数组结构。
      douyinVideos: (recipe.douyinVideos && recipe.douyinVideos.length)
        ? recipe.douyinVideos
        : (recipe.douyinUrl ? [{ title: '作者分享的抖音做法视频', url: recipe.douyinUrl }] : []),
      loading: false
    })
    wx.setNavigationBarTitle({ title: recipe.title })
    this.refreshFavState()

    // 标题/食材/步骤文案已经可以展示了；封面图和步骤图单独异步解析
    // （resolveImage 云函数有额外的网络往返和冷启动开销），不阻塞首屏，
    // 解析完成后再补丁式更新，避免整个详情页都在等换图片地址。
    data.resolveRecipeImages(recipe).then(withImages => {
      if (this.data.recipe && this.data.recipe.id === recipe.id) {
        this.setData({
          'recipe.coverImageUrl': withImages.coverImageUrl,
          'recipe.steps': withImages.steps
        })
      }
    }).catch(err => console.error('菜谱图片加载失败:', err))
  },

  // 图片解析完成前，只使用能直接展示的地址（如已经是 https 图床链接的）；
  // cloud:// fileID 还没换成临时地址，先留空走占位图，避免短暂出现加载失败的图片。
  withDisplayableImagesOnly(recipe) {
    const displayable = url => (typeof url === 'string' && url.indexOf('https://') === 0) ? url : ''
    return {
      ...recipe,
      coverImageUrl: displayable(recipe.coverImageUrl),
      steps: (recipe.steps || []).map(step => ({ ...step, imageUrl: displayable(step.imageUrl) }))
    }
  },

  onShow() {
    this.setData({ isLoggedIn: store.isLoggedIn() })
    if (this.data.recipe) {
      this.refreshFavState()
      data.getComments(this.data.recipe.id)
        .then(comments => this.setData({ comments: this.decorateComments(comments) }))
        .catch(err => console.error('评论刷新失败:', err))
    }
  },

  // 收藏状态以云端 favorites 集合为准；未登录时必然是未收藏。
  async refreshFavState() {
    if (!this.data.recipe || !store.isLoggedIn()) {
      this.setData({ isFav: false })
      return
    }
    try {
      const ids = await data.getFavoriteIds()
      const isFav = ids.some(x => String(x) === String(this.data.recipe.id))
      this.setData({ isFav })
    } catch (err) {
      console.warn('收藏状态获取失败:', err)
    }
  },

  // 给每条评论标记是否属于当前登录用户，供 WXML 决定是否显示“删除”。
  decorateComments(comments) {
    const openid = (store.getSession() || {}).openid
    return (comments || []).map(item => ({ ...item, isMine: !!openid && item._openid === openid }))
  },

  // ---------- 收藏（云端，需登录） ----------
  onToggleFav() {
    if (!this.data.recipe) return
    // 未登录：引导登录，登录成功后自动完成这次想做的收藏动作。
    store.requireLogin(() => this.doToggleFav(),
      '登录后才能收藏菜谱。')
  },

  async doToggleFav() {
    const id = this.data.recipe.id
    const faved = this.data.isFav
    try {
      if (faved) {
        await data.removeFavorite(id)
      } else {
        await data.addFavorite(id)
      }
      this.setData({ isFav: !faved, isLoggedIn: true })
      ui.toast(faved ? '已取消收藏' : '已加入收藏')
    } catch (err) {
      console.error('收藏操作失败:', err)
      ui.toast('操作失败，请稍后重试')
    }
  },

  // ---------- 步骤打卡 ----------
  toggleStep(e) {
    const idx = Number(e.currentTarget.dataset.index)
    const done = [...this.data.doneSteps]
    const pos = done.indexOf(idx)
    if (pos >= 0) done.splice(pos, 1)
    else done.push(idx)
    this.setData({ doneSteps: done })
    wx.setStorageSync('jiawei_done_' + this.data.recipe.id, done)
  },

  restoreDone(id) {
    try {
      return wx.getStorageSync('jiawei_done_' + id) || []
    } catch (e) {
      return []
    }
  },

  // ---------- 复制抖音视频链接 ----------
  onCopyVideo(e) {
    const url = e.currentTarget.dataset.url
    if (!url) return
    wx.setClipboardData({
      data: url,
      success() {
        ui.toast('已复制，去抖音打开')
      }
    })
  },

  // ---------- 评论（需登录） ----------
  onCommentInput(e) {
    this.setData({ commentInput: e.detail.value })
  },

  submitComment() {
    const content = (this.data.commentInput || '').trim()
    if (!content) {
      ui.toast('说点什么再发布吧')
      return
    }
    store.requireLogin(() => {
      data.addComment(this.data.recipe.id, content, store.getSession())
        .then(comments => {
          this.setData({ comments: this.decorateComments(comments), commentInput: '', isLoggedIn: true })
          ui.toast('发布成功', 'success')
        })
        .catch(err => {
          console.error('评论发布失败:', err)
          ui.toast('发布失败，请稍后重试')
        })
    })
  },

  deleteComment(e) {
    const id = e.currentTarget.dataset.id
    ui.confirmRemove({
      title: '删除评论',
      content: '确定删除这条评论吗？删除后不可恢复。',
      action: () => data.removeComment(id, this.data.recipe.id),
      onDone: comments => this.setData({ comments: this.decorateComments(comments) }),
      errorLabel: '评论删除'
    })
  },

  // ---------- 分享 ----------
  onShareAppMessage() {
    const r = this.data.recipe
    return {
      title: `一起来做「${r.title}」吧！`,
      path: '/pages/detail/detail?id=' + r.id
    }
  },

  onShareTimeline() {
    const r = this.data.recipe
    return { title: `一起来做「${r.title}」吧！` }
  }
})
