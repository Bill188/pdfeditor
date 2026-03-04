/* ============================================
   PDF Editor - Application Logic
   ============================================ */

(() => {
  'use strict';

  // ---- Configure PDF.js worker ----
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const { PDFDocument, rgb, StandardFonts, degrees } = PDFLib;

  // ============================================
  // State
  // ============================================
  const state = {
    pdfDoc: null,          // pdf.js document (for rendering)
    pdfLibDoc: null,       // pdf-lib document (for editing)
    pdfBytes: null,        // raw bytes of the current PDF
    currentPage: 1,
    totalPages: 0,
    zoom: 1.0,
    activeTool: 'select',
    color: '#000000',
    fontSize: 16,
    fontName: 'Helvetica',
    annotations: {},       // page => [annotation]
    undoStack: [],
    redoStack: [],
    isDrawing: false,
    drawPoints: [],
    textPosition: null,
    imageToAdd: null,
    fileName: '',
  };

  // ============================================
  // DOM References
  // ============================================
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const dom = {
    welcomeScreen: $('#welcome-screen'),
    editorScreen: $('#editor-screen'),
    dropZone: $('#drop-zone'),
    browseBtn: $('#browse-btn'),
    fileInput: $('#file-input'),
    pdfCanvas: $('#pdf-canvas'),
    annoCanvas: $('#annotation-canvas'),
    canvasContainer: $('#canvas-container'),
    canvasArea: $('#canvas-area'),
    thumbnails: $('#thumbnails'),
    sidebar: $('#sidebar'),
    sidebarToggle: $('#sidebar-toggle'),
    pageInput: $('#page-input'),
    pageCount: $('#page-count'),
    zoomLevel: $('#zoom-level'),
    optColor: $('#opt-color'),
    optSize: $('#opt-size'),
    optSizeVal: $('#opt-size-val'),
    optFont: $('#opt-font'),
    optFontLabel: $('#opt-font-label'),
    textModal: $('#text-modal'),
    textInput: $('#text-input'),
    textConfirm: $('#text-confirm'),
    textCancel: $('#text-cancel'),
    mergeModal: $('#merge-modal'),
    mergeInput: $('#merge-input'),
    mergeConfirm: $('#merge-confirm'),
    mergeCancel: $('#merge-cancel'),
    toast: $('#toast'),
    toolOptions: $('#tool-options'),
  };

  const pdfCtx = dom.pdfCanvas.getContext('2d');
  const annoCtx = dom.annoCanvas.getContext('2d');

  // ============================================
  // Utility
  // ============================================
  function showToast(message, type = 'info', duration = 2500) {
    dom.toast.textContent = message;
    dom.toast.className = `toast toast-${type}`;
    dom.toast.classList.remove('hidden');
    clearTimeout(dom.toast._timer);
    dom.toast._timer = setTimeout(() => dom.toast.classList.add('hidden'), duration);
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function pdfLibColor(hex) {
    const c = hexToRgb(hex);
    return rgb(c.r / 255, c.g / 255, c.b / 255);
  }

  function pushUndo(action) {
    state.undoStack.push(action);
    state.redoStack = [];
    updateUndoRedoButtons();
  }

  function updateUndoRedoButtons() {
    $('#btn-undo').disabled = state.undoStack.length === 0;
    $('#btn-redo').disabled = state.redoStack.length === 0;
  }

  // ============================================
  // File Loading
  // ============================================
  async function loadPDF(arrayBuffer) {
    try {
      state.pdfBytes = new Uint8Array(arrayBuffer);

      // Load for rendering
      state.pdfDoc = await pdfjsLib.getDocument({ data: state.pdfBytes.slice() }).promise;
      state.totalPages = state.pdfDoc.numPages;
      state.currentPage = 1;
      state.annotations = {};
      state.undoStack = [];
      state.redoStack = [];

      // Load for editing
      state.pdfLibDoc = await PDFDocument.load(state.pdfBytes, { ignoreEncryption: true });

      // Switch views
      dom.welcomeScreen.classList.add('hidden');
      dom.editorScreen.classList.remove('hidden');

      dom.pageCount.textContent = state.totalPages;
      dom.pageInput.max = state.totalPages;

      updateUndoRedoButtons();
      await renderPage(state.currentPage);
      await renderThumbnails();

      showToast('PDF loaded successfully', 'success');
    } catch (err) {
      console.error(err);
      showToast('Failed to load PDF: ' + err.message, 'error', 4000);
    }
  }

  // ============================================
  // Rendering
  // ============================================
  async function renderPage(pageNum) {
    if (!state.pdfDoc) return;

    const page = await state.pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: state.zoom * (window.devicePixelRatio || 1) });
    const cssViewport = page.getViewport({ scale: state.zoom });

    dom.pdfCanvas.width = viewport.width;
    dom.pdfCanvas.height = viewport.height;
    dom.pdfCanvas.style.width = cssViewport.width + 'px';
    dom.pdfCanvas.style.height = cssViewport.height + 'px';

    dom.annoCanvas.width = viewport.width;
    dom.annoCanvas.height = viewport.height;
    dom.annoCanvas.style.width = cssViewport.width + 'px';
    dom.annoCanvas.style.height = cssViewport.height + 'px';

    await page.render({ canvasContext: pdfCtx, viewport }).promise;

    // Redraw annotations for this page
    redrawAnnotations(pageNum);

    dom.pageInput.value = pageNum;
    dom.zoomLevel.textContent = Math.round(state.zoom * 100) + '%';

    // Highlight active thumbnail
    $$('.thumbnail').forEach((t, i) => {
      t.classList.toggle('active', i + 1 === pageNum);
    });
  }

  function redrawAnnotations(pageNum) {
    annoCtx.clearRect(0, 0, dom.annoCanvas.width, dom.annoCanvas.height);
    const dpr = window.devicePixelRatio || 1;
    const annos = state.annotations[pageNum] || [];
    for (const a of annos) {
      if (a.deleted) continue;
      annoCtx.save();
      switch (a.type) {
        case 'freehand':
          drawFreehand(annoCtx, a, dpr);
          break;
        case 'highlight':
          drawHighlight(annoCtx, a, dpr);
          break;
        case 'rect':
          drawRect(annoCtx, a, dpr);
          break;
        case 'whiteout':
          drawWhiteout(annoCtx, a, dpr);
          break;
        case 'text':
          drawTextAnnotation(annoCtx, a, dpr);
          break;
        case 'image':
          drawImageAnnotation(annoCtx, a, dpr);
          break;
      }
      annoCtx.restore();
    }
  }

  function drawFreehand(ctx, a, dpr) {
    if (a.points.length < 2) return;
    ctx.strokeStyle = a.color;
    ctx.lineWidth = a.size * dpr;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(a.points[0].x * dpr, a.points[0].y * dpr);
    for (let i = 1; i < a.points.length; i++) {
      ctx.lineTo(a.points[i].x * dpr, a.points[i].y * dpr);
    }
    ctx.stroke();
  }

  function drawHighlight(ctx, a, dpr) {
    ctx.fillStyle = a.color;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(
      Math.min(a.startX, a.endX) * dpr,
      Math.min(a.startY, a.endY) * dpr,
      Math.abs(a.endX - a.startX) * dpr,
      Math.abs(a.endY - a.startY) * dpr
    );
  }

  function drawRect(ctx, a, dpr) {
    ctx.strokeStyle = a.color;
    ctx.lineWidth = a.size * dpr;
    ctx.strokeRect(
      Math.min(a.startX, a.endX) * dpr,
      Math.min(a.startY, a.endY) * dpr,
      Math.abs(a.endX - a.startX) * dpr,
      Math.abs(a.endY - a.startY) * dpr
    );
  }

  function drawWhiteout(ctx, a, dpr) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(
      Math.min(a.startX, a.endX) * dpr,
      Math.min(a.startY, a.endY) * dpr,
      Math.abs(a.endX - a.startX) * dpr,
      Math.abs(a.endY - a.startY) * dpr
    );
  }

  function drawTextAnnotation(ctx, a, dpr) {
    ctx.fillStyle = a.color;
    ctx.font = `${a.size * dpr}px ${a.font || 'Helvetica'}`;
    const lines = a.text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i], a.x * dpr, (a.y + a.size * (i + 1)) * dpr);
    }
  }

  function drawImageAnnotation(ctx, a, dpr) {
    if (a.imgElement) {
      ctx.drawImage(a.imgElement, a.x * dpr, a.y * dpr, a.width * dpr, a.height * dpr);
    }
  }

  // ============================================
  // Thumbnails
  // ============================================
  async function renderThumbnails() {
    dom.thumbnails.innerHTML = '';
    for (let i = 1; i <= state.totalPages; i++) {
      const page = await state.pdfDoc.getPage(i);
      const vp = page.getViewport({ scale: 0.25 });

      const wrapper = document.createElement('div');
      wrapper.className = 'thumbnail' + (i === state.currentPage ? ' active' : '');
      wrapper.dataset.page = i;

      const canvas = document.createElement('canvas');
      canvas.width = vp.width;
      canvas.height = vp.height;
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport: vp }).promise;

      const label = document.createElement('div');
      label.className = 'thumbnail-label';
      label.textContent = i;

      wrapper.appendChild(canvas);
      wrapper.appendChild(label);
      wrapper.addEventListener('click', () => goToPage(i));
      dom.thumbnails.appendChild(wrapper);
    }
  }

  // ============================================
  // Navigation
  // ============================================
  function goToPage(n) {
    n = Math.max(1, Math.min(n, state.totalPages));
    state.currentPage = n;
    renderPage(n);
  }

  // ============================================
  // Canvas Event Handling
  // ============================================
  function getCanvasPos(e) {
    const rect = dom.annoCanvas.getBoundingClientRect();
    return {
      x: (e.clientX - rect.left),
      y: (e.clientY - rect.top),
    };
  }

  dom.annoCanvas.addEventListener('mousedown', (e) => {
    if (!state.pdfDoc) return;
    const pos = getCanvasPos(e);
    const tool = state.activeTool;

    if (tool === 'select') return;

    if (tool === 'text') {
      state.textPosition = pos;
      dom.textModal.classList.remove('hidden');
      dom.textInput.value = '';
      dom.textInput.focus();
      return;
    }

    if (tool === 'image') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (ev) => {
        const file = ev.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (re) => {
          const img = new Image();
          img.onload = () => {
            const maxW = 200, maxH = 200;
            let w = img.width, h = img.height;
            if (w > maxW) { h = h * maxW / w; w = maxW; }
            if (h > maxH) { w = w * maxH / h; h = maxH; }
            const anno = {
              type: 'image',
              x: pos.x, y: pos.y,
              width: w, height: h,
              imgElement: img,
              imgDataUrl: re.target.result,
            };
            addAnnotation(anno);
          };
          img.src = re.target.result;
        };
        reader.readAsDataURL(file);
      };
      input.click();
      return;
    }

    state.isDrawing = true;

    if (tool === 'draw') {
      state.drawPoints = [pos];
    } else {
      state.drawStart = pos;
    }
  });

  dom.annoCanvas.addEventListener('mousemove', (e) => {
    if (!state.isDrawing) return;
    const pos = getCanvasPos(e);
    const tool = state.activeTool;

    if (tool === 'draw') {
      state.drawPoints.push(pos);
      // Live preview
      redrawAnnotations(state.currentPage);
      const dpr = window.devicePixelRatio || 1;
      annoCtx.save();
      annoCtx.strokeStyle = state.color;
      annoCtx.lineWidth = state.fontSize * dpr;
      annoCtx.lineCap = 'round';
      annoCtx.lineJoin = 'round';
      annoCtx.beginPath();
      annoCtx.moveTo(state.drawPoints[0].x * dpr, state.drawPoints[0].y * dpr);
      for (let i = 1; i < state.drawPoints.length; i++) {
        annoCtx.lineTo(state.drawPoints[i].x * dpr, state.drawPoints[i].y * dpr);
      }
      annoCtx.stroke();
      annoCtx.restore();
    } else if (['highlight', 'rect', 'whiteout'].includes(tool)) {
      // Live preview for rectangle-based tools
      redrawAnnotations(state.currentPage);
      const dpr = window.devicePixelRatio || 1;
      annoCtx.save();
      if (tool === 'highlight') {
        annoCtx.fillStyle = state.color;
        annoCtx.globalAlpha = 0.35;
        annoCtx.fillRect(
          Math.min(state.drawStart.x, pos.x) * dpr,
          Math.min(state.drawStart.y, pos.y) * dpr,
          Math.abs(pos.x - state.drawStart.x) * dpr,
          Math.abs(pos.y - state.drawStart.y) * dpr
        );
      } else if (tool === 'rect') {
        annoCtx.strokeStyle = state.color;
        annoCtx.lineWidth = state.fontSize * dpr;
        annoCtx.strokeRect(
          Math.min(state.drawStart.x, pos.x) * dpr,
          Math.min(state.drawStart.y, pos.y) * dpr,
          Math.abs(pos.x - state.drawStart.x) * dpr,
          Math.abs(pos.y - state.drawStart.y) * dpr
        );
      } else if (tool === 'whiteout') {
        annoCtx.fillStyle = '#ffffff';
        annoCtx.fillRect(
          Math.min(state.drawStart.x, pos.x) * dpr,
          Math.min(state.drawStart.y, pos.y) * dpr,
          Math.abs(pos.x - state.drawStart.x) * dpr,
          Math.abs(pos.y - state.drawStart.y) * dpr
        );
      }
      annoCtx.restore();
    }
  });

  dom.annoCanvas.addEventListener('mouseup', (e) => {
    if (!state.isDrawing) return;
    state.isDrawing = false;
    const pos = getCanvasPos(e);
    const tool = state.activeTool;

    if (tool === 'draw') {
      if (state.drawPoints.length > 1) {
        addAnnotation({
          type: 'freehand',
          points: [...state.drawPoints],
          color: state.color,
          size: state.fontSize,
        });
      }
      state.drawPoints = [];
    } else if (tool === 'highlight') {
      addAnnotation({
        type: 'highlight',
        startX: state.drawStart.x, startY: state.drawStart.y,
        endX: pos.x, endY: pos.y,
        color: state.color,
      });
    } else if (tool === 'rect') {
      addAnnotation({
        type: 'rect',
        startX: state.drawStart.x, startY: state.drawStart.y,
        endX: pos.x, endY: pos.y,
        color: state.color,
        size: state.fontSize,
      });
    } else if (tool === 'whiteout') {
      addAnnotation({
        type: 'whiteout',
        startX: state.drawStart.x, startY: state.drawStart.y,
        endX: pos.x, endY: pos.y,
      });
    }
  });

  dom.annoCanvas.addEventListener('mouseleave', () => {
    if (state.isDrawing) {
      state.isDrawing = false;
      state.drawPoints = [];
      redrawAnnotations(state.currentPage);
    }
  });

  function addAnnotation(anno) {
    const page = state.currentPage;
    if (!state.annotations[page]) state.annotations[page] = [];
    state.annotations[page].push(anno);
    pushUndo({ action: 'add-annotation', page, index: state.annotations[page].length - 1 });
    redrawAnnotations(page);
  }

  // ============================================
  // Text Modal
  // ============================================
  dom.textConfirm.addEventListener('click', () => {
    const text = dom.textInput.value.trim();
    if (!text || !state.textPosition) return;
    addAnnotation({
      type: 'text',
      text,
      x: state.textPosition.x,
      y: state.textPosition.y,
      color: state.color,
      size: state.fontSize,
      font: state.fontName,
    });
    dom.textModal.classList.add('hidden');
    state.textPosition = null;
    showToast('Text added', 'success');
  });

  dom.textCancel.addEventListener('click', () => {
    dom.textModal.classList.add('hidden');
    state.textPosition = null;
  });

  // Enter to confirm
  dom.textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      dom.textConfirm.click();
    }
  });

  // ============================================
  // Saving PDF
  // ============================================
  async function savePDF() {
    try {
      showToast('Saving PDF...', 'info');

      // Reload the doc from current bytes to apply annotations
      const doc = await PDFDocument.load(state.pdfBytes, { ignoreEncryption: true });
      doc.registerFontkit(fontkit);

      const pages = doc.getPages();

      for (const [pageNumStr, annos] of Object.entries(state.annotations)) {
        const pageIdx = parseInt(pageNumStr) - 1;
        if (pageIdx < 0 || pageIdx >= pages.length) continue;
        const page = pages[pageIdx];
        const { width: pw, height: ph } = page.getSize();

        for (const a of annos) {
          if (a.deleted) continue;

          // Convert canvas coords to PDF coords
          // Canvas Y goes down, PDF Y goes up
          const scaleX = pw / (dom.pdfCanvas.clientWidth);
          const scaleY = ph / (dom.pdfCanvas.clientHeight);

          switch (a.type) {
            case 'text': {
              let font;
              try {
                const fontMap = {
                  'Helvetica': StandardFonts.Helvetica,
                  'Times-Roman': StandardFonts.TimesRoman,
                  'Courier': StandardFonts.Courier,
                };
                font = await doc.embedFont(fontMap[a.font] || StandardFonts.Helvetica);
              } catch {
                font = await doc.embedFont(StandardFonts.Helvetica);
              }
              const pdfX = a.x * scaleX;
              const pdfY = ph - (a.y + a.size) * scaleY;
              const lines = a.text.split('\n');
              for (let i = 0; i < lines.length; i++) {
                page.drawText(lines[i], {
                  x: pdfX,
                  y: pdfY - (i * a.size * scaleY),
                  size: a.size * scaleY,
                  color: pdfLibColor(a.color),
                  font,
                });
              }
              break;
            }
            case 'freehand': {
              // Draw as a series of line segments
              if (a.points.length < 2) break;
              const lineColor = pdfLibColor(a.color);
              const lineWidth = Math.max(1, a.size * scaleX);
              for (let i = 0; i < a.points.length - 1; i++) {
                const x1 = a.points[i].x * scaleX;
                const y1 = ph - a.points[i].y * scaleY;
                const x2 = a.points[i + 1].x * scaleX;
                const y2 = ph - a.points[i + 1].y * scaleY;
                page.drawLine({
                  start: { x: x1, y: y1 },
                  end: { x: x2, y: y2 },
                  thickness: lineWidth,
                  color: lineColor,
                });
              }
              break;
            }
            case 'highlight': {
              const x = Math.min(a.startX, a.endX) * scaleX;
              const y = ph - Math.max(a.startY, a.endY) * scaleY;
              const w = Math.abs(a.endX - a.startX) * scaleX;
              const h = Math.abs(a.endY - a.startY) * scaleY;
              page.drawRectangle({
                x, y, width: w, height: h,
                color: pdfLibColor(a.color),
                opacity: 0.35,
              });
              break;
            }
            case 'rect': {
              const x = Math.min(a.startX, a.endX) * scaleX;
              const y = ph - Math.max(a.startY, a.endY) * scaleY;
              const w = Math.abs(a.endX - a.startX) * scaleX;
              const h = Math.abs(a.endY - a.startY) * scaleY;
              page.drawRectangle({
                x, y, width: w, height: h,
                borderColor: pdfLibColor(a.color),
                borderWidth: a.size * scaleX,
                color: rgb(0, 0, 0),
                opacity: 0,
              });
              break;
            }
            case 'whiteout': {
              const x = Math.min(a.startX, a.endX) * scaleX;
              const y = ph - Math.max(a.startY, a.endY) * scaleY;
              const w = Math.abs(a.endX - a.startX) * scaleX;
              const h = Math.abs(a.endY - a.startY) * scaleY;
              page.drawRectangle({
                x, y, width: w, height: h,
                color: rgb(1, 1, 1),
              });
              break;
            }
            case 'image': {
              try {
                const dataUrl = a.imgDataUrl;
                let img;
                if (dataUrl.includes('image/png')) {
                  const bytes = await fetch(dataUrl).then(r => r.arrayBuffer());
                  img = await doc.embedPng(bytes);
                } else {
                  const bytes = await fetch(dataUrl).then(r => r.arrayBuffer());
                  img = await doc.embedJpg(bytes);
                }
                page.drawImage(img, {
                  x: a.x * scaleX,
                  y: ph - (a.y + a.height) * scaleY,
                  width: a.width * scaleX,
                  height: a.height * scaleY,
                });
              } catch (err) {
                console.warn('Could not embed image:', err);
              }
              break;
            }
          }
        }
      }

      const savedBytes = await doc.save();

      // Prompt user for a filename
      const defaultName = state.fileName ? state.fileName.replace(/\.pdf$/i, '') + '_edited' : 'edited';
      const userInput = prompt('Enter a filename for the saved PDF:', defaultName);
      if (userInput === null) {
        showToast('Save cancelled', 'info');
        return;
      }
      let filename = userInput.trim() || defaultName;
      if (!/\.pdf$/i.test(filename)) filename += '.pdf';

      const blob = new Blob([savedBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);

      showToast(`Saved as "${filename}"`, 'success');
    } catch (err) {
      console.error(err);
      showToast('Save failed: ' + err.message, 'error', 4000);
    }
  }

  // ============================================
  // Page Operations
  // ============================================
  async function reloadFromBytes(bytes) {
    state.pdfBytes = new Uint8Array(bytes);
    state.pdfDoc = await pdfjsLib.getDocument({ data: state.pdfBytes.slice() }).promise;
    state.totalPages = state.pdfDoc.numPages;
    state.pdfLibDoc = await PDFDocument.load(state.pdfBytes, { ignoreEncryption: true });
    dom.pageCount.textContent = state.totalPages;
    dom.pageInput.max = state.totalPages;
    if (state.currentPage > state.totalPages) state.currentPage = state.totalPages;
    if (state.currentPage < 1) state.currentPage = 1;
    await renderPage(state.currentPage);
    await renderThumbnails();
  }

  async function rotatePage(angleDeg) {
    if (!state.pdfLibDoc) return;
    const doc = await PDFDocument.load(state.pdfBytes, { ignoreEncryption: true });
    const page = doc.getPages()[state.currentPage - 1];
    const current = page.getRotation().angle;
    page.setRotation(degrees(current + angleDeg));
    const newBytes = await doc.save();
    pushUndo({ action: 'rotate', page: state.currentPage, angle: -angleDeg });
    await reloadFromBytes(newBytes);
    showToast(`Page rotated ${angleDeg > 0 ? 'right' : 'left'}`, 'info');
  }

  async function deletePage() {
    if (!state.pdfLibDoc || state.totalPages <= 1) {
      showToast('Cannot delete the only page', 'error');
      return;
    }
    const doc = await PDFDocument.load(state.pdfBytes, { ignoreEncryption: true });
    doc.removePage(state.currentPage - 1);
    const newBytes = await doc.save();
    pushUndo({ action: 'delete-page', page: state.currentPage }); // simplified undo
    await reloadFromBytes(newBytes);
    showToast('Page deleted', 'info');
  }

  async function addBlankPage() {
    const doc = await PDFDocument.load(state.pdfBytes, { ignoreEncryption: true });
    doc.addPage();
    const newBytes = await doc.save();
    pushUndo({ action: 'add-page' });
    await reloadFromBytes(newBytes);
    state.currentPage = state.totalPages;
    await renderPage(state.currentPage);
    showToast('Blank page added', 'success');
  }

  async function mergePDFs(files) {
    try {
      const doc = await PDFDocument.load(state.pdfBytes, { ignoreEncryption: true });
      for (const file of files) {
        const bytes = await file.arrayBuffer();
        const srcDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const indices = srcDoc.getPageIndices();
        const copiedPages = await doc.copyPages(srcDoc, indices);
        copiedPages.forEach(p => doc.addPage(p));
      }
      const newBytes = await doc.save();
      pushUndo({ action: 'merge' });
      await reloadFromBytes(newBytes);
      showToast(`Merged ${files.length} PDF(s)`, 'success');
    } catch (err) {
      console.error(err);
      showToast('Merge failed: ' + err.message, 'error', 4000);
    }
  }

  // ============================================
  // Undo / Redo
  // ============================================
  function undo() {
    if (state.undoStack.length === 0) return;
    const action = state.undoStack.pop();
    state.redoStack.push(action);
    if (action.action === 'add-annotation') {
      const annos = state.annotations[action.page];
      if (annos && annos[action.index]) {
        annos[action.index].deleted = true;
      }
      redrawAnnotations(state.currentPage);
    }
    updateUndoRedoButtons();
  }

  function redo() {
    if (state.redoStack.length === 0) return;
    const action = state.redoStack.pop();
    state.undoStack.push(action);
    if (action.action === 'add-annotation') {
      const annos = state.annotations[action.page];
      if (annos && annos[action.index]) {
        annos[action.index].deleted = false;
      }
      redrawAnnotations(state.currentPage);
    }
    updateUndoRedoButtons();
  }

  // ============================================
  // Tool Selection
  // ============================================
  function setActiveTool(tool) {
    state.activeTool = tool;
    $$('[data-tool]').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tool === tool);
    });

    // Update cursor
    if (tool === 'select') {
      dom.annoCanvas.style.cursor = 'default';
      dom.annoCanvas.style.pointerEvents = 'none';
    } else {
      dom.annoCanvas.style.pointerEvents = 'auto';
      dom.annoCanvas.style.cursor = tool === 'text' ? 'text' : 'crosshair';
    }

    // Show/hide font option
    const showFont = tool === 'text';
    dom.optFontLabel.style.display = showFont ? '' : 'none';
    dom.optFont.style.display = showFont ? '' : 'none';

    // Default highlight color
    if (tool === 'highlight') {
      dom.optColor.value = '#fde047';
      state.color = '#fde047';
    }
  }

  // ============================================
  // Zoom
  // ============================================
  function setZoom(z) {
    state.zoom = Math.max(0.25, Math.min(z, 5));
    renderPage(state.currentPage);
  }

  function fitToWidth() {
    if (!state.pdfDoc) return;
    state.pdfDoc.getPage(state.currentPage).then(page => {
      const vp = page.getViewport({ scale: 1 });
      const availW = dom.canvasContainer.clientWidth - 48;
      state.zoom = availW / vp.width;
      renderPage(state.currentPage);
    });
  }

  // ============================================
  // Event Binding
  // ============================================

  // File open
  dom.browseBtn.addEventListener('click', () => dom.fileInput.click());
  dom.dropZone.addEventListener('click', (e) => {
    if (e.target !== dom.browseBtn) dom.fileInput.click();
  });

  dom.fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) { state.fileName = file.name; file.arrayBuffer().then(loadPDF); }
  });

  // Drag and drop
  ['dragenter', 'dragover'].forEach(ev => {
    dom.dropZone.addEventListener(ev, (e) => {
      e.preventDefault();
      dom.dropZone.classList.add('drag-over');
    });
  });
  ['dragleave', 'drop'].forEach(ev => {
    dom.dropZone.addEventListener(ev, () => {
      dom.dropZone.classList.remove('drag-over');
    });
  });
  dom.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
      state.fileName = file.name;
      file.arrayBuffer().then(loadPDF);
    } else {
      showToast('Please drop a PDF file', 'error');
    }
  });

  // Also allow drop on the entire editor
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    if (dom.editorScreen.classList.contains('hidden')) return;
    const file = e.dataTransfer.files[0];
    if (file && file.type === 'application/pdf') {
      state.fileName = file.name;
      file.arrayBuffer().then(loadPDF);
    }
  });

  // Toolbar buttons
  $('#btn-open').addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) { state.fileName = file.name; file.arrayBuffer().then(loadPDF); }
    };
    input.click();
  });

  $('#btn-save').addEventListener('click', savePDF);

  // Tools
  $$('[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => setActiveTool(btn.dataset.tool));
  });

  // Options
  dom.optColor.addEventListener('input', (e) => { state.color = e.target.value; });
  dom.optSize.addEventListener('input', (e) => {
    state.fontSize = parseInt(e.target.value);
    dom.optSizeVal.textContent = e.target.value;
  });
  dom.optFont.addEventListener('change', (e) => { state.fontName = e.target.value; });

  // Navigation
  $('#btn-prev-page').addEventListener('click', () => goToPage(state.currentPage - 1));
  $('#btn-next-page').addEventListener('click', () => goToPage(state.currentPage + 1));
  dom.pageInput.addEventListener('change', () => goToPage(parseInt(dom.pageInput.value) || 1));

  // Zoom
  $('#btn-zoom-in').addEventListener('click', () => setZoom(state.zoom + 0.15));
  $('#btn-zoom-out').addEventListener('click', () => setZoom(state.zoom - 0.15));
  $('#btn-fit').addEventListener('click', fitToWidth);

  // Mouse wheel zoom
  dom.canvasContainer.addEventListener('wheel', (e) => {
    if (e.ctrlKey) {
      e.preventDefault();
      setZoom(state.zoom + (e.deltaY < 0 ? 0.1 : -0.1));
    }
  }, { passive: false });

  // Page operations
  $('#btn-rotate-left').addEventListener('click', () => rotatePage(-90));
  $('#btn-rotate-right').addEventListener('click', () => rotatePage(90));
  $('#btn-delete-page').addEventListener('click', deletePage);
  $('#btn-add-page').addEventListener('click', addBlankPage);

  // Undo / Redo
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-redo').addEventListener('click', redo);

  // Sidebar toggle
  dom.sidebarToggle.addEventListener('click', () => {
    dom.sidebar.classList.toggle('collapsed');
  });

  // Merge modal
  dom.mergeConfirm.addEventListener('click', () => {
    const files = dom.mergeInput.files;
    if (files.length > 0) {
      mergePDFs(Array.from(files));
      dom.mergeModal.classList.add('hidden');
    }
  });
  dom.mergeCancel.addEventListener('click', () => {
    dom.mergeModal.classList.add('hidden');
  });

  // Keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    // Ctrl+Z / Ctrl+Y
    if (e.ctrlKey && e.key === 'z') { e.preventDefault(); undo(); }
    if (e.ctrlKey && e.key === 'y') { e.preventDefault(); redo(); }
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); savePDF(); }
    if (e.ctrlKey && e.key === 'o') { e.preventDefault(); $('#btn-open').click(); }

    // Page navigation
    if (e.key === 'ArrowLeft' || e.key === 'PageUp') goToPage(state.currentPage - 1);
    if (e.key === 'ArrowRight' || e.key === 'PageDown') goToPage(state.currentPage + 1);

    // Tool shortcuts
    if (e.key === 'v' || e.key === 'V') setActiveTool('select');
    if (e.key === 't' || e.key === 'T') setActiveTool('text');
    if (e.key === 'd' || e.key === 'D') setActiveTool('draw');
    if (e.key === 'h' || e.key === 'H') setActiveTool('highlight');
    if (e.key === 'r' || e.key === 'R') setActiveTool('rect');
    if (e.key === 'w' || e.key === 'W') setActiveTool('whiteout');

    // Zoom
    if (e.key === '+' || e.key === '=') setZoom(state.zoom + 0.15);
    if (e.key === '-') setZoom(state.zoom - 0.15);
    if (e.key === '0') fitToWidth();
  });

  // Escape key closes modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      dom.textModal.classList.add('hidden');
      dom.mergeModal.classList.add('hidden');
    }
  });

  // Initialize
  setActiveTool('select');

})();
