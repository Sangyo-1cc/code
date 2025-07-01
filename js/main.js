import { calculateAngle, wrapText } from './utils.js';
import { SquatAnalyzer } from './analyzer.js';
import { updateStatus, showRegularResults, showNoSquatResults } from './ui.js';
import { PoseLandmarker, FilesetResolver, DrawingUtils } from "https://cdn.skypack.dev/@mediapipe/tasks-vision@0.10.12";

// ================================= DOM 요소 참조 =================================
const getElement = (id) => document.getElementById(id);

const uploadSection = getElement('upload-section');
const analysisSection = getElement('analysis-section');
const resultSection = getElement('result-section');
const videoUpload = getElement("videoUpload");
const video = getElement("analysisVideo");
const videoContainer = getElement("videoContainer");
const canvasElement = getElement("output_canvas");
const canvasCtx = canvasElement?.getContext("2d");
const statusElement = getElement("status");
const feedbackList = getElement("feedbackList");
const shareStoryBtn = getElement("shareStoryBtn");
const storyCanvas = getElement('story-canvas');
const storyCtx = storyCanvas?.getContext('2d');
const coachFeedbackArea = getElement('coach-feedback-area');
const storyCanvasContainer = getElement('story-canvas-container');
const startAnalysisBtn = getElement('startAnalysisBtn');
const resetBtn = getElement('resetBtn');
const noSquatResultArea = getElement('no-squat-result-area');
const initialStatus = getElement('initial-status');
const adOverlay = getElement('ad-overlay');
const snsShareBtn = getElement('snsShareBtn');

// 진행률 바 관련 요소
const progressContainer = document.getElementById('progress-container');
const analysisProgress = document.getElementById('analysis-progress');
const progressPercent = document.getElementById('progress-percent');

// ================================= 전역 변수 및 상태 관리 =================================
let poseLandmarker;
let squatAnalyzer;
let animationFrameId;

let squatCount = 0;
let bestMomentTime = 0;
let lowestKneeAngle = 180;
let analysisStarted = false;

const DEBUG_MODE = true; // 개발 완료 후 false로 전환

// 다크모드/테마 토글 기능
const themeToggleBtn = document.getElementById('theme-toggle');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
function setTheme(theme) {
    document.body.setAttribute('data-theme', theme);
    if (themeToggleBtn) themeToggleBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
    localStorage.setItem('theme', theme);
}
function toggleTheme() {
    const current = document.body.getAttribute('data-theme') || (prefersDark ? 'dark' : 'light');
    setTheme(current === 'dark' ? 'light' : 'dark');
}
if (themeToggleBtn) themeToggleBtn.addEventListener('click', toggleTheme);
// 페이지 로드 시 테마 적용
const savedTheme = localStorage.getItem('theme');
setTheme(savedTheme || (prefersDark ? 'dark' : 'light'));

function getQualitativeFeedback(score) {
    if (score >= 90) return "완벽에 가까운 스쿼트! 자세 교본으로 써도 되겠어요. 👏";
    if (score >= 80) return "훌륭해요! 안정적인 자세가 돋보입니다. 여기서 만족하지 않으실 거죠? 😉";
    if (score >= 70) return "좋아요! 기본기가 탄탄하시네요. 조금만 더 깊이에 신경 쓰면 완벽할 거예요.";
    if (score >= 50) return "잘하고 있어요! 조금만 더 꾸준히 하면 금방 좋아질 거예요. 화이팅!";
    if (score >= 30) return "음, 이게 스쿼트일까요? 🕺 열정은 100점! 자세는 우리와 함께 만들어가요!";
    return "앗, 앉으려다 마신 건 아니죠? 😅 괜찮아요, 모든 시작은 미약하니까요!";
}

