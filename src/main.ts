import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { open, save } from "@tauri-apps/plugin-dialog";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import * as api from "./api";
import type {
  Profile,
  BucketInfo,
  ObjectInfo,
  Provider,
  AddressingStyle,
  SignatureVersion,
  SyncProgressPayload,
  SyncCompletedPayload,
  SyncErrorPayload,
  Task,
  TaskStatus,
  TaskType,
} from "./types";

// State
let currentProfileId: string | null = null;
let currentBucket: string | null = null;
let currentPrefix = "";
let profiles: Profile[] = [];
let buckets: BucketInfo[] = [];
let objects: ObjectInfo[] = [];
let commonPrefixes: string[] = [];
let continuationToken: string | null = null;
let tokenHistory: string[] = [];
let presignedUrl = "";
let errors: string[] = [];
let errorScrollIndex = 0;
let isLoading = false;
let viewMode: "list" | "grid" = "list";
let thumbnailCache: Map<string, string> = new Map();
let hasMoreData = false;
let isLoadingMore = false;
let allGridItems: { key: string; size: number; last_modified?: string; etag?: string; is_folder: boolean }[] = [];
let searchPrefix = "";
let searchTimeout: number | null = null;
let tasks: Task[] = [];
let taskIdCounter = 0;
let selectedKeys: Set<string> = new Set();
let sortField: "name" | "size" | "modified" = "name";
let sortDirection: "asc" | "desc" = "asc";

// DOM Elements
const profilesList = document.getElementById("profiles-list")!;
const addProfileBtn = document.getElementById("add-profile-btn")!;
const bucketSelect = document.getElementById("bucket-select") as HTMLSelectElement;
const refreshBucketsBtn = document.getElementById("refresh-buckets-btn")!;
const currentPathEl = document.getElementById("current-path")!;
const goBackBtn = document.getElementById("go-back-btn") as HTMLButtonElement;
const refreshObjectsBtn = document.getElementById("refresh-objects-btn")!;
const objectList = document.getElementById("object-list")!;
const objectGrid = document.getElementById("object-grid")!;
const listView = document.getElementById("list-view")!;
const gridView = document.getElementById("grid-view")!;
const mainContent = document.querySelector(".main-content")!;
const emptyStateList = document.getElementById("empty-state-list")!;
const emptyStateGrid = document.getElementById("empty-state-grid")!;
const listViewBtn = document.getElementById("list-view-btn")!;
const gridViewBtn = document.getElementById("grid-view-btn")!;
const prevPageBtn = document.getElementById("prev-page-btn") as HTMLButtonElement;
const nextPageBtn = document.getElementById("next-page-btn") as HTMLButtonElement;
const pageInfo = document.getElementById("page-info")!;
const paginationEl = document.querySelector(".pagination") as HTMLElement;
const uploadFilesBtn = document.getElementById("upload-files-btn")!;
const uploadFolderBtn = document.getElementById("upload-folder-btn")!;
const createBucketBtn = document.getElementById("create-bucket-btn")!;
const syncBtn = document.getElementById("sync-btn")!;
const keepSyncBtn = document.getElementById("keep-sync-btn")!;
const createFolderBtn = document.getElementById("create-folder-btn")!;
const presignedUrlTextarea = document.getElementById("presigned-url") as HTMLTextAreaElement;
const copyUrlBtn = document.getElementById("copy-url-btn")!;
const errorListEl = document.getElementById("error-list")!;
const footer = document.getElementById("footer")!;
const footerToggle = document.getElementById("footer-toggle")!;
const searchPrefixInput = document.getElementById("search-prefix") as HTMLInputElement;
const searchClearBtn = document.getElementById("search-clear-btn")!;
const taskPanel = document.getElementById("task-panel")!;
const taskListEl = document.getElementById("task-list")!;
const clearCompletedBtn = document.getElementById("clear-completed-btn")!;
const closeTaskPanelBtn = document.getElementById("close-task-panel-btn")!;
const taskProgressText = document.getElementById("task-progress-text")!;
const taskProgressFill = document.getElementById("task-progress-fill")!;
const deleteSelectedBtn = document.getElementById("delete-selected-btn")!;
const selectedCountEl = document.getElementById("selected-count")!;
const selectAllCheckbox = document.getElementById("select-all-checkbox") as HTMLInputElement;

// Modals
const profileModal = document.getElementById("profile-modal")!;
const bucketModal = document.getElementById("bucket-modal")!;
const folderModal = document.getElementById("folder-modal")!;
const deleteModal = document.getElementById("delete-modal")!;
const previewModal = document.getElementById("preview-modal")!;

// Forms
const profileForm = document.getElementById("profile-form") as HTMLFormElement;
const bucketForm = document.getElementById("bucket-form") as HTMLFormElement;
const folderForm = document.getElementById("folder-form") as HTMLFormElement;

// Delete confirmation state
let deleteCallback: (() => Promise<void>) | null = null;

// Provider options for dropdown
const providers: { value: Provider; label: string }[] = [
  { value: "aws_s3", label: "AWS S3" },
  { value: "google_cloud_storage", label: "Google Cloud Storage" },
  { value: "azure_blob", label: "Azure Blob" },
  { value: "min_i_o", label: "MinIO" },
  { value: "rust_f_s", label: "RustFS" },
  { value: "volcengine_t_o_s", label: "Volcengine TOS" },
  { value: "tencent_c_o_s", label: "Tencent COS" },
  { value: "baidu_b_o_s", label: "Baidu BOS" },
];

// Storage keys for persistence
const STORAGE_KEY_PROFILE = "s3gui_last_profile";
const STORAGE_KEY_BUCKET = "s3gui_last_bucket";

function saveLastSelection() {
  if (currentProfileId) {
    localStorage.setItem(STORAGE_KEY_PROFILE, currentProfileId);
  }
  if (currentBucket) {
    localStorage.setItem(STORAGE_KEY_BUCKET, currentBucket);
  }
}

function getLastSelection(): { profileId: string | null; bucket: string | null } {
  return {
    profileId: localStorage.getItem(STORAGE_KEY_PROFILE),
    bucket: localStorage.getItem(STORAGE_KEY_BUCKET),
  };
}

// Initialize
async function init() {
  await loadProfiles();
  setupEventListeners();
  setupKeyboardShortcuts();
  setupTauriEventListeners();
  addProviderAndStyleDropdowns();
  updateSortIndicators();
  await restoreLastSelection();
}

async function restoreLastSelection() {
  const { profileId, bucket } = getLastSelection();
  
  if (profileId && profiles.some(p => p.id === profileId)) {
    await selectProfile(profileId);
    
    if (bucket && buckets.some(b => b.name === bucket)) {
      await selectBucket(bucket);
    }
  }
}

