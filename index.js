import usePython from './python.js'

/* ================= 常量 ================= */

const key = new URLSearchParams(location.search).get('key') || 'key'

const DB_NAME = 'copyn'
const DB_VERSION = 1
const STORE_NAME = 'handles'
const DIR_HANDLE_ID = 'copyN-dir'

/* ================= 状态 ================= */

const pasteWorker = new Worker('worker.js')

let dirHandle = null
let db = null
let editor = null

document.title = key + ' - ' + document.title

/* ================= Worker 消息 ================= */

pasteWorker.onmessage = e => {
  const data = e.data || {}
  if (data.type === 'error') {
    console.error('[Index] worker error', data.message)
    alert(data.message)
  } else if (data.type === 'image') {
    console.log('[Index] image saved', data.filename)
  }
}

pasteWorker.onerror = e => {
  console.error('[Index] worker error', e.message)
}

/* ================= Service Worker 消息：提供目录句柄 ================= */

navigator.serviceWorker.addEventListener('message', event => {
  if (event.data?.type === 'dirHandle') {
    // 句柄就绪才回传；未就绪时 SW 会按超时重试再次询问
    if (dirHandle) {
      navigator.serviceWorker.controller?.postMessage({
        type: 'dirHandle',
        dirHandle
      })
    }
  }
})

/* ================= 启动流程 ================= */

async function run() {
  try {
    await openDB()
    await getHandle()
  } catch (err) {
    console.error('[Index] init failed', err)
    alert('初始化失败：' + (err?.message || err))
  }
}

run()

/* ================= 目录句柄与数据加载 ================= */

async function readData() {
  if (!dirHandle) return

  // 等 SW 就绪后推送目录句柄，确保图片请求可落盘读取
  await navigator.serviceWorker.ready
  navigator.serviceWorker.controller?.postMessage({ type: 'dirHandle', dirHandle })
  pasteWorker.postMessage({ type: 'dirHandle', dirHandle })

  try {
    const fileHandle = await dirHandle.getFileHandle(`copyN-${key}.md`, {
      create: true
    })
    pasteWorker.postMessage({ type: 'fileHandle', fileHandle })

    const file = await fileHandle.getFile()
    init(await file.text())
  } catch (err) {
    console.error('[Index] readData failed', err)
    alert('读取文档失败：' + (err?.message || err))
  }
}

async function getHandle() {
  dirHandle = await idbGet(DIR_HANDLE_ID)
  if (!dirHandle) {
    showButton('pick')
    return
  }

  // 已有授权直接加载；否则需用户手势请求授权
  if ((await dirHandle.queryPermission({ mode: 'readwrite' })) === 'granted') {
    readData()
  } else {
    showButton('perm')
  }
}

function showButton(id, visible = true) {
  const el = document.querySelector('#' + id)
  if (el) el.style.display = visible ? 'inline' : 'none'
}

// 必须由用户手势触发（目录选择器需要 user activation）
window.pickDir = async function () {
  try {
    dirHandle = await window.showDirectoryPicker()
    await idbPut(DIR_HANDLE_ID, dirHandle)
    showButton('pick', false)
    readData()
  } catch (err) {
    // AbortError：用户取消选择，静默处理
    if (err?.name !== 'AbortError') {
      console.error('[Index] pickDir failed', err)
      alert('选择目录失败：' + (err?.message || err))
    }
  }
}

// 必须由用户手势触发（requestPermission 需要 user activation）
window.reqPerm = async function () {
  if ((await dirHandle.requestPermission({ mode: 'readwrite' })) === 'granted') {
    showButton('perm', false)
    readData()
  }
}

/* ================= IndexedDB：目录句柄持久化 ================= */

function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = e => {
      const database = e.target.result
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: 'id' })
      }
    }

    request.onsuccess = () => {
      db = request.result
      db.onversionchange = () => db.close()
      resolve()
    }

    request.onerror = () => reject(request.error)
    request.onblocked = () => console.warn('[Index] IndexedDB open blocked')
  })
}

function idbGet(id) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(id)
    req.onsuccess = () => resolve(req.result ? req.result.handle : null)
    req.onerror = () => reject(req.error)
  })
}

// 统一 put：新建与更新幂等，重复选择目录不会因 key 冲突报错
function idbPut(id, handle) {
  return new Promise((resolve, reject) => {
    const req = db
      .transaction(STORE_NAME, 'readwrite')
      .objectStore(STORE_NAME)
      .put({ id, handle })
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

/* ================= 编辑器 ================= */

function init(value) {
  // 编辑器已存在（如重新选择目录/重新授权后再次加载）：仅同步内容
  if (editor) {
    editor.$set({ value })
    return
  }

  editor = BytemdPaste({
    target: document.body,
    props: {
      value,
      plugins: [
        bytemdPluginGfm({
          locale: {
            strike: '删除线',
            strikeText: '文本',
            table: '表格',
            tableHeading: '标题',
            task: '任务列表',
            taskText: '待办事项'
          }
        }),
        bytemdPluginHighlight(),
        myPlugin({
          useCodemirror(codemirror) {
            usePython(codemirror)
            codemirror.defineMode('py', codemirror.modes.python)
          },
        })
      ],
      uploadImages: async (files) => {
        // 同批文件用同一时间戳 + 序号，避免同批同名文件互相覆盖
        const time = Date.now()
        const names = files.map((file, i) => `${time}-${i}-${file.name}`)

        files.forEach((file, i) => {
          pasteWorker.postMessage({
            type: 'saveImage',
            value: { file, filename: names[i] }
          })
        })

        // URL 编码与 SW 端 decodeURIComponent 对齐
        return files.map((file, i) => ({
          url: `/images/${encodeURIComponent(names[i])}`,
          alt: file.name,
          title: undefined
        }))
      },
      locale: {
        bold: '粗体',
        boldText: '粗体文本',
        cheatsheet: 'Markdown 语法',
        closeHelp: '关闭帮助',
        closeToc: '关闭目录',
        code: '代码',
        codeBlock: '代码块',
        codeLang: '编程语言',
        codeText: '代码',
        exitFullscreen: '退出全屏',
        exitPreviewOnly: '恢复默认',
        exitWriteOnly: '恢复默认',
        fullscreen: '全屏',
        h1: '一级标题',
        h2: '二级标题',
        h3: '三级标题',
        h4: '四级标题',
        h5: '五级标题',
        h6: '六级标题',
        headingText: '标题',
        help: '帮助',
        hr: '分割线',
        image: '图片',
        imageAlt: 'alt',
        imageTitle: '图片描述',
        italic: '斜体',
        italicText: '斜体文本',
        limited: '已达最大字符数限制',
        lines: '行数',
        link: '链接',
        linkText: '链接描述',
        ol: '有序列表',
        olItem: '项目',
        preview: '预览',
        previewOnly: '仅预览区',
        quote: '引用',
        quotedText: '引用文本',
        shortcuts: '快捷键',
        source: '源代码',
        sync: '同步滚动',
        toc: '目录',
        top: '回到顶部',
        ul: '无序列表',
        ulItem: '项目',
        words: '字数',
        write: '编辑',
        writeOnly: '仅编辑区',
        chars: '字符数'
      }
    }
  })

  // 防抖 1s：停顿后再交给 Worker 落盘（Worker 内部再做串行合并）
  let timer = null

  editor.$on('change', e => {
    const value = e.detail.value
    editor.$set({ value })
    clearTimeout(timer)
    timer = setTimeout(() => {
      pasteWorker.postMessage({ type: 'save', key, value })
    }, 1000)
  })
}
