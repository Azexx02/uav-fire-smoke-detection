/* ============================================
 林焰智巡 — Centralized API Module
 ============================================ */

const API = {
 baseURL: '',

 /**
 * Helper: build full URL
 */
 _url(path) {
 return this.baseURL + path;
 },

 /**
 * Helper: generic fetch with error handling
 */
 async _request(path, options = {}) {
 try {
 const res = await fetch(this._url(path), options);
 if (!res.ok) {
 let errorMsg = `HTTP ${res.status}`;
 try {
 const errData = await res.json();
 errorMsg = errData.detail || errData.message || errorMsg;
 } catch (_) {}
 throw new Error(errorMsg);
 }
 const contentType = res.headers.get('content-type') || '';
 if (contentType.includes('application/json')) {
 return await res.json();
 }
 return await res.text();
 } catch (err) {
 if (err.name === 'TypeError' && err.message === 'Failed to fetch') {
 throw new Error('无法连接到服务器，请检查后端是否已启动');
 }
 throw err;
 }
 },

 /**
 * Helper: upload file(s) via FormData
 */
 async _upload(path, formData) {
 try {
 const res = await fetch(this._url(path), {
 method: 'POST',
 body: formData,
 });
 if (!res.ok) {
 let errorMsg = `HTTP ${res.status}`;
 try {
 const errData = await res.json();
 errorMsg = errData.detail || errData.message || errorMsg;
 } catch (_) {}
 throw new Error(errorMsg);
 }
 return await res.json();
 } catch (err) {
 if (err.name === 'TypeError' && err.message === 'Failed to fetch') {
 throw new Error('无法连接到服务器，请检查后端是否已启动');
 }
 throw err;
 }
 },

 /* ========== Detection ========== */

 /**
 * Detect objects in an image file
 * @param {File} file - Image file
 * @param {number} conf - Confidence threshold (0-1)
 * @param {boolean} saveHistory - Whether to save to history
 * @returns {Promise<Object>} Detection results
 */
 async detectImage(file, conf = 0.25, saveHistory = true) {
 const formData = new FormData();
 formData.append('file', file);
 formData.append('conf', conf.toString());
 formData.append('save_history', saveHistory.toString());
 return this._upload('/api/detect/image', formData);
 },

 /**
 * Detect objects in a video file
 * @param {File} file - Video file
 * @param {number} conf - Confidence threshold (0-1)
 * @param {number} frameInterval - Process every N-th frame
 * @returns {Promise<Object>} Detection results
 */
 async detectVideo(file, conf = 0.25, frameInterval = 1) {
 const formData = new FormData();
 formData.append('file', file);
 formData.append('conf', conf.toString());
 formData.append('frame_interval', frameInterval.toString());
 return this._upload('/api/detect/video', formData);
 },

 /* ========== Camera ========== */

 /**
 * Get the MJPEG camera stream URL
 * @param {string} [cameraId] - Camera ID ('downward' or 'forward')
 * @returns {string} Stream URL
 */
 getCameraStreamURL(cameraId = 'downward') {
 return this._url(`/api/camera/stream?camera_id=${cameraId}`);
 },

 /**
 * Capture a single frame from camera and run detection
 * @returns {Promise<Object>} Detection result
 */
 async captureFrame() {
 return this._request('/api/camera/capture', { method: 'POST' });
 },

 /**
 * Get camera connection status
 * @param {string} [cameraId] - Camera ID ('downward' or 'forward')
 * @returns {Promise<Object>} Camera status info
 */
 async getCameraStatus(cameraId = 'downward') {
 return this._request(`/api/camera/status?camera_id=${cameraId}`);
 },

 /**
 * Reconnect camera hardware on the backend
 * @param {string} [cameraId] - Camera ID ('downward' or 'forward')
 * @returns {Promise<Object>} Reconnect result and camera status info
 */
 async reconnectCamera(cameraId = 'downward') {
 return this._request(`/api/camera/reconnect?camera_id=${cameraId}`, { method: 'POST' });
 },

 /**
 * Enable camera YOLO real-time detection
 * @param {string} [cameraId] - Camera ID ('downward' or 'forward')
 * @returns {Promise<Object>} Result info
 */
 async enableCameraDetect(cameraId = 'downward') {
 return this._request(`/api/camera/detect/enable?camera_id=${cameraId}`, { method: 'POST' });
 },

 /**
 * Disable camera YOLO real-time detection
 * @param {string} [cameraId] - Camera ID ('downward' or 'forward')
 * @returns {Promise<Object>} Result info
 */
 async disableCameraDetect(cameraId = 'downward') {
 return this._request(`/api/camera/detect/disable?camera_id=${cameraId}`, { method: 'POST' });
 },

 /**
 * Get camera integration settings
 * @returns {Promise<Object>} Settings info
 */
 async getCameraSettings() {
 return this._request('/api/camera/settings');
 },

 /**
 * Update camera integration settings
 * @param {Object} settings - Settings object
 * @returns {Promise<Object>} Result info
 */
 async updateCameraSettings(settings) {
 return this._request('/api/camera/settings', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify(settings),
 });
 },

 /* ========== Demo Mode ========== */

 /**
 * Start camera demo mode
 * @returns {Promise<Object>} Result info
 */
 async startDemo() {
 return this._request('/api/camera/demo/start', { method: 'POST' });
 },

 /**
 * Stop camera demo mode
 * @returns {Promise<Object>} Result info
 */
 async stopDemo() {
 return this._request('/api/camera/demo/stop', { method: 'POST' });
 },

 /**
 * Get camera demo status
 * @returns {Promise<Object>} Demo status info
 */
 async getDemoStatus() {
 return this._request('/api/camera/demo/status');
 },

 /**
 * Reset camera demo status (and clear history records of type demo)
 * @returns {Promise<Object>} Result info
 */
 async resetDemo() {
 return this._request('/api/camera/demo/reset', { method: 'POST' });
 },

 /**
 * Manually capture one demo frame. This is saved as alert_type=demo even when no detections exist.
 * @param {string} [cameraId] - Camera ID ('downward' or 'forward')
 * @returns {Promise<Object>} Capture result
 */
 async captureDemoFrame(cameraId = 'downward') {
 return this._request(`/api/camera/demo/capture?camera_id=${cameraId}`, { method: 'POST' });
 },

 /* ========== History ========== */

 /**
 * Get all history records
 * @returns {Promise<Array>} List of history items
 */
 async getHistory() {
 return this._request('/api/history');
 },

 /**
 * Get a single history record by ID
 * @param {string} id - History item ID
 * @returns {Promise<Object>} History item
 */
 async getHistoryById(id) {
 return this._request(`/api/history/${id}`);
 },

 /**
 * Delete a single history record
 * @param {string} id - History item ID
 * @returns {Promise<Object>} Result
 */
 async deleteHistory(id) {
 return this._request(`/api/history/${id}`, { method: 'DELETE' });
 },

 /**
 * Clear all history records
 * @returns {Promise<Object>} Result
 */
 async clearHistory() {
 return this._request('/api/history/clear/all', { method: 'DELETE' });
 },

 /**
 * Get unarchived and archived dataset status lists
 * @returns {Promise<Object>} Lists of unarchived/archived materials
 */
 async getDatasetStatus() {
 return this._request('/api/history/dataset/status');
 },

 /**
 * Move unarchived materials to a new zip archive and timestamped folder
 * @returns {Promise<Object>} Archival and download information
 */
 async archiveDataset() {
 return this._request('/api/history/dataset/archive', { method: 'POST' });
 },

 /**
 * Clear all unarchived dataset images
 * @returns {Promise<Object>} Result
 */
 async clearUnarchivedDataset() {
 return this._request('/api/history/dataset/unarchived/clear', { method: 'DELETE' });
 },

 /**
 * Clear all unarchived history records
 * @returns {Promise<Object>} Result
 */
 async clearUnarchivedHistory() {
 return this._request('/api/history/unarchived/clear', { method: 'DELETE' });
 },

 /**
 * Delete a specific archived batch
 * @param {string} batchId - Batch ID to delete
 * @returns {Promise<Object>} Result
 */
 async deleteArchivedBatch(batchId) {
 return this._request(`/api/history/dataset/archives/${batchId}`, { method: 'DELETE' });
 },

 /* ========== Scoring ========== */

 /**
 * Score a history item (correct / incorrect)
 * @param {string} historyId - History item ID
 * @param {boolean} correct - Whether the detection was correct
 * @returns {Promise<Object>} Updated scoring result
 */
 async scoreImage(historyId, correct, hasFireSmoke = null, imageDecisions = null) {
 const payload = { correct };
 if (imageDecisions !== null) {
 payload.image_decisions = imageDecisions;
 } else if (hasFireSmoke !== null) {
 payload.has_fire_smoke = hasFireSmoke;
 }
 return this._request(`/api/scoring/${historyId}`, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify(payload),
 });
 },

 /**
 * Get scoring summary
 * @returns {Promise<Object>} Summary with total score, counts, etc.
 */
 async getScoringSummary() {
 return this._request('/api/scoring/summary');
 },

 /**
 * Reset all scoring data
 * @returns {Promise<Object>} Result
 */
 async resetScoring() {
 return this._request('/api/scoring/reset', { method: 'POST' });
 },

 /**
 * Commit all active scoring data to a batch
 * @returns {Promise<Object>} Result
 */
 async commitScoring() {
 return this._request('/api/scoring/commit', { method: 'POST' });
 },

 /* ========== Reports ========== */

 /**
 * Get training report data (metrics, curves)
 * @returns {Promise<Object>} Training report
 */
 async getTrainingReport() {
 return this._request('/api/report/training');
 },

 /**
 * Get model information
 * @returns {Promise<Object>} Model info
 */
 async getModelInfo() {
 return this._request('/api/report/model');
 },

 /* ========== System ========== */

 /**
 * Health check
 * @returns {Promise<Object>} Health status
 */
 async healthCheck() {
 return this._request('/api/health');
 },
};

