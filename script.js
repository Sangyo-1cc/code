import { PoseLandmarker, FilesetResolver, DrawingUtils } from "https://cdn.skypack.dev/@mediapipe/tasks-vision@0.10.12";

const videoUpload = document.getElementById("videoUpload"), video = document.getElementById("analysisVideo"), canvasElement = document.getElementById("output_canvas"), canvasCtx = canvasElement.getContext("2d"), videoContainer = document.getElementById("videoContainer"), statusElement = document.getElementById("status"), feedbackList = document.getElementById("feedbackList"), shareStoryBtn = document.getElementById("shareStoryBtn"), uploadSection = document.getElementById('upload-section'), analysisSection = document.getElementById('analysis-section'), resultSection = document.getElementById('result-section'), storyCanvas = document.getElementById('story-canvas'), storyCtx = storyCanvas.getContext('2d'), coachFeedbackArea = document.getElementById('coach-feedback-area'), storyCanvasContainer = document.getElementById('story-canvas-container'), startAnalysisBtn = document.getElementById('startAnalysisBtn'), resetBtn = document.getElementById('resetBtn'), noSquatResultArea = document.getElementById('no-squat-result-area'), initialStatus = document.getElementById('initial-status');

// 스쿼트 분석 관련 변수 (SquatAnalyzer 클래스에서 관리할 상태 변수 일부 제외)
let poseLandmarker, squatCount = 0, bestMomentTime = 0, lowestKneeAngle = 180, animationFrameId, analysisStarted = false;

// SquatAnalyzer 인스턴스 생성
const squatAnalyzer = new SquatAnalyzer();

// 디버그 모드 토글 (개발 시 true, 배포 시 false)
const DEBUG_MODE = true;

// 기존 calculateAngle 함수를 클래스 외부에서 호출 가능하도록 유지
function calculateAngle(a, b, c) {
    const r = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(a.y - b.y, a.x - b.x);
    let ang = Math.abs(r * 180.0 / Math.PI);
    if (ang > 180.0) ang = 360 - ang;
    return ang;
}

