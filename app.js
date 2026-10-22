const CATEGORIES = [
  { key: "animal", label: "Animal" },
  { key: "place", label: "Place" },
  { key: "plant", label: "Plant" },
  { key: "character", label: "Character" },
  { key: "season", label: "Season" },
  { key: "hobby", label: "Hobby" },
  { key: "food", label: "Food" },
  { key: "color", label: "Color", isColor: true },
  { key: "drink", label: "Drink" },
];

// 1080 divides evenly by 3, so every cell lands on whole pixels and there are no seams
const EXPORT_SIZE = 1080;
const EXPORT_EMPTY_CELL = "#ebe6df";

// Photo cells hold { img, url, posX, posY }; the color cell holds { color }.
// posX/posY are object-position percentages, used for both the preview and the export.
const cells = {};

const grid = document.getElementById("grid");
const fileInput = document.getElementById("file-input");

let pendingPhotoKey = null;

// ---------- Grid ----------

function buildGrid() {
  for (const category of CATEGORIES) {
    const cell = document.createElement("div");
    cell.className = "cell";
    cell.dataset.key = category.key;

    const placeholder = document.createElement("div");
    placeholder.className = category.isColor ? "placeholder placeholder-color" : "placeholder";
    placeholder.textContent = category.isColor ? "" : "+";

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = category.label;

    cell.append(placeholder, label);
    grid.append(cell);

    if (category.isColor) {
      cell.addEventListener("click", () => openColorPicker(category.key));
    } else {
      setupPhotoCell(cell, category.key);
    }
  }
}

function setupPhotoCell(cell, key) {
  let drag = null;
  let suppressClick = false;

  // A tap opens the file picker. A drag on a filled cell pans the photo instead.
  cell.addEventListener("pointerdown", (event) => {
    drag = { startX: event.clientX, startY: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
    if (cells[key]) cell.setPointerCapture(event.pointerId);
  });

  cell.addEventListener("pointermove", (event) => {
    if (!drag || !cells[key]) return;

    const distance = Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY);
    if (distance > 4) drag.moved = true;

    if (drag.moved) panPhoto(cell, key, event.clientX - drag.lastX, event.clientY - drag.lastY);
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
  });

  cell.addEventListener("pointerup", () => {
    suppressClick = Boolean(drag && drag.moved);
    drag = null;
  });

  cell.addEventListener("pointercancel", () => {
    drag = null;
  });

  cell.addEventListener("click", () => {
    if (suppressClick) {
      suppressClick = false;
      return;
    }
    pickPhoto(key);
  });

  // Desktop drag-and-drop from Finder / file manager
  cell.addEventListener("dragover", (event) => {
    event.preventDefault();
    cell.classList.add("drop-target");
  });

  cell.addEventListener("dragleave", () => {
    cell.classList.remove("drop-target");
  });

  cell.addEventListener("drop", (event) => {
    event.preventDefault();
    cell.classList.remove("drop-target");
    const file = event.dataTransfer.files[0];
    if (file) loadPhoto(key, file);
  });
}

function renderCell(key) {
  const cell = grid.querySelector(`[data-key="${key}"]`);
  const data = cells[key];

  cell.querySelector(".photo")?.remove();
  cell.style.backgroundColor = "";
  cell.classList.toggle("filled", Boolean(data));

  if (!data) return;

  if (data.color) {
    cell.style.backgroundColor = data.color;
    return;
  }

  data.img.className = "photo";
  data.img.draggable = false;
  data.img.style.objectPosition = `${data.posX}% ${data.posY}%`;
  cell.prepend(data.img);
}

// ---------- Photos ----------

function pickPhoto(key) {
  pendingPhotoKey = key;
  fileInput.value = "";
  fileInput.click();
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files[0];
  if (file && pendingPhotoKey) loadPhoto(pendingPhotoKey, file);
  pendingPhotoKey = null;
});

