/* ============================================
 林焰智巡 — Dedicated Demo Mode (demo.html) Logic
 ============================================ */

(function () {
 'use strict';

 /* ---------- State ---------- */
 let cameraActive = false;
 let streamReady = false;
 let demoPollTimer = null;
 let activeCameraId = 'downward';
 const STREAM_REFRESH_INTERVAL_MS = 60000;
 let streamRefreshTimer = null;

 /* ---------- DOM Elements ---------- */
 const $ = (sel) => document.querySelector(sel);

 // Camera
 const cameraStream = $('#cameraStream');
 const cameraPlaceholder = $('#cameraPlaceholder');
 const btnToggleCamera = $('#btnToggleCamera');
 const btnCheckCamera = $('#btnCheckCamera');
 const btnForceReconnect = $('#btnForceReconnect');
 const cameraSelect = $('#cameraSelect');
 const cameraConnCard = $('#cameraConnCard');
 const cameraConnSub = $('#cameraConnSub');

 // Demo Controls
 const btnStartDemo = $('#btnStartDemo');
 const btnStopDemo = $('#btnStopDemo');
 const btnResetDemo = $('#btnResetDemo');
 const btnManualDemoCapture = $('#btnManualDemoCapture');
 const demoProgressVal = $('#demoProgressVal');
 const demoProgressFill = $('#demoProgressFill');
 const demoTimerVal = $('#demoTimerVal');
 const demoScoreVal = $('#demoScoreVal');
 const demoCompleteAlert = $('#demoCompleteAlert');

 // Lightbox
 const lightbox = $('#lightbox');
 const lightboxImg = $('#lightboxImg');

 // System status
 const statusDot = $('#statusDot');
 const statusText = $('#statusText');

 /* ---------- Init ---------- */
 async function init() {
 setupEventListeners();
 await checkCameraAvailability();
 await loadDemoStatus();
 checkHealth();
 setInterval(checkHealth, 15000);
 }

 async function checkHealth() {
 try {
 await API.healthCheck();
 if (statusDot) statusDot.className = 'status-dot';
 if (statusText) statusText.textContent = '系统在线';
 } catch {
 if (statusDot) statusDot.className = 'status-dot offline';
 if (statusText) statusText.textContent = '连接失败';
 }
 }

 /* ---------- Camera Functions ---------- */
 function refreshCameraStream() {
 if (!cameraStream || !cameraActive) return;
 const streamUrl = API.getCameraStreamURL(activeCameraId);
 cameraStream.src = streamUrl + (streamUrl.includes('?') ? '&' : '?') + 't=' + Date.now();
 }

 function startStreamRefresh() {
 stopStreamRefresh();
 streamRefreshTimer = setInterval(refreshCameraStream, STREAM_REFRESH_INTERVAL_MS);
 }

 function stopStreamRefresh() {
 if (streamRefreshTimer) {
 clearInterval(streamRefreshTimer);
 streamRefreshTimer = null;
 }
 }

 async function checkCameraAvailability() {
 try {
 if (btnCheckCamera) btnCheckCamera.disabled = true;
 if (cameraConnSub) cameraConnSub.textContent = '正在检测硬件状态...';
 
 const res = await API.getCameraStatus(activeCameraId);
 if (res && res.available) {
 streamReady = true;
 const resStr = res.resolution ? ` (${res.resolution.width}×${res.resolution.height})` : '';
 if (cameraConnSub) cameraConnSub.textContent = `摄像头已就绪${resStr}`;
 if (cameraConnCard) cameraConnCard.classList.add('connected');
 if (btnCheckCamera) btnCheckCamera.innerHTML = '重新检测';
 } else {
 handleConnectError();
 }
 } catch (err) {
 console.warn("Camera check failed:", err);
 handleConnectError();
 } finally {
 if (btnCheckCamera) btnCheckCamera.disabled = false;
 }

 function handleConnectError() {
 streamReady = false;
 if (cameraConnSub) cameraConnSub.textContent = '摄像头未连接或硬件离线';
 if (cameraConnCard) cameraConnCard.classList.remove('connected');
 if (btnCheckCamera) btnCheckCamera.innerHTML = '连接并检测';
 if (cameraActive) {
 stopCamera();
 }
 }
 }

 async function toggleCamera() {
 if (cameraActive) {
 await stopCamera();
 } else {
 await startCamera();
 }
 }

 async function startCamera() {
 if (!streamReady) {
 Toast.error('摄像头未就绪，请先检查连接状态');
 return;
 }
 
 if (btnToggleCamera) {
 btnToggleCamera.innerHTML = '开启中...';
 btnToggleCamera.disabled = true;
 }

 try {
 // 联动开启后端 YOLO 检测以确保演示捕获逻辑正常运行
 await API.enableCameraDetect(activeCameraId);
 cameraActive = true;
 if (cameraStream) {
 refreshCameraStream();
 cameraStream.style.display = 'block';
 }
 if (cameraPlaceholder) cameraPlaceholder.classList.add('hidden');
 
 startStreamRefresh();
 if (btnToggleCamera) {
 btnToggleCamera.innerHTML = '关闭巡检监控';
 btnToggleCamera.classList.remove('btn-primary');
 btnToggleCamera.classList.add('btn-ghost');
 }
 } catch (err) {
 Toast.error('开启摄像头流失败: ' + err.message);
 cameraActive = false;
 stopStreamRefresh();
 if (cameraStream) {
 cameraStream.src = '';
 cameraStream.style.display = 'none';
 }
 if (cameraPlaceholder) cameraPlaceholder.classList.remove('hidden');
 } finally {
 if (btnToggleCamera) btnToggleCamera.disabled = false;
 }
 }

 async function stopCamera() {
 if (btnToggleCamera) {
 btnToggleCamera.innerHTML = '关闭中...';
 btnToggleCamera.disabled = true;
 }

 stopStreamRefresh();
 try {
 await API.disableCameraDetect(activeCameraId);
 if (cameraStream) {
 cameraStream.onload = null;
 cameraStream.onerror = null;
 cameraStream.src = '';
 cameraStream.style.display = 'none';
 }
 if (cameraPlaceholder) {
 cameraPlaceholder.classList.remove('hidden');
 const spanText = cameraPlaceholder.querySelector('span:not(.placeholder-icon)');
 if (spanText) spanText.textContent = '摄像头画面';
 }
 
 cameraActive = false;
 if (btnToggleCamera) {
 btnToggleCamera.innerHTML = '开启巡检监控';
 btnToggleCamera.classList.remove('btn-ghost');
 btnToggleCamera.classList.add('btn-primary');
 }
 } catch (e) {
 console.warn("Failed to stop stream gracefully:", e);
 } finally {
 if (btnToggleCamera) btnToggleCamera.disabled = false;
 }
 }

 /* ---------- Event Listeners ---------- */
 function setupEventListeners() {
 if (btnToggleCamera) btnToggleCamera.addEventListener('click', toggleCamera);
 if (btnCheckCamera) btnCheckCamera.addEventListener('click', checkCameraAvailability);
 
 if (btnForceReconnect) {
 btnForceReconnect.addEventListener('click', async () => {
 if (btnForceReconnect.disabled) return;
 
 try {
 btnForceReconnect.disabled = true;
 btnForceReconnect.innerHTML = '重连中...';
 if (btnCheckCamera) btnCheckCamera.disabled = true;
 if (cameraConnSub) cameraConnSub.textContent = '正在强制重设硬件连接...';
 
 const res = await API.reconnectCamera(activeCameraId);
 if (res && res.available) {
 streamReady = true;
 const resStr = res.resolution ? ` (${res.resolution.width}×${res.resolution.height})` : '';
 if (cameraConnSub) cameraConnSub.textContent = `摄像头已重连就绪${resStr}`;
 if (cameraConnCard) cameraConnCard.classList.add('connected');
 if (btnCheckCamera) btnCheckCamera.innerHTML = '重新检测';
 Toast.success('摄像头硬件强制重连成功！');
 if (cameraActive) {
 await startCamera();
 }
 } else {
 handleForceReconnectError();
 }
 } catch (err) {
 console.warn("Camera force reconnect failed:", err);
 handleForceReconnectError(err.message);
 } finally {
 btnForceReconnect.disabled = false;
 btnForceReconnect.innerHTML = '强制重连';
 if (btnCheckCamera) btnCheckCamera.disabled = false;
 }
 });
 }

 function handleForceReconnectError(msg = '') {
 streamReady = false;
 if (cameraConnSub) cameraConnSub.textContent = '摄像头重连失败，请检查物理连线';
 if (cameraConnCard) cameraConnCard.classList.remove('connected');
 if (btnCheckCamera) btnCheckCamera.innerHTML = '连接并检测';
 Toast.error('摄像头强制重连失败' + (msg ? `: ${msg}` : ''));
 if (cameraActive) {
 stopCamera();
 }
 }
 
 if (cameraSelect) {
 cameraSelect.addEventListener('change', async () => {
 activeCameraId = cameraSelect.value;
 await checkCameraAvailability();
 if (cameraActive) {
 // Restart camera with new feed ID
 stopStreamRefresh();
 await startCamera();
 }
 });
 }

 // Demo actions
 if (btnStartDemo) {
 btnStartDemo.addEventListener('click', async () => {
 try {
 const res = await API.startDemo();
 Toast.success(res.message || '实测演示已启动！请使摄像头对准火源。');
 
 // 联动开启巡检监控
 if (!cameraActive) {
 await startCamera();
 } else {
 // Ensure detect is active
 await API.enableCameraDetect(activeCameraId);
 }
 
 await loadDemoStatus();
 startDemoPolling();
 } catch (err) {
 Toast.error('启动演示失败: ' + err.message);
 }
 });
 }

 if (btnStopDemo) {
 btnStopDemo.addEventListener('click', async () => {
 try {
 const res = await API.stopDemo();
 Toast.success(res.message || '实测演示已停止。');
 stopDemoPolling();
 await loadDemoStatus();
 } catch (err) {
 Toast.error('停止演示失败: ' + err.message);
 }
 });
 }

 if (btnResetDemo) {
 btnResetDemo.addEventListener('click', () => {
 const confirmReset = confirm("确定要重置当前实测演示状态吗？\n此操作将物理清空该次演示中抓取的所有 20 张截图及打分！");
 if (confirmReset) {
 resetDemo();
 }
 });
 }

 if (btnManualDemoCapture) {
 btnManualDemoCapture.addEventListener('click', async () => {
 if (btnManualDemoCapture.disabled) return;
 try {
 btnManualDemoCapture.disabled = true;
 btnManualDemoCapture.textContent = '截图检测中...';
 const res = await API.captureDemoFrame(activeCameraId);
 const count = res.demo_captured_count || 0;
 const detCount = res.detection_count || 0;
 Toast.success(detCount > 0 ? `手动截图完成：检测到 ${detCount} 个目标` : '手动截图完成：未检测到火灾/烟雾');
 await loadDemoStatus();
 await loadDemoCaptures();
 if (count >= 20) {
 stopDemoPolling();
 }
 } catch (err) {
 Toast.error('手动截图失败: ' + err.message);
 } finally {
 btnManualDemoCapture.disabled = false;
 btnManualDemoCapture.textContent = '手动截图检测（计入本轮）';
 }
 });
 }
 }

 /* ---------- Demo Logics ---------- */
 async function loadDemoStatus() {
 try {
 const status = await API.getDemoStatus();
 if (status && status.success) {
 updateDemoUI(status);
 if (status.demo_mode) {
 if (btnStartDemo) btnStartDemo.disabled = true;
 if (btnStopDemo) btnStopDemo.disabled = false;
 startDemoPolling();
 } else {
 if (btnStartDemo) btnStartDemo.disabled = false;
 if (btnStopDemo) btnStopDemo.disabled = true;
 stopDemoPolling();
 }
 }
 } catch (e) {
 console.warn("加载演示状态失败:", e);
 }
 }

 async function resetDemo() {
 try {
 const res = await API.resetDemo();
 Toast.success(res.message || '演示状态已成功重置！');
 
 stopDemoPolling();
 if (btnStartDemo) btnStartDemo.disabled = false;
 if (btnStopDemo) btnStopDemo.disabled = true;

 if (demoTimerVal) demoTimerVal.textContent = '0 秒';
 if (demoProgressVal) demoProgressVal.textContent = '0 / 20 张';
 if (demoProgressFill) demoProgressFill.style.width = '0%';
 if (demoScoreVal) demoScoreVal.textContent = '15.00';
 if (demoCompleteAlert) demoCompleteAlert.classList.add('hidden');

 await loadDemoCaptures();
 } catch (err) {
 Toast.error('重置演示失败: ' + err.message);
 }
 }

 function startDemoPolling() {
 if (demoPollTimer) clearInterval(demoPollTimer);
 pollDemo();
 demoPollTimer = setInterval(pollDemo, 1000);
 }

 function stopDemoPolling() {
 if (demoPollTimer) {
 clearInterval(demoPollTimer);
 demoPollTimer = null;
 }
 }

 async function pollDemo() {
 try {
 const status = await API.getDemoStatus();
 if (status && status.success) {
 updateDemoUI(status);
 if (!status.demo_mode) {
 if (btnStartDemo) btnStartDemo.disabled = false;
 if (btnStopDemo) btnStopDemo.disabled = true;
 stopDemoPolling();
 }
 if (status.demo_complete) {
 stopDemoPolling();
 }
 }
 } catch (e) {
 console.warn("轮询演示状态失败:", e);
 }
 }

 function updateDemoUI(status) {
 // 1. Progress
 const count = status.demo_captured_count || 0;
 if (demoProgressVal) demoProgressVal.textContent = `${count} / 20 张`;
 const pct = Math.min(100, (count / 20) * 100);
 if (demoProgressFill) demoProgressFill.style.width = `${pct}%`;

 // 2. Stopwatch (Raw seconds)
 const secs = Math.round(status.elapsed_time || 0);
 if (demoTimerVal) demoTimerVal.textContent = `${secs} 秒`;

 // 3. Time Score
 if (demoScoreVal) demoScoreVal.textContent = parseFloat(status.time_score || 0).toFixed(2);

 // 4. Complete Alert
 if (demoCompleteAlert) {
 if (status.demo_complete) {
 demoCompleteAlert.classList.remove('hidden');
 if (btnStopDemo) btnStopDemo.disabled = true;
 } else {
 demoCompleteAlert.classList.add('hidden');
 }
 }

 // 5. Load captures strip
 loadDemoCaptures();
 }

 async function loadDemoCaptures() {
 try {
 const history = await API.getHistory();
 const list = history.records || (Array.isArray(history) ? history : []);
 // Filter alert_type == "demo"
 const demoList = list.filter(item => item.alert_type === 'demo');
 
 const countText = $('#demoCapturedCountText');
 if (countText) countText.textContent = demoList.length;
 
 const listContainer = $('#demoCapturesList');
 if (!listContainer) return;
 
 if (demoList.length === 0) {
 listContainer.innerHTML = `
 <div class="empty-state" style="padding:16px 0;width:100%;">
 <p style="color:var(--text-muted);font-size:0.85rem;">等待演示启动并采集第一张图像...</p>
 </div>`;
 return;
 }
 
 listContainer.innerHTML = demoList.map((item, idx) => {
 const imgUrl = item.thumbnail_path || item.annotated_path || item.original_path;
 return `
 <div class="thumb-item" onclick="openLightbox('${item.annotated_path}')" title="第${idx + 1}张">
 <img src="${imgUrl}" alt="第${idx + 1}张" loading="lazy">
 <span style="position:absolute; bottom:2px; left:2px; background:rgba(0,0,0,0.6); color:#fff; font-size:0.6rem; padding:1px 4px; border-radius:2px;">#${idx + 1}</span>
 </div>`;
 }).join('');
 } catch (e) {
 console.warn("加载演示快照失败:", e);
 }
 }

 /* ---------- Lightbox ---------- */
 window.openLightbox = function (imgSrc) {
 if (lightboxImg) lightboxImg.src = imgSrc;
 if (lightbox) lightbox.classList.add('active');
 };

 window.closeLightbox = function () {
 if (lightbox) lightbox.classList.remove('active');
 };

 // Run initializations
 document.addEventListener('DOMContentLoaded', init);
 window.addEventListener('beforeunload', stopStreamRefresh);
})();
