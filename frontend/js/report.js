/* ============================================
 林焰智巡 — Report Page Logic
 ============================================ */

(function () {
 'use strict';

 /* ---------- DOM ---------- */
 const $ = (sel) => document.querySelector(sel);

 // Model info
 const modelName = $('#modelName');
 const modelClasses = $('#modelClasses');
 const modelInputSize = $('#modelInputSize');
 const modelSize = $('#modelSize');
 const modelStatus = $('#modelStatus');

 // Metrics
 const metricMAP50 = $('#metricMAP50');
 const metricMAP5095 = $('#metricMAP5095');
 const metricPrecision = $('#metricPrecision');
 const metricRecall = $('#metricRecall');
 const barMAP50 = $('#barMAP50');
 const barMAP5095 = $('#barMAP5095');
 const barPrecision = $('#barPrecision');
 const barRecall = $('#barRecall');

 // Curves
 const curveGrid = $('#curveGrid');

 // Assessment
 const assessmentGrade = $('#assessmentGrade');
 const assessmentText = $('#assessmentText');

 // System
 const statusDot = $('#statusDot');
 const statusText = $('#statusText');

 /* ---------- Curve Config ---------- */
 const curveConfig = [
 { key: 'results', label: '训练损失曲线', file: 'results.png' },
 { key: 'PR', label: 'PR 曲线 (Box)', file: 'BoxPR_curve.png' },
 { key: 'F1', label: 'F1 曲线 (Box)', file: 'BoxF1_curve.png' },
 { key: 'confusion', label: '混淆矩阵', file: 'confusion_matrix.png' },
 { key: 'confusion_normalized', label: '归一化混淆矩阵', file: 'confusion_matrix_normalized.png' },
 { key: 'labels', label: '标签分布', file: 'labels.jpg' },
 ];

 /* ---------- Init ---------- */
 async function init() {
 checkHealth();
 setInterval(checkHealth, 15000);
 await Promise.all([loadModelInfo(), loadTrainingReport()]);
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

 /* ---------- Load Model Info ---------- */
 async function loadModelInfo() {
 try {
 const info = await API.getModelInfo();
 modelName.textContent = info.name || info.model_name || 'YOLO26s';
 modelClasses.textContent = (info.classes || info.names || []).join(', ') || 'fire, smoke';
 modelInputSize.textContent = info.input_size || info.imgsz || '640×640';
 modelSize.textContent = info.model_size || info.size || '--';
 modelStatus.textContent = '已加载';
 modelStatus.className = 'badge badge-success';
 } catch (err) {
 modelStatus.textContent = '加载失败';
 modelStatus.className = 'badge badge-fire';
 // Set defaults
 modelName.textContent = 'YOLO26s Fire Detection';
 modelClasses.textContent = 'fire, smoke';
 modelInputSize.textContent = '640×640';
 modelSize.textContent = '--';
 }
 }

 /* ---------- Load Training Report ---------- */
 async function loadTrainingReport() {
 try {
 const report = await API.getTrainingReport();

 // Metrics
 const metrics = report.metrics || report;
 const map50 = parseMetric(metrics.mAP50 || metrics.map50 || metrics['metrics/mAP50(B)']);
 const map5095 = parseMetric(metrics.mAP50_95 || metrics['mAP50-95'] || metrics.map5095 || metrics['metrics/mAP50-95(B)']);
 const precision = parseMetric(metrics.precision || metrics['metrics/precision(B)']);
 const recall = parseMetric(metrics.recall || metrics['metrics/recall(B)']);

 setMetric(metricMAP50, barMAP50, map50);
 setMetric(metricMAP5095, barMAP5095, map5095);
 setMetric(metricPrecision, barPrecision, precision);
 setMetric(metricRecall, barRecall, recall);

 // Curves
 loadCurves(report);

 // Assessment
 generateAssessment(map50, map5095, precision, recall);

 } catch (err) {
 assessmentText.innerHTML = `<p style="color:var(--danger-red);">加载报告数据失败: ${err.message}</p>
 <p style="color:var(--text-muted);margin-top:8px;">请确认后端已启动并且训练数据可用。</p>`;

 // Try loading curves directly from common paths
 loadCurvesFromPaths();
 }
 }

 /* ---------- Helpers ---------- */
 function parseMetric(value) {
 if (value === undefined || value === null) return null;
 const n = parseFloat(value);
 return isNaN(n) ? null : n;
 }

 function setMetric(el, bar, value) {
 if (value === null) {
 el.textContent = '--';
 return;
 }
 const display = value > 1 ? value.toFixed(1) : (value * 100).toFixed(1);
 const pct = value > 1 ? value : value * 100;

 // Animate
 setTimeout(() => {
 Utils.animateNumber(el, parseFloat(display), 800, 1);
 bar.style.width = `${Math.min(pct, 100)}%`;
 }, 300);
 }

 /* ---------- Load Curves ---------- */
 function loadCurves(report) {
 const curves = report.curves || report.images || {};

 curveConfig.forEach(cfg => {
 const imgEl = curveGrid.querySelector(`img[data-curve="${cfg.key}"]`);
 if (!imgEl) return;

 // Try from report data
 const stem = cfg.file.split('.')[0];
 let url = curves[cfg.key] || curves[stem] || curves[cfg.file] || '';

 // If not in report, try proxy path
 if (!url) {
 url = `/api/report/training/image/${cfg.file}`;
 }

 imgEl.src = url;
 imgEl.onerror = function () {
 // Try alternative paths
 const altPaths = [
 `/api/report/curves/${cfg.file}`,
 `/static/train/${cfg.file}`,
 `/train/${cfg.file}`,
 ];
 tryAlternativePaths(this, altPaths, 0);
 };
 });
 }

 function loadCurvesFromPaths() {
 curveConfig.forEach(cfg => {
 const imgEl = curveGrid.querySelector(`img[data-curve="${cfg.key}"]`);
 if (!imgEl) return;
 imgEl.src = `/api/report/training/image/${cfg.file}`;
 imgEl.onerror = function () {
 this.style.opacity = '0.3';
 this.alt = '图片未找到';
 };
 });
 }

 function tryAlternativePaths(img, paths, idx) {
 if (idx >= paths.length) {
 img.style.opacity = '0.3';
 img.alt = '图片未找到';
 return;
 }
 img.src = paths[idx];
 img.onerror = function () {
 tryAlternativePaths(img, paths, idx + 1);
 };
 }

 /* ---------- Curve Lightbox ---------- */
 window.openCurveLightbox = function (card) {
 const img = card.querySelector('img');
 if (!img || !img.src) return;
 const lightbox = document.getElementById('lightbox');
 const lightboxImg = document.getElementById('lightboxImg');
 lightboxImg.src = img.src;
 lightbox.classList.add('active');
 };

 // Close lightbox
 const lightbox = document.getElementById('lightbox');
 lightbox.addEventListener('click', (e) => {
 if (e.target === lightbox) lightbox.classList.remove('active');
 });

 document.addEventListener('keydown', (e) => {
 if (e.key === 'Escape') lightbox.classList.remove('active');
 });

 /* ---------- Generate Assessment ---------- */
 function generateAssessment(map50, map5095, precision, recall) {
 // Determine grade based on competition criteria
 // A档: mAP50 >= 0.8
 // B档: mAP50 >= 0.6
 // C档: mAP50 < 0.6
 let grade, gradeClass, gradeName;
 const effectiveMap50 = map50 !== null ? (map50 > 1 ? map50 / 100 : map50) : 0;

 if (effectiveMap50 >= 0.8) {
 grade = 'A'; gradeClass = 'grade-a'; gradeName = 'A档 · 优秀';
 } else if (effectiveMap50 >= 0.6) {
 grade = 'B'; gradeClass = 'grade-b'; gradeName = 'B档 · 良好';
 } else {
 grade = 'C'; gradeClass = 'grade-c'; gradeName = 'C档 · 待改进';
 }

 assessmentGrade.className = `assessment-grade ${gradeClass}`;
 assessmentGrade.innerHTML = `${gradeName}`;
 assessmentGrade.style.display = 'inline-flex';

 // Format values for display
 const fmtVal = (v) => {
 if (v === null) return '未知';
 return v > 1 ? `${v.toFixed(1)}%` : `${(v * 100).toFixed(1)}%`;
 };

 let text = '';

 text += `<p><strong>综合评估：</strong>本模型基于 YOLO26s 架构，针对森林火灾场景中的火焰与烟雾进行目标检测训练。</p>`;

 if (map50 !== null) {
 text += `<p style="margin-top:12px;"><strong>mAP@50 (${fmtVal(map50)})：</strong>`;
 if (effectiveMap50 >= 0.8) {
 text += `模型在 IoU=0.50 阈值下的平均精度优秀，表明模型能够准确定位和分类绝大多数火焰与烟雾目标。该指标达到了竞赛 A 档标准。</p>`;
 } else if (effectiveMap50 >= 0.6) {
 text += `模型在 IoU=0.50 阈值下的平均精度良好，能够识别大部分火焰与烟雾目标，但仍有提升空间。建议通过数据增强和调整超参数进一步优化。</p>`;
 } else {
 text += `模型在 IoU=0.50 阈值下的平均精度偏低，存在较多漏检或误检。建议增加训练数据量，检查标注质量，并尝试不同的训练策略。</p>`;
 }
 }

 if (map5095 !== null) {
 text += `<p style="margin-top:8px;"><strong>mAP@50-95 (${fmtVal(map5095)})：</strong>`;
 const effMap5095 = map5095 > 1 ? map5095 / 100 : map5095;
 if (effMap5095 >= 0.5) {
 text += `在更严格的多阈值评估下仍保持较高精度，表明模型具有精确的边界框回归能力。</p>`;
 } else {
 text += `在严格阈值评估下精度有所下降，建议优化边界框回归精度以提升整体定位准确性。</p>`;
 }
 }

 if (precision !== null) {
 text += `<p style="margin-top:8px;"><strong>精确率 Precision (${fmtVal(precision)})：</strong>`;
 const effPrec = precision > 1 ? precision / 100 : precision;
 if (effPrec >= 0.8) {
 text += `精确率高，误报率低，模型判别能力强，不易将非火灾目标误判为火灾。</p>`;
 } else {
 text += `存在一定的误报率，建议检查训练数据中是否存在容易混淆的负样本，并考虑增加难例挖掘策略。</p>`;
 }
 }

 if (recall !== null) {
 text += `<p style="margin-top:8px;"><strong>召回率 Recall (${fmtVal(recall)})：</strong>`;
 const effRecall = recall > 1 ? recall / 100 : recall;
 if (effRecall >= 0.8) {
 text += `召回率高，模型能够捕获绝大多数真实火灾目标，漏检率低，适合实际巡检场景部署。</p>`;
 } else {
 text += `召回率偏低，存在漏检风险。在森林防火场景中漏检可能导致严重后果，建议降低置信度阈值或增加训练样本数量。</p>`;
 }
 }

 text += `<p style="margin-top:16px;"><strong>部署建议：</strong>`;
 if (effectiveMap50 >= 0.7) {
 text += `模型整体性能满足实际部署要求，可结合实际场景调整置信度阈值，平衡精确率与召回率。建议在部署时配置报警阈值为 0.5-0.7 之间。</p>`;
 } else {
 text += `建议继续优化模型后再进行部署，可尝试增加数据、调整学习率、使用预训练权重或更换更大的模型架构。</p>`;
 }

 assessmentText.innerHTML = text;
 }

 /* ---------- Start ---------- */
 document.addEventListener('DOMContentLoaded', init);
})();