function addProviderAndStyleDropdowns() {
  // Add provider dropdown to profile form
  const endpointGroup = document.querySelector("#profile-form .form-group:nth-child(2)")!;
  
  const providerGroup = document.createElement("div");
  providerGroup.className = "form-group";
  providerGroup.innerHTML = `
    <label for="profile-provider">Provider</label>
    <select id="profile-provider" class="select" required>
      ${providers.map(p => `<option value="${p.value}">${p.label}</option>`).join("")}
    </select>
  `;
  endpointGroup.before(providerGroup);
  
  // Add addressing style dropdown
  const secretGroup = document.querySelector("#profile-form .form-group:last-of-type")!;
  
  const addressingGroup = document.createElement("div");
  addressingGroup.className = "form-group";
  addressingGroup.innerHTML = `
    <label for="profile-addressing">Addressing Style</label>
    <select id="profile-addressing" class="select" required>
      <option value="virtual_hosted">Virtual Hosted</option>
      <option value="path">Path Style</option>
    </select>
  `;
  secretGroup.after(addressingGroup);
  
  const signatureGroup = document.createElement("div");
  signatureGroup.className = "form-group";
  signatureGroup.innerHTML = `
    <label for="profile-signature">Signature Version</label>
    <select id="profile-signature" class="select" required>
      <option value="v4">V4 (Recommended)</option>
      <option value="v2">V2</option>
    </select>
  `;
  addressingGroup.after(signatureGroup);

  // Add public checkbox to bucket form
  const bucketNameGroup = bucketForm.querySelector(".form-group")!;
  const publicGroup = document.createElement("div");
  publicGroup.className = "form-group form-checkbox";
  publicGroup.innerHTML = `
    <label>
      <input type="checkbox" id="bucket-public">
      Make bucket public
    </label>
  `;
  bucketNameGroup.after(publicGroup);
}

async function loadProfiles() {
  try {
    profiles = await api.getProfiles();
    renderProfiles();
  } catch (err) {
    showError(`Failed to load profiles: ${err}`);
  }
}

function renderProfiles() {
  profilesList.innerHTML = profiles.map(p => `
    <li class="profile-item ${p.id === currentProfileId ? "active" : ""}" data-id="${p.id}">
      <span class="profile-name">${escapeHtml(p.name)}</span>
      <button class="btn btn-icon btn-small edit-profile" data-id="${p.id}" title="Edit">
        <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
          <path d="M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10z"/>
        </svg>
      </button>
    </li>
  `).join("");
}

async function selectProfile(id: string) {
  currentProfileId = id;
  currentBucket = null;
  currentPrefix = "";
  objects = [];
  commonPrefixes = [];
  continuationToken = null;
  tokenHistory = [];
  
  saveLastSelection();
  renderProfiles();
  await loadBuckets();
  renderObjects();
}

async function loadBuckets() {
  if (!currentProfileId) return;
  
  try {
    setLoading(true);
    buckets = await api.listBuckets(currentProfileId);
    renderBuckets();
  } catch (err) {
    showError(`Failed to load buckets: ${err}`);
  } finally {
    setLoading(false);
  }
}

function renderBuckets() {
  bucketSelect.innerHTML = `
    <option value="">Select a bucket</option>
    ${buckets.map(b => `<option value="${b.name}">${escapeHtml(b.name)}</option>`).join("")}
  `;
  
  if (currentBucket) {
    bucketSelect.value = currentBucket;
  }
}

async function selectBucket(name: string) {
  currentBucket = name;
  currentPrefix = "";
  continuationToken = null;
  tokenHistory = [];
  searchPrefix = "";
  searchPrefixInput.value = "";
  searchClearBtn.classList.add("hidden");
  clearSelection();
  saveLastSelection();
  await loadObjects();
}

async function loadObjects(append = false) {
  if (!currentProfileId || !currentBucket) return;
  
  try {
    if (!append) {
      setLoading(true);
      allGridItems = [];
    }
    const effectivePrefix = searchPrefix ? (currentPrefix + searchPrefix) : (currentPrefix || undefined);
    const result = await api.listObjects(
      currentProfileId,
      currentBucket,
      effectivePrefix,
      continuationToken || undefined
    );
    
    objects = result.objects;
    commonPrefixes = result.common_prefixes;
    continuationToken = result.next_continuation_token || null;
    hasMoreData = result.is_truncated;
    
    renderObjects(append);
    updatePagination(result.is_truncated);
  } catch (err) {
    showError(`Failed to load objects: ${err}`);
  } finally {
    setLoading(false);
    isLoadingMore = false;
  }
}

function renderObjects(append = false) {
  currentPathEl.textContent = currentPrefix ? `/ ${currentPrefix}` : "/";
  goBackBtn.disabled = !currentPrefix;
  
  const folders = commonPrefixes.map(prefix => ({
    key: prefix,
    size: 0,
    last_modified: undefined,
    etag: undefined,
    is_folder: true,
  }));
  
  const files = objects.filter(o => !o.is_folder);
  
  // Sort files (folders always first)
  const sortedFiles = [...files].sort((a, b) => {
    let comparison = 0;
    switch (sortField) {
      case "name":
        comparison = a.key.localeCompare(b.key);
        break;
      case "size":
        comparison = a.size - b.size;
        break;
      case "modified":
        const aTime = a.last_modified ? new Date(a.last_modified).getTime() : 0;
        const bTime = b.last_modified ? new Date(b.last_modified).getTime() : 0;
        comparison = aTime - bTime;
        break;
    }
    return sortDirection === "asc" ? comparison : -comparison;
  });
  
  const newItems = [...folders, ...sortedFiles];
  
  if (viewMode === "list") {
    paginationEl.classList.remove("hidden");
    renderListView(newItems);
  } else {
    paginationEl.classList.add("hidden");
    if (append) {
      allGridItems = [...allGridItems, ...newItems];
      appendGridItems(newItems);
    } else {
      allGridItems = newItems;
      renderGridView(newItems);
    }
  }
}

function renderListView(allItems: { key: string; size: number; last_modified?: string; etag?: string; is_folder: boolean }[]) {
  listView.classList.remove("hidden");
  gridView.classList.add("hidden");
  
  if (allItems.length === 0) {
    objectList.innerHTML = "";
    emptyStateList.style.display = "flex";
    updateSelectAllCheckbox();
    return;
  }
  
  emptyStateList.style.display = "none";
  
  const selectableItems = allItems.filter(obj => !obj.is_folder);
  
  objectList.innerHTML = allItems.map(obj => {
    const name = obj.is_folder 
      ? obj.key.replace(currentPrefix, "").replace(/\/$/, "")
      : obj.key.replace(currentPrefix, "");
    const size = obj.is_folder ? "-" : formatSize(obj.size);
    const modified = obj.last_modified ? formatDate(obj.last_modified) : "-";
    const isPreviewable = isMediaFile(obj.key);
    const isSelected = selectedKeys.has(obj.key);
    
    return `
      <tr class="object-row ${obj.is_folder ? "folder" : ""} ${isSelected ? "selected" : ""}" data-key="${escapeHtml(obj.key)}" data-is-folder="${obj.is_folder}">
        <td class="col-checkbox">
          ${obj.is_folder ? "" : `<input type="checkbox" class="object-checkbox" data-key="${escapeHtml(obj.key)}" ${isSelected ? "checked" : ""}>`}
        </td>
        <td class="col-name">
          <span class="icon">${obj.is_folder ? "📁" : "📄"}</span>
          <span class="name">${escapeHtml(name)}</span>
        </td>
        <td class="col-size">${size}</td>
        <td class="col-modified">${modified}</td>
        <td class="col-actions">
          ${obj.is_folder ? "" : `
            ${isPreviewable ? `<button class="btn btn-icon btn-small preview-btn" title="Preview">👁</button>` : ""}
            <button class="btn btn-icon btn-small download-btn" title="Download">⬇</button>
            <button class="btn btn-icon btn-small presign-btn" title="Presign URL">🔗</button>
            <button class="btn btn-icon btn-small delete-btn" title="Delete">🗑</button>
          `}
        </td>
      </tr>
    `;
  }).join("");
  
  updateSelectAllCheckbox();
}

