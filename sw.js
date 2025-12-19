/*
 * production-ready Service Worker
 * - 强制更新（skipWaiting + clients.claim）
 * - sw.js 禁缓存前提下可确保必然升级
 * - 版本化 Cache
 * - Stale-While-Revalidate 策略
 * - 安全兜底与可观测日志
 */

/* ================= 配置区 ================= */

// ⚠️ 每次发布必须修改版本号
const SW_VERSION = 'v3'

const CACHE_PREFIX = 'm2-cache'
const CACHE_NAME = `${CACHE_PREFIX}-${SW_VERSION}`

// 需要预缓存的核心资源（尽量少）
const PRECACHE_URLS = ['/']

let dirHandleMap = {}
let promiseInsMap = {}, promiseResMap = {}

/* ================= install ================= */

// 非必须，可在首次访问时缓存指定资源，但仍需监听 fetch 事件来响应缓存
self.addEventListener('install', event => {
  console.log('[SW] install', SW_VERSION)

  // 强制跳过 waiting
  self.skipWaiting()

  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(PRECACHE_URLS)
    })
  )
})

/* ================= activate ================= */

self.addEventListener('activate', event => {
  console.log('[SW] activate', SW_VERSION)

  event.waitUntil(
    Promise.all([
      // 清理旧缓存
      caches
        .keys()
        .then(keys =>
          Promise.all(
            keys
              .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
              .map(key => caches.delete(key))
          )
        ),

      // 立即接管页面
      self.clients.claim()
    ])
  )
})

// 页面第二次加载时缓存，第三次访问才可离线，任意资源
self.addEventListener('fetch', event => {
  const req = event.request
  console.log('[SW] fetch', req.url)

  const url = new URL(req.url)
  if (req.method === 'POST' || url.origin !== self.location.origin) {
    console.log('[SW] fetch pass through', req.url)
    return fetch(req) // 直接走网络请求
  }

  if (url.pathname.startsWith('/images/')) {
    if (!dirHandleMap?.[event.clientId]) {
      if (!promiseInsMap) promiseInsMap = {}
      promiseInsMap[event.clientId] = new Promise(r => promiseResMap[event.clientId] = r)
      setTimeout(() => {
        promiseResMap[event.clientId]?.()
      }, 2000);
      event.waitUntil(
        (async () => {
          const client = await self.clients.get(event.clientId)
          if (client) {
            console.log('[SW] postMessage dirHandle', event.clientId)
            client.postMessage({
              type: 'dirHandle'
            })
          }
        })()
      )
    }
    event.respondWith(handleImageRequest(url.pathname, event.clientId))
    return
  }

  event.respondWith(handleRequest(req))
})

/* ================= error safety ================= */

self.addEventListener('error', event => {
  console.log('[SW] error', event.error)
})

self.addEventListener('unhandledrejection', event => {
  console.log('[SW] unhandledrejection', event.reason)
})

async function handleRequest(request) {
  const cache = await caches.open(CACHE_NAME)

  // 1. 先查缓存
  const matchCache = await cache.match(request)

  // 2. 后台更新
  const fetchPromise = fetch(new Request(request, { cache: 'no-store' }))
    .then(response => {
      if (response && response.ok) {
        cache.put(request, response.clone())
      }
      return response
    })
    .catch(() => matchCache)

  // 3. 优先返回缓存，没有则等网络
  return matchCache || fetchPromise
}

self.addEventListener('message', event => {
  console.log('[SW] message', event.source?.id, event.data)

  if (event.data?.type === 'dirHandle') {
    if (!dirHandleMap) dirHandleMap = {}
    dirHandleMap[event.source.id] = event.data?.dirHandle
    promiseResMap[event.clientId]?.()
  }
})

async function handleImageRequest(pathname, clientId) {
  if (!dirHandleMap?.[clientId]) {
    await promiseInsMap?.[clientId]
  }
  if (!dirHandleMap?.[clientId]) {
    return new Response('FS handle not ready', { status: 503 })
  }

  try {
    const permission1 = await dirHandleMap?.[clientId].queryPermission({
      mode: 'readwrite'
    })
    console.log('[SW] permission1', permission1)

    const filename = pathname.replace('/images/', '')

    // 1. images 目录
    const imagesDir = await dirHandleMap?.[clientId].getDirectoryHandle('images')

    // 2. 文件句柄
    const fileHandle = await imagesDir.getFileHandle(filename)

    // 3. 读取 File
    const file = await fileHandle.getFile()

    // 4. 返回 Response
    return new Response(file, {
      headers: {
        'Content-Type': file.type || 'image/png',
        'Content-Length': file.size
      }
    })
  } catch (err) {
    console.error('[SW] images error', err)
    return new Response('Image not found', { status: 404 })
  }
}
