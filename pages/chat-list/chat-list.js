// pages/chat-list/chat-list.js —— 聊天记录二级页：历史对话列表 / 删除
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
    data.getAiConversations(50).then(chats => {
      this.setData({ list: chats.map(this.decorateChat), loading: false })
    }).catch(err => {
      console.error('聊天记录加载失败:', err)
      this.setData({ list: [], loading: false })
      ui.toast('加载失败，请稍后重试')
    })
  },

  // 取第一句提问作为标题，附消息条数和更新时间
  decorateChat(chat) {
    const firstQuestion = (chat.messages || []).find(m => m.role === 'user')
    const d = new Date(chat.updatedAt || Date.now())
    const pad = n => String(n).padStart(2, '0')
    return {
      _id: chat._id,
      preview: (firstQuestion && firstQuestion.text) || '（没有提问内容）',
      count: (chat.messages || []).length,
      updatedAtText: `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
    }
  },

  openChat(e) {
    wx.navigateTo({ url: '/pages/ai/ai?id=' + e.currentTarget.dataset.id })
  },

  removeChat(e) {
    const id = e.currentTarget.dataset.id
    ui.confirmRemove({
      title: '删除聊天记录',
      content: '确定删除这段对话吗？删除后不可恢复。',
      action: () => data.removeAiConversation(id),
      onDone: () => this.refresh(),
      errorLabel: '删除聊天记录'
    })
  }
})