function renderGridView(allItems: { key: string; size: number; last_modified?: string; etag?: string; is_folder: boolean }[]) {
  listView.classList.add("hidden");
  gridView.classList.remove("hidden");
  
  if (allItems.length === 0) {
    objectGrid.innerHTML = "";
    emptyStateGrid.style.display = "flex";
    return;
  }
  
  emptyStateGrid.style.display = "none";
  
  objectGrid.innerHTML = allItems.map(obj => {
    const name = obj.is_folder 
      ? obj.key.replace(currentPrefix, "").replace(/\/$/, "")
      : obj.key.replace(currentPrefix, "");
    const size = obj.is_folder ? "-" : formatSize(obj.size);
    const isPreviewable = isMediaFile(obj.key);
    const isVideo = isVideoFile(obj.key);
    const cacheKey = `${currentProfileId}:${currentBucket}:${obj.key}`;
    const cachedThumb = thumbnailCache.get(cacheKey);
    
    let thumbnailContent: string;
    if (obj.is_folder) {
      thumbnailContent = `<span class="placeholder">📁</span>`;
    } else if (cachedThumb) {
      thumbnailContent = isVideo 
        ? `<video src="${cachedThumb}" preload="auto" muted playsinline></video><span class="video-icon">▶ VIDEO</span>`
        : `<img src="${cachedThumb}" alt="${escapeHtml(name)}">`;
    } else if (isPreviewable) {
      thumbnailContent = `<div class="loading-spinner"></div>`;
    } else {
      thumbnailContent = `<span class="placeholder">📄</span>`;
    }
    
    return `
      <div class="grid-item ${obj.is_folder ? "folder" : ""}" data-key="${escapeHtml(obj.key)}" data-is-folder="${obj.is_folder}" data-previewable="${isPreviewable}">
        <div class="grid-item-thumbnail">
          ${thumbnailContent}
        </div>
        <div class="grid-item-info">
          <div class="grid-item-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
          <div class="grid-item-size">${size}</div>
        </div>
      </div>
    `;
  }).join("");
  
  // Set up cached video thumbnails to show first frame
  objectGrid.querySelectorAll(".grid-item-thumbnail video").forEach((video) => {
    const videoEl = video as HTMLVideoElement;
    videoEl.style.opacity = "0";
    videoEl.style.transition = "opacity 0.2s";
    videoEl.onloadeddata = () => {
      videoEl.currentTime = 0.1;
    };
    videoEl.onseeked = () => {
      videoEl.style.opacity = "1";
    };
    // Trigger load if already has src
    if (videoEl.src) {
      videoEl.load();
    }
  });
  
  // Load thumbnails for previewable items
  loadGridThumbnails(allItems.filter(item => !item.is_folder && isMediaFile(item.key)));
  
  // Set up infinite scroll sentinel
  setupInfiniteScroll();
}

function createGridItemHtml(obj: { key: string; size: number; last_modified?: string; etag?: string; is_folder: boolean }): string {
  const name = obj.is_folder 
    ? obj.key.replace(currentPrefix, "").replace(/\/$/, "")
    : obj.key.replace(currentPrefix, "");
  const size = obj.is_folder ? "-" : formatSize(obj.size);
  const isPreviewable = isMediaFile(obj.key);
  const isVideo = isVideoFile(obj.key);
  const cacheKey = `${currentProfileId}:${currentBucket}:${obj.key}`;
  const cachedThumb = thumbnailCache.get(cacheKey);
  
  let thumbnailContent: string;
  if (obj.is_folder) {
    thumbnailContent = `<span class="placeholder">📁</span>`;
  } else if (cachedThumb) {
    thumbnailContent = isVideo 
      ? `<video src="${cachedThumb}" preload="auto" muted playsinline></video><span class="video-icon">▶ VIDEO</span>`
      : `<img src="${cachedThumb}" alt="${escapeHtml(name)}">`;
  } else if (isPreviewable) {
    thumbnailContent = `<div class="loading-spinner"></div>`;
  } else {
    thumbnailContent = `<span class="placeholder">📄</span>`;
  }
  
  return `
    <div class="grid-item ${obj.is_folder ? "folder" : ""}" data-key="${escapeHtml(obj.key)}" data-is-folder="${obj.is_folder}" data-previewable="${isPreviewable}">
      <div class="grid-item-thumbnail">
        ${thumbnailContent}
      </div>
      <div class="grid-item-info">
        <div class="grid-item-name" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
        <div class="grid-item-size">${size}</div>
      </div>
    </div>
  `;
}

function appendGridItems(items: { key: string; size: number; last_modified?: string; etag?: string; is_folder: boolean }[]) {
  // Remove existing sentinel
  const existingSentinel = objectGrid.querySelector(".infinite-scroll-sentinel");
  if (existingSentinel) {
    existingSentinel.remove();
  }
  
  // Append new items
  const fragment = document.createDocumentFragment();
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = items.map(obj => createGridItemHtml(obj)).join("");
  
  while (tempDiv.firstChild) {
    fragment.appendChild(tempDiv.firstChild);
  }
  objectGrid.appendChild(fragment);
  
  // Set up video thumbnails for new items
  items.forEach(item => {
    if (isVideoFile(item.key)) {
      const gridItem = objectGrid.querySelector(`[data-key="${CSS.escape(item.key)}"]`);
      if (gridItem) {
        const video = gridItem.querySelector("video") as HTMLVideoElement | null;
        if (video) {
          video.style.opacity = "0";
          video.style.transition = "opacity 0.2s";
          video.onloadeddata = () => {
            video.currentTime = 0.1;
          };
          video.onseeked = () => {
            video.style.opacity = "1";
          };
          if (video.src) {
            video.load();
          }
        }
      }
    }
  });
  
  // Load thumbnails for new previewable items
  loadGridThumbnails(items.filter(item => !item.is_folder && isMediaFile(item.key)));
  
  // Re-setup infinite scroll sentinel
  setupInfiniteScroll();
}

let infiniteScrollObserver: IntersectionObserver | null = null;

function setupInfiniteScroll() {
  // Clean up existing observer
  if (infiniteScrollObserver) {
    infiniteScrollObserver.disconnect();
  }
  
  // Remove existing sentinel
  const existingSentinel = objectGrid.querySelector(".infinite-scroll-sentinel");
  if (existingSentinel) {
    existingSentinel.remove();
  }
  
  // Only add sentinel if there's more data
  if (!hasMoreData) return;
  
  // Create sentinel element
  const sentinel = document.createElement("div");
  sentinel.className = "infinite-scroll-sentinel";
  objectGrid.appendChild(sentinel);
  
  // Create observer
  infiniteScrollObserver = new IntersectionObserver((entries) => {
    const entry = entries[0];
    if (entry.isIntersecting && hasMoreData && !isLoadingMore && !isLoading) {
      loadMoreGridItems();
    }
  }, {
    root: gridView,
    rootMargin: "200px",
    threshold: 0
  });
  
  infiniteScrollObserver.observe(sentinel);
}