async function loadPhoto(key, file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;

  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    alert("Couldn't read that image. Try a JPG or PNG.");
    return;
  }

  if (cells[key]) URL.revokeObjectURL(cells[key].url);
  cells[key] = { img, url, posX: 50, posY: 50 };
  renderCell(key);
}

// The photo is scaled to cover the cell, so it can only move along the axis that overflows.
function panPhoto(cell, key, dx, dy) {
  const data = cells[key];
  const { width, height } = cell.getBoundingClientRect();
  const scale = coverScale(data.img, width, height);
  const overflowX = data.img.naturalWidth * scale - width;
  const overflowY = data.img.naturalHeight * scale - height;

  if (overflowX > 0) data.posX = clamp(data.posX - (dx / overflowX) * 100, 0, 100);
  if (overflowY > 0) data.posY = clamp(data.posY - (dy / overflowY) * 100, 0, 100);

  data.img.style.objectPosition = `${data.posX}% ${data.posY}%`;
}

function coverScale(img, width, height) {
  return Math.max(width / img.naturalWidth, height / img.naturalHeight);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// ---------- Color picker ----------

const colorDialog = document.getElementById("color-dialog");
const wheel = document.getElementById("wheel");
const wheelWrap = document.getElementById("wheel-wrap");
const wheelMarker = document.getElementById("wheel-marker");
const brightnessInput = document.getElementById("brightness");
const swatch = document.getElementById("swatch");
const hexInput = document.getElementById("hex");

// Hue in degrees, saturation and value from 0 to 1
const picker = { h: 0, s: 0, v: 1 };
let colorKey = null;

// Hue runs around the circle, saturation runs from the center out.
// Brightness is applied separately with the slider.
function drawWheel() {
  const size = wheel.width;
  const radius = size / 2;
  const ctx = wheel.getContext("2d");
  const image = ctx.createImageData(size, size);

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - radius + 0.5;
      const dy = y - radius + 0.5;
      const distance = Math.hypot(dx, dy);
      if (distance > radius) continue;

      const hue = (Math.atan2(dy, dx) * 180 / Math.PI + 360) % 360;
      const [r, g, b] = hsvToRgb(hue, distance / radius, 1);
      const i = (y * size + x) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = Math.min(1, radius - distance) * 255; // soft edge
    }
  }

  ctx.putImageData(image, 0, 0);
}

function openColorPicker(key) {
  colorKey = key;
  Object.assign(picker, hexToHsv(cells[key]?.color || "#e8a0b4"));
  updatePicker();
  colorDialog.returnValue = "";
  colorDialog.showModal();
}

colorDialog.addEventListener("close", () => {
  if (colorDialog.returnValue === "done") {
    cells[colorKey] = { color: hsvToHex(picker.h, picker.s, picker.v) };
    renderCell(colorKey);
  }
});

function updatePicker({ updateHex = true } = {}) {
  const hex = hsvToHex(picker.h, picker.s, picker.v);
  const angle = picker.h * Math.PI / 180;

  wheelMarker.style.left = `${50 + Math.cos(angle) * picker.s * 50}%`;
  wheelMarker.style.top = `${50 + Math.sin(angle) * picker.s * 50}%`;
  wheelMarker.style.backgroundColor = hex;

  // brightness() scales RGB linearly, which matches HSV value exactly
  wheel.style.filter = `brightness(${picker.v})`;

  brightnessInput.value = Math.round(picker.v * 100);
  brightnessInput.style.background = `linear-gradient(to right, #000, ${hsvToHex(picker.h, picker.s, 1)})`;

  swatch.style.backgroundColor = hex;
  if (updateHex) hexInput.value = hex;
}

function pickFromWheel(event) {
  const rect = wheelWrap.getBoundingClientRect();
  const x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  const y = ((event.clientY - rect.top) / rect.height) * 2 - 1;

  picker.h = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  picker.s = Math.min(1, Math.hypot(x, y));
  updatePicker();
}

wheelWrap.addEventListener("pointerdown", (event) => {
  wheelWrap.setPointerCapture(event.pointerId);
  pickFromWheel(event);
});

