const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("desktopAPI", {
  openImageDialog: () => ipcRenderer.invoke("open-image-dialog"),
  saveImageDialog: (dataUrl) => ipcRenderer.invoke("save-image-dialog", dataUrl),
  showItemInFolder: (filePath) => ipcRenderer.invoke("show-item-in-folder", filePath),
  onMenuOpenImage: (cb) => ipcRenderer.on("menu-open-image", cb),
  onMenuExportImage: (cb) => ipcRenderer.on("menu-export-image", cb),
  onMenuUndo: (cb) => ipcRenderer.on("menu-undo", cb),
  onMenuRedo: (cb) => ipcRenderer.on("menu-redo", cb),
});
