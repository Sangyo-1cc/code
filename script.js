import { PoseLandmarker, FilesetResolver, DrawingUtils } from "https://cdn.skypack.dev/@mediapipe/tasks-vision@0.10.12";

// DOM 요소 참조 (전역 스코프 유지)
const getElement = (id) => {
    const element = document.getElementById(id);
    if (!element) console.warn(`Element with id '${id}' not found`);
    return element;
};

// 🌟 [수정됨] 모든 변수 선언 포함 🌟
const videoUpload = getElement("videoUpload");
const video = getElement("analysisVideo");
const canvasElement = getElement("output_canvas");
const canvasCtx = canvasElement?.getContext("2d");
const videoContainer = getElement("videoContainer");
const statusElement = getElement("status");
const feedbackList = getElement("feedbackList");
const shareStoryBtn = getElement("shareStoryBtn");
const uploadSection = getElement('upload-section');
const analysisSection = getElement('analysis-section');
const resultSection = getElement('result-section');
const storyCanvas = getElement('story-canvas');
const storyCtx = storyCanvas?.getContext('2d');
const coachFeedbackArea = getElement('coach-feedback-area');
const storyCanvasContainer = getElement('story-canvas-container');
const startAnalysisBtn = getElement('startAnalysisBtn');
const resetBtn = getElement('resetBtn');
const noSquatResultArea = getElement('no-squat-result-area');
const initialStatus = getElement('initial-status');

// 스쿼트 분석 관련 변수 (전역 스코프 유지)
let poseLandmarker, squatCount = 0, bestMomentTime = 0, lowestKneeAngle = 180, animationFrameId, analysisStarted = false;
let squatAnalyzer;

// 디버그 모드 토글 (개발 시 true, 배포 시 false)
const DEBUG_MODE = true;

// 🌟 [새로운 기능] 훨씬 안정적인 광고 로딩 함수 🌟
function loadAd(adContainer) {
    if (!adContainer || adContainer.hasAttribute('data-ad-loaded')) {
        return;
    }
    adContainer.setAttribute('data-ad-loaded', 'true');
    let attempts = 0;
    const maxAttempts = 15;
    const tryLoad = () => {
        const containerWidth = adContainer.getBoundingClientRect().width;
        if (containerWidth > 0) {
            console.log(`Ad container is visible (width: ${containerWidth}px), pushing ad.`);
            try {
                (window.adsbygoogle = window.adsbygoogle || []).push({});
            } catch (e) {
                console.error("adsbygoogle.push() failed:", e);
            }
        } else if (attempts < maxAttempts) {
            attempts++;
            console.log(`Ad container width is 0. Retrying... (Attempt ${attempts})`);
            setTimeout(tryLoad, 100);
        } else {
            console.error('Ad container failed to get a width after multiple attempts.');
        }
    };
    tryLoad();
}

// ======== 유틸리티 함수들 ========
function calculateAngle(point1, point2, point3) {
    const vector1 = { x: point1.x - point2.x, y: point1.y - point2.y };
    const vector2 = { x: point3.x - point2.x, y: point3.y - point2.y };
    const dot = vector1.x * vector2.x + vector1.y * vector2.y;
    const mag1 = Math.sqrt(vector1.x * vector1.x + vector1.y * vector1.y);
    const mag2 = Math.sqrt(vector2.x * vector2.x + vector2.y * vector2.y);
    if (mag1 === 0 || mag2 === 0) return 0;
    const cosAngle = dot / (mag1 * mag2);
    const clampedCos = Math.max(-1, Math.min(1, cosAngle));
    return Math.acos(clampedCos) * (180 / Math.PI);
}

function updateStatus(message, isLoading = false) {
    if (statusElement) statusElement.innerHTML = isLoading ? `<span class="loading"></span> ${message}` : message;
}

function showRegularResults() {
    if(storyCanvasContainer) storyCanvasContainer.style.display = 'block';
    if(noSquatResultArea) noSquatResultArea.style.display = 'none';
    if(coachFeedbackArea) coachFeedbackArea.style.display = 'block';
    if(shareStoryBtn) shareStoryBtn.style.display = 'block';
}

