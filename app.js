"use strict";

(() => {
  const $ = id => document.getElementById(id);
  const i18n = window.DollfolioI18n;
  const t = i18n.t;
  const fixedAspects = {"ratio-4-3": 4/3, "ratio-3-2": 3/2, "ratio-2-3": 2/3, "ratio-3-4": 3/4, "ratio-4-5": 4/5};
  const cropShapes = ["circle", "square", "rectangle", "cat", "star5", "star6", "heart", "triangle", "triangleDown", ...Object.keys(fixedAspects)];
  const message = (key, params = {}) => ({key, params});
  let statusMessage = null;
  let statusError = false;
  const fonts = [
    ["sans", "fontSans", '"Microsoft YaHei", "PingFang SC", "Yu Gothic", "Malgun Gothic", sans-serif'],
    ["serif", "fontSerif", '"Noto Serif CJK SC", "Songti SC", "SimSun", "Yu Mincho", "Batang", serif'],
    ["kai", "fontKai", '"KaiTi", "STKaiti", "BiauKai", serif'],
    ["mono", "fontMono", '"Cascadia Code", "Consolas", "Microsoft YaHei", monospace']
  ];
  const defaultStyle = i => ({font: i ? "sans" : "serif", size: i ? 42 : 64, background: "#ffffff", transparent: true});
  const defaultLineColors = () => Array.from({length: 8}, () => ({foreground: null, background: null}));
  let settings = {columns: 3, rows: 3, width: 4096, height: 4096, lineCount: 3,
    imageScale: 85, textScale: 100, background: "#fffdf8", foreground: "#313c36", transparent: false,
    textPosition: "outside", textAlign: "center", textOffset: 100, pageTitle: "", styles: Array.from({length: 8}, (_, i) => defaultStyle(i))};
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
    document.querySelectorAll("[data-i18n-placeholder]").forEach(el => { el.placeholder = t(el.dataset.i18nPlaceholder); });
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
    $("export").disabled = (!dolls.length && !settings.pageTitle.trim()) || busy;
    $("preview-empty").hidden = dolls.length > 0 || !!settings.pageTitle.trim();
    $("capacity-message").textContent = full ? t("full") : t("remaining", {count: capacity() - dolls.length});
    $("dimensions").textContent = `${settings.width} × ${settings.height} px`;
    $("image-scale-value").value = `${settings.imageScale}%`;
    $("text-scale-value").value = `${settings.textScale}%`;
    $("background").disabled = busy || settings.transparent;
    $("text-offset").disabled = busy || settings.textPosition === "inside";
    $("text-offset-value").value = `${settings.textOffset}%`;
  }

  function fillSettings() {
    const fields = {columns:"columns", rows:"rows", width:"width", height:"height", "line-count":"lineCount", "image-scale":"imageScale", "text-scale":"textScale", background:"background", foreground:"foreground"};
    for (const [id, key] of Object.entries(fields)) $(id).value = settings[key];
    $("transparent").checked = settings.transparent;
    $("text-position").value = settings.textPosition;
    $("text-align").value = settings.textAlign;
    $("text-offset").value = settings.textOffset;
    $("page-title").value = settings.pageTitle;
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
      const backgroundLabel = element("label", "line-background");
      backgroundLabel.append(element("span", "", t("textBackground")));
      const color = element("input");
      Object.assign(color, {type: "color", value: settings.styles[i].background});
      color.setAttribute("aria-label", t("lineBackgroundAria", {index: i + 1}));
      backgroundLabel.append(color);
      const transparentLabel = element("label", "check-label");
      const transparent = element("input");
      Object.assign(transparent, {type: "checkbox", checked: settings.styles[i].transparent});
      transparent.setAttribute("aria-label", t("lineTransparentAria", {index: i + 1}));
      transparentLabel.append(transparent, element("span", "", t("transparentOption")));
      color.addEventListener("input", () => {
        settings.styles[i].background = color.value;
        settings.styles[i].transparent = transparent.checked = false;
        queueDraw();
      });
      transparent.addEventListener("change", () => { settings.styles[i].transparent = transparent.checked; queueDraw(); });
      group.append(backgroundLabel, transparentLabel);
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
            $("grid").children[index]?.querySelector(".grid-cell")?.setAttribute("aria-label", t("occupiedAria", {index: index + 1, name: name.textContent}));
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
    positionGrid();
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
      const entry = element("div", "grid-entry");
      entry.append(cell);
      if (occupied) {
        const doll = dolls[i];
        const tools = element("div", "cell-background-tools");
        const colorLabel = element("label", "cell-color-label");
        colorLabel.append(element("span", "", t("cellBackground")));
        const color = element("input");
        Object.assign(color, {type: "color", value: doll.background});
        color.setAttribute("aria-label", t("cellBackgroundAria", {index: i + 1}));
        colorLabel.append(color);
        const transparentLabel = element("label", "check-label");
        const transparent = element("input");
        Object.assign(transparent, {type: "checkbox", checked: doll.transparent});
        transparent.setAttribute("aria-label", t("cellTransparentAria", {index: i + 1}));
        transparentLabel.append(transparent, element("span", "", t("transparentOption")));
        color.addEventListener("input", () => { doll.background = color.value; doll.transparent = transparent.checked = false; queueDraw(); });
        transparent.addEventListener("change", () => { doll.transparent = transparent.checked; queueDraw(); });
        tools.append(colorLabel, transparentLabel);
        const details = element("details", "cell-text-colors");
        details.append(element("summary", "", t("cellTextColors")));
        const panel = element("div", "cell-line-settings");
        for (let line = 0; line < settings.lineCount; line++) {
          const row = element("div", "cell-line-colors");
          row.append(element("strong", "", t("line", {index: line + 1})));
          for (const field of ["foreground", "background"]) {
            const label = element("label", "cell-line-color");
            label.append(element("span", "", t(field === "foreground" ? "foreground" : "textBackground")));
            const mode = element("select");
            for (const [key, textKey] of [["default", "useDefault"], ["color", "customColor"], ...(field === "background" ? [["transparent", "transparentOption"]] : [])]) {
              const option = element("option", "", t(textKey)); option.value = key; mode.append(option);
            }
            const override = doll.lineColors[line];
            mode.value = override[field] === null ? "default" : override[field] === "transparent" ? "transparent" : "color";
            const picker = element("input");
            Object.assign(picker, {type: "color", value: /^#[0-9a-f]{6}$/i.test(override[field] || "") ? override[field] : field === "foreground" ? settings.foreground : settings.styles[line].background});
            const aria = t(field === "foreground" ? "cellLineForeground" : "cellLineBackground", {doll: i + 1, line: line + 1});
            mode.setAttribute("aria-label", `${aria} · ${t("colorMode")}`);
            picker.setAttribute("aria-label", aria);
            mode.dataset.field = picker.dataset.field = field;
            mode.dataset.line = picker.dataset.line = line;
            mode.addEventListener("change", () => { override[field] = mode.value === "default" ? null : mode.value === "transparent" ? "transparent" : picker.value; queueDraw(); });
            picker.addEventListener("input", () => { override[field] = picker.value; mode.value = "color"; queueDraw(); });
            label.append(mode, picker); row.append(label);
          }
          panel.append(row);
        }
        details.append(panel);
        details.addEventListener("toggle", () => {
          if (!details.open) return;
          panel.style.transform = "";
          const box = panel.getBoundingClientRect();
          const shift = box.left < 16 ? 16 - box.left : box.right > innerWidth - 16 ? innerWidth - 16 - box.right : 0;
          panel.style.transform = `translateX(${shift}px)`;
        });
        tools.append(details);
        entry.append(tools);
      }
      fragment.append(entry);
    }
    grid.replaceChildren(fragment);
    $("selection-hint").textContent = selected === null ? t("selectionHint") : t("selectedHint", {index: selected + 1});
  }

  function queueDraw() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; drawPreview(); });
  }

  function rotatedBounds(image, rotation = 0) {
    const radians = rotation * Math.PI / 180;
    const cos = Math.cos(radians), sin = Math.sin(radians);
    return {width: Math.abs(image.naturalWidth * cos) + Math.abs(image.naturalHeight * sin),
      height: Math.abs(image.naturalWidth * sin) + Math.abs(image.naturalHeight * cos), cos, sin, radians};
  }

  function drawRotated(ctx, image, rotation, ox, oy, scale) {
    const bounds = rotatedBounds(image, rotation);
    ctx.save();
    ctx.translate(ox + bounds.width * scale / 2, oy + bounds.height * scale / 2);
    ctx.rotate(bounds.radians);
    ctx.drawImage(image, -image.naturalWidth * scale / 2, -image.naturalHeight * scale / 2, image.naturalWidth * scale, image.naturalHeight * scale);
    ctx.restore();
  }

  function cropDimensions(crop, image) {
    const aspect = fixedAspects[crop.shape] || (crop.shape === "rectangle" ? crop.aspect || 1 : 1);
    const bounds = rotatedBounds(image, crop.rotation);
    const width = Math.min(bounds.width, bounds.height * aspect) / crop.zoom;
    return {width, height: width / aspect};
  }

  function photoPath(ctx, shape, x, y, width, height) {
    ctx.beginPath();
    if (shape === "circle") ctx.arc(x + width / 2, y + height / 2, width / 2, 0, Math.PI * 2);
    else if (shape === "cat") {
      const cx = x + width * .5, cy = y + height * .56, radius = width * .44;
      const point = angle => [cx + radius * Math.cos(angle * Math.PI / 180), cy + radius * Math.sin(angle * Math.PI / 180)];
      // Widen each ear's attachment from 40 to 55 degrees around the circle.
      ctx.moveTo(...point(-157.5));
      ctx.lineTo(x + width * .04, y);
      ctx.lineTo(...point(-102.5));
      ctx.arc(cx, cy, radius, -102.5 * Math.PI / 180, -77.5 * Math.PI / 180);
      ctx.lineTo(x + width * .96, y);
      ctx.lineTo(...point(-22.5));
      ctx.arc(cx, cy, radius, -22.5 * Math.PI / 180, 202.5 * Math.PI / 180);
      ctx.closePath();
    }
    else if (["star5", "star6"].includes(shape)) {
      const points = shape === "star5" ? 5 : 6;
      const inner = points === 5 ? .381966 : 1 / Math.sqrt(3);
      for (let i = 0; i < points * 2; i++) {
        const angle = -Math.PI / 2 + i * Math.PI / points;
        const radius = i % 2 ? inner : 1;
        const px = x + width * (.5 + .5 * radius * Math.cos(angle));
        const py = y + height * (.5 + .5 * radius * Math.sin(angle));
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.closePath();
    } else if (shape === "heart") {
      ctx.moveTo(x + width * .5, y + height * .98);
      ctx.bezierCurveTo(x + width * .4, y + height * .82, x, y + height * .56, x, y + height * .27);
      ctx.bezierCurveTo(x, y - height * .02, x + width * .36, y - height * .09, x + width * .5, y + height * .2);
      ctx.bezierCurveTo(x + width * .64, y - height * .09, x + width, y - height * .02, x + width, y + height * .27);
      ctx.bezierCurveTo(x + width, y + height * .56, x + width * .6, y + height * .82, x + width * .5, y + height * .98);
      ctx.closePath();
    } else if (["triangle", "triangleDown"].includes(shape)) {
      const h = Math.sqrt(3) / 2;
      const top = (1 - h) / 2;
      const vertices = [[.5,top],[1,top + h],[0,top + h]];
      vertices.forEach(([px,py], i) => {
        const cy = shape === "triangleDown" ? 1 - py : py;
        if (i === 0) ctx.moveTo(x + px * width, y + cy * height); else ctx.lineTo(x + px * width, y + cy * height);
      });
      ctx.closePath();
    } else ctx.rect(x, y, width, height);
  }

  function drawPhoto(ctx, doll, x, y, width, height = width) {
    if (width <= 0 || height <= 0) return;
    const {crop, image} = doll;
    const source = cropDimensions(crop, image);
    // Thumbnails also preserve a rectangular crop's proportions.
    const factor = Math.min(width / source.width, height / source.height);
    const w = source.width * factor, h = source.height * factor;
    x += (width - w) / 2; y += (height - h) / 2;
    ctx.save();
    photoPath(ctx, crop.shape, x, y, w, h);
    ctx.clip();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x, y, w, h);
    drawRotated(ctx, image, crop.rotation, x - (crop.x - source.width / 2) * factor, y - (crop.y - source.height / 2) * factor, factor);
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

  const maskRows = new Map();
  function maskBandBounds(shape, top, bottom) {
    // Sample the actual mask's central interior, including concave star/heart shapes.
    // Cached normalized geometry keeps screen previews and full-size exports identical.
    if (!maskRows.has(shape)) {
      const ctx = document.createElement("canvas").getContext("2d");
      photoPath(ctx, shape, 0, 0, 1, 1);
      const rows = Array.from({length: 256}, (_, i) => {
        const y = (i + .5) / 256;
        if (!ctx.isPointInPath(.5, y)) return [.5, .5];
        let left = .5, right = .5;
        while (left > 0 && ctx.isPointInPath(left - 1/512, y)) left -= 1/256;
        while (right < 1 && ctx.isPointInPath(right + 1/512, y)) right += 1/256;
        return [left, right];
      });
      maskRows.set(shape, rows);
    }
    const rows = maskRows.get(shape);
    let left = 0, right = 1;
    for (let i = clamp(Math.floor(top * 256), 0, 255); i <= clamp(Math.ceil(bottom * 256), 0, 255); i++) {
      left = Math.max(left, rows[i][0]); right = Math.min(right, rows[i][1]);
    }
    return {left, right, width: Math.max(0, right - left)};
  }

  function bottomTextTop(shape, height) {
    // Start at the bottom and move up only enough for the text to fit inside the mask.
    for (let bottom = .98; bottom >= height; bottom -= 1/256) {
      if (maskBandBounds(shape, bottom - height, bottom).width >= .16) return bottom - height;
    }
    return Math.max(0, (.95 - height) / 2);
  }

  function sceneLayout(width, height) {
    const unit = Math.min(width, height) / 4096;
    const padX = width * .035, padY = height * .035;
    const titleHeight = settings.pageTitle.trim() ? Math.min(height * .18, 200 * unit) : 0;
    const top = padY + titleHeight;
    const gapX = width * .015, gapY = height * .015;
    return {unit, padX, padY, top, titleHeight, gapX, gapY,
      cellW: (width - padX * 2 - gapX * (settings.columns - 1)) / settings.columns,
      cellH: (height - top - padY - gapY * (settings.rows - 1)) / settings.rows};
  }

  function positionGrid() {
    const g = sceneLayout(settings.width, settings.height);
    $("grid").style.top = `${g.top / settings.height * 100}%`;
    $("grid").style.columnGap = `${g.gapX / (settings.width - g.padX * 2) * 100}%`;
    $("grid").style.rowGap = `${g.gapY / (settings.height - g.top - g.padY) * 100}%`;
  }

  // The preview and PNG export both use this renderer. UI guides and controls never export.
  function drawScene(canvas, width, height) {
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw failure("canvasFailed");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    if (!settings.transparent) { ctx.fillStyle = settings.background; ctx.fillRect(0, 0, width, height); }
    const {padX, padY, top: gridTop, titleHeight, gapX, gapY, cellW, cellH, unit} = sceneLayout(width, height);
    if (titleHeight) {
      ctx.font = `${96 * unit}px ${fontFamily(settings.styles[0].font)}`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillStyle = settings.foreground;
      ctx.fillText(fitText(ctx, settings.pageTitle.trim(), width - 2 * padX), width / 2, padY + titleHeight * .4);
    }
    const sizes = settings.styles.slice(0, settings.lineCount).map(s => s.size * settings.textScale / 100 * unit);
    const lineHeights = sizes.map(s => s * 1.45);
    dolls.forEach((doll, index) => {
      const x = padX + (index % settings.columns) * (cellW + gapX);
      const y = gridTop + Math.floor(index / settings.columns) * (cellH + gapY);
      const inside = settings.textPosition === "inside";
      const source = cropDimensions(doll.crop, doll.image);
      // Photo and outside text use independent cell coordinates; neither reserves space for the other.
      const photoScale = Math.min(cellW / source.width, cellH / source.height) * settings.imageScale / 100;
      const photoW = source.width * photoScale, photoH = source.height * photoScale;
      const top = y;
      const photoX = x + (cellW - photoW) / 2;
      ctx.save();
      ctx.beginPath(); ctx.rect(x, y, cellW, cellH); ctx.clip();
      if (!doll.transparent) { ctx.fillStyle = doll.background; ctx.fillRect(x, y, cellW, cellH); }
      drawPhoto(ctx, doll, photoX, top, photoW, photoH);
      const visibleLines = Array.from({length: settings.lineCount}, (_, i) => i).filter(i => !inside || (doll.texts[i] || "").trim());
      const visibleHeight = visibleLines.reduce((sum, i) => sum + lineHeights[i], 0);
      const textFactor = inside && visibleHeight ? Math.min(1, photoH * .3 / visibleHeight) : 1;
      const actualTextHeight = visibleHeight * textFactor;
      let textY = inside ? top + photoH * bottomTextTop(doll.crop.shape, photoH ? actualTextHeight / photoH : 0) : y + Math.max(0, cellH - visibleHeight) * settings.textOffset / 100;
      if (inside) { photoPath(ctx, doll.crop.shape, photoX, top, photoW, photoH); ctx.clip(); }
      ctx.textAlign = settings.textAlign;
      ctx.textBaseline = "middle";
      for (const i of visibleLines) {
        const lineHeight = lineHeights[i] * textFactor;
        let left = x + cellW * .03, right = x + cellW * .97;
        if (inside) {
          const bounds = maskBandBounds(doll.crop.shape, photoH ? (textY - top) / photoH : 0, photoH ? (textY + lineHeight - top) / photoH : 0);
          const inset = (bounds.right - bounds.left) * .03;
          left = photoX + photoW * (bounds.left + inset);
          right = photoX + photoW * (bounds.right - inset);
        }
        const maxWidth = Math.max(0, right - left);
        const textX = settings.textAlign === "left" ? left : settings.textAlign === "right" ? right : (left + right) / 2;
        ctx.font = `${sizes[i] * textFactor}px ${fontFamily(settings.styles[i].font)}`;
        const value = fitText(ctx, doll.texts[i] || "", maxWidth);
        const colors = doll.lineColors[i];
        const background = colors.background === null ? settings.styles[i].transparent ? "transparent" : settings.styles[i].background : colors.background;
        if (value && background !== "transparent") {
          ctx.fillStyle = background;
          const boxWidth = Math.min(maxWidth, ctx.measureText(value).width + 24 * unit);
          const boxX = settings.textAlign === "left" ? left : settings.textAlign === "right" ? right - boxWidth : textX - boxWidth / 2;
          ctx.fillRect(boxX, textY, boxWidth, lineHeight);
        }
        ctx.fillStyle = colors.foreground || settings.foreground;
        ctx.fillText(value, textX, textY + lineHeight / 2);
        textY += lineHeight;
      }
      ctx.restore();
    });
  }

  function drawPreview() {
    const ratio = Math.min(1, 1400 / Math.max(settings.width, settings.height));
    drawScene($("preview"), Math.max(1, Math.round(settings.width * ratio)), Math.max(1, Math.round(settings.height * ratio)));
    $("board").style.aspectRatio = `${settings.width} / ${settings.height}`;
    positionGrid();
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
          const doll = {name: file.name, src, image, texts: Array(8).fill(""), lineColors: defaultLineColors(), background: "#ffffff", transparent: true, crop: {shape: "circle", aspect: 1, rotation: 0, zoom: 1, x: image.naturalWidth / 2, y: image.naturalHeight / 2}};
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
    crop.zoom = clamp(crop.zoom, .2, 5);
    crop.rotation = Number.isFinite(crop.rotation) ? crop.rotation : 0;
    crop.aspect = fixedAspects[crop.shape] || (crop.shape === "rectangle" ? clamp(crop.aspect || 1, .2, 5) : 1);
    const bounds = rotatedBounds(image, crop.rotation);
    const padding = Math.max(bounds.width, bounds.height);
    crop.x = clamp(crop.x, -padding, bounds.width + padding);
    crop.y = clamp(crop.y, -padding, bounds.height + padding);
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
    $("crop-rotation").value = cropDraft.rotation;
    $("crop-angle").value = cropDraft.rotation;
    $("crop-rotation-value").value = `${cropDraft.rotation}°`;
    document.querySelectorAll('input[name="shape"]').forEach(el => { el.checked = el.value === cropDraft.shape; });
    $("rectangle-settings").hidden = cropDraft.shape !== "rectangle";
    const dimensions = cropDimensions(cropDraft, cropTarget.image);
    $("crop-width").value = Math.round(dimensions.width);
    $("crop-height").value = Math.round(dimensions.height);
    const bounds = rotatedBounds(cropTarget.image, cropDraft.rotation);
    $("crop-width").max = Math.round(bounds.width * 5);
    $("crop-height").max = Math.round(bounds.height * 5);
    drawCrop();
  }

  function cropView() {
    const size = $("crop-canvas").width;
    const dimensions = cropDimensions(cropDraft, cropTarget.image);
    const scale = size * .8 / Math.max(dimensions.width, dimensions.height);
    const view = pointer?.mode === "resize" ? pointer.view : {scale, ox: size / 2 - cropDraft.x * scale, oy: size / 2 - cropDraft.y * scale};
    return {...view, x: view.ox + (cropDraft.x - dimensions.width / 2) * view.scale,
      y: view.oy + (cropDraft.y - dimensions.height / 2) * view.scale,
      width: dimensions.width * view.scale, height: dimensions.height * view.scale};
  }

  function setCropSize(width, height, centerX = cropDraft.x, centerY = cropDraft.y) {
    const bounds = rotatedBounds(cropTarget.image, cropDraft.rotation);
    width = clamp(width, 1, bounds.width * 5);
    height = clamp(height, 1, bounds.height * 5);
    cropDraft.aspect = clamp(width / height, .2, 5);
    cropDraft.zoom = clamp(Math.min(bounds.width / width, bounds.height / height), .2, 5);
    cropDraft.x = centerX; cropDraft.y = centerY;
    syncCrop();
  }

  function drawCrop() {
    const canvas = $("crop-canvas"), ctx = canvas.getContext("2d");
    const size = canvas.width;
    const {image} = cropTarget;
    const frame = cropView();
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, size, size);
    drawRotated(ctx, image, cropDraft.rotation, frame.ox, frame.oy, frame.scale);
    ctx.fillStyle = "#10251fc4"; ctx.fillRect(0, 0, size, size);
    ctx.save();
    photoPath(ctx, cropDraft.shape, frame.x, frame.y, frame.width, frame.height);
    ctx.clip();
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, size, size);
    drawRotated(ctx, image, cropDraft.rotation, frame.ox, frame.oy, frame.scale);
    ctx.restore();
    photoPath(ctx, cropDraft.shape, frame.x, frame.y, frame.width, frame.height);
    ctx.strokeStyle = "white"; ctx.lineWidth = 2; ctx.stroke();
    if (cropDraft.shape === "rectangle") {
      ctx.fillStyle = "white";
      for (const [dx, dy] of [[0,0],[1,0],[0,1],[1,1]]) ctx.fillRect(frame.x + dx * frame.width - 6, frame.y + dy * frame.height - 6, 12, 12);
    }
    ctx.strokeStyle = "#ffffff50"; ctx.lineWidth = 1;
    // A small center cross makes alignment easier without hiding the photo.
    ctx.beginPath(); ctx.moveTo(size / 2 - 10, size / 2); ctx.lineTo(size / 2 + 10, size / 2);
    ctx.moveTo(size / 2, size / 2 - 10); ctx.lineTo(size / 2, size / 2 + 10); ctx.stroke();
  }

  let pointer = null;
  $("crop-canvas").addEventListener("pointerdown", event => {
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) * 480 / box.width;
    const y = (event.clientY - box.top) * 480 / box.height;
    const frame = cropView();
    const corner = cropDraft.shape === "rectangle" ? [[0,0],[1,0],[0,1],[1,1]].find(([dx,dy]) => Math.hypot(x - frame.x - dx * frame.width, y - frame.y - dy * frame.height) < 20) : null;
    pointer = {id: event.pointerId, x: event.clientX, y: event.clientY, mode: corner ? "resize" : "pan", view: frame};
    if (corner) {
      const dimensions = cropDimensions(cropDraft, cropTarget.image);
      pointer.anchorX = cropDraft.x + (corner[0] ? -1 : 1) * dimensions.width / 2;
      pointer.anchorY = cropDraft.y + (corner[1] ? -1 : 1) * dimensions.height / 2;
      pointer.signX = corner[0] ? 1 : -1; pointer.signY = corner[1] ? 1 : -1;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
  });
  $("crop-canvas").addEventListener("pointermove", event => {
    if (!pointer || !cropTarget || event.pointerId !== pointer.id) return;
    const box = event.currentTarget.getBoundingClientRect();
    if (pointer.mode === "resize") {
      const bounds = rotatedBounds(cropTarget.image, cropDraft.rotation);
      const padding = Math.max(bounds.width, bounds.height);
      let x = clamp(((event.clientX - box.left) * 480 / box.width - pointer.view.ox) / pointer.view.scale, -padding, bounds.width + padding);
      let y = clamp(((event.clientY - box.top) * 480 / box.height - pointer.view.oy) / pointer.view.scale, -padding, bounds.height + padding);
      x = pointer.anchorX + pointer.signX * Math.max(1, pointer.signX * (x - pointer.anchorX));
      y = pointer.anchorY + pointer.signY * Math.max(1, pointer.signY * (y - pointer.anchorY));
      setCropSize(Math.abs(x - pointer.anchorX), Math.abs(y - pointer.anchorY), (x + pointer.anchorX) / 2, (y + pointer.anchorY) / 2);
      return;
    }
    const scale = 480 / box.width / cropView().scale;
    cropDraft.x -= (event.clientX - pointer.x) * scale;
    cropDraft.y -= (event.clientY - pointer.y) * scale;
    pointer.x = event.clientX; pointer.y = event.clientY;
    syncCrop();
  });
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) $("crop-canvas").addEventListener(event, () => { pointer = null; if (cropTarget) drawCrop(); });
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
  function rotateCrop(angle) {
    if (!cropTarget || !Number.isFinite(angle)) return;
    pointer = null;
    const old = rotatedBounds(cropTarget.image, cropDraft.rotation);
    const dx = cropDraft.x - old.width / 2, dy = cropDraft.y - old.height / 2;
    const originalX = dx * old.cos + dy * old.sin;
    const originalY = -dx * old.sin + dy * old.cos;
    cropDraft.rotation = ((Math.round(angle) + 180) % 360 + 360) % 360 - 180;
    const next = rotatedBounds(cropTarget.image, cropDraft.rotation);
    cropDraft.x = next.width / 2 + originalX * next.cos - originalY * next.sin;
    cropDraft.y = next.height / 2 + originalX * next.sin + originalY * next.cos;
    syncCrop();
  }
  $("crop-rotation").addEventListener("input", () => rotateCrop(Number($("crop-rotation").value)));
  $("crop-angle").addEventListener("change", () => rotateCrop(Number($("crop-angle").value)));
  $("rotate-left").addEventListener("click", () => rotateCrop(cropDraft.rotation - 90));
  $("rotate-right").addEventListener("click", () => rotateCrop(cropDraft.rotation + 90));
  $("reset-rotation").addEventListener("click", () => rotateCrop(0));
  for (const id of ["crop-width", "crop-height"]) $(id).addEventListener("change", () => {
    setCropSize(Number($("crop-width").value) || 1, Number($("crop-height").value) || 1);
  });
  document.querySelectorAll('input[name="shape"]').forEach(el => el.addEventListener("change", () => { cropDraft.shape = el.value; syncCrop(); }));
  $("reset-crop").addEventListener("click", () => {
    const bounds = rotatedBounds(cropTarget.image, cropDraft.rotation);
    Object.assign(cropDraft, {zoom: 1, aspect: 1, x: bounds.width / 2, y: bounds.height / 2});
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
    if (!dolls.length && !settings.pageTitle.trim()) return;
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
      dolls: dolls.map(({name, src, texts, crop, background, transparent, lineColors}) => ({name, src, texts, crop, background, transparent, lineColors}))};
    download(new Blob([JSON.stringify(project)], {type: "application/json"}), `${t("projectFilename")}-${dateStamp()}.json`);
    toast(message("projectSaved"));
  }));

  function validateBackground(raw) {
    const background = raw.background === undefined ? "#ffffff" : raw.background;
    const transparent = raw.transparent === undefined ? true : raw.transparent;
    if (typeof background !== "string" || !/^#[0-9a-f]{6}$/i.test(background) || typeof transparent !== "boolean") throw failure("invalidAppearance");
    return {background, transparent};
  }

  function validateLineColors(raw) {
    if (raw === undefined) return defaultLineColors();
    if (!Array.isArray(raw) || raw.length > 8) throw failure("invalidAppearance");
    return Array.from({length: 8}, (_, i) => {
      if (raw[i] === undefined) return {foreground: null, background: null};
      const value = raw[i];
      if (!value || typeof value !== "object") throw failure("invalidAppearance");
      const result = {};
      for (const field of ["foreground", "background"]) {
        const color = value[field] === undefined ? null : value[field];
        if (color !== null && !(field === "background" && color === "transparent") && (typeof color !== "string" || !/^#[0-9a-f]{6}$/i.test(color))) throw failure("invalidAppearance");
        result[field] = color;
      }
      return result;
    });
  }

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
      return {font: value.font, size: value.size, ...validateBackground(value)};
    });
    result.transparent = raw.transparent === true;
    result.textPosition = raw.textPosition === undefined ? "outside" : raw.textPosition;
    result.textAlign = raw.textAlign === undefined ? "center" : raw.textAlign;
    result.textOffset = raw.textOffset === undefined ? 100 : raw.textOffset;
    result.pageTitle = raw.pageTitle === undefined ? "" : raw.pageTitle;
    if (!["outside", "inside"].includes(result.textPosition) || !["left", "center", "right"].includes(result.textAlign) || !Number.isInteger(result.textOffset) || result.textOffset < 0 || result.textOffset > 100 || typeof result.pageTitle !== "string" || result.pageTitle.length > 200) throw failure("invalidAppearance");
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
    if ((dolls.length || settings.pageTitle.trim()) && !await confirmReplace()) return;
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
        if (!crop || !cropShapes.includes(crop.shape) || ![crop.x,crop.y,crop.zoom].every(Number.isFinite) || crop.zoom < .2 || crop.zoom > 5 ||
          (crop.rotation !== undefined && (!Number.isInteger(crop.rotation) || crop.rotation < -180 || crop.rotation > 180)) ||
          (crop.shape === "rectangle" && (!Number.isFinite(crop.aspect) || crop.aspect < .2 || crop.aspect > 5))) throw failure("invalidCrop");
        if (!Array.isArray(value.texts) || value.texts.length > 8 || value.texts.some(t => typeof t !== "string" || t.length > 500)) throw failure("invalidText");
        const normalized = {shape: crop.shape, zoom: crop.zoom, x: crop.x, y: crop.y, aspect: crop.aspect || 1, rotation: crop.rotation || 0};
        normalizeCrop(normalized, image);
        loaded.push({name: typeof value.name === "string" ? value.name.slice(0, 255) : "", src: value.src, image, lineColors: validateLineColors(value.lineColors), ...validateBackground(value),
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
  $("text-position").addEventListener("change", () => { settings.textPosition = $("text-position").value; syncAvailability(); queueDraw(); });
  $("text-offset").addEventListener("input", () => { settings.textOffset = Number($("text-offset").value); syncAvailability(); queueDraw(); });
  $("text-align").addEventListener("change", () => { settings.textAlign = $("text-align").value; queueDraw(); });
  $("page-title").addEventListener("input", () => { settings.pageTitle = $("page-title").value; syncAvailability(); queueDraw(); });
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
    if (dolls.length || settings.pageTitle.trim()) { event.preventDefault(); event.returnValue = ""; }
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