// 개선된 스쿼트 분석 함수를 포함하는 클래스
class SquatAnalyzer {
    constructor() {
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
        // MediaPipe 좌표는 0~1 사이로 정규화되어 있으므로 0.05는 꽤 큰 차이일 수 있음.
        // 테스트 필요: 0.02 또는 0.03으로 더 엄격하게
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
            // 손이 어깨보다 많이 위에 있으면 춤추는 동작일 가능성
            // Y좌표는 아래로 갈수록 커지므로, 손이 어깨보다 '위'에 있다면 Y좌표는 더 작아야 함.
            const handsAboveShoulders = 
                (leftWrist.y < leftShoulder.y - 0.1) || // 어깨 Y보다 0.1 작으면 (위에 있으면)
                (rightWrist.y < rightShoulder.y - 0.1);
            
            if (handsAboveShoulders) {
                if (DEBUG_MODE) console.log("MOVEMENT_FILTER: 춤추는 동작 감지 - 스쿼트 분석 제외 (손 위치)");
                return true; // 비스쿼트 동작으로 판단
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
        
        // 상체가 너무 앞으로 기울어진 경우 (요가 자세 등)
        if (torsoAngle > 70) { // 70도 (수직에서 70도 기울어짐)는 상당히 많이 기운 것.
            if (DEBUG_MODE) console.log("MOVEMENT_FILTER: 과도한 상체 기울임 감지 - 요가/스트레칭 동작으로 판단");
            return true;
        }
        
        return false; // 스쿼트 가능성 있음
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
            return; // 스쿼트가 아닌 동작이므로 분석 중단
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
        const shoulder = {x:(pose[11].x+pose[12].x)/2, y:(pose[11].y+pose[12].y)/2}; // 어깨점도 여기서 정의

        // 각도 계산 및 스무딩
        const rawKneeAngle = calculateAngle(hip, knee, ankle); // 외부 calculateAngle 사용
        const kneeAngle = this.smoothAngle(rawKneeAngle);
        
        // 움직임 속도 계산
        const velocity = this.calculateMovementVelocity(kneeAngle);
        
        // 스쿼트 품질 검증
        const isValidSquat = this.validateSquatQuality(kneeAngle, leftKnee, rightKnee, hip, velocity);
        
        if (!isValidSquat) {
            if (DEBUG_MODE) console.log("QUALITY_CHECK: 스쿼트 품질 기준 미달 - 카운트 제외");
            return; // 품질 기준 미달이므로 카운트하지 않음
        }
        
        // 점수 계산 (클래스 내부에서 계산하도록 변경)
        let depthScore = 0;
        if (kneeAngle >= 160) depthScore = 0;
        else if (kneeAngle <= 60) depthScore = 100;
        else { 
            depthScore = 100 - ((kneeAngle - 60) / (160 - 60)) * 100; 
        }
        depthScore = Math.round(Math.max(0, depthScore)); 
        
        let backScore = 0;
        const idealTorsoMin = 10;
        const idealTorsoMax = 50;
        if (calculateAngle(shoulder, hip, { x: hip.x, y: hip.y - 1 }) >= idealTorsoMin && calculateAngle(shoulder, hip, { x: hip.x, y: hip.y - 1 }) <= idealTorsoMax) {
            backScore = 100;
        } else if (calculateAngle(shoulder, hip, { x: hip.x, y: hip.y - 1 }) < idealTorsoMin) {
            backScore = Math.max(0, 100 - (idealTorsoMin - calculateAngle(shoulder, hip, { x: hip.x, y: hip.y - 1 })) * 5);
        } else {
            backScore = Math.max(0, 100 - (calculateAngle(shoulder, hip, { x: hip.x, y: hip.y - 1 }) - idealTorsoMax) * 3);
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

function resetApp() {
    squatCount = 0; // 전역 변수 초기화
    bestMomentTime = 0;
    lowestKneeAngle = 180;
    analysisStarted = false;
    
    // SquatAnalyzer 내부 상태 초기화
    squatAnalyzer.squatPhase = 'standing';
    squatAnalyzer.frameCount = 0;
    squatAnalyzer.totalScores = { depth: 0, backPosture: 0 };
    squatAnalyzer.repReachedMinDepth = false;
    squatAnalyzer.bottomHoldFrames = 0;
    squatAnalyzer.angleHistory = [];
    squatAnalyzer.velocityHistory = [];
    squatAnalyzer.squatQualityChecks = {
        hasProperDepth: false,
        hasControlledMovement: false,
        hasSymmetricMovement: false
    };

    uploadSection.style.display = 'block';
    analysisSection.style.display = 'none';
    resultSection.style.display = 'none';
    startAnalysisBtn.disabled = false;
    startAnalysisBtn.textContent = "이 영상으로 분석 시작하기 🔬";
    if(video.src) {
        video.pause();
        video.removeAttribute('src');
        video.load();
    }
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    initialStatus.textContent = '';
    statusElement.innerHTML = ''; 
}

function handleVideoUpload(event) {
    const file = event.target.files[0];
    if (!file) return;

    uploadSection.style.display = 'none';
    analysisSection.style.display = 'block';
    
    const fileURL = URL.createObjectURL(file);
    video.src = fileURL;
    video.play();
}

function setupVideoDisplay() {
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
    if (video.paused || video.ended) return;

    canvasCtx.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);
    animationFrameId = requestAnimationFrame(previewLoop);
}

function startAnalysis() {
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
    analysisSection.style.display = 'none';
    resultSection.style.display = 'block';

    if (squatCount > 0) { 
        showRegularResults();
        // 스쿼트 분석기의 최종 점수를 가져옴
        const finalScores = {
            depth: Math.round(squatAnalyzer.totalScores.depth / squatAnalyzer.frameCount),
            backPosture: Math.round(squatAnalyzer.totalScores.backPosture / squatAnalyzer.frameCount)
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
    if (!poseLandmarker || video.ended) {
        if (video.ended) endAnalysis();
        return;
    }

    poseLandmarker.detectForVideo(video, performance.now(), (result) => {
        canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
        canvasCtx.drawImage(video, 0, 0, canvasElement.width, canvasElement.height);

        const drawingUtils = new DrawingUtils(canvasCtx);
        if (result.landmarks && result.landmarks.length > 0) {
            drawingUtils.drawLandmarks(result.landmarks[0], {color: '#FFC107', lineWidth: 2});
            drawingUtils.drawConnectors(result.landmarks[0], PoseLandmarker.POSE_CONNECTIONS, {color: '#FFFFFF', lineWidth: 2});
            // SquatAnalyzer의 메인 분석 함수 호출
            squatAnalyzer.analyzeBetterSquat(result.landmarks);
        } else {
            console.log("POSE_DETECTION_STATUS: 랜드마크가 감지되지 않음 (MediaPipe로부터 결과 없음).");
        }
    });
    animationFrameId = requestAnimationFrame(processVideoFrame);
}

videoUpload.addEventListener('change', handleVideoUpload);
video.addEventListener('loadedmetadata', setupVideoDisplay);
video.addEventListener('ended', () => { if(!video.loop && analysisStarted) endAnalysis(); });
startAnalysisBtn.addEventListener('click', (event) => { event.preventDefault(); startAnalysis(); });
resetBtn.addEventListener('click', (event) => { event.preventDefault(); videoUpload.value = ''; resetApp(); });
shareStoryBtn.addEventListener('click', (event) => { event.preventDefault();
    if (squatCount === 0) {
        alert("스쿼트가 감지되지 않아 결과 이미지를 다운로드할 수 없습니다.");
        return;
    }
    const dataURL = storyCanvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.download = `squat-analysis-story-${Date.now()}.png`;
    link.href = dataURL;
    link.click();
});
document.addEventListener('DOMContentLoaded', createPoseLandmarker);
