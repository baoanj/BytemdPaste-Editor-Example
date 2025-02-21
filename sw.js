// 非必须，可在首次访问时缓存指定资源，但仍需监听 fetch 事件来响应缓存
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open('v1').then(cache => {
      return cache.addAll(['/'])
    })
  )
})

// 页面第二次加载时缓存，第三次访问才可离线，任意资源
self.addEventListener('fetch', event => {
  if (event.request.url.indexOf('http') !== 0) return
  // 过滤需要跳过的请求
  if (shouldSkipCache(event.request)) {
    return fetch(event.request); // 直接走网络请求
  }
  event.respondWith(
    // 先响应缓存资源，并发起请求更新缓存，保证访问最新数据
    // 但有个缺陷：如果数据更新了，需要多刷新一次才能看到新数据
    caches.match(event.request).then(matchCache => {
      fetch(event.request).then(response => {
        caches.open('v1').then(function(cache) {
          cache.put(event.request, response)
        })
      })
      return matchCache || fetch(event.request)
    })
  )
})

// 判断是否需要跳过缓存
function shouldSkipCache(request) {
  const url = new URL(request.url);
  
  // 过滤条件（根据需求扩展）
  return (
    request.method === 'POST' ||                  // 过滤所有POST请求
    url.pathname.includes('upload')
  );
}