/* ========== Toast Notification Utility ========== */

const Toast = {
 container: null,

 _ensureContainer() {
 if (!this.container) {
 this.container = document.createElement('div');
 this.container.className = 'toast-container';
 document.body.appendChild(this.container);
 }
 },

 show(message, type = 'info', duration = 3500) {
 this._ensureContainer();

 const icons = {
 success: '',
 error: '',
 warning: '',
 info: 'ℹ',
 };

 const toast = document.createElement('div');
 toast.className = `toast toast-${type}`;
 toast.innerHTML = `
 <span class="toast-icon">${icons[type] || icons.info}</span><span>${message}</span>
 `;

 this.container.appendChild(toast);

 setTimeout(() => {
 toast.classList.add('toast-exit');
 setTimeout(() => toast.remove(), 300);
 }, duration);
 },

 success(msg) { this.show(msg, 'success'); },
 error(msg) { this.show(msg, 'error', 5000); },
 warning(msg) { this.show(msg, 'warning'); },
 info(msg) { this.show(msg, 'info'); },
};

/* ========== Utility Functions ========== */

const Utils = {
 /**
 * Format a timestamp string to readable Chinese date
 */
 formatTime(ts) {
 if (!ts) return '未知时间';
 const d = new Date(ts);
 if (isNaN(d.getTime())) return ts;
 const pad = n => String(n).padStart(2, '0');
 return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
 },

 /**
 * Format short time (no date)
 */
 formatShortTime(ts) {
 if (!ts) return '';
 const d = new Date(ts);
 if (isNaN(d.getTime())) return ts;
 const pad = n => String(n).padStart(2, '0');
 return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
 },

 /**
 * Debounce function
 */
 debounce(fn, delay = 300) {
 let timer;
 return (...args) => {
 clearTimeout(timer);
 timer = setTimeout(() => fn(...args), delay);
 };
 },

 /**
 * Get detection class display name
 */
 classLabel(cls) {
 const map = { fire: '火焰', smoke: '烟雾', Fire: '火焰', Smoke: '烟雾' };
 return map[cls] || cls;
 },

 /**
 * Get badge class for detection type
 */
 classBadge(cls) {
 const lower = (cls || '').toLowerCase();
 if (lower.includes('fire')) return 'badge-fire';
 if (lower.includes('smoke')) return 'badge-smoke';
 return 'badge-info';
 },

 /**
 * Count detections by class
 */
 countByClass(detections) {
 const counts = { fire: 0, smoke: 0 };
 (detections || []).forEach(d => {
 const cls = (d.class || d.name || '').toLowerCase();
 if (cls.includes('fire')) counts.fire++;
 else if (cls.includes('smoke')) counts.smoke++;
 });
 return counts;
 },

 /**
 * Animate a number from 0 to target
 */
 animateNumber(el, target, duration = 600, decimals = 0) {
 const start = parseFloat(el.textContent) || 0;
 const startTime = performance.now();

 function update(now) {
 const elapsed = now - startTime;
 const progress = Math.min(elapsed / duration, 1);
 const eased = 1 - Math.pow(1 - progress, 3);
 const current = start + (target - start) * eased;
 el.textContent = current.toFixed(decimals);
 if (progress < 1) requestAnimationFrame(update);
 }

 requestAnimationFrame(update);
 },

 /**
 * Get image URL from history item
 */
 getImageURL(item) {
 if (!item) return '';
 // Check all possible fields including annotated_path, images, thumbnail_path
 if (item.annotated_path) return item.annotated_path;
 if (item.annotated_image) return item.annotated_image;
 if (item.result_image) return item.result_image;
 if (item.image_path) return item.image_path;
 if (item.thumbnail_path) return item.thumbnail_path;
 if (item.images && item.images.length > 0) return item.images[0];
 if (item.original_path) return item.original_path;
 if (item.original_image) return item.original_image;
 return '';
 },

 /**
 * Get original image URL from history item
 */
 getOriginalImageURL(item) {
 if (!item) return '';
 if (item.original_path) return item.original_path;
 if (item.original_image) return item.original_image;
 if (item.image_path) return item.image_path;
 return '';
 },
};