async function loadMoreGridItems() {
  if (!continuationToken || isLoadingMore) return;
  
  isLoadingMore = true;
  tokenHistory.push(continuationToken);
  await loadObjects(true);
}

async function loadGridThumbnails(items: { key: string }[]) {
  if (!currentProfileId || !currentBucket) return;
  
  for (const item of items) {
    const cacheKey = `${currentProfileId}:${currentBucket}:${item.key}`;
    if (thumbnailCache.has(cacheKey)) continue;
    
    try {
      const previewData = await api.getObjectPreview(currentProfileId, currentBucket, item.key);
      const dataUrl = `data:${previewData.content_type};base64,${previewData.data}`;
      thumbnailCache.set(cacheKey, dataUrl);
      
      // Update the grid item if still visible
      const gridItem = objectGrid.querySelector(`[data-key="${CSS.escape(item.key)}"]`);
      if (gridItem) {
        const thumbContainer = gridItem.querySelector(".grid-item-thumbnail");
        if (thumbContainer) {
          const isVideo = previewData.content_type.startsWith("video/");
          if (isVideo) {
            const video = document.createElement("video");
            video.muted = true;
            video.preload = "auto";
            video.playsInline = true;
            
            video.onloadeddata = () => {
              video.currentTime = 0.1;
            };
            
            video.onseeked = () => {
              video.style.opacity = "1";
            };
            
            video.style.opacity = "0";
            video.style.transition = "opacity 0.2s";
            video.src = dataUrl;
            
            thumbContainer.innerHTML = "";
            thumbContainer.appendChild(video);
            const icon = document.createElement("span");
            icon.className = "video-icon";
            icon.textContent = "▶ VIDEO";
            thumbContainer.appendChild(icon);
          } else {
            thumbContainer.innerHTML = `<img src="${dataUrl}" alt="">`;
          }
        }
      }
    } catch (err) {
      console.error(`Failed to load thumbnail for ${item.key}:`, err);
      // Show placeholder on error
      const gridItem = objectGrid.querySelector(`[data-key="${CSS.escape(item.key)}"]`);
      if (gridItem) {
        const thumbContainer = gridItem.querySelector(".grid-item-thumbnail");
        if (thumbContainer) {
          thumbContainer.innerHTML = `<span class="placeholder">📄</span>`;
        }
      }
    }
  }
}

function isVideoFile(key: string): boolean {
  const ext = key.toLowerCase().split(".").pop();
  return ["mp4", "webm", "ogg", "mov", "avi"].includes(ext || "");
}

function setViewMode(mode: "list" | "grid") {
  const previousMode = viewMode;
  viewMode = mode;
  listViewBtn.classList.toggle("active", mode === "list");
  gridViewBtn.classList.toggle("active", mode === "grid");
  
  // When switching to grid mode, reset to first page and reload for infinite scroll
  if (mode === "grid" && previousMode === "list") {
    continuationToken = null;
    tokenHistory = [];
    allGridItems = [];
    loadObjects();
  } else {
    renderObjects();
  }
}

function updatePagination(hasMore: boolean) {
  prevPageBtn.disabled = tokenHistory.length === 0;
  nextPageBtn.disabled = !hasMore;
  pageInfo.textContent = tokenHistory.length > 0 ? `Page ${tokenHistory.length + 1}` : "";
}

async function nextPage() {
  if (!continuationToken) return;
  tokenHistory.push(continuationToken);
  await loadObjects();
}

async function previousPage() {
  if (tokenHistory.length === 0) return;
  tokenHistory.pop();
  continuationToken = tokenHistory[tokenHistory.length - 1] || null;
  await loadObjects();
}

async function navigateToPrefix(prefix: string) {
  currentPrefix = prefix;
  continuationToken = null;
  tokenHistory = [];
  searchPrefix = "";
  searchPrefixInput.value = "";
  searchClearBtn.classList.add("hidden");
  clearSelection();
  await loadObjects();
}

async function goToParent() {
  if (!currentPrefix) return;
  
  // Remove trailing slash, then find last slash
  const trimmed = currentPrefix.replace(/\/$/, "");
  const lastSlash = trimmed.lastIndexOf("/");
  
  if (lastSlash === -1) {
    // We're at top level of a prefix, go to root
    currentPrefix = "";
  } else {
    // Go to parent folder
    currentPrefix = trimmed.substring(0, lastSlash + 1);
  }
  
  continuationToken = null;
  tokenHistory = [];
  clearSelection();
  await loadObjects();
}

// Profile CRUD
function openProfileModal(profile?: Profile) {
  const title = document.getElementById("profile-modal-title")!;
  const idInput = document.getElementById("profile-id") as HTMLInputElement;
  const nameInput = document.getElementById("profile-name") as HTMLInputElement;
  const providerSelect = document.getElementById("profile-provider") as HTMLSelectElement;
  const endpointInput = document.getElementById("profile-endpoint") as HTMLInputElement;
  const regionInput = document.getElementById("profile-region") as HTMLInputElement;
  const accessKeyInput = document.getElementById("profile-access-key") as HTMLInputElement;
  const secretKeyInput = document.getElementById("profile-secret-key") as HTMLInputElement;
  const addressingSelect = document.getElementById("profile-addressing") as HTMLSelectElement;
  const signatureSelect = document.getElementById("profile-signature") as HTMLSelectElement;
  const deleteBtn = document.getElementById("delete-profile-btn") as HTMLButtonElement;
  
  if (profile) {
    title.textContent = "Edit Profile";
    idInput.value = profile.id;
    nameInput.value = profile.name;
    providerSelect.value = profile.provider;
    endpointInput.value = profile.endpoint || "";
    regionInput.value = profile.region;
    accessKeyInput.value = profile.access_key_id;
    secretKeyInput.value = profile.secret_access_key;
    addressingSelect.value = profile.addressing_style;
    signatureSelect.value = profile.signature_version;
    deleteBtn.style.display = "inline-flex";
  } else {
    title.textContent = "Add Profile";
    profileForm.reset();
    idInput.value = "";
    providerSelect.value = "aws_s3";
    addressingSelect.value = "virtual_hosted";
    signatureSelect.value = "v4";
    deleteBtn.style.display = "none";
  }
  
  profileModal.classList.add("open");
}

async function saveProfile() {
  const idInput = document.getElementById("profile-id") as HTMLInputElement;
  const nameInput = document.getElementById("profile-name") as HTMLInputElement;
  const providerSelect = document.getElementById("profile-provider") as HTMLSelectElement;
  const endpointInput = document.getElementById("profile-endpoint") as HTMLInputElement;
  const regionInput = document.getElementById("profile-region") as HTMLInputElement;
  const accessKeyInput = document.getElementById("profile-access-key") as HTMLInputElement;
  const secretKeyInput = document.getElementById("profile-secret-key") as HTMLInputElement;
  const addressingSelect = document.getElementById("profile-addressing") as HTMLSelectElement;
  const signatureSelect = document.getElementById("profile-signature") as HTMLSelectElement;
  
  const profile: Profile = {
    id: idInput.value,
    name: nameInput.value,
    provider: providerSelect.value as Provider,
    endpoint: endpointInput.value || undefined,
    region: regionInput.value,
    access_key_id: accessKeyInput.value,
    secret_access_key: secretKeyInput.value,
    addressing_style: addressingSelect.value as AddressingStyle,
    signature_version: signatureSelect.value as SignatureVersion,
  };
  
  try {
    if (profile.id) {
      await api.updateProfile(profile);
    } else {
      await api.createProfile(profile);
    }
    await loadProfiles();
    closeModal("profile-modal");
  } catch (err) {
    showError(`Failed to save profile: ${err}`);
  }
}

