onmessage = e => {
  console.log(e)
  if (e.data?.type === 'init') {
    readData(e.data.key)
  }
  if (e.data?.type === 'save') {
    writeData(e.data.key, e.data.value)
  }
}

var dirHandle
var db

async function writeData(key, data) {
  if (dirHandle) {
    const fileHandle = await dirHandle.getFileHandle(`copyN-${key}.md`, { create: true });
    const writable = await fileHandle.createWritable();
    // Write the contents of the file to the stream.
    await writable.write(data);
    // Close the file and write the contents to disk.
    await writable.close();
  }
}

async function readData(key) {
  await openIndexDB()
  await getHandle()
  if (dirHandle) {
    const fileHandle = await dirHandle.getFileHandle(`copyN-${key}.md`, { create: true });
    const file = await fileHandle.getFile();
    const contents = await file.text();
    console.log(contents)
    postMessage(contents)
  }
}

async function getHandle() {
  dirHandle = await read('copyN-dir')
  if (!dirHandle) {
    dirHandle = await showDirectoryPicker();
    await add({ id: 'copyN-dir', handle: dirHandle })
  }
  console.log(dirHandle);
  for await (const entry of dirHandle.values()) {
    console.log(entry.kind, entry.name);
  }
  const permission = await verifyPermission(dirHandle)
  console.log('permission:', permission)
  if (!permission) dirHandle = null
}

async function verifyPermission(handle) {
  const options = { mode: "readwrite" };
  // Check if permission was already granted. If so, return true.
  if ((await handle.queryPermission(options)) === "granted") {
    return true;
  }
  // Request permission. If the user grants permission, return true.
  if ((await handle.requestPermission(options)) === "granted") {
    return true;
  }
  // The user didn't grant permission, so return false.
  return false;
}

async function openIndexDB() {
  return new Promise((resolve, reject) => {
    var request = window.indexedDB.open('copyn');
    request.onsuccess = function (event) {
      db = request.result;
      console.log("数据库打开成功");
      resolve()
    };
    request.onerror = function (event) {
      console.log("数据库打开报错");
      reject()
    };
    request.onupgradeneeded = function (event) {
      db = event.target.result;
      var objectStore;
      if (!db.objectStoreNames.contains("handles")) {
        objectStore = db.createObjectStore("handles", { keyPath: "id" });
        console.log("数据库建表成功");
      }
      resolve()
    };
  })
}

async function add({ id, handle }) {
  return new Promise((resolve, reject) => {
    var req = db
      .transaction(["handles"], "readwrite")
      .objectStore("handles")
      .add({ id, handle });

    req.onsuccess = function (event) {
      console.log("数据写入成功");
      resolve()
    };

    req.onerror = function (event) {
      console.log("数据写入失败");
      reject()
    };
  })
}

async function read(id) {
  return new Promise((resolve, reject) => {
    var req = db.transaction(["handles"]).objectStore("handles").get(id);

    req.onerror = function (event) {
      console.log("事务失败");
      reject()
    };

    req.onsuccess = function (event) {
      if (req.result) {
        console.log(req.result);
        resolve(req.result.handle)
      } else {
        console.log("未获得数据记录");
        resolve()
      }
    };
  })
}

async function update({ id, handle }) {
  return new Promise((resolve, reject) => {
    var req = db
      .transaction(["handles"], "readwrite")
      .objectStore("handles")
      .put({ id, handle });

    req.onsuccess = function (event) {
      console.log("数据更新成功");
      resolve()
    };

    req.onerror = function (event) {
      console.log("数据更新失败");
      reject()
    };
  })
}
