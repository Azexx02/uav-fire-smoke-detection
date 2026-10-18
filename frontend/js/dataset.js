/* ============================================
 林焰智巡 — Dataset Management Logic
 ============================================ */

(function () {
 'use strict';

 /* ---------- State ---------- */
 let unarchivedNegative = [];
 let unarchivedReinforce = [];
 let archivedBatches = [];

 /* ---------- DOM ---------- */
 const $ = (sel) => document.querySelector(sel);

 // Left Column (Unarchived)
 const unarchivedCountBadge = $('#unarchivedCountBadge');
 const negCountEl = $('#negCount');
 const reinfCountEl = $('#reinfCount');
 const unarchivedGrid = $('#unarchivedGrid');
 const unarchivedEmpty = $('#unarchivedEmpty');

 // Right Column (Archived)
 const archivedCountBadge = $('#archivedCountBadge');
 const archivedList = $('#archivedList');
 const archivedEmpty = $('#archivedEmpty');

 // Action Buttons
 const btnArchiveDataset = $('#btnArchiveDataset');
 const btnClearUnarchived = $('#btnClearUnarchived');

 // Confirm Dialog
 const confirmDialog = $('#confirmDialog');
 const btnConfirmCancel = $('#btnConfirmCancel');
 const btnConfirmOk = $('#btnConfirmOk');
 const confirmTitle = $('#confirmTitle');
 const confirmMessage = $('#confirmMessage');
 let confirmCallback = null;

 // System
 const statusDot = $('#statusDot');
 const statusText = $('#statusText');

 /* ---------- Init ---------- */
 async function init() {
 setupEventListeners();
 await loadData();
 checkHealth();
 setInterval(checkHealth, 15000);
 }

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

 /* ---------- Load Data ---------- */
 async function loadData() {
 try {
 const res = await API.getDatasetStatus();
 if (res && res.success) {
 unarchivedNegative = res.unarchived.negative || [];
 unarchivedReinforce = res.unarchived.reinforce || [];
 archivedBatches = res.archived || [];
 } else {
 throw new Error(res.message || '获取素材库状态失败');
 }
 } catch (err) {
 Toast.error('获取数据集状态失败: ' + err.message);
 unarchivedNegative = [];
 unarchivedReinforce = [];
 archivedBatches = [];
 }

 renderUnarchived();
 renderArchived();
 }

 /* ---------- Render Unarchived ---------- */
 function renderUnarchived() {
 const totalCount = unarchivedNegative.length + unarchivedReinforce.length;
 unarchivedCountBadge.textContent = `${totalCount} 个文件`;
 Utils.animateNumber(negCountEl, unarchivedNegative.length, 300);
 Utils.animateNumber(reinfCountEl, unarchivedReinforce.length, 300);

 if (totalCount === 0) {
 unarchivedGrid.innerHTML = '';
 unarchivedGrid.classList.add('hidden');
 unarchivedEmpty.classList.remove('hidden');
 return;
 }

 unarchivedEmpty.classList.add('hidden');
 unarchivedGrid.classList.remove('hidden');

 const negHTML = unarchivedNegative.map(file => renderUnarchivedCard(file, 'negative')).join('');
 const reinfHTML = unarchivedReinforce.map(file => renderUnarchivedCard(file, 'reinforce')).join('');

 unarchivedGrid.innerHTML = negHTML + reinfHTML;
 }

 function renderUnarchivedCard(file, type) {
 const typeLabel = type === 'negative' ? '误报负样本' : '漏报强化样本';
 const badgeClass = type === 'negative' ? 'badge-fire' : 'badge-smoke'; // Fire is red/danger, Smoke is orange/warning
 const isVideo = /\.(mp4|avi|mov|mkv|wmv|flv)$/i.test(file.name || file.url || '');
 const preview = isVideo
 ? `<video src="${file.url}" style="width: 100%; height: 80px; object-fit: cover; border-radius: 4px; background: #000;" muted playsinline></video>`
 : `<img src="${file.url}" style="width: 100%; height: 80px; object-fit: cover; border-radius: 4px; background: #000;" alt="${file.name}">`;

 return `
 <div class="card-flat relative flex flex-column justify-between animate-scale-in" style="padding: 6px; border: 1px solid rgba(255,255,255,0.05); background: rgba(255,255,255,0.01); border-radius: var(--radius-md); overflow: hidden; cursor: zoom-in;" onclick="openLightbox('${file.url}')">
 ${preview}
 <div style="margin-top: 6px; text-align: left;">
 <div style="font-size: 0.7rem; color: var(--text-muted); text-overflow: ellipsis; white-space: nowrap; overflow: hidden;" title="${file.name}">${file.name}
 </div>
 <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px;">
 <span class="badge ${badgeClass}" style="font-size: 0.65rem; padding: 1px 4px;">${typeLabel}</span>
 <span style="font-size: 0.65rem; color: var(--text-muted);">${file.size_kb} KB</span>
 </div>
 </div>
 </div>
 `;
 }

 /* ---------- Render Archived ---------- */
 function renderArchived() {
 archivedCountBadge.textContent = `${archivedBatches.length} 个批次`;

 if (archivedBatches.length === 0) {
 archivedList.innerHTML = '';
 archivedList.classList.add('hidden');
 archivedEmpty.classList.remove('hidden');
 return;
 }

 archivedEmpty.classList.add('hidden');
 archivedList.classList.remove('hidden');

 archivedList.innerHTML = archivedBatches.map(batch => {
 // Collect preview thumbs
 const previewFiles = [...(batch.negative_files || []), ...(batch.reinforce_files || [])].slice(0, 5);
 const thumbsHTML = previewFiles.length > 0
 ? `<div class="archive-thumbs-row">
 ${previewFiles.map(f => `<img src="${f.url}" class="archive-thumb" onclick="event.stopPropagation(); openLightbox('${f.url}')">`).join('')}
 ${(batch.negative_count + batch.reinforce_count) > 5 ? `<div class="archive-more-count">+${(batch.negative_count + batch.reinforce_count) - 5}</div>` : ''}
 </div>`
 : `<p style="font-size: 0.75rem; color: var(--text-muted); margin: 6px 0 0 0;">无细节样本图 (仅归档日常基础历史记录)</p>`;

 return `
 <div class="archive-item-card" id="card-${batch.batch_id}">
 <div class="archive-item-header" onclick="window.toggleArchiveBody('${batch.batch_id}')">
 <div class="archive-item-main">
 <div class="archive-batch-title">归档数据集批次 (${batch.timestamp})</div>
 <div class="archive-batch-meta">
 负样本: <span style="color:var(--danger-red); font-weight:600;">${batch.negative_count}</span> | 
 强化样本: <span style="color:var(--accent-orange); font-weight:600;">${batch.reinforce_count}</span> | 
 日常基础素材: <span style="color:var(--success-green); font-weight:600;">${batch.history_count}</span>
 </div>
 </div>
 <span id="arrow-${batch.batch_id}" class="archive-toggle">展开</span>
 </div>
 <div class="archive-item-body hidden" id="body-${batch.batch_id}">
 <div style="text-align: left;">
 <span class="archive-preview-label">归档图片预览:</span>${thumbsHTML}
 </div>
 <div class="archive-action-row">
 <span class="archive-name">归档名称: ${batch.batch_id}</span>
 <div class="archive-actions">
 <button class="btn btn-danger btn-sm" onclick="event.stopPropagation(); deleteArchivedBatch('${batch.batch_id}')" style="padding: 6px 14px; font-size:0.75rem; display:flex; align-items:center; gap:4px;">删除批次
 </button>
 <a href="${batch.zip_url}" class="btn btn-success btn-sm" style="padding: 6px 14px; font-size:0.75rem; display:flex; align-items:center; gap:4px;">
 下载 ZIP 归档素材
 </a>
 </div>
 </div>
 </div>
 </div>
 `;
 }).join('');
 }

 /* ---------- Expand / Collapse Accordion ---------- */
 window.toggleArchiveBody = function(batchId) {
 const body = document.getElementById(`body-${batchId}`);
 const arrow = document.getElementById(`arrow-${batchId}`);
 const card = document.getElementById(`card-${batchId}`);
 
 if (body && arrow) {
 const isHidden = body.classList.toggle('hidden');
 arrow.textContent = isHidden ? '展开' : '收起';
 arrow.style.background = isHidden ? 'rgba(255,255,255,0.03)' : 'rgba(34, 197, 94, 0.15)';
 arrow.style.color = isHidden ? 'var(--text-muted)' : 'var(--success-green)';
 
 if (card) {
 card.style.border = isHidden ? '1px solid rgba(255,255,255,0.05)' : '1px solid rgba(34, 197, 94, 0.3)';
 card.style.boxShadow = isHidden ? '' : '0 8px 32px rgba(34, 197, 94, 0.05)';
 card.style.height = isHidden ? '' : `${card.scrollHeight}px`;
 card.style.overflow = isHidden ? 'hidden' : 'visible';
 }
 }
 };

 /* ---------- Lightbox ---------- */
 window.openLightbox = function (imgSrc) {
 const lightbox = document.getElementById('lightbox');
 const lightboxImg = document.getElementById('lightboxImg');
 lightboxImg.src = imgSrc;
 lightbox.classList.add('active');
 };

 /* ---------- Event Listeners ---------- */
 function setupEventListeners() {
 // Lightbox close
 const lightbox = document.getElementById('lightbox');
 lightbox.addEventListener('click', (e) => {
 if (e.target === lightbox) lightbox.classList.remove('active');
 });

 document.addEventListener('keydown', (e) => {
 if (e.key === 'Escape') lightbox.classList.remove('active');
 });

 // Archive Action
 btnArchiveDataset.addEventListener('click', async () => {
 const totalUnarchived = unarchivedNegative.length + unarchivedReinforce.length;
 if (totalUnarchived === 0) {
 Toast.warning('当前无待归档素材！请先去专家评审页面对错误数据进行分类。');
 return;
 }

 const oldText = btnArchiveDataset.innerHTML;
 btnArchiveDataset.disabled = true;
 btnArchiveDataset.innerHTML = '正在打包归档中…';
 Toast.info('正在剪切未归档样本并打包为 ZIP，请稍候…');

 try {
 const res = await API.archiveDataset();
 if (res.success) {
 Toast.success(res.message);
 
 // Programmatically trigger download of the new ZIP
 if (res.download_url) {
 const a = document.createElement('a');
 a.href = res.download_url;
 a.download = res.download_url.split('/').pop();
 document.body.appendChild(a);
 a.click();
 document.body.removeChild(a);
 }
 
 // Reload
 await loadData();
 } else {
 throw new Error(res.message || '归档打包失败');
 }
 } catch (err) {
 Toast.error('归档打包素材失败: ' + err.message);
 } finally {
 btnArchiveDataset.disabled = false;
 btnArchiveDataset.innerHTML = oldText;
 }
 });

 // Confirm Dialog OK
 btnConfirmOk.addEventListener('click', async () => {
 confirmDialog.classList.remove('active');
 if (confirmCallback) {
 await confirmCallback();
 confirmCallback = null;
 }
 });

 // Confirm Dialog Cancel
 btnConfirmCancel.addEventListener('click', () => {
 confirmDialog.classList.remove('active');
 confirmCallback = null;
 });

 // Clear Unarchived Action
 btnClearUnarchived.addEventListener('click', () => {
 const totalUnarchived = unarchivedNegative.length + unarchivedReinforce.length;
 if (totalUnarchived === 0) {
 Toast.warning('当前无待清除的未归档素材！');
 return;
 }

 showConfirm(
 '清除未归档素材',
 '确定要清除这批未归档的素材图片吗？此操作将从物理磁盘中删除这些文件，且关联的错误评分会回滚为“未评分”状态。',
 async () => {
 try {
 const res = await API.clearUnarchivedDataset();
 if (res.success) {
 Toast.success(res.message);
 await loadData();
 } else {
 throw new Error(res.message || '清除失败');
 }
 } catch (err) {
 Toast.error('清除未归档素材失败: ' + err.message);
 }
 }
 );
 });
 }

 function showConfirm(title, msg, onOk) {
 confirmTitle.textContent = title;
 confirmMessage.textContent = msg;
 confirmCallback = onOk;
 confirmDialog.classList.add('active');
 }

 // Global delete archived batch
 window.deleteArchivedBatch = function (batchId) {
 showConfirm(
 '删除归档批次',
 `确定要删除归档批次 "${batchId}" 吗？此操作将彻底物理删除该数据集文件夹、ZIP 压缩文件，并级联物理删除关联的历史检测记录。`,
 async () => {
 try {
 const res = await API.deleteArchivedBatch(batchId);
 if (res.success) {
 Toast.success(res.message);
 await loadData();
 } else {
 throw new Error(res.message || '删除失败');
 }
 } catch (err) {
 Toast.error('删除归档批次失败: ' + err.message);
 }
 }
 );
 };

 /* ---------- Start ---------- */
 document.addEventListener('DOMContentLoaded', init);
})();
