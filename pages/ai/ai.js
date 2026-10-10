// pages/ai/ai.js —— 美食助手：能力接入示例页
// 真正调用外部大模型 API 的逻辑在 cloudfunctions/aiAssistant 中，密钥只存在于
// 云函数环境变量里，本页只负责收发文本，不接触任何密钥。
const data = require('../../utils/data.js')
const store = require('../../utils/store.js')
const ui = require('../../utils/ui.js')

const SUGGESTIONS = ['土豆可以用什么食材替代？', '牛排几分熟怎么判断？', '豆腐怎么切不容易碎？', '剩饭怎么处理不浪费？']
const GREETING = { role: 'assistant', text: '我是味不孬吃货顾问，关于选材、替换食材、火候把控都可以问我～' }

Page({
  data: {
    messages: [GREETING],
    suggestions: SUGGESTIONS,
    input: '',
    loading: false,
    keyboardHeight: 0,
    kbDuration: 0
  },

  onLoad(options) {
    // 从「我的-聊天记录」点进来：把之前那段对话加载回来，继续追加新消息，
    // 而不是当成一段新对话（避免云端出现一堆零碎的历史记录）。
    if (options.id) this.loadConversation(options.id)
  },

  async loadConversation(id) {
    try {
      const conversation = await data.getAiConversationById(id)
      if (conversation && conversation.messages && conversation.messages.length) {
        this._conversationId = id
        this.setData({ messages: conversation.messages })
        this.scrollToBottom()
      }
    } catch (err) {
      console.error('历史对话加载失败:', err)
      ui.toast('对话加载失败')
    }
  },

  onInput(e) {
    this.setData({ input: e.detail.value })
  },

  // 键盘高度刚开始变化时即触发（与键盘动画同步）：按 height 抬高输入栏、
  // duration 做等时长过渡。相同高度忽略（事件可能多次触发），高度为 0 即收起。
  onKeyboardChange(e) {
    const { height, duration } = e.detail
    if (height === this.data.keyboardHeight) return
    this.setData({ keyboardHeight: height || 0, kbDuration: duration || 0 })
    if (height > 0) this.scrollToBottom()
  },

  onSuggestion(e) {
    this.setData({ input: e.currentTarget.dataset.text })
    this.send()
  },

  send() {
    const prompt = this.data.input.trim()
    if (!prompt || this.data.loading) return
    // 助手需要登录才能用：未登录会弹窗引导登录，登录成功后自动继续这次提问。
    store.requireLogin(() => this.doSend(prompt), '登录后才能使用吃货顾问，登录后即可继续提问。')
  },

  async doSend(prompt) {
    const messages = [...this.data.messages, { role: 'user', text: prompt }]
    this.setData({ messages, input: '', loading: true })
    this.scrollToBottom()
    await this.ensureConversation()
    // 先等用户消息落库再请求，避免两条 push 并发到达时顺序颠倒。
    await data.appendAiMessage(this._conversationId, { role: 'user', text: prompt, at: Date.now() })

    try {
      const res = await wx.cloud.callFunction({ name: 'aiAssistant', data: { prompt } })
      const result = res.result || {}
      const text = result.success ? result.answer : (result.error || '服务暂时不可用')
      this.appendReply(text)
    } catch (err) {
      console.error('callFunction aiAssistant failed:', err)
      this.appendReply('网络不太顺畅，暂时无法答复，请稍后再试～')
    } finally {
      this.setData({ loading: false })
    }
  },

  // 第一条消息发出时才建云端会话记录，避免只是点进页面、什么都没问就留一条空记录。
  async ensureConversation() {
    if (this._conversationId) return
    try {
      this._conversationId = await data.startAiConversation()
    } catch (err) {
      console.warn('创建对话记录失败，本次对话将不会同步到云端:', err)
    }
  },

  appendReply(text) {
    this.setData({ messages: [...this.data.messages, { role: 'assistant', text }] })
    this.scrollToBottom()
    if (this._conversationId) {
      data.appendAiMessage(this._conversationId, { role: 'assistant', text, at: Date.now() })
    }
  },

  scrollToBottom() {
    // scroll-into-view 设为相同值不会重新触发，先清空再置回，确保布局变化
    // （键盘弹起、新消息到达）后都能准确滚到底部。
    this.setData({ scrollTo: '' })
    setTimeout(() => this.setData({ scrollTo: 'msg-bottom' }), 30)
  }
})
