// 1. 미디어파이프 라이브러리 및 유틸리티 임포트
import { PoseLandmarker, FilesetResolver, DrawingUtils } from "https://cdn.skypack.dev/@mediapipe/tasks-vision@0.10.12";

// ================================= DOM 요소 참조 =================================
const getElement = (id) => {
    const element = document.getElementById(id);
    if (!element) console.warn(`Element with id '${id}' not found`);
    return element;
};

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

// ================================= 전역 변수 및 상태 관리 =================================
let poseLandmarker;
let squatAnalyzer; 
let animationFrameId;

let squatCount = 0;
let bestMomentTime = 0;
let lowestKneeAngle = 180;
let analysisStarted = false;

const DEBUG_MODE = true; // 개발 완료 후 false로 전환

// ================================= 유틸리티 함수 =================================

function calculateAngle(point1, point2, point3) {
    const vector1 = { x: point1.x - point2.x, y: point1.y - point2.y };
    const vector2 = { x: point3.x - point2.x, y: point3.y - point2.y };
    const dot = vector1.x * vector2.x + vector1.y * vector2.y;
    const mag1 = Math.sqrt(vector1.x * vector1.x + vector1.y * vector1.y);
    const mag2 = Math.sqrt(vector2.x * vector2.x + vector2.y * vector2.y);
    if (mag1 === 0 || mag2 === 0) return 0;
    const cosAngle = dot / (mag1 * mag2);
    return Math.acos(Math.max(-1, Math.min(1, cosAngle))) * (180 / Math.PI);
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
        noSquatResultArea.innerHTML = `
            <div class="no-result-icon">🤖</div>
            <h2>분석 실패!</h2>
            <p>유효한 스쿼트 동작을 인식하지 못했습니다.</p>
            <p class="help-text">자세나 영상 각도를 확인 후 다시 시도해보세요.</p>
        `;
        noSquatResultArea.style.display = 'block';
    }
    if(storyCanvasContainer) storyCanvasContainer.style.display = 'none';
    if(coachFeedbackArea) coachFeedbackArea.style.display = 'none';
    if(shareStoryBtn) shareStoryBtn.style.display = 'none';
}

function getQualitativeFeedback(score) {
    if (score >= 90) return "완벽에 가까운 스쿼트! 자세 교본으로 써도 되겠어요. 👏";
    if (score >= 80) return "훌륭해요! 안정적인 자세가 돋보입니다. 여기서 만족하지 않으실 거죠? 😉";
    if (score >= 70) return "좋아요! 기본기가 탄탄하시네요. 조금만 더 깊이에 신경 쓰면 완벽할 거예요.";
    if (score >= 50) return "잘하고 있어요! 조금만 더 꾸준히 하면 금방 좋아질 거예요. 화이팅!";
    if (score >= 30) return "음, 이게 스쿼트일까요? 🕺 열정은 100점! 자세는 우리와 함께 만들어가요!";
    return "앗, 앉으려다 마신 건 아니죠? 😅 괜찮아요, 모든 시작은 미약하니까요!";
}

