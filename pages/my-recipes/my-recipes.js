// pages/my-recipes/my-recipes.js —— 我的菜谱二级页：全部自创菜谱列表 / 删除
const store = require('../../utils/store.js')
const data = require('../../utils/data.js')
const ui = require('../../utils/ui.js')

Page({
  data: {
    list: [],
    loading: true
  },

  onShow() {
    this.refresh()
  },

  refresh() {
    const session = store.getSession()
    if (!session) {
      this.setData({ list: [], loading: false })
      return
    }
    this.setData({ loading: true })
    data.getMyRecipes(session.openid).then(list => {
      this.setData({ list, loading: false })
    }).catch(err => {
      console.error('我的菜谱加载失败:', err)
      this.setData({ list: [], loading: false })
      ui.toast('加载失败，请稍后重试')
    })
  },

  goDetail(e) {
    wx.navigateTo({ url: '/pages/detail/detail?id=' + e.currentTarget.dataset.id })
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
  }
})