async function deleteCurrentProfile() {
  const idInput = document.getElementById("profile-id") as HTMLInputElement;
  if (!idInput.value) return;
  
  showDeleteConfirm("Are you sure you want to delete this profile?", async () => {
    try {
      await api.deleteProfile(idInput.value);
      if (currentProfileId === idInput.value) {
        currentProfileId = null;
        currentBucket = null;
        objects = [];
        buckets = [];
        renderBuckets();
        renderObjects();
      }
      await loadProfiles();
      closeModal("profile-modal");
      closeModal("delete-modal");
    } catch (err) {
      showError(`Failed to delete profile: ${err}`);
    }
  });
}

// Bucket operations
function openBucketModal() {
  bucketForm.reset();
  bucketModal.classList.add("open");
}

async function createBucket() {
  const nameInput = document.getElementById("bucket-name") as HTMLInputElement;
  const publicCheckbox = document.getElementById("bucket-public") as HTMLInputElement;
  
  if (!currentProfileId || !nameInput.value) return;
  
  try {
    await api.createBucket(currentProfileId, nameInput.value, publicCheckbox?.checked || false);
    await loadBuckets();
    closeModal("bucket-modal");
  } catch (err) {
    showError(`Failed to create bucket: ${err}`);
  }
}

// Folder operations
function openFolderModal() {
  folderForm.reset();
  folderModal.classList.add("open");
}

async function createFolder() {
  const nameInput = document.getElementById("folder-name") as HTMLInputElement;
  
  if (!currentProfileId || !currentBucket || !nameInput.value) return;
  
  const folderName = nameInput.value.replace(/^\/+|\/+$/g, '');
  if (!folderName) {
    showError("Folder name cannot be empty");
    return;
  }
  
  const fullKey = currentPrefix ? `${currentPrefix}${folderName}` : folderName;
  
  try {
    await api.createFolder(currentProfileId, currentBucket, fullKey);
    await loadObjects();
    closeModal("folder-modal");
  } catch (err) {
    showError(`Failed to create folder: ${err}`);
  }
}

// File operations
async function uploadFiles() {
  if (!currentProfileId || !currentBucket) {
    showError("Please select a profile and bucket first");
    return;
  }
  
  const files = await open({
    multiple: true,
    title: "Select files to upload",
  });
  
  if (!files || files.length === 0) return;
  
  await uploadFilesWithTasks(files as string[]);
}

async function uploadDroppedFiles(filePaths: string[]) {
  if (!currentProfileId || !currentBucket) {
    showError("Please select a profile and bucket first");
    return;
  }
  
  if (filePaths.length === 0) return;
  
  await uploadFilesWithTasks(filePaths);
}

const MAX_CONCURRENT_UPLOADS = 20;

async function uploadFilesWithTasks(filePaths: string[]) {
  if (!currentProfileId || !currentBucket) return;
  
  const fileNames = filePaths.map(filePath => filePath.split(/[/\\]/).pop() || filePath);
  const createdTasks = addTasksBatch("upload", fileNames);
  
  const uploadItems = filePaths.map((filePath, index) => ({
    filePath,
    task: createdTasks[index],
  }));
  
  const profileId = currentProfileId!;
  const bucket = currentBucket!;
  const prefix = currentPrefix;
  
  await runWithConcurrency(uploadItems, MAX_CONCURRENT_UPLOADS, async ({ filePath, task }) => {
    updateTaskStatus(task.id, "running");
    try {
      await api.uploadFile(profileId, bucket, prefix, filePath);
      updateTaskStatus(task.id, "completed");
    } catch (err) {
      updateTaskStatus(task.id, "failed", String(err));
    }
  });
  
  await loadObjects();
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  const queue = [...items];
  const running: Promise<void>[] = [];
  
  while (queue.length > 0 || running.length > 0) {
    while (running.length < concurrency && queue.length > 0) {
      const item = queue.shift()!;
      const promise = fn(item).finally(() => {
        const index = running.indexOf(promise);
        if (index > -1) running.splice(index, 1);
      });
      running.push(promise);
    }
    
    if (running.length > 0) {
      await Promise.race(running);
    }
  }
}

async function uploadFolder() {
  if (!currentProfileId || !currentBucket) {
    showError("Please select a profile and bucket first");
    return;
  }
  
  const folder = await open({
    directory: true,
    title: "Select folder to upload",
  });
  
  if (!folder) return;
  
  try {
    setLoading(true);
    await api.uploadFolder(currentProfileId, currentBucket, currentPrefix, folder as string);
    await loadObjects();
  } catch (err) {
    showError(`Failed to upload folder: ${err}`);
  } finally {
    setLoading(false);
  }
}

async function downloadObject(key: string) {
  if (!currentProfileId || !currentBucket) return;
  
  const fileName = key.split("/").pop() || "download";
  const savePath = await save({
    defaultPath: fileName,
    title: "Save file as",
  });
  
  if (!savePath) return;
  
  try {
    setLoading(true);
    await api.downloadObject(currentProfileId, currentBucket, key, savePath);
  } catch (err) {
    showError(`Failed to download: ${err}`);
  } finally {
    setLoading(false);
  }
}

async function deleteObject(key: string) {
  if (!currentProfileId || !currentBucket) return;
  
  const fileName = key.split("/").pop() || key;
  
  showDeleteConfirm(`Are you sure you want to delete "${key}"?`, async () => {
    closeModal("delete-modal");
    const task = addTask("delete", fileName);
    updateTaskStatus(task.id, "running");
    
    try {
      await api.deleteObject(currentProfileId!, currentBucket!, key);
      updateTaskStatus(task.id, "completed");
      await loadObjects();
    } catch (err) {
      updateTaskStatus(task.id, "failed", String(err));
    }
  });
}

async function presignObject(key: string) {
  if (!currentProfileId || !currentBucket) return;
  
  try {
    presignedUrl = await api.presignUrl(currentProfileId, currentBucket, key, 3600);
    presignedUrlTextarea.value = presignedUrl;
    footer.classList.add("expanded");
  } catch (err) {
    showError(`Failed to generate presigned URL: ${err}`);
  }
}

