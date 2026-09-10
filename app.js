(() => {
  const fileInput = document.getElementById("fileInput");
  const openBtn = document.getElementById("openBtn");
  const emptyOpenBtn = document.getElementById("emptyOpenBtn");
  const downloadBtn = document.getElementById("downloadBtn");
  const mainCanvas = document.getElementById("mainCanvas");
  const overlayCanvas = document.getElementById("overlayCanvas");
  const canvasWrap = document.getElementById("canvasWrap");
  const emptyState = document.getElementById("emptyState");
  const statusBar = document.getElementById("statusBar");
  const targetColor = document.getElementById("targetColor");
  const tolerance = document.getElementById("tolerance");
  const toleranceValue = document.getElementById("toleranceValue");
  const recolorBtn = document.getElementById("recolorBtn");
  const fillBrushBtn = document.getElementById("fillBrushBtn");
  const textContent = document.getElementById("textContent");
  const fontSize = document.getElementById("fontSize");
  const textColor = document.getElementById("textColor");
  const fontFamily = document.getElementById("fontFamily");
  const textBold = document.getElementById("textBold");
  const placeTextBtn = document.getElementById("placeTextBtn");
  const clearTextBtn = document.getElementById("clearTextBtn");
  const undoBtn = document.getElementById("undoBtn");
  const redoBtn = document.getElementById("redoBtn");
  const resetBtn = document.getElementById("resetBtn");
  const checkUpdateBtn = document.getElementById("checkUpdateBtn");
  const updateModal = document.getElementById("updateModal");
  const updateTitle = document.getElementById("updateTitle");
  const updateMeta = document.getElementById("updateMeta");
  const updateNotes = document.getElementById("updateNotes");
  const updateLaterBtn = document.getElementById("updateLaterBtn");
  const updateNowBtn = document.getElementById("updateNowBtn");
  const updateProgress = document.getElementById("updateProgress");
  const modeButtons = [...document.querySelectorAll(".mode-btn")];
  const electronAPI = window.desktopAPI || null;
  let pyApi = null;

  function getPyApi() {
    if (pyApi) return pyApi;
    if (window.pywebview && window.pywebview.api) {
      pyApi = window.pywebview.api;
      return pyApi;
    }
    return null;
  }

  function isDesktop() {
    return !!(electronAPI || getPyApi());
  }

  const mainCtx = mainCanvas.getContext("2d", { willReadFrequently: true });
  const overlayCtx = overlayCanvas.getContext("2d");

  const state = {
    mode: "select",
    imageLoaded: false,
    originalImageData: null,
    history: [],
    historyIndex: -1,
    selection: null,
    isDrawing: false,
    startX: 0,
    startY: 0,
    brushSize: 18,
    sampledRgb: null,
    textLayers: [],
    draggingText: null,
    pendingUpdate: null,
  };

  function setStatus(msg) {
    statusBar.textContent = msg;
  }

  function enableControls(enabled) {
    [
      downloadBtn,
      recolorBtn,
      fillBrushBtn,
      placeTextBtn,
      clearTextBtn,
      resetBtn,
    ].forEach((el) => {
      el.disabled = !enabled;
    });
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    undoBtn.disabled = !(state.imageLoaded && state.historyIndex > 0);
    redoBtn.disabled = !(
      state.imageLoaded && state.historyIndex < state.history.length - 1
    );
  }

  function cloneImageData(imageData) {
    return new ImageData(
      new Uint8ClampedArray(imageData.data),
      imageData.width,
      imageData.height
    );
  }

  function pushHistory() {
    const snapshot = cloneImageData(
      mainCtx.getImageData(0, 0, mainCanvas.width, mainCanvas.height)
    );
    state.history = state.history.slice(0, state.historyIndex + 1);
    state.history.push(snapshot);
    state.historyIndex = state.history.length - 1;
    if (state.history.length > 30) {
      state.history.shift();
      state.historyIndex -= 1;
    }
    updateHistoryButtons();
  }

  function restoreHistory(index) {
    const snapshot = state.history[index];
    if (!snapshot) return;
    mainCtx.putImageData(snapshot, 0, 0);
    state.historyIndex = index;
    updateHistoryButtons();
    drawOverlay();
  }

  function hexToRgb(hex) {
    const value = hex.replace("#", "");
    return {
      r: parseInt(value.slice(0, 2), 16),
      g: parseInt(value.slice(2, 4), 16),
      b: parseInt(value.slice(4, 6), 16),
    };
  }

  function colorDistance(a, b) {
    const dr = a.r - b.r;
    const dg = a.g - b.g;
    const db = a.b - b.b;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  }

  function normalizeRect(x1, y1, x2, y2) {
    const left = Math.max(0, Math.min(x1, x2));
    const top = Math.max(0, Math.min(y1, y2));
    const right = Math.min(mainCanvas.width, Math.max(x1, x2));
    const bottom = Math.min(mainCanvas.height, Math.max(y1, y2));
    return {
      x: Math.round(left),
      y: Math.round(top),
      w: Math.round(right - left),
      h: Math.round(bottom - top),
    };
  }

  function getPointerPos(event) {
    const rect = overlayCanvas.getBoundingClientRect();
    const scaleX = overlayCanvas.width / rect.width;
    const scaleY = overlayCanvas.height / rect.height;
    return {
      x: (event.clientX - rect.left) * scaleX,
      y: (event.clientY - rect.top) * scaleY,
    };
  }

  function fitCanvases(width, height) {
    mainCanvas.width = width;
    mainCanvas.height = height;
    overlayCanvas.width = width;
    overlayCanvas.height = height;

    const maxW = canvasWrap.clientWidth || 900;
    const maxH = Math.max(520, window.innerHeight - 220);
    const scale = Math.min(1, maxW / width, maxH / height);
    const displayW = Math.round(width * scale);
    const displayH = Math.round(height * scale);

    mainCanvas.style.width = `${displayW}px`;
    mainCanvas.style.height = `${displayH}px`;
    overlayCanvas.style.width = `${displayW}px`;
    overlayCanvas.style.height = `${displayH}px`;
    canvasWrap.style.minHeight = `${displayH + 24}px`;
  }

  function applyLoadedImage(img, displayName) {
    fitCanvases(img.width, img.height);
    mainCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
    mainCtx.drawImage(img, 0, 0);
    state.originalImageData = cloneImageData(
      mainCtx.getImageData(0, 0, mainCanvas.width, mainCanvas.height)
    );
    state.history = [];
    state.historyIndex = -1;
    state.selection = null;
    state.textLayers = [];
    state.sampledRgb = null;
    state.imageLoaded = true;
    pushHistory();
    emptyState.classList.add("hidden");
    canvasWrap.classList.remove("hidden");
    enableControls(true);
    drawOverlay();
    setStatus(`已加载：${displayName}（${img.width}×${img.height}）`);
  }

  function loadImageFromUrl(url, displayName, revokeAfterLoad = false) {
    const img = new Image();
    img.onload = () => {
      applyLoadedImage(img, displayName);
      if (revokeAfterLoad) URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      setStatus("图片加载失败，请换一张再试");
      if (revokeAfterLoad) URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  function loadImageFile(file) {
    if (!file || !file.type.startsWith("image/")) {
      setStatus("请选择有效的图片文件");
      return;
    }
    const url = URL.createObjectURL(file);
    loadImageFromUrl(url, file.name, true);
  }

  async function openImageNative() {
    const py = getPyApi();
    if (py && py.open_image) {
      const result = await py.open_image();
      if (!result) return;
      loadImageFromUrl(result.dataUrl, result.name);
      return;
    }
    if (electronAPI) {
      const result = await electronAPI.openImageDialog();
      if (!result) return;
      loadImageFromUrl(result.dataUrl, result.name);
      return;
    }
    fileInput.click();
  }

  function estimateBgColor(imageData) {
    const { data, width, height } = imageData;
    const samples = [];
    const points = [
      [2, 2],
      [width - 3, 2],
      [2, height - 3],
      [width - 3, height - 3],
      [Math.floor(width / 2), 2],
      [Math.floor(width / 2), height - 3],
      [2, Math.floor(height / 2)],
      [width - 3, Math.floor(height / 2)],
    ];

    for (const [x, y] of points) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const i = (y * width + x) * 4;
      samples.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
    }

    if (!samples.length) return { r: 255, g: 255, b: 255 };

    const avg = samples.reduce(
      (acc, c) => ({ r: acc.r + c.r, g: acc.g + c.g, b: acc.b + c.b }),
      { r: 0, g: 0, b: 0 }
    );
    return {
      r: Math.round(avg.r / samples.length),
      g: Math.round(avg.g / samples.length),
      b: Math.round(avg.b / samples.length),
    };
  }

  function recolorSelection() {
    if (!state.selection || state.selection.w < 2 || state.selection.h < 2) {
      setStatus("请先框选文字区域");
      return;
    }

    const { x, y, w, h } = state.selection;
    const region = mainCtx.getImageData(x, y, w, h);
    const bg = state.sampledRgb || estimateBgColor(region);
    const target = hexToRgb(targetColor.value);
    const tol = Number(tolerance.value);

    const data = region.data;
    for (let i = 0; i < data.length; i += 4) {
      const pixel = { r: data[i], g: data[i + 1], b: data[i + 2] };
      const dist = colorDistance(pixel, bg);
      if (dist <= tol) {
        const t = 1 - dist / Math.max(tol, 1);
        const blend = Math.min(1, t * 1.15);
        data[i] = Math.round(pixel.r * (1 - blend) + target.r * blend);
        data[i + 1] = Math.round(pixel.g * (1 - blend) + target.g * blend);
        data[i + 2] = Math.round(pixel.b * (1 - blend) + target.b * blend);
      }
    }

    mainCtx.putImageData(region, x, y);
    pushHistory();
    drawOverlay();
    setStatus(
      `已替换选区背景色（容差 ${tol}${state.sampledRgb ? "，使用吸取色" : "，自动估算底色"}）`
    );
  }

  function fillSelectionSolid() {
    if (!state.selection || state.selection.w < 1 || state.selection.h < 1) {
      setStatus("请先框选区域");
      return;
    }
    const { x, y, w, h } = state.selection;
    mainCtx.fillStyle = targetColor.value;
    mainCtx.fillRect(x, y, w, h);
    pushHistory();
    drawOverlay();
    setStatus("已用目标色填充选区");
  }

  function paintBrush(x, y) {
    const color = hexToRgb(targetColor.value);
    const r = state.brushSize;
    const left = Math.max(0, Math.floor(x - r));
    const top = Math.max(0, Math.floor(y - r));
    const right = Math.min(mainCanvas.width, Math.ceil(x + r));
    const bottom = Math.min(mainCanvas.height, Math.ceil(y + r));
    const w = right - left;
    const h = bottom - top;
    if (w <= 0 || h <= 0) return;

    const imageData = mainCtx.getImageData(left, top, w, h);
    const data = imageData.data;
    const rr = r * r;

    for (let py = 0; py < h; py++) {
      for (let px = 0; px < w; px++) {
        const dx = left + px - x;
        const dy = top + py - y;
        if (dx * dx + dy * dy > rr) continue;
        const i = (py * w + px) * 4;
        data[i] = color.r;
        data[i + 1] = color.g;
        data[i + 2] = color.b;
        data[i + 3] = 255;
      }
    }
    mainCtx.putImageData(imageData, left, top);
  }

  function sampleColor(x, y) {
    const px = Math.max(0, Math.min(mainCanvas.width - 1, Math.floor(x)));
    const py = Math.max(0, Math.min(mainCanvas.height - 1, Math.floor(y)));
    const data = mainCtx.getImageData(px, py, 1, 1).data;
    state.sampledRgb = { r: data[0], g: data[1], b: data[2] };
    const hex =
      "#" +
      [data[0], data[1], data[2]]
        .map((n) => n.toString(16).padStart(2, "0"))
        .join("");
    setStatus(`已吸取底色 ${hex}，框选后可精确替换相近颜色`);
  }

  function placeTextInSelection() {
    const content = textContent.value.trim();
    if (!content) {
      setStatus("请输入文字内容");
      return;
    }
    if (!state.selection || state.selection.w < 2 || state.selection.h < 2) {
      setStatus("请先框选要放置文字的区域");
      return;
    }

    const { x, y, w, h } = state.selection;
    state.textLayers.push({
      text: content,
      x: x + w / 2,
      y: y + h / 2,
      fontSize: Number(fontSize.value) || 36,
      color: textColor.value,
      fontFamily: fontFamily.value,
      bold: textBold.checked,
      maxWidth: w,
    });
    drawOverlay();
    setStatus("文字已放到选区中心，可在「添加文字」模式下拖动调整位置");
  }

  function hitTestText(x, y) {
    for (let i = state.textLayers.length - 1; i >= 0; i--) {
      const layer = state.textLayers[i];
      overlayCtx.save();
      overlayCtx.font = `${layer.bold ? "700" : "400"} ${layer.fontSize}px ${layer.fontFamily}`;
      const metrics = overlayCtx.measureText(layer.text);
      const width = Math.min(metrics.width, layer.maxWidth || metrics.width);
      const height = layer.fontSize;
      overlayCtx.restore();
      if (
        x >= layer.x - width / 2 - 8 &&
        x <= layer.x + width / 2 + 8 &&
        y >= layer.y - height / 2 - 8 &&
        y <= layer.y + height / 2 + 8
      ) {
        return { index: i, layer };
      }
    }
    return null;
  }

  function drawOverlay() {
    overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    if (state.selection && state.selection.w > 0 && state.selection.h > 0) {
      const { x, y, w, h } = state.selection;
      overlayCtx.save();
      overlayCtx.strokeStyle = "#0f7a56";
      overlayCtx.lineWidth = 2;
      overlayCtx.setLineDash([6, 4]);
      overlayCtx.strokeRect(x + 0.5, y + 0.5, w, h);
      overlayCtx.fillStyle = "rgba(15, 122, 86, 0.08)";
      overlayCtx.fillRect(x, y, w, h);
      overlayCtx.restore();
    }

    for (const layer of state.textLayers) {
      overlayCtx.save();
      overlayCtx.font = `${layer.bold ? "700" : "400"} ${layer.fontSize}px ${layer.fontFamily}`;
      overlayCtx.fillStyle = layer.color;
      overlayCtx.textAlign = "center";
      overlayCtx.textBaseline = "middle";
      overlayCtx.fillText(layer.text, layer.x, layer.y, layer.maxWidth);
      overlayCtx.restore();
    }
  }

  function bakeTextLayers() {
    if (!state.textLayers.length) return;
    for (const layer of state.textLayers) {
      mainCtx.save();
      mainCtx.font = `${layer.bold ? "700" : "400"} ${layer.fontSize}px ${layer.fontFamily}`;
      mainCtx.fillStyle = layer.color;
      mainCtx.textAlign = "center";
      mainCtx.textBaseline = "middle";
      mainCtx.fillText(layer.text, layer.x, layer.y, layer.maxWidth);
      mainCtx.restore();
    }
    state.textLayers = [];
    pushHistory();
    drawOverlay();
  }

  function buildExportCanvas() {
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = mainCanvas.width;
    exportCanvas.height = mainCanvas.height;
    const ctx = exportCanvas.getContext("2d");
    ctx.drawImage(mainCanvas, 0, 0);

    for (const layer of state.textLayers) {
      ctx.save();
      ctx.font = `${layer.bold ? "700" : "400"} ${layer.fontSize}px ${layer.fontFamily}`;
      ctx.fillStyle = layer.color;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(layer.text, layer.x, layer.y, layer.maxWidth);
      ctx.restore();
    }
    return exportCanvas;
  }

  async function exportImage() {
    if (!state.imageLoaded) return;
    const exportCanvas = buildExportCanvas();

    const dataUrl = exportCanvas.toDataURL("image/png");
    const py = getPyApi();
    if (py && py.save_image) {
      const result = await py.save_image(dataUrl, `贴片修改-${Date.now()}.png`);
      if (result && result.ok) setStatus(`已保存：${result.path}`);
      else if (!result || !result.canceled) setStatus("导出失败");
      return;
    }
    if (electronAPI) {
      const result = await electronAPI.saveImageDialog(dataUrl);
      if (result && result.ok) {
        setStatus(`已保存：${result.path}`);
        if (electronAPI.showItemInFolder) electronAPI.showItemInFolder(result.path);
      } else if (!result || !result.canceled) {
        setStatus("导出失败");
      }
      return;
    }

    exportCanvas.toBlob((blob) => {
      if (!blob) {
        setStatus("导出失败");
        return;
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `patch-edit-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(a.href);
      setStatus("已导出 PNG");
    }, "image/png");
  }

  function setMode(mode) {
    state.mode = mode;
  
  function showUpdateModal(info) {
    state.pendingUpdate = info;
    updateTitle.textContent = info.force ? "需要更新后才能继续使用" : "发现新版本";
    updateMeta.textContent = `当前 v${info.localVersion}  →  最新 v${info.remoteVersion}`;
    updateNotes.textContent = info.notes || "暂无更新说明";
    updateProgress.textContent = "";
    updateNowBtn.disabled = !info.setupUrl;
    updateLaterBtn.style.display = info.force ? "none" : "";
    updateModal.classList.remove("hidden");
    updateModal.setAttribute("aria-hidden", "false");
  }

  function hideUpdateModal() {
    if (state.pendingUpdate && state.pendingUpdate.force) return;
    updateModal.classList.add("hidden");
    updateModal.setAttribute("aria-hidden", "true");
  }

  async function runUpdateCheck(manual) {
    const py = getPyApi();
    if (!py || !py.check_update) {
      if (manual) setStatus("当前环境不支持云端更新（请使用安装版桌面软件）");
      return;
    }
    if (manual) setStatus("正在检查更新…");
    try {
      const info = await py.check_update(!!manual);
      if (!info || !info.ok) {
        if (manual) setStatus((info && info.error) || "检查更新失败");
        return;
      }
      if (info.skipped) return;
      if (!info.hasUpdate) {
        if (manual) setStatus(`已是最新版本 v${info.localVersion}`);
        return;
      }
      setStatus(`发现新版本 v${info.remoteVersion}`);
      showUpdateModal(info);
      if (!manual && info.autoDownload && info.setupUrl) {
        updateNowBtn.click();
      }
    } catch (err) {
      if (manual) setStatus("检查更新失败：" + (err && err.message ? err.message : err));
    }
  }

  async function applyPendingUpdate() {
    const py = getPyApi();
    const info = state.pendingUpdate;
    if (!py || !info || !info.setupUrl) {
      setStatus("没有可下载的更新包");
      return;
    }
    updateNowBtn.disabled = true;
    updateProgress.textContent = "正在下载安装包，请稍候…";
    setStatus("正在下载更新…");
    try {
      const result = await py.download_and_install_update(info.setupUrl, info.sha256 || "");
      if (!result || !result.ok) {
        updateProgress.textContent = (result && result.error) || "更新失败";
        updateNowBtn.disabled = false;
        setStatus((result && result.error) || "更新失败");
        return;
      }
      updateProgress.textContent = "下载完成，正在启动安装程序并退出…";
      setStatus("正在安装更新…");
    } catch (err) {
      updateProgress.textContent = "更新失败";
      updateNowBtn.disabled = false;
      setStatus("更新失败：" + (err && err.message ? err.message : err));
    }
  }

  modeButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });
    const tips = {
      select: "框选模式：拖拽画出文字区域",
      sample: "吸取模式：点击图片取样背景色",
      brush: "涂抹模式：按住拖动用目标色覆盖",
      text: "文字模式：可拖动已放置的文字",
    };
    setStatus(tips[mode] || "");
  }

  modeButtons.forEach((btn) => {
    btn.addEventListener("click", () => setMode(btn.dataset.mode));
  });

  fileInput.addEventListener("change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) loadImageFile(file);
    fileInput.value = "";
  });

  openBtn.addEventListener("click", openImageNative);
  checkUpdateBtn.addEventListener("click", () => runUpdateCheck(true));
  updateLaterBtn.addEventListener("click", hideUpdateModal);
  updateNowBtn.addEventListener("click", applyPendingUpdate);
  emptyOpenBtn.addEventListener("click", openImageNative);

  if (electronAPI) {
    electronAPI.onMenuOpenImage(() => openImageNative());
    electronAPI.onMenuExportImage(() => exportImage());
    electronAPI.onMenuUndo(() => undoBtn.click());
    electronAPI.onMenuRedo(() => redoBtn.click());
  }

  window.addEventListener("pywebviewready", async () => {
    const py = getPyApi();
    let ver = "";
    try {
      if (py && py.get_app_info) {
        const info = await py.get_app_info();
        if (info && info.version) ver = " v" + info.version;
      }
    } catch (_) {}
    setStatus("桌面版已就绪" + ver + "，点击「打开贴片图」开始");
    runUpdateCheck(false);
  });

  tolerance.addEventListener("input", () => {
    toleranceValue.textContent = tolerance.value;
  });

  recolorBtn.addEventListener("click", recolorSelection);
  fillBrushBtn.addEventListener("click", fillSelectionSolid);
  placeTextBtn.addEventListener("click", placeTextInSelection);
  clearTextBtn.addEventListener("click", () => {
    state.textLayers = [];
    drawOverlay();
    setStatus("已清除文字图层");
  });
  downloadBtn.addEventListener("click", exportImage);

  undoBtn.addEventListener("click", () => {
    if (state.historyIndex > 0) restoreHistory(state.historyIndex - 1);
  });
  redoBtn.addEventListener("click", () => {
    if (state.historyIndex < state.history.length - 1) {
      restoreHistory(state.historyIndex + 1);
    }
  });
  resetBtn.addEventListener("click", () => {
    if (!state.originalImageData) return;
    mainCtx.putImageData(state.originalImageData, 0, 0);
    state.textLayers = [];
    state.selection = null;
    pushHistory();
    drawOverlay();
    setStatus("已还原到原图");
  });

  overlayCanvas.addEventListener("mousedown", (e) => {
    if (!state.imageLoaded) return;
    const { x, y } = getPointerPos(e);

    if (state.mode === "sample") {
      sampleColor(x, y);
      return;
    }

    if (state.mode === "text") {
      const hit = hitTestText(x, y);
      if (hit) {
        state.draggingText = {
          index: hit.index,
          offsetX: x - hit.layer.x,
          offsetY: y - hit.layer.y,
        };
        state.isDrawing = true;
      }
      return;
    }

    state.isDrawing = true;
    state.startX = x;
    state.startY = y;

    if (state.mode === "brush") {
      paintBrush(x, y);
      return;
    }

    if (state.mode === "select") {
      state.selection = normalizeRect(x, y, x, y);
      drawOverlay();
    }
  });

  overlayCanvas.addEventListener("mousemove", (e) => {
    if (!state.isDrawing || !state.imageLoaded) return;
    const { x, y } = getPointerPos(e);

    if (state.mode === "select") {
      state.selection = normalizeRect(state.startX, state.startY, x, y);
      drawOverlay();
      return;
    }

    if (state.mode === "brush") {
      paintBrush(x, y);
      return;
    }

    if (state.mode === "text" && state.draggingText) {
      const layer = state.textLayers[state.draggingText.index];
      layer.x = x - state.draggingText.offsetX;
      layer.y = y - state.draggingText.offsetY;
      drawOverlay();
    }
  });

  function endStroke() {
    if (!state.isDrawing) return;
    const wasBrush = state.mode === "brush";
    state.isDrawing = false;
    state.draggingText = null;
    if (wasBrush) {
      pushHistory();
      setStatus("涂抹完成");
    }
  }

  overlayCanvas.addEventListener("mouseup", endStroke);
  overlayCanvas.addEventListener("mouseleave", endStroke);

  ["dragenter", "dragover", "dragleave", "drop"].forEach((name) => {
    canvasWrap.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    emptyState.addEventListener(name, (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  });

  function handleDrop(e) {
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) loadImageFile(file);
  }

  canvasWrap.addEventListener("drop", handleDrop);
  emptyState.addEventListener("drop", handleDrop);

  window.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redoBtn.click();
      else undoBtn.click();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redoBtn.click();
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      bakeTextLayers();
      exportImage();
    }
  });

  setStatus(isDesktop() ? "桌面版已就绪，点击「打开贴片图」开始" : "等待打开贴片图");
})();