function showNoSquatResults() {
    if(noSquatResultArea) {
        noSquatResultArea.innerHTML = `<h2>분석 실패! 🤖</h2><p style="margin-top: 20px;">유효한 스쿼트 동작을 인식하지 못했습니다.</p><p>자세나 영상 각도를 확인 후 다시 시도해보세요.</p><p class="privacy-note">**개인 정보 보호:** 업로드하신 영상은 사용자 기기에서만 분석되며, **어떠한 영상도 서버에 저장되지 않습니다.**</p>`;
        noSquatResultArea.style.display = 'block';
    }
    if(storyCanvasContainer) storyCanvasContainer.style.display = 'none';
    if(coachFeedbackArea) coachFeedbackArea.style.display = 'none';
    if(shareStoryBtn) shareStoryBtn.style.display = 'none';
}

function getDetailedFeedback(scores) {
    const feedbackMessages = [];
    let overallFeedbackClass = 'feedback-good'; 
    if (scores.depth < 60) {
        feedbackMessages.push('<span class="feedback-warning">⚠️</span> **깊이가 아쉬워요!** 허벅지가 지면과 평행하게 내려가도록 노력해 보세요.');
        overallFeedbackClass = 'feedback-warning';
    } else if (scores.depth < 80) {
        feedbackMessages.push('<span class="feedback-info">💡</span> 스쿼트 깊이는 좋아요! 조금 더 깊이 앉으면 더 큰 효과를 볼 수 있어요.');
    } else {
        feedbackMessages.push('<span class="feedback-good">👍</span> **완벽한 깊이!** 아주 안정적으로 내려가셨어요.');
    }
    if (scores.backPosture < 60) {
        feedbackMessages.push('<span class="feedback-warning">⚠️</span> **상체가 너무 숙여지거나 굽혀졌어요.** 가슴을 펴고 시선을 정면으로 유지해 보세요!');
        overallFeedbackClass = 'feedback-warning';
    } else if (scores.backPosture < 80) {
        feedbackMessages.push('<span class="feedback-info">💡</span> 상체 자세는 괜찮아요. 코어에 좀 더 힘을 주면 더욱 안정적일 거예요.');
    } else {
        feedbackMessages.push('<span class="feedback-good">👍</span> **훌륭한 등 자세!** 부상 위험 없이 바른 자세를 유지하셨어요.');
    }
    if (scores.kneeAlignment < 60) {
        feedbackMessages.push('<span class="feedback-warning">⚠️</span> **무릎이 안으로 모이거나 발끝을 너무 넘어갔어요.** 무릎이 발끝 방향과 일직선이 되도록 신경 써 주세요!');
        overallFeedbackClass = 'feedback-warning';
    } else if (scores.kneeAlignment < 80) {
        feedbackMessages.push('<span class="feedback-info">💡</span> 무릎 정렬은 나쁘지 않아요. 스쿼트 시 무릎과 발의 정렬을 항상 의식해 보세요.');
    } else {
        feedbackMessages.push('<span class="feedback-good">👍</span> **안정적인 무릎 정렬!** 무릎 부담을 줄이는 바른 자세예요.');
    }
    if (scores.control < 60) {
        feedbackMessages.push('<span class="feedback-warning">⚠️</span> **움직임이 너무 빠르거나 불안정했어요.** 천천히, 통제된 움직임으로 스쿼트 해보세요.');
        overallFeedbackClass = 'feedback-warning';
    } else if (scores.control < 80) {
        feedbackMessages.push('<span class="feedback-info">💡</span> 움직임 제어는 괜찮아요. 더욱 천천히, 근육의 움직임을 느끼며 수행해 보세요.');
    } else {
        feedbackMessages.push('<span class="feedback-good">👍</span> **완벽한 컨트롤!** 아주 부드럽고 안정적인 스쿼트였어요.');
    }
    if (feedbackMessages.length === 0) {
        feedbackMessages.push('<span class="feedback-good">✨</span> **AI 코치도 놀란 완벽한 스쿼트!** 이대로 꾸준히 노력하면 됩니다!');
    }
    let overallMessage;
    if (scores.total >= 90) overallMessage = "완벽에 가까운 스쿼트! 자세 교본으로 써도 되겠어요. 👏";
    else if (scores.total >= 80) overallMessage = "훌륭해요! 안정적인 자세가 돋보입니다. 😉";
    else if (scores.total >= 70) overallMessage = "좋아요! 기본기가 탄탄하시네요. 조금만 더 신경 쓰면 완벽할 거예요.";
    else if (scores.total >= 50) overallMessage = "잘하고 있어요! 꾸준히 하면 좋아질 거예요. 화이팅!";
    else overallMessage = "아직 개선할 점이 많지만, 시작이 반! 우리와 함께 만들어가요! 💪";
    feedbackMessages.unshift(`<p style="font-weight: bold; font-size: 1.2em;">${overallMessage}</p><hr style="border: 0; height: 1px; background: #eee; margin: 10px 0;">`);
    return { html: `<div class="${overallFeedbackClass}">${feedbackMessages.join('<br>')}</div>`, overallScore: scores.total };
}

