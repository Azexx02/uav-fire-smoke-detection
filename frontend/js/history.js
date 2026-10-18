/* ============================================
 林焰智巡 — History Page Logic
 ============================================ */

(function () {
 'use strict';

 /* ---------- State ---------- */
 let historyItems = [];
 let currentModalItem = null;
 let confirmCallback = null;
 let scoredActiveIds = new Set();
 let currentImageMode = 'annotated';
 let activeImageIndex = 0;

 /* ---------- DOM ---------- */
 const $ = (sel) => document.querySelector(sel);

 const historyGrid = $('#historyGrid');
 const emptyState = $('#emptyState');
 const loadingState = $('#loadingState');
 const recordCount = $('#recordCount');
 const filterType = $('#filterType');
 const sortOrder = $('#sortOrder');
 const btnRefresh = $('#btnRefresh');
 const btnClearAll = $('#btnClearAll');
 const btnClearUnarchivedHistory = $('#btnClearUnarchivedHistory');

 // Modal
 const historyModal = $('#historyModal');
 const btnCloseModal = $('#btnCloseModal');
 const modalImage = $('#modalImage');
 const modalTime = $('#modalTime');
 const modalSource = $('#modalSource');
 const modalInference = $('#modalInference');
 const modalDetections = $('#modalDetections');
 const btnDeleteRecord = $('#btnDeleteRecord');
 const btnShowAnnotated = $('#btnShowAnnotated');
 const btnShowOriginal = $('#btnShowOriginal');

 // Confirm
 const confirmDialog = $('#confirmDialog');
 const btnConfirmCancel = $('#btnConfirmCancel');
 const btnConfirmOk = $('#btnConfirmOk');

 // System
 const statusDot = $('#statusDot');
 const statusText = $('#statusText');

 /* ---------- Init ---------- */
 async function init() {
 setupEventListeners();
 await loadHistory();
 checkHealth();
 setInterval(checkHealth, 15000);
 }

 async function loadScoringSummary() {
 try {
 const summary = await API.getScoringSummary();
 scoredActiveIds.clear();
 if (summary && summary.score_details) {
 summary.score_details.forEach(detail => {
 scoredActiveIds.add(String(detail.history_id));
 });
 }
 } catch (err) {
 console.warn("无法拉取当前活动评分摘要:", err);
 }
 }

 window.toggleBatch = function(batchId) {
 const body = document.getElementById(`body-${batchId}`);
 const arrow = document.getElementById(`arrow-${batchId}`);
 if (body && arrow) {
 const isHidden = body.classList.toggle('hidden');
 arrow.textContent = isHidden ? '展开' : '收起';
 const parentCard = body.closest('.batch-card');
 if (parentCard) {
 if (!isHidden) {
 parentCard.style.border = '1px solid rgba(34, 197, 94, 0.4)';
 parentCard.style.boxShadow = '0 8px 32px rgba(34, 197, 94, 0.05)';
 } else {
 parentCard.style.border = '1px dashed rgba(34, 197, 94, 0.2)';
 parentCard.style.boxShadow = '';
 }
 }
 }
 };

 async function checkHealth() {
 try {
 await API.healthCheck();
 statusDot.className = 'status-dot';
 statusText.textContent = '系统在线';
 } catch {
 statusDot.className = 'status-dot offline';
 statusText.textContent = '连接失败';
 }
 }

 /* ---------- Load History ---------- */
 async function loadHistory() {
 loadingState.classList.remove('hidden');
 emptyState.classList.add('hidden');
 historyGrid.innerHTML = '';

 try {
 await loadScoringSummary();
 const data = await API.getHistory();
 historyItems = data.records || (Array.isArray(data) ? data : []);
 } catch (err) {
 Toast.error('加载历史记录失败: ' + err.message);
 historyItems = [];
 }

 loadingState.classList.add('hidden');
 renderGrid();
 }

 /* ---------- Filter & Sort ---------- */
 function getFilteredSorted() {
 let items = [...historyItems];

 // Filter by type
 const type = filterType.value;
 if (type !== 'all') {
 items = items.filter(item => {
 const src = (item.source || item.type || '').toLowerCase();
 if (type === 'capture') return src.includes('capture') || src.includes('camera');
 if (type === 'upload') return src.includes('upload') || src.includes('image');
 if (type === 'video') return src.includes('video');
 return true;
 });
 }

 // Filter by scored state
 const filterScored = $('#filterScored');
 const scoredFilter = filterScored ? filterScored.value : 'all';
 if (scoredFilter !== 'all') {
 items = items.filter(item => {
 const isScored = !!item.batch_id || scoredActiveIds.has(String(item.id));
 if (scoredFilter === 'scored') return isScored;
 if (scoredFilter === 'unscored') return !isScored;
 return true;
 });
 }

 // Sort
 const order = sortOrder.value;
 items.sort((a, b) => {
 if (order === 'newest') {
 return new Date(b.timestamp || b.created_at || 0) - new Date(a.timestamp || a.created_at || 0);
 }
 if (order === 'oldest') {
 return new Date(a.timestamp || a.created_at || 0) - new Date(b.timestamp || b.created_at || 0);
 }
 if (order === 'most_detections') {
 const da = (a.detections || []).length;
 const db = (b.detections || []).length;
 return db - da;
 }
 return 0;
 });

 return items;
 }

 function renderSingleCard(item, idx, isScored) {
 const imgUrl = Utils.getImageURL(item);
 const time = Utils.formatTime(item.timestamp || item.created_at);
 const detections = item.detections || [];
 const counts = Utils.countByClass(detections);
 const source = item.source || item.type || 'upload';
 const sourceLabel = {
 capture: ' 实时监测', camera: ' 实时监测',
 upload: ' 图片上传', image: ' 图片上传',
 video: ' 视频监测'
 }[source.toLowerCase()] || ' ' + source;

 const scoredBadge = isScored 
 ? `<span class="badge badge-success" style="background:var(--success-green);color:#fff;border-color:var(--success-green);">已评审</span>`
 : '';

 const isSmokeBurst = item.alert_type === 'smoke_burst' && item.images && item.images.length > 0;
 const imgCountBadge = isSmokeBurst
 ? `<span class="img-count-badge" style="position:absolute; right:8px; bottom:8px; background:rgba(0,0,0,0.65); color:#fff; font-size:0.7rem; padding:2px 6px; border-radius:4px; font-weight:bold; backdrop-filter:blur(4px); border:1px solid rgba(255,255,255,0.1); z-index:5; display:flex; align-items:center; gap:4px;">${item.images.length}张</span>`
 : '';

 return `
 <div class="image-grid-item animate-slide-up" style="animation-delay:${idx * 0.04}s; position:relative;"
 data-id="${item.id}" onclick="openHistoryModal('${item.id}')">
 <img src="${imgUrl}" alt="检测记录" loading="lazy" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 400 300%22><rect fill=%22%231a1f35%22 width=%22400%22 height=%22300%22/><text x=%2250%%22 y=%2250%%22 fill=%22%2364748b%22 text-anchor=%22middle%22 dy=%22.3em%22 font-size=%2220%22>图片加载失败</text></svg>'">
 ${imgCountBadge}
 <div class="item-overlay">
 <span class="badge badge-muted">${sourceLabel}</span>${scoredBadge}
 </div>
 <div class="item-info">
 <div class="item-time">${time}</div>
 <div class="item-badges">
 ${counts.fire > 0 ? `<span class="badge badge-fire">${counts.fire}</span>` : ''}
 ${counts.smoke > 0 ? `<span class="badge badge-smoke">${counts.smoke}</span>` : ''}
 ${detections.length === 0 ? '<span class="badge badge-success">安全</span>' : ''}
 </div>
 </div>
 </div>`;
 }

 function renderBatchCard(batchId, batchItems, idx) {
 const time = Utils.formatTime(batchItems[0].timestamp || batchItems[0].created_at);
 const innerGridHTML = batchItems.map((item, subIdx) => {
 return renderSingleCard(item, subIdx, true);
 }).join('');

 return `
 <div class="batch-card mb-16" style="grid-column: 1 / -1; background: rgba(34, 197, 94, 0.02); border: 1px dashed rgba(34, 197, 94, 0.2); border-radius: var(--radius-lg); overflow: hidden; transition: all var(--transition); animation: fadeSlideUp 0.4s ease; animation-delay:${idx * 0.04}s;">
 <div class="batch-header flex items-center justify-between" style="cursor: pointer; padding: 16px; background: rgba(255, 255, 255, 0.02); border-bottom: 1px solid rgba(255,255,255,0.05); user-select: none;" onclick="window.toggleBatch('${batchId}')" onmouseover="this.style.background='rgba(255, 255, 255, 0.04)'" onmouseout="this.style.background='rgba(255, 255, 255, 0.02)'">
 <div class="flex items-center gap-12">
 <span style="font-size: 1.5rem; filter: drop-shadow(0 2px 4px rgba(34, 197, 94, 0.2));"></span>
 <div>
 <h3 style="font-family: var(--font-cn); margin: 0; font-size: 1.05rem; color: var(--text-primary); display: flex; align-items: center; gap: 8px;">
 ${batchId}
 </h3>
 <p style="margin: 4px 0 0 0; font-size: 0.8rem; color: var(--text-muted);">
 评审归档时间: ${time} &nbsp;|&nbsp; 样本总数: ${batchItems.length} 个
 </p>
 </div>
 </div>
 <div class="flex items-center gap-12">
 <span class="badge badge-success" style="background:rgba(34, 197, 94, 0.15); color:var(--success-green); border:1px solid rgba(34, 197, 94, 0.3);">已完成专家评审</span>
 <span id="arrow-${batchId}" style="color: var(--text-muted); font-size: 0.8rem; font-weight: 600; padding: 4px 10px; border-radius: 4px; background: rgba(255,255,255,0.05); transition: background var(--transition);">展开</span>
 </div>
 </div>
 <div class="batch-body hidden" id="body-${batchId}" style="padding: 16px; background: rgba(0, 0, 0, 0.2);">
 <div class="image-grid">${innerGridHTML}
 </div>
 </div>
 </div>`;
 }

 /* ---------- Render Grid ---------- */
 function renderGrid() {
 const items = getFilteredSorted();
 recordCount.textContent = `共 ${items.length} 条记录`;

 if (items.length === 0) {
 historyGrid.innerHTML = '';
 emptyState.classList.remove('hidden');
 return;
 }

 emptyState.classList.add('hidden');

 // Grouping
 const groups = [];
 const batchMap = new Map();

 items.forEach((item, index) => {
 if (!item.batch_id) {
 groups.push({
 type: 'individual',
 id: item.id,
 items: [item],
 firstIndex: index
 });
 } else {
 if (!batchMap.has(item.batch_id)) {
 const group = {
 type: 'batch',
 id: item.batch_id,
 items: [],
 firstIndex: index
 };
 batchMap.set(item.batch_id, group);
 groups.push(group);
 }
 batchMap.get(item.batch_id).items.push(item);
 }
 });

 // Sort groups by their firstIndex to preserve desired sort order
 groups.sort((a, b) => a.firstIndex - b.firstIndex);

 historyGrid.innerHTML = groups.map((g, idx) => {
 if (g.type === 'individual') {
 const item = g.items[0];
 const isScored = scoredActiveIds.has(String(item.id));
 return renderSingleCard(item, idx, isScored);
 } else {
 return renderBatchCard(g.id, g.items, idx);
 }
 }).join('');
 }

 /* ---------- Modal ---------- */
 window.setActiveImageIndex = function(activeIdx) {
 activeImageIndex = activeIdx;
 updateModalImage();
 };

 function updateModalImage() {
 if (!currentModalItem) return;
 
 const hasMultiple = currentModalItem.images && currentModalItem.images.length > 0;
 let imgSrc = '';
 
 if (currentImageMode === 'original') {
 if (hasMultiple && currentModalItem.original_images && currentModalItem.original_images.length > activeImageIndex) {
 imgSrc = currentModalItem.original_images[activeImageIndex];
 } else if (hasMultiple && currentModalItem.images && currentModalItem.images.length > activeImageIndex) {
 if (activeImageIndex === 0) {
 imgSrc = Utils.getOriginalImageURL(currentModalItem) || currentModalItem.images[0];
 } else {
 // Fallback parsing naming from annotated image to original image
 const annUrl = currentModalItem.images[activeImageIndex];
 if (annUrl && annUrl.includes('/results/det_')) {
 imgSrc = annUrl.replace('/results/det_', '/uploads/orig_');
 } else {
 imgSrc = annUrl;
 }
 }
 } else {
 imgSrc = Utils.getOriginalImageURL(currentModalItem) || Utils.getImageURL(currentModalItem);
 }
 } else { // annotated
 if (hasMultiple && currentModalItem.images && currentModalItem.images.length > activeImageIndex) {
 imgSrc = currentModalItem.images[activeImageIndex];
 } else {
 imgSrc = Utils.getImageURL(currentModalItem);
 }
 }
 
 modalImage.src = imgSrc;
 
 // Update active class on thumbnails
 const thumbs = document.querySelectorAll('.smoke-burst-thumb');
 thumbs.forEach((t, i) => {
 t.style.border = i === activeImageIndex ? '2px solid var(--accent-orange)' : '2px solid rgba(255,255,255,0.1)';
 });

 // Update buttons
 if (currentImageMode === 'original') {
 btnShowOriginal.className = 'btn btn-sm btn-primary active';
 btnShowAnnotated.className = 'btn btn-sm btn-ghost';
 } else {
 btnShowAnnotated.className = 'btn btn-sm btn-primary active';
 btnShowOriginal.className = 'btn btn-sm btn-ghost';
 }
 }

 window.openHistoryModal = function (id) {
 const item = historyItems.find(h => String(h.id) === String(id));
 if (!item) return;
 currentModalItem = item;

 const imgUrl = Utils.getImageURL(item);
 modalTime.textContent = Utils.formatTime(item.timestamp || item.created_at);

 const source = item.source || item.type || 'upload';
 const sourceLabels = {
 capture: '实时监测', camera: '实时监测',
 upload: '图片上传', image: '图片上传',
 video: '视频监测'
 };
 modalSource.textContent = sourceLabels[source.toLowerCase()] || source;

 const time = item.inference_time_ms || item.total_inference_time_ms || item.inference_time || item.time || 0;
 modalInference.textContent = time.toFixed(1) + ' ms';

 // Create or locate modalVideo and modalSmokeBurstStrip
 let modalVideo = $('#modalVideo');
 if (!modalVideo) {
 modalVideo = document.createElement('video');
 modalVideo.id = 'modalVideo';
 modalVideo.style.width = '100%';
 modalVideo.style.borderRadius = 'var(--radius-md)';
 modalVideo.style.display = 'none';
 modalVideo.controls = true;
 modalImage.after(modalVideo);
 }

 let burstStrip = $('#modalSmokeBurstStrip');
 if (!burstStrip) {
 burstStrip = document.createElement('div');
 burstStrip.id = 'modalSmokeBurstStrip';
 burstStrip.style.display = 'flex';
 burstStrip.style.gap = '8px';
 burstStrip.style.marginTop = '10px';
 $('#modalImageTabs').after(burstStrip);
 }

 // Dynamic Swapping based on type
 const isVideo = item.alert_type === 'fire_segment' || item.type === 'video' || item.video_clip;
 
 if (isVideo) {
 modalImage.style.display = 'none';
 $('#modalImageTabs').style.display = 'none';
 burstStrip.style.display = 'none';
 
 modalVideo.src = item.video_clip || item.annotated_path;
 modalVideo.style.display = 'block';
 modalVideo.load();
 modalVideo.play().catch(() => {});
 } else {
 modalVideo.style.display = 'none';
 modalVideo.src = '';
 
 modalImage.style.display = 'block';
 $('#modalImageTabs').style.display = 'flex';
 
 activeImageIndex = 0;
 currentImageMode = 'annotated';
 
 if (item.alert_type === 'smoke_burst' && item.images && item.images.length > 0) {
 burstStrip.style.display = 'flex';
 burstStrip.innerHTML = item.images.map((img, idx) => `
 <div class="smoke-burst-thumb" onclick="setActiveImageIndex(${idx})" style="flex:1;cursor:pointer;border-radius:4px;overflow:hidden;border:2px solid ${idx===0 ? 'var(--accent-orange)' : 'rgba(255,255,255,0.1)'};background:#000;transition:transform 0.1s;">
 <img src="${img}" style="width:100%;height:45px;object-fit:cover;">
 </div>
 `).join('');
 } else {
 burstStrip.style.display = 'none';
 burstStrip.innerHTML = '';
 }
 
 updateModalImage();
 }

 // Detections
 const detections = item.detections || [];
 if (detections.length === 0) {
 modalDetections.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">未检测到目标</p>';
 } else {
 modalDetections.innerHTML = detections.map(d => {
 const cls = d.class || d.name || 'unknown';
 const conf = ((d.confidence || d.conf || 0) * 100).toFixed(1);
 const bbox = d.bbox || d.box || [];
 const bboxStr = bbox.length >= 4 ? `[${bbox.map(v => Math.round(v)).join(', ')}]` : '';
 const levelLabel = d.alert_level === 'suspected' ? ' <span style="color:var(--accent-orange);font-size:0.7rem;">(疑似)</span>' : '';
 return `
 <div class="detection-item">
 <span class="badge ${Utils.classBadge(cls)}">${Utils.classLabel(cls)}</span>
 <span class="det-bbox">${bboxStr}</span>
 <span class="det-conf">${conf}%${levelLabel}</span>
 </div>`;
 }).join('');
 }

 // Image tab buttons
 btnShowAnnotated.className = 'btn btn-sm btn-primary active';
 btnShowOriginal.className = 'btn btn-sm btn-ghost';

 historyModal.classList.add('active');
 };

 function closeModal() {
 historyModal.classList.remove('active');
 currentModalItem = null;
 const modalVideo = $('#modalVideo');
 if (modalVideo) {
 modalVideo.pause();
 modalVideo.src = '';
 }
 }

 window.openFullImage = function () {
 if (!currentModalItem) return;
 const lightbox = document.getElementById('lightbox');
 const lightboxImg = document.getElementById('lightboxImg');
 lightboxImg.src = modalImage.src;
 lightbox.classList.add('active');
 };

 /* ---------- Event Listeners ---------- */
 function setupEventListeners() {
 btnRefresh.addEventListener('click', loadHistory);

 filterType.addEventListener('change', renderGrid);
 
 const filterScored = $('#filterScored');
 if (filterScored) {
 filterScored.addEventListener('change', renderGrid);
 }
 
 sortOrder.addEventListener('change', renderGrid);

 // Close modal
 btnCloseModal.addEventListener('click', closeModal);
 historyModal.addEventListener('click', (e) => {
 if (e.target === historyModal) closeModal();
 });

 // Image tab switching
 btnShowAnnotated.addEventListener('click', () => {
 currentImageMode = 'annotated';
 updateModalImage();
 });

 btnShowOriginal.addEventListener('click', () => {
 currentImageMode = 'original';
 updateModalImage();
 });

 // Delete single
 btnDeleteRecord.addEventListener('click', async () => {
 if (!currentModalItem) return;
 showConfirm('删除记录', '确定要删除这条检测记录吗？', async () => {
 try {
 await API.deleteHistory(currentModalItem.id);
 Toast.success('记录已删除');
 closeModal();
 await loadHistory();
 } catch (err) {
 Toast.error('删除失败: ' + err.message);
 }
 });
 });

 // Clear all
 btnClearAll.addEventListener('click', () => {
 showConfirm('清空全部', '确定要清空所有历史记录吗？此操作无法撤销。', async () => {
 try {
 await API.clearHistory();
 Toast.success('所有记录已清空');
 await loadHistory();
 } catch (err) {
 Toast.error('清空失败: ' + err.message);
 }
 });
 });

 // Clear unarchived
 btnClearUnarchivedHistory.addEventListener('click', () => {
 showConfirm('清除未归档记录', '确定要清空所有未归档的历史记录吗？此操作物理删除这批记录、对应的打分及未归档素材图片，且无法撤销。', async () => {
 try {
 const res = await API.clearUnarchivedHistory();
 if (res.success) {
 Toast.success(res.message);
 await loadHistory();
 } else {
 throw new Error(res.message || '清除失败');
 }
 } catch (err) {
 Toast.error('清除失败: ' + err.message);
 }
 });
 });

 // Confirm dialog
 btnConfirmCancel.addEventListener('click', () => {
 confirmDialog.classList.remove('active');
 confirmCallback = null;
 });

 btnConfirmOk.addEventListener('click', async () => {
 confirmDialog.classList.remove('active');
 if (confirmCallback) {
 await confirmCallback();
 confirmCallback = null;
 }
 });

 confirmDialog.addEventListener('click', (e) => {
 if (e.target === confirmDialog) {
 confirmDialog.classList.remove('active');
 confirmCallback = null;
 }
 });

 // Lightbox
 const lightbox = document.getElementById('lightbox');
 lightbox.addEventListener('click', (e) => {
 if (e.target === lightbox) lightbox.classList.remove('active');
 });

 // ESC
 document.addEventListener('keydown', (e) => {
 if (e.key === 'Escape') {
 closeModal();
 confirmDialog.classList.remove('active');
 lightbox.classList.remove('active');
 }
 });
 }

 /* ---------- Confirm Dialog ---------- */
 function showConfirm(title, message, callback) {
 document.getElementById('confirmTitle').textContent = title;
 document.getElementById('confirmMessage').textContent = message;
 confirmCallback = callback;
 confirmDialog.classList.add('active');
 }

 /* ---------- Start ---------- */
 document.addEventListener('DOMContentLoaded', init);
})();