async function previewObject(key: string) {
  console.log("[Preview] Starting preview for key:", key);
  
  if (!currentProfileId || !currentBucket) {
    console.log("[Preview] Missing profileId or bucket, aborting");
    return;
  }
  
  const container = document.getElementById("preview-container")!;
  const title = document.getElementById("preview-title")!;
  
  // Show modal with loading state
  title.textContent = key.split("/").pop() || "Preview";
  container.innerHTML = `<div class="loading">Loading...</div>`;
  previewModal.classList.add("open");
  
  try {
    console.log("[Preview] Fetching preview data from backend...");
    const previewData = await api.getObjectPreview(currentProfileId, currentBucket, key);
    console.log("[Preview] Preview data received, content_type:", previewData.content_type, "data length:", previewData.data.length);
    
    // Determine actual content type - use extension as fallback for application/octet-stream
    let contentType = previewData.content_type;
    if (contentType === "application/octet-stream") {
      const ext = key.toLowerCase().split(".").pop();
      const extMimeMap: Record<string, string> = {
        jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif",
        webp: "image/webp", svg: "image/svg+xml", bmp: "image/bmp", ico: "image/x-icon",
        mp4: "video/mp4", webm: "video/webm", ogg: "video/ogg", mov: "video/quicktime",
        avi: "video/x-msvideo", mkv: "video/x-matroska",
      };
      contentType = extMimeMap[ext || ""] || contentType;
    }
    
    const dataUrl = `data:${contentType};base64,${previewData.data}`;
    
    container.innerHTML = "";
    
    if (contentType.startsWith("image/")) {
      console.log("[Preview] Creating image element");
      const img = document.createElement("img");
      img.alt = "Preview";
      img.style.maxWidth = "100%";
      img.style.maxHeight = "60vh";
      img.onload = () => console.log("[Preview] Image loaded successfully");
      img.onerror = (e) => {
        console.error("[Preview] Image failed to load:", e);
        container.innerHTML = `<div class="loading">Failed to display image</div>`;
      };
      img.src = dataUrl;
      container.appendChild(img);
    } else if (contentType.startsWith("video/")) {
      console.log("[Preview] Creating video element with play button");
      
      // Create wrapper for video and play button
      const wrapper = document.createElement("div");
      wrapper.className = "video-preview-wrapper";
      
      const video = document.createElement("video");
      video.style.maxWidth = "100%";
      video.style.maxHeight = "60vh";
      video.onloadeddata = () => console.log("[Preview] Video loaded successfully");
      video.onerror = (e) => {
        console.error("[Preview] Video failed to load:", e);
        container.innerHTML = `<div class="loading">Failed to display video</div>`;
      };
      video.src = dataUrl;
      
      // Create play button overlay
      const playButton = document.createElement("div");
      playButton.className = "video-play-button";
      playButton.innerHTML = `<svg width="64" height="64" viewBox="0 0 16 16" fill="white">
        <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
        <path d="M6.271 5.055a.5.5 0 0 1 .52.038l3.5 2.5a.5.5 0 0 1 0 .814l-3.5 2.5A.5.5 0 0 1 6 10.5v-5a.5.5 0 0 1 .271-.445z"/>
      </svg>`;
      
      playButton.addEventListener("click", () => {
        playButton.style.display = "none";
        video.controls = true;
        video.play();
      });
      
      wrapper.appendChild(video);
      wrapper.appendChild(playButton);
      container.appendChild(wrapper);
    } else {
      container.innerHTML = `<div class="loading">Unsupported content type: ${contentType}</div>`;
    }
  } catch (err) {
    console.error("[Preview] Error fetching preview:", err);
    container.innerHTML = `<div class="loading">Failed to load preview</div>`;
    showError(`Failed to preview: ${err}`);
  }
}

// Sync operations
async function syncWithLocal() {
  if (!currentProfileId || !currentBucket) {
    showError("Please select a profile and bucket first");
    return;
  }
  
  const folder = await open({
    directory: true,
    title: "Select local folder to sync",
  });
  
  if (!folder) return;
  
  const folderName = (folder as string).split(/[/\\]/).pop() || "folder";
  const task = addTask("sync", folderName);
  updateTaskStatus(task.id, "running");
  
  try {
    const result = await api.syncFolder(
      currentProfileId,
      currentBucket,
      currentPrefix,
      folder as string,
      "local_to_remote"
    );
    updateTaskStatus(task.id, "completed");
    showError(`Sync complete: ${result.uploaded} uploaded, ${result.downloaded} downloaded, ${result.skipped} skipped`);
    await loadObjects();
  } catch (err) {
    updateTaskStatus(task.id, "failed", String(err));
  }
}

async function startKeepSync() {
  if (!currentProfileId || !currentBucket) {
    showError("Please select a profile and bucket first");
    return;
  }
  
  const folder = await open({
    directory: true,
    title: "Select local folder for KeepSync",
  });
  
  if (!folder) return;
  
  const folderName = (folder as string).split(/[/\\]/).pop() || "folder";
  const task = addTask("keepsync", folderName);
  updateTaskStatus(task.id, "running");
  
  try {
    const syncId = await api.startKeepSync(
      currentProfileId,
      currentBucket,
      currentPrefix,
      folder as string
    );
    task.syncId = syncId;
    showError(`KeepSync started: ${syncId}`);
  } catch (err) {
    updateTaskStatus(task.id, "failed", String(err));
  }
}

// Task management
const MAX_VISIBLE_TASKS = 100;
let renderScheduled = false;

function generateTaskId(): string {
  return `task-${++taskIdCounter}`;
}

function scheduleRender() {
  if (!renderScheduled) {
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      renderTasks();
    });
  }
}

function addTask(type: TaskType, fileName: string): Task {
  const task: Task = {
    id: generateTaskId(),
    type,
    fileName,
    status: "pending",
  };
  tasks.unshift(task);
  showTaskPanel();
  scheduleRender();
  return task;
}

function addTasksBatch(type: TaskType, fileNames: string[]): Task[] {
  const newTasks = fileNames.map(fileName => ({
    id: generateTaskId(),
    type,
    fileName,
    status: "pending" as TaskStatus,
  }));
  tasks.unshift(...newTasks);
  showTaskPanel();
  scheduleRender();
  return newTasks;
}

function updateTaskStatus(taskId: string, status: TaskStatus, error?: string) {
  const task = tasks.find(t => t.id === taskId);
  if (task) {
    task.status = status;
    if (error) task.error = error;
    scheduleRender();
  }
}

function clearCompletedTasks() {
  tasks = tasks.filter(t => t.status !== "completed" && t.status !== "failed");
  renderTasks();
  if (tasks.length === 0) {
    hideTaskPanel();
  }
}

function showTaskPanel() {
  taskPanel.classList.remove("hidden");
}

function hideTaskPanel() {
  taskPanel.classList.add("hidden");
}

function updateTaskProgress() {
  const total = tasks.length;
  const completed = tasks.filter(t => t.status === "completed").length;
  const failed = tasks.filter(t => t.status === "failed").length;
  const done = completed + failed;
  
  taskProgressText.textContent = `${done} / ${total} completed`;
  
  if (total === 0) {
    taskProgressFill.style.width = "0%";
    taskProgressFill.classList.remove("has-errors");
    return;
  }
  
  const percent = (done / total) * 100;
  taskProgressFill.style.width = `${percent}%`;
  
  if (failed > 0) {
    const successPercent = (completed / total) * 100;
    taskProgressFill.classList.add("has-errors");
    taskProgressFill.style.setProperty("--success-percent", `${successPercent}%`);
  } else {
    taskProgressFill.classList.remove("has-errors");
  }
}