async function createShareableImage(finalScore, detailedFeedbackHtml) {
    if (!video || !video.duration || !video.videoWidth || !video.videoHeight || !storyCanvas || !storyCtx) return;
    storyCanvas.style.display = 'block';
    const tempVideoCanvas = document.createElement('canvas');
    const tempVideoCtx = tempVideoCanvas.getContext('2d');
    video.currentTime = bestMomentTime;
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { video.removeEventListener('seeked', onSeeked); reject(new Error('Video seek timeout')); }, 5000);
        const onSeeked = () => { clearTimeout(timeout); video.removeEventListener('seeked', onSeeked); resolve(); };
        video.addEventListener('seeked', onSeeked);
    });
    tempVideoCanvas.width = video.videoWidth;
    tempVideoCanvas.height = video.videoHeight;
    tempVideoCtx.drawImage(video, 0, 0, tempVideoCanvas.width, tempVideoCanvas.height);
    const storyWidth = 1080, storyHeight = 1920; 
    storyCanvas.width = storyWidth;
    storyCanvas.height = storyHeight;
    storyCtx.fillStyle = '#1a1a1a';
    storyCtx.fillRect(0, 0, storyWidth, storyHeight);
    const gradient = storyCtx.createLinearGradient(0, 0, 0, storyHeight);
    gradient.addColorStop(0, 'rgba(0,0,0,0.7)');
    gradient.addColorStop(0.5, 'rgba(0,0,0,0.3)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.9)');
    storyCtx.fillStyle = gradient;
    storyCtx.fillRect(0, 0, storyWidth, storyHeight);
    const videoAspectRatio = tempVideoCanvas.width / tempVideoCanvas.height;
    const outputWidth = storyWidth * 0.9; 
    const outputHeight = outputWidth / videoAspectRatio;
    const xPosVideo = (storyWidth - outputWidth) / 2;
    const yPosVideo = (storyHeight * 0.5 - outputHeight) / 2; 
    storyCtx.drawImage(tempVideoCanvas, xPosVideo, yPosVideo, outputWidth, outputHeight);
    storyCtx.shadowColor = 'rgba(0,0,0,0.5)';
    storyCtx.shadowBlur = 10;
    storyCtx.textAlign = 'center';
    storyCtx.fillStyle = 'white';
    storyCtx.font = 'bold 120px "Noto Sans KR", sans-serif';
    storyCtx.fillText('✨ 최고의 순간 ✨', storyWidth / 2, yPosVideo - 50);
    storyCtx.font = 'bold 300px "Noto Sans KR", sans-serif'; 
    storyCtx.fillStyle = '#FFC107'; 
    storyCtx.fillText(finalScore, storyWidth / 2, storyHeight - 350);
    storyCtx.font = '80px "Noto Sans KR", sans-serif'; 
    storyCtx.fillStyle = 'white';
    storyCtx.fillText('/100', storyWidth / 2 + 250, storyHeight - 350); 
    storyCtx.
