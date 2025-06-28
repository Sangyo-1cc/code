import { PoseLandmarker, FilesetResolver, DrawingUtils } from "https://cdn.skypack.dev/@mediapipe/tasks-vision@0.10.12";

// DOM 요소 참조 (전역 스코프 유지)
const getElement = (id) => {
    const element = document.getElementById(id);
    if (!element) console.warn(`Element with id '${id}' not found`);
    return element;
};

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

// SquatAnalyzer 인스턴스는 DOMContentLoaded 이후에 생성되도록 변경 (선언만 먼저)
let squatAnalyzer; 

// 디버그 모드 토글 (개발 시 true, 배포 시 false)
const DEBUG_MODE = true;

// ======== 유틸리티 함수들 (클래스 및 이벤트 리스너보다 먼저 정의되어야 함) ========

function calculateAngle(point1, point2, point3) {
    const vector1 = {
        x: point1.x - point2.x,
        y: point1.y - point2.y
    };
    const vector2 = {
        x: point3.x - point2.x,
        y: point3.y - point2.y
    };
    
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

async function createShareableImage(finalScore, qualitativeFeedback) {
    if (!video || !video.duration || !video.videoWidth || !video.videoHeight) return;
    if (!storyCanvas || !storyCtx) return;
    
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
    gradient.addColorStop(0, 'rgba(0,0,0,0.6)');
    gradient.addColorStop(0.5, 'rgba(0,0,0,0.2)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.8)');
    storyCtx.fillStyle = gradient;
    storyCtx.fillRect(0, 0, storyWidth, storyHeight);

    const videoAspectRatio = tempVideoCanvas.width / tempVideoCanvas.height;
    const outputWidth = storyWidth;
    const outputHeight = outputWidth / videoAspectRatio;
    const yPos = (storyHeight - outputHeight) / 2.5;

    storyCtx.drawImage(tempVideoCanvas, 0, yPos, outputWidth, outputHeight);

    storyCtx.font = 'bold 120px "Noto Sans KR", sans-serif';
    storyCtx.fillStyle = 'white';
    storyCtx.textAlign = 'center';
    storyCtx.shadowColor = 'rgba(0,0,0,0.5)';
    storyCtx.shadowBlur = 10;
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


// 개선된 스쿼트 분석 함수를 포함하는 클래스
class SquatAnalyzer {
    constructor() {
        // 모든 메서드에 'this' 바인딩
        this.smoothAngle = this.smoothAngle.bind(this);
        this.calculateMovementVelocity = this.calculateMovementVelocity.bind(this);
        this.validateSquatQuality = this.validateSquatQuality.bind(this);
        this.detectNonSquatMovement = this.detectNonSquatMovement.bind(this);
        this.analyzeBetterSquat = this.analyzeBetterSquat.bind(this);
        this.reset = this.reset.bind(this); // reset 메서드도 바인딩

        this.angleHistory = [];
        this.velocityHistory = [];
        this.SMOOTHING_WINDOW = 3;
        this.squatPhase = 'standing'; // 클래스 내부에서 상태 관리
        this.frameCount = 0; // 클래스 내부에서 프레임 카운트 관리
        this.totalScores = { depth: 0, backPosture: 0 }; // 클래스 내부에서 점수 누적 관리
        this.repReachedMinDepth = false; // 클래스 내부에서 최소 깊이 도달 여부 관리
        this.bottomHoldFrames = 0; // 클래스 내부에서 최하점 유지 프레임 관리

        this.squatQualityChecks = {
            hasProperDepth: false,
            hasControlledMovement: false,
            hasSymmetricMovement: false
        };

        // 임계값 (당신 제안 반영)
        this.STANDING_KNEE_THRESHOLD = 160;     // 서있는 상태
        this.DESCENDING_KNEE_THRESHOLD = 150;   // 하강 시작
        this.BOTTOM_KNEE_THRESHOLD = 120;       // 스쿼트 바닥 (더 엄격하게)
        this.ASCENDING_KNEE_THRESHOLD = 125;    // 상승 시작

        this.MIN_SQUAT_DURATION_FRAMES = 5; // 유효한 스쿼트 동작의 최소 프레임 수
        this.MIN_BOTTOM_HOLD_FRAMES = 1;    // 최하점 상태를 유지해야 하는 최소 프레임 수
    }

    // 각도 스무딩
    smoothAngle(newAngle) {
        this.angleHistory.push(newAngle);
        if (this.angleHistory.length > this.SMOOTHING_WINDOW) {
            this.angleHistory.shift();
        }
        return this.angleHistory.reduce((sum, angle) => sum + angle, 0) / this.angleHistory.length;
    }

    // 움직임 속도 계산 (갑작스러운 변화 감지)
    calculateMovementVelocity(currentAngle) {
        if (this.angleHistory.length < 2) return 0; // 최소 2개 각도 필요
        
        const prevAngle = this.angleHistory[this.angleHistory.length - 2];
        const velocity = Math.abs(currentAngle - prevAngle);
        
        this.velocityHistory.push(velocity);
        if (this.velocityHistory.length > 5) { // 속도 히스토리 5프레임 유지
            this.velocityHistory.shift();
        }
        
        return velocity;
    }

    // 스쿼트 품질 검증
    validateSquatQuality(kneeAngle, leftKnee, rightKnee, hip, velocity) {
        // 1. 적절한 깊이 확인
        this.squatQualityChecks.hasProperDepth = kneeAngle <= this.BOTTOM_KNEE_THRESHOLD; // 바닥 임계값 사용
        
        // 2. 제어된 움직임 (너무 빠르지 않은)
        const avgVelocity = this.velocityHistory.reduce((sum, v) => sum + v, 0) / this.velocityHistory.length;
        this.squatQualityChecks.hasControlledMovement = avgVelocity < 15; // 임계값 조정 가능 (프레임 단위 각도 변화)
        
        // 3. 대칭적 움직임 (좌우 무릎 높이 차이) - 정규화된 좌표 기준
        const kneeDifference = Math.abs(leftKnee.y - rightKnee.y);
        this.squatQualityChecks.hasSymmetricMovement = kneeDifference < 0.05; 
        
        // 3개 중 2개 이상 만족해야 유효한 스쿼트
        const qualityScore = Object.values(this.squatQualityChecks).filter(Boolean).length;
        return qualityScore >= 2; 
    }

    // 비스쿼트 동작 필터링
    detectNonSquatMovement(landmarks) {
        const pose = landmarks[0];
        
        // 1. 손 위치 확인 (춤추는 동작 감지)
        const leftWrist = pose[15];
        const rightWrist = pose[16];
        const leftShoulder = pose[11];
        const rightShoulder = pose[12];
        
        if (leftWrist && rightWrist && leftShoulder && rightShoulder) {
            const handsAboveShoulders = 
                (leftWrist.y < leftShoulder.y - 0.1) || 
                (rightWrist.y < rightShoulder.y - 0.1);
            
            if (handsAboveShoulders) {
                if (DEBUG_MODE) console.log("MOVEMENT_FILTER: 춤추는 동작 감지 - 스쿼트 분석 제외 (손 위치)");
                return true; 
            }
        }
        
        // 2. 상체 각도 확인 (너무 앞으로 기울어진 경우)
        const hip = {
            x: (pose[23].x + pose[24].x) / 2,
            y: (pose[23].y + pose[24].y) / 2
        };
        const shoulder = {
            x: (pose[11].x + pose[12].x) / 2,
            y: (pose[11].y + pose[12].y) / 2
        };
        
        const vertical = { x: hip.x, y: hip.y - 1 };
        const torsoAngle = calculateAngle(shoulder, hip, vertical); // 외부 calculateAngle 사용
        
        if (torsoAngle > 70) { 
            if (DEBUG_MODE) console.log("MOVEMENT_FILTER: 과도한 상체 기울임 감지 - 요가/스트레칭 동작으로 판단");
            return true;
        }
        
        return false; 
    }

    // 메인 분석 함수 (기존 analyzeSquat 함수를 개선)
    analyzeBetterSquat(landmarks) {
        const requiredLandmarks = [11, 12, 23, 24, 25, 26, 27, 28]; // 어깨, 엉덩이, 무릎, 발목
        
        if (!landmarks || landmarks.length === 0 || !landmarks[0]) {
            if (DEBUG_MODE) console.warn("LANDMARK_STATUS: 랜드마크 데이터 없음. 스쿼트 분석 건너뜀.");
            return;
        }
        
        const pose = landmarks[0];
        
        // 필수 랜드마크 확인
        for (let i = 0; i < requiredLandmarks.length; i++) {
            if (!pose[requiredLandmarks[i]] || pose[requiredLandmarks[i]].visibility < 0.3) {
                if (DEBUG_MODE) console.warn(`LANDMARK_STATUS: 필수 랜드마크 ${requiredLandmarks[i]}번이 감지되지 않거나 가시성(${pose[requiredLandmarks[i]]?.visibility.toFixed(2)})이 낮음. 스쿼트 분석 건너뛰기`);
                return;
            }
        }
        
        // 비스쿼트 동작 필터링
        if (this.detectNonSquatMovement(landmarks)) {
            return; 
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

        // 각도 계산 및 스무딩
        const rawKneeAngle = calculateAngle(hip, knee, ankle); 
        const kneeAngle = this.smoothAngle(rawKneeAngle);
        
        // 움직임 속도 계산
        const velocity = this.calculateMovementVelocity(kneeAngle);
        
        // 스쿼트 품질 검증
        const isValidSquat = this.validateSquatQuality(kneeAngle, leftKnee, rightKnee, hip, velocity);
        
        if (!isValidSquat) {
            if (DEBUG_MODE) console.log("QUALITY_CHECK: 스쿼트 품질 기준 미달 - 카운트 제외");
            return; 
        }
        
        // 점수 계산 (클래스 내부에서 계산하도록 변경)
        let depthScore = 0;
        if (kneeAngle >= 160) depthScore = 0; 
        else if (kneeAngle <= 60) depthScore = 100; 
        else { 
            depthScore = Math.round(100 - ((kneeAngle - 60) / (160 - 60)) * 100); 
        }
        depthScore = Math.round(Math.max(0, depthScore)); 
        
        let backScore = 0;
        const idealTorsoMin = 10;
        const idealTorsoMax = 50;
        const torsoAngle = calculateAngle(shoulder, hip, { x: hip.x, y: hip.y - 1 }); 
        
        if (torsoAngle >= idealTorsoMin && torsoAngle <= idealTorsoMax) {
            backScore = 100;
        } else if (torsoAngle < idealTorsoMin) {
            backScore = Math.round(Math.max(0, 100 - (idealTorsoMin - torsoAngle) * 5));
        } else {
            backScore = Math.round(Math.max(0, 100 - (torsoAngle - idealTorsoMax) * 3));
        }
        backScore = Math.round(Math.max(0, backScore)); 

        // 스쿼트 상태 머신 로직
        switch (this.squatPhase) {
            case 'standing':
                if (kneeAngle <= this.DESCENDING_KNEE_THRESHOLD) { 
                    this.squatPhase = 'descending';
                    this.frameCount = 0;
                    this.bottomHoldFrames = 0;
                    this.repReachedMinDepth = false; 
                    this.totalScores = { depth: 0, backPosture: 0 }; 
                    if (DEBUG_MODE) console.log(`SQUAT_PHASE: **DESCENDING** (무릎 각도: ${kneeAngle.toFixed(2)})`);
                } else {
                    if (DEBUG_MODE) console.log(`DEBUG_STANDING: Standing. Knee: ${kneeAngle.toFixed(2)}, DescendingThresh: ${this.DESCENDING_KNEE_THRESHOLD}`);
                }
                break;

            case 'descending':
                if (kneeAngle <= this.BOTTOM_KNEE_THRESHOLD) {
                    this.bottomHoldFrames++;
                    if (this.bottomHoldFrames >= this.MIN_BOTTOM_HOLD_FRAMES) { 
                        this.squatPhase = 'bottom';
                        this.repReachedMinDepth = true; 
                        if (DEBUG_MODE) console.log(`SQUAT_PHASE: **BOTTOM** (무릎 각도: ${kneeAngle.toFixed(2)}, 유지 프레임: ${this.bottomHoldFrames})`);
                    }
                } else if (kneeAngle > this.STANDING_KNEE_THRESHOLD) { 
                    this.squatPhase = 'standing';
                    if (DEBUG_MODE) console.log(`SQUAT_PHASE: standing (하강 취소, 무릎 각도: ${kneeAngle.toFixed(2)})`);
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
                    if (DEBUG_MODE) console.log(`SQUAT_PHASE: **ASCENDING** (무릎 각도: ${kneeAngle.toFixed(2)})`);
                }
                
                this.frameCount++; 
                this.totalScores.depth += depthScore;
                this.totalScores.backPosture += backScore;
                break;

            case 'ascending':
                if (kneeAngle > this.STANDING_KNEE_THRESHOLD) {
                    this.squatPhase = 'standing';
                    if (this.repReachedMinDepth && this.frameCount >= this.MIN_SQUAT_DURATION_FRAMES) {
                        squatCount++; // 전역 squatCount 증가
                        if (DEBUG_MODE) console.log(`SQUAT_COUNT: 스쿼트 횟수 증가! 현재 횟수: ${squatCount}, 총 프레임: ${this.frameCount}`);
                    } else {
                        if (DEBUG_MODE) console.log(`SQUAT_COUNT: 스쿼트 횟수 증가 실패. repReachedMinDepth: ${this.repReachedMinDepth}, frameCount: ${this.frameCount}`);
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
            console.log(`FRAME_DATA: Phase: ${this.squatPhase}, Knee: ${kneeAngle.toFixed(2)}, Torso: ${torsoAngle.toFixed(2)}, DepthScore: ${depthScore.toFixed(0)}, BackScore: ${backScore.toFixed(0)}, FrameCount: ${this.frameCount}, BottomHoldFrames: ${this.bottomHoldFrames}, HipY: ${hip.y.toFixed(2)}, KneeY: ${knee.y.toFixed(2)}, Velocity: ${velocity.toFixed(2)}, Quality: ${JSON.stringify(this.squatQualityChecks)}`);
        }
    }
    // reset 메서드 추가: SquatAnalyzer 내부 상태를 초기화
    reset() {
        this.angleHistory = [];
        this.velocityHistory = [];
        this.squatPhase = 'standing';
        this.frameCount = 0;
        this.totalScores = { depth: 0, backPosture: 0 };
        this.repReachedMinDepth = false;
        this.bottomHoldFrames = 0;
        this.squatQualityChecks = {
            hasProperDepth: false,
            hasControlledMovement: false,
            hasSymmetricMovement: false
        };
    }
}
   
async function createPoseLandmarker() {
    initialStatus.innerHTML = `<span class="loading"></span> AI 모델을 로딩중입니다...`;
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
        initialStatus.textContent = 'AI 모델 준비 완료!';
    } catch (error) {
        console.error("MODEL_LOAD_ERROR:", error);
        initialStatus.textContent = '❌ 모델 로딩 실패. 새로고침 해주세요.';
    }
}

// DOMContentLoaded 이벤트 리스너
document.addEventListener('DOMContentLoaded', () => {
    squatAnalyzer = new SquatAnalyzer(); // 이곳에서 인스턴스 생성
    createPoseLandmarker(); // 기존 createPoseLandmarker 호출은 유지
});

function resetApp() {
    squatCount = 0; // 전역 변수 초기화
    bestMomentTime = 0;
    lowestKneeAngle = 180;
    analysisStarted = false;
    
    // SquatAnalyzer 내부 상태 초기화
    if (squatAnalyzer) { // squatAnalyzer가 정의되었는지 확인 후 호출
        squatAnalyzer.reset(); 
    }
    
    if (uploadSection) uploadSection.style.display = 'block';
    if (analysisSection) analysisSection.style.display = 'none';
    if (resultSection) resultSection.style.display = 'none';
    if (startAnalysisBtn) {
        startAnalysisBtn.disabled = false;
        startAnalysisBtn.textContent = "이 영상으로 분석 시작하기 🔬";
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

    // animationFrameId 초기화 로직도 추가
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
}

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
    startAnalysisBtn.textContent = "분석 중...";
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
        // 점수 계산은 SquatAnalyzer의 최종 누적 점수를 사용 
        const finalScores = {
            depth: squatAnalyzer.frameCount > 0 ? Math.round(squatAnalyzer.totalScores.depth / squatAnalyzer.frameCount) : 0,
            backPosture: squatAnalyzer.frameCount > 0 ? Math.round(squatAnalyzer.totalScores.backPosture / squatAnalyzer.frameCount) : 0
        };
        const finalTotalScore = Math.round((finalScores.depth + finalScores.backPosture) / 2);
        const qualitativeFeedback = getQualitativeFeedback(finalTotalScore);
        
        await createShareableImage(finalTotalScore, qualitativeFeedback);
        feedbackList.textContent = qualitativeFeedback;

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
            // SquatAnalyzer의 메인 분석 함수 호출 (this 컨텍스트 유지)
            // analyzeBetterSquat는 SquatAnalyzer 클래스의 메서드이므로, squatAnalyzer 객체를 통해 호출해야 함
            squatAnalyzer.analyzeBetterSquat(result.landmarks);
        } else {
            console.log("POSE_DETECTION_STATUS: 랜드마크가 감지되지 않음 (MediaPipe로부터 결과 없음).");
        }
    });
    animationFrameId = requestAnimationFrame(processVideoFrame);
}

// 이벤트 리스너들
videoUpload?.addEventListener('change', handleVideoUpload);
video?.addEventListener('loadedmetadata', setupVideoDisplay);
video?.addEventListener('ended', () => { if(video && !video.loop && analysisStarted) endAnalysis(); });
startAnalysisBtn?.addEventListener('click', (event) => { event.preventDefault(); startAnalysis(); });
resetBtn?.addEventListener('click', (event) => { event.preventDefault(); videoUpload.value = ''; resetApp(); });
shareStoryBtn?.addEventListener('click', (event) => { event.preventDefault();
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