wheelWrap.addEventListener("pointermove", (event) => {
  if (wheelWrap.hasPointerCapture(event.pointerId)) pickFromWheel(event);
});

brightnessInput.addEventListener("input", () => {
  picker.v = brightnessInput.value / 100;
  updatePicker();
});

hexInput.addEventListener("input", () => {
  const value = hexInput.value.trim();
  if (!/^#?[0-9a-f]{6}$/i.test(value)) return;
  Object.assign(picker, hexToHsv(value.startsWith("#") ? value : `#${value}`));
  updatePicker({ updateHex: false });
});

// Enter would otherwise submit the form through the first button, which is Cancel
hexInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  colorDialog.close("done");
});

// ---------- Color math ----------

function hsvToRgb(h, s, v) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let rgb;

  if (h < 60) rgb = [c, x, 0];
  else if (h < 120) rgb = [x, c, 0];
  else if (h < 180) rgb = [0, c, x];
  else if (h < 240) rgb = [0, x, c];
  else if (h < 300) rgb = [x, 0, c];
  else rgb = [c, 0, x];

  return rgb.map((channel) => Math.round((channel + m) * 255));
}

function hsvToHex(h, s, v) {
  return "#" + hsvToRgb(h, s, v).map((channel) => channel.toString(16).padStart(2, "0")).join("");
}

function hexToHsv(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const delta = max - Math.min(r, g, b);

  let h = 0;
  if (delta > 0) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * ((b - r) / delta + 2);
    else h = 60 * ((r - g) / delta + 4);
  }

  return { h: (h + 360) % 360, s: max === 0 ? 0 : delta / max, v: max };
}

// ---------- Export ----------

// A seamless square: no padding, gaps, rounded corners, or labels
function renderExport() {
  const cellSize = EXPORT_SIZE / 3;

  const canvas = document.createElement("canvas");
  canvas.width = EXPORT_SIZE;
  canvas.height = EXPORT_SIZE;
  const ctx = canvas.getContext("2d");

  CATEGORIES.forEach((category, index) => {
    const x = (index % 3) * cellSize;
    const y = Math.floor(index / 3) * cellSize;
    const data = cells[category.key];

    // Clip so a photo's cropped overflow can't bleed into the neighboring cell
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, cellSize, cellSize);
    ctx.clip();

    if (data?.img) {
      drawCoverImage(ctx, data, x, y, cellSize);
    } else {
      ctx.fillStyle = data?.color || EXPORT_EMPTY_CELL;
      ctx.fillRect(x, y, cellSize, cellSize);
    }

    ctx.restore();
  });

  return canvas;
}

// Same math as CSS object-fit: cover with object-position, so the export matches the preview
function drawCoverImage(ctx, data, x, y, size) {
  const scale = coverScale(data.img, size, size);
  const width = data.img.naturalWidth * scale;
  const height = data.img.naturalHeight * scale;
  const offsetX = (size - width) * (data.posX / 100);
  const offsetY = (size - height) * (data.posY / 100);
  ctx.drawImage(data.img, x + offsetX, y + offsetY, width, height);
}

async function exportPng() {
  const canvas = renderExport();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const filename = "how-i-see-you.png";
  const file = new File([blob], filename, { type: "image/png" });

  // On phones the share sheet is the easy path to "Save Image" in Photos.
  // If sharing isn't available or fails, fall back to a normal download.
  const isTouchDevice = window.matchMedia("(pointer: coarse)").matches;
  if (isTouchDevice && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (error) {
      if (error.name === "AbortError") return;
    }
  }

  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

// ---------- Setup ----------

document.getElementById("export").addEventListener("click", exportPng);

document.getElementById("clear").addEventListener("click", () => {
  if (!confirm("Clear the whole grid?")) return;

  for (const key of Object.keys(cells)) {
    if (cells[key].url) URL.revokeObjectURL(cells[key].url);
    delete cells[key];
    renderCell(key);
  }
});

buildGrid();
drawWheel();