async function createShareableImage(finalScore, qualitativeFeedback) {
    if (!video || !video.duration || !video.videoWidth || !video.videoHeight || !storyCanvas || !storyCtx) return;
    storyCanvas.style.display = 'block';
    const tempVideoCanvas = document.createElement('canvas');
    const tempVideoCtx = tempVideoCanvas.getContext('2d');
    video.currentTime = bestMomentTime;
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            video.removeEventListener('seeked', onSeeked);
            reject(new Error('Video seek timeout'));
        }, 5000);
        const onSeeked = () => {
            clearTimeout(timeout);
            video.removeEventListener('seeked', onSeeked);
            resolve();
        };
        video.addEventListener('seeked', onSeeked, { once: true });
    });
    tempVideoCanvas.width = video.videoWidth;
    tempVideoCanvas.height = video.videoHeight;
    tempVideoCtx.drawImage(video, 0, 0, tempVideoCanvas.width, tempVideoCanvas.height);
    const storyWidth = 1080, storyHeight = 1920;
    storyCanvas.width = storyWidth;
    storyCanvas.height = storyHeight;
    storyCtx.fillStyle = '#1a1a1a';
    storyCtx.fillRect(0, 0, storyWidth, storyHeight);
    const videoAspectRatio = tempVideoCanvas.width / tempVideoCanvas.height;
    const outputWidth = storyWidth;
    const outputHeight = outputWidth / videoAspectRatio;
    const yPos = (storyHeight - outputHeight) / 2.5;
    storyCtx.drawImage(tempVideoCanvas, 0, yPos, outputWidth, outputHeight);
    const gradient = storyCtx.createLinearGradient(0, 0, 0, storyHeight);
    gradient.addColorStop(0, 'rgba(0,0,0,0.6)');
    gradient.addColorStop(0.5, 'rgba(0,0,0,0.2)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.8)');
    storyCtx.fillStyle = gradient;
    storyCtx.fillRect(0, 0, storyWidth, storyHeight);
    storyCtx.textAlign = 'center';
    storyCtx.fillStyle = 'white';
    storyCtx.shadowColor = 'rgba(0,0,0,0.5)';
    storyCtx.shadowBlur = 10;
    storyCtx.font = 'bold 120px "Noto Sans KR", sans-serif';
    storyCtx.fillText('✨ 최고의 순간 ✨', storyWidth / 2, yPos - 50);
    storyCtx.font = 'bold 250px "Noto Sans KR", sans-serif';
    storyCtx.fillStyle = '#FFC107';
    storyCtx.fillText(finalScore, storyWidth / 2, storyHeight - 350);
    storyCtx.font = '60px "Noto Sans KR", sans-serif';
    storyCtx.fillStyle = 'white';
    storyCtx.fillText('/100', storyWidth / 2 + 250, storyHeight - 350);
    storyCtx.shadowBlur = 0;
    storyCtx.font = '55px "Noto Sans KR", sans-serif';
    wrapText(storyCtx, qualitativeFeedback, storyWidth / 2, storyHeight - 200, storyWidth - 100, 70);
}

function setStatus(message, type = 'info', showRetry = false, retryHandler = null) {
    if (!statusElement) return;
    let icon = '';
    switch(type) {
        case 'loading': icon = '⏳'; break;
        case 'success': icon = '✅'; break;
        case 'error': icon = '❌'; break;
        default: icon = 'ℹ️'; break;
    }
    statusElement.innerHTML = `<span style="font-size:1.3em;">${icon}</span> ${message}`;
    if (showRetry && typeof retryHandler === 'function') {
        const retryBtn = document.createElement('button');
        retryBtn.textContent = '다시 시도';
        retryBtn.className = 'button-secondary';
        retryBtn.style.marginLeft = '12px';
        retryBtn.onclick = retryHandler;
        statusElement.appendChild(retryBtn);
    }
}

