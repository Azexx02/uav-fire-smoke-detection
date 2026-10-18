/* ============================================
 林焰智巡 — Scoring Page Logic
 ============================================ */

(function () {
 'use strict';

 /* ---------- Constants ---------- */
 const POINTS_PER_CORRECT = 1.75;
 const MAX_IMAGES = 20;
 const MAX_SCORE = POINTS_PER_CORRECT * MAX_IMAGES; // 35.00

 /* ---------- State ---------- */
 let items = []; // History items to score
 let currentIndex = 0;
 let scoringState = {}; // { id: 'correct' | 'incorrect' | null }
 let confirmCallback = null;
 let reviewMode = 'demo';
 let loadSequence = 0;

 /* ---------- DOM ---------- */
 const $ = (sel) => document.querySelector(sel);

 // Dashboard
 const totalScoreEl = $('#totalScore');
 const scoreProgress = $('#scoreProgress');
 const progressCircle = $('#progressCircle');
 const progressPercent = $('#progressPercent');
 const reviewedCount = $('#reviewedCount');
 const correctCount = $('#correctCount');
 const incorrectCount = $('#incorrectCount');

 // Review area
 const reviewArea = $('#reviewArea');
 const emptyState = $('#emptyState');
 const reviewImage = $('#reviewImage');
 const reviewPlaceholder = $('#reviewPlaceholder');
 const reviewLoading = $('#reviewLoading');
 const imageIndicator = $('#imageIndicator');
 const reviewDetList = $('#reviewDetList');
 const reviewDetCount = $('#reviewDetCount');
 const reviewModeSubtitle = $('#reviewModeSubtitle');
 const reviewModeTabs = $('#reviewModeTabs');
 const emptyStateAction = $('#emptyStateAction');

 // Buttons
 const btnPrev = $('#btnPrev');
 const btnNext = $('#btnNext');
 const btnCorrect = $('#btnCorrect');
 const btnIncorrect = $('#btnIncorrect');
 const btnResetScoring = $('#btnResetScoring');

 // Thumbnails
 const thumbStrip = $('#thumbStrip');
 const thumbStripContainer = $('#thumbStripContainer');

 // Summary
 const summaryToggle = $('#summaryToggle');
 const summaryToggleIcon = $('#summaryToggleIcon');
 const summaryContent = $('#summaryContent');
 const summaryTableBody = $('#summaryTableBody');
 const scoreSummaryPanel = $('#scoreSummaryPanel');
 const btnExportScoring = $('#btnExportScoring');

 // Confirm
 const confirmDialog = $('#confirmDialog');
 const btnConfirmCancel = $('#btnConfirmCancel');
 const btnConfirmOk = $('#btnConfirmOk');

 // Expert Feedback Dialog (False Alarm vs Missed Case)
 const feedbackDialog = $('#feedbackDialog');

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

 function hideReviewContent() {
 reviewArea.classList.add('hidden');
 thumbStripContainer.classList.add('hidden');
 scoreSummaryPanel.classList.add('hidden');
 emptyState.classList.add('hidden');
 }

 /* ---------- Load Data ---------- */
 async function loadData() {
 const sequence = ++loadSequence;
 const modeAtStart = reviewMode;
 hideReviewContent();
 reviewLoading.classList.add('active');
 updateReviewModeUI();

 try {
 // Load history
 const history = await API.getHistory();
 const rawHistoryList = history.records || (Array.isArray(history) ? history : []);
 const baseHistoryList = rawHistoryList.filter(item => !item.batch_id);
 const historyList = modeAtStart === 'demo'
 ? baseHistoryList.filter(item => item.alert_type === 'demo')
 : baseHistoryList;
 items = historyList.slice(0, MAX_IMAGES);

 // Load scoring summary
 try {
 const summary = await API.getScoringSummary();
 if (summary && summary.score_details) {
 // Reconstruct scoring state from server
 summary.score_details.forEach(detail => {
 scoringState[String(detail.history_id)] = detail.correct ? 'correct' : 'incorrect';
 });
 }
 } catch {
 // Scoring summary may not exist yet — that's ok
 }
 } catch (err) {
 Toast.error('加载数据失败: ' + err.message);
 items = [];
 }

 if (sequence !== loadSequence || modeAtStart !== reviewMode) return;

 reviewLoading.classList.remove('active');
 const completionPanel = $('#completionPanel');
 if (completionPanel) completionPanel.classList.add('hidden');

 if (items.length === 0) {
 reviewArea.classList.add('hidden');
 thumbStripContainer.classList.add('hidden');
 scoreSummaryPanel.classList.add('hidden');
 const hint = emptyState ? emptyState.querySelector('.empty-state-hint') : null;
 if (hint) {
 hint.textContent = modeAtStart === 'demo'
 ? '请先在实时演示页面启动演示，并采集本轮评审截图'
 : '请先在实时检测页面上传图片或使用摄像头进行检测';
 }
 if (emptyStateAction) {
 emptyStateAction.href = modeAtStart === 'demo' ? 'demo.html' : 'index.html';
 emptyStateAction.textContent = modeAtStart === 'demo' ? '前往演示' : '前往检测';
 }
 emptyState.classList.remove('hidden');
 return;
 }

 emptyState.classList.add('hidden');
 reviewArea.classList.remove('hidden');
 thumbStripContainer.classList.remove('hidden');
 scoreSummaryPanel.classList.remove('hidden');

 renderThumbnails();
 updateDashboard();
 
 // Show export button if there are items
 if (btnExportScoring && items.length > 0) {
 btnExportScoring.style.display = 'block';
 }

 // Check if everything is completed, otherwise load index 0
 if (!checkCompletionStatus()) {
 showImage(0);
 }
 }

function updateReviewModeUI() {
if (reviewModeSubtitle) {
reviewModeSubtitle.textContent = reviewMode === 'demo'
? '评审实时演示采集的 20 张样本，计算比赛展示得分'
 : '逐张审核全部未归档检测记录，记录评审结果并统计实测准确度';
}

if (reviewModeTabs) {
reviewModeTabs.querySelectorAll('[data-review-mode]').forEach(btn => {
btn.classList.toggle('active', btn.dataset.reviewMode === reviewMode);
});
}

 const scoreDashboard = $('#scoreDashboard');
 const totalScoreCard = $('#totalScoreCard');
 const timeScoreCard = $('#timeScoreCard');
 const accuracyScoreUnit = $('#accuracyScoreUnit');
 const accuracyLabel = $('#accuracyScoreCard .label');
 const accuracyDetails = $('#accuracyDetails');

 if (reviewMode === 'all') {
 if (scoreDashboard) scoreDashboard.style.gridTemplateColumns = 'repeat(2, 1fr)';
 if (totalScoreCard) totalScoreCard.classList.add('hidden');
 if (timeScoreCard) timeScoreCard.classList.add('hidden');
 if (accuracyScoreUnit) accuracyScoreUnit.textContent = '%';
 if (accuracyLabel) accuracyLabel.textContent = '实测准确度';
 if (accuracyDetails) accuracyDetails.textContent = '0/0 正确，准确率 0.0%';
 } else {
 if (scoreDashboard) scoreDashboard.style.gridTemplateColumns = 'repeat(4, 1fr)';
 if (totalScoreCard) totalScoreCard.classList.remove('hidden');
 if (timeScoreCard) timeScoreCard.classList.remove('hidden');
 if (accuracyScoreUnit) accuracyScoreUnit.textContent = '/ 35.00 分';
 if (accuracyLabel) accuracyLabel.textContent = '实测准确度';
 if (accuracyDetails) accuracyDetails.textContent = '0/20 正确 (1.75分/张)';
 }
 }

 async function switchReviewMode(mode) {
 if (mode !== 'demo' && mode !== 'all') return;
 if (mode === reviewMode) return;
 reviewMode = mode;
 currentIndex = 0;
 updateReviewModeUI();
 await loadData();
 }

 /* ---------- Show Image & Completion Panel Helpers ---------- */
 window.setReviewActiveImage = function(imgSrc, activeIdx) {
 reviewImage.src = imgSrc;
 const thumbs = document.querySelectorAll('.review-smoke-thumb');
 thumbs.forEach((t, i) => {
 t.style.border = i === activeIdx ? '2px solid var(--accent-orange)' : '2px solid rgba(255,255,255,0.1)';
 });
 };

 window.resetScoringFromCompletion = function() {
 // Re-use the existing reset button action
 btnResetScoring.click();
 };

 window.commitScoringBatch = async function() {
 try {
 reviewLoading.classList.add('active');
 const res = await API.commitScoring();
 Toast.success(res.message || "打分成功提交并已归档到评审记录中！");
 scoringState = {};
 await loadData();
 } catch (err) {
 Toast.error("归档失败: " + err.message);
 } finally {
 reviewLoading.classList.remove('active');
 }
 };

 function checkCompletionStatus() {
 const allScored = items.length > 0 && items.every(item => scoringState[String(item.id)]);
 if (allScored) {
 showCompletionView();
 return true;
 }
 return false;
 }

 async function showCompletionView() {
 // Hide standard content
 const reviewContentWrap = reviewArea.querySelector('div[style*="max-width:800px"]');
 if (reviewContentWrap) reviewContentWrap.classList.add('hidden');
 
 // Create completion panel if not exists
 let completionPanel = $('#completionPanel');
 if (!completionPanel) {
 completionPanel = document.createElement('div');
 completionPanel.id = 'completionPanel';
 completionPanel.className = 'text-center';
 completionPanel.style.padding = '40px 10px';
 reviewArea.appendChild(completionPanel);
 }
 completionPanel.classList.remove('hidden');

 let timeScore = 15.00;
 let elapsedTime = 0;
 try {
 const demoStatus = await API.getDemoStatus();
 if (demoStatus && demoStatus.success) {
 timeScore = demoStatus.time_score;
 elapsedTime = demoStatus.elapsed_time;
 }
 } catch (e) {
 console.warn("无法拉取实测演示时间:", e);
 }

 // Calculate score & grade
 let correct = 0;
 let incorrect = 0;
 items.forEach(item => {
 const state = scoringState[String(item.id)];
 if (state === 'correct') correct++;
 else if (state === 'incorrect') incorrect++;
 });

 const accuracyScore = correct * POINTS_PER_CORRECT;
 const totalScore = accuracyScore + timeScore;
 const accuracy = items.length > 0 ? (correct / items.length) : 0;
 const isAllReview = reviewMode === 'all';
 
 let gradeName = 'C档 · 待优化';
 let gradeClass = 'grade-c';
 if (totalScore >= 40.0) {
 gradeName = 'A档 · 优秀';
 gradeClass = 'grade-a';
 } else if (totalScore >= 30.0) {
 gradeName = 'B档 · 良好';
 gradeClass = 'grade-b';
 }

 completionPanel.innerHTML = `
 <div class="animate-scale-in" style="max-width:600px;margin:0 auto;padding:10px 0;">
 <div style="font-size:4.5rem;margin-bottom:15px;animation: pulse 2.5s infinite;"></div>
 <h2 style="font-family:var(--font-cn);margin-bottom:10px;font-size:1.8rem;color:var(--text-primary);">专家评审已全部完成！</h2>
 <p style="color:var(--text-muted);font-size:0.92rem;margin-bottom:20px;">${isAllReview ? '本次未归档记录已全部审计完毕，评审记录可归档保存。' : '本次实测样本已全部审计完毕，最终实战测评得分如下：'}</p>
 
 <div style="margin-bottom:25px; display:flex; justify-content:center; gap:12px; align-items:center;">
 ${isAllReview
 ? `<span style="font-size:1.5rem; font-weight:800; color:var(--success-green); font-family:monospace;">准确率 ${(accuracy * 100).toFixed(1)}%</span>`
 : `<span class="badge ${gradeClass}" style="font-size:1.1rem;padding:8px 16px;">评估等级：${gradeName}</span>
 <span style="font-size:1.5rem; font-weight:800; color:var(--accent-orange); font-family:monospace; margin-left:8px;">${totalScore.toFixed(2)} 分</span>`}
 </div>

 <div class="card-flat" style="padding:20px;margin-bottom:35px;background:rgba(255,255,255,0.02);border:1px solid rgba(255,255,255,0.05);text-align:left;">
 <h4 style="font-family:var(--font-cn);margin-bottom:12px;font-size:0.9rem;color:var(--text-primary);border-bottom:1px solid rgba(255,255,255,0.05);padding-bottom:8px;">${isAllReview ? '评审记录明细' : '实测成绩单明细'}</h4>
 <div style="display:flex;justify-content:space-between;font-size:0.88rem;margin-bottom:10px;">
 <span style="color:var(--text-muted);">样本总数 (Total Samples):</span>
 <span style="font-weight:600;color:var(--text-primary);">${items.length} 个</span>
 </div>
 <div style="display:flex;justify-content:space-between;font-size:0.88rem;margin-bottom:10px;">
 <span style="color:var(--text-muted);">实测识别准确 ():</span>
 <span style="font-weight:600;color:var(--success-green);">${correct} 个 (${(accuracy * 100).toFixed(1)}%)</span>
 </div>
 ${isAllReview ? '' : `
 <div style="display:flex;justify-content:space-between;font-size:0.88rem;margin-bottom:10px;">
 <span style="color:var(--text-muted);">准确度得分 (Accuracy Score):</span>
 <span style="font-weight:600;color:var(--success-green);">${accuracyScore.toFixed(2)} / 35.00 分</span>
 </div>
 <div style="display:flex;justify-content:space-between;font-size:0.88rem;margin-bottom:10px;">
 <span style="color:var(--text-muted);">演示采集总耗时 (Elapsed Time):</span>
 <span style="font-weight:600;color:var(--text-primary);">${elapsedTime} 秒</span>
 </div>
 <div style="display:flex;justify-content:space-between;font-size:0.88rem;">
 <span style="color:var(--text-muted);">推理时效性得分 (Time Score):</span>
 <span style="font-weight:600;color:#60a5fa;">${timeScore.toFixed(2)} / 15.00 分</span>
 </div>`}
 </div>

 <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;">
 <button class="btn btn-success" onclick="window.commitScoringBatch()" style="padding:10px 20px;">完成评审并归档</button>
 <button class="btn" onclick="window.exportScoringResults()" style="background: var(--accent-orange); color: #fff; padding:10px 20px;">导出评审结果</button>
 <button class="btn btn-primary" onclick="window.resetScoringFromCompletion()" style="padding:10px 20px;">重新评审</button>
 <a href="report.html" class="btn btn-ghost" style="padding:10px 20px;border:1px solid rgba(255,255,255,0.15);"> 查看模型评估报告</a>
 </div>
 </div>
 `;
 }

 /* ---------- Export Scoring Results to CSV ---------- */
 window.exportScoringResults = async function() {
 if (items.length === 0) {
 Toast.warning("当前没有可导出的评审数据！");
 return;
 }

 reviewLoading.classList.add('active');

 try {
 let timeScore = 15.00;
 let elapsedTime = 0;
 if (reviewMode === 'demo') {
 try {
 const demoStatus = await API.getDemoStatus();
 if (demoStatus && demoStatus.success) {
 timeScore = demoStatus.time_score;
 elapsedTime = demoStatus.elapsed_time;
 }
 } catch (e) {
 console.warn("无法拉取实测演示时间:", e);
 }
 }

 let correct = 0;
 let incorrect = 0;
 let reviewed = 0;
 items.forEach(item => {
 const state = scoringState[String(item.id)];
 if (state === 'correct') { correct++; reviewed++; }
 else if (state === 'incorrect') { incorrect++; reviewed++; }
 });

 const accuracyScore = correct * POINTS_PER_CORRECT;
 const totalScore = accuracyScore + timeScore;
 const accuracy = items.length > 0 ? (correct / items.length) : 0;
 const isAllReview = reviewMode === 'all';

 let gradeName = 'C档 · 待优化';
 if (totalScore >= 40.0) {
 gradeName = 'A档 · 优秀';
 } else if (totalScore >= 30.0) {
 gradeName = 'B档 · 良好';
 }

 const rows = [];
 rows.push([isAllReview ? '林焰智巡 - 专家评审记录' : '林焰智巡 - 项目评估结果汇总报告']);
 rows.push(['导出时间', new Date().toLocaleString()]);
 rows.push([]);
 rows.push(['评估指标', '评估结果']);
 if (!isAllReview) {
 rows.push(['实测综合得分', `${totalScore.toFixed(2)} 分 (总分 50.00)`]);
 rows.push(['评估等级', gradeName]);
 rows.push(['实测准确度得分', `${accuracyScore.toFixed(2)} 分 (总分 35.00)`]);
 rows.push(['推理时效性得分', `${timeScore.toFixed(2)} 分 (总分 15.00)`]);
 }
 rows.push(['巡检样本总数', `${items.length} 个`]);
 rows.push(['已评审样本数', `${reviewed} 个`]);
 rows.push(['准确/错误分配', `${correct} 正确 / ${incorrect} 错误`]);
 rows.push(['实测准确率', `${(accuracy * 100).toFixed(1)}%`]);
 if (!isAllReview) {
 rows.push(['演示采集总耗时', `${elapsedTime} 秒`]);
 }
 rows.push([]);
 rows.push(['项目结果细则明细数据']);
 rows.push(['序号', '记录ID', '源文件', '检测目标数', '专家评审结果', '准确度单项得分']);

 items.forEach((item, idx) => {
 const itemId = String(item.id);
 const state = scoringState[itemId];
 const detCount = (item.detections || []).length;
 const filename = item.filename || item.annotated_path || 'N/A';
 
 let resultLabel = '未评审';
 let scoreVal = 0;
 if (state === 'correct') {
 resultLabel = '正确';
 scoreVal = POINTS_PER_CORRECT;
 } else if (state === 'incorrect') {
 resultLabel = '错误';
 scoreVal = 0;
 }

 rows.push([
 idx + 1,
 item.id,
 filename,
 detCount,
 resultLabel,
 scoreVal.toFixed(2)
 ]);
 });

 const csvString = rows.map(r => r.map(val => {
 if (val === null || val === undefined) return '';
 let str = String(val);
 if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
 str = '"' + str.replace(/"/g, '""') + '"';
 }
 return str;
 }).join(',')).join('\n');

 const blob = new Blob(['\uFEFF' + csvString], { type: 'text/csv;charset=utf-8;' });
 const link = document.createElement("a");
 const url = URL.createObjectURL(blob);
 link.href = url;
 
 const pad = n => String(n).padStart(2, '0');
 const now = new Date();
 const timestamp = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
 
 link.setAttribute("download", `林焰智巡_专家评审结果_${timestamp}.csv`);
 document.body.appendChild(link);
 link.click();
 document.body.removeChild(link);
 URL.revokeObjectURL(url);
 
 Toast.success(" 评审结果已成功导出 CSV 文件！");
 } catch (err) {
 console.error(err);
 Toast.error("导出失败: " + err.message);
 } finally {
 reviewLoading.classList.remove('active');
 }
 };

 function showImage(index) {
 if (index < 0 || index >= items.length) return;
 currentIndex = index;

 const item = items[index];
 const imgUrl = Utils.getImageURL(item);

 // Hide completion panel if shown
 const completionPanel = $('#completionPanel');
 if (completionPanel) completionPanel.classList.add('hidden');
 const reviewContentWrap = reviewArea.querySelector('div[style*="max-width:800px"]');
 if (reviewContentWrap) reviewContentWrap.classList.remove('hidden');

 reviewPlaceholder.classList.add('hidden');

 // Indicator
 imageIndicator.textContent = `第 ${index + 1}/${items.length} 张`;

 // Navigation buttons
 btnPrev.disabled = index === 0;
 btnNext.disabled = index === items.length - 1;

 // Create or locate reviewVideo and reviewSmokeBurstStrip
 let reviewVideo = $('#reviewVideo');
 if (!reviewVideo) {
 reviewVideo = document.createElement('video');
 reviewVideo.id = 'reviewVideo';
 reviewVideo.style.width = '100%';
 reviewVideo.style.borderRadius = 'var(--radius-md)';
 reviewVideo.style.display = 'none';
 reviewVideo.controls = true;
 reviewImage.after(reviewVideo);
 }

 let burstStrip = $('#reviewSmokeBurstStrip');
 if (!burstStrip) {
 burstStrip = document.createElement('div');
 burstStrip.id = 'reviewSmokeBurstStrip';
 burstStrip.style.display = 'flex';
 burstStrip.style.gap = '8px';
 burstStrip.style.marginTop = '10px';
 reviewImage.after(burstStrip);
 }

 // Dynamic Swapping
 const isVideo = item.alert_type === 'fire_segment' || item.type === 'video' || item.video_clip;

 let burstGrid = $('#reviewSmokeBurstGrid');
 if (!burstGrid) {
 burstGrid = document.createElement('div');
 burstGrid.id = 'reviewSmokeBurstGrid';
 burstGrid.style.display = 'none';
 burstGrid.style.gridTemplateColumns = 'repeat(3, 1fr)';
 burstGrid.style.gap = '12px';
 burstGrid.style.width = '100%';
 burstGrid.style.borderRadius = 'var(--radius-md)';
 reviewImage.after(burstGrid);
 }

 if (isVideo) {
 reviewImage.style.display = 'none';
 burstGrid.style.display = 'none';
 
 reviewVideo.src = item.video_clip || item.annotated_path;
 reviewVideo.style.display = 'block';
 reviewVideo.load();
 reviewVideo.play().catch(() => {});

 // Display 3 core images for video/fire segment record auditing!
 if (item.images && item.images.length > 0) {
 burstStrip.style.display = 'flex';
 burstStrip.innerHTML = `
 <div style="width:100%;margin-top:5px;">
 <h5 style="margin-bottom:8px;font-size:0.75rem;color:var(--text-secondary);text-align:left;"> 核心检测快照 (点击大图)</h5>
 <div style="display:flex;gap:8px;">
 ${item.images.map((img, idx) => `
 <div class="review-smoke-thumb" onclick="openLightbox('${img}')" style="flex:1;cursor:pointer;border-radius:4px;overflow:hidden;border:2px solid rgba(255,255,255,0.1);background:#000;transition:transform 0.1s;" onmouseover="this.style.transform='scale(1.03)'" onmouseout="this.style.transform='scale(1)'">
 <img src="${img}" style="width:100%;height:45px;object-fit:cover;">
 </div>`).join('')}
 </div>
 </div>
 `;
 } else {
 burstStrip.style.display = 'none';
 burstStrip.innerHTML = '';
 }
 } else {
 reviewVideo.style.display = 'none';
 reviewVideo.src = '';
 
 if (item.alert_type === 'smoke_burst' && item.images && item.images.length > 0) {
 reviewImage.style.display = 'none';
 burstStrip.style.display = 'none';
 
 burstGrid.style.display = 'grid';
 burstGrid.innerHTML = item.images.map((img, idx) => `
 <div class="relative" style="border: 1px solid rgba(255,255,255,0.05); border-radius: var(--radius-md); overflow: hidden; background: #000; transition: transform var(--transition);" onmouseover="this.style.transform='scale(1.02)'" onmouseout="this.style.transform='scale(1)'">
 <img src="${img}" style="width:100%; height:auto; object-fit:contain; cursor:zoom-in;" onclick="openLightbox('${img}')">
 <div style="position: absolute; left: 8px; top: 8px; background: rgba(0,0,0,0.6); color: #fff; font-size: 0.72rem; padding: 2px 6px; border-radius: 4px; font-weight: bold; backdrop-filter: blur(2px); border: 1px solid rgba(255,255,255,0.1);">帧 ${idx + 1}</div>
 </div>
 `).join('');
 } else {
 burstGrid.style.display = 'none';
 burstGrid.innerHTML = '';
 
 reviewImage.src = imgUrl;
 reviewImage.style.display = 'block';
 burstStrip.style.display = 'none';
 burstStrip.innerHTML = '';
 }
 }

 // Detection details
 const detections = item.detections || [];
 reviewDetCount.textContent = `${detections.length} 个目标`;

 if (detections.length === 0) {
 reviewDetList.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">未检测到目标</p>';
 } else {
 reviewDetList.innerHTML = detections.map(d => {
 const cls = d.class || d.name || 'unknown';
 const conf = ((d.confidence || d.conf || 0) * 100).toFixed(1);
 const levelLabel = d.alert_level === 'suspected' ? ' <span style="color:var(--accent-orange);font-size:0.7rem;">(疑似)</span>' : '';
 return `
 <div class="detection-item">
 <span class="badge ${Utils.classBadge(cls)}">${Utils.classLabel(cls)}</span>
 <span class="det-conf">${conf}%${levelLabel}</span>
 </div>`;
 }).join('');
 }

 // Update button states based on scoring
 const itemId = String(item.id);
 const scored = scoringState[itemId];
 updateScoringButtons(scored);

 // Highlight thumbnail
 updateThumbnailHighlight();
 }

 /* ---------- Scoring Buttons State ---------- */
 function updateScoringButtons(scored) {
 btnCorrect.style.opacity = '';
 btnIncorrect.style.opacity = '';
 btnCorrect.style.outline = '';
 btnIncorrect.style.outline = '';

 if (scored === 'correct') {
 btnCorrect.style.outline = '3px solid var(--success-green)';
 btnIncorrect.style.opacity = '0.4';
 } else if (scored === 'incorrect') {
 btnIncorrect.style.outline = '3px solid var(--danger-red)';
 btnCorrect.style.opacity = '0.4';
 }
 }

 /* ---------- Score an Image ---------- */
 async function scoreCurrentImage(correct, feedback = null) {
 const item = items[currentIndex];
 if (!item) return;

 const itemId = String(item.id);

 try {
 let hasFireSmoke = null;
 let imageDecisions = null;

 if (!correct && feedback !== null) {
 if (typeof feedback === 'object') {
 imageDecisions = feedback;
 } else {
 hasFireSmoke = feedback;
 }
 }

 await API.scoreImage(item.id, correct, hasFireSmoke, imageDecisions);
 scoringState[itemId] = correct ? 'correct' : 'incorrect';

 // Visual feedback
 const btn = correct ? btnCorrect : btnIncorrect;
 btn.style.transform = 'scale(1.08)';
 setTimeout(() => { btn.style.transform = ''; }, 200);

 // Toast feedback based on decision
 if (correct) {
 Toast.success(' 评审结果已记为正确');
 } else if (imageDecisions !== null) {
 let negs = 0;
 let reinfs = 0;
 let skipped = 0;
 Object.values(imageDecisions).forEach(v => {
 if (v === 'true' || v === true) reinfs++;
 else if (v === 'false' || v === false) negs++;
 else skipped++;
 });
 if (skipped > 0) {
 Toast.success(`样本精细化归档成功！整理负样本 ${negs} 张，强化样本 ${reinfs} 张，忽略无错误图片 ${skipped} 张`);
 } else {
 Toast.success(`样本精细化归档成功！共整理负样本 ${negs} 张，强化样本 ${reinfs} 张`);
 }
 } else if (hasFireSmoke === false) {
 Toast.success('已将该样本保存为 [负样本集] 供后续优化');
 } else if (hasFireSmoke === true) {
 Toast.success('已将该样本归入 [强化训练集] 供下轮迭代');
 }

 updateDashboard();
 updateScoringButtons(scoringState[itemId]);
 renderThumbnails();
 updateSummaryTable();

 // Check if all items are now successfully scored
 const allScored = items.every(item => scoringState[String(item.id)]);
 if (allScored) {
 // Stop video playback if playing
 const reviewVideo = $('#reviewVideo');
 if (reviewVideo) {
 reviewVideo.pause();
 reviewVideo.src = '';
 }
 setTimeout(() => {
 showCompletionView();
 Toast.success(' 所有巡检记录已评审完毕！');
 }, 350);
 } else {
 // Auto-advance to next unscored
 if (currentIndex < items.length - 1) {
 setTimeout(() => {
 let nextIdx = -1;
 for (let i = currentIndex + 1; i < items.length; i++) {
 if (!scoringState[String(items[i].id)]) {
 nextIdx = i;
 break;
 }
 }
 if (nextIdx === -1) {
 // Try from beginning
 for (let i = 0; i < currentIndex; i++) {
 if (!scoringState[String(items[i].id)]) {
 nextIdx = i;
 break;
 }
 }
 }
 if (nextIdx !== -1) {
 showImage(nextIdx);
 }
 }, 350);
 }
 }
 } catch (err) {
 Toast.error('评分提交失败: ' + err.message);
 }
 }

 /* ---------- Update Dashboard ---------- */
 async function updateDashboard() {
 const modeAtStart = reviewMode;
 let correct = 0;
 let incorrect = 0;
 let reviewed = 0;

 items.forEach(item => {
 const state = scoringState[String(item.id)];
 if (state === 'correct') { correct++; reviewed++; }
 else if (state === 'incorrect') { incorrect++; reviewed++; }
 });

 const score = correct * POINTS_PER_CORRECT;
 const total = items.length;
 const accuracyPercent = total > 0 ? (correct / total) * 100 : 0;

 // 拉取演示时效得分
 let timeScore = 15.00;
 let elapsedTime = 0;
 if (modeAtStart === 'demo') {
 try {
 const demoStatus = await API.getDemoStatus();
 if (demoStatus && demoStatus.success) {
 timeScore = demoStatus.time_score;
 elapsedTime = demoStatus.elapsed_time;
 }
 } catch (e) {
 console.warn("无法拉取时效得分:", e);
 }
 }

 if (modeAtStart !== reviewMode) return;

 const totalScore = score + timeScore;

 // 综合总分
 const demoTotalScoreEl = $('#demoTotalScore');
 if (demoTotalScoreEl) Utils.animateNumber(demoTotalScoreEl, totalScore, 500, 2);

 // 准确度：演示模式显示分数，全部记录评审显示百分比
 if (totalScoreEl) Utils.animateNumber(totalScoreEl, modeAtStart === 'all' ? accuracyPercent : score, 500, 2);

 // 时效分
 const demoTimeScoreEl = $('#demoTimeScore');
 if (demoTimeScoreEl) Utils.animateNumber(demoTimeScoreEl, timeScore, 500, 2);

 // 明细更新
 const accuracyDetails = $('#accuracyDetails');
 if (accuracyDetails) {
 accuracyDetails.textContent = modeAtStart === 'all'
 ? `${correct}/${total} 正确，准确率 ${accuracyPercent.toFixed(1)}%`
 : `${correct}/${total} 正确 (1.75分/张)`;
 }

 const timeDetails = $('#timeDetails');
 if (timeDetails) {
 timeDetails.textContent = elapsedTime > 0 
 ? `耗时 ${elapsedTime} 秒 (${elapsedTime <= 180 ? '符合要求' : '超时扣分'})` 
 : `耗时 -- 秒 (限180秒)`;
 }

 // 进度与正确数
 if (reviewedCount) reviewedCount.textContent = `${reviewed}/${total}`;
 if (correctCount) Utils.animateNumber(correctCount, correct, 300);
 if (incorrectCount) Utils.animateNumber(incorrectCount, incorrect, 300);

 // 兼容原有的 circular progress (防崩)
 const circumference = 213.6;
 const offset = circumference - (circumference * (reviewed / Math.max(total, 1)));
 if (progressCircle) progressCircle.style.strokeDashoffset = offset;
 if (progressPercent) {
 const percent = total > 0 ? Math.round((reviewed / total) * 100) : 0;
 progressPercent.textContent = `${percent}%`;
 }
 if (scoreProgress) {
 scoreProgress.style.width = `${(score / MAX_SCORE) * 100}%`;
 }
 }

 /* ---------- Thumbnails ---------- */
 function renderThumbnails() {
 thumbStrip.innerHTML = items.map((item, idx) => {
 const imgUrl = Utils.getImageURL(item);
 const itemId = String(item.id);
 const state = scoringState[itemId];
 let statusClass = 'unscored';
 let statusIcon = '';

 if (state === 'correct') {
 statusClass = 'correct';
 statusIcon = '<span class="thumb-status correct"></span>';
 } else if (state === 'incorrect') {
 statusClass = 'incorrect';
 statusIcon = '<span class="thumb-status incorrect"></span>';
 }

 const activeClass = idx === currentIndex ? ' active' : '';

 return `
 <div class="thumb-item ${statusClass}${activeClass}" onclick="goToImage(${idx})" title="第${idx + 1}张">
 <img src="${imgUrl}" alt="第${idx + 1}张" loading="lazy">${statusIcon}
 </div>`;
 }).join('');
 }

 function updateThumbnailHighlight() {
 const thumbs = thumbStrip.querySelectorAll('.thumb-item');
 thumbs.forEach((t, i) => {
 t.classList.toggle('active', i === currentIndex);
 });

 // Scroll active into view
 if (thumbs[currentIndex]) {
 thumbs[currentIndex].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
 }
 }

 window.goToImage = function (idx) {
 showImage(idx);
 };

 /* ---------- Summary Table ---------- */
 function updateSummaryTable() {
 summaryTableBody.innerHTML = items.map((item, idx) => {
 const itemId = String(item.id);
 const state = scoringState[itemId];
 const detCount = (item.detections || []).length;
 let resultText = '<span style="color:var(--text-muted);">未评审</span>';
 let scoreText = '--';

 if (state === 'correct') {
 resultText = '<span style="color:var(--success-green);">正确</span>';
 scoreText = `<span style="color:var(--success-green);">+${POINTS_PER_CORRECT}</span>`;
 } else if (state === 'incorrect') {
 resultText = '<span style="color:var(--danger-red);">错误</span>';
 scoreText = '<span style="color:var(--danger-red);">+0</span>';
 }

 return `
 <tr style="cursor:pointer;" onclick="goToImage(${idx})">
 <td>${idx + 1}</td>
 <td>
 <img src="${Utils.getImageURL(item)}" style="width:48px;height:36px;object-fit:cover;border-radius:4px;" loading="lazy">
 </td>
 <td>${detCount}</td>
 <td>${resultText}</td>
 <td>${scoreText}</td>
 </tr>`;
 }).join('');
 }

 /* ---------- Review Lightbox ---------- */
 window.openLightbox = function (imgSrc) {
 const lightbox = document.getElementById('lightbox');
 const lightboxImg = document.getElementById('lightboxImg');
 lightboxImg.src = imgSrc;
 lightbox.classList.add('active');
 };

 window.openReviewLightbox = function () {
 const item = items[currentIndex];
 if (!item) return;
 window.openLightbox(Utils.getImageURL(item));
 };

 /* ---------- Expert Dynamic Feedback Dialog Helpers ---------- */
 window.openFeedbackDialog = function() {
 const item = items[currentIndex];
 if (!item) return;

 // Filter out video files from the list to display, to guarantee only core images are checked
 const images = (item.images && item.images.length > 0)
 ? item.images.filter(img => !/\.(mp4|avi|mov|mkv|wmv|flv)$/i.test(img))
 : [Utils.getImageURL(item)].filter(img => !/\.(mp4|avi|mov|mkv|wmv|flv)$/i.test(img));

 let html = `
 <h3 style="color: var(--danger-red); font-family: var(--font-cn); display: flex; align-items: center; gap: 8px; font-size: 1.25rem; margin: 0 0 12px 0;">
 判定为【错误】— 精细化样本归档
 </h3>
 <p style="color: var(--text-muted); font-size: 0.82rem; margin: 0 0 16px 0; line-height: 1.5; text-align: left;">
 请逐张选择：<strong>该图片中实际是否存在火灾（火点）或烟雾？</strong> 系统将根据每张图的判定，分别复制保存到负样本集（用于纠错）或强化训练集（用于补漏）。如果图片检测本身没有错误，请选择“此照片无错误”。
 </p>
 <div style="display: flex; flex-direction: column; gap: 12px; max-height: 320px; overflow-y: auto; padding-right: 4px; margin-bottom: 8px;" id="feedbackImagesList">
 `;

 images.forEach((img, idx) => {
 html += `
 <div class="feedback-image-row" data-img-url="${img}">
 <img src="${img}" style="width: 72px; height: 54px; object-fit: cover; border-radius: 4px; background:#000; cursor:zoom-in;" onclick="window.openLightbox('${img}')">
 <div style="flex: 1; text-align: left;">
 <div style="font-size: 0.8rem; font-weight: 600; color: var(--text-primary);">图片 ${idx + 1}</div>
 <div style="font-size: 0.7rem; color: var(--text-muted); margin-top: 2px;">请评估实际火/烟存在性</div>
 </div>
 <div class="feedback-choice-group">
 <button class="btn btn-sm btn-feedback-choice is-negative" data-choice="false" style="padding: 4px 8px; font-size: 0.72rem;" onclick="window.selectFeedbackChoice(this, 'false')">无火烟 (负样本)
 </button>
 <button class="btn btn-sm btn-feedback-choice is-positive" data-choice="true" style="padding: 4px 8px; font-size: 0.72rem;" onclick="window.selectFeedbackChoice(this, 'true')">有火烟 (强化)
 </button>
 <button class="btn btn-sm btn-feedback-choice is-neutral" data-choice="none" style="padding: 4px 8px; font-size: 0.72rem;" onclick="window.selectFeedbackChoice(this, 'none')">此照片无错误
 </button>
 </div>
 </div>`;
 });

 html += `
 </div>
 <div style="display: flex; justify-content: flex-end; gap: 12px; margin-top: 20px; border-top: 1px solid rgba(255,255,255,0.05); padding-top: 12px;">
 <button class="btn btn-ghost" id="btnFeedbackCancel" style="padding: 6px 16px; font-size: 0.85rem;" onclick="window.closeFeedbackDialog()">取消</button>
 <button class="btn btn-danger" id="btnFeedbackSubmit" style="padding: 6px 20px; font-size: 0.85rem;" onclick="window.submitFeedbackDecisions()">确认提交归档</button>
 </div>
 `;

 $('#feedbackDialogContent').innerHTML = html;

 // Set default choice to No (false)
 document.querySelectorAll('.feedback-image-row').forEach(row => {
 const noBtn = row.querySelector('button[data-choice="false"]');
 window.selectFeedbackChoice(noBtn, 'false');
 });

 feedbackDialog.classList.add('active');
 };

 window.selectFeedbackChoice = function(btn, value) {
 const row = btn.closest('.feedback-image-row');
 const buttons = row.querySelectorAll('.btn-feedback-choice');
 buttons.forEach(b => {
 b.classList.remove('selected-negative', 'selected-positive', 'selected-neutral');
 });

 if (value === 'true' || value === true) {
 btn.classList.add('selected-positive');
 } else if (value === 'false' || value === false) {
 btn.classList.add('selected-negative');
 } else {
 btn.classList.add('selected-neutral');
 }

 row.setAttribute('data-selected-value', value.toString());
 };

 window.closeFeedbackDialog = function() {
 feedbackDialog.classList.remove('active');
 };

 window.submitFeedbackDecisions = async function() {
 const rows = document.querySelectorAll('.feedback-image-row');
 const decisions = {};
 rows.forEach(row => {
 const imgUrl = row.getAttribute('data-img-url');
 const value = row.getAttribute('data-selected-value'); // 'true', 'false', or 'none'
 decisions[imgUrl] = value;
 });

 window.closeFeedbackDialog();
 await scoreCurrentImage(false, decisions);
 };

 /* ---------- Event Listeners ---------- */
 function setupEventListeners() {
 if (reviewModeTabs) {
 reviewModeTabs.addEventListener('click', async (e) => {
 const btn = e.target.closest('[data-review-mode]');
 if (!btn) return;
 await switchReviewMode(btn.dataset.reviewMode);
 });
 }

 btnPrev.addEventListener('click', () => showImage(currentIndex - 1));
 btnNext.addEventListener('click', () => showImage(currentIndex + 1));

 btnCorrect.addEventListener('click', () => scoreCurrentImage(true));
 btnIncorrect.addEventListener('click', () => {
 window.openFeedbackDialog();
 });

 feedbackDialog.addEventListener('click', (e) => {
 if (e.target === feedbackDialog) {
 window.closeFeedbackDialog();
 }
 });

 // Reset
 btnResetScoring.addEventListener('click', () => {
 showConfirm('确认重置', '确定要重置所有评审结果吗？此操作无法撤销。', async () => {
 try {
 await API.resetScoring();
 scoringState = {};
 Toast.success('评审结果已重置');
 updateDashboard();
 renderThumbnails();
 updateSummaryTable();
 showImage(0);
 } catch (err) {
 Toast.error('重置失败: ' + err.message);
 }
 });
 });

 // Summary toggle
 summaryToggle.addEventListener('click', () => {
 const isHidden = summaryContent.classList.toggle('hidden');
 summaryToggleIcon.textContent = isHidden ? '展开' : '收起';
 if (!isHidden) updateSummaryTable();
 });

 if (btnExportScoring) {
 btnExportScoring.addEventListener('click', (e) => {
 e.stopPropagation();
 window.exportScoringResults();
 });
 }

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

 // Keyboard
 document.addEventListener('keydown', (e) => {
 if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

 switch (e.key) {
 case 'ArrowLeft':
 e.preventDefault();
 showImage(currentIndex - 1);
 break;
 case 'ArrowRight':
 e.preventDefault();
 showImage(currentIndex + 1);
 break;
 case '1':
 case 'y':
 case 'Y':
 e.preventDefault();
 scoreCurrentImage(true);
 break;
 case '2':
 case 'n':
 case 'N':
 e.preventDefault();
 window.openFeedbackDialog();
 break;
 case 'Escape':
 confirmDialog.classList.remove('active');
 window.closeFeedbackDialog();
 lightbox.classList.remove('active');
 break;
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
 window.addEventListener('pagehide', hideReviewContent);
})();