function renderTasks() {
  updateTaskProgress();
  
  if (tasks.length === 0) {
    taskListEl.innerHTML = '<div class="task-empty">No tasks</div>';
    return;
  }
  
  const visibleTasks = tasks.slice(0, MAX_VISIBLE_TASKS);
  const hiddenCount = tasks.length - visibleTasks.length;
  
  let html = visibleTasks.map(task => {
    const iconClass = task.type;
    let typeIcon: string;
    switch (task.type) {
      case "upload":
        typeIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5z"/><path d="M7.646 1.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1-.708.708L8.5 2.707V11.5a.5.5 0 0 1-1 0V2.707L5.354 4.854a.5.5 0 1 1-.708-.708l3-3z"/></svg>`;
        break;
      case "delete":
        typeIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/><path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1z"/></svg>`;
        break;
      case "sync":
        typeIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41zm-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9z"/><path fill-rule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5.002 5.002 0 0 0 8 3zM3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9H3.1z"/></svg>`;
        break;
      case "keepsync":
        typeIcon = `<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/><path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466z"/></svg>`;
        break;
    }
    
    let statusIcon = "";
    let statusText = "";
    let statusClass = "";
    
    const runningTextMap: Record<TaskType, string> = {
      upload: "Uploading...",
      delete: "Deleting...",
      sync: "Syncing...",
      keepsync: "Watching...",
    };
    
    switch (task.status) {
      case "pending":
        statusText = "Waiting...";
        break;
      case "running":
        statusIcon = '<div class="task-spinner"></div>';
        statusText = runningTextMap[task.type];
        statusClass = "running";
        break;
      case "completed":
        statusIcon = '<svg class="task-check" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/></svg>';
        statusText = "Completed";
        statusClass = "completed";
        break;
      case "failed":
        statusIcon = '<svg class="task-error" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/><path d="M7.002 11a1 1 0 1 1 2 0 1 1 0 0 1-2 0zM7.1 4.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 4.995z"/></svg>';
        statusText = task.error || "Failed";
        statusClass = "failed";
        break;
    }
    
    return `
      <div class="task-item" data-id="${task.id}">
        <div class="task-icon ${iconClass}">${typeIcon}</div>
        <div class="task-info">
          <div class="task-name" title="${escapeHtml(task.fileName)}">${escapeHtml(task.fileName)}</div>
          <div class="task-status ${statusClass}">${statusText}</div>
        </div>
        ${statusIcon}
      </div>
    `;
  }).join("");
  
  if (hiddenCount > 0) {
    html += `<div class="task-hidden-notice">... and ${hiddenCount} more tasks</div>`;
  }
  
  taskListEl.innerHTML = html;
}

// Search functions
function handleSearchInput() {
  const value = searchPrefixInput.value;
  searchClearBtn.classList.toggle("hidden", !value);
  
  if (searchTimeout) {
    clearTimeout(searchTimeout);
  }
  
  searchTimeout = window.setTimeout(() => {
    searchPrefix = value;
    continuationToken = null;
    tokenHistory = [];
    loadObjects();
  }, 300);
}

function clearSearch() {
  searchPrefixInput.value = "";
  searchClearBtn.classList.add("hidden");
  searchPrefix = "";
  continuationToken = null;
  tokenHistory = [];
  loadObjects();
}

// Sorting
function setSortField(field: "name" | "size" | "modified") {
  if (sortField === field) {
    sortDirection = sortDirection === "asc" ? "desc" : "asc";
  } else {
    sortField = field;
    sortDirection = "asc";
  }
  updateSortIndicators();
  renderObjects();
}

function updateSortIndicators() {
  document.querySelectorAll(".sortable").forEach(th => {
    const field = (th as HTMLElement).dataset.sort;
    const icon = th.querySelector(".sort-icon");
    if (icon) {
      if (field === sortField) {
        icon.textContent = sortDirection === "asc" ? "▲" : "▼";
      } else {
        icon.textContent = "";
      }
    }
  });
}

// Helpers
function setLoading(loading: boolean) {
  isLoading = loading;
  document.body.classList.toggle("loading", loading);
}

function showError(message: string) {
  errors.unshift(message);
  if (errors.length > 50) errors.pop();
  renderErrors();
  footer.classList.add("expanded");
}

function clearErrors() {
  errors = [];
  errorScrollIndex = 0;
  renderErrors();
  footer.classList.remove("expanded");
}

function renderErrors() {
  const visibleErrors = errors.slice(errorScrollIndex, errorScrollIndex + 5);
  errorListEl.innerHTML = visibleErrors.map(e => `<div class="error-item">${escapeHtml(e)}</div>`).join("");
}

function scrollErrors(direction: number) {
  errorScrollIndex = Math.max(0, Math.min(errors.length - 5, errorScrollIndex + direction));
  renderErrors();
}

function showDeleteConfirm(message: string, callback: () => Promise<void>) {
  const messageEl = document.getElementById("delete-message")!;
  messageEl.textContent = message;
  deleteCallback = callback;
  deleteModal.classList.add("open");
}

function closeModal(id: string) {
  document.getElementById(id)?.classList.remove("open");
}

async function copyPresignedUrl() {
  if (!presignedUrl) return;
  try {
    await writeText(presignedUrl);
    showError("URL copied to clipboard");
  } catch (err) {
    showError(`Failed to copy: ${err}`);
  }
}

function formatSize(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString();
  } catch {
    return dateStr;
  }
}

