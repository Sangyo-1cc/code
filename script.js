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
const adOverlay = getElement('ad-overlay'); // ✨ 광고 오버레이 요소 추가

// ================================= 전역 변수 및 상태 관리 =================================
let poseLandmarker;
let squatAnalyzer; 
let animationFrameId;

let squatCount = 0;
let bestMomentTime = 0;
let lowestKneeAngle = 180;
let analysisStarted = false;

const DEBUG_MODE = false; // 개발 완료 후 false로 전환

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
        noSquatResultArea.innerHTML = `<h2>분석 실패! 🤖</h2><p style="margin-top: 20px;">유효한 스쿼트 동작을 인식하지 못했습니다.</p><p>자세나 영상 각도를 확인 후 다시 시도해보세요.</p>`;
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
        this.feedbackMessages = new Set(); // ✨ 구체적 피드백을 담을 Set
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

        const hasProperDepth = kneeAngle <= this.BOTTOM_KNEE_THRESHOLD;
        const avgVelocity = this.velocityHistory.reduce((sum, v) => sum + v, 0) / this.velocityHistory.length;
        const hasControlledMovement = avgVelocity < 15;
        const kneeDifference = Math.abs(leftKnee.y - rightKnee.y);
        const hasSymmetricMovement = kneeDifference < 0.05;

        // ✨ 구체적 피드백 추가
        if (!hasControlledMovement) this.feedbackMessages.add("조금 더 천천히, 통제된 움직임으로 해보세요.");
        if (!hasSymmetricMovement) this.feedbackMessages.add("몸의 좌우 균형이 맞지 않아요. 양쪽 무릎 높이를 맞춰보세요.");
        
        return [hasProperDepth, hasControlledMovement, hasSymmetricMovement].filter(Boolean).length >= 2;
    }

    analyzeBetterSquat(landmarks) {
        if (!landmarks || landmarks.length === 0 || !landmarks[0]) return;
        
        const pose = landmarks[0];
        const required = [11, 12, 23, 24, 25, 26, 27, 28];
        for (let i of required) if (!pose[i] || pose[i].visibility < 0.3) return;

        const leftHip = pose[23], rightHip = pose[24], leftKnee = pose[25], rightKnee = pose[26], leftAnkle = pose[27], rightAnkle = pose[28];
        const hip = { x: (leftHip.x + rightHip.x) / 2, y: (leftHip.y + rightHip.y) / 2 };
        const knee = { x: (leftKnee.x + rightKnee.x) / 2, y: (leftKnee.y + rightKnee.y) / 2 };
        const ankle = { x: (leftAnkle.x + rightAnkle.x) / 2, y: (leftAnkle.y + rightAnkle.y) / 2 };
        const shoulder = { x: (pose[11].x + pose[12].x) / 2, y: (pose[11].y + pose[12].y) / 2 };

        const kneeAngle = this.smoothAngle(calculateAngle(hip, knee, ankle));
        this.calculateMovementVelocity(kneeAngle);

        if (!this.validateSquatQuality(landmarks, kneeAngle)) return;
        
        const torsoAngle = calculateAngle(shoulder, hip, ankle);
        if (torsoAngle < 70 || torsoAngle > 110) { // 허리가 너무 펴지거나 숙여지면
             this.feedbackMessages.add("허리가 너무 숙여지지 않도록 가슴을 펴주세요.");
        }

        // ✨ '최고의 순간' 포착 로직
        if (this.squatPhase === 'bottom' || this.squatPhase === 'descending') {
            if (kneeAngle < lowestKneeAngle) {
                lowestKneeAngle = kneeAngle;
                bestMomentTime = video.currentTime;
            }
        }
        
        switch (this.squatPhase) {
            case 'standing':
                if (kneeAngle <= this.DESCENDING_KNEE_THRESHOLD) {
                    this.squatPhase = 'descending';
                    this.frameCount = 0;
                    this.bottomHoldFrames = 0;
                    this.repReachedMinDepth = false;
                    this.totalScores = { depth: 0, backPosture: 0 };
                }
                break;
            case 'descending':
                this.frameCount++;
                if (kneeAngle <= this.BOTTOM_KNEE_THRESHOLD) {
                    this.bottomHoldFrames++;
                    if (this.bottomHoldFrames >= this.MIN_BOTTOM_HOLD_FRAMES) {
                        this.squatPhase = 'bottom';
                        this.repReachedMinDepth = true;
                    }
                } else if (kneeAngle > this.STANDING_KNEE_THRESHOLD) {
                    this.squatPhase = 'standing';
                }
                break;
            case 'bottom':
                this.frameCount++;
                if (kneeAngle > this.ASCENDING_KNEE_THRESHOLD) {
                    this.squatPhase = 'ascending';
                    this.bottomHoldFrames = 0;
                }
                break;
            case 'ascending':
                this.frameCount++;
                if (kneeAngle > this.STANDING_KNEE_THRESHOLD) {
                    this.squatPhase = 'standing';
                    if (this.repReachedMinDepth && this.frameCount >= this.MIN_SQUAT_DURATION_FRAMES) {
                        squatCount++;
                    }
                    this.repReachedMinDepth = false;
                }
                break;
        }
    }
}

// ================================= 핵심 기능 함수 =================================

