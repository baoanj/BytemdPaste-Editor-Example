let key = new URLSearchParams(location.search).get('key') || 'key'

document.title = key + ' - ' + document.title

const pasteWorker = new Worker('worker.js')

var dirHandle
var db

pasteWorker.onmessage = e => {
  console.log('[Index] from Worker', e)
  if (e.data?.type === 'error') {
    alert(e.data.message)
  }
  if (e.data?.type === 'image') {
    document.execCommand(
      'insertHTML',
      false,
      `![${e.data.filename}](/images/${e.data.filename})`
    )
  }
}

navigator.serviceWorker.addEventListener('message', event => {
  console.log('[Index] from SW:', event.data)
  if (event.data?.type === 'dirHandle') {
    console.log('[Index] to SW:', navigator.serviceWorker.controller)
    navigator.serviceWorker.controller?.postMessage({ type: 'dirHandle', dirHandle })
  }
})

async function run() {
  await openIndexDB()
  await getHandle()
}

run()

async function readData() {
  if (dirHandle) {
    await navigator.serviceWorker.ready
    console.log('[Index] serviceWorker ready', navigator.serviceWorker.controller)

    navigator.serviceWorker.controller?.postMessage({ type: 'dirHandle', dirHandle })

    pasteWorker.postMessage({
      type: 'dirHandle',
      dirHandle
    })

    for await (const entry of dirHandle.values()) {
      console.log(entry.kind, entry.name)
    }
    const fileHandle = await dirHandle.getFileHandle(`copyN-${key}.md`, {
      create: true
    })
    pasteWorker.postMessage({
      type: 'fileHandle',
      fileHandle
    })
    const file = await fileHandle.getFile()
    const contents = await file.text()
    console.log(contents)
    init(contents || '')
  }
}

async function getHandle() {
  dirHandle = await read('copyN-dir')
  if (!dirHandle) {
    document.querySelector('#pick').style.display = 'inline'
    return
  }

  // Check if permission was already granted. If so, return true.
  if ((await dirHandle.queryPermission({ mode: 'readwrite' })) === 'granted') {
    readData()
  } else {
    document.querySelector('#perm').style.display = 'inline'
  }
}

async function pickDir() {
  // Must be handling a user gesture to show a file picker.
  // 必须手动触发
  dirHandle = await window.showDirectoryPicker()
  await add({ id: 'copyN-dir', handle: dirHandle })
  document.querySelector('#pick').style.display = 'none'
  readData()
}

async function reqPerm() {
  // Request permission. If the user grants permission, return true.
  // User activation is required to request permissions.
  // 必须手动触发
  if (
    (await dirHandle.requestPermission({ mode: 'readwrite' })) === 'granted'
  ) {
    document.querySelector('#perm').style.display = 'none'
    readData()
  }
}

async function openIndexDB() {
  return new Promise((resolve, reject) => {
    var request = window.indexedDB.open('copyn', 1)
    request.onsuccess = function (event) {
      db = request.result
      console.log('数据库打开成功')
      resolve()
    }
    request.onerror = function (event) {
      console.log('数据库打开报错')
      reject()
    }
    request.onupgradeneeded = function (event) {
      db = event.target.result
      var objectStore
      if (!db.objectStoreNames.contains('handles')) {
        objectStore = db.createObjectStore('handles', { keyPath: 'id' })
        // 使用事务的 oncomplete 事件确保在插入数据前对象存储已经创建完毕。
        objectStore.transaction.oncomplete = event => {
          console.log('数据库建表成功')
          resolve()
        }
      } else {
        resolve()
      }
    }
  })
}

async function add({ id, handle }) {
  return new Promise((resolve, reject) => {
    var req = db
      .transaction(['handles'], 'readwrite')
      .objectStore('handles')
      .add({ id, handle })

    req.onsuccess = function (event) {
      console.log('数据写入成功')
      resolve()
    }

    req.onerror = function (event) {
      console.log('数据写入失败')
      reject()
    }
  })
}

async function read(id) {
  return new Promise((resolve, reject) => {
    var req = db.transaction(['handles']).objectStore('handles').get(id)

    req.onerror = function (event) {
      console.log('事务失败')
      reject()
    }

    req.onsuccess = function (event) {
      if (req.result) {
        console.log(req.result)
        resolve(req.result.handle)
      } else {
        console.log('未获得数据记录')
        resolve()
      }
    }
  })
}

async function update({ id, handle }) {
  return new Promise((resolve, reject) => {
    var req = db
      .transaction(['handles'], 'readwrite')
      .objectStore('handles')
      .put({ id, handle })

    req.onsuccess = function (event) {
      console.log('数据更新成功')
      resolve()
    }

    req.onerror = function (event) {
      console.log('数据更新失败')
      reject()
    }
  })
}

// pasteWorker.onmessage = e => {
//   console.log(e)
//   init(e.data || '')
// }

// pasteWorker.postMessage({
//   type: 'init',
//   key
// })

function init(value) {
  const editor = BytemdPaste({
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
            window.usePython(codemirror)
            codemirror.defineMode('py', codemirror.modes.python)
          },
          async usePasteImage(file) {
            try {
              console.log('[Index] usePasteImage', file)
              pasteWorker.postMessage({
                type: 'saveImage',
                value: file
              })
              // if (result.success) {
              //   console.log(`上传成功！URL: ${result.url}`)
              //   document.execCommand('insertHTML', false, `![image](http://localhost:3000${result.url})`)
              // }
            } catch (error) {
              console.error('上传失败:', error)
            }
          }
          // useMarkdownBody(markdownBody) {
          //   console.log(markdownBody)
          // }
        })
      ],
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

  let timer = null

  editor.$on('change', e => {
    const value = e.detail.value
    editor.$set({ value })
    // localStorage.setItem(key, value)
    clearTimeout(timer)
    timer = setTimeout(() => {
      pasteWorker.postMessage({
        type: 'save',
        key,
        value
      })
    }, 1000)
  })
}
