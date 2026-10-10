// pages/changelog/changelog.js —— 关于 · 版本更新日志
const { APP_META, CHANGELOG } = require('../../data/meta.js')

Page({
  data: {
    appMeta: APP_META,
    changelog: CHANGELOG
  }
})
