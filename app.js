// app.js
const { APP_META } = require('./data/meta.js')
const cloudConfig = require('./config/cloud.js')

App({
  globalData: {
    themeColor: APP_META.themeColor,
    version: APP_META.version
  },

  onLaunch() {
    // 初始化云开发。真机上若未开通云开发，wx.cloud 也会存在但调用会报错，
    // 因此这里只做初始化，具体的云函数调用失败已在各调用处做兜底处理。
    if (wx.cloud) {
      wx.cloud.init({
        // 未填写环境 ID 时使用默认环境；已填写时固定连接指定云环境。
        env: cloudConfig.isConfigured ? cloudConfig.CLOUD_ENV_ID : '',
        traceUser: true
      })
    }
  }
})
