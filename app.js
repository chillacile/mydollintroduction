"use strict";

(() => {
  const $ = id => document.getElementById(id);
  const i18n = window.DollfolioI18n;
  const t = i18n.t;
  const message = (key, params = {}) => ({key, params});
  let statusMessage = null;
  let statusError = false;
  const fonts = [
    ["sans", "fontSans", '"Microsoft YaHei", "PingFang SC", "Yu Gothic", "Malgun Gothic", sans-serif'],
    ["serif", "fontSerif", '"Noto Serif CJK SC", "Songti SC", "SimSun", "Yu Mincho", "Batang", serif'],
    ["kai", "fontKai", '"KaiTi", "STKaiti", "BiauKai", serif'],
    ["mono", "fontMono", '"Cascadia Code", "Consolas", "Microsoft YaHei", monospace']
  ];
  const defaultStyle = i => ({font: i ? "sans" : "serif", size: i ? 42 : 64});
  let settings = {columns: 3, rows: 3, width: 4096, height: 4096, lineCount: 3,
    imageScale: 85, textScale: 100, background: "#fffdf8", foreground: "#313c36", transparent: false,
    styles: Array.from({length: 8}, (_, i) => defaultStyle(i))};
  let dolls = [];
  let selected = null;
  let dragged = null;
  let cropDraft = null;
  let cropTarget = null;
  let busy = false;
  let scheduled = false;
  let toastTimer;
  let disabledBeforeBusy = [];
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const capacity = () => settings.columns * settings.rows;
  const fontFamily = key => (fonts.find(f => f[0] === key) || fonts[0])[2];

  function translateMessage(info, separator = t("messageSeparator")) {
    if (Array.isArray(info)) return info.map(item => translateMessage(item)).join(separator);
    const params = Object.fromEntries(Object.entries(info.params || {}).map(([key, value]) =>
      [key, value && typeof value === "object" && value.key ? translateMessage(value) : value]));
    return t(info.key, params);
  }

  function failure(key, params = {}) {
    const info = message(key, params);
    const error = new Error(translateMessage(info));
    error.info = info;
    return error;
  }

  function renderStatus() {
    if (statusMessage) $("status").textContent = translateMessage(statusMessage, t(statusError ? "errorSeparator" : "messageSeparator"));
  }

  function toast(info, error = false) {
    clearTimeout(toastTimer);
    statusMessage = info;
    statusError = error;
    renderStatus();
    $("status").classList.toggle("error", error);
    $("status").hidden = false;
    toastTimer = setTimeout(() => { $("status").hidden = true; }, error ? 7000 : 4000);
  }

  function applyLanguage() {
    document.documentElement.lang = i18n.languages.find(item => item.code === i18n.language).html;
    document.title = t("title");
    document.querySelectorAll("[data-i18n]").forEach(el => { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll("[data-i18n-aria]").forEach(el => { el.setAttribute("aria-label", t(el.dataset.i18nAria)); });
    const buttons = i18n.languages.filter(item => item.code !== i18n.language).map(item => {
      const button = element("button", "", item.label);
      button.type = "button";
      button.lang = item.html;
      button.dataset.language = item.code;
      button.setAttribute("aria-label", t("switchTo", {language: item.label}));
      return button;
    });
    $("language-switcher").replaceChildren(...buttons);
    renderStyles();
    refresh();
    renderStatus();
  }

  function setBusy(value) {
    busy = value;
    document.body.classList.toggle("busy", value);
    if (value) {
      disabledBeforeBusy = [...document.querySelectorAll("button, input, select")].map(el => [el, el.disabled]);
      disabledBeforeBusy.forEach(([el]) => { el.disabled = true; });
    } else {
      disabledBeforeBusy.forEach(([el, disabled]) => { el.disabled = disabled; });
      syncAvailability();
    }
  }

  async function task(fn) {
    if (busy) return;
    setBusy(true);
    try { await fn(); }
    catch (error) { console.error(error); toast(error.info || message("operationFailed"), true); }
    finally { setBusy(false); }
  }

  function element(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text !== undefined) el.textContent = text;
    return el;
  }

  function syncAvailability() {
    const full = dolls.length >= capacity();
    $("count").textContent = `${dolls.length} / ${capacity()}`;
    $("add").disabled = full || busy;
    $("empty-add").disabled = full || busy;
    $("empty-add").hidden = dolls.length > 0;
    $("export").disabled = !dolls.length || busy;
    $("preview-empty").hidden = dolls.length > 0;
    $("capacity-message").textContent = full ? t("full") : t("remaining", {count: capacity() - dolls.length});
    $("dimensions").textContent = `${settings.width} × ${settings.height} px`;
    $("image-scale-value").value = `${settings.imageScale}%`;
    $("text-scale-value").value = `${settings.textScale}%`;
    $("background").disabled = busy || settings.transparent;
  }

  function fillSettings() {
    const fields = {columns:"columns", rows:"rows", width:"width", height:"height", "line-count":"lineCount", "image-scale":"imageScale", "text-scale":"textScale", background:"background", foreground:"foreground"};
    for (const [id, key] of Object.entries(fields)) $(id).value = settings[key];
    $("transparent").checked = settings.transparent;
    renderStyles();
    syncAvailability();
  }

  function renderStyles() {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < settings.lineCount; i++) {
      const group = element("div", "line-style");
      group.append(element("span", "", t("line", {index: i + 1})));
      const select = element("select");
      select.setAttribute("aria-label", t("lineFont", {index: i + 1}));
      fonts.forEach(([key, label]) => {
        const option = element("option", "", t(label));
        option.value = key;
        select.append(option);
      });
      select.value = settings.styles[i].font;
      select.addEventListener("change", () => { settings.styles[i].font = select.value; queueDraw(); });
      const input = element("input");
      Object.assign(input, {type: "number", min: "8", max: "240", value: settings.styles[i].size, title: t("fontSizeTitle")});
      input.setAttribute("aria-label", t("lineSize", {index: i + 1}));
      input.addEventListener("change", () => {
        settings.styles[i].size = clamp(Math.round(Number(input.value) || 42), 8, 240);
        input.value = settings.styles[i].size;
        queueDraw();
      });
      group.append(select, input);
      fragment.append(group);
    }
    $("line-styles").replaceChildren(fragment);
  }

  function renderDolls() {
    const fragment = document.createDocumentFragment();
    dolls.forEach((doll, index) => {
      const card = element("article", "doll-card");
      const heading = element("div", "card-heading");
      const thumb = element("canvas", "thumbnail");
      thumb.width = thumb.height = 104;
      thumb.setAttribute("aria-label", t("thumbnailAria", {index: index + 1}));
      drawPhoto(thumb.getContext("2d"), doll, 0, 0, 104);
      const title = element("div", "card-title");
      title.append(element("span", "card-index", t("dollIndex", {index: String(index + 1).padStart(2, "0")})));
      const name = element("span", "", doll.texts[0] || doll.name || t("photoName"));
      title.append(name);
      const actions = element("div", "card-actions");
      const crop = element("button", "", t("crop"));
      crop.setAttribute("aria-label", t("cropButtonAria", {index: index + 1}));
      crop.addEventListener("click", () => openCrop(doll));
      const remove = element("button", "danger", t("remove"));
      remove.setAttribute("aria-label", t("removeButtonAria", {index: index + 1}));
      remove.addEventListener("click", () => {
        dolls.splice(dolls.indexOf(doll), 1);
        selected = null;
        refresh();
      });
      actions.append(crop, remove);
      heading.append(thumb, title, actions);
      card.append(heading);
      for (let i = 0; i < settings.lineCount; i++) {
        const label = element("label", "text-entry");
        label.append(element("span", "", `0${i + 1}`));
        const input = element("input");
        Object.assign(input, {type: "text", maxLength: 500, value: doll.texts[i] || "", placeholder: t(["placeholderName", "placeholderDetails", "placeholderIntro"][i] || "placeholderLine", {index: i + 1})});
        input.setAttribute("aria-label", t("textAria", {doll: index + 1, line: i + 1}));
        input.addEventListener("input", () => {
          doll.texts[i] = input.value;
          if (i === 0) {
            name.textContent = input.value || doll.name || t("photoName");
            $("grid").children[index]?.setAttribute("aria-label", t("occupiedAria", {index: index + 1, name: name.textContent}));
          }
          queueDraw();
        });
        label.append(input);
        card.append(label);
      }
      fragment.append(card);
    });
    $("doll-list").replaceChildren(fragment);
  }

  function swap(a, b) {
    if (a === b) { selected = null; renderGrid(); return; }
    if (a < 0 || b < 0 || a >= dolls.length || b >= dolls.length) return;
    [dolls[a], dolls[b]] = [dolls[b], dolls[a]];
    selected = null;
    dragged = null;
    refresh();
    toast(message("swapped", {first: a + 1, second: b + 1}));
  }

  function renderGrid() {
    const grid = $("grid");
    grid.style.gridTemplateColumns = `repeat(${settings.columns}, minmax(0, 1fr))`;
    grid.style.gridTemplateRows = `repeat(${settings.rows}, minmax(0, 1fr))`;
    grid.classList.toggle("no-lines", !$("show-grid").checked);
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < capacity(); i++) {
      const occupied = i < dolls.length;
      const cell = element("button", `grid-cell${occupied ? " occupied" : ""}${selected === i ? " selected" : ""}`);
      cell.type = "button";
      cell.draggable = occupied;
      cell.disabled = !occupied;
      cell.setAttribute("aria-label", occupied ? t("occupiedAria", {index: i + 1, name: dolls[i].texts[0] || dolls[i].name || t("photoName")}) : t("emptyAria", {index: i + 1}));
      cell.setAttribute("aria-pressed", String(selected === i));
      cell.append(element("span", "position-label", String(i + 1).padStart(2, "0")));
      cell.addEventListener("click", () => {
        if (busy) return;
        if (selected !== null) swap(selected, i);
        else { selected = i; renderGrid(); }
      });
      cell.addEventListener("dragstart", event => {
        if (busy) { event.preventDefault(); return; }
        dragged = i;
        selected = null;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(i));
      });
      cell.addEventListener("dragover", event => {
        if (dragged === null || !occupied) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        cell.classList.add("drop-target");
      });
      cell.addEventListener("dragleave", () => cell.classList.remove("drop-target"));
      cell.addEventListener("drop", event => {
        event.preventDefault();
        cell.classList.remove("drop-target");
        if (dragged !== null && !busy) swap(dragged, i);
      });
      cell.addEventListener("dragend", () => {
        dragged = null;
        document.querySelectorAll(".drop-target").forEach(el => el.classList.remove("drop-target"));
      });
      fragment.append(cell);
    }
    grid.replaceChildren(fragment);
    $("selection-hint").textContent = selected === null ? t("selectionHint") : t("selectedHint", {index: selected + 1});
  }

  function queueDraw() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; drawPreview(); });
  }

  function drawPhoto(ctx, doll, x, y, size) {
    if (size <= 0) return;
    const {crop, image} = doll;
    const side = Math.min(image.naturalWidth, image.naturalHeight) / crop.zoom;
    ctx.save();
    ctx.beginPath();
    if (crop.shape === "circle") ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
    else ctx.rect(x, y, size, size);
    ctx.clip();
    ctx.drawImage(image, crop.x - side / 2, crop.y - side / 2, side, side, x, y, size, size);
    ctx.restore();
  }

  function fitText(ctx, value, maxWidth) {
    const chars = Array.from(value);
    if (ctx.measureText(value).width <= maxWidth) return value;
    let lo = 0, hi = chars.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (ctx.measureText(chars.slice(0, mid).join("") + "…").width <= maxWidth) lo = mid;
      else hi = mid - 1;
    }
    return ctx.measureText("…").width <= maxWidth ? chars.slice(0, lo).join("") + "…" : "";
  }

  // The preview and PNG export both use this renderer. UI guides are separate DOM elements.
  function drawScene(canvas, width, height) {
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw failure("canvasFailed");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (!settings.transparent) { ctx.fillStyle = settings.background; ctx.fillRect(0, 0, width, height); }
    const padX = width * .035, padY = height * .035;
    const gapX = width * .015, gapY = height * .015;
    const cellW = (width - padX * 2 - gapX * (settings.columns - 1)) / settings.columns;
    const cellH = (height - padY * 2 - gapY * (settings.rows - 1)) / settings.rows;
    // Size settings use a 4096px reference, so output resolution changes do not change composition.
    const unit = Math.min(width, height) / 4096;
    const sizes = settings.styles.slice(0, settings.lineCount).map(s => s.size * settings.textScale / 100 * unit);
    const lineHeights = sizes.map(s => s * 1.45);
    const textHeight = lineHeights.reduce((a, b) => a + b, 0);
    const separation = 35 * unit;
    dolls.forEach((doll, index) => {
      const x = padX + (index % settings.columns) * (cellW + gapX);
      const y = padY + Math.floor(index / settings.columns) * (cellH + gapY);
      const imageSize = Math.max(0, Math.min(cellW * .94, cellH - textHeight - separation) * settings.imageScale / 100);
      const groupHeight = imageSize + (imageSize ? separation : 0) + textHeight;
      const top = y + Math.max(0, (cellH - groupHeight) / 2);
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, cellW, cellH); ctx.clip();
      drawPhoto(ctx, doll, x + (cellW - imageSize) / 2, top, imageSize);
      let textY = top + imageSize + (imageSize ? separation : 0);
      ctx.fillStyle = settings.foreground;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let i = 0; i < settings.lineCount; i++) {
        ctx.font = `${sizes[i]}px ${fontFamily(settings.styles[i].font)}`;
        ctx.fillText(fitText(ctx, doll.texts[i] || "", cellW * .94), x + cellW / 2, textY + lineHeights[i] / 2);
        textY += lineHeights[i];
      }
      ctx.restore();
    });
  }

  function drawPreview() {
    const ratio = Math.min(1, 1400 / Math.max(settings.width, settings.height));
    drawScene($("preview"), Math.max(1, Math.round(settings.width * ratio)), Math.max(1, Math.round(settings.height * ratio)));
    $("board").style.aspectRatio = `${settings.width} / ${settings.height}`;
  }

  function refresh() {
    renderDolls(); renderGrid(); syncAvailability(); queueDraw();
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth * image.naturalHeight > 100000000) reject(failure("imageTooLarge"));
        else resolve(image);
      };
      image.onerror = () => reject(failure("imageUnreadable"));
      image.src = src;
    });
  }

  function readDataURL(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(failure("fileReadFailed"));
      reader.readAsDataURL(file);
    });
  }

  async function addPhotos(files) {
    let added = [];
    let skipped = 0;
    const errors = [];
    await task(async () => {
      for (const file of files) {
        if (dolls.length >= capacity()) { skipped++; continue; }
        try {
          if (file.size > 30 * 1024 * 1024) throw failure("photoFileTooLarge", {name: file.name});
          if (!/^image\/(jpeg|png|webp|gif|bmp|avif|x-icon)$/i.test(file.type)) throw failure("photoUnsupported", {name: file.name});
          const src = await readDataURL(file);
          const image = await loadImage(src);
          const doll = {name: file.name, src, image, texts: Array(8).fill(""), crop: {shape: "circle", zoom: 1, x: image.naturalWidth / 2, y: image.naturalHeight / 2}};
          dolls.push(doll); added.push(doll);
        } catch (error) { errors.push(error.info || message("operationFailed")); }
      }
      selected = null;
      refresh();
    });
    if (errors.length) toast(errors, true);
    else if (added.length) toast([message("photosAdded", {count: added.length}), skipped ? message("photosSkipped", {count: skipped}) : message("cropTip")]);
    if (added.length === 1 && files.length === 1) openCrop(added[0]);
  }

  function normalizeCrop(crop, image) {
    crop.zoom = clamp(crop.zoom, 1, 5);
    const half = Math.min(image.naturalWidth, image.naturalHeight) / crop.zoom / 2;
    crop.x = clamp(crop.x, half, image.naturalWidth - half);
    crop.y = clamp(crop.y, half, image.naturalHeight - half);
  }

  function openCrop(doll) {
    if (busy) return;
    cropTarget = doll;
    cropDraft = {...doll.crop};
    $("crop-dialog").showModal();
    syncCrop();
  }

  function syncCrop() {
    if (!cropTarget) return;
    normalizeCrop(cropDraft, cropTarget.image);
    $("crop-zoom").value = cropDraft.zoom;
    $("crop-zoom-value").value = `${Math.round(cropDraft.zoom * 100)}%`;
    document.querySelectorAll('input[name="shape"]').forEach(el => { el.checked = el.value === cropDraft.shape; });
    drawCrop();
  }

  function drawCrop() {
    const canvas = $("crop-canvas"), ctx = canvas.getContext("2d");
    const size = canvas.width, frame = size * .8;
    const {image} = cropTarget;
    const side = Math.min(image.naturalWidth, image.naturalHeight) / cropDraft.zoom;
    const scale = frame / side;
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "#c9cec6"; ctx.fillRect(0, 0, size, size);
    ctx.drawImage(image, size / 2 - cropDraft.x * scale, size / 2 - cropDraft.y * scale, image.naturalWidth * scale, image.naturalHeight * scale);
    ctx.beginPath(); ctx.rect(0, 0, size, size);
    if (cropDraft.shape === "circle") { ctx.moveTo(size / 2 + frame / 2, size / 2); ctx.arc(size / 2, size / 2, frame / 2, 0, Math.PI * 2); }
    else ctx.rect((size - frame) / 2, (size - frame) / 2, frame, frame);
    ctx.fillStyle = "#10251fc4"; ctx.fill("evenodd");
    ctx.beginPath();
    if (cropDraft.shape === "circle") ctx.arc(size / 2, size / 2, frame / 2, 0, Math.PI * 2);
    else ctx.rect((size - frame) / 2, (size - frame) / 2, frame, frame);
    ctx.strokeStyle = "white"; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = "#ffffff50"; ctx.lineWidth = 1;
    // A small center cross makes alignment easier without hiding the photo.
    ctx.beginPath(); ctx.moveTo(size / 2 - 10, size / 2); ctx.lineTo(size / 2 + 10, size / 2);
    ctx.moveTo(size / 2, size / 2 - 10); ctx.lineTo(size / 2, size / 2 + 10); ctx.stroke();
  }

  let pointer = null;
  $("crop-canvas").addEventListener("pointerdown", event => {
    pointer = {id: event.pointerId, x: event.clientX, y: event.clientY};
    event.currentTarget.setPointerCapture(event.pointerId);
  });
  $("crop-canvas").addEventListener("pointermove", event => {
    if (!pointer || !cropTarget || event.pointerId !== pointer.id) return;
    const side = Math.min(cropTarget.image.naturalWidth, cropTarget.image.naturalHeight) / cropDraft.zoom;
    const scale = side / (event.currentTarget.getBoundingClientRect().width * .8);
    cropDraft.x -= (event.clientX - pointer.x) * scale;
    cropDraft.y -= (event.clientY - pointer.y) * scale;
    pointer.x = event.clientX; pointer.y = event.clientY;
    syncCrop();
  });
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) $("crop-canvas").addEventListener(event, () => { pointer = null; });
  $("crop-canvas").addEventListener("wheel", event => {
    event.preventDefault();
    if (!cropDraft) return;
    cropDraft.zoom *= Math.exp(-event.deltaY * .001);
    syncCrop();
  }, {passive: false});
  $("crop-canvas").addEventListener("keydown", event => {
    const deltas = {ArrowLeft: [1, 0], ArrowRight: [-1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1]};
    if (!cropTarget || !deltas[event.key]) return;
    event.preventDefault();
    const step = Math.min(cropTarget.image.naturalWidth, cropTarget.image.naturalHeight) / cropDraft.zoom * (event.shiftKey ? .05 : .01);
    cropDraft.x += deltas[event.key][0] * step;
    cropDraft.y += deltas[event.key][1] * step;
    syncCrop();
  });
  $("crop-zoom").addEventListener("input", () => { cropDraft.zoom = Number($("crop-zoom").value); syncCrop(); });
  document.querySelectorAll('input[name="shape"]').forEach(el => el.addEventListener("change", () => { cropDraft.shape = el.value; syncCrop(); }));
  $("reset-crop").addEventListener("click", () => {
    Object.assign(cropDraft, {zoom: 1, x: cropTarget.image.naturalWidth / 2, y: cropTarget.image.naturalHeight / 2});
    syncCrop();
  });
  $("confirm-crop").addEventListener("click", () => {
    cropTarget.crop = {...cropDraft};
    $("crop-dialog").close();
    refresh();
  });
  $("crop-dialog").addEventListener("close", () => { cropTarget = cropDraft = pointer = null; });

  function download(blob, name) {
    const url = URL.createObjectURL(blob);
    const anchor = element("a");
    anchor.href = url; anchor.download = name;
    document.body.append(anchor); anchor.click(); anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }

  const dateStamp = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  };

  $("export").addEventListener("click", () => task(async () => {
    if (!dolls.length) return;
    toast(message("generating"));
    await document.fonts.ready;
    // Yield once so the busy message can paint before the full-resolution render.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const canvas = document.createElement("canvas");
    try {
      drawScene(canvas, settings.width, settings.height);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw failure("exportFailed");
      download(blob, `${t("imageFilename")}-${dateStamp()}.png`);
      toast(message("exported", {width: settings.width, height: settings.height}));
    } finally { canvas.width = canvas.height = 1; }
  }));

  $("save-project").addEventListener("click", () => task(async () => {
    const project = {format: "dollfolio", version: 1, settings,
      dolls: dolls.map(({name, src, texts, crop}) => ({name, src, texts, crop}))};
    download(new Blob([JSON.stringify(project)], {type: "application/json"}), `${t("projectFilename")}-${dateStamp()}.json`);
    toast(message("projectSaved"));
  }));

  function validateSettings(raw) {
    if (!raw || typeof raw !== "object") throw failure("missingSettings");
    const ranges = {columns:[1,12], rows:[1,12], width:[256,8192], height:[256,8192], lineCount:[1,8], imageScale:[25,100], textScale:[50,200]};
    const result = {};
    for (const [key, [min, max]] of Object.entries(ranges)) {
      if (!Number.isInteger(raw[key]) || raw[key] < min || raw[key] > max) throw failure("invalidSetting", {field: message(key)});
      result[key] = raw[key];
    }
    if (result.width * result.height > 33554432) throw failure("pixelLimit");
    for (const key of ["background", "foreground"]) {
      if (!/^#[0-9a-f]{6}$/i.test(raw[key])) throw failure("invalidColors");
      result[key] = raw[key];
    }
    if (!Array.isArray(raw.styles) || raw.styles.length < result.lineCount) throw failure("invalidFonts");
    result.styles = Array.from({length: 8}, (_, i) => {
      const value = raw.styles[i];
      if (value === undefined && i >= result.lineCount) return defaultStyle(i);
      if (!value || !fonts.some(f => f[0] === value.font) || !Number.isInteger(value.size) || value.size < 8 || value.size > 240) throw failure("invalidFonts");
      return {font: value.font, size: value.size};
    });
    result.transparent = raw.transparent === true;
    return result;
  }

  function confirmReplace() {
    return new Promise(resolve => {
      const dialog = $("replace-dialog");
      dialog.returnValue = "cancel";
      dialog.addEventListener("close", () => resolve(dialog.returnValue === "open"), {once: true});
      dialog.showModal();
    });
  }

  async function importProject(file) {
    if (dolls.length && !await confirmReplace()) return;
    await task(async () => {
      if (file.size > 150 * 1024 * 1024) throw failure("projectTooLarge");
      let raw;
      try { raw = JSON.parse(await file.text()); }
      catch { throw failure("invalidJson"); }
      if (!raw || raw.format !== "dollfolio" || raw.version !== 1) throw failure("invalidProject");
      const newSettings = validateSettings(raw.settings);
      if (!Array.isArray(raw.dolls) || raw.dolls.length > newSettings.columns * newSettings.rows) throw failure("projectOverflow");
      const loaded = [];
      for (const value of raw.dolls) {
        if (!value || typeof value.src !== "string" || !/^data:image\/(jpeg|png|webp|gif|bmp|avif|x-icon);base64,/i.test(value.src)) throw failure("invalidPhoto");
        const image = await loadImage(value.src);
        const crop = value.crop;
        if (!crop || !["circle", "square"].includes(crop.shape) || ![crop.x,crop.y,crop.zoom].every(Number.isFinite) || crop.zoom < 1 || crop.zoom > 5) throw failure("invalidCrop");
        if (!Array.isArray(value.texts) || value.texts.length > 8 || value.texts.some(t => typeof t !== "string" || t.length > 500)) throw failure("invalidText");
        const normalized = {shape: crop.shape, zoom: crop.zoom, x: crop.x, y: crop.y};
        normalizeCrop(normalized, image);
        loaded.push({name: typeof value.name === "string" ? value.name.slice(0, 255) : "", src: value.src, image,
          texts: Array.from({length: 8}, (_, i) => value.texts[i] || ""), crop: normalized});
      }
      // Apply only after the entire file has loaded and validated successfully.
      settings = newSettings;
      dolls = loaded;
      selected = null;
      fillSettings(); refresh();
      toast(message("projectOpened", {count: dolls.length}));
    });
  }

  const numbers = {columns:["columns",1,12], rows:["rows",1,12], width:["width",256,8192], height:["height",256,8192], "line-count":["lineCount",1,8]};
  for (const [id, [key, min, max]] of Object.entries(numbers)) {
    $(id).addEventListener("change", () => {
      const candidate = clamp(Math.round(Number($(id).value) || settings[key]), min, max);
      // A browser may also commit a native change on blur after a dispatched change.
      // Avoid rebuilding text fields when the setting did not actually change.
      if (candidate === settings[key]) { $(id).value = candidate; return; }
      const next = {...settings, [key]: candidate};
      if (next.columns * next.rows < dolls.length) {
        $(id).value = settings[key];
        toast(message("gridTooSmall", {count: dolls.length}), true);
        return;
      }
      if (next.width * next.height > 33554432) {
        $(id).value = settings[key];
        toast(message("pixelLimit"), true);
        return;
      }
      settings[key] = candidate;
      $(id).value = candidate;
      if (key === "lineCount") { renderStyles(); renderDolls(); }
      selected = null;
      renderGrid(); syncAvailability(); queueDraw();
    });
  }
  for (const [id, key] of [["image-scale", "imageScale"], ["text-scale", "textScale"], ["background", "background"], ["foreground", "foreground"]]) {
    $(id).addEventListener("input", () => {
      settings[key] = $(id).type === "range" ? Number($(id).value) : $(id).value;
      syncAvailability(); queueDraw();
    });
  }
  $("transparent").addEventListener("change", () => { settings.transparent = $("transparent").checked; syncAvailability(); queueDraw(); });
  $("show-grid").addEventListener("change", renderGrid);
  for (const id of ["add", "empty-add"]) $(id).addEventListener("click", () => { if (!busy) $("photo-input").click(); });
  $("photo-input").addEventListener("change", async event => {
    const files = [...event.target.files];
    event.target.value = "";
    if (files.length) await addPhotos(files);
  });
  $("open-project").addEventListener("click", () => $("project-input").click());
  $("project-input").addEventListener("change", async event => {
    const file = event.target.files[0];
    event.target.value = "";
    if (file) await importProject(file);
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && selected !== null && !cropTarget && !$("replace-dialog").open) { selected = null; renderGrid(); }
  });
  window.addEventListener("beforeunload", event => {
    if (dolls.length) { event.preventDefault(); event.returnValue = ""; }
  });
  $("language-switcher").addEventListener("click", event => {
    const button = event.target.closest("button[data-language]");
    if (!button || busy) return;
    i18n.setLanguage(button.dataset.language);
    applyLanguage();
  });
  fillSettings(); applyLanguage();
  document.fonts.ready.then(queueDraw);
})();
