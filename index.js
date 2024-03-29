let key = new URLSearchParams(location.search).get('key') || 'key'

document.title = key + ' - ' + document.title

key = 'bytemd-paste-' + key

const pasteWorker = new Worker('worker.js')

pasteWorker.onmessage = e => {
  console.log(e)
  init(e.data || '')
}

pasteWorker.postMessage({
  type: 'init',
  key
})

function init(value) {
  const editor = BytemdPaste({
    target: document.body,
    props: {
      // value: localStorage.getItem(key) || '',
      value,
      plugins: [bytemdPluginGfm({
        locale: {
          "strike": "删除线",
          "strikeText": "文本",
          "table": "表格",
          "tableHeading": "标题",
          "task": "任务列表",
          "taskText": "待办事项"
        }
      }), bytemdPluginHighlight()],
      locale: {
        "bold": "粗体",
        "boldText": "粗体文本",
        "cheatsheet": "Markdown 语法",
        "closeHelp": "关闭帮助",
        "closeToc": "关闭目录",
        "code": "代码",
        "codeBlock": "代码块",
        "codeLang": "编程语言",
        "codeText": "代码",
        "exitFullscreen": "退出全屏",
        "exitPreviewOnly": "恢复默认",
        "exitWriteOnly": "恢复默认",
        "fullscreen": "全屏",
        "h1": "一级标题",
        "h2": "二级标题",
        "h3": "三级标题",
        "h4": "四级标题",
        "h5": "五级标题",
        "h6": "六级标题",
        "headingText": "标题",
        "help": "帮助",
        "hr": "分割线",
        "image": "图片",
        "imageAlt": "alt",
        "imageTitle": "图片描述",
        "italic": "斜体",
        "italicText": "斜体文本",
        "limited": "已达最大字符数限制",
        "lines": "行数",
        "link": "链接",
        "linkText": "链接描述",
        "ol": "有序列表",
        "olItem": "项目",
        "preview": "预览",
        "previewOnly": "仅预览区",
        "quote": "引用",
        "quotedText": "引用文本",
        "shortcuts": "快捷键",
        "source": "源代码",
        "sync": "同步滚动",
        "toc": "目录",
        "top": "回到顶部",
        "ul": "无序列表",
        "ulItem": "项目",
        "words": "字数",
        "write": "编辑",
        "writeOnly": "仅编辑区",
        "chars": "字符数"
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
