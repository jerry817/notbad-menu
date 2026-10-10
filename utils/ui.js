// utils/ui.js —— 页面间重复的交互封装：轻提示 / 二次确认 / 确认后删除 / 登录后跳转
// 抽取自 pages/ 下多个页面里几乎逐字重复的 wx.showToast / wx.showModal 样板代码，
// 统一在这里维护一次，各页面只描述"标题/文案/要执行的动作"这些差异化的部分。

// 最常用的“轻提示、不带图标”场景；需要成功图标时显式传第二个参数（'success'）。
function toast(title, icon = 'none') {
  wx.showToast({ title, icon })
}

// 通用二次确认弹窗：确认后执行 onConfirm，不关心其结果——适用于退出登录、
// 清空本地缓存这类本地同步操作，各自的成功提示文案不同，由调用方自行 toast。
function confirm({ title, content, confirmColor = '#e8552f', onConfirm }) {
  wx.showModal({
    title,
    content,
    confirmColor,
    success(res) {
      if (res.confirm) onConfirm && onConfirm(res)
    }
  })
}

// 需要调云端接口才能完成的删除类操作：确认后执行 action()（可返回 Promise），
// 成功统一提示「已删除」并把结果交给 onDone，失败统一提示并打印带标签的日志。
// 「我的菜谱」「聊天记录」「评论」的删除都是同一套文案与流程，仅标题/文案/
// 具体动作不同，因此抽成这一个公共方法。
function confirmRemove({ title, content, action, onDone, errorLabel }) {
  confirm({
    title,
    content,
    onConfirm() {
      Promise.resolve(action())
        .then(result => {
          toast('已删除')
          onDone && onDone(result)
        })
        .catch(err => {
          console.error((errorLabel || '删除') + '失败:', err)
          toast('删除失败，请稍后重试')
        })
    }
  })
}

// 跳转登录页，登录成功后自动执行 onSuccess——「收藏夹」「我的」等页面里，
// 已经展示了「去登录」入口（用户显然还未登录）时的直接跳转，与 store.requireLogin
// 那种"先弹窗确认是否去登录"的场景不同，因此单独提供。
function goLoginThen(onSuccess) {
  wx.navigateTo({
    url: '/pages/login/login',
    events: { loginSuccess: () => onSuccess && onSuccess() }
  })
}

module.exports = { toast, confirm, confirmRemove, goLoginThen }
