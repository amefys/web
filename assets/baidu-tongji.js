// Baidu Tongji (百度统计) loader — the site ID lives here exactly once.
// Included on every page as <script src="/assets/baidu-tongji.js" defer></script>.
// Until BAIDU_HM_ID is configured this file is a no-op and fires no requests.
// amefys.com and amefys.cn should use separate Tongji sites (separate IDs);
// this copy serves amefys.com. Disclosed in privacy.html (使用的第三方服务).
(function () {
  var BAIDU_HM_ID = 'PENDING_BAIDU_HM_ID'
  if (BAIDU_HM_ID.indexOf('PENDING_') === 0) return

  window._hmt = window._hmt || []
  var hm = document.createElement('script')
  hm.src = 'https://hm.baidu.com/hm.js?' + BAIDU_HM_ID
  hm.async = true
  var s = document.getElementsByTagName('script')[0]
  if (s && s.parentNode) {
    s.parentNode.insertBefore(hm, s)
  } else {
    document.head.appendChild(hm)
  }
})()
