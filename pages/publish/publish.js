// pages/publish/publish.js —— 发布自创菜谱：表单校验 + 动态食材/步骤 + 写入云数据库
// 发布后与官方菜谱共用同一个 recipes 集合，因此对所有用户可见。
const data = require('../../utils/data.js')
const store = require('../../utils/store.js')
const ui = require('../../utils/ui.js')
const { DIFFICULTIES } = require('../../data/meta.js')

Page({
  data: {
    categories: data.categories,
    catIndex: 0,
    cuisines: data.cuisines,
    cuisineIndex: 0,
    difficulties: DIFFICULTIES,
    diffIndex: 0,
    form: {
      title: '',
      desc: '',
      time: '',
      servings: '',
      douyinUrl: ''
    },
    ingredients: [{ name: '', amount: '' }, { name: '', amount: '' }, { name: '', amount: '' }],
    steps: ['', ''],
    tips: [''],
    coverImageFileId: '',
    coverPreviewUrl: '',
    coverUploading: false
  },

  onShow() {
    // 未登录也可以先把表单填好，真正拦截的时机是最终提交
  },

  // ---------- 基础字段 ----------
  onField(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['form.' + field]: e.detail.value })
  },

  onCat(e) {
    this.setData({ catIndex: Number(e.detail.value) })
  },

  onCuisine(e) {
    this.setData({ cuisineIndex: Number(e.detail.value) })
  },

  onDiff(e) {
    this.setData({ diffIndex: Number(e.currentTarget.dataset.index) })
  },

  onTime(e) {
    // 编辑过程中只原样保存输入值，不做数字转换/默认值兜底——
    // 否则每敲一次键盘，输入框都会被强制刷新为兜底值，出现跳动。
    this.setData({ 'form.time': e.detail.value })
  },

  onServings(e) {
    this.setData({ 'form.servings': e.detail.value })
  },

  // ---------- 食材 / 步骤 / 小贴士：结构相同的三组动态列表，统一走这三个通用方法 ----------
  updateListField(listKey, index, value) {
    const list = this.data[listKey]
    list[index] = value
    this.setData({ [listKey]: list })
  },

  addListItem(listKey, emptyItem, max) {
    const list = this.data[listKey]
    if (list.length >= max) return
    list.push(emptyItem)
    this.setData({ [listKey]: list })
  },

  removeListItem(listKey, index, min) {
    const list = this.data[listKey]
    if (list.length <= min) return
    list.splice(index, 1)
    this.setData({ [listKey]: list })
  },

  // ---------- 食材 ----------
  onIng(e) {
    const { index, field } = e.currentTarget.dataset
    this.setData({ ['ingredients[' + index + '].' + field]: e.detail.value })
  },

  addIngredient() {
    this.addListItem('ingredients', { name: '', amount: '' }, 20)
  },

  removeIngredient(e) {
    this.removeListItem('ingredients', e.currentTarget.dataset.index, 1)
  },

  // ---------- 步骤 ----------
  onStep(e) {
    this.updateListField('steps', e.currentTarget.dataset.index, e.detail.value)
  },

  addStep() {
    this.addListItem('steps', '', 20)
  },

  removeStep(e) {
    this.removeListItem('steps', e.currentTarget.dataset.index, 1)
  },

  // ---------- 小贴士（选填，无最少条数限制） ----------
  onTip(e) {
    this.updateListField('tips', e.currentTarget.dataset.index, e.detail.value)
  },

  addTip() {
    this.addListItem('tips', '', 10)
  },

  removeTip(e) {
    this.removeListItem('tips', e.currentTarget.dataset.index, 0)
  },

  // ---------- 封面图（选填） ----------
  // 上传本身不受云存储读权限限制；展示时统一交给云函数 resolveImage 换临时地址，
  // 因此这里全程不依赖“所有用户可读”这个云存储权限。
  chooseCover() {
    if (this.data.coverUploading) return
    store.requireLogin(() => {
      wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sizeType: ['compressed'],
        sourceType: ['album', 'camera'],
        success: (res) => this.uploadCover(res.tempFiles[0].tempFilePath),
        fail: () => { /* 用户取消选择，无需提示 */ }
      })
    })
  },

  async uploadCover(tempFilePath) {
    const ext = (tempFilePath.split('.').pop() || 'jpg').split('?')[0]
    const cloudPath = `recipe-covers/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`
    const prevFileId = this.data.coverImageFileId
    const prevPreviewUrl = this.data.coverPreviewUrl
    this.setData({ coverUploading: true, coverPreviewUrl: tempFilePath })
    try {
      const res = await wx.cloud.uploadFile({ cloudPath, filePath: tempFilePath })
      if (!res.fileID || res.fileID.indexOf('cloud://') !== 0) {
        throw new Error('云存储未返回有效 fileID')
      }
      this.setData({ coverImageFileId: res.fileID, coverUploading: false })
      if (prevFileId) wx.cloud.deleteFile({ fileList: [prevFileId] }).catch(() => { /* 忽略旧文件清理失败 */ })
    } catch (err) {
      console.error('封面图上传失败:', err)
      this.setData({ coverUploading: false, coverPreviewUrl: prevFileId ? prevPreviewUrl : '' })
      ui.toast('封面图上传失败，请重试')
    }
  },

  removeCover() {
    const fileId = this.data.coverImageFileId
    this.setData({ coverImageFileId: '', coverPreviewUrl: '' })
    if (fileId) wx.cloud.deleteFile({ fileList: [fileId] }).catch(() => { /* 忽略旧文件清理失败 */ })
  },

  // ---------- 提交（需登录） ----------
  submit() {
    const { form, ingredients, steps, tips, catIndex, diffIndex, cuisineIndex, coverImageFileId, coverUploading } = this.data

    if (!form.title.trim()) {
      return ui.toast('请填写菜谱名称')
    }
    if (!form.desc.trim()) {
      return ui.toast('请写一句菜品介绍')
    }
    const validIngs = ingredients.filter(i => i.name.trim())
    if (!validIngs.length) {
      return ui.toast('至少添加一种食材')
    }
    const validSteps = steps.map(s => s.trim()).filter(Boolean)
    if (validSteps.length < 1) {
      return ui.toast('至少填写一个步骤')
    }
    if (coverUploading) {
      return ui.toast('封面图上传中，请稍候')
    }

    store.requireLogin(async () => {
      const session = store.getSession()
      const category = data.categories[catIndex].key
      const recipe = {
        title: form.title.trim(),
        category,
        cuisine: category === 'cn' ? data.cuisines[cuisineIndex].key : undefined,
        difficulty: DIFFICULTIES[diffIndex],
        // 耗时/份量允许留空，此处才补上默认值，编辑过程中不做任何强制兜底。
        time: Number(form.time) || 30,
        servings: (form.servings || '').trim() || '2人',
        desc: form.desc.trim(),
        tags: ['自创'],
        author: { name: session.nickname },
        coverImageFileId,
        ingredients: validIngs.map(i => ({ name: i.name.trim(), amount: (i.amount || '适量').trim() })),
        steps: validSteps.map(text => ({ text })),
        tips: tips.map(t => t.trim()).filter(Boolean)
      }
      const douyinUrl = (form.douyinUrl || '').trim()
      if (douyinUrl) recipe.douyinUrl = douyinUrl

      wx.showLoading({ title: '发布中...', mask: true })
      try {
        const doc = await data.addRecipe(recipe)
        wx.hideLoading()
        ui.toast('发布成功！', 'success')
        // 发布页本身是 tabBar 页面，跳到详情页（非 tabBar 页）用 redirectTo 即可，
        // 同时替换掉当前页面，返回键不会回到已提交过的表单。
        setTimeout(() => wx.redirectTo({ url: '/pages/detail/detail?id=' + doc.id }), 1200)
      } catch (err) {
        wx.hideLoading()
        console.error('菜谱发布失败:', err)
        ui.toast('发布失败，请稍后重试')
      }
    })
  }
})