function isMediaFile(key: string): boolean {
  const ext = key.toLowerCase().split(".").pop();
  return ["jpg", "jpeg", "png", "gif", "webp", "svg", "mp4", "webm", "ogg"].includes(ext || "");
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Selection functions
function toggleObjectSelection(key: string, selected: boolean) {
  if (selected) {
    selectedKeys.add(key);
  } else {
    selectedKeys.delete(key);
  }
  updateSelectionUI();
}

function selectAllObjects(selected: boolean) {
  const selectableItems = [...objects.filter(o => !o.is_folder)];
  if (selected) {
    selectableItems.forEach(obj => selectedKeys.add(obj.key));
  } else {
    selectableItems.forEach(obj => selectedKeys.delete(obj.key));
  }
  updateSelectionUI();
  renderObjects();
}

function clearSelection() {
  selectedKeys.clear();
  updateSelectionUI();
}

function updateSelectionUI() {
  const count = selectedKeys.size;
  selectedCountEl.textContent = String(count);
  if (count > 0) {
    deleteSelectedBtn.classList.remove("hidden");
  } else {
    deleteSelectedBtn.classList.add("hidden");
  }
  updateSelectAllCheckbox();
}

function updateSelectAllCheckbox() {
  const selectableItems = objects.filter(o => !o.is_folder);
  if (selectableItems.length === 0) {
    selectAllCheckbox.checked = false;
    selectAllCheckbox.indeterminate = false;
    return;
  }
  const selectedCount = selectableItems.filter(o => selectedKeys.has(o.key)).length;
  selectAllCheckbox.checked = selectedCount === selectableItems.length;
  selectAllCheckbox.indeterminate = selectedCount > 0 && selectedCount < selectableItems.length;
}

async function deleteSelectedObjects() {
  if (!currentProfileId || !currentBucket || selectedKeys.size === 0) return;
  
  const keys = Array.from(selectedKeys);
  const count = keys.length;
  
  showDeleteConfirm(`Are you sure you want to delete ${count} selected object${count > 1 ? "s" : ""}?`, async () => {
    closeModal("delete-modal");
    
    const task = addTask("delete", `${count} objects`);
    updateTaskStatus(task.id, "running");
    
    try {
      const result = await api.deleteObjects(currentProfileId!, currentBucket!, keys);
      
      if (result.errors.length > 0) {
        result.errors.forEach(err => {
          showError(`Failed to delete ${err.key}: ${err.message}`);
        });
        updateTaskStatus(task.id, "failed", `${result.errors.length} errors`);
      } else {
        updateTaskStatus(task.id, "completed");
      }
      
      clearSelection();
      await loadObjects();
    } catch (err) {
      updateTaskStatus(task.id, "failed", String(err));
    }
  });
}

// Event Listeners
function setupEventListeners() {
  // Profile list clicks
  profilesList.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const editBtn = target.closest(".edit-profile");
    if (editBtn) {
      const id = (editBtn as HTMLElement).dataset.id!;
      const profile = profiles.find(p => p.id === id);
      if (profile) openProfileModal(profile);
      return;
    }
    
    const item = target.closest(".profile-item");
    if (item) {
      selectProfile((item as HTMLElement).dataset.id!);
    }
  });
  
  addProfileBtn.addEventListener("click", () => openProfileModal());
  
  document.getElementById("save-profile-btn")!.addEventListener("click", saveProfile);
  document.getElementById("delete-profile-btn")!.addEventListener("click", deleteCurrentProfile);
  
  // Task panel
  clearCompletedBtn.addEventListener("click", clearCompletedTasks);
  closeTaskPanelBtn.addEventListener("click", hideTaskPanel);
  
  // Bucket operations
  bucketSelect.addEventListener("change", () => {
    if (bucketSelect.value) selectBucket(bucketSelect.value);
  });
  refreshBucketsBtn.addEventListener("click", loadBuckets);
  
  createBucketBtn.addEventListener("click", openBucketModal);
  document.getElementById("create-bucket-submit-btn")!.addEventListener("click", createBucket);
  
  createFolderBtn.addEventListener("click", openFolderModal);
  document.getElementById("create-folder-submit-btn")!.addEventListener("click", createFolder);
  
  // Navigation
  goBackBtn.addEventListener("click", goToParent);
  refreshObjectsBtn.addEventListener("click", () => loadObjects());
  
  // View mode toggle
  listViewBtn.addEventListener("click", () => setViewMode("list"));
  gridViewBtn.addEventListener("click", () => setViewMode("grid"));
  
  // Sort headers
  document.querySelectorAll(".sortable").forEach(th => {
    th.addEventListener("click", () => {
      const field = (th as HTMLElement).dataset.sort as "name" | "size" | "modified";
      if (field) setSortField(field);
    });
  });
  
  // Object list clicks
  objectList.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const row = target.closest(".object-row") as HTMLElement;
    if (!row) return;
    
    const key = row.dataset.key!;
    const isFolder = row.dataset.isFolder === "true";
    
    // Handle checkbox clicks
    if (target.classList.contains("object-checkbox")) {
      const checkbox = target as HTMLInputElement;
      toggleObjectSelection(key, checkbox.checked);
      row.classList.toggle("selected", checkbox.checked);
      return;
    }
    
    if (target.closest(".download-btn")) {
      downloadObject(key);
    } else if (target.closest(".presign-btn")) {
      presignObject(key);
    } else if (target.closest(".delete-btn")) {
      deleteObject(key);
    } else if (target.closest(".preview-btn")) {
      previewObject(key);
    } else if (isFolder) {
      navigateToPrefix(key);
    }
  });
  
  // Select all checkbox
  selectAllCheckbox.addEventListener("change", () => {
    selectAllObjects(selectAllCheckbox.checked);
  });
  
  // Delete selected button
  deleteSelectedBtn.addEventListener("click", deleteSelectedObjects);
  
  // Object grid clicks
  objectGrid.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const gridItem = target.closest(".grid-item") as HTMLElement;
    if (!gridItem) return;
    
    const key = gridItem.dataset.key!;
    const isFolder = gridItem.dataset.isFolder === "true";
    
    if (isFolder) {
      navigateToPrefix(key);
    } else if (isMediaFile(key)) {
      previewObject(key);
    }
  });
  
  // Pagination
  prevPageBtn.addEventListener("click", previousPage);
  nextPageBtn.addEventListener("click", nextPage);
  
  // Toolbar buttons
  uploadFilesBtn.addEventListener("click", uploadFiles);
  uploadFolderBtn.addEventListener("click", uploadFolder);
  syncBtn.addEventListener("click", syncWithLocal);
  keepSyncBtn.addEventListener("click", startKeepSync);
  
  // Footer
  footerToggle.addEventListener("click", () => footer.classList.toggle("expanded"));
  copyUrlBtn.addEventListener("click", copyPresignedUrl);
  
  // Search
  searchPrefixInput.addEventListener("input", handleSearchInput);
  searchClearBtn.addEventListener("click", clearSearch);
  
  // Delete confirmation
  document.getElementById("confirm-delete-btn")!.addEventListener("click", async () => {
    if (deleteCallback) await deleteCallback();
  });
  
  // Modal close buttons
  document.querySelectorAll(".modal-close, .modal-backdrop").forEach(el => {
    el.addEventListener("click", (e) => {
      const modal = (e.target as HTMLElement).closest(".modal");
      if (modal) modal.classList.remove("open");
    });
  });
}

function setupKeyboardShortcuts() {
  document.addEventListener("keydown", (e) => {
    // Escape to clear errors
    if (e.key === "Escape") {
      clearErrors();
      document.querySelectorAll(".modal.open").forEach(m => m.classList.remove("open"));
    }
    
    // Ctrl/Cmd + C to copy URL when focused on URL area
    if ((e.ctrlKey || e.metaKey) && e.key === "c" && document.activeElement === presignedUrlTextarea) {
      e.preventDefault();
      copyPresignedUrl();
    }
    
    // Arrow keys / j/k for error scrolling
    if (footer.classList.contains("expanded")) {
      if (e.key === "ArrowUp" || e.key === "k") {
        scrollErrors(-1);
      } else if (e.key === "ArrowDown" || e.key === "j") {
        scrollErrors(1);
      }
    }
  });
}

function setupTauriEventListeners() {
  listen<SyncProgressPayload>("sync-progress", (event) => {
    showError(`Syncing: ${event.payload.current_file}`);
  });
  
  listen<SyncCompletedPayload>("sync-completed", (event) => {
    showError(`Sync completed: ${event.payload.files_uploaded} uploaded, ${event.payload.files_downloaded} downloaded`);
  });
  
  listen<SyncErrorPayload>("sync-error", (event) => {
    showError(`Sync error: ${event.payload.error}`);
  });
  
  setupDragAndDrop();
}

function setupDragAndDrop() {
  const appWindow = getCurrentWebviewWindow();
  let dragCounter = 0;
  
  appWindow.onDragDropEvent((event) => {
    if (event.payload.type === "over") {
      dragCounter++;
      mainContent.classList.add("drag-over");
    } else if (event.payload.type === "leave") {
      dragCounter--;
      if (dragCounter <= 0) {
        dragCounter = 0;
        mainContent.classList.remove("drag-over");
      }
    } else if (event.payload.type === "drop") {
      dragCounter = 0;
      mainContent.classList.remove("drag-over");
      const paths = event.payload.paths;
      if (paths && paths.length > 0) {
        uploadDroppedFiles(paths);
      }
    }
  });
}

// Start the app
init();