async function createPoseLandmarker() {
    updateStatus('AI 모델을 로딩중입니다...', true);
    try {
        const filesetResolver = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.12/wasm");
        poseLandmarker = await PoseLandmarker.createFromOptions(filesetResolver, {
            baseOptions: {
                modelAssetPath: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarke_lite.task`,
                delegate: "GPU"
            },
            runningMode: "VIDEO",
            numPoses: 1
        });
        initialStatus.textContent = '✅ AI 모델 준비 완료!';
    } catch (error) {
        console.error("MODEL_LOAD_ERROR:", error);
        initialStatus.textContent = '❌ 모델 로딩 실패. 새로고침 해주세요.';
    }
}

function resetApp() {
    squatCount = 0;
    bestMomentTime = 0;
    lowestKneeAngle = 180;
    analysisStarted = false;
    
    squatAnalyzer?.reset();
    
    uploadSection.style.display = 'block';
    analysisSection.style.display = 'none';
    resultSection.style.display = 'none';
    
    startAnalysisBtn.disabled = false;
    startAnalysisBtn.textContent = "이 영상으로 분석 시작하기 🔬";
    
    if (video.src) {
        video.pause();
        URL.revokeObjectURL(video.src);
        video.removeAttribute('src');
        video.load();
    }
    
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    initialStatus.textContent = '✅ AI 모델 준비 완료!';
    statusElement.innerHTML = '';
    
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
}

function processVideoFrame() {
    if (!poseLandmarker || !video || video.ended || video.paused) {
        if (video && video.ended) endAnalysis();
        return;
    }

    poseLandmarker.detectForVideo(video, performance.now(), (result) => {
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        canvasCtx.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);
        
        if (result.landmarks && result.landmarks.length > 0) {
            const drawingUtils = new DrawingUtils(canvasCtx);
            drawingUtils.drawLandmarks(result.landmarks[0], { color: '#FFC107', lineWidth: 2 });
            drawingUtils.drawConnectors(result.landmarks[0], PoseLandmarker.POSE_CONNECTIONS, { color: '#FFFFFF', lineWidth: 2 });
            squatAnalyzer.analyzeBetterSquat(result.landmarks);
        }
    });
    animationFrameId = requestAnimationFrame(processVideoFrame);
}

async function endAnalysis() {
    updateStatus('✅ 분석 완료! 결과를 저장하고 있습니다...', true);
    if (animationFrameId) cancelAnimationFrame(animationFrameId);
    
    analysisSection.style.display = 'none';
    resultSection.style.display = 'block';

    if (squatCount > 0) {
        showRegularResults();
        const finalTotalScore = Math.min(100, Math.round(100 - (lowestKneeAngle - 60))); // 간단하고 직관적인 점수 계산
        
        // ✨ --- 백엔드에 데이터 전송 로직 --- ✨
        const dataToLog = {
            squatCount: squatCount,
            totalScore: finalTotalScore,
            depthScore: Math.round(100 * (180 - lowestKneeAngle) / (180 - 60)),
            backPosture: 0 // 현재는 점수 없으므로 0으로 기록
        };

        google.script.run
            .withSuccessHandler(message => {
                console.log(message);
                updateStatus('✅ 분석 완료! 결과가 시트에 저장되었습니다.');
            })
            .withFailureHandler(error => {
                console.error(error);
                alert(error.message);
                updateStatus(`❌ 분석 완료! 하지만 결과 저장 실패: ${error.message}`);
            })
            .logSquatData(dataToLog);

        const qualitativeFeedback = getQualitativeFeedback(finalTotalScore);
        const specificFeedbacks = Array.from(squatAnalyzer.feedbackMessages);

        if (specificFeedbacks.length > 0) {
            feedbackList.innerHTML = `<p>${qualitativeFeedback}</p><h4 style="margin-top:15px;">개선하면 좋은 점:</h4><ul>${specificFeedbacks.map(msg => `<li>${msg}</li>`).join('')}</ul>`;
        } else {
            feedbackList.innerHTML = `<p>${qualitativeFeedback}</p>`;
        }

        await createShareableImage(finalTotalScore, qualitativeFeedback);
    } else {
        showNoSquatResults();
    }
}

// ================================= 이벤트 리스너 =================================

document.addEventListener('DOMContentLoaded', () => {
    squatAnalyzer = new SquatAnalyzer();
    createPoseLandmarker();
});

videoUpload.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (!file) return;

    resetApp();
    uploadSection.style.display = 'none';
    analysisSection.style.display = 'block';
    
    const fileURL = URL.createObjectURL(file);
    video.src = fileURL;
    video.onloadedmetadata = () => {
        canvasElement.width = video.videoWidth;
        canvasElement.height = video.videoHeight;
    };
    video.play();
    requestAnimationFrame(processVideoFrame); // 미리보기 루프 시작
});

video.addEventListener('ended', () => {
    if (analysisStarted) endAnalysis();
});

// ✨ --- 광고 오버레이 로직이 포함된 새로운 분석 시작 이벤트 리스너 --- ✨
startAnalysisBtn.addEventListener('click', (event) => {
    event.preventDefault();
    if (!video || !adOverlay) return;

    // 1. 분석 시작 준비
    analysisStarted = true;
    startAnalysisBtn.disabled = true;
    startAnalysisBtn.textContent = "분석 중...";
    video.loop = false;
    video.pause();

    // 2. 광고 오버레이 표시
    adOverlay.classList.add('visible');

    // 3. 5초 후에 광고 숨기고 실제 분석 시작
    setTimeout(() => {
        adOverlay.classList.remove('visible');
        updateStatus('🔬 분석 중...', true);
        
        video.currentTime = 0;
        video.play();
        if (animationFrameId) cancelAnimationFrame(animationFrameId); // 기존 루프 중지
        requestAnimationFrame(processVideoFrame); // 분석 루프 다시 시작
    }, 5000); // 5초
});

resetBtn.addEventListener('click', (event) => {
    event.preventDefault();
    videoUpload.value = '';
    resetApp();
});

shareStoryBtn.addEventListener('click', (event) => {
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
