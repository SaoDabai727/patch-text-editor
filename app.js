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
  const autoFillBg = document.getElementById("autoFillBg");
  const replaceTextBtn = document.getElementById("replaceTextBtn");
  const placeTextBtn = document.getElementById("placeTextBtn");
  const editSelectedTextBtn = document.getElementById("editSelectedTextBtn");
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
  const inlineEditor = document.getElementById("inlineTextEditor");
  const modeButtons = [...document.querySelectorAll(".mode-btn")];

  const electronAPI = window.desktopAPI || null;
  let pyApi = null;

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
    selectedTextIndex: -1,
    draggingText: null,
    editingTextIndex: -1,
    pendingUpdate: null,
    displayScale: 1,
  };

  function getPyApi() {
    if (pyApi) return pyApi;
    if (window.pywebview && window.pywebview.api) {
      pyApi = window.pywebview.api;
      return pyApi;
    }
    return null;
  }

  function setStatus(msg) {
    statusBar.textContent = msg;
  }

  function enableControls(enabled) {
    [
      downloadBtn,
      recolorBtn,
      fillBrushBtn,
      replaceTextBtn,
      placeTextBtn,
      clearTextBtn,
      resetBtn,
    ].forEach((el) => {
      el.disabled = !enabled;
    });
    updateHistoryButtons();
    updateTextButtons();
  }

  function updateHistoryButtons() {
    undoBtn.disabled = !(state.imageLoaded && state.historyIndex > 0);
    redoBtn.disabled = !(
      state.imageLoaded && state.historyIndex < state.history.length - 1
    );
  }

  function updateTextButtons() {
    editSelectedTextBtn.disabled = !(
      state.imageLoaded && state.selectedTextIndex >= 0
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

  function updateDisplaySize(width, height) {
    const maxW = Math.max(320, canvasWrap.clientWidth || 900);
    const maxH = Math.max(420, window.innerHeight - 220);
    const scale = Math.min(1, maxW / width, maxH / height) || 1;
    state.displayScale = scale;
    const displayW = Math.round(width * scale);
    const displayH = Math.round(height * scale);

    mainCanvas.style.width = `${displayW}px`;
    mainCanvas.style.height = `${displayH}px`;
    overlayCanvas.style.width = `${displayW}px`;
    overlayCanvas.style.height = `${displayH}px`;
    canvasWrap.style.minHeight = `${displayH + 24}px`;
  }

  function fitCanvases(width, height, resetBuffer = true) {
    if (
      resetBuffer ||
      mainCanvas.width !== width ||
      mainCanvas.height !== height
    ) {
      mainCanvas.width = width;
      mainCanvas.height = height;
      overlayCanvas.width = width;
      overlayCanvas.height = height;
    }
    updateDisplaySize(width, height);
  }

  function applyLoadedImage(img, displayName) {
    commitInlineEditor();
    fitCanvases(img.width, img.height, true);
    mainCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
    mainCtx.drawImage(img, 0, 0);
    state.originalImageData = cloneImageData(
      mainCtx.getImageData(0, 0, mainCanvas.width, mainCanvas.height)
    );
    state.history = [];
    state.historyIndex = -1;
    state.selection = null;
    state.textLayers = [];
    state.selectedTextIndex = -1;
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

  function openImageNative() {
    setStatus("请选择贴片图片…");
    // 必须优先用 HTML file input。
    // pywebview 在 js_api 线程里调 create_file_dialog 会卡住，表现为“点击没反应”。
    try {
      fileInput.value = "";
      fileInput.click();
    } catch (err) {
      setStatus("无法打开文件选择框：" + (err && err.message ? err.message : err));
    }
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
    setStatus(`已替换选区背景色（容差 ${tol}）`);
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
    setStatus("已用目标色覆盖选区");
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
    targetColor.value = hex;
    setStatus(`已吸取颜色 ${hex}`);
  }

  function currentTextStyle() {
    return {
      fontSize: Number(fontSize.value) || 36,
      color: textColor.value,
      fontFamily: fontFamily.value,
      bold: textBold.checked,
    };
  }

  function measureLayer(layer) {
    overlayCtx.save();
    overlayCtx.font = `${layer.bold ? "700" : "400"} ${layer.fontSize}px ${layer.fontFamily}`;
    const metrics = overlayCtx.measureText(layer.text || " ");
    overlayCtx.restore();
    const width = Math.max(
      20,
      Math.min(metrics.width, layer.maxWidth || metrics.width || 20)
    );
    const height = layer.fontSize * 1.25;
    return {
      x: layer.x - width / 2,
      y: layer.y - height / 2,
      w: width,
      h: height,
    };
  }

  function createTextLayer(text, x, y, maxWidth) {
    const style = currentTextStyle();
    return {
      text: text || "新文字",
      x,
      y,
      fontSize: style.fontSize,
      color: style.color,
      fontFamily: style.fontFamily,
      bold: style.bold,
      maxWidth: maxWidth || Math.max(80, mainCanvas.width * 0.4),
    };
  }

  function placeTextInSelection(clearBg) {
    const content = textContent.value.trim() || "新文字";
    if (!state.selection || state.selection.w < 2 || state.selection.h < 2) {
      setStatus("请先框选要改文案的区域");
      return;
    }
    if (clearBg) fillSelectionSolid();
    const { x, y, w, h } = state.selection;
    const layer = createTextLayer(content, x + w / 2, y + h / 2, w);
    if (h > 8) layer.fontSize = Math.max(12, Math.min(200, Math.floor(h * 0.72)));
    fontSize.value = String(layer.fontSize);
    state.textLayers.push(layer);
    state.selectedTextIndex = state.textLayers.length - 1;
    setMode("text");
    drawOverlay();
    updateTextButtons();
    openInlineEditor(state.selectedTextIndex);
    setStatus("已放置文字，可直接在图上修改，拖动调整位置");
  }

  function replaceTextOneClick() {
    placeTextInSelection(!!autoFillBg.checked);
  }

  function hitTestText(x, y) {
    for (let i = state.textLayers.length - 1; i >= 0; i--) {
      const box = measureLayer(state.textLayers[i]);
      if (
        x >= box.x - 8 &&
        x <= box.x + box.w + 8 &&
        y >= box.y - 8 &&
        y <= box.y + box.h + 8
      ) {
        return i;
      }
    }
    return -1;
  }

  function canvasToDisplayBox(box) {
    const scale = state.displayScale || 1;
    return {
      left: box.x * scale,
      top: box.y * scale,
      width: Math.max(60, box.w * scale),
      height: Math.max(28, box.h * scale),
    };
  }

  function openInlineEditor(index) {
    if (index < 0 || index >= state.textLayers.length) return;
    const layer = state.textLayers[index];
    state.editingTextIndex = index;
    state.selectedTextIndex = index;
    textContent.value = layer.text;
    fontSize.value = String(layer.fontSize);
    textColor.value = layer.color;
    fontFamily.value = layer.fontFamily;
    textBold.checked = !!layer.bold;

    const box = measureLayer(layer);
    const disp = canvasToDisplayBox(box);
    inlineEditor.classList.remove("hidden");
    inlineEditor.value = layer.text;
    inlineEditor.style.left = `${disp.left}px`;
    inlineEditor.style.top = `${disp.top}px`;
    inlineEditor.style.width = `${Math.max(disp.width, 120)}px`;
    inlineEditor.style.height = `${disp.height}px`;
    inlineEditor.style.fontSize = `${layer.fontSize * state.displayScale}px`;
    inlineEditor.style.color = layer.color;
    inlineEditor.style.fontFamily = layer.fontFamily;
    inlineEditor.style.fontWeight = layer.bold ? "700" : "400";
    drawOverlay();
    updateTextButtons();
    setTimeout(() => {
      inlineEditor.focus();
      inlineEditor.select();
    }, 0);
  }

  function commitInlineEditor() {
    if (state.editingTextIndex < 0) return;
    const layer = state.textLayers[state.editingTextIndex];
    if (layer) {
      layer.text = inlineEditor.value.trim() || layer.text || "新文字";
      textContent.value = layer.text;
    }
    state.editingTextIndex = -1;
    inlineEditor.classList.add("hidden");
    drawOverlay();
  }

  function syncSelectedLayerFromPanel() {
    if (state.selectedTextIndex < 0) return;
    const layer = state.textLayers[state.selectedTextIndex];
    if (!layer) return;
    layer.text = textContent.value.trim() || layer.text;
    layer.fontSize = Number(fontSize.value) || layer.fontSize;
    layer.color = textColor.value;
    layer.fontFamily = fontFamily.value;
    layer.bold = textBold.checked;
    if (state.editingTextIndex === state.selectedTextIndex) {
      inlineEditor.value = layer.text;
      inlineEditor.style.fontSize = `${layer.fontSize * state.displayScale}px`;
      inlineEditor.style.color = layer.color;
      inlineEditor.style.fontFamily = layer.fontFamily;
      inlineEditor.style.fontWeight = layer.bold ? "700" : "400";
    }
    drawOverlay();
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

    state.textLayers.forEach((layer, index) => {
      if (index === state.editingTextIndex) return;
      overlayCtx.save();
      overlayCtx.font = `${layer.bold ? "700" : "400"} ${layer.fontSize}px ${layer.fontFamily}`;
      overlayCtx.fillStyle = layer.color;
      overlayCtx.textAlign = "center";
      overlayCtx.textBaseline = "middle";
      overlayCtx.fillText(layer.text, layer.x, layer.y, layer.maxWidth);
      if (index === state.selectedTextIndex) {
        const box = measureLayer(layer);
        overlayCtx.setLineDash([4, 3]);
        overlayCtx.strokeStyle = "#c99436";
        overlayCtx.lineWidth = 1.5;
        overlayCtx.strokeRect(box.x - 4, box.y - 4, box.w + 8, box.h + 8);
      }
      overlayCtx.restore();
    });
  }

  function bakeTextLayers() {
    commitInlineEditor();
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
    state.selectedTextIndex = -1;
    pushHistory();
    drawOverlay();
    updateTextButtons();
  }

  function buildExportCanvas() {
    commitInlineEditor();
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
    if (!state.imageLoaded) {
      setStatus("请先打开图片");
      return;
    }
    setStatus("正在导出…");
    const exportCanvas = buildExportCanvas();
    exportCanvas.toBlob((blob) => {
      if (!blob) {
        setStatus("导出失败");
        return;
      }
      const a = document.createElement("a");
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = `贴片修改-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus("已导出 PNG（下载目录）");
    }, "image/png");
  }

  function setMode(mode) {
    commitInlineEditor();
    state.mode = mode;
    modeButtons.forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.mode === mode);
    });
    const tips = {
      select: "框选模式：拖拽画出要改的文字区域",
      sample: "吸取模式：点击图片取样背景色",
      brush: "涂抹模式：按住拖动覆盖旧文字",
      text: "改文案模式：拖动文字；双击文字编辑；双击空白新增",
    };
    setStatus(tips[mode] || "");
  }

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
      if (manual) setStatus("当前环境不支持云端更新（请使用安装版）");
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
    try {
      const result = await py.download_and_install_update(info.setupUrl, info.sha256 || "");
      if (!result || !result.ok) {
        updateProgress.textContent = (result && result.error) || "更新失败";
        updateNowBtn.disabled = false;
        return;
      }
      updateProgress.textContent = "下载完成，正在启动安装程序…";
    } catch (err) {
      updateProgress.textContent = "更新失败";
      updateNowBtn.disabled = false;
    }
  }

  // Events
  function on(el, evt, fn) {
    if (!el) return;
    el.addEventListener(evt, fn);
  }

  modeButtons.forEach((btn) => {
    on(btn, "click", () => setMode(btn.dataset.mode));
  });

  on(fileInput, "change", (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) loadImageFile(file);
    fileInput.value = "";
  });

  on(openBtn, "click", (e) => {
    e.preventDefault();
    openImageNative();
  });
  on(emptyOpenBtn, "click", (e) => {
    e.preventDefault();
    openImageNative();
  });
  on(checkUpdateBtn, "click", () => runUpdateCheck(true));
  on(updateLaterBtn, "click", hideUpdateModal);
  on(updateNowBtn, "click", applyPendingUpdate);
  on(updateModal, "click", (e) => {
    if (e.target === updateModal) hideUpdateModal();
  });

  tolerance.addEventListener("input", () => {
    toleranceValue.textContent = tolerance.value;
  });

  on(recolorBtn, "click", recolorSelection);
  on(fillBrushBtn, "click", fillSelectionSolid);
  on(replaceTextBtn, "click", replaceTextOneClick);
  on(placeTextBtn, "click", () => placeTextInSelection(false));
  on(editSelectedTextBtn, "click", () => {
    if (state.selectedTextIndex >= 0) openInlineEditor(state.selectedTextIndex);
  });
  on(clearTextBtn, "click", () => {
    commitInlineEditor();
    state.textLayers = [];
    state.selectedTextIndex = -1;
    drawOverlay();
    updateTextButtons();
    setStatus("已清除文字图层");
  });
  on(downloadBtn, "click", exportImage);

  ["input", "change"].forEach((evt) => {
    textContent.addEventListener(evt, syncSelectedLayerFromPanel);
    fontSize.addEventListener(evt, syncSelectedLayerFromPanel);
    textColor.addEventListener(evt, syncSelectedLayerFromPanel);
    fontFamily.addEventListener(evt, syncSelectedLayerFromPanel);
    textBold.addEventListener(evt, syncSelectedLayerFromPanel);
  });

  inlineEditor.addEventListener("input", () => {
    if (state.editingTextIndex < 0) return;
    const layer = state.textLayers[state.editingTextIndex];
    if (!layer) return;
    layer.text = inlineEditor.value;
    textContent.value = layer.text;
  });

  inlineEditor.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      commitInlineEditor();
    } else if (e.key === "Escape") {
      e.preventDefault();
      commitInlineEditor();
    }
  });
  inlineEditor.addEventListener("blur", () => {
    setTimeout(() => commitInlineEditor(), 120);
  });

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
    commitInlineEditor();
    mainCtx.putImageData(state.originalImageData, 0, 0);
    state.textLayers = [];
    state.selectedTextIndex = -1;
    state.selection = null;
    pushHistory();
    drawOverlay();
    updateTextButtons();
    setStatus("已还原到原图");
  });

  overlayCanvas.addEventListener("mousedown", (e) => {
    if (!state.imageLoaded) return;
    if (state.editingTextIndex >= 0) commitInlineEditor();
    const { x, y } = getPointerPos(e);

    if (state.mode === "sample") {
      sampleColor(x, y);
      return;
    }

    if (state.mode === "text") {
      const hit = hitTestText(x, y);
      if (hit >= 0) {
        state.selectedTextIndex = hit;
        state.draggingText = {
          index: hit,
          offsetX: x - state.textLayers[hit].x,
          offsetY: y - state.textLayers[hit].y,
        };
        state.isDrawing = true;
        updateTextButtons();
        drawOverlay();
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

  overlayCanvas.addEventListener("dblclick", (e) => {
    if (!state.imageLoaded) return;
    const { x, y } = getPointerPos(e);
    setMode("text");
    const hit = hitTestText(x, y);
    if (hit >= 0) {
      openInlineEditor(hit);
      return;
    }
    const layer = createTextLayer(textContent.value.trim() || "新文字", x, y);
    state.textLayers.push(layer);
    state.selectedTextIndex = state.textLayers.length - 1;
    updateTextButtons();
    openInlineEditor(state.selectedTextIndex);
    setStatus("已新增文字，直接输入文案");
  });

  function endStroke() {
    if (!state.isDrawing) return;
    const wasBrush = state.mode === "brush";
    const wasSelect = state.mode === "select";
    state.isDrawing = false;
    state.draggingText = null;
    if (wasBrush) {
      pushHistory();
      setStatus("涂抹完成");
    } else if (
      wasSelect &&
      state.selection &&
      state.selection.w > 4 &&
      state.selection.h > 4
    ) {
      setStatus("选区已就绪：点「一键改文案」或按 Enter，在图上直接改字");
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
    if (document.activeElement === inlineEditor) return;
    if (
      e.key === "Enter" &&
      !e.ctrlKey &&
      !e.metaKey &&
      state.selection &&
      state.selection.w > 4 &&
      state.mode === "select"
    ) {
      e.preventDefault();
      replaceTextOneClick();
      return;
    }
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
    if (e.key === "Delete" && state.selectedTextIndex >= 0 && state.mode === "text") {
      state.textLayers.splice(state.selectedTextIndex, 1);
      state.selectedTextIndex = -1;
      drawOverlay();
      updateTextButtons();
    }
  });

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
    // 延后检查更新，避免启动时卡住点击
    setTimeout(() => runUpdateCheck(false), 2500);
  });

  window.addEventListener("resize", () => {
    if (!state.imageLoaded) return;
    // 只改显示尺寸，禁止重置 canvas 宽高（否则会清空图片）
    updateDisplaySize(mainCanvas.width, mainCanvas.height);
    drawOverlay();
    if (state.editingTextIndex >= 0) {
      openInlineEditor(state.editingTextIndex);
    }
  });

  setStatus("等待打开贴片图");
})();
