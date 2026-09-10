const { app, BrowserWindow, Menu, dialog, ipcMain, shell } = require("electron");
const path = require("path");
const fs = require("fs");

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    title: "贴片文字修改工具",
    backgroundColor: "#e8efe8",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, "..", "index.html"));

  const template = [
    {
      label: "文件",
      submenu: [
        {
          label: "打开贴片图",
          accelerator: "CmdOrCtrl+O",
          click: () => mainWindow.webContents.send("menu-open-image"),
        },
        {
          label: "导出图片",
          accelerator: "CmdOrCtrl+E",
          click: () => mainWindow.webContents.send("menu-export-image"),
        },
        { type: "separator" },
        { role: "quit", label: "退出" },
      ],
    },
    {
      label: "编辑",
      submenu: [
        {
          label: "撤销",
          accelerator: "CmdOrCtrl+Z",
          click: () => mainWindow.webContents.send("menu-undo"),
        },
        {
          label: "重做",
          accelerator: "CmdOrCtrl+Y",
          click: () => mainWindow.webContents.send("menu-redo"),
        },
      ],
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "使用说明",
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: "info",
              title: "使用说明",
              message: "贴片文字修改工具",
              detail:
                "1. 打开或拖入贴片图片\n" +
                "2. 框选文字区域\n" +
                "3. 选择目标背景色，点击「替换选区背景色」\n" +
                "4. 需要时可叠加新文字并拖动位置\n" +
                "5. 导出 PNG 保存结果",
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.handle("open-image-dialog", async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "选择贴片图片",
    properties: ["openFile"],
    filters: [
      { name: "图片", extensions: ["png", "jpg", "jpeg", "webp", "bmp", "gif"] },
    ],
  });

  if (result.canceled || !result.filePaths.length) {
    return null;
  }

  const filePath = result.filePaths[0];
  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase().replace(".", "") || "png";
  const mime =
    ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "webp"
        ? "image/webp"
        : ext === "gif"
          ? "image/gif"
          : ext === "bmp"
            ? "image/bmp"
            : "image/png";

  return {
    name: path.basename(filePath),
    path: filePath,
    mime,
    dataUrl: `data:${mime};base64,${buffer.toString("base64")}`,
  };
});

ipcMain.handle("save-image-dialog", async (_event, dataUrl) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    title: "导出修改后的图片",
    defaultPath: `贴片修改-${Date.now()}.png`,
    filters: [{ name: "PNG 图片", extensions: ["png"] }],
  });

  if (result.canceled || !result.filePath) {
    return { ok: false, canceled: true };
  }

  const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
  fs.writeFileSync(result.filePath, Buffer.from(base64, "base64"));
  return { ok: true, path: result.filePath };
});

ipcMain.handle("show-item-in-folder", async (_event, filePath) => {
  if (filePath) shell.showItemInFolder(filePath);
});

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