function wrapText(context, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    for(let n = 0; n < words.length; n++) {
        let testLine = line + words[n] + ' ';
        let metrics = context.measureText(testLine);
        if (metrics.width > maxWidth && n > 0) {
            context.fillText(line, x, y);
            line = words[n] + ' ';
            y += lineHeight;
        } else {
            line = testLine;
        }
    }
    context.fillText(line, x, y);
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

// ================================= SquatAnalyzer 클래스 =================================
class SquatAnalyzer {
    constructor() {
        this.reset();
        this.SMOOTHING_WINDOW = 3;
        this.STANDING_KNEE_THRESHOLD = 160;
        this.DESCENDING_KNEE_THRESHOLD = 150;
        this.BOTTOM_KNEE_THRESHOLD = 120;
        this.ASCENDING_KNEE_THRESHOLD = 125;
        this.MIN_SQUAT_DURATION_FRAMES = 5;
        this.MIN_BOTTOM_HOLD_FRAMES = 1;
    }

    reset() {
        this.angleHistory = [];
        this.velocityHistory = [];
        this.squatPhase = 'standing';
        this.frameCount = 0;
        this.totalScores = { depth: 0, backPosture: 0 };
        this.repReachedMinDepth = false;
        this.bottomHoldFrames = 0;
        this.feedbackMessages = new Set();
    }

    smoothAngle(newAngle) {
        this.angleHistory.push(newAngle);
        if (this.angleHistory.length > this.SMOOTHING_WINDOW) this.angleHistory.shift();
        return this.angleHistory.reduce((sum, angle) => sum + angle, 0) / this.angleHistory.length;
    }

    calculateMovementVelocity(currentAngle) {
        if (this.angleHistory.length < 2) return 0;
        const prevAngle = this.angleHistory[this.angleHistory.length - 2];
        const velocity = Math.abs(currentAngle - prevAngle);
        this.velocityHistory.push(velocity);
        if (this.velocityHistory.length > 5) this.velocityHistory.shift();
        return velocity;
    }

    validateSquatQuality(landmarks, kneeAngle) {
        const pose = landmarks[0];
        const leftKnee = pose[25];
        const rightKnee = pose[26];
        
        // 깊이 확인
        const hasProperDepth = kneeAngle <= this.BOTTOM_KNEE_THRESHOLD;
        
        // 제어된 움직임 확인
        const avgVelocity = this.velocityHistory.reduce((sum, v) => sum + v, 0) / this.velocityHistory.length;
        const hasControlledMovement = avgVelocity < 15;
        
        // 대칭적 움직임 확인
        const kneeDifference = Math.abs(leftKnee.y - rightKnee.y);
        const hasSymmetricMovement = kneeDifference < 0.05;
        
        return (hasProperDepth && hasControlledMovement) || (hasProperDepth && hasSymmetricMovement) || (hasControlledMovement && hasSymmetricMovement);
    }

    analyzeBetterSquat(landmarks) {
        if (!landmarks || landmarks.length === 0 || !landmarks[0]) {
            if (DEBUG_MODE) console.warn("LANDMARK_STATUS: 랜드마크 데이터 없음");
            return;
        }

        const pose = landmarks[0];
        const requiredLandmarks = [11, 12, 23, 24, 25, 26, 27, 28];
        
        for (let i = 0; i < requiredLandmarks.length; i++) {
            if (!pose[requiredLandmarks[i]] || pose[requiredLandmarks[i]].visibility < 0.3) {
                if (DEBUG_MODE) console.warn(`LANDMARK_STATUS: 필수 랜드마크 ${requiredLandmarks[i]}번 감지 실패`);
                return;
            }
        }

        const leftHip = pose[23];
        const rightHip = pose[24];
        const leftKnee = pose[25];
        const rightKnee = pose[26];
        const leftAnkle = pose[27];
        const rightAnkle = pose[28];
        
        const hip = {x:(leftHip.x + rightHip.x)/2, y:(leftHip.y + rightHip.y)/2};
        const knee = {x:(leftKnee.x + rightKnee.x)/2, y:(leftKnee.y + rightKnee.y)/2};
        const ankle = {x:(leftAnkle.x + rightAnkle.x)/2, y:(leftAnkle.y + rightAnkle.y)/2};
        const shoulder = {x:(pose[11].x+pose[12].x)/2, y:(pose[11].y+pose[12].y)/2};

        const rawKneeAngle = calculateAngle(hip, knee, ankle);
        const kneeAngle = this.smoothAngle(rawKneeAngle);
        const velocity = this.calculateMovementVelocity(kneeAngle);
        
        if (!this.validateSquatQuality(landmarks, kneeAngle)) {
            if (DEBUG_MODE) console.log("QUALITY_CHECK: 스쿼트 품질 기준 미달");
            return;
        }

        let depthScore = 0;
        if (kneeAngle >= 160) depthScore = 0;
        else if (kneeAngle <= 60) depthScore = 100;
        else depthScore = Math.round(100 - ((kneeAngle - 60) / (160 - 60)) * 100);
        depthScore = Math.max(0, depthScore);

        let backScore = 0;
        const torsoAngle = calculateAngle(shoulder, hip, { x: hip.x, y: hip.y - 1 });
        if (torsoAngle >= 10 && torsoAngle <= 50) {
            backScore = 100;
        } else if (torsoAngle < 10) {
            backScore = Math.max(0, 100 - (10 - torsoAngle) * 5);
        } else {
            backScore = Math.max(0, 100 - (torsoAngle - 50) * 3);
        }
        backScore = Math.max(0, backScore);

        switch (this.squatPhase) {
            case 'standing':
                if (kneeAngle <= this.DESCENDING_KNEE_THRESHOLD) {
                    this.squatPhase = 'descending';
                    this.frameCount = 0;
                    this.bottomHoldFrames = 0;
                    this.repReachedMinDepth = false;
                    this.totalScores = { depth: 0, backPosture: 0 };
                    if (DEBUG_MODE) console.log(`SQUAT_PHASE: DESCENDING (무릎 각도: ${kneeAngle.toFixed(2)})`);
                }
                break;

            case 'descending':
                if (kneeAngle <= this.BOTTOM_KNEE_THRESHOLD) {
                    this.bottomHoldFrames++;
                    if (this.bottomHoldFrames >= this.MIN_BOTTOM_HOLD_FRAMES) {
                        this.squatPhase = 'bottom';
                        this.repReachedMinDepth = true;
                        if (DEBUG_MODE) console.log(`SQUAT_PHASE: BOTTOM (무릎 각도: ${kneeAngle.toFixed(2)})`);
                    }
                } else if (kneeAngle > this.STANDING_KNEE_THRESHOLD) {
                    this.squatPhase = 'standing';
                    if (DEBUG_MODE) console.log(`SQUAT_PHASE: standing (하강 취소)`);
                }
                
                if (this.squatPhase === 'descending') {
                    this.frameCount++;
                    this.totalScores.depth += depthScore;
                    this.totalScores.backPosture += backScore;
                }
                break;

            case 'bottom':
                if (kneeAngle > this.ASCENDING_KNEE_THRESHOLD) {
                    this.squatPhase = 'ascending';
                    this.bottomHoldFrames = 0;
                    if (DEBUG_MODE) console.log(`SQUAT_PHASE: ASCENDING (무릎 각도: ${kneeAngle.toFixed(2)})`);
                }
                
                this.frameCount++;
                this.totalScores.depth += depthScore;
                this.totalScores.backPosture += backScore;
                break;

            case 'ascending':
                if (kneeAngle > this.STANDING_KNEE_THRESHOLD) {
                    this.squatPhase = 'standing';
                    if (this.repReachedMinDepth && this.frameCount >= this.MIN_SQUAT_DURATION_FRAMES) {
                        squatCount++;
                        if (DEBUG_MODE) console.log(`SQUAT_COUNT: 스쿼트 횟수 증가! 현재: ${squatCount}`);
                    }
                    this.repReachedMinDepth = false;
                    this.frameCount = 0;
                    this.totalScores = { depth: 0, backPosture: 0 };
                    this.bottomHoldFrames = 0;
                    if (DEBUG_MODE) console.log(`SQUAT_PHASE: standing (스쿼트 완료)`);
                }
                
                this.frameCount++;
                this.totalScores.depth += depthScore;
                this.totalScores.backPosture += backScore;
                break;
        }

        if (DEBUG_MODE) {
            console.log(`FRAME_DATA: Phase: ${this.squatPhase}, Knee: ${kneeAngle.toFixed(2)}, Torso: ${torsoAngle.toFixed(2)}, DepthScore: ${depthScore}, BackScore: ${backScore}, FrameCount: ${this.frameCount}`);
        }
    }
}

// ================================= 초기화 및 설정 =================================
async function createPoseLandmarker() {
    if (initialStatus) initialStatus.innerHTML = `<span class="loading"></span> AI 모델을 로딩중입니다...`;
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
        if (initialStatus) initialStatus.textContent = 'AI 모델 준비 완료!';
    } catch (error) {
        console.error("MODEL_LOAD_ERROR:", error);
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

// ================================= 이벤트 핸들러 =================================
function handleVideoUpload(event) {
    const file = event.target.files[0];
    if (!file || !uploadSection || !analysisSection || !video) return;

    uploadSection.style.display = 'none';
    analysisSection.style.display = 'block';
    
    const fileURL = URL.createObjectURL(file);
    video.src = fileURL;
    video.play();
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
    updateStatus('🔬 분석 중...', true);
    startAnalysisBtn.disabled = true;
    startAnalysisBtn.innerHTML = '<span class="btn-icon">⏳</span><span class="btn-text">분석 중...</span>';
    video.loop = false;
    video.currentTime = 0;
    video.play();
    processVideoFrame();
}

async function endAnalysis() {
    updateStatus('✅ 분석 완료!');
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    if (analysisSection) analysisSection.style.display = 'none';
    if (resultSection) resultSection.style.display = 'block';

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
    } else {
        showNoSquatResults();
    }
}

function processVideoFrame() {
    if (!poseLandmarker || !video || video.ended || !canvasCtx || !canvasElement) {
        if (video && video.ended) endAnalysis();
        return;
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

// ================================= 이벤트 리스너 =================================
document.addEventListener('DOMContentLoaded', () => {
    squatAnalyzer = new SquatAnalyzer();
    createPoseLandmarker();
    
    // 파일 업로드 라벨 클릭 이벤트 추가
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
