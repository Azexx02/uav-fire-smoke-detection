/* ============================================
 林焰智巡 — Main Page (index.html) Logic
 ============================================ */

(function () {
 'use strict';

 /* ---------- State ---------- */
 let currentTab = 'camera';
 let selectedFile = null;
 let selectedVideoFile = null;
 let cameraActive = false;
 let isDetecting = false;
 const STREAM_REFRESH_INTERVAL_MS = 60000;
 let streamRefreshTimer = null;

 /* ---------- DOM Elements ---------- */
 const $ = (sel) => document.querySelector(sel);
 const $$ = (sel) => document.querySelectorAll(sel);

 // Tabs
 const tabBtns = $$('.tab-btn');
 const tabContents = $$('.tab-content');

 // Camera
 const cameraStream = $('#cameraStream');
 const cameraPlaceholder = $('#cameraPlaceholder');
 const btnCaptureFrame = $('#btnCaptureFrame');
 const btnToggleCamera = $('#btnToggleCamera');
 const btnCheckCamera = $('#btnCheckCamera');
 // Camera connection card
 const cameraConnCard = $('#cameraConnCard');
 const cameraConnSub = $('#cameraConnSub');

 // Upload
 const dropZone = $('#dropZone');
 const fileInput = $('#fileInput');
 const imagePreviewContainer = $('#imagePreviewContainer');
 const uploadPreview = $('#uploadPreview');
 const uploadLoading = $('#uploadLoading');
 const btnDetectImage = $('#btnDetectImage');
 const btnClearUpload = $('#btnClearUpload');

 // Video
 const videoDropZone = $('#videoDropZone');
 const videoInput = $('#videoInput');
 const videoPreviewContainer = $('#videoPreviewContainer');
 const videoPreview = $('#videoPreview');
 const videoLoading = $('#videoLoading');
 const videoProgressText = $('#videoProgressText');
 const frameInterval = $('#frameInterval');
 const btnDetectVideo = $('#btnDetectVideo');
 const btnClearVideo = $('#btnClearVideo');

 // Results & Settings Controls
 const confSlider = $('#confSlider');
 const confValue = $('#confValue');
 const settingRoutineInterval = $('#settingRoutineInterval');
 const routineIntervalVal = $('#routineIntervalVal');
 const settingFireVideo = $('#settingFireVideo');
 const settingSmokeBurst = $('#settingSmokeBurst');
 const settingAlarmVoice = $('#settingAlarmVoice');
 const resultImageContainer = $('#resultImageContainer');
 const resultImage = $('#resultImage');

 // Recent
 const recentCaptures = $('#recentCaptures');

 // System
 const statusDot = $('#statusDot');
 const statusText = $('#statusText');

 /* ---------- Init ---------- */
 async function init() {
 setupTabs();
 setupDropZone();
 setupVideoDropZone();
 setupSlider();
 setupButtons();
 checkSystemHealth();
 loadRecentCaptures();
 await setupSettings();

 // 预热连接启动配置逻辑：启动时若开启了自动预热，则自动检测并连接摄像头硬件
 if (settingPreConnect && settingPreConnect.checked) {
 console.log("启动配置：自动检测摄像头常驻状态...");
 checkCameraAvailability(false); // 默认启动时不强制重置硬件
 }

 // Periodic health check
 setInterval(checkSystemHealth, 15000);
 }

 /* ---------- System Health ---------- */
 async function checkSystemHealth() {
 try {
 await API.healthCheck();
 statusDot.className = 'status-dot';
 statusText.textContent = '系统在线';
 } catch {
 statusDot.className = 'status-dot offline';
 statusText.textContent = '连接失败';
 }
 }

 /* ---------- Camera Check / Pre-connect ---------- */
 let streamReady = false;
 const settingPreConnect = $('#settingPreConnect');

 async function checkCameraAvailability(forceReconnect = false) {
 // 识别是否是用户手动点击卡片连接/重连按钮触发
 const isManualClick = forceReconnect === true || (arguments[0] instanceof Event);

 if (btnCheckCamera && btnCheckCamera.disabled) return;

 if (btnCheckCamera) { btnCheckCamera.disabled = true; btnCheckCamera.innerHTML = '连接中…'; }
 if (cameraConnSub) cameraConnSub.textContent = '正在连接硬件…';
 if (cameraConnCard) cameraConnCard.classList.remove('connected');

 // 若当前正在预览中，主按钮显示为连接中状态
 if (cameraActive) {
 btnToggleCamera.innerHTML = '连接中…';
 btnToggleCamera.disabled = true;
 }

 try {
 let res;
 if (isManualClick) {
 // 手动强制重新连接：向后端发起物理摄像头连接重置
 res = await API.reconnectCamera();
 } else {
 // 自动拉取检测：获取当前后端常驻线程状态
 res = await API.getCameraStatus();
 // 若后端相机关联未就绪，则主动唤醒并连接一次
 if (res && !res.available) {
 res = await API.reconnectCamera();
 }
 }

 if (res && res.available) {
 streamReady = true;
 const resStr = res.resolution ? ` (${res.resolution.width}×${res.resolution.height})` : '';
 if (cameraConnSub) cameraConnSub.textContent = `摄像头已连接${resStr}`;
 if (cameraConnCard) cameraConnCard.classList.add('connected');
 if (btnCheckCamera) { btnCheckCamera.innerHTML = '重新连接'; btnCheckCamera.disabled = false; }
 
 // 常驻摄像头连接建立，将前端 <img> 指向 MJPEG 视频源 URL，通过 opacity 控制显示/后台静默
 cameraStream.style.display = 'block';
 cameraStream.style.opacity = cameraActive ? '1' : '0';
 cameraStream.onload = null;
 cameraStream.onerror = null;
 
 if (cameraActive) {
 refreshCameraStream();
 cameraPlaceholder.classList.add('hidden');
 btnToggleCamera.innerHTML = '关闭摄像头';
 btnToggleCamera.disabled = false;
 startEventListening();
 startStreamRefresh();
 
 // 联动开启后端 YOLO 推理
 API.enableCameraDetect().catch(e => console.warn("Failed to enable camera detect:", e));
 } else {
 cameraStream.src = '';
 stopStreamRefresh();
 }
 } else {
 handleConnectError();
 }
 } catch (err) {
 console.warn("Camera check/reconnect failed:", err);
 handleConnectError();
 }

 function handleConnectError() {
 streamReady = false;
 cameraStream.onload = null;
 cameraStream.onerror = null;
 cameraStream.src = '';
 cameraStream.style.display = 'none';
 cameraStream.style.opacity = '1';
 stopStreamRefresh();
 
 if (cameraConnSub) cameraConnSub.textContent = '摄像头未就绪';
 if (cameraConnCard) cameraConnCard.classList.remove('connected');
 if (btnCheckCamera) { btnCheckCamera.innerHTML = '连接摄像头'; btnCheckCamera.disabled = false; }
 
 if (cameraActive) {
 cameraPlaceholder.classList.remove('hidden');
 btnToggleCamera.innerHTML = '开启摄像头';
 btnToggleCamera.disabled = false;
 cameraActive = false;
 }
 stopEventListening();
 }
 }

 function setCameraConnState(state, subText) {
 if (cameraConnSub) cameraConnSub.textContent = subText;
 if (cameraConnCard) cameraConnCard.classList.toggle('connected', state === 'preview' || state === 'online');
 }

 /* ---------- Tab Switching ---------- */
 function setupTabs() {
 tabBtns.forEach(btn => {
 btn.addEventListener('click', () => {
 const tab = btn.dataset.tab;
 currentTab = tab;

 tabBtns.forEach(b => b.classList.remove('active'));
 btn.classList.add('active');

 tabContents.forEach(tc => tc.classList.remove('active'));
 const target = $(`#tab-${tab}`);
 if (target) target.classList.add('active');
 });
 });
 }

 /* ---------- Confidence Slider ---------- */
 function setupSlider() {
 confSlider.addEventListener('input', () => {
 confValue.textContent = parseFloat(confSlider.value).toFixed(2);
 });
 }

 /* ---------- Image Drop Zone ---------- */
 function setupDropZone() {
 dropZone.addEventListener('click', () => fileInput.click());

 dropZone.addEventListener('dragover', (e) => {
 e.preventDefault();
 dropZone.classList.add('drag-over');
 });

 dropZone.addEventListener('dragleave', () => {
 dropZone.classList.remove('drag-over');
 });

 dropZone.addEventListener('drop', (e) => {
 e.preventDefault();
 dropZone.classList.remove('drag-over');
 const files = e.dataTransfer.files;
 if (files.length > 0 && files[0].type.startsWith('image/')) {
 handleImageFile(files[0]);
 } else {
 Toast.warning('请上传图片文件');
 }
 });

 fileInput.addEventListener('change', () => {
 if (fileInput.files.length > 0) {
 handleImageFile(fileInput.files[0]);
 }
 });
 }

 function handleImageFile(file) {
 selectedFile = file;
 const url = URL.createObjectURL(file);
 uploadPreview.src = url;
 dropZone.classList.add('hidden');
 imagePreviewContainer.classList.remove('hidden');
 }

 /* ---------- Video Drop Zone ---------- */
 function setupVideoDropZone() {
 videoDropZone.addEventListener('click', () => videoInput.click());

 videoDropZone.addEventListener('dragover', (e) => {
 e.preventDefault();
 videoDropZone.classList.add('drag-over');
 });

 videoDropZone.addEventListener('dragleave', () => {
 videoDropZone.classList.remove('drag-over');
 });

 videoDropZone.addEventListener('drop', (e) => {
 e.preventDefault();
 videoDropZone.classList.remove('drag-over');
 const files = e.dataTransfer.files;
 if (files.length > 0 && files[0].type.startsWith('video/')) {
 handleVideoFile(files[0]);
 } else {
 Toast.warning('请上传视频文件');
 }
 });

 videoInput.addEventListener('change', () => {
 if (videoInput.files.length > 0) {
 handleVideoFile(videoInput.files[0]);
 }
 });
 }

 function handleVideoFile(file) {
 selectedVideoFile = file;
 const url = URL.createObjectURL(file);
 videoPreview.src = url;
 videoDropZone.classList.add('hidden');
 videoPreviewContainer.classList.remove('hidden');
 }

 /* ---------- Buttons ---------- */
 function setupButtons() {
 // Camera demo toggle
 btnToggleCamera.addEventListener('click', toggleCamera);
 // Camera hardware check (separate from demo)
 if (btnCheckCamera) btnCheckCamera.addEventListener('click', checkCameraAvailability);
 // Capture frame
 btnCaptureFrame.addEventListener('click', captureFrame);

 // Upload
 btnDetectImage.addEventListener('click', detectImage);
 btnClearUpload.addEventListener('click', clearUpload);

 // Video
 btnDetectVideo.addEventListener('click', detectVideo);
 btnClearVideo.addEventListener('click', clearVideo);
 }

 /* ---------- Camera ---------- */
 let eventSource = null;

 function refreshCameraStream() {
 if (!cameraStream || !cameraActive) return;
 const streamUrl = API.getCameraStreamURL();
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

 function startEventListening() {
 if (eventSource) return;
 console.log("开启智能告警事件监听通道 (SSE)...");
 eventSource = new EventSource('/api/camera/events');
 
 eventSource.onmessage = (e) => {
 try {
 const ev = JSON.parse(e.data);
 console.log("收到实时告警事件:", ev);
 
 if (ev.type === 'fire_segment') {
 Toast.show(` [实时火灾告警] 检测到持续火焰！系统已自动录制并保存一段 ${ev.record.duration_sec}秒 视频记录以供审核。`, 'error', 8000);
 speakAlert(
 "监测画面发现持续火焰，请现场人员注意安全，远离危险区域。系统已自动记录告警视频。",
 "assets/alarm-fire.mp3"
 );
 } else if (ev.type === 'smoke_burst') {
 Toast.show(` [实时烟雾告警] 检测到局部浓烟！系统已自动执行三连拍，并将照片集保存以供审核。`, 'warning', 8000);
 speakAlert(
 "监测画面发现疑似烟雾，请现场人员注意核查，保持安全距离。系统已自动保存三连拍记录。",
 "assets/alarm-smoke.mp3"
 );
 }
 
 loadRecentCaptures();
 } catch (err) {
 console.error("解析告警数据失败:", err);
 }
 };
 
 eventSource.onerror = (err) => {
 console.warn("实时通道重连中...");
 };
 }

 function stopEventListening() {
 if (eventSource) {
 console.log("关闭智能告警通道.");
 eventSource.close();
 eventSource = null;
 }
 }

 async function toggleCamera() {
 if (cameraActive) {
 // 关闭预览：不需要断开物理流连接，仅隐藏画面在后台保持监测
 cameraPlaceholder.classList.remove('hidden');
 cameraStream.style.opacity = '0';
 cameraStream.src = ''; // 停止前端视频流拉取以节省 CPU 和流量
 btnToggleCamera.innerHTML = '开启摄像头';
 cameraActive = false;
 stopStreamRefresh();
 stopEventListening(); // 关闭预览时关闭事件流监听
 
 // 联动关闭后端 YOLO 推理以释放 CPU
 API.disableCameraDetect().catch(e => console.warn("Failed to disable camera detect:", e));
 } else {
 if (streamReady) {
 // 如果流已经在后台预热连接好了，瞬间显示画面即可
 cameraStream.style.opacity = '1';
 cameraPlaceholder.classList.add('hidden');
 btnToggleCamera.innerHTML = '关闭摄像头';
 cameraActive = true;
 refreshCameraStream(); // 开启预览时重新绑定流
 startStreamRefresh();
 startEventListening(); // 开启预览时开启事件流监听
 
 // 联动开启后端 YOLO 推理
 API.enableCameraDetect().catch(e => console.warn("Failed to enable camera detect:", e));
 } else {
 // 如果流尚未建立连接，则启动连接，并直接进入预览激活等待态
 cameraActive = true;
 btnToggleCamera.innerHTML = '连接中…';
 btnToggleCamera.disabled = true;
 checkCameraAvailability();
 }
 }
 }

 function setGlobalDetectingState(detecting, sourceTab = '') {
 isDetecting = detecting;

 // 1. 禁用/启用 所有检测与清空相关动作按钮
 const allButtons = [
 btnCaptureFrame, btnDetectImage, btnDetectVideo,
 btnClearUpload, btnClearVideo
 ];
 allButtons.forEach(btn => {
 if (btn) btn.disabled = detecting;
 });

 // 2. 禁用/启用 置信度滑块和帧采样间隔
 if (confSlider) confSlider.disabled = detecting;
 if (frameInterval) frameInterval.disabled = detecting;

 // 3. 处理 Loading 局部遮罩与显示
 if (uploadLoading) {
 if (detecting && sourceTab === 'image') {
 uploadLoading.classList.add('active');
 } else {
 uploadLoading.classList.remove('active');
 }
 }

 if (videoLoading) {
 if (detecting && sourceTab === 'video') {
 videoLoading.classList.add('active');
 } else {
 videoLoading.classList.remove('active');
 }
 }

 // 4. 更新摄像头截图检测按钮文字与状态
 if (btnCaptureFrame) {
 if (detecting && sourceTab === 'camera') {
 btnCaptureFrame.innerHTML = '<div class="spinner spinner-sm" style="display:inline-block;vertical-align:middle;margin-right:6px;"></div>正在分析截屏...';
 } else {
 btnCaptureFrame.innerHTML = '截图检测';
 }
 }

 // 5. 更新视频检测按钮文字与状态
 if (btnDetectVideo) {
 if (detecting && sourceTab === 'video') {
 btnDetectVideo.innerHTML = '正在分析视频并转码中...';
 } else {
 btnDetectVideo.innerHTML = '开始视频检测';
 }
 }

 // 6. 更新图片检测按钮文字与状态
 if (btnDetectImage) {
 if (detecting && sourceTab === 'image') {
 btnDetectImage.innerHTML = '正在分析图片...';
 } else {
 btnDetectImage.innerHTML = '开始检测';
 }
 }
 }

 async function captureFrame() {
 if (isDetecting) return;
 setGlobalDetectingState(true, 'camera');

 try {
 const result = await API.captureFrame();
 displayResults(result);
 Toast.success('截图检测完成');
 loadRecentCaptures();
 } catch (err) {
 Toast.error('截图检测失败: ' + err.message);
 } finally {
 setGlobalDetectingState(false);
 }
 }

 /* ---------- Image Detection ---------- */
 async function detectImage() {
 if (!selectedFile || isDetecting) return;
 setGlobalDetectingState(true, 'image');

 try {
 const conf = parseFloat(confSlider.value);
 const result = await API.detectImage(selectedFile, conf, true);
 displayResults(result);
 Toast.success('图片检测完成');
 loadRecentCaptures();
 } catch (err) {
 Toast.error('检测失败: ' + err.message);
 } finally {
 setGlobalDetectingState(false);
 }
 }

 function clearUpload() {
 selectedFile = null;
 fileInput.value = '';
 uploadPreview.src = '';
 imagePreviewContainer.classList.add('hidden');
 dropZone.classList.remove('hidden');
 }

 /* ---------- Video Detection ---------- */
 async function detectVideo() {
 if (!selectedVideoFile || isDetecting) return;
 setGlobalDetectingState(true, 'video');
 if (videoProgressText) {
 videoProgressText.textContent = '正在解码视频并运行智能推理转码，请稍候 (此操作已在后台多线程运行，不影响系统响应)…';
 }

 try {
 const conf = parseFloat(confSlider.value);
 const interval = parseInt(frameInterval.value) || 5;
 const result = await API.detectVideo(selectedVideoFile, conf, interval);
 displayResults(result);
 Toast.success('视频检测完成');
 loadRecentCaptures();
 } catch (err) {
 Toast.error('视频检测失败: ' + err.message);
 } finally {
 setGlobalDetectingState(false);
 }
 }

 function clearVideo() {
 selectedVideoFile = null;
 videoInput.value = '';
 videoPreview.src = '';
 videoPreviewContainer.classList.add('hidden');
 videoDropZone.classList.remove('hidden');
 }

 /* ---------- Display Detection Results ---------- */
 function displayResults(result) {
 if (!result) return;

 const detections = result.detections || [];
 const counts = Utils.countByClass(detections);

 // Update counts with animation if element exists
 const fireCount = $('#fireCount');
 const smokeCount = $('#smokeCount');
 if (fireCount) Utils.animateNumber(fireCount, counts.fire, 400);
 if (smokeCount) Utils.animateNumber(smokeCount, counts.smoke, 400);

 // Inference time
 const time = result.inference_time_ms || result.total_inference_time_ms || 0;
 const inferenceTime = $('#inferenceTime');
 if (inferenceTime) inferenceTime.textContent = time.toFixed(1) + ' ms';

 // Detection total
 const detectionTotal = $('#detectionTotal');
 if (detectionTotal) detectionTotal.textContent = `${detections.length} 个目标`;

 // Remove old keyframes container if present
 const oldKf = $('#videoKeyFramesContainer');
 if (oldKf) oldKf.remove();

 // Detection list
 const detectionList = $('#detectionList');
 if (detectionList) {
 if (detections.length === 0) {
 detectionList.innerHTML = `
 <div class="empty-state" style="padding:24px 0;">
 <div style="font-size:2rem;opacity:0.3;margin-bottom:8px;"></div>
 <p style="color:var(--text-muted);font-size:0.85rem;">未检测到火焰或烟雾</p>
 </div>`;
 } else {
 detectionList.innerHTML = detections.map((d, i) => {
 const cls = d.class || d.name || 'unknown';
 const conf = ((d.confidence || d.conf || 0) * 100).toFixed(1);
 const bbox = d.bbox || d.box || [];
 const bboxStr = bbox.length >= 4
 ? `[${bbox.map(v => Math.round(v)).join(', ')}]`
 : '';
 const levelLabel = d.alert_level === 'suspected' ? ' <span style="color:var(--accent-orange);font-size:0.7rem;">(疑似)</span>' : '';
 return `
 <div class="detection-item" style="animation-delay:${i * 0.05}s">
 <span class="badge ${Utils.classBadge(cls)}">${Utils.classLabel(cls)}</span>
 <span class="det-bbox">${bboxStr}</span>
 <span class="det-conf">${conf}%${levelLabel}</span>
 </div>`;
 }).join('');
 }
 }

 // Result video playback support
 if (result.video_url) {
 videoPreview.src = result.video_url;
 videoPreview.controls = true;
 videoPreview.autoplay = true;
 videoPreviewContainer.classList.remove('hidden');
 videoDropZone.classList.add('hidden');
 
 // Render keyframes strip
 if (result.key_frames && result.key_frames.length > 0) {
 const kfHtml = `
 <div style="margin-top:20px; border-top: 1px solid rgba(255,255,255,0.08); padding-top: 15px;">
 <h4 style="margin-bottom:10px;font-size:0.9rem;color:var(--text-primary);display:flex;align-items:center;gap:6px;">
 核心识别图片 (${result.key_frames.length})
 </h4>
 <div class="key-frames-strip" style="display:flex;gap:10px;overflow-x:auto;padding-bottom:8px;scrollbar-width:thin;">
 ${result.key_frames.map(kf => `
 <div class="keyframe-card" onclick="openLightbox('${kf.image_url}')" style="flex:0 0 110px;cursor:pointer;border-radius:6px;overflow:hidden;border:1px solid rgba(255,255,255,0.1);background:rgba(0,0,0,0.3);transition:transform 0.2s;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
 <img src="${kf.image_url}" style="width:100%;height:70px;object-fit:cover;">
 <div style="font-size:0.65rem;color:var(--text-muted);padding:4px;text-align:center;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">帧 #${kf.frame_index}</div>
 </div>`).join('')}
 </div>
 </div>
 `;
 
 const kfContainer = document.createElement('div');
 kfContainer.id = 'videoKeyFramesContainer';
 kfContainer.innerHTML = kfHtml;
 const detectionList = $('#detectionList');
 if (detectionList) {
 detectionList.after(kfContainer);
 } else {
 videoPreviewContainer.appendChild(kfContainer);
 }
 }
 } else {
 // Result image (only for standard image uploads or manual capture)
 const imgUrl = Utils.getImageURL(result);
 if (imgUrl) {
 resultImage.src = imgUrl;
 resultImageContainer.classList.remove('hidden');
 resultImage.onclick = () => openLightbox(imgUrl);
 }
 }
 }

 /* ---------- Recent Captures ---------- */
 async function loadRecentCaptures() {
 try {
 const historyData = await API.getHistory();
 const historyList = historyData.records || (Array.isArray(historyData) ? historyData : []);
 const recent = historyList.slice(0, 5);

 if (recent.length === 0) {
 recentCaptures.innerHTML = `
 <div class="empty-state" style="padding:12px 0;width:100%;">
 <p style="color:var(--text-muted);font-size:0.8rem;">暂无记录</p>
 </div>`;
 return;
 }

 recentCaptures.innerHTML = recent.map(item => {
 const imgUrl = Utils.getImageURL(item);
 const time = Utils.formatShortTime(item.timestamp || item.created_at);
 return `
 <div class="thumb-item" onclick="openLightbox('${imgUrl}')" title="${time}">
 <img src="${imgUrl}" alt="检测记录" loading="lazy">
 </div>`;
 }).join('');
 } catch (e) {
 console.warn("加载最近截屏失败:", e);
 }
 }

 /* ---------- Lightbox ---------- */
 window.openLightbox = function (src) {
 const lightbox = $('#lightbox');
 const lightboxImg = $('#lightboxImg');
 lightboxImg.src = src;
 lightbox.classList.add('active');
 };

 window.closeLightbox = function () {
 $('#lightbox').classList.remove('active');
 };

 // Close lightbox on overlay click
 const lightbox = $('#lightbox');
 if (lightbox) {
 lightbox.addEventListener('click', (e) => {
 if (e.target === lightbox) {
 lightbox.classList.remove('active');
 }
 });
 }

 // ESC key
 document.addEventListener('keydown', (e) => {
 if (e.key === 'Escape') {
 closeLightbox();
 }
 });

 /* ---------- Start ---------- */
 document.addEventListener('DOMContentLoaded', init);
 
 /* ---------- Settings Panel Integration ---------- */
 async function setupSettings() {
 try {
 const data = await API.getCameraSettings();
 if (data && data.settings) {
 const s = data.settings;
 
 // 同步输入控件的值
 if (settingRoutineInterval) {
 settingRoutineInterval.value = String(Math.round(s.routine_interval));
 updateRoutineIntervalText(s.routine_interval);
 }
 if (settingFireVideo) settingFireVideo.checked = s.fire_video_enabled;
 if (settingSmokeBurst) settingSmokeBurst.checked = s.smoke_burst_enabled;
 if (settingPreConnect) settingPreConnect.checked = s.pre_connect_enabled;
 }
 } catch (err) {
 console.warn("无法从后端加载系统集成设置:", err);
 }

 // 预热连接选项已升级为与后端 camera_settings.json 实时双向同步
 if (settingPreConnect) {
 settingPreConnect.addEventListener('change', async () => {
 await saveSettings();
 });
 }

 // 语音报警选项使用 localStorage 进行前端状态维护与留存
 const voiceSaved = localStorage.getItem('settingAlarmVoice');
 if (settingAlarmVoice) {
 settingAlarmVoice.checked = voiceSaved !== 'false'; // 默认开启
 }

 // 监听快照频率变化
 if (settingRoutineInterval) {
 settingRoutineInterval.addEventListener('change', async () => {
 const val = parseFloat(settingRoutineInterval.value);
 updateRoutineIntervalText(val);
 await saveSettings();
 });
 }

 // 监听火焰视频及烟雾三连拍开关
 [settingFireVideo, settingSmokeBurst].forEach(el => {
 if (el) {
 el.addEventListener('change', saveSettings);
 }
 });

 // 监听语音声光警报开关
 if (settingAlarmVoice) {
 settingAlarmVoice.addEventListener('change', () => {
 localStorage.setItem('settingAlarmVoice', settingAlarmVoice.checked);
 Toast.success(settingAlarmVoice.checked ? '智能语音应急广播已开启' : '智能语音应急广播已关闭');
 });
 }
 }

 function updateRoutineIntervalText(val) {
 if (!routineIntervalVal) return;
 if (val === 60) routineIntervalVal.textContent = '1分钟/次';
 else if (val === 300) routineIntervalVal.textContent = '5分钟/次';
 else if (val === 600) routineIntervalVal.textContent = '10分钟/次';
 else if (val === 1800) routineIntervalVal.textContent = '30分钟/次';
 else routineIntervalVal.textContent = '已停用';
 }

 async function saveSettings() {
 try {
 const payload = {
 routine_interval: parseFloat(settingRoutineInterval.value),
 fire_video_enabled: settingFireVideo.checked,
 smoke_burst_enabled: settingSmokeBurst.checked,
 pre_connect_enabled: settingPreConnect.checked,
 };
 await API.updateCameraSettings(payload);
 Toast.success('系统集成配置已实时同步');
 } catch (err) {
 Toast.error('系统配置同步失败: ' + err.message);
 }
 }

 function speakAlert(text, audioSrc = null) {
 if (settingAlarmVoice && settingAlarmVoice.checked) {
 if (audioSrc) {
 const audio = new Audio(audioSrc);
 audio.volume = 1.0;
 audio.play().catch(() => {
 speakWithBrowserVoice(text);
 });
 return;
 }
 speakWithBrowserVoice(text);
 }
 }

 function speakWithBrowserVoice(text) {
 if ('speechSynthesis' in window) {
 // 取消正在播报的所有其他广播，插播高优先级警报
 window.speechSynthesis.cancel();
 const utterance = new SpeechSynthesisUtterance(text);
 utterance.lang = 'zh-CN';
 utterance.rate = 0.95; // 稍慢，更显严肃和清晰
 utterance.volume = 1.0;
 window.speechSynthesis.speak(utterance);
 }
 }

 // Clean up SSE channel on page unload
 window.addEventListener('beforeunload', () => {
 stopEventListening();
 stopStreamRefresh();
 });
})();