// ================================= 초기화 및 설정 =================================
async function createPoseLandmarker() {
    setStatus('AI 모델을 로딩중입니다...', 'loading');
    if (initialStatus) initialStatus.innerHTML = `<span class=\"loading\"></span> AI 모델을 로딩중입니다...`;
    try {
        const filesetResolver = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/wasm");
        poseLandmarker = await PoseLandmarker.createFromOptions(filesetResolver, {
            baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`,
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numPoses: 1
        });
        setStatus('AI 모델 준비 완료!', 'success');
        if (initialStatus) initialStatus.textContent = 'AI 모델 준비 완료!';
    } catch (error) {
        console.error("MODEL_LOAD_ERROR:", error);
        setStatus('❌ 모델 로딩 실패. 새로고침 해주세요.', 'error', true, () => window.location.reload());
        if (initialStatus) initialStatus.textContent = '❌ 모델 로딩 실패. 새로고침 해주세요.';
    }
}

function resetApp() {
    squatCount = 0;
    bestMomentTime = 0;
    lowestKneeAngle = 180;
    analysisStarted = false;
    if (squatAnalyzer) squatAnalyzer.reset();
    if (uploadSection) uploadSection.style.display = 'block';
    if (analysisSection) analysisSection.style.display = 'none';
    if (resultSection) resultSection.style.display = 'none';
    if (startAnalysisBtn) {
        startAnalysisBtn.disabled = false;
        startAnalysisBtn.innerHTML = '<span class="btn-icon">🔬</span><span class="btn-text">이 영상으로 분석 시작하기</span>';
    }
    if (video && video.src) {
        video.pause();
        video.removeAttribute('src');
        video.load();
    }
    if (canvasCtx && canvasElement) {
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    }
    if (initialStatus) initialStatus.textContent = '';
    if (statusElement) statusElement.innerHTML = '';
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
}

function handleVideoUpload(event) {
    const file = event.target.files[0];
    if (!file || !uploadSection || !analysisSection || !video) {
        setStatus('영상 업로드에 실패했습니다. 파일을 다시 선택해 주세요.', 'error', true, () => resetApp());
        return;
    }
    uploadSection.style.display = 'none';
    analysisSection.style.display = 'block';
    const fileURL = URL.createObjectURL(file);
    video.src = fileURL;
    video.play();
    setStatus('영상이 업로드되었습니다. 분석을 시작해 주세요.', 'success');
}

function setupVideoDisplay() {
    if (!video || !videoContainer || !canvasElement) return;
    const aspectRatio = video.videoWidth / video.videoHeight;
    let newWidth = videoContainer.clientWidth;
    let newHeight = newWidth / aspectRatio;
    videoContainer.style.height = `${newHeight}px`;
    canvasElement.width = newWidth;
    canvasElement.height = newHeight;
    previewLoop();
}

function previewLoop() {
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    if (!video || video.paused || video.ended || !canvasCtx || !canvasElement) return;
    canvasCtx.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);
    animationFrameId = requestAnimationFrame(previewLoop);
}

function startAnalysis() {
    if (!video || !startAnalysisBtn) return;
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    analysisStarted = true;
    setStatus('🔬 분석 중...', 'loading');
    startAnalysisBtn.disabled = true;
    startAnalysisBtn.innerHTML = '<span class="btn-icon">⏳</span><span class="btn-text">분석 중...</span>';
    video.loop = false;
    video.currentTime = 0;
    video.play();
    if (progressContainer) progressContainer.style.display = 'block';
    if (analysisProgress) analysisProgress.value = 0;
    if (progressPercent) progressPercent.textContent = '0%';
    processVideoFrame();
}

const coachMessage = document.getElementById('coach-message');

// 반복별 피드백 저장
let repFeedbacks = [];

// SquatAnalyzer의 analyzeBetterSquat에서 반복별 피드백 기록
// (아래는 기존 analyzeBetterSquat 내부에 들어갈 코드 예시)
// if (this.squatPhase === 'ascending' && ...스쿼트 완료 조건...) {
//   repFeedbacks.push({ depthScore, backScore, kneeAngle, torsoAngle, ... });
// }

async function endAnalysis() {
    setStatus('분석이 완료되었습니다!', 'success');
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    if (analysisSection) analysisSection.style.display = 'none';
    if (resultSection) resultSection.style.display = 'block';
    if (progressContainer) progressContainer.style.display = 'none';
    if (squatCount > 0) {
        showRegularResults();
        const finalScores = {
            depth: squatAnalyzer.frameCount > 0 ? Math.round(squatAnalyzer.totalScores.depth / squatAnalyzer.frameCount) : 0,
            backPosture: squatAnalyzer.frameCount > 0 ? Math.round(squatAnalyzer.totalScores.backPosture / squatAnalyzer.frameCount) : 0
        };
        const finalTotalScore = Math.round((finalScores.depth + finalScores.backPosture) / 2);
        const qualitativeFeedback = getQualitativeFeedback(finalTotalScore);
        await createShareableImage(finalTotalScore, qualitativeFeedback);
        if (feedbackList) feedbackList.textContent = qualitativeFeedback;
        // 반복별 피드백 요약
        if (coachMessage && repFeedbacks.length > 0) {
            let best = repFeedbacks.reduce((a, b) => (a.depthScore + a.backScore > b.depthScore + b.backScore ? a : b));
            let worst = repFeedbacks.reduce((a, b) => (a.depthScore + a.backScore < b.depthScore + b.backScore ? a : b));
            let msg = `총 <b>${repFeedbacks.length}</b>회 스쿼트 중<br>`;
            msg += `가장 좋은 자세는 <b>${Math.round((best.depthScore + best.backScore)/2)}</b>점!<br>`;
            msg += `아쉬운 자세는 <b>${Math.round((worst.depthScore + worst.backScore)/2)}</b>점.<br>`;
            if (best.depthScore > 90) msg += '깊이와 등 각도가 훌륭해요! 👍<br>';
            if (worst.depthScore < 60) msg += '조금 더 깊게 앉아보면 어떨까요?⬇️<br>';
            if (worst.backScore < 60) msg += '허리 각도에 신경 써주세요! 🦵<br>';
            msg += '계속 연습하면 더 좋아질 거예요! 💪';
            coachMessage.innerHTML = msg;
        } else if (coachMessage) {
            coachMessage.innerHTML = '분석 결과가 준비되었습니다!';
        }
    } else {
        setStatus('스쿼트가 감지되지 않았습니다. 영상을 다시 확인해 주세요.', 'error');
        showNoSquatResults();
        if (coachMessage) coachMessage.innerHTML = '스쿼트가 감지되지 않았어요. 다른 영상을 시도해보세요!';
    }
}

function processVideoFrame() {
    if (!poseLandmarker || !video || video.ended || !canvasCtx || !canvasElement) {
        if (video && video.ended) endAnalysis();
        return;
    }
    // 진행률 계산 및 표시
    if (video && analysisProgress && progressPercent) {
        const percent = video.duration ? Math.min(100, Math.round((video.currentTime / video.duration) * 100)) : 0;
        analysisProgress.value = percent;
        progressPercent.textContent = percent + '%';
    }
    poseLandmarker.detectForVideo(video, performance.now(), (result) => {
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        canvasCtx.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);
        const drawingUtils = new DrawingUtils(canvasCtx);
        if (result.landmarks && result.landmarks.length > 0) {
            drawingUtils.drawLandmarks(result.landmarks[0], {color: '#FFC107', lineWidth: 2});
            drawingUtils.drawConnectors(result.landmarks[0], PoseLandmarker.POSE_CONNECTIONS, {color: '#FFFFFF', lineWidth: 2});
            squatAnalyzer.analyzeBetterSquat(result.landmarks);
        } else {
            if (DEBUG_MODE) console.log("POSE_DETECTION_STATUS: 랜드마크가 감지되지 않음");
        }
    });
    animationFrameId = requestAnimationFrame(processVideoFrame);
}

function getShareMessage() {
    // 결과 점수/피드백/앱 링크 등 공유 메시지 구성
    const score = feedbackList?.textContent || 'AI 스쿼트 분석 결과!';
    return `🏋️‍♀️ 내 스쿼트 분석 결과\n${score}\n지금 AI 스쿼트 코치에서 자세를 분석해보세요!`;
}

async function handleSnsShare() {
    const message = getShareMessage();
    // 결과 이미지(스토리 캔버스) 데이터 URL
    let imageUrl = '';
    if (storyCanvas) {
        imageUrl = storyCanvas.toDataURL('image/png');
    }
    // Web Share API 지원 시
    if (navigator.share) {
        try {
            await navigator.share({
                title: 'AI 스쿼트 분석 결과',
                text: message,
                url: window.location.href
            });
            return;
        } catch (e) { /* 사용자가 취소 등 */ }
    }
    // 트위터 공유 fallback
    const tweet = encodeURIComponent(message + '\n' + window.location.href);
    window.open(`https://twitter.com/intent/tweet?text=${tweet}`, '_blank');
}

// ================================= 이벤트 리스너 =================================
document.addEventListener('DOMContentLoaded', () => {
    squatAnalyzer = new SquatAnalyzer();
    createPoseLandmarker();
    const fileLabel = document.querySelector('.file-label');
    if (fileLabel && videoUpload) {
        fileLabel.addEventListener('click', () => videoUpload.click());
    }
});

videoUpload?.addEventListener('change', handleVideoUpload);
video?.addEventListener('loadedmetadata', setupVideoDisplay);
video?.addEventListener('ended', () => { if(video && !video.loop && analysisStarted) endAnalysis(); });
startAnalysisBtn?.addEventListener('click', (event) => { event.preventDefault(); startAnalysis(); });
resetBtn?.addEventListener('click', (event) => { event.preventDefault(); videoUpload.value = ''; resetApp(); });
shareStoryBtn?.addEventListener('click', (event) => { 
    event.preventDefault();
    if (squatCount === 0) {
        alert("스쿼트가 감지되지 않아 결과 이미지를 다운로드할 수 없습니다.");
        return;
    }
    const dataURL = storyCanvas?.toDataURL('image/png');
    if (dataURL) {
        const link = document.createElement('a');
        link.download = `squat-analysis-story-${Date.now()}.png`;
        link.href = dataURL;
        link.click();
    }
});

if (snsShareBtn) snsShareBtn.addEventListener('click', handleSnsShare); 